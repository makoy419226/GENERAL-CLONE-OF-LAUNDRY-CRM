import pg from "pg";
import { loadEnvironment } from "../server/env.ts";

loadEnvironment();

const { Pool } = pg;

const CREDIT_TYPES = ["deposit", "deposit_used", "bulk_deposit_used"] as const;
const LEGACY_CREDIT_USAGE_SOURCE_TYPES = ["payment", "bulk_payment"] as const;
const MONEY_EPSILON = 0.01;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type CreditType = (typeof CREDIT_TYPES)[number];
type LegacyCreditUsageSourceType = (typeof LEGACY_CREDIT_USAGE_SOURCE_TYPES)[number];

type Options = {
  apply: boolean;
  clientIds: number[];
  verbose: boolean;
};

type ClientRow = {
  id: number;
  name: string;
  billNumber: string | null;
  deposit: string | null;
  balance: string | null;
};

type BillRow = {
  id: number;
  clientId: number | null;
  description: string | null;
  billDate: Date | null;
  amount: string;
  paidAmount: string | null;
  paymentMethod: string | null;
};

type OrderRow = {
  id: number;
  clientId: number | null;
  billId: number | null;
  orderNumber: string;
  paymentMethod: string | null;
  paidAmount: string | null;
  entryDate: Date;
  deliveryDate: Date | null;
};

type BillPaymentRow = {
  id: number;
  billId: number;
  clientId: number;
  amount: string;
  paymentDate: Date;
  paymentMethod: string | null;
  notes: string | null;
};

type CreditTxRow = {
  id: number;
  clientId: number;
  billId: number | null;
  type: CreditType;
  amount: string;
  description: string | null;
  date: Date;
  runningBalance: string;
  paymentMethod: string | null;
  discount: string | null;
  processedBy: string | null;
};

type LegacyCreditUsageRow = {
  id: number;
  clientId: number;
  billId: number | null;
  type: LegacyCreditUsageSourceType;
  amount: string;
  description: string | null;
  date: Date;
  runningBalance: string;
  paymentMethod: string | null;
  billPaymentMethod: string | null;
  discount: string | null;
  processedBy: string | null;
};

type CreditUsageSourceRow = {
  id: number;
  clientId: number;
  billId: number | null;
  type: CreditType;
  amount: string;
  description: string | null;
  date: Date;
  runningBalance: string;
  paymentMethod: string | null;
  discount: string | null;
  processedBy: string | null;
  source: "credit_row" | "legacy_history";
};

type PlannedCreditRow = {
  clientId: number;
  billId: number | null;
  type: CreditType;
  amount: number;
  description: string;
  date: Date;
  paymentMethod: string | null;
  discount: number;
  processedBy: string | null;
  runningBalance: string;
  sortHint: number;
  source:
    | "existing_deposit"
    | "bill_payment_deposit"
    | "bill_payment_overpay"
    | "bill_paid_inferred"
    | "order_paid_inferred"
    | "existing_usage_fallback"
    | "current_balance_adjustment";
};

type ClientPlan = {
  client: ClientRow;
  existingRows: CreditTxRow[];
  legacySourceRows: LegacyCreditUsageRow[];
  targetRows: PlannedCreditRow[];
  warnings: string[];
  currentDeposit: number;
  ledgerNet: number;
  adjustment: number;
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
        throw new Error("Missing value after --client");
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
    new Set(
      options.clientIds.filter((clientId) => Number.isFinite(clientId) && clientId > 0),
    ),
  ).sort((left, right) => left - right);

  return options;
}

function printHelp() {
  console.log(`
Usage:
  npx tsx scripts/migrate-credit-management.ts [--apply] [--client 123,456] [--verbose]

Examples:
  npx tsx scripts/migrate-credit-management.ts
  npx tsx scripts/migrate-credit-management.ts --apply
  npx tsx scripts/migrate-credit-management.ts --apply --client 42
`.trim());
}

function parseClientIdList(value: string): number[] {
  return String(value)
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
}

function parseMoney(value: unknown): number {
  const parsed = parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return rounded.toFixed(2);
}

function moneyEquals(left: number, right: number): boolean {
  return Math.abs(left - right) <= MONEY_EPSILON;
}

function normalizePaymentMethod(value?: string | null): string {
  const normalized = String(value || "").trim().toLowerCase();

  switch (normalized) {
    case "bulk_deposit":
    case "deposit":
      return "deposit";
    case "transfer":
      return "bank";
    case "cash":
    case "card":
    case "bank":
      return normalized;
    default:
      return normalized || "cash";
  }
}

function paymentMethodIncludesDeposit(value?: string | null): boolean {
  const parts = String(value || "")
    .split("+")
    .map((part) => normalizePaymentMethod(part))
    .filter(Boolean);

  return parts.includes("deposit");
}

function uniqueOrderNumbers(orders: OrderRow[]): string[] {
  return Array.from(
    new Set(
      orders
        .map((order) => String(order.orderNumber || "").trim())
        .filter(Boolean),
    ),
  );
}

