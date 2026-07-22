import { loadEnvironment } from "./env";
loadEnvironment();

import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Response as ExpressResponse } from "express";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "@shared/schema";

const applicationDatabaseUrl =
  process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

if (!applicationDatabaseUrl) {
  throw new Error(
    "APP_DATABASE_URL or DATABASE_URL must be set. For local Windows development, add DATABASE_URL to .env.windows.local.",
  );
}

const pool = new Pool({
  connectionString: applicationDatabaseUrl,
  max: process.env.VERCEL ? 1 : undefined,
  allowExitOnIdle: Boolean(process.env.VERCEL),
});

type AppDatabase = NodePgDatabase<typeof schema>;

export type DatabaseScope =
  | { platform: true }
  | { businessId: number };

type DatabaseScopeStore = {
  active: boolean;
  client: PoolClient;
  database: AppDatabase;
  scope: DatabaseScope;
};

const databaseScopeStorage = new AsyncLocalStorage<DatabaseScopeStore>();
const unscopedDatabase = drizzle(pool, { schema });

export function getCurrentDatabaseScope(): DatabaseScope | null {
  const store = databaseScopeStorage.getStore();
  return store?.active ? store.scope : null;
}

function normalizeDatabaseScope(scope: DatabaseScope): DatabaseScope {
  if ("platform" in scope) {
    return { platform: true };
  }

  const businessId = Number(scope.businessId);
  if (!Number.isSafeInteger(businessId) || businessId <= 0) {
    throw new Error("A positive integer businessId is required for tenant database scope");
  }

  return { businessId };
}

function databaseScopesMatch(left: DatabaseScope, right: DatabaseScope) {
  if ("platform" in left || "platform" in right) {
    return "platform" in left && "platform" in right;
  }

  return left.businessId === right.businessId;
}

async function setClientDatabaseScope(
  client: PoolClient,
  scope: DatabaseScope,
) {
  const platformScope = "platform" in scope ? "on" : "";
  const businessId = "businessId" in scope ? String(scope.businessId) : "";

  await client.query(
    `
      SELECT
        set_config('app.platform_scope', $1, false),
        set_config('app.business_id', $2, false),
        set_config('row_security', 'on', false)
    `,
    [platformScope, businessId],
  );
}

async function clearClientDatabaseScope(client: PoolClient) {
  await client.query(`
    SELECT
      set_config('app.platform_scope', '', false),
      set_config('app.business_id', '', false),
      set_config('row_security', 'on', false)
  `);
}

function toError(error: unknown, fallback: string) {
  return error instanceof Error ? error : new Error(fallback);
}

async function acquireDatabaseScope(
  requestedScope: DatabaseScope,
): Promise<DatabaseScopeStore> {
  const scope = normalizeDatabaseScope(requestedScope);
  const client = await pool.connect();

  try {
    await setClientDatabaseScope(client, scope);
  } catch (error) {
    client.release(toError(error, "Failed to configure database scope"));
    throw error;
  }

  return {
    active: true,
    client,
    database: drizzle(client, { schema }),
    scope,
  };
}

async function releaseDatabaseScope(store: DatabaseScopeStore) {
  if (!store.active) return;
  store.active = false;

  try {
    await clearClientDatabaseScope(store.client);
    store.client.release();
  } catch (error) {
    store.client.release(toError(error, "Failed to clear database scope"));
    throw error;
  }
}

async function runWithDatabaseScope<T>(
  requestedScope: DatabaseScope,
  operation: () => Promise<T>,
): Promise<T> {
  const scope = normalizeDatabaseScope(requestedScope);
  const existingStore = databaseScopeStorage.getStore();

  if (existingStore) {
    if (!existingStore.active) {
      throw new Error("The current database scope is no longer active");
    }
    if (!databaseScopesMatch(existingStore.scope, scope)) {
      throw new Error("Cannot change database scope inside an active database scope");
    }
    return operation();
  }

  const store = await acquireDatabaseScope(scope);
  let operationError: unknown;

  try {
    return await databaseScopeStorage.run(store, operation);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await releaseDatabaseScope(store);
    } catch (releaseError) {
      if (operationError === undefined) {
        throw releaseError;
      }
    }
  }
}

/**
 * Runs database work with explicit platform-owner visibility. The scope holds a
 * reserved PoolClient but intentionally does not open an outer transaction.
 */
export function runWithPlatformDatabase<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return runWithDatabaseScope({ platform: true }, operation);
}

/**
 * Runs database work with visibility restricted to one tenant. The scope holds
 * a reserved PoolClient but intentionally does not open an outer transaction.
 */
export function runWithTenantDatabase<T>(
  businessId: number,
  operation: () => Promise<T>,
): Promise<T> {
  return runWithDatabaseScope({ businessId }, operation);
}

/**
 * Establishes a database scope for an Express response lifetime. Call `next`
 * inside AsyncLocalStorage so every downstream imported `db` use resolves to
 * the reserved client. The client is scrubbed and released on finish or close.
 */
export async function runRequestWithDatabaseScope(
  requestedScope: DatabaseScope,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> {
  const scope = normalizeDatabaseScope(requestedScope);
  const existingStore = databaseScopeStorage.getStore();

  if (existingStore) {
    if (!existingStore.active) {
      throw new Error("The current database scope is no longer active");
    }
    if (!databaseScopesMatch(existingStore.scope, scope)) {
      throw new Error("Cannot change database scope inside an active database scope");
    }
    next();
    return;
  }

  const store = await acquireDatabaseScope(scope);

  await new Promise<void>((resolve, reject) => {
    let cleanupStarted = false;

    const removeResponseListeners = () => {
      res.off("finish", finishScope);
      res.off("close", finishScope);
    };

    const finishScope = () => {
      if (cleanupStarted) return;
      cleanupStarted = true;
      removeResponseListeners();
      void releaseDatabaseScope(store).then(resolve, reject);
    };

    res.once("finish", finishScope);
    res.once("close", finishScope);

    databaseScopeStorage.run(store, () => {
      try {
        next();
      } catch (error) {
        if (!cleanupStarted) {
          cleanupStarted = true;
          removeResponseListeners();
          void releaseDatabaseScope(store).then(
            () => reject(error),
            reject,
          );
        }
      }
    });
  });
}

/**
 * Existing imports keep a stable object, while each property access resolves
 * to the Drizzle instance attached to the current asynchronous scope.
 * Unscoped access uses the pool directly; FORCE RLS policies make that path
 * fail closed for protected tenant data.
 */
export const db = new Proxy(unscopedDatabase, {
  get(target, property) {
    const store = databaseScopeStorage.getStore();
    if (store && !store.active) {
      throw new Error("The current database scope is no longer active");
    }

    const database = store?.database || target;
    const value = Reflect.get(database, property, database);
    return typeof value === "function" ? value.bind(database) : value;
  },
}) as AppDatabase;
