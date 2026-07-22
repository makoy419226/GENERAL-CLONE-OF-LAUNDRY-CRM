import pg from "pg";
import { loadEnvironment } from "../server/env.ts";

loadEnvironment();

const { Pool } = pg;

type Options = {
  apply: boolean;
};

type PlatformOwnerRow = {
  id: number;
  username: string;
  role: string;
  active: boolean | null;
  business_id: number | null;
};

type RecoveryInput = {
  username: string;
  password: string;
  name: string;
  email: string;
};

function printHelp() {
  console.log(
    [
      "Usage:",
      "  npm run super-admin:reset -- --apply",
      "",
      "Required environment variables:",
      "  SUPER_ADMIN_USERNAME  Platform-owner login username",
      "  SUPER_ADMIN_PASSWORD  New platform-owner password",
      "  SUPER_ADMIN_NAME      Platform-owner display name",
      "  SUPER_ADMIN_EMAIL     Platform-owner recovery email",
      "",
      "Options:",
      "  --apply               Write the change to the database",
      "  --help                Show this help",
      "",
      "The command only updates the existing platform owner whose role is",
      "super_admin and whose business_id is null. It never creates a generic",
      "administrator or changes a tenant account.",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false };

  for (const arg of argv) {
    if (arg === "--apply") {
      options.apply = true;
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

function requireEnvValue(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function getRecoveryInput(): RecoveryInput {
  const input = {
    username: requireEnvValue("SUPER_ADMIN_USERNAME"),
    password: requireEnvValue("SUPER_ADMIN_PASSWORD"),
    name: requireEnvValue("SUPER_ADMIN_NAME"),
    email: requireEnvValue("SUPER_ADMIN_EMAIL").toLowerCase(),
  };

  if (input.username.length > 80) {
    throw new Error("SUPER_ADMIN_USERNAME must be 80 characters or fewer.");
  }
  if (input.password.length < 8) {
    throw new Error("SUPER_ADMIN_PASSWORD must be at least 8 characters.");
  }
  if (input.name.length < 2 || input.name.length > 120) {
    throw new Error("SUPER_ADMIN_NAME must contain 2 to 120 characters.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    throw new Error("SUPER_ADMIN_EMAIL must be a valid email address.");
  }

  return input;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required before running platform-owner recovery.");
  }

  const input = getRecoveryInput();
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query(
      `select set_config('app.platform_scope', 'on', true),
              set_config('app.business_id', '', true),
              set_config('row_security', 'on', true)`,
    );

    const owners = await client.query<PlatformOwnerRow>(
      `
        select id, username, role, active, business_id
        from users
        where lower(role) = 'super_admin' and business_id is null
        order by id asc
        for update
      `,
    );

    if (owners.rows.length !== 1) {
      throw new Error(
        `Expected exactly one platform owner, but found ${owners.rows.length}. Recovery stopped without changing any account.`,
      );
    }

    const owner = owners.rows[0];
    const duplicateUsername = await client.query<{ id: number }>(
      `
        select id
        from users
        where lower(username) = lower($1) and id <> $2
        limit 1
      `,
      [input.username, owner.id],
    );

    if (duplicateUsername.rows.length > 0) {
      throw new Error("SUPER_ADMIN_USERNAME is already assigned to another account.");
    }

    console.log(`${options.apply ? "Applying" : "Dry run"} platform-owner recovery.`);
    console.log(`Target account ID: ${owner.id}`);

    if (!options.apply) {
      console.log('No database changes were made. Re-run with "--apply" to update the platform owner.');
      await client.query("rollback");
      return;
    }

    await client.query(
      `
        update users
        set username = $1,
            password = $2,
            name = $3,
            email = $4,
            role = 'super_admin',
            active = true,
            business_id = null
        where id = $5
      `,
      [input.username, input.password, input.name, input.email, owner.id],
    );

    await client.query(
      `
        update password_reset_tokens
        set used = true
        where user_id = $1 and used = false
      `,
      [owner.id],
    );

    await client.query("commit");
    console.log("Platform-owner recovery completed.");
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
