import pg from "pg";
import { loadEnvironment } from "../server/env.ts";

loadEnvironment();

const { Pool } = pg;

const CREDIT_MANAGEMENT_TYPES = ["deposit", "deposit_used", "bulk_deposit_used"] as const;

type Options = {
  apply: boolean;
  verbose: boolean;
  bulkGroup: string | null;
  changedAfter: string | null;
  changedBefore: string | null;
  orderNumbers: string[];
  limit: number;
};

type AuditCandidateRow = {
  auditId: number;
  orderId: number;
  orderNumber: string;
  oldEntryDate: string;
  newEntryDate: string;
  deltaMinutes: number;
  changedAt: string;
  changedBy: string | null;
  reason: string | null;
  bulkGroup: string | null;
  currentEntryDate: string | null;
  currentDeliveryDate: string | null;
  currentExpectedDeliveryAt: string | null;
  billId: number | null;
  urgent: boolean | null;
  delivered: boolean | null;
};

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apply: false,
    verbose: false,
    bulkGroup: null,
    changedAfter: null,
    changedBefore: null,
    orderNumbers: [],
    limit: 50,
  };

  for (const rawValue of argv) {
    if (rawValue === "--apply") {
      options.apply = true;
      continue;
    }

    if (rawValue === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (rawValue === "--help" || rawValue === "-h") {
      printHelp();
      process.exit(0);
    }

    if (rawValue.startsWith("--bulk-group=")) {
      options.bulkGroup = rawValue.slice("--bulk-group=".length).trim() || null;
      continue;
    }

    if (rawValue.startsWith("--changed-after=")) {
      options.changedAfter = rawValue.slice("--changed-after=".length).trim() || null;
      continue;
    }

    if (rawValue.startsWith("--changed-before=")) {
      options.changedBefore = rawValue.slice("--changed-before=".length).trim() || null;
      continue;
    }

    if (rawValue.startsWith("--order-numbers=")) {
      options.orderNumbers = parseCsv(rawValue.slice("--order-numbers=".length)).map((entry) =>
        entry.toUpperCase(),
      );
      continue;
    }

    if (rawValue.startsWith("--limit=")) {
      const parsed = Number(rawValue.slice("--limit=".length));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit value: ${rawValue}`);
      }
      options.limit = Math.floor(parsed);
      continue;
    }

    throw new Error(`Unknown argument: ${rawValue}`);
  }

  return options;
}

function printHelp() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/restore-entry-dates-from-audit.ts [filters] [--apply] [--verbose]",
      "",
      "What it does:",
      "  Restores order entry dates from order_date_change_audit while keeping delivery dates unchanged.",
      "  It also restores linked bill dates and reverses credit-management date shifts for the linked bill.",
      "",
      "Filters:",
      "  --bulk-group=<value>         Restore a specific bulk edit batch",
      "  --changed-after=<ISO>        Only consider audit rows changed after this timestamp",
      "  --changed-before=<ISO>       Only consider audit rows changed before this timestamp",
      "  --order-numbers=ORD-1,ORD-2  Only consider these order numbers",
      "  --limit=<n>                  Limit preview rows when filters are broad (default: 50)",
      "",
      "Examples:",
      "  npx tsx scripts/restore-entry-dates-from-audit.ts --changed-after=2026-04-27T00:00:00Z",
      "  npx tsx scripts/restore-entry-dates-from-audit.ts --bulk-group=bulk-1775847628260",
      "  npx tsx scripts/restore-entry-dates-from-audit.ts --order-numbers=ORD-123,ORD-456 --apply",
      "",
      "Safety:",
      "  Dry run by default. Use --apply to perform the recovery after reviewing the preview.",
    ].join("\n"),
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
}

function validateApplyScope(options: Options) {
  if (!options.apply) {
    return;
  }

  if (!options.bulkGroup && options.orderNumbers.length === 0) {
    throw new Error(
      'Use "--bulk-group=..." or "--order-numbers=..." together with --apply to avoid restoring the wrong rows.',
    );
  }
}

async function fetchCandidates(pool: pg.Pool, options: Options): Promise<AuditCandidateRow[]> {
  const conditions: string[] = [];
  const values: Array<string | string[] | number> = [];

  if (options.bulkGroup) {
    values.push(options.bulkGroup);
    conditions.push(`a.bulk_group = $${values.length}`);
  }

  if (options.changedAfter) {
    values.push(options.changedAfter);
    conditions.push(`a.changed_at >= $${values.length}::timestamp`);
  }

  if (options.changedBefore) {
    values.push(options.changedBefore);
    conditions.push(`a.changed_at <= $${values.length}::timestamp`);
  }

  if (options.orderNumbers.length > 0) {
    values.push(options.orderNumbers);
    conditions.push(`UPPER(a.order_number) = ANY($${values.length}::text[])`);
  }

  const whereClause = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
  values.push(options.limit);

  const result = await pool.query<AuditCandidateRow>(
    `
      with filtered_audit as (
        select
          a.id as "auditId",
          a.order_id as "orderId",
          a.order_number as "orderNumber",
          a.old_entry_date as "oldEntryDate",
          a.new_entry_date as "newEntryDate",
          a.delta_minutes as "deltaMinutes",
          a.changed_at as "changedAt",
          a.changed_by as "changedBy",
          a.reason as "reason",
          a.bulk_group as "bulkGroup",
          row_number() over (
            partition by a.order_id
            order by a.changed_at desc, a.id desc
          ) as audit_rank
        from order_date_change_audit a
        ${whereClause}
      )
      select
        f."auditId",
        f."orderId",
        f."orderNumber",
        f."oldEntryDate",
        f."newEntryDate",
        f."deltaMinutes",
        f."changedAt",
        f."changedBy",
        f."reason",
        f."bulkGroup",
        o.entry_date as "currentEntryDate",
        o.delivery_date as "currentDeliveryDate",
        o.expected_delivery_at as "currentExpectedDeliveryAt",
        o.bill_id as "billId",
        o.urgent,
        o.delivered
      from filtered_audit f
      join orders o on o.id = f."orderId"
      where f.audit_rank = 1
      order by f."changedAt" desc, f."auditId" desc
      limit $${values.length}
    `,
    values,
  );

  return result.rows;
}

function printCandidates(rows: AuditCandidateRow[], verbose: boolean) {
  if (rows.length === 0) {
    console.log("No matching audit rows were found.");
    return;
  }

  console.log(`Found ${rows.length} candidate order(s).`);
  console.table(
    rows.map((row) => ({
      orderNumber: row.orderNumber,
      orderId: row.orderId,
      bulkGroup: row.bulkGroup || "-",
      changedAt: formatDateTime(row.changedAt),
      oldEntryDate: formatDateTime(row.oldEntryDate),
      currentEntryDate: formatDateTime(row.currentEntryDate),
      currentDeliveryDate: formatDateTime(row.currentDeliveryDate),
      urgent: row.urgent ? "yes" : "no",
      delivered: row.delivered ? "yes" : "no",
    })),
  );

  if (!verbose) {
    return;
  }

  for (const row of rows) {
    console.log(
      [
        `- ${row.orderNumber} (#${row.orderId})`,
        `  audit: ${row.auditId} at ${formatDateTime(row.changedAt)}`,
        `  changed by: ${row.changedBy || "-"} | reason: ${row.reason || "-"}`,
        `  bulk group: ${row.bulkGroup || "-"}`,
        `  old entry: ${formatDateTime(row.oldEntryDate)}`,
        `  new entry from audit: ${formatDateTime(row.newEntryDate)}`,
        `  current entry: ${formatDateTime(row.currentEntryDate)}`,
        `  current delivery: ${formatDateTime(row.currentDeliveryDate)}`,
        `  current expected delivery: ${formatDateTime(row.currentExpectedDeliveryAt)}`,
        `  bill id: ${row.billId ?? "-"}`,
      ].join("\n"),
    );
  }
}

