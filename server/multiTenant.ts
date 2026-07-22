import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { users } from "@shared/schema";
import { db } from "./db";

export const DEFAULT_BUSINESS_SLUG = "default-business";

let foundationPromise: Promise<void> | null = null;

async function runMultiTenantFoundationMigration() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS laundry_businesses (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      business_type TEXT NOT NULL DEFAULT 'laundry',
      timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
      currency TEXT NOT NULL DEFAULT 'AED',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      contact_email TEXT,
      phone TEXT,
      logo_url TEXT,
      smtp_host TEXT,
      smtp_port INTEGER DEFAULT 587,
      smtp_secure BOOLEAN DEFAULT FALSE,
      smtp_user TEXT,
      smtp_password_encrypted TEXT,
      smtp_from TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    ALTER TABLE laundry_businesses
    ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'laundry',
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'AED'
  `);

  await db.execute(sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES laundry_businesses(id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS users_business_id_idx ON users(business_id)
  `);

  await db.execute(sql`
    INSERT INTO laundry_businesses (name, slug)
    VALUES ('Primary Laundry Business', ${DEFAULT_BUSINESS_SLUG})
    ON CONFLICT (slug) DO NOTHING
  `);

  await db.execute(sql`
    UPDATE users
    SET business_id = (
      SELECT id FROM laundry_businesses WHERE slug = ${DEFAULT_BUSINESS_SLUG}
    )
    WHERE business_id IS NULL AND role <> 'super_admin'
  `);

  const username = String(
    process.env.SUPER_ADMIN_USERNAME || "idusma0010@gmail.com",
  ).trim();
  const configuredPassword = String(process.env.SUPER_ADMIN_PASSWORD || "");
  if (process.env.NODE_ENV === "production" && !configuredPassword) {
    throw new Error("SUPER_ADMIN_PASSWORD must be configured in production");
  }
  const password = configuredPassword || "admin123";
  const name = String(process.env.SUPER_ADMIN_NAME || "makoy").trim();
  const email = String(
    process.env.SUPER_ADMIN_EMAIL || "idusma0010@gmail.com",
  ).trim();

  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(2026072201)`,
    );

    const existingOwners = await transaction
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(and(eq(users.role, "super_admin"), isNull(users.businessId)))
      .orderBy(asc(users.id))
      .limit(2);

    if (existingOwners.length > 1) {
      throw new Error(
        "Multiple platform-owner accounts exist; resolve them before startup can continue",
      );
    }

    const [accountUsingUsername] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    const existingOwner = existingOwners[0];

    if (existingOwner) {
      if (accountUsingUsername && accountUsingUsername.id !== existingOwner.id) {
        throw new Error(
          `Cannot rename the platform owner because username ${username} is already in use`,
        );
      }

      await transaction
        .update(users)
        .set({
          username,
          name,
          email,
          active: true,
          businessId: null,
        })
        .where(eq(users.id, existingOwner.id));
    } else {
      if (accountUsingUsername) {
        throw new Error(
          `Cannot create the platform owner because username ${username} is already in use`,
        );
      }

      await transaction.insert(users).values({
        username,
        password,
        role: "super_admin",
        name,
        email,
        pin: "00000",
        active: true,
        businessId: null,
      });
    }
  });
}

export async function ensureMultiTenantFoundation() {
  if (!foundationPromise) {
    foundationPromise = runMultiTenantFoundationMigration().catch((error) => {
      foundationPromise = null;
      throw error;
    });
  }

  return foundationPromise;
}
