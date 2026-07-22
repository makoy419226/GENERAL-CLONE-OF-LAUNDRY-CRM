import pg from "pg";
import { loadEnvironment } from "../server/env.ts";

loadEnvironment();

const { Pool } = pg;

type Options = {
  apply: boolean;
  verbose: boolean;
};

type ClientRow = {
  id: number;
  name: string;
  phone: string | null;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apply: false,
    verbose: false,
  };

  for (const value of argv) {
    if (value === "--apply") {
      options.apply = true;
      continue;
    }

    if (value === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (value === "--help" || value === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${value}`);
  }

  return options;
}

function printHelp() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/cleanup-zero-client-phones.ts [--apply] [--verbose]",
      "",
      "Examples:",
      "  npx tsx scripts/cleanup-zero-client-phones.ts",
      "  npx tsx scripts/cleanup-zero-client-phones.ts --apply",
      "  npx tsx scripts/cleanup-zero-client-phones.ts --apply --verbose",
    ].join("\n"),
  );
}

async function fetchClientsWithZeroPhone(pool: pg.Pool): Promise<ClientRow[]> {
  const result = await pool.query<ClientRow>(`
    select id, name, phone
    from clients
    where trim(coalesce(phone, '')) = '0'
    order by id asc
  `);

  return result.rows;
}

async function clearZeroPhoneValues(pool: pg.Pool): Promise<number> {
  const result = await pool.query(`
    update clients
    set phone = ''
    where trim(coalesce(phone, '')) = '0'
  `);

  return result.rowCount ?? 0;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required before running this cleanup.");
  }

  const pool = new Pool({ connectionString });

  try {
    const clients = await fetchClientsWithZeroPhone(pool);

    if (clients.length === 0) {
      console.log('No client phone values set to "0" were found.');
      return;
    }

    console.log(
      `${options.apply ? "Applying" : "Dry run"} zero-phone cleanup for ${clients.length} client(s).`,
    );

    if (options.verbose || clients.length <= 20) {
      for (const client of clients) {
        console.log(`- #${client.id} ${client.name} (${client.phone || ""})`);
      }
    }

    if (!options.apply) {
      console.log('Re-run with "--apply" to clear these phone values.');
      return;
    }

    const updatedCount = await clearZeroPhoneValues(pool);
    console.log(`Cleared phone value "0" for ${updatedCount} client(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Zero-phone cleanup failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
