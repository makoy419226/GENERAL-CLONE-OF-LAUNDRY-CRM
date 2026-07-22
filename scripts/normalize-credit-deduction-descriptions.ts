import pg from "pg";
import { loadEnvironment } from "../server/env.ts";

loadEnvironment();

const { Pool } = pg;

const DIRECT_DEDUCTION_TYPES = ["deposit_used", "bulk_deposit_used"] as const;
const LEGACY_DEDUCTION_TYPES = ["payment", "bulk_payment"] as const;
const CANDIDATE_TYPES = [...DIRECT_DEDUCTION_TYPES, ...LEGACY_DEDUCTION_TYPES] as const;

type Options = {
  apply: boolean;
  clientIds: number[];
  verbose: boolean;
};

type CandidateRow = {
  id: number;
  clientId: number | null;
  billId: number | null;
  type: string;
  description: string | null;
  paymentMethod: string | null;
  billPaymentMethod: string | null;
  billReferenceNumber: string | null;
  billDescription: string | null;
  orderNumbers: string[] | null;
};

type PlannedChange = {
  id: number;
  clientId: number | null;
  billId: number;
  from: string;
  to: string;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apply: false,
    clientIds: [],
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];

    if (value === "--apply") {
      options.apply = true;
      continue;
    }

    if (value === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (value === "--client" || value === "--clients") {
      const nextValue = argv[i + 1];
      if (!nextValue) {
        throw new Error(`Missing value after ${value}`);
      }
      options.clientIds.push(...parseClientIdList(nextValue));
      i++;
      continue;
    }

    if (value.startsWith("--client=") || value.startsWith("--clients=")) {
      const [, rawIds = ""] = value.split("=", 2);
      options.clientIds.push(...parseClientIdList(rawIds));
      continue;
    }

    if (value === "--help" || value === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${value}`);
  }

  options.clientIds = Array.from(
    new Set(options.clientIds.filter((clientId) => Number.isFinite(clientId) && clientId > 0)),
  ).sort((left, right) => left - right);

  return options;
}

function printHelp() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/normalize-credit-deduction-descriptions.ts [--apply] [--client 123,456] [--verbose]",
      "",
      "Examples:",
      "  npx tsx scripts/normalize-credit-deduction-descriptions.ts",
      "  npx tsx scripts/normalize-credit-deduction-descriptions.ts --apply",
      "  npx tsx scripts/normalize-credit-deduction-descriptions.ts --apply --client 42",
    ].join("\n"),
  );
}

function parseClientIdList(value: string): number[] {
  return String(value)
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
}

function normalizePaymentMethod(value?: string | null): string {
  const normalized = String(value || "").trim().toLowerCase();

  switch (normalized) {
    case "bulk_deposit":
    case "deposit":
      return "deposit";
    case "transfer":
      return "bank";
    default:
      return normalized;
  }
}

function isCreditDeductionRow(row: CandidateRow): boolean {
  if ((DIRECT_DEDUCTION_TYPES as readonly string[]).includes(row.type)) {
    return true;
  }

  if (!(LEGACY_DEDUCTION_TYPES as readonly string[]).includes(row.type)) {
    return false;
  }

  if (normalizePaymentMethod(row.paymentMethod) === "deposit") {
    return true;
  }

  if (normalizePaymentMethod(row.billPaymentMethod) === "deposit") {
    return true;
  }

  const description = String(row.description || "").trim().toLowerCase();
  return description.startsWith("deposit used") || description.includes("-> account credit");
}

function extractTaggedTokens(value?: string | null): string[] {
  return Array.from(
    new Set((String(value || "").match(/\[(?:bulk|SPLIT):[^\]]+\]/gi) || []).map((entry) => entry.trim())),
  );
}

function extractOrderNumber(value?: string | null): string | null {
  const text = String(value || "").trim();
  if (!text) return null;

  const explicitMatch = text.match(/Order\s*#?\s*(ORD-[A-Z0-9-]+)/i);
  if (explicitMatch?.[1]) {
    return explicitMatch[1].toUpperCase();
  }

  const billReferenceMatch = text.match(/BILL-(ORD-[A-Z0-9-]+)/i);
  if (billReferenceMatch?.[1]) {
    return billReferenceMatch[1].toUpperCase();
  }

  const looseMatch = text.match(/\b(ORD-[A-Z0-9-]+)\b/i);
  if (looseMatch?.[1]) {
    return looseMatch[1].toUpperCase();
  }

  return null;
}

function chooseOrderNumber(row: CandidateRow): string | null {
  const dbOrderNumbers = Array.from(
    new Set(
      (row.orderNumbers || [])
        .map((entry) => String(entry || "").trim().toUpperCase())
        .filter(Boolean),
    ),
  );

  if (dbOrderNumbers.length === 1) {
    return dbOrderNumbers[0];
  }

  return (
    extractOrderNumber(row.description) ||
    extractOrderNumber(row.billReferenceNumber) ||
    extractOrderNumber(row.billDescription)
  );
}

function buildNormalizedDescription(row: CandidateRow): string | null {
  if (!row.billId) {
    return null;
  }

  const orderNumber = chooseOrderNumber(row);
  const baseDescription = orderNumber
    ? `Deposit used for Bill #${row.billId}: Order #${orderNumber}`
    : `Deposit used for Bill #${row.billId}`;
  const tags = extractTaggedTokens(row.description);

  return tags.length > 0 ? `${baseDescription} ${tags.join(" ")}` : baseDescription;
}

function normalizeComparableText(value?: string | null): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchCandidateRows(pool: pg.Pool, clientIds: number[]): Promise<CandidateRow[]> {
  const query = clientIds.length
    ? `
        select
          client_transactions.id,
          client_transactions.client_id as "clientId",
          client_transactions.bill_id as "billId",
          client_transactions.type,
          client_transactions.description,
          client_transactions.payment_method as "paymentMethod",
          bills.payment_method as "billPaymentMethod",
          bills.reference_number as "billReferenceNumber",
          bills.description as "billDescription",
          coalesce(array_remove(array_agg(distinct orders.order_number), null), '{}') as "orderNumbers"
        from client_transactions
        left join bills on bills.id = client_transactions.bill_id
        left join orders on orders.bill_id = client_transactions.bill_id
        where client_transactions.bill_id is not null
          and client_transactions.client_id = any($1::int[])
          and client_transactions.type = any($2::text[])
        group by
          client_transactions.id,
          client_transactions.client_id,
          client_transactions.bill_id,
          client_transactions.type,
          client_transactions.description,
          client_transactions.payment_method,
          bills.payment_method,
          bills.reference_number,
          bills.description
        order by client_transactions.id
      `
    : `
        select
          client_transactions.id,
          client_transactions.client_id as "clientId",
          client_transactions.bill_id as "billId",
          client_transactions.type,
          client_transactions.description,
          client_transactions.payment_method as "paymentMethod",
          bills.payment_method as "billPaymentMethod",
          bills.reference_number as "billReferenceNumber",
          bills.description as "billDescription",
          coalesce(array_remove(array_agg(distinct orders.order_number), null), '{}') as "orderNumbers"
        from client_transactions
        left join bills on bills.id = client_transactions.bill_id
        left join orders on orders.bill_id = client_transactions.bill_id
        where client_transactions.bill_id is not null
          and client_transactions.type = any($1::text[])
        group by
          client_transactions.id,
          client_transactions.client_id,
          client_transactions.bill_id,
          client_transactions.type,
          client_transactions.description,
          client_transactions.payment_method,
          bills.payment_method,
          bills.reference_number,
          bills.description
        order by client_transactions.id
      `;

  const result = clientIds.length
    ? await pool.query<CandidateRow>(query, [clientIds, [...CANDIDATE_TYPES]])
    : await pool.query<CandidateRow>(query, [[...CANDIDATE_TYPES]]);

  return result.rows;
}

function planChanges(rows: CandidateRow[], verbose: boolean) {
  const matchedRows = rows.filter((row) => isCreditDeductionRow(row));
  const plannedChanges: PlannedChange[] = [];
  let unchangedCount = 0;
  let skippedCount = 0;

  for (const row of matchedRows) {
    const nextDescription = buildNormalizedDescription(row);
    if (!nextDescription || !row.billId) {
      skippedCount++;
      if (verbose) {
        console.log(`Skipping transaction #${row.id}: no bill context available.`);
      }
      continue;
    }

    const currentDescription = normalizeComparableText(row.description);
    const nextComparable = normalizeComparableText(nextDescription);

    if (currentDescription === nextComparable) {
      unchangedCount++;
      continue;
    }

    plannedChanges.push({
      id: row.id,
      clientId: row.clientId,
      billId: row.billId,
      from: String(row.description || "").trim() || "(empty)",
      to: nextDescription,
    });
  }

  return {
    matchedCount: matchedRows.length,
    plannedChanges,
    unchangedCount,
    skippedCount,
  };
}

async function applyChanges(pool: pg.Pool, changes: PlannedChange[]) {
  if (changes.length === 0) {
    return;
  }

  await pool.query("BEGIN");

  try {
    for (const change of changes) {
      await pool.query(
        `
          update client_transactions
          set description = $2
          where id = $1
        `,
        [change.id, change.to],
      );
    }

    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required before running this script.");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const candidateRows = await fetchCandidateRows(pool, options.clientIds);
    const summary = planChanges(candidateRows, options.verbose);

    console.log(
      `${options.apply ? "Applying" : "Dry run"} credit deduction description normalization.`,
    );
    console.log(`Candidate rows loaded: ${candidateRows.length}`);
    console.log(`Matched deduction rows: ${summary.matchedCount}`);
    console.log(`Rows needing updates: ${summary.plannedChanges.length}`);
    console.log(`Already normalized: ${summary.unchangedCount}`);
    console.log(`Skipped: ${summary.skippedCount}`);

    if (summary.plannedChanges.length > 0) {
      console.log("");
      console.log("Planned updates:");
      for (const change of summary.plannedChanges) {
        console.log(
          `  tx #${change.id} | client #${change.clientId ?? "-"} | bill #${change.billId}`,
        );
        console.log(`    from: ${change.from}`);
        console.log(`    to:   ${change.to}`);
      }
    }

    if (!options.apply) {
      console.log("");
      console.log("Dry run only. Re-run with --apply to update stored descriptions.");
      return;
    }

    await applyChanges(pool, summary.plannedChanges);

    console.log("");
    console.log("Credit deduction descriptions updated successfully.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Credit deduction description normalization failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
