import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { laundryBusinesses, users } from "@shared/schema";
import { getRequestAuth } from "./authToken";
import { db } from "./db";

export type CanonicalTenantRole =
  | "admin"
  | "counter"
  | "production"
  | "driver";

export type RequestIdentityRole = "super_admin" | CanonicalTenantRole;

export interface TenantRequestContext {
  userId: number;
  username: string;
  role: RequestIdentityRole;
  businessId: number | null;
  businessSlug: string | null;
  businessName: string | null;
}

export type TenantAccountRequestContext = TenantRequestContext & {
  role: CanonicalTenantRole;
  businessId: number;
  businessSlug: string;
  businessName: string;
};

export type PlatformOwnerRequestContext = TenantRequestContext & {
  role: "super_admin";
  businessId: null;
  businessSlug: null;
  businessName: null;
};

type IdentityFailure = {
  ok: false;
  status: 401 | 403 | 503;
  message: string;
};

export type RequestIdentityResolution =
  | { ok: true; context: TenantRequestContext }
  | IdentityFailure;

const INVALID_SESSION: IdentityFailure = {
  ok: false,
  status: 401,
  message: "Your session is invalid or has expired",
};

const TENANT_UNAVAILABLE: IdentityFailure = {
  ok: false,
  status: 403,
  message: "Tenant access is currently unavailable",
};

const IDENTITY_UNAVAILABLE: IdentityFailure = {
  ok: false,
  status: 503,
  message: "Authentication is temporarily unavailable",
};

function normalizeStoredRole(role: unknown): string {
  return String(role || "")
    .trim()
    .toLowerCase();
}

export function canonicalizeTenantRole(
  role: unknown,
): CanonicalTenantRole | null {
  switch (normalizeStoredRole(role)) {
    case "admin":
      return "admin";
    case "counter":
    case "reception":
      return "counter";
    case "production":
    case "section":
    case "staff":
      return "production";
    case "driver":
      return "driver";
    default:
      return null;
  }
}

/**
 * Resolves the caller exclusively from the signed bearer token and current
 * database state. Tenant identifiers supplied in a request body, query string,
 * route parameter, cookie, or custom header are intentionally ignored.
 */
export async function resolveRequestIdentity(
  req: Request,
): Promise<RequestIdentityResolution> {
  try {
    const tokenIdentity = getRequestAuth(req);
    if (!tokenIdentity) {
      return INVALID_SESSION;
    }

    const [account] = await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        active: users.active,
        businessId: users.businessId,
      })
      .from(users)
      .where(eq(users.id, tokenIdentity.userId))
      .limit(1);

    if (!account || account.active !== true) {
      return INVALID_SESSION;
    }

    const storedRole = normalizeStoredRole(account.role);
    const tokenRole = normalizeStoredRole(tokenIdentity.role);
    const tokenIsStale =
      account.username !== tokenIdentity.username ||
      storedRole !== tokenRole ||
      account.businessId !== tokenIdentity.businessId;

    if (tokenIsStale) {
      return INVALID_SESSION;
    }

    if (storedRole === "super_admin") {
      if (account.businessId !== null) {
        return INVALID_SESSION;
      }

      return {
        ok: true,
        context: {
          userId: account.id,
          username: account.username,
          role: "super_admin",
          businessId: null,
          businessSlug: null,
          businessName: null,
        },
      };
    }

    const canonicalRole = canonicalizeTenantRole(storedRole);
    if (!canonicalRole || account.businessId === null) {
      return INVALID_SESSION;
    }

    const [business] = await db
      .select({
        id: laundryBusinesses.id,
        slug: laundryBusinesses.slug,
        name: laundryBusinesses.name,
        active: laundryBusinesses.active,
      })
      .from(laundryBusinesses)
      .where(eq(laundryBusinesses.id, account.businessId))
      .limit(1);

    if (
      !business ||
      business.active !== true ||
      !business.slug.trim() ||
      !business.name.trim()
    ) {
      return TENANT_UNAVAILABLE;
    }

    return {
      ok: true,
      context: {
        userId: account.id,
        username: account.username,
        role: canonicalRole,
        businessId: business.id,
        businessSlug: business.slug,
        businessName: business.name,
      },
    };
  } catch {
    return IDENTITY_UNAVAILABLE;
  }
}

function sendIdentityFailure(res: Response, failure: IdentityFailure): null {
  res.status(failure.status).json({
    success: false,
    message: failure.message,
  });
  return null;
}

export async function requireRequestIdentity(
  req: Request,
  res: Response,
): Promise<TenantRequestContext | null> {
  const resolution = await resolveRequestIdentity(req);
  if (!resolution.ok) {
    return sendIdentityFailure(res, resolution);
  }
  return resolution.context;
}

export async function requireTenantContext(
  req: Request,
  res: Response,
): Promise<TenantAccountRequestContext | null> {
  const resolution = await resolveRequestIdentity(req);
  if (!resolution.ok) {
    return sendIdentityFailure(res, resolution);
  }

  const { context } = resolution;
  if (
    context.role === "super_admin" ||
    context.businessId === null ||
    context.businessSlug === null ||
    context.businessName === null
  ) {
    return sendIdentityFailure(res, {
      ok: false,
      status: 403,
      message: "Tenant access is required",
    });
  }

  return context as TenantAccountRequestContext;
}

export async function requirePlatformOwnerContext(
  req: Request,
  res: Response,
): Promise<PlatformOwnerRequestContext | null> {
  const resolution = await resolveRequestIdentity(req);
  if (!resolution.ok) {
    return sendIdentityFailure(res, resolution);
  }

  const { context } = resolution;
  if (context.role !== "super_admin" || context.businessId !== null) {
    return sendIdentityFailure(res, {
      ok: false,
      status: 403,
      message: "Platform owner access is required",
    });
  }

  return context as PlatformOwnerRequestContext;
}
