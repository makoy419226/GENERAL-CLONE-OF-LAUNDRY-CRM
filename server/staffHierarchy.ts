import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { and, asc, eq, ne, or } from "drizzle-orm";
import { z } from "zod";
import { organizationUnits, staffProfiles, users } from "@shared/schema";
import { db } from "./db";
import {
  requireTenantContext,
  type TenantAccountRequestContext,
} from "./tenantContext";

const unitTypeSchema = z.enum(["branch", "department", "team"]);
const operationalRoleSchema = z.enum([
  "manager",
  "counter",
  "production",
  "driver",
]);
const activityPinSchema = z
  .string()
  .regex(/^\d{5}$/, "Activity PIN must contain exactly 5 digits");

const createUnitSchema = z
  .object({
    name: z.string().trim().min(1, "Unit name is required").max(120),
    unitType: unitTypeSchema,
    parentId: z.number().int().positive().nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();

const updateUnitSchema = createUnitSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Choose at least one unit field to update",
  });

const nullableShortTextSchema = z
  .string()
  .trim()
  .max(120)
  .nullable();

const createStaffProfileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, "Staff display name is required")
      .max(120),
    jobTitle: nullableShortTextSchema.optional(),
    operationalRole: operationalRoleSchema,
    organizationUnitId: z.number().int().positive().nullable().optional(),
    managerStaffId: z.number().int().positive().nullable().optional(),
    active: z.boolean().optional(),
    activityPin: activityPinSchema.optional(),
  })
  .strict();

const updateStaffProfileSchema = createStaffProfileSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Choose at least one staff profile field to update",
  });

const verifyPinSchema = z
  .object({
    pin: activityPinSchema,
  })
  .strict();

type OrganizationUnitRow = typeof organizationUnits.$inferSelect;
type StaffProfileRow = typeof staffProfiles.$inferSelect;

type ManagementAccess = {
  allowed: boolean;
  managerProfileId: number | null;
};

function parsePositiveId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeNullableText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const normalized = String(value || "").trim();
  return normalized || null;
}

function serializeUnit(unit: OrganizationUnitRow, validUnitIds?: Set<number>) {
  return {
    id: unit.id,
    publicKey: unit.publicKey,
    name: unit.name,
    unitType: unit.unitType,
    parentId:
      unit.parentId !== null && (!validUnitIds || validUnitIds.has(unit.parentId))
        ? unit.parentId
        : null,
    active: unit.active,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
  };
}

