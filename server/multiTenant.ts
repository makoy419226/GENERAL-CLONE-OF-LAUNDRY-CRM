import { sql } from "drizzle-orm";
import { db } from "./db";

export const DEFAULT_BUSINESS_SLUG = "default-business";

let foundationPromise: Promise<void> | null = null;

async function runMultiTenantFoundationMigration() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS laundry_businesses (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
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

  const username = String(process.env.SUPER_ADMIN_USERNAME || "superadmin").trim();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || "admin123");
  const name = String(process.env.SUPER_ADMIN_NAME || "Platform Owner").trim();
  const email = String(process.env.SUPER_ADMIN_EMAIL || "").trim() || null;

  await db.execute(sql`
    INSERT INTO users (username, password, role, name, email, pin, active, business_id)
    VALUES (${username}, ${password}, 'super_admin', ${name}, ${email}, '00000', TRUE, NULL)
    ON CONFLICT (username) DO UPDATE SET
      password = EXCLUDED.password,
      role = 'super_admin',
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      active = TRUE,
      business_id = NULL
  `);
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
