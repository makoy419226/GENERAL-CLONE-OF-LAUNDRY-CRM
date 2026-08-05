import { defineConfig } from "drizzle-kit";
import { loadEnvironment } from "./server/env";

loadEnvironment();

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.APP_DATABASE_URL ||
  process.env.POSTGRES_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL, APP_DATABASE_URL, or POSTGRES_URL must be set before running Drizzle commands.",
  );
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
