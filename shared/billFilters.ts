import { z } from "zod";
import { isAfter, isSameDay, startOfMonth, startOfYear } from "date-fns";
import { normalizePhoneForComparison, stripPhoneToDigits } from "./phone";
import type { Bill, Client } from "./schema";

export const billTimePeriodSchema = z.enum([
  "today",
  "month",
  "year",
  "all",
  "date",
  "custom",
]);

export const billPaymentFilterSchema = z.enum(["all", "unpaid", "partial", "paid"]);

export const billFilterSummaryInputSchema = z.object({
  search: z.string().optional(),
  timePeriod: billTimePeriodSchema.default("all"),
  paymentFilter: billPaymentFilterSchema.default("all"),
  exactDate: z.string().optional(),
  customDateFrom: z.string().optional(),
  customDateTo: z.string().optional(),
  rangeApplied: z.preprocess((value) => {
    if (typeof value === "string") {
      if (value === "true") return true;
      if (value === "false") return false;
    }
    return value;
  }, z.boolean().optional()),
});

export const billFilterSummaryResponseSchema = z.object({
  matchingCount: z.number(),
  selectableCount: z.number(),
});

export type BillTimePeriod = z.infer<typeof billTimePeriodSchema>;
export type BillPaymentFilter = z.infer<typeof billPaymentFilterSchema>;
export type BillFilterSummaryInput = z.infer<typeof billFilterSummaryInputSchema>;
export type BillFilterSummaryResponse = z.infer<typeof billFilterSummaryResponseSchema>;

type BillFilterableBill = Pick<
  Bill,
  | "id"
  | "clientId"
  | "customerName"
  | "customerPhone"
  | "referenceNumber"
  | "description"
  | "billDate"
  | "amount"
  | "paidAmount"
  | "isPaid"
>;

type BillFilterableClient = Pick<
  Client,
  | "id"
  | "phone"
  | "address"
  | "billNumber"
  | "company"
>;

export function getNormalizedPhoneSearchTerm(value: string): string {
  const trimmedValue = String(value || "").trim();
  const digits = stripPhoneToDigits(trimmedValue);

  if (!digits) {
    return "";
  }

  const looksLikePhoneSearch =
    trimmedValue.startsWith("+") ||
    trimmedValue.startsWith("00") ||
    trimmedValue.startsWith("0") ||
    digits.length >= 5;

  if (!looksLikePhoneSearch) {
    return "";
  }

  return normalizePhoneForComparison(trimmedValue);
}

export function matchesNormalizedPhoneSearch(
  value: string | null | undefined,
  normalizedSearchTerm: string,
): boolean {
  if (!value || !normalizedSearchTerm) {
    return false;
  }

  return normalizePhoneForComparison(value).includes(normalizedSearchTerm);
}

function matchesTimePeriod(
  bill: BillFilterableBill,
  filters: BillFilterSummaryInput,
  now: Date,
): boolean {
  const timePeriod = filters.timePeriod ?? "all";

  if (timePeriod === "custom" && !filters.rangeApplied) {
    return false;
  }

  if (timePeriod === "date" && !filters.exactDate) {
    return false;
  }

  const billDate = new Date(bill.billDate);
  if (Number.isNaN(billDate.getTime())) {
    return false;
  }

  if (timePeriod === "date" && filters.exactDate) {
    const selectedDate = new Date(`${filters.exactDate}T00:00:00`);
    return !Number.isNaN(selectedDate.getTime()) && isSameDay(billDate, selectedDate);
  }

  if (timePeriod === "custom" && filters.customDateFrom) {
    const fromDate = new Date(`${filters.customDateFrom}T00:00:00`);
    const toDate = filters.customDateTo
      ? new Date(`${filters.customDateTo}T23:59:59`)
      : new Date(`${filters.customDateFrom}T23:59:59`);

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return false;
    }

    return billDate >= fromDate && billDate <= toDate;
  }

  if (timePeriod === "today") {
    return isSameDay(billDate, now);
  }

  if (timePeriod === "month") {
    const monthStart = startOfMonth(now);
    return isAfter(billDate, monthStart) || isSameDay(billDate, monthStart);
  }

  if (timePeriod === "year") {
    const yearStart = startOfYear(now);
    return isAfter(billDate, yearStart) || isSameDay(billDate, yearStart);
  }

  return true;
}

