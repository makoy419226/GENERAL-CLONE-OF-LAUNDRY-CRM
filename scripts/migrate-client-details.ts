import pg from "pg";
import { loadEnvironment } from "../server/env.ts";

loadEnvironment();

const { Pool } = pg;

type Options = {
  apply: boolean;
  verbose: boolean;
};

type ClientDetailRow = {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  clearPhone: boolean;
  clearAddress: boolean;
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
      "  npx tsx scripts/migrate-client-details.ts [--apply] [--verbose]",
      "",
      "What it changes:",
      "  - clients.phone becomes NULL when it is blank, '-', or only zero digits",
      "  - clients.address becomes NULL when it is only '-'",
      "",
      "Examples:",
      "  npx tsx scripts/migrate-client-details.ts",
      "  npx tsx scripts/migrate-client-details.ts --apply",
      "  npx tsx scripts/migrate-client-details.ts --apply --verbose",
    ].join("\n"),
  );
}

async function fetchClientsNeedingCleanup(pool: pg.Pool): Promise<ClientDetailRow[]> {
  const result = await pool.query<ClientDetailRow>(`
    select
      id,
      name,
      phone,
      address,
      (
        trim(coalesce(phone, '')) in ('', '-')
        or (
          regexp_replace(coalesce(phone, ''), '\\D', '', 'g') <> ''
          and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') ~ '^0+$'
        )
      ) as "clearPhone",
      trim(coalesce(address, '')) = '-' as "clearAddress"
    from clients
    where
      trim(coalesce(phone, '')) in ('', '-')
      or (
        regexp_replace(coalesce(phone, ''), '\\D', '', 'g') <> ''
        and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') ~ '^0+$'
      )
      or trim(coalesce(address, '')) = '-'
    order by id asc
  `);

  return result.rows;
}

async function applyClientDetailsCleanup(pool: pg.Pool): Promise<number> {
  const result = await pool.query(`
    update clients
    set
      phone = case
        when trim(coalesce(phone, '')) in ('', '-')
          or (
            regexp_replace(coalesce(phone, ''), '\\D', '', 'g') <> ''
            and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') ~ '^0+$'
          )
        then null
        else phone
      end,
      address = case
        when trim(coalesce(address, '')) = '-' then null
        else address
      end
    where
      trim(coalesce(phone, '')) in ('', '-')
      or (
        regexp_replace(coalesce(phone, ''), '\\D', '', 'g') <> ''
        and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') ~ '^0+$'
      )
      or trim(coalesce(address, '')) = '-'
  `);

  return result.rowCount ?? 0;
}

function printClientRows(rows: ClientDetailRow[]) {
  for (const row of rows) {
    const changes = [
      row.clearPhone ? `phone "${row.phone ?? ""}" -> NULL` : null,
      row.clearAddress ? `address "${row.address ?? ""}" -> NULL` : null,
    ].filter(Boolean);

    console.log(`- #${row.id} ${row.name}: ${changes.join(", ")}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required before running this migration.");
  }

  const pool = new Pool({ connectionString });

  try {
    const clients = await fetchClientsNeedingCleanup(pool);

    if (clients.length === 0) {
      console.log("No client phone or address values need cleanup.");
      return;
    }

    const phoneCount = clients.filter((client) => client.clearPhone).length;
    const addressCount = clients.filter((client) => client.clearAddress).length;

    console.log(
      `${options.apply ? "Applying" : "Dry run"} client-details cleanup for ${clients.length} client(s).`,
    );
    console.log(`Phones to clear: ${phoneCount}`);
    console.log(`Addresses to clear: ${addressCount}`);

    if (options.verbose || clients.length <= 20) {
      printClientRows(clients);
    }

    if (!options.apply) {
      console.log('Dry run only. Re-run with "--apply" to write these changes.');
      return;
    }

    const updatedCount = await applyClientDetailsCleanup(pool);
    console.log(`Client-details cleanup completed. Updated ${updatedCount} client(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Client-details cleanup failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