function buildOrderReference(orders: OrderRow[]): string | null {
  const orderNumbers = uniqueOrderNumbers(orders);
  if (orderNumbers.length === 0) return null;
  if (orderNumbers.length === 1) return `Order #${orderNumbers[0]}`;
  return `Orders ${orderNumbers.map((orderNumber) => `#${orderNumber}`).join(", ")}`;
}

function buildBillContext(bill: BillRow | undefined, orders: OrderRow[]): string {
  const billDescription = String(bill?.description || "").trim();
  if (billDescription) return billDescription;
  return buildOrderReference(orders) || "N/A";
}

function buildDepositUsedDescription(bill: BillRow | undefined, orders: OrderRow[]): string {
  if (bill) {
    return `Deposit used for Bill #${bill.id}: ${buildBillContext(bill, orders)}`;
  }

  return buildOrderReference(orders)
    ? `Deposit used for ${buildOrderReference(orders)}`
    : "Deposit used from account credit";
}

function buildOverpaymentDescription(bill: BillRow | undefined, orders: OrderRow[]): string {
  if (bill) {
    const billTarget = parseMoney(bill.amount);
    const orderReference = buildOrderReference(orders);
    const subject = orderReference || `Bill #${bill.id}`;
    return `Credit added from overpayment on ${subject} (bill amount ${formatMoney(billTarget)} AED)`;
  }

  return "Credit added from migrated overpayment";
}

function extractOrderNumbers(value?: string | null): string[] {
  return Array.from(
    new Set(
      (String(value || "").toUpperCase().match(/ORD-[A-Z0-9-]+/g) || []).map((entry) =>
        entry.trim(),
      ),
    ),
  );
}

function extractBillIds(value?: string | null): number[] {
  const matches = String(value || "").match(/#(\d+)/g) || [];
  const ids = matches
    .map((token) => Number(token.replace("#", "")))
    .filter((id) => Number.isFinite(id) && id > 0);
  return Array.from(new Set(ids));
}

function descriptionMentionsOrder(value: string | null | undefined, orderNumber: string): boolean {
  return String(value || "").toUpperCase().includes(String(orderNumber || "").toUpperCase());
}

function getMinDate(rows: PlannedCreditRow[]): Date | null {
  if (rows.length === 0) return null;
  return rows.reduce((minDate, row) => (row.date < minDate ? row.date : minDate), rows[0].date);
}

function getMaxDate(rows: PlannedCreditRow[]): Date | null {
  if (rows.length === 0) return null;
  return rows.reduce((maxDate, row) => (row.date > maxDate ? row.date : maxDate), rows[0].date);
}

function sortRows(rows: PlannedCreditRow[]): PlannedCreditRow[] {
  return [...rows].sort((left, right) => {
    const timeDelta = left.date.getTime() - right.date.getTime();
    if (timeDelta !== 0) return timeDelta;
    const billDelta = (left.billId || 0) - (right.billId || 0);
    if (billDelta !== 0) return billDelta;
    const typeDelta = left.type.localeCompare(right.type);
    if (typeDelta !== 0) return typeDelta;
    return left.sortHint - right.sortHint;
  });
}

function defaultDescriptionForType(type: CreditType, billId: number | null): string {
  if (type === "deposit") return "Deposit received";
  if (billId) return `Deposit used for Bill #${billId}`;
  return type === "bulk_deposit_used" ? "Bulk credit payment" : "Deposit used from account credit";
}

function normalizeLegacyCreditUsageDescription(
  description: string | null | undefined,
  type: CreditType,
  billId: number | null,
): string {
  const fallback = defaultDescriptionForType(type, billId);
  const text = String(description || "").trim();
  if (!text) {
    return fallback;
  }

  const normalized = text.replace(/Payment for Bill/gi, "Deposit used for Bill");
  if (type === "bulk_deposit_used") {
    return normalized.replace(/^Bulk payment\b/gi, "Bulk credit payment");
  }

  return normalized;
}

function inferLegacyCreditType(row: LegacyCreditUsageRow): CreditType {
  if (row.type === "bulk_payment") {
    return "bulk_deposit_used";
  }

  const billIds = extractBillIds(row.description);
  if (billIds.length > 1 || /\[bulk:[^\]]+\]/i.test(String(row.description || ""))) {
    return "bulk_deposit_used";
  }

  return "deposit_used";
}

function toUsageSourceRowFromExisting(tx: CreditTxRow): CreditUsageSourceRow {
  return {
    ...tx,
    source: "credit_row",
  };
}

function toUsageSourceRowFromLegacy(tx: LegacyCreditUsageRow): CreditUsageSourceRow {
  const type = inferLegacyCreditType(tx);
  return {
    id: tx.id,
    clientId: tx.clientId,
    billId: tx.billId,
    type,
    amount: tx.amount,
    description: normalizeLegacyCreditUsageDescription(tx.description, type, tx.billId),
    date: new Date(tx.date),
    runningBalance: tx.runningBalance,
    paymentMethod: "deposit",
    discount: tx.discount,
    processedBy: tx.processedBy,
    source: "legacy_history",
  };
}

