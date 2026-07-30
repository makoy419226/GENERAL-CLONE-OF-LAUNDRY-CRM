import { useState, useRef, useMemo, useEffect, useCallback, useDeferredValue, type MouseEvent as ReactMouseEvent } from "react";
import { DateTimeRangePicker } from "@/components/ui/DateTimeRangePicker";
import { useLocation, useSearch } from "wouter";
import { TopBar } from "@/components/TopBar";
import {
  useBills,
  useDeleteBill,
  type BillWithPaymentRecorder,
} from "@/hooks/use-bills";
import { useClients } from "@/hooks/use-clients";
import { useCreateProduct } from "@/hooks/use-products";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2,
  FileText,
  Trash2,
  Plus,
  Minus,
  Receipt,
  Printer,
  Package,
  User,
  PlusCircle,
  AlertCircle,
  Key,
  DollarSign,
  FolderOpen,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Phone,
  MapPin,
  Building2,
  RotateCcw,
  Edit,
  History,
  X,
  Banknote,
  CreditCard,
  Wallet,
  Search,
  CheckCircle2,
  BarChart3,
  SlidersHorizontal,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { apiRequest, extractApiErrorMessage, queryClient } from "@/lib/queryClient";
import { BillItemsPopover } from "@/components/BillItemsPopover";
import {
  InvoiceItemDescription,
  getInvoiceItemDisplayDetails,
} from "@/components/InvoiceItemDescription";
import {
  escapeHtml,
  formatCompanyPhoneLine,
  getCompanyAddressLines,
  getPublicTrackingUrl,
  getWorkspaceLogoUrl,
  useCompanyContactInfo,
} from "@/lib/companyContact";
import { isEditableKeyboardShortcutTarget } from "@/lib/keyboardShortcuts";
import { filterBills } from "@shared/billFilters";
import { normalizePhoneForComparison } from "@shared/phone";
import { normalizeStoredProductCategoryName } from "@shared/productCategories";
import type { Product, Client, Bill, Order, PackingWorker, ClientTransaction } from "@shared/schema";
import logoImage from "@/assets/images/lwl-logo.png";

const BILLS_INITIAL_LOAD_COUNT = 50;
const BILLS_LOAD_MORE_COUNT = 30;
const BILLS_LOAD_MORE_THRESHOLD_PX = 160;
const UNKNOWN_PAYMENT_DATE_KEY = "__unknown_payment_date__";

type DiscountPinPreview = {
  name: string;
  roleLabel: string;
};

function formatDiscountPinPreviewRole(role: unknown): string {
  const normalizedRole = String(role || "staff").trim().toLowerCase();
  const roleLabels: Record<string, string> = {
    admin: "Admin",
    counter: "Counter",
    reception: "Counter",
    section: "Section",
    driver: "Driver",
    staff: "Staff",
  };

  return roleLabels[normalizedRole] || normalizedRole.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getDiscountPinPreview(data: any): DiscountPinPreview | null {
  const rawName = data?.member?.name || data?.worker?.name || data?.user?.name;
  if (typeof rawName !== "string" || !rawName.trim()) return null;

  const rawRole =
    data?.member?.roleType ||
    data?.member?.role ||
    data?.worker?.role ||
    data?.worker?.roleType ||
    data?.user?.role ||
    data?.user?.type;

  return {
    name: rawName.trim(),
    roleLabel: formatDiscountPinPreviewRole(rawRole),
  };
}

function normalizeDisplayPhone(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text || text === "-") return "";

  const digits = text.replace(/\D/g, "");
  if (digits && /^0+$/.test(digits)) return "";

  return text;
}

function getDisplayPhone(...values: unknown[]): string {
  for (const value of values) {
    const phone = normalizeDisplayPhone(value);
    if (phone) return phone;
  }

  return "";
}

const EMPTY_PAID_BY_DATE_GROUPS_DATA = {
  totalPaymentEntries: 0,
  groups: [] as PaidByDateGroup[],
};

const EMPTY_PAID_BY_DATE_VISIBLE_DATA = {
  groups: [] as VisiblePaidByDateGroup[],
  visibleEntryCount: 0,
};

type PdfDoc = InstanceType<typeof import("jspdf").default>;
type PdfRuntime = {
  html2pdf: any;
  jsPDF: typeof import("jspdf").default;
  autoTable: typeof import("jspdf-autotable").default;
};

let pdfRuntimePromise: Promise<PdfRuntime> | null = null;

const loadPdfRuntime = async (): Promise<PdfRuntime> => {
  if (!pdfRuntimePromise) {
    pdfRuntimePromise = Promise.all([
      import("html2pdf.js"),
      import("jspdf"),
      import("jspdf-autotable"),
    ]).then(([html2pdfModule, jsPdfModule, autoTableModule]) => ({
      html2pdf: html2pdfModule.default,
      jsPDF: jsPdfModule.default,
      autoTable: autoTableModule.default,
    }));
  }

  return pdfRuntimePromise;
};

type CompanyPaymentTransactionRow = ClientTransaction & {
  clientName: string;
  companyName: string;
  accountNumber: string | null;
};

type BillPaymentRow = {
  id: number;
  billId: number;
  clientId: number;
  amount: string;
  paymentDate: string;
  paymentMethod?: string | null;
  notes?: string | null;
};

type BillsTabValue =
  | "bills"
  | "paid-by-date"
  | "by-client"
  | "by-company"
  | "by-broker";

type BillsSearchFieldKey =
  | "accountNumber"
  | "orderNumber"
  | "billAmount"
  | "billNumber"
  | "nameAddress"
  | "mobileNumber"
  | "companyName";

type BillsSearchFilters = Record<BillsSearchFieldKey, string>;

const BILLS_SEARCH_FIELD_KEYS: BillsSearchFieldKey[] = [
  "accountNumber",
  "orderNumber",
  "billAmount",
  "billNumber",
  "nameAddress",
  "mobileNumber",
  "companyName",
];

const EMPTY_BILLS_SEARCH_FILTERS: BillsSearchFilters = {
  accountNumber: "",
  orderNumber: "",
  billAmount: "",
  billNumber: "",
  nameAddress: "",
  mobileNumber: "",
  companyName: "",
};

const BILLS_SEARCH_FIELD_CONFIGS: Array<{
  key: BillsSearchFieldKey;
  label: string;
  placeholder: string;
  inputMode?: "decimal" | "numeric" | "tel";
  testId: string;
}> = [
  {
    key: "accountNumber",
    label: "Account Number",
    placeholder: "Search account #",
    testId: "input-search-bills-account-number",
  },
  {
    key: "orderNumber",
    label: "Order Number",
    placeholder: "Search order #",
    inputMode: "numeric",
    testId: "input-search-bills-order-number",
  },
  {
    key: "billAmount",
    label: "Bill Amount",
    placeholder: "Search amount",
    inputMode: "decimal",
    testId: "input-search-bills-bill-amount",
  },
  {
    key: "billNumber",
    label: "Bill Number",
    placeholder: "Search bill #",
    inputMode: "numeric",
    testId: "input-search-bills-bill-number",
  },
  {
    key: "nameAddress",
    label: "Name / Address",
    placeholder: "Search customer or address",
    testId: "input-search-bills-name-address",
  },
  {
    key: "mobileNumber",
    label: "Mobile Number",
    placeholder: "Search mobile #",
    inputMode: "tel",
    testId: "input-search-bills-mobile-number",
  },
  {
    key: "companyName",
    label: "Company Name",
    placeholder: "Search company",
    testId: "input-search-bills-company-name",
  },
];

function hasBillsSearchFilters(filters: BillsSearchFilters): boolean {
  return BILLS_SEARCH_FIELD_KEYS.some((key) => filters[key].trim().length > 0);
}

function areBillsSearchFiltersEqual(
  first: BillsSearchFilters,
  second: BillsSearchFilters,
): boolean {
  return BILLS_SEARCH_FIELD_KEYS.every((key) => first[key] === second[key]);
}

function normalizeBillsReferenceSearch(value: string): string {
  return value.trim().replace(/^#/, "").toLowerCase();
}

function normalizeBillsExactBillNumber(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^#/, "")
    .replace(/^bill[-\s#]*/i, "")
    .toLowerCase();
}

function normalizeBillsExactOrderNumber(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^#/, "")
    .replace(/^ord[-\s#]*/i, "")
    .toLowerCase();
}

function matchesBillsExactBillNumber(value: unknown, normalizedSearch: string): boolean {
  return !!normalizedSearch && normalizeBillsExactBillNumber(value) === normalizedSearch;
}

function matchesBillsExactOrderNumber(value: unknown, normalizedSearch: string): boolean {
  if (!normalizedSearch) return false;

  const normalizedValue = normalizeBillsExactOrderNumber(value);
  if (normalizedValue === normalizedSearch) return true;

  const orderReferences = String(value ?? "").match(/ORD[-\s#]*[A-Z0-9-]+/gi) || [];
  return orderReferences.some(
    (reference) => normalizeBillsExactOrderNumber(reference) === normalizedSearch,
  );
}

function normalizeBillsMoneySearch(value: string): string {
  return value
    .trim()
    .replace(/\baed\b/gi, "")
    .replace(/,/g, "")
    .trim()
    .toLowerCase();
}

function matchesBillsMoneySearch(amount: number, normalizedSearch: string): boolean {
  if (!normalizedSearch) return true;

  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const numericSearch = Number(normalizedSearch);

  if (Number.isFinite(numericSearch) && Math.abs(safeAmount - numericSearch) < 0.005) {
    return true;
  }

  return [
    safeAmount.toFixed(2),
    String(Number(safeAmount.toFixed(2))),
  ].some((candidate) => candidate.toLowerCase().includes(normalizedSearch));
}

function normalizeTransferClientSearchValue(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

function compactTransferClientSearchValue(value?: string | null): string {
  return normalizeTransferClientSearchValue(value).replace(/[^a-z0-9]/g, "");
}

function matchesTransferClientSearchValue(
  value: string | null | undefined,
  search: string,
  compactSearch: string,
): boolean {
  const normalizedValue = normalizeTransferClientSearchValue(value);
  if (!normalizedValue) {
    return false;
  }

  if (normalizedValue.includes(search)) {
    return true;
  }

  return (
    compactSearch.length > 0 &&
    compactTransferClientSearchValue(normalizedValue).includes(compactSearch)
  );
}

function getBillsSearchFiltersFromLegacySearch(search: string): BillsSearchFilters {
  const legacySearch = String(search || "").trim();
  if (!legacySearch) {
    return { ...EMPTY_BILLS_SEARCH_FILTERS };
  }

  const normalizedPhone = normalizePhoneForComparison(legacySearch);
  const normalizedReference = legacySearch.replace(/^#/, "").trim();

  if (/^acc-/i.test(normalizedReference)) {
    return {
      ...EMPTY_BILLS_SEARCH_FILTERS,
      accountNumber: normalizedReference,
    };
  }

  if (/^ord-/i.test(normalizedReference)) {
    return {
      ...EMPTY_BILLS_SEARCH_FILTERS,
      orderNumber: normalizedReference,
    };
  }

  if (normalizedPhone.length >= 7) {
    return {
      ...EMPTY_BILLS_SEARCH_FILTERS,
      mobileNumber: legacySearch,
    };
  }

  if (/^\d+$/.test(normalizedReference)) {
    return normalizedReference.length <= 5
      ? {
          ...EMPTY_BILLS_SEARCH_FILTERS,
          billNumber: normalizedReference,
        }
      : {
          ...EMPTY_BILLS_SEARCH_FILTERS,
          orderNumber: normalizedReference,
        };
  }

  return {
    ...EMPTY_BILLS_SEARCH_FILTERS,
    nameAddress: legacySearch,
  };
}

type PaidByDateBillEntry = {
  bill: Bill;
  totalPaid: number;
  latestPaymentDate: string;
  latestPaymentTimestamp: number;
  billTimestamp: number;
};

type PaidByDateGroup = {
  dateKey: string;
  billEntries: PaidByDateBillEntry[];
  totalBillEntries: number;
  totalPaid: number;
};

type VisiblePaidByDateGroup = PaidByDateGroup & {
  visibleBillEntries: PaidByDateBillEntry[];
  isPartiallyVisible: boolean;
};

type BillStatusMeta = {
  label: "PAID" | "PARTIAL" | "UNPAID";
  tableRowClass: string;
  badgeClass: string;
  mobileCardClass: string;
  accentClass: string;
  summaryClass: string;
  historyBadgeLabel: string | null;
  historyBadgeClass: string;
  historyDate: string | null;
};

type SelectedBillsPaymentSummary = {
  billIds: number[];
  billCount: number;
  clientIds: number[];
  clientCount: number;
  singleClientId: number | null;
  totalWorkReceived: number;
  totalDiscount: number;
  totalAmount: number;
  totalPaid: number;
  totalRemaining: number;
  hasBillsWithoutClient: boolean;
  sharedPaymentLabel: string | null;
};

type SelectedBillsRevertSummary = {
  billIds: number[];
  billCount: number;
  clientIds: number[];
  clientCount: number;
  totalPaid: number;
};

type SelectedBillsFolderKind = "payment" | "revert";

type MobileBillsControlDialog = "overview" | "search" | "filters" | "folders" | null;

type BillSortOption =
  | "newest"
  | "oldest"
  | "highest-unpaid"
  | "lowest-unpaid";

const buildSplitPaymentGroupId = () =>
  `SP-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;

const getSplitPaymentTag = (groupId: string) => `[SPLIT:${groupId}]`;

const appendSplitPaymentTag = (notes: string | undefined, groupId: string) => {
  const trimmedNotes = String(notes || "").trim();
  const tag = getSplitPaymentTag(groupId);
  return trimmedNotes ? `${trimmedNotes} ${tag}` : tag;
};

const getSharedPaymentTag = (billCount: number, clientCount: number) =>
  `[SHARED:${billCount}:${clientCount}]`;

const appendSharedPaymentTag = (
  notes: string | undefined,
  billCount: number,
  clientCount: number,
) => {
  if (billCount <= 1 || clientCount <= 1) {
    return String(notes || "").trim();
  }

  const trimmedNotes = String(notes || "").trim();
  const tag = getSharedPaymentTag(billCount, clientCount);
  return trimmedNotes ? `${trimmedNotes} ${tag}` : tag;
};

const buildSharedBillsPaymentLabel = (billCount: number, clientCount: number) => {
  if (billCount <= 1 || clientCount <= 1) {
    return null;
  }

  return `${billCount} separate client bill shared payment`;
};

function formatPaymentMethodLabel(method?: string | null): string {
  const normalized = String(method || "").trim();
  if (!normalized) return "-";

  const parts = normalized
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    return parts.map((part) => formatPaymentMethodLabel(part)).join(" + ");
  }

  switch (normalized.toLowerCase()) {
    case "cash":
      return "Cash";
    case "card":
      return "Card";
    case "transfer":
      return "Bank Transfer";
    case "bank":
      return "Bank Transfer";
    case "deposit":
      return "Account Credit";
    default:
      return normalized.toUpperCase();
  }
}

function getEditablePaymentMethodValue(method?: string | null): string | null {
  const normalized = String(method || "").trim().toLowerCase();
  if (!normalized || normalized.includes("+")) {
    return null;
  }

  if (normalized === "bank") {
    return "transfer";
  }

  if (["cash", "card", "transfer", "deposit"].includes(normalized)) {
    return normalized;
  }

  return null;
}

function formatSplitPaymentMethodLabel(method?: string | null): string {
  if (String(method || "").trim().toLowerCase() === "deposit") {
    return "Account Credit";
  }
  return formatPaymentMethodLabel(method);
}

function getBillPaymentEventGroupKey(payment: BillPaymentRow): string {
  const splitTagMatch = String(payment.notes || "").match(/\[SPLIT:([^\]]+)\]/i);
  if (splitTagMatch?.[1]) {
    return `split:${splitTagMatch[1].trim().toUpperCase()}`;
  }

  return `payment:${payment.id}`;
}

function formatClientHistoryPaymentMethodLabel(method?: string | null): string {
  const normalized = String(method || "").trim();
  if (!normalized) return "-";

  const parts = normalized
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    return parts.map((part) => formatClientHistoryPaymentMethodLabel(part)).join(" + ");
  }

  switch (normalized.toLowerCase()) {
    case "deposit":
      return "Account Credit";
    case "cash":
      return "Cash";
    case "card":
      return "Card";
    case "bank":
    case "transfer":
      return "Bank Transfer";
    default:
      return normalized.toUpperCase();
  }
}

const CLIENT_HISTORY_EPSILON = 0.01;

const isAccountCreditDeductionType = (type?: string | null) =>
  type === "deposit_used" || type === "bulk_deposit_used" || type === "deposit_deduction";

const extractTaggedHistoryValue = (value: string | null | undefined, tagName: string) => {
  if (!value) return null;
  const match = String(value).match(new RegExp(`\\[${tagName}:([^\\]]+)\\]`, "i"));
  return match?.[1] ? match[1] : null;
};

const extractBulkHistoryGroup = (value?: string | null) => extractTaggedHistoryValue(value, "bulk");

const extractSplitHistoryGroup = (value?: string | null) => extractTaggedHistoryValue(value, "SPLIT");

const collectHistoryBillIds = (value?: string | null) => {
  if (!value) return [];
  const matches = String(value).match(/#(\d+)/g) || [];
  const ids = matches
    .map((token) => Number(token.replace("#", "")))
    .filter((id) => Number.isFinite(id) && id > 0);
  return Array.from(new Set(ids));
};

const getSingleBillBulkHistoryBillId = (transaction: ClientTransaction) => {
  if (transaction.type !== "bulk_payment" && transaction.type !== "bulk_deposit_used") {
    return null;
  }

  const billIds = collectHistoryBillIds(transaction.description);
  return billIds.length === 1 ? billIds[0] : null;
};

const getSingleBillBulkHistoryDescription = (transaction: ClientTransaction) => {
  const billId = getSingleBillBulkHistoryBillId(transaction);
  if (!billId) return null;

  const discountMatch = String(transaction.description || "").match(/Discount:\s*([0-9.]+)\s*AED/i);
  const discountAmount = parseFloat(discountMatch?.[1] || "0");
  const baseLabel =
    transaction.type === "bulk_deposit_used"
      ? `Deposit used for Bill #${billId}`
      : `Payment for Bill #${billId}`;

  if (Number.isFinite(discountAmount) && discountAmount > 0.009) {
    return `${baseLabel} | Discount: ${discountAmount.toFixed(2)} AED`;
  }

  return baseLabel;
};

const normalizeHistoryDescription = (value?: string | null) => {
  const cleaned = String(value || "")
    .replace(/\s*\[(?:bulk|SPLIT):[^\]]+\]/gi, "")
    .replace(/\s*\|\s*\|\s*/g, " | ")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*\|\s*/g, "")
    .replace(/\s*\|\s*$/g, "")
    .trim();

  return cleaned || "No description";
};

const parseTransactionMoney = (value?: string | null) => {
  const parsed = parseFloat(String(value || "0"));
  return Number.isFinite(parsed) ? parsed : 0;
};

const compareClientTransactionsAsc = (left: ClientTransaction, right: ClientTransaction) => {
  const timeDelta = new Date(left.date).getTime() - new Date(right.date).getTime();
  if (timeDelta !== 0) {
    return timeDelta;
  }
  return left.id - right.id;
};

type VisibleClientHistoryTransaction = ClientTransaction & {
  displayDescription: string;
  bulkGroup: string | null;
  splitGroup: string | null;
};

const buildVisibleClientHistoryTransactions = (
  transactions?: ClientTransaction[] | null,
): VisibleClientHistoryTransaction[] => {
  if (!transactions || transactions.length === 0) {
    return [];
  }

  const sortedTransactions = [...transactions].sort(compareClientTransactionsAsc);

  const shouldHideBulkDepositSummary = (transaction: ClientTransaction) => {
    if (transaction.type !== "bulk_deposit_used") {
      return false;
    }

    const summaryBillIds = collectHistoryBillIds(transaction.description);
    if (summaryBillIds.length === 0) {
      return false;
    }

    const matchingDepositRows = sortedTransactions.filter((candidate) => {
      if (candidate.type !== "deposit_used" || !candidate.billId) {
        return false;
      }
      return summaryBillIds.includes(candidate.billId);
    });

    if (matchingDepositRows.length === 0) {
      return false;
    }

    const matchedBillIds = new Set(
      matchingDepositRows
        .map((candidate) => candidate.billId)
        .filter((billId): billId is number => Number.isFinite(billId)),
    );

    if (summaryBillIds.some((billId) => !matchedBillIds.has(billId))) {
      return false;
    }

    const summaryAmount = parseTransactionMoney(transaction.amount);
    const depositUsedAmount = matchingDepositRows.reduce(
      (sum, candidate) => sum + parseTransactionMoney(candidate.amount),
      0,
    );

    return Math.abs(summaryAmount - depositUsedAmount) <= CLIENT_HISTORY_EPSILON;
  };

  return sortedTransactions
    .filter((transaction) => !shouldHideBulkDepositSummary(transaction))
    .map((transaction) => ({
      ...transaction,
      displayDescription: normalizeHistoryDescription(
        getSingleBillBulkHistoryDescription(transaction) || transaction.description,
      ),
      bulkGroup: extractBulkHistoryGroup(transaction.description),
      splitGroup: extractSplitHistoryGroup(transaction.description),
    }));
};

function getPdfFileName(documentTitle?: string) {
  const baseName = (documentTitle || "Document").trim() || "Document";
  return baseName.toLowerCase().endsWith(".pdf") ? baseName : `${baseName}.pdf`;
}

function normalizeHtmlForPdf(html: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const styleText = Array.from(parsed.head.querySelectorAll("style"))
    .map((styleNode) => styleNode.textContent || "")
    .join("\n");
  const bodyHtml = parsed.body.innerHTML || html;
  return `${styleText ? `<style>${styleText}</style>` : ""}${bodyHtml}`;
}

function createPdfMount(widthPx: number) {
  const mount = document.createElement("div");
  mount.setAttribute("data-pdf-export", "true");
  mount.style.position = "fixed";
  mount.style.left = "0";
  mount.style.top = "0";
  mount.style.width = `${widthPx}px`;
  mount.style.background = "#ffffff";
  mount.style.pointerEvents = "none";
  mount.style.opacity = "0.01";
  mount.style.zIndex = "2147483647";
  mount.style.padding = "0";
  mount.style.margin = "0";
  mount.style.boxSizing = "border-box";
  mount.style.overflow = "hidden";
  document.body.appendChild(mount);
  return mount;
}

async function waitForPdfAssets(root: HTMLElement) {
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));

  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map((image) => {
      if (image.complete) return Promise.resolve();

      return new Promise<void>((resolve) => {
        const timeoutId = window.setTimeout(resolve, 1500);
        const done = () => {
          window.clearTimeout(timeoutId);
          resolve();
        };

        image.addEventListener("load", done, { once: true });
        image.addEventListener("error", done, { once: true });
      });
    }),
  );

  if (document.fonts?.ready) {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => window.setTimeout(resolve, 1000)),
      ]);
    } catch {
      // Keep PDF export moving even if fonts report readiness issues.
    }
  }

  await new Promise((resolve) => window.setTimeout(resolve, 80));
}

async function saveHtmlDocumentAsPdf(html: string, documentTitle?: string) {
  const { html2pdf } = await loadPdfRuntime();
  const mount = createPdfMount(1120);
  mount.innerHTML = normalizeHtmlForPdf(html);

  try {
    await waitForPdfAssets(mount);
    await html2pdf()
      .set({
        margin: 0,
        filename: getPdfFileName(documentTitle),
        image: { type: "jpeg" as const, quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
          windowWidth: 1120,
        },
        pagebreak: { mode: ["css", "legacy"] },
        jsPDF: {
          unit: "mm",
          format: "a4" as const,
          orientation: "portrait" as const,
        },
      } as any)
      .from(mount)
      .save();
  } finally {
    mount.remove();
  }
}

async function saveElementAsPdf(element: HTMLElement, documentTitle?: string) {
  const { html2pdf } = await loadPdfRuntime();
  const exportWidth = Math.max(element.scrollWidth, 900);
  const mount = createPdfMount(exportWidth);
  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.background = "#ffffff";
  clone.style.boxSizing = "border-box";
  mount.appendChild(clone);

  try {
    await waitForPdfAssets(mount);
    await html2pdf()
      .set({
        margin: 10,
        filename: getPdfFileName(documentTitle),
        image: { type: "jpeg" as const, quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
          windowWidth: exportWidth,
        },
        pagebreak: { mode: ["css", "legacy"] },
        jsPDF: {
          unit: "mm",
          format: "a4" as const,
          orientation: "portrait" as const,
        },
      } as any)
      .from(mount)
      .save();
  } finally {
    mount.remove();
  }
}

function extractBillsFromCompanyPaymentDescription(description?: string | null): string {
  if (!description) return "-";
  const match = description.match(/Bills:\s*(.*?)\s*-\s*Discount:/i);
  if (match && match[1]) return match[1].trim();
  return description;
}

function parseSqmDescriptionPart(
  part: string,
  products?: Product[],
): { name: string; qty: number; sqm: number; price: number; total: number; note: string | null; isAdminEdited: boolean } | null {
  const trailingNoteMatch = part.match(/\s*\((custom|min\s*50|admin\s*edited)\)\s*$/i);
  const trailingNote = trailingNoteMatch ? trailingNoteMatch[1].trim().toLowerCase() : null;
  const normalizedPart = trailingNoteMatch ? part.replace(/\s*\((custom|min\s*50|admin\s*edited)\)\s*$/i, "").trim() : part;

  const sqmMatch = normalizedPart.match(
    /^(?:(\d+)x\s+)?([\d.]+)\s*sqm\s+(.+?)(?:\s*@\s*([\d.]+)\s*AED|\s+Total\s+([\d.]+)\s*AED|\s*\(([\d.]+)\s*AED\))?$/i,
  );
  if (!sqmMatch) return null;

  const qty = sqmMatch[1] ? parseInt(sqmMatch[1], 10) : 1;
  const sqm = parseFloat(sqmMatch[2]);
  const rawName = sqmMatch[3].trim();
  const embeddedPrice = sqmMatch[4] ? parseFloat(sqmMatch[4]) : NaN;
  const embeddedTotal = sqmMatch[5]
    ? parseFloat(sqmMatch[5])
    : sqmMatch[6]
      ? parseFloat(sqmMatch[6])
      : NaN;
  const cleanName = rawName.replace(/\s*\(\s*[\d.]+\s*AED\s*\)\s*$/i, "").trim();
  const productLookupName = cleanName
    .replace(/\s*\(per\s*SQ\s*MTR\)\s*$/i, "")
    .replace(/\s*\[[^\]]*\]\s*/g, "")
    .trim();
  const sqmProduct = products?.find(
    (product) => product.name.toLowerCase() === productLookupName.toLowerCase(),
  );

  let linePrice = Number.isFinite(embeddedPrice) ? embeddedPrice : NaN;
  if (!Number.isFinite(linePrice) && Number.isFinite(embeddedTotal)) {
    linePrice = embeddedTotal;
  }
  if (!Number.isFinite(linePrice) && sqmProduct) {
    const fallbackRate = parseFloat(sqmProduct.sqmPrice || sqmProduct.price || "0");
    if (Number.isFinite(fallbackRate)) {
      linePrice = sqm * fallbackRate;
      if (sqm < 5) {
        linePrice = Math.max(linePrice, 50);
      }
    }
  }

  const sqmDisplayName = cleanName.replace(/\s*\(per\s*SQ\s*MTR\)\s*$/i, "").trim();
  const baseName = trailingNote === "admin edited"
    ? sqmDisplayName
    : /\(per\s*SQ\s*MTR\)/i.test(cleanName)
      ? cleanName
      : `${cleanName} (per SQ MTR)`;

  return {
    name: `${sqm} sqm ${baseName}`.trim(),
    qty,
    sqm,
    price: Number.isFinite(linePrice) ? linePrice : 0,
    total: Number.isFinite(linePrice) ? qty * linePrice : 0,
    note: trailingNote,
    isAdminEdited: trailingNote === "admin edited",
  };
}

function stripEmbeddedItemPriceText(name: string): string {
  return String(name || "")
    .replace(/\s*\(base\s*[\d.]+\s*AED\)/gi, "")
    .replace(/\s*@\s*[\d.]+\s*AED(?:\s*\((custom|min\s*50|admin\s*edited)\))?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseDescriptionItems(description: string, products?: Product[]): { name: string; qty: number; price: number; total: number }[] {
  if (!description) return [];
  
  const orderMatch = description.match(/Order #[A-Z0-9-]+:\s*/i);
  const itemsText = orderMatch ? description.replace(orderMatch[0], '') : description;
  
  const itemParts = itemsText.split(',').map(s => s.trim()).filter(Boolean);
  
  return itemParts.map(part => {
    const sqmItem = parseSqmDescriptionPart(part, products);
    if (sqmItem) {
      return { name: sqmItem.name, qty: sqmItem.qty, price: sqmItem.price, total: sqmItem.total };
    }

    const match = part.match(/^(\d+)x\s+(.+)$/i);
    if (match) {
      const qty = parseInt(match[1]);
      const name = match[2].trim();
      const displayName = stripEmbeddedItemPriceText(name);
      
      const embeddedPriceMatch = name.match(/@\s*([\d.]+)\s*AED/i);
      if (embeddedPriceMatch) {
        const price = parseFloat(embeddedPriceMatch[1]);
        return { name: displayName, qty, price, total: qty * price };
      }
      
      const serviceMatch = name.match(/\[(N|DC|I)\]/i);
      const serviceType = serviceMatch ? serviceMatch[1].toUpperCase() : 'N';
      const sizeMatch = name.match(/\((Small|Medium|Large)\)/i);
      const size = sizeMatch ? sizeMatch[1].toLowerCase() : null;
      
      const baseName = name.replace(/\s*\([^)]*\)\s*$/g, '').replace(/\s*\[[^\]]*\]\s*/g, '').trim();
      let product = products?.find(p => p.name.toLowerCase() === baseName.toLowerCase());
      if (!product) {
        const nameWithoutAll = name.replace(/\s*\(Small\)|\(Medium\)|\(Large\)|\(folding\)|\(hanger\)/gi, '').replace(/\s*\[[^\]]*\]/g, '').trim();
        product = products?.find(p => p.name.toLowerCase() === nameWithoutAll.toLowerCase());
      }
      if (!product) {
        product = products?.find(p => p.name.toLowerCase() === name.toLowerCase());
      }
      
      let price = 0;
      if (product) {
        if (size === 'small' && product.smallPrice) price = parseFloat(product.smallPrice);
        else if (size === 'medium' && product.mediumPrice) price = parseFloat(product.mediumPrice);
        else if (size === 'large' && product.largePrice) price = parseFloat(product.largePrice);
        else if (serviceType === 'DC' && product.dryCleanPrice) price = parseFloat(product.dryCleanPrice);
        else if (serviceType === 'I' && product.ironOnlyPrice) price = parseFloat(product.ironOnlyPrice);
        else price = parseFloat(product.price || '0');
      }
      return { name: displayName, qty, price, total: qty * price };
    }
    return { name: stripEmbeddedItemPriceText(part), qty: 1, price: 0, total: 0 };
  });
}

export default function Bills() {
  const isMobile = useIsMobile();
  const storedUser = localStorage.getItem("user");
  const userInfo = storedUser ? JSON.parse(storedUser) : null;
  const userRole = userInfo?.role || "cashier";
  
  if (userRole === "section") {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Card className="max-w-md w-full mx-4">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
              <AlertCircle className="w-8 h-8 text-destructive" />
            </div>
            <CardTitle className="text-xl text-destructive">Access Restricted</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-muted-foreground">
              User is restricted in this section. Please contact your administrator for access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const searchParams = useSearch();
  const [, setLocation] = useLocation();
  const urlSearch = new URLSearchParams(searchParams).get("search") || "";
  const urlHighlightBill = new URLSearchParams(searchParams).get("highlightBill");
  const urlHighlightClient = new URLSearchParams(searchParams).get("highlightClient");
  const urlTab = new URLSearchParams(searchParams).get("tab");
  const urlBillId = new URLSearchParams(searchParams).get("billId");
  const urlPayNow = new URLSearchParams(searchParams).get("payNow");
  const urlPayBill = new URLSearchParams(searchParams).get("payBill");
  const urlPayBillRequirePin = new URLSearchParams(searchParams).get("requirePin") === "1";
  const urlPrintBill = new URLSearchParams(searchParams).get("printBill");
  const urlPayClient = new URLSearchParams(searchParams).get("payClient");
  const urlPayCompany = new URLSearchParams(searchParams).get("payCompany");
  const [searchTerm, setSearchTerm] = useState(urlSearch);
  const [billSearchFilters, setBillSearchFilters] = useState<BillsSearchFilters>(() =>
    getBillsSearchFiltersFromLegacySearch(urlSearch),
  );
  const [timePeriod, setTimePeriod] = useState<"today" | "month" | "year" | "all" | "date" | "custom">("all");
  const [billsRangeApplied, setBillsRangeApplied] = useState(false);
  const [exactDate, setExactDate] = useState("");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "unpaid" | "partial" | "paid">("all");
  const [billSort, setBillSort] = useState<BillSortOption>("newest");
  const [deleteAdminDialog, setDeleteAdminDialog] = useState(false);
  const [deleteAdminPassword, setDeleteAdminPassword] = useState("");
  const [deleteAdminError, setDeleteAdminError] = useState("");
  const [pendingDeleteBillId, setPendingDeleteBillId] = useState<number | null>(null);
  const [revertPaymentDialog, setRevertPaymentDialog] = useState(false);
  const [revertPaymentPin, setRevertPaymentPin] = useState("");
  const [revertPaymentError, setRevertPaymentError] = useState("");
  const [pendingRevertBillId, setPendingRevertBillId] = useState<number | null>(null);
  const [pendingRevertBillIds, setPendingRevertBillIds] = useState<number[] | null>(null);
  const [revertPaymentTargetLabel, setRevertPaymentTargetLabel] = useState("this bill payment");
  const [highlightedBillId, setHighlightedBillId] = useState<number | null>(null);
  
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const newSearch = params.get("search") || "";
    setSearchTerm((current) => (current === newSearch ? current : newSearch));
    const nextBillSearchFilters = getBillsSearchFiltersFromLegacySearch(newSearch);
    setBillSearchFilters((current) =>
      areBillsSearchFiltersEqual(current, nextBillSearchFilters)
        ? current
        : nextBillSearchFilters,
    );
  }, [searchParams]);
  
  useEffect(() => {
    if (urlHighlightBill) {
      const billId = parseInt(urlHighlightBill);
      setHighlightedBillId(billId);
      setActiveTab("bills");
      setTimePeriod("all");
      setBillsRangeApplied(false);
      setExactDate("");
      setCustomDateFrom("");
      setCustomDateTo("");
      setPaymentFilter("all");
      setSearchTerm("");
      setBillSearchFilters({ ...EMPTY_BILLS_SEARCH_FILTERS });
      setLocation("/bills", { replace: true });
      setTimeout(() => {
        setHighlightedBillId(null);
      }, 3000);
    }
  }, [urlHighlightBill]);

  useEffect(() => {
    if (!urlHighlightClient) {
      return;
    }

    const clientId = parseInt(urlHighlightClient, 10);
    if (Number.isNaN(clientId)) {
      return;
    }

    setLocation(`/bills?payClient=${clientId}`, { replace: true });
  }, [urlHighlightClient]);

  useEffect(() => {
    if (urlTab === "bills") {
      setActiveTab("bills");
    }
  }, [urlTab]);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<BillsTabValue>("bills");
  const [isMobileBillsOverviewOpen, setIsMobileBillsOverviewOpen] = useState(false);
  const isBillsTab = activeTab === "bills";
  const isPaidByDateTab = activeTab === "paid-by-date";
  const isByClientTab = activeTab === "by-client";
  const isByCompanyTab = activeTab === "by-company";
  const isByBrokerTab = activeTab === "by-broker";
  const [paidByDateDate, setPaidByDateDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [selectedItems, setSelectedItems] = useState<Record<number, number>>(
    {},
  );
  const [billDescription, setBillDescription] = useState("");
  const [createdBill, setCreatedBill] = useState<{
    bill: Bill;
    items: { name: string; qty: number; price: number; total?: number }[];
  } | null>(null);
  const [viewBillDetails, setViewBillDetails] = useState<BillWithPaymentRecorder | null>(null);
  const [transferBillDialog, setTransferBillDialog] = useState<BillWithPaymentRecorder | null>(null);
  const [transferTargetClientId, setTransferTargetClientId] = useState("");
  const [transferBillSearch, setTransferBillSearch] = useState("");
  const [transferBillAdminPin, setTransferBillAdminPin] = useState("");
  const [transferBillReason, setTransferBillReason] = useState("");
  const [visibleBillsCount, setVisibleBillsCount] = useState(BILLS_INITIAL_LOAD_COUNT);
  const [visiblePaidByDateEntriesCount, setVisiblePaidByDateEntriesCount] = useState(
    BILLS_INITIAL_LOAD_COUNT,
  );
  const [visibleClientGroupsCount, setVisibleClientGroupsCount] = useState(
    BILLS_INITIAL_LOAD_COUNT,
  );
  const [visibleCompanyGroupsCount, setVisibleCompanyGroupsCount] = useState(
    BILLS_INITIAL_LOAD_COUNT,
  );
  const [visibleBrokerGroupsCount, setVisibleBrokerGroupsCount] = useState(
    BILLS_INITIAL_LOAD_COUNT,
  );
  const [showNewItemDialog, setShowNewItemDialog] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("");
  const invoiceRef = useRef<HTMLDivElement>(null);
  const billsListScrollRef = useRef<HTMLDivElement | null>(null);
  const groupedTabsScrollRootRef = useRef<HTMLElement | null>(null);
  const paidByDateLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const clientGroupsLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const companyGroupsLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const brokerGroupsLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const [logoBase64, setLogoBase64] = useState<string>("");
  const workspaceLogoUrl = getWorkspaceLogoUrl(logoImage);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        setLogoBase64(canvas.toDataURL("image/png"));
      }
    };
    img.src = workspaceLogoUrl;
  }, [workspaceLogoUrl]);

  const [showCreatorPinDialog, setShowCreatorPinDialog] = useState(false);
  const [creatorPin, setCreatorPin] = useState("");
  const [creatorPinError, setCreatorPinError] = useState("");
  const [pendingBillData, setPendingBillData] = useState<{
    customerName: string;
    customerPhone?: string;
    amount: string;
    description: string;
    billDate: string;
    referenceNumber: string;
  } | null>(null);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [splitPaymentEnabled, setSplitPaymentEnabled] = useState(false);
  const [splitPaymentAmount, setSplitPaymentAmount] = useState("");
  const [remainingPaymentMethod, setRemainingPaymentMethod] = useState("cash");
  const discountAmountInputRef = useRef<HTMLInputElement | null>(null);
  const [paymentNotes, setPaymentNotes] = useState("");
  const [applyDiscount, setApplyDiscount] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [isSplitPaymentSubmitting, setIsSplitPaymentSubmitting] = useState(false);
  const [selectedBillsOverpaymentClientId, setSelectedBillsOverpaymentClientId] = useState("");
  const [editingDiscountBillId, setEditingDiscountBillId] = useState<number | null>(null);
  const [editingDiscountValue, setEditingDiscountValue] = useState("");
  const [editingDiscountStaffPin, setEditingDiscountStaffPin] = useState("");
  const [editingDiscountAppliedBy, setEditingDiscountAppliedBy] = useState("");
  const [discountPinDialogBill, setDiscountPinDialogBill] = useState<Bill | null>(null);
  const [discountPin, setDiscountPin] = useState("");
  const [discountPinError, setDiscountPinError] = useState("");
  const [discountPinPreview, setDiscountPinPreview] = useState<DiscountPinPreview | null>(null);
  const [isDiscountPinVerifying, setIsDiscountPinVerifying] = useState(false);
  const discountPinPreviewRequestIdRef = useRef(0);
  const pendingBillDiscountFocusIdRef = useRef<number | null>(null);
  const [historyClient, setHistoryClient] = useState<Client | null>(null);
  const [bulkPaymentClientId, setBulkPaymentClientId] = useState<number | null>(null);
  const [companyPayment, setCompanyPayment] = useState<{ companyName: string; totalDue: number } | null>(null);
  const [selectedBillsPaymentSummary, setSelectedBillsPaymentSummary] =
    useState<SelectedBillsPaymentSummary | null>(null);
  const [selectedBillIds, setSelectedBillIds] = useState<Set<number>>(new Set());
  const [isSelectedBillsFolderOpen, setIsSelectedBillsFolderOpen] = useState(false);
  const [selectedBillsFolderKind, setSelectedBillsFolderKind] = useState<SelectedBillsFolderKind>("payment");
  const [mobileBillsControlDialog, setMobileBillsControlDialog] = useState<MobileBillsControlDialog>(null);
  const hoveredGroupedBillsFolderRef = useRef<{ tab: BillsTabValue; key: string } | null>(null);
  const [openClientBillFolders, setOpenClientBillFolders] = useState<string[]>([]);
  const [openCompanyBillFolders, setOpenCompanyBillFolders] = useState<string[]>([]);
  const [openBrokerBillFolders, setOpenBrokerBillFolders] = useState<string[]>([]);
  
  // Cashier PIN verification states
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [cashierPin, setCashierPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pendingPaymentAction, setPendingPaymentAction] = useState<{
    type: 'bill' | 'client' | 'selected-bills';
    bill?: Bill;
    client?: Client;
    totalDue?: number;
    selectedBillsSummary?: SelectedBillsPaymentSummary;
  } | null>(null);
  const [verifiedCashier, setVerifiedCashier] = useState<string | null>(null);
  const [verifiedCashierPin, setVerifiedCashierPin] = useState<string | null>(null);
  const [verifiedCashierRole, setVerifiedCashierRole] = useState<string | null>(null);

  const depositPaymentMethodOption = { value: "deposit" as const, label: "Account Credit", Icon: Wallet };
  const basePaymentMethodOptions = [
    { value: "cash", label: "Cash", Icon: Banknote },
    { value: "card", label: "Card", Icon: CreditCard },
    { value: "bank", label: "Bank Transfer", Icon: Building2 },
  ];

  const focusDiscountAmountInput = () => {
    requestAnimationFrame(() => {
      discountAmountInputRef.current?.focus();
      discountAmountInputRef.current?.select();
    });
  };

  const isAdminOrCounterRole = (role?: string | null) => {
    const normalizedRole = String(role || "").toLowerCase();
    return normalizedRole === "admin" || normalizedRole === "counter" || normalizedRole === "reception";
  };

  const clearDiscountPinPreview = useCallback(() => {
    discountPinPreviewRequestIdRef.current += 1;
    setDiscountPinPreview(null);
  }, []);

  const updateDiscountPinPreview = useCallback(
    async (value: string) => {
      const normalizedPin = value.replace(/\D/g, "").slice(0, 5);
      if (normalizedPin.length !== 5) {
        clearDiscountPinPreview();
        return;
      }

      const requestId = discountPinPreviewRequestIdRef.current + 1;
      discountPinPreviewRequestIdRef.current = requestId;
      setDiscountPinPreview(null);

      try {
        const response = await apiRequest("POST", "/api/discounts/verify-pin", {
          pin: normalizedPin,
        });
        const data = await response.json();
        if (discountPinPreviewRequestIdRef.current !== requestId) return;
        setDiscountPinPreview(getDiscountPinPreview(data));
      } catch {
        if (discountPinPreviewRequestIdRef.current !== requestId) return;
        setDiscountPinPreview(null);
      }
    },
    [clearDiscountPinPreview],
  );

  const renderDiscountPinPreview = () => {
    if (!discountPinPreview) return null;

    return (
      <div
        className="mb-2 flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
        data-testid="text-bill-discount-pin-preview"
        aria-live="polite"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>{discountPinPreview.roleLabel}: {discountPinPreview.name}</span>
      </div>
    );
  };

  const focusBillDiscountInput = useCallback((billId: number) => {
    const selector = [
      `input[data-testid="input-main-bill-discount-${billId}"]`,
      `input[data-testid="input-bill-discount-${billId}"]`,
      `input[data-testid="input-company-bill-discount-${billId}"]`,
      `input[data-testid="input-broker-bill-discount-${billId}"]`,
    ].join(",");
    const focusInput = () => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(selector));
      const input =
        inputs.find((candidate) => candidate.getClientRects().length > 0) ||
        inputs[0];
      if (!input) return false;
      input.focus();
      input.select();
      return true;
    };

    requestAnimationFrame(() => {
      focusInput();
      window.setTimeout(() => {
        focusInput();
        if (pendingBillDiscountFocusIdRef.current === billId) {
          pendingBillDiscountFocusIdRef.current = null;
        }
      }, 35);
    });
  }, []);

  useEffect(() => {
    if (editingDiscountBillId === null) return;
    focusBillDiscountInput(editingDiscountBillId);
  }, [editingDiscountBillId, focusBillDiscountInput]);

  // Query for workers to verify cashier PIN
  const { data: workers = [] } = useQuery<PackingWorker[]>({
    queryKey: ["/api/packing-workers"],
  });

  const { data: bills, isLoading, isError } = useBills();
  const { data: clients = [] } = useClients();
  const clientById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );
  const selectedTransferTargetClient = useMemo(
    () =>
      clients.find((client) => client.id === Number(transferTargetClientId)) || null,
    [clients, transferTargetClientId],
  );
  const transferTargetClients = useMemo(() => {
    const excludedClientId = transferBillDialog?.clientId ?? null;
    const search = transferBillSearch.trim().toLowerCase();
    const compactSearch = compactTransferClientSearchValue(transferBillSearch);
    const normalizedPhoneSearch = normalizePhoneForComparison(transferBillSearch);

    return clients.filter((client) => {
      if (excludedClientId && client.id === excludedClientId) {
        return false;
      }

      if (!search) {
        return true;
      }

      const brokerAddresses = Array.isArray(client.brokerAddresses)
        ? client.brokerAddresses
        : [];
      const searchableDetails = [
        client.name,
        client.company,
        client.address,
        client.phone,
        client.billNumber,
        ...brokerAddresses,
      ];

      return (
        searchableDetails.some((value) =>
          matchesTransferClientSearchValue(value, search, compactSearch),
        ) ||
        (!!normalizedPhoneSearch &&
          normalizePhoneForComparison(client.phone).includes(
            normalizedPhoneSearch,
          ))
      );
    });
  }, [clients, transferBillDialog?.clientId, transferBillSearch]);
  const billsById = useMemo(
    () => new Map((bills || []).map((bill) => [bill.id, bill])),
    [bills],
  );
  useEffect(() => {
    if (!urlBillId) {
      return;
    }

    const billId = parseInt(urlBillId, 10);
    if (Number.isNaN(billId)) {
      return;
    }

    const bill = billsById.get(billId);
    if (!bill) {
      return;
    }

    setActiveTab("bills");
    setViewBillDetails(bill);
    setHighlightedBillId(billId);
    setLocation("/bills", { replace: true });
  }, [urlBillId, billsById, setLocation]);
  const deferredBillSearchFilters = useDeferredValue(billSearchFilters);
  const { data: historyTransactions, isLoading: isHistoryTransactionsLoading } = useQuery<ClientTransaction[]>({
    queryKey: ["/api/clients", historyClient?.id, "transactions"],
    enabled: !!historyClient,
  });
  const getClientAvailableDeposit = useCallback((clientId?: number | null) => {
    if (!clientId) return 0;
    const client = clientById.get(clientId);
    return Math.max(0, parseFloat(client?.deposit || "0"));
  }, [clientById]);
  const activePaymentClientId =
    bulkPaymentClientId ??
    selectedBillsPaymentSummary?.singleClientId ??
    selectedBill?.clientId ??
    null;
  const activePaymentClientDeposit = useMemo(
    () => getClientAvailableDeposit(activePaymentClientId),
    [getClientAvailableDeposit, activePaymentClientId],
  );
  const canUseDepositPayment =
    !companyPayment &&
    !selectedBillsPaymentSummary?.hasBillsWithoutClient &&
    activePaymentClientDeposit > 0.01;
  const paymentMethodOptions = useMemo(
    () => [
      ...(canUseDepositPayment ? [depositPaymentMethodOption] : []),
      ...basePaymentMethodOptions,
    ],
    [canUseDepositPayment],
  );
  const splitPaymentMethodOptions = useMemo(
    () => [
      ...basePaymentMethodOptions,
      ...(canUseDepositPayment ? [depositPaymentMethodOption] : []),
    ].filter(({ value }) => value !== paymentMethod),
    [canUseDepositPayment, paymentMethod],
  );
  const viewBillClientDeposit = useMemo(
    () => getClientAvailableDeposit(viewBillDetails?.clientId),
    [getClientAvailableDeposit, viewBillDetails?.clientId],
  );
  useEffect(() => {
    if (paymentMethod === "deposit" && !canUseDepositPayment) {
      setPaymentMethod("cash");
    }
  }, [paymentMethod, canUseDepositPayment]);
  useEffect(() => {
    if (!splitPaymentMethodOptions.some(({ value }) => value === remainingPaymentMethod)) {
      setRemainingPaymentMethod(splitPaymentMethodOptions[0]?.value || "cash");
    }
  }, [splitPaymentMethodOptions, remainingPaymentMethod]);
  useEffect(() => {
    if (!splitPaymentEnabled) return;

    const totalAmount = parseFloat(paymentAmount || "0");
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      if (splitPaymentAmount !== "") {
        setSplitPaymentAmount("");
      }
      return;
    }

    const currentSplitAmount = parseFloat(splitPaymentAmount || "0");
    const maxAllowedAmount =
      paymentMethod === "deposit"
        ? Math.min(totalAmount, activePaymentClientDeposit)
        : totalAmount;

    // Allow users to clear/backspace the field without auto-restoring the amount.
    if (!Number.isFinite(currentSplitAmount) || currentSplitAmount <= 0) {
      return;
    }

    if (currentSplitAmount > maxAllowedAmount + 0.009) {
      setSplitPaymentAmount(maxAllowedAmount.toFixed(2));
    }
  }, [
    splitPaymentEnabled,
    paymentAmount,
    splitPaymentAmount,
    paymentMethod,
    activePaymentClientDeposit,
  ]);
  const companyClients = useMemo(
    () => clients.filter((client) => client.company && client.company.trim() !== ""),
    [clients],
  );
  const companyClientFingerprint = useMemo(
    () =>
      companyClients
        .map((client) =>
          `${client.id}:${client.company?.trim().toUpperCase()}:${client.name}:${client.billNumber || ""}`,
        )
        .sort()
        .join("|"),
    [companyClients],
  );

  const {
    data: companyPaymentTransactions = [],
    isLoading: isCompanyPaymentTransactionsLoading,
  } = useQuery<CompanyPaymentTransactionRow[]>({
    queryKey: ["/api/company-payment-transactions", companyClientFingerprint],
    enabled: isByCompanyTab && companyClients.length > 0,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/company-payment-transactions", {
        credentials: "include",
        signal,
      });
      if (!response.ok) {
        return [] as CompanyPaymentTransactionRow[];
      }

      const transactions = (await response.json()) as CompanyPaymentTransactionRow[];
      return transactions.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
    },
  });

  const companyTransactionsByKey = useMemo(() => {
    if (!isByCompanyTab) {
      return new Map<string, CompanyPaymentTransactionRow[]>();
    }

    const grouped = new Map<string, CompanyPaymentTransactionRow[]>();

    companyPaymentTransactions.forEach((tx) => {
      const key = tx.companyName?.toUpperCase();
      if (!key) return;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(tx);
    });

    return grouped;
  }, [companyPaymentTransactions, isByCompanyTab]);

  const billFilterState = useMemo(
    () => ({
      search: undefined,
      timePeriod,
      paymentFilter,
      exactDate: exactDate || undefined,
      customDateFrom: customDateFrom || undefined,
      customDateTo: customDateTo || undefined,
      rangeApplied: billsRangeApplied,
    }),
    [
      timePeriod,
      paymentFilter,
      exactDate,
      customDateFrom,
      customDateTo,
      billsRangeApplied,
    ],
  );

  const { mutate: deleteBill } = useDeleteBill();
  const { mutate: createProduct, isPending: isCreatingProduct } =
    useCreateProduct();
  const { toast } = useToast();
  const { companyContact } = useCompanyContactInfo();
  const companyAddressLines = getCompanyAddressLines(companyContact);
  const companyAddressHtml = companyAddressLines.map(escapeHtml).join("<br />");
  const companyPhoneLine = formatCompanyPhoneLine(companyContact);
  const companyPhoneHtml = escapeHtml(companyPhoneLine);

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: allOrders } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
  });

  const { data: allBillPayments = [] } = useQuery<BillPaymentRow[]>({
    queryKey: ["/api/bill-payments"],
  });

  const latestPaymentDateByBillId = useMemo(() => {
    const latestByBillId = new Map<number, string>();

    allBillPayments.forEach((payment) => {
      const paymentTs = new Date(payment.paymentDate).getTime();
      if (!Number.isFinite(paymentTs)) return;

      const current = latestByBillId.get(payment.billId);
      const currentTs = current ? new Date(current).getTime() : Number.NEGATIVE_INFINITY;
      if (!current || paymentTs > currentTs) {
        latestByBillId.set(payment.billId, payment.paymentDate);
      }
    });

    return latestByBillId;
  }, [allBillPayments]);

  const getBillLatestPaymentDate = (billId?: number | null) => {
    if (!billId) return null;
    const liveBill = billsById.get(billId);
    if (liveBill) {
      const livePaidAmount = parseFloat(String(liveBill.paidAmount || "0"));
      if ((!Number.isFinite(livePaidAmount) || livePaidAmount <= 0.009) && !liveBill.isPaid) {
        return null;
      }
    }
    return latestPaymentDateByBillId.get(billId) || null;
  };

  const formatBillCreatedDate = (value?: string | Date | null) => {
    if (!value) return "-";
    return format(new Date(value), "dd/MM/yyyy");
  };

  const formatBillDateTime = (value?: string | Date | null) => {
    if (!value) return "-";
    return format(new Date(value), "dd/MM/yyyy hh:mm a");
  };

  const formatBillPaymentDate = (value?: string | Date | null) => {
    return formatBillDateTime(value);
  };

  const renderPartialHistoryDatePill = (value?: string | Date | null) => {
    if (!value) return null;

    return (
      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300">
        Partial {formatBillCreatedDate(value)}
      </span>
    );
  };

  const ordersByBillId = useMemo(() => {
    const grouped = new Map<number, Order[]>();

    (allOrders || []).forEach((order) => {
      if (!order.billId) return;
      if (!grouped.has(order.billId)) grouped.set(order.billId, []);
      grouped.get(order.billId)!.push(order);
    });

    return grouped;
  }, [allOrders]);
  const firstOrderByBillId = useMemo(() => {
    const firstByBillId = new Map<number, Order>();

    ordersByBillId.forEach((orders, billId) => {
      if (orders.length > 0) {
        firstByBillId.set(billId, orders[0]);
      }
    });

    return firstByBillId;
  }, [ordersByBillId]);
  const billedOrdersTotalByClientId = useMemo(() => {
    const totals = new Map<number, number>();

    (allOrders || []).forEach((order) => {
      if (!order.billId || !order.clientId) return;
      const totalAmount = parseFloat(order.totalAmount || "0");
      totals.set(
        order.clientId,
        (totals.get(order.clientId) || 0) + (Number.isFinite(totalAmount) ? totalAmount : 0),
      );
    });

    return totals;
  }, [allOrders]);

  const getBillTypeMeta = (bill?: Bill | null) => {
    const linkedOrders = bill ? ordersByBillId.get(bill.id) || [] : [];
    const isUrgent = linkedOrders.some((order) => order.urgent === true);

    return {
      isUrgent,
      label: isUrgent ? "URGENT" : "NORMAL",
      textClassName: isUrgent ? "text-red-600" : "text-green-600",
    };
  };

  const renderBillTypeIndicator = (bill?: Bill | null) => {
    const billTypeMeta = getBillTypeMeta(bill);

    return (
      <span
        className={`mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${billTypeMeta.textClassName}`}
      >
        {billTypeMeta.label}
      </span>
    );
  };

  const hasMeaningfulAdjustment = (order: Order): boolean => {
    const adjustedRaw = order.adjustedTotal;
    const hasAdjustedValue =
      adjustedRaw !== null &&
      adjustedRaw !== undefined &&
      String(adjustedRaw).trim() !== "";
    if (!hasAdjustedValue) return false;
    return String(order.priceAdjustReason || "").trim().length > 0;
  };

  const getOrderDeliveryChargeAmount = (order: Order): number => {
    const charge = parseFloat(String((order as any).deliveryCharge || "0"));
    return Number.isFinite(charge) ? Math.max(0, charge) : 0;
  };

  const getOrderTipsAmount = (order: Order): number => {
    const tips = parseFloat(String(order.tips || "0"));
    return Number.isFinite(tips) ? Math.max(0, tips) : 0;
  };

  const getOrderExtraCharges = (order: Order): number =>
    getOrderDeliveryChargeAmount(order) + getOrderTipsAmount(order);

  const getOrderWorkReceivedAmount = (order: Order): number => {
    if (hasMeaningfulAdjustment(order)) {
      const adjusted = parseFloat(String(order.adjustedTotal ?? "0"));
      if (Number.isFinite(adjusted)) return Math.max(0, adjusted);
    }

    const original = parseFloat(String(order.totalAmount ?? ""));
    if (Number.isFinite(original)) {
      return Math.max(0, original);
    }

    const finalAmount = parseFloat(String(order.finalAmount ?? "0"));
    if (!Number.isFinite(finalAmount)) return 0;
    const directDiscount = parseFloat(String(order.discountAmount || "0"));
    const safeDiscount = Number.isFinite(directDiscount) ? Math.max(0, directDiscount) : 0;
    return Math.max(0, finalAmount + safeDiscount - getOrderExtraCharges(order));
  };

  const getOrderDiscountAmount = useCallback((order: Order): number => {
    const directDiscount = parseFloat(String(order.discountAmount || "0"));
    if (Number.isFinite(directDiscount) && directDiscount > 0) {
      return Math.max(0, directDiscount);
    }

    if (!order.billId) return 0;
    const linkedBill = billsById.get(order.billId);
    const billDiscount = parseFloat(String(linkedBill?.discountAmount || "0"));
    if (!Number.isFinite(billDiscount) || billDiscount <= 0) return 0;

    const ordersInSameBill = ordersByBillId.get(order.billId) || [];
    if (ordersInSameBill.length <= 1) {
      return Math.max(0, billDiscount);
    }

    const billBaseTotal = ordersInSameBill.reduce(
      (sum, candidate) => sum + getOrderWorkReceivedAmount(candidate),
      0,
    );
    if (billBaseTotal <= 0) return 0;

    const orderShare = getOrderWorkReceivedAmount(order) / billBaseTotal;
    return Math.max(0, billDiscount * orderShare);
  }, [billsById, ordersByBillId]);

  const getOrderFinalAmount = useCallback((order: Order): number => {
    const explicitFinalAmount = parseFloat(String(order.finalAmount ?? ""));
    if (
      Number.isFinite(explicitFinalAmount) &&
      String(order.finalAmount ?? "").trim() !== ""
    ) {
      return Math.max(0, explicitFinalAmount);
    }

    if (order.billId && bills) {
      const linkedBill = bills.find((bill) => bill.id === order.billId);
      const ordersInSameBill = allOrders?.filter((candidate) => candidate.billId === order.billId) || [];
      if (linkedBill && ordersInSameBill.length <= 1) {
        const linkedBillAmount = parseFloat(String(linkedBill.amount ?? ""));
        if (
          Number.isFinite(linkedBillAmount) &&
          (linkedBillAmount > 0 || String(linkedBill.amount ?? "").trim() !== "")
        ) {
          return Math.max(0, linkedBillAmount);
        }
      }
    }

    const workReceived = getOrderWorkReceivedAmount(order);
    return Math.max(0, workReceived - getOrderDiscountAmount(order)) + getOrderExtraCharges(order);
  }, [allOrders, bills, getOrderDiscountAmount]);

  const billDisplayAmountsById = useMemo(() => {
    const mapped = new Map<number, {
      originalAmount: number;
      discount: number;
      deliveryCharge: number;
      finalAmount: number;
      paidAmount: number;
      due: number;
    }>();

    (bills || []).forEach((bill) => {
      const linkedOrders = ordersByBillId.get(bill.id) || [];

      const fallbackOriginalRaw = parseFloat(String((bill as any).originalAmount ?? bill.amount ?? "0"));
      const fallbackDiscountRaw = parseFloat(String(bill.discountAmount || "0"));
      const fallbackDeliveryChargeRaw = parseFloat(String((bill as any).deliveryCharge || "0"));
      const fallbackFinalRaw = parseFloat(String(bill.amount || "0"));
      const paidAmountRaw = parseFloat(String(bill.paidAmount || "0"));

      const fallbackOriginalAmount = Number.isFinite(fallbackOriginalRaw) ? Math.max(0, fallbackOriginalRaw) : 0;
      const fallbackDiscount = Number.isFinite(fallbackDiscountRaw) ? Math.max(0, fallbackDiscountRaw) : 0;
      const fallbackDeliveryCharge = Number.isFinite(fallbackDeliveryChargeRaw) ? Math.max(0, fallbackDeliveryChargeRaw) : 0;
      const fallbackFinalAmount = Number.isFinite(fallbackFinalRaw) ? Math.max(0, fallbackFinalRaw) : 0;
      const paidAmount = Number.isFinite(paidAmountRaw) ? Math.max(0, paidAmountRaw) : 0;

      let originalAmount = linkedOrders.length > 0
        ? linkedOrders.reduce((sum, order) => sum + getOrderWorkReceivedAmount(order), 0)
        : fallbackOriginalAmount;

      let discount = linkedOrders.length > 0
        ? linkedOrders.reduce((sum, order) => sum + getOrderDiscountAmount(order), 0)
        : fallbackDiscount;

      let finalAmount = linkedOrders.length > 0
        ? linkedOrders.reduce((sum, order) => sum + getOrderFinalAmount(order), 0)
        : fallbackFinalAmount;

      let deliveryCharge = linkedOrders.length > 0
        ? linkedOrders.reduce((sum, order) => sum + getOrderDeliveryChargeAmount(order), 0)
        : fallbackDeliveryCharge;

      if (originalAmount <= 0.009 && fallbackOriginalAmount > 0) {
        originalAmount = fallbackOriginalAmount;
      }
      if (discount <= 0.009 && fallbackDiscount > 0) {
        discount = fallbackDiscount;
      }
      if (deliveryCharge <= 0.009 && fallbackDeliveryCharge > 0) {
        deliveryCharge = fallbackDeliveryCharge;
      }
      if (finalAmount <= 0.009 && fallbackFinalAmount > 0) {
        finalAmount = fallbackFinalAmount;
      }
      if (originalAmount <= 0.009 && (finalAmount > 0 || discount > 0)) {
        originalAmount = Math.max(0, finalAmount + discount - deliveryCharge);
      }

      const due = Math.max(0, finalAmount - paidAmount);

      mapped.set(bill.id, {
        originalAmount,
        discount,
        deliveryCharge,
        finalAmount,
        paidAmount,
        due,
      });
    });

    return mapped;
  }, [bills, ordersByBillId, getOrderDiscountAmount, getOrderFinalAmount]);

  const getBillDisplayAmounts = useCallback((bill: Bill) => {
    return billDisplayAmountsById.get(bill.id) || {
      originalAmount: parseFloat(String((bill as any).originalAmount ?? bill.amount ?? "0")) || 0,
      discount: parseFloat(String(bill.discountAmount || "0")) || 0,
      deliveryCharge: parseFloat(String((bill as any).deliveryCharge || "0")) || 0,
      finalAmount: parseFloat(String(bill.amount || "0")) || 0,
      paidAmount: parseFloat(String(bill.paidAmount || "0")) || 0,
      due: Math.max(
        0,
        (parseFloat(String(bill.amount || "0")) || 0) - (parseFloat(String(bill.paidAmount || "0")) || 0),
      ),
    };
  }, [billDisplayAmountsById]);

  const getBillPaymentStatus = useCallback(
    (bill: Bill): "paid" | "partial" | "unpaid" => {
      const displayAmounts = getBillDisplayAmounts(bill);

      if (bill.isPaid || displayAmounts.due <= 0.01) {
        return "paid";
      }

      if (displayAmounts.paidAmount > 0.01) {
        return "partial";
      }

      return "unpaid";
    },
    [getBillDisplayAmounts],
  );

  const allTimeBillsOverview = useMemo(() => {
    const overview = {
      total: 0,
      unpaid: 0,
      partial: 0,
      paid: 0,
    };

    (bills || []).forEach((bill) => {
      overview.total += 1;
      const status = getBillPaymentStatus(bill);
      overview[status] += 1;
    });

    return overview;
  }, [bills, getBillPaymentStatus]);

  const firstPartialPaymentDateByBillId = useMemo(() => {
    const result = new Map<number, string | null>();
    const paymentsByBillId = new Map<number, BillPaymentRow[]>();

    allBillPayments.forEach((payment) => {
      if (!Number.isFinite(payment.billId)) return;
      const existing = paymentsByBillId.get(payment.billId);
      if (existing) {
        existing.push(payment);
      } else {
        paymentsByBillId.set(payment.billId, [payment]);
      }
    });

    paymentsByBillId.forEach((payments, billId) => {
      const liveBill = billsById.get(billId);
      if (!liveBill?.isPaid) {
        result.set(billId, null);
        return;
      }

      const fallbackFinalAmount = parseFloat(String(liveBill.amount || "0"));
      const finalAmount =
        billDisplayAmountsById.get(billId)?.finalAmount ??
        (Number.isFinite(fallbackFinalAmount) ? fallbackFinalAmount : 0);
      if (!Number.isFinite(finalAmount) || finalAmount <= 0.01) {
        result.set(billId, null);
        return;
      }

      const groupedEvents = new Map<string, { time: number; amount: number }>();
      payments
        .slice()
        .sort((left, right) => {
          const leftTime = new Date(left.paymentDate).getTime();
          const rightTime = new Date(right.paymentDate).getTime();
          if (leftTime !== rightTime) return leftTime - rightTime;
          return left.id - right.id;
        })
        .forEach((payment) => {
          const amount = parseFloat(String(payment.amount || "0"));
          if (!Number.isFinite(amount) || amount <= 0) return;

          const eventKey = getBillPaymentEventGroupKey(payment);
          const paymentTime = new Date(payment.paymentDate).getTime();
          const existing = groupedEvents.get(eventKey);
          if (existing) {
            existing.amount += amount;
            if (Number.isFinite(paymentTime)) {
              existing.time = Math.min(existing.time, paymentTime);
            }
          } else {
            groupedEvents.set(eventKey, {
              time: Number.isFinite(paymentTime) ? paymentTime : Number.MAX_SAFE_INTEGER,
              amount,
            });
          }
        });

      const orderedEvents = Array.from(groupedEvents.values()).sort((left, right) => left.time - right.time);
      let runningPaidAmount = 0;
      let firstPartialEventTime: number | null = null;

      for (const event of orderedEvents) {
        runningPaidAmount += event.amount;
        const afterEvent = Math.min(runningPaidAmount, finalAmount);

        if (
          firstPartialEventTime === null &&
          afterEvent > 0.01 &&
          afterEvent < finalAmount - 0.01 &&
          Number.isFinite(event.time) &&
          event.time < Number.MAX_SAFE_INTEGER
        ) {
          firstPartialEventTime = event.time;
        }

        if (afterEvent >= finalAmount - 0.01) {
          break;
        }
      }

      result.set(
        billId,
        firstPartialEventTime !== null ? new Date(firstPartialEventTime).toISOString() : null,
      );
    });

    return result;
  }, [allBillPayments, billDisplayAmountsById, billsById]);

  const getBillStatusMeta = (bill: Bill, displayAmounts: ReturnType<typeof getBillDisplayAmounts>): BillStatusMeta => {
    const isPartiallyPaid = !bill.isPaid && displayAmounts.paidAmount > 0.01;
    const partialHistoryDate = bill.isPaid ? firstPartialPaymentDateByBillId.get(bill.id) || null : null;
    const hadPartialHistory = partialHistoryDate !== null;

    if (bill.isPaid) {
      return {
        label: "PAID",
        tableRowClass: "bg-green-50/40 hover:bg-green-100/70 dark:bg-green-950/20 dark:hover:bg-green-950/40",
        badgeClass: "bg-green-500 hover:bg-green-600",
        mobileCardClass: "border-emerald-200/80 bg-gradient-to-br from-white via-emerald-50/70 to-emerald-100/70 dark:from-card dark:via-emerald-950/20 dark:to-emerald-950/35",
        accentClass: "from-emerald-400 via-green-500 to-teal-500",
        summaryClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        historyBadgeLabel: hadPartialHistory ? "WAS PARTIAL FIRST" : null,
        historyBadgeClass: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
        historyDate: partialHistoryDate,
      };
    }

    if (isPartiallyPaid) {
      return {
        label: "PARTIAL",
        tableRowClass: "bg-amber-50/40 hover:bg-amber-100/70 dark:bg-amber-950/20 dark:hover:bg-amber-950/40",
        badgeClass: "bg-amber-500 hover:bg-amber-600",
        mobileCardClass: "border-amber-200/80 bg-gradient-to-br from-white via-amber-50/70 to-orange-100/70 dark:from-card dark:via-amber-950/20 dark:to-orange-950/30",
        accentClass: "from-amber-400 via-orange-500 to-yellow-500",
        summaryClass: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        historyBadgeLabel: null,
        historyBadgeClass: "",
        historyDate: null,
      };
    }

    return {
      label: "UNPAID",
      tableRowClass: "bg-blue-50/30 hover:bg-blue-100/70 dark:bg-blue-950/10 dark:hover:bg-blue-950/30",
      badgeClass: "bg-blue-500 hover:bg-blue-600",
      mobileCardClass: "border-sky-200/80 bg-gradient-to-br from-white via-sky-50/70 to-blue-100/70 dark:from-card dark:via-sky-950/20 dark:to-blue-950/30",
      accentClass: "from-sky-400 via-blue-500 to-indigo-500",
      summaryClass: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
      historyBadgeLabel: null,
      historyBadgeClass: "",
      historyDate: null,
    };
  };

  const getBillReceiptIconClass = (
    bill: Bill,
    displayAmounts: ReturnType<typeof getBillDisplayAmounts>,
  ) => {
    const statusMeta = getBillStatusMeta(bill, displayAmounts);

    if (statusMeta.label === "PARTIAL") {
      return "text-amber-500 dark:text-amber-400";
    }

    if (statusMeta.label === "PAID") {
      return "text-green-600 dark:text-green-400";
    }

    return "text-sky-600 dark:text-sky-400";
  };

  const getBillAddressLines = (bill: Bill, client?: Client | null) => {
    const linkedOrders = ordersByBillId.get(bill.id) || [];
    const normalizeAddressKey = (value: string) => value.trim().toUpperCase();
    const isUsefulAddress = (value: string) => {
      const normalized = normalizeAddressKey(value);
      return !!normalized && normalized !== "-" && normalized !== "0";
    };
    const orderAddresses = Array.from(
      new Set(
        linkedOrders
          .map((order) => String(order.deliveryAddress || "").trim())
          .filter(isUsefulAddress),
      ),
    );

    const linkedClient = client ?? (bill.clientId ? clientById.get(bill.clientId) : undefined);
    const isBroker = ((linkedClient as any)?.clientType || "").trim().toLowerCase() === "broker";
    if (isBroker) return orderAddresses;

    const clientAddress = String(linkedClient?.address || "").trim();
    return isUsefulAddress(clientAddress) ? [clientAddress] : orderAddresses;
  };

  const matchesBillsSearchReference = useCallback(
    (value: string | number | null | undefined, search: string) =>
      normalizeBillsReferenceSearch(String(value || "")).includes(search),
    [],
  );

  const matchesBillsSearchFilters = useCallback(
    (bill: Bill, filters: BillsSearchFilters) => {
      if (!hasBillsSearchFilters(filters)) {
        return true;
      }

      const linkedClient = bill.clientId ? clientById.get(bill.clientId) ?? null : null;
      const linkedOrders = ordersByBillId.get(bill.id) || [];

      const accountNumberSearch = normalizeBillsReferenceSearch(filters.accountNumber);
      if (
        accountNumberSearch &&
        !matchesBillsSearchReference(linkedClient?.billNumber, accountNumberSearch)
      ) {
        return false;
      }

      const orderNumberSearch = normalizeBillsExactOrderNumber(filters.orderNumber);
      if (orderNumberSearch) {
        const matchesOrderNumber =
          linkedOrders.some((order) =>
            matchesBillsExactOrderNumber(order.orderNumber, orderNumberSearch),
          ) ||
          matchesBillsExactOrderNumber(bill.description, orderNumberSearch);

        if (!matchesOrderNumber) {
          return false;
        }
      }

      const billNumberSearch = normalizeBillsExactBillNumber(filters.billNumber);
      if (billNumberSearch) {
        const matchesBillNumber = matchesBillsExactBillNumber(bill.id, billNumberSearch);

        if (!matchesBillNumber) {
          return false;
        }
      }

      const billAmountSearch = normalizeBillsMoneySearch(filters.billAmount);
      if (
        billAmountSearch &&
        !matchesBillsMoneySearch(getBillDisplayAmounts(bill).finalAmount, billAmountSearch)
      ) {
        return false;
      }

      const nameAddressSearch = filters.nameAddress.trim().toLowerCase();
      if (nameAddressSearch) {
        const addressText = getBillAddressLines(bill, linkedClient).join(" ").toLowerCase();
        const matchesNameOrAddress =
          String(bill.customerName || "").toLowerCase().includes(nameAddressSearch) ||
          String(linkedClient?.name || "").toLowerCase().includes(nameAddressSearch) ||
          addressText.includes(nameAddressSearch);

        if (!matchesNameOrAddress) {
          return false;
        }
      }

      const mobileSearch = filters.mobileNumber.trim();
      if (mobileSearch) {
        const normalizedMobileSearch = normalizePhoneForComparison(mobileSearch);
        const loweredMobileSearch = mobileSearch.toLowerCase();
        const matchesMobile = [bill.customerPhone, linkedClient?.phone].some((value) => {
          const loweredValue = String(value || "").toLowerCase();
          if (!loweredValue) {
            return false;
          }

          if (loweredValue.includes(loweredMobileSearch)) {
            return true;
          }

          return normalizedMobileSearch
            ? normalizePhoneForComparison(loweredValue).includes(normalizedMobileSearch)
            : false;
        });

        if (!matchesMobile) {
          return false;
        }
      }

      const companySearch = filters.companyName.trim().toLowerCase();
      if (companySearch) {
        const companyName = String(linkedClient?.company || "").toLowerCase();
        if (!companyName.includes(companySearch)) {
          return false;
        }
      }

      return true;
    },
    [clientById, getBillAddressLines, getBillDisplayAmounts, matchesBillsSearchReference, ordersByBillId],
  );

  const getBillAggregateTotals = (billList: Bill[]) => {
    return billList.reduce(
      (totals, bill) => {
        const displayAmounts = getBillDisplayAmounts(bill);
        totals.workReceived += displayAmounts.originalAmount;
        totals.discount += displayAmounts.discount;
        totals.finalAmount += displayAmounts.finalAmount;
        totals.paidAmount += displayAmounts.paidAmount;
        totals.due += displayAmounts.due;
        return totals;
      },
      {
        workReceived: 0,
        discount: 0,
        finalAmount: 0,
        paidAmount: 0,
        due: 0,
      },
    );
  };

  const isBillOutstanding = (bill: Bill) => getBillDisplayAmounts(bill).due > 0.01;
  const isBillRevertable = (bill: Bill) => {
    const displayAmounts = getBillDisplayAmounts(bill);
    return bill.isPaid || displayAmounts.paidAmount > 0.01;
  };
  const isBillSelectableForBulkAction = (bill: Bill) =>
    isBillOutstanding(bill) || isBillRevertable(bill);

  const paymentFilterlessBills = useMemo(() => {
    if (!bills) return bills;
    const searchAndViewMatchedBills = filterBills(bills, clientById, {
      ...billFilterState,
      paymentFilter: "all",
    });
    return searchAndViewMatchedBills.filter((bill) =>
      matchesBillsSearchFilters(bill, deferredBillSearchFilters),
    );
  }, [
    bills,
    clientById,
    billFilterState,
    deferredBillSearchFilters,
    matchesBillsSearchFilters,
  ]);

  const filteredBills = useMemo(() => {
    if (!paymentFilterlessBills) return paymentFilterlessBills;

    if (paymentFilter === "all") {
      return paymentFilterlessBills;
    }

    return paymentFilterlessBills.filter(
      (bill) => getBillPaymentStatus(bill) === paymentFilter,
    );
  }, [
    paymentFilterlessBills,
    getBillPaymentStatus,
    paymentFilter,
  ]);

  const sortBillsForSelectedOption = useCallback(
    (billList: readonly BillWithPaymentRecorder[]) => [...billList].sort((left, right) => {
      const leftTime = new Date(left.billDate).getTime();
      const rightTime = new Date(right.billDate).getTime();
      const leftDue = getBillDisplayAmounts(left).due;
      const rightDue = getBillDisplayAmounts(right).due;
      const leftOutstanding = leftDue > 0.01 ? 1 : 0;
      const rightOutstanding = rightDue > 0.01 ? 1 : 0;

      if (billSort === "oldest") {
        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return left.id - right.id;
      }

      if (billSort === "highest-unpaid" || billSort === "lowest-unpaid") {
        if (leftOutstanding !== rightOutstanding) {
          return rightOutstanding - leftOutstanding;
        }

        if (leftOutstanding === 1 && rightOutstanding === 1 && Math.abs(leftDue - rightDue) > 0.009) {
          return billSort === "highest-unpaid"
            ? rightDue - leftDue
            : leftDue - rightDue;
        }
      }

      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }

      return right.id - left.id;
    }),
    [billSort, getBillDisplayAmounts],
  );

  const sortedBills = useMemo(
    () => sortBillsForSelectedOption(filteredBills || []),
    [filteredBills, sortBillsForSelectedOption],
  );

  const brokerClientIds = useMemo(
    () =>
      new Set(
        (clients || [])
          .filter((client: any) => (client.clientType || "").trim().toLowerCase() === "broker")
          .map((client) => client.id),
      ),
    [clients],
  );

  const clientTabBills = useMemo(
    () => {
      if (!isByClientTab) return [];

      return sortedBills.filter(
        (bill) => !(bill.clientId && brokerClientIds.has(bill.clientId)),
      );
    },
    [sortedBills, brokerClientIds, isByClientTab],
  );

  const companyTabBills = useMemo(
    () => {
      if (!isByCompanyTab) return [];

      return sortedBills.filter((bill) => {
        const companyName = bill.clientId
          ? clientById.get(bill.clientId)?.company
          : "";
        return Boolean(companyName && companyName.trim() !== "");
      });
    },
    [sortedBills, clientById, isByCompanyTab],
  );

  const brokerTabBills = useMemo(
    () => {
      if (!isByBrokerTab) return [];

      return sortedBills.filter(
        (bill) => Boolean(bill.clientId && brokerClientIds.has(bill.clientId)),
      );
    },
    [sortedBills, brokerClientIds, isByBrokerTab],
  );

  const filteredBillsById = useMemo(
    () => new Map((filteredBills || []).map((bill) => [bill.id, bill])),
    [filteredBills],
  );
  const paidByDateBillsById = useMemo(
    () => new Map((filteredBills || []).map((bill) => [bill.id, bill])),
    [filteredBills],
  );

  const handleBillsSearchChange = useCallback(
    (field: BillsSearchFieldKey, value: string) => {
      setBillSearchFilters((current) => ({ ...current, [field]: value }));
    },
    [],
  );
  const clearBillsSearchFilters = useCallback(() => {
    setBillSearchFilters({ ...EMPTY_BILLS_SEARCH_FILTERS });
  }, []);
  const activeBillsSearchFilterCount = useMemo(
    () =>
      BILLS_SEARCH_FIELD_KEYS.reduce(
        (count, key) => count + (billSearchFilters[key].trim() ? 1 : 0),
        0,
      ),
    [billSearchFilters],
  );
  const hasActiveBillsSearchFilters = activeBillsSearchFilterCount > 0;
  const hasActiveSharedBillFilters = Boolean(
    hasActiveBillsSearchFilters || paymentFilter !== "all" || timePeriod !== "all",
  );
  const activeBillsViewFilterCount =
    (paymentFilter !== "all" ? 1 : 0) +
    (timePeriod !== "all" ? 1 : 0) +
    (billSort !== "newest" ? 1 : 0);
  const mobileBillsSearchSummaryLabel = hasActiveBillsSearchFilters
    ? `${activeBillsSearchFilterCount} active`
    : "Account, order, bill, customer";
  const billsSearchGridClassName = isMobile
    ? "grid grid-cols-1 gap-2"
    : "grid w-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7";
  const billsSearchInputClassName = isMobile
    ? "h-8 w-full rounded-xl border-border/70 bg-background/95 pl-7.5 pr-2.5 text-[11px] touch-manipulation"
    : "h-10 w-full rounded-xl border-border/70 bg-background/95 pl-9 pr-3 text-sm shadow-sm";
  const billsSearchIconClassName = isMobile
    ? "absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
    : "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground";
  const billsSearchFields = (
    <div className={billsSearchGridClassName}>
      {BILLS_SEARCH_FIELD_CONFIGS.map((field) => (
        <div key={field.key} className="min-w-0 text-left">
          <Label className={`${isMobile ? "mb-1 text-[9px] tracking-[0.12em]" : "mb-1.5 text-[11px] tracking-[0.16em]"} block px-1 font-semibold uppercase text-muted-foreground`}>
            {field.label}
          </Label>
          <div className="relative">
            <Search className={billsSearchIconClassName} />
            <Input
              placeholder={field.placeholder}
              value={billSearchFilters[field.key]}
              onChange={(event) => handleBillsSearchChange(field.key, event.target.value)}
              className={billsSearchInputClassName}
              inputMode={field.inputMode}
              data-testid={field.testId}
            />
          </div>
        </div>
      ))}
    </div>
  );

  const compactBillsOverviewItems = [
    {
      key: "all",
      label: "All Bills",
      value: allTimeBillsOverview.total,
      Icon: Package,
      cardClass:
        "border-slate-200/80 bg-slate-50/80 text-slate-700 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200",
      iconClass: "text-slate-500 dark:text-slate-300",
      valueClass: "text-slate-900 dark:text-slate-50",
      meta: "all-time",
    },
    {
      key: "unpaid",
      label: "Unpaid",
      value: allTimeBillsOverview.unpaid,
      Icon: FileText,
      cardClass:
        "border-sky-200/80 bg-sky-50/80 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200",
      iconClass: "text-sky-500 dark:text-sky-300",
      valueClass: "text-sky-700 dark:text-sky-200",
      meta: "bills",
    },
    {
      key: "partial",
      label: "Partial",
      value: allTimeBillsOverview.partial,
      Icon: Receipt,
      cardClass:
        "border-amber-200/80 bg-amber-50/80 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200",
      iconClass: "text-amber-500 dark:text-amber-300",
      valueClass: "text-amber-700 dark:text-amber-200",
      meta: "bills",
    },
    {
      key: "paid",
      label: "Paid",
      value: allTimeBillsOverview.paid,
      Icon: DollarSign,
      cardClass:
        "border-emerald-200/80 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200",
      iconClass: "text-emerald-500 dark:text-emerald-300",
      valueClass: "text-emerald-700 dark:text-emerald-200",
      meta: "bills",
    },
  ] as const;

  const compactBillsOverview = isMobile ? (
    <div className="overflow-hidden rounded-[22px] border border-border/70 bg-card/95 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.45)] backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setIsMobileBillsOverviewOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
        aria-expanded={isMobileBillsOverviewOpen}
        data-testid="button-mobile-bills-overview"
      >
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
            Bills Overview
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {allTimeBillsOverview.total} total • {allTimeBillsOverview.unpaid} unpaid • {allTimeBillsOverview.partial} partial • {allTimeBillsOverview.paid} paid
          </p>
        </div>
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground">
          {isMobileBillsOverviewOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
      </button>

      {isMobileBillsOverviewOpen && (
        <div className="grid grid-cols-2 gap-2 border-t border-border/60 px-3 pb-3 pt-2">
          {compactBillsOverviewItems.map(({ key, label, value, Icon, cardClass, iconClass, valueClass, meta }) => (
            <div
              key={key}
              className={`rounded-2xl border px-2.5 py-2 shadow-sm backdrop-blur-sm ${cardClass}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em]">
                  {label}
                </p>
                <Icon className={`h-3.5 w-3.5 ${iconClass}`} />
              </div>
              <p className={`mt-1 text-lg font-bold leading-none ${valueClass}`}>
                {value}
              </p>
              <p className="mt-1 text-[10px] text-current/75">{meta}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {compactBillsOverviewItems.map(({ key, label, value, Icon, cardClass, iconClass, valueClass, meta }) => (
        <div
          key={key}
          className={`min-w-[6.5rem] rounded-2xl border px-2.5 py-2 shadow-sm backdrop-blur-sm ${cardClass}`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em]">
              {label}
            </p>
            <Icon className={`h-3.5 w-3.5 ${iconClass}`} />
          </div>
          <p className={`mt-1 text-lg font-bold leading-none ${valueClass}`}>
            {value}
          </p>
          <p className="mt-1 text-[10px] text-current/75">{meta}</p>
        </div>
      ))}
    </div>
  );

  const mobileBillsOverviewDialogContent = (
    <div>
      <div className="mb-2">
        <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Bills Overview
        </p>
        <p className="text-[9px] text-muted-foreground">
          {allTimeBillsOverview.total} total | {allTimeBillsOverview.unpaid} unpaid | {allTimeBillsOverview.partial} partial | {allTimeBillsOverview.paid} paid
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {compactBillsOverviewItems.map(({ key, label, value, Icon, cardClass, iconClass, valueClass, meta }) => (
          <div
            key={key}
            className={`rounded-2xl border px-2.5 py-2 shadow-sm backdrop-blur-sm ${cardClass}`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em]">
                {label}
              </p>
              <Icon className={`h-3.5 w-3.5 ${iconClass}`} />
            </div>
            <p className={`mt-1 text-lg font-bold leading-none ${valueClass}`}>
              {value}
            </p>
            <p className="mt-1 text-[9px] text-current/75">{meta}</p>
          </div>
        ))}
      </div>
    </div>
  );

  const visibleHistoryTransactions = useMemo(
    () => buildVisibleClientHistoryTransactions(historyTransactions),
    [historyTransactions],
  );

  const historyClientUnpaidTotal = useMemo(() => {
    if (!historyClient || !bills) return 0;
    return bills
      .filter((bill) => bill.clientId === historyClient.id && isBillOutstanding(bill))
      .reduce((sum, bill) => sum + getBillDisplayAmounts(bill).due, 0);
  }, [historyClient, bills, billDisplayAmountsById]);

  const historyAvailableCreditBalance = useMemo(() => {
    const creditBalance = visibleHistoryTransactions.reduce((sum, tx) => {
      if (tx.type === "deposit") return sum + parseFloat(tx.amount || "0");
      if (isAccountCreditDeductionType(tx.type)) {
        return sum - parseFloat(tx.amount || "0");
      }
      return sum;
    }, 0);

    return Math.max(0, creditBalance);
  }, [visibleHistoryTransactions]);

  const historyClientTotalPaid = useMemo(
    () =>
      visibleHistoryTransactions.reduce((sum, tx) => {
        if (
          tx.type === "payment" ||
          tx.type === "deposit_used" ||
          tx.type === "bulk_deposit_used" ||
          tx.type === "bulk_payment" ||
          tx.type === "company_payment"
        ) {
          return sum + parseFloat(tx.amount || "0");
        }
        return sum;
      }, 0),
    [visibleHistoryTransactions],
  );

  const getHistoryTransactionTypeDisplay = (tx: ClientTransaction) => {
    const singleBillBulkHistoryBillId = getSingleBillBulkHistoryBillId(tx);

    if (tx.type === "deposit") {
      return { label: "Add Credit to Account", color: "bg-green-100 text-green-700" };
    }
    if (tx.type === "deposit_used") {
      return { label: "Paid with Account Credit", color: "bg-orange-100 text-orange-700" };
    }
    if (tx.type === "deposit_deduction") {
      return { label: "Deduct Credit from Account", color: "bg-rose-100 text-rose-700" };
    }
    if (tx.type === "payment_reverted") {
      return { label: "Payment Reverted", color: "bg-rose-100 text-rose-700" };
    }
    if (tx.type === "bulk_deposit_used") {
      if (singleBillBulkHistoryBillId) {
        return { label: "Paid with Account Credit", color: "bg-orange-100 text-orange-700" };
      }
      return { label: "Bulk Payment (Account Credit)", color: "bg-orange-100 text-orange-700" };
    }
    if (tx.type === "bulk_payment") {
      if (singleBillBulkHistoryBillId) {
        const method = String(tx.paymentMethod || "cash").trim().toLowerCase();
        switch (method) {
          case "cash":
            return { label: "Paid in Cash", color: "bg-purple-100 text-purple-700" };
          case "card":
            return { label: "Paid in Card", color: "bg-indigo-100 text-indigo-700" };
          case "transfer":
          case "bank":
            return { label: "Paid in Bank", color: "bg-cyan-100 text-cyan-700" };
          case "deposit":
            return { label: "Paid with Account Credit", color: "bg-orange-100 text-orange-700" };
          default:
            return {
              label: `Paid in ${formatClientHistoryPaymentMethodLabel(method)}`,
              color: "bg-gray-100 text-gray-700",
            };
        }
      }

      const method = formatClientHistoryPaymentMethodLabel(tx.paymentMethod || "cash");
      return { label: `Bulk Payment (${method})`, color: "bg-amber-100 text-amber-700" };
    }
    if (tx.type === "company_payment") {
      const method = formatClientHistoryPaymentMethodLabel(tx.paymentMethod || "cash");
      return { label: `Company Payment (${method})`, color: "bg-blue-100 text-blue-700" };
    }
    if (tx.type === "bill") {
      return { label: "Bill", color: "bg-slate-100 text-slate-700" };
    }
    if (tx.type === "payment" || tx.paymentMethod) {
      const method = String(tx.paymentMethod || "cash").trim().toLowerCase();
      switch (method) {
        case "cash":
          return { label: "Paid in Cash", color: "bg-purple-100 text-purple-700" };
        case "card":
          return { label: "Paid in Card", color: "bg-indigo-100 text-indigo-700" };
        case "transfer":
        case "bank":
          return { label: "Paid in Bank", color: "bg-cyan-100 text-cyan-700" };
        case "deposit":
          return { label: "Paid with Account Credit", color: "bg-orange-100 text-orange-700" };
        default:
          return {
            label: `Paid in ${formatClientHistoryPaymentMethodLabel(method)}`,
            color: "bg-gray-100 text-gray-700",
          };
      }
    }

    return { label: tx.type, color: "bg-gray-100 text-gray-700" };
  };

  const historyTransactionRows = useMemo(() => {
    if (visibleHistoryTransactions.length === 0) return [];

    let creditBalance = 0;

    return visibleHistoryTransactions.map((tx) => {
      if (tx.type === "deposit") {
        creditBalance += parseFloat(tx.amount || "0");
      } else if (isAccountCreditDeductionType(tx.type)) {
        creditBalance -= parseFloat(tx.amount || "0");
      }

      return {
        tx,
        creditBalance,
        typeDisplay: getHistoryTransactionTypeDisplay(tx),
      };
    });
  }, [visibleHistoryTransactions]);

  const filteredBillCount = filteredBills?.length || 0;
  const matchingBillCount = filteredBillCount;
  const loadMoreVisibleBills = useCallback(() => {
    if (activeTab !== "bills") return;

    setVisibleBillsCount((current) => {
      if (current >= filteredBillCount) {
        return current;
      }

      return Math.min(filteredBillCount, current + BILLS_LOAD_MORE_COUNT);
    });
  }, [activeTab, filteredBillCount]);

  const maybeLoadMoreVisibleBills = useCallback(
    (container?: HTMLDivElement | null) => {
      if (activeTab !== "bills" || !container) return;

      const remainingScroll =
        container.scrollHeight - container.scrollTop - container.clientHeight;

      if (remainingScroll > BILLS_LOAD_MORE_THRESHOLD_PX) {
        return;
      }

      loadMoreVisibleBills();
    },
    [activeTab, loadMoreVisibleBills],
  );

  const visibleBills = useMemo(() => {
    if (activeTab !== "bills") {
      return sortedBills || [];
    }

    return (sortedBills || []).slice(0, visibleBillsCount);
  }, [activeTab, sortedBills, visibleBillsCount]);

  useEffect(() => {
    setVisibleBillsCount(BILLS_INITIAL_LOAD_COUNT);
    setVisiblePaidByDateEntriesCount(BILLS_INITIAL_LOAD_COUNT);
    setVisibleClientGroupsCount(BILLS_INITIAL_LOAD_COUNT);
    setVisibleCompanyGroupsCount(BILLS_INITIAL_LOAD_COUNT);
    setVisibleBrokerGroupsCount(BILLS_INITIAL_LOAD_COUNT);
    billsListScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    groupedTabsScrollRootRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [
    activeTab,
    timePeriod,
    paymentFilter,
    billSort,
    searchTerm,
    billSearchFilters,
    exactDate,
    customDateFrom,
    customDateTo,
    billsRangeApplied,
  ]);

  useEffect(() => {
    if (activeTab !== "bills") return;

    setVisibleBillsCount((current) => {
      if (filteredBillCount === 0) {
        return BILLS_INITIAL_LOAD_COUNT;
      }

      return Math.min(Math.max(current, BILLS_INITIAL_LOAD_COUNT), filteredBillCount);
    });
  }, [activeTab, filteredBillCount]);

  useEffect(() => {
    if (activeTab !== "bills" || !highlightedBillId || !filteredBills?.length) return;

    const highlightedIndex = filteredBills.findIndex((bill) => bill.id === highlightedBillId);
    if (highlightedIndex < 0) return;

    setVisibleBillsCount((current) =>
      Math.max(current, Math.min(filteredBills.length, highlightedIndex + 1)),
    );
  }, [activeTab, filteredBills, highlightedBillId]);

  useEffect(() => {
    if (activeTab !== "bills" || !highlightedBillId) return;

    const billElement = document.querySelector(`[data-bill-id="${highlightedBillId}"]`);
    if (!billElement) return;

    billElement.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeTab, highlightedBillId, visibleBills]);

  useEffect(() => {
    if (activeTab !== "bills") return;
    maybeLoadMoreVisibleBills(billsListScrollRef.current);
  }, [activeTab, maybeLoadMoreVisibleBills, visibleBills]);

  const bulkClientOutstandingSummary = useMemo(() => {
    if (!bulkPaymentClientId || !bills) return null;

    const allUnpaidForClient = bills.filter((bill) => {
      if (bill.clientId !== bulkPaymentClientId) return false;
      return isBillOutstanding(bill);
    });
    const selectedForClient = allUnpaidForClient.filter((bill) => selectedBillIds.has(bill.id));
    const unpaidBills = selectedForClient.length > 0 ? selectedForClient : allUnpaidForClient;

    if (unpaidBills.length === 0) return null;

    const totals = getBillAggregateTotals(unpaidBills);

    return {
      billCount: unpaidBills.length,
      totalWorkReceived: totals.workReceived,
      totalDiscount: totals.discount,
      totalAmount: totals.finalAmount,
      totalPaid: totals.paidAmount,
      totalRemaining: totals.due,
    };
  }, [bulkPaymentClientId, bills, selectedBillIds, billDisplayAmountsById]);

  const companyPaymentOutstandingSummary = useMemo(() => {
    if (!companyPayment || !bills) return null;

    const normalizedCompanyName = companyPayment.companyName.trim().toUpperCase();
    const allUnpaidForCompany = bills.filter((bill) => {
      if (!bill.clientId || !isBillOutstanding(bill)) return false;
      const clientCompany = clientById.get(bill.clientId)?.company || "";
      return clientCompany.trim().toUpperCase() === normalizedCompanyName;
    });
    const selectedForCompany = allUnpaidForCompany.filter((bill) => selectedBillIds.has(bill.id));
    const unpaidBills = selectedForCompany.length > 0 ? selectedForCompany : allUnpaidForCompany;

    if (unpaidBills.length === 0) return null;

    const totals = getBillAggregateTotals(unpaidBills);
    const clientIds = Array.from(
      new Set(
        unpaidBills
          .map((bill) => bill.clientId)
          .filter((clientId): clientId is number => Number.isFinite(clientId)),
      ),
    );

    return {
      companyName: companyPayment.companyName,
      billIds: unpaidBills.map((bill) => bill.id),
      billCount: unpaidBills.length,
      clientIds,
      clientCount: clientIds.length,
      singleClientId: clientIds.length === 1 ? clientIds[0] : null,
      totalWorkReceived: totals.workReceived,
      totalDiscount: totals.discount,
      totalAmount: totals.finalAmount,
      totalPaid: totals.paidAmount,
      totalRemaining: totals.due,
    };
  }, [companyPayment, bills, selectedBillIds, billDisplayAmountsById, clientById]);

  const selectedBillsForPayment = useMemo(() => {
    if (selectedBillIds.size === 0) return [];

    return Array.from(selectedBillIds)
      .map((billId) => billsById.get(billId))
      .filter((bill): bill is BillWithPaymentRecorder => {
        if (!bill) return false;
        return getBillDisplayAmounts(bill).due > 0.01;
      });
  }, [billsById, getBillDisplayAmounts, selectedBillIds]);

  const selectedBillsHiddenBySearchCount = useMemo(
    () => selectedBillsForPayment.filter((bill) => !filteredBillsById.has(bill.id)).length,
    [filteredBillsById, selectedBillsForPayment],
  );
  const selectedBillsForRevert = useMemo(() => {
    if (selectedBillIds.size === 0) return [];

    return Array.from(selectedBillIds)
      .map((billId) => billsById.get(billId))
      .filter((bill): bill is BillWithPaymentRecorder => !!bill && isBillRevertable(bill));
  }, [billsById, selectedBillIds]);
  const selectedBillsForRevertTotal = useMemo(
    () => selectedBillsForRevert.reduce((sum, bill) => sum + getBillDisplayAmounts(bill).paidAmount, 0),
    [getBillDisplayAmounts, selectedBillsForRevert],
  );
  const selectedPaidBillsHiddenBySearchCount = useMemo(
    () => selectedBillsForRevert.filter((bill) => !filteredBillsById.has(bill.id)).length,
    [filteredBillsById, selectedBillsForRevert],
  );

  const selectedBillsOutstandingSummary = useMemo<SelectedBillsPaymentSummary | null>(() => {
    if (selectedBillsForPayment.length === 0) return null;

    const totals = getBillAggregateTotals(selectedBillsForPayment);
    const clientIds = Array.from(
      new Set(
        selectedBillsForPayment
          .map((bill) => bill.clientId)
          .filter((clientId): clientId is number => Number.isFinite(clientId)),
      ),
    );

    return {
      billIds: selectedBillsForPayment.map((bill) => bill.id),
      billCount: selectedBillsForPayment.length,
      clientIds,
      clientCount: clientIds.length,
      singleClientId: clientIds.length === 1 ? clientIds[0] : null,
      totalWorkReceived: totals.workReceived,
      totalDiscount: totals.discount,
      totalAmount: totals.finalAmount,
      totalPaid: totals.paidAmount,
      totalRemaining: totals.due,
      hasBillsWithoutClient: selectedBillsForPayment.some((bill) => !bill.clientId),
      sharedPaymentLabel: buildSharedBillsPaymentLabel(selectedBillsForPayment.length, clientIds.length),
    };
  }, [selectedBillsForPayment, billDisplayAmountsById]);

  const selectedBillsRevertSummary = useMemo<SelectedBillsRevertSummary | null>(() => {
    if (selectedBillsForRevert.length === 0) return null;

    const clientIds = Array.from(
      new Set(
        selectedBillsForRevert
          .map((bill) => bill.clientId)
          .filter((clientId): clientId is number => Number.isFinite(clientId)),
      ),
    );

    return {
      billIds: selectedBillsForRevert.map((bill) => bill.id),
      billCount: selectedBillsForRevert.length,
      clientIds,
      clientCount: clientIds.length,
      totalPaid: selectedBillsForRevertTotal,
    };
  }, [selectedBillsForRevert, selectedBillsForRevertTotal]);

  useEffect(() => {
    const hasPaymentSelection = selectedBillsForPayment.length > 0;
    const hasRevertSelection = selectedBillsForRevert.length > 0;

    if (hasPaymentSelection && selectedBillsFolderKind === "revert" && !hasRevertSelection) {
      setSelectedBillsFolderKind("payment");
      return;
    }

    if (hasRevertSelection && selectedBillsFolderKind === "payment" && !hasPaymentSelection) {
      setSelectedBillsFolderKind("revert");
      return;
    }

    if (hasPaymentSelection || hasRevertSelection) return;

    setIsSelectedBillsFolderOpen(false);
  }, [selectedBillsFolderKind, selectedBillsForPayment.length, selectedBillsForRevert.length]);

  const openRevertPaymentDialog = useCallback((billIds: number[], targetLabel: string) => {
    const normalizedBillIds = Array.from(
      new Set(billIds.map(Number).filter((billId) => Number.isFinite(billId) && billId > 0)),
    );
    if (normalizedBillIds.length === 0) return;

    setPendingRevertBillId(normalizedBillIds.length === 1 ? normalizedBillIds[0] : null);
    setPendingRevertBillIds(normalizedBillIds);
    setRevertPaymentTargetLabel(targetLabel);
    setRevertPaymentDialog(true);
    setRevertPaymentPin("");
    setRevertPaymentError("");
  }, []);

  const handleBulkRevertSelectedPayments = useCallback(() => {
    if (selectedBillsForRevert.length === 0) return;
    const billIds = selectedBillsForRevert.map((bill) => bill.id);
    openRevertPaymentDialog(
      billIds,
      `${selectedBillsForRevert.length} selected payment${selectedBillsForRevert.length === 1 ? "" : "s"}`,
    );
  }, [openRevertPaymentDialog, selectedBillsForRevert]);

  const selectableVisibleBills = useMemo(
    () => visibleBills.filter((bill) => isBillSelectableForBulkAction(bill)),
    [visibleBills, isBillSelectableForBulkAction],
  );
  const selectableFilteredBills = useMemo(
    () => (filteredBills || []).filter((bill) => isBillSelectableForBulkAction(bill)),
    [filteredBills, isBillSelectableForBulkAction],
  );
  const selectableFilteredBillCount = selectableFilteredBills.length;
  const hasMoreVisibleBills = visibleBills.length < filteredBillCount;
  const billsListControls = filteredBillCount > 0 ? (
    <div
      className={
        isMobile
          ? "mb-1 flex items-center gap-1 overflow-x-auto px-0.5 py-0.5 text-[8.5px] text-muted-foreground [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "flex items-center justify-between gap-3 px-4 py-2 text-xs text-muted-foreground md:px-2"
      }
    >
      <div className={isMobile ? "flex min-w-0 flex-nowrap items-center gap-1" : "flex flex-wrap items-center gap-2"}>
        <span className={isMobile ? "shrink-0 whitespace-nowrap" : undefined}>
          {isMobile
            ? `${visibleBills.length}/${matchingBillCount} bills`
            : `Showing ${visibleBills.length} of ${matchingBillCount} matching bills`}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={
            isMobile
              ? "!h-[18px] !min-h-0 shrink-0 rounded-md border-blue-200 bg-blue-50 px-1.5 !py-0 text-[9px] leading-none text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300"
              : "h-7 px-2 text-xs"
          }
          onClick={() => selectBills(selectableVisibleBills)}
          disabled={selectableVisibleBills.length === 0}
          data-testid="button-select-current-page-bills"
        >
          {isMobile ? `Loaded ${selectableVisibleBills.length}` : `Select loaded (${selectableVisibleBills.length})`}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={
            isMobile
              ? "!h-[18px] !min-h-0 shrink-0 rounded-md border-violet-200 bg-violet-50 px-1.5 !py-0 text-[9px] leading-none text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300"
              : "h-7 px-2 text-xs"
          }
          onClick={() => selectBills(selectableFilteredBills)}
          disabled={selectableFilteredBills.length === 0}
          data-testid="button-select-all-filtered-bills"
        >
          {isMobile ? `Filtered ${selectableFilteredBillCount}` : `Select all filtered (${selectableFilteredBillCount})`}
        </Button>
      </div>
      {!isMobile && (
        <span className="text-[11px] text-muted-foreground">
          {hasMoreVisibleBills ? `Scroll down to load ${BILLS_LOAD_MORE_COUNT} more` : "All matching bills loaded"}
        </span>
      )}
    </div>
  ) : null;

  const getClientTotalBill = (client: Client): number => {
    const baseBillAmount = parseFloat(client.amount || "0");
    return baseBillAmount + (billedOrdersTotalByClientId.get(client.id) || 0);
  };

  const verifyCreatorPinMutation = useMutation({
    mutationFn: async (pin: string) => {
      const res = await apiRequest("POST", "/api/workers/verify-pin", { pin });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success && pendingBillData) {
        createBillMutation.mutate({
          ...pendingBillData,
          createdByWorkerId: data.worker.id,
          createdBy: data.worker.name,
        });
        setShowCreatorPinDialog(false);
        setCreatorPin("");
        setCreatorPinError("");
        setPendingBillData(null);
      } else {
        setCreatorPinError("Invalid PIN. Please try again.");
      }
    },
    onError: () => {
      setCreatorPinError("Invalid PIN. Please try again.");
    },
  });

  const createBillMutation = useMutation({
    mutationFn: async (billData: {
      customerName: string;
      customerPhone?: string;
      amount: string;
      description: string;
      billDate: string;
      referenceNumber: string;
      createdByWorkerId?: number;
      createdBy?: string;
    }) => {
      const res = await apiRequest("POST", "/api/bills", billData);
      return res.json();
    },
    onSuccess: (bill: Bill) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });

      const items = Object.entries(selectedItems)
        .filter(([_, qty]) => qty > 0)
        .map(([productId, qty]) => {
          const product = products?.find((p) => p.id === parseInt(productId));
          return {
            name: product?.name || "Unknown",
            qty,
            price: parseFloat(product?.price || "0"),
          };
        });

      setCreatedBill({ bill, items });
      setIsCreateOpen(false);
      setSelectedItems({});
      setSelectedClientId("");
      setCustomerName("");
      setCustomerPhone("");
      setBillDescription("");

      toast({
        title: "Bill Created",
        description: "Invoice generated successfully.",
      });
    },
  });

  const getClientById = (clientId: number | null | undefined) => {
    if (!clientId) return null;
    return clientById.get(clientId) ?? null;
  };

  const getClientPaymentAccountDisplayLabel = (clientId: number | null | undefined) => {
    const client = getClientById(clientId);
    if (!client) return null;
    return client.billNumber ? `${client.name} (${client.billNumber})` : client.name;
  };

  const overpaymentCreditClientOptions = useMemo(
    () =>
      (selectedBillsPaymentSummary?.clientIds || companyPaymentOutstandingSummary?.clientIds || [])
        .map((clientId) => getClientById(clientId))
        .filter((client): client is Client => Boolean(client))
        .map((client) => ({
          value: String(client.id),
          label: client.billNumber ? `${client.name} (${client.billNumber})` : client.name,
        })),
    [selectedBillsPaymentSummary?.clientIds, companyPaymentOutstandingSummary?.clientIds, clientById],
  );

  const openClientTransactionHistory = (clientId: number | null | undefined) => {
    const client = getClientById(clientId);
    if (!client) {
      toast({
        title: "Client Not Found",
        description: "This bill is not linked to a client account.",
        variant: "destructive",
      });
      return;
    }

    setHistoryClient(client);
  };

  const getClientName = (clientId: number) => {
    return getClientById(clientId)?.name || "Unknown Client";
  };

  const sanitizePrintDocumentTitle = (value: string) => {
    const normalized = value
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return normalized || "Document";
  };

  const getStatementPrintDocumentTitle = (
    clientId: number | null | undefined,
    displayName: string,
  ) => {
    const accountNumber = getClientById(clientId)?.billNumber?.trim();
    return sanitizePrintDocumentTitle(accountNumber || displayName || "Statement");
  };

  const getIndividualBillPrintDocumentTitle = (bill: Bill) => {
    const client = getClientById(bill.clientId);
    const billNumber = String(bill.referenceNumber || `Bill-${bill.id}`).trim();
    const accountName = (bill.customerName || client?.name || "Customer").trim();
    const accountNumber = client?.billNumber?.trim();

    return sanitizePrintDocumentTitle(
      [billNumber, accountName, accountNumber].filter(Boolean).join(" - "),
    );
  };

  const addInvoicePdfHeader = (
    doc: PdfDoc,
    title: string,
    subtitleLines: string[] = [],
  ) => {
    const pageWidth = doc.internal.pageSize.getWidth();
    let cursorY = 12;
    let headerTextY = cursorY;

    if (logoBase64) {
      const logoWidth = 28;
      const logoHeight = 20;
      doc.addImage(
        logoBase64,
        "PNG",
        (pageWidth - logoWidth) / 2,
        cursorY,
        logoWidth,
        logoHeight,
      );
      headerTextY = cursorY + logoHeight + 8;
    } else {
      headerTextY = cursorY + 2;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(companyContact.companyName.toUpperCase(), pageWidth / 2, headerTextY, { align: "center" });
    cursorY = headerTextY + 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    [...companyAddressLines, companyPhoneLine].filter(Boolean).forEach((line) => {
      doc.text(String(line), pageWidth / 2, cursorY, { align: "center" });
      cursorY += 4;
    });

    cursorY += 2;
    doc.setDrawColor(30, 64, 175);
    doc.line(14, cursorY, pageWidth - 14, cursorY);
    cursorY += 7;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(title, pageWidth / 2, cursorY, { align: "center" });
    cursorY += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    subtitleLines.filter(Boolean).forEach((line) => {
      doc.text(line, pageWidth / 2, cursorY, { align: "center" });
      cursorY += 4.5;
    });

    return cursorY + 3;
  };

  const savePdfDocument = (doc: PdfDoc, documentTitle: string) => {
    doc.save(getPdfFileName(documentTitle));
  };

  const downloadGroupedBillsPdf = async ({
    clientId,
    displayName,
    phone,
    addressLines,
    bills,
    kind,
    isBroker = false,
  }: {
    clientId?: number | null;
    displayName: string;
    phone?: string | null;
    addressLines: string[];
    bills: Bill[];
    kind: "paid" | "unpaid";
    isBroker?: boolean;
  }) => {
    if (bills.length === 0) return;

    const { jsPDF, autoTable } = await loadPdfRuntime();
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const printTotals = getBillAggregateTotals(bills);
    const isPaidView = kind === "paid";
    const uniqueAddressLines = Array.from(new Set(addressLines.filter(Boolean)));
    const printDocumentTitle = getStatementPrintDocumentTitle(clientId, displayName);
    const accountNumber = getClientById(clientId ?? null)?.billNumber?.trim() || "";
    const includeClientColumn = bills.some((bill) => {
      const client = getClientById(bill.clientId);
      const name = bill.customerName || client?.name || "";
      return name.trim().toLowerCase() !== displayName.trim().toLowerCase();
    });

    let cursorY = addInvoicePdfHeader(doc, isPaidView ? "PAID BILLS SUMMARY" : "OUTSTANDING BILLS INVOICE", [
      `${displayName}${isBroker ? " (Broker)" : ""}`,
      `Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`,
    ]);

    const infoLines = [
      accountNumber ? `Acc #: ${accountNumber}` : "",
      phone ? `Phone: ${phone}` : "",
      ...uniqueAddressLines.map((line) => `Address: ${line}`),
    ].filter(Boolean);

    if (infoLines.length > 0) {
      doc.setFontSize(10);
      infoLines.forEach((line) => {
        doc.text(line, 14, cursorY);
        cursorY += 4.5;
      });
      cursorY += 2;
    }

    const tableMargin = { left: 14, right: 14 };
    const availableTableWidth =
      doc.internal.pageSize.getWidth() - tableMargin.left - tableMargin.right;
    const baseColumnWidths = includeClientColumn
      ? {
          billRef: 18,
          date: 15,
          client: 16,
          acc: 15,
          work: 12,
          disc: 12,
          final: 12,
          paid: 12,
          due: 12,
        }
      : {
          billRef: 18,
          date: 15,
          acc: 15,
          work: 12,
          disc: 12,
          final: 12,
          paid: 12,
          due: 12,
        };
    const fixedWidth = Object.values(baseColumnWidths).reduce((sum, width) => sum + width, 0);
    const descriptionWidth = Math.max(42, availableTableWidth - fixedWidth);

    const head = [[
      "Bill / Ref",
      "Date",
      ...(includeClientColumn ? ["Client"] : []),
      "Acc",
      "Description",
      "Work",
      "Disc.",
      "Final",
      "Paid",
      "Due",
    ]];

    const body = bills.map((bill) => {
      const client = getClientById(bill.clientId);
      const displayAmounts = getBillDisplayAmounts(bill);
      const row = [
        `#${bill.id}\n${String(bill.referenceNumber || "-")}`,
        format(new Date(bill.billDate), "dd/MM/yyyy"),
        ...(includeClientColumn ? [bill.customerName || client?.name || "-"] : []),
        client?.billNumber?.trim() || "-",
        bill.description || "-",
        displayAmounts.originalAmount.toFixed(2),
        displayAmounts.discount > 0 ? `-${displayAmounts.discount.toFixed(2)}` : "-",
        displayAmounts.finalAmount.toFixed(2),
        displayAmounts.paidAmount.toFixed(2),
        displayAmounts.due.toFixed(2),
      ];
      return row;
    });

    body.push([
      `Total (${bills.length})`,
      "",
      ...(includeClientColumn ? [""] : []),
      "",
      "",
      printTotals.workReceived.toFixed(2),
      printTotals.discount > 0 ? `-${printTotals.discount.toFixed(2)}` : "-",
      printTotals.finalAmount.toFixed(2),
      printTotals.paidAmount.toFixed(2),
      printTotals.due.toFixed(2),
    ]);

    autoTable(doc, {
      startY: cursorY,
      head,
      body,
      theme: "grid",
      margin: tableMargin,
      tableWidth: availableTableWidth,
      headStyles: { fillColor: [30, 64, 175], fontSize: 6.5, halign: "center", valign: "middle" },
      styles: { fontSize: 6.2, cellPadding: 1.2, overflow: "linebreak", valign: "top" },
      columnStyles: {
        0: { cellWidth: baseColumnWidths.billRef, halign: "center" },
        1: { cellWidth: baseColumnWidths.date, halign: "center" },
        ...(includeClientColumn ? { 2: { cellWidth: baseColumnWidths.client } } : {}),
        [includeClientColumn ? 3 : 2]: { cellWidth: baseColumnWidths.acc, halign: "center" },
        [includeClientColumn ? 4 : 3]: { cellWidth: descriptionWidth },
        [includeClientColumn ? 5 : 4]: { cellWidth: baseColumnWidths.work, halign: "right" },
        [includeClientColumn ? 6 : 5]: { cellWidth: baseColumnWidths.disc, halign: "right" },
        [includeClientColumn ? 7 : 6]: { cellWidth: baseColumnWidths.final, halign: "right" },
        [includeClientColumn ? 8 : 7]: { cellWidth: baseColumnWidths.paid, halign: "right" },
        [includeClientColumn ? 9 : 8]: { cellWidth: baseColumnWidths.due, halign: "right" },
      },
      footStyles: { fillColor: [245, 245, 245], textColor: 17 },
      didParseCell: (hookData) => {
        if (hookData.row.index === body.length - 1) {
          hookData.cell.styles.fontStyle = "bold";
          hookData.cell.styles.fillColor = [245, 245, 245];
        }
      },
    });

    const finalY = (doc as any).lastAutoTable?.finalY || cursorY;
    if (isPaidView) {
      const stampY = finalY + 8;
      doc.setDrawColor(34, 197, 94);
      doc.setLineWidth(0.8);
      doc.roundedRect(70, stampY, 70, 12, 2, 2);
      doc.setTextColor(34, 197, 94);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("FULLY PAID", 105, stampY + 8, { align: "center" });
      doc.setTextColor(17, 24, 39);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
    }

    const totalBannerY = finalY + (isPaidView ? 26 : 10);
    if (!isPaidView) {
      doc.setFillColor(254, 240, 138);
      doc.roundedRect(42, totalBannerY - 6, 126, 12, 2, 2, "F");
      doc.setTextColor(146, 64, 14);
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(
      isPaidView ? "FULLY PAID - THANK YOU!" : `TOTAL AMOUNT DUE: ${printTotals.due.toFixed(2)} AED`,
      doc.internal.pageSize.getWidth() / 2,
      totalBannerY,
      { align: "center" },
    );
    doc.setTextColor(17, 24, 39);

    savePdfDocument(doc, printDocumentTitle);
  };

  const downloadSingleBillPdf = async (
    bill: Bill,
    itemsOverride?: { name: string; qty: number; price: number; total?: number }[],
  ) => {
    const { jsPDF, autoTable } = await loadPdfRuntime();
    const parsedItems = (itemsOverride || parseDescriptionItems(bill.description || "", products)).map((item) => ({
      name: item.name,
      qty: item.qty,
      price: item.price,
      total: item.total ?? item.price * item.qty,
    }));
    const customerName = bill.customerName || getClientName(bill.clientId!);
    const customerAccountNumber = getClientById(bill.clientId)?.billNumber?.trim() || "";
    const displayAmounts = getBillDisplayAmounts(bill);
    const relatedOrder = firstOrderByBillId.get(bill.id);
    const priceAdjustReason = (bill as any).priceAdjustReason || relatedOrder?.priceAdjustReason;
    const billIsUrgent = Boolean(relatedOrder?.urgent);
    const subTotal = parsedItems.reduce((sum, item) => sum + item.total, 0);
    const adjustedTotal = relatedOrder?.adjustedTotal != null ? parseFloat(relatedOrder.adjustedTotal) : displayAmounts.originalAmount;
    const originalTotal = displayAmounts.originalAmount;
    const printDocumentTitle = getIndividualBillPrintDocumentTitle(bill);
    const parsedItemDisplayDetails = parsedItems.map((item) => getInvoiceItemDisplayDetails(item.name));
    const billTypeLabel = billIsUrgent ? "URGENT" : "NORMAL";
    const billTypeColor: [number, number, number] = billIsUrgent ? [220, 38, 38] : [22, 163, 74];

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    let cursorY = addInvoicePdfHeader(doc, "INVOICE", [
      `Ref: ${bill.referenceNumber || bill.id}`,
      `Bill #: ${bill.id}`,
      `Date: ${bill.billDate ? format(new Date(bill.billDate), "dd/MM/yyyy HH:mm") : "-"}`,
    ]);

    const customerInfoLines = [
      `Bill #: ${bill.id}`,
      `Customer: ${customerName}`,
      customerAccountNumber ? `Acc #: ${customerAccountNumber}` : "",
      getDisplayPhone(bill.customerPhone) ? `Phone: ${getDisplayPhone(bill.customerPhone)}` : "",
      bill.createdBy ? `Billed by: ${bill.createdBy}` : "",
    ].filter(Boolean);

    const customerBoxHeight = Math.max(14, (customerInfoLines.length + 1) * 5 + 4);
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(14, cursorY - 2, 182, customerBoxHeight, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(customerName, 18, cursorY + 3);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    let customerLineY = cursorY + 8;
    customerInfoLines.slice(1).forEach((line) => {
      doc.text(line, 18, customerLineY);
      customerLineY += 4.5;
    });
    doc.setTextColor(billTypeColor[0], billTypeColor[1], billTypeColor[2]);
    doc.setFont("helvetica", "bold");
    doc.text(`Bill Type: ${billTypeLabel}`, 18, customerLineY);
    doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "normal");
    cursorY += customerBoxHeight + 4;

    if (parsedItems.length > 0) {
      autoTable(doc, {
        startY: cursorY,
        head: [["S.No", "Item", "Qty", "Price", "Total"]],
        body: parsedItems.map((item, index) => [
          String(index + 1),
          "",
          String(item.qty),
          item.price.toFixed(2),
          item.total.toFixed(2),
        ]),
        theme: "grid",
        headStyles: { fillColor: [30, 64, 175], fontSize: 9 },
        styles: { fontSize: 9, cellPadding: 2, overflow: "linebreak" },
        columnStyles: { 1: { cellWidth: 90 } },
        didParseCell: (data) => {
          if (data.section !== "body" || data.column.index !== 1) {
            return;
          }

          data.cell.styles.minCellHeight = Math.max(Number(data.cell.styles.minCellHeight || 0), 8.5);
          data.cell.styles.valign = "middle";
        },
        didDrawCell: (data) => {
          if (data.section !== "body" || data.column.index !== 1) {
            return;
          }

          const displayDetails = parsedItemDisplayDetails[data.row.index];
          if (!displayDetails) {
            return;
          }

          const truncateText = (value: string, maxWidth: number) => {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
            if (maxWidth <= 6) return "";
            if (doc.getTextWidth(value) <= maxWidth) return value;
            let truncated = value;
            while (truncated.length > 0 && doc.getTextWidth(`${truncated}...`) > maxWidth) {
              truncated = truncated.slice(0, -1);
            }
            return truncated ? `${truncated}...` : value;
          };

          const boxSize = 2.8;
          const leftPadding = 2.4;
          const rightPadding = 2.4;
          const baselineY = data.cell.y + data.cell.height / 2 + 1.2;
          const packingOptionWidth = (label: string) => {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.5);
            return boxSize + 1.1 + doc.getTextWidth(label) + 4.5;
          };
          const packingWidth = displayDetails.packingType
            ? packingOptionWidth("Folding") + packingOptionWidth("Hanging") - 4.5
            : 0;
          const packingStartX = data.cell.x + data.cell.width - rightPadding - packingWidth;

          doc.setFont("helvetica", "bold");
          doc.setFontSize(8.6);
          const indicatorWidth = displayDetails.indicators.reduce((sum, indicator, index) => {
            const width = doc.getTextWidth(`[${indicator.label}]`);
            return sum + width + (index < displayDetails.indicators.length - 1 ? 1.8 : 0);
          }, 0);
          const availableNameWidth = Math.max(
            12,
            packingStartX - (data.cell.x + leftPadding) - indicatorWidth - (displayDetails.indicators.length > 0 ? 2.2 : 0),
          );
          const nameText = truncateText(displayDetails.displayName, availableNameWidth);

          doc.setTextColor(17, 24, 39);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.text(nameText, data.cell.x + leftPadding, baselineY);

          if (displayDetails.indicators.length > 0) {
            let indicatorX =
              data.cell.x + leftPadding + doc.getTextWidth(nameText) + 2.2;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8.6);

            displayDetails.indicators.forEach((indicator) => {
              const color =
                indicator.color === "#16a34a"
                  ? [22, 163, 74]
                  : indicator.color === "#dc2626"
                    ? [220, 38, 38]
                    : indicator.color === "#2563eb"
                      ? [37, 99, 235]
                      : [217, 119, 6];
              doc.setTextColor(color[0], color[1], color[2]);
              const indicatorText = `[${indicator.label}]`;
              doc.text(indicatorText, indicatorX, baselineY);
              indicatorX += doc.getTextWidth(indicatorText) + 1.8;
            });
          }

          const packingType = displayDetails.packingType;
          if (!packingType) {
            doc.setDrawColor(51, 51, 51);
            doc.setTextColor(17, 24, 39);
            doc.setFont("helvetica", "normal");
            doc.setLineWidth(0.2);
            doc.setFontSize(10);
            return;
          }

          let cursorX = packingStartX;
          const drawPackingOption = (label: string, checked: boolean) => {
            const boxY = baselineY - boxSize + 0.1;

            doc.setDrawColor(31, 41, 55);
            doc.setLineWidth(0.2);
            doc.rect(cursorX, boxY, boxSize, boxSize);

            if (checked) {
              doc.setDrawColor(220, 38, 38);
              doc.setLineWidth(0.45);
              doc.line(cursorX + 0.55, boxY + 1.45, cursorX + 1.15, boxY + 2.05);
              doc.line(cursorX + 1.1, boxY + 2.0, cursorX + 2.2, boxY + 0.75);
            }

            doc.setTextColor(55, 65, 81);
            doc.setFontSize(7.5);
            doc.text(label, cursorX + boxSize + 1.1, baselineY);
            cursorX += boxSize + 1.1 + doc.getTextWidth(label) + 4.5;
          };

          drawPackingOption("Folding", packingType === "folding");
          drawPackingOption("Hanging", packingType === "hanging");

          doc.setDrawColor(51, 51, 51);
          doc.setTextColor(17, 24, 39);
          doc.setFont("helvetica", "normal");
          doc.setLineWidth(0.2);
          doc.setFontSize(10);
        },
      });
      cursorY = ((doc as any).lastAutoTable?.finalY || cursorY) + 8;
    } else {
      cursorY += 4;
    }

    const summarySubTotal = parsedItems.length > 0 ? subTotal : displayAmounts.originalAmount;
    const summaryDeliveryCharge = Math.max(0, displayAmounts.deliveryCharge || 0);
    const summaryRows: Array<{
      label: string;
      value: string;
      color?: [number, number, number];
      bold?: boolean;
    }> = [
      { label: "Sub Total:", value: `AED ${summarySubTotal.toFixed(2)}` },
    ];
    if (adjustedTotal != null && Math.abs(adjustedTotal - originalTotal) > 0.009) {
      summaryRows.push({ label: "Original Total:", value: `AED ${originalTotal.toFixed(2)}`, color: [120, 120, 120] });
      summaryRows.push({ label: "Work Received:", value: `AED ${adjustedTotal.toFixed(2)}`, color: [30, 64, 175] });
    }
    if (displayAmounts.discount > 0) {
      summaryRows.push({ label: "Discount:", value: `-AED ${displayAmounts.discount.toFixed(2)}`, color: [234, 88, 12] });
    }
    summaryRows.push({ label: "Delivery Charge:", value: `AED ${summaryDeliveryCharge.toFixed(2)}` });
    summaryRows.push({ label: "Final Amount:", value: `AED ${displayAmounts.finalAmount.toFixed(2)}`, color: [21, 128, 61], bold: true });
    if (displayAmounts.paidAmount > 0) {
      summaryRows.push({ label: "Paid Amount:", value: `AED ${displayAmounts.paidAmount.toFixed(2)}` });
    }
    summaryRows.push({ label: "Balance Due:", value: `AED ${displayAmounts.due.toFixed(2)}`, color: [185, 28, 28], bold: true });

    const summaryBoxWidth = 118;
    const summaryBoxX = (doc.internal.pageSize.getWidth() - summaryBoxWidth) / 2;
    const summaryRowHeight = 6.5;
    const summaryBoxHeight = summaryRows.length * summaryRowHeight + 8 + (priceAdjustReason ? 8 : 0);
    doc.setDrawColor(209, 213, 219);
    doc.setFillColor(249, 250, 251);
    doc.roundedRect(summaryBoxX, cursorY - 4, summaryBoxWidth, summaryBoxHeight, 2, 2, "FD");

    summaryRows.forEach((row) => {
      const textColor = row.color || [17, 24, 39];
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.setFont("helvetica", row.bold ? "bold" : "normal");
      doc.setFontSize(row.bold ? 11 : 10);

      const labelX = summaryBoxX + 8;
      const valueX = summaryBoxX + summaryBoxWidth - 8;
      doc.text(row.label, labelX, cursorY);
      doc.text(row.value, valueX, cursorY, { align: "right" });

      const labelWidth = doc.getTextWidth(row.label);
      const valueWidth = doc.getTextWidth(row.value);
      const dashStartX = labelX + labelWidth + 3;
      const dashEndX = valueX - valueWidth - 3;
      const dashY = cursorY - 1.2;
      if (dashEndX > dashStartX) {
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.15);
        for (let x = dashStartX; x < dashEndX; x += 2) {
          doc.line(x, dashY, Math.min(x + 1, dashEndX), dashY);
        }
      }

      cursorY += summaryRowHeight;
    });

    doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    if (priceAdjustReason) {
      const reasonLines = doc.splitTextToSize(`Reason: ${priceAdjustReason}`, summaryBoxWidth - 16);
      doc.setFontSize(9);
      doc.text(reasonLines, summaryBoxX + 8, cursorY);
      cursorY += reasonLines.length * 4;
      doc.setFontSize(10);
    }

    if (bill.isPaid) {
      cursorY += 4;
      doc.setDrawColor(34, 197, 94);
      doc.setLineWidth(0.8);
      doc.roundedRect(63, cursorY, 84, 12, 2, 2);
      doc.setTextColor(34, 197, 94);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("FULLY PAID", 105, cursorY + 8, { align: "center" });
      doc.setTextColor(17, 24, 39);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      cursorY += 18;
      doc.text(
        `Payment Method: ${bill.paymentMethod === "deposit" ? "Account Credit" : formatPaymentMethodLabel(bill.paymentMethod || "cash")}`,
        105,
        cursorY,
        { align: "center" },
      );
      cursorY += 8;
      doc.setFont("helvetica", "bold");
      doc.text("FULLY PAID - THANK YOU!", 105, cursorY, { align: "center" });
    } else {
      cursorY += 6;
      doc.setFillColor(254, 240, 138);
      doc.roundedRect(42, cursorY - 6, 126, 12, 2, 2, "F");
      doc.setTextColor(146, 64, 14);
      doc.setFont("helvetica", "bold");
      doc.text(`TOTAL AMOUNT DUE: ${displayAmounts.due.toFixed(2)} AED`, 105, cursorY, { align: "center" });
      doc.setTextColor(17, 24, 39);
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Thank you for your business!", 105, cursorY + 10, { align: "center" });

    savePdfDocument(doc, printDocumentTitle);
  };

  const getClientAccountLabel = (clientId: number | null) => {
    if (!clientId) return null;
    const client = getClientById(clientId);
    if (!client) return null;
    const parts: string[] = [];
    if (client.billNumber) parts.push(client.billNumber);
    const isBroker = ((client as any).clientType || '').trim().toLowerCase() === 'broker';
    if (isBroker) {
      parts.push('Broker');
    } else if (client.company) {
      parts.push(client.company);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  const getBillClientDisplayName = (bill: Bill) => {
    const explicitCustomerName = String(bill.customerName || "").trim();
    if (explicitCustomerName) {
      return explicitCustomerName;
    }

    if (bill.clientId) {
      return getClientName(bill.clientId);
    }

    return "Walk-in Customer";
  };

  const sortBillsByClientThenDateAsc = (billList: Bill[]) => {
    return [...billList].sort((left, right) => {
      const clientDelta = getBillClientDisplayName(left).localeCompare(
        getBillClientDisplayName(right),
        undefined,
        { numeric: true, sensitivity: "base" },
      );
      if (clientDelta !== 0) {
        return clientDelta;
      }

      const dateDelta = new Date(left.billDate).getTime() - new Date(right.billDate).getTime();
      if (dateDelta !== 0) {
        return dateDelta;
      }

      return left.id - right.id;
    });
  };

  const groupBillsByClient = (billList: Bill[]) => {
    const grouped = new Map<string, { clientName: string; clientId: number | null; bills: Bill[] }>();

    sortBillsByClientThenDateAsc(billList).forEach((bill) => {
      const clientId = bill.clientId ?? null;
      const clientName = getBillClientDisplayName(bill);
      const clientKey = clientId ? `client-${clientId}` : `walk-in-${clientName.toUpperCase()}`;

      if (!grouped.has(clientKey)) {
        grouped.set(clientKey, {
          clientName,
          clientId,
          bills: [],
        });
      }

      grouped.get(clientKey)!.bills.push(bill);
    });

    return Array.from(grouped.entries());
  };

  const handleDelete = (billId: number) => {
    setPendingDeleteBillId(billId);
    setDeleteAdminPassword("");
    setDeleteAdminError("");
    setDeleteAdminDialog(true);
  };

  const performDelete = (billId: number, adminPin: string) => {
    deleteBill({ id: billId, adminPin }, {
      onSuccess: () => {
        setDeleteAdminDialog(false);
        setPendingDeleteBillId(null);
        setDeleteAdminPassword("");
        setDeleteAdminError("");
        toast({
          title: "Bill & Order Deleted",
          description: "The bill, linked order, and transactions have been removed.",
        });
      },
      onError: (error: Error) => {
        let message = "Failed to delete bill";
        try {
          const errorMsg = String(error.message || "");
          const msgMatch = errorMsg.match(/"message"\s*:\s*"([^"]+)"/);
          if (msgMatch) message = msgMatch[1];
        } catch {}
        setDeleteAdminError(message);
        toast({
          title: "Error",
          description: message,
          variant: "destructive",
        });
      },
    });
  };

  const handleAdminDeleteConfirm = async () => {
    if (!/^\d{5}$/.test(deleteAdminPassword.trim())) {
      setDeleteAdminError("Please enter the 5-digit admin PIN");
      return;
    }
    if (pendingDeleteBillId !== null) {
      performDelete(pendingDeleteBillId, deleteAdminPassword);
    }
  };

  const handleRevertPayment = (billId: number) => {
    openRevertPaymentDialog([billId], `bill #${billId}`);
  };

  const handleRevertPaymentConfirm = async () => {
    if (!/^\d{5}$/.test(revertPaymentPin.trim())) {
      setRevertPaymentError("Please enter the 5-digit admin PIN");
      return;
    }
    const billIdsToRevert =
      pendingRevertBillIds && pendingRevertBillIds.length > 0
        ? pendingRevertBillIds
        : pendingRevertBillId !== null
          ? [pendingRevertBillId]
          : [];
    if (billIdsToRevert.length === 0) return;
    try {
      const currentUser = localStorage.getItem("username") || "";
      const res =
        billIdsToRevert.length > 1
          ? await apiRequest("POST", "/api/bill-payments/revert-selected", {
              billIds: billIdsToRevert,
              adminPin: revertPaymentPin,
              revertedBy: currentUser,
            })
          : await apiRequest("POST", `/api/bills/${billIdsToRevert[0]}/revert-payment`, {
              adminPin: revertPaymentPin,
              revertedBy: currentUser,
            });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
        queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
        queryClient.invalidateQueries({ queryKey: ["/api/bill-payments"] });
        queryClient.invalidateQueries({ queryKey: ["/api/sales-data"] });
        queryClient.invalidateQueries({ queryKey: ["/api/reports/credit-transactions"] });
        toast({
          title: billIdsToRevert.length > 1 ? "Payments Reverted" : "Payment Reverted",
          description:
            billIdsToRevert.length > 1
              ? `${billIdsToRevert.length} selected payment${billIdsToRevert.length === 1 ? "" : "s"} reverted successfully.`
              : `Bill #${billIdsToRevert[0]} payment has been reverted successfully.`,
        });
        clearBillSelections(billIdsToRevert);
        setRevertPaymentDialog(false);
        setPendingRevertBillId(null);
        setPendingRevertBillIds(null);
        setRevertPaymentTargetLabel("this bill payment");
        setRevertPaymentPin("");
        setRevertPaymentError("");
        setViewBillDetails(null);
      } else {
        const data = await res.json();
        setRevertPaymentError(data.message || "Failed to revert payment");
      }
    } catch (error) {
      setRevertPaymentError(extractApiErrorMessage(error, "Failed to revert payment"));
    }
  };

  const handleCreateNewItem = () => {
    if (!newItemName.trim()) {
      toast({
        title: "Error",
        description: "Please enter item name",
        variant: "destructive",
      });
      return;
    }
    if (!newItemPrice.trim() || isNaN(parseFloat(newItemPrice))) {
      toast({
        title: "Error",
        description: "Please enter valid price",
        variant: "destructive",
      });
      return;
    }

    createProduct(
      {
        name: newItemName.trim(),
        price: newItemPrice.trim(),
        category: normalizeStoredProductCategoryName(newItemCategory),
        stockQuantity: 0,
      },
      {
        onSuccess: () => {
          setShowNewItemDialog(false);
          setNewItemName("");
          setNewItemPrice("");
          setNewItemCategory("");
          queryClient.invalidateQueries({ queryKey: ["/api/products"] });
        },
      },
    );
  };

  const updateItemQty = (productId: number, delta: number) => {
    setSelectedItems((prev) => {
      const current = prev[productId] || 0;
      const newQty = Math.max(0, current + delta);
      if (newQty === 0) {
        const { [productId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [productId]: newQty };
    });
  };

  const calculateTotal = () => {
    return Object.entries(selectedItems).reduce((total, [productId, qty]) => {
      const product = products?.find((p) => p.id === parseInt(productId));
      return total + parseFloat(product?.price || "0") * qty;
    }, 0);
  };

  const handleCreateBill = () => {
    if (!customerName.trim()) {
      toast({
        title: "Error",
        description: "Please enter customer name",
        variant: "destructive",
      });
      return;
    }
    const total = calculateTotal();
    if (total <= 0) {
      toast({
        title: "Error",
        description: "Please add at least one item",
        variant: "destructive",
      });
      return;
    }

    const itemsList = Object.entries(selectedItems)
      .filter(([_, qty]) => qty > 0)
      .map(([productId, qty]) => {
        const product = products?.find((p) => p.id === parseInt(productId));
        return `${product?.name} x${qty}`;
      })
      .join(", ");

    setPendingBillData({
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      amount: total.toFixed(2),
      description: billDescription || itemsList,
      billDate: new Date().toISOString(),
      referenceNumber: `BILL-${Date.now()}`,
    });
    setShowCreatorPinDialog(true);
  };

  const handleVerifyCreatorPin = () => {
    if (!creatorPin.trim()) {
      setCreatorPinError("Please enter your PIN");
      return;
    }
    verifyCreatorPinMutation.mutate(creatorPin);
  };

  const printInvoice = async () => {
    if (!createdBill) return;
    await downloadSingleBillPdf(createdBill.bill, createdBill.items);
  };

  const shareWhatsApp = () => {
    if (!createdBill) return;
    const billDate = createdBill.bill.billDate
      ? format(new Date(createdBill.bill.billDate), "dd/MM/yyyy HH:mm")
      : "";

    let itemsList = createdBill.items
      .map(
        (item) =>
          `${item.name} x${item.qty} = ${(item.price * item.qty).toFixed(2)} AED`,
      )
      .join("%0A");

    const trackingUrl = getPublicTrackingUrl();
    const companyLines = [
      `*${companyContact.companyName.toUpperCase()}*`,
      ...companyAddressLines,
      companyPhoneLine,
    ].filter(Boolean);
    const message = encodeURIComponent(
      [
        ...companyLines,
        "--------------------------------",
        "*INVOICE*",
        "--------------------------------",
        `Ref: ${createdBill.bill.referenceNumber}`,
        `Date: ${billDate}`,
        `Customer: ${createdBill.bill.customerName}`,
        "--------------------------------",
        "*Items:*",
        itemsList.replace(/%0A/g, "\n"),
        "--------------------------------",
        `*TOTAL: AED ${parseFloat(createdBill.bill.amount).toFixed(2)}*`,
        "--------------------------------",
        `Track your order at: ${trackingUrl}`,
        `Order Number: ${createdBill.bill.referenceNumber}`,
        "--------------------------------",
        "Thank you for your business!",
      ].join("\n"),
    );

    const phone = getDisplayPhone(createdBill.bill.customerPhone).replace(/\D/g, "") || "";
    window.open(`https://wa.me/${phone}?text=${message}`, "_blank");
  };

  // Verify cashier PIN before allowing payment (supports admin, manager, cashier, staff PINs)
  const verifyCashierPin = async () => {
    const normalizedPin = cashierPin.replace(/\D/g, "").slice(0, 5);
    if (normalizedPin.length !== 5) {
      setPinError("PIN must be 5 digits.");
      return;
    }

    try {
      const res = await fetch("/api/workers/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: normalizedPin }),
      });

      if (res.ok) {
        const data = await res.json();
        const verifiedCashierName = data.worker?.name || "Staff";
        setVerifiedCashier(verifiedCashierName);
        setVerifiedCashierPin(normalizedPin);
        setVerifiedCashierRole(data.worker?.role || null);
        setShowPinDialog(false);
        setCashierPin("");
        setPinError("");
        
        // Execute the pending payment action
        if (pendingPaymentAction) {
          if (pendingPaymentAction.type === 'bill' && pendingPaymentAction.bill) {
            proceedWithPayment(pendingPaymentAction.bill);
          } else if (pendingPaymentAction.type === 'client' && pendingPaymentAction.client) {
            proceedWithClientPayment(pendingPaymentAction.client, pendingPaymentAction.totalDue || 0);
          } else if (
            pendingPaymentAction.type === "selected-bills" &&
            pendingPaymentAction.selectedBillsSummary
          ) {
            proceedWithSelectedBillsPayment(pendingPaymentAction.selectedBillsSummary);
          }
          setPendingPaymentAction(null);
        }
      } else {
        setPinError("Invalid PIN. Please try again.");
      }
    } catch (err) {
      setPinError("Failed to verify PIN. Please try again.");
    }
  };

  const proceedWithPayment = (bill: Bill) => {
    const displayAmounts = getBillDisplayAmounts(bill);
    const remainingAmount = displayAmounts.due;

    if (bill.isPaid || remainingAmount <= 0.009) {
      toast({
        title: "Already Paid",
        description: `Bill #${bill.id} has already been paid.`,
      });
      return;
    }

    setBulkPaymentClientId(null);
    setCompanyPayment(null);
    setSelectedBillsPaymentSummary(null);
    setSelectedBill(bill);
    setPaymentAmount(remainingAmount.toFixed(2));
    setPaymentNotes("");
    setPaymentMethod("cash");
    setSplitPaymentEnabled(false);
    setSplitPaymentAmount("");
    setRemainingPaymentMethod("cash");
    setApplyDiscount(false);
    setDiscountAmount("");
    setSelectedBillsOverpaymentClientId("");
    setShowPaymentDialog(true);
  };

  const proceedWithSelectedBillsPayment = (summary: SelectedBillsPaymentSummary) => {
    if (summary.billCount === 0 || summary.totalRemaining <= 0.009) {
      toast({
        title: "No Unpaid Bills",
        description: "Select at least one unpaid bill to continue.",
        variant: "destructive",
      });
      return;
    }

    if (summary.hasBillsWithoutClient) {
      toast({
        title: "Client Account Required",
        description:
          "Selected shared-payment bills must belong to client accounts so transaction history can be recorded for each client.",
        variant: "destructive",
      });
      return;
    }

    setSelectedBill(null);
    setBulkPaymentClientId(null);
    setCompanyPayment(null);
    setSelectedBillsPaymentSummary(summary);
    setPaymentAmount(summary.totalRemaining.toFixed(2));
    setPaymentNotes(
      summary.sharedPaymentLabel ||
        `Payment for ${summary.billCount} selected bill${summary.billCount === 1 ? "" : "s"}`,
    );
    setPaymentMethod("cash");
    setSplitPaymentEnabled(false);
    setSplitPaymentAmount("");
    setRemainingPaymentMethod("cash");
    setApplyDiscount(false);
    setDiscountAmount("");
    setSelectedBillsOverpaymentClientId("");
    setShowPaymentDialog(true);
  };

  const handlePayNow = (bill: Bill, skipPin = false) => {
    setVerifiedCashier(null);
    setVerifiedCashierPin(null);
    setVerifiedCashierRole(null);

    if (skipPin) {
      // Direct payment without PIN (from Order Slip redirect)
      proceedWithPayment(bill);
    } else {
      // Require PIN verification first
      setPendingPaymentAction({ type: 'bill', bill });
      setShowPinDialog(true);
      setCashierPin("");
      setPinError("");
    }
  };

  // Handle payBill URL parameter - redirects from Orders/Delivery "Pay" buttons.
  const payBillHandled = useRef(false);
  useEffect(() => {
    if (urlPayBill && bills && !payBillHandled.current) {
      const billId = parseInt(urlPayBill);
      const bill = billsById.get(billId);
      payBillHandled.current = true;
      setLocation("/bills", { replace: true });
      setActiveTab("bills");
      if (bill && !bill.isPaid) {
        setTimeout(() => {
          handlePayNow(bill, !urlPayBillRequirePin);
        }, 200);
      } else if (bill && bill.isPaid) {
        toast({ title: "Already Paid", description: `Bill #${billId} has already been paid.` });
      }
    }
    if (!urlPayBill) {
      payBillHandled.current = false;
    }
  }, [urlPayBill, urlPayBillRequirePin, bills, billsById]);

  const printBillHandled = useRef(false);
  useEffect(() => {
    if (urlPrintBill && bills && !printBillHandled.current) {
      const billId = parseInt(urlPrintBill);
      const bill = billsById.get(billId);
      printBillHandled.current = true;
      setLocation("/bills", { replace: true });
      setActiveTab("bills");

      if (bill) {
        setTimeout(() => {
          void printBillPDF(bill);
        }, 200);
      } else {
        toast({
          title: "Bill not found",
          description: `Could not find Bill #${billId} to print.`,
          variant: "destructive",
        });
      }
    }
    if (!urlPrintBill) {
      printBillHandled.current = false;
    }
  }, [urlPrintBill, bills, billsById]);

  const payClientHandled = useRef(false);
  useEffect(() => {
    if (urlPayClient && bills && clients && !payClientHandled.current) {
      const clientId = parseInt(urlPayClient);
      if (!Number.isNaN(clientId)) {
        const client = clientById.get(clientId);
        const clientUnpaidBills = bills
          .filter((b) => b.clientId === clientId && isBillOutstanding(b))
          .sort((a, b) => new Date(a.billDate).getTime() - new Date(b.billDate).getTime());

        if (clientUnpaidBills.length > 0) {
          const totalDue = getBillAggregateTotals(clientUnpaidBills).due;
          setBulkPaymentClientId(clientId);
          setCompanyPayment(null);
          setSelectedBillsPaymentSummary(null);
          setSelectedBill(clientUnpaidBills[0]);
          setPaymentAmount(totalDue.toFixed(2));
          setPaymentMethod("cash");
          setSplitPaymentEnabled(false);
          setSplitPaymentAmount("");
          setRemainingPaymentMethod("cash");
          setPaymentNotes(`Payment for ${client?.name || "client"} outstanding bills`);
          setApplyDiscount(false);
          setDiscountAmount("");
          setShowPaymentDialog(true);
          setActiveTab("by-client");
        } else {
          toast({
            title: "No Unpaid Bills",
            description: "This client has no unpaid bills.",
          });
        }
      }
      payClientHandled.current = true;
      setLocation("/bills", { replace: true });
    }
    if (!urlPayClient) {
      payClientHandled.current = false;
    }
  }, [urlPayClient, bills, clients, clientById]);

  const payCompanyHandled = useRef(false);
  useEffect(() => {
    if (urlPayCompany && bills && clients && !payCompanyHandled.current) {
      const companyName = decodeURIComponent(urlPayCompany);
      const companyClientIds = clients
        .filter((c) => c.company && c.company.toUpperCase() === companyName.toUpperCase())
        .map((c) => c.id);
      const companyUnpaidBills = bills
        .filter((b) => b.clientId && companyClientIds.includes(b.clientId) && isBillOutstanding(b))
        .sort((a, b) => new Date(a.billDate).getTime() - new Date(b.billDate).getTime());

      if (companyUnpaidBills.length > 0) {
        const totalDue = getBillAggregateTotals(companyUnpaidBills).due;
        setCompanyPayment({ companyName, totalDue });
        setBulkPaymentClientId(null);
        setSelectedBillsPaymentSummary(null);
        setSelectedBill(companyUnpaidBills[0]);
        setPaymentAmount(totalDue.toFixed(2));
        setPaymentMethod("cash");
        setSplitPaymentEnabled(false);
        setSplitPaymentAmount("");
        setRemainingPaymentMethod("cash");
        setPaymentNotes(`Company payment for ${companyName}`);
        setApplyDiscount(false);
        setDiscountAmount("");
        setShowPaymentDialog(true);
        setActiveTab("by-company");
      } else {
        toast({
          title: "No Unpaid Bills",
          description: `No unpaid bills found for ${companyName}.`,
        });
      }

      payCompanyHandled.current = true;
      setLocation("/bills", { replace: true });
    }
    if (!urlPayCompany) {
      payCompanyHandled.current = false;
    }
  }, [urlPayCompany, bills, clients]);

  const requestBillPayment = async (data: {
    billId: number;
    amount: string;
    paymentMethod: string;
    notes?: string;
    processedBy?: string;
  }) => {
    const response = await apiRequest("POST", `/api/bills/${data.billId}/pay`, data);
    return response.json();
  };

  const requestClientBulkPayment = async (data: {
    clientId: number;
    amount: string;
    paymentMethod: string;
    notes?: string;
    processedBy?: string;
    discountAmount?: string;
    billIds?: number[];
    staffPin?: string;
  }) => {
    const response = await apiRequest("POST", `/api/clients/${data.clientId}/pay-all-bills`, data);
    return response.json();
  };

  const requestCompanyBulkPayment = async (data: {
    companyName: string;
    amount: string;
    paymentMethod: string;
    notes?: string;
    processedBy?: string;
    discountAmount?: string;
    billIds?: number[];
    overpaymentClientId?: number;
    staffPin?: string;
  }) => {
    const response = await apiRequest("POST", `/api/companies/pay-all-bills`, data);
    return response.json();
  };

  const requestSelectedBillsPayment = async (data: {
    billIds: number[];
    amount: string;
    paymentMethod: string;
    notes?: string;
    discountAmount?: string;
    processedBy?: string;
    overpaymentClientId?: number;
    staffPin?: string;
  }) => {
    const selectedBillSet = new Set(
      (data.billIds || []).map(Number).filter((billId) => Number.isFinite(billId)),
    );

    const fallbackSelectedBillsPayment = async () => {
      const [freshBillsResponse, freshClientsResponse] = await Promise.all([
        apiRequest("GET", "/api/bills"),
        apiRequest("GET", "/api/clients"),
      ]);
      const [freshBills, freshClients]: [Bill[], Client[]] = await Promise.all([
        freshBillsResponse.json(),
        freshClientsResponse.json(),
      ]);

      const targetBills = (freshBills || [])
        .filter((bill: Bill) => selectedBillSet.has(bill.id))
        .filter((bill: Bill) => {
          const amount = parseFloat(String(bill.amount || "0"));
          const paid = parseFloat(String(bill.paidAmount || "0"));
          return Math.max(0, amount - paid) > 0.01;
        })
        .sort((left: Bill, right: Bill) => {
          const leftTime = left.billDate ? new Date(left.billDate).getTime() : 0;
          const rightTime = right.billDate ? new Date(right.billDate).getTime() : 0;
          if (leftTime !== rightTime) {
            return leftTime - rightTime;
          }
          return left.id - right.id;
        });

      if (targetBills.length === 0) {
        throw new Error("No unpaid selected bills found");
      }

      const affectedClientIds = Array.from(
        new Set(
          targetBills
            .map((bill: Bill) => bill.clientId)
            .filter(
              (clientId: number | null | undefined): clientId is number =>
                Number.isFinite(clientId),
            ),
        ),
      );

      if (targetBills.some((bill: Bill) => !bill.clientId)) {
        throw new Error(
          "Selected bills must be linked to client accounts so payment history can be recorded.",
        );
      }

      const paymentAmountRaw = parseFloat(String(data.amount || "0"));
      let remainingPayment = Number.isFinite(paymentAmountRaw) ? Math.max(0, paymentAmountRaw) : 0;
      let remainingDiscount = Math.max(0, parseFloat(String(data.discountAmount || "0")) || 0);
      const normalizedOverpaymentClientId = Number(data.overpaymentClientId);

      if (data.paymentMethod === "deposit") {
        if (affectedClientIds.length !== 1) {
          throw new Error(
            "Credit payment is only available when all selected bills belong to one client.",
          );
        }
      }

      const sharedNotes = appendSharedPaymentTag(
        data.notes,
        targetBills.length,
        affectedClientIds.length,
      );

      const discountAllocations: Array<{
        billId: number;
        discountApplied: number;
        newAmount: string;
      }> = [];
      const dueAfterDiscountByBillId = new Map<number, number>();

      for (const bill of targetBills) {
        const currentFinalAmount = Math.max(0, parseFloat(String(bill.amount || "0")) || 0);
        const currentPaidAmount = Math.max(0, parseFloat(String(bill.paidAmount || "0")) || 0);
        const currentDiscount = Math.max(0, parseFloat(String(bill.discountAmount || "0")) || 0);
        const originalAmountRaw = parseFloat(String((bill as any).originalAmount ?? ""));
        const originalAmount =
          Number.isFinite(originalAmountRaw) && String((bill as any).originalAmount ?? "").trim() !== ""
            ? Math.max(0, originalAmountRaw)
            : Math.max(0, currentFinalAmount + currentDiscount);
        const currentDue = Math.max(0, currentFinalAmount - currentPaidAmount);
        const discountForBill = Math.min(remainingDiscount, currentDue);

        if (discountForBill > 0.009) {
          const newDiscountTotal = currentDiscount + discountForBill;
          await apiRequest("POST", `/api/bills/${bill.id}/apply-discount`, {
            discountAmount: newDiscountTotal.toFixed(2),
            appliedBy: data.processedBy || undefined,
            staffPin: data.staffPin,
          });

          remainingDiscount -= discountForBill;
          discountAllocations.push({
            billId: bill.id,
            discountApplied: discountForBill,
            newAmount: Math.max(0, originalAmount - newDiscountTotal).toFixed(2),
          });
        }

        dueAfterDiscountByBillId.set(bill.id, Math.max(0, currentDue - discountForBill));
      }

      const totalDueAfterDiscount = Array.from(dueAfterDiscountByBillId.values()).reduce(
        (sum, value) => sum + value,
        0,
      );

      if (
        data.paymentMethod !== "deposit" &&
        paymentAmountRaw > totalDueAfterDiscount + 0.01 &&
        affectedClientIds.length > 1 &&
        (!Number.isFinite(normalizedOverpaymentClientId) ||
          !affectedClientIds.includes(normalizedOverpaymentClientId))
      ) {
        throw new Error("Select which client account should receive the overpayment credit.");
      }

      if (data.paymentMethod === "deposit" && remainingPayment > 0.009) {
        const activeClient = (freshClients || []).find(
          (client: Client) => client.id === affectedClientIds[0],
        );
        const currentDeposit = parseFloat(String(activeClient?.deposit || "0"));
        if (!Number.isFinite(currentDeposit) || currentDeposit + 0.009 < remainingPayment) {
          throw new Error(
            `Insufficient credit balance. Available: ${Math.max(0, currentDeposit || 0).toFixed(2)} AED, Required: ${remainingPayment.toFixed(2)} AED`,
          );
        }
      }

      const paidBills: Array<{ billId: number; clientId: number; amountPaid: number }> = [];

      for (const bill of targetBills) {
        if (remainingPayment <= 0.009) break;

        const adjustedDue =
          dueAfterDiscountByBillId.get(bill.id) ??
          Math.max(
            0,
            (parseFloat(String(bill.amount || "0")) || 0) - (parseFloat(String(bill.paidAmount || "0")) || 0),
          );
        if (adjustedDue <= 0.009) continue;

        const paymentForBill = Math.min(remainingPayment, adjustedDue);
        if (paymentForBill <= 0.009) continue;

        await requestBillPayment({
          billId: bill.id,
          amount: paymentForBill.toFixed(2),
          paymentMethod: data.paymentMethod,
          notes: sharedNotes,
          processedBy: data.processedBy,
        });

        paidBills.push({
          billId: bill.id,
          clientId: bill.clientId as number,
          amountPaid: paymentForBill,
        });
        remainingPayment -= paymentForBill;
      }

      const paidTotal = paidBills.reduce((sum, bill) => sum + bill.amountPaid, 0);
      const appliedDiscountTotal = discountAllocations.reduce(
        (sum, entry) => sum + entry.discountApplied,
        0,
      );
      let creditedAmount = 0;
      let creditedClientId: number | undefined;

      if (remainingPayment > 0.01 && data.paymentMethod !== "deposit") {
        const creditClientId =
          affectedClientIds.length === 1
            ? affectedClientIds[0]
            : normalizedOverpaymentClientId;

        if (!Number.isFinite(creditClientId) || !affectedClientIds.includes(creditClientId)) {
          throw new Error("Select which client account should receive the overpayment credit.");
        }

        const billReferences = targetBills.map((bill) => `#${bill.id}`).join(", ");
        const trimmedNotes = String(data.notes || "").trim();
        const descriptionParts = [
          "Credit added from selected bills overpayment",
          billReferences ? `Bills: ${billReferences}` : "",
          trimmedNotes,
        ].filter(Boolean);

        await apiRequest("POST", `/api/clients/${creditClientId}/deposit`, {
          amount: remainingPayment.toFixed(2),
          description: descriptionParts.join(" | "),
          paymentMethod: data.paymentMethod,
          processedBy: data.processedBy || "admin",
        });

        creditedAmount = remainingPayment;
        creditedClientId = creditClientId;
        remainingPayment = 0;
      }

      const creditedClient = creditedClientId
        ? (freshClients || []).find((client: Client) => client.id === creditedClientId)
        : null;
      const creditedAccountLabel = creditedClient
        ? creditedClient.billNumber
          ? `${creditedClient.name} (${creditedClient.billNumber})`
          : creditedClient.name
        : null;

      return {
        success: true,
        message: `Payment ${paidTotal.toFixed(2)} AED and discount ${appliedDiscountTotal.toFixed(2)} AED applied to ${targetBills.length} selected bill(s).${creditedAmount > 0.01 && creditedAccountLabel ? ` Overpayment ${creditedAmount.toFixed(2)} AED added to ${creditedAccountLabel}.` : ""}`,
        paidBills,
        affectedClientIds,
        discountAllocations,
        creditedAmount: creditedAmount > 0.01 ? creditedAmount.toFixed(2) : "0.00",
        creditedClientId,
        remainingAmount: remainingPayment > 0.01 ? remainingPayment : 0,
        unappliedDiscount: remainingDiscount > 0.01 ? remainingDiscount : 0,
      };
    };

    const response = await apiRequest("POST", "/api/bills/pay-selected", data);
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.toLowerCase().includes("application/json")) {
      return fallbackSelectedBillsPayment();
    }

    try {
      return await response.json();
    } catch {
      return fallbackSelectedBillsPayment();
    }
  };

  const invalidatePaymentQueries = (
    clientIds?: number | null | Array<number | null | undefined>,
  ) => {
    queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-count"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-selection"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders/active-with-clients"] });
    queryClient.invalidateQueries({ queryKey: ["/api/bill-payments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/daily-sales"] });
    queryClient.invalidateQueries({ queryKey: ["/api/company-payment-transactions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/reports/credit-transactions"] });

    const normalizedClientIds = Array.isArray(clientIds) ? clientIds : [clientIds];
    normalizedClientIds
      .filter((clientId): clientId is number => Number.isFinite(clientId))
      .forEach((clientId) => {
        queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "bills"] });
        queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "unpaid-bills"] });
        queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "unpaid-balance"] });
        queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "transactions"] });
      });
  };

  const resetTransferBillDialog = () => {
    setTransferBillDialog(null);
    setTransferTargetClientId("");
    setTransferBillSearch("");
    setTransferBillAdminPin("");
    setTransferBillReason("");
  };

  const openTransferBillDialog = (bill: BillWithPaymentRecorder) => {
    setTransferBillDialog(bill);
    setTransferTargetClientId("");
    setTransferBillSearch("");
    setTransferBillAdminPin("");
    setTransferBillReason("");
  };

  const closePaymentDialog = (clearSelections = false) => {
    setShowPaymentDialog(false);
    setSelectedBill(null);
    setBulkPaymentClientId(null);
    setCompanyPayment(null);
    setSelectedBillsPaymentSummary(null);
    setPaymentAmount("");
    setPaymentMethod("cash");
    setSplitPaymentEnabled(false);
    setSplitPaymentAmount("");
    setRemainingPaymentMethod("cash");
    setPaymentNotes("");
    setApplyDiscount(false);
    setDiscountAmount("");
    setIsSplitPaymentSubmitting(false);
    setSelectedBillsOverpaymentClientId("");
    if (clearSelections) {
      setSelectedBillIds(new Set());
    }
  };

  const handlePaySelectedBills = () => {
    if (!selectedBillsOutstandingSummary) {
      toast({
        title: "No Bills Selected",
        description: "Select one or more unpaid bills first.",
        variant: "destructive",
      });
      return;
    }

    setPendingPaymentAction({
      type: "selected-bills",
      selectedBillsSummary: selectedBillsOutstandingSummary,
      totalDue: selectedBillsOutstandingSummary.totalRemaining,
    });
    setShowPinDialog(true);
    setCashierPin("");
    setPinError("");
  };

  const payBillMutation = useMutation({
    mutationFn: async (data: {
      billId: number;
      amount: string;
      paymentMethod: string;
      notes?: string;
      processedBy?: string;
    }) => requestBillPayment(data),
    onSuccess: () => {
      invalidatePaymentQueries(selectedBill?.clientId);
      closePaymentDialog(true);
      toast({
        title: "Payment Successful",
        description: "Bill has been paid successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Payment Failed",
        description: error.message || "Failed to process payment.",
        variant: "destructive",
      });
    },
  });

  const payAllBillsMutation = useMutation({
    mutationFn: async (data: {
      clientId: number;
      amount: string;
      paymentMethod: string;
      notes?: string;
      processedBy?: string;
      discountAmount?: string;
      billIds?: number[];
      staffPin?: string;
    }) => requestClientBulkPayment(data),
    onSuccess: (data) => {
      invalidatePaymentQueries(bulkPaymentClientId);
      closePaymentDialog(true);
      toast({
        title: "Payment Successful",
        description: data.message || "Bulk payment completed successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Payment Failed",
        description: error.message || "Failed to process payment.",
        variant: "destructive",
      });
    },
  });

  const payCompanyBillsMutation = useMutation({
    mutationFn: async (data: {
      companyName: string;
      amount: string;
      paymentMethod: string;
      notes?: string;
      processedBy?: string;
      discountAmount?: string;
      billIds?: number[];
      overpaymentClientId?: number;
      staffPin?: string;
    }) => requestCompanyBulkPayment(data),
    onSuccess: (data) => {
      invalidatePaymentQueries(data?.affectedClientIds ?? data?.creditedClientId ?? undefined);
      closePaymentDialog(true);
      toast({
        title: "Company Payment Successful",
        description: data.message || "Company bulk payment completed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Payment Failed",
        description: error.message || "Failed to process company payment.",
        variant: "destructive",
      });
    },
  });

  const paySelectedBillsMutation = useMutation({
    mutationFn: async (data: {
      billIds: number[];
      amount: string;
      paymentMethod: string;
      notes?: string;
      discountAmount?: string;
      processedBy?: string;
      overpaymentClientId?: number;
      staffPin?: string;
    }) => requestSelectedBillsPayment(data),
    onSuccess: (data) => {
      invalidatePaymentQueries(data?.affectedClientIds);
      closePaymentDialog(true);
      toast({
        title: "Payment Successful",
        description: data.message || "Selected bills were paid successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Payment Failed",
        description: error.message || "Failed to process selected bills payment.",
        variant: "destructive",
      });
    },
  });

  const updatePaymentMethodMutation = useMutation({
    mutationFn: async (data: { billId: number; paymentMethod: string }) => {
      const response = await apiRequest("PATCH", `/api/bills/${data.billId}/payment-method`, { paymentMethod: data.paymentMethod });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bill-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/credit-transactions"] });
      toast({
        title: "Payment Method Updated",
        description: "The payment method has been changed successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update payment method.",
        variant: "destructive",
      });
    },
  });

  const transferBillMutation = useMutation({
    mutationFn: async (data: {
      billId: number;
      targetClientId: number;
      adminPin: string;
      reason?: string;
      processedBy?: string;
    }) => {
      const response = await apiRequest("POST", `/api/bills/${data.billId}/transfer-client`, data);
      return response.json();
    },
    onSuccess: (data) => {
      invalidatePaymentQueries([data?.sourceClientId, data?.targetClientId]);
      const updatedBill = data?.bill as BillWithPaymentRecorder | undefined;
      resetTransferBillDialog();
      if (updatedBill) {
        setViewBillDetails(updatedBill);
      }
      toast({
        title: "Bill Transferred",
        description: data?.message || "The bill was transferred to the selected client account.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Transfer Failed",
        description: error.message || "Failed to transfer the bill to another client account.",
        variant: "destructive",
      });
    },
  });

  const updateBillDiscountMutation = useMutation({
    mutationFn: async (data: {
      billId: number;
      discountAmount: string;
      staffPin: string;
      appliedBy?: string;
    }) => {
      const response = await apiRequest("POST", `/api/bills/${data.billId}/apply-discount`, {
        discountAmount: data.discountAmount,
        staffPin: data.staffPin,
        appliedBy: data.appliedBy || verifiedCashier || localStorage.getItem("username") || undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-payment-transactions"] });
      toast({
        title: "Discount Updated",
        description: "Bill and linked order amounts were recalculated.",
      });
      setEditingDiscountBillId(null);
      setEditingDiscountValue("");
      setEditingDiscountStaffPin("");
      setEditingDiscountAppliedBy("");
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: extractApiErrorMessage(error, "Failed to update discount."),
        variant: "destructive",
      });
    },
  });

  const handleTransferBillSubmit = async () => {
    if (!transferBillDialog) {
      return;
    }

    const targetClientId = Number(transferTargetClientId);
    if (!Number.isFinite(targetClientId) || targetClientId <= 0) {
      toast({
        title: "Select Client",
        description: "Choose the client account that should receive this bill.",
        variant: "destructive",
      });
      return;
    }

    if (transferBillAdminPin.trim().length !== 5) {
      toast({
        title: "Admin PIN Required",
        description: "Enter the 5-digit admin PIN to confirm the transfer.",
        variant: "destructive",
      });
      return;
    }

    await transferBillMutation.mutateAsync({
      billId: transferBillDialog.id,
      targetClientId,
      adminPin: transferBillAdminPin.trim(),
      reason: transferBillReason.trim() || undefined,
      processedBy: verifiedCashier || localStorage.getItem("username") || undefined,
    });
  };

  const submitBillDiscountEdit = async (bill: Bill) => {
    if (bill.isPaid) {
      toast({
        title: "Discount Locked",
        description: "Cannot edit discount for a fully paid bill.",
        variant: "destructive",
      });
      setEditingDiscountBillId(null);
      setEditingDiscountValue("");
      return;
    }

    const nextDiscount = parseFloat(editingDiscountValue || "0");
    if (!Number.isFinite(nextDiscount) || nextDiscount < 0) {
      toast({
        title: "Invalid Discount",
        description: "Please enter a valid non-negative amount.",
        variant: "destructive",
      });
      return;
    }

    const billOriginalAmount = getBillDisplayAmounts(bill).originalAmount;
    if (nextDiscount > billOriginalAmount + 0.009) {
      toast({
        title: "Invalid Discount",
        description: `Discount cannot exceed bill amount (${billOriginalAmount.toFixed(2)} AED).`,
        variant: "destructive",
      });
      return;
    }

    const currentDiscount = parseFloat(bill.discountAmount || "0");
    if (Math.abs(currentDiscount - nextDiscount) < 0.009) {
      setEditingDiscountBillId(null);
      setEditingDiscountValue("");
      setEditingDiscountStaffPin("");
      setEditingDiscountAppliedBy("");
      return;
    }

    if (!editingDiscountStaffPin) {
      setDiscountPinDialogBill(bill);
      setDiscountPin("");
      setDiscountPinError("Enter admin or counter PIN to update the discount.");
      return;
    }

    await updateBillDiscountMutation.mutateAsync({
      billId: bill.id,
      discountAmount: nextDiscount.toFixed(2),
      staffPin: editingDiscountStaffPin,
      appliedBy: editingDiscountAppliedBy || undefined,
    });
  };

  const cancelBillDiscountEdit = () => {
    setEditingDiscountBillId(null);
    setEditingDiscountValue("");
    setEditingDiscountStaffPin("");
    setEditingDiscountAppliedBy("");
  };

  const openBillDiscountEdit = (bill: Bill) => {
    if (bill.isPaid || editingDiscountBillId === bill.id) return;
    pendingBillDiscountFocusIdRef.current = null;
    setDiscountPinDialogBill(bill);
    setDiscountPin("");
    setDiscountPinError("");
    clearDiscountPinPreview();
  };

  const verifyBillDiscountPin = async () => {
    const targetBill = discountPinDialogBill;
    const normalizedPin = discountPin.replace(/\D/g, "").slice(0, 5);
    if (!targetBill) return;
    if (normalizedPin.length !== 5) {
      setDiscountPinError("Please enter the 5-digit admin or counter PIN.");
      return;
    }

    setIsDiscountPinVerifying(true);
    setDiscountPinError("");
    try {
      const response = await apiRequest("POST", "/api/discounts/verify-pin", {
        pin: normalizedPin,
      });
      const data = await response.json();
      pendingBillDiscountFocusIdRef.current = targetBill.id;
      setEditingDiscountBillId(targetBill.id);
      setEditingDiscountValue(parseFloat(targetBill.discountAmount || "0").toFixed(2));
      setEditingDiscountStaffPin(normalizedPin);
      setEditingDiscountAppliedBy(data.member?.name || "");
      setDiscountPinDialogBill(null);
      setDiscountPin("");
      clearDiscountPinPreview();
    } catch (error: any) {
      setDiscountPinError(extractApiErrorMessage(error, "Invalid admin or counter PIN."));
    } finally {
      setIsDiscountPinVerifying(false);
    }
  };

  const renderBillDiscountEditor = (
    bill: Bill,
    discount: number,
    inputTestId: string,
    inputClassName = "ml-auto h-7 w-24 text-right text-xs",
  ) => {
    if (editingDiscountBillId === bill.id) {
      return (
        <Input
          type="number"
          step="0.01"
          min="0"
          autoFocus
          value={editingDiscountValue}
          onChange={(event) => setEditingDiscountValue(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onBlur={cancelBillDiscountEdit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submitBillDiscountEdit(bill);
            }
            if (event.key === "Escape") {
              cancelBillDiscountEdit();
            }
          }}
          disabled={updateBillDiscountMutation.isPending}
          className={inputClassName}
          data-testid={inputTestId}
        />
      );
    }

    return (
      <span className="inline-flex w-full items-center justify-end gap-1">
        <span>{discount > 0 ? `-${discount.toFixed(2)}` : "-"}</span>
        {!bill.isPaid && <Edit className="h-3 w-3 text-orange-500" />}
      </span>
    );
  };

  const requestedPaymentAmount = parseFloat(paymentAmount || "0");
  const normalizedRequestedPaymentAmount = Number.isFinite(requestedPaymentAmount)
    ? requestedPaymentAmount
    : 0;
  const requestedDiscountAmount = parseFloat(discountAmount || "0");
  const normalizedRequestedDiscountAmount =
    applyDiscount && Number.isFinite(requestedDiscountAmount) ? Math.max(0, requestedDiscountAmount) : 0;
  const requestedSplitPaymentAmount = parseFloat(splitPaymentAmount || "0");
  const normalizedSplitPaymentAmount = Number.isFinite(requestedSplitPaymentAmount)
    ? requestedSplitPaymentAmount
    : 0;
  const splitRemainingAmount = splitPaymentEnabled
    ? Math.max(0, normalizedRequestedPaymentAmount - normalizedSplitPaymentAmount)
    : 0;
  const hasActiveSplitPayment =
    splitPaymentEnabled &&
    normalizedSplitPaymentAmount > 0.009 &&
    splitRemainingAmount > 0.009;
  const splitUsesDeposit = splitPaymentEnabled
    ? paymentMethod === "deposit" || (hasActiveSplitPayment && remainingPaymentMethod === "deposit")
    : paymentMethod === "deposit";
  const bulkClientDiscountToApply = bulkClientOutstandingSummary
    ? Math.min(normalizedRequestedDiscountAmount, bulkClientOutstandingSummary.totalRemaining)
    : 0;
  const bulkClientExpectedDueAfterDiscount = bulkClientOutstandingSummary
    ? Math.max(0, bulkClientOutstandingSummary.totalRemaining - bulkClientDiscountToApply)
    : 0;
  const bulkClientExpectedOverpayment = bulkClientOutstandingSummary
    ? Math.max(0, normalizedRequestedPaymentAmount - bulkClientExpectedDueAfterDiscount)
    : 0;
  const bulkPaymentOverpaymentCreatesCredit =
    !!bulkClientOutstandingSummary &&
    (splitPaymentEnabled
      ? paymentMethod !== "deposit" || remainingPaymentMethod !== "deposit"
      : paymentMethod !== "deposit");
  const companyPaymentDiscountToApply = companyPaymentOutstandingSummary
    ? Math.min(normalizedRequestedDiscountAmount, companyPaymentOutstandingSummary.totalRemaining)
    : 0;
  const companyPaymentExpectedDueAfterDiscount = companyPaymentOutstandingSummary
    ? Math.max(0, companyPaymentOutstandingSummary.totalRemaining - companyPaymentDiscountToApply)
    : 0;
  const companyPaymentExpectedOverpayment = companyPaymentOutstandingSummary
    ? Math.max(0, normalizedRequestedPaymentAmount - companyPaymentExpectedDueAfterDiscount)
    : 0;
  const companyPaymentOverpaymentCreatesCredit =
    !!companyPaymentOutstandingSummary &&
    (splitPaymentEnabled
      ? paymentMethod !== "deposit" || remainingPaymentMethod !== "deposit"
      : paymentMethod !== "deposit");
  const selectedBillsDiscountToApply = selectedBillsPaymentSummary
    ? Math.min(normalizedRequestedDiscountAmount, selectedBillsPaymentSummary.totalRemaining)
    : 0;
  const selectedBillsExpectedDueAfterDiscount = selectedBillsPaymentSummary
    ? Math.max(0, selectedBillsPaymentSummary.totalRemaining - selectedBillsDiscountToApply)
    : 0;
  const selectedBillsExpectedOverpayment = selectedBillsPaymentSummary
    ? Math.max(0, normalizedRequestedPaymentAmount - selectedBillsExpectedDueAfterDiscount)
    : 0;
  const selectedBillsOverpaymentCreatesCredit =
    !!selectedBillsPaymentSummary &&
    (splitPaymentEnabled
      ? paymentMethod !== "deposit" || remainingPaymentMethod !== "deposit"
      : paymentMethod !== "deposit");
  const isSingleBillPayment =
    !!selectedBill &&
    !bulkPaymentClientId &&
    !companyPayment &&
    !selectedBillsPaymentSummary;
  const singleBillDisplayAmounts =
    isSingleBillPayment && selectedBill ? getBillDisplayAmounts(selectedBill) : null;
  const singleBillDiscountToApply = singleBillDisplayAmounts
    ? Math.min(normalizedRequestedDiscountAmount, singleBillDisplayAmounts.due)
    : 0;
  const singleBillExpectedDueAfterDiscount = singleBillDisplayAmounts
    ? Math.max(0, singleBillDisplayAmounts.due - singleBillDiscountToApply)
    : 0;
  const singleBillExpectedOverpayment = singleBillDisplayAmounts
    ? Math.max(0, normalizedRequestedPaymentAmount - singleBillExpectedDueAfterDiscount)
    : 0;
  const singleBillOverpaymentCreatesCredit =
    !!singleBillDisplayAmounts &&
    !!selectedBill?.clientId &&
    (splitPaymentEnabled
      ? paymentMethod !== "deposit" || remainingPaymentMethod !== "deposit"
      : paymentMethod !== "deposit");
  const requiresSelectedBillsOverpaymentAccount =
    !!selectedBillsPaymentSummary &&
    !bulkPaymentClientId &&
    !companyPayment &&
    selectedBillsPaymentSummary.clientCount > 1 &&
    selectedBillsOverpaymentCreatesCredit &&
    selectedBillsExpectedOverpayment > 0.01;
  const requiresCompanyOverpaymentAccount =
    !!companyPaymentOutstandingSummary &&
    companyPaymentOutstandingSummary.clientCount > 1 &&
    companyPaymentOverpaymentCreatesCredit &&
    companyPaymentExpectedOverpayment > 0.01;
  const requiresOverpaymentCreditAccount =
    requiresSelectedBillsOverpaymentAccount || requiresCompanyOverpaymentAccount;
  const activePaymentExpectedOverpayment = companyPaymentOutstandingSummary
    ? companyPaymentExpectedOverpayment
    : selectedBillsPaymentSummary
      ? selectedBillsExpectedOverpayment
      : bulkClientOutstandingSummary
        ? bulkClientExpectedOverpayment
        : singleBillDisplayAmounts
          ? singleBillExpectedOverpayment
          : 0;
  const activePaymentExpectedDueAfterDiscount = companyPaymentOutstandingSummary
    ? companyPaymentExpectedDueAfterDiscount
    : selectedBillsPaymentSummary
      ? selectedBillsExpectedDueAfterDiscount
      : bulkClientOutstandingSummary
        ? bulkClientExpectedDueAfterDiscount
        : singleBillDisplayAmounts
          ? singleBillExpectedDueAfterDiscount
          : 0;
  const showPartialPaymentNotice =
    normalizedRequestedPaymentAmount > 0.009 &&
    activePaymentExpectedDueAfterDiscount > 0.009 &&
    normalizedRequestedPaymentAmount < activePaymentExpectedDueAfterDiscount - 0.009;
  const partialPaymentRemainingAfterPayment = Math.max(
    0,
    activePaymentExpectedDueAfterDiscount - normalizedRequestedPaymentAmount,
  );
  const autoOverpaymentCreditClientId =
    selectedBillsPaymentSummary?.singleClientId ??
    companyPaymentOutstandingSummary?.singleClientId ??
    bulkPaymentClientId ??
    (singleBillDisplayAmounts ? selectedBill?.clientId ?? null : null) ??
    null;
  const autoOverpaymentCreditAccountLabel = getClientPaymentAccountDisplayLabel(
    autoOverpaymentCreditClientId,
  );
  const automaticOverpaymentPaidTargetLabel = singleBillDisplayAmounts
    ? "this bill is fully paid"
    : "the current bills are fully paid";
  const showAutomaticOverpaymentCreditNotice =
    !requiresOverpaymentCreditAccount &&
    activePaymentExpectedOverpayment > 0.01 &&
    !!autoOverpaymentCreditAccountLabel &&
    (companyPaymentOutstandingSummary
      ? companyPaymentOverpaymentCreatesCredit
      : selectedBillsPaymentSummary
        ? selectedBillsOverpaymentCreatesCredit
        : bulkClientOutstandingSummary
          ? bulkPaymentOverpaymentCreatesCredit
          : singleBillDisplayAmounts
            ? singleBillOverpaymentCreatesCredit
            : false);

  useEffect(() => {
    if (!requiresOverpaymentCreditAccount) {
      if (selectedBillsOverpaymentClientId) {
        setSelectedBillsOverpaymentClientId("");
      }
      return;
    }

    const hasMatchingOption = overpaymentCreditClientOptions.some(
      (option) => option.value === selectedBillsOverpaymentClientId,
    );
    if (!hasMatchingOption && selectedBillsOverpaymentClientId) {
      setSelectedBillsOverpaymentClientId("");
    }
  }, [
    requiresOverpaymentCreditAccount,
    selectedBillsOverpaymentClientId,
    overpaymentCreditClientOptions,
  ]);

  const handleProcessPayment = async () => {
    const paymentVal = parseFloat(paymentAmount || "0");
    const discountVal = parseFloat(discountAmount || "0");
    const hasValidPayment = !isNaN(paymentVal) && paymentVal > 0;
    const hasValidDiscount = applyDiscount && !isNaN(discountVal) && discountVal > 0;

    if (!hasValidPayment && !hasValidDiscount) {
      toast({
        title: "Error",
        description: "Please enter a valid payment or discount amount.",
        variant: "destructive",
      });
      return;
    }

    if (hasValidDiscount && (!verifiedCashierPin || !isAdminOrCounterRole(verifiedCashierRole))) {
      toast({
        title: "Discount PIN Required",
        description: "Discounts can only be applied with an admin or counter PIN.",
        variant: "destructive",
      });
      return;
    }

    if (hasValidDiscount && selectedBill && !bulkPaymentClientId && !companyPayment && !selectedBillsPaymentSummary) {
      const billOriginalAmount = getBillDisplayAmounts(selectedBill).originalAmount;
      if (discountVal > billOriginalAmount + 0.009) {
        toast({
          title: "Invalid Discount",
          description: `Discount cannot exceed bill amount (${billOriginalAmount.toFixed(2)} AED).`,
          variant: "destructive",
        });
        return;
      }
    }

    if (requiresOverpaymentCreditAccount && !selectedBillsOverpaymentClientId) {
      toast({
        title: "Credit Account Required",
        description: "Choose which client account should receive the overpayment credit.",
        variant: "destructive",
      });
      return;
    }

    if (hasValidPayment && !splitPaymentEnabled && paymentMethod === "deposit" && paymentVal > activePaymentClientDeposit + 0.009) {
      toast({
        title: "Credit Not Enough",
        description: `Available credit is ${activePaymentClientDeposit.toFixed(2)} AED. Add another payment method or reduce the credit amount.`,
        variant: "destructive",
      });
      return;
    }

    if (hasValidPayment && splitPaymentEnabled) {
      if (!Number.isFinite(normalizedSplitPaymentAmount) || normalizedSplitPaymentAmount <= 0) {
        toast({
          title: "Invalid Split Amount",
          description: `Enter a valid amount for ${formatSplitPaymentMethodLabel(paymentMethod)}.`,
          variant: "destructive",
        });
        return;
      }

      if (normalizedSplitPaymentAmount >= paymentVal - 0.009) {
        toast({
          title: "Second Payment Needed",
          description: "Enter a smaller first payment amount so the second payment method can cover the remaining balance.",
          variant: "destructive",
        });
        return;
      }

      if (paymentMethod === "deposit" && normalizedSplitPaymentAmount > activePaymentClientDeposit + 0.009) {
        toast({
          title: "Credit Not Enough",
          description: `Available credit is ${activePaymentClientDeposit.toFixed(2)} AED. Reduce the credit amount or choose another split.`,
          variant: "destructive",
        });
        return;
      }

      if (remainingPaymentMethod === "deposit" && splitRemainingAmount > activePaymentClientDeposit + 0.009) {
        toast({
          title: "Credit Not Enough",
          description: `Remaining credit available is ${activePaymentClientDeposit.toFixed(2)} AED. Reduce the remaining credit amount or choose another method.`,
          variant: "destructive",
        });
        return;
      }

      const splitParts = [
        {
          amount: normalizedSplitPaymentAmount,
          paymentMethod,
          label: formatSplitPaymentMethodLabel(paymentMethod),
        },
        {
          amount: splitRemainingAmount,
          paymentMethod: remainingPaymentMethod,
          label: formatSplitPaymentMethodLabel(remainingPaymentMethod),
        },
      ];
      const splitGroupId = buildSplitPaymentGroupId();

      setIsSplitPaymentSubmitting(true);
      try {
        if (companyPayment) {
          const companyBillIds = companyPaymentOutstandingSummary?.billIds || [];
          const companyClientIds = companyPaymentOutstandingSummary?.clientIds || [];

          for (let index = 0; index < splitParts.length; index += 1) {
            const part = splitParts[index];
            await requestCompanyBulkPayment({
              companyName: companyPayment.companyName,
              amount: part.amount.toFixed(2),
              paymentMethod: part.paymentMethod,
              notes: appendSplitPaymentTag(
                paymentNotes || `Company payment for ${companyPayment.companyName}`,
                splitGroupId,
              ),
              processedBy: verifiedCashier || undefined,
              discountAmount: index === 0 && applyDiscount && parseFloat(discountAmount || "0") > 0 ? discountAmount : "0",
              billIds: companyBillIds.length > 0 ? companyBillIds : undefined,
              overpaymentClientId: requiresCompanyOverpaymentAccount
                ? Number(selectedBillsOverpaymentClientId)
                : undefined,
              staffPin: verifiedCashierPin || undefined,
            });
          }

          invalidatePaymentQueries(companyClientIds);
          closePaymentDialog(true);
          toast({
            title: "Company Payment Successful",
            description: `Paid ${splitParts[0].amount.toFixed(2)} AED with ${splitParts[0].label} and ${splitParts[1].amount.toFixed(2)} AED with ${splitParts[1].label}.`,
          });
          return;
        }

        if (bulkPaymentClientId) {
          const clientBillIds = (bills || [])
            .filter(
              (bill) =>
                bill.clientId === bulkPaymentClientId &&
                isBillOutstanding(bill) &&
                selectedBillIds.has(bill.id),
            )
            .map((bill) => bill.id);

          for (let index = 0; index < splitParts.length; index += 1) {
            const part = splitParts[index];
            await requestClientBulkPayment({
              clientId: bulkPaymentClientId,
              amount: part.amount.toFixed(2),
              paymentMethod: part.paymentMethod,
              notes: appendSplitPaymentTag(paymentNotes, splitGroupId),
              processedBy: verifiedCashier || undefined,
              discountAmount: index === 0 && applyDiscount && parseFloat(discountAmount || "0") > 0 ? discountAmount : "0",
              billIds: clientBillIds.length > 0 ? clientBillIds : undefined,
              staffPin: verifiedCashierPin || undefined,
            });
          }

          invalidatePaymentQueries(bulkPaymentClientId);
          closePaymentDialog(true);
          toast({
            title: "Payment Successful",
            description: `Paid ${splitParts[0].amount.toFixed(2)} AED with ${splitParts[0].label} and ${splitParts[1].amount.toFixed(2)} AED with ${splitParts[1].label}.`,
          });
          return;
        }

        if (selectedBillsPaymentSummary) {
          for (let index = 0; index < splitParts.length; index += 1) {
            const part = splitParts[index];
            await requestSelectedBillsPayment({
              billIds: selectedBillsPaymentSummary.billIds,
              amount: part.amount.toFixed(2),
              paymentMethod: part.paymentMethod,
              notes: appendSplitPaymentTag(paymentNotes, splitGroupId),
              discountAmount:
                index === 0 && applyDiscount && parseFloat(discountAmount || "0") > 0
                  ? discountAmount
                  : "0",
              processedBy: verifiedCashier || undefined,
              overpaymentClientId: requiresSelectedBillsOverpaymentAccount
                ? Number(selectedBillsOverpaymentClientId)
                : undefined,
              staffPin: verifiedCashierPin || undefined,
            });
          }

          invalidatePaymentQueries(selectedBillsPaymentSummary.clientIds);
          closePaymentDialog(true);
          toast({
            title: "Payment Successful",
            description: `Paid ${splitParts[0].amount.toFixed(2)} AED with ${splitParts[0].label} and ${splitParts[1].amount.toFixed(2)} AED with ${splitParts[1].label}.`,
          });
          return;
        }

        if (selectedBill) {
          if (applyDiscount && parseFloat(discountAmount || "0") > 0) {
            await apiRequest("POST", `/api/bills/${selectedBill.id}/apply-discount`, {
              discountAmount: discountAmount,
              appliedBy: verifiedCashier || undefined,
              staffPin: verifiedCashierPin || undefined,
            });
          }

          for (const part of splitParts) {
            await requestBillPayment({
              billId: selectedBill.id,
              amount: part.amount.toFixed(2),
              paymentMethod: part.paymentMethod,
              notes: appendSplitPaymentTag(paymentNotes, splitGroupId),
              processedBy: verifiedCashier || undefined,
            });
          }

          invalidatePaymentQueries(selectedBill.clientId);
          closePaymentDialog(true);
          toast({
            title: "Payment Successful",
            description: `Paid ${splitParts[0].amount.toFixed(2)} AED with ${splitParts[0].label} and ${splitParts[1].amount.toFixed(2)} AED with ${splitParts[1].label}.`,
          });
          return;
        }
      } catch (error: any) {
        toast({
          title: "Payment Failed",
          description: extractApiErrorMessage(error, "Failed to process split payment."),
          variant: "destructive",
        });
        return;
      } finally {
        setIsSplitPaymentSubmitting(false);
      }
    }

    if (applyDiscount && selectedBill && !bulkPaymentClientId && !companyPayment && discountAmount && parseFloat(discountAmount) > 0) {
      try {
        await apiRequest("POST", `/api/bills/${selectedBill.id}/apply-discount`, {
          discountAmount: discountAmount,
          appliedBy: verifiedCashier || undefined,
          staffPin: verifiedCashierPin || undefined,
        });
      } catch (err: any) {
        toast({
          title: "Discount Failed",
          description: extractApiErrorMessage(err, "Failed to apply discount."),
          variant: "destructive",
        });
        return;
      }
    }

    if (!hasValidPayment && selectedBill && !bulkPaymentClientId && !companyPayment) {
      invalidatePaymentQueries(selectedBill.clientId);
      closePaymentDialog(true);
      toast({
        title: "Discount Applied",
        description: "Bill discount updated successfully.",
      });
      return;
    }

    if (companyPayment) {
      const companyBillIds = companyPaymentOutstandingSummary?.billIds || [];
      payCompanyBillsMutation.mutate({
        companyName: companyPayment.companyName,
        amount: paymentAmount,
        paymentMethod,
        notes: paymentNotes || `Company payment for ${companyPayment.companyName}`,
        processedBy: verifiedCashier || undefined,
        discountAmount: applyDiscount && parseFloat(discountAmount || "0") > 0 ? discountAmount : "0",
        billIds: companyBillIds.length > 0 ? companyBillIds : undefined,
        overpaymentClientId: requiresCompanyOverpaymentAccount
          ? Number(selectedBillsOverpaymentClientId)
          : undefined,
        staffPin: verifiedCashierPin || undefined,
      });
    } else if (bulkPaymentClientId) {
      const clientBillIds = (bills || [])
        .filter(b => b.clientId === bulkPaymentClientId
          && isBillOutstanding(b)
          && selectedBillIds.has(b.id))
        .map(b => b.id);
      payAllBillsMutation.mutate({
        clientId: bulkPaymentClientId,
        amount: paymentAmount,
        paymentMethod,
        notes: paymentNotes,
        processedBy: verifiedCashier || undefined,
        discountAmount: applyDiscount && parseFloat(discountAmount || "0") > 0 ? discountAmount : "0",
        billIds: clientBillIds.length > 0 ? clientBillIds : undefined,
        staffPin: verifiedCashierPin || undefined,
      });
    } else if (selectedBillsPaymentSummary) {
      paySelectedBillsMutation.mutate({
        billIds: selectedBillsPaymentSummary.billIds,
        amount: paymentAmount,
        paymentMethod,
        notes: paymentNotes,
        discountAmount: applyDiscount && parseFloat(discountAmount || "0") > 0 ? discountAmount : "0",
        processedBy: verifiedCashier || undefined,
        overpaymentClientId: requiresSelectedBillsOverpaymentAccount
          ? Number(selectedBillsOverpaymentClientId)
          : undefined,
        staffPin: verifiedCashierPin || undefined,
      });
    } else if (selectedBill) {
      payBillMutation.mutate({
        billId: selectedBill.id,
        amount: paymentAmount,
        paymentMethod,
        notes: paymentNotes,
        processedBy: verifiedCashier || undefined,
      });
    }
  };

  const toggleBillSelection = (billId: number) => {
    setSelectedBillIds(prev => {
      const next = new Set(prev);
      if (next.has(billId)) {
        next.delete(billId);
      } else {
        next.add(billId);
      }
      return next;
    });
  };

  const isCtrlLeftClick = (event: ReactMouseEvent<HTMLElement>) =>
    event.button === 0 && event.ctrlKey;

  const isNestedInteractiveClickTarget = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return false;

    const interactiveTarget = target.closest(
      'button,a,input,textarea,select,[role="button"]',
    );

    return Boolean(interactiveTarget && interactiveTarget !== event.currentTarget);
  };

  const toggleBillSelectionFromShortcut = (
    event: ReactMouseEvent<HTMLElement>,
    bill: Bill,
  ) => {
    if (!isCtrlLeftClick(event) || !isBillSelectableForBulkAction(bill)) return false;

    event.preventDefault();
    event.stopPropagation();
    toggleBillSelection(bill.id);
    return true;
  };

  const handleBillShortcutSelectionCapture = (
    event: ReactMouseEvent<HTMLElement>,
    bill: Bill,
  ) => {
    if (isNestedInteractiveClickTarget(event)) return;

    toggleBillSelectionFromShortcut(event, bill);
  };

  const handleBillShortcutClick = (
    event: ReactMouseEvent<HTMLElement>,
    bill: Bill,
  ) => {
    if (toggleBillSelectionFromShortcut(event, bill)) return;

    setViewBillDetails(bill);
  };

  const clearBillSelections = (billIds: number[]) => {
    setSelectedBillIds((prev) => {
      const next = new Set(prev);
      billIds.forEach((billId) => next.delete(billId));
      return next;
    });
  };

  const selectBills = useCallback((billList: Bill[]) => {
    if (billList.length === 0) return;
    setSelectedBillIds((prev) => {
      const next = new Set(prev);
      billList.forEach((bill) => {
        if (isBillSelectableForBulkAction(bill)) {
          next.add(bill.id);
        }
      });
      return next;
    });
  }, [isBillSelectableForBulkAction]);

  const toggleBillsSelection = useCallback((billList: Bill[]) => {
    const selectableBills = billList.filter((bill) => isBillSelectableForBulkAction(bill));
    if (selectableBills.length === 0) return;

    const allBillsSelected = selectableBills.every((bill) => selectedBillIds.has(bill.id));

    setSelectedBillIds((prev) => {
      const next = new Set(prev);
      selectableBills.forEach((bill) => {
        if (allBillsSelected) {
          next.delete(bill.id);
        } else {
          next.add(bill.id);
        }
      });
      return next;
    });
  }, [isBillSelectableForBulkAction, selectedBillIds]);

  useEffect(() => {
    if (isMobile || activeTab !== "bills") {
      return;
    }

    const isDialogShortcutContextActive = () =>
      Boolean(document.querySelector('[role="dialog"][data-state="open"], [aria-modal="true"]'));

    const focusBillsTable = () => {
      const billsScroller = billsListScrollRef.current;
      if (!billsScroller) return;

      billsScroller.focus({ preventScroll: true });
      billsScroller.scrollIntoView({ block: "nearest", inline: "nearest" });
    };

    const handleBillsSelectAllShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== "a" || (!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }

      if (isEditableKeyboardShortcutTarget(event)) {
        return;
      }

      if (isDialogShortcutContextActive()) {
        return;
      }

      event.preventDefault();
      focusBillsTable();
      toggleBillsSelection(selectableVisibleBills);
    };

    window.addEventListener("keydown", handleBillsSelectAllShortcut);
    return () => {
      window.removeEventListener("keydown", handleBillsSelectAllShortcut);
    };
  }, [activeTab, isMobile, selectableVisibleBills, toggleBillsSelection]);

  const getUnpaidBillsForClient = (clientId: number) => {
    return (bills || []).filter((b) => b.clientId === clientId && isBillOutstanding(b));
  };

  const getSelectedDueTotal = (unpaidBills: Bill[]) => {
    if (selectedBillIds.size === 0) {
      return getBillAggregateTotals(unpaidBills).due;
    }
    return unpaidBills
      .filter(b => selectedBillIds.has(b.id))
      .reduce((sum, b) => sum + getBillDisplayAmounts(b).due, 0);
  };

  const proceedWithClientPayment = (client: Client, totalDue: number) => {
    const clientUnpaidBills = getUnpaidBillsForClient(client.id);

    if (clientUnpaidBills.length === 0) {
      toast({
        title: "No Unpaid Bills",
        description: "This client has no unpaid bills.",
        variant: "destructive",
      });
      return;
    }

    const selectedForThisClient = clientUnpaidBills.filter(b => selectedBillIds.has(b.id));
    const hasClientSelection = selectedForThisClient.length > 0;
    const effectiveDue = hasClientSelection
      ? getBillAggregateTotals(selectedForThisClient).due
      : totalDue;
    const selectedCount = hasClientSelection
      ? selectedForThisClient.length
      : clientUnpaidBills.length;

    setBulkPaymentClientId(client.id);
    setCompanyPayment(null);
    setSelectedBillsPaymentSummary(null);
    setSelectedBill(clientUnpaidBills[0]);
    setPaymentAmount(effectiveDue.toFixed(2));
    setPaymentNotes(`Payment for ${client.name}'s outstanding balance (${selectedCount} bills)`);
    setPaymentMethod("cash");
    setApplyDiscount(false);
    setDiscountAmount("");
    setShowPaymentDialog(true);
  };

  const handlePayNowForClient = (client: Client, totalDue: number) => {
    // Require PIN verification first
    setPendingPaymentAction({ type: 'client', client, totalDue });
    setShowPinDialog(true);
    setCashierPin("");
    setPinError("");
  };

  const renderGroupedBillStatusBadge = (bill: Bill, paidAmount: number, due: number) => {
    if (due <= 0) {
      return (
        <Badge variant="outline" className="border-green-600 text-green-600">
          Paid
        </Badge>
      );
    }

    if (paidAmount > 0.01 || (!bill.isPaid && parseFloat(bill.paidAmount || "0") > 0)) {
      return (
        <Badge variant="outline" className="border-amber-600 text-amber-600">
          Partial
        </Badge>
      );
    }

    return <Badge className="bg-blue-500 text-white">Unpaid</Badge>;
  };

  const renderMobileGroupedBillCard = (
    bill: Bill,
    options: { scope: "client" | "company" | "broker"; showClientInfo?: boolean },
  ) => {
    const displayAmounts = getBillDisplayAmounts(bill);
    const billTypeMeta = getBillTypeMeta(bill);
    const originalAmount = displayAmounts.originalAmount;
    const discount = displayAmounts.discount;
    const finalAmt = displayAmounts.finalAmount;
    const paid = displayAmounts.paidAmount;
    const due = displayAmounts.due;
    const isUnpaid = due > 0.01;
    const latestPaymentDate = getBillLatestPaymentDate(bill.id);
    const clientName = bill.customerName || (bill.clientId ? getClientName(bill.clientId) : "Walk-in Customer");
    const accountLabel = getClientAccountLabel(bill.clientId);
    const discountInputTestId = options.scope === "company"
      ? `input-company-bill-discount-${bill.id}`
      : options.scope === "broker"
        ? `input-broker-bill-discount-${bill.id}`
        : `input-bill-discount-${bill.id}`;
    const checkboxTestId = options.scope === "company"
      ? `checkbox-company-bill-${bill.id}`
      : options.scope === "broker"
        ? `checkbox-broker-bill-${bill.id}`
        : `checkbox-bill-${bill.id}`;

    return (
      <Card
        key={`${options.scope}-mobile-bill-${bill.id}`}
        role="button"
        tabIndex={0}
        onClickCapture={(event) => handleBillShortcutSelectionCapture(event, bill)}
        onClick={(event) => handleBillShortcutClick(event, bill)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setViewBillDetails(bill);
          }
        }}
        className={`overflow-hidden rounded-xl border shadow-sm transition-colors ${
          selectedBillIds.has(bill.id)
            ? "border-primary/40 bg-blue-50/70 dark:bg-blue-950/20"
            : "bg-card"
        }`}
      >
        <CardContent className="p-3">
          <div className="flex items-start gap-2">
            <div
              className="pt-0.5"
              onClick={(event) => event.stopPropagation()}
            >
              {isUnpaid ? (
                <input
                  type="checkbox"
                  checked={selectedBillIds.has(bill.id)}
                  onChange={() => toggleBillSelection(bill.id)}
                  className="rounded border-gray-300"
                  data-testid={checkboxTestId}
                />
              ) : (
                <div className="h-4 w-4" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold text-foreground">Bill #{bill.id}</span>
                <span className="rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {formatBillCreatedDate(bill.billDate)}
                </span>
                {renderGroupedBillStatusBadge(bill, paid, due)}
              </div>
              <div className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${billTypeMeta.textClassName}`}>
                {billTypeMeta.label}
              </div>

              {options.showClientInfo && (
                <p className="mt-1 text-[11px] font-medium text-foreground break-words">
                  {clientName}
                  {accountLabel && (
                    <span className="ml-1 font-normal text-muted-foreground">
                      ({accountLabel})
                    </span>
                  )}
                </p>
              )}

              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                <span>
                  Created:{" "}
                  <span className="font-medium text-foreground">
                    {formatBillCreatedDate(bill.billDate)}
                  </span>
                </span>
                <span>
                  Paid On:{" "}
                  <span className={latestPaymentDate ? "font-medium text-green-600" : "font-medium"}>
                    {formatBillPaymentDate(latestPaymentDate)}
                  </span>
                </span>
              </div>

              <p className="mt-2 text-[11px] leading-snug text-muted-foreground break-words">
                {bill.description || "-"}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px]">
                <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground">Work Rec.</p>
                  <p className="font-semibold text-foreground">{originalAmount.toFixed(2)} AED</p>
                </div>
                <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground">Final</p>
                  <p className="font-semibold text-blue-600">{finalAmt.toFixed(2)} AED</p>
                </div>
                <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground">Paid</p>
                  <p className="font-semibold text-green-600">{paid.toFixed(2)} AED</p>
                </div>
                <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground">Due</p>
                  <p className={`font-semibold ${due > 0 ? "text-destructive" : "text-green-600"}`}>
                    {due.toFixed(2)} AED
                  </p>
                </div>
                <div
                  className="col-span-2 rounded-lg bg-muted/40 px-2 py-1.5"
                  onClick={(event) => {
                    event.stopPropagation();
                    openBillDiscountEdit(bill);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] text-muted-foreground">Discount</p>
                    {!bill.isPaid && editingDiscountBillId !== bill.id && (
                      <Edit className="h-3 w-3 text-orange-500" />
                    )}
                  </div>
                  {editingDiscountBillId === bill.id ? (
                    renderBillDiscountEditor(
                      bill,
                      discount,
                      discountInputTestId,
                      "mt-1 h-8 rounded-lg text-right text-xs",
                    )
                  ) : (
                    <p className="mt-0.5 text-right font-semibold text-orange-600">
                      {discount > 0 ? `-${discount.toFixed(2)} AED` : "-"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderMobileBillsByDate = (
    billList: Bill[],
    options: { scope: "client" | "company" | "broker"; showClientInfo?: boolean },
  ) => {
    const byDate: Record<string, Bill[]> = {};
    billList.forEach((bill) => {
      const dateKey = format(new Date(bill.billDate), "yyyy-MM-dd");
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push(bill);
    });

    const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
    const selectAllTestId = options.scope === "company"
      ? "checkbox-select-all-company-bills"
      : options.scope === "broker"
        ? "checkbox-select-all-broker-bills"
        : "checkbox-select-all-client-bills";

    return sortedDates.map((dateKey) => {
      const datedBills = byDate[dateKey];
      const unpaidInDate = datedBills.filter((bill) => isBillOutstanding(bill));
      const allSelected =
        unpaidInDate.length > 0 && unpaidInDate.every((bill) => selectedBillIds.has(bill.id));

      return (
        <div key={`${options.scope}-${dateKey}`} className="mb-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-semibold text-muted-foreground">
              {format(new Date(`${dateKey}T00:00:00`), "EEEE, MMM dd, yyyy")}
            </span>
            <Badge variant="secondary" className="text-[10px]">
              {datedBills.length}
            </Badge>
            <div className="flex-1 border-t border-border" />
            {unpaidInDate.length > 0 && (
              <label
                className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-1 text-[10px] font-semibold text-muted-foreground"
                onClick={(event) => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => {
                    event.stopPropagation();
                    setSelectedBillIds((prev) => {
                      const next = new Set(prev);
                      if (allSelected) {
                        unpaidInDate.forEach((bill) => next.delete(bill.id));
                      } else {
                        unpaidInDate.forEach((bill) => next.add(bill.id));
                      }
                      return next;
                    });
                  }}
                  className="rounded border-gray-300"
                  data-testid={selectAllTestId}
                />
                All
              </label>
            )}
          </div>

          <div className="space-y-2">
            {datedBills.map((bill) => renderMobileGroupedBillCard(bill, options))}
          </div>
        </div>
      );
    });
  };

  const renderMobileBillsByClient = (
    billList: Bill[],
    options: { scope: "company"; showClientInfo?: boolean },
  ) => {
    const billsByClient = groupBillsByClient(billList);

    return billsByClient.map(([clientKey, clientData]) => {
      const unpaidForClient = clientData.bills.filter((bill) => isBillOutstanding(bill));
      const allSelected =
        unpaidForClient.length > 0 && unpaidForClient.every((bill) => selectedBillIds.has(bill.id));
      const accountNumber = clientData.clientId
        ? getClientById(clientData.clientId)?.billNumber?.trim() || null
        : null;

      return (
        <div key={`${options.scope}-${clientKey}`} className="mb-3">
          <div className="mb-2 flex items-center gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-foreground">
                {clientData.clientName}
              </p>
              {accountNumber && (
                <p className="text-[10px] text-muted-foreground">{accountNumber}</p>
              )}
            </div>
            <Badge variant="secondary" className="text-[10px]">
              {clientData.bills.length}
            </Badge>
            <div className="flex-1 border-t border-border" />
            {unpaidForClient.length > 0 && (
              <label
                className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-1 text-[10px] font-semibold text-muted-foreground"
                onClick={(event) => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => {
                    event.stopPropagation();
                    setSelectedBillIds((prev) => {
                      const next = new Set(prev);
                      if (allSelected) {
                        unpaidForClient.forEach((bill) => next.delete(bill.id));
                      } else {
                        unpaidForClient.forEach((bill) => next.add(bill.id));
                      }
                      return next;
                    });
                  }}
                  className="rounded border-gray-300"
                  data-testid="checkbox-select-all-company-bills"
                />
                All
              </label>
            )}
          </div>

          <div className="space-y-2">
            {clientData.bills.map((bill) => renderMobileGroupedBillCard(bill, options))}
          </div>
        </div>
      );
    });
  };

  const renderMobileCompanyPaymentHistory = (
    companyTransactions: CompanyPaymentTransactionRow[],
    companyPaidTotal: number,
    companyDiscountTotal: number,
  ) => {
    return (
      <div className="mt-4 overflow-hidden rounded-xl border">
        <div className="space-y-2 border-b bg-muted/40 px-3 py-3">
          <div>
            <p className="text-sm font-semibold">Company Payment History</p>
            <p className="text-[11px] text-muted-foreground">
              Transactions recorded as company payments.
            </p>
          </div>
          {companyTransactions.length > 0 && (
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg bg-background px-2 py-1.5">
                <p className="text-[10px] text-muted-foreground">Paid</p>
                <p className="font-semibold text-green-600">{companyPaidTotal.toFixed(2)} AED</p>
              </div>
              <div className="rounded-lg bg-background px-2 py-1.5">
                <p className="text-[10px] text-muted-foreground">Discount</p>
                <p className="font-semibold text-orange-600">{companyDiscountTotal.toFixed(2)} AED</p>
              </div>
            </div>
          )}
        </div>

        {isCompanyPaymentTransactionsLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Loading company transactions...
          </div>
        ) : companyTransactions.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No company payment transactions yet.
          </div>
        ) : (
          <div className="space-y-2 p-3">
            {companyTransactions.map((tx) => {
              const txAmount = parseFloat(tx.amount || "0");
              const txDiscount = parseFloat(tx.discount || "0");
              return (
                <div key={tx.id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-foreground">
                        {tx.clientName}
                        {tx.accountNumber && (
                          <span className="ml-1 font-normal text-muted-foreground">
                            ({tx.accountNumber})
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {format(new Date(tx.date), "dd/MM/yyyy HH:mm")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-green-600">
                        {txAmount.toFixed(2)} AED
                      </p>
                      <p className="text-[10px] font-medium text-orange-600">
                        {txDiscount > 0 ? `${txDiscount.toFixed(2)} AED disc.` : "No discount"}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] leading-snug text-muted-foreground break-words">
                    {extractBillsFromCompanyPaymentDescription(tx.description)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span>
                      Method:{" "}
                      <span className="font-medium text-foreground">
                        {formatPaymentMethodLabel(tx.paymentMethod)}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const handleSharedViewChange = (value: typeof timePeriod) => {
    setTimePeriod(value);
    setExactDate("");
    setCustomDateFrom("");
    setCustomDateTo("");
    setBillsRangeApplied(false);
  };

  const renderSharedBillFilters = () => (
    <div className={`shrink-0 ${isMobile ? "space-y-1" : "mb-4 flex flex-wrap items-center justify-end gap-2"}`}>
      {isMobile ? (
        <>
          <div className="grid grid-cols-2 gap-1">
            <div className="flex items-center gap-1 rounded-full border border-border/70 bg-card/85 px-1.5 shadow-sm">
              <span className="shrink-0 pl-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Status
              </span>
              <Select value={paymentFilter} onValueChange={(value) => setPaymentFilter(value as typeof paymentFilter)}>
                <SelectTrigger
                  className="h-[22px] w-full min-w-0 border-0 bg-transparent px-1 text-[9px] shadow-none focus:ring-0 focus:ring-offset-0 [&>span]:truncate [&>span]:text-[9px]"
                  data-testid="select-payment-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Bills</SelectItem>
                  <SelectItem value="unpaid">Unpaid Bills</SelectItem>
                  <SelectItem value="partial">Partial Paid Bills</SelectItem>
                  <SelectItem value="paid">Paid Bills</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1 rounded-full border border-border/70 bg-card/85 px-1.5 shadow-sm">
              <span className="shrink-0 pl-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                View
              </span>
              <Select value={timePeriod} onValueChange={(value) => handleSharedViewChange(value as typeof timePeriod)}>
                <SelectTrigger
                  className="h-[22px] w-full min-w-0 border-0 bg-transparent px-1 text-[9px] shadow-none focus:ring-0 focus:ring-offset-0 [&>span]:truncate [&>span]:text-[9px]"
                  data-testid="select-time-period"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="month">This Month</SelectItem>
                  <SelectItem value="year">This Year</SelectItem>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="date">Exact Date</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-full border border-border/70 bg-card/85 px-1.5 shadow-sm">
            <span className="shrink-0 pl-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Sort
            </span>
            <Select value={billSort} onValueChange={(value) => setBillSort(value as BillSortOption)}>
              <SelectTrigger
                className="h-[22px] w-full min-w-0 border-0 bg-transparent px-1 text-[9px] shadow-none focus:ring-0 focus:ring-offset-0 [&>span]:truncate [&>span]:text-[9px]"
                data-testid="select-bill-sort"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
                <SelectItem value="highest-unpaid">Highest Unpaid</SelectItem>
                <SelectItem value="lowest-unpaid">Lowest Unpaid</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {timePeriod === "date" && (
            <div className="flex items-center gap-1 rounded-full border border-border/70 bg-card/85 px-1.5 shadow-sm">
              <span className="shrink-0 pl-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Date
              </span>
              <Input
                type="date"
                className="h-[22px] w-full min-w-0 border-0 bg-transparent px-1 text-[9px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                value={exactDate}
                onChange={(event) => setExactDate(event.target.value)}
                data-testid="input-bills-exact-date"
              />
            </div>
          )}

          {timePeriod === "custom" && (
            <div className="rounded-xl border border-border/70 bg-card/85 px-2 py-1 shadow-sm">
              <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Range
              </div>
              <DateTimeRangePicker
                start={customDateFrom || new Date().toISOString().split("T")[0] + "T00:00"}
                end={customDateTo || new Date().toISOString().split("T")[0] + "T23:59"}
                onChange={(start, end) => {
                  setCustomDateFrom(start.split("T")[0]);
                  setCustomDateTo(end.split("T")[0]);
                  setBillsRangeApplied(true);
                }}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <span className="text-sm text-muted-foreground">Status:</span>
          <Select value={paymentFilter} onValueChange={(value) => setPaymentFilter(value as typeof paymentFilter)}>
            <SelectTrigger className="w-32" data-testid="select-payment-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Bills</SelectItem>
              <SelectItem value="unpaid">Unpaid Bills</SelectItem>
              <SelectItem value="partial">Partial Paid Bills</SelectItem>
              <SelectItem value="paid">Paid Bills</SelectItem>
            </SelectContent>
          </Select>

          <span className="text-sm text-muted-foreground">View:</span>
          <Select value={timePeriod} onValueChange={(value) => handleSharedViewChange(value as typeof timePeriod)}>
            <SelectTrigger className="w-36" data-testid="select-time-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="year">This Year</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="date">Exact Date</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>

          {timePeriod === "date" && (
            <Input
              type="date"
              className="w-40 h-9"
              value={exactDate}
              onChange={(event) => setExactDate(event.target.value)}
              data-testid="input-bills-exact-date"
            />
          )}

          <span className="text-sm text-muted-foreground">Sort:</span>
          <Select value={billSort} onValueChange={(value) => setBillSort(value as BillSortOption)}>
            <SelectTrigger className="w-44" data-testid="select-bill-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="highest-unpaid">Highest Unpaid</SelectItem>
              <SelectItem value="lowest-unpaid">Lowest Unpaid</SelectItem>
            </SelectContent>
          </Select>

          {timePeriod === "custom" && (
            <DateTimeRangePicker
              start={customDateFrom || new Date().toISOString().split("T")[0] + "T00:00"}
              end={customDateTo || new Date().toISOString().split("T")[0] + "T23:59"}
              onChange={(start, end) => {
                setCustomDateFrom(start.split("T")[0]);
                setCustomDateTo(end.split("T")[0]);
                setBillsRangeApplied(true);
              }}
            />
          )}
        </>
      )}
    </div>
  );

  const printGroupedBillsInvoice = async ({
    clientId,
    displayName,
    phone,
    addressLines,
    bills,
    kind,
    isBroker = false,
  }: {
    clientId?: number | null;
    displayName: string;
    phone?: string | null;
    addressLines: string[];
    bills: Bill[];
    kind: "paid" | "unpaid";
    isBroker?: boolean;
  }) => {
    await downloadGroupedBillsPdf({
      clientId,
      displayName,
      phone,
      addressLines,
      bills,
      kind,
      isBroker,
    });
  };

  const printBillPDF = async (bill: Bill) => {
    await downloadSingleBillPdf(bill);
  };

  const sortedProducts =
    products?.sort((a, b) => a.name.localeCompare(b.name)) || [];

  const paidByDateGroupsData = useMemo(() => {
    if (!isPaidByDateTab) {
      return EMPTY_PAID_BY_DATE_GROUPS_DATA;
    }

    const safeAmt = (val: string | undefined | null) => {
      const n = parseFloat(val || "0");
      return Number.isFinite(n) ? n : 0;
    };

    const paidBillIds = new Set<number>();
    const billsByPayDate = new Map<
      string,
      {
        billEntriesById: Map<number, PaidByDateBillEntry>;
        totalPaid: number;
      }
    >();

    allBillPayments.forEach((payment) => {
      const bill = paidByDateBillsById.get(payment.billId);
      if (!bill) return;

      const paymentAmount = safeAmt(payment.amount);

      const paymentTimestamp = new Date(payment.paymentDate).getTime();
      if (!Number.isFinite(paymentTimestamp)) return;

      const paymentDate = new Date(paymentTimestamp);
      const dateKey = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, "0")}-${String(paymentDate.getDate()).padStart(2, "0")}`;

      if (!billsByPayDate.has(dateKey)) {
        billsByPayDate.set(dateKey, {
          billEntriesById: new Map(),
          totalPaid: 0,
        });
      }

      const entry = billsByPayDate.get(dateKey)!;
      const existingBillEntry = entry.billEntriesById.get(bill.id);
      if (!paidBillIds.has(bill.id)) {
        paidBillIds.add(bill.id);
      }

      if (existingBillEntry) {
        existingBillEntry.totalPaid += paymentAmount;

        if (paymentTimestamp > existingBillEntry.latestPaymentTimestamp) {
          existingBillEntry.latestPaymentDate = payment.paymentDate;
          existingBillEntry.latestPaymentTimestamp = paymentTimestamp;
        }
      } else {
        entry.billEntriesById.set(bill.id, {
          bill,
          totalPaid: paymentAmount,
          latestPaymentDate: payment.paymentDate,
          latestPaymentTimestamp: paymentTimestamp,
          billTimestamp: new Date(bill.billDate).getTime(),
        });
      }

      entry.totalPaid += paymentAmount;
    });

    paidByDateBillsById.forEach((bill) => {
      if (paidBillIds.has(bill.id)) return;

      const paymentStatus = getBillPaymentStatus(bill);
      if (paymentStatus === "unpaid") return;

      const fallbackPaidAmount = getBillDisplayAmounts(bill).paidAmount;
      if (fallbackPaidAmount <= 0.01 && !bill.isPaid) return;

      const fallbackPaymentTimestamp = bill.paymentProcessedAt
        ? new Date(bill.paymentProcessedAt).getTime()
        : Number.NaN;
      const hasFallbackDate = Number.isFinite(fallbackPaymentTimestamp);
      const fallbackPaymentDate = hasFallbackDate
        ? new Date(fallbackPaymentTimestamp)
        : null;
      const dateKey = hasFallbackDate && fallbackPaymentDate
        ? `${fallbackPaymentDate.getFullYear()}-${String(fallbackPaymentDate.getMonth() + 1).padStart(2, "0")}-${String(fallbackPaymentDate.getDate()).padStart(2, "0")}`
        : UNKNOWN_PAYMENT_DATE_KEY;

      if (!billsByPayDate.has(dateKey)) {
        billsByPayDate.set(dateKey, {
          billEntriesById: new Map(),
          totalPaid: 0,
        });
      }

      const entry = billsByPayDate.get(dateKey)!;
      entry.billEntriesById.set(bill.id, {
        bill,
        totalPaid: fallbackPaidAmount,
        latestPaymentDate: hasFallbackDate && bill.paymentProcessedAt ? bill.paymentProcessedAt : "",
        latestPaymentTimestamp: hasFallbackDate ? fallbackPaymentTimestamp : 0,
        billTimestamp: new Date(bill.billDate).getTime(),
      });
      entry.totalPaid += fallbackPaidAmount;
      paidBillIds.add(bill.id);
    });

    const groups = Array.from(billsByPayDate.entries())
      .sort(([dateA], [dateB]) => {
        if (dateA === UNKNOWN_PAYMENT_DATE_KEY) return 1;
        if (dateB === UNKNOWN_PAYMENT_DATE_KEY) return -1;
        return dateB.localeCompare(dateA);
      })
      .map(([dateKey, group]) => {
        const billEntries = Array.from(group.billEntriesById.values());

        return {
          dateKey,
          billEntries,
          totalBillEntries: billEntries.length,
          totalPaid: group.totalPaid,
        };
      });

    return {
      totalPaymentEntries: groups.reduce((sum, group) => sum + group.totalBillEntries, 0),
      groups,
    };
  }, [allBillPayments, paidByDateBillsById, getBillDisplayAmounts, getBillPaymentStatus, isPaidByDateTab]);

  const clientBillGroups = useMemo(() => {
    if (!isByClientTab) {
      return [];
    }

    const billsByClient = new Map<
      string,
      { clientName: string; clientId: number | null; bills: Bill[] }
    >();

    clientTabBills.forEach((bill) => {
      if (bill.clientId && brokerClientIds.has(bill.clientId)) return;

      const explicitCustomerName = String(bill.customerName || "").trim();
      const clientName = explicitCustomerName ||
        (bill.clientId ? clientById.get(bill.clientId)?.name || "Unknown Client" : "Walk-in Customer");
      const clientKey = bill.clientId
        ? `client-${bill.clientId}`
        : `walk-in-${clientName.toUpperCase()}`;

      if (!billsByClient.has(clientKey)) {
        billsByClient.set(clientKey, {
          clientName,
          clientId: bill.clientId,
          bills: [],
        });
      }

      billsByClient.get(clientKey)!.bills.push(bill);
    });

    return Array.from(billsByClient.entries())
      .map(([clientKey, clientData]) => ({
        clientKey,
        clientData,
      }));
  }, [brokerClientIds, clientById, clientTabBills, isByClientTab]);

  const companyBillGroups = useMemo(() => {
    if (!isByCompanyTab) {
      return [];
    }

    const billsByCompany = new Map<
      string,
      { companyName: string; clientIds: Set<number>; bills: Bill[] }
    >();

    companyTabBills.forEach((bill) => {
      const client = bill.clientId ? clientById.get(bill.clientId) : undefined;
      const companyName = client?.company;
      if (!companyName || companyName.trim() === "") return;

      const companyKey = companyName.toUpperCase();
      if (!billsByCompany.has(companyKey)) {
        billsByCompany.set(companyKey, {
          companyName: companyKey,
          clientIds: new Set<number>(),
          bills: [],
        });
      }

      const group = billsByCompany.get(companyKey)!;
      group.bills.push(bill);
      if (bill.clientId) {
        group.clientIds.add(bill.clientId);
      }
    });

    return Array.from(billsByCompany.entries())
      .map(([companyKey, companyData]) => ({
        companyKey,
        companyData,
      }));
  }, [clientById, companyTabBills, isByCompanyTab]);

  const brokerBillGroups = useMemo(() => {
    if (!isByBrokerTab) {
      return [];
    }

    const billsByBroker = new Map<
      number,
      { broker: Client; bills: Bill[] }
    >();

    brokerTabBills.forEach((bill) => {
      if (!bill.clientId || !brokerClientIds.has(bill.clientId)) return;

      const broker = clientById.get(bill.clientId);
      if (!broker) return;

      if (!billsByBroker.has(bill.clientId)) {
        billsByBroker.set(bill.clientId, { broker, bills: [] });
      }

      billsByBroker.get(bill.clientId)!.bills.push(bill);
    });

    return Array.from(billsByBroker.entries())
      .map(([brokerId, brokerData]) => ({
        brokerId,
        brokerData,
      }));
  }, [brokerClientIds, brokerTabBills, clientById, isByBrokerTab]);

  const paidByDateVisibleData = useMemo(() => {
    if (!isPaidByDateTab) {
      return EMPTY_PAID_BY_DATE_VISIBLE_DATA;
    }

    let remainingEntries = visiblePaidByDateEntriesCount;
    let visibleEntryCount = 0;

    const groups = paidByDateGroupsData.groups.reduce<VisiblePaidByDateGroup[]>((acc, group) => {
      if (remainingEntries <= 0) {
        return acc;
      }

      const visibleBillEntries = group.billEntries
        .slice()
        .sort((left, right) => {
          const latestPaymentDiff =
            right.latestPaymentTimestamp - left.latestPaymentTimestamp;

          if (latestPaymentDiff !== 0) {
            return latestPaymentDiff;
          }

          const billDateDiff = right.billTimestamp - left.billTimestamp;
          if (billDateDiff !== 0) {
            return billDateDiff;
          }

          return right.bill.id - left.bill.id;
        })
        .slice(0, remainingEntries);
      if (visibleBillEntries.length === 0) {
        return acc;
      }

      visibleEntryCount += visibleBillEntries.length;
      acc.push({
        ...group,
        visibleBillEntries,
        isPartiallyVisible: visibleBillEntries.length < group.totalBillEntries,
      });
      remainingEntries -= visibleBillEntries.length;
      return acc;
    }, []);

    return {
      groups,
      visibleEntryCount,
    };
  }, [isPaidByDateTab, paidByDateGroupsData.groups, visiblePaidByDateEntriesCount]);

  const visiblePaidByDateGroups = paidByDateVisibleData.groups;
  const visiblePaidByDateEntryCount = paidByDateVisibleData.visibleEntryCount;
  const visibleClientBillGroups = clientBillGroups.slice(0, visibleClientGroupsCount);
  const visibleCompanyBillGroups = companyBillGroups.slice(
    0,
    visibleCompanyGroupsCount,
  );
  const visibleBrokerBillGroups = brokerBillGroups.slice(0, visibleBrokerGroupsCount);

  const hasMorePaidByDateGroups =
    visiblePaidByDateEntryCount < paidByDateGroupsData.totalPaymentEntries;
  const hasMoreClientGroups =
    visibleClientBillGroups.length < clientBillGroups.length;
  const hasMoreCompanyGroups =
    visibleCompanyBillGroups.length < companyBillGroups.length;
  const hasMoreBrokerGroups =
    visibleBrokerBillGroups.length < brokerBillGroups.length;

  useEffect(() => {
    if (
      isMobile ||
      (activeTab !== "by-client" &&
        activeTab !== "by-company" &&
        activeTab !== "by-broker")
    ) {
      return;
    }

    const isDialogShortcutContextActive = () =>
      Boolean(document.querySelector('[role="dialog"][data-state="open"], [aria-modal="true"]'));

    const getOpenFolderKeys = () => {
      if (activeTab === "by-client") return openClientBillFolders;
      if (activeTab === "by-company") return openCompanyBillFolders;
      if (activeTab === "by-broker") return openBrokerBillFolders;
      return [];
    };

    const getFolderBills = (target: { tab: BillsTabValue; key: string }) => {
      if (target.tab === "by-client") {
        return (
          visibleClientBillGroups.find((group) => group.clientKey === target.key)
            ?.clientData.bills || []
        );
      }

      if (target.tab === "by-company") {
        return (
          visibleCompanyBillGroups.find((group) => group.companyKey === target.key)
            ?.companyData.bills || []
        );
      }

      if (target.tab === "by-broker") {
        return (
          visibleBrokerBillGroups.find(
            (group) => `broker-${group.brokerId}` === target.key,
          )?.brokerData.bills || []
        );
      }

      return [];
    };

    const focusGroupedFolder = (target: { tab: BillsTabValue; key: string }) => {
      const folderElement = Array.from(
        document.querySelectorAll<HTMLElement>("[data-bills-folder-key]"),
      ).find(
        (element) =>
          element.dataset.billsFolderTab === target.tab &&
          element.dataset.billsFolderKey === target.key,
      );

      folderElement?.focus({ preventScroll: true });
      folderElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };

    const getActiveFolderTarget = () => {
      const hoveredFolder = hoveredGroupedBillsFolderRef.current;
      if (hoveredFolder?.tab === activeTab) {
        return hoveredFolder;
      }

      const openFolderKeys = getOpenFolderKeys();
      const openFolderKey = openFolderKeys[openFolderKeys.length - 1];
      return openFolderKey ? { tab: activeTab, key: openFolderKey } : null;
    };

    const handleGroupedFolderSelectAllShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== "a" || (!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }

      if (isEditableKeyboardShortcutTarget(event)) {
        return;
      }

      if (isDialogShortcutContextActive()) {
        return;
      }

      const targetFolder = getActiveFolderTarget();
      if (!targetFolder) {
        return;
      }

      event.preventDefault();
      focusGroupedFolder(targetFolder);
      toggleBillsSelection(getFolderBills(targetFolder));
    };

    window.addEventListener("keydown", handleGroupedFolderSelectAllShortcut);
    return () => {
      window.removeEventListener("keydown", handleGroupedFolderSelectAllShortcut);
    };
  }, [
    activeTab,
    isMobile,
    openBrokerBillFolders,
    openClientBillFolders,
    openCompanyBillFolders,
    toggleBillsSelection,
    visibleBrokerBillGroups,
    visibleClientBillGroups,
    visibleCompanyBillGroups,
  ]);

  const loadMorePaidByDateGroups = useCallback(() => {
    setVisiblePaidByDateEntriesCount((current) =>
      Math.min(
        paidByDateGroupsData.totalPaymentEntries,
        current + BILLS_LOAD_MORE_COUNT,
      ),
    );
  }, [paidByDateGroupsData.totalPaymentEntries]);

  const loadMoreClientGroups = useCallback(() => {
    setVisibleClientGroupsCount((current) =>
      Math.min(clientBillGroups.length, current + BILLS_LOAD_MORE_COUNT),
    );
  }, [clientBillGroups.length]);

  const loadMoreCompanyGroups = useCallback(() => {
    setVisibleCompanyGroupsCount((current) =>
      Math.min(companyBillGroups.length, current + BILLS_LOAD_MORE_COUNT),
    );
  }, [companyBillGroups.length]);

  const loadMoreBrokerGroups = useCallback(() => {
    setVisibleBrokerGroupsCount((current) =>
      Math.min(brokerBillGroups.length, current + BILLS_LOAD_MORE_COUNT),
    );
  }, [brokerBillGroups.length]);

  const getGroupedTabLoadState = useCallback(() => {
    if (activeTab === "paid-by-date") {
      return {
        hasMore: hasMorePaidByDateGroups,
        loadMore: loadMorePaidByDateGroups,
      };
    }

    if (activeTab === "by-client") {
      return {
        hasMore: hasMoreClientGroups,
        loadMore: loadMoreClientGroups,
      };
    }

    if (activeTab === "by-company") {
      return {
        hasMore: hasMoreCompanyGroups,
        loadMore: loadMoreCompanyGroups,
      };
    }

    if (activeTab === "by-broker") {
      return {
        hasMore: hasMoreBrokerGroups,
        loadMore: loadMoreBrokerGroups,
      };
    }

    return null;
  }, [
    activeTab,
    hasMoreBrokerGroups,
    hasMoreClientGroups,
    hasMoreCompanyGroups,
    hasMorePaidByDateGroups,
    loadMoreBrokerGroups,
    loadMoreClientGroups,
    loadMoreCompanyGroups,
    loadMorePaidByDateGroups,
  ]);

  const maybeLoadMoreGroupedTabContent = useCallback(
    (container?: HTMLElement | null) => {
      const groupedTabLoadState = getGroupedTabLoadState();
      if (!groupedTabLoadState || !container || !groupedTabLoadState.hasMore) return;

      const remainingScroll =
        container.scrollHeight - container.scrollTop - container.clientHeight;

      if (remainingScroll > BILLS_LOAD_MORE_THRESHOLD_PX) {
        return;
      }

      groupedTabLoadState.loadMore();
    },
    [getGroupedTabLoadState],
  );

  useEffect(() => {
    if (activeTab !== "paid-by-date") return;

    setVisiblePaidByDateEntriesCount((current) => {
      if (paidByDateGroupsData.totalPaymentEntries === 0) {
        return BILLS_INITIAL_LOAD_COUNT;
      }

      return Math.min(
        Math.max(current, BILLS_INITIAL_LOAD_COUNT),
        paidByDateGroupsData.totalPaymentEntries,
      );
    });
  }, [activeTab, paidByDateGroupsData.totalPaymentEntries]);

  useEffect(() => {
    if (
      activeTab !== "paid-by-date" &&
      activeTab !== "by-client" &&
      activeTab !== "by-company" &&
      activeTab !== "by-broker"
    ) {
      return;
    }

    let target: HTMLDivElement | null = null;
    let hasMore = false;
    let loadMore = () => {};

    if (activeTab === "paid-by-date") {
      target = paidByDateLoadMoreRef.current;
      hasMore = hasMorePaidByDateGroups;
      loadMore = loadMorePaidByDateGroups;
    } else if (activeTab === "by-client") {
      target = clientGroupsLoadMoreRef.current;
      hasMore = hasMoreClientGroups;
      loadMore = loadMoreClientGroups;
    } else if (activeTab === "by-company") {
      target = companyGroupsLoadMoreRef.current;
      hasMore = hasMoreCompanyGroups;
      loadMore = loadMoreCompanyGroups;
    } else if (activeTab === "by-broker") {
      target = brokerGroupsLoadMoreRef.current;
      hasMore = hasMoreBrokerGroups;
      loadMore = loadMoreBrokerGroups;
    }

    if (!target || !hasMore) return;

    const scrollRoot = groupedTabsScrollRootRef.current;
    if (!scrollRoot) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      {
        root: scrollRoot,
        rootMargin: `0px 0px ${BILLS_LOAD_MORE_THRESHOLD_PX}px 0px`,
        threshold: 0,
      },
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [
    activeTab,
    hasMoreBrokerGroups,
    hasMoreClientGroups,
    hasMoreCompanyGroups,
    hasMorePaidByDateGroups,
    loadMoreBrokerGroups,
    loadMoreClientGroups,
    loadMoreCompanyGroups,
    loadMorePaidByDateGroups,
    visibleBrokerGroupsCount,
    visibleClientGroupsCount,
    visibleCompanyGroupsCount,
    visiblePaidByDateEntriesCount,
  ]);

  useEffect(() => {
    if (isBillsTab) return;
    maybeLoadMoreGroupedTabContent(groupedTabsScrollRootRef.current);
  }, [
    isBillsTab,
    maybeLoadMoreGroupedTabContent,
    visibleBrokerGroupsCount,
    visibleClientGroupsCount,
    visibleCompanyGroupsCount,
    visiblePaidByDateEntriesCount,
  ]);

  const selectedBillsFolderHasPayment = !!selectedBillsOutstandingSummary;
  const selectedBillsFolderHasRevert = !!selectedBillsRevertSummary;
  const shouldShowSelectedBillsFolders =
    selectedBillsFolderHasPayment || selectedBillsFolderHasRevert;
  const activeSelectedBillsFolderKind: SelectedBillsFolderKind =
    selectedBillsFolderKind === "revert" && selectedBillsFolderHasRevert
      ? "revert"
      : selectedBillsFolderKind === "payment" && selectedBillsFolderHasPayment
        ? "payment"
        : selectedBillsFolderHasPayment
          ? "payment"
          : "revert";

  const openSelectedBillsFolderDialog = (kind: SelectedBillsFolderKind) => {
    setSelectedBillsFolderKind(kind);
    setIsSelectedBillsFolderOpen(true);
  };

  const renderSelectedBillsFolderModeSwitch = () => {
    if (!selectedBillsFolderHasPayment || !selectedBillsFolderHasRevert) return null;

    return (
      <div className={`${isMobile ? "mb-1" : "mb-2"} grid grid-cols-2 rounded-xl border border-border/60 bg-muted/40 p-0.5`}>
        <button
          type="button"
          className={`${isMobile ? "h-[20px] text-[9px] leading-none" : "h-7 text-xs"} rounded-lg px-1.5 font-semibold transition-colors ${
            activeSelectedBillsFolderKind === "payment"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-muted-foreground hover:bg-background/80"
          }`}
          onClick={() => setSelectedBillsFolderKind("payment")}
          data-testid="button-show-selected-unpaid-folder"
        >
          {isMobile ? `Unpaid ${selectedBillsOutstandingSummary?.billCount || 0}` : `Unpaid (${selectedBillsOutstandingSummary?.billCount || 0})`}
        </button>
        <button
          type="button"
          className={`${isMobile ? "h-[20px] text-[9px] leading-none" : "h-7 text-xs"} rounded-lg px-1.5 font-semibold transition-colors ${
            activeSelectedBillsFolderKind === "revert"
              ? "bg-destructive text-destructive-foreground shadow-sm"
              : "text-muted-foreground hover:bg-background/80"
          }`}
          onClick={() => setSelectedBillsFolderKind("revert")}
          data-testid="button-show-selected-paid-folder"
        >
          {isMobile ? `Paid ${selectedBillsRevertSummary?.billCount || 0}` : `Paid (${selectedBillsRevertSummary?.billCount || 0})`}
        </button>
      </div>
    );
  };

  const renderSelectedBillsFolderEmptyState = () => (
    <div className="rounded-2xl border border-dashed border-border/70 p-4 text-center">
      <FolderOpen className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
      <p className="text-sm font-semibold text-foreground">
        No selected bills
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Select unpaid bills for payment or paid bills for revert.
      </p>
    </div>
  );

  const renderSelectedBillsFolderList = (kind: SelectedBillsFolderKind) => {
    const selectedBills = kind === "payment" ? selectedBillsForPayment : selectedBillsForRevert;
    const isPaymentFolder = kind === "payment";

    if (selectedBills.length === 0) {
      return renderSelectedBillsFolderEmptyState();
    }

    return (
      <div
        className={`${isMobile ? "max-h-[42vh]" : "max-h-[50vh]"} overflow-y-auto rounded-xl border border-border/70 bg-background/95 p-1 shadow-inner`}
      >
        <div className="overflow-hidden rounded-lg border border-border/60 bg-background/95">
          {selectedBills.map((bill) => {
            const displayAmounts = getBillDisplayAmounts(bill);
            const linkedClient = bill.clientId ? clientById.get(bill.clientId) : null;
            const clientName =
              bill.customerName || linkedClient?.name || "Walk-in Customer";
            const accountLabel = getClientAccountLabel(bill.clientId);
            const isOutsideCurrentSearch = !filteredBillsById.has(bill.id);
            const amountLabel = isPaymentFolder ? "Due" : "Paid";
            const amountValue = isPaymentFolder
              ? displayAmounts.due
              : displayAmounts.paidAmount;

            return (
              <div
                key={bill.id}
                className={`flex items-center gap-2 border-b border-border/60 last:border-b-0 ${
                  isMobile ? "px-2 py-1.5" : "px-3 py-2.5"
                } ${
                  isOutsideCurrentSearch
                    ? "bg-amber-50/80 dark:bg-amber-950/30"
                    : "bg-background"
                }`}
                data-testid={`selected-${isPaymentFolder ? "unpaid" : "paid"}-bill-row-${bill.id}`}
              >
                <button
                  type="button"
                  className={`grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center text-left ${
                    isMobile ? "gap-2" : "gap-3"
                  }`}
                  onClick={(event) => handleBillShortcutClick(event, bill)}
                >
                  <span className="min-w-0">
                    <span className={`flex min-w-0 items-center gap-1.5 ${isMobile ? "text-[10px]" : "text-sm"}`}>
                      <span className={`shrink-0 font-bold ${isPaymentFolder ? "text-blue-600" : "text-destructive"}`}>
                        #{bill.id}
                      </span>
                      {bill.referenceNumber && (
                        <span className={`truncate text-muted-foreground ${isMobile ? "text-[8.5px]" : "text-xs"}`}>
                          {bill.referenceNumber}
                        </span>
                      )}
                      {isOutsideCurrentSearch && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-200">
                          outside search
                        </span>
                      )}
                    </span>
                    <span className={`mt-0.5 block truncate text-muted-foreground ${isMobile ? "text-[8.5px]" : "text-xs"}`}>
                      {clientName}
                      {accountLabel ? ` | ${accountLabel}` : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className={`block text-muted-foreground ${isMobile ? "text-[8px]" : "text-xs"}`}>{amountLabel}</span>
                    <span className={`block font-semibold text-foreground ${isMobile ? "text-[10px]" : "text-sm"}`}>
                      {amountValue.toFixed(2)} AED
                    </span>
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={`${isMobile ? "h-6 w-6" : "h-8 w-8"} shrink-0 rounded-full`}
                  onClick={() => clearBillSelections([bill.id])}
                  aria-label={`Remove selected bill ${bill.id}`}
                  data-testid={`button-remove-selected-${isPaymentFolder ? "unpaid" : "paid"}-bill-${bill.id}`}
                >
                  <X className={isMobile ? "h-3 w-3" : "h-4 w-4"} />
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSelectedBillsFolderCard = (
    kind: SelectedBillsFolderKind,
    options?: { showModeSwitch?: boolean; inDialog?: boolean },
  ) => {
    const isPaymentFolder = kind === "payment";
    const paymentSummary = selectedBillsOutstandingSummary;
    const revertSummary = selectedBillsRevertSummary;
    const summary = isPaymentFolder ? paymentSummary : revertSummary;
    if (!summary) return null;

    const isDialogCard = !!options?.inDialog;
    const isFolderDialogOpen = isSelectedBillsFolderOpen && selectedBillsFolderKind === kind;
    const hiddenBySearchCount = isPaymentFolder
      ? selectedBillsHiddenBySearchCount
      : selectedPaidBillsHiddenBySearchCount;
    const title = isMobile
      ? isPaymentFolder
        ? "Unpaid Bills Folder"
        : "Paid Bills Folder"
      : isPaymentFolder
        ? "Selected Unpaid Bills Folder"
        : "Selected Paid Bills Folder";
    const subtitle = isPaymentFolder && paymentSummary
      ? `${paymentSummary.billCount} bill${paymentSummary.billCount === 1 ? "" : "s"} | Clients: ${paymentSummary.clientCount} | Remaining: AED ${paymentSummary.totalRemaining.toFixed(2)}${
          paymentSummary.sharedPaymentLabel ? ` | ${paymentSummary.sharedPaymentLabel}` : ""
        }`
      : revertSummary
        ? `${revertSummary.billCount} payment${revertSummary.billCount === 1 ? "" : "s"} | Clients: ${revertSummary.clientCount} | Paid: AED ${revertSummary.totalPaid.toFixed(2)}`
        : "";
    const folderHeaderContent = (
      <>
        <span
          className={`inline-flex ${isMobile ? "h-7 w-7 rounded-lg" : "h-9 w-9 rounded-xl"} shrink-0 items-center justify-center border ${
            isPaymentFolder
              ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
              : "border-destructive/25 bg-destructive/10 text-destructive"
          }`}
        >
          <FolderOpen className={isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-semibold text-foreground ${isMobile ? "text-[10px]" : "text-sm"}`}>
            {title}
          </span>
          <span className={`block text-muted-foreground ${isMobile ? "text-[8.5px] leading-tight" : "text-xs"}`}>
            {subtitle}
          </span>
          {hiddenBySearchCount > 0 && (
            <span className={`mt-0.5 block font-medium text-amber-700 dark:text-amber-400 ${isMobile ? "text-[8.5px]" : "text-xs"}`}>
              {hiddenBySearchCount} selected bill{hiddenBySearchCount === 1 ? " is" : "s are"} outside the current search.
            </span>
          )}
          {isPaymentFolder && paymentSummary?.hasBillsWithoutClient && (
            <span className={`mt-0.5 block text-amber-700 dark:text-amber-400 ${isMobile ? "text-[8.5px]" : "text-xs"}`}>
              Some selected bills are not linked to a client account.
            </span>
          )}
        </span>
      </>
    );
    const closeSelectedFolderSurfaces = () => {
      setIsSelectedBillsFolderOpen(false);
      setMobileBillsControlDialog(null);
    };
    const handleSelectedFolderPrimaryAction = () => {
      closeSelectedFolderSurfaces();
      if (isPaymentFolder) {
        handlePaySelectedBills();
      } else {
        handleBulkRevertSelectedPayments();
      }
    };

    return (
      <div
        className={`relative rounded-2xl border bg-background/95 ${isMobile ? "p-1.5" : "p-2.5"} shadow-lg backdrop-blur animate-in fade-in-0 slide-in-from-top-1 duration-200 ${
          isPaymentFolder
            ? "border-blue-200 shadow-blue-500/5 dark:border-blue-900/60"
            : "border-destructive/25 shadow-destructive/5"
        }`}
      >
        {options?.showModeSwitch && renderSelectedBillsFolderModeSwitch()}
        <div className="flex items-start gap-1.5">
          {isDialogCard ? (
            <div className="flex min-w-0 flex-1 items-start gap-1.5 text-left">
              {folderHeaderContent}
            </div>
          ) : (
            <button
              type="button"
              className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
              onClick={() => openSelectedBillsFolderDialog(kind)}
              aria-haspopup="dialog"
              aria-expanded={isFolderDialogOpen}
              data-testid={`button-selected-${isPaymentFolder ? "unpaid" : "paid"}-bills-folder`}
            >
              {folderHeaderContent}
              <span className={`${isMobile ? "mt-0 h-5 w-5" : "mt-1 h-7 w-7"} inline-flex shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground`}>
                <ChevronRight className={isMobile ? "h-3 w-3" : "h-4 w-4"} />
              </span>
            </button>
          )}
        </div>

        <div className={`${isMobile ? "mt-1.5 gap-1" : "mt-2 gap-2"} grid grid-cols-2`}>
          {isPaymentFolder ? (
            <Button
              variant="default"
              size="sm"
              className={`${isMobile ? "!h-[22px] !min-h-0 !gap-1 !px-1 !py-0 !text-[9px] !leading-none" : "h-8"} bg-blue-600 text-white hover:bg-blue-700`}
              onClick={handleSelectedFolderPrimaryAction}
              disabled={paymentSummary?.hasBillsWithoutClient}
              data-testid="button-pay-selected-bills"
            >
              <DollarSign className={`${isMobile ? "mr-1 h-3 w-3" : "mr-1.5 h-3.5 w-3.5"}`} />
              {isMobile ? "Pay" : "Pay Selected"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className={isMobile ? "!h-[22px] !min-h-0 !gap-1 !px-1 !py-0 !text-[9px] !leading-none" : "h-8"}
              onClick={handleSelectedFolderPrimaryAction}
              title={`Selected paid amount: ${revertSummary?.totalPaid.toFixed(2) || "0.00"} AED`}
              data-testid="button-bulk-revert-selected-bills"
            >
              <RotateCcw className={`${isMobile ? "mr-1 h-3 w-3" : "mr-1.5 h-3.5 w-3.5"}`} />
              {isMobile ? "Revert" : "Revert Selected"}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={isMobile ? "!h-[22px] !min-h-0 !gap-1 !px-1 !py-0 !text-[9px] !leading-none" : "h-8"}
            onClick={() => clearBillSelections(summary.billIds)}
            data-testid={`button-clear-selected-${isPaymentFolder ? "unpaid" : "paid"}-bills`}
          >
            <X className={`${isMobile ? "mr-1 h-3 w-3" : "mr-1.5 h-3.5 w-3.5"}`} />
            Clear
          </Button>
        </div>

      </div>
    );
  };

  const renderMobileControlBadge = (count: number) => {
    if (count <= 0) return null;

    return (
      <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground shadow-sm">
        {count > 9 ? "9+" : count}
      </span>
    );
  };

  const renderSelectedBillsFolderDialogBody = () => (
    <div className={isMobile ? "space-y-2" : "space-y-3"}>
      {shouldShowSelectedBillsFolders ? (
        <>
          {renderSelectedBillsFolderModeSwitch()}
          {renderSelectedBillsFolderCard(activeSelectedBillsFolderKind, {
            inDialog: true,
          })}
          {renderSelectedBillsFolderList(activeSelectedBillsFolderKind)}
        </>
      ) : (
        renderSelectedBillsFolderEmptyState()
      )}
    </div>
  );

  const mobileBillsSearchDialogContent = (
    <div>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Search
          </p>
          <p className="text-[9px] text-muted-foreground">
            {mobileBillsSearchSummaryLabel}
          </p>
        </div>
        {hasActiveBillsSearchFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-[22px] shrink-0 rounded-full px-2 text-[9px]"
            onClick={clearBillsSearchFilters}
            data-testid="button-clear-mobile-bills-search-filters"
          >
            Clear
          </Button>
        ) : null}
      </div>
      {billsSearchFields}
    </div>
  );

  const mobileBillsFiltersDialogContent = (
    <div>
      <div className="mb-1.5">
        <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Status, View, Sort
        </p>
        <p className="text-[9px] text-muted-foreground">
          Control which bills appear below.
        </p>
      </div>
      {renderSharedBillFilters()}
    </div>
  );

  const mobileBillsControlDialogTitle =
    mobileBillsControlDialog === "overview"
      ? "Bills Overview"
      : mobileBillsControlDialog === "search"
        ? "Search Bills"
        : mobileBillsControlDialog === "filters"
          ? "Status, View, Sort"
          : mobileBillsControlDialog === "folders"
            ? "Selected Bill Folders"
            : "Bills Controls";

  const renderMobileBillsControlDialogBody = () => {
    switch (mobileBillsControlDialog) {
      case "overview":
        return mobileBillsOverviewDialogContent;
      case "search":
        return mobileBillsSearchDialogContent;
      case "filters":
        return mobileBillsFiltersDialogContent;
      case "folders":
        return renderSelectedBillsFolderDialogBody();
      default:
        return null;
    }
  };

  const mobileControlButtonClass =
    "relative inline-flex h-10 min-w-[58px] flex-col items-center justify-center gap-0.5 rounded-xl border px-1 shadow-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  const mobileBillsControlsPopoverBar = isMobile ? (
    <div className="relative z-20 mb-2 flex items-center justify-between gap-1.5 rounded-2xl border border-border/60 bg-background/95 px-2 py-1.5 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.55)] backdrop-blur">
      <button
        type="button"
        className={`${mobileControlButtonClass} border-emerald-200 bg-emerald-50 text-emerald-700 hover:text-emerald-800 aria-pressed:border-emerald-300 aria-pressed:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300`}
        aria-label="Bills overview"
        aria-pressed={mobileBillsControlDialog === "overview"}
        onClick={() => setMobileBillsControlDialog("overview")}
        data-testid="button-mobile-bills-overview-popover"
      >
        <BarChart3 className="h-3.5 w-3.5" />
        <span className="text-[8px] font-semibold leading-none">Overview</span>
      </button>

      <button
        type="button"
        className={`${mobileControlButtonClass} border-sky-200 bg-sky-50 text-sky-700 hover:text-sky-800 aria-pressed:border-sky-300 aria-pressed:bg-sky-100 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300`}
        aria-label="Search bills"
        aria-pressed={mobileBillsControlDialog === "search"}
        onClick={() => setMobileBillsControlDialog("search")}
        data-testid="button-mobile-bills-search-popover"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="text-[8px] font-semibold leading-none">Search</span>
        {renderMobileControlBadge(activeBillsSearchFilterCount)}
      </button>

      <button
        type="button"
        className={`${mobileControlButtonClass} border-blue-200 bg-blue-50 text-blue-700 hover:text-blue-800 aria-pressed:border-blue-300 aria-pressed:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300`}
        aria-label="Bill status, view, and sort filters"
        aria-pressed={mobileBillsControlDialog === "filters"}
        onClick={() => setMobileBillsControlDialog("filters")}
        data-testid="button-mobile-bills-filter-popover"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span className="text-[8px] font-semibold leading-none">Filters</span>
        {renderMobileControlBadge(activeBillsViewFilterCount)}
      </button>

      <button
        type="button"
        className={`${mobileControlButtonClass} border-violet-200 bg-violet-50 text-violet-700 hover:text-violet-800 aria-pressed:border-violet-300 aria-pressed:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300`}
        aria-label="Selected bill folders"
        aria-pressed={mobileBillsControlDialog === "folders"}
        onClick={() => {
          setSelectedBillsFolderKind(activeSelectedBillsFolderKind);
          setMobileBillsControlDialog("folders");
        }}
        data-testid="button-mobile-selected-bills-folder-popover"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="text-[8px] font-semibold leading-none">Folders</span>
        {renderMobileControlBadge(selectedBillIds.size)}
      </button>
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as BillsTabValue)}
        className="flex flex-1 min-h-0 flex-col"
      >
        <TopBar
          onSearch={setSearchTerm}
          searchValue={searchTerm}
          pageTitle="Bills"
          searchPlacement="beside-title"
          compactMobile
          expandMobileSearchOnFocus={isMobile}
          showSearch={false}
          extraContent={
            <div className={`flex max-w-full ${isMobile ? "w-full flex-col gap-1.5" : "flex-wrap items-center justify-end gap-2"}`}>
              {!isMobile && compactBillsOverview}
              <div
                className={
                  isMobile
                    ? "w-full overflow-x-auto rounded-[20px] border border-border/60 bg-background/95 p-1 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.45)] backdrop-blur-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    : ""
                }
              >
                <TabsList className={`${isMobile ? "inline-flex h-8 min-w-max flex-nowrap justify-start gap-1 bg-transparent p-0" : "flex h-auto flex-wrap justify-start gap-1"}`}>
                  <TabsTrigger
                    value="bills"
                    title="All Bills"
                    className={`${isMobile ? "h-6.5 shrink-0 rounded-[12px] border border-transparent px-2.5 py-0 text-[10px] font-semibold leading-none whitespace-nowrap text-muted-foreground transition-all hover:text-foreground data-[state=active]:border-primary/20 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm" : ""} ${highlightedBillId ? "animate-order-focus-glow ring-2 ring-primary/30 ring-offset-1" : ""}`}
                  >
                    {isMobile ? "All" : "All Bills"}
                  </TabsTrigger>
                  <TabsTrigger
                    value="paid-by-date"
                    title="Paid by Date"
                    className={isMobile ? "h-6.5 shrink-0 rounded-[12px] border border-transparent px-2.5 py-0 text-[10px] font-semibold leading-none whitespace-nowrap text-muted-foreground transition-all hover:text-foreground data-[state=active]:border-primary/20 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm" : ""}
                  >
                    {isMobile ? "Paid" : "Paid by Date"}
                  </TabsTrigger>
                  <TabsTrigger
                    value="by-client"
                    title="By Client"
                    className={isMobile ? "h-6.5 shrink-0 rounded-[12px] border border-transparent px-2.5 py-0 text-[10px] font-semibold leading-none whitespace-nowrap text-muted-foreground transition-all hover:text-foreground data-[state=active]:border-primary/20 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm" : ""}
                  >
                    {isMobile ? "Client" : "By Client"}
                  </TabsTrigger>
                  <TabsTrigger
                    value="by-company"
                    title="By Company"
                    className={isMobile ? "h-6.5 shrink-0 rounded-[12px] border border-transparent px-2.5 py-0 text-[10px] font-semibold leading-none whitespace-nowrap text-muted-foreground transition-all hover:text-foreground data-[state=active]:border-primary/20 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm" : ""}
                  >
                    {isMobile ? "Company" : "By Company"}
                  </TabsTrigger>
                  <TabsTrigger
                    value="by-broker"
                    title="By Broker"
                    className={isMobile ? "h-6.5 shrink-0 rounded-[12px] border border-transparent px-2.5 py-0 text-[10px] font-semibold leading-none whitespace-nowrap text-muted-foreground transition-all hover:text-foreground data-[state=active]:border-primary/20 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm" : ""}
                  >
                    {isMobile ? "Broker" : "By Broker"}
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>
          }
        />

        <main
          ref={groupedTabsScrollRootRef}
          className={`flex-1 container mx-auto ${isMobile ? "px-2.5 py-3" : "px-4 py-8"} ${isBillsTab ? "overflow-hidden flex flex-col" : "overflow-auto"}`}
          onScroll={(event) => {
            if (!isBillsTab) {
              maybeLoadMoreGroupedTabContent(event.currentTarget);
            }
          }}
        >
          {isMobile ? (
            mobileBillsControlsPopoverBar
          ) : (
            <>
              <div className="mb-3 shrink-0">
                <div className="rounded-[24px] border border-border/60 bg-card/95 p-3 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.24)]">
                  <div className={hasActiveBillsSearchFilters ? "mb-2 flex justify-end" : "hidden"}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 rounded-full px-2.5 text-[11px]"
                      onClick={clearBillsSearchFilters}
                      data-testid="button-clear-bills-search-filters"
                    >
                      Clear
                    </Button>
                  </div>
                  {billsSearchFields}
                </div>
              </div>
              {renderSharedBillFilters()}
            </>
          )}

          {!isMobile && shouldShowSelectedBillsFolders && (
            <div
              className="sticky top-2 z-30 mb-3 shrink-0"
            >
              <div className="grid grid-cols-2 gap-2">
                {selectedBillsOutstandingSummary ? (
                  renderSelectedBillsFolderCard("payment")
                ) : (
                  <div aria-hidden="true" />
                )}
                {selectedBillsRevertSummary ? (
                  renderSelectedBillsFolderCard("revert")
                ) : (
                  <div aria-hidden="true" />
                )}
              </div>
            </div>
          )}

          <TabsContent value="bills" className="mt-0 flex flex-1 min-h-0 flex-col">
            {isBillsTab ? (
            <>
            <div className={`mb-2 shrink-0 ${isMobile ? "space-y-1.5" : ""}`}>
              {isMobile ? (
                <div className="flex flex-wrap items-center gap-1">
                  <p className="mr-auto text-[10px] text-muted-foreground">
                    Track bill entries.
                  </p>
                  <span className="inline-flex h-5 items-center rounded-full border border-border/60 bg-muted/35 px-1.5 text-[9px] font-semibold text-muted-foreground">
                    <span className="text-primary">{matchingBillCount}</span>
                    <span className="ml-1">total</span>
                  </span>
                  <span className="inline-flex h-5 items-center rounded-full border border-border/60 bg-muted/35 px-1.5 text-[9px] font-semibold text-muted-foreground">
                    <span className="text-primary">{visibleBills.length}</span>
                    <span className="ml-1">showing</span>
                  </span>
                </div>
              ) : (
                <div className="min-w-0 flex flex-wrap items-center gap-3">
                  <p className="text-muted-foreground">
                    Track bill entries for customers.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-sm font-medium text-muted-foreground bg-muted px-3 py-1 rounded-full">
                      <span>Total </span>
                      <span className="text-primary">{matchingBillCount}</span>
                    </div>
                    <div className="text-sm font-medium text-muted-foreground bg-muted px-3 py-1 rounded-full">
                      <span>Showing </span>
                      <span className="text-primary">{visibleBills.length}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Loader2 className="w-10 h-10 animate-spin mb-4 text-primary" />
                <p>Loading bills...</p>
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center justify-center py-20 text-destructive">
                <p className="font-semibold text-lg">Failed to load bills</p>
              </div>
            ) : filteredBills?.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-3xl bg-card/50">
                <FileText className="w-16 h-16 mb-4 opacity-50" />
                <h3 className="text-xl font-bold text-foreground mb-2">
                  {timePeriod === "custom" && !billsRangeApplied
                    ? "Select a date range"
                    : timePeriod === "date" && !exactDate
                      ? "Pick a date"
                      : hasActiveBillsSearchFilters
                        ? "No matching bills"
                        : "No bills found"}
                </h3>
                <p className="max-w-md text-center">
                  {timePeriod === "custom" && !billsRangeApplied
                    ? "Pick your start and end dates above, then click Apply Range to view bills."
                    : timePeriod === "date" && !exactDate
                      ? "Select an exact date above to view bills."
                      : hasActiveBillsSearchFilters
                        ? "No bills match the current search filters."
                        : "Bills are created automatically when orders are placed."}
                </p>
              </div>
            ) : isMobile ? (
              <div
                ref={billsListScrollRef}
                className="flex-1 min-h-0 overflow-y-auto pr-1 pb-4"
                onScroll={(event) => maybeLoadMoreVisibleBills(event.currentTarget)}
              >
                {billsListControls}
                <div className="space-y-3">
                  {visibleBills.map((bill) => {
                  const displayAmounts = getBillDisplayAmounts(bill);
                  const latestPaymentDate = getBillLatestPaymentDate(bill.id);
                  const statusMeta = getBillStatusMeta(bill, displayAmounts);
                  const linkedClient = bill.clientId
                    ? getClientById(bill.clientId)
                    : undefined;
                  const accountLabel = getClientAccountLabel(bill.clientId);
                  const phoneLine = getDisplayPhone(bill.customerPhone, linkedClient?.phone);
                  const addressLine = getBillAddressLines(bill, linkedClient)[0] || "";
                  const linkedOrders = ordersByBillId.get(bill.id) || [];
                  const billTypeMeta = getBillTypeMeta(bill);
                  const isUnpaid = displayAmounts.due > 0.01;
                  const canSelectBill = isBillSelectableForBulkAction(bill);

                  return (
                    <Card
                      key={bill.id}
                      data-bill-id={bill.id}
                      data-testid={`row-bill-${bill.id}`}
                      role="button"
                      tabIndex={0}
                      onClickCapture={(event) => handleBillShortcutSelectionCapture(event, bill)}
                      onClick={(event) => handleBillShortcutClick(event, bill)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setViewBillDetails(bill);
                        }
                      }}
                      className={`relative overflow-hidden rounded-[24px] border shadow-[0_18px_40px_-32px_rgba(15,23,42,0.38)] transition-all active:scale-[0.99] ${statusMeta.mobileCardClass} ${selectedBillIds.has(bill.id) ? "ring-2 ring-primary/40 ring-offset-2" : ""} ${highlightedBillId === bill.id ? "ring-2 ring-primary ring-offset-2 animate-order-focus-glow" : ""}`}
                    >
                      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${statusMeta.accentClass}`} />
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex items-start gap-2">
                            <div
                              className="pt-0.5"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {canSelectBill ? (
                                <input
                                  type="checkbox"
                                  checked={selectedBillIds.has(bill.id)}
                                  onChange={() => toggleBillSelection(bill.id)}
                                  className="rounded border-gray-300"
                                  data-testid={`checkbox-bill-${bill.id}`}
                                />
                              ) : (
                                <div className="h-4 w-4" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-base font-bold text-primary ${highlightedBillId === bill.id ? "animate-order-focus-text" : ""}`}>#{bill.id}</span>
                              </div>
                              <div className={`mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${billTypeMeta.textClassName}`}>
                                {billTypeMeta.label}
                              </div>
                              {bill.referenceNumber && (
                                <div className="mt-1">
                                  <span className="rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                    {bill.referenceNumber}
                                  </span>
                                </div>
                              )}
                              <div className="mt-1 text-xs text-muted-foreground">
                                {formatBillDateTime(bill.billDate)}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <Badge className={`text-[10px] text-white shadow-sm ${statusMeta.badgeClass}`}>
                              {statusMeta.label}
                            </Badge>
                          </div>
                        </div>

                        <div className="mt-3 rounded-[20px] border border-border/60 bg-background/75 p-3">
                          <div className="flex items-start gap-3">
                            <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${statusMeta.summaryClass}`}>
                              <User className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                                  {bill.clientId
                                    ? bill.customerName || getClientName(bill.clientId)
                                    : bill.customerName || "Unknown Client"}
                                </p>
                                {accountLabel && (
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {accountLabel}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                {phoneLine && (
                                  <span className="inline-flex items-center gap-1">
                                    <Phone className="h-3 w-3" />
                                    {phoneLine}
                                  </span>
                                )}
                                {linkedClient?.company && (
                                  <span className="inline-flex items-center gap-1">
                                    <Building2 className="h-3 w-3" />
                                    {linkedClient.company}
                                  </span>
                                )}
                              </div>
                              {addressLine && (
                                <div className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
                                  <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                                  <span className="line-clamp-2">{addressLine}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div className="rounded-2xl border border-border/60 bg-background/70 p-3">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Final</p>
                            <p className="mt-1 text-lg font-bold text-foreground">{displayAmounts.finalAmount.toFixed(2)} <span className="text-xs font-medium text-muted-foreground">AED</span></p>
                            {displayAmounts.discount > 0 && (
                              <p className="mt-1 text-[11px] text-orange-600">Discount {displayAmounts.discount.toFixed(2)}</p>
                            )}
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-background/70 p-3">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Due</p>
                            <p className="mt-1 text-lg font-bold text-red-600 dark:text-red-400">{displayAmounts.due.toFixed(2)} <span className="text-xs font-medium text-muted-foreground">AED</span></p>
                            <p className="mt-1 text-[11px] text-muted-foreground">Paid {displayAmounts.paidAmount.toFixed(2)} AED</p>
                          </div>
	                          <div className="rounded-2xl border border-border/60 bg-background/70 p-3">
	                            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Work Rec.</p>
	                            <p className="mt-1 text-sm font-semibold text-foreground">{displayAmounts.originalAmount.toFixed(2)} AED</p>
	                            {displayAmounts.deliveryCharge > 0.009 && (
	                              <p className="mt-1 text-[11px] text-blue-600 dark:text-blue-400">
	                                Delivery {displayAmounts.deliveryCharge.toFixed(2)}
	                              </p>
	                            )}
	                          </div>
                          <div className="rounded-2xl border border-border/60 bg-background/70 p-3">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Orders</p>
                            <p className="mt-1 text-sm font-semibold text-foreground">{linkedOrders.length} order{linkedOrders.length === 1 ? "" : "s"}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {(bill.isPaid || displayAmounts.paidAmount > 0.01)
                                ? formatPaymentMethodLabel(bill.paymentMethod)
                                : "Awaiting payment"}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 rounded-[20px] border border-border/60 bg-muted/35 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Bill Details</p>
                              <p className="mt-1 text-sm text-foreground line-clamp-2">
                                {bill.description || "No description available"}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-wrap justify-end gap-1">
                              {renderPartialHistoryDatePill(statusMeta.historyDate)}
                              <div className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusMeta.summaryClass}`}>
                                {latestPaymentDate ? `Paid ${formatBillCreatedDate(latestPaymentDate)}` : "Tap to view"}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div
                          className="mt-3 flex items-center gap-2"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {!bill.isPaid && (
                            <Button
                              variant="default"
                              size="sm"
                              className="h-9 flex-1 rounded-xl bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                              onClick={() => handlePayNow(bill)}
                              data-testid={`button-pay-now-${bill.id}`}
                            >
                              <DollarSign className="mr-1.5 h-3.5 w-3.5" />
                              Pay Now
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className={`${bill.isPaid ? "flex-1" : ""} h-9 rounded-xl px-3`}
                            onClick={() => void printBillPDF(bill)}
                            data-testid={`button-print-pdf-${bill.id}`}
                          >
                            <Printer className="mr-1.5 h-3.5 w-3.5" />
                            Print
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => handleDelete(bill.id)}
                            data-testid={`button-delete-bill-${bill.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                {filteredBillCount > 0 && (
                  <div className="py-2 text-center text-[11px] text-muted-foreground">
                    {hasMoreVisibleBills
                      ? `Scroll down to load ${BILLS_LOAD_MORE_COUNT} more bills`
                      : "All matching bills loaded"}
                  </div>
                )}
                </div>
              </div>
            ) : (
              <Card className="responsive-card flex flex-1 min-h-0 flex-col overflow-hidden">
                <div className="flex flex-1 min-h-0 overflow-hidden">
                  <div
                    ref={billsListScrollRef}
                    tabIndex={-1}
                    className="min-h-0 flex-1 overflow-auto"
                    onScroll={(event) => maybeLoadMoreVisibleBills(event.currentTarget)}
                  >
                    {billsListControls}
	                    <Table className="w-full min-w-[1180px]">
                      <TableHeader>
                        <TableRow className="transition-all duration-200 text-xs">
                          <TableHead className="w-[44px] px-2">
                            {(() => {
                              const visibleSelectableBills = visibleBills.filter((bill) =>
                                isBillSelectableForBulkAction(bill),
                              );
                              const allVisibleSelected =
                                visibleSelectableBills.length > 0 &&
                                visibleSelectableBills.every((bill) => selectedBillIds.has(bill.id));

                              if (visibleSelectableBills.length === 0) {
                                return null;
                              }

                              return (
                                <input
                                  type="checkbox"
                                  checked={allVisibleSelected}
                                  onChange={(event) => {
                                    event.stopPropagation();
                                    setSelectedBillIds((prev) => {
                                      const next = new Set(prev);
                                      if (allVisibleSelected) {
                                        visibleSelectableBills.forEach((bill) => next.delete(bill.id));
                                      } else {
                                        visibleSelectableBills.forEach((bill) => next.add(bill.id));
                                      }
                                      return next;
                                    });
                                  }}
                                  className="rounded border-gray-300"
                                  data-testid="checkbox-select-all-bills"
                                />
                              );
                            })()}
                          </TableHead>
                          <TableHead className="w-[120px] px-2">Date</TableHead>
                          <TableHead className="w-[90px] px-2">Bill</TableHead>
                          <TableHead className="w-[220px] px-2">Client</TableHead>
	                          <TableHead className="w-[240px] px-2">Details</TableHead>
	                          <TableHead className="w-[90px] px-2 text-right">Work Rec.</TableHead>
	                          <TableHead className="w-[90px] px-2 text-right">Delivery</TableHead>
	                          <TableHead className="w-[90px] px-2 text-right">Discount</TableHead>
                          <TableHead className="w-[90px] px-2 text-right">Final Amt</TableHead>
                          <TableHead className="w-[90px] px-2 text-right">Paid</TableHead>
                          <TableHead className="w-[90px] px-2 text-right">Due</TableHead>
                          <TableHead className="w-[90px] px-2">Status</TableHead>
                          <TableHead className="w-[130px] px-2">Payment</TableHead>
                          <TableHead className="w-[176px] px-2">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleBills.map((bill) => {
                          const displayAmounts = getBillDisplayAmounts(bill);
                          const latestPaymentDate = getBillLatestPaymentDate(bill.id);
                          const isPartiallyPaid = !bill.isPaid && displayAmounts.paidAmount > 0.01;
                          const statusMeta = getBillStatusMeta(bill, displayAmounts);
                          const isUnpaid = displayAmounts.due > 0.01;
                          const canSelectBill = isBillSelectableForBulkAction(bill);
                          const linkedClient = bill.clientId
                            ? getClientById(bill.clientId)
                            : undefined;
                          const addressLine = getBillAddressLines(bill, linkedClient)[0] || "";
                          return (
                            <TableRow
                              key={bill.id}
                              data-bill-id={bill.id}
                              data-testid={`row-bill-${bill.id}`}
                              onClickCapture={(event) => handleBillShortcutSelectionCapture(event, bill)}
                              onClick={(event) => handleBillShortcutClick(event, bill)}
                              className={`cursor-pointer transition-colors ${
                                bill.isPaid
                                  ? "bg-green-50/40 hover:bg-green-100/70 dark:bg-green-950/20 dark:hover:bg-green-950/40"
                                  : isPartiallyPaid
                                  ? "bg-amber-50/40 hover:bg-amber-100/70 dark:bg-amber-950/20 dark:hover:bg-amber-950/40"
                                  : "bg-blue-50/30 hover:bg-blue-100/70 dark:bg-blue-950/10 dark:hover:bg-blue-950/30"
                              } ${selectedBillIds.has(bill.id) ? "ring-1 ring-inset ring-primary/30" : ""} ${highlightedBillId === bill.id ? "order-focus-row" : ""}`}
                            >
                              <TableCell
                                className="px-2 py-3 align-top"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {canSelectBill ? (
                                  <input
                                    type="checkbox"
                                    checked={selectedBillIds.has(bill.id)}
                                    onChange={() => toggleBillSelection(bill.id)}
                                    className="rounded border-gray-300"
                                    data-testid={`checkbox-bill-${bill.id}`}
                                  />
                                ) : (
                                  <div className="h-4 w-4" />
                                )}
                              </TableCell>
                              <TableCell className="px-2 py-3 align-top">
                                <div className="flex flex-col leading-tight">
                                  <span className="font-medium text-foreground">
                                    {formatBillDateTime(bill.billDate)}
                                  </span>
                                  {statusMeta.historyDate ? (
                                    <span className="text-[11px] text-amber-700 dark:text-amber-300">
                                      Partial: {formatBillCreatedDate(statusMeta.historyDate)}
                                    </span>
                                  ) : null}
                                  <span className={`text-[11px] ${latestPaymentDate ? "text-green-600" : "text-muted-foreground"}`}>
                                    Paid: {formatBillPaymentDate(latestPaymentDate)}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="px-2 py-3 align-top">
                                <div className="flex flex-col leading-tight">
                                  <span className="font-semibold text-primary">#{bill.id}</span>
                                  {renderBillTypeIndicator(bill)}
                                  <span className="text-[11px] text-muted-foreground">
                                    {bill.referenceNumber || "-"}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="px-2 py-3 align-top">
                                {bill.clientId ? (
                                  <div className="px-1 py-1">
                                    <div className="flex w-full flex-col items-start text-left leading-tight">
                                      <div className="flex items-center gap-1 w-full">
                                        <User className="w-3 h-3 shrink-0 text-primary" />
                                        <span className="truncate text-sm font-semibold text-foreground max-w-[120px]">
                                          {bill.customerName || getClientName(bill.clientId)}
                                        </span>
                                      </div>
                                      {getClientAccountLabel(bill.clientId) && (
                                        <span className="text-[11px] text-muted-foreground">
                                          {getClientAccountLabel(bill.clientId)}
                                        </span>
                                      )}
                                      {getDisplayPhone(bill.customerPhone, linkedClient?.phone) && (
                                        <span className="text-[11px] text-muted-foreground">
                                          {getDisplayPhone(bill.customerPhone, linkedClient?.phone)}
                                        </span>
                                      )}
                                      {addressLine && (
                                        <span className="text-[11px] text-muted-foreground truncate max-w-[220px]">
                                          {addressLine}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col leading-tight">
                                    <span className="font-semibold text-foreground">
                                      {bill.customerName || "Unknown Client"}
                                    </span>
                                    {getDisplayPhone(bill.customerPhone, linkedClient?.phone) && (
                                      <span className="text-[11px] text-muted-foreground">
                                        {getDisplayPhone(bill.customerPhone, linkedClient?.phone)}
                                      </span>
                                    )}
                                    {addressLine && (
                                      <span className="text-[11px] text-muted-foreground truncate max-w-[220px]">
                                        {addressLine}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="px-2 py-3 align-top">
                                {bill.description ? (
                                  <div className="flex w-full flex-col px-1 py-0.5 text-left">
                                    <span className="text-[11px] font-medium text-muted-foreground">
                                      Items
                                    </span>
                                    <span className="text-[11px] text-muted-foreground line-clamp-2">
                                      {bill.description}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">-</span>
                                )}
                              </TableCell>
	                              <TableCell className="px-2 py-3 text-right align-top font-medium">
	                                {displayAmounts.originalAmount.toFixed(2)} AED
	                              </TableCell>
	                              <TableCell className="px-2 py-3 text-right align-top font-medium">
	                                {displayAmounts.deliveryCharge > 0.009 ? (
	                                  <span className="text-blue-600 dark:text-blue-400">
	                                    {displayAmounts.deliveryCharge.toFixed(2)} AED
	                                  </span>
	                                ) : (
	                                  <span className="text-muted-foreground">-</span>
	                                )}
	                              </TableCell>
	                              <TableCell
                                className={`px-2 py-3 text-right align-top text-orange-500 font-medium ${!bill.isPaid ? "cursor-pointer hover:underline" : ""}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openBillDiscountEdit(bill);
                                }}
                              >
                                {renderBillDiscountEditor(
                                  bill,
                                  displayAmounts.discount,
                                  `input-main-bill-discount-${bill.id}`,
                                )}
                              </TableCell>
                              <TableCell className="px-2 py-3 text-right align-top font-semibold">
                                {displayAmounts.finalAmount.toFixed(2)} AED
                              </TableCell>
                              <TableCell className="px-2 py-3 text-right align-top text-green-600 dark:text-green-400">
                                {displayAmounts.paidAmount > 0 ? `${displayAmounts.paidAmount.toFixed(2)} AED` : "-"}
                              </TableCell>
                              <TableCell className="px-2 py-3 text-right align-top font-semibold text-red-600 dark:text-red-400">
                                {displayAmounts.due > 0 ? `${displayAmounts.due.toFixed(2)} AED` : "-"}
                              </TableCell>
                              <TableCell className="px-2 py-3 align-top">
                                <div className="flex flex-col items-start gap-1">
                                  <Badge className={`text-[10px] text-white ${statusMeta.badgeClass}`}>
                                    {statusMeta.label}
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell className="px-2 py-3 align-top">
                                <div className="flex flex-col leading-tight">
                                  <span className="font-medium text-foreground">
                                    {(bill.isPaid || isPartiallyPaid)
                                      ? formatPaymentMethodLabel(bill.paymentMethod)
                                      : "-"}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground">
                                    {latestPaymentDate ? formatBillPaymentDate(latestPaymentDate) : "-"}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="px-2 py-3 align-top">
                                <div
                                  className="flex items-start justify-end gap-1.5"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <div className="flex w-[118px] flex-col gap-1.5">
                                    {!bill.isPaid && (
                                      <Button
                                        variant="default"
                                        size="sm"
                                        className="h-7 w-full justify-center bg-blue-600 px-2 text-xs text-white hover:bg-blue-700"
                                        onClick={() => handlePayNow(bill)}
                                        data-testid={`button-pay-now-${bill.id}`}
                                      >
                                        <DollarSign className="mr-1 h-3 w-3" />
                                        Pay
                                      </Button>
                                    )}
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 w-full justify-start px-2 text-[11px]"
                                      onClick={() => void printBillPDF(bill)}
                                      data-testid={`button-print-pdf-${bill.id}`}
                                      title="Print Bill"
                                    >
                                      <Printer className="mr-1.5 h-3 w-3" />
                                      Print Invoice
                                    </Button>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 self-start text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    onClick={() => handleDelete(bill.id)}
                                    data-testid={`button-delete-bill-${bill.id}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <div className="px-4 py-3 text-center text-[11px] text-muted-foreground md:px-2">
                      {hasMoreVisibleBills
                        ? `Scroll down to load ${BILLS_LOAD_MORE_COUNT} more bills`
                        : "All matching bills loaded"}
                    </div>
                  </div>
                </div>
              </Card>
            )}
            </>
            ) : null}
          </TabsContent>

          <TabsContent value="paid-by-date">
            {isPaidByDateTab ? (() => {
              const totalPaymentEntries = paidByDateGroupsData.totalPaymentEntries;

              return (
                <div>
                  <div className="mb-4">
                    <p className="text-muted-foreground">
                      Bills grouped by payment date, most recent first.
                    </p>
                  </div>

                  {paidByDateGroupsData.groups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-3xl bg-card/50">
                      <Receipt className="w-16 h-16 mb-4 opacity-50" />
                      <h3 className="text-xl font-bold text-foreground mb-2">
                        {hasActiveSharedBillFilters
                          ? "No bill payment activity matches the current filters"
                          : "No bill payment activity yet"}
                      </h3>
                      <p className="max-w-md text-center">
                        {hasActiveSharedBillFilters
                          ? "Try adjusting the shared Status, View, or search filters above."
                          : "Bills with recorded payments will appear here grouped by payment date."}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {visiblePaidByDateGroups.map((group) => {
                        return (
                          <div key={group.dateKey}>
                            <div className="flex items-center gap-3 mb-3">
                              <h3 className="text-sm font-semibold text-foreground">
                                {group.dateKey === UNKNOWN_PAYMENT_DATE_KEY
                                  ? "Unknown Payment Date"
                                  : format(new Date(group.dateKey + "T00:00:00"), "EEEE, MMM dd, yyyy")}
                              </h3>
                              <Badge variant="secondary" className="text-xs">
                                {group.totalBillEntries} bill{group.totalBillEntries !== 1 ? "s" : ""}
                              </Badge>
                              <Badge className="text-xs bg-green-100 text-green-700">
                                {group.totalPaid.toFixed(2)} AED
                              </Badge>
                              <div className="flex-1 border-t border-border" />
                            </div>
                            <div className="space-y-1">
                              {group.visibleBillEntries.map((entry) => {
                                const bill = entry.bill;
                                const displayAmounts = getBillDisplayAmounts(bill);
                                const billTypeMeta = getBillTypeMeta(bill);
                                const amount = displayAmounts.finalAmount;
                                const paid = displayAmounts.paidAmount;
                                const due = displayAmounts.due;
                                const isPartiallyPaid = !bill.isPaid && paid > 0;
                                const statusMeta = getBillStatusMeta(bill, displayAmounts);
                                const paidOnDate = entry.latestPaymentDate || getBillLatestPaymentDate(bill.id);
                                return (
                                  <div
                                    key={`${group.dateKey}-${bill.id}`}
                                    data-bill-id={bill.id}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                                      bill.isPaid
                                        ? "bg-green-50/60 hover:bg-green-100/80 dark:bg-green-950/20 dark:hover:bg-green-950/40"
                                        : isPartiallyPaid
                                        ? "bg-amber-50/60 hover:bg-amber-100/80 dark:bg-amber-950/20 dark:hover:bg-amber-950/40"
                                        : "bg-blue-50/60 hover:bg-blue-100/80 dark:bg-blue-950/20 dark:hover:bg-blue-950/40"
                                    }`}
                                    data-testid={`card-paid-bill-${bill.id}`}
                                    onClickCapture={(event) => handleBillShortcutSelectionCapture(event, bill)}
                                    onClick={(event) => handleBillShortcutClick(event, bill)}
                                  >
                                    <div className={`w-1 h-10 rounded-full flex-shrink-0 ${bill.isPaid ? "bg-green-500" : isPartiallyPaid ? "bg-amber-500" : "bg-blue-500"}`} />
                                    <Badge
                                      className={`text-[10px] px-2 py-0 flex-shrink-0 text-white ${statusMeta.badgeClass}`}
                                    >
                                      {statusMeta.label}
                                    </Badge>
                                    <div className="flex min-w-[72px] flex-col leading-tight">
                                      <span className="text-xs text-muted-foreground font-mono flex-shrink-0">#{bill.id}</span>
                                      <span className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${billTypeMeta.textClassName}`}>
                                        {billTypeMeta.label}
                                      </span>
                                    </div>
                                    <span className="font-semibold text-sm truncate flex-1 min-w-0">
                                      {bill.customerName || getClientName(bill.clientId!)}
                                      {getClientAccountLabel(bill.clientId) && <span className="ml-1 text-xs text-muted-foreground font-normal">({getClientAccountLabel(bill.clientId)})</span>}
                                    </span>
                                    {bill.description && (
                                      <span className="text-xs text-muted-foreground truncate max-w-[200px] hidden md:inline">
                                        {bill.description}
                                      </span>
                                    )}
                                    <div className="hidden lg:flex flex-col text-[10px] text-muted-foreground leading-tight min-w-[150px]">
                                      <span>Created: {formatBillCreatedDate(bill.billDate)}</span>
                                      <span className={paidOnDate ? "text-green-600" : ""}>
                                        Paid: {formatBillPaymentDate(paidOnDate)}
                                      </span>
                                      {statusMeta.historyDate ? (
                                        <span className="text-amber-700 dark:text-amber-300">
                                          Partial: {formatBillCreatedDate(statusMeta.historyDate)}
                                        </span>
                                      ) : null}
                                    </div>
                                    {(bill.isPaid || isPartiallyPaid) && (
                                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 flex-shrink-0 capitalize hidden sm:inline-flex">
                                        {formatPaymentMethodLabel(bill.paymentMethod)}
                                      </Badge>
                                    )}
                                    <div className="flex-shrink-0 text-right">
                                      {isPartiallyPaid ? (
                                        <div>
                                          <span className="text-sm font-bold text-red-600">{due.toFixed(2)} AED</span>
                                          <span className="text-[10px] text-muted-foreground block">of {amount.toFixed(2)}</span>
                                        </div>
                                      ) : (
                                        <span className="text-sm font-bold">{amount.toFixed(2)} AED</span>
                                      )}
                                    </div>
                                    <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                      {!bill.isPaid && (
                                        <Button
                                          variant="default"
                                          size="sm"
                                          className="h-7 px-2 bg-blue-600 hover:bg-blue-700 text-white text-xs"
                                          onClick={() => handlePayNow(bill)}
                                          data-testid={`button-pay-now-${bill.id}`}
                                        >
                                          <DollarSign className="w-3 h-3 mr-0.5" />
                                          Pay
                                        </Button>
                                      )}
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => void printBillPDF(bill)}
                                        data-testid={`button-print-pdf-${bill.id}`}
                                        title="Print Bill"
                                      >
                                        <Printer className="w-3.5 h-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                        onClick={() => handleDelete(bill.id)}
                                        data-testid={`button-delete-paid-${bill.id}`}
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      <div
                        ref={paidByDateLoadMoreRef}
                        className="py-2 text-center text-[11px] text-muted-foreground"
                      >
                        Showing {visiblePaidByDateEntryCount} of {totalPaymentEntries} paid bill entries across{" "}
                        {visiblePaidByDateGroups.length} of {paidByDateGroupsData.groups.length} payment dates
                        {hasMorePaidByDateGroups
                          ? `, scroll down to load ${BILLS_LOAD_MORE_COUNT} more`
                          : ", all payment entries loaded"}
                        {hasMorePaidByDateGroups ? (
                          <div className="mt-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => loadMorePaidByDateGroups()}
                              data-testid="button-load-more-paid-by-date"
                            >
                              Load {BILLS_LOAD_MORE_COUNT} more
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              );
            })() : null}
          </TabsContent>

          <TabsContent value="by-client">
            {isByClientTab ? (
            <>
            <div className={`mb-4 ${isMobile ? "space-y-2" : "space-y-3"}`}>
              <div className={isMobile ? "space-y-1" : "flex items-center justify-between gap-4"}>
                <p className={isMobile ? "text-xs text-muted-foreground" : "text-muted-foreground"}>
                  Bills organized by client, most recent first.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground">
                  <span className="rounded-full border border-border/60 bg-muted/35 px-2.5 py-1">
                    {clientTabBills.length} bills
                  </span>
                </div>
              </div>
              <p className={isMobile ? "text-[11px] text-muted-foreground" : "text-sm text-muted-foreground"}>
                Showing client bills with your current search and payment filters.
              </p>
            </div>

            {(() => {
              if (clientBillGroups.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-3xl bg-card/50">
                    <FolderOpen className="w-16 h-16 mb-4 opacity-50" />
                    <h3 className="text-xl font-bold text-foreground mb-2">No client bills found</h3>
                    <p>
                      {hasActiveSharedBillFilters
                        ? "No client bills match the current search or filters."
                        : "Bills will appear here organized by client."}
                    </p>
                  </div>
                );
              }

              return (
                <Accordion
                  type="multiple"
                  value={openClientBillFolders}
                  onValueChange={setOpenClientBillFolders}
                  className={isMobile ? "space-y-3" : "space-y-2"}
                >
                  {visibleClientBillGroups.map(({ clientKey, clientData }) => {
                    const billTotals = getBillAggregateTotals(clientData.bills || []);
                    const totalAmount = billTotals.finalAmount;
                    const totalPaid = billTotals.paidAmount;
                    const totalDiscount = billTotals.discount;
                    const totalDue = billTotals.due;

                    return (
                      <AccordionItem
                        key={clientKey}
                        value={clientKey}
                        tabIndex={-1}
                        data-bills-folder-tab="by-client"
                        data-bills-folder-key={clientKey}
                        onMouseEnter={() => {
                          hoveredGroupedBillsFolderRef.current = { tab: "by-client", key: clientKey };
                        }}
                        onMouseLeave={() => {
                          const hoveredFolder = hoveredGroupedBillsFolderRef.current;
                          if (hoveredFolder?.tab === "by-client" && hoveredFolder.key === clientKey) {
                            hoveredGroupedBillsFolderRef.current = null;
                          }
                        }}
                        className={isMobile ? "overflow-hidden rounded-xl border bg-card shadow-sm" : "border rounded-lg bg-card"}
                      >
                        <AccordionTrigger className={isMobile ? "px-3 py-3 hover:no-underline" : "px-4 hover:no-underline"}>
                          {isMobile ? (
                            <div className="mr-2 flex min-w-0 flex-1 items-start gap-2.5">
                              <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                              <div className="min-w-0 flex-1 text-left">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="truncate text-sm font-semibold">{clientData.clientName}</span>
                                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {clientData.bills?.length || 0} bills
                                  </span>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                                  <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                                    <p className="text-[10px] text-muted-foreground">Final</p>
                                    <p className="font-semibold text-blue-600">{totalAmount.toFixed(2)} AED</p>
                                  </div>
                                  <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                                    <p className="text-[10px] text-muted-foreground">
                                      {totalDue > 0 ? "Due" : "Status"}
                                    </p>
                                    <p className={`font-semibold ${totalDue > 0 ? "text-destructive" : "text-green-600"}`}>
                                      {totalDue > 0 ? `${totalDue.toFixed(2)} AED` : "Paid"}
                                    </p>
                                  </div>
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                                  <span>
                                    Paid: <span className="font-semibold text-green-600">{totalPaid.toFixed(2)} AED</span>
                                  </span>
                                  {totalDiscount > 0 && (
                                    <span>
                                      Discount: <span className="font-semibold text-orange-600">{totalDiscount.toFixed(2)} AED</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3 flex-1">
                              <FolderOpen className="w-5 h-5 text-amber-500" />
                              <div className="flex-1 text-left">
                                <span className="font-semibold">{clientData.clientName}</span>
                                <span className="ml-2 text-sm text-muted-foreground">
                                  ({clientData.bills?.length || 0} bills)
                                </span>
                              </div>
                              <div className="flex items-center gap-4 mr-4 text-sm">
                                <span>
                                  Final: <strong className="text-blue-600">{totalAmount.toFixed(2)} AED</strong>
                                </span>
                                {totalDiscount > 0 && (
                                  <span>
                                    Discount: <strong className="text-orange-600">{totalDiscount.toFixed(2)} AED</strong>
                                  </span>
                                )}
                                {totalDue > 0 && (
                                  <Badge variant="destructive" className="text-xs">
                                    Due: {totalDue.toFixed(2)} AED
                                  </Badge>
                                )}
                                {totalDue === 0 && totalAmount > 0 && (
                                  <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                                    Paid
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )}
                        </AccordionTrigger>
                        <AccordionContent className={isMobile ? "px-3 pb-3" : "px-4 pb-4"}>
                          <div className={isMobile ? "mb-3 grid grid-cols-1 gap-2" : "flex justify-end gap-2 mb-3"}>
                            {totalDue > 0 && (() => {
                              const clientUnpaid = (clientData.bills || []).filter((b) => isBillOutstanding(b));
                              const selectedInClient = clientUnpaid.filter(b => selectedBillIds.has(b.id));
                              const hasSelection = selectedInClient.length > 0;
                              const selectedDue = hasSelection
                                ? getBillAggregateTotals(selectedInClient).due
                                : totalDue;
                              return (
                                <Button
                                  variant="default"
                                  size="sm"
                                  className={isMobile ? "h-8 w-full rounded-lg text-[11px]" : undefined}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const client = getClientById(clientData.clientId);
                                    if (client) {
                                      handlePayNowForClient(client, selectedDue);
                                    }
                                  }}
                                  data-testid="button-pay-client-total"
                                >
                                  <DollarSign className="w-4 h-4 mr-2" />
                                  {hasSelection
                                    ? `Pay Selected (${selectedInClient.length}) - ${selectedDue.toFixed(2)} AED`
                                    : `Pay ${totalDue.toFixed(2)} AED`}
                                </Button>
                              );
                            })()}
                            {(() => {
                              const clientUnpaid = (clientData.bills || []).filter((b) => isBillOutstanding(b));
                              const selectedInClient = clientUnpaid.filter((b) => selectedBillIds.has(b.id));
                              if (selectedInClient.length === 0) return null;
                              return (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className={isMobile ? "h-8 w-full rounded-lg text-[11px]" : undefined}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    clearBillSelections(selectedInClient.map((bill) => bill.id));
                                  }}
                                  data-testid="button-clear-client-selection"
                                >
                                  <X className="w-4 h-4 mr-2" />
                                  Clear Selection
                                </Button>
                              );
                            })()}
                            <Button
                              variant="outline"
                              size="sm"
                              className={isMobile ? "h-8 w-full rounded-lg text-[11px]" : undefined}
                              onClick={(e) => {
                                e.stopPropagation();
                                const allBills = clientData.bills || [];
                                const unpaidBills = allBills.filter((b) => isBillOutstanding(b));
                                const isFullyPaid = unpaidBills.length === 0 && allBills.length > 0;
                                const targetClient = getClientById(clientData.clientId);
                                const groupedBillsToPrint = isFullyPaid ? allBills : unpaidBills;

                                void printGroupedBillsInvoice({
                                  clientId: clientData.clientId,
                                  displayName: clientData.clientName,
                                  phone: targetClient?.phone,
                                  addressLines: groupedBillsToPrint.flatMap((bill) => getBillAddressLines(bill, targetClient)),
                                  bills: groupedBillsToPrint,
                                  kind: isFullyPaid ? "paid" : "unpaid",
                                });
                              }}
                              data-testid="button-print-client-invoice"
                            >
                              <Printer className="w-4 h-4 mr-2" />
                              {totalDue > 0 ? 'Print Unpaid Invoice' : 'Print Invoice'}
                            </Button>
                            {(() => {
                              const paidClientBills = (clientData.bills || []).filter((bill) => !isBillOutstanding(bill));
                              if (totalDue <= 0 || paidClientBills.length === 0) return null;
                              return (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className={isMobile ? "h-8 w-full rounded-lg text-[11px]" : undefined}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const client = getClientById(clientData.clientId);
                                    void printGroupedBillsInvoice({
                                      clientId: clientData.clientId,
                                      displayName: clientData.clientName,
                                      phone: getDisplayPhone(client?.phone),
                                      addressLines: paidClientBills.flatMap((bill) => getBillAddressLines(bill, client ?? null)),
                                      bills: paidClientBills,
                                      kind: "paid",
                                    });
                                  }}
                                  data-testid={`button-print-client-paid-invoices-${clientKey}`}
                                >
                                  <Printer className="w-4 h-4 mr-2" />
                                  Print All Paid Invoices
                                </Button>
                              );
                            })()}
                          </div>
                          {(() => {
                            if (isMobile) {
                              return (
                                <div className="space-y-3">
                                  {renderMobileBillsByDate(clientData.bills || [], { scope: "client" })}
                                </div>
                              );
                            }
                            const byDate: Record<string, Bill[]> = {};
                            clientData.bills?.forEach((bill) => {
                              const dk = format(new Date(bill.billDate), "yyyy-MM-dd");
                              if (!byDate[dk]) byDate[dk] = [];
                              byDate[dk].push(bill);
                            });
                            const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
                            return sortedDates.map((dk) => (
                              <div key={dk} className="mb-4">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-xs font-semibold text-muted-foreground">
                                    {format(new Date(dk + "T00:00:00"), "EEEE, MMM dd, yyyy")}
                                  </span>
                                  <Badge variant="secondary" className="text-[10px]">
                                    {byDate[dk].length}
                                  </Badge>
                                  <div className="flex-1 border-t border-border" />
                                </div>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="w-8">
                                        {(() => {
                                          const unpaidInDate = byDate[dk].filter((b) => isBillOutstanding(b));
                                          const allSelected = unpaidInDate.length > 0 && unpaidInDate.every(b => selectedBillIds.has(b.id));
                                          return unpaidInDate.length > 0 ? (
                                            <input
                                              type="checkbox"
                                              checked={allSelected}
                                              onChange={(e) => {
                                                e.stopPropagation();
                                                setSelectedBillIds(prev => {
                                                  const next = new Set(prev);
                                                  if (allSelected) {
                                                    unpaidInDate.forEach(b => next.delete(b.id));
                                                  } else {
                                                    unpaidInDate.forEach(b => next.add(b.id));
                                                  }
                                                  return next;
                                                });
                                              }}
                                              className="rounded border-gray-300"
                                              data-testid="checkbox-select-all-client-bills"
                                            />
                                      ) : null;
                                    })()}
                                      </TableHead>
                                      <TableHead>Bill #</TableHead>
                                      <TableHead>Created</TableHead>
                                      <TableHead>Paid On</TableHead>
                                      <TableHead>Description</TableHead>
                                      <TableHead className="text-right">Work Rec.</TableHead>
                                      <TableHead className="text-right">Discount</TableHead>
                                      <TableHead className="text-right">Final</TableHead>
                                      <TableHead className="text-right">Paid</TableHead>
                                      <TableHead className="text-right">Due</TableHead>
                                      <TableHead>Status</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {byDate[dk].map((bill) => {
                                      const displayAmounts = getBillDisplayAmounts(bill);
                                      const originalAmount = displayAmounts.originalAmount;
                                      const discount = displayAmounts.discount;
                                      const finalAmt = displayAmounts.finalAmount;
                                      const paid = displayAmounts.paidAmount;
                                      const due = displayAmounts.due;
                                      const isUnpaid = due > 0.01;
                                      const latestPaymentDate = getBillLatestPaymentDate(bill.id);
                                      const receiptIconClass = getBillReceiptIconClass(bill, displayAmounts);
                                      return (
                                        <TableRow
                                          key={bill.id}
                                          className={`cursor-pointer hover:bg-muted/50 ${selectedBillIds.has(bill.id) ? "bg-blue-50 dark:bg-blue-950/30" : ""}`}
                                          onClickCapture={(event) => handleBillShortcutSelectionCapture(event, bill)}
                                          onClick={(event) => handleBillShortcutClick(event, bill)}
                                        >
                                          <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                                            {isUnpaid && (
                                              <input
                                                type="checkbox"
                                                checked={selectedBillIds.has(bill.id)}
                                                onChange={() => toggleBillSelection(bill.id)}
                                                className="rounded border-gray-300"
                                                data-testid={`checkbox-bill-${bill.id}`}
                                              />
                                            )}
                                          </TableCell>
                              <TableCell className={`font-medium ${highlightedBillId === bill.id ? "animate-order-focus-text" : ""}`}>
                                <div className="flex flex-col leading-tight">
                                  <div className="flex items-center gap-1">
                                    <Receipt className={`h-3.5 w-3.5 ${receiptIconClass}`} />
                                    <span>#{bill.id}</span>
                                  </div>
                                  {renderBillTypeIndicator(bill)}
                                </div>
                              </TableCell>
                                          <TableCell>{formatBillCreatedDate(bill.billDate)}</TableCell>
                                          <TableCell className={latestPaymentDate ? "text-green-600" : "text-muted-foreground"}>
                                            {formatBillPaymentDate(latestPaymentDate)}
                                          </TableCell>
                                          <TableCell className="max-w-xs truncate">
                                            {bill.description || '-'}
                                          </TableCell>
                                          <TableCell className="text-right">{originalAmount.toFixed(2)}</TableCell>
                                          <TableCell
                                            className={`text-right text-orange-600 font-medium ${!bill.isPaid ? "cursor-pointer hover:underline" : ""}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              openBillDiscountEdit(bill);
                                            }}
                                          >
                                            {renderBillDiscountEditor(
                                              bill,
                                              discount,
                                              `input-bill-discount-${bill.id}`,
                                            )}
                                          </TableCell>
                                          <TableCell className="text-right text-green-700 font-medium">{finalAmt.toFixed(2)}</TableCell>
                                          <TableCell className="text-right text-green-600">{paid.toFixed(2)}</TableCell>
                                          <TableCell className="text-right text-destructive font-medium">
                                            {due > 0 ? due.toFixed(2) : '-'}
                                          </TableCell>
                                          <TableCell>
                                            {due <= 0 ? (
                                              <Badge variant="outline" className="text-green-600 border-green-600">Paid</Badge>
                                            ) : paid > 0 ? (
                                              <Badge variant="outline" className="text-amber-600 border-amber-600">Partial</Badge>
                                            ) : (
                                              <Badge className="bg-blue-500 text-white">Unpaid</Badge>
                                            )}
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              </div>
                            ));
                          })()}
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                  <div
                    ref={clientGroupsLoadMoreRef}
                    className="py-2 text-center text-[11px] text-muted-foreground"
                  >
                    Showing {visibleClientBillGroups.length} of {clientBillGroups.length} clients
                    {hasMoreClientGroups
                      ? `, scroll down to load ${BILLS_LOAD_MORE_COUNT} more`
                      : ", all client groups loaded"}
                  </div>
                </Accordion>
              );
            })()}
            </>
            ) : null}
          </TabsContent>

          <TabsContent value="by-company">
            {isByCompanyTab ? (
            <>
            <div className={`mb-4 ${isMobile ? "space-y-2" : "space-y-3"}`}>
              <div className={isMobile ? "space-y-1" : "flex items-center justify-between gap-4"}>
                <p className={isMobile ? "text-xs text-muted-foreground" : "text-muted-foreground"}>
                  Bills organized by company, then by client with oldest bills first.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground">
                  <span className="rounded-full border border-border/60 bg-muted/35 px-2.5 py-1">
                    {companyTabBills.length} bills
                  </span>
                </div>
              </div>
              <p className={isMobile ? "text-[11px] text-muted-foreground" : "text-sm text-muted-foreground"}>
                Showing company bills with your current search and payment filters.
              </p>
            </div>

            {(() => {
              if (companyBillGroups.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-3xl bg-card/50">
                    <FolderOpen className="w-16 h-16 mb-4 opacity-50" />
                    <h3 className="text-xl font-bold text-foreground mb-2">No company bills found</h3>
                    <p>
                      {hasActiveSharedBillFilters
                        ? "No company bills match the current search or filters."
                        : "Bills will appear here organized by company."}
                    </p>
                  </div>
                );
              }

              return (
                <Accordion
                  type="multiple"
                  value={openCompanyBillFolders}
                  onValueChange={setOpenCompanyBillFolders}
                  className={isMobile ? "space-y-3" : "space-y-2"}
                >
                  {visibleCompanyBillGroups.map(({ companyKey, companyData }) => {
                    const billTotals = getBillAggregateTotals(companyData.bills);
                    const totalAmount = billTotals.finalAmount;
                    const totalPaid = billTotals.paidAmount;
                    const totalDiscount = billTotals.discount;
                    const totalDue = billTotals.due;
                    const companyTransactions = companyTransactionsByKey.get(companyKey) || [];
                    const companyPaidTotal = companyTransactions.reduce((sum, tx) => sum + parseFloat(tx.amount || "0"), 0);
                    const companyDiscountTotal = companyTransactions.reduce((sum, tx) => sum + parseFloat(tx.discount || "0"), 0);
                    const companyBillsByClient = groupBillsByClient(companyData.bills);

                    return (
                      <AccordionItem
                        key={companyKey}
                        value={companyKey}
                        tabIndex={-1}
                        data-bills-folder-tab="by-company"
                        data-bills-folder-key={companyKey}
                        onMouseEnter={() => {
                          hoveredGroupedBillsFolderRef.current = { tab: "by-company", key: companyKey };
                        }}
                        onMouseLeave={() => {
                          const hoveredFolder = hoveredGroupedBillsFolderRef.current;
                          if (hoveredFolder?.tab === "by-company" && hoveredFolder.key === companyKey) {
                            hoveredGroupedBillsFolderRef.current = null;
                          }
                        }}
                        className={isMobile ? "overflow-hidden rounded-xl border bg-card shadow-sm" : "border rounded-lg bg-card"}
                      >
                        <AccordionTrigger className={isMobile ? "px-3 py-3 hover:no-underline" : "px-4 hover:no-underline"}>
                          {isMobile ? (
                            <div className="mr-2 flex min-w-0 flex-1 items-start gap-2.5">
                              <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                              <div className="min-w-0 flex-1 text-left">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="truncate text-sm font-semibold">{companyData.companyName}</span>
                                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {companyData.bills.length} bills
                                  </span>
                                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {companyData.clientIds.size} client{companyData.clientIds.size !== 1 ? "s" : ""}
                                  </span>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                                  <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                                    <p className="text-[10px] text-muted-foreground">Final</p>
                                    <p className="font-semibold text-blue-600">{totalAmount.toFixed(2)} AED</p>
                                  </div>
                                  <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                                    <p className="text-[10px] text-muted-foreground">
                                      {totalDue > 0 ? "Due" : "Status"}
                                    </p>
                                    <p className={`font-semibold ${totalDue > 0 ? "text-destructive" : "text-green-600"}`}>
                                      {totalDue > 0 ? `${totalDue.toFixed(2)} AED` : "Paid"}
                                    </p>
                                  </div>
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                                  <span>
                                    Paid: <span className="font-semibold text-green-600">{totalPaid.toFixed(2)} AED</span>
                                  </span>
                                  {totalDiscount > 0 && (
                                    <span>
                                      Discount: <span className="font-semibold text-orange-600">{totalDiscount.toFixed(2)} AED</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3 flex-1">
                              <FolderOpen className="w-5 h-5 text-blue-500" />
                              <div className="flex-1 text-left">
                                <span className="font-semibold">{companyData.companyName}</span>
                                <span className="ml-2 text-sm text-muted-foreground">
                                  ({companyData.bills.length} bills, {companyData.clientIds.size} client{companyData.clientIds.size !== 1 ? 's' : ''})
                                </span>
                              </div>
                              <div className="flex items-center gap-4 mr-4 text-sm">
                                <span>
                                  Final: <strong className="text-blue-600">{totalAmount.toFixed(2)} AED</strong>
                                </span>
                                {totalDiscount > 0 && (
                                  <span>
                                    Discount: <strong className="text-orange-600">{totalDiscount.toFixed(2)} AED</strong>
                                  </span>
                                )}
                                {totalDue > 0 && (
                                  <Badge variant="destructive" className="text-xs">
                                    Due: {totalDue.toFixed(2)} AED
                                  </Badge>
                                )}
                                {totalDue === 0 && totalAmount > 0 && (
                                  <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                                    Paid
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )}
                        </AccordionTrigger>
                        <AccordionContent className={isMobile ? "px-3 pb-3" : "px-4 pb-4"}>
                          <div className={isMobile ? "mb-3 grid grid-cols-1 gap-2" : "flex justify-end gap-2 mb-3"}>
                            <Button
                              variant="outline"
                              size="sm"
                              className={isMobile ? "h-8 w-full rounded-lg text-[11px]" : undefined}
                              onClick={(e) => {
                                e.stopPropagation();
                                const allBills = companyData.bills || [];
                                const unpaidBills = allBills.filter((bill) => isBillOutstanding(bill));
                                const isFullyPaid = unpaidBills.length === 0 && allBills.length > 0;
                                const groupedBillsToPrint = isFullyPaid ? allBills : unpaidBills;

                                void printGroupedBillsInvoice({
                                  displayName: companyData.companyName,
                                  addressLines: groupedBillsToPrint.flatMap((bill) =>
                                    getBillAddressLines(bill, getClientById(bill.clientId)),
                                  ),
                                  bills: groupedBillsToPrint,
                                  kind: isFullyPaid ? "paid" : "unpaid",
                                });
                              }}
                              data-testid={`button-print-company-${companyKey}`}
                            >
                              <Printer className="w-4 h-4 mr-2" />
                              {totalDue > 0 ? "Print Unpaid Invoice" : "Print Invoice"}
                            </Button>
                            {(() => {
                              const paidCompanyBills = companyData.bills.filter((bill) => !isBillOutstanding(bill));
                              if (totalDue <= 0 || paidCompanyBills.length === 0) return null;
                              return (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className={isMobile ? "h-8 w-full rounded-lg text-[11px]" : undefined}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void printGroupedBillsInvoice({
                                      displayName: companyData.companyName,
                                      addressLines: paidCompanyBills.flatMap((bill) =>
                                        getBillAddressLines(bill, getClientById(bill.clientId)),
                                      ),
                                      bills: paidCompanyBills,
                                      kind: "paid",
                                    });
                                  }}
                                  data-testid={`button-print-company-paid-invoices-${companyKey}`}
                                >
                                  <Printer className="w-4 h-4 mr-2" />
                                  Print All Paid Invoices
                                </Button>
                              );
                            })()}
                            {totalDue > 0 && (() => {
                              const companyUnpaid = companyData.bills.filter((b) => isBillOutstanding(b));
                              const selectedInCompany = companyUnpaid.filter(b => selectedBillIds.has(b.id));
                              const hasSelection = selectedInCompany.length > 0;
                              const selectedDue = hasSelection
                                ? getBillAggregateTotals(selectedInCompany).due
                                : totalDue;
                              return (
                                <Button
                                  variant="default"
                                  size="sm"
                                  className={isMobile ? "h-8 w-full rounded-lg bg-blue-600 text-[11px] hover:bg-blue-700" : "bg-blue-600 hover:bg-blue-700"}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCompanyPayment({ companyName: companyData.companyName, totalDue: selectedDue });
                                    setBulkPaymentClientId(null);
                                    setSelectedBillsPaymentSummary(null);
                                    setPaymentAmount(selectedDue.toFixed(2));
                                    setPaymentMethod("cash");
                                    setPaymentNotes("");
                                    setShowPaymentDialog(true);
                                  }}
                                  data-testid={`button-pay-company-${companyKey}`}
                                >
                                  <DollarSign className="w-4 h-4 mr-2" />
                                  {hasSelection
                                    ? `Pay Selected (${selectedInCompany.length}) - ${selectedDue.toFixed(2)} AED`
                                    : `Pay All ${totalDue.toFixed(2)} AED`}
                                </Button>
                              );
                            })()}
                            {(() => {
                              const companyUnpaid = companyData.bills.filter((b) => isBillOutstanding(b));
                              const selectedInCompany = companyUnpaid.filter((b) => selectedBillIds.has(b.id));
                              if (selectedInCompany.length === 0) return null;
                              return (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className={isMobile ? "h-8 w-full rounded-lg text-[11px]" : undefined}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    clearBillSelections(selectedInCompany.map((bill) => bill.id));
                                  }}
                                  data-testid={`button-clear-company-selection-${companyKey}`}
                                >
                                  <X className="w-4 h-4 mr-2" />
                                  Clear Selection
                                </Button>
                              );
                            })()}
                          </div>
                          {isMobile ? (
                            <>
                              <div className="space-y-3">
                                {renderMobileBillsByClient(companyData.bills, {
                                  scope: "company",
                                })}
                              </div>
                              {renderMobileCompanyPaymentHistory(
                                companyTransactions,
                                companyPaidTotal,
                                companyDiscountTotal,
                              )}
                            </>
                          ) : (
                            <>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-8">
                                  {(() => {
                                    const unpaidInCompany = companyData.bills.filter((b) => isBillOutstanding(b));
                                    const allSelected = unpaidInCompany.length > 0 && unpaidInCompany.every(b => selectedBillIds.has(b.id));
                                    return unpaidInCompany.length > 0 ? (
                                      <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          setSelectedBillIds(prev => {
                                            const next = new Set(prev);
                                            if (allSelected) {
                                              unpaidInCompany.forEach(b => next.delete(b.id));
                                            } else {
                                              unpaidInCompany.forEach(b => next.add(b.id));
                                            }
                                            return next;
                                          });
                                        }}
                                        className="rounded border-gray-300"
                                        data-testid="checkbox-select-all-company-bills"
                                      />
                                    ) : null;
                                  })()}
                                </TableHead>
                                <TableHead>Bill #</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead>Paid On</TableHead>
                                <TableHead>Client</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">Work Rec.</TableHead>
                                <TableHead className="text-right">Discount</TableHead>
                                <TableHead className="text-right">Final</TableHead>
                                <TableHead className="text-right">Paid</TableHead>
                                <TableHead className="text-right">Due</TableHead>
                                <TableHead>Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {companyBillsByClient.flatMap(([clientKey, clientData]) => {
                                const clientAccountNumber = clientData.clientId
                                  ? getClientById(clientData.clientId)?.billNumber?.trim() || null
                                  : null;

                                return [
                                  (
                                    <TableRow
                                      key={`${companyKey}-${clientKey}-header`}
                                      className="bg-muted/35 hover:bg-muted/35"
                                    >
                                      <TableCell colSpan={12} className="py-2">
                                        <div className="flex items-center gap-2 text-sm">
                                          <span className="font-semibold text-foreground">
                                            {clientData.clientName}
                                          </span>
                                          {clientAccountNumber && (
                                            <Badge variant="outline" className="text-[10px]">
                                              {clientAccountNumber}
                                            </Badge>
                                          )}
                                          <span className="text-xs text-muted-foreground">
                                            {clientData.bills.length} bill{clientData.bills.length !== 1 ? "s" : ""}
                                          </span>
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  ),
                                  ...clientData.bills.map((bill) => {
                                    const displayAmounts = getBillDisplayAmounts(bill);
                                    const originalAmount = displayAmounts.originalAmount;
                                    const discount = displayAmounts.discount;
                                    const finalAmt = displayAmounts.finalAmount;
                                    const paid = displayAmounts.paidAmount;
                                    const due = displayAmounts.due;
                                    const isUnpaid = due > 0.01;
                                    const latestPaymentDate = getBillLatestPaymentDate(bill.id);
                                    const receiptIconClass = getBillReceiptIconClass(bill, displayAmounts);
                                    return (
                                      <TableRow
                                        key={bill.id}
                                        className={`cursor-pointer hover:bg-muted/50 ${selectedBillIds.has(bill.id) ? "bg-blue-50 dark:bg-blue-950/30" : ""}`}
                                        onClickCapture={(event) => handleBillShortcutSelectionCapture(event, bill)}
                                        onClick={(event) => handleBillShortcutClick(event, bill)}
                                      >
                                        <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                                          {isUnpaid && (
                                            <input
                                              type="checkbox"
                                              checked={selectedBillIds.has(bill.id)}
                                              onChange={() => toggleBillSelection(bill.id)}
                                              className="rounded border-gray-300"
                                              data-testid={`checkbox-company-bill-${bill.id}`}
                                            />
                                          )}
                                        </TableCell>
                                        <TableCell className="font-medium">
                                          <div className="flex flex-col leading-tight">
                                            <div className="flex items-center gap-1">
                                              <Receipt className={`h-3.5 w-3.5 ${receiptIconClass}`} />
                                              <span>#{bill.id}</span>
                                            </div>
                                            {renderBillTypeIndicator(bill)}
                                          </div>
                                        </TableCell>
                                        <TableCell>{formatBillCreatedDate(bill.billDate)}</TableCell>
                                        <TableCell className={latestPaymentDate ? "text-green-600" : "text-muted-foreground"}>
                                          {formatBillPaymentDate(latestPaymentDate)}
                                        </TableCell>
                                        <TableCell className="font-medium">
                                          {getBillClientDisplayName(bill)}
                                          {getClientAccountLabel(bill.clientId) && <span className="ml-1 text-xs text-muted-foreground font-normal">({getClientAccountLabel(bill.clientId)})</span>}
                                        </TableCell>
                                        <TableCell className="max-w-xs truncate text-xs">
                                          {bill.description || '-'}
                                        </TableCell>
                                        <TableCell className="text-right">{originalAmount.toFixed(2)}</TableCell>
                                        <TableCell
                                          className={`text-right text-orange-600 font-medium ${!bill.isPaid ? "cursor-pointer hover:underline" : ""}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openBillDiscountEdit(bill);
                                          }}
                                        >
                                          {renderBillDiscountEditor(
                                            bill,
                                            discount,
                                            `input-company-bill-discount-${bill.id}`,
                                          )}
                                        </TableCell>
                                        <TableCell className="text-right text-green-700 font-medium">{finalAmt.toFixed(2)}</TableCell>
                                        <TableCell className="text-right text-green-600">{paid.toFixed(2)}</TableCell>
                                        <TableCell className="text-right text-destructive font-medium">
                                          {due > 0 ? due.toFixed(2) : '-'}
                                        </TableCell>
                                        <TableCell>
                                          {due <= 0 ? (
                                            <Badge variant="outline" className="text-green-600 border-green-600">Paid</Badge>
                                          ) : paid > 0 ? (
                                            <Badge variant="outline" className="text-amber-600 border-amber-600">Partial</Badge>
                                          ) : (
                                            <Badge className="bg-blue-500 text-white">Unpaid</Badge>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  }),
                                ];
                              })}
                            </TableBody>
                          </Table>
                          <div className="mt-4 border rounded-lg overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-3 bg-muted/40">
                              <div>
                                <p className="text-sm font-semibold">Company Payment History</p>
                                <p className="text-xs text-muted-foreground">
                                  Transactions recorded as company payments.
                                </p>
                              </div>
                              {companyTransactions.length > 0 && (
                                <div className="text-right text-xs">
                                  <p>
                                    Paid:{" "}
                                    <span className="font-semibold text-green-600">
                                      {companyPaidTotal.toFixed(2)} AED
                                    </span>
                                  </p>
                                  <p>
                                    Discount:{" "}
                                    <span className="font-semibold text-orange-600">
                                      {companyDiscountTotal.toFixed(2)} AED
                                    </span>
                                  </p>
                                </div>
                              )}
                            </div>
                            {isCompanyPaymentTransactionsLoading ? (
                              <div className="py-6 text-sm text-center text-muted-foreground">
                                Loading company transactions...
                              </div>
                            ) : companyTransactions.length === 0 ? (
                              <div className="py-6 text-sm text-center text-muted-foreground">
                                No company payment transactions yet.
                              </div>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Client</TableHead>
                                    <TableHead>Bills</TableHead>
                                    <TableHead className="text-right">Paid</TableHead>
                                    <TableHead className="text-right">Discount</TableHead>
                                    <TableHead>Method</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {companyTransactions.map((tx) => {
                                    const txAmount = parseFloat(tx.amount || "0");
                                    const txDiscount = parseFloat(tx.discount || "0");
                                    return (
                                      <TableRow key={tx.id}>
                                        <TableCell className="text-xs">
                                          {format(new Date(tx.date), "dd/MM/yyyy HH:mm")}
                                        </TableCell>
                                        <TableCell className="font-medium text-xs">
                                          {tx.clientName}
                                          {tx.accountNumber && (
                                            <span className="ml-1 text-muted-foreground">
                                              ({tx.accountNumber})
                                            </span>
                                          )}
                                        </TableCell>
                                        <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                                          {extractBillsFromCompanyPaymentDescription(tx.description)}
                                        </TableCell>
                                        <TableCell className="text-right text-green-600 font-medium">
                                          {txAmount.toFixed(2)}
                                        </TableCell>
                                        <TableCell className="text-right text-orange-600 font-medium">
                                          {txDiscount > 0 ? txDiscount.toFixed(2) : "-"}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                          {formatPaymentMethodLabel(tx.paymentMethod)}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            )}
                          </div>
                            </>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                  <div
                    ref={companyGroupsLoadMoreRef}
                    className="py-2 text-center text-[11px] text-muted-foreground"
                  >
                    Showing {visibleCompanyBillGroups.length} of {companyBillGroups.length} companies
                    {hasMoreCompanyGroups
                      ? `, scroll down to load ${BILLS_LOAD_MORE_COUNT} more`
                      : ", all company groups loaded"}
                  </div>
                </Accordion>
              );
            })()}
            </>
            ) : null}
          </TabsContent>

          <TabsContent value="by-broker">
            {isByBrokerTab ? (
            <>
            <div className={`mb-4 ${isMobile ? "space-y-2" : "space-y-3"}`}>
              <div className={isMobile ? "space-y-1" : "flex items-center justify-between gap-4"}>
                <p className={isMobile ? "text-xs text-muted-foreground" : "text-muted-foreground"}>
                  Bills organized by broker clients, most recent first.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground">
                  <span className="rounded-full border border-border/60 bg-muted/35 px-2.5 py-1">
                    {brokerTabBills.length} bills
                  </span>
                </div>
              </div>
              <p className={isMobile ? "text-[11px] text-muted-foreground" : "text-sm text-muted-foreground"}>
                Showing broker bills with your current search and payment filters.
              </p>
            </div>

            {(() => {
              if (brokerBillGroups.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-3xl bg-card/50">
                    <FolderOpen className="w-16 h-16 mb-4 opacity-50" />
                    <h3 className="text-xl font-bold text-foreground mb-2">No broker bills found</h3>
                    <p>
                      {hasActiveSharedBillFilters
                        ? "No broker bills match the current search or filters."
                        : "Bills from broker clients will appear here."}
                    </p>
                  </div>
                );
              }

              return (
                <Accordion
                  type="multiple"
                  value={openBrokerBillFolders}
                  onValueChange={setOpenBrokerBillFolders}
                  className={isMobile ? "space-y-3" : "space-y-2"}
                >
                  {visibleBrokerBillGroups.map(({ brokerId, brokerData }) => {
                    const billTotals = getBillAggregateTotals(brokerData.bills);
                    const totalAmount = billTotals.finalAmount;
                    const totalPaid = billTotals.paidAmount;
                    const totalDiscount = billTotals.discount;
                    const totalDue = billTotals.due;
                    const brokerUnpaid = brokerData.bills.filter((bill) => isBillOutstanding(bill));
                    const selectedInBroker = brokerUnpaid.filter((bill) => selectedBillIds.has(bill.id));
                    const hasSelection = selectedInBroker.length > 0;
                    const selectedDue = hasSelection
                      ? getBillAggregateTotals(selectedInBroker).due
                      : totalDue;

                    return (
                      <AccordionItem
                        key={brokerId}
                        value={`broker-${brokerId}`}
                        tabIndex={-1}
                        data-bills-folder-tab="by-broker"
                        data-bills-folder-key={`broker-${brokerId}`}
                        onMouseEnter={() => {
                          hoveredGroupedBillsFolderRef.current = { tab: "by-broker", key: `broker-${brokerId}` };
                        }}
                        onMouseLeave={() => {
                          const hoveredFolder = hoveredGroupedBillsFolderRef.current;
                          if (hoveredFolder?.tab === "by-broker" && hoveredFolder.key === `broker-${brokerId}`) {
                            hoveredGroupedBillsFolderRef.current = null;
                          }
                        }}
                        className={isMobile ? "overflow-hidden rounded-xl border bg-card shadow-sm" : "border rounded-lg bg-card"}
                      >
                        <AccordionTrigger className={isMobile ? "px-3 py-3 hover:no-underline" : "px-4 hover:no-underline"}>
                          {isMobile ? (
                            <div className="mr-2 flex min-w-0 flex-1 items-start gap-2.5">
                              <User className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                              <div className="min-w-0 flex-1 text-left">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="truncate text-sm font-semibold">{brokerData.broker.name}</span>
                                  {brokerData.broker.phone && (
                                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                      {brokerData.broker.phone}
                                    </span>
                                  )}
                                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {brokerData.bills.length} bill{brokerData.bills.length !== 1 ? "s" : ""}
                                  </span>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                                  <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                                    <p className="text-[10px] text-muted-foreground">Final</p>
                                    <p className="font-semibold text-violet-600">{totalAmount.toFixed(2)} AED</p>
                                  </div>
                                  <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                                    <p className="text-[10px] text-muted-foreground">
                                      {totalDue > 0 ? "Due" : "Status"}
                                    </p>
                                    <p className={`font-semibold ${totalDue > 0 ? "text-destructive" : "text-green-600"}`}>
                                      {totalDue > 0 ? `${totalDue.toFixed(2)} AED` : "Paid"}
                                    </p>
                                  </div>
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                                  <span>
                                    Paid: <span className="font-semibold text-green-600">{totalPaid.toFixed(2)} AED</span>
                                  </span>
                                  {totalDiscount > 0 && (
                                    <span>
                                      Discount: <span className="font-semibold text-orange-600">{totalDiscount.toFixed(2)} AED</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3 flex-1">
                              <User className="w-5 h-5 text-violet-500" />
                              <div className="flex-1 text-left">
                                <span className="font-semibold">{brokerData.broker.name}</span>
                                {brokerData.broker.phone && (
                                  <span className="ml-2 text-sm text-muted-foreground">
                                    ({brokerData.broker.phone})
                                  </span>
                                )}
                                <span className="ml-2 text-sm text-muted-foreground">
                                  - {brokerData.bills.length} bill{brokerData.bills.length !== 1 ? 's' : ''}
                                </span>
                              </div>
                              <div className="flex items-center gap-4 mr-4 text-sm">
                                <span>
                                  Final: <strong className="text-violet-600">{totalAmount.toFixed(2)} AED</strong>
                                </span>
                                {totalDiscount > 0 && (
                                  <span>
                                    Discount: <strong className="text-orange-600">{totalDiscount.toFixed(2)} AED</strong>
                                  </span>
                                )}
                                {totalDue > 0 && (
                                  <Badge variant="destructive" className="text-xs">
                                    Due: {totalDue.toFixed(2)} AED
                                  </Badge>
                                )}
                                {totalDue === 0 && totalAmount > 0 && (
                                  <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                                    Paid
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )}
                        </AccordionTrigger>
                        <AccordionContent className={isMobile ? "px-3 pb-3" : "px-4 pb-4"}>
                          <div className={isMobile ? "mb-3 grid grid-cols-1 gap-2" : "mb-3 flex justify-end gap-2"}>
                            {totalDue > 0 && (
                              <Button
                                variant="default"
                                size="sm"
                                className={isMobile ? "h-8 w-full rounded-lg bg-blue-600 text-[11px] hover:bg-blue-700" : undefined}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePayNowForClient(brokerData.broker, selectedDue);
                                }}
                                data-testid={`button-pay-broker-${brokerId}`}
                              >
                                <DollarSign className="w-4 h-4 mr-2" />
                                {hasSelection
                                  ? `Pay Selected (${selectedInBroker.length}) - ${selectedDue.toFixed(2)} AED`
                                  : `Pay ${totalDue.toFixed(2)} AED`}
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className={isMobile ? "h-8 w-full rounded-lg text-[11px]" : undefined}
                              onClick={(e) => {
                                e.stopPropagation();
                                const allBills = brokerData.bills || [];
                                const unpaidBills = allBills.filter((b) => isBillOutstanding(b));
                                const isFullyPaid = unpaidBills.length === 0 && allBills.length > 0;
                                const targetClient = getClientById(brokerData.broker.id);
                                const groupedBillsToPrint = isFullyPaid ? allBills : unpaidBills;

                                void printGroupedBillsInvoice({
                                  clientId: brokerData.broker.id,
                                  displayName: brokerData.broker.name,
                                  phone: brokerData.broker.phone || targetClient?.phone,
                                  addressLines: groupedBillsToPrint.flatMap((bill) => getBillAddressLines(bill, targetClient)),
                                  bills: groupedBillsToPrint,
                                  kind: isFullyPaid ? "paid" : "unpaid",
                                  isBroker: true,
                                });
                              }}
                              data-testid={`button-print-broker-invoice-${brokerId}`}
                            >
                              <Printer className="w-4 h-4 mr-2" />
                              {totalDue > 0 ? 'Print Unpaid Invoice' : 'Print Invoice'}
                            </Button>
                            {(() => {
                              const paidBrokerBills = brokerData.bills.filter((bill) => !isBillOutstanding(bill));
                              if (totalDue <= 0 || paidBrokerBills.length === 0) return null;
                              return (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className={isMobile ? "h-8 w-full rounded-lg text-[11px]" : undefined}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const brokerClient = getClientById(brokerData.broker.id);
                                    void printGroupedBillsInvoice({
                                      clientId: brokerData.broker.id,
                                      displayName: brokerData.broker.name,
                                      phone: brokerData.broker.phone || brokerClient?.phone,
                                      addressLines: paidBrokerBills.flatMap((bill) => getBillAddressLines(bill, brokerClient)),
                                      bills: paidBrokerBills,
                                      kind: "paid",
                                      isBroker: true,
                                    });
                                  }}
                                  data-testid={`button-print-broker-paid-invoices-${brokerId}`}
                                >
                                  <Printer className="w-4 h-4 mr-2" />
                                  Print All Paid Invoices
                                </Button>
                              );
                            })()}
                            {selectedInBroker.length > 0 && (
                              <Button
                                variant="outline"
                                size="sm"
                                className={isMobile ? "h-8 w-full rounded-lg text-[11px]" : undefined}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  clearBillSelections(selectedInBroker.map((bill) => bill.id));
                                }}
                                data-testid={`button-clear-broker-selection-${brokerId}`}
                              >
                                <X className="w-4 h-4 mr-2" />
                                Clear Selection
                              </Button>
                            )}
                          </div>
                          {isMobile ? (
                            <div className="space-y-3">
                              {renderMobileBillsByDate(brokerData.bills, { scope: "broker" })}
                            </div>
                          ) : (() => {
                            const byDate: Record<string, Bill[]> = {};
                            brokerData.bills.forEach((bill) => {
                              const dk = format(new Date(bill.billDate), "yyyy-MM-dd");
                              if (!byDate[dk]) byDate[dk] = [];
                              byDate[dk].push(bill);
                            });
                            const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
                            return sortedDates.map((dk) => (
                              <div key={dk} className="mb-4">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-xs font-semibold text-muted-foreground">
                                    {format(new Date(dk + "T00:00:00"), "EEEE, MMM dd, yyyy")}
                                  </span>
                                  <Badge variant="secondary" className="text-[10px]">
                                    {byDate[dk].length}
                                  </Badge>
                                  <div className="flex-1 border-t border-border" />
                                </div>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="w-8">
                                        {(() => {
                                          const unpaidInDate = byDate[dk].filter((b) => isBillOutstanding(b));
                                          const allSelected = unpaidInDate.length > 0 && unpaidInDate.every(b => selectedBillIds.has(b.id));
                                          return unpaidInDate.length > 0 ? (
                                            <input
                                              type="checkbox"
                                              checked={allSelected}
                                              onChange={(e) => {
                                                e.stopPropagation();
                                                setSelectedBillIds(prev => {
                                                  const next = new Set(prev);
                                                  if (allSelected) {
                                                    unpaidInDate.forEach(b => next.delete(b.id));
                                                  } else {
                                                    unpaidInDate.forEach(b => next.add(b.id));
                                                  }
                                                  return next;
                                                });
                                              }}
                                              className="rounded border-gray-300"
                                              data-testid={`checkbox-select-all-broker-bills-${dk}`}
                                            />
                                      ) : null;
                                    })()}
                                      </TableHead>
                                      <TableHead>Bill #</TableHead>
                                      <TableHead>Created</TableHead>
                                      <TableHead>Paid On</TableHead>
                                      <TableHead>Description</TableHead>
                                      <TableHead className="text-right">Work Rec.</TableHead>
                                      <TableHead className="text-right">Discount</TableHead>
                                      <TableHead className="text-right">Final</TableHead>
                                      <TableHead className="text-right">Paid</TableHead>
                                      <TableHead className="text-right">Due</TableHead>
                                      <TableHead>Status</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {byDate[dk].map((bill) => {
                                      const displayAmounts = getBillDisplayAmounts(bill);
                                      const originalAmount = displayAmounts.originalAmount;
                                      const discount = displayAmounts.discount;
                                      const finalAmt = displayAmounts.finalAmount;
                                      const paid = displayAmounts.paidAmount;
                                      const due = displayAmounts.due;
                                      const isUnpaid = due > 0.01;
                                      const latestPaymentDate = getBillLatestPaymentDate(bill.id);
                                      const receiptIconClass = getBillReceiptIconClass(bill, displayAmounts);
                                      return (
                                        <TableRow
                                          key={bill.id}
                                          className={`cursor-pointer hover:bg-muted/50 ${selectedBillIds.has(bill.id) ? "bg-blue-50 dark:bg-blue-950/30" : ""}`}
                                          onClickCapture={(event) => handleBillShortcutSelectionCapture(event, bill)}
                                          onClick={(event) => handleBillShortcutClick(event, bill)}
                                        >
                                          <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                                            {isUnpaid && (
                                              <input
                                                type="checkbox"
                                                checked={selectedBillIds.has(bill.id)}
                                                onChange={() => toggleBillSelection(bill.id)}
                                                className="rounded border-gray-300"
                                                data-testid={`checkbox-broker-bill-${bill.id}`}
                                              />
                                            )}
                                          </TableCell>
                                          <TableCell className="font-medium">
                                            <div className="flex flex-col leading-tight">
                                              <div className="flex items-center gap-1">
                                                <Receipt className={`h-3.5 w-3.5 ${receiptIconClass}`} />
                                                <span>#{bill.id}</span>
                                              </div>
                                              {renderBillTypeIndicator(bill)}
                                            </div>
                                          </TableCell>
                                          <TableCell>{formatBillCreatedDate(bill.billDate)}</TableCell>
                                          <TableCell className={latestPaymentDate ? "text-green-600" : "text-muted-foreground"}>
                                            {formatBillPaymentDate(latestPaymentDate)}
                                          </TableCell>
                                          <TableCell className="max-w-xs truncate text-xs">
                                            {bill.description || '-'}
                                          </TableCell>
                                          <TableCell className="text-right">{originalAmount.toFixed(2)}</TableCell>
                                          <TableCell
                                            className={`text-right text-orange-600 font-medium ${!bill.isPaid ? "cursor-pointer hover:underline" : ""}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              openBillDiscountEdit(bill);
                                            }}
                                          >
                                            {renderBillDiscountEditor(
                                              bill,
                                              discount,
                                              `input-broker-bill-discount-${bill.id}`,
                                            )}
                                          </TableCell>
                                          <TableCell className="text-right text-green-700 font-medium">{finalAmt.toFixed(2)}</TableCell>
                                          <TableCell className="text-right text-green-600">{paid.toFixed(2)}</TableCell>
                                          <TableCell className="text-right text-destructive font-medium">
                                            {due > 0 ? due.toFixed(2) : '-'}
                                          </TableCell>
                                          <TableCell>
                                            {due <= 0 ? (
                                              <Badge variant="outline" className="text-green-600 border-green-600">Paid</Badge>
                                            ) : paid > 0 ? (
                                              <Badge variant="outline" className="text-amber-600 border-amber-600">Partial</Badge>
                                            ) : (
                                              <Badge className="bg-violet-500 text-white">Unpaid</Badge>
                                            )}
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              </div>
                            ));
                          })()}
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                  <div
                    ref={brokerGroupsLoadMoreRef}
                    className="py-2 text-center text-[11px] text-muted-foreground"
                  >
                    Showing {visibleBrokerBillGroups.length} of {brokerBillGroups.length} brokers
                    {hasMoreBrokerGroups
                      ? `, scroll down to load ${BILLS_LOAD_MORE_COUNT} more`
                      : ", all broker groups loaded"}
                  </div>
                </Accordion>
              );
            })()}
            </>
            ) : null}
          </TabsContent>

        </main>
      </Tabs>

      <Dialog
        open={mobileBillsControlDialog !== null}
        onOpenChange={(open) => {
          if (!open) setMobileBillsControlDialog(null);
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="w-[min(92vw,24rem)] max-w-sm rounded-2xl border-border/70 p-3 pr-10 shadow-2xl sm:rounded-2xl"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{mobileBillsControlDialogTitle}</DialogTitle>
            <DialogDescription>
              Mobile bills control panel
            </DialogDescription>
          </DialogHeader>
          {renderMobileBillsControlDialogBody()}
        </DialogContent>
      </Dialog>

      <Dialog
        open={isSelectedBillsFolderOpen}
        onOpenChange={setIsSelectedBillsFolderOpen}
      >
        <DialogContent
          aria-describedby={undefined}
          className="w-[min(94vw,34rem)] max-w-lg rounded-2xl border-border/70 p-3 pr-10 shadow-2xl sm:rounded-2xl"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>
              {activeSelectedBillsFolderKind === "payment"
                ? "Selected Unpaid Bills Folder"
                : "Selected Paid Bills Folder"}
            </DialogTitle>
            <DialogDescription>
              Selected bills available for bulk payment or bulk revert.
            </DialogDescription>
          </DialogHeader>
          {renderSelectedBillsFolderDialogBody()}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!createdBill}
        onOpenChange={(open) => !open && setCreatedBill(null)}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-green-600" />
              Bill Created Successfully
            </DialogTitle>
            <DialogDescription>
              Invoice ready to print
            </DialogDescription>
          </DialogHeader>

          <div
            ref={invoiceRef}
            className="bg-white p-6 rounded-lg border text-black"
            style={{ fontFamily: "Arial, sans-serif", fontSize: "12px", position: "relative" }}
          >
            <div style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              opacity: 0.08,
              pointerEvents: "none",
              zIndex: 0,
            }}>
              <img src={logoBase64 || workspaceLogoUrl} alt="" style={{ width: "350px", height: "auto" }} />
            </div>
            <div style={{ position: "relative", zIndex: 1 }}>
            <div className="text-center border-b pb-3 mb-3">
              <img 
                src={logoBase64 || workspaceLogoUrl} 
                alt={companyContact.companyName} 
                style={{ width: '120px', height: 'auto', objectFit: 'contain', margin: '0 auto 10px' }}
              />
              {companyAddressLines.map((line) => (
                <div key={line} className="text-sm">{line}</div>
              ))}
              <div className="text-sm mt-2">{companyPhoneLine}</div>
            </div>
            <div className="text-center font-bold text-lg mb-3">INVOICE</div>
            <div className="text-sm mb-3">
              <div>Ref: {createdBill?.bill.referenceNumber}</div>
              <div>
                Date:{" "}
                {createdBill?.bill.billDate
                  ? format(
                      new Date(createdBill.bill.billDate),
                      "dd/MM/yyyy HH:mm",
                    )
                  : ""}
              </div>
              <div>Customer: {createdBill?.bill.customerName}</div>
              {getDisplayPhone(createdBill?.bill.customerPhone) && (
                <div>Phone: {getDisplayPhone(createdBill?.bill.customerPhone)}</div>
              )}
              {createdBill?.bill.createdBy && (
                <div>Billed by: {createdBill.bill.createdBy}</div>
              )}
              <div
                style={{
                  marginTop: "2px",
                  fontWeight: "bold",
                  color: createdBill?.bill.id && firstOrderByBillId.get(createdBill.bill.id)?.urgent
                    ? "#dc2626"
                    : "#16a34a",
                }}
              >
                Bill Type: {createdBill?.bill.id && firstOrderByBillId.get(createdBill.bill.id)?.urgent ? "URGENT" : "NORMAL"}
              </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px', fontSize: '12px' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'center', padding: '10px 8px', fontWeight: 'bold', width: '8%', background: '#1e40af', color: 'white', border: '1px solid #333' }}>S.No</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', fontWeight: 'bold', width: '42%', background: '#1e40af', color: 'white', border: '1px solid #333' }}>Item</th>
                  <th style={{ textAlign: 'center', padding: '10px 8px', fontWeight: 'bold', width: '12%', background: '#1e40af', color: 'white', border: '1px solid #333' }}>Qty</th>
                  <th style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 'bold', width: '18%', background: '#1e40af', color: 'white', border: '1px solid #333' }}>Price</th>
                  <th style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 'bold', width: '20%', background: '#1e40af', color: 'white', border: '1px solid #333' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {createdBill?.items.map((item, idx) => (
                  <tr key={idx} style={{ background: idx % 2 === 1 ? '#f5f5f5' : 'white' }}>
                    <td style={{ textAlign: 'center', padding: '10px 8px', border: '1px solid #333' }}>{idx + 1}</td>
                    <td style={{ textAlign: 'left', padding: '10px 8px', border: '1px solid #333' }}>
                      <InvoiceItemDescription
                        name={item.name}
                        packingRowStyle={{ fontSize: "10px", marginTop: "4px" }}
                      />
                    </td>
                    <td style={{ textAlign: 'center', padding: '10px 8px', border: '1px solid #333' }}>{item.qty}</td>
                    <td style={{ textAlign: 'right', padding: '10px 8px', border: '1px solid #333' }}>{item.price.toFixed(2)}</td>
                    <td style={{ textAlign: 'right', padding: '10px 8px', border: '1px solid #333', fontWeight: '500' }}>{(item.total || item.price * item.qty).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(() => {
              const previewSubTotal = createdBill?.items.reduce((sum, item) => sum + (item.total || item.price * item.qty), 0) || 0;
              const previewRelatedOrder = createdBill?.bill.id ? firstOrderByBillId.get(createdBill.bill.id) : undefined;
              const previewBill = createdBill?.bill as any;
              const previewBillOriginal = previewBill?.originalAmount ? parseFloat(previewBill.originalAmount) : null;
              const previewAdjustedTotal = previewRelatedOrder?.adjustedTotal != null ? parseFloat(previewRelatedOrder.adjustedTotal) : (previewBillOriginal != null ? parseFloat(previewBill?.amount || "0") : null);
              const previewOriginalTotal = previewBillOriginal != null ? previewBillOriginal : (previewRelatedOrder ? parseFloat(previewRelatedOrder.totalAmount || "0") : previewSubTotal);
              const previewReason = previewBill?.priceAdjustReason || previewRelatedOrder?.priceAdjustReason;
              const billTotal = parseFloat(createdBill?.bill.amount || "0");
              return (
                <div style={{ borderTop: "1px solid #000", paddingTop: "8px", fontSize: "13px" }}>
                  {createdBill?.items && createdBill.items.length > 0 && (
                    <div className="flex justify-between" style={{ padding: "4px 0" }}>
                      <span>Sub Total:</span>
                      <span>AED {previewSubTotal.toFixed(2)}</span>
                    </div>
                  )}
                  {previewAdjustedTotal != null && previewAdjustedTotal !== previewOriginalTotal && (
                    <>
                      <div className="flex justify-between" style={{ padding: "4px 0", textDecoration: "line-through", color: "#999" }}>
                        <span>Original Total:</span>
                        <span>AED {previewOriginalTotal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between" style={{ padding: "4px 0", fontWeight: "bold", color: "#1e40af" }}>
                        <span>Adjusted Total:</span>
                        <span>AED {previewAdjustedTotal.toFixed(2)}</span>
                      </div>
                      {previewReason && (
                        <div style={{ fontSize: "11px", color: "#b45309", fontStyle: "italic", padding: "2px 0 4px" }}>
                          Reason: {previewReason}
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex justify-between font-bold text-base" style={{ borderTop: "2px solid #000", paddingTop: "8px", marginTop: "4px" }}>
                    <span>TOTAL:</span>
                    <span>AED {billTotal.toFixed(2)}</span>
                  </div>
                </div>
              );
            })()}
            
            {createdBill?.bill.isPaid && (
              <div className="text-center mt-4">
                <div 
                  style={{
                    display: 'inline-block',
                    border: '3px solid #22c55e',
                    borderRadius: '8px',
                    padding: '8px 20px',
                    color: '#22c55e',
                    fontWeight: 'bold',
                    fontSize: '18px',
                    transform: 'rotate(-5deg)',
                    textTransform: 'uppercase'
                  }}
                >
                  PAID
                </div>
                <div className="text-sm mt-2 text-gray-600">
                  Payment Method: {
                    createdBill.bill.paymentMethod === 'deposit' 
                      ? 'CLIENT CREDIT' 
                      : formatPaymentMethodLabel(createdBill.bill.paymentMethod || 'cash')
                  }
                </div>
              </div>
            )}
            
            <div style={{ 
              marginTop: '15px', 
              padding: '10px', 
              background: '#f0f9ff', 
              borderRadius: '6px', 
              border: '1px dashed #1e40af',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '10px', color: '#1e40af', marginBottom: '4px' }}>
                Track your order at this link:
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                <div style={{ backgroundColor: 'white', padding: '6px', borderRadius: '4px' }}>
                  <QRCodeSVG 
                    value={getPublicTrackingUrl()}
                    size={70}
                    level="M"
                  />
                </div>
              </div>
              <div style={{ fontSize: '11px', color: '#1e40af', fontWeight: 'bold' }}>
                {getPublicTrackingUrl()}
              </div>
              <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#333', marginTop: '4px' }}>
                Order Number: {createdBill?.bill.referenceNumber}
              </div>
            </div>
            <div className="text-center mt-4 text-xs">
              Thank you for your business!
            </div>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <Button
              onClick={printInvoice}
              className="flex-1"
              data-testid="button-print-invoice"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print Invoice
            </Button>
            <Button
              onClick={shareWhatsApp}
              variant="outline"
              className="flex-1 text-green-600"
              data-testid="button-share-whatsapp"
            >
              <SiWhatsapp className="w-4 h-4 mr-2" />
              WhatsApp
            </Button>
          </div>
          <Button
            variant="ghost"
            onClick={() => setCreatedBill(null)}
            className="w-full"
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewItemDialog} onOpenChange={setShowNewItemDialog}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-primary" />
              Add New Item
            </DialogTitle>
            <DialogDescription>
              Create a new laundry item
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Item Name</Label>
              <Input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="Enter item name"
                data-testid="input-new-item-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Price (AED)</Label>
              <Input
                type="number"
                step="0.01"
                value={newItemPrice}
                onChange={(e) => setNewItemPrice(e.target.value)}
                placeholder="Enter price"
                data-testid="input-new-item-price"
              />
            </div>
            <div className="space-y-2">
              <Label>Category (Optional)</Label>
              <Input
                value={newItemCategory}
                onChange={(e) => setNewItemCategory(e.target.value)}
                placeholder="e.g. Traditional Wear, Formal Wear"
                data-testid="input-new-item-category"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowNewItemDialog(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleCreateNewItem}
                disabled={isCreatingProduct}
                data-testid="button-save-new-item"
              >
                {isCreatingProduct && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Add Item
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showCreatorPinDialog}
        onOpenChange={(open) => {
          setShowCreatorPinDialog(open);
          if (!open) {
            setCreatorPin("");
            setCreatorPinError("");
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5 text-primary" />
              Staff PIN Required
            </DialogTitle>
            <DialogDescription>
              Enter your staff PIN to create this bill
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Staff PIN</Label>
              <Input
                id="creator-pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={5}
                enterKeyHint="done"
                value={creatorPin}
                autoComplete="one-time-code"
                onChange={(e) => {
                  setCreatorPin(e.target.value.replace(/\D/g, "").slice(0, 5));
                  setCreatorPinError("");
                }}
                placeholder="Enter your PIN"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    handleVerifyCreatorPin();
                  }
                }}
                className="text-center text-2xl tracking-widest [-webkit-text-security:disc]"
                data-testid="input-creator-pin"
              />
              {creatorPinError && (
                <p className="text-sm text-destructive">{creatorPinError}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowCreatorPinDialog(false);
                  setCreatorPin("");
                  setCreatorPinError("");
                  setPendingBillData(null);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleVerifyCreatorPin}
                disabled={verifyCreatorPinMutation.isPending}
                data-testid="button-verify-creator-pin"
              >
                {verifyCreatorPinMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Create Bill
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cashier PIN Verification Dialog */}
      <Dialog
        open={showPinDialog}
        onOpenChange={(open) => {
          setShowPinDialog(open);
          if (!open) {
            setCashierPin("");
            setPinError("");
            setPendingPaymentAction(null);
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5 text-primary" />
              Manager/Cashier PIN Required
            </DialogTitle>
            <DialogDescription>
              Enter your Manager/Cashier PIN to process this payment
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="cashier-pin">Enter PIN</Label>
              <Input
                id="cashier-pin"
                type="password"
                inputMode="numeric"
                maxLength={5}
                value={cashierPin}
                onChange={(e) => {
                  setCashierPin(e.target.value.replace(/\D/g, "").slice(0, 5));
                  setPinError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && cashierPin.length === 5) {
                    e.preventDefault();
                    e.stopPropagation();
                    verifyCashierPin();
                  }
                }}
                placeholder="Enter 5-digit PIN"
                className="text-center tracking-widest text-lg"
                autoFocus
                data-testid="input-cashier-pin"
              />
              {pinError && (
                <p className="text-sm text-destructive mt-1">{pinError}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowPinDialog(false);
                  setCashierPin("");
                  setPinError("");
                  setPendingPaymentAction(null);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={verifyCashierPin}
                disabled={cashierPin.length !== 5}
                data-testid="button-verify-pin"
              >
                Verify & Proceed
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!discountPinDialogBill}
        onOpenChange={(open) => {
          if (!open) {
            setDiscountPinDialogBill(null);
            setDiscountPin("");
            setDiscountPinError("");
            setIsDiscountPinVerifying(false);
            clearDiscountPinPreview();
          }
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="sm:max-w-sm"
          onCloseAutoFocus={(event) => {
            if (pendingBillDiscountFocusIdRef.current !== null) {
              event.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-orange-600" />
              Discount Authorization
            </DialogTitle>
            <DialogDescription>
              Enter an admin or counter PIN before editing this discount.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="bill-discount-pin">Admin or Counter PIN</Label>
              {renderDiscountPinPreview()}
              <Input
                id="bill-discount-pin"
                type="password"
                inputMode="numeric"
                maxLength={5}
                value={discountPin}
                onChange={(event) => {
                  const normalizedPin = event.target.value.replace(/\D/g, "").slice(0, 5);
                  setDiscountPin(normalizedPin);
                  setDiscountPinError("");
                  void updateDiscountPinPreview(normalizedPin);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void verifyBillDiscountPin();
                  }
                }}
                placeholder="Enter 5-digit PIN"
                data-testid="input-bill-discount-pin"
              />
              {discountPinError && (
                <p className="mt-1 text-sm text-destructive">{discountPinError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  pendingBillDiscountFocusIdRef.current = null;
                  setDiscountPinDialogBill(null);
                  setDiscountPin("");
                  setDiscountPinError("");
                  clearDiscountPinPreview();
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void verifyBillDiscountPin()}
                disabled={isDiscountPinVerifying || discountPin.length !== 5}
                data-testid="button-verify-bill-discount-pin"
              >
                {isDiscountPinVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Unlock
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showPaymentDialog}
        onOpenChange={(open) => {
          if (open) {
            setShowPaymentDialog(true);
            return;
          }
          closePaymentDialog(true);
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" />
              {companyPayment
                ? `Pay Company Bills - ${companyPayment.companyName}`
                : selectedBillsPaymentSummary
                  ? "Pay Selected Bills"
                  : bulkPaymentClientId
                    ? "Pay All Outstanding Bills"
                    : "Pay Bill"}
            </DialogTitle>
            <DialogDescription>
              {companyPayment
                ? `Process payment for all unpaid bills under ${companyPayment.companyName}`
                : selectedBillsPaymentSummary
                  ? selectedBillsPaymentSummary.clientCount > 1
                    ? `Process one shared payment for ${selectedBillsPaymentSummary.billCount} selected bills across ${selectedBillsPaymentSummary.clientCount} client accounts`
                    : `Process payment for ${selectedBillsPaymentSummary.billCount} selected bill${selectedBillsPaymentSummary.billCount === 1 ? "" : "s"}`
                : bulkPaymentClientId 
                ? `Process payment for all unpaid bills`
                : `Process payment for ${selectedBill?.referenceNumber}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="amount">Payment Amount</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="Enter amount"
              />
              {companyPayment && companyPaymentOutstandingSummary && (
                <p className="text-xs text-muted-foreground mt-1">
                  Bills: {companyPaymentOutstandingSummary.billCount} | Clients: {companyPaymentOutstandingSummary.clientCount} | Work Received: AED{" "}
                  {companyPaymentOutstandingSummary.totalWorkReceived.toFixed(2)} | Discount: AED{" "}
                  {companyPaymentOutstandingSummary.totalDiscount > 0
                    ? `-${companyPaymentOutstandingSummary.totalDiscount.toFixed(2)}`
                    : "0.00"}{" "}
                  | Final: AED {companyPaymentOutstandingSummary.totalAmount.toFixed(2)} | Paid: AED{" "}
                  {companyPaymentOutstandingSummary.totalPaid.toFixed(2)} | Remaining: AED{" "}
                  {companyPaymentOutstandingSummary.totalRemaining.toFixed(2)}
                </p>
              )}
              {companyPayment && !companyPaymentOutstandingSummary && (
                <p className="text-xs text-muted-foreground mt-1">
                  Total Due for {companyPayment.companyName}: <strong>AED {companyPayment.totalDue.toFixed(2)}</strong>
                </p>
              )}
              {bulkPaymentClientId && !companyPayment && bulkClientOutstandingSummary && (
                <p className="text-xs text-muted-foreground mt-1">
                  Total Bills: {bulkClientOutstandingSummary.billCount} | Work Received: AED{" "}
                  {bulkClientOutstandingSummary.totalWorkReceived.toFixed(2)} | Discount: AED{" "}
                  {bulkClientOutstandingSummary.totalDiscount > 0 ? `-${bulkClientOutstandingSummary.totalDiscount.toFixed(2)}` : "0.00"} | Final: AED{" "}
                  {bulkClientOutstandingSummary.totalAmount.toFixed(2)} | Paid: AED{" "}
                  {bulkClientOutstandingSummary.totalPaid.toFixed(2)} | Remaining: AED{" "}
                  {bulkClientOutstandingSummary.totalRemaining.toFixed(2)}
                </p>
              )}
              {selectedBillsPaymentSummary && !companyPayment && !bulkPaymentClientId && (
                <>
                  <p className="text-xs text-muted-foreground mt-1">
                    Bills: {selectedBillsPaymentSummary.billCount} | Clients: {selectedBillsPaymentSummary.clientCount} | Work Received: AED{" "}
                    {selectedBillsPaymentSummary.totalWorkReceived.toFixed(2)} | Discount: AED{" "}
                    {selectedBillsPaymentSummary.totalDiscount > 0
                      ? `-${selectedBillsPaymentSummary.totalDiscount.toFixed(2)}`
                      : "0.00"}{" "}
                    | Final: AED {selectedBillsPaymentSummary.totalAmount.toFixed(2)} | Paid: AED{" "}
                    {selectedBillsPaymentSummary.totalPaid.toFixed(2)} | Remaining: AED{" "}
                    {selectedBillsPaymentSummary.totalRemaining.toFixed(2)}
                  </p>
                  <div className="mt-2 rounded-lg border border-primary/15 bg-primary/5 p-2">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Bills Included
                    </p>
                    <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
                      {selectedBillsPaymentSummary.billIds.map((billId) => {
                        const bill = billsById.get(billId);
                        if (!bill) {
                          return (
                            <div key={billId} className="rounded-md bg-background/80 px-2 py-1 text-xs">
                              <span className="font-semibold text-primary">#{billId}</span>
                            </div>
                          );
                        }

                        const displayAmounts = getBillDisplayAmounts(bill);
                        const linkedClient = bill.clientId ? clientById.get(bill.clientId) : null;
                        const clientName =
                          bill.customerName || linkedClient?.name || "Walk-in Customer";

                        return (
                          <div
                            key={bill.id}
                            className="flex items-center justify-between gap-2 rounded-md bg-background/80 px-2 py-1 text-xs"
                          >
                            <span className="min-w-0 truncate">
                              <span className="font-semibold text-primary">#{bill.id}</span>
                              <span className="text-muted-foreground"> | {clientName}</span>
                            </span>
                            <span className="shrink-0 font-medium">
                              {displayAmounts.due.toFixed(2)} AED
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
              {selectedBill && !companyPayment && !bulkPaymentClientId && (
                <p className="text-xs text-muted-foreground mt-1">
                  {(() => {
                    const displayAmounts = getBillDisplayAmounts(selectedBill);
                    return (
                      <>
                        Work Received: AED {displayAmounts.originalAmount.toFixed(2)} | Final: AED{" "}
                        {displayAmounts.finalAmount.toFixed(2)} | Discount: AED{" "}
                        {displayAmounts.discount > 0 ? `-${displayAmounts.discount.toFixed(2)}` : "0.00"} | Paid: AED{" "}
                        {displayAmounts.paidAmount.toFixed(2)} | Remaining: AED{" "}
                        {displayAmounts.due.toFixed(2)}
                      </>
                    );
                  })()}
                </p>
              )}
              {showPartialPaymentNotice && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Partial payment notice</p>
                      <p>
                        {isSingleBillPayment
                          ? "This bill will be marked partially paid because the given amount is lower than the current bill amount."
                          : "This grouped payment is lower than the current total bill amount, so the affected bills will be marked partially paid as needed."}
                      </p>
                      <p className="mt-1 font-medium">
                        Remaining after payment: {partialPaymentRemainingAfterPayment.toFixed(2)} AED
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {canUseDepositPayment && (
              <>
                <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    Customer has AED {activePaymentClientDeposit.toFixed(2)} account credit balance available
                  </p>
                </div>
                {!splitUsesDeposit && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                      Reminder: Customer still has account credit balance. Consider using "Account Credit" instead.
                    </p>
                  </div>
                )}
              </>
            )}
            {((bulkPaymentClientId || companyPayment || selectedBillsPaymentSummary) ||
              (selectedBill && !selectedBill.isPaid && parseFloat(selectedBill.discountAmount || "0") === 0)) && (
              <div className="p-3 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="bills-apply-discount"
                    checked={applyDiscount}
                    onChange={(e) => {
                      setApplyDiscount(e.target.checked);
                      if (e.target.checked) {
                        focusDiscountAmountInput();
                      } else {
                        setDiscountAmount("");
                        if (selectedBill && !bulkPaymentClientId && !companyPayment && !selectedBillsPaymentSummary) {
                          const billDue = getBillDisplayAmounts(selectedBill).due;
                          setPaymentAmount(billDue.toFixed(2));
                        } else if (selectedBillsPaymentSummary) {
                          setPaymentAmount(selectedBillsPaymentSummary.totalRemaining.toFixed(2));
                        } else if (bulkPaymentClientId && bulkClientOutstandingSummary) {
                          setPaymentAmount(bulkClientOutstandingSummary.totalRemaining.toFixed(2));
                        } else if (companyPayment) {
                          setPaymentAmount(
                            (companyPaymentOutstandingSummary?.totalRemaining ?? companyPayment.totalDue).toFixed(2),
                          );
                        }
                      }
                    }}
                    className="rounded"
                    data-testid="toggle-apply-discount-bills"
                  />
                  <Label htmlFor="bills-apply-discount" className="text-sm font-medium text-orange-700 dark:text-orange-400 cursor-pointer">
                    {bulkPaymentClientId || companyPayment || selectedBillsPaymentSummary
                      ? "Apply FIFO Discount Across Bills"
                      : "Apply Discount"}
                  </Label>
                </div>
                {applyDiscount && (
                  <div>
                    <Label className="text-xs">
                      {bulkPaymentClientId || companyPayment || selectedBillsPaymentSummary
                        ? "Total Discount Amount (AED)"
                        : "Discount Amount (AED)"}
                    </Label>
                    <Input
                      ref={discountAmountInputRef}
                      type="number"
                      step="0.01"
                      min="0"
                      value={discountAmount}
                      onChange={(e) => {
                        setDiscountAmount(e.target.value);
                        const disc = parseFloat(e.target.value) || 0;
                        if (selectedBill && !bulkPaymentClientId && !companyPayment && !selectedBillsPaymentSummary) {
                          const displayAmounts = getBillDisplayAmounts(selectedBill);
                          const origAmount = displayAmounts.originalAmount;
                          const newAmount = Math.max(0, origAmount - disc);
                          const paid = displayAmounts.paidAmount;
                          setPaymentAmount(Math.max(0, newAmount - paid).toFixed(2));
                        } else if (selectedBillsPaymentSummary) {
                          const adjustedTotal = Math.max(0, selectedBillsPaymentSummary.totalRemaining - disc);
                          setPaymentAmount(adjustedTotal.toFixed(2));
                        } else if (bulkPaymentClientId && bulkClientOutstandingSummary) {
                          const adjustedTotal = Math.max(0, bulkClientOutstandingSummary.totalRemaining - disc);
                          setPaymentAmount(adjustedTotal.toFixed(2));
                        } else if (companyPayment) {
                          const adjustedTotal = Math.max(
                            0,
                            (companyPaymentOutstandingSummary?.totalRemaining ?? companyPayment.totalDue) - disc,
                          );
                          setPaymentAmount(adjustedTotal.toFixed(2));
                        }
                      }}
                      placeholder="0.00"
                      data-testid="input-discount-amount-bills"
                    />
                    {discountAmount && parseFloat(discountAmount) > 0 && (
                      <p className="text-xs text-orange-600 mt-1">
                        {bulkPaymentClientId || companyPayment || selectedBillsPaymentSummary
                          ? `Discount: -${parseFloat(discountAmount).toFixed(2)} AED (FIFO from oldest bills). Pay: ${paymentAmount} AED`
                          : `New bill total: ${Math.max(0, (selectedBill ? getBillDisplayAmounts(selectedBill).originalAmount : 0) - parseFloat(discountAmount)).toFixed(2)} AED`}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            <div>
              <Label>Payment Method</Label>
              <div
                className="grid grid-cols-2 gap-2 mt-2"
                role="radiogroup"
                aria-label="Payment Method"
                data-testid="select-payment-method"
              >
                {paymentMethodOptions.map(({ value, label, Icon }) => {
                  const isSelected = paymentMethod === value;

                  return (
                    <Button
                      key={value}
                      type="button"
                      variant={isSelected ? "default" : "outline"}
                      className={`h-auto justify-start gap-2 px-3 py-2 text-left whitespace-normal ${
                        isSelected ? "" : "hover:border-primary/50"
                      }`}
                      onClick={() => setPaymentMethod(value)}
                      aria-pressed={isSelected}
                      data-testid={`button-payment-method-${value}`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className="text-sm leading-tight">{label}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enable-split-payment"
                  checked={splitPaymentEnabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setSplitPaymentEnabled(enabled);

                    if (enabled) {
                      const suggestedSplitAmount =
                        paymentMethod === "deposit"
                          ? Math.min(normalizedRequestedPaymentAmount, activePaymentClientDeposit)
                          : normalizedRequestedPaymentAmount;
                      setSplitPaymentAmount(
                        suggestedSplitAmount > 0 ? suggestedSplitAmount.toFixed(2) : "",
                      );
                      setRemainingPaymentMethod(splitPaymentMethodOptions[0]?.value || "cash");
                    } else {
                      setSplitPaymentAmount("");
                    }
                  }}
                  className="rounded"
                  data-testid="toggle-enable-split-payment"
                />
                <Label htmlFor="enable-split-payment" className="text-sm font-medium cursor-pointer">
                  Add another payment method
                </Label>
              </div>
              {splitPaymentEnabled && (
                <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-3 space-y-3 dark:border-sky-800 dark:bg-sky-950/20">
                  <div>
                    <Label className="text-xs">
                      Amount to pay with {formatSplitPaymentMethodLabel(paymentMethod)}
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={splitPaymentAmount}
                      onChange={(e) => setSplitPaymentAmount(e.target.value)}
                      placeholder="0.00"
                      data-testid="input-split-payment-amount"
                    />
                    {paymentMethod === "deposit" && (
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">
                          Available credit: {activePaymentClientDeposit.toFixed(2)} AED
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() =>
                            setSplitPaymentAmount(
                              Math.min(normalizedRequestedPaymentAmount, activePaymentClientDeposit).toFixed(2),
                            )
                          }
                        >
                          Use Full Credit
                        </Button>
                      </div>
                    )}
                    {paymentMethod === "deposit" &&
                      normalizedSplitPaymentAmount > activePaymentClientDeposit + 0.009 && (
                        <p className="mt-2 text-xs text-destructive">
                          Credit amount cannot be more than {activePaymentClientDeposit.toFixed(2)} AED.
                        </p>
                      )}
                  </div>
                  <div>
                    <Label className="text-xs">Second Payment Method</Label>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {splitPaymentMethodOptions.map(({ value, label, Icon }) => {
                        const isSelected = remainingPaymentMethod === value;

                        return (
                          <Button
                            key={`split-${value}`}
                            type="button"
                            variant={isSelected ? "default" : "outline"}
                            className={`h-auto justify-start gap-2 px-3 py-2 text-left whitespace-normal ${
                              isSelected ? "" : "hover:border-primary/50"
                            }`}
                            onClick={() => setRemainingPaymentMethod(value)}
                            aria-pressed={isSelected}
                            data-testid={`button-remaining-payment-method-${value}`}
                          >
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            <span className="text-sm leading-tight">{label}</span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="rounded-md border bg-background/80 px-3 py-2 text-sm">
                    Remaining for {formatSplitPaymentMethodLabel(remainingPaymentMethod)}:{" "}
                    <strong>{splitRemainingAmount.toFixed(2)} AED</strong>
                  </div>
                  {splitRemainingAmount <= 0.009 ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Lower the first payment amount to activate the second payment method.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Example: if the total is {normalizedRequestedPaymentAmount.toFixed(2)} AED and this first amount is{" "}
                      {normalizedSplitPaymentAmount.toFixed(2)} AED, the rest is paid with{" "}
                      {formatSplitPaymentMethodLabel(remainingPaymentMethod)}.
                    </p>
                  )}
                  {remainingPaymentMethod === "deposit" &&
                    splitRemainingAmount > activePaymentClientDeposit + 0.009 && (
                      <p className="text-xs text-destructive">
                        Remaining credit payment cannot be more than {activePaymentClientDeposit.toFixed(2)} AED.
                      </p>
                    )}
                </div>
              )}
              {!splitPaymentEnabled && paymentMethod === "deposit" && normalizedRequestedPaymentAmount > activePaymentClientDeposit + 0.009 && (
                <div className="text-sm text-amber-700 dark:text-amber-400">
                  Credit is not enough for the full amount. Turn on "Add another payment method" to split the payment.
                </div>
              )}
            </div>
            {showAutomaticOverpaymentCreditNotice && (
              <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-800 dark:bg-sky-950/20">
                <p className="text-xs text-sky-700 dark:text-sky-300">
                  This payment is leaving an extra {activePaymentExpectedOverpayment.toFixed(2)} AED after {automaticOverpaymentPaidTargetLabel}. It will be added to {autoOverpaymentCreditAccountLabel}.
                </p>
              </div>
            )}
            {requiresOverpaymentCreditAccount && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-3 dark:border-amber-800 dark:bg-amber-950/20">
                <div className="space-y-1">
                  <Label>Overpayment Credit Account</Label>
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    This payment is leaving an extra {activePaymentExpectedOverpayment.toFixed(2)} AED after the current bills are fully paid. Choose which client account should receive that credit.
                  </p>
                </div>
                <Select
                  value={selectedBillsOverpaymentClientId}
                  onValueChange={setSelectedBillsOverpaymentClientId}
                >
                  <SelectTrigger data-testid="select-selected-bills-overpayment-client">
                    <SelectValue placeholder="Choose client account" />
                  </SelectTrigger>
                  <SelectContent>
                    {overpaymentCreditClientOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Input
                id="notes"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="Payment notes"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => closePaymentDialog(true)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleProcessPayment}
                disabled={
                  payBillMutation.isPending ||
                  payAllBillsMutation.isPending ||
                  payCompanyBillsMutation.isPending ||
                  paySelectedBillsMutation.isPending ||
                  isSplitPaymentSubmitting
                }
              >
                {(
                  payBillMutation.isPending ||
                  payAllBillsMutation.isPending ||
                  payCompanyBillsMutation.isPending ||
                  paySelectedBillsMutation.isPending ||
                  isSplitPaymentSubmitting
                )
                  ? "Processing..."
                  : "Pay Now"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyClient} onOpenChange={(open) => !open && setHistoryClient(null)}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-2xl max-h-[85vh] overflow-hidden">
          <DialogHeader className="pr-10">
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              {historyClient?.name} - Transaction History
            </DialogTitle>
            <DialogDescription>
              Review this client account without leaving the Bills tab.
            </DialogDescription>
          </DialogHeader>

          {historyClient && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Unpaid Bills</p>
                  <p className="text-lg font-bold text-blue-600">
                    {historyClientUnpaidTotal.toFixed(2)} AED
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total Paid</p>
                  <p className="text-lg font-bold text-purple-600">
                    {historyClientTotalPaid.toFixed(2)} AED
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Credits Available</p>
                  <p className="text-lg font-bold text-green-600">
                    {historyAvailableCreditBalance.toFixed(2)} AED
                  </p>
                </div>
              </div>

              {historyClient.billNumber && (
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-muted-foreground">
                  Account: <span className="font-medium text-foreground">{historyClient.billNumber}</span>
                </div>
              )}

              <div className="rounded-xl border bg-card">
                <div className="border-b px-4 py-3">
                  <h4 className="text-sm font-semibold text-foreground">Transaction History</h4>
                </div>
                <ScrollArea className="h-[48vh]">
                  <div className="space-y-3 p-4">
                    {isHistoryTransactionsLoading ? (
                      <div className="flex items-center justify-center py-10 text-muted-foreground">
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Loading transaction history...
                      </div>
                    ) : historyTransactionRows.length > 0 ? (
                      historyTransactionRows.map(({ tx, creditBalance, typeDisplay }) => (
                        <div key={tx.id} className="rounded-xl border bg-background p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(tx.date), "dd/MM/yyyy HH:mm")}
                              </p>
                              <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${typeDisplay.color}`}>
                                {typeDisplay.label}
                              </span>
                              {tx.paymentMethod && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Method: {formatClientHistoryPaymentMethodLabel(tx.paymentMethod)}
                                </p>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              <p
                                className={`text-sm font-semibold ${
                                  tx.type === "deposit"
                                    ? "text-green-600"
                                    : isAccountCreditDeductionType(tx.type)
                                      ? "text-orange-600"
                                      : "text-muted-foreground"
                                }`}
                              >
                                {tx.type === "deposit" ? "+" : isAccountCreditDeductionType(tx.type) ? "-" : ""}
                                {parseFloat(tx.amount || "0").toFixed(2)} AED
                              </p>
                              <p className={`text-xs font-medium ${creditBalance >= 0 ? "text-green-600" : "text-red-600"}`}>
                                Account Credit Balance: {creditBalance.toFixed(2)} AED
                              </p>
                            </div>
                          </div>
                          <p className="mt-2 text-sm leading-snug text-muted-foreground break-words">
                            {tx.displayDescription}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="py-10 text-center text-muted-foreground">
                        No transactions yet
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bill Details Popup */}
      <Dialog open={!!viewBillDetails} onOpenChange={(open) => !open && setViewBillDetails(null)}>
        <DialogContent className={`w-[min(96vw,44rem)] max-w-xl max-h-[85vh] overflow-y-auto ${viewBillDetails?.isPaid ? "bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/50 border-green-200 dark:border-green-800" : (!viewBillDetails?.isPaid && parseFloat(viewBillDetails?.paidAmount || "0") > 0) ? "bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/50 dark:to-yellow-950/50 border-amber-200 dark:border-amber-800" : "bg-gradient-to-br from-blue-50 to-sky-50 dark:from-blue-950/50 dark:to-sky-950/50 border-blue-200 dark:border-blue-800"}`}>
          <DialogHeader className="sr-only">
            <DialogTitle>Bill Details</DialogTitle>
            <DialogDescription>View bill details, payment status, and payment method.</DialogDescription>
          </DialogHeader>
          {viewBillDetails && (
            <div className="space-y-3">
	              {(() => {
	                const displayAmounts = getBillDisplayAmounts(viewBillDetails);
	                const paidAmount = displayAmounts.paidAmount;
	                const dueAmount = displayAmounts.due;
	                const hasPaidAmount = paidAmount > 0;
	                const deliveryChargeAmount = displayAmounts.deliveryCharge;
	                const hasDeliveryCharge = deliveryChargeAmount > 0.009;
                const statusMeta = getBillStatusMeta(viewBillDetails, displayAmounts);
                const latestPaymentDate = getBillLatestPaymentDate(viewBillDetails.id);
                const billClientName = viewBillDetails.customerName || getClientName(viewBillDetails.clientId!);
                const accountLabel = getClientAccountLabel(viewBillDetails.clientId);
                const clientBillNumber = getClientById(viewBillDetails.clientId)?.billNumber?.trim();
                return (
            <>
              <div className={`relative overflow-hidden rounded-[22px] border shadow-[0_18px_40px_-32px_rgba(15,23,42,0.38)] ${statusMeta.mobileCardClass}`}>
                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${statusMeta.accentClass}`} />
                <div className={isMobile ? "p-3" : "p-4"}>
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${statusMeta.summaryClass}`}>
                      <Receipt className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="shrink-0 text-sm font-semibold text-foreground">Bill Details</p>
                            {viewBillDetails.referenceNumber && (
                              <span className="truncate rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-border/60">
                                Ref {viewBillDetails.referenceNumber}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                            <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                              Bill #{viewBillDetails.id}
                            </span>
                            <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                              {format(new Date(viewBillDetails.billDate), isMobile ? "dd MMM yyyy" : "MMM dd, yyyy")}
                            </span>
                            {clientBillNumber && (
                              <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                Acc {clientBillNumber}
                              </span>
                            )}
                            {viewBillDetails.createdBy && (
                              <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                By {viewBillDetails.createdBy}
                              </span>
                            )}
                            {renderPartialHistoryDatePill(statusMeta.historyDate)}
                            {latestPaymentDate && (
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                                Paid {formatBillCreatedDate(latestPaymentDate)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge className={`text-[10px] text-white shadow-sm ${statusMeta.badgeClass}`}>
                            {statusMeta.label}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className={`rounded-xl border border-border/50 bg-background/70 ${isMobile ? "p-3" : "p-4"}`}>
                <div className="min-w-0">
                  {viewBillDetails.clientId ? (
                    <button
                      type="button"
                      className={`${isMobile ? "truncate text-lg font-bold" : "text-xl font-bold"} text-left transition-colors hover:text-primary hover:underline`}
                      onClick={() => openClientTransactionHistory(viewBillDetails.clientId)}
                      data-testid={`button-open-bill-detail-client-history-${viewBillDetails.id}`}
                    >
                      {billClientName}
                      {accountLabel && (
                        <span className="ml-2 text-sm font-normal text-muted-foreground">({accountLabel})</span>
                      )}
                    </button>
                  ) : (
                    <p className={isMobile ? "truncate text-lg font-bold" : "text-xl font-bold"}>
                      {billClientName}
                      {accountLabel && (
                        <span className="ml-2 text-sm font-normal text-muted-foreground">({accountLabel})</span>
                      )}
                    </p>
                  )}
                </div>
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Bill #</span>
                    <span className="font-medium">#{viewBillDetails.id}</span>
                  </div>
                  {clientBillNumber && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Bill Number</span>
                      <span className="font-medium">{clientBillNumber}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Created On</span>
                    <span className="font-medium">{formatBillDateTime(viewBillDetails.billDate)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Paid On</span>
                    <span className={latestPaymentDate ? "font-medium text-green-600" : "text-muted-foreground"}>
                      {formatBillPaymentDate(latestPaymentDate)}
                    </span>
                  </div>
                </div>
                {(() => {
                  const client = getClientById(viewBillDetails.clientId);
                  if (!client) return null;
                  const isBroker = ((client as any).clientType || '').trim().toLowerCase() === 'broker';
                  const addressLines = getBillAddressLines(viewBillDetails, client);
                  return (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isBroker ? (
                          <Badge variant="secondary" className="text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border-violet-200 dark:border-violet-700">
                            Broker Account
                          </Badge>
                        ) : client.company ? (
                          <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-700">
                            Company: {client.company}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Regular Account
                          </Badge>
                        )}
                      </div>
                      {client.company && (
                        <div className="flex items-center gap-2 text-sm text-blue-600">
                          <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{client.company}</span>
                        </div>
                      )}
                      {client.phone && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{client.phone}</span>
                        </div>
                      )}
                      {addressLines.map((address, index) => (
                        <div key={`${viewBillDetails.id}-address-${index}`} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{address}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div className={`grid gap-3 ${viewBillDetails.isPaid || hasPaidAmount ? "grid-cols-3" : "grid-cols-2"}`}>
                <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                  <p className="text-xs text-muted-foreground">Work Received</p>
                  <p className="text-2xl font-bold text-primary">
                    {displayAmounts.originalAmount.toFixed(2)} <span className="text-sm">AED</span>
                  </p>
	                  {displayAmounts.discount > 0 && (
	                    <div className="mt-1">
	                      <p className="text-xs text-orange-600">Disc: -{displayAmounts.discount.toFixed(2)}</p>
	                    </div>
	                  )}
	                </div>
                <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="text-lg font-semibold">
                    {format(new Date(viewBillDetails.billDate), "dd MMM yyyy")}
                  </p>
                </div>
                {(viewBillDetails.isPaid || hasPaidAmount) && (
                  <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                    <p className="text-xs text-muted-foreground mb-1">Payment Method</p>
                    {(() => {
                      const editablePaymentMethod = getEditablePaymentMethodValue(viewBillDetails.paymentMethod);

                      if (!editablePaymentMethod) {
                        return (
                          <div className="flex min-h-9 items-center rounded-md border bg-background px-3 py-1 text-sm font-medium leading-5">
                            <span className="whitespace-normal break-words">
                              {formatPaymentMethodLabel(viewBillDetails.paymentMethod)}
                            </span>
                          </div>
                        );
                      }

                      return (
                        <Select
                          value={editablePaymentMethod}
                          onValueChange={(value) => {
                            updatePaymentMethodMutation.mutate({ billId: viewBillDetails.id, paymentMethod: value });
                            setViewBillDetails({ ...viewBillDetails, paymentMethod: value });
                          }}
                        >
                          <SelectTrigger className="h-9" data-testid="select-payment-method-bill">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="card">Card</SelectItem>
                            <SelectItem value="transfer">Bank Transfer</SelectItem>
                            {(viewBillClientDeposit > 0.01 || editablePaymentMethod === "deposit") && (
                              <SelectItem value="deposit">Account Credit</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      );
                    })()}
                  </div>
                )}
              </div>

		              <div className="rounded-xl border border-blue-200/70 bg-blue-50/70 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
		                <div className="flex items-center justify-between gap-3">
		                  <div className="min-w-0">
		                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">Delivery Charge</p>
		                    <p className="mt-0.5 text-sm text-muted-foreground">
		                      {hasDeliveryCharge ? "Included in final amount" : "No delivery charge applied"}
		                    </p>
		                  </div>
		                  <p className={`shrink-0 text-lg font-bold ${hasDeliveryCharge ? "text-blue-700 dark:text-blue-300" : "text-muted-foreground"}`}>
		                    {hasDeliveryCharge ? `${deliveryChargeAmount.toFixed(2)} AED` : "-"}
		                  </p>
		                </div>
		              </div>

	              <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/70 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
	                <div className="flex items-center justify-between gap-3">
	                  <div>
	                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Final Amount</p>
	                    <p className="mt-0.5 text-[11px] text-muted-foreground">
	                      Work received
	                      {displayAmounts.discount > 0 ? " - discount" : ""}
	                      {deliveryChargeAmount > 0.009 ? " + delivery charge" : ""}
	                    </p>
	                  </div>
	                  <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
	                    {displayAmounts.finalAmount.toFixed(2)} <span className="text-sm">AED</span>
	                  </p>
	                </div>
	              </div>

              {viewBillDetails.description && (
                <BillItemsPopover
                  items={parseDescriptionItems(viewBillDetails.description, products)}
                  rawDescription={viewBillDetails.description}
                  title={`Bill #${viewBillDetails.id} Items`}
                  subtitle={`${billClientName} • ${format(new Date(viewBillDetails.billDate), "dd MMM yyyy")}`}
                  dataTestId={`button-bill-items-popover-${viewBillDetails.id}`}
                  disablePortal
                />
              )}

              {(viewBillDetails as any).priceAdjustReason && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 rounded-lg">
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold mb-1">Price Adjustment</p>
                  {displayAmounts.originalAmount > 0 && (
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Original:</span>
                      <span className="line-through text-muted-foreground">{displayAmounts.originalAmount.toFixed(2)} AED</span>
                    </div>
                  )}
                  <div className="text-sm text-amber-700 dark:text-amber-400 italic">
                    {(viewBillDetails as any).priceAdjustReason}
                  </div>
                </div>
              )}

              {/* Payment breakdown for partial payments after item recount */}
              {!viewBillDetails.isPaid && hasPaidAmount && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 rounded-lg">
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold mb-2">Payment Breakdown</p>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Previously Paid:</span>
                      <span className="font-medium text-green-600">{paidAmount.toFixed(2)} AED</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">New Total:</span>
                      <span className="font-medium">{displayAmounts.finalAmount.toFixed(2)} AED</span>
                    </div>
                    <div className="flex justify-between border-t border-amber-200 dark:border-amber-700 pt-1 mt-1">
                      <span className="font-semibold text-amber-700 dark:text-amber-400">Amount Due:</span>
                      <span className="font-bold text-red-600">{dueAmount.toFixed(2)} AED</span>
                    </div>
                  </div>
                </div>
              )}

              {/* History notes if available */}
              {(viewBillDetails as any).notes && (
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
                  <p className="text-xs text-blue-700 dark:text-blue-400 font-semibold mb-2">History</p>
                  <div className="text-xs text-blue-600 dark:text-blue-300 whitespace-pre-wrap">
                    {(viewBillDetails as any).notes}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                {!viewBillDetails.isPaid && (
                  <Button
                    className="flex-1 bg-blue-600 hover:bg-blue-700"
                    onClick={() => {
                      handlePayNow(viewBillDetails);
                      setViewBillDetails(null);
                    }}
                    data-testid="button-pay-now-bill"
                  >
                    <DollarSign className="w-4 h-4 mr-2" />
                    Pay Now
                  </Button>
                )}
                {(viewBillDetails.isPaid || parseFloat(viewBillDetails.paidAmount || "0") > 0) && (
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => handleRevertPayment(viewBillDetails.id)}
                    data-testid="button-revert-payment-bill"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Revert Payment
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    openTransferBillDialog(viewBillDetails);
                    setViewBillDetails(null);
                  }}
                  data-testid="button-transfer-bill"
                >
                  {viewBillDetails.clientId ? "Transfer Account" : "Assign Account"}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    void printBillPDF(viewBillDetails);
                    setViewBillDetails(null);
                  }}
                  data-testid="button-print-bill"
                >
                  <Printer className="w-4 h-4 mr-2" />
                  Print
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    handleDelete(viewBillDetails.id);
                    setViewBillDetails(null);
                  }}
                  data-testid="button-delete-bill"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!transferBillDialog}
        onOpenChange={(open) => {
          if (!open && !transferBillMutation.isPending) {
            resetTransferBillDialog();
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {transferBillDialog?.clientId ? "Transfer Bill to Another Account" : "Assign Bill to Client Account"}
            </DialogTitle>
            <DialogDescription>
              Move this bill, its linked orders, payment records, and bill history to the correct client account.
            </DialogDescription>
          </DialogHeader>
          {transferBillDialog && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Bill</span>
                  <span className="font-semibold">
                    #{transferBillDialog.id}
                    {transferBillDialog.referenceNumber ? ` • ${transferBillDialog.referenceNumber}` : ""}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Current Account</span>
                  <span className="text-right font-medium">
                    {transferBillDialog.clientId
                      ? getClientById(transferBillDialog.clientId)?.billNumber
                        ? `${getClientName(transferBillDialog.clientId)} (${getClientById(transferBillDialog.clientId)?.billNumber})`
                        : getClientName(transferBillDialog.clientId)
                      : "Walk-in / Unassigned"}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="transfer-bill-client-search">Find Target Client</Label>
                <Input
                  id="transfer-bill-client-search"
                  value={transferBillSearch}
                  onChange={(e) => setTransferBillSearch(e.target.value)}
                  placeholder="Search by name, company, address, phone, or account number"
                  data-testid="input-transfer-bill-search"
                />
                <ScrollArea className="h-56 rounded-md border">
                  <div className="divide-y">
                    {transferTargetClients.length > 0 ? (
                      transferTargetClients.map((client) => {
                        const isSelected = Number(transferTargetClientId) === client.id;
                        return (
                          <button
                            key={client.id}
                            type="button"
                            className={`w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/50 ${isSelected ? "bg-primary/5" : ""}`}
                            onClick={() => setTransferTargetClientId(String(client.id))}
                            data-testid={`option-transfer-bill-client-${client.id}`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate font-medium">{client.name}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {[
                                    client.billNumber,
                                    client.phone,
                                    client.company,
                                    client.address,
                                  ]
                                    .filter(Boolean)
                                    .join(" • ") || "No extra account details"}
                                </p>
                              </div>
                              {isSelected && <Badge variant="secondary">Selected</Badge>}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                        No matching client accounts found.
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>

              {selectedTransferTargetClient && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                  <p className="font-medium">
                    Target: {selectedTransferTargetClient.name}
                    {selectedTransferTargetClient.billNumber
                      ? ` (${selectedTransferTargetClient.billNumber})`
                      : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      selectedTransferTargetClient.phone,
                      selectedTransferTargetClient.company,
                      selectedTransferTargetClient.address,
                    ]
                      .filter(Boolean)
                      .join(" • ") || "This account will receive the bill and linked order history."}
                  </p>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="transfer-bill-admin-pin">Admin PIN</Label>
                  <Input
                    id="transfer-bill-admin-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={5}
                    value={transferBillAdminPin}
                    onChange={(e) => setTransferBillAdminPin(e.target.value.replace(/\D/g, "").slice(0, 5))}
                    placeholder="Enter 5-digit PIN"
                    data-testid="input-transfer-bill-admin-pin"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transfer-bill-reason">Reason</Label>
                  <Input
                    id="transfer-bill-reason"
                    value={transferBillReason}
                    onChange={(e) => setTransferBillReason(e.target.value)}
                    placeholder="Optional note for audit history"
                    data-testid="input-transfer-bill-reason"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => resetTransferBillDialog()}
              disabled={transferBillMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => void handleTransferBillSubmit()}
              disabled={
                transferBillMutation.isPending ||
                !transferBillDialog ||
                !transferTargetClientId ||
                transferBillAdminPin.trim().length !== 5
              }
              data-testid="button-confirm-transfer-bill"
            >
              {transferBillMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Confirm Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteAdminDialog} onOpenChange={(open) => { if (!open) { setDeleteAdminDialog(false); setPendingDeleteBillId(null); setDeleteAdminPassword(""); setDeleteAdminError(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Admin Authorization Required</DialogTitle>
            <DialogDescription>Deleting this bill will also delete the linked order and its transaction history. If the bill was paid by credit, the credits will be restored. Enter admin PIN to confirm.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Admin PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={5}
                value={deleteAdminPassword}
                onChange={(e) => { setDeleteAdminPassword(e.target.value.replace(/\D/g, "").slice(0, 5)); setDeleteAdminError(""); }}
                placeholder="Enter 5-digit admin PIN"
                onKeyDown={(e) => { if (e.key === "Enter") handleAdminDeleteConfirm(); }}
                data-testid="input-admin-delete-password"
              />
              {deleteAdminError && <p className="text-xs text-destructive mt-1">{deleteAdminError}</p>}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setDeleteAdminDialog(false); setPendingDeleteBillId(null); setDeleteAdminPassword(""); setDeleteAdminError(""); }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleAdminDeleteConfirm} data-testid="button-confirm-admin-delete">
              Delete Bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revertPaymentDialog} onOpenChange={(open) => { if (!open) { setRevertPaymentDialog(false); setPendingRevertBillId(null); setPendingRevertBillIds(null); setRevertPaymentTargetLabel("this bill payment"); setRevertPaymentPin(""); setRevertPaymentError(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {(pendingRevertBillIds?.length || 0) > 1 ? "Revert Selected Payments" : "Revert Bill Payment"}
            </DialogTitle>
            <DialogDescription>
              This will reset {revertPaymentTargetLabel} to unpaid, remove payment records and transaction history. Enter the admin PIN to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Admin PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={5}
                value={revertPaymentPin}
                onChange={(e) => { setRevertPaymentPin(e.target.value.replace(/\D/g, "").slice(0, 5)); setRevertPaymentError(""); }}
                placeholder="Enter 5-digit admin PIN"
                onKeyDown={(e) => { if (e.key === "Enter") handleRevertPaymentConfirm(); }}
                data-testid="input-revert-payment-pin"
              />
              {revertPaymentError && <p className="text-xs text-destructive mt-1">{revertPaymentError}</p>}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setRevertPaymentDialog(false); setPendingRevertBillId(null); setPendingRevertBillIds(null); setRevertPaymentTargetLabel("this bill payment"); setRevertPaymentPin(""); setRevertPaymentError(""); }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRevertPaymentConfirm} data-testid="button-confirm-revert-payment">
              {(pendingRevertBillIds?.length || 0) > 1 ? "Revert Payments" : "Revert Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
