import { defineConfig } from "drizzle-kit";
import { loadEnvironment } from "./server/env";

loadEnvironment();

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://postgres:password@localhost:5432/laundry_db",
  },
});
