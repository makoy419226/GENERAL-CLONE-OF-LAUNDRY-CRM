import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { users } from "@shared/schema";
import { db, runWithPlatformDatabase } from "./db";

export const DEFAULT_BUSINESS_SLUG = "default-business";

let foundationPromise: Promise<void> | null = null;

async function runMultiTenantFoundationMigrationWithinPlatformScope() {
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
      telephone TEXT,
      mobile_phone TEXT,
      website TEXT,
      address TEXT,
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
      ADD COLUMN IF NOT EXISTS telephone TEXT,
      ADD COLUMN IF NOT EXISTS mobile_phone TEXT,
      ADD COLUMN IF NOT EXISTS website TEXT,
      ADD COLUMN IF NOT EXISTS address TEXT
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

  // Login accounts may have an operational PIN, but the platform must never
  // provision a shared, fixed PIN implicitly.
  await db.execute(sql`
    ALTER TABLE users
    ALTER COLUMN pin DROP DEFAULT,
    ALTER COLUMN pin DROP NOT NULL
  `);

  await db.execute(sql`
    INSERT INTO laundry_businesses (name, slug)
    VALUES ('Primary Laundry Business', ${DEFAULT_BUSINESS_SLUG})
    ON CONFLICT (slug) DO NOTHING
  `);

  await db.execute(sql`
    UPDATE users
    SET business_id = NULL
    WHERE role = 'super_admin'
  `);

  await db.execute(sql`
    UPDATE users
    SET business_id = (
      SELECT id FROM laundry_businesses WHERE slug = ${DEFAULT_BUSINESS_SLUG}
    )
    WHERE business_id IS NULL AND role <> 'super_admin'
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS organization_units (
      id SERIAL PRIMARY KEY,
      public_key UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES laundry_businesses(id),
      name TEXT NOT NULL,
      unit_type TEXT NOT NULL CHECK (unit_type IN ('branch', 'department', 'team')),
      parent_id INTEGER REFERENCES organization_units(id) ON DELETE SET NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS organization_units_public_key_idx
    ON organization_units(public_key)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS organization_units_business_id_idx
    ON organization_units(business_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS organization_units_parent_id_idx
    ON organization_units(parent_id)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS staff_profiles (
      id SERIAL PRIMARY KEY,
      public_key UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES laundry_businesses(id),
      organization_unit_id INTEGER REFERENCES organization_units(id) ON DELETE SET NULL,
      manager_staff_id INTEGER REFERENCES staff_profiles(id) ON DELETE SET NULL,
      linked_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      display_name TEXT NOT NULL,
      job_title TEXT,
      operational_role TEXT NOT NULL CHECK (
        operational_role IN ('manager', 'counter', 'production', 'driver')
      ),
      pin_hash TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS staff_profiles_public_key_idx
    ON staff_profiles(public_key)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS staff_profiles_business_id_idx
    ON staff_profiles(business_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS staff_profiles_organization_unit_id_idx
    ON staff_profiles(organization_unit_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS staff_profiles_manager_staff_id_idx
    ON staff_profiles(manager_staff_id)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS staff_profiles_linked_user_id_idx
    ON staff_profiles(linked_user_id)
  `);

  await db.execute(sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS staff_profile_id INTEGER
      REFERENCES staff_profiles(id) ON DELETE SET NULL
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS users_staff_profile_id_idx ON users(staff_profile_id)
  `);

  // This table is created dynamically by the legacy order-date tooling. Own it
  // here as well so its historical rows participate in the tenant backfill.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS order_date_change_audit (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL,
      order_number TEXT NOT NULL,
      old_entry_date TIMESTAMP NOT NULL,
      new_entry_date TIMESTAMP NOT NULL,
      delta_minutes INTEGER NOT NULL,
      changed_by TEXT,
      reason TEXT,
      changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      bulk_group TEXT,
      business_id INTEGER REFERENCES laundry_businesses(id)
    )
  `);

  // Unlike the other settings tables, this legacy singleton is created at
  // runtime instead of by a checked-in migration. Create it before the tenant
  // ownership pass so a fresh database has the column Drizzle expects.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app_security_settings (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES laundry_businesses(id),
      lockdown_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      lockdown_reason TEXT NOT NULL DEFAULT 'Page lockdown for security reasons.',
      lockdown_at TIMESTAMP,
      lockdown_by TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Add nullable tenant ownership during the compatibility phase. Existing
  // rows are assigned to the legacy default business; a later scoped-storage
  // migration can validate ownership and make these columns NOT NULL.
  await db.execute(sql`
    DO $tenant_ownership$
    DECLARE
      tenant_table TEXT;
      default_business_id INTEGER;
      tenant_tables CONSTANT TEXT[] := ARRAY[
        'products',
        'clients',
        'client_transactions',
        'bills',
        'bill_payments',
        'orders',
        'packing_workers',
        'staff_members',
        'incidents',
        'missing_items',
        'stage_checklists',
        'companies',
        'product_category_settings',
        'company_contact_settings',
        'app_security_settings',
        'sales_report_schedule_settings',
        'reviews',
        'order_date_change_audit'
      ];
    BEGIN
      SELECT id INTO default_business_id
      FROM laundry_businesses
      WHERE slug = 'default-business';

      IF default_business_id IS NULL THEN
        RAISE EXCEPTION 'Default business is required for the tenant ownership backfill';
      END IF;

      FOREACH tenant_table IN ARRAY tenant_tables LOOP
        IF to_regclass(tenant_table) IS NULL THEN
          CONTINUE;
        END IF;

        EXECUTE format(
          'ALTER TABLE %I ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES laundry_businesses(id)',
          tenant_table
        );
        EXECUTE format(
          'UPDATE %I SET business_id = $1 WHERE business_id IS NULL',
          tenant_table
        ) USING default_business_id;
        EXECUTE format(
          'ALTER TABLE %I ALTER COLUMN business_id SET NOT NULL',
          tenant_table
        );
        EXECUTE format(
          'CREATE INDEX IF NOT EXISTS %I ON %I (business_id)',
          tenant_table || '_business_id_idx',
          tenant_table
        );
      END LOOP;
    END
    $tenant_ownership$;
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS product_category_settings_business_unique
      ON product_category_settings (business_id);
    CREATE UNIQUE INDEX IF NOT EXISTS company_contact_settings_business_unique
      ON company_contact_settings (business_id);
    CREATE UNIQUE INDEX IF NOT EXISTS app_security_settings_business_unique
      ON app_security_settings (business_id);
    CREATE UNIQUE INDEX IF NOT EXISTS sales_report_schedule_settings_business_unique
      ON sales_report_schedule_settings (business_id);
  `);

  await db.execute(sql`
    ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_role_business_scope_check;
    ALTER TABLE users
      ADD CONSTRAINT users_role_business_scope_check
      CHECK (
        (role = 'super_admin' AND business_id IS NULL)
        OR (role <> 'super_admin' AND business_id IS NOT NULL)
      );
  `);

  // Every table carrying tenant data is protected at the database boundary.
  // The application sets these connection-local values only through the
  // reserved-client helpers in db.ts. Missing scope therefore matches no
  // tenant rows, while an explicit platform scope can perform control-plane
  // and maintenance work.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION app_enforce_business_scope()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $business_scope$
    DECLARE
      platform_scope_enabled BOOLEAN :=
        current_setting('app.platform_scope', TRUE) = 'on';
      scoped_business_id INTEGER :=
        NULLIF(current_setting('app.business_id', TRUE), '')::INTEGER;
    BEGIN
      IF platform_scope_enabled THEN
        IF TG_TABLE_NAME = 'users' THEN
          IF NEW.role = 'super_admin' THEN
            NEW.business_id := NULL;
          ELSIF NEW.business_id IS NULL THEN
            RAISE EXCEPTION
              'Platform writes to tenant users require an explicit business_id'
              USING ERRCODE = '42501';
          END IF;
        ELSIF NEW.business_id IS NULL THEN
          RAISE EXCEPTION
            'Platform writes to % require an explicit business_id', TG_TABLE_NAME
            USING ERRCODE = '42501';
        END IF;

        RETURN NEW;
      END IF;

      IF scoped_business_id IS NULL THEN
        RAISE EXCEPTION
          'Database write requires an explicit tenant or platform scope'
          USING ERRCODE = '42501';
      END IF;

      IF TG_TABLE_NAME = 'users' THEN
        IF NEW.role = 'super_admin' THEN
          RAISE EXCEPTION
            'Tenant scope cannot create or modify a platform-owner account'
            USING ERRCODE = '42501';
        END IF;
      END IF;

      IF NEW.business_id IS NULL THEN
        NEW.business_id := scoped_business_id;
      ELSIF NEW.business_id <> scoped_business_id THEN
        RAISE EXCEPTION
          'business_id % does not match tenant scope %',
          NEW.business_id,
          scoped_business_id
          USING ERRCODE = '42501';
      END IF;

      RETURN NEW;
    END
    $business_scope$;
  `);

  await db.execute(sql`
    DO $tenant_rls$
    DECLARE
      tenant_table TEXT;
      tenant_tables CONSTANT TEXT[] := ARRAY[
        'products',
        'clients',
        'client_transactions',
        'bills',
        'bill_payments',
        'orders',
        'packing_workers',
        'staff_members',
        'incidents',
        'missing_items',
        'stage_checklists',
        'companies',
        'product_category_settings',
        'company_contact_settings',
        'app_security_settings',
        'sales_report_schedule_settings',
        'reviews',
        'order_date_change_audit',
        'organization_units',
        'staff_profiles'
      ];
    BEGIN
      FOREACH tenant_table IN ARRAY tenant_tables LOOP
        IF to_regclass(tenant_table) IS NULL THEN
          CONTINUE;
        END IF;

        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
        EXECUTE format('DROP POLICY IF EXISTS tenant_scope_policy ON %I', tenant_table);
        EXECUTE format(
          'CREATE POLICY tenant_scope_policy ON %I
             FOR ALL
             USING (
               current_setting(''app.platform_scope'', TRUE) = ''on''
               OR business_id = NULLIF(current_setting(''app.business_id'', TRUE), '''')::INTEGER
             )
             WITH CHECK (
               current_setting(''app.platform_scope'', TRUE) = ''on''
               OR business_id = NULLIF(current_setting(''app.business_id'', TRUE), '''')::INTEGER
             )',
          tenant_table
        );

        EXECUTE format('DROP TRIGGER IF EXISTS enforce_business_scope ON %I', tenant_table);
        EXECUTE format(
          'CREATE TRIGGER enforce_business_scope
             BEFORE INSERT OR UPDATE ON %I
             FOR EACH ROW
             EXECUTE FUNCTION app_enforce_business_scope()',
          tenant_table
        );
      END LOOP;
    END
    $tenant_rls$;
  `);

  // Tenant sessions may see and manage only non-platform accounts belonging to
  // the same business. Only an explicit platform scope can see or write the
  // business_id-NULL super-admin account.
  await db.execute(sql`
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE users FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_scope_policy ON users;
    CREATE POLICY tenant_scope_policy ON users
      FOR ALL
      USING (
        current_setting('app.platform_scope', TRUE) = 'on'
        OR (
          role <> 'super_admin'
          AND business_id = NULLIF(current_setting('app.business_id', TRUE), '')::INTEGER
        )
      )
      WITH CHECK (
        current_setting('app.platform_scope', TRUE) = 'on'
        OR (
          role <> 'super_admin'
          AND business_id = NULLIF(current_setting('app.business_id', TRUE), '')::INTEGER
        )
      );
    DROP TRIGGER IF EXISTS enforce_business_scope ON users;
    CREATE TRIGGER enforce_business_scope
      BEFORE INSERT OR UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION app_enforce_business_scope();
  `);

  // A tenant can read its own organization record, but organization lifecycle
  // changes remain platform-only. This table has no business_id column, so it
  // receives dedicated policies rather than the generic tenant policy/trigger.
  await db.execute(sql`
    ALTER TABLE laundry_businesses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE laundry_businesses FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_read_policy ON laundry_businesses;
    DROP POLICY IF EXISTS platform_write_policy ON laundry_businesses;
    CREATE POLICY tenant_read_policy ON laundry_businesses
      FOR SELECT
      USING (
        current_setting('app.platform_scope', TRUE) = 'on'
        OR id = NULLIF(current_setting('app.business_id', TRUE), '')::INTEGER
      );
    CREATE POLICY platform_write_policy ON laundry_businesses
      FOR ALL
      USING (current_setting('app.platform_scope', TRUE) = 'on')
      WITH CHECK (current_setting('app.platform_scope', TRUE) = 'on');
  `);

  // Reset codes currently belong only to the platform-owner recovery flow.
  // Protect them as platform-only even though the legacy table has no
  // business_id column.
  await db.execute(sql`
    ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
    ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS platform_only_policy ON password_reset_tokens;
    CREATE POLICY platform_only_policy ON password_reset_tokens
      FOR ALL
      USING (current_setting('app.platform_scope', TRUE) = 'on')
      WITH CHECK (current_setting('app.platform_scope', TRUE) = 'on');
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
        pin: null,
        active: true,
        businessId: null,
      });
    }
  });
}

