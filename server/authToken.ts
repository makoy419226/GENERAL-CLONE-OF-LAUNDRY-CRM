import { createHmac, timingSafeEqual } from "crypto";
import type { Request } from "express";

export type AuthTokenPayload = {
  userId: number;
  username: string;
  role: string;
  businessId: number | null;
  expiresAt: number;
};

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function getSigningSecret() {
  const configured = String(process.env.SESSION_SECRET || "").trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be configured in production");
  }

  return "local-development-session-secret-change-me";
}

function sign(encodedPayload: string) {
  return createHmac("sha256", getSigningSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function createAuthToken(
  payload: Omit<AuthTokenPayload, "expiresAt">,
): string {
  const encodedPayload = Buffer.from(
    JSON.stringify({ ...payload, expiresAt: Date.now() + TOKEN_TTL_MS }),
  ).toString("base64url");

  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  const [encodedPayload, suppliedSignature] = String(token || "").split(".");
  if (!encodedPayload || !suppliedSignature) return null;

  const expectedSignature = sign(encodedPayload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as AuthTokenPayload;

    if (
      !Number.isInteger(payload.userId) ||
      !payload.username ||
      !payload.role ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= Date.now()
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getRequestAuth(req: Request): AuthTokenPayload | null {
  const authorization = req.get("authorization") || "";
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return verifyAuthToken(token);
}