function getUsageSourceBillIds(row: Pick<CreditUsageSourceRow, "billId" | "description">): number[] {
  return row.billId != null ? [row.billId] : extractBillIds(row.description);
}

function getUsageSourceOrderNumbers(row: Pick<CreditUsageSourceRow, "description">): string[] {
  return extractOrderNumbers(row.description);
}

function usageSourcesReferenceSameTarget(left: CreditUsageSourceRow, right: CreditUsageSourceRow): boolean {
  const leftBillIds = getUsageSourceBillIds(left);
  const rightBillIds = getUsageSourceBillIds(right);

  if (leftBillIds.length > 0 || rightBillIds.length > 0) {
    return leftBillIds.some((billId) => rightBillIds.includes(billId));
  }

  const leftOrderNumbers = getUsageSourceOrderNumbers(left);
  const rightOrderNumbers = getUsageSourceOrderNumbers(right);
  return leftOrderNumbers.some((orderNumber) => rightOrderNumbers.includes(orderNumber));
}

function legacyUsageCoveredByExistingRows(
  legacyRow: LegacyCreditUsageRow,
  existingUsageRows: CreditTxRow[],
): boolean {
  const normalizedLegacy = toUsageSourceRowFromLegacy(legacyRow);

  return existingUsageRows.some((row) => {
    if (row.type !== normalizedLegacy.type) {
      return false;
    }

    if (!moneyEquals(parseMoney(row.amount), parseMoney(normalizedLegacy.amount))) {
      return false;
    }

    const normalizedExisting = toUsageSourceRowFromExisting(row);
    if (!usageSourcesReferenceSameTarget(normalizedExisting, normalizedLegacy)) {
      return false;
    }

    const timeDistance = Math.abs(
      new Date(normalizedExisting.date).getTime() - new Date(normalizedLegacy.date).getTime(),
    );
    return timeDistance <= DAY_MS;
  });
}

function toPlannedRowFromExisting(tx: CreditUsageSourceRow, runningBalance: string): PlannedCreditRow {
  return {
    clientId: tx.clientId,
    billId: tx.billId,
    type: tx.type,
    amount: parseMoney(tx.amount),
    description: String(tx.description || "").trim() || defaultDescriptionForType(tx.type, tx.billId),
    date: new Date(tx.date),
    paymentMethod: tx.paymentMethod || "deposit",
    discount: parseMoney(tx.discount),
    processedBy: tx.processedBy,
    runningBalance,
    sortHint: tx.id,
    source: tx.type === "deposit" ? "existing_deposit" : "existing_usage_fallback",
  };
}

function takeMatchingExistingUsage(
  unmatchedUsage: CreditUsageSourceRow[],
  billId: number | null,
  amount: number,
  date: Date,
  orderNumbers: string[] = [],
): CreditUsageSourceRow | undefined {
  let bestIndex = -1;
  let bestPriority = Number.POSITIVE_INFINITY;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = 0; index < unmatchedUsage.length; index++) {
    const candidate = unmatchedUsage[index];
    const candidateAmount = parseMoney(candidate.amount);
    if (!moneyEquals(candidateAmount, amount)) {
      continue;
    }

    const candidateBillIds =
      candidate.billId != null ? [candidate.billId] : extractBillIds(candidate.description);

    const matchesBill =
      billId != null
        ? candidateBillIds.length === 1 && candidateBillIds[0] === billId
        : orderNumbers.some((orderNumber) => descriptionMentionsOrder(candidate.description, orderNumber));

    if (!matchesBill) {
      continue;
    }

    const timeDistance = Math.abs(new Date(candidate.date).getTime() - date.getTime());
    const priority = candidate.source === "credit_row" ? 0 : 1;
    if (priority < bestPriority || (priority === bestPriority && timeDistance < bestScore)) {
      bestPriority = priority;
      bestScore = timeDistance;
      bestIndex = index;
    }
  }

  if (bestIndex < 0) {
    return undefined;
  }

  const [matched] = unmatchedUsage.splice(bestIndex, 1);
  return matched;
}

function hasMatchingExistingDeposit(
  existingDeposits: CreditTxRow[],
  billId: number | null,
  amount: number,
): boolean {
  return existingDeposits.some((tx) => {
    if (!moneyEquals(parseMoney(tx.amount), amount)) {
      return false;
    }

    if (billId == null) {
      return tx.billId == null;
    }

    return tx.billId === billId || extractBillIds(tx.description).includes(billId);
  });
}

