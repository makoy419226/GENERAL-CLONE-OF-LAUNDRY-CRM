import { eq, sql } from "drizzle-orm";
import { appSecuritySettings } from "@shared/schema";
import { db } from "./db";

const APP_SECURITY_SETTINGS_ID = 1;
const DEFAULT_LOCKDOWN_REASON = "Page lockdown for security reasons.";

export type AppLockdownStatus = {
  enabled: boolean;
  reason: string;
  lockedAt: string | null;
  lockedBy: string | null;
  updatedAt: string | null;
};

let ensurePromise: Promise<void> | null = null;
let cachedStatus: AppLockdownStatus | null = null;
let cachedStatusUntil = 0;

export function clearAppLockdownStatusCache() {
  cachedStatus = null;
  cachedStatusUntil = 0;
}

export async function ensureAppSecuritySettingsTable(): Promise<void> {
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

      await db
        .insert(appSecuritySettings)
        .values({
          id: APP_SECURITY_SETTINGS_ID,
          lockdownEnabled: false,
          lockdownReason: DEFAULT_LOCKDOWN_REASON,
          lockdownAt: null,
          lockdownBy: null,
        })
        .onConflictDoNothing();
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
  if (cachedStatus && Date.now() < cachedStatusUntil) {
    return cachedStatus;
  }

  await ensureAppSecuritySettingsTable();

  const [settings] = await db
    .select()
    .from(appSecuritySettings)
    .where(eq(appSecuritySettings.id, APP_SECURITY_SETTINGS_ID))
    .limit(1);

  const status = toLockdownStatus(
    settings || {
      id: APP_SECURITY_SETTINGS_ID,
      lockdownEnabled: false,
      lockdownReason: DEFAULT_LOCKDOWN_REASON,
      lockdownAt: null,
      lockdownBy: null,
      updatedAt: new Date(),
    },
  );

  cachedStatus = status;
  cachedStatusUntil = Date.now() + 1000;
  return status;
}

export async function setAppLockdownStatus(
  enabled: boolean,
  actor: string,
): Promise<AppLockdownStatus> {
  await ensureAppSecuritySettingsTable();

  const nextLockdownAt = enabled ? new Date() : null;
  const nextLockdownBy = enabled ? actor || "Admin" : null;

  const [updated] = await db
    .update(appSecuritySettings)
    .set({
      lockdownEnabled: enabled,
      lockdownReason: DEFAULT_LOCKDOWN_REASON,
      lockdownAt: nextLockdownAt,
      lockdownBy: nextLockdownBy,
      updatedAt: new Date(),
    })
    .where(eq(appSecuritySettings.id, APP_SECURITY_SETTINGS_ID))
    .returning();

  clearAppLockdownStatusCache();

  if (updated) {
    return toLockdownStatus(updated);
  }

  await db.insert(appSecuritySettings).values({
    id: APP_SECURITY_SETTINGS_ID,
    lockdownEnabled: enabled,
    lockdownReason: DEFAULT_LOCKDOWN_REASON,
    lockdownAt: nextLockdownAt,
    lockdownBy: nextLockdownBy,
  });

  return getAppLockdownStatus();
}
