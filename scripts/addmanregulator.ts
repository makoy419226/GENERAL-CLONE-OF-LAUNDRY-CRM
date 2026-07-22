import pg from "pg";
import { loadEnvironment } from "../server/env.ts";

loadEnvironment();

const { Pool } = pg;

type Options = {
  apply: boolean;
  disableExtraAdmins: boolean;
};

type UserRow = {
  id: number;
  username: string;
  role: string;
  active: boolean | null;
};

function printHelp() {
  console.log(
    [
      "Usage:",
      "  npm run admin:reset -- --apply",
      "",
      "Required environment variables:",
      "  ADMIN_RESET_PASSWORD   New password for the admin account",
      "",
      "Optional environment variables:",
      "  ADMIN_RESET_PIN        New 5-digit admin PIN",
      "  ADMIN_RESET_NAME       New admin display name",
      "  ADMIN_RESET_EMAIL      New admin email",
      "",
      "Options:",
      "  --apply                Write the change to the database",
      "  --disable-extra-admins Deactivate other admin-role accounts after reset",
      "  --help                 Show this help",
      "",
      "PowerShell example:",
      '  $env:ADMIN_RESET_PASSWORD="new-secure-password"; $env:ADMIN_RESET_PIN="00102"; npm run admin:reset -- --apply',
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apply: false,
    disableExtraAdmins: false,
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }

    if (arg === "--disable-extra-admins") {
      options.disableExtraAdmins = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function getEnvValue(name: string) {
  return String(process.env[name] || "").trim();
}

function validateInputs(password: string, pin: string) {
  if (!password) {
    throw new Error("ADMIN_RESET_PASSWORD is required.");
  }

  if (password.length < 8) {
    throw new Error("ADMIN_RESET_PASSWORD must be at least 8 characters.");
  }

  if (pin && !/^\d{5}$/.test(pin)) {
    throw new Error("ADMIN_RESET_PIN must be exactly 5 digits.");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required before running admin recovery.");
  }

  const password = getEnvValue("ADMIN_RESET_PASSWORD");
  const pin = getEnvValue("ADMIN_RESET_PIN");
  const name = getEnvValue("ADMIN_RESET_NAME");
  const email = getEnvValue("ADMIN_RESET_EMAIL").toLowerCase();

  validateInputs(password, pin);

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query("begin");

    const usernameResult = await client.query<UserRow>(
      `
        select id, username, role, active
        from users
        where lower(username) = 'admin'
        limit 1
        for update
      `,
    );
    const roleResult = await client.query<UserRow>(
      `
        select id, username, role, active
        from users
        where lower(role) = 'admin'
        order by id asc
        limit 1
        for update
      `,
    );

    const existingAdmin = usernameResult.rows[0] || roleResult.rows[0] || null;
    const action = existingAdmin
      ? existingAdmin.username.toLowerCase() === "admin"
        ? "update"
        : "recover-renamed-admin"
      : "create";

    console.log(`${options.apply ? "Applying" : "Dry run"} admin account recovery.`);
    console.log(`Planned action: ${action}`);

    if (!options.apply) {
      console.log('No database changes were made. Re-run with "--apply" to reset the admin account.');
      await client.query("rollback");
      return;
    }

    let adminId: number;

    if (existingAdmin) {
      const values: unknown[] = ["admin", password];
      const updates = [
        "username = $1",
        "password = $2",
        "role = 'admin'",
        "active = true",
      ];

      if (pin) {
        values.push(pin);
        updates.push(`pin = $${values.length}`);
      }

      if (name) {
        values.push(name);
        updates.push(`name = $${values.length}`);
      } else {
        updates.push("name = coalesce(nullif(trim(name), ''), 'Administrator')");
      }

      if (email) {
        values.push(email);
        updates.push(`email = $${values.length}`);
      }

      values.push(existingAdmin.id);
      const updated = await client.query<UserRow>(
        `
          update users
          set ${updates.join(", ")}
          where id = $${values.length}
          returning id, username, role, active
        `,
        values,
      );
      adminId = updated.rows[0].id;
    } else {
      if (!pin) {
        throw new Error("ADMIN_RESET_PIN is required when the admin account must be created.");
      }

      const inserted = await client.query<UserRow>(
        `
          insert into users (username, password, role, name, email, pin, active)
          values ($1, $2, 'admin', $3, $4, $5, true)
          returning id, username, role, active
        `,
        ["admin", password, name || "Administrator", email || null, pin],
      );
      adminId = inserted.rows[0].id;
    }

    await client.query(
      `
        update password_reset_tokens
        set used = true
        where user_id = $1 and used = false
      `,
      [adminId],
    );

    if (options.disableExtraAdmins) {
      const extraAdmins = await client.query(
        `
          update users
          set active = false
          where lower(role) = 'admin' and id <> $1
        `,
        [adminId],
      );
      console.log(`Disabled ${extraAdmins.rowCount ?? 0} extra admin-role account(s).`);
    }

    await client.query("commit");
    console.log("Admin account recovery completed. Username: admin");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