function bulkSummaryCoveredByRows(
  tx: CreditUsageSourceRow,
  rows: PlannedCreditRow[],
): boolean {
  if (tx.type !== "bulk_deposit_used") {
    return false;
  }

  const summaryBillIds = extractBillIds(tx.description);
  if (summaryBillIds.length === 0) {
    return false;
  }

  const matchingRows = rows.filter(
    (row) => row.type === "deposit_used" && row.billId != null && summaryBillIds.includes(row.billId),
  );

  if (matchingRows.length === 0) {
    return false;
  }

  const matchedBillIds = new Set(
    matchingRows
      .map((row) => row.billId)
      .filter((billId): billId is number => Number.isFinite(billId)),
  );

  if (summaryBillIds.some((billId) => !matchedBillIds.has(billId))) {
    return false;
  }

  const summaryAmount = parseMoney(tx.amount);
  const rowAmount = matchingRows.reduce((sum, row) => sum + row.amount, 0);
  return moneyEquals(summaryAmount, rowAmount);
}

function buildAccountLabel(client: ClientRow): string {
  const accountNumber = String(client.billNumber || "").trim();
  if (accountNumber) {
    return `account ${accountNumber}`;
  }

  return `client #${client.id}`;
}

function chooseFallbackUsageDate(
  bill: BillRow | undefined,
  orders: OrderRow[],
  payments: BillPaymentRow[],
): Date {
  if (payments.length > 0) {
    return new Date(
      Math.max(
        ...payments.map((payment) => new Date(payment.paymentDate).getTime()),
      ),
    );
  }

  const datedOrders = orders
    .map((order) => order.deliveryDate || order.entryDate)
    .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()));

  if (datedOrders.length > 0) {
    return new Date(Math.max(...datedOrders.map((value) => value.getTime())));
  }

  if (bill?.billDate) {
    return new Date(bill.billDate);
  }

  return new Date();
}

function addUsageRow(
  rows: PlannedCreditRow[],
  unmatchedUsage: CreditUsageSourceRow[],
  config: {
    clientId: number;
    billId: number | null;
    amount: number;
    date: Date;
    orderNumbers?: string[];
    description: string;
    runningBalance: string;
    sortHint: number;
    source: PlannedCreditRow["source"];
  },
) {
  if (config.amount <= MONEY_EPSILON) {
    return;
  }

  const matched = takeMatchingExistingUsage(
    unmatchedUsage,
    config.billId,
    config.amount,
    config.date,
    config.orderNumbers || [],
  );

  rows.push({
    clientId: config.clientId,
    billId: config.billId,
    type: "deposit_used",
    amount: config.amount,
    description: String(matched?.description || config.description).trim() || config.description,
    date: matched ? new Date(matched.date) : new Date(config.date),
    paymentMethod: "deposit",
    discount: parseMoney(matched?.discount),
    processedBy: matched?.processedBy || null,
    runningBalance: config.runningBalance,
    sortHint: matched?.id || config.sortHint,
    source: config.source,
  });
}

