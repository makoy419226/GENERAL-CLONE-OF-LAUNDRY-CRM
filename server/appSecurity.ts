import { eq, sql } from "drizzle-orm";
import { appSecuritySettings } from "@shared/schema";
import { db, getCurrentDatabaseScope } from "./db";

const DEFAULT_LOCKDOWN_REASON = "Page lockdown for security reasons.";

export type AppLockdownStatus = {
  enabled: boolean;
  reason: string;
  lockedAt: string | null;
  lockedBy: string | null;
  updatedAt: string | null;
};

let ensurePromise: Promise<void> | null = null;
const cachedStatuses = new Map<
  string,
  { status: AppLockdownStatus; expiresAt: number }
>();

function getScopeCacheKey() {
  const scope = getCurrentDatabaseScope();
  if (!scope) return "unscoped";
  return "platform" in scope ? "platform" : `business:${scope.businessId}`;
}

export function clearAppLockdownStatusCache() {
  cachedStatuses.clear();
}

export async function ensureAppSecuritySettingsTable(): Promise<void> {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_RUNTIME_SCHEMA_MIGRATIONS !== "true"
  ) {
    return;
  }

  if (!ensurePromise) {
    ensurePromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_security_settings (
          id SERIAL PRIMARY KEY,
          lockdown_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          lockdown_reason TEXT NOT NULL DEFAULT 'Page lockdown for security reasons.',
          lockdown_at TIMESTAMP,
          lockdown_by TEXT,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }

  await ensurePromise;
}

function toLockdownStatus(row: typeof appSecuritySettings.$inferSelect): AppLockdownStatus {
  return {
    enabled: !!row.lockdownEnabled,
    reason: row.lockdownReason || DEFAULT_LOCKDOWN_REASON,
    lockedAt: row.lockdownAt ? new Date(row.lockdownAt).toISOString() : null,
    lockedBy: row.lockdownBy || null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

export async function getAppLockdownStatus(): Promise<AppLockdownStatus> {
  const cacheKey = getScopeCacheKey();
  const cached = cachedStatuses.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.status;
  }

  await ensureAppSecuritySettingsTable();

  const [settings] = await db
    .select()
    .from(appSecuritySettings)
    .orderBy(appSecuritySettings.id)
    .limit(1);

  const status = toLockdownStatus(
    settings || {
      id: 0,
      businessId: null,
      lockdownEnabled: false,
      lockdownReason: DEFAULT_LOCKDOWN_REASON,
      lockdownAt: null,
      lockdownBy: null,
      updatedAt: new Date(),
    },
  );

  cachedStatuses.set(cacheKey, {
    status,
    expiresAt: Date.now() + 1000,
  });
  return status;
}

export async function getAppLockdownStatusForBusiness(
  businessId: number,
): Promise<AppLockdownStatus> {
  if (!Number.isSafeInteger(businessId) || businessId <= 0) {
    throw new Error("A valid business is required for lockdown status");
  }

  const cacheKey = `business:${businessId}`;
  const cached = cachedStatuses.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.status;
  }

  await ensureAppSecuritySettingsTable();
  const [settings] = await db
    .select()
    .from(appSecuritySettings)
    .where(eq(appSecuritySettings.businessId, businessId))
    .limit(1);
  const status = toLockdownStatus(
    settings || {
      id: 0,
      businessId,
      lockdownEnabled: false,
      lockdownReason: DEFAULT_LOCKDOWN_REASON,
      lockdownAt: null,
      lockdownBy: null,
      updatedAt: new Date(),
    },
  );

  cachedStatuses.set(cacheKey, {
    status,
    expiresAt: Date.now() + 1000,
  });
  return status;
}

export async function setAppLockdownStatus(
  enabled: boolean,
  actor: string,
): Promise<AppLockdownStatus> {
  await ensureAppSecuritySettingsTable();

  const nextLockdownAt = enabled ? new Date() : null;
  const nextLockdownBy = enabled ? actor || "Admin" : null;

  const [existing] = await db
    .select({ id: appSecuritySettings.id })
    .from(appSecuritySettings)
    .orderBy(appSecuritySettings.id)
    .limit(1);

  const [updated] = existing
    ? await db
        .update(appSecuritySettings)
        .set({
          lockdownEnabled: enabled,
          lockdownReason: DEFAULT_LOCKDOWN_REASON,
          lockdownAt: nextLockdownAt,
          lockdownBy: nextLockdownBy,
          updatedAt: new Date(),
        })
        .where(eq(appSecuritySettings.id, existing.id))
        .returning()
    : await db
        .insert(appSecuritySettings)
        .values({
          lockdownEnabled: enabled,
          lockdownReason: DEFAULT_LOCKDOWN_REASON,
          lockdownAt: nextLockdownAt,
          lockdownBy: nextLockdownBy,
        })
        .returning();

  clearAppLockdownStatusCache();

  return toLockdownStatus(updated);
}
