import { useState, useMemo, useEffect, useCallback, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { TopBar } from "@/components/TopBar";
import logoImage from "@/assets/images/lwl-logo.png";
import { useClients, useDeleteClient } from "@/hooks/use-clients";
import {
  Loader2,
  Users,
  Trash2,
  Edit,
  MessageCircle,
  Plus,
  History,
  Receipt,
  Wallet,
  Calendar,
  Search,
  Printer,
  Lock,
  Download,
  FileSpreadsheet,
  ShoppingBag,
  ExternalLink,
  Package,
  Eye,
  Check,
  X,
  Pencil,
  DollarSign,
  ArrowUpDown,
  Merge,
  Building2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  FolderOpen,
  Folder,
  UserPlus,
  UserMinus,
  User,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,

  
  DialogTitle,
} from "@/components/ui/dialog";
import { ClientForm } from "@/components/ClientForm";
import { AddressTextWithIcon, PhoneNumberWithFlag } from "@/components/PhoneFlag";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { extractApiErrorMessage, queryClient, apiRequest } from "@/lib/queryClient";
import {
  escapeHtml,
  formatCompanyAddressSingleLine,
  formatCompanyPhoneLine,
  useCompanyContactInfo,
} from "@/lib/companyContact";
import {
  format,
  isWithinInterval,
  parseISO,
  startOfDay,
  endOfDay,
} from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BillItemsPopover } from "@/components/BillItemsPopover";
import { Invoice } from "@/components/Invoice";
import type { Client, ClientTransaction, Bill, Order } from "@shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { exportToExcel as writeExcel } from "@/lib/excelExport";
import html2pdf from "html2pdf.js";
import { normalizePhoneForComparison } from "@shared/phone";