function buildClientPlan(
  client: ClientRow,
  bills: BillRow[],
  orders: OrderRow[],
  billPayments: BillPaymentRow[],
  existingRows: CreditTxRow[],
  legacySourceRows: LegacyCreditUsageRow[],
): ClientPlan {
  const runningBalance = formatMoney(parseMoney(client.balance));
  const currentDeposit = parseMoney(client.deposit);
  const warnings: string[] = [];

  const ordersByBillId = new Map<number, OrderRow[]>();
  const ordersWithoutBill: OrderRow[] = [];
  for (const order of orders) {
    if (order.billId != null) {
      const list = ordersByBillId.get(order.billId) || [];
      list.push(order);
      ordersByBillId.set(order.billId, list);
    } else {
      ordersWithoutBill.push(order);
    }
  }

  const paymentsByBillId = new Map<number, BillPaymentRow[]>();
  for (const payment of billPayments) {
    const list = paymentsByBillId.get(payment.billId) || [];
    list.push(payment);
    paymentsByBillId.set(payment.billId, list);
  }

  const existingDeposits = existingRows.filter((row) => row.type === "deposit");
  const existingUsageRows = existingRows
    .filter((row) => row.type === "deposit_used" || row.type === "bulk_deposit_used")
    .sort((left, right) => left.id - right.id);
  const normalizedLegacySourceRows = legacySourceRows.filter(
    (row) => !legacyUsageCoveredByExistingRows(row, existingUsageRows),
  );
  const unmatchedExistingUsage: CreditUsageSourceRow[] = [
    ...existingUsageRows.map((row) => toUsageSourceRowFromExisting(row)),
    ...normalizedLegacySourceRows.map((row) => toUsageSourceRowFromLegacy(row)),
  ];

  const targetRows: PlannedCreditRow[] = existingDeposits.map((row) =>
    toPlannedRowFromExisting(toUsageSourceRowFromExisting(row), runningBalance),
  );
  const derivedUsageRows: PlannedCreditRow[] = [];

  for (const bill of bills) {
    const linkedOrders = ordersByBillId.get(bill.id) || [];
    const paymentsForBill = (paymentsByBillId.get(bill.id) || []).slice().sort((left, right) => {
      const timeDelta = new Date(left.paymentDate).getTime() - new Date(right.paymentDate).getTime();
      if (timeDelta !== 0) return timeDelta;
      return left.id - right.id;
    });

    const depositPayments = paymentsForBill.filter(
      (payment) => normalizePaymentMethod(payment.paymentMethod) === "deposit",
    );
    const nonDepositPayments = paymentsForBill.filter(
      (payment) => normalizePaymentMethod(payment.paymentMethod) !== "deposit",
    );

    for (const payment of depositPayments) {
      addUsageRow(derivedUsageRows, unmatchedExistingUsage, {
        clientId: client.id,
        billId: bill.id,
        amount: parseMoney(payment.amount),
        date: new Date(payment.paymentDate),
        orderNumbers: uniqueOrderNumbers(linkedOrders),
        description: buildDepositUsedDescription(bill, linkedOrders),
        runningBalance,
        sortHint: payment.id,
        source: "bill_payment_deposit",
      });
    }

    const totalExplicitDeposit = depositPayments.reduce((sum, payment) => sum + parseMoney(payment.amount), 0);
    const totalNonDepositPaid = nonDepositPayments.reduce((sum, payment) => sum + parseMoney(payment.amount), 0);
    const paidAmount = parseMoney(bill.paidAmount);

    const exactBillUsesDeposit =
      normalizePaymentMethod(bill.paymentMethod) === "deposit" ||
      linkedOrders.some((order) => normalizePaymentMethod(order.paymentMethod) === "deposit");
    const billUsesDeposit =
      paymentMethodIncludesDeposit(bill.paymentMethod) ||
      linkedOrders.some((order) => paymentMethodIncludesDeposit(order.paymentMethod));

    if (totalExplicitDeposit <= MONEY_EPSILON && billUsesDeposit && paidAmount > MONEY_EPSILON) {
      const inferredDepositAmount = Math.max(0, paidAmount - totalNonDepositPaid);

      if (inferredDepositAmount > MONEY_EPSILON && (exactBillUsesDeposit || totalNonDepositPaid > MONEY_EPSILON)) {
        addUsageRow(derivedUsageRows, unmatchedExistingUsage, {
          clientId: client.id,
          billId: bill.id,
          amount: inferredDepositAmount,
          date: chooseFallbackUsageDate(bill, linkedOrders, paymentsForBill),
          orderNumbers: uniqueOrderNumbers(linkedOrders),
          description: buildDepositUsedDescription(bill, linkedOrders),
          runningBalance,
          sortHint: 100_000 + bill.id,
          source: "bill_paid_inferred",
        });
      } else if (billUsesDeposit) {
        warnings.push(
          `Bill #${bill.id} includes account credit in payment method "${bill.paymentMethod || "unknown"}" but no exact credit amount could be reconstructed.`,
        );
      }
    }

    const totalBillPayments = paymentsForBill.reduce((sum, payment) => sum + parseMoney(payment.amount), 0);
    const overpaymentAmount = Math.max(0, totalBillPayments - parseMoney(bill.amount));
    if (
      overpaymentAmount > MONEY_EPSILON &&
      !hasMatchingExistingDeposit(existingDeposits, bill.id, overpaymentAmount)
    ) {
      const latestPayment = paymentsForBill[paymentsForBill.length - 1];
      targetRows.push({
        clientId: client.id,
        billId: bill.id,
        type: "deposit",
        amount: overpaymentAmount,
        description: buildOverpaymentDescription(bill, linkedOrders),
        date: latestPayment ? new Date(latestPayment.paymentDate) : chooseFallbackUsageDate(bill, linkedOrders, paymentsForBill),
        paymentMethod: latestPayment?.paymentMethod || "cash",
        discount: 0,
        processedBy: null,
        runningBalance,
        sortHint: latestPayment?.id || 200_000 + bill.id,
        source: "bill_payment_overpay",
      });
    }
  }

  for (const order of ordersWithoutBill) {
    const orderUsesExactDeposit = normalizePaymentMethod(order.paymentMethod) === "deposit";
    const paidAmount = parseMoney(order.paidAmount);
    if (!orderUsesExactDeposit || paidAmount <= MONEY_EPSILON) {
      continue;
    }

    addUsageRow(derivedUsageRows, unmatchedExistingUsage, {
      clientId: client.id,
      billId: null,
      amount: paidAmount,
      date: order.deliveryDate || order.entryDate || new Date(),
      orderNumbers: [order.orderNumber],
      description: `Deposit used for Order #${order.orderNumber}`,
      runningBalance,
      sortHint: 300_000 + order.id,
      source: "order_paid_inferred",
    });
  }

  targetRows.push(...derivedUsageRows);

  for (const leftoverUsage of unmatchedExistingUsage) {
    if (bulkSummaryCoveredByRows(leftoverUsage, derivedUsageRows)) {
      continue;
    }

    targetRows.push(toPlannedRowFromExisting(leftoverUsage, runningBalance));
  }

  const ledgerNetBeforeAdjustment = targetRows.reduce((sum, row) => {
    if (row.type === "deposit") return sum + row.amount;
    return sum - row.amount;
  }, 0);
  const adjustment = currentDeposit - ledgerNetBeforeAdjustment;

  if (adjustment > MONEY_EPSILON) {
    const earliestDate = getMinDate(targetRows);
    targetRows.push({
      clientId: client.id,
      billId: null,
      type: "deposit",
      amount: adjustment,
      description: `Migrated opening account credit balance for ${buildAccountLabel(client)}`,
      date: earliestDate ? new Date(earliestDate.getTime() - MINUTE_MS) : new Date(),
      paymentMethod: "deposit",
      discount: 0,
      processedBy: "system-migration",
      runningBalance,
      sortHint: -1,
      source: "current_balance_adjustment",
    });
  } else if (adjustment < -MONEY_EPSILON) {
    const latestDate = getMaxDate(targetRows);
    targetRows.push({
      clientId: client.id,
      billId: null,
      type: "deposit_used",
      amount: Math.abs(adjustment),
      description: `Migrated credit adjustment for ${buildAccountLabel(client)} to match the current stored balance`,
      date: latestDate ? new Date(latestDate.getTime() + MINUTE_MS) : new Date(),
      paymentMethod: "deposit",
      discount: 0,
      processedBy: "system-migration",
      runningBalance,
      sortHint: Number.MAX_SAFE_INTEGER,
      source: "current_balance_adjustment",
    });
  }

  const sortedRows = sortRows(targetRows);
  const ledgerNet = sortedRows.reduce((sum, row) => {
    if (row.type === "deposit") return sum + row.amount;
    return sum - row.amount;
  }, 0);

  const combinedWarnings = [...warnings];
  if (!moneyEquals(ledgerNet, currentDeposit)) {
    combinedWarnings.push(
      `Rebuilt ledger net is ${formatMoney(ledgerNet)} AED while client deposit is ${formatMoney(currentDeposit)} AED.`,
    );
  }

  return {
    client,
    existingRows,
    legacySourceRows: normalizedLegacySourceRows,
    targetRows: sortedRows,
    warnings: combinedWarnings,
    currentDeposit,
    ledgerNet,
    adjustment,
  };
}