function matchesPaymentFilter(
  bill: BillFilterableBill,
  paymentFilter: BillPaymentFilter,
): boolean {
  const epsilon = 0.01;
  const amount = parseFloat(String(bill.amount || "0"));
  const paidAmount = parseFloat(String(bill.paidAmount || "0"));
  const normalizedAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const normalizedPaidAmount = Number.isFinite(paidAmount) ? Math.max(0, paidAmount) : 0;
  const isPaid =
    Boolean(bill.isPaid) ||
    (normalizedAmount > epsilon && normalizedPaidAmount >= normalizedAmount - epsilon);
  const isPartial =
    !isPaid &&
    normalizedPaidAmount > epsilon &&
    (normalizedAmount <= epsilon || normalizedPaidAmount < normalizedAmount - epsilon);

  if (paymentFilter === "unpaid") {
    return !isPaid && !isPartial;
  }

  if (paymentFilter === "partial") {
    return isPartial;
  }

  if (paymentFilter === "paid") {
    return isPaid;
  }

  return true;
}

function matchesSearchFilter<TClient extends BillFilterableClient>(
  bill: BillFilterableBill,
  clientById: ReadonlyMap<number, TClient>,
  search: string | undefined,
): boolean {
  if (!search) {
    return true;
  }

  const term = search.toLowerCase().replace(/^#/, "");
  const normalizedPhoneTerm = getNormalizedPhoneSearchTerm(search);

  if (bill.customerName?.toLowerCase().includes(term)) return true;
  if (String(bill.id) === term || String(bill.id).startsWith(term)) return true;
  if (bill.customerPhone?.toLowerCase().includes(term)) return true;
  if (matchesNormalizedPhoneSearch(bill.customerPhone, normalizedPhoneTerm)) return true;
  if (bill.referenceNumber?.toLowerCase().includes(term)) return true;
  if (bill.description?.toLowerCase().includes(term)) return true;

  const client = bill.clientId ? clientById.get(bill.clientId) : undefined;
  if (!client) {
    return false;
  }

  if (client.phone?.toLowerCase().includes(term)) return true;
  if (matchesNormalizedPhoneSearch(client.phone, normalizedPhoneTerm)) return true;
  if (client.address?.toLowerCase().includes(term)) return true;
  if (client.billNumber?.toLowerCase().includes(term)) return true;
  if (client.company?.toLowerCase().includes(term)) return true;

  return false;
}

export function filterBills<
  TBill extends BillFilterableBill,
  TClient extends BillFilterableClient,
>(
  bills: readonly TBill[],
  clientById: ReadonlyMap<number, TClient>,
  filters: BillFilterSummaryInput,
  now: Date = new Date(),
): TBill[] {
  return bills
    .filter((bill) => matchesTimePeriod(bill, filters, now))
    .filter((bill) => matchesPaymentFilter(bill, filters.paymentFilter ?? "all"))
    .filter((bill) => matchesSearchFilter(bill, clientById, filters.search))
    .slice()
    .sort((left, right) => {
      const leftTime = new Date(left.billDate).getTime();
      const rightTime = new Date(right.billDate).getTime();
      return rightTime - leftTime;
    });
}

export function buildBillFilterSummary<
  TBill extends BillFilterableBill,
  TClient extends BillFilterableClient,
>(
  bills: readonly TBill[],
  clientById: ReadonlyMap<number, TClient>,
  filters: BillFilterSummaryInput,
  now: Date = new Date(),
): BillFilterSummaryResponse {
  const matchingBills = filterBills(bills, clientById, filters, now);

  return {
    matchingCount: matchingBills.length,
    selectableCount: matchingBills.filter((bill) => {
      const amount = parseFloat(String(bill.amount || "0"));
      const paidAmount = parseFloat(String(bill.paidAmount || "0"));
      const normalizedAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
      const normalizedPaidAmount = Number.isFinite(paidAmount) ? Math.max(0, paidAmount) : 0;
      return normalizedAmount <= 0.01
        ? !bill.isPaid
        : normalizedAmount - normalizedPaidAmount > 0.01;
    }).length,
  };
}