function formatClientBillPaymentMethodLabel(method?: string | null): string {
  const normalized = String(method || "").trim();
  if (!normalized) return "-";

  const parts = normalized
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    return parts.map((part) => formatClientBillPaymentMethodLabel(part)).join(" + ");
  }

  switch (normalized.toLowerCase()) {
    case "deposit":
      return "Credit";
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

function getEditableClientBillPaymentMethodValue(method?: string | null): string | null {
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

const CLIENT_HISTORY_EPSILON = 0.01;
const CLIENTS_INITIAL_LOAD_COUNT = 50;
const CLIENTS_LOAD_MORE_COUNT = 30;
const CLIENTS_LOAD_MORE_THRESHOLD_PX = 160;
const CLIENT_SEARCH_DEBOUNCE_MS = 250;
const CLIENT_ORDER_SUMMARY_QUERY_KEY = "/api/clients/order-summary";

type ClientSearchFieldKey = "accountNumber" | "nameAddress" | "mobileNumber" | "companyName";

type ClientSearchFilters = Record<ClientSearchFieldKey, string>;

const CLIENT_SEARCH_FIELD_KEYS: ClientSearchFieldKey[] = [
  "accountNumber",
  "nameAddress",
  "mobileNumber",
  "companyName",
];

const EMPTY_CLIENT_SEARCH_FILTERS: ClientSearchFilters = {
  accountNumber: "",
  nameAddress: "",
  mobileNumber: "",
  companyName: "",
};

function hasClientSearchFilters(filters: ClientSearchFilters): boolean {
  return CLIENT_SEARCH_FIELD_KEYS.some((key) => filters[key].trim().length > 0);
}

function normalizeClientSearchText(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeClientAccountNumber(value?: string | null): string {
  return normalizeClientSearchText(value)
    .replace(/^#/, "")
    .replace(/^account[-\s#]*/i, "")
    .replace(/^acc[-\s#]*/i, "");
}

function getClientFallbackAccountNumber(client: Pick<Client, "id">): string {
  return `ACC-${String(client.id).padStart(4, "0")}`;
}

function matchesClientAccountSearch(client: Client, value: string): boolean {
  const rawSearch = normalizeClientSearchText(value).replace(/^#/, "");
  if (!rawSearch) return true;

  const accountSearch = normalizeClientAccountNumber(rawSearch);
  const candidates = [client.billNumber || getClientFallbackAccountNumber(client)];

  return candidates.some((candidate) => {
    const rawCandidate = normalizeClientSearchText(candidate).replace(/^#/, "");
    const accountCandidate = normalizeClientAccountNumber(candidate);

    return (
      rawCandidate.includes(rawSearch) ||
      (!!accountSearch && accountCandidate.includes(accountSearch))
    );
  });
}

function matchesClientPhoneSearch(client: Client, value: string): boolean {
  const rawSearch = normalizeClientSearchText(value);
  if (!rawSearch) return true;

  const normalizedSearch = normalizePhoneForComparison(value);
  const rawPhone = normalizeClientSearchText(client.phone);
  const normalizedPhone = normalizePhoneForComparison(client.phone);

  return (
    rawPhone.includes(rawSearch) ||
    (!!normalizedSearch && normalizedPhone.includes(normalizedSearch))
  );
}

function matchesClientTextSearch(values: Array<string | null | undefined>, value: string): boolean {
  const search = normalizeClientSearchText(value);
  if (!search) return true;

  return values.some((candidate) => normalizeClientSearchText(candidate).includes(search));
}

function matchesClientSearchFilters(client: Client, filters: ClientSearchFilters): boolean {
  return (
    matchesClientAccountSearch(client, filters.accountNumber) &&
    matchesClientTextSearch([client.name, client.address], filters.nameAddress) &&
    matchesClientPhoneSearch(client, filters.mobileNumber) &&
    matchesClientTextSearch([client.company], filters.companyName)
  );
}

type ClientOrderTotals = {
  totalAmount: number;
  totalPaid: number;
  due: number;
  orderCount: number;
};

type ClientOrderSummaryResponse = {
  byClientId: Record<string, ClientOrderTotals>;
  totalAmount: number;
  totalPaid: number;
  totalDue: number;
  dueClientsCount: number;
};

const EMPTY_CLIENT_ORDER_TOTALS: ClientOrderTotals = {
  totalAmount: 0,
  totalPaid: 0,
  due: 0,
  orderCount: 0,
};

const invalidateClientOrderSummary = () => {
  void queryClient.invalidateQueries({
    queryKey: [CLIENT_ORDER_SUMMARY_QUERY_KEY],
  });
};

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

const extractHistoryOrderNumber = (value?: string | null) => {
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
};

function stripClientBillEmbeddedPriceText(name: string): string {
  return String(name || "")
    .replace(/\s*\(base\s*[\d.]+\s*AED\)/gi, "")
    .replace(/\s*@\s*[\d.]+\s*AED(?:\s*\((custom|min\s*50|admin\s*edited)\))?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseClientBillSqmDescriptionPart(
  part: string,
): { name: string; qty: number; price: number; total: number } | null {
  const trailingNoteMatch = part.match(/\s*\((custom|min\s*50|admin\s*edited)\)\s*$/i);
  const normalizedPart = trailingNoteMatch
    ? part.replace(/\s*\((custom|min\s*50|admin\s*edited)\)\s*$/i, "").trim()
    : part;

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

  let linePrice = Number.isFinite(embeddedPrice) ? embeddedPrice : NaN;
  if (!Number.isFinite(linePrice) && Number.isFinite(embeddedTotal)) {
    linePrice = embeddedTotal;
  }

  const baseName = /\(per\s*SQ\s*MTR\)/i.test(cleanName)
    ? cleanName
    : `${cleanName} (per SQ MTR)`;

  return {
    name: `${sqm} sqm ${baseName}`.trim(),
    qty,
    price: Number.isFinite(linePrice) ? linePrice : 0,
    total: Number.isFinite(linePrice) ? qty * linePrice : 0,
  };
}

function parseClientBillDescriptionItems(
  description: string,
): { name: string; qty: number; price: number; total: number }[] {
  if (!description) return [];

  const orderMatch = description.match(/Order #[A-Z0-9-]+:\s*/i);
  const itemsText = orderMatch ? description.replace(orderMatch[0], "") : description;

  return itemsText
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const sqmItem = parseClientBillSqmDescriptionPart(part);
      if (sqmItem) {
        return sqmItem;
      }

      const match = part.match(/^(\d+)x\s+(.+)$/i);
      if (!match) {
        return {
          name: stripClientBillEmbeddedPriceText(part),
          qty: 1,
          price: 0,
          total: 0,
        };
      }

      const qty = parseInt(match[1], 10);
      const name = match[2].trim();
      const cleanedName = stripClientBillEmbeddedPriceText(name);
      const embeddedPriceMatch =
        name.match(/@\s*([\d.]+)\s*AED/i) ||
        name.match(/\(base\s*([\d.]+)\s*AED\)/i);
      const price = embeddedPriceMatch ? parseFloat(embeddedPriceMatch[1]) : 0;

      return {
        name: cleanedName,
        qty,
        price,
        total: qty * price,
      };
    })
    .filter((item) => String(item.name || "").trim().length > 0);
}

const formatClientHistoryDescription = (transaction: ClientTransaction) => {
  const normalized = normalizeHistoryDescription(
    getSingleBillBulkHistoryDescription(transaction) || transaction.description,
  );
  const isDeduction =
    transaction.type === "deposit_used" || transaction.type === "bulk_deposit_used";

  if (!isDeduction) {
    return normalized;
  }

  const billId = transaction.billId ?? getSingleBillBulkHistoryBillId(transaction);
  const orderNumber =
    extractHistoryOrderNumber(transaction.description) || extractHistoryOrderNumber(normalized);

  if (billId && orderNumber) {
    return `Deposit used for Bill #${billId}: Order #${orderNumber}`;
  }

  if (billId) {
    return `Deposit used for Bill #${billId}`;
  }

  return normalized;
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
      displayDescription: formatClientHistoryDescription(transaction),
      bulkGroup: extractBulkHistoryGroup(transaction.description),
      splitGroup: extractSplitHistoryGroup(transaction.description),
    }));
};

export default function Clients() {
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const [clientSearchFilters, setClientSearchFilters] = useState<ClientSearchFilters>(EMPTY_CLIENT_SEARCH_FILTERS);
  const [debouncedClientSearchFilters, setDebouncedClientSearchFilters] =
    useState<ClientSearchFilters>(EMPTY_CLIENT_SEARCH_FILTERS);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [viewingClient, setViewingClient] = useState<Client | null>(null);
  const [transactionClient, setTransactionClient] = useState<Client | null>(
    null,
  );
  const [highlightedClientId, setHighlightedClientId] = useState<number | null>(null);
  const [billAmount, setBillAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositPaymentMethod, setDepositPaymentMethod] = useState("cash");
  const [deductionAmount, setDeductionAmount] = useState("");
  const [billDescription, setBillDescription] = useState("");
  const [depositDescription, setDepositDescription] = useState("");
  const [deductionDescription, setDeductionDescription] = useState("");
  const [filterFromDate, setFilterFromDate] = useState("");
  const [filterToDate, setFilterToDate] = useState("");
  const [filterType, setFilterType] = useState<"all" | "bill" | "deposit">(
    "all",
  );
  const [transactionDialogView, setTransactionDialogView] = useState<
    "unpaid" | "history"
  >("history");
  const [duePopoverOpen, setDuePopoverOpen] = useState(false);
  const [sortBy, setSortBy] = useState<"alphabetical" | "newest" | "oldest" | "high_unpaid" | "total_credits">("alphabetical");
  const [applyDiscountToSubtotal, setApplyDiscountToSubtotal] = useState(false);
  const [applyDiscountToFinalPrice, setApplyDiscountToFinalPrice] = useState(false);
  const [payingBillId, setPayingBillId] = useState<number | null>(null);
  const [billPaymentAmount, setBillPaymentAmount] = useState("");
  const [billPaymentMethod, setBillPaymentMethod] = useState("cash");
  const [showPayAllDialog, setShowPayAllDialog] = useState(false);
  const [payAllAmount, setPayAllAmount] = useState("");
  const [payAllMethod, setPayAllMethod] = useState("cash");
  const [showCashierPinDialog, setShowCashierPinDialog] = useState(false);
  const [cashierPin, setCashierPin] = useState("");
  const [cashierPinError, setCashierPinError] = useState("");
  const [pendingPinAction, setPendingPinAction] = useState<
    | { type: "cash_payment"; billId: number; amount: string }
    | { type: "cash_pay_all"; clientId: number; amount: string; paymentMethod: string; notes?: string }
    | {
        type: "add_credit";
        clientId: number;
        amount: string;
        description: string;
        paymentMethod: string;
      }
    | {
        type: "deduct_credit";
        clientId: number;
        amount: string;
        description: string;
      }
    | null
  >(null);
  const [editingTransaction, setEditingTransaction] = useState<ClientTransaction | null>(null);
  const [editTransactionAmount, setEditTransactionAmount] = useState("");
  const [editTransactionDescription, setEditTransactionDescription] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletePin, setDeletePin] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState<number | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [mergePassword, setMergePassword] = useState("");
  const [mergeError, setMergeError] = useState("");
  const [clientsTab, setClientsTab] = useState<"all" | "company" | "broker">("all");
  const [isMobileClientSearchOpen, setIsMobileClientSearchOpen] = useState(false);
  const [mobileCreditFormOpen, setMobileCreditFormOpen] = useState<"add" | "deduct" | null>(null);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [showAddCompanyDialog, setShowAddCompanyDialog] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [managingCompany, setManagingCompany] = useState<string | null>(null);
  const [manageCompanyName, setManageCompanyName] = useState("");
  const [manageCompanyAdminPin, setManageCompanyAdminPin] = useState("");
  const [manageCompanyRenameError, setManageCompanyRenameError] = useState("");
  const [addClientsSearch, setAddClientsSearch] = useState("");
  const [selectedClientsToAdd, setSelectedClientsToAdd] = useState<Set<number>>(new Set());
  const [mergeSourceSearch, setMergeSourceSearch] = useState("");
  const [mergeTargetSearch, setMergeTargetSearch] = useState("");
  const [mergeSourceOpen, setMergeSourceOpen] = useState(false);
  const [mergeTargetOpen, setMergeTargetOpen] = useState(false);
  const [invoiceData, setInvoiceData] = useState<{
    invoiceNumber: string;
    date: string;
    clientName: string;
    clientPhone?: string;
    clientAddress?: string;
    totalAmount: number;
    paidAmount: number;
    paymentMethod?: string;
  } | null>(null);
  const [combinedInvoiceData, setCombinedInvoiceData] = useState<{
    invoiceNumber: string;
    date: string;
    clientName: string;
    clientPhone?: string;
    clientAddress?: string;
    bills: Array<{
      billId: number;
      date: string;
      description: string;
      amount: number;
      paid: number;
      due: number;
      createdBy?: string;
    }>;
    totalDue: number;
  } | null>(null);
  const [billsPopoverOpen, setBillsPopoverOpen] = useState(false);
  const [creditsPopoverOpen, setCreditsPopoverOpen] = useState(false);
  const [visibleClientsCount, setVisibleClientsCount] = useState(CLIENTS_INITIAL_LOAD_COUNT);
  const clientListScrollRef = useRef<HTMLDivElement | null>(null);
  const clientsLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const clientSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchString = useSearch();

  const handleClientSearchChange = useCallback((field: ClientSearchFieldKey, value: string) => {
    setClientSearchFilters((current) => {
      const next = { ...current, [field]: value };

      if (clientSearchTimerRef.current) {
        clearTimeout(clientSearchTimerRef.current);
      }

      clientSearchTimerRef.current = setTimeout(() => {
        setDebouncedClientSearchFilters(next);
      }, CLIENT_SEARCH_DEBOUNCE_MS);

      return next;
    });
  }, []);

  const clearClientSearchFilters = useCallback(() => {
    if (clientSearchTimerRef.current) {
      clearTimeout(clientSearchTimerRef.current);
    }

    const next = { ...EMPTY_CLIENT_SEARCH_FILTERS };
    setClientSearchFilters(next);
    setDebouncedClientSearchFilters(next);
  }, []);

  useEffect(() => {
    return () => {
      if (clientSearchTimerRef.current) {
        clearTimeout(clientSearchTimerRef.current);
      }
    };
  }, []);

  const { data: clients, isLoading, isError } = useClients();
  const allClients = clients;
  const { mutate: deleteClient } = useDeleteClient();
  const { toast } = useToast();
  const { companyContact } = useCompanyContactInfo();
  const companyAddressLine = formatCompanyAddressSingleLine(companyContact);
  const companyPhoneLine = formatCompanyPhoneLine(companyContact);

  useEffect(() => {
    if (!allClients) return;
    const params = new URLSearchParams(searchString);
    const clientIdParam = params.get("clientId");
    const highlightClientParam = params.get("highlightClient");
    const modeParam = params.get("mode");
    if (clientIdParam) {
      const clientId = parseInt(clientIdParam);
      const client = allClients.find(c => c.id === clientId);
      if (client) {
        if (modeParam === "edit") {
          setEditingClient(client);
        } else if (modeParam === "transactions") {
          setTransactionClient(client);
        } else {
          setViewingClient(client);
        }
        navigate("/clients", { replace: true });
      }
    }
    if (highlightClientParam) {
      const clientId = parseInt(highlightClientParam);
      if (Number.isFinite(clientId)) {
        setClientsTab("all");
        setHighlightedClientId(clientId);
        navigate("/clients", { replace: true });
      }
    }
  }, [allClients, searchString]);

  useEffect(() => {
    if (!viewingClient || !allClients) return;
    const freshClient = allClients.find(c => c.id === viewingClient.id);
    if (freshClient && (freshClient.name !== viewingClient.name || freshClient.phone !== viewingClient.phone || freshClient.address !== viewingClient.address)) {
      setViewingClient(freshClient);
    }
  }, [allClients]);

  const { data: allOrders, isLoading: paidBillOrdersLoading } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
    enabled: billsPopoverOpen,
    staleTime: 30000,
  });

  const { data: allBills, isLoading: paidBillBillsLoading } = useQuery<Bill[]>({
    queryKey: ["/api/bills"],
    enabled: billsPopoverOpen,
    staleTime: 30000,
  });

  const { data: clientOrderSummary } = useQuery<ClientOrderSummaryResponse>({
    queryKey: [CLIENT_ORDER_SUMMARY_QUERY_KEY],
    staleTime: 10000,
    refetchOnMount: "always",
  });

  const { data: transactions } = useQuery<ClientTransaction[]>({
    queryKey: ["/api/clients", transactionClient?.id, "transactions"],
    enabled: !!transactionClient,
  });

  const { data: unpaidBills, isLoading: unpaidBillsLoading } = useQuery<Bill[]>({
    queryKey: ["/api/clients", transactionClient?.id, "unpaid-bills"],
    enabled: !!transactionClient,
  });

  const visibleTransactions = useMemo(
    () => buildVisibleClientHistoryTransactions(transactions),
    [transactions],
  );

  const availableCreditBalance = useMemo(() => {
    const creditBalance = visibleTransactions.reduce((sum, tx) => {
      if (tx.type === "deposit") return sum + parseFloat(tx.amount || "0");
      if (isAccountCreditDeductionType(tx.type)) {
        return sum - parseFloat(tx.amount || "0");
      }
      return sum;
    }, 0);

    return Math.max(0, creditBalance);
  }, [visibleTransactions]);

  const canUseClientCredit = availableCreditBalance > 0.01;

  const getCreditTransactionTypeDisplay = (tx: ClientTransaction) => {
    const singleBillBulkHistoryBillId = getSingleBillBulkHistoryBillId(tx);

    if (tx.type === "deposit") {
      return { label: "Add Credit to Account", color: "bg-green-100 text-green-700" };
    }
    if (tx.type === "deposit_used") {
      return { label: "Paid with Credit", color: "bg-orange-100 text-orange-700" };
    }
    if (tx.type === "deposit_deduction") {
      return { label: "Deduct Credit from Account", color: "bg-rose-100 text-rose-700" };
    }
    if (tx.type === "payment_reverted") {
      return { label: "Payment Reverted", color: "bg-rose-100 text-rose-700" };
    }
    if (tx.type === "bill") {
      return { label: "Bill", color: "bg-blue-100 text-blue-700" };
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
            return { label: "Paid with Credit", color: "bg-orange-100 text-orange-700" };
          default:
            return {
              label: `Paid in ${formatClientBillPaymentMethodLabel(method)}`,
              color: "bg-gray-100 text-gray-700",
            };
        }
      }

      const method = formatClientBillPaymentMethodLabel(tx.paymentMethod || "cash");
      return { label: `Bulk Payment (${method})`, color: "bg-amber-100 text-amber-700" };
    }
    if (tx.type === "bulk_deposit_used") {
      if (singleBillBulkHistoryBillId) {
        return { label: "Paid with Credit", color: "bg-orange-100 text-orange-700" };
      }
      return { label: "Bulk Payment (Credit)", color: "bg-orange-100 text-orange-700" };
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
          return { label: "Paid with Credit", color: "bg-orange-100 text-orange-700" };
        default:
          return { label: `Paid in ${formatClientBillPaymentMethodLabel(method)}`, color: "bg-gray-100 text-gray-700" };
      }
    }

    return { label: tx.type, color: "bg-gray-100 text-gray-700" };
  };

  const transactionHistoryRows = useMemo(() => {
    if (visibleTransactions.length === 0) return [];

    let creditBalance = 0;

    return visibleTransactions.map((tx) => {
      if (tx.type === "deposit") {
        creditBalance += parseFloat(tx.amount);
      } else if (isAccountCreditDeductionType(tx.type)) {
        creditBalance -= parseFloat(tx.amount);
      }

      return {
        tx,
        creditBalance,
        typeDisplay: getCreditTransactionTypeDisplay(tx),
      };
    });
  }, [visibleTransactions]);

  const unpaidBillRows = useMemo(
    () =>
      (unpaidBills || []).map((bill) => ({
        bill,
        totalAmount: parseFloat(bill.amount || "0"),
        paidAmount: parseFloat(bill.paidAmount || "0"),
        remainingAmount:
          parseFloat(bill.amount || "0") - parseFloat(bill.paidAmount || "0"),
        parsedItems: parseClientBillDescriptionItems(bill.description || ""),
      })),
    [unpaidBills],
  );

  const unpaidBillsCount = unpaidBills?.length ?? 0;
  const hasUnpaidBills = unpaidBillsCount > 0;

  useEffect(() => {
    if (billPaymentMethod === "deposit" && !canUseClientCredit) {
      setBillPaymentMethod("cash");
    }
  }, [billPaymentMethod, canUseClientCredit]);

  useEffect(() => {
    if (!transactionClient) {
      setTransactionDialogView("history");
      setPayingBillId(null);
      setBillPaymentAmount("");
      setBillPaymentMethod("cash");
      setMobileCreditFormOpen(null);
      return;
    }

    setTransactionDialogView("history");
    setMobileCreditFormOpen(null);
  }, [transactionClient?.id]);

  useEffect(() => {
    if (!hasUnpaidBills) {
      setPayingBillId(null);
      setBillPaymentAmount("");
      setBillPaymentMethod("cash");
    }
  }, [hasUnpaidBills]);

  useEffect(() => {
    if (payAllMethod === "deposit" && !canUseClientCredit) {
      setPayAllMethod("cash");
    }
  }, [payAllMethod, canUseClientCredit]);

  const { data: clientOrders, isLoading: clientOrdersLoading } = useQuery<Order[]>({
    queryKey: ["/api/clients", viewingClient?.id, "orders"],
    enabled: !!viewingClient,
  });

  // Transactions for the viewing client popup
  const { data: viewingClientTransactions } = useQuery<ClientTransaction[]>({
    queryKey: ["/api/clients", viewingClient?.id, "transactions"],
    enabled: !!viewingClient,
  });

  const visibleViewingClientTransactions = useMemo(
    () => buildVisibleClientHistoryTransactions(viewingClientTransactions),
    [viewingClientTransactions],
  );

  // All bills for the viewing client popup
  const { data: viewingClientBills } = useQuery<Bill[]>({
    queryKey: ["/api/clients", viewingClient?.id, "bills"],
    enabled: !!viewingClient,
  });

  const { data: companiesList } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/companies"],
  });

  useEffect(() => {
    if (!managingCompany) {
      setManageCompanyName("");
      setManageCompanyAdminPin("");
      setManageCompanyRenameError("");
      return;
    }

    setManageCompanyName(managingCompany);
    setManageCompanyAdminPin("");
    setManageCompanyRenameError("");
  }, [managingCompany]);

  const createCompanyMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/companies", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setShowAddCompanyDialog(false);
      setNewCompanyName("");
      toast({ title: "Company created successfully" });
    },
    onError: (err: any) => {
      toast({ title: err.message || "Failed to create company", variant: "destructive" });
    },
  });

  const renameCompanyMutation = useMutation({
    mutationFn: async ({
      oldName,
      newName,
      adminPin,
    }: {
      oldName: string;
      newName: string;
      adminPin: string;
    }) => {
      const res = await apiRequest("POST", "/api/companies/rename", {
        oldName,
        newName,
        adminPin,
      });
      return res.json() as Promise<{
        companyName?: string;
        message?: string;
        affectedClients?: number;
      }>;
    },
    onSuccess: (data, variables) => {
      const renamedCompany = String(data.companyName || variables.newName || "")
        .trim()
        .toUpperCase();
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setManagingCompany(renamedCompany);
      setManageCompanyName(renamedCompany);
      setManageCompanyAdminPin("");
      setManageCompanyRenameError("");
      setExpandedCompanies((current) => {
        const next = new Set(current);
        if (next.has(variables.oldName)) {
          next.delete(variables.oldName);
          next.add(renamedCompany);
        }
        return next;
      });
      toast({
        title: data.message || "Company renamed",
        description: `${data.affectedClients ?? 0} client${data.affectedClients === 1 ? "" : "s"} updated`,
      });
    },
    onError: (error: unknown) => {
      const message = extractApiErrorMessage(error, "Failed to rename company");
      setManageCompanyRenameError(message);
      toast({ title: message, variant: "destructive" });
    },
  });

  const updateClientCompanyMutation = useMutation({
    mutationFn: async ({ clientId, company }: { clientId: number; company: string }) => {
      const res = await apiRequest("PUT", `/api/clients/${clientId}`, { company: company.trim().toUpperCase() });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
    },
    onError: (err: any) => {
      toast({ title: err.message || "Failed to update client company", variant: "destructive" });
    },
  });

  const assignClientsToCompanyMutation = useMutation({
    mutationFn: async ({ clientIds, company }: { clientIds: number[]; company: string }) => {
      const normalizedCompany = company.trim().toUpperCase();
      await Promise.all(clientIds.map(id =>
        apiRequest("PUT", `/api/clients/${id}`, { company: normalizedCompany })
      ));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setManagingCompany(null);
      setSelectedClientsToAdd(new Set());
      setAddClientsSearch("");
      toast({ title: "Clients assigned to company" });
    },
    onError: (err: any) => {
      toast({ title: err.message || "Failed to assign clients", variant: "destructive" });
    },
  });

  const disperseCompanyMutation = useMutation({
    mutationFn: async ({ id }: { id: number; companyName: string }) => {
      const res = await apiRequest("POST", `/api/companies/${id}/disperse`, {});
      return res.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setManagingCompany((current) =>
        current && current.toUpperCase() === variables.companyName.toUpperCase() ? null : current,
      );
      setSelectedClientsToAdd(new Set());
      setAddClientsSearch("");
      toast({ title: data.message || `${variables.companyName} dispersed successfully` });
    },
    onError: (err: any) => {
      toast({ title: err.message || "Failed to disperse company", variant: "destructive" });
    },
  });

  const handleDisperseCompany = (companyName: string) => {
    const companyRecord = (companiesList || []).find(
      (company) => company.name.toUpperCase() === companyName.toUpperCase(),
    );

    if (!companyRecord) {
      toast({ title: `Company ${companyName} not found`, variant: "destructive" });
      return;
    }

    const confirmed = window.confirm(
      `Disperse ${companyName}? Clients will be kept, but their company will be cleared.`,
    );
    if (!confirmed) {
      return;
    }

    disperseCompanyMutation.mutate({ id: companyRecord.id, companyName });
  };

  const payBillMutation = useMutation({
    mutationFn: async ({
      billId,
      amount,
      paymentMethod,
      processedBy,
    }: {
      billId: number;
      amount: string;
      paymentMethod: string;
      processedBy?: string;
    }) => {
      return apiRequest("POST", `/api/bills/${billId}/pay`, {
        amount,
        paymentMethod,
        processedBy,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      invalidateClientOrderSummary();
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", transactionClient?.id, "transactions"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", transactionClient?.id, "unpaid-bills"],
      });
      setPayingBillId(null);
      setBillPaymentAmount("");
      setBillPaymentMethod("cash");
      setPendingPinAction(null);
      toast({
        title: "Payment recorded",
        description: "Bill payment has been recorded successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Payment failed",
        description: error.message || "Failed to record payment",
        variant: "destructive",
      });
    },
  });

  const payAllBillsMutation = useMutation({
    mutationFn: async ({
      clientId,
      amount,
      paymentMethod,
      notes,
      processedBy,
    }: {
      clientId: number;
      amount: string;
      paymentMethod: string;
      notes?: string;
      processedBy?: string;
    }) => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/pay-all-bills`, {
        amount,
        paymentMethod,
        notes,
        processedBy,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      invalidateClientOrderSummary();
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", transactionClient?.id, "transactions"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", transactionClient?.id, "unpaid-bills"],
      });
      setShowPayAllDialog(false);
      setPayAllAmount("");
      setPayAllMethod("cash");
      toast({
        title: "Payment recorded",
        description: data.message || "All bills have been paid successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Payment failed",
        description: error.message || "Failed to record payment",
        variant: "destructive",
      });
    },
  });

  const verifyCashierPinMutation = useMutation({
    mutationFn: async (pin: string) => {
      const res = await apiRequest("POST", "/api/workers/verify-pin", { pin });
      return res.json();
    },
    onSuccess: (data) => {
      if (!data.success || !pendingPinAction) return;

      const processedBy = data.worker?.name || "Staff";

      if (pendingPinAction.type === "cash_payment") {
        payBillMutation.mutate({
          billId: pendingPinAction.billId,
          amount: pendingPinAction.amount,
          paymentMethod: "cash",
          processedBy,
        });
      } else if (pendingPinAction.type === "cash_pay_all") {
        payAllBillsMutation.mutate({
          clientId: pendingPinAction.clientId,
          amount: pendingPinAction.amount,
          paymentMethod: pendingPinAction.paymentMethod,
          notes: pendingPinAction.notes,
          processedBy,
        });
      } else if (pendingPinAction.type === "add_credit") {
        addDepositMutation.mutate({
          clientId: pendingPinAction.clientId,
          amount: pendingPinAction.amount,
          description: pendingPinAction.description,
          paymentMethod: pendingPinAction.paymentMethod,
          processedBy,
          processorPin: cashierPin,
        });
      } else if (pendingPinAction.type === "deduct_credit") {
        deductDepositMutation.mutate({
          clientId: pendingPinAction.clientId,
          amount: pendingPinAction.amount,
          description: pendingPinAction.description,
          processedBy,
          processorPin: cashierPin,
        });
      }

      setShowCashierPinDialog(false);
      setCashierPin("");
      setCashierPinError("");
      setPendingPinAction(null);
    },
    onError: () => {
      setCashierPinError("Invalid PIN. Please try again.");
    },
  });

  const handlePayBill = (billId: number, amount: string, method: string) => {
    if (method === "cash") {
      setPendingPinAction({ type: "cash_payment", billId, amount });
      setShowCashierPinDialog(true);
      setCashierPin("");
      setCashierPinError("");
    } else {
      payBillMutation.mutate({ billId, amount, paymentMethod: method });
    }
  };

  const resetTransactionDialogState = () => {
    setTransactionDialogView("history");
    setPayingBillId(null);
    setBillPaymentAmount("");
    setBillPaymentMethod("cash");
    setDepositAmount("");
    setDepositDescription("");
    setDepositPaymentMethod("cash");
    setDeductionAmount("");
    setDeductionDescription("");
    setMobileCreditFormOpen(null);
  };

  const closeTransactionDialog = () => {
    resetTransactionDialogState();
    setTransactionClient(null);
  };

  const getBillsHighlightHref = useCallback(
    (billId: number) => `/bills?tab=bills&highlightBill=${billId}&billId=${billId}`,
    [],
  );

  const getBillsPayClientHref = useCallback(
    (clientId: number) => `/bills?payClient=${clientId}`,
    [],
  );

  const handleTransactionDialogViewChange = (view: "unpaid" | "history") => {
    setTransactionDialogView(view);

    if (view !== "unpaid") {
      setPayingBillId(null);
      setBillPaymentAmount("");
      setBillPaymentMethod("cash");
    }
  };

  const handleCashierPinSubmit = () => {
    if (cashierPin.length !== 5) {
      setCashierPinError("PIN must be 5 digits");
      return;
    }
    verifyCashierPinMutation.mutate(cashierPin);
  };

  const filteredTransactions = useMemo(() => {
    if (visibleTransactions.length === 0) return [];

    return visibleTransactions.filter((tx) => {
      if (filterType !== "all" && tx.type !== filterType) return false;

      if (filterFromDate || filterToDate) {
        const txDate = new Date(tx.date);
        if (filterFromDate && txDate < startOfDay(new Date(filterFromDate)))
          return false;
        if (filterToDate && txDate > endOfDay(new Date(filterToDate)))
          return false;
      }

      return true;
    });
  }, [visibleTransactions, filterFromDate, filterToDate, filterType]);

  const filteredTotals = useMemo(() => {
    const bills = filteredTransactions
      .filter((tx) => tx.type === "bill")
      .reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
    const deposits = filteredTransactions
      .filter((tx) => tx.type === "deposit")
      .reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
    return { bills, deposits, due: bills - deposits };
  }, [filteredTransactions]);

  const addBillMutation = useMutation({
    mutationFn: async ({
      clientId,
      amount,
      description,
    }: {
      clientId: number;
      amount: string;
      description: string;
    }) => {
      return apiRequest("POST", `/api/clients/${clientId}/bill`, {
        amount,
        description,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", transactionClient?.id, "transactions"],
      });
      setBillAmount("");
      setBillDescription("");
      toast({
        title: "Bill added",
        description: "Amount added to client's total.",
      });
    },
  });

  const addDepositMutation = useMutation({
    mutationFn: async ({
      clientId,
      amount,
      description,
      paymentMethod,
      processedBy,
      processorPin,
    }: {
      clientId: number;
      amount: string;
      description: string;
      paymentMethod: string;
      processedBy?: string;
      processorPin?: string;
    }) => {
      return apiRequest("POST", `/api/clients/${clientId}/deposit`, {
        amount,
        description,
        paymentMethod,
        processedBy,
        processorPin,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      invalidateClientOrderSummary();
      queryClient.invalidateQueries({ queryKey: ["/api/reports/credit-transactions"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", transactionClient?.id, "transactions"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", viewingClient?.id, "transactions"],
      });

      if (transactionClient) {
        const newDepositAmount = parseFloat(depositAmount);
        const totalBillAmount = parseFloat(transactionClient.amount || "0");
        const previousDeposits = parseFloat(transactionClient.deposit || "0");
        const totalPaidToDate = previousDeposits + newDepositAmount;

        setInvoiceData({
          invoiceNumber: `REC-${Date.now().toString().slice(-8)}`,
          date: new Date().toISOString(),
          clientName: transactionClient.name,
          clientPhone: transactionClient.phone || undefined,
          clientAddress: transactionClient.address || undefined,
          totalAmount: totalBillAmount,
          paidAmount: totalPaidToDate,
          paymentMethod: "Cash",
        });
      }

      setDepositAmount("");
      setDepositDescription("");
      toast({
        title: "Deposit added",
        description:
          "Deposit recorded successfully. Receipt is ready to print.",
      });
    },
  });

  const deductDepositMutation = useMutation({
    mutationFn: async ({
      clientId,
      amount,
      description,
      processedBy,
      processorPin,
    }: {
      clientId: number;
      amount: string;
      description: string;
      processedBy?: string;
      processorPin?: string;
    }) => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/deposit-deduction`, {
        amount,
        description,
        processedBy,
        processorPin,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/credit-transactions"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", transactionClient?.id, "transactions"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", viewingClient?.id, "transactions"],
      });
      setDeductionAmount("");
      setDeductionDescription("");
      toast({
        title: "Credit deducted",
        description: "Account credit deduction was recorded successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Credit deduction failed",
        description: error.message || "Failed to deduct account credit.",
        variant: "destructive",
      });
    },
  });

  const deleteTransactionMutation = useMutation({
    mutationFn: async (transactionId: number) => {
      return apiRequest("DELETE", `/api/transactions/${transactionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      invalidateClientOrderSummary();
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", viewingClient?.id, "transactions"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", viewingClient?.id, "orders"],
      });
      toast({
        title: "Transaction deleted",
        description: "Transaction has been removed and balance updated.",
      });
    },
  });

  const deleteClientOrdersMutation = useMutation({
    mutationFn: async (clientId: number) => {
      return apiRequest("DELETE", `/api/clients/${clientId}/orders`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      invalidateClientOrderSummary();
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", viewingClient?.id, "orders"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", viewingClient?.id, "transactions"],
      });
      toast({
        title: "Orders deleted",
        description: "All order history for this client has been removed.",
      });
    },
  });

  const updateTransactionMutation = useMutation({
    mutationFn: async ({
      transactionId,
      amount,
      description,
    }: {
      transactionId: number;
      amount: string;
      description: string;
    }) => {
      return apiRequest("PATCH", `/api/transactions/${transactionId}`, {
        amount,
        description,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", viewingClient?.id, "transactions"],
      });
      setEditingTransaction(null);
      setEditTransactionAmount("");
      setEditTransactionDescription("");
      toast({
        title: "Transaction updated",
        description: "Transaction has been updated and balance recalculated.",
      });
    },
  });

  const mergeClientsMutation = useMutation({
    mutationFn: async ({ sourceClientId, targetClientId, adminPassword }: { sourceClientId: number; targetClientId: number; adminPassword: string }) => {
      console.log('[MERGE] Starting mutation with:', { sourceClientId, targetClientId });
      try {
        const res = await fetch("/api/clients/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceClientId, targetClientId, adminPassword }),
          credentials: "include",
        });
        console.log('[MERGE] Response received:', res.status, res.statusText);
        
        const responseText = await res.text();
        console.log('[MERGE] Response body (first 500 chars):', responseText.substring(0, 500));
        
        if (!res.ok) {
          console.error('[MERGE] Error response:', responseText);
          throw new Error(responseText || "Failed to merge clients");
        }
        
        const data = JSON.parse(responseText);
        console.log('[MERGE] Data parsed:', data);
        return data;
      } catch (error) {
        console.error('[MERGE] Error in mutationFn:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      invalidateClientOrderSummary();
      setShowMergeDialog(false);
      setMergeSourceId(null);
      setMergeTargetId(null);
      setMergePassword("");
      setMergeError("");
      toast({
        title: "Clients merged",
        description: "Client accounts have been successfully merged.",
      });
    },
    onError: (error: Error) => {
      let message = "Failed to merge clients";
      try {
        const errorMsg = String(error.message || "");
        const msgMatch = errorMsg.match(/"message"\s*:\s*"([^"]+)"/);
        if (msgMatch) message = msgMatch[1];
      } catch {}
      setMergeError(message);
    },
  });

  const deleteClientWithPinMutation = useMutation({
    mutationFn: async ({ clientId, adminPin }: { clientId: number; adminPin: string }) => {
      return apiRequest("POST", `/api/clients/${clientId}/delete-with-password`, { adminPin });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      invalidateClientOrderSummary();
      const clientName = clientToDelete?.name || "";
      setShowDeleteDialog(false);
      setDeletePin("");
      setDeleteError("");
      setClientToDelete(null);
      if (viewingClient && viewingClient.id === clientToDelete?.id) {
        setViewingClient(null);
      }
      toast({
        title: "Client deleted",
        description: `${clientName} has been removed.`,
      });
    },
    onError: (error: Error) => {
      let message = "Failed to delete client";
      try {
        const errorMsg = String(error.message || "");
        const msgMatch = errorMsg.match(/"message"\s*:\s*"([^"]+)"/);
        if (msgMatch) message = msgMatch[1];
      } catch {}
      setDeleteError(message);
    },
  });

  const updateBillPaymentMethodMutation = useMutation({
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
      invalidateClientOrderSummary();
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

  const handleDeleteTransaction = (tx: ClientTransaction) => {
    if (confirm(`Are you sure you want to delete this ${tx.type} of ${parseFloat(tx.amount).toFixed(2)} AED?`)) {
      deleteTransactionMutation.mutate(tx.id);
    }
  };

  const handleEditTransaction = (tx: ClientTransaction) => {
    setEditingTransaction(tx);
    setEditTransactionAmount(tx.amount);
    setEditTransactionDescription(tx.description || "");
  };

  const handleSaveTransaction = () => {
    if (editingTransaction && editTransactionAmount) {
      updateTransactionMutation.mutate({
        transactionId: editingTransaction.id,
        amount: editTransactionAmount,
        description: editTransactionDescription,
      });
    }
  };

  const handleDelete = (client: Client) => {
    setClientToDelete(client);
    setDeletePin("");
    setDeleteError("");
    setShowDeleteDialog(true);
  };


  const downloadClientPDF = async (client: Client) => {
    const totalBill = getClientTotalBills(client);
    const totalDeposit = getClientTotalDeposits(client);
    const balance = getClientBalanceDue(client);

    // Fetch all transactions and bills for this client
    let transactionRows = "";
    let paidBillsRows = "";
    let depositsRows = "";
    try {
      // Fetch both transactions and bills
      const [txRes, billsRes] = await Promise.all([
        fetch(`/api/clients/${client.id}/transactions`),
        fetch(`/api/clients/${client.id}/bills`)
      ]);
      
      const clientTransactions: ClientTransaction[] = txRes.ok ? await txRes.json() : [];
      const clientBills: Bill[] = billsRes.ok ? await billsRes.json() : [];
      const visibleClientTransactions = buildVisibleClientHistoryTransactions(clientTransactions);
      
      // Create unified entries: bills as "bill" type, transactions as their type
      interface UnifiedEntry {
        date: string;
        type: "bill" | "deposit" | "payment";
        amount: string;
        description: string;
        isPaid?: boolean;
        referenceNumber?: string;
        billId?: number;
      }
      
      const unifiedEntries: UnifiedEntry[] = [];
      
      // Add bills as entries
      clientBills.forEach(bill => {
        const billDate = bill.billDate ? (typeof bill.billDate === 'string' ? bill.billDate : bill.billDate.toISOString()) : new Date().toISOString();
        unifiedEntries.push({
          date: billDate,
          type: "bill",
          amount: bill.amount || "0",
          description: `Bill #${bill.id}: Order #${bill.referenceNumber || "N/A"}`,
          isPaid: bill.isPaid ?? false,
          referenceNumber: bill.referenceNumber ?? undefined,
          billId: bill.id
        });
      });
      
      // Add transactions (deposits and payments only - skip bill type since we're adding bills directly)
      visibleClientTransactions.forEach(tx => {
        if (tx.type !== "bill") {
          const txDate = typeof tx.date === 'string' ? tx.date : tx.date.toISOString();
          unifiedEntries.push({
            date: txDate,
            type: tx.type === "deposit" ? "deposit" : "payment",
            amount: tx.amount,
            description: tx.displayDescription || ""
          });
        }
      });
      
      // Sort by date
      unifiedEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      if (unifiedEntries.length > 0) {
        let cumulativeBills = 0;
        let cumulativePayments = 0;
        
        transactionRows = unifiedEntries
          .map((entry, idx) => {
            // Balance represents what client owes: bills add, deposits/payments subtract
            if (entry.type === "bill") {
              cumulativeBills += parseFloat(entry.amount);
            } else {
              cumulativePayments += parseFloat(entry.amount);
            }
            // Running balance = cumulative bills - cumulative payments
            const runningBalance = cumulativeBills - cumulativePayments;
            
            // Format description
            let simpleDesc = entry.description;
            if (entry.type === "bill") {
              const paidStatus = entry.isPaid ? " (Paid)" : " (Unpaid)";
              simpleDesc = `Bill #${entry.billId}: Order #${entry.referenceNumber || "N/A"}${paidStatus}`;
            } else {
              const cleanDescription = normalizeHistoryDescription(entry.description);
              const billMatch = cleanDescription.match(/Bill #(\d+)/);
              const orderMatch = cleanDescription.match(/Order #(ORD-\d+)/);
              if (billMatch && orderMatch) {
                if (cleanDescription.toLowerCase().includes("deposit used")) {
                  simpleDesc = `Deposit used for Bill #${billMatch[1]}: Order #${orderMatch[1]}`;
                } else {
                  simpleDesc = `Payment for Bill #${billMatch[1]}: Order #${orderMatch[1]}`;
                }
              } else if (cleanDescription.toLowerCase().includes("deposit received")) {
                simpleDesc = "Deposit received";
              } else if (cleanDescription.length > 50) {
                simpleDesc = cleanDescription.substring(0, 50) + "...";
              } else {
                simpleDesc = cleanDescription;
              }
            }
            
            const typeLabel = entry.type === "bill" ? "Bill" : entry.type === "deposit" ? "Deposit" : "Payment";
            const typeColor = entry.type === "deposit" || entry.type === "payment" ? "#4caf50" : "#2196f3";
            const amountColor = entry.type === "deposit" || entry.type === "payment" ? "#4caf50" : "#2196f3";
            // Positive balance = client owes (red), zero or negative = client has credit (green)
            const balanceColor = runningBalance > 0 ? "#f44336" : "#4caf50";
            
            return `
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 8px; text-align: center;">${idx + 1}</td>
                <td style="padding: 8px;">${format(new Date(entry.date), "dd/MM/yyyy")}</td>
                <td style="padding: 8px;">${format(new Date(entry.date), "HH:mm")}</td>
                <td style="padding: 8px; font-weight: 500; color: ${typeColor};">${typeLabel}</td>
                <td style="padding: 8px;">${simpleDesc}</td>
                <td style="padding: 8px; text-align: right; color: ${amountColor};">${entry.type === "deposit" ? "+" : ""}${parseFloat(entry.amount).toFixed(2)} AED</td>
                <td style="padding: 8px; text-align: right; font-weight: 500; color: ${balanceColor};">${runningBalance.toFixed(2)} AED</td>
              </tr>
            `;
          })
          .join("");
      }
      
      // Build paid bills rows for PDF
      const paidBills = clientBills.filter(b => b.isPaid);
      if (paidBills.length > 0) {
        const totalPaidAmount = paidBills.reduce((sum, b) => sum + parseFloat(b.amount || "0"), 0);
        const totalPaidPaid = paidBills.reduce((sum, b) => sum + parseFloat(b.paidAmount || "0"), 0);
        paidBillsRows = paidBills.map((bill, idx) => `
          <tr style="border-bottom: 1px solid #eee;${idx % 2 === 1 ? ' background: #f9f9f9;' : ''}">
            <td style="padding: 8px; font-weight: 500;">#${bill.id}</td>
            <td style="padding: 8px;">${format(new Date(bill.billDate), "dd/MM/yyyy")}</td>
            <td style="padding: 8px; font-size: 11px;">${(bill.description || "-").substring(0, 50)}${(bill.description || "").length > 50 ? "..." : ""}</td>
            <td style="padding: 8px;"><span style="background: #e8f5e9; color: #2e7d32; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${formatClientBillPaymentMethodLabel(bill.paymentMethod || "cash")}</span></td>
            <td style="padding: 8px; text-align: right;">${parseFloat(bill.amount || "0").toFixed(2)} AED</td>
            <td style="padding: 8px; text-align: right; color: #4caf50; font-weight: 500;">${parseFloat(bill.paidAmount || "0").toFixed(2)} AED</td>
          </tr>
        `).join("") + `
          <tr style="background: #e8f5e9; font-weight: bold;">
            <td colspan="4" style="padding: 8px; text-align: right;">Total:</td>
            <td style="padding: 8px; text-align: right;">${totalPaidAmount.toFixed(2)} AED</td>
            <td style="padding: 8px; text-align: right; color: #4caf50;">${totalPaidPaid.toFixed(2)} AED</td>
          </tr>
        `;
      }
      
      // Build deposits rows for PDF
      const depositTxs = clientTransactions.filter(tx => tx.type === "deposit");
      if (depositTxs.length > 0) {
        const totalDepositAmount = depositTxs.reduce((sum, tx) => sum + parseFloat(tx.amount || "0"), 0);
        depositsRows = depositTxs.map((tx, idx) => `
          <tr style="border-bottom: 1px solid #eee;${idx % 2 === 1 ? ' background: #f9f9f9;' : ''}">
            <td style="padding: 8px; text-align: center;">${idx + 1}</td>
            <td style="padding: 8px;">${format(new Date(tx.date), "dd/MM/yyyy HH:mm")}</td>
            <td style="padding: 8px; font-size: 11px;">${tx.description || "Deposit received"}</td>
            <td style="padding: 8px;"><span style="background: #e8f5e9; color: #2e7d32; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${formatClientBillPaymentMethodLabel(tx.paymentMethod || "cash")}</span></td>
            <td style="padding: 8px; text-align: right; color: #4caf50; font-weight: 500;">+${parseFloat(tx.amount || "0").toFixed(2)} AED</td>
          </tr>
        `).join("") + `
          <tr style="background: #e8f5e9; font-weight: bold;">
            <td colspan="4" style="padding: 8px; text-align: right;">Total Deposits:</td>
            <td style="padding: 8px; text-align: right; color: #4caf50;">+${totalDepositAmount.toFixed(2)} AED</td>
          </tr>
        `;
      }
    } catch (e) {
      console.log("Could not fetch transactions/bills");
    }

    const content = document.createElement("div");
    content.innerHTML = `
      <div style="font-family: Arial, sans-serif; padding: 30px; max-width: 800px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 30px; border-bottom: 3px solid #1e88e5; padding-bottom: 20px;">
          <div style="display: flex; justify-content: center; margin-bottom: 10px;">
            <img src="${logoImage}" alt="Logo" style="max-width: 180px; height: auto;" />
          </div>
          <p style="margin: 8px 0 0 0; font-size: 14px; color: #666;">${escapeHtml(companyAddressLine)}</p>
        </div>

        <h2 style="text-align: center; margin: 20px 0; color: #333; font-size: 22px;">CLIENT ACCOUNT SUMMARY</h2>

        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
          <table style="width: 100%; font-size: 14px;">
            <tr>
              <td style="padding: 8px 0; width: 50%;"><strong>Client Name:</strong> ${client.name}</td>
              <td style="padding: 8px 0;"><strong>Phone:</strong> ${client.phone || "-"}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Address:</strong> ${client.address || "-"}</td>
              <td style="padding: 8px 0;"><strong>Account Number:</strong> ${client.billNumber || "-"}</td>
            </tr>
          </table>
        </div>

        <div style="display: flex; gap: 20px; margin-bottom: 25px;">
          <div style="flex: 1; background: #e3f2fd; padding: 15px; border-radius: 8px; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #1565c0;">Total Bills</p>
            <p style="margin: 5px 0 0 0; font-size: 22px; font-weight: bold; color: #1e88e5;">${totalBill.toFixed(2)} AED</p>
          </div>
          <div style="flex: 1; background: #e8f5e9; padding: 15px; border-radius: 8px; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #2e7d32;">Total Deposits</p>
            <p style="margin: 5px 0 0 0; font-size: 22px; font-weight: bold; color: #4caf50;">${totalDeposit.toFixed(2)} AED</p>
          </div>
          <div style="flex: 1; background: #ffebee; padding: 15px; border-radius: 8px; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #c62828;">Due Balance</p>
            <p style="margin: 5px 0 0 0; font-size: 22px; font-weight: bold; color: #f44336;">${balance.toFixed(2)} AED</p>
          </div>
        </div>

        <h3 style="margin: 25px 0 15px 0; color: #333; border-bottom: 2px solid #ddd; padding-bottom: 10px;">Transaction History</h3>

        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background: #1e88e5; color: white;">
              <th style="padding: 12px 8px; text-align: center; width: 40px;">#</th>
              <th style="padding: 12px 8px; text-align: left;">Date</th>
              <th style="padding: 12px 8px; text-align: left;">Time</th>
              <th style="padding: 12px 8px; text-align: left;">Type</th>
              <th style="padding: 12px 8px; text-align: left;">Order #</th>
              <th style="padding: 12px 8px; text-align: right;">Amount</th>
              <th style="padding: 12px 8px; text-align: right;">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${transactionRows || '<tr><td colspan="7" style="padding: 20px; text-align: center; color: #999;">No transaction history found</td></tr>'}
          </tbody>
        </table>

        ${paidBillsRows ? `
        <h3 style="margin: 25px 0 15px 0; color: #2e7d32; border-bottom: 2px solid #4caf50; padding-bottom: 10px;">Paid Bills</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background: #4caf50; color: white;">
              <th style="padding: 10px 8px; text-align: left;">Bill #</th>
              <th style="padding: 10px 8px; text-align: left;">Date</th>
              <th style="padding: 10px 8px; text-align: left;">Description</th>
              <th style="padding: 10px 8px; text-align: left;">Payment</th>
              <th style="padding: 10px 8px; text-align: right;">Amount</th>
              <th style="padding: 10px 8px; text-align: right;">Paid</th>
            </tr>
          </thead>
          <tbody>${paidBillsRows}</tbody>
        </table>
        ` : ''}

        ${depositsRows ? `
        <h3 style="margin: 25px 0 15px 0; color: #2e7d32; border-bottom: 2px solid #4caf50; padding-bottom: 10px;">Deposits</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background: #2e7d32; color: white;">
              <th style="padding: 10px 8px; text-align: center; width: 40px;">#</th>
              <th style="padding: 10px 8px; text-align: left;">Date</th>
              <th style="padding: 10px 8px; text-align: left;">Description</th>
              <th style="padding: 10px 8px; text-align: left;">Method</th>
              <th style="padding: 10px 8px; text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>${depositsRows}</tbody>
        </table>
        ` : ''}

        <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #ddd; text-align: center;">
          <p style="font-size: 11px; color: #666; margin: 0;">
            Generated on ${format(new Date(), "dd/MM/yyyy 'at' HH:mm")} | Thank you for your business!
          </p>
          <p style="font-size: 13px; font-weight: bold; color: #000; margin: 8px 0 0 0;">
            ${escapeHtml(companyPhoneLine)}
          </p>
        </div>
      </div>
    `;

    const opt = {
      margin: 10,
      filename: `${client.name.replace(/\s+/g, "_")}_Summary.pdf`,
      image: { type: "jpeg" as const, quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: {
        unit: "mm",
        format: "a4" as const,
        orientation: "portrait" as const,
      },
    };

    html2pdf().set(opt).from(content).save();
    toast({
      title: "PDF Downloaded",
      description: `Full summary for ${client.name} saved`,
    });
  };

  const downloadClientExcel = async (client: Client) => {
    let transactionData: any[][] = [];
    let paidBillsData: any[][] = [];
    let depositsData: any[][] = [];
    let totalBillsFromTx = 0;
    let totalDepositsFromTx = 0;
    let totalBillsPaid = 0;
    let totalDepositsUsed = 0;
    
    const formatPaymentMethod = (method: string | null | undefined) => {
      return formatClientBillPaymentMethodLabel(method);
    };
    
    try {
      const [txRes, billsRes] = await Promise.all([
        fetch(`/api/clients/${client.id}/transactions`),
        fetch(`/api/clients/${client.id}/bills`)
      ]);
      
      const clientTransactions: ClientTransaction[] = txRes.ok ? await txRes.json() : [];
      const clientBills: Bill[] = billsRes.ok ? await billsRes.json() : [];
      const visibleClientTransactions = buildVisibleClientHistoryTransactions(clientTransactions);
      
      if (visibleClientTransactions.length > 0) {
        const sortedTransactions = [...visibleClientTransactions].sort(compareClientTransactionsAsc);
        
        sortedTransactions.forEach(t => {
          const amt = parseFloat(t.amount || "0");
          if (t.type === "deposit") {
            totalDepositsFromTx += amt;
          } else if (isAccountCreditDeductionType(t.type)) {
            totalDepositsUsed += amt;
          } else if (t.type === "payment" || t.type === "bulk_payment") {
            totalBillsPaid += amt;
          } else {
            totalBillsFromTx += amt;
          }
        });
        
        transactionData = sortedTransactions.map(t => {
          let typeLabel = 'Bill';
          if (t.type === "deposit") {
            typeLabel = 'Add Credit to Account';
          } else if (t.type === "deposit_deduction") {
            typeLabel = 'Deduct Credit from Account';
          } else if (t.type === "payment" || t.type === "deposit_used" || t.type === "bulk_deposit_used" || t.type === "bulk_payment") {
            typeLabel = 'Payment';
          }
          return [
            typeLabel,
            t.displayDescription || "-",
            parseFloat(t.amount).toFixed(2),
            formatPaymentMethod(t.paymentMethod),
            format(new Date(t.date), "dd/MM/yyyy, HH:mm"),
          ];
        });
        
        const depositTxs = sortedTransactions.filter(t => t.type === "deposit");
        depositsData = depositTxs.map((t, idx) => [
          idx + 1,
          format(new Date(t.date), "dd/MM/yyyy, HH:mm"),
          t.displayDescription || "Deposit received",
          formatPaymentMethod(t.paymentMethod),
          `+${parseFloat(t.amount).toFixed(2)}`,
        ]);
      }
      
      const paidBills = clientBills.filter(b => b.isPaid);
      paidBillsData = paidBills.map(bill => [
        `#${bill.id}`,
        format(new Date(bill.billDate), "dd/MM/yyyy"),
        (bill.description || "-").substring(0, 60),
        formatPaymentMethod(bill.paymentMethod),
        parseFloat(bill.amount || "0").toFixed(2),
        parseFloat(bill.paidAmount || "0").toFixed(2),
      ]);
    } catch (e) {
      console.log("Could not fetch transactions/bills");
    }

    const data: any[][] = [];
    
    data.push([`${companyContact.companyName} - ${client.name} Account Summary`]);
    data.push([`Phone: ${client.phone || '-'}`]);
    data.push([`Generated: ${format(new Date(), "dd/MM/yyyy, HH:mm:ss")}`]);
    data.push([""]);
    
    data.push(["All Transactions"]);
    if (transactionData.length > 0) {
      data.push(["Type", "Description", "Amount (AED)", "Payment Method", "Date"]);
      transactionData.forEach(row => data.push(row));
    } else {
      data.push(["No transaction history available"]);
    }
    data.push([""]);
    
    data.push(["Paid Bills"]);
    if (paidBillsData.length > 0) {
      data.push(["Bill #", "Date", "Description", "Payment Method", "Amount (AED)", "Paid (AED)"]);
      paidBillsData.forEach(row => data.push(row));
      const totalPaidAmount = paidBillsData.reduce((sum, row) => sum + parseFloat(row[4]), 0);
      const totalPaidPaid = paidBillsData.reduce((sum, row) => sum + parseFloat(row[5]), 0);
      data.push(["", "", "", "Total:", totalPaidAmount.toFixed(2), totalPaidPaid.toFixed(2)]);
    } else {
      data.push(["No paid bills"]);
    }
    data.push([""]);
    
    data.push(["Deposits"]);
    if (depositsData.length > 0) {
      data.push(["#", "Date", "Description", "Payment Method", "Amount (AED)"]);
      depositsData.forEach(row => data.push(row));
      const totalDepositsAmount = depositsData.reduce((sum, row) => sum + parseFloat(String(row[4]).replace("+", "")), 0);
      data.push(["", "", "", "Total:", `+${totalDepositsAmount.toFixed(2)}`]);
    } else {
      data.push(["No deposits"]);
    }
    data.push([""]);
    
    const unpaidBillsAmount = Math.max(0, totalBillsFromTx - totalBillsPaid);
    const creditsAvailable = Math.max(0, totalDepositsFromTx - totalDepositsUsed);
    
    data.push(["Summary"]);
    data.push(["Unpaid Bills", `${unpaidBillsAmount.toFixed(2)} AED`]);
    data.push(["Total Paid", `${totalBillsPaid.toFixed(2)} AED`]);
    data.push(["Credits Available", `${creditsAvailable.toFixed(2)} AED`]);

    const headerRow = 5;
    const lastRow = headerRow + transactionData.length;
    await writeExcel({
      data,
      sheetName: "Client Summary",
      fileName: `${client.name.replace(/\s+/g, "_")}_Summary.xlsx`,
      columns: [
        { wch: 22 },
        { wch: 40 },
        { wch: 15 },
        { wch: 20 },
        { wch: 20 },
      ],
      autoFilterRef: transactionData.length > 0 ? `A${headerRow + 1}:E${lastRow + 1}` : undefined,
    });
    toast({
      title: "Excel Downloaded",
      description: `Full summary for ${client.name} saved`,
    });
  };

  const downloadCompanyPDF = async (companyName: string, companyClients: Client[]) => {
    const companyTotalBills = companyClients.reduce((sum, c) => sum + getClientTotalBills(c), 0);
    const companyTotalDeposits = companyClients.reduce((sum, c) => sum + getClientTotalDeposits(c), 0);
    const companyTotalDue = companyClients.reduce((sum, c) => sum + getClientBalanceDue(c), 0);

    const clientRows = companyClients.map((client, idx) => {
      const bills = getClientTotalBills(client);
      const deposits = getClientTotalDeposits(client);
      const due = getClientBalanceDue(client);
      const dueColor = due > 0 ? "#f44336" : "#4caf50";
      return `
        <tr style="border-bottom: 1px solid #eee; ${idx % 2 === 1 ? 'background: #f9f9f9;' : ''}">
          <td style="padding: 8px; text-align: center;">${idx + 1}</td>
          <td style="padding: 8px; font-weight: 500;">${client.name}</td>
          <td style="padding: 8px;">${client.phone || "-"}</td>
          <td style="padding: 8px;">${client.address || "-"}</td>
          <td style="padding: 8px;">${client.billNumber || "-"}</td>
          <td style="padding: 8px; text-align: right; color: #2196f3;">${bills.toFixed(2)}</td>
          <td style="padding: 8px; text-align: right; color: #4caf50;">${deposits.toFixed(2)}</td>
          <td style="padding: 8px; text-align: right; font-weight: 600; color: ${dueColor};">${due.toFixed(2)}</td>
        </tr>
      `;
    }).join("");

    const content = document.createElement("div");
    content.innerHTML = `
      <div style="font-family: Arial, sans-serif; padding: 30px; max-width: 900px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 30px; border-bottom: 3px solid #1e88e5; padding-bottom: 20px;">
          <div style="display: flex; justify-content: center; margin-bottom: 10px;">
            <img src="${logoImage}" alt="Logo" style="max-width: 180px; height: auto;" />
          </div>
          <p style="margin: 8px 0 0 0; font-size: 14px; color: #666;">${escapeHtml(companyAddressLine)}</p>
        </div>
        <h2 style="text-align: center; margin: 20px 0; color: #333; font-size: 22px;">COMPANY REPORT</h2>
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
          <table style="width: 100%; font-size: 14px;">
            <tr>
              <td style="padding: 8px 0;"><strong>Company:</strong> ${companyName}</td>
              <td style="padding: 8px 0;"><strong>Total Clients:</strong> ${companyClients.length}</td>
            </tr>
          </table>
        </div>
        <div style="display: flex; gap: 20px; margin-bottom: 25px;">
          <div style="flex: 1; background: #e3f2fd; padding: 15px; border-radius: 8px; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #1565c0;">Total Bills</p>
            <p style="margin: 5px 0 0 0; font-size: 22px; font-weight: bold; color: #1e88e5;">${companyTotalBills.toFixed(2)} AED</p>
          </div>
          <div style="flex: 1; background: #e8f5e9; padding: 15px; border-radius: 8px; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #2e7d32;">Total Deposits</p>
            <p style="margin: 5px 0 0 0; font-size: 22px; font-weight: bold; color: #4caf50;">${companyTotalDeposits.toFixed(2)} AED</p>
          </div>
          <div style="flex: 1; background: #ffebee; padding: 15px; border-radius: 8px; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #c62828;">Total Due</p>
            <p style="margin: 5px 0 0 0; font-size: 22px; font-weight: bold; color: #f44336;">${companyTotalDue.toFixed(2)} AED</p>
          </div>
        </div>
        <h3 style="margin: 25px 0 15px 0; color: #333; border-bottom: 2px solid #ddd; padding-bottom: 10px;">Client Details</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background: #1e88e5; color: white;">
              <th style="padding: 12px 8px; text-align: center; width: 40px;">#</th>
              <th style="padding: 12px 8px; text-align: left;">Client Name</th>
              <th style="padding: 12px 8px; text-align: left;">Phone</th>
              <th style="padding: 12px 8px; text-align: left;">Address</th>
              <th style="padding: 12px 8px; text-align: left;">Acc #</th>
              <th style="padding: 12px 8px; text-align: right;">Bills (AED)</th>
              <th style="padding: 12px 8px; text-align: right;">Deposits (AED)</th>
              <th style="padding: 12px 8px; text-align: right;">Due (AED)</th>
            </tr>
          </thead>
          <tbody>
            ${clientRows}
            <tr style="background: #e3f2fd; font-weight: bold;">
              <td colspan="5" style="padding: 10px 8px; text-align: right;">TOTALS:</td>
              <td style="padding: 10px 8px; text-align: right; color: #1e88e5;">${companyTotalBills.toFixed(2)}</td>
              <td style="padding: 10px 8px; text-align: right; color: #4caf50;">${companyTotalDeposits.toFixed(2)}</td>
              <td style="padding: 10px 8px; text-align: right; color: #f44336;">${companyTotalDue.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #ddd; text-align: center;">
          <p style="font-size: 11px; color: #666; margin: 0;">
            Generated on ${format(new Date(), "dd/MM/yyyy 'at' HH:mm")} | Thank you for your business!
          </p>
          <p style="font-size: 13px; font-weight: bold; color: #000; margin: 8px 0 0 0;">
            ${escapeHtml(companyPhoneLine)}
          </p>
        </div>
      </div>
    `;

    const opt = {
      margin: 10,
      filename: `${companyName.replace(/\s+/g, "_")}_Company_Report.pdf`,
      image: { type: "jpeg" as const, quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: "mm", format: "a4" as const, orientation: "landscape" as const },
    };

    html2pdf().set(opt).from(content).save();
    toast({ title: "PDF Downloaded", description: `Company report for ${companyName} saved` });
  };

  const downloadCompanyExcel = async (companyName: string, companyClients: Client[]) => {
    const data: any[][] = [];
    data.push([`${companyContact.companyName} - ${companyName} Company Report`]);
    data.push([`Total Clients: ${companyClients.length}`]);
    data.push([`Generated: ${format(new Date(), "dd/MM/yyyy, HH:mm:ss")}`]);
    data.push([""]);

    data.push(["Client Details"]);
    data.push(["#", "Client Name", "Phone", "Address", "Account #", "Total Bills (AED)", "Deposits (AED)", "Due (AED)"]);

    let totalBills = 0;
    let totalDeposits = 0;
    let totalDue = 0;
    companyClients.forEach((client, idx) => {
      const bills = getClientTotalBills(client);
      const deposits = getClientTotalDeposits(client);
      const due = getClientBalanceDue(client);
      totalBills += bills;
      totalDeposits += deposits;
      totalDue += due;
      data.push([
        idx + 1,
        client.name,
        client.phone || "-",
        client.address || "-",
        client.billNumber || "-",
        bills.toFixed(2),
        deposits.toFixed(2),
        due.toFixed(2),
      ]);
    });

    data.push([""]);
    data.push(["", "", "", "", "TOTALS:", totalBills.toFixed(2), totalDeposits.toFixed(2), totalDue.toFixed(2)]);

    const headerRow = 5;
    const lastRow = headerRow + companyClients.length;
    await writeExcel({
      data,
      sheetName: "Company Report",
      fileName: `${companyName.replace(/\s+/g, "_")}_Company_Report.xlsx`,
      columns: [
        { wch: 5 },
        { wch: 25 },
        { wch: 15 },
        { wch: 30 },
        { wch: 12 },
        { wch: 18 },
        { wch: 15 },
        { wch: 15 },
      ],
      autoFilterRef: `A${headerRow + 1}:H${lastRow + 1}`,
    });
    toast({ title: "Excel Downloaded", description: `Company report for ${companyName} saved` });
  };

  const getItemCount = (itemsString: string | null): number => {
    if (!itemsString) return 0;
    const trimmed = itemsString.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.reduce((sum: number, item: any) => sum + (item.quantity || 1), 0);
        }
      } catch (e) {}
    }
    return itemsString.split(", ").reduce((count, item) => {
      const quantityFirstMatch = item.match(/^(\d+)x\s+.+$/);
      if (quantityFirstMatch) return count + parseInt(quantityFirstMatch[1]);
      const nameFirstMatch = item.match(/^.+\s+x(\d+)$/);
      if (nameFirstMatch) return count + parseInt(nameFirstMatch[1]);
      return count + 1;
    }, 0);
  };

  const clientOrderTotalsById = useMemo(
    () => clientOrderSummary?.byClientId ?? {},
    [clientOrderSummary],
  );

  const getClientOrderTotals = useCallback(
    (client: Client): ClientOrderTotals =>
      clientOrderTotalsById[String(client.id)] ?? EMPTY_CLIENT_ORDER_TOTALS,
    [clientOrderTotalsById],
  );

  // Total paid against orders for this client.
  const getClientTotalBills = useCallback(
    (client: Client): number => getClientOrderTotals(client).totalPaid,
    [getClientOrderTotals],
  );

  // Calculate Total Deposits = sum of deposit transactions (money customer gave)
  const getClientTotalDeposits = useCallback((client: Client): number => {
    return parseFloat(client.deposit || "0");
  }, []);

  // Balance due is pre-aggregated server-side so the list does not rescan every order per row.
  const getClientBalanceDue = useCallback(
    (client: Client): number => getClientOrderTotals(client).due,
    [getClientOrderTotals],
  );

  // Generate combined invoice for all unpaid bills
  const generateCombinedInvoice = () => {
    if (!transactionClient || !unpaidBills || unpaidBills.length === 0) return;
    
    const billItems = unpaidBills.map((bill) => ({
      billId: bill.id,
      date: format(new Date(bill.billDate), "dd/MM/yyyy"),
      description: bill.description || `Bill #${bill.id}`,
      amount: parseFloat(bill.amount || "0"),
      paid: parseFloat(bill.paidAmount || "0"),
      due: parseFloat(bill.amount || "0") - parseFloat(bill.paidAmount || "0"),
      createdBy: bill.createdBy || undefined,
    }));
    
    const totalDue = billItems.reduce((sum, item) => sum + item.due, 0);
    
    setCombinedInvoiceData({
      invoiceNumber: `DUE-${transactionClient.id}-${Date.now().toString().slice(-6)}`,
      date: format(new Date(), "dd/MM/yyyy"),
      clientName: transactionClient.name,
      clientPhone: transactionClient.phone || undefined,
      clientAddress: transactionClient.address || undefined,
      bills: billItems,
      totalDue,
    });
  };

  const totalBillsCardAmount = clientOrderSummary?.totalAmount || 0;
  const totalPaidBillsAllTime = clientOrderSummary?.totalPaid || 0;
  const totalDueCardAmount = clientOrderSummary?.totalDue || 0;
  const totalDeposit =
    clients?.reduce((sum, c) => sum + getClientTotalDeposits(c), 0) || 0;
  const creditedAccounts = useMemo(() => {
    if (!allClients) return [];

    const entries = [...allClients]
      .map((client) => ({
        client,
        creditAmount: getClientTotalDeposits(client),
        dueAmount: getClientBalanceDue(client),
      }))
      .filter(({ creditAmount }) => creditAmount > 0.009);

    if (!creditsPopoverOpen) return entries;

    return entries.sort((left, right) => {
      if (right.creditAmount !== left.creditAmount) {
        return right.creditAmount - left.creditAmount;
      }
      return left.client.name.localeCompare(right.client.name);
    });
  }, [allClients, creditsPopoverOpen, getClientBalanceDue, getClientTotalDeposits]);

  const totalSystemCredits = useMemo(
    () => creditedAccounts.reduce((sum, entry) => sum + entry.creditAmount, 0),
    [creditedAccounts],
  );

  const paidBillEntries = useMemo(() => {
    if (!billsPopoverOpen) return [];
    if (!allBills || !allOrders || !allClients) return [];

    const clientsById = new Map(allClients.map((client) => [client.id, client]));
    const ordersByBillId = new Map<number, Order[]>();
    for (const order of allOrders) {
      if (!order.billId) continue;
      const linkedOrders = ordersByBillId.get(order.billId) || [];
      linkedOrders.push(order);
      ordersByBillId.set(order.billId, linkedOrders);
    }

    return [...allBills]
      .map((bill) => {
        const linkedOrders = ordersByBillId.get(bill.id) || [];
        if (linkedOrders.length === 0) return null;

        const client =
          (bill.clientId ? clientsById.get(bill.clientId) : undefined) ||
          clientsById.get(linkedOrders.find((order) => order.clientId)?.clientId || -1);
        const paidAmountValue = parseFloat(String(bill.paidAmount || "0"));
        const finalAmountValue = parseFloat(String(bill.amount || "0"));
        const primaryOrder = [...linkedOrders].sort((left, right) => {
          const leftTime = new Date(left.entryDate || 0).getTime();
          const rightTime = new Date(right.entryDate || 0).getTime();
          if (leftTime !== rightTime) return leftTime - rightTime;
          return Number(left.id || 0) - Number(right.id || 0);
        })[0];

        return {
          bill,
          client,
          primaryOrder,
          paidAmountValue: Number.isFinite(paidAmountValue) ? paidAmountValue : 0,
          finalAmountValue: Number.isFinite(finalAmountValue) ? finalAmountValue : 0,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry && entry.paidAmountValue > 0.009)
      .sort((left, right) => {
        const leftTime = new Date(left.bill.billDate || 0).getTime();
        const rightTime = new Date(right.bill.billDate || 0).getTime();
        if (leftTime !== rightTime) {
          return rightTime - leftTime;
        }
        return Number(right.bill.id || 0) - Number(left.bill.id || 0);
    });
  }, [allBills, allClients, allOrders, billsPopoverOpen]);

  const isPaidBillEntriesLoading =
    billsPopoverOpen && (paidBillOrdersLoading || paidBillBillsLoading);

  const dueAccounts = useMemo(() => {
    if (!duePopoverOpen || !allClients) return [];

    return [...allClients]
      .map((client) => ({
        client,
        dueAmount: getClientBalanceDue(client),
        creditAmount: getClientTotalDeposits(client),
      }))
      .filter(({ dueAmount }) => dueAmount > 0.009)
      .sort((left, right) => {
        if (right.dueAmount !== left.dueAmount) {
          return right.dueAmount - left.dueAmount;
        }
        return left.client.name.localeCompare(right.client.name);
      });
  }, [allClients, duePopoverOpen, getClientBalanceDue, getClientTotalDeposits]);

  const displayedClients = useMemo(() => {
    if (!clients) return [];
    let filtered = clients.filter((client) =>
      matchesClientSearchFilters(client, debouncedClientSearchFilters),
    );

    switch (sortBy) {
      case "alphabetical":
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "newest":
        filtered.sort((a, b) => b.id - a.id);
        break;
      case "oldest":
        filtered.sort((a, b) => a.id - b.id);
        break;
      case "high_unpaid":
        filtered.sort((a, b) => getClientBalanceDue(b) - getClientBalanceDue(a));
        break;
      case "total_credits":
        filtered.sort((a, b) => getClientTotalDeposits(b) - getClientTotalDeposits(a));
        break;
    }
    return filtered;
  }, [clients, debouncedClientSearchFilters, getClientBalanceDue, getClientTotalDeposits, sortBy]);

  const brokerClients = useMemo(
    () => displayedClients.filter((client: any) => ((client as any).clientType || "").trim().toLowerCase() === "broker"),
    [displayedClients],
  );

  const currentTabClients = useMemo(() => {
    if (clientsTab === "broker") {
      return brokerClients;
    }

    if (clientsTab === "all") {
      return displayedClients;
    }

    return [];
  }, [brokerClients, clientsTab, displayedClients]);

  const visibleCurrentTabClients = useMemo(() => {
    if (clientsTab === "company") {
      return currentTabClients;
    }

    return currentTabClients.slice(0, visibleClientsCount);
  }, [clientsTab, currentTabClients, visibleClientsCount]);

  const dueClientsCount =
    clientOrderSummary?.dueClientsCount ??
    clients?.filter((c) => getClientBalanceDue(c) > 0).length ??
    0;

  const companiesGrouped = useMemo(() => {
    if (clientsTab !== "company") {
      return { companies: new Map<string, Client[]>(), unassigned: [] as Client[] };
    }

    if (!displayedClients) return { companies: new Map<string, Client[]>(), unassigned: [] as Client[] };
    const companiesMap = new Map<string, Client[]>();
    const unassigned: Client[] = [];
    if (companiesList) {
      companiesList.forEach(c => {
        if (!companiesMap.has(c.name)) {
          companiesMap.set(c.name, []);
        }
      });
    }
    displayedClients.forEach(client => {
      if (client.company && client.company.trim()) {
        const companyName = client.company.trim().toUpperCase();
        if (!companiesMap.has(companyName)) {
          companiesMap.set(companyName, []);
        }
        companiesMap.get(companyName)!.push(client);
      } else {
        unassigned.push(client);
      }
    });
    return { companies: companiesMap, unassigned };
  }, [clientsTab, displayedClients, companiesList]);

  const hasMoreCurrentTabClients =
    clientsTab !== "company" && visibleCurrentTabClients.length < currentTabClients.length;

  const loadMoreCurrentTabClients = useCallback(() => {
    setVisibleClientsCount((current) =>
      Math.min(currentTabClients.length, current + CLIENTS_LOAD_MORE_COUNT),
    );
  }, [currentTabClients.length]);

  useEffect(() => {
    if (clientsTab === "company") return;

    setVisibleClientsCount(CLIENTS_INITIAL_LOAD_COUNT);
    clientListScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [clientsTab, debouncedClientSearchFilters, sortBy]);

  useEffect(() => {
    if (clientsTab === "company") return;

    setVisibleClientsCount((current) => {
      if (currentTabClients.length === 0) {
        return CLIENTS_INITIAL_LOAD_COUNT;
      }

      return Math.min(
        Math.max(current, CLIENTS_INITIAL_LOAD_COUNT),
        currentTabClients.length,
      );
    });
  }, [clientsTab, currentTabClients.length]);

  useEffect(() => {
    if (!highlightedClientId || clientsTab !== "all" || !currentTabClients.length) return;

    const highlightedIndex = currentTabClients.findIndex((client) => client.id === highlightedClientId);
    if (highlightedIndex === -1) return;

    const requiredVisibleCount = Math.max(
      CLIENTS_INITIAL_LOAD_COUNT,
      highlightedIndex + 1,
    );

    if (visibleClientsCount < requiredVisibleCount) {
      setVisibleClientsCount(
        Math.min(currentTabClients.length, requiredVisibleCount),
      );
      return;
    }

    const timer = setTimeout(() => {
      const target = document.querySelector(`[data-testid="row-client-${highlightedClientId}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 250);

    const clearTimer = setTimeout(() => {
      setHighlightedClientId((current) => (current === highlightedClientId ? null : current));
    }, 3200);

    return () => {
      clearTimeout(timer);
      clearTimeout(clearTimer);
    };
  }, [highlightedClientId, clientsTab, currentTabClients, visibleClientsCount]);

  useEffect(() => {
    if (clientsTab === "company") return;

    const target = clientsLoadMoreRef.current;
    const scrollRoot = clientListScrollRef.current;

    if (!target || !scrollRoot || !hasMoreCurrentTabClients) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreCurrentTabClients();
        }
      },
      {
        root: scrollRoot,
        rootMargin: `0px 0px ${CLIENTS_LOAD_MORE_THRESHOLD_PX}px 0px`,
        threshold: 0,
      },
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [
    clientsTab,
    hasMoreCurrentTabClients,
    loadMoreCurrentTabClients,
    visibleCurrentTabClients.length,
  ]);

  const clientListStatus =
    clientsTab !== "company" && currentTabClients.length > 0 ? (
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
        <span>
          Showing {visibleCurrentTabClients.length} of {currentTabClients.length} matching clients
          {hasMoreCurrentTabClients
            ? `, scroll down to load ${CLIENTS_LOAD_MORE_COUNT} more`
            : ", all matching clients loaded"}
        </span>
      </div>
    ) : null;

  const clientListLoadMoreFooter =
    clientsTab !== "company" && currentTabClients.length > 0 ? (
      <div
        ref={clientsLoadMoreRef}
        className="px-3 py-3 text-center text-xs text-muted-foreground"
      >
        Showing {visibleCurrentTabClients.length} of {currentTabClients.length} matching clients
        {hasMoreCurrentTabClients
          ? `, scroll down to load ${CLIENTS_LOAD_MORE_COUNT} more`
          : ", all matching clients loaded"}
      </div>
    ) : null;

  const toggleCompany = (companyName: string) => {
    setExpandedCompanies(prev => {
      const next = new Set(prev);
      if (next.has(companyName)) {
        next.delete(companyName);
      } else {
        next.add(companyName);
      }
      return next;
    });
  };

  const mobileTableClassName = isMobile
    ? "min-w-[660px] text-[11px] [&_th]:h-8 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-[11px] [&_td]:px-2 [&_td]:py-2 [&_td]:align-top"
    : "";
  const clientSearchGridClassName = isMobile
    ? "grid grid-cols-1 gap-2.5"
    : "grid w-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4";
  const clientSearchInputClassName = isMobile
    ? "h-10 w-full rounded-xl border-border/70 bg-background/95 pl-8 pr-3 text-[12px] touch-manipulation"
    : "h-10 w-full rounded-xl border-border/70 bg-background/95 pl-9 pr-3 text-sm shadow-sm";
  const clientSearchIconClassName = isMobile
    ? "absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
    : "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground";
  const clientSearchFieldConfigs: Array<{
    key: ClientSearchFieldKey;
    label: string;
    placeholder: string;
    inputMode?: "text" | "search" | "tel" | "url" | "email" | "numeric" | "decimal" | "none";
    testId: string;
  }> = [
    {
      key: "accountNumber",
      label: "Account Number",
      placeholder: "Search account #",
      testId: "input-search-clients-account-number",
    },
    {
      key: "nameAddress",
      label: "Name / Address",
      placeholder: "Search customer or address",
      testId: "input-search-clients-name-address",
    },
    {
      key: "mobileNumber",
      label: "Mobile Number",
      placeholder: "Search mobile #",
      inputMode: "tel",
      testId: "input-search-clients-mobile-number",
    },
    {
      key: "companyName",
      label: "Company Name",
      placeholder: "Search company",
      testId: "input-search-clients-company-name",
    },
  ];
  const activeClientSearchFilterCount = CLIENT_SEARCH_FIELD_KEYS.reduce(
    (count, key) => count + (clientSearchFilters[key].trim() ? 1 : 0),
    0,
  );
  const hasActiveClientSearchFilters = activeClientSearchFilterCount > 0;
  const mobileClientSearchSummaryLabel = hasActiveClientSearchFilters
    ? `${activeClientSearchFilterCount} active`
    : "Account, name, mobile, company";
  const clientSearchFields = (
    <div className={clientSearchGridClassName}>
      {clientSearchFieldConfigs.map((field) => (
        <div key={field.key} className="min-w-0 text-left">
          <Label className="mb-1.5 block px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {field.label}
          </Label>
          <div className="relative">
            <Search className={clientSearchIconClassName} />
            <Input
              placeholder={field.placeholder}
              value={clientSearchFilters[field.key]}
              onChange={(event) => handleClientSearchChange(field.key, event.target.value)}
              className={clientSearchInputClassName}
              inputMode={field.inputMode}
              autoComplete="off"
              data-testid={field.testId}
            />
          </div>
        </div>
      ))}
    </div>
  );

  const openClientEditDialog = (
    event: ReactMouseEvent<HTMLButtonElement>,
    client: Client,
  ) => {
    event.stopPropagation();
    setEditingClient(client);
  };

  const renderMobileClientList = (
    clientsList: Client[],
    view: "all" | "broker" | "company",
    companyName?: string,
    startIndex = 0,
  ) => {
    const getRowTestId = (clientId: number) => {
      if (view === "broker") return `row-broker-${clientId}`;
      if (view === "company") return `row-company-client-${clientId}`;
      return `row-client-${clientId}`;
    };

    const getActionTestId = (action: "pdf" | "excel" | "merge" | "edit" | "delete" | "remove", clientId: number) => {
      if (view === "broker") {
        if (action === "pdf") return `button-pdf-broker-${clientId}`;
        if (action === "excel") return `button-excel-broker-${clientId}`;
        if (action === "edit") return `button-edit-broker-${clientId}`;
        if (action === "delete") return `button-delete-broker-${clientId}`;
      }

      if (view === "company") {
        if (action === "remove") return `button-remove-company-${clientId}`;
        if (action === "pdf") return `button-pdf-company-${clientId}`;
        if (action === "excel") return `button-excel-company-${clientId}`;
        if (action === "merge") return `button-merge-company-${clientId}`;
        if (action === "edit") return `button-edit-company-${clientId}`;
        if (action === "delete") return `button-delete-company-${clientId}`;
      }

      if (action === "pdf") return `button-pdf-${clientId}`;
      if (action === "excel") return `button-excel-${clientId}`;
      if (action === "merge") return `button-merge-${clientId}`;
      if (action === "edit") return `button-edit-${clientId}`;
      if (action === "delete") return `button-delete-${clientId}`;
      return `button-${action}-${clientId}`;
    };

    return (
      <div className="overflow-hidden rounded-lg border bg-card" data-testid={view === "broker" ? "broker-view-mobile" : undefined}>
        <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2.5 border-b bg-primary/10 px-3 py-2.5 text-[12px] font-semibold text-foreground">
          <span>No.</span>
          <span>Client Details</span>
        </div>
        <div className="divide-y divide-border">
          {clientsList.map((client, index) => {
            const isBroker = ((client as any).clientType || "").trim().toLowerCase() === "broker";
            const totalBill = getClientTotalBills(client);
            const totalDeposit = getClientTotalDeposits(client);
            const totalDue = getClientBalanceDue(client);
            const openClientDetails = () => setTransactionClient(client);
            const isHighlighted = view === "all" && highlightedClientId === client.id;

            return (
              <div
                key={client.id}
                className={`grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)] gap-2.5 px-3 py-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${isHighlighted ? "bg-primary/10 ring-2 ring-primary ring-offset-2 animate-order-focus-glow" : "hover:bg-muted/40"}`}
                data-testid={getRowTestId(client.id)}
                role="button"
                tabIndex={0}
                onClick={openClientDetails}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openClientDetails();
                  }
                }}
              >
                <div className="pt-1 text-[12px] font-semibold text-muted-foreground">
                  {startIndex + index + 1}
                </div>

                <div className="min-w-0">
                  <div className="min-w-0 text-[14px] font-semibold leading-snug text-foreground">
                    <button
                      type="button"
                      className="break-words text-left transition-colors hover:text-primary hover:underline underline-offset-2"
                      data-testid={view === "all" ? `text-client-name-${client.id}` : undefined}
                      onClick={(event) => openClientEditDialog(event, client)}
                    >
                      {client.name}
                    </button>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {client.billNumber && (
                      <span className="text-[11px] text-muted-foreground">
                        ({client.billNumber})
                      </span>
                    )}
                    {view !== "company" && (
                      isBroker ? (
                        <Badge variant="secondary" className="px-1.5 py-0.5 text-[11px] bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border-violet-200 dark:border-violet-700">
                          Broker
                        </Badge>
                      ) : client.company ? (
                        <Badge variant="secondary" className="px-1.5 py-0.5 text-[11px] bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-700">
                          {client.company}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          Regular
                        </Badge>
                      )
                    )}
                  </div>

                  {client.phone && (
                    <div className="mt-1" data-testid={view === "all" ? `text-client-contact-${client.id}` : undefined}>
                      <PhoneNumberWithFlag
                        phone={client.phone}
                        textClassName="text-[12px] text-foreground"
                      />
                    </div>
                  )}
                  {client.address && (
                    <div className={client.phone ? "mt-1" : "mt-0.5"}>
                      <AddressTextWithIcon
                        address={client.address}
                        textClassName="text-[12px] text-muted-foreground break-words"
                      />
                    </div>
                  )}

                  <div className="mt-3 space-y-1.5 border-t border-border/70 pt-2">
                    <div className="flex min-h-7 items-center justify-between gap-3 rounded-md bg-blue-50/70 px-2 dark:bg-blue-950/20">
                      <span className="text-[11px] font-medium text-muted-foreground">Bill</span>
                      <span className="text-[13px] font-semibold text-blue-600" data-testid={view === "all" ? `text-client-amount-${client.id}` : undefined}>
                        {totalBill.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex min-h-7 items-center justify-between gap-3 rounded-md bg-emerald-50/70 px-2 dark:bg-emerald-950/20">
                      <span className="text-[11px] font-medium text-muted-foreground">Credit</span>
                      <span className="text-[13px] font-semibold text-green-600" data-testid={view === "all" ? `text-client-deposit-${client.id}` : undefined}>
                        {totalDeposit.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex min-h-7 items-center justify-between gap-3 rounded-md bg-rose-50/70 px-2 dark:bg-rose-950/20">
                      <span className="text-[11px] font-medium text-muted-foreground">Due</span>
                      <span className={`text-[13px] font-bold ${totalDue > 0 ? "text-destructive" : "text-primary"}`} data-testid={view === "all" ? `text-client-balance-${client.id}` : undefined}>
                        {totalDue.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {view === "company" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-orange-500"
                        onClick={(event) => {
                          event.stopPropagation();
                          updateClientCompanyMutation.mutate(
                            { clientId: client.id, company: "" },
                            { onSuccess: () => { toast({ title: `${client.name} removed from ${companyName}` }); } },
                          );
                        }}
                        data-testid={getActionTestId("remove", client.id)}
                        title="Remove from Company"
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-500"
                      onClick={(event) => {
                        event.stopPropagation();
                        downloadClientPDF(client);
                      }}
                      data-testid={getActionTestId("pdf", client.id)}
                      title="Print Client Summary"
                    >
                      <Download className="h-4 w-4" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-green-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        downloadClientExcel(client);
                      }}
                      data-testid={getActionTestId("excel", client.id)}
                      title="Download Excel Summary"
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                    </Button>

                    {!isBroker && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-blue-600"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMergeSourceId(client.id);
                          setMergeSourceSearch(client.name + " - " + (client.phone || "") + (client.billNumber ? ` (${client.billNumber})` : ""));
                          setShowMergeDialog(true);
                        }}
                        title="Merge Client"
                        data-testid={getActionTestId("merge", client.id)}
                      >
                        <Merge className="h-4 w-4" />
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditingClient(client);
                      }}
                      data-testid={getActionTestId("edit", client.id)}
                      title="Edit Client"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDelete(client);
                      }}
                      title="Delete Client"
                      data-testid={getActionTestId("delete", client.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        onSearch={() => undefined}
        searchValue=""
        onAddClick={() => setIsCreateOpen(true)}
        addButtonLabel="Add Client"
        pageTitle="Clients"
        compactMobile
        showSearch={false}
      />

      <main className={`flex-1 min-h-0 container mx-auto ${isMobile ? "px-2.5 py-2" : "px-4 py-6"} ${clientsTab === "company" ? "overflow-auto" : "overflow-hidden flex flex-col"}`}>
          <div className="mb-3 shrink-0">
            {isMobile ? (
              <div className="w-full">
                <button
                  type="button"
                  className={`flex w-full min-w-0 items-center gap-2 rounded-[18px] border px-2.5 py-2.5 shadow-[0_16px_30px_-26px_rgba(15,23,42,0.55)] transition-all ${
                    isMobileClientSearchOpen
                      ? "border-primary/30 bg-primary/[0.07]"
                      : "border-border/60 bg-card/95"
                  }`}
                  onClick={() => setIsMobileClientSearchOpen((open) => !open)}
                  aria-expanded={isMobileClientSearchOpen}
                  data-testid="button-toggle-mobile-clients-search"
                >
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background shadow-sm">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Search
                    </p>
                    <p className="truncate text-[12px] font-semibold text-foreground">
                      {mobileClientSearchSummaryLabel}
                    </p>
                  </div>
                  {hasActiveClientSearchFilters ? (
                    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                      {activeClientSearchFilterCount}
                    </span>
                  ) : null}
                  {isMobileClientSearchOpen ? (
                    <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>

                <div className={`grid transition-all duration-300 ease-out ${isMobileClientSearchOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-90"}`}>
                  <div className="min-h-0 overflow-hidden">
                    <div className="mt-2 overflow-hidden rounded-[16px] border border-border/60 bg-card/95 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.4)]">
                      <div className="bg-gradient-to-b from-background via-background to-primary/5 px-2.5 pb-2.5 pt-2">
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              Search Clients
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              Narrow results with one or more fields.
                            </p>
                          </div>
                          {hasActiveClientSearchFilters ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 shrink-0 rounded-full px-2.5 text-[11px]"
                              onClick={clearClientSearchFilters}
                              data-testid="button-clear-mobile-clients-search-filters"
                            >
                              Clear
                            </Button>
                          ) : null}
                        </div>
                        {clientSearchFields}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[20px] border border-border/70 bg-card/95 px-3 py-2.5 shadow-[0_18px_36px_-30px_rgba(15,23,42,0.45)]">
                <div className={hasActiveClientSearchFilters ? "mb-2 flex justify-end" : "hidden"}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-full px-2.5 text-[11px]"
                    onClick={clearClientSearchFilters}
                    data-testid="button-clear-client-search-filters"
                  >
                    Clear
                  </Button>
                </div>
                {clientSearchFields}
              </div>
            )}
          </div>

          <div className={`grid ${isMobile ? "mb-3 grid-cols-2 gap-1.5" : "mb-6 grid-cols-1 gap-4 md:grid-cols-4"}`}>
            <div className={`bg-card rounded-lg border ${isMobile ? "p-2.5" : "p-4"}`}>
              <div className={`flex items-center ${isMobile ? "gap-2" : "gap-3"}`}>
                <div className={`${isMobile ? "h-8 w-8" : "w-10 h-10"} rounded-full bg-primary/10 flex items-center justify-center shrink-0`}>
                  <Users className={`${isMobile ? "h-3.5 w-3.5" : "w-5 h-5"} text-primary`} />
                </div>
                <div className="min-w-0">
                  <p className={`${isMobile ? "text-[10px]" : "text-sm"} text-muted-foreground leading-snug`}>Total Clients</p>
                  <p
                    className={`${isMobile ? "text-base" : "text-2xl"} font-bold text-foreground leading-tight`}
                    data-testid="text-total-clients"
                  >
                    {displayedClients.length}
                  </p>
                </div>
              </div>
            </div>

            <Popover open={billsPopoverOpen} onOpenChange={setBillsPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={`bg-card rounded-lg border text-left transition-all hover-elevate ${isMobile ? "p-2.5" : "p-4"} ${billsPopoverOpen ? "ring-2 ring-blue-500/40" : ""}`}
                  data-testid="card-total-bills"
                >
                  <div className={`flex items-center ${isMobile ? "gap-2" : "gap-3"}`}>
                    <div className={`${isMobile ? "h-8 w-8" : "w-10 h-10"} rounded-full bg-blue-500/10 flex items-center justify-center shrink-0`}>
                      <Receipt className={`${isMobile ? "h-3.5 w-3.5" : "w-5 h-5"} text-blue-500`} />
                    </div>
                    <div className="min-w-0">
                      <p className={`${isMobile ? "text-[10px]" : "text-sm"} text-muted-foreground leading-snug`}>Total Bills</p>
                      <p
                        className={`${isMobile ? "text-base" : "text-2xl"} font-bold text-blue-600 leading-tight`}
                        data-testid="text-total-amount"
                      >
                        {totalBillsCardAmount.toFixed(2)} AED
                      </p>
                    </div>
                  </div>
                </button>
              </PopoverTrigger>
              <PopoverContent
                className={isMobile ? "w-[calc(100vw-1.5rem)] max-w-md p-0" : "w-[520px] p-0"}
                align={isMobile ? "center" : "start"}
              >
                <div className="border-b px-4 py-3">
                  <h4 className="text-sm font-semibold text-foreground">Paid Bills All Time</h4>
                  <p className="text-xs text-muted-foreground">
                    Total paid bills all time: {totalPaidBillsAllTime.toFixed(2)} AED
                  </p>
                </div>
                <div className="max-h-[360px] overflow-auto">
                  {isPaidBillEntriesLoading ? (
                    <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading paid bills...
                    </div>
                  ) : paidBillEntries.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Bill #</TableHead>
                          <TableHead>Client</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paidBillEntries.map(({ bill, client, primaryOrder, paidAmountValue, finalAmountValue }) => (
                          <TableRow
                            key={bill.id}
                            className="cursor-pointer transition-colors hover:bg-muted/50"
                            onClick={() => {
                              if (!primaryOrder) return;
                              const params = new URLSearchParams({
                                focusOrderId: String(primaryOrder.id),
                              });

                              if (primaryOrder.entryDate) {
                                try {
                                  params.set("focusDate", format(new Date(primaryOrder.entryDate), "yyyy-MM-dd"));
                                } catch {
                                  // Ignore invalid dates and fall back to ID-only focus.
                                }
                              }

                              setBillsPopoverOpen(false);
                              navigate(`/orders?${params.toString()}`);
                            }}
                            data-testid={`row-bill-order-${bill.id}`}
                          >
                            <TableCell className="font-mono font-medium text-primary">
                              #{bill.referenceNumber || bill.id}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium text-foreground">
                                  {client?.name || bill.customerName || primaryOrder?.customerName || "Walk-in"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  Final: {finalAmountValue.toFixed(2)} AED
                                </span>
                                {bill.billDate ? (
                                  <span className="text-xs text-muted-foreground">
                                    {format(new Date(bill.billDate), "dd/MM/yyyy")}
                                  </span>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-blue-600">
                              {paidAmountValue.toFixed(2)} AED
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No paid bills found right now.
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <Popover open={creditsPopoverOpen} onOpenChange={setCreditsPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={`bg-card rounded-lg border text-left transition-all hover-elevate ${isMobile ? "p-2.5" : "p-4"} ${creditsPopoverOpen ? "ring-2 ring-green-500/40" : ""}`}
                  data-testid="card-total-system-credits"
                >
                  <div className={`flex items-center ${isMobile ? "gap-2" : "gap-3"}`}>
                    <div className={`${isMobile ? "h-8 w-8" : "w-10 h-10"} rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0`}>
                      <Wallet className={`${isMobile ? "h-3.5 w-3.5" : "w-5 h-5"} text-emerald-600`} />
                    </div>
                    <div className="min-w-0">
                      <p className={`${isMobile ? "text-[10px]" : "text-sm"} text-muted-foreground leading-snug`}>
                        {isMobile ? "Accumulated Credits" : "Total Accumulated Credits"}
                      </p>
                      <p
                        className={`${isMobile ? "text-base" : "text-2xl"} font-bold text-emerald-600 leading-tight`}
                        data-testid="text-total-system-credits"
                      >
                        {totalSystemCredits.toFixed(2)} AED
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {creditedAccounts.length} account{creditedAccounts.length === 1 ? "" : "s"} with credit
                      </p>
                    </div>
                  </div>
                </button>
              </PopoverTrigger>
              <PopoverContent
                className={isMobile ? "w-[calc(100vw-1.5rem)] max-w-md p-0" : "w-[520px] p-0"}
                align={isMobile ? "center" : "start"}
              >
                <div className="border-b px-4 py-3">
                  <h4 className="text-sm font-semibold text-foreground">Accounts With Accumulated Credits</h4>
                  <p className="text-xs text-muted-foreground">
                    Total accumulated credits: {totalSystemCredits.toFixed(2)} AED
                  </p>
                </div>
                <div className="max-h-[360px] overflow-auto">
                  {creditedAccounts.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account</TableHead>
                          <TableHead>Client</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {creditedAccounts.map(({ client, creditAmount }) => (
                          <TableRow
                            key={client.id}
                            className="cursor-pointer transition-colors hover:bg-muted/50"
                            onClick={() => {
                              setCreditsPopoverOpen(false);
                              setTransactionClient(client);
                            }}
                            data-testid={`row-credit-account-${client.id}`}
                          >
                            <TableCell className="text-xs font-medium text-muted-foreground">
                              {client.billNumber || `ACC-${String(client.id).padStart(4, "0")}`}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium text-foreground">{client.name}</span>
                                {client.phone && (
                                  <PhoneNumberWithFlag
                                    phone={client.phone}
                                    textClassName="text-xs text-muted-foreground"
                                  />
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-emerald-600">
                              {creditAmount.toFixed(2)} AED
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No client accounts have accumulated credits right now.
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <Popover open={duePopoverOpen} onOpenChange={setDuePopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={`bg-card rounded-lg border text-left transition-all hover-elevate ${isMobile ? "p-2.5" : "p-4"} ${duePopoverOpen ? "ring-2 ring-destructive/40" : ""}`}
                  data-testid="card-total-due"
                >
                  <div className={`flex items-center ${isMobile ? "gap-2" : "gap-3"}`}>
                    <div className={`${isMobile ? "h-8 w-8" : "w-10 h-10"} rounded-full bg-destructive/10 flex items-center justify-center shrink-0`}>
                      <Receipt className={`${isMobile ? "h-3.5 w-3.5" : "w-5 h-5"} text-destructive`} />
                    </div>
                    <div className="min-w-0">
                      <p className={`${isMobile ? "text-[10px]" : "text-sm"} text-muted-foreground leading-snug`}>
                        {isMobile ? `Due (${dueClientsCount})` : `Total Due (${dueClientsCount} clients)`}
                      </p>
                      <p
                        className={`${isMobile ? "text-base" : "text-2xl"} font-bold text-destructive leading-tight`}
                        data-testid="text-total-balance"
                      >
                        {totalDueCardAmount.toFixed(2)} AED
                      </p>
                    </div>
                  </div>
                </button>
              </PopoverTrigger>
              <PopoverContent
                className={isMobile ? "w-[calc(100vw-1.5rem)] max-w-md p-0" : "w-[520px] p-0"}
                align={isMobile ? "center" : "start"}
              >
                <div className="border-b px-4 py-3">
                  <h4 className="text-sm font-semibold text-foreground">Clients With Outstanding Balance</h4>
                  <p className="text-xs text-muted-foreground">
                    All-time due amount: {totalDueCardAmount.toFixed(2)} AED
                  </p>
                </div>
                <div className="max-h-[360px] overflow-auto">
                  {dueAccounts.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account</TableHead>
                          <TableHead>Client</TableHead>
                          <TableHead className="text-right">Due</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dueAccounts.map(({ client, dueAmount, creditAmount }) => (
                          <TableRow
                            key={client.id}
                            className="cursor-pointer transition-colors hover:bg-muted/50"
                            onClick={() => {
                              setDuePopoverOpen(false);
                              setTransactionClient(client);
                            }}
                            data-testid={`row-due-account-${client.id}`}
                          >
                            <TableCell className="text-xs font-medium text-muted-foreground">
                              {client.billNumber || `ACC-${String(client.id).padStart(4, "0")}`}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium text-foreground">{client.name}</span>
                                {client.phone && (
                                  <PhoneNumberWithFlag
                                    phone={client.phone}
                                    textClassName="text-xs text-muted-foreground"
                                  />
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-destructive">
                              {dueAmount.toFixed(2)} AED
                            </TableCell>
                            <TableCell className="text-right font-medium text-emerald-600">
                              {creditAmount.toFixed(2)} AED
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No client accounts have outstanding balance right now.
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

        <div className={isMobile ? "mb-2.5 space-y-1.5" : "mb-4 flex items-center gap-4 flex-wrap"}>
          <div className={isMobile ? "grid grid-cols-3 gap-0.5 rounded-lg border bg-card p-0.5" : "flex rounded-md border overflow-visible"}>
            <Button
              variant={clientsTab === "all" ? "default" : "ghost"}
              size="sm"
              onClick={() => setClientsTab("all")}
              className={isMobile ? "h-7 rounded-md px-1.5 text-[11px] font-medium" : "rounded-none rounded-l-md"}
              data-testid="tab-all-clients"
            >
              <Users className={`${isMobile ? "mr-1 h-3 w-3" : "w-4 h-4 mr-1"}`} />
              {isMobile ? "All" : "All Clients"}
            </Button>
            <Button
              variant={clientsTab === "company" ? "default" : "ghost"}
              size="sm"
              onClick={() => setClientsTab("company")}
              className={isMobile ? "h-7 rounded-md px-1.5 text-[11px] font-medium" : "rounded-none"}
              data-testid="tab-by-company"
            >
              <Building2 className={`${isMobile ? "mr-1 h-3 w-3" : "w-4 h-4 mr-1"}`} />
              {isMobile ? "Company" : "By Company"}
            </Button>
            <Button
              variant={clientsTab === "broker" ? "default" : "ghost"}
              size="sm"
              onClick={() => setClientsTab("broker")}
              className={isMobile ? "h-7 rounded-md px-1.5 text-[11px] font-medium" : "rounded-none rounded-r-md"}
              data-testid="tab-by-broker"
            >
              <User className={`${isMobile ? "mr-1 h-3 w-3" : "w-4 h-4 mr-1"}`} />
              {isMobile ? "Broker" : "By Broker"}
            </Button>
          </div>
          {clientsTab === "company" && (
            <Button
              size="sm"
              onClick={() => { setNewCompanyName(""); setShowAddCompanyDialog(true); }}
              className={isMobile ? "h-7 px-2.5 text-[11px]" : ""}
              data-testid="button-add-company"
            >
              <Plus className={`${isMobile ? "mr-1 h-3 w-3" : "w-4 h-4 mr-1"}`} />
              Add Company
            </Button>
          )}
          <div className={isMobile ? "flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5" : "flex items-center gap-2"}>
            <ArrowUpDown className={`${isMobile ? "h-3 w-3" : "w-4 h-4"} text-muted-foreground`} />
            {!isMobile && <span className="text-sm text-muted-foreground whitespace-nowrap">Sort by:</span>}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className={`${isMobile ? "h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-[11px]" : "h-9 rounded-md border border-input bg-background px-3 text-sm"}`}
              data-testid="select-sort-clients"
            >
              <option value="alphabetical">{isMobile ? "A-Z" : "A - Z (Alphabetical)"}</option>
              <option value="newest">{isMobile ? "Newest" : "Newest First"}</option>
              <option value="oldest">{isMobile ? "Oldest" : "Oldest First"}</option>
              <option value="high_unpaid">{isMobile ? "Unpaid" : "Highest Unpaid Bills"}</option>
              <option value="total_credits">{isMobile ? "Credits" : "Highest Credits"}</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-10 h-10 animate-spin mb-4 text-primary" />
            <p>Loading clients...</p>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-20 text-destructive">
            <p className="font-semibold text-lg">Failed to load clients</p>
            <p className="text-sm opacity-80">
              Please try refreshing the page.
            </p>
          </div>
        ) : displayedClients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-lg bg-card/50">
            <Users className="w-16 h-16 mb-4 opacity-50" />
            <h3 className="text-xl font-bold text-foreground mb-2">
              No clients found
            </h3>
            <p className="max-w-md text-center">
              {hasClientSearchFilters(debouncedClientSearchFilters)
                ? "No clients match the current search filters. Try changing or clearing a field."
                : "Your client list is empty. Click the 'Add Client' button to get started."}
            </p>
          </div>
        ) : clientsTab === "broker" ? (
          <div className="space-y-3" data-testid="broker-view">
            {(() => {
              if (brokerClients.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-3xl bg-card/50">
                    <User className="w-16 h-16 mb-4 opacity-50" />
                    <h3 className="text-xl font-bold text-foreground mb-2">No broker clients found</h3>
                    <p>Create a client with type "Broker" to see them here.</p>
                  </div>
                );
              }
              if (isMobile) {
                return (
                  <div ref={clientListScrollRef} className="flex-1 min-h-0 overflow-y-auto pb-4">
                    {clientListStatus}
                    {renderMobileClientList(visibleCurrentTabClients, "broker")}
                    {clientListLoadMoreFooter}
                  </div>
                );
              }

              return (
                <div className="bg-card rounded-lg border overflow-hidden flex flex-1 min-h-0 flex-col">
                  {clientListStatus}
                  <div ref={clientListScrollRef} className="min-h-0 flex-1 overflow-auto">
                  <Table className={mobileTableClassName}>
                    <TableHeader>
                      <TableRow className="bg-violet-50 dark:bg-violet-950/30">
                        <TableHead className="font-bold text-foreground w-16">No.</TableHead>
                        <TableHead className="font-bold text-foreground">Broker Name</TableHead>
                        <TableHead className="font-bold text-foreground">Phone / Address</TableHead>
                        <TableHead className="font-bold text-foreground text-right">Total Bill</TableHead>
                        <TableHead className="font-bold text-foreground text-right">Account Credit Available</TableHead>
                        <TableHead className="font-bold text-foreground text-right">Due</TableHead>
                        <TableHead className="font-bold text-foreground text-center w-40">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleCurrentTabClients.map((client, index) => {
                        const totalBill = getClientTotalBills(client);
                        const totalDeposit = getClientTotalDeposits(client);
                        const due = getClientBalanceDue(client);
                        return (
                          <TableRow
                            key={client.id}
                            className={`${index % 2 === 0 ? "bg-background" : "bg-muted/30"} cursor-pointer transition-colors hover:bg-muted/50`}
                            data-testid={`row-broker-${client.id}`}
                            onClick={() => setTransactionClient(client)}
                          >
                            <TableCell className="font-medium text-muted-foreground">{index + 1}</TableCell>
                            <TableCell className="font-semibold">
                              <div className={`flex items-center flex-wrap ${isMobile ? "gap-1.5" : "gap-2"}`}>
                                <User className={`${isMobile ? "h-3.5 w-3.5" : "w-4 h-4"} text-violet-500`} />
                                <button
                                  type="button"
                                  className="text-left transition-colors hover:text-primary hover:underline underline-offset-2"
                                  onClick={(event) => openClientEditDialog(event, client)}
                                >
                                  {client.name}
                                </button>
                                {client.billNumber && (
                                  <span className={`${isMobile ? "text-[10px]" : "text-xs"} text-muted-foreground`}>({client.billNumber})</span>
                                )}
                                <Badge variant="secondary" className={`${isMobile ? "px-1.5 py-0 text-[10px]" : "text-xs"} bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border-violet-200 dark:border-violet-700`}>
                                  Broker
                                </Badge>
                                {!isMobile && <Wallet className="w-3 h-3 opacity-50" />}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className={isMobile ? "space-y-0.5" : "space-y-1"}>
                                {client.phone && (
                                  <div>
                                    <PhoneNumberWithFlag
                                      phone={client.phone}
                                      textClassName={isMobile ? "text-[11px]" : "text-sm"}
                                    />
                                  </div>
                                )}
                                {client.address && (
                                  <div>
                                    <AddressTextWithIcon
                                      address={client.address}
                                      textClassName={`${isMobile ? "text-[11px]" : "text-sm"} text-muted-foreground`}
                                    />
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium text-blue-600">{totalBill.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-medium text-green-600">{totalDeposit.toFixed(2)}</TableCell>
                            <TableCell className={`text-right font-bold ${due > 0 ? "text-destructive" : "text-primary"}`}>
                              {due.toFixed(2)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={`${isMobile ? "h-7 w-7" : "h-8 w-8"} text-red-500`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    downloadClientPDF(client);
                                  }}
                                  data-testid={`button-pdf-broker-${client.id}`}
                                  title="Print Client Summary"
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={`${isMobile ? "h-7 w-7" : "h-8 w-8"} text-green-600`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    downloadClientExcel(client);
                                  }}
                                  data-testid={`button-excel-broker-${client.id}`}
                                  title="Download Excel Summary"
                                >
                                  <FileSpreadsheet className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={isMobile ? "h-7 w-7" : "h-8 w-8"}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setEditingClient(client);
                                  }}
                                  data-testid={`button-edit-broker-${client.id}`}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={`${isMobile ? "h-7 w-7" : "h-8 w-8"} text-destructive`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleDelete(client);
                                  }}
                                  title="Delete Client"
                                  data-testid={`button-delete-broker-${client.id}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {clientListLoadMoreFooter}
                  </div>
                </div>
              );
            })()}
          </div>
        ) : clientsTab === "all" ? (
          isMobile ? (
          <div ref={clientListScrollRef} className="flex-1 min-h-0 overflow-y-auto pb-4">
            {clientListStatus}
            {renderMobileClientList(visibleCurrentTabClients, "all")}
            {clientListLoadMoreFooter}
          </div>
          ) : (
          <div className="bg-card rounded-lg border overflow-hidden flex flex-1 min-h-0 flex-col">
            {clientListStatus}
            <div ref={clientListScrollRef} className="min-h-0 flex-1 overflow-auto">
            <Table className={mobileTableClassName}>
              <TableHeader>
                <TableRow className="bg-primary/10">
                  <TableHead className="font-bold text-foreground w-16">
                    No.
                  </TableHead>
                  <TableHead className="font-bold text-foreground">
                    Client Name
                  </TableHead>
                  <TableHead className="font-bold text-foreground">
                    Phone / Address
                  </TableHead>
                  <TableHead className="font-bold text-foreground text-right">
                    Total Bill
                  </TableHead>
                  <TableHead className="font-bold text-foreground text-right">
                    Account Credit Available
                  </TableHead>
                  <TableHead className="font-bold text-foreground text-right">
                    Due
                  </TableHead>
                  <TableHead className="font-bold text-foreground text-center w-40">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleCurrentTabClients.map((client, index) => {
                  const isHighlighted = highlightedClientId === client.id;
                  return (
                  <TableRow
                    key={client.id}
                    className={`${
                      index % 2 === 0 ? "bg-background" : "bg-muted/30"
                    } cursor-pointer transition-colors ${isHighlighted ? "bg-primary/5 animate-order-focus-glow" : "hover:bg-muted/50"}`}
                    data-testid={`row-client-${client.id}`}
                    onClick={() => setTransactionClient(client)}
                  >
                    <TableCell
                      className="font-medium text-muted-foreground"
                      data-testid={`text-serial-${client.id}`}
                    >
                      {index + 1}
                    </TableCell>
                    <TableCell
                      className="font-semibold"
                      data-testid={`text-client-name-${client.id}`}
                    >
                      <div className={`flex items-center flex-wrap ${isMobile ? "gap-1.5" : "gap-2"}`}>
                        <button
                          type="button"
                          className="text-left transition-colors hover:text-primary hover:underline underline-offset-2"
                          onClick={(event) => openClientEditDialog(event, client)}
                        >
                          {client.name}
                        </button>
                        {client.billNumber && (
                          <span className={`${isMobile ? "text-[10px]" : "text-xs"} text-muted-foreground`}>
                            ({client.billNumber})
                          </span>
                        )}
                        {((client as any).clientType || '').trim().toLowerCase() === 'broker' ? (
                          <Badge variant="secondary" className={`${isMobile ? "px-1.5 py-0 text-[10px]" : "text-xs"} bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border-violet-200 dark:border-violet-700`}>
                            <User className="w-3 h-3 mr-1" />
                            Broker
                          </Badge>
                        ) : client.company ? (
                          <Badge variant="secondary" className={`${isMobile ? "px-1.5 py-0 text-[10px]" : "text-xs"} bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-700`}>
                            <Building2 className="w-3 h-3 mr-1" />
                            {client.company}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className={`${isMobile ? "px-1.5 py-0 text-[10px]" : "text-xs"} text-muted-foreground`}>
                            Regular
                          </Badge>
                        )}
                        {!isMobile && <Wallet className="w-3 h-3 opacity-50" />}
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-client-contact-${client.id}`}>
                      <div className={isMobile ? "space-y-0.5" : "space-y-1"}>
                        {client.phone && (
                          <div>
                            <PhoneNumberWithFlag
                              phone={client.phone}
                              textClassName={isMobile ? "text-[11px]" : "text-sm"}
                            />
                          </div>
                        )}
                        {client.address && (
                          <div>
                            <AddressTextWithIcon
                              address={client.address}
                              textClassName={`${isMobile ? "text-[11px]" : "text-sm"} text-muted-foreground`}
                            />
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell
                      className="text-right font-medium text-blue-600"
                      data-testid={`text-client-amount-${client.id}`}
                    >
                      {getClientTotalBills(client).toFixed(2)}
                    </TableCell>
                    <TableCell
                      className="text-right font-medium text-green-600"
                      data-testid={`text-client-deposit-${client.id}`}
                    >
                      {getClientTotalDeposits(client).toFixed(2)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-bold ${getClientBalanceDue(client) > 0 ? "text-destructive" : "text-primary"}`}
                      data-testid={`text-client-balance-${client.id}`}
                    >
                      {getClientBalanceDue(client).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`${isMobile ? "h-7 w-7" : "h-8 w-8"} text-red-500`}
                          onClick={(event) => {
                            event.stopPropagation();
                            downloadClientPDF(client);
                          }}
                          data-testid={`button-pdf-${client.id}`}
                          title="Print Client Summary"
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`${isMobile ? "h-7 w-7" : "h-8 w-8"} text-green-600`}
                          onClick={(event) => {
                            event.stopPropagation();
                            downloadClientExcel(client);
                          }}
                          data-testid={`button-excel-${client.id}`}
                          title="Download Excel Summary"
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                        </Button>
                        {((client as any).clientType || '').trim().toLowerCase() !== 'broker' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`${isMobile ? "h-7 w-7" : "h-8 w-8"} text-blue-600`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setMergeSourceId(client.id);
                            setMergeSourceSearch(client.name + " - " + (client.phone || "") + (client.billNumber ? ` (${client.billNumber})` : ""));
                            setShowMergeDialog(true);
                          }}
                          title="Merge Client"
                          data-testid={`button-merge-${client.id}`}
                        >
                          <Merge className="w-4 h-4" />
                        </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className={isMobile ? "h-7 w-7" : "h-8 w-8"}
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditingClient(client);
                          }}
                          data-testid={`button-edit-${client.id}`}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`${isMobile ? "h-7 w-7" : "h-8 w-8"} text-destructive`}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDelete(client);
                          }}
                          title="Delete Client"
                          data-testid={`button-delete-${client.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {clientListLoadMoreFooter}
            </div>
          </div>
          )
        ) : (
          <div className="space-y-3" data-testid="company-view">
            {Array.from(companiesGrouped.companies.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([companyName, companyClients]) => {
                const isExpanded = expandedCompanies.has(companyName);
                const companyTotalBills = companyClients.reduce((sum, c) => sum + getClientTotalBills(c), 0);
                const companyTotalDeposits = companyClients.reduce((sum, c) => sum + getClientTotalDeposits(c), 0);
                const companyTotalDue = companyClients.reduce((sum, c) => sum + getClientBalanceDue(c), 0);
                return (
                  <div key={companyName} className="bg-card rounded-lg border overflow-hidden" data-testid={`company-group-${companyName}`}>
                    {isMobile ? (
                      <div className="p-2.5">
                        <button
                          type="button"
                          className="w-full rounded-xl border border-border/80 bg-gradient-to-br from-background via-background to-muted/30 p-3 text-left shadow-sm transition-all hover:border-primary/30 hover:bg-muted/20"
                          onClick={() => toggleCompany(companyName)}
                          data-testid={`button-toggle-company-${companyName}`}
                        >
                          <div className="flex items-start gap-2.5">
                            <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${isExpanded ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground"}`}>
                              {isExpanded ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-[15px] font-bold text-foreground">{companyName}</span>
                                <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                                  {companyClients.length} {companyClients.length === 1 ? "client" : "clients"}
                                </Badge>
                              </div>
                              <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
                                <div className="rounded-lg bg-blue-50 px-2 py-1.5 text-center dark:bg-blue-950/20">
                                  <p className="text-[10px] text-muted-foreground">Bill</p>
                                  <p className="font-semibold text-blue-600">{companyTotalBills.toFixed(2)} AED</p>
                                </div>
                                <div className="rounded-lg bg-green-50 px-2 py-1.5 text-center dark:bg-green-950/20">
                                  <p className="text-[10px] text-muted-foreground">Credit</p>
                                  <p className="font-semibold text-green-600">{companyTotalDeposits.toFixed(2)} AED</p>
                                </div>
                                <div className="rounded-lg bg-red-50 px-2 py-1.5 text-center dark:bg-red-950/20">
                                  <p className="text-[10px] text-muted-foreground">Due</p>
                                  <p className={`font-semibold ${companyTotalDue > 0 ? "text-destructive" : "text-primary"}`}>{companyTotalDue.toFixed(2)} AED</p>
                                </div>
                              </div>
                            </div>
                            <div className="mt-1 shrink-0 text-muted-foreground">
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </div>
                          </div>
                        </button>
                        <div className={`mt-2 grid gap-1.5 ${companyTotalDue > 0 ? "grid-cols-[minmax(0,1fr)_2.25rem_2.25rem_auto]" : "grid-cols-[2.25rem_2.25rem_minmax(0,1fr)]"}`}>
                          {companyTotalDue > 0 && (
                            <Button
                              variant="default"
                              size="sm"
                              className="h-8 justify-center rounded-lg px-2 text-[11px]"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/bills?payCompany=${encodeURIComponent(companyName)}`);
                              }}
                              data-testid={`button-company-pay-all-${companyName}`}
                              title="Pay all unpaid bills for this company"
                            >
                              <DollarSign className="mr-1 h-3.5 w-3.5" />
                              Pay All
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg border border-border/70"
                            onClick={(e) => { e.stopPropagation(); downloadCompanyPDF(companyName, companyClients); }}
                            data-testid={`button-company-pdf-${companyName}`}
                            title="Download Company PDF Report"
                          >
                            <Download className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg border border-border/70"
                            onClick={(e) => { e.stopPropagation(); downloadCompanyExcel(companyName, companyClients); }}
                            data-testid={`button-company-excel-${companyName}`}
                            title="Download Company Excel Report"
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5 text-green-600" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg px-2 text-[11px]"
                            onClick={(e) => {
                              e.stopPropagation();
                              setManagingCompany(companyName);
                              setSelectedClientsToAdd(new Set());
                              setAddClientsSearch("");
                            }}
                            data-testid={`button-manage-clients-${companyName}`}
                            title="Add or remove clients"
                          >
                            <UserPlus className="mr-1 h-3.5 w-3.5" />
                            Manage
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg px-2 text-[11px] text-orange-600 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/20"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDisperseCompany(companyName);
                            }}
                            disabled={disperseCompanyMutation.isPending}
                            data-testid={`button-disperse-company-${companyName}`}
                            title="Remove the company and keep its clients unassigned"
                          >
                            <UserMinus className="mr-1 h-3.5 w-3.5" />
                            Disperse
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 p-4">
                        <button
                          type="button"
                          className="flex-1 flex items-center gap-3 hover-elevate text-left rounded-md p-0"
                          onClick={() => toggleCompany(companyName)}
                          data-testid={`button-toggle-company-${companyName}`}
                        >
                          {isExpanded ? <FolderOpen className="w-5 h-5 text-primary" /> : <Folder className="w-5 h-5 text-muted-foreground" />}
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          <div className="flex-1 flex items-center gap-3 flex-wrap">
                            <span className="font-bold text-foreground text-lg">{companyName}</span>
                            <Badge variant="secondary">{companyClients.length} {companyClients.length === 1 ? "client" : "clients"}</Badge>
                          </div>
                          <div className="flex items-center gap-4 text-sm">
                            <span className="text-blue-600 font-medium">{companyTotalBills.toFixed(2)} AED</span>
                            <span className="text-green-600 font-medium">{companyTotalDeposits.toFixed(2)} AED</span>
                            <span className={`font-bold ${companyTotalDue > 0 ? "text-destructive" : "text-primary"}`}>{companyTotalDue.toFixed(2)} Due</span>
                          </div>
                        </button>
                        <div className="flex items-center gap-1">
                          {companyTotalDue > 0 && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/bills?payCompany=${encodeURIComponent(companyName)}`);
                              }}
                              data-testid={`button-company-pay-all-${companyName}`}
                              title="Pay all unpaid bills for this company"
                            >
                              <DollarSign className="w-4 h-4 mr-1" />
                              Pay All
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); downloadCompanyPDF(companyName, companyClients); }}
                            data-testid={`button-company-pdf-${companyName}`}
                            title="Download Company PDF Report"
                          >
                            <Download className="w-4 h-4 text-red-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); downloadCompanyExcel(companyName, companyClients); }}
                            data-testid={`button-company-excel-${companyName}`}
                            title="Download Company Excel Report"
                          >
                            <FileSpreadsheet className="w-4 h-4 text-green-600" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setManagingCompany(companyName);
                              setSelectedClientsToAdd(new Set());
                              setAddClientsSearch("");
                            }}
                            data-testid={`button-manage-clients-${companyName}`}
                            title="Add or remove clients"
                          >
                            <UserPlus className="w-4 h-4 mr-1" />
                            Manage
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-orange-600 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/20"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDisperseCompany(companyName);
                            }}
                            disabled={disperseCompanyMutation.isPending}
                            data-testid={`button-disperse-company-${companyName}`}
                            title="Remove the company and keep its clients unassigned"
                          >
                            <UserMinus className="w-4 h-4 mr-1" />
                            Disperse
                          </Button>
                        </div>
                      </div>
                    )}
                    {isExpanded && (
                      <div className="border-t">
                        {isMobile ? (
                          renderMobileClientList(companyClients, "company", companyName)
                        ) : (
                        <Table className={mobileTableClassName}>
                          <TableHeader>
                            <TableRow className="bg-primary/5">
                              <TableHead className="font-bold text-foreground w-16">No.</TableHead>
                              <TableHead className="font-bold text-foreground">Client Name</TableHead>
                              <TableHead className="font-bold text-foreground">Phone / Address</TableHead>
                              <TableHead className="font-bold text-foreground text-right">Total Bill</TableHead>
                              <TableHead className="font-bold text-foreground text-right">Account Credit Available</TableHead>
                              <TableHead className="font-bold text-foreground text-right">Due</TableHead>
                              <TableHead className="font-bold text-foreground text-center w-48">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {companyClients.map((client, idx) => (
                              <TableRow
                                key={client.id}
                                className={`${idx % 2 === 0 ? "bg-background" : "bg-muted/30"} cursor-pointer transition-colors hover:bg-muted/50`}
                                data-testid={`row-company-client-${client.id}`}
                                onClick={() => setTransactionClient(client)}
                              >
                                <TableCell className="font-medium text-muted-foreground">{idx + 1}</TableCell>
                                <TableCell className="font-semibold">
                                  <div className={`flex items-center ${isMobile ? "gap-1.5" : "gap-2"}`}>
                                    <button
                                      type="button"
                                      className="text-left transition-colors hover:text-primary hover:underline underline-offset-2"
                                      onClick={(event) => openClientEditDialog(event, client)}
                                    >
                                      {client.name}
                                    </button>
                                    {client.billNumber && <span className={`${isMobile ? "text-[10px]" : "text-xs"} text-muted-foreground`}>({client.billNumber})</span>}
                                    {!isMobile && <Wallet className="w-3 h-3 opacity-50" />}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className={isMobile ? "space-y-0.5" : "space-y-1"}>
                                    {client.phone && (
                                      <div>
                                        <PhoneNumberWithFlag
                                          phone={client.phone}
                                          textClassName={isMobile ? "text-[11px]" : "text-sm"}
                                        />
                                      </div>
                                    )}
                                    {client.address && (
                                      <div>
                                        <AddressTextWithIcon
                                          address={client.address}
                                          textClassName={`${isMobile ? "text-[11px]" : "text-sm"} text-muted-foreground`}
                                        />
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-medium text-blue-600">{getClientTotalBills(client).toFixed(2)}</TableCell>
                                <TableCell className="text-right font-medium text-green-600">{getClientTotalDeposits(client).toFixed(2)}</TableCell>
                                <TableCell className={`text-right font-bold ${getClientBalanceDue(client) > 0 ? "text-destructive" : "text-primary"}`}>{getClientBalanceDue(client).toFixed(2)}</TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-center gap-1">
                                    <Button variant="ghost" size="icon" className={`${isMobile ? "h-7 w-7" : ""} text-orange-500`} onClick={(event) => { event.stopPropagation(); updateClientCompanyMutation.mutate({ clientId: client.id, company: "" }, { onSuccess: () => { toast({ title: `${client.name} removed from ${companyName}` }); } }); }} data-testid={`button-remove-company-${client.id}`} title="Remove from Company"><UserMinus className="w-4 h-4" /></Button>
                                    <Button variant="ghost" size="icon" className={`${isMobile ? "h-7 w-7" : ""} text-red-500`} onClick={(event) => { event.stopPropagation(); downloadClientPDF(client); }} data-testid={`button-pdf-company-${client.id}`} title="Print Client Summary"><Download className="w-4 h-4" /></Button>
                                    <Button variant="ghost" size="icon" className={`${isMobile ? "h-7 w-7" : ""} text-green-600`} onClick={(event) => { event.stopPropagation(); downloadClientExcel(client); }} data-testid={`button-excel-company-${client.id}`} title="Download Excel Summary"><FileSpreadsheet className="w-4 h-4" /></Button>
                                    {((client as any).clientType || '').trim().toLowerCase() !== 'broker' && <Button variant="ghost" size="icon" className={`${isMobile ? "h-7 w-7" : ""} text-blue-600`} onClick={(event) => { event.stopPropagation(); setMergeSourceId(client.id); setMergeSourceSearch(client.name + " - " + (client.phone || "") + (client.billNumber ? ` (${client.billNumber})` : "")); setShowMergeDialog(true); }} title="Merge Client" data-testid={`button-merge-company-${client.id}`}><Merge className="w-4 h-4" /></Button>}
                                    <Button variant="ghost" size="icon" className={isMobile ? "h-7 w-7" : ""} onClick={(event) => { event.stopPropagation(); setEditingClient(client); }} data-testid={`button-edit-company-${client.id}`}><Edit className="w-4 h-4" /></Button>
                                    <Button variant="ghost" size="icon" className={`${isMobile ? "h-7 w-7" : ""} text-destructive`} onClick={(event) => { event.stopPropagation(); handleDelete(client); }} data-testid={`button-delete-company-${client.id}`}><Trash2 className="w-4 h-4" /></Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}


            {companiesGrouped.companies.size === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-lg bg-card/50">
                <Building2 className="w-16 h-16 mb-4 opacity-50" />
                <h3 className="text-xl font-bold text-foreground mb-2">No companies yet</h3>
                <p className="max-w-md text-center">Assign clients to a company by editing them and adding a company name.</p>
              </div>
            )}
          </div>
        )}
      </main>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-display text-primary">
              Add New Client
            </DialogTitle>
          </DialogHeader>
          <ClientForm mode="create" onSuccess={() => setIsCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingClient}
        onOpenChange={(open) => !open && setEditingClient(null)}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-display text-primary">
              Edit Client
            </DialogTitle>
          </DialogHeader>
          {editingClient && (
            <ClientForm
              mode="edit"
              client={editingClient}
              onSuccess={(updatedClient) => {
                if (updatedClient && viewingClient && viewingClient.id === editingClient.id) {
                  setViewingClient(updatedClient);
                }
                setEditingClient(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!transactionClient}
        onOpenChange={(open) => !open && closeTransactionDialog()}
      >
        <DialogContent
          aria-describedby={undefined}
          className={
            isMobile
              ? "w-[calc(100vw-1rem)] max-w-none gap-0 overflow-hidden rounded-2xl p-0 max-h-[calc(100dvh-1rem)] [&>button]:hidden"
              : "w-[min(95vw,64rem)] max-w-[64rem] gap-0 overflow-hidden p-0 max-h-[88vh] [&>button]:hidden"
          }
        >
          <div className={isMobile ? "max-h-[calc(100dvh-1rem)] overflow-y-auto" : "max-h-[88vh] overflow-y-auto"}>
          <DialogHeader className={isMobile ? "sticky top-0 z-10 border-b bg-background px-4 pb-3 pt-4 text-center" : "relative px-6 pb-4 pt-5 text-center"}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={isMobile ? "absolute right-3 top-3 h-8 w-8 rounded-full border bg-background/95 text-muted-foreground shadow-sm hover:bg-muted" : "absolute right-0 top-0 h-9 w-9 rounded-full text-muted-foreground hover:bg-muted"}
              onClick={closeTransactionDialog}
              data-testid="button-close-client-transactions"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close transaction history</span>
            </Button>
            <DialogTitle className={isMobile ? "px-10 text-center" : "px-12 text-center"}>
              <span className={isMobile ? "block text-lg font-display leading-tight text-primary" : "block text-2xl font-display leading-tight text-primary"}>
                {transactionClient?.name}
              </span>
              <span className={isMobile ? "mt-1 block text-sm font-medium text-muted-foreground" : "mt-1.5 block text-sm font-medium uppercase tracking-[0.14em] text-muted-foreground"}>
                Account Activity
              </span>
            </DialogTitle>
          </DialogHeader>

          {transactionClient && (
            <div className={isMobile ? "space-y-4 px-3.5 py-3.5" : "space-y-6"}>
              {(() => {
                // Calculate actual unpaid bills due
                const clientUnpaidTotal = unpaidBills?.reduce((sum, bill) => {
                  const total = parseFloat(bill.amount || "0");
                  const paid = parseFloat(bill.paidAmount || "0");
                  return sum + (total - paid);
                }, 0) || 0;
                
                // Calculate credit balance from transactions (deposit - credit deductions)
                const creditBalance = visibleTransactions.reduce((sum, tx) => {
                  if (tx.type === "deposit") {
                    return sum + parseFloat(tx.amount || "0");
                  } else if (isAccountCreditDeductionType(tx.type)) {
                    return sum - parseFloat(tx.amount || "0");
                  }
                  return sum;
                }, 0) || 0;
                
                // Credit Available = credit balance (what's been added minus what's been used)
                const availableCredit = Math.max(0, creditBalance);
                
                // Calculate total paid from payment transactions
                const totalPaid = visibleTransactions.reduce((sum, tx) => {
                  if (tx.type === "payment" || tx.type === "deposit_used" || tx.type === "bulk_deposit_used" || tx.type === "bulk_payment") {
                    return sum + parseFloat(tx.amount || "0");
                  }
                  return sum;
                }, 0);
                
                return (
                  <div className={isMobile ? "grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-3" : "grid grid-cols-3 gap-4 rounded-lg bg-muted/50 p-4"}>
                    <div className={isMobile ? "rounded-lg border bg-background/90 px-2.5 py-2 text-center" : "text-center"}>
                      <p className={isMobile ? "text-[11px] text-muted-foreground" : "text-sm text-muted-foreground"}>Unpaid Bills</p>
                      <p className={isMobile ? "text-lg font-bold text-blue-600" : "text-xl font-bold text-blue-600"}>
                        {clientUnpaidTotal.toFixed(2)} AED
                      </p>
                    </div>
                    <div className={isMobile ? "rounded-lg border bg-background/90 px-2.5 py-2 text-center" : "text-center"}>
                      <p className={isMobile ? "text-[11px] text-muted-foreground" : "text-sm text-muted-foreground"}>Total Paid</p>
                      <p className={isMobile ? "text-lg font-bold text-purple-600" : "text-xl font-bold text-purple-600"}>
                        {totalPaid.toFixed(2)} AED
                      </p>
                    </div>
                    <div className={isMobile ? "col-span-2 rounded-lg border bg-background/90 px-2.5 py-2 text-center" : "text-center"}>
                      <p className={isMobile ? "text-[11px] text-muted-foreground" : "text-sm text-muted-foreground"}>Credits Available</p>
                      <p className={isMobile ? "text-lg font-bold text-green-600" : "text-xl font-bold text-green-600"}>
                        {availableCredit.toFixed(2)} AED
                      </p>
                    </div>
                  </div>
                );
              })()}

              <div className={isMobile ? "grid gap-3" : "grid gap-4 lg:grid-cols-2"}>
                <div className={isMobile ? "overflow-hidden rounded-xl border bg-card" : "rounded-lg border bg-card p-4"}>
                  {isMobile ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-3 text-left"
                      onClick={() => setMobileCreditFormOpen((current) => (current === "add" ? null : "add"))}
                      aria-expanded={mobileCreditFormOpen === "add"}
                      data-testid="button-toggle-mobile-add-credit"
                    >
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/10 text-green-600">
                        <Wallet className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-green-600">Add Credit</span>
                        <span className="block truncate text-[11px] text-muted-foreground">Cash, card, or bank credit</span>
                      </span>
                      {mobileCreditFormOpen === "add" ? (
                        <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  ) : null}
                  {(!isMobile || mobileCreditFormOpen === "add") ? (
                    <div className={isMobile ? "border-t px-3 pb-3 pt-3" : ""}>
                      <div className="mx-auto w-full max-w-md space-y-3 text-center">
                        {!isMobile ? (
                          <h4 className="flex items-center justify-center gap-2 font-semibold text-green-600">
                            <Wallet className="w-4 h-4" /> Add Credit to Account
                          </h4>
                        ) : null}
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Amount (AED)"
                          value={depositAmount}
                          onChange={(e) => setDepositAmount(e.target.value)}
                          className={isMobile ? "h-10 rounded-lg text-center text-sm" : "h-11 text-center"}
                          data-testid="input-deposit-amount"
                        />
                        <Select
                          value={depositPaymentMethod}
                          onValueChange={setDepositPaymentMethod}
                        >
                          <SelectTrigger
                            className={isMobile ? "h-10 rounded-lg text-center text-sm" : "h-11 text-center"}
                            data-testid="select-deposit-payment-method"
                          >
                            <SelectValue placeholder="Payment Method" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="card">Card</SelectItem>
                            <SelectItem value="bank">Bank</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          placeholder="Description (optional)"
                          value={depositDescription}
                          onChange={(e) => setDepositDescription(e.target.value)}
                          className={isMobile ? "h-10 rounded-lg text-center text-sm" : "h-11 text-center"}
                          data-testid="input-deposit-description"
                        />
                        <Button
                          className={isMobile ? "h-10 w-full rounded-lg bg-green-600 text-sm hover:bg-green-700" : "h-11 w-full bg-green-600 hover:bg-green-700"}
                          onClick={() => {
                            if (depositAmount && transactionClient) {
                              setPendingPinAction({
                                type: "add_credit",
                                clientId: transactionClient.id,
                                amount: depositAmount,
                                description: depositDescription.trim() || "Deposit received",
                                paymentMethod: depositPaymentMethod,
                              });
                              setShowCashierPinDialog(true);
                              setCashierPin("");
                              setCashierPinError("");
                            }
                          }}
                          disabled={!depositAmount || addDepositMutation.isPending}
                          data-testid="button-add-deposit"
                        >
                          {addDepositMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Plus className="w-4 h-4 mr-2" />
                          )}
                          Add Credit
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className={isMobile ? "overflow-hidden rounded-xl border bg-card" : "rounded-lg border bg-card p-4"}>
                  {isMobile ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-3 text-left"
                      onClick={() => setMobileCreditFormOpen((current) => (current === "deduct" ? null : "deduct"))}
                      aria-expanded={mobileCreditFormOpen === "deduct"}
                      data-testid="button-toggle-mobile-deduct-credit"
                    >
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-600">
                        <UserMinus className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-rose-600">Deduct Credit</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          Available: {availableCreditBalance.toFixed(2)} AED
                        </span>
                      </span>
                      {mobileCreditFormOpen === "deduct" ? (
                        <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  ) : null}
                  {(!isMobile || mobileCreditFormOpen === "deduct") ? (
                    <div className={isMobile ? "border-t px-3 pb-3 pt-3" : ""}>
                      <div className="mx-auto w-full max-w-md space-y-3 text-center">
                        {!isMobile ? (
                          <h4 className="flex items-center justify-center gap-2 font-semibold text-rose-600">
                            <UserMinus className="w-4 h-4" /> Deduct Credit from Account
                          </h4>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          Available credit: {availableCreditBalance.toFixed(2)} AED
                        </p>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Amount (AED)"
                          value={deductionAmount}
                          onChange={(e) => setDeductionAmount(e.target.value)}
                          className={isMobile ? "h-10 rounded-lg text-center text-sm" : "h-11 text-center"}
                          data-testid="input-deduction-amount"
                        />
                        <Input
                          placeholder="Reason for deduction (optional)"
                          value={deductionDescription}
                          onChange={(e) => setDeductionDescription(e.target.value)}
                          className={isMobile ? "h-10 rounded-lg text-center text-sm" : "h-11 text-center"}
                          data-testid="input-deduction-description"
                        />
                        {parseFloat(deductionAmount || "0") > availableCreditBalance + 0.009 && (
                          <p className="text-xs text-destructive">
                            Deduction cannot be more than the available account credit.
                          </p>
                        )}
                        <Button
                          variant="destructive"
                          className={isMobile ? "h-10 w-full rounded-lg text-sm" : "h-11 w-full"}
                          onClick={() => {
                            if (deductionAmount && transactionClient) {
                              setPendingPinAction({
                                type: "deduct_credit",
                                clientId: transactionClient.id,
                                amount: deductionAmount,
                                description: deductionDescription.trim() || "Credit deducted from account",
                              });
                              setShowCashierPinDialog(true);
                              setCashierPin("");
                              setCashierPinError("");
                            }
                          }}
                          disabled={
                            !deductionAmount ||
                            parseFloat(deductionAmount || "0") <= 0 ||
                            parseFloat(deductionAmount || "0") > availableCreditBalance + 0.009 ||
                            deductDepositMutation.isPending
                          }
                          data-testid="button-deduct-deposit"
                        >
                          {deductDepositMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <UserMinus className="w-4 h-4 mr-2" />
                          )}
                          Deduct Credit
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div
                className={
                  transactionDialogView === "unpaid"
                    ? isMobile
                      ? "space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3"
                      : "space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
                    : isMobile
                      ? "space-y-3 rounded-xl border bg-card p-3"
                      : "space-y-4 rounded-lg border bg-card p-4"
                }
              >
                <div className="space-y-3">
                  <div className="flex justify-center">
                    <div className={isMobile ? "grid w-full max-w-[420px] grid-cols-2 gap-2" : "inline-flex items-center rounded-full bg-muted p-1"}>
                    <Button
                      type="button"
                      size="sm"
                      variant={transactionDialogView === "unpaid" ? "default" : "ghost"}
                      className={
                        isMobile
                          ? "h-9 w-full rounded-lg text-sm"
                          : transactionDialogView === "unpaid"
                            ? "min-w-[220px] rounded-full"
                            : "min-w-[220px] rounded-full text-muted-foreground"
                      }
                      onClick={() => handleTransactionDialogViewChange("unpaid")}
                      data-testid="button-client-unpaid-bills-view"
                    >
                      <Receipt className="mr-1 h-4 w-4" />
                      Unpaid Bills ({unpaidBillsCount})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={transactionDialogView === "history" ? "default" : "ghost"}
                      className={
                        isMobile
                          ? "h-9 w-full rounded-lg text-sm"
                          : transactionDialogView === "history"
                            ? "min-w-[220px] rounded-full"
                            : "min-w-[220px] rounded-full text-muted-foreground"
                      }
                      onClick={() => handleTransactionDialogViewChange("history")}
                      data-testid="button-client-transaction-history-view"
                    >
                      <History className="mr-1 h-4 w-4" />
                      Transaction History ({transactionHistoryRows.length})
                    </Button>
                  </div>
                  </div>

                  {transactionDialogView === "unpaid" && hasUnpaidBills && (
                    <div className={isMobile ? "grid grid-cols-1 gap-2" : "flex flex-wrap items-center justify-center gap-2"}>
                      <Button
                        size="sm"
                        variant="default"
                        className={isMobile ? "h-9 w-full rounded-lg text-sm" : undefined}
                        onClick={() => {
                          if (transactionClient?.id) {
                            closeTransactionDialog();
                            navigate(getBillsPayClientHref(transactionClient.id));
                          }
                        }}
                        data-testid="button-pay-all-bills"
                      >
                        <DollarSign className="mr-1 h-4 w-4" />
                        Pay All Bills
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className={isMobile ? "h-9 w-full rounded-lg text-sm" : undefined}
                        onClick={generateCombinedInvoice}
                        data-testid="button-generate-combined-invoice"
                      >
                        <Printer className="mr-1 h-4 w-4" />
                        Print Combined Invoice
                      </Button>
                    </div>
                  )}
                </div>

                {transactionDialogView === "unpaid" ? (
                  unpaidBillsLoading ? (
                    <div className="flex items-center justify-center rounded-lg border border-dashed bg-background/80 px-4 py-8 text-center text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading unpaid bills...
                    </div>
                  ) : hasUnpaidBills ? (
                    isMobile ? (
                      <div className="space-y-2.5">
                        {unpaidBillRows.map(
                          ({
                            bill,
                            totalAmount,
                            paidAmount,
                            remainingAmount,
                            parsedItems,
                          }) => (
                            <div
                              key={bill.id}
                              className="rounded-xl border bg-background p-3 shadow-sm"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    Bill
                                  </p>
                                  <p className="mt-0.5 text-sm font-bold text-primary">
                                    #{bill.id}
                                  </p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    Date
                                  </p>
                                  <p className="mt-0.5 text-sm font-medium text-foreground">
                                    {format(new Date(bill.billDate), "dd/MM/yyyy")}
                                  </p>
                                </div>
                              </div>

                              <div className="mt-3 grid grid-cols-3 gap-1.5">
                                <div className="rounded-lg border bg-blue-50/70 px-2 py-2 text-center dark:bg-blue-950/20">
                                  <p className="text-[10px] text-muted-foreground">Total</p>
                                  <p className="mt-0.5 text-[12px] font-bold text-blue-600">
                                    {totalAmount.toFixed(2)}
                                  </p>
                                </div>
                                <div className="rounded-lg border bg-emerald-50/70 px-2 py-2 text-center dark:bg-emerald-950/20">
                                  <p className="text-[10px] text-muted-foreground">Paid</p>
                                  <p className="mt-0.5 text-[12px] font-bold text-green-600">
                                    {paidAmount.toFixed(2)}
                                  </p>
                                </div>
                                <div className="rounded-lg border bg-rose-50/70 px-2 py-2 text-center dark:bg-rose-950/20">
                                  <p className="text-[10px] text-muted-foreground">Due</p>
                                  <p className="mt-0.5 text-[12px] font-bold text-destructive">
                                    {remainingAmount.toFixed(2)}
                                  </p>
                                </div>
                              </div>

                              <div className="mt-3">
                                <BillItemsPopover
                                  items={parsedItems}
                                  rawDescription={bill.description}
                                  title={`Bill #${bill.id} Items`}
                                  subtitle={`${transactionClient.name} - ${format(new Date(bill.billDate), "dd MMM yyyy")}`}
                                  triggerMode="dialog"
                                  trigger={
                                    <button
                                      type="button"
                                      className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                      data-testid={`button-client-bill-items-${bill.id}`}
                                    >
                                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                        <Package className="h-4 w-4" />
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-semibold text-primary">
                                          View Items
                                        </span>
                                        <span className="mt-0.5 block text-[12px] font-medium text-foreground">
                                          {parsedItems.length > 0
                                            ? `${parsedItems.length} line item${parsedItems.length === 1 ? "" : "s"}`
                                            : `Bill #${bill.id} details`}
                                        </span>
                                        <span className="mt-0.5 block line-clamp-2 break-words text-[11px] leading-snug text-muted-foreground">
                                          {bill.description || "Open the items table"}
                                        </span>
                                      </span>
                                    </button>
                                  }
                                />
                              </div>

                              <div className="mt-3 grid grid-cols-1 gap-2">
                                <Button
                                  size="sm"
                                  className="h-9 w-full rounded-lg text-sm"
                                  onClick={() => {
                                    closeTransactionDialog();
                                    navigate(getBillsHighlightHref(bill.id));
                                  }}
                                  data-testid={`button-client-bill-pay-${bill.id}`}
                                >
                                  <Wallet className="mr-1.5 h-4 w-4" />
                                  Pay Bill
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-9 w-full rounded-lg text-sm"
                                  onClick={() => {
                                    closeTransactionDialog();
                                    navigate(`/bills?printBill=${bill.id}`);
                                  }}
                                  data-testid={`button-client-bill-print-${bill.id}`}
                                >
                                  <Printer className="mr-1.5 h-4 w-4" />
                                  Print Invoice
                                </Button>
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-lg border bg-background">
                        <Table className="table-fixed w-full">
                          <TableHeader>
                            <TableRow className="bg-destructive/5">
                              <TableHead className="w-[72px]">Bill</TableHead>
                              <TableHead className="w-[94px]">Date</TableHead>
                              <TableHead className="w-[40%]">Items</TableHead>
                              <TableHead className="w-[78px] text-right">Total</TableHead>
                              <TableHead className="w-[78px] text-right">Paid</TableHead>
                              <TableHead className="w-[78px] text-right">Due</TableHead>
                              <TableHead className="w-[148px] text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {unpaidBillRows.map(
                              ({
                                bill,
                                totalAmount,
                                paidAmount,
                                remainingAmount,
                                parsedItems,
                              }) => {
                              return (
                                <TableRow key={bill.id}>
                                  <TableCell className="align-top font-medium text-primary">
                                    Bill #{bill.id}
                                  </TableCell>
                                  <TableCell className="align-top text-sm text-muted-foreground">
                                    {format(new Date(bill.billDate), "dd/MM/yyyy")}
                                  </TableCell>
                                  <TableCell className="w-[40%] min-w-0 align-top">
                                    <BillItemsPopover
                                      items={parsedItems}
                                      rawDescription={bill.description}
                                      title={`Bill #${bill.id} Items`}
                                      subtitle={`${transactionClient.name} - ${format(new Date(bill.billDate), "dd MMM yyyy")}`}
                                      triggerMode="popover"
                                      popoverAlign="center"
                                      popoverContentClassName="w-[min(92vw,42rem)] max-w-[42rem]"
                                      trigger={
                                        <button
                                          type="button"
                                          className="flex w-full min-w-0 flex-col rounded-lg border border-primary/15 bg-primary/5 px-2.5 py-2 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                          data-testid={`button-client-bill-items-${bill.id}`}
                                        >
                                          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                                            View items
                                          </span>
                                          <span className="mt-1 text-sm font-medium text-foreground">
                                            {parsedItems.length > 0
                                              ? `${parsedItems.length} line item${parsedItems.length === 1 ? "" : "s"}`
                                              : `Bill #${bill.id} details`}
                                          </span>
                                          <span className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                                            {bill.description || "Open the items table"}
                                          </span>
                                        </button>
                                      }
                                    />
                                  </TableCell>
                                  <TableCell className="align-top text-right font-medium text-blue-600">
                                    {totalAmount.toFixed(2)} AED
                                  </TableCell>
                                  <TableCell className="align-top text-right font-medium text-green-600">
                                    {paidAmount.toFixed(2)} AED
                                  </TableCell>
                                  <TableCell className="align-top text-right font-semibold text-destructive">
                                    {remainingAmount.toFixed(2)} AED
                                  </TableCell>
                                  <TableCell className="align-top text-right">
                                    <div className="flex flex-col items-stretch gap-1.5">
                                      <Button
                                        size="sm"
                                        className={isMobile ? "h-9 rounded-lg px-3 text-sm" : "h-8 justify-center px-2 text-xs"}
                                        onClick={() => {
                                          closeTransactionDialog();
                                          navigate(getBillsHighlightHref(bill.id));
                                        }}
                                        data-testid={`button-client-bill-pay-${bill.id}`}
                                      >
                                        <Wallet className="mr-1.5 h-4 w-4" />
                                        Pay Bill
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className={isMobile ? "h-9 rounded-lg px-3 text-sm" : "h-8 justify-center px-2 text-xs"}
                                        onClick={() => {
                                          closeTransactionDialog();
                                          navigate(`/bills?printBill=${bill.id}`);
                                        }}
                                        data-testid={`button-client-bill-print-${bill.id}`}
                                      >
                                        <Printer className="mr-1.5 h-4 w-4" />
                                        Print Invoice
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )
                  ) : (
                    <div className="rounded-lg border border-dashed bg-background/80 px-4 py-8 text-center text-sm text-muted-foreground">
                      This account has 0 unpaid bills.
                    </div>
                  )
                ) : transactionHistoryRows.length > 0 ? (
                  isMobile ? (
                    <div className="space-y-2.5">
                      {transactionHistoryRows.map(({ tx, creditBalance, typeDisplay }) => (
                        <div key={tx.id} className="rounded-xl border bg-card p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[11px] text-muted-foreground">
                                {format(new Date(tx.date), "dd/MM/yyyy HH:mm")}
                              </p>
                              <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${typeDisplay.color}`}>
                                {typeDisplay.label}
                              </span>
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
                                {parseFloat(tx.amount).toFixed(2)} AED
                              </p>
                              <p className={`text-[11px] font-medium ${creditBalance >= 0 ? "text-green-600" : "text-red-600"}`}>
                                Account Credit Balance: {creditBalance.toFixed(2)} AED
                              </p>
                            </div>
                          </div>
                          <p className="mt-2 text-sm leading-snug text-muted-foreground break-words">
                            {tx.displayDescription || "No description"}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead>Date</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="text-right">Account Credit Balance</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {transactionHistoryRows.map(({ tx, creditBalance, typeDisplay }) => (
                            <TableRow key={tx.id}>
                              <TableCell className="text-sm">
                                {format(new Date(tx.date), "dd/MM/yyyy HH:mm")}
                              </TableCell>
                              <TableCell>
                                <span className={`rounded px-2 py-1 text-xs font-semibold ${typeDisplay.color}`}>
                                  {typeDisplay.label}
                                </span>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {tx.displayDescription}
                              </TableCell>
                              <TableCell
                                className={`text-right font-medium ${
                                  tx.type === "deposit"
                                    ? "text-green-600"
                                    : isAccountCreditDeductionType(tx.type)
                                      ? "text-orange-600"
                                      : "text-muted-foreground"
                                }`}
                              >
                                {tx.type === "deposit" ? "+" : isAccountCreditDeductionType(tx.type) ? "-" : ""}
                                {parseFloat(tx.amount).toFixed(2)}
                              </TableCell>
                              <TableCell className={`text-right font-bold ${creditBalance >= 0 ? "text-green-600" : "text-red-600"}`}>
                                {creditBalance.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )
                ) : (
                  <p className="rounded-lg border border-dashed bg-background/80 py-8 text-center text-muted-foreground">
                    No transactions yet
                  </p>
                )}
              </div>
            </div>
          )}
          </div>
        </DialogContent>
      </Dialog>

      {invoiceData && (
        <Invoice
          invoiceNumber={invoiceData.invoiceNumber}
          date={invoiceData.date}
          clientName={invoiceData.clientName}
          clientPhone={invoiceData.clientPhone}
          clientAddress={invoiceData.clientAddress}
          totalAmount={invoiceData.totalAmount}
          paidAmount={invoiceData.paidAmount}
          paymentMethod={invoiceData.paymentMethod}
          onClose={() => setInvoiceData(null)}
        />
      )}

      {/* Combined Invoice Dialog */}
      <Dialog open={!!combinedInvoiceData} onOpenChange={(open) => !open && setCombinedInvoiceData(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Combined Due Invoice
            </DialogTitle>
          </DialogHeader>
          {combinedInvoiceData && (
            <div className="space-y-4" id="combined-invoice-print">
              <div className="text-center border-b pb-3">
                <h2 className="text-lg font-bold">{companyContact.companyName}</h2>
                <p className="text-xs text-muted-foreground">Statement of Outstanding Bills</p>
                <p className="text-xs text-muted-foreground">Invoice #: {combinedInvoiceData.invoiceNumber}</p>
                <p className="text-xs text-muted-foreground">Date: {combinedInvoiceData.date}</p>
              </div>

              <div className="border-b pb-3">
                <p className="text-sm font-medium">{combinedInvoiceData.clientName}</p>
                {combinedInvoiceData.clientPhone && (
                  <PhoneNumberWithFlag
                    phone={combinedInvoiceData.clientPhone}
                    className="mt-1"
                    textClassName="text-xs text-muted-foreground"
                  />
                )}
                {combinedInvoiceData.clientAddress && (
                  <AddressTextWithIcon
                    address={combinedInvoiceData.clientAddress}
                    className="mt-1"
                    textClassName="text-xs text-muted-foreground"
                  />
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-2">Outstanding Bills</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Bill #</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs">Billed by</TableHead>
                      <TableHead className="text-xs text-right">Amount</TableHead>
                      <TableHead className="text-xs text-right">Paid</TableHead>
                      <TableHead className="text-xs text-right">Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {combinedInvoiceData.bills.map((bill) => (
                      <TableRow key={bill.billId}>
                        <TableCell className="text-xs">#{bill.billId}</TableCell>
                        <TableCell className="text-xs">{bill.date}</TableCell>
                        <TableCell className="text-xs">{bill.createdBy || "-"}</TableCell>
                        <TableCell className="text-xs text-right">{bill.amount.toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right text-green-600">{bill.paid.toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right text-destructive font-medium">{bill.due.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="border-t pt-3">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-bold">Total Due:</span>
                  <span className="text-lg font-bold text-destructive">
                    AED {combinedInvoiceData.totalDue.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1"
                  onClick={() => {
                    const printContent = document.getElementById("combined-invoice-print");
                    if (printContent) {
                      const printWindow = window.open("", "_blank");
                      if (printWindow) {
                        printWindow.document.write(`
                          <html>
                            <head>
                              <title>Combined Invoice - ${combinedInvoiceData.clientName}</title>
                              <style>
                                body { font-family: Arial, sans-serif; padding: 20px; }
                                table { width: 100%; border-collapse: collapse; margin: 10px 0; }
                                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                                th { background-color: #f5f5f5; }
                                .text-right { text-align: right; }
                                .text-center { text-align: center; }
                                .total { font-size: 18px; font-weight: bold; margin-top: 15px; }
                                .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
                                .due { color: #dc2626; }
                                .paid { color: #16a34a; }
                              </style>
                            </head>
                            <body>
                              <div class="header">
                                <h1>{companyContact.companyName}</h1>
                                <p>Statement of Outstanding Bills</p>
                                <p>Invoice #: ${combinedInvoiceData.invoiceNumber}</p>
                                <p>Date: ${combinedInvoiceData.date}</p>
                              </div>
                              <div>
                                <strong>${combinedInvoiceData.clientName}</strong><br/>
                                ${combinedInvoiceData.clientPhone || ""}<br/>
                                ${combinedInvoiceData.clientAddress || ""}
                              </div>
                              <h3>Outstanding Bills</h3>
                              <table>
                                <tr>
                                  <th>Bill #</th>
                                  <th>Date</th>
                                  <th>Billed by</th>
                                  <th class="text-right">Amount (AED)</th>
                                  <th class="text-right">Paid (AED)</th>
                                  <th class="text-right">Due (AED)</th>
                                </tr>
                                ${combinedInvoiceData.bills.map(bill => `
                                  <tr>
                                    <td>#${bill.billId}</td>
                                    <td>${bill.date}</td>
                                    <td>${bill.createdBy || "-"}</td>
                                    <td class="text-right">${bill.amount.toFixed(2)}</td>
                                    <td class="text-right paid">${bill.paid.toFixed(2)}</td>
                                    <td class="text-right due">${bill.due.toFixed(2)}</td>
                                  </tr>
                                `).join("")}
                              </table>
                              <div class="total">
                                <span>Total Due: </span>
                                <span class="due">AED ${combinedInvoiceData.totalDue.toFixed(2)}</span>
                              </div>
                              <div style="margin-top: 30px; text-align: center; font-size: 12px; color: #666;">
                                Thank you for your business!
                              </div>
                            </body>
                          </html>
                        `);
                        printWindow.document.close();
                        printWindow.print();
                      }
                    }
                  }}
                  data-testid="button-print-combined-invoice"
                >
                  <Printer className="w-4 h-4 mr-1" />
                  Print
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setCombinedInvoiceData(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Cashier PIN Dialog for Cash Payments */}
      <Dialog
        open={showCashierPinDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowCashierPinDialog(false);
            setCashierPin("");
            setCashierPinError("");
            setPendingPinAction(null);
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-center flex items-center justify-center gap-2">
              <Lock className="w-5 h-5 text-primary" />
              {pendingPinAction?.type === "add_credit"
                ? "PIN Required To Add Credit"
                : pendingPinAction?.type === "deduct_credit"
                  ? "PIN Required To Deduct Credit"
                  : "PIN Required For Cash Payment"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-center text-muted-foreground">
              {pendingPinAction?.type === "add_credit"
                ? "Enter the 5-digit staff PIN of the person adding this account credit. Their name will be saved in Credit Management Log."
                : pendingPinAction?.type === "deduct_credit"
                  ? "Enter the 5-digit staff PIN of the person deducting this account credit. Their name will be saved in Credit Management Log."
                : pendingPinAction?.type === "cash_pay_all"
                  ? "Enter the 5-digit staff PIN of the person accepting this cash bulk payment."
                  : "Enter the 5-digit staff PIN of the person accepting this cash payment."}
            </p>
            <div className="space-y-2">
              <Label htmlFor="cashier-pin">PIN</Label>
              <Input
                id="cashier-pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={5}
                enterKeyHint="done"
                placeholder="Enter 5-digit PIN"
                value={cashierPin}
                autoComplete="one-time-code"
                onChange={(e) => {
                  setCashierPin(e.target.value.replace(/\D/g, "").slice(0, 5));
                  setCashierPinError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCashierPinSubmit();
                  }
                }}
                className="text-center text-2xl tracking-widest [-webkit-text-security:disc]"
                data-testid="input-cashier-pin"
              />
              {cashierPinError && (
                <p className="text-sm text-destructive text-center">
                  {cashierPinError}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowCashierPinDialog(false);
                  setCashierPin("");
                  setCashierPinError("");
                  setPendingPinAction(null);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleCashierPinSubmit}
                disabled={
                  cashierPin.length !== 5 || verifyCashierPinMutation.isPending
                }
                data-testid="button-verify-cashier-pin"
              >
                {verifyCashierPinMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Verify"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!viewingClient}
        onOpenChange={(open) => !open && setViewingClient(null)}
      >
        <DialogContent aria-describedby={undefined} className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-display text-primary flex items-center gap-2">
              <Users className="w-6 h-6" />
              {viewingClient?.name}
            </DialogTitle>
          </DialogHeader>

          {viewingClient && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-muted/30 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">Phone</p>
                  <p className="font-medium">{viewingClient.phone || "-"}</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">Address</p>
                  <p className="font-medium">{viewingClient.address || "-"}</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">Account Number</p>
                  <p className="font-medium">{viewingClient.billNumber || "-"}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-4 text-center">
                  <Receipt className="w-6 h-6 mx-auto mb-2 text-blue-600" />
                  <p className="text-sm text-muted-foreground">Total Bills</p>
                  <p className="text-xl font-bold text-blue-600">
                    {getClientTotalBills(viewingClient).toFixed(2)} AED
                  </p>
                </div>
                <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-4 text-center">
                  <Wallet className="w-6 h-6 mx-auto mb-2 text-green-600" />
                  <p className="text-sm text-muted-foreground">Total Deposits</p>
                  <p className="text-xl font-bold text-green-600">
                    {getClientTotalDeposits(viewingClient).toFixed(2)} AED
                  </p>
                </div>
                <div className="rounded-lg p-4 text-center bg-red-50 dark:bg-red-950/30">
                  <Wallet className="w-6 h-6 mx-auto mb-2 text-red-600" />
                  <p className="text-sm text-muted-foreground">Due Balance</p>
                  <p className="text-xl font-bold text-red-600">
                    {getClientBalanceDue(viewingClient).toFixed(2)} AED
                  </p>
                </div>
              </div>

              <div className="flex items-center">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  Order History ({clientOrders?.length || 0})
                </h3>
              </div>

              {clientOrdersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : !clientOrders || clientOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                  <ShoppingBag className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No orders found for this client</p>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Order #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Items</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-center">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clientOrders.map((order) => (
                        <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                          <TableCell className="font-mono font-semibold">
                            {order.orderNumber}
                          </TableCell>
                          <TableCell>
                            {order.entryDate
                              ? format(new Date(order.entryDate), "dd/MM/yyyy")
                              : "-"}
                          </TableCell>
                          <TableCell>
                            {getItemCount(order.items)} items
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {parseFloat(order.totalAmount || "0").toFixed(2)} AED
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                order.status === "released"
                                  ? "default"
                                  : order.status === "ready"
                                    ? "secondary"
                                    : "outline"
                              }
                              className="capitalize"
                            >
                              {order.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  const params = new URLSearchParams({
                                    focusOrderId: String(order.id),
                                  });

                                  if (order.entryDate) {
                                    try {
                                      params.set("focusDate", format(new Date(order.entryDate), "yyyy-MM-dd"));
                                    } catch {
                                      // Ignore invalid dates and fall back to ID-only focus.
                                    }
                                  }

                                  setViewingClient(null);
                                  navigate(`/orders?${params.toString()}`);
                                }}
                                data-testid={`button-view-order-${order.id}`}
                                title="View Order"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Paid Bills Section */}
              {(() => {
                const paidBills = viewingClientBills?.filter(b => b.isPaid) || [];
                if (paidBills.length === 0) return null;
                return (
                  <div className="mt-6">
                    <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
                      <Receipt className="w-5 h-5 text-green-600" />
                      Paid Bills ({paidBills.length})
                    </h3>
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-green-50 dark:bg-green-950/30">
                            <TableHead>Bill #</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Payment</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="text-right">Paid</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paidBills.map((bill) => (
                            <TableRow key={bill.id} data-testid={`row-paid-bill-${bill.id}`}>
                              <TableCell className="font-mono font-semibold">#{bill.id}</TableCell>
                              <TableCell className="text-sm">
                                {format(new Date(bill.billDate), "dd/MM/yyyy")}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                                {bill.description || "-"}
                              </TableCell>
                              <TableCell>
                                {(() => {
                                  const editablePaymentMethod = getEditableClientBillPaymentMethodValue(bill.paymentMethod);

                                  if (!editablePaymentMethod) {
                                    return (
                                      <div className="flex min-h-7 w-[160px] items-center rounded-md border bg-background px-3 py-1 text-xs font-medium leading-4">
                                        <span className="whitespace-normal break-words">
                                          {formatClientBillPaymentMethodLabel(bill.paymentMethod)}
                                        </span>
                                      </div>
                                    );
                                  }

                                  return (
                                    <Select
                                      value={editablePaymentMethod}
                                      onValueChange={(value) => {
                                        updateBillPaymentMethodMutation.mutate({ billId: bill.id, paymentMethod: value });
                                      }}
                                    >
                                      <SelectTrigger className="h-7 w-[160px] text-xs" data-testid={`select-payment-method-client-bill-${bill.id}`}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="cash">Cash</SelectItem>
                                        <SelectItem value="card">Card</SelectItem>
                                        <SelectItem value="transfer">Bank Transfer</SelectItem>
                                        <SelectItem value="deposit">Deposit</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  );
                                })()}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {parseFloat(bill.amount || "0").toFixed(2)} AED
                              </TableCell>
                              <TableCell className="text-right font-medium text-green-600">
                                {parseFloat(bill.paidAmount || "0").toFixed(2)} AED
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                );
              })()}

              {/* Deposits List Section */}
              {(() => {
                const deposits = visibleViewingClientTransactions.filter((tx) => tx.type === "deposit");
                if (deposits.length === 0) return null;
                const totalDeposits = deposits.reduce((sum, tx) => sum + parseFloat(tx.amount || "0"), 0);
                return (
                  <div className="mt-6">
                    <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
                      <Wallet className="w-5 h-5 text-green-600" />
                      Deposits ({deposits.length})
                    </h3>
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-emerald-50 dark:bg-emerald-950/30">
                            <TableHead>#</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Payment Method</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {deposits.map((tx, idx) => (
                            <TableRow key={tx.id} data-testid={`row-deposit-${tx.id}`}>
                              <TableCell className="font-mono">{idx + 1}</TableCell>
                              <TableCell className="text-sm">
                                {format(new Date(tx.date), "dd/MM/yyyy HH:mm")}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {tx.displayDescription || "Deposit received"}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 capitalize text-xs">
                                  {formatClientBillPaymentMethodLabel(tx.paymentMethod || "cash")}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-medium text-green-600">
                                +{parseFloat(tx.amount || "0").toFixed(2)} AED
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-emerald-50/50 dark:bg-emerald-950/20 font-semibold">
                            <TableCell colSpan={4} className="text-right">Total Deposits:</TableCell>
                            <TableCell className="text-right text-green-600">
                              {totalDeposits.toFixed(2)} AED
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                );
              })()}

              {/* Transaction History - shows where bill amounts came from */}
              {visibleViewingClientTransactions.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <History className="w-5 h-5" />
                      Transaction History ({visibleViewingClientTransactions.length})
                    </h3>
                    <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const sortedTx = [...visibleViewingClientTransactions].sort(compareClientTransactionsAsc);
                        
                        // Calculate running balance: for each transaction, compute cumulative balance
                        // Bills add to what client owes, deposits/payments reduce it
                        // Start with the total bills from the client's orders as initial balance
                        // since bill transactions may not be in the transaction list
                        const initialBillTotal = sortedTx.filter(t => t.type === "bill").reduce((sum, t) => sum + parseFloat(t.amount), 0);
                        const hasBillTransactions = sortedTx.some(t => t.type === "bill");
                        // If no bill transactions in list, use the client's total bills as starting point
                        let cumulativeBills = hasBillTransactions ? 0 : getClientTotalBills(viewingClient);
                        let cumulativePayments = 0;
                        
                        // Simplify description to only show bill/order numbers
                        const simplifyDesc = (desc: string, txType: string) => {
                          if (!desc) return "-";
                          // Extract bill number and order number only
                          const billMatch = desc.match(/Bill #(\d+)/);
                          const orderMatch = desc.match(/Order #(ORD-\d+)/);
                          
                          if (billMatch && orderMatch) {
                            if (desc.toLowerCase().includes("deposit used")) {
                              return `Deposit used for Bill #${billMatch[1]}: Order #${orderMatch[1]}`;
                            }
                            return `Payment for Bill #${billMatch[1]}: Order #${orderMatch[1]}`;
                          }
                          if (desc.toLowerCase().includes("deposit received")) {
                            return "Deposit received";
                          }
                          const cleanDesc = normalizeHistoryDescription(desc);
                          return cleanDesc.length > 50 ? cleanDesc.substring(0, 50) + "..." : cleanDesc;
                        };
                        
                        const txRows = sortedTx.map((tx, index) => {
                          // Balance represents what client owes: bills add, deposits/payments subtract
                          if (tx.type === "bill") {
                            cumulativeBills += parseFloat(tx.amount);
                          } else {
                            cumulativePayments += parseFloat(tx.amount);
                          }
                          // Running balance = cumulative bills - cumulative payments
                          const runningBalance = cumulativeBills - cumulativePayments;
                          const typeMeta =
                            tx.type === "bill"
                              ? { label: "Bill", color: "#2563eb" }
                              : {
                                  label: getCreditTransactionTypeDisplay(tx).label,
                                  color: tx.type === "deposit"
                                    ? "#16a34a"
                                    : isAccountCreditDeductionType(tx.type)
                                      ? "#ea580c"
                                      : "#2563eb",
                                };
                          const amountColor =
                            tx.type === "deposit"
                              ? "#16a34a"
                              : isAccountCreditDeductionType(tx.type)
                                ? "#ea580c"
                                : "#2563eb";
                          // Positive balance = client owes (red), zero or negative = client has credit (green)
                          const balanceColor = runningBalance > 0 ? "#dc2626" : "#16a34a";
                          return `
                            <tr style="border-bottom: 1px solid #eee;">
                              <td style="padding: 8px; text-align: center;">${index + 1}</td>
                              <td style="padding: 8px;">${format(new Date(tx.date), "dd/MM/yyyy")}</td>
                              <td style="padding: 8px;">${format(new Date(tx.date), "HH:mm")}</td>
                              <td style="padding: 8px; color: ${typeMeta.color}; font-weight: 500;">${typeMeta.label}</td>
                              <td style="padding: 8px; font-size: 11px;">${simplifyDesc(tx.displayDescription || "", tx.type)}</td>
                              <td style="padding: 8px; text-align: right; color: ${amountColor};">${tx.type === "deposit" ? "+" : isAccountCreditDeductionType(tx.type) ? "-" : ""}${parseFloat(tx.amount).toFixed(2)} AED</td>
                              <td style="padding: 8px; text-align: right; font-weight: bold; color: ${balanceColor};">${runningBalance.toFixed(2)} AED</td>
                            </tr>
                          `;
                        }).join('');

                        const printContent = `
                          <html>
                            <head>
                              <title>Transaction History - ${viewingClient.name}</title>
                              <style>
                                @page { size: A4; margin: 15mm; }
                                body { font-family: Arial, sans-serif; padding: 20px; color: #333; margin: 0; }
                                table { width: 100%; border-collapse: collapse; font-size: 12px; }
                                th { background: #1e88e5; color: white; padding: 10px 8px; text-align: left; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                                @media print { th { background: #1e88e5 !important; color: white !important; } }
                              </style>
                            </head>
                            <body>
                              <div style="text-align: center; margin-bottom: 20px; border-bottom: 3px solid #1e88e5; padding-bottom: 15px;">
                                <img src="${logoImage}" alt="Logo" style="max-width: 150px; height: auto;" />
                                <p style="margin: 8px 0 0 0; font-size: 12px; color: #666;">${escapeHtml(companyAddressLine)}</p>
                              </div>
                              
                              <h2 style="text-align: center; margin: 15px 0; color: #333; font-size: 18px;">CLIENT ACCOUNT SUMMARY</h2>
                              
                              <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                                <table style="width: 100%; font-size: 13px;">
                                  <tr>
                                    <td style="padding: 5px 0;"><strong>Client Name:</strong> ${viewingClient.name}</td>
                                    <td style="padding: 5px 0;"><strong>Phone:</strong> ${viewingClient.phone || "-"}</td>
                                  </tr>
                                  <tr>
                                    <td style="padding: 5px 0;"><strong>Address:</strong> ${viewingClient.address || "-"}</td>
                                    <td style="padding: 5px 0;"><strong>Account Number:</strong> ${viewingClient.billNumber || "-"}</td>
                                  </tr>
                                </table>
                              </div>
                              
                              <div style="display: flex; gap: 15px; margin-bottom: 20px;">
                                <div style="flex: 1; background: #e3f2fd; padding: 12px; border-radius: 6px; text-align: center;">
                                  <p style="margin: 0; font-size: 11px; color: #1565c0;">Total Bills</p>
                                  <p style="margin: 5px 0 0 0; font-size: 20px; font-weight: bold; color: #1e88e5;">${getClientTotalBills(viewingClient).toFixed(2)} AED</p>
                                </div>
                                <div style="flex: 1; background: #e8f5e9; padding: 12px; border-radius: 6px; text-align: center;">
                                  <p style="margin: 0; font-size: 11px; color: #2e7d32;">Total Deposits</p>
                                  <p style="margin: 5px 0 0 0; font-size: 20px; font-weight: bold; color: #4caf50;">${getClientTotalDeposits(viewingClient).toFixed(2)} AED</p>
                                </div>
                                <div style="flex: 1; background: ${getClientBalanceDue(viewingClient) > 0 ? "#ffebee" : "#e8f5e9"}; padding: 12px; border-radius: 6px; text-align: center;">
                                  <p style="margin: 0; font-size: 11px; color: ${getClientBalanceDue(viewingClient) > 0 ? "#c62828" : "#2e7d32"};">Due Balance</p>
                                  <p style="margin: 5px 0 0 0; font-size: 20px; font-weight: bold; color: ${getClientBalanceDue(viewingClient) > 0 ? "#f44336" : "#4caf50"};">${getClientBalanceDue(viewingClient).toFixed(2)} AED</p>
                                </div>
                              </div>
                              
                              <h3 style="margin: 15px 0 10px 0; color: #333; border-bottom: 2px solid #ddd; padding-bottom: 8px; font-size: 14px;">Transaction History</h3>
                              
                              <table>
                                <thead>
                                  <tr>
                                    <th style="width: 30px; text-align: center;">#</th>
                                    <th>Date</th>
                                    <th>Time</th>
                                    <th>Type</th>
                                    <th>Description</th>
                                    <th style="text-align: right;">Amount</th>
                                    <th style="text-align: right;">Balance</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  ${txRows || '<tr><td colspan="7" style="padding: 20px; text-align: center; color: #999;">No transactions found</td></tr>'}
                                </tbody>
                              </table>
                              
                              <div style="margin-top: 25px; padding-top: 15px; border-top: 2px solid #ddd; text-align: center;">
                                <p style="font-size: 10px; color: #666; margin: 0;">Generated on ${format(new Date(), "dd/MM/yyyy 'at' HH:mm")} | Thank you for your business!</p>
                                <p style="font-size: 12px; font-weight: bold; color: #000; margin: 8px 0 0 0;">${escapeHtml(companyPhoneLine)}</p>
                              </div>
                            </body>
                          </html>
                        `;
                        const printWindow = window.open('', '_blank');
                        if (printWindow) {
                          printWindow.document.write(printContent);
                          printWindow.document.close();
                          printWindow.focus();
                          setTimeout(() => printWindow.print(), 300);
                        }
                      }}
                      data-testid="button-print-transaction-history"
                    >
                      <Printer className="w-4 h-4 mr-1" />
                      Print History
                    </Button>
                    </div>
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Bill #</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Processed By</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                        <TableBody>
                          {(() => {
                          const sortedTx = [...visibleViewingClientTransactions].sort(compareClientTransactionsAsc);
                          // If no bill transactions in list, use the client's total bills as starting point
                          const hasBillTransactions = sortedTx.some(t => t.type === "bill");
                          let cumulativeBills = hasBillTransactions ? 0 : getClientTotalBills(viewingClient);
                          let cumulativePayments = 0;
                          return sortedTx.map((tx) => {
                            // Balance represents what client owes: bills add, deposits/payments subtract
                            if (tx.type === "bill") {
                              cumulativeBills += parseFloat(tx.amount);
                            } else {
                              cumulativePayments += parseFloat(tx.amount);
                            }
                            const currentBalance = cumulativeBills - cumulativePayments;
                            const typeMeta =
                              tx.type === "bill"
                                ? { label: "Bill", className: "bg-blue-100 text-blue-700" }
                                : {
                                    label: getCreditTransactionTypeDisplay(tx).label,
                                    className: getCreditTransactionTypeDisplay(tx).color,
                                  };
                            return (
                          <TableRow key={tx.id}>
                            <TableCell className="text-sm">
                              {format(new Date(tx.date), "dd/MM/yyyy HH:mm")}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={tx.type === "bill" ? "default" : "secondary"}
                                className={typeMeta.className}
                              >
                                {typeMeta.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm font-medium">
                              {tx.billId ? `#${tx.billId}` : "-"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {tx.displayDescription}
                            </TableCell>
                            <TableCell className="text-sm">
                              {tx.processedBy || "-"}
                            </TableCell>
                            <TableCell className={`text-right font-medium ${
                              tx.type === "deposit"
                                ? "text-green-600"
                                : isAccountCreditDeductionType(tx.type)
                                  ? "text-orange-600"
                                  : "text-blue-600"
                            }`}>
                              {tx.type === "deposit" ? "+" : isAccountCreditDeductionType(tx.type) ? "-" : ""}{parseFloat(tx.amount).toFixed(2)} AED
                            </TableCell>
                            <TableCell className={`text-right font-bold ${currentBalance > 0 ? "text-red-600" : "text-green-600"}`}>
                              {currentBalance.toFixed(2)} AED
                            </TableCell>
                          </TableRow>
                            );
                          });
                        })()}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setTransactionClient(viewingClient)}
                >
                  <History className="w-4 h-4 mr-2" />
                  Add Deposit
                </Button>
                <Button
                  variant="outline"
                  onClick={() => downloadClientPDF(viewingClient)}
                >
                  <Printer className="w-4 h-4 mr-2" />
                  Print Client Summary
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (confirm(`Are you sure you want to delete ALL orders, bills, and transactions for ${viewingClient.name}? This cannot be undone.`)) {
                      deleteClientOrdersMutation.mutate(viewingClient.id);
                    }
                  }}
                  disabled={deleteClientOrdersMutation.isPending}
                  data-testid="button-delete-client-orders"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {deleteClientOrdersMutation.isPending ? "Deleting..." : "Delete All History"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Pay All Bills Dialog */}
      <Dialog open={showPayAllDialog} onOpenChange={(open) => {
        setShowPayAllDialog(open);
        if (!open) {
          setPayAllAmount("");
          setPayAllMethod("cash");
        }
      }}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" />
              Pay All Outstanding Bills
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">
                {transactionClient?.name && (
                  <span className="font-medium">{transactionClient.name}</span>
                )}
                {unpaidBills && (
                  <span className="block mt-1">
                    {unpaidBills.length} unpaid bill{unpaidBills.length !== 1 ? 's' : ''} totaling{' '}
                    <span className="font-semibold text-destructive">
                      {unpaidBills.reduce((sum, bill) => {
                        const amt = parseFloat(bill.amount || "0");
                        const paid = parseFloat(bill.paidAmount || "0");
                        return sum + (amt - paid);
                      }, 0).toFixed(2)} AED
                    </span>
                  </span>
                )}
              </p>
            </div>
            <div>
              <Label htmlFor="payAllAmount">Payment Amount (AED)</Label>
              <Input
                id="payAllAmount"
                type="number"
                step="0.01"
                value={payAllAmount}
                onChange={(e) => setPayAllAmount(e.target.value)}
                placeholder="Enter payment amount"
                data-testid="input-pay-all-amount"
              />
            </div>
            <div>
              <Label htmlFor="payAllMethod">Payment Method</Label>
              <select
                id="payAllMethod"
                className="w-full p-2 border rounded-md bg-background"
                value={payAllMethod}
                onChange={(e) => setPayAllMethod(e.target.value)}
                data-testid="select-pay-all-method"
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                {canUseClientCredit && (
                  <option value="deposit">Credit (Use Balance)</option>
                )}
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowPayAllDialog(false)}
                data-testid="button-cancel-pay-all"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (transactionClient && payAllAmount && parseFloat(payAllAmount) > 0) {
                    if (payAllMethod === "cash") {
                      setPendingPinAction({
                        type: "cash_pay_all",
                        clientId: transactionClient.id,
                        amount: payAllAmount,
                        paymentMethod: payAllMethod,
                        notes: `Bulk payment for all outstanding bills`,
                      });
                      setShowCashierPinDialog(true);
                      setCashierPin("");
                      setCashierPinError("");
                    } else {
                      payAllBillsMutation.mutate({
                        clientId: transactionClient.id,
                        amount: payAllAmount,
                        paymentMethod: payAllMethod,
                        notes: `Bulk payment for all outstanding bills`,
                      });
                    }
                  }
                }}
                disabled={payAllBillsMutation.isPending || !payAllAmount || parseFloat(payAllAmount) <= 0}
                data-testid="button-confirm-pay-all"
              >
                {payAllBillsMutation.isPending ? "Processing..." : "Pay Now"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Merge Clients Dialog */}
      <Dialog open={showMergeDialog} onOpenChange={(open) => {
        setShowMergeDialog(open);
        if (!open) {
          setMergeSourceId(null);
          setMergeTargetId(null);
          setMergePassword("");
          setMergeError("");
          setMergeSourceSearch("");
          setMergeTargetSearch("");
          setMergeSourceOpen(false);
          setMergeTargetOpen(false);
        }
      }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Merge className="w-5 h-5" />
              Merge Client Accounts
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Merge two client accounts. All orders, bills, transactions, and credits from the source client will be transferred to the target client.
            </p>
            <div className="space-y-2">
              <Label>Source Client (will be deleted)</Label>
              <div className="relative">
                {mergeSourceId ? (
                  <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-muted/50">
                    <span className="font-medium text-sm flex-1">{(() => { const sc = allClients?.find(c => c.id === mergeSourceId); return sc ? `${sc.name} - ${sc.phone || "No phone"}${sc.billNumber ? ` (${sc.billNumber})` : ""}` : ""; })()}</span>
                    <button onClick={() => { setMergeSourceId(null); setMergeSourceSearch(""); }} className="text-destructive text-sm font-bold">&times;</button>
                  </div>
                ) : (
                  <Input
                    placeholder="Search by name, phone, or client number..."
                    value={mergeSourceSearch}
                    onChange={(e) => {
                      setMergeSourceSearch(e.target.value);
                      setMergeSourceOpen(true);
                      if (!e.target.value) setMergeSourceId(null);
                    }}
                    onFocus={() => { setMergeSourceOpen(true); setMergeTargetOpen(false); }}
                    data-testid="input-merge-source-search"
                  />
                )}
                {!mergeSourceId && mergeSourceOpen && (
                  <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {allClients
                      ?.filter(c => {
                        const term = mergeSourceSearch.toLowerCase();
                        return (!term || c.name.toLowerCase().includes(term) || (c.phone || "").includes(term) || (c.billNumber || "").toLowerCase().includes(term)) && c.id !== mergeTargetId;
                      })
                      .map(c => (
                        <button
                          key={c.id}
                          type="button"
                          className={`w-full text-left px-3 py-2 text-sm hover-elevate ${mergeSourceId === c.id ? "bg-primary/10 font-medium" : ""}`}
                          onClick={() => {
                            setMergeSourceId(c.id);
                            setMergeSourceSearch(c.name + " - " + (c.phone || "") + (c.billNumber ? ` (${c.billNumber})` : ""));
                            setMergeSourceOpen(false);
                          }}
                          data-testid={`option-merge-source-${c.id}`}
                        >
                          {c.name} - {c.phone || "No phone"}{c.billNumber ? ` (${c.billNumber})` : ""}
                        </button>
                      ))}
                    {allClients?.filter(c => {
                      const term = mergeSourceSearch.toLowerCase();
                      return (!term || c.name.toLowerCase().includes(term) || (c.phone || "").includes(term) || (c.billNumber || "").toLowerCase().includes(term)) && c.id !== mergeTargetId;
                    }).length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No clients found</div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Target Client (will receive all data)</Label>
              <div className="relative">
                <Input
                  placeholder="Search by name, phone, or client number..."
                  value={mergeTargetSearch}
                  onChange={(e) => {
                    setMergeTargetSearch(e.target.value);
                    setMergeTargetOpen(true);
                    if (!e.target.value) setMergeTargetId(null);
                  }}
                  onFocus={() => { setMergeTargetOpen(true); setMergeSourceOpen(false); }}
                  data-testid="input-merge-target-search"
                />
                {mergeTargetId && !mergeTargetOpen && (
                  <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                    Selected: <span className="font-medium text-foreground">{(() => { const tc = allClients?.find(c => c.id === mergeTargetId); return tc ? `${tc.name} - ${tc.phone || "No phone"}${tc.billNumber ? ` (${tc.billNumber})` : ""}` : ""; })()}</span>
                    <button onClick={() => { setMergeTargetId(null); setMergeTargetSearch(""); }} className="text-destructive ml-1">&times;</button>
                  </div>
                )}
                {mergeTargetOpen && (
                  <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {allClients
                      ?.filter(c => {
                        const term = mergeTargetSearch.toLowerCase();
                        return (!term || c.name.toLowerCase().includes(term) || (c.phone || "").includes(term) || (c.billNumber || "").toLowerCase().includes(term)) && c.id !== mergeSourceId;
                      })
                      .map(c => (
                        <button
                          key={c.id}
                          type="button"
                          className={`w-full text-left px-3 py-2 text-sm hover-elevate ${mergeTargetId === c.id ? "bg-primary/10 font-medium" : ""}`}
                          onClick={() => {
                            setMergeTargetId(c.id);
                            setMergeTargetSearch(c.name + " - " + (c.phone || "") + (c.billNumber ? ` (${c.billNumber})` : ""));
                            setMergeTargetOpen(false);
                          }}
                          data-testid={`option-merge-target-${c.id}`}
                        >
                          {c.name} - {c.phone || "No phone"}{c.billNumber ? ` (${c.billNumber})` : ""}
                        </button>
                      ))}
                    {allClients?.filter(c => {
                      const term = mergeTargetSearch.toLowerCase();
                      return (!term || c.name.toLowerCase().includes(term) || (c.phone || "").includes(term) || (c.billNumber || "").toLowerCase().includes(term)) && c.id !== mergeSourceId;
                    }).length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No clients found</div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="merge-password">Admin Password</Label>
              <Input
                id="merge-password"
                type="password"
                placeholder="Enter admin password"
                value={mergePassword}
                onChange={(e) => {
                  setMergePassword(e.target.value);
                  setMergeError("");
                }}
                onFocus={() => { setMergeSourceOpen(false); setMergeTargetOpen(false); }}
                autoComplete="current-password"
                data-testid="input-merge-password"
              />
              {mergeError && (
                <p className="text-sm text-destructive">{mergeError}</p>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowMergeDialog(false)}
                data-testid="button-cancel-merge"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (mergeSourceId && mergeTargetId && mergePassword) {
                    mergeClientsMutation.mutate({
                      sourceClientId: mergeSourceId,
                      targetClientId: mergeTargetId,
                      adminPassword: mergePassword,
                    });
                  }
                }}
                disabled={mergeClientsMutation.isPending || !mergeSourceId || !mergeTargetId || !mergePassword}
                data-testid="button-confirm-merge"
              >
                {mergeClientsMutation.isPending ? "Merging..." : "Merge Clients"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Client Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => {
        setShowDeleteDialog(open);
        if (!open) {
          setClientToDelete(null);
          setDeletePin("");
          setDeleteError("");
        }
      }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Delete Client
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will permanently delete{" "}
              <strong>{clientToDelete?.name}</strong> and all their transaction history. This action cannot be undone.
            </p>
            <div className="space-y-2">
              <Label htmlFor="admin-pin">Admin PIN</Label>
              <input
                type="text"
                name="username"
                autoComplete="username"
                style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }}
                tabIndex={-1}
                aria-hidden="true"
              />
              <Input
                id="admin-pin"
                type="password"
                inputMode="numeric"
                maxLength={5}
                placeholder="Enter 5-digit admin PIN"
                value={deletePin}
                onChange={(e) => {
                  setDeletePin(e.target.value.replace(/\D/g, "").slice(0, 5));
                  setDeleteError("");
                }}
                onKeyDown={(e) => e.stopPropagation()}
                autoComplete="off"
                autoFocus
                data-testid="input-delete-password"
              />
              {deleteError && (
                <p className="text-sm text-destructive">{deleteError}</p>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDeleteDialog(false);
                  setClientToDelete(null);
                  setDeletePin("");
                  setDeleteError("");
                }}
                data-testid="button-cancel-delete"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (clientToDelete && deletePin.length === 5) {
                    deleteClientWithPinMutation.mutate({
                      clientId: clientToDelete.id,
                      adminPin: deletePin,
                    });
                  } else if (deletePin.length > 0 && deletePin.length < 5) {
                    setDeleteError("Admin PIN must be 5 digits");
                  }
                }}
                disabled={deleteClientWithPinMutation.isPending || deletePin.length !== 5}
                data-testid="button-confirm-delete"
              >
                {deleteClientWithPinMutation.isPending ? "Deleting..." : "Delete Client"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddCompanyDialog} onOpenChange={setShowAddCompanyDialog}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              Add New Company
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input
                placeholder="Enter company name"
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value.toUpperCase())}
                className="uppercase"
                autoFocus
                data-testid="input-new-company-name"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAddCompanyDialog(false)} data-testid="button-cancel-company">
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (newCompanyName.trim()) {
                    createCompanyMutation.mutate(newCompanyName.trim());
                  }
                }}
                disabled={!newCompanyName.trim() || createCompanyMutation.isPending}
                data-testid="button-save-company"
              >
                {createCompanyMutation.isPending ? "Creating..." : "Create Company"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!managingCompany} onOpenChange={(open) => { if (!open) { setManagingCompany(null); setSelectedClientsToAdd(new Set()); setAddClientsSearch(""); } }}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              Manage Clients - {managingCompany}
            </DialogTitle>
          </DialogHeader>
          {managingCompany && (() => {
            const currentCompanyClients = (allClients || []).filter(c => c.company && c.company.toUpperCase() === managingCompany.toUpperCase());
            const availableClients = (allClients || []).filter(c => !c.company || !c.company.trim());
            const filteredAvailable = availableClients.filter(c =>
              !addClientsSearch || c.name.toLowerCase().includes(addClientsSearch.toLowerCase()) || (c.phone && c.phone.includes(addClientsSearch))
            );
            const normalizedManagingCompany = managingCompany.trim().toUpperCase();
            const normalizedManageCompanyName = manageCompanyName.trim().toUpperCase();
            const isCompanyRenameChanged =
              normalizedManageCompanyName.length > 0 &&
              normalizedManageCompanyName !== normalizedManagingCompany;
            return (
              <div className="space-y-6">
                <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <div className="space-y-2">
                      <Label htmlFor="manage-company-name">Company Name</Label>
                      <Input
                        id="manage-company-name"
                        value={manageCompanyName}
                        onChange={(e) => {
                          setManageCompanyName(e.target.value.toUpperCase());
                          setManageCompanyRenameError("");
                        }}
                        className="uppercase"
                        data-testid="input-manage-company-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manage-company-admin-pin">Admin PIN</Label>
                      <Input
                        id="manage-company-admin-pin"
                        type="password"
                        inputMode="numeric"
                        maxLength={5}
                        placeholder="5 digits"
                        value={manageCompanyAdminPin}
                        onChange={(e) => {
                          setManageCompanyAdminPin(e.target.value.replace(/\D/g, "").slice(0, 5));
                          setManageCompanyRenameError("");
                        }}
                        autoComplete="off"
                        data-testid="input-manage-company-admin-pin"
                      />
                    </div>
                  </div>
                  {manageCompanyRenameError && (
                    <p className="text-sm text-destructive">{manageCompanyRenameError}</p>
                  )}
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        if (!normalizedManageCompanyName) {
                          setManageCompanyRenameError("Company name is required");
                          return;
                        }
                        if (manageCompanyAdminPin.length !== 5) {
                          setManageCompanyRenameError("Admin PIN must be 5 digits");
                          return;
                        }
                        renameCompanyMutation.mutate({
                          oldName: normalizedManagingCompany,
                          newName: normalizedManageCompanyName,
                          adminPin: manageCompanyAdminPin,
                        });
                      }}
                      disabled={
                        !isCompanyRenameChanged ||
                        manageCompanyAdminPin.length !== 5 ||
                        renameCompanyMutation.isPending
                      }
                      data-testid="button-save-company-rename"
                    >
                      {renameCompanyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save New Company Name
                    </Button>
                  </div>
                </div>

                {currentCompanyClients.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-base font-semibold">Current Clients in {managingCompany}</Label>
                    <div className="border rounded-lg max-h-48 overflow-y-auto">
                      {currentCompanyClients.map((client) => (
                        <div key={client.id} className="flex items-center justify-between gap-2 p-2 border-b last:border-b-0" data-testid={`manage-current-client-${client.id}`}>
                          <div className="flex-1">
                            <span className="font-medium text-sm">{client.name}</span>
                            {client.phone && (
                              <PhoneNumberWithFlag
                                phone={client.phone}
                                className="ml-2"
                                textClassName="text-xs text-muted-foreground"
                              />
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-orange-500"
                            onClick={() => {
                              updateClientCompanyMutation.mutate(
                                { clientId: client.id, company: "" },
                                { onSuccess: () => { toast({ title: `${client.name} removed from ${managingCompany}` }); } }
                              );
                            }}
                            data-testid={`button-remove-from-company-${client.id}`}
                            title="Remove from company"
                          >
                            <UserMinus className="w-4 h-4 mr-1" />
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-base font-semibold">Add Clients to {managingCompany}</Label>
                  <Input
                    placeholder="Search clients by name or phone..."
                    value={addClientsSearch}
                    onChange={(e) => setAddClientsSearch(e.target.value)}
                    data-testid="input-search-add-clients"
                  />
                  <div className="border rounded-lg max-h-60 overflow-y-auto">
                    {filteredAvailable.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        {addClientsSearch ? "No matching clients found" : "No unassigned clients available"}
                      </div>
                    ) : (
                      filteredAvailable.map((client) => (
                        <label
                          key={client.id}
                          className="flex items-center gap-3 p-2 border-b last:border-b-0 cursor-pointer hover-elevate"
                          data-testid={`manage-available-client-${client.id}`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedClientsToAdd.has(client.id)}
                            onChange={(e) => {
                              setSelectedClientsToAdd(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) {
                                  next.add(client.id);
                                } else {
                                  next.delete(client.id);
                                }
                                return next;
                              });
                            }}
                            className="w-4 h-4 rounded border-input"
                            data-testid={`checkbox-client-${client.id}`}
                          />
                          <div className="flex-1">
                            <span className="font-medium text-sm">{client.name}</span>
                            {client.phone && (
                              <PhoneNumberWithFlag
                                phone={client.phone}
                                className="ml-2"
                                textClassName="text-xs text-muted-foreground"
                              />
                            )}
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                  {selectedClientsToAdd.size > 0 && (
                    <p className="text-sm text-muted-foreground">{selectedClientsToAdd.size} client{selectedClientsToAdd.size !== 1 ? "s" : ""} selected</p>
                  )}
                </div>

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => { setManagingCompany(null); setSelectedClientsToAdd(new Set()); setAddClientsSearch(""); }} data-testid="button-cancel-manage">
                    Close
                  </Button>
                  <Button
                    onClick={() => {
                      if (selectedClientsToAdd.size > 0 && managingCompany) {
                        assignClientsToCompanyMutation.mutate({
                          clientIds: Array.from(selectedClientsToAdd),
                          company: managingCompany.toUpperCase(),
                        });
                      }
                    }}
                    disabled={selectedClientsToAdd.size === 0 || assignClientsToCompanyMutation.isPending}
                    data-testid="button-assign-clients"
                  >
                    {assignClientsToCompanyMutation.isPending ? "Assigning..." : `Add ${selectedClientsToAdd.size} Client${selectedClientsToAdd.size !== 1 ? "s" : ""}`}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