async function fetchClients(pool: pg.Pool, clientIds: number[]): Promise<ClientRow[]> {
  const query = clientIds.length
    ? `
        select
          id,
          name,
          bill_number as "billNumber",
          deposit,
          balance
        from clients
        where id = any($1::int[])
        order by id
      `
    : `
        select
          id,
          name,
          bill_number as "billNumber",
          deposit,
          balance
        from clients
        order by id
      `;

  const result = clientIds.length
    ? await pool.query<ClientRow>(query, [clientIds])
    : await pool.query<ClientRow>(query);

  return result.rows;
}

async function fetchBills(pool: pg.Pool, clientIds: number[]): Promise<BillRow[]> {
  const query = clientIds.length
    ? `
        select
          id,
          client_id as "clientId",
          description,
          bill_date as "billDate",
          amount,
          paid_amount as "paidAmount",
          payment_method as "paymentMethod"
        from bills
        where client_id = any($1::int[])
        order by id
      `
    : `
        select
          id,
          client_id as "clientId",
          description,
          bill_date as "billDate",
          amount,
          paid_amount as "paidAmount",
          payment_method as "paymentMethod"
        from bills
        where client_id is not null
        order by id
      `;

  const result = clientIds.length
    ? await pool.query<BillRow>(query, [clientIds])
    : await pool.query<BillRow>(query);

  return result.rows;
}

async function fetchOrders(pool: pg.Pool, clientIds: number[]): Promise<OrderRow[]> {
  const query = clientIds.length
    ? `
        select
          id,
          client_id as "clientId",
          bill_id as "billId",
          order_number as "orderNumber",
          payment_method as "paymentMethod",
          paid_amount as "paidAmount",
          entry_date as "entryDate",
          delivery_date as "deliveryDate"
        from orders
        where client_id = any($1::int[])
        order by id
      `
    : `
        select
          id,
          client_id as "clientId",
          bill_id as "billId",
          order_number as "orderNumber",
          payment_method as "paymentMethod",
          paid_amount as "paidAmount",
          entry_date as "entryDate",
          delivery_date as "deliveryDate"
        from orders
        where client_id is not null
        order by id
      `;

  const result = clientIds.length
    ? await pool.query<OrderRow>(query, [clientIds])
    : await pool.query<OrderRow>(query);

  return result.rows;
}

async function fetchBillPayments(pool: pg.Pool, clientIds: number[]): Promise<BillPaymentRow[]> {
  const query = clientIds.length
    ? `
        select
          id,
          bill_id as "billId",
          client_id as "clientId",
          amount,
          payment_date as "paymentDate",
          payment_method as "paymentMethod",
          notes
        from bill_payments
        where client_id = any($1::int[])
        order by id
      `
    : `
        select
          id,
          bill_id as "billId",
          client_id as "clientId",
          amount,
          payment_date as "paymentDate",
          payment_method as "paymentMethod",
          notes
        from bill_payments
        order by id
      `;

  const result = clientIds.length
    ? await pool.query<BillPaymentRow>(query, [clientIds])
    : await pool.query<BillPaymentRow>(query);

  return result.rows;
}