function serializeStaffProfile(
  profile: StaffProfileRow,
  validUnitIds?: Set<number>,
  validProfileIds?: Set<number>,
) {
  return {
    id: profile.id,
    publicKey: profile.publicKey,
    organizationUnitId:
      profile.organizationUnitId !== null &&
      (!validUnitIds || validUnitIds.has(profile.organizationUnitId))
        ? profile.organizationUnitId
        : null,
    managerStaffId:
      profile.managerStaffId !== null &&
      (!validProfileIds || validProfileIds.has(profile.managerStaffId))
        ? profile.managerStaffId
        : null,
    displayName: profile.displayName,
    jobTitle: profile.jobTitle,
    operationalRole: profile.operationalRole,
    active: profile.active,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function serializeVerifiedActor(profile: StaffProfileRow) {
  return {
    id: profile.id,
    publicKey: profile.publicKey,
    displayName: profile.displayName,
    jobTitle: profile.jobTitle,
    operationalRole: profile.operationalRole,
    organizationUnitId: profile.organizationUnitId,
  };
}

async function serializeScopedUnit(unit: OrganizationUnitRow, businessId: number) {
  const validUnitIds = new Set<number>([unit.id]);
  if (unit.parentId !== null) {
    const parent = await getScopedUnit(businessId, unit.parentId);
    if (parent) validUnitIds.add(parent.id);
  }
  return serializeUnit(unit, validUnitIds);
}

async function serializeScopedStaffProfile(
  profile: StaffProfileRow,
  businessId: number,
) {
  const validUnitIds = new Set<number>();
  const validProfileIds = new Set<number>([profile.id]);

  if (profile.organizationUnitId !== null) {
    const unit = await getScopedUnit(businessId, profile.organizationUnitId);
    if (unit) validUnitIds.add(unit.id);
  }
  if (profile.managerStaffId !== null) {
    const manager = await getScopedProfile(businessId, profile.managerStaffId);
    if (manager) validProfileIds.add(manager.id);
  }

  return serializeStaffProfile(profile, validUnitIds, validProfileIds);
}

function sendValidationError(res: Response, error: z.ZodError) {
  return res.status(400).json({
    success: false,
    message: error.issues[0]?.message || "Choose valid hierarchy details",
  });
}

function sendUnexpectedError(res: Response, operation: string) {
  return res.status(500).json({
    success: false,
    message: `Unable to ${operation}`,
  });
}

async function getManagementAccess(
  context: TenantAccountRequestContext,
): Promise<ManagementAccess> {
  if (context.role === "admin") {
    return { allowed: true, managerProfileId: null };
  }

  const [directlyLinkedProfile] = await db
    .select({ id: staffProfiles.id })
    .from(staffProfiles)
    .where(
      and(
        eq(staffProfiles.businessId, context.businessId),
        eq(staffProfiles.linkedUserId, context.userId),
        eq(staffProfiles.operationalRole, "manager"),
        eq(staffProfiles.active, true),
      ),
    )
    .limit(1);

  if (directlyLinkedProfile) {
    return { allowed: true, managerProfileId: directlyLinkedProfile.id };
  }

  const [accountLink] = await db
    .select({ staffProfileId: users.staffProfileId })
    .from(users)
    .where(
      and(
        eq(users.id, context.userId),
        eq(users.businessId, context.businessId),
      ),
    )
    .limit(1);

  if (!accountLink?.staffProfileId) {
    return { allowed: false, managerProfileId: null };
  }

  const [linkedManagerProfile] = await db
    .select({ id: staffProfiles.id })
    .from(staffProfiles)
    .where(
      and(
        eq(staffProfiles.id, accountLink.staffProfileId),
        eq(staffProfiles.businessId, context.businessId),
        eq(staffProfiles.operationalRole, "manager"),
        eq(staffProfiles.active, true),
      ),
    )
    .limit(1);

  return linkedManagerProfile
    ? { allowed: true, managerProfileId: linkedManagerProfile.id }
    : { allowed: false, managerProfileId: null };
}

async function requireHierarchyManager(
  req: Request,
  res: Response,
): Promise<{
  context: TenantAccountRequestContext;
  access: ManagementAccess;
} | null> {
  const context = await requireTenantContext(req, res);
  if (!context) return null;

  const access = await getManagementAccess(context);
  if (!access.allowed) {
    res.status(403).json({
      success: false,
      message: "Tenant administrator or manager access is required",
    });
    return null;
  }

  return { context, access };
}

async function getScopedUnit(businessId: number, unitId: number) {
  const [unit] = await db
    .select()
    .from(organizationUnits)
    .where(
      and(
        eq(organizationUnits.id, unitId),
        eq(organizationUnits.businessId, businessId),
      ),
    )
    .limit(1);
  return unit || null;
}

async function getScopedProfile(businessId: number, profileId: number) {
  const [profile] = await db
    .select()
    .from(staffProfiles)
    .where(
      and(
        eq(staffProfiles.id, profileId),
        eq(staffProfiles.businessId, businessId),
      ),
    )
    .limit(1);
  return profile || null;
}

async function validateParentUnit(
  businessId: number,
  parentId: number | null | undefined,
  unitBeingUpdated?: number,
) {
  if (parentId === undefined || parentId === null) return;
  if (parentId === unitBeingUpdated) {
    throw new Error("A unit cannot be its own parent");
  }

  const parent = await getScopedUnit(businessId, parentId);
  if (!parent || parent.active !== true) {
    throw new Error("Choose an active parent unit from this business");
  }

  if (!unitBeingUpdated) return;

  const visited = new Set<number>();
  let current: OrganizationUnitRow | null = parent;
  while (current) {
    if (current.id === unitBeingUpdated) {
      throw new Error("A unit hierarchy cycle is not allowed");
    }
    if (visited.has(current.id)) {
      throw new Error("The selected parent hierarchy is invalid");
    }
    visited.add(current.id);

    if (current.parentId === null) break;
    current = await getScopedUnit(businessId, current.parentId);
    if (!current) {
      throw new Error("The selected parent hierarchy is invalid");
    }
  }
}

async function validateOrganizationUnitAssignment(
  businessId: number,
  organizationUnitId: number | null | undefined,
) {
  if (organizationUnitId === undefined || organizationUnitId === null) return;
  const unit = await getScopedUnit(businessId, organizationUnitId);
  if (!unit || unit.active !== true) {
    throw new Error("Choose an active organization unit from this business");
  }
}

async function validateManagerAssignment(
  businessId: number,
  managerStaffId: number | null | undefined,
  profileBeingUpdated?: number,
) {
  if (managerStaffId === undefined || managerStaffId === null) return;
  if (managerStaffId === profileBeingUpdated) {
    throw new Error("A staff profile cannot manage itself");
  }

  const manager = await getScopedProfile(businessId, managerStaffId);
  if (
    !manager ||
    manager.active !== true ||
    manager.operationalRole !== "manager"
  ) {
    throw new Error("Choose an active manager from this business");
  }

  if (!profileBeingUpdated) return;

  const visited = new Set<number>();
  let current: StaffProfileRow | null = manager;
  while (current) {
    if (current.id === profileBeingUpdated) {
      throw new Error("A staff management cycle is not allowed");
    }
    if (visited.has(current.id)) {
      throw new Error("The selected manager hierarchy is invalid");
    }
    visited.add(current.id);

    if (current.managerStaffId === null) break;
    current = await getScopedProfile(businessId, current.managerStaffId);
    if (!current) {
      throw new Error("The selected manager hierarchy is invalid");
    }
  }
}

async function assertActivityPinAvailable(
  businessId: number,
  pin: string,
  excludeProfileId?: number,
) {
  const profiles = await db
    .select({ id: staffProfiles.id, pinHash: staffProfiles.pinHash })
    .from(staffProfiles)
    .where(
      excludeProfileId
        ? and(
            eq(staffProfiles.businessId, businessId),
            ne(staffProfiles.id, excludeProfileId),
          )
        : eq(staffProfiles.businessId, businessId),
  );

  for (const profile of profiles) {
    if (profile.pinHash && (await activityPinMatches(pin, profile.pinHash))) {
      throw new Error("That activity PIN is already assigned in this business");
    }
  }
}

async function activityPinMatches(pin: string, pinHash: string) {
  try {
    return await bcrypt.compare(pin, pinHash);
  } catch {
    return false;
  }
}

function isValidationMessage(error: unknown): error is Error {
  return (
    error instanceof Error &&
    /^(A |Choose |The |That )/.test(error.message)
  );
}

function sendOperationError(
  res: Response,
  error: unknown,
  operation: string,
) {
  if (isValidationMessage(error)) {
    return res.status(400).json({ success: false, message: error.message });
  }
  return sendUnexpectedError(res, operation);
}

export function registerStaffHierarchyRoutes(app: Express) {
  app.get("/api/organization-units", async (req, res) => {
    const context = await requireTenantContext(req, res);
    if (!context) return;

    try {
      const units = await db
        .select()
        .from(organizationUnits)
        .where(eq(organizationUnits.businessId, context.businessId))
        .orderBy(asc(organizationUnits.name), asc(organizationUnits.id));
      const validUnitIds = new Set(units.map((unit) => unit.id));
      res.json(units.map((unit) => serializeUnit(unit, validUnitIds)));
    } catch {
      sendUnexpectedError(res, "load organization units");
    }
  });

  app.get("/api/organization-units/:id", async (req, res) => {
    const context = await requireTenantContext(req, res);
    if (!context) return;
    const unitId = parsePositiveId(req.params.id);
    if (!unitId) {
      return res.status(400).json({ message: "Choose a valid organization unit" });
    }

    try {
      const unit = await getScopedUnit(context.businessId, unitId);
      if (!unit) {
        return res.status(404).json({ message: "Organization unit not found" });
      }
      res.json(await serializeScopedUnit(unit, context.businessId));
    } catch {
      sendUnexpectedError(res, "load the organization unit");
    }
  });

  app.post("/api/organization-units", async (req, res) => {
    const managed = await requireHierarchyManager(req, res);
    if (!managed) return;

    const parsed = createUnitSchema.safeParse(req.body || {});
    if (!parsed.success) return sendValidationError(res, parsed.error);

    try {
      await validateParentUnit(
        managed.context.businessId,
        parsed.data.parentId,
      );
      const [unit] = await db
        .insert(organizationUnits)
        .values({
          businessId: managed.context.businessId,
          name: parsed.data.name,
          unitType: parsed.data.unitType,
          parentId: parsed.data.parentId ?? null,
          active: parsed.data.active ?? true,
          updatedAt: new Date(),
        })
        .returning();
      res
        .status(201)
        .json(await serializeScopedUnit(unit, managed.context.businessId));
    } catch (error) {
      sendOperationError(res, error, "create the organization unit");
    }
  });

  app.put("/api/organization-units/:id", async (req, res) => {
    const managed = await requireHierarchyManager(req, res);
    if (!managed) return;
    const unitId = parsePositiveId(req.params.id);
    if (!unitId) {
      return res.status(400).json({ message: "Choose a valid organization unit" });
    }

    const parsed = updateUnitSchema.safeParse(req.body || {});
    if (!parsed.success) return sendValidationError(res, parsed.error);

    try {
      const existing = await getScopedUnit(managed.context.businessId, unitId);
      if (!existing) {
        return res.status(404).json({ message: "Organization unit not found" });
      }
      await validateParentUnit(
        managed.context.businessId,
        parsed.data.parentId,
        unitId,
      );

      const [unit] = await db
        .update(organizationUnits)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(
          and(
            eq(organizationUnits.id, unitId),
            eq(organizationUnits.businessId, managed.context.businessId),
          ),
        )
        .returning();
      res.json(await serializeScopedUnit(unit, managed.context.businessId));
    } catch (error) {
      sendOperationError(res, error, "update the organization unit");
    }
  });

  app.delete("/api/organization-units/:id", async (req, res) => {
    const managed = await requireHierarchyManager(req, res);
    if (!managed) return;
    const unitId = parsePositiveId(req.params.id);
    if (!unitId) {
      return res.status(400).json({ message: "Choose a valid organization unit" });
    }

    try {
      const existing = await getScopedUnit(managed.context.businessId, unitId);
      if (!existing) {
        return res.status(404).json({ message: "Organization unit not found" });
      }

      const [childReference] = await db
        .select({ id: organizationUnits.id })
        .from(organizationUnits)
        .where(eq(organizationUnits.parentId, unitId))
        .limit(1);
      const [staffReference] = await db
        .select({ id: staffProfiles.id })
        .from(staffProfiles)
        .where(eq(staffProfiles.organizationUnitId, unitId))
        .limit(1);

      if (childReference || staffReference) {
        const [unit] = await db
          .update(organizationUnits)
          .set({ active: false, updatedAt: new Date() })
          .where(
            and(
              eq(organizationUnits.id, unitId),
              eq(organizationUnits.businessId, managed.context.businessId),
            ),
          )
          .returning();
        return res.json({
          success: true,
          deleted: false,
          deactivated: true,
          unit: await serializeScopedUnit(unit, managed.context.businessId),
        });
      }

      await db
        .delete(organizationUnits)
        .where(
          and(
            eq(organizationUnits.id, unitId),
            eq(organizationUnits.businessId, managed.context.businessId),
          ),
        );
      res.json({ success: true, deleted: true, deactivated: false });
    } catch {
      sendUnexpectedError(res, "remove the organization unit");
    }
  });

  app.get("/api/staff-profiles", async (req, res) => {
    const context = await requireTenantContext(req, res);
    if (!context) return;

    try {
      const [profiles, units] = await Promise.all([
        db
          .select()
          .from(staffProfiles)
          .where(eq(staffProfiles.businessId, context.businessId))
          .orderBy(asc(staffProfiles.displayName), asc(staffProfiles.id)),
        db
          .select({ id: organizationUnits.id })
          .from(organizationUnits)
          .where(eq(organizationUnits.businessId, context.businessId)),
      ]);
      const validUnitIds = new Set(units.map((unit) => unit.id));
      const validProfileIds = new Set(profiles.map((profile) => profile.id));
      res.json(
        profiles.map((profile) =>
          serializeStaffProfile(profile, validUnitIds, validProfileIds),
        ),
      );
    } catch {
      sendUnexpectedError(res, "load staff profiles");
    }
  });

  app.get("/api/staff-profiles/:id", async (req, res) => {
    const context = await requireTenantContext(req, res);
    if (!context) return;
    const profileId = parsePositiveId(req.params.id);
    if (!profileId) {
      return res.status(400).json({ message: "Choose a valid staff profile" });
    }

    try {
      const profile = await getScopedProfile(context.businessId, profileId);
      if (!profile) {
        return res.status(404).json({ message: "Staff profile not found" });
      }
      res.json(await serializeScopedStaffProfile(profile, context.businessId));
    } catch {
      sendUnexpectedError(res, "load the staff profile");
    }
  });

  app.post("/api/staff-profiles/verify-pin", async (req, res) => {
    const context = await requireTenantContext(req, res);
    if (!context) return;
    const parsed = verifyPinSchema.safeParse(req.body || {});
    if (!parsed.success) return sendValidationError(res, parsed.error);

    try {
      const profiles = await db
        .select()
        .from(staffProfiles)
        .where(
          and(
            eq(staffProfiles.businessId, context.businessId),
            eq(staffProfiles.active, true),
          ),
        );

      for (const profile of profiles) {
        if (
          profile.pinHash &&
          (await activityPinMatches(parsed.data.pin, profile.pinHash))
        ) {
          const safeProfile = await serializeScopedStaffProfile(
            profile,
            context.businessId,
          );
          return res.json({
            success: true,
            actor: {
              ...serializeVerifiedActor(profile),
              organizationUnitId: safeProfile.organizationUnitId,
            },
          });
        }
      }

      return res.status(401).json({
        success: false,
        message: "Invalid activity PIN",
      });
    } catch {
      sendUnexpectedError(res, "verify the activity PIN");
    }
  });

  app.post("/api/staff-profiles", async (req, res) => {
    const managed = await requireHierarchyManager(req, res);
    if (!managed) return;
    const parsed = createStaffProfileSchema.safeParse(req.body || {});
    if (!parsed.success) return sendValidationError(res, parsed.error);

    try {
      await validateOrganizationUnitAssignment(
        managed.context.businessId,
        parsed.data.organizationUnitId,
      );
      await validateManagerAssignment(
        managed.context.businessId,
        parsed.data.managerStaffId,
      );
      if (parsed.data.activityPin) {
        await assertActivityPinAvailable(
          managed.context.businessId,
          parsed.data.activityPin,
        );
      }

      const pinHash = parsed.data.activityPin
        ? await bcrypt.hash(parsed.data.activityPin, 12)
        : null;
      const [profile] = await db
        .insert(staffProfiles)
        .values({
          businessId: managed.context.businessId,
          displayName: parsed.data.displayName,
          jobTitle: normalizeNullableText(parsed.data.jobTitle) ?? null,
          operationalRole: parsed.data.operationalRole,
          organizationUnitId: parsed.data.organizationUnitId ?? null,
          managerStaffId: parsed.data.managerStaffId ?? null,
          active: parsed.data.active ?? true,
          pinHash,
          linkedUserId: null,
          updatedAt: new Date(),
        })
        .returning();
      res
        .status(201)
        .json(
          await serializeScopedStaffProfile(
            profile,
            managed.context.businessId,
          ),
        );
    } catch (error) {
      sendOperationError(res, error, "create the staff profile");
    }
  });

  app.put("/api/staff-profiles/:id", async (req, res) => {
    const managed = await requireHierarchyManager(req, res);
    if (!managed) return;
    const profileId = parsePositiveId(req.params.id);
    if (!profileId) {
      return res.status(400).json({ message: "Choose a valid staff profile" });
    }
    const parsed = updateStaffProfileSchema.safeParse(req.body || {});
    if (!parsed.success) return sendValidationError(res, parsed.error);

    try {
      const existing = await getScopedProfile(
        managed.context.businessId,
        profileId,
      );
      if (!existing) {
        return res.status(404).json({ message: "Staff profile not found" });
      }

      const managerIsChangingOwnAuthority =
        managed.access.managerProfileId === profileId &&
        (parsed.data.active === false ||
          (parsed.data.operationalRole !== undefined &&
            parsed.data.operationalRole !== "manager"));
      if (managerIsChangingOwnAuthority) {
        return res.status(403).json({
          message: "A manager cannot remove their own management access",
        });
      }

      await validateOrganizationUnitAssignment(
        managed.context.businessId,
        parsed.data.organizationUnitId,
      );
      await validateManagerAssignment(
        managed.context.businessId,
        parsed.data.managerStaffId,
        profileId,
      );

      if (
        parsed.data.operationalRole !== undefined &&
        parsed.data.operationalRole !== "manager"
      ) {
        const [subordinate] = await db
          .select({ id: staffProfiles.id })
          .from(staffProfiles)
          .where(
            and(
              eq(staffProfiles.businessId, managed.context.businessId),
              eq(staffProfiles.managerStaffId, profileId),
            ),
          )
          .limit(1);
        if (subordinate) {
          return res.status(400).json({
            message: "Reassign this manager's staff before changing the role",
          });
        }
      }

      let pinHash: string | undefined;
      if (parsed.data.activityPin) {
        await assertActivityPinAvailable(
          managed.context.businessId,
          parsed.data.activityPin,
          profileId,
        );
        pinHash = await bcrypt.hash(parsed.data.activityPin, 12);
      }

      const { activityPin: _activityPin, ...profileUpdates } = parsed.data;
      const updates = {
        ...profileUpdates,
        ...(profileUpdates.jobTitle !== undefined
          ? { jobTitle: normalizeNullableText(profileUpdates.jobTitle) }
          : {}),
        ...(pinHash ? { pinHash } : {}),
        updatedAt: new Date(),
      };
      const [profile] = await db
        .update(staffProfiles)
        .set(updates)
        .where(
          and(
            eq(staffProfiles.id, profileId),
            eq(staffProfiles.businessId, managed.context.businessId),
          ),
        )
        .returning();
      res.json(
        await serializeScopedStaffProfile(
          profile,
          managed.context.businessId,
        ),
      );
    } catch (error) {
      sendOperationError(res, error, "update the staff profile");
    }
  });

  app.delete("/api/staff-profiles/:id", async (req, res) => {
    const managed = await requireHierarchyManager(req, res);
    if (!managed) return;
    const profileId = parsePositiveId(req.params.id);
    if (!profileId) {
      return res.status(400).json({ message: "Choose a valid staff profile" });
    }

    try {
      const existing = await getScopedProfile(
        managed.context.businessId,
        profileId,
      );
      if (!existing) {
        return res.status(404).json({ message: "Staff profile not found" });
      }
      if (managed.access.managerProfileId === profileId) {
        return res.status(403).json({
          message: "A manager cannot remove their own profile",
        });
      }

      const [subordinateReference] = await db
        .select({ id: staffProfiles.id })
        .from(staffProfiles)
        .where(eq(staffProfiles.managerStaffId, profileId))
        .limit(1);
      const [accountReference] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          or(
            eq(users.staffProfileId, profileId),
            existing.linkedUserId !== null
              ? eq(users.id, existing.linkedUserId)
              : eq(users.id, -1),
          ),
        )
        .limit(1);

      if (
        subordinateReference ||
        accountReference ||
        existing.linkedUserId !== null
      ) {
        const [profile] = await db
          .update(staffProfiles)
          .set({ active: false, updatedAt: new Date() })
          .where(
            and(
              eq(staffProfiles.id, profileId),
              eq(staffProfiles.businessId, managed.context.businessId),
            ),
          )
          .returning();
        return res.json({
          success: true,
          deleted: false,
          deactivated: true,
          profile: await serializeScopedStaffProfile(
            profile,
            managed.context.businessId,
          ),
        });
      }

      await db
        .delete(staffProfiles)
        .where(
          and(
            eq(staffProfiles.id, profileId),
            eq(staffProfiles.businessId, managed.context.businessId),
          ),
        );
      res.json({ success: true, deleted: true, deactivated: false });
    } catch {
      sendUnexpectedError(res, "remove the staff profile");
    }
  });
}