async function restoreOneOrder(client: pg.PoolClient, row: AuditCandidateRow) {
  const oldEntryDate = new Date(row.oldEntryDate);
  const newEntryDate = new Date(row.newEntryDate);

  if (Number.isNaN(oldEntryDate.getTime()) || Number.isNaN(newEntryDate.getTime())) {
    throw new Error(`Audit row ${row.auditId} has invalid timestamps.`);
  }

  const reverseDeltaMs = oldEntryDate.getTime() - newEntryDate.getTime();

  await client.query(
    `
      update orders
      set entry_date = $2::timestamp
      where id = $1
    `,
    [row.orderId, oldEntryDate.toISOString()],
  );

  if (row.billId) {
    await client.query(
      `
        update bills
        set bill_date = $2::timestamp
        where id = $1
      `,
      [row.billId, oldEntryDate.toISOString()],
    );

    await client.query(
      `
        update client_transactions
        set date = date + ($2 * interval '1 millisecond')
        where bill_id = $1
          and type = any($3::text[])
      `,
      [row.billId, reverseDeltaMs, [...CREDIT_MANAGEMENT_TYPES]],
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateApplyScope(options);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required before running this recovery.");
  }

  const pool = new Pool({ connectionString });

  try {
    const rows = await fetchCandidates(pool, options);
    printCandidates(rows, options.verbose);

    if (rows.length === 0) {
      return;
    }

    if (!options.apply) {
      console.log('Dry run only. Re-run with "--apply" after reviewing the candidates.');
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("begin");

      for (const row of rows) {
        await restoreOneOrder(client, row);
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    console.log(`Recovered ${rows.length} order(s).`);
    console.log(
      "Entry dates, linked bill dates, and related credit-management dates were restored. Delivery dates were left unchanged.",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Entry-date recovery failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