async function fetchCreditTransactions(pool: pg.Pool, clientIds: number[]): Promise<CreditTxRow[]> {
  const query = clientIds.length
    ? `
        select
          id,
          client_id as "clientId",
          bill_id as "billId",
          type,
          amount,
          description,
          date,
          running_balance as "runningBalance",
          payment_method as "paymentMethod",
          discount,
          processed_by as "processedBy"
        from client_transactions
        where client_id = any($1::int[])
          and type = any($2::text[])
        order by id
      `
    : `
        select
          id,
          client_id as "clientId",
          bill_id as "billId",
          type,
          amount,
          description,
          date,
          running_balance as "runningBalance",
          payment_method as "paymentMethod",
          discount,
          processed_by as "processedBy"
        from client_transactions
        where type = any($1::text[])
        order by id
      `;

  const result = clientIds.length
    ? await pool.query<CreditTxRow>(query, [clientIds, [...CREDIT_TYPES]])
    : await pool.query<CreditTxRow>(query, [[...CREDIT_TYPES]]);

  return result.rows;
}

function isLikelyLegacyCreditUsageRow(row: LegacyCreditUsageRow): boolean {
  const normalizedMethod = normalizePaymentMethod(row.paymentMethod);
  if (normalizedMethod === "deposit") {
    return true;
  }

  const normalizedBillMethod = normalizePaymentMethod(row.billPaymentMethod);
  if (normalizedBillMethod === "deposit") {
    return true;
  }

  const description = String(row.description || "").trim().toLowerCase();
  if (!description) {
    return false;
  }

  return description.startsWith("deposit used") || description.includes("-> account credit");
}

async function fetchLegacyCreditUsageTransactions(
  pool: pg.Pool,
  clientIds: number[],
): Promise<LegacyCreditUsageRow[]> {
  const query = clientIds.length
    ? `
        select
          client_transactions.id,
          client_transactions.client_id as "clientId",
          client_transactions.bill_id as "billId",
          client_transactions.type,
          client_transactions.amount,
          client_transactions.description,
          client_transactions.date,
          client_transactions.running_balance as "runningBalance",
          client_transactions.payment_method as "paymentMethod",
          bills.payment_method as "billPaymentMethod",
          client_transactions.discount,
          client_transactions.processed_by as "processedBy"
        from client_transactions
        left join bills on bills.id = client_transactions.bill_id
        where client_transactions.client_id = any($1::int[])
          and client_transactions.type = any($2::text[])
          and (
            lower(coalesce(client_transactions.payment_method, '')) in ('deposit', 'bulk_deposit')
            or lower(coalesce(bills.payment_method, '')) in ('deposit', 'bulk_deposit')
            or lower(coalesce(client_transactions.description, '')) like 'deposit used%'
            or lower(coalesce(client_transactions.description, '')) like '%-> account credit%'
          )
        order by client_transactions.id
      `
    : `
        select
          client_transactions.id,
          client_transactions.client_id as "clientId",
          client_transactions.bill_id as "billId",
          client_transactions.type,
          client_transactions.amount,
          client_transactions.description,
          client_transactions.date,
          client_transactions.running_balance as "runningBalance",
          client_transactions.payment_method as "paymentMethod",
          bills.payment_method as "billPaymentMethod",
          client_transactions.discount,
          client_transactions.processed_by as "processedBy"
        from client_transactions
        left join bills on bills.id = client_transactions.bill_id
        where client_transactions.type = any($1::text[])
          and (
            lower(coalesce(client_transactions.payment_method, '')) in ('deposit', 'bulk_deposit')
            or lower(coalesce(bills.payment_method, '')) in ('deposit', 'bulk_deposit')
            or lower(coalesce(client_transactions.description, '')) like 'deposit used%'
            or lower(coalesce(client_transactions.description, '')) like '%-> account credit%'
          )
        order by client_transactions.id
      `;

  const result = clientIds.length
    ? await pool.query<LegacyCreditUsageRow>(query, [clientIds, [...LEGACY_CREDIT_USAGE_SOURCE_TYPES]])
    : await pool.query<LegacyCreditUsageRow>(query, [[...LEGACY_CREDIT_USAGE_SOURCE_TYPES]]);

  return result.rows.filter((row) => isLikelyLegacyCreditUsageRow(row));
}

function groupByClient<T extends { clientId: number | null }>(rows: T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>();

  for (const row of rows) {
    if (row.clientId == null) continue;
    const list = grouped.get(row.clientId) || [];
    list.push(row);
    grouped.set(row.clientId, list);
  }

  return grouped;
}