async function runMultiTenantFoundationMigration() {
  await runWithPlatformDatabase(
    runMultiTenantFoundationMigrationWithinPlatformScope,
  );
}

async function validateMultiTenantFoundation() {
  await runWithPlatformDatabase(async () => {
    const result = await db.execute(sql`
      SELECT
        to_regclass('public.laundry_businesses') IS NOT NULL AS has_businesses,
        to_regclass('public.users') IS NOT NULL AS has_users,
        to_regprocedure('public.app_enforce_business_scope()') IS NOT NULL AS has_scope_trigger,
        (
          SELECT COUNT(*)::INTEGER
          FROM pg_class
          WHERE relrowsecurity = TRUE
            AND relforcerowsecurity = TRUE
        ) AS forced_rls_tables
    `);
    const status = ((result as any)?.rows || [])[0];
    if (
      !status?.has_businesses ||
      !status?.has_users ||
      !status?.has_scope_trigger ||
      Number(status?.forced_rls_tables || 0) < 23
    ) {
      throw new Error(
        "The production database is missing the required multi-tenant foundation",
      );
    }

    const owners = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "super_admin"), isNull(users.businessId)))
      .limit(2);
    if (owners.length !== 1) {
      throw new Error(
        `Expected exactly one platform owner, but found ${owners.length}`,
      );
    }
  });
}

export async function ensureMultiTenantFoundation() {
  if (!foundationPromise) {
    const operation =
      process.env.NODE_ENV === "production" &&
      process.env.ENABLE_RUNTIME_SCHEMA_MIGRATIONS !== "true"
        ? validateMultiTenantFoundation
        : runMultiTenantFoundationMigration;
    foundationPromise = operation().catch((error) => {
      foundationPromise = null;
      throw error;
    });
  }

  return foundationPromise;
}
