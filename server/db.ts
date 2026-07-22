import { loadEnvironment } from "./env";
loadEnvironment();

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. For local Windows development, add it to .env.windows.local.",
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.VERCEL ? 1 : undefined,
  allowExitOnIdle: Boolean(process.env.VERCEL),
});

export const db = drizzle(pool, { schema });