async function applyPlans(pool: pg.Pool, plans: ClientPlan[]) {
  await pool.query("BEGIN");

  try {
    for (const plan of plans) {
      await pool.query(
        `
          delete from client_transactions
          where client_id = $1
            and type = any($2::text[])
        `,
        [plan.client.id, [...CREDIT_TYPES]],
      );

      if (plan.legacySourceRows.length > 0) {
        await pool.query(
          `
            delete from client_transactions
            where id = any($1::int[])
          `,
          [plan.legacySourceRows.map((row) => row.id)],
        );
      }

      for (const row of plan.targetRows) {
        await pool.query(
          `
            insert into client_transactions (
              client_id,
              bill_id,
              type,
              amount,
              description,
              date,
              running_balance,
              payment_method,
              discount,
              processed_by
            ) values (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              $10
            )
          `,
          [
            row.clientId,
            row.billId,
            row.type,
            formatMoney(row.amount),
            row.description,
            row.date,
            row.runningBalance,
            row.paymentMethod || "deposit",
            formatMoney(row.discount),
            row.processedBy,
          ],
        );
      }
    }

    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

function printPlanSummary(plans: ClientPlan[], options: Options) {
  const affectedPlans = plans.filter(
    (plan) =>
      plan.existingRows.length > 0 ||
      plan.legacySourceRows.length > 0 ||
      plan.targetRows.length > 0 ||
      plan.currentDeposit > MONEY_EPSILON ||
      plan.warnings.length > 0,
  );
  const totalExisting = affectedPlans.reduce((sum, plan) => sum + plan.existingRows.length, 0);
  const totalLegacy = affectedPlans.reduce((sum, plan) => sum + plan.legacySourceRows.length, 0);
  const totalTarget = affectedPlans.reduce((sum, plan) => sum + plan.targetRows.length, 0);
  const totalWarnings = affectedPlans.reduce((sum, plan) => sum + plan.warnings.length, 0);

  console.log(
    `${options.apply ? "Applying" : "Dry run"} credit-management migration for ${affectedPlans.length} client(s).`,
  );
  console.log(`Existing credit rows: ${totalExisting}`);
  console.log(`Legacy payment rows converted: ${totalLegacy}`);
  console.log(`Rebuilt credit rows: ${totalTarget}`);
  console.log(`Warnings: ${totalWarnings}`);

  for (const plan of affectedPlans) {
    const addedCount = plan.targetRows.filter((row) => row.type === "deposit").length;
    const usedCount = plan.targetRows.length - addedCount;
    const accountNumber = String(plan.client.billNumber || "").trim();
    const header = accountNumber
      ? `Client #${plan.client.id} (${plan.client.name}) [${accountNumber}]`
      : `Client #${plan.client.id} (${plan.client.name})`;

    console.log("");
    console.log(header);
    console.log(
      `  deposit: ${formatMoney(plan.currentDeposit)} AED | ledger net: ${formatMoney(plan.ledgerNet)} AED | rows: ${plan.targetRows.length} (${addedCount} add / ${usedCount} use)`,
    );

    if (plan.legacySourceRows.length > 0) {
      console.log(`  legacy payment rows converted: ${plan.legacySourceRows.length}`);
    }

    if (Math.abs(plan.adjustment) > MONEY_EPSILON) {
      console.log(`  balancing row: ${formatMoney(plan.adjustment)} AED`);
    }

    if (options.verbose) {
      for (const row of plan.targetRows) {
        console.log(
          `    ${row.date.toISOString()} | ${row.type} | ${formatMoney(row.amount)} | ${row.description} | ${row.source}`,
        );
      }
    }

    for (const warning of plan.warnings) {
      console.log(`  warning: ${warning}`);
    }
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required before running this migration.");
  }

  const options = parseArgs(process.argv.slice(2));
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const clients = await fetchClients(pool, options.clientIds);
    if (clients.length === 0) {
      console.log("No matching clients found.");
      return;
    }

    const [bills, orders, billPayments, existingCreditRows, legacyCreditUsageRows] = await Promise.all([
      fetchBills(pool, options.clientIds),
      fetchOrders(pool, options.clientIds),
      fetchBillPayments(pool, options.clientIds),
      fetchCreditTransactions(pool, options.clientIds),
      fetchLegacyCreditUsageTransactions(pool, options.clientIds),
    ]);

    const billsByClient = groupByClient(bills);
    const ordersByClient = groupByClient(orders);
    const paymentsByClient = groupByClient(billPayments);
    const creditRowsByClient = groupByClient(existingCreditRows);
    const legacyRowsByClient = groupByClient(legacyCreditUsageRows);

    const plans = clients.map((client) =>
      buildClientPlan(
        client,
        billsByClient.get(client.id) || [],
        ordersByClient.get(client.id) || [],
        paymentsByClient.get(client.id) || [],
        creditRowsByClient.get(client.id) || [],
        legacyRowsByClient.get(client.id) || [],
      ),
    );

    printPlanSummary(plans, options);

    if (!options.apply) {
      console.log("");
      console.log("Dry run only. Re-run with --apply to write the rebuilt credit ledger.");
      return;
    }

    await applyPlans(pool, plans);

    console.log("");
    console.log("Credit-management migration completed successfully.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Credit-management migration failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
