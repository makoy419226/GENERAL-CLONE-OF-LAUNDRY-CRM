import { useEffect, useState, useMemo, useRef, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Calendar, TrendingUp, Wallet, Receipt, FileText, CalendarDays, CalendarRange, Download, FileSpreadsheet, Truck, ShoppingBag, Users, Banknote, Tag, Package, Zap, Clock, Check, CheckCircle, Phone, MapPin, Building2, ChevronDown, RotateCcw, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateTimeRangePicker } from "@/components/ui/DateTimeRangePicker";
import { BillItemsPopover } from "@/components/BillItemsPopover";
import { CenteredDatePicker } from "@/components/CenteredDatePicker";
import { AnalogClockPicker } from "@/components/AnalogClockPicker";
import {
  escapeHtml,
  formatCompanyAddressSingleLine,
  formatCompanyPhoneLine,
  useCompanyContactInfo,
} from "@/lib/companyContact";
import { exportToExcel as writeExcel, CellStyle, ExcelExportCell } from "@/lib/excelExport";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Bill, BillPayment, Client, Order, Product } from "@shared/schema";

interface SalesReportsProps {
  embedded?: boolean;
  creditOnly?: boolean;
  externalActiveTab?: string;
  externalSelectedDate?: string;
  externalSelectedMonth?: string;
  externalSelectedYear?: string;
  externalStartDate?: string;
  externalEndDate?: string;
}

type ReportPeriod = 'daily' | 'monthly' | 'yearly' | 'range';

type SalesPaymentHistoryMeta = {
  historyBadgeLabel: string | null;
  historyBadgeClass: string;
  historyNote: string | null;
  firstPartialPaymentDate: string | null;
};

type SalesPaymentStatusMeta = SalesPaymentHistoryMeta & {
  label: string;
  badgeClass: string;
};

type SalesOrderPaymentStatusMeta = SalesPaymentHistoryMeta & {
  label: string;
  color: string;
};

type SalesReportBill = Bill & {
  paymentProcessedBy?: string | null;
  paymentProcessedAt?: string | Date | null;
};

type SalesPeriodResponse = {
  period: {
    period: ReportPeriod;
    from: string;
    to: string;
  };
  clients: Client[];
  orders: Order[];
  bills: SalesReportBill[];
  billPayments: BillPayment[];
};

type SalesReportRevertPaymentRequest = {
  adminPin: string;
  billId?: number;
  paymentIds?: number[];
};

const EMPTY_SALES_PAYMENT_HISTORY_META: SalesPaymentHistoryMeta = {
  historyBadgeLabel: null,
  historyBadgeClass: "",
  historyNote: null,
  firstPartialPaymentDate: null,
};

function parseSalesReportSqmDescriptionPart(
  part: string,
  products?: Product[],
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

  return {
    name: `${sqm} sqm ${cleanName.replace(/\s*\(per\s*SQ\s*MTR\)\s*$/i, "").trim()} (per SQ MTR)`.trim(),
    qty,
    price: Number.isFinite(linePrice) ? linePrice : 0,
    total: Number.isFinite(linePrice) ? qty * linePrice : 0,
  };
}

function stripSalesReportEmbeddedItemPriceText(name: string): string {
  return String(name || "")
    .replace(/\s*\(base\s*[\d.]+\s*AED\)/gi, "")
    .replace(/\s*@\s*[\d.]+\s*AED(?:\s*\((custom|min\s*50|admin\s*edited)\))?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseSalesReportDescriptionItems(
  description: string,
  products?: Product[],
): { name: string; qty: number; price: number; total: number }[] {
  if (!description) return [];

  const orderMatch = description.match(/Order #[A-Z0-9-]+:\s*/i);
  const itemsText = orderMatch ? description.replace(orderMatch[0], "") : description;
  const itemParts = itemsText.split(",").map((entry) => entry.trim()).filter(Boolean);

  return itemParts.map((part) => {
    const sqmItem = parseSalesReportSqmDescriptionPart(part, products);
    if (sqmItem) {
      return sqmItem;
    }

    const match = part.match(/^(\d+)x\s+(.+)$/i);
    if (match) {
      const qty = parseInt(match[1], 10);
      const name = match[2].trim();
      const displayName = stripSalesReportEmbeddedItemPriceText(name);

      const embeddedPriceMatch = name.match(/@\s*([\d.]+)\s*AED/i);
      if (embeddedPriceMatch) {
        const price = parseFloat(embeddedPriceMatch[1]);
        return { name: displayName, qty, price, total: qty * price };
      }

      const serviceMatch = name.match(/\[(N|DC|I)\]/i);
      const serviceType = serviceMatch ? serviceMatch[1].toUpperCase() : "N";
      const sizeMatch = name.match(/\((Small|Medium|Large)\)/i);
      const size = sizeMatch ? sizeMatch[1].toLowerCase() : null;

      const baseName = name.replace(/\s*\([^)]*\)\s*$/g, "").replace(/\s*\[[^\]]*\]\s*/g, "").trim();
      let product = products?.find((entry) => entry.name.toLowerCase() === baseName.toLowerCase());
      if (!product) {
        const nameWithoutAll = name
          .replace(/\s*\(Small\)|\(Medium\)|\(Large\)|\(folding\)|\(hanger\)/gi, "")
          .replace(/\s*\[[^\]]*\]/g, "")
          .trim();
        product = products?.find((entry) => entry.name.toLowerCase() === nameWithoutAll.toLowerCase());
      }
      if (!product) {
        product = products?.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
      }

      let price = 0;
      if (product) {
        if (size === "small" && product.smallPrice) price = parseFloat(product.smallPrice);
        else if (size === "medium" && product.mediumPrice) price = parseFloat(product.mediumPrice);
        else if (size === "large" && product.largePrice) price = parseFloat(product.largePrice);
        else if (serviceType === "DC" && product.dryCleanPrice) price = parseFloat(product.dryCleanPrice);
        else if (serviceType === "I" && product.ironOnlyPrice) price = parseFloat(product.ironOnlyPrice);
        else price = parseFloat(product.price || "0");
      }

      return { name: displayName, qty, price, total: qty * price };
    }

    return { name: stripSalesReportEmbeddedItemPriceText(part), qty: 1, price: 0, total: 0 };
  });
}

function toDateTimeLocal(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export default function SalesReports({ embedded = false, creditOnly = false, externalActiveTab, externalSelectedDate, externalSelectedMonth, externalSelectedYear, externalStartDate, externalEndDate }: SalesReportsProps) {
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const today = new Date().toISOString().split('T')[0];
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentYear = new Date().getFullYear().toString();

  const [internalSelectedDate, setInternalSelectedDate] = useState(today);
  const [internalSelectedMonth, setInternalSelectedMonth] = useState(currentMonth);
  const [internalSelectedYear, setInternalSelectedYear] = useState(currentYear);
  const [internalStartDate, setInternalStartDate] = useState(`${today}T00:00`);
  const [internalEndDate, setInternalEndDate] = useState(`${today}T23:59`);
  const [internalActiveTab, setInternalActiveTab] = useState("daily");

  const selectedDate = externalSelectedDate ?? internalSelectedDate;
  const setSelectedDate = externalSelectedDate ? () => {} : setInternalSelectedDate;
  const selectedMonth = externalSelectedMonth ?? internalSelectedMonth;
  const setSelectedMonth = externalSelectedMonth ? () => {} : setInternalSelectedMonth;
  const selectedYear = externalSelectedYear ?? internalSelectedYear;
  const setSelectedYear = externalSelectedYear ? () => {} : setInternalSelectedYear;
  const startDate = externalStartDate ?? internalStartDate;
  const setStartDate = externalStartDate ? () => {} : setInternalStartDate;
  const endDate = externalEndDate ?? internalEndDate;
  const setEndDate = externalEndDate ? () => {} : setInternalEndDate;
  const activeTab = externalActiveTab ?? internalActiveTab;
  const setActiveTab = externalActiveTab ? () => {} : setInternalActiveTab;

  const { toast } = useToast();
  const { companyContact } = useCompanyContactInfo();
  const salesReportCompanyName = companyContact.companyName;
  const salesReportHeaderAddress = formatCompanyAddressSingleLine(companyContact);
  const salesReportPhoneLine = formatCompanyPhoneLine(companyContact);
  const creditManagementLogLabel = "Credit Management Log";
  const creditManagementLogDescription = "All-time credit usage log";
  const creditManagementLogFileBaseName = "credit-management-log";
  const [selectedCurrentOrderIds, setSelectedCurrentOrderIds] = useState<Set<number>>(new Set());
  const salesReportCurrentOrdersTableRef = useRef<HTMLDivElement | null>(null);
  const salesReportOldPaidTableRef = useRef<HTMLDivElement | null>(null);
  const salesReportTotalSalesTableRef = useRef<HTMLDivElement | null>(null);
  const hoveredSalesReportTableRef = useRef<"current" | "old-paid" | "total-sales" | null>(null);
  const [bulkOrderDateEditDialog, setBulkOrderDateEditDialog] = useState(false);
  const [bulkOrderDateEditPin, setBulkOrderDateEditPin] = useState("");
  const [bulkOrderDateEditValue, setBulkOrderDateEditValue] = useState("");
  const [bulkOrderDateEditReason, setBulkOrderDateEditReason] = useState("");
  const [bulkOrderDateEditShiftTagDate, setBulkOrderDateEditShiftTagDate] = useState(true);
  const [bulkOrderDateEditShiftPackDate, setBulkOrderDateEditShiftPackDate] = useState(true);
  const [bulkOrderDateEditShiftDeliveryDate, setBulkOrderDateEditShiftDeliveryDate] = useState(true);
  const [bulkOrderDateEditPreserveSpacing, setBulkOrderDateEditPreserveSpacing] = useState(true);
  const [bulkOrderDateEditSpacingMinutes, setBulkOrderDateEditSpacingMinutes] = useState("1");
  const [bulkOrderDateEditing, setBulkOrderDateEditing] = useState(false);
  const [bulkOrderDateEditError, setBulkOrderDateEditError] = useState("");
  const [mobileSalesSummaryOpen, setMobileSalesSummaryOpen] = useState(false);
  const [selectedOldPaidPayments, setSelectedOldPaidPayments] = useState<Set<number>>(new Set());
  const [selectedTotalSalesPaymentKeys, setSelectedTotalSalesPaymentKeys] = useState<Set<string>>(new Set());
  const [movePaymentDateTimeValue, setMovePaymentDateTimeValue] = useState("");
  const [movePaymentPin, setMovePaymentPin] = useState("");
  const [movePaymentError, setMovePaymentError] = useState("");
  const [movePaymentConfirmOpen, setMovePaymentConfirmOpen] = useState(false);
  const [isMovingPayments, setIsMovingPayments] = useState(false);
  const [salesReportBillDetailsEntry, setSalesReportBillDetailsEntry] = useState<any | null>(null);
  const [salesReportRevertBillId, setSalesReportRevertBillId] = useState<number | null>(null);
  const [salesReportRevertPaymentIds, setSalesReportRevertPaymentIds] = useState<number[] | null>(null);
  const [salesReportRevertTargetLabel, setSalesReportRevertTargetLabel] = useState("payment");
  const [salesReportRevertPin, setSalesReportRevertPin] = useState("");
  const [salesReportRevertError, setSalesReportRevertError] = useState("");
  const movePaymentDatePart = movePaymentDateTimeValue.split("T")[0] || today;
  const movePaymentTimePart = movePaymentDateTimeValue.split("T")[1]?.slice(0, 5) || "12:00";
  const activeReportPeriod: ReportPeriod =
    activeTab === "monthly"
      ? "monthly"
      : activeTab === "range"
        ? "range"
        : activeTab === "yearly"
          ? "yearly"
          : "daily";

  const parseLocalDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  const parseRangeBoundary = (dateValue: string, isEnd: boolean): Date => {
    if (!dateValue) return new Date();
    if (dateValue.includes("T")) {
      const parsed = new Date(dateValue);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    const parsedDate = parseLocalDate(dateValue);
    if (isEnd) {
      parsedDate.setHours(23, 59, 59, 999);
    } else {
      parsedDate.setHours(0, 0, 0, 0);
    }
    return parsedDate;
  };

  const salesReportQueryOptions = {
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false as const,
    refetchOnReconnect: false as const,
    refetchOnMount: false as const,
  };

  const activePeriodBounds = useMemo(() => {
    if (activeReportPeriod === "daily") {
      const from = parseLocalDate(selectedDate);
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }

    if (activeReportPeriod === "monthly") {
      const [year, month] = selectedMonth.split("-").map(Number);
      return {
        from: new Date(year, month - 1, 1, 0, 0, 0, 0),
        to: new Date(year, month, 0, 23, 59, 59, 999),
      };
    }

    if (activeReportPeriod === "range") {
      return {
        from: parseRangeBoundary(startDate, false),
        to: parseRangeBoundary(endDate, true),
      };
    }

    return {
      from: new Date(Number(selectedYear), 0, 1, 0, 0, 0, 0),
      to: new Date(Number(selectedYear), 11, 31, 23, 59, 59, 999),
    };
  }, [activeReportPeriod, selectedDate, selectedMonth, selectedYear, startDate, endDate]);

  const salesPeriodUrl = useMemo(() => {
    const params = new URLSearchParams({
      period: activeReportPeriod,
      from: activePeriodBounds.from.toISOString(),
      to: activePeriodBounds.to.toISOString(),
    });

    return `/api/reports/sales-period?${params.toString()}`;
  }, [activePeriodBounds.from, activePeriodBounds.to, activeReportPeriod]);

  const {
    data: salesPeriodData,
    isLoading: isLoadingSalesPeriodData,
  } = useQuery<SalesPeriodResponse>({
    queryKey: [salesPeriodUrl],
    enabled: !creditOnly,
    ...salesReportQueryOptions,
  });

  const { data: creditOnlyClients, isLoading: isLoadingCreditOnlyClients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: creditOnly,
    ...salesReportQueryOptions,
  });

  const { data: creditOnlyBills, isLoading: isLoadingCreditOnlyBills } = useQuery<SalesReportBill[]>({
    queryKey: ["/api/bills"],
    enabled: creditOnly,
    ...salesReportQueryOptions,
  });

  const allClients = creditOnly ? creditOnlyClients : salesPeriodData?.clients;
  const allOrders = creditOnly ? undefined : salesPeriodData?.orders;
  const allBillPayments = creditOnly ? undefined : salesPeriodData?.billPayments;
  const allBills = creditOnly ? creditOnlyBills : salesPeriodData?.bills;

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
    enabled: !creditOnly,
    ...salesReportQueryOptions,
  });

  const refreshSalesReportQueries = () =>
    Promise.all([
      queryClient.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === "string" &&
          query.queryKey[0].startsWith("/api/reports/sales-period"),
      }),
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/bill-payments"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/reports/credit-transactions"] }),
    ]);

  const revertSalesReportBillPaymentMutation = useMutation({
    mutationFn: async ({ billId, paymentIds, adminPin }: SalesReportRevertPaymentRequest) => {
      const currentUser = localStorage.getItem("username") || "";
      const response =
        paymentIds && paymentIds.length > 0
          ? await apiRequest("POST", "/api/bill-payments/revert-selected", {
              paymentIds,
              adminPin,
              revertedBy: currentUser,
            })
          : await apiRequest("POST", `/api/bills/${billId}/revert-payment`, {
              adminPin,
              revertedBy: currentUser,
            });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || "Failed to revert payment");
      }

      return response.json().catch(() => ({}));
    },
    onSuccess: (data: any) => {
      const billId = salesReportRevertBillId;
      const paymentCount = salesReportRevertPaymentIds?.length || 0;
      const revertedBillCount = Array.isArray(data?.revertedBills) ? data.revertedBills.length : 0;
      refreshSalesReportQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/sales-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-sales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-selection"] });

      toast({
        title: paymentCount > 0 ? "Payments Reverted" : "Payment Reverted",
        description:
          paymentCount > 0
            ? `Reverted ${revertedBillCount || paymentCount} bill payment${(revertedBillCount || paymentCount) === 1 ? "" : "s"}.`
            : billId
              ? `Bill #${billId} has been reverted to unpaid.`
              : "The bill payment has been reverted.",
      });

      setSalesReportRevertBillId(null);
      setSalesReportRevertPaymentIds(null);
      setSalesReportRevertTargetLabel("payment");
      setSalesReportRevertPin("");
      setSalesReportRevertError("");
      setSalesReportBillDetailsEntry(null);
      setSelectedOldPaidPayments(new Set());
      setSelectedTotalSalesPaymentKeys(new Set());
    },
    onError: (error: Error) => {
      setSalesReportRevertError(error.message || "Failed to revert payment");
    },
  });

  const openSalesReportRevertDialog = (billId?: number | null) => {
    const normalizedBillId = Number(billId || 0);
    if (!Number.isFinite(normalizedBillId) || normalizedBillId <= 0) return;
    setSalesReportRevertBillId(normalizedBillId);
    setSalesReportRevertPaymentIds(null);
    setSalesReportRevertTargetLabel(`bill #${normalizedBillId}`);
    setSalesReportRevertPin("");
    setSalesReportRevertError("");
  };

  const openSalesReportPaymentsRevertDialog = (
    paymentIds: number[],
    targetLabel = "selected payments",
  ) => {
    const normalizedPaymentIds = Array.from(
      new Set(paymentIds.map(Number).filter((paymentId) => Number.isFinite(paymentId) && paymentId > 0)),
    );
    if (normalizedPaymentIds.length === 0) {
      toast({
        title: "No payments selected",
        description: "Select at least one payment to revert.",
        variant: "destructive",
      });
      return;
    }
    setSalesReportRevertBillId(null);
    setSalesReportRevertPaymentIds(normalizedPaymentIds);
    setSalesReportRevertTargetLabel(targetLabel);
    setSalesReportRevertPin("");
    setSalesReportRevertError("");
  };

  const confirmSalesReportBillRevert = () => {
    if (!salesReportRevertBillId && !salesReportRevertPaymentIds?.length) return;

    if (!/^\d{5}$/.test(salesReportRevertPin.trim())) {
      setSalesReportRevertError("Please enter the 5-digit admin PIN");
      return;
    }

    revertSalesReportBillPaymentMutation.mutate({
      billId: salesReportRevertBillId || undefined,
      paymentIds: salesReportRevertPaymentIds || undefined,
      adminPin: salesReportRevertPin.trim(),
    });
  };

  const {
    data: allCreditTransactions,
    isLoading: isLoadingCreditTransactions,
    error: creditTransactionsError,
  } = useQuery<any[]>({
    queryKey: ["/api/reports/credit-transactions"],
    enabled: creditOnly,
    ...salesReportQueryOptions,
  });

  const isLoading = creditOnly
    ? isLoadingCreditOnlyClients || isLoadingCreditOnlyBills || isLoadingCreditTransactions
    : isLoadingSalesPeriodData;

  useEffect(() => {
    if (selectedOldPaidPayments.size > 0) {
      setMovePaymentDateTimeValue((previousValue) => previousValue || toDateTimeLocal(new Date()));
      return;
    }

    setMovePaymentDateTimeValue("");
    setMovePaymentPin("");
    setMovePaymentError("");
    setMovePaymentConfirmOpen(false);
  }, [selectedOldPaidPayments.size]);

  useEffect(() => {
    if (!isMovingPayments || typeof document === "undefined") return;

    const body = document.body;
    const documentElement = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousDocumentOverflow = documentElement.style.overflow;

    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";

    const blockInteraction = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const blockKeyboardInteraction = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("wheel", blockInteraction, { capture: true, passive: false });
    document.addEventListener("touchmove", blockInteraction, { capture: true, passive: false });
    document.addEventListener("keydown", blockKeyboardInteraction, true);

    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousDocumentOverflow;
      document.removeEventListener("wheel", blockInteraction, true);
      document.removeEventListener("touchmove", blockInteraction, true);
      document.removeEventListener("keydown", blockKeyboardInteraction, true);
    };
  }, [isMovingPayments]);

  const billPaymentsByBillId = useMemo(() => {
    const groupedPayments = new Map<number, any[]>();

    for (const payment of allBillPayments || []) {
      const billId = Number(payment?.billId);
      if (!Number.isFinite(billId) || billId <= 0) {
        continue;
      }

      const existingPayments = groupedPayments.get(billId);
      if (existingPayments) {
        existingPayments.push(payment);
      } else {
        groupedPayments.set(billId, [payment]);
      }
    }

    Array.from(groupedPayments.values()).forEach((payments) => {
      payments.sort((left: any, right: any) => {
        const leftTime = new Date(left?.paymentDate || left?.date || "").getTime();
        const rightTime = new Date(right?.paymentDate || right?.date || "").getTime();
        const timeDelta =
          (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
        if (timeDelta !== 0) {
          return timeDelta;
        }
        return Number(left?.id || 0) - Number(right?.id || 0);
      });
    });

    return groupedPayments;
  }, [allBillPayments]);
  const paymentById = useMemo(() => {
    const payments = new Map<number, any>();

    for (const payment of allBillPayments || []) {
      const paymentId = Number(payment?.id);
      if (!Number.isFinite(paymentId) || paymentId <= 0) {
        continue;
      }
      payments.set(paymentId, payment);
    }

    return payments;
  }, [allBillPayments]);
  const clientById = useMemo(() => {
    const clientsMap = new Map<number, Client>();

    for (const client of allClients || []) {
      const clientId = Number(client?.id);
      if (!Number.isFinite(clientId) || clientId <= 0) {
        continue;
      }
      clientsMap.set(clientId, client);
    }

    return clientsMap;
  }, [allClients]);
  const billById = useMemo(() => {
    const billsMap = new Map<number, SalesReportBill>();

    for (const bill of allBills || []) {
      const billId = Number(bill?.id);
      if (!Number.isFinite(billId) || billId <= 0) {
        continue;
      }
      billsMap.set(billId, bill);
    }

    return billsMap;
  }, [allBills]);
  const ordersByBillId = useMemo(() => {
    const groupedOrders = new Map<number, Order[]>();

    for (const order of allOrders || []) {
      const billId = Number(order?.billId);
      if (!Number.isFinite(billId) || billId <= 0) {
        continue;
      }

      const existingOrders = groupedOrders.get(billId);
      if (existingOrders) {
        existingOrders.push(order);
      } else {
        groupedOrders.set(billId, [order]);
      }
    }

    return groupedOrders;
  }, [allOrders]);
  const orderByNumber = useMemo(() => {
    const ordersMap = new Map<string, Order>();

    for (const order of allOrders || []) {
      const orderNumber = String(order?.orderNumber || "").trim().toUpperCase();
      if (!orderNumber) {
        continue;
      }
      ordersMap.set(orderNumber, order);
    }

    return ordersMap;
  }, [allOrders]);
  const getClientById = (clientId?: number | null) => {
    const normalizedClientId = Number(clientId);
    if (!Number.isFinite(normalizedClientId) || normalizedClientId <= 0) {
      return undefined;
    }
    return clientById.get(normalizedClientId);
  };
  const getBillById = (billId?: number | null) => {
    const normalizedBillId = Number(billId);
    if (!Number.isFinite(normalizedBillId) || normalizedBillId <= 0) {
      return undefined;
    }
    return billById.get(normalizedBillId);
  };
  const getOrdersForBillId = (billId?: number | null) => {
    const normalizedBillId = Number(billId);
    if (!Number.isFinite(normalizedBillId) || normalizedBillId <= 0) {
      return [] as Order[];
    }
    return ordersByBillId.get(normalizedBillId) || [];
  };
  const getLatestReportOrderForBillId = (billId?: number | null) => {
    const linkedOrders = getOrdersForBillId(billId);
    return linkedOrders.length > 0 ? linkedOrders[linkedOrders.length - 1] : undefined;
  };
  const getTotalSalesPaymentSelectionKey = (payment: any) => {
    if (payment?.id !== undefined && payment?.id !== null) {
      return String(payment.id);
    }

    const sourcePaymentIds = Array.isArray(payment?.sourcePaymentIds)
      ? payment.sourcePaymentIds.join("-")
      : "";
    return `${payment?.billId || "bill"}-${payment?.date || payment?.paymentDate || "payment"}-${sourcePaymentIds}`;
  };

  const getTotalSalesPaymentSourceIds = (payment: any): number[] => {
    const rawSourceIds = Array.isArray(payment?.sourcePaymentIds)
      ? payment.sourcePaymentIds
      : [payment?.id];

    return Array.from(
      new Set(
        rawSourceIds
          .map((paymentId: unknown) => Number(paymentId))
          .filter((paymentId: number) => Number.isFinite(paymentId) && paymentId > 0),
      ),
    );
  };

  const toggleOldPaidPaymentSelection = (paymentId: number) => {
    if (isMovingPayments) return;
    if (!Number.isFinite(paymentId) || paymentId <= 0) return;
    setSelectedOldPaidPayments((previous) => {
      const next = new Set(previous);
      if (next.has(paymentId)) {
        next.delete(paymentId);
      } else {
        next.add(paymentId);
      }
      return next;
    });
  };

  const toggleTotalSalesPaymentSelection = (selectionKey: string) => {
    if (isMovingPayments) return;
    if (!selectionKey) return;
    setSelectedTotalSalesPaymentKeys((previous) => {
      const next = new Set(previous);
      if (next.has(selectionKey)) {
        next.delete(selectionKey);
      } else {
        next.add(selectionKey);
      }
      return next;
    });
  };

  const toggleAllTotalSalesPayments = useCallback((payments: any[]) => {
    if (isMovingPayments) return;
    const selectableKeys = payments
      .filter((payment) => getTotalSalesPaymentSourceIds(payment).length > 0)
      .map(getTotalSalesPaymentSelectionKey);
    if (selectableKeys.length === 0) return;

    const allSelected = selectableKeys.every((selectionKey) => selectedTotalSalesPaymentKeys.has(selectionKey));
    setSelectedTotalSalesPaymentKeys(allSelected ? new Set() : new Set(selectableKeys));
  }, [isMovingPayments, selectedTotalSalesPaymentKeys]);

  const isCtrlLeftClick = (event: ReactMouseEvent<HTMLElement>) =>
    event.button === 0 && (event.ctrlKey || event.metaKey);

  const isNestedSalesReportInteractiveTarget = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return false;

    const interactiveTarget = target.closest(
      'button,a,input,textarea,select,[role="button"]',
    );

    return Boolean(interactiveTarget && interactiveTarget !== event.currentTarget);
  };

  const handleSalesReportShortcutSelection = (
    event: ReactMouseEvent<HTMLElement>,
    toggleSelection: () => void,
  ) => {
    if (isMovingPayments || !isCtrlLeftClick(event) || isNestedSalesReportInteractiveTarget(event)) return;

    event.preventDefault();
    event.stopPropagation();
    toggleSelection();
  };
  const totalSystemCreditRemaining = useMemo(
    () =>
      (allClients || []).reduce((sum, client) => {
        const creditAmount = parseFloat(String(client?.deposit || "0"));
        if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
          return sum;
        }
        return sum + creditAmount;
      }, 0),
    [allClients],
  );

  const handleMovePaymentDates = async (
    oldPaidPaymentEntries: Array<{ payment: any }>,
  ) => {
    if (selectedOldPaidPayments.size === 0) return;
    if (!movePaymentDateTimeValue) {
      setMovePaymentError("Please select date and time");
      return;
    }
    if (!movePaymentPin.trim()) {
      setMovePaymentError("Please enter admin PIN");
      return;
    }

    const paymentsToMove = Array.from(
      new Map(
        oldPaidPaymentEntries
          .filter((entry) => selectedOldPaidPayments.has(Number(entry.payment?.id || 0)))
          .map((entry) => [Number(entry.payment.id), entry.payment]),
      ).values(),
    );

    if (paymentsToMove.length === 0) {
      toast({
        title: "No payments selected",
        description: "Select at least one old bill payment to move.",
        variant: "destructive",
      });
      return;
    }

    setIsMovingPayments(true);
    setMovePaymentError("");
    try {
      const targetDate = new Date(movePaymentDateTimeValue);
      if (Number.isNaN(targetDate.getTime())) {
        setMovePaymentError("Please select a valid date and time");
        return;
      }

      await apiRequest("PATCH", "/api/bill-payments/move-dates", {
        paymentIds: paymentsToMove.map((payment) => Number(payment.id)),
        newDate: targetDate.toISOString(),
        adminPin: movePaymentPin,
        requireAdminPin: true,
      });

      await refreshSalesReportQueries();
      toast({
        title: "Payment dates updated",
        description: `Moved ${paymentsToMove.length} payment(s) to ${targetDate.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}`,
      });
      setSelectedOldPaidPayments(new Set());
      setMovePaymentDateTimeValue("");
      setMovePaymentPin("");
      setMovePaymentError("");
      setMovePaymentConfirmOpen(false);
    } catch (err: any) {
      const errorMessage = String(err?.message || "");
      if (errorMessage.toLowerCase().includes("invalid admin pin")) {
        setMovePaymentError("Invalid admin PIN");
      } else {
        setMovePaymentError("Failed to move payment dates");
      }
      toast({ title: "Error", description: err.message || "Failed to move payment dates", variant: "destructive" });
    } finally {
      setIsMovingPayments(false);
    }
  };

  const dateMatchesPeriod = (date: Date, period: ReportPeriod) => {
    if (period === 'daily') {
      const selectedDateObj = parseLocalDate(selectedDate);
      selectedDateObj.setHours(0, 0, 0, 0);
      const dateNorm = new Date(date);
      dateNorm.setHours(0, 0, 0, 0);
      return dateNorm.getTime() === selectedDateObj.getTime();
    } else if (period === 'monthly') {
      const m = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return m === selectedMonth;
    } else if (period === 'range') {
      const startDateObj = parseRangeBoundary(startDate, false);
      const endDateObj = parseRangeBoundary(endDate, true);
      return date >= startDateObj && date <= endDateObj;
    } else {
      return date.getFullYear().toString() === selectedYear;
    }
  };

  const normalizeReportAddress = (value: string | null | undefined) => {
    const trimmed = String(value || "").trim();
    if (!trimmed || trimmed === "-") return "";
    return trimmed;
  };

  const normalizeReportPhone = (value: string | null | undefined) => {
    const trimmed = String(value || "").trim();
    if (!trimmed || trimmed === "-") return "";
    return trimmed;
  };

  const getOrderCustomerName = (order: Order, client?: any | null) =>
    order.customerName || client?.name || "Walk-in";

  const getOrderCustomerAddress = (order: Order, client?: any | null) => {
    const deliveryAddress = normalizeReportAddress(order.deliveryAddress);
    if (deliveryAddress) return deliveryAddress;
    return normalizeReportAddress(client?.address);
  };

  const getOrderCustomerPhone = (order: Order, client?: any | null) =>
    normalizeReportPhone((order as any).customerPhone || client?.phone);

  const getPaymentCustomerAddress = (payment: any, client?: any | null) => {
    if (payment.billId) {
      const linkedOrder = getOrdersForBillId(payment.billId).find((order) => getOrderCustomerAddress(order, client));
      const orderAddress = linkedOrder ? getOrderCustomerAddress(linkedOrder, client) : "";
      if (orderAddress) return orderAddress;
    }
    return normalizeReportAddress(client?.address);
  };

  const getPaymentCustomerPhone = (payment: any, client?: any | null) =>
    normalizeReportPhone(payment.clientPhone || client?.phone);

  const getSalesPaymentLinkedOrder = (payment: any) => {
    if (!payment.billId) return undefined;
    return getOrdersForBillId(payment.billId)[0];
  };

  const getSalesPaymentBillNumber = (payment: any, bill?: any | null) =>
    bill?.id || payment.billId || "-";

  const getSalesPaymentClient = (payment: any, bill?: SalesReportBill | null) =>
    getClientById(payment?.clientId) || getClientById(bill?.clientId);

  const extractSharedPaymentMetaFromText = (value?: string | null) => {
    if (!value) return null;
    const match = String(value).match(/\[SHARED:(\d+):(\d+)\]/i);
    if (!match) return null;

    const billCount = Number(match[1]);
    const clientCount = Number(match[2]);
    if (!Number.isFinite(billCount) || !Number.isFinite(clientCount)) {
      return null;
    }

    return { billCount, clientCount };
  };

  const buildSharedSalesPaymentSummary = (billCount: number, clientCount: number) => {
    if (billCount <= 1 || clientCount <= 1) {
      return null;
    }

    return `${billCount} separate client bill shared payment`;
  };

  const getSharedSalesPaymentSummary = (...values: Array<string | null | undefined>) => {
    for (const value of values) {
      const sharedMeta = extractSharedPaymentMetaFromText(value);
      if (!sharedMeta) continue;

      const label = buildSharedSalesPaymentSummary(sharedMeta.billCount, sharedMeta.clientCount);
      if (label) {
        return label;
      }
    }

    return null;
  };

  const getSalesPaymentOrderSummary = (payment: any, bill?: any | null) => {
    const sharedPaymentSummary = getSharedSalesPaymentSummary(
      payment.notes,
      payment.description,
      bill?.description,
    );
    if (sharedPaymentSummary) {
      return sharedPaymentSummary;
    }

    const linkedOrder = getSalesPaymentLinkedOrder(payment);
    if (linkedOrder?.orderNumber) {
      return `Payment for Order #${linkedOrder.orderNumber}`;
    }

    const textSources = [payment.notes, payment.description, bill?.description]
      .map((value) => String(value || ""))
      .filter(Boolean);
    for (const source of textSources) {
      const orderMatch = source.match(/ORD-\d+/i);
      if (orderMatch) {
        return `Payment for Order #${orderMatch[0].toUpperCase()}`;
      }
    }

    return `Payment for Bill #${getSalesPaymentBillNumber(payment, bill)}`;
  };

  const buildSalesPaymentMethodLabel = (paymentMethods: Array<string | null | undefined>) => {
    const labels: string[] = [];
    const seenKeys = new Set<string>();

    for (const rawMethod of paymentMethods) {
      const rawParts = String(rawMethod || "")
        .split("+")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);

      for (const rawPart of rawParts) {
        let comparisonKey = rawPart;
        let displayLabel: string;

        switch (rawPart) {
          case "credit":
          case "deposit":
          case "bulk_deposit":
            comparisonKey = "credit";
            displayLabel = "Credit";
            break;
          case "cash":
            displayLabel = "Cash";
            break;
          case "card":
            displayLabel = "Card";
            break;
          case "bank transfer":
          case "bank":
          case "transfer":
            comparisonKey = "bank";
            displayLabel = "Bank Transfer";
            break;
          default:
            displayLabel = rawPart.toUpperCase();
            break;
        }

        if (seenKeys.has(comparisonKey)) {
          continue;
        }

        seenKeys.add(comparisonKey);
        labels.push(displayLabel);
      }
    }

    return labels.join(" + ");
  };

  const extractSplitPaymentGroupFromText = (value?: string | null) => {
    if (!value) return null;
    const match = String(value).match(/\[SPLIT:([^\]]+)\]/i);
    return match?.[1] ? match[1] : null;
  };

  const getSalesPaymentRecordTime = (value?: string | Date | null) => {
    const timestamp = new Date(value || "").getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  const compareSalesPaymentRecordsAsc = (left: any, right: any) => {
    const timeDelta = getSalesPaymentRecordTime(left.date || left.paymentDate) - getSalesPaymentRecordTime(right.date || right.paymentDate);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return Number(left.id || 0) - Number(right.id || 0);
  };

  const compareSalesPaymentRecordsDesc = (left: any, right: any) => compareSalesPaymentRecordsAsc(right, left);

  const getSalesPaymentEventGroupKey = (payment: any) => {
    const splitGroupId = extractSplitPaymentGroupFromText(payment?.notes);
    if (splitGroupId) {
      return `split:${splitGroupId.trim().toUpperCase()}`;
    }

    return `payment:${Number(payment?.id || 0)}`;
  };

  const salesBillPartialHistoryByBillId = useMemo(() => {
    const historyByBillId = new Map<number, SalesPaymentHistoryMeta>();
    billPaymentsByBillId.forEach((payments, billId) => {
      const bill = billById.get(billId);
      const finalAmount = parseFloat(String(bill?.amount || "0"));
      if (!bill?.isPaid || !Number.isFinite(finalAmount) || finalAmount <= 0.01) {
        historyByBillId.set(billId, EMPTY_SALES_PAYMENT_HISTORY_META);
        return;
      }

      const groupedEvents = new Map<string, { amount: number; time: number }>();
      payments
        .slice()
        .sort(compareSalesPaymentRecordsAsc)
        .forEach((payment) => {
          const amount = parseFloat(String(payment?.amount || "0"));
          if (!Number.isFinite(amount) || amount <= 0) {
            return;
          }

          const eventKey = getSalesPaymentEventGroupKey(payment);
          const paymentTime = getSalesPaymentRecordTime(payment?.paymentDate || payment?.date);
          const existing = groupedEvents.get(eventKey);

          if (existing) {
            existing.amount += amount;
            existing.time = Math.min(existing.time, paymentTime || Number.MAX_SAFE_INTEGER);
            return;
          }

          groupedEvents.set(eventKey, {
            amount,
            time: paymentTime || Number.MAX_SAFE_INTEGER,
          });
        });

      let runningPaidAmount = 0;
      let firstPartialEventTime: number | null = null;
      let wasFullyPaidAfterPartial = false;

      const orderedEvents = Array.from(groupedEvents.values()).sort((left, right) => left.time - right.time);
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
          wasFullyPaidAfterPartial = firstPartialEventTime !== null;
          break;
        }
      }

      historyByBillId.set(
        billId,
        wasFullyPaidAfterPartial
          ? {
              historyBadgeLabel: null,
              historyBadgeClass: "",
              historyNote: null,
              firstPartialPaymentDate:
                firstPartialEventTime !== null ? new Date(firstPartialEventTime).toISOString() : null,
            }
          : EMPTY_SALES_PAYMENT_HISTORY_META,
      );
    });

    (allBills || []).forEach((bill: any) => {
      if (!historyByBillId.has(Number(bill?.id || 0))) {
        historyByBillId.set(Number(bill.id), EMPTY_SALES_PAYMENT_HISTORY_META);
      }
    });

    return historyByBillId;
  }, [allBills, billById, billPaymentsByBillId]);

  const getSalesBillPartialHistoryMeta = (billId?: number | null): SalesPaymentHistoryMeta => {
    const normalizedBillId = Number(billId);
    if (!Number.isFinite(normalizedBillId) || normalizedBillId <= 0) {
      return EMPTY_SALES_PAYMENT_HISTORY_META;
    }

    return salesBillPartialHistoryByBillId.get(normalizedBillId) || EMPTY_SALES_PAYMENT_HISTORY_META;
  };

  const buildSalesPaymentDescriptionFromSummary = (
    orderSummary: string | null | undefined,
    billDisplayNumber: string | number | null | undefined,
    paymentMethods: Array<string | null | undefined>,
  ) => {
    const paymentMethodLabel = buildSalesPaymentMethodLabel(paymentMethods);
    const summaryLabel = String(orderSummary || "").trim() || `Payment for Bill #${billDisplayNumber || "-"}`;

    if (!paymentMethodLabel) {
      return summaryLabel;
    }

    if (/^Payment for Bill #/i.test(summaryLabel)) {
      return `${summaryLabel} | Paid with ${paymentMethodLabel}`;
    }

    return `${summaryLabel} | Bill #${billDisplayNumber || "-"} | Paid with ${paymentMethodLabel}`;
  };

  const buildGroupedSalesPayments = (payments: any[]) => {
    const groupedPayments = new Map<
      string,
      {
        splitGroupId: string | null;
        items: any[];
      }
    >();

    payments.forEach((payment) => {
      const splitGroupId = extractSplitPaymentGroupFromText(payment.notes);
      const groupKey = splitGroupId ? `split:${payment.billId || "none"}:${splitGroupId}` : `payment:${payment.id}`;
      const existingGroup = groupedPayments.get(groupKey);

      if (existingGroup) {
        existingGroup.items.push(payment);
        return;
      }

      groupedPayments.set(groupKey, {
        splitGroupId,
        items: [payment],
      });
    });

    return Array.from(groupedPayments.values())
      .map((group) => {
        const orderedItems = group.items.slice().sort(compareSalesPaymentRecordsAsc);
        const anchor = orderedItems[orderedItems.length - 1] || orderedItems[0];
        const totalAmount = orderedItems.reduce((sum, payment) => {
          const amount = parseFloat(String(payment.amount || "0"));
          return Number.isFinite(amount) ? sum + amount : sum;
        }, 0);
        const paymentMethods = orderedItems.map((payment) => payment.paymentMethod);

        return {
          ...anchor,
          id: group.splitGroupId ? `split-${anchor.billId || "none"}-${group.splitGroupId}` : anchor.id,
          amount: totalAmount.toFixed(2),
          paymentMethod: buildSalesPaymentMethodLabel(paymentMethods) || anchor.paymentMethod,
          description: buildSalesPaymentDescriptionFromSummary(
            anchor.orderSummary,
            anchor.billDisplayNumber || anchor.billId,
            paymentMethods,
          ),
          splitGroupId: group.splitGroupId,
          sourcePaymentIds: orderedItems.map((payment) => payment.id),
        };
      })
      .sort(compareSalesPaymentRecordsAsc);
  };

  const getSalesPaymentMethodDescription = (payment: any, bill?: any | null) => {
    const currentPaymentTime = new Date(payment.paymentDate || payment.date || "").getTime();
    const relatedMethods =
      (billPaymentsByBillId.get(Number(payment.billId || 0)) || [])
        .filter((candidate: any) => {
          if (!Number.isFinite(currentPaymentTime)) {
            return true;
          }

          const candidateTime = new Date(candidate.paymentDate || "").getTime();
          if (!Number.isFinite(candidateTime)) {
            return false;
          }

          if (candidateTime < currentPaymentTime) {
            return true;
          }

          if (candidateTime > currentPaymentTime) {
            return false;
          }

          return Number(candidate.id || 0) <= Number(payment.id || 0);
        })
        .sort((left: any, right: any) => {
          const timeDelta =
            new Date(left.paymentDate || "").getTime() - new Date(right.paymentDate || "").getTime();
          if (timeDelta !== 0) {
            return timeDelta;
          }
          return Number(left.id || 0) - Number(right.id || 0);
        })
        .map((candidate: any) => candidate.paymentMethod)
        .filter(Boolean) || [];

    const paymentMethodLabel = buildSalesPaymentMethodLabel(
      relatedMethods.length > 0 ? relatedMethods : [bill?.paymentMethod, payment.paymentMethod],
    );

    return paymentMethodLabel || "Payment";
  };

  const getSalesPaymentDescription = (payment: any, bill?: any | null) => {
    const orderSummary = getSalesPaymentOrderSummary(payment, bill);
    const paymentMethodLabel = getSalesPaymentMethodDescription(payment, bill);
    if (/^Payment for Bill #/i.test(orderSummary)) {
      return `${orderSummary} | Paid with ${paymentMethodLabel}`;
    }
    return `${orderSummary} | Bill #${getSalesPaymentBillNumber(payment, bill)} | Paid with ${paymentMethodLabel}`;
  };

  const getSalesPaymentStatusMeta = (payment: any, bill?: any | null): SalesPaymentStatusMeta => {
    const billAmount = parseFloat(String(bill?.amount || "0"));
    const partialHistoryMeta = getSalesBillPartialHistoryMeta(Number(payment?.billId || bill?.id || 0));
    if (!payment?.billId || !Number.isFinite(billAmount) || billAmount <= 0) {
      return {
        label: "Unknown",
        badgeClass: "border-slate-300 text-slate-600",
        ...EMPTY_SALES_PAYMENT_HISTORY_META,
      };
    }

    const paymentRows = billPaymentsByBillId.get(Number(payment.billId)) || [];
    if (paymentRows.length === 0) {
      const currentPaidAmount = parseFloat(String(bill?.paidAmount || "0"));
      if (Number.isFinite(currentPaidAmount) && currentPaidAmount >= billAmount - 0.01) {
        return {
          label: "Fully Paid",
          badgeClass: "border-green-600 text-green-600",
          ...partialHistoryMeta,
        };
      }

      if (Number.isFinite(currentPaidAmount) && currentPaidAmount > 0.01) {
        return {
          label: "Partially Paid",
          badgeClass: "border-amber-600 text-amber-600",
          ...EMPTY_SALES_PAYMENT_HISTORY_META,
        };
      }

      return {
        label: "Unpaid",
        badgeClass: "border-blue-600 text-blue-600",
        ...EMPTY_SALES_PAYMENT_HISTORY_META,
      };
    }

    const paymentTime = getSalesPaymentRecordTime(payment.paymentDate || payment.date);
    const sourcePaymentIds = Array.isArray(payment?.sourcePaymentIds)
      ? payment.sourcePaymentIds
          .map((value: unknown) => Number(value))
          .filter((value: number) => Number.isFinite(value) && value > 0)
      : [];
    const anchorPaymentId = sourcePaymentIds.length > 0
      ? Math.max(...sourcePaymentIds)
      : Number(payment?.id || 0);

    const paidAfterThisPayment = paymentRows.reduce((sum, candidate: any) => {
      const candidateTime = getSalesPaymentRecordTime(candidate?.paymentDate || candidate?.date);
      const candidateId = Number(candidate?.id || 0);

      if (Number.isFinite(paymentTime)) {
        if (candidateTime < paymentTime) {
          const amount = parseFloat(String(candidate?.amount || "0"));
          return Number.isFinite(amount) ? sum + amount : sum;
        }

        if (candidateTime > paymentTime) {
          return sum;
        }

        if (Number.isFinite(anchorPaymentId) && anchorPaymentId > 0 && candidateId <= anchorPaymentId) {
          const amount = parseFloat(String(candidate?.amount || "0"));
          return Number.isFinite(amount) ? sum + amount : sum;
        }

        return sum;
      }

      const amount = parseFloat(String(candidate?.amount || "0"));
      return Number.isFinite(amount) ? sum + amount : sum;
    }, 0);

    if (paidAfterThisPayment >= billAmount - 0.01) {
      return {
        label: "Fully Paid",
        badgeClass: "border-green-600 text-green-600",
        ...partialHistoryMeta,
      };
    }

    if (paidAfterThisPayment > 0.01) {
      return {
        label: "Partially Paid",
        badgeClass: "border-amber-600 text-amber-600",
        ...EMPTY_SALES_PAYMENT_HISTORY_META,
      };
    }

    return {
      label: "Unpaid",
      badgeClass: "border-blue-600 text-blue-600",
      ...EMPTY_SALES_PAYMENT_HISTORY_META,
    };
  };

  const openSalesReportBillDetails = (payment: any) => {
    const billId = Number(payment?.billId || 0);
    if (!Number.isFinite(billId) || billId <= 0) return;

    const linkedBill = getBillById(billId);
    if (!linkedBill) {
      toast({
        title: "Bill not found",
        description: "This bill is no longer available to view.",
        variant: "destructive",
      });
      return;
    }

    setSalesReportBillDetailsEntry(payment);
  };

  const getSalesReportBillDisplayAmounts = (bill: any) => {
    const discountRaw = parseFloat(String(bill?.discountAmount || "0"));
    const finalRaw = parseFloat(String(bill?.amount || "0"));
    const paidRaw = parseFloat(String(bill?.paidAmount || "0"));
    const originalRaw = parseFloat(String(bill?.originalAmount ?? ""));

    const discount = Number.isFinite(discountRaw) ? Math.max(0, discountRaw) : 0;
    const finalAmount = Number.isFinite(finalRaw) ? Math.max(0, finalRaw) : 0;
    const paidAmount = Number.isFinite(paidRaw) ? Math.max(0, paidRaw) : 0;
    const originalAmount =
      Number.isFinite(originalRaw) && (originalRaw > 0 || String(bill?.originalAmount ?? "").trim() !== "")
        ? Math.max(0, originalRaw)
        : Math.max(0, finalAmount + discount);

    return {
      discount,
      originalAmount,
      finalAmount,
      paidAmount,
      dueAmount: Math.max(0, finalAmount - paidAmount),
    };
  };

  const getSalesReportBillStatusMeta = (bill: any) => {
    const amounts = getSalesReportBillDisplayAmounts(bill);
    const hasPaidAmount = amounts.paidAmount > 0.01;

    if (bill?.isPaid) {
      return {
        label: "PAID",
        badgeClass: "bg-green-500 hover:bg-green-600 text-white",
        cardClass: "border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/40 dark:to-emerald-950/40 dark:border-green-800",
        accentClass: "from-emerald-400 via-green-500 to-teal-500",
        summaryClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      };
    }

    if (hasPaidAmount) {
      return {
        label: "PARTIAL",
        badgeClass: "bg-amber-500 hover:bg-amber-600 text-white",
        cardClass: "border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/40 dark:to-yellow-950/40 dark:border-amber-800",
        accentClass: "from-amber-400 via-orange-500 to-yellow-500",
        summaryClass: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
    }

    return {
      label: "UNPAID",
      badgeClass: "bg-blue-500 hover:bg-blue-600 text-white",
      cardClass: "border-blue-200 bg-gradient-to-br from-blue-50 to-sky-50 dark:from-blue-950/40 dark:to-sky-950/40 dark:border-blue-800",
      accentClass: "from-sky-400 via-blue-500 to-indigo-500",
      summaryClass: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    };
  };

  const getSalesReportBillLatestPaymentDate = (billId?: number | null) => {
    const normalizedBillId = Number(billId || 0);
    if (!Number.isFinite(normalizedBillId) || normalizedBillId <= 0) {
      return null;
    }

    const payments = billPaymentsByBillId.get(normalizedBillId) || [];
    const latestPayment = payments[payments.length - 1];
    return latestPayment?.paymentDate || latestPayment?.date || null;
  };

  const formatSalesReportBillChipDate = (value?: string | Date | null) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const formatSalesReportBillHeaderDate = (value?: string | Date | null) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  };

  const buildExcelClientCell = (name: string, address: string, phone?: string): ExcelExportCell => {
    const phoneLabel = normalizeReportPhone(phone);
    if (!address && !phoneLabel) return name;

    const title = address ? `${name} (${address})` : name;
    return {
      richText: [
        { text: title, font: { bold: true } },
        ...(phoneLabel ? [{ text: `\n${phoneLabel}` }] : []),
      ],
    };
  };

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const buildPdfClientCell = (name: string, address: string, phone?: string, compact = false) => {
    const phoneLabel = normalizeReportPhone(phone);
    const addressLabel = normalizeReportAddress(address);
    const nameFontSize = compact ? "5.8px" : "inherit";
    const addressFontSize = compact ? "5.1px" : "6.6px";
    const phoneFontSize = compact ? "5.3px" : "7px";
    const addressMarginTop = compact ? "0" : "1px";
    const phoneMarginTop = compact ? "1px" : "2px";

    return `
      <span style="display:block;color:#111;font-weight:700;font-size:${nameFontSize};line-height:${compact ? "1.04" : "1.1"};">${escapeHtml(name)}</span>
      ${addressLabel ? `<span style="display:block;color:#4b5563;font-size:${addressFontSize};line-height:${compact ? "1.04" : "1.12"};margin-top:${addressMarginTop};">${escapeHtml(addressLabel)}</span>` : ''}
      ${phoneLabel ? `<span style="display:block;color:#111827;font-size:${phoneFontSize};line-height:${compact ? "1.08" : "1.18"};margin-top:${phoneMarginTop};font-weight:700;">${escapeHtml(phoneLabel)}</span>` : ''}
    `;
  };

  type SalesPaymentBreakdownRow = {
    key: "cash" | "card" | "bank" | "credit" | "other";
    label: string;
    billCount: number;
    totalAmount: number;
  };

  type SalesCreditManagementTransaction = {
    id: number;
    clientId: number;
    billId?: number | null;
    type: string;
    amount: string;
    description?: string | null;
    date: string;
    paymentMethod?: string | null;
    processedBy?: string | null;
    clientName?: string | null;
    accountNumber?: string | null;
  };

  type VisibleSalesCreditManagementTransaction = SalesCreditManagementTransaction & {
    displayDescription: string;
    accountLabel: string;
    customerName: string;
    amountValue: number;
    isDeduction: boolean;
    billDisplayNumber: number | string;
  };

  type SalesCreditManagementData = {
    entries: VisibleSalesCreditManagementTransaction[];
    totalAdded: number;
    totalUsed: number;
    addedCount: number;
    usedCount: number;
  };

  type SalesCreditSummary = {
    usageLabel: string;
    usedAmount: number;
    usedBillCount: number;
    remainingAmount: number;
  };

  const formatSalesPaymentMethodLabel = (method?: string | null) => {
    return buildSalesPaymentMethodLabel([method]) || "-";
  };

  const getPaymentBreakdownLines = (payment: any) => {
    const sourcePaymentIds = Array.isArray(payment?.sourcePaymentIds)
      ? payment.sourcePaymentIds
      : [];

    if (sourcePaymentIds.length <= 1) {
      const methodLabel = formatSalesPaymentMethodLabel(payment?.paymentMethod);
      const amountValue = parseFloat(String(payment?.amount || "0"));
      return Number.isFinite(amountValue)
        ? [`${methodLabel}: ${amountValue.toFixed(2)} AED`]
        : [methodLabel];
    }

    const groupedParts = sourcePaymentIds
      .map((sourcePaymentId: number) => paymentById.get(Number(sourcePaymentId)))
      .filter(Boolean)
      .sort(compareSalesPaymentRecordsAsc)
      .map((candidate: any) => {
        const amountValue = parseFloat(String(candidate.amount || "0"));
        return {
          label: formatSalesPaymentMethodLabel(candidate.paymentMethod),
          amountValue: Number.isFinite(amountValue) ? amountValue : 0,
        };
      });

    if (groupedParts.length === 0) {
      return [formatSalesPaymentMethodLabel(payment?.paymentMethod)];
    }

    return groupedParts.map((part: { label: string; amountValue: number }) => `${part.label}: ${part.amountValue.toFixed(2)} AED`);
  };

  const getPaymentBreakdownInline = (payment: any) => getPaymentBreakdownLines(payment).join(" + ");

  const CREDIT_MANAGEMENT_EPSILON = 0.01;

  const collectCreditManagementBillIds = (value?: string | null) => {
    if (!value) return [];
    const matches = String(value).match(/#(\d+)/g) || [];
    const ids = matches
      .map((token) => Number(token.replace("#", "")))
      .filter((id) => Number.isFinite(id) && id > 0);
    return Array.from(new Set(ids));
  };

  const getSingleBillCreditManagementBillId = (transaction: SalesCreditManagementTransaction) => {
    if (transaction.type !== "bulk_deposit_used") {
      return null;
    }

    const billIds = collectCreditManagementBillIds(transaction.description);
    return billIds.length === 1 ? billIds[0] : null;
  };

  const getSingleBillCreditManagementDescription = (transaction: SalesCreditManagementTransaction) => {
    const billId = getSingleBillCreditManagementBillId(transaction);
    if (!billId) return null;

    const discountMatch = String(transaction.description || "").match(/Discount:\s*([0-9.]+)\s*AED/i);
    const discountAmount = parseFloat(discountMatch?.[1] || "0");
    const baseLabel = `Deposit used for Bill #${billId}`;

    if (Number.isFinite(discountAmount) && discountAmount > 0.009) {
      return `${baseLabel} | Discount: ${discountAmount.toFixed(2)} AED`;
    }

    return baseLabel;
  };

  const extractCreditManagementOrderNumber = (value?: string | null) => {
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

  const normalizeCreditManagementDescription = (value?: string | null) => {
    const cleaned = String(value || "")
      .replace(/\s*\[(?:bulk|SPLIT):[^\]]+\]/gi, "")
      .replace(/\s*\|\s*\|\s*/g, " | ")
      .replace(/\s{2,}/g, " ")
      .replace(/^\s*\|\s*/g, "")
      .replace(/\s*\|\s*$/g, "")
      .trim();

    return cleaned || "No description";
  };

  const formatCreditManagementDisplayDescription = (
    transaction: SalesCreditManagementTransaction,
    bill?: { id?: number | null; referenceNumber?: string | null; description?: string | null } | null,
  ) => {
    const normalized = normalizeCreditManagementDescription(transaction.description);
    const isDeduction =
      transaction.type === "deposit_used" ||
      transaction.type === "bulk_deposit_used" ||
      transaction.type === "deposit_deduction";

    if (!isDeduction) {
      return normalized;
    }

    const billId = transaction.billId ?? getSingleBillCreditManagementBillId(transaction) ?? bill?.id ?? null;
    const orderNumber =
      extractCreditManagementOrderNumber(transaction.description) ||
      extractCreditManagementOrderNumber(bill?.referenceNumber) ||
      extractCreditManagementOrderNumber(bill?.description);

    if (billId && orderNumber) {
      return `Deposit used for Bill #${billId}: Order #${orderNumber}`;
    }

    if (billId) {
      return `Deposit used for Bill #${billId}`;
    }

    return normalized;
  };

  const parseCreditManagementAmount = (value?: string | null) => {
    const parsed = parseFloat(String(value || "0"));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const compareCreditManagementTransactionsAsc = (
    left: SalesCreditManagementTransaction,
    right: SalesCreditManagementTransaction,
  ) => {
    const timeDelta = new Date(left.date).getTime() - new Date(right.date).getTime();
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.id - right.id;
  };

  const buildVisibleCreditManagementTransactions = (
    transactions?: SalesCreditManagementTransaction[] | null,
  ): SalesCreditManagementTransaction[] => {
    if (!transactions || transactions.length === 0) {
      return [];
    }

    const sortedTransactions = [...transactions].sort(compareCreditManagementTransactionsAsc);

    const shouldHideBulkDepositSummary = (transaction: SalesCreditManagementTransaction) => {
      if (transaction.type !== "bulk_deposit_used") {
        return false;
      }

      const summaryBillIds = collectCreditManagementBillIds(transaction.description);
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

      const summaryAmount = parseCreditManagementAmount(transaction.amount);
      const depositUsedAmount = matchingDepositRows.reduce(
        (sum, candidate) => sum + parseCreditManagementAmount(candidate.amount),
        0,
      );

      return Math.abs(summaryAmount - depositUsedAmount) <= CREDIT_MANAGEMENT_EPSILON;
    };

    return sortedTransactions
      .filter((transaction) => !shouldHideBulkDepositSummary(transaction))
      .map((transaction) => ({
        ...transaction,
        description: normalizeCreditManagementDescription(transaction.description),
      }));
  };

  const getSalesPaymentBreakdown = (payments: any[]): SalesPaymentBreakdownRow[] => {
    const buckets = {
      cash: { label: "Cash", paymentCount: 0, totalAmount: 0, billIds: new Set<number>() },
      card: { label: "Card", paymentCount: 0, totalAmount: 0, billIds: new Set<number>() },
      bank: { label: "Bank Transfer", paymentCount: 0, totalAmount: 0, billIds: new Set<number>() },
      credit: { label: "Credit", paymentCount: 0, totalAmount: 0, billIds: new Set<number>() },
      other: { label: "Other", paymentCount: 0, totalAmount: 0, billIds: new Set<number>() },
    };

    payments.forEach((payment: any) => {
      const normalized = String(payment?.paymentMethod || "cash").trim().toLowerCase();
      const key =
        normalized === "cash"
          ? "cash"
          : normalized === "card"
            ? "card"
            : normalized === "bank" || normalized === "transfer" || normalized === "bank transfer"
              ? "bank"
              : normalized === "deposit" || normalized === "bulk_deposit"
                ? "credit"
              : "other";
      const bucket = buckets[key];
      const amount = parseFloat(String(payment?.amount || "0"));

      bucket.paymentCount += 1;
      if (Number.isFinite(amount)) {
        bucket.totalAmount += amount;
      }

      const billId = Number(payment?.billId);
      if (Number.isFinite(billId)) {
        bucket.billIds.add(billId);
      }
    });

    const rows: SalesPaymentBreakdownRow[] = [
      {
        key: "cash",
        label: buckets.cash.label,
        billCount: buckets.cash.billIds.size,
        totalAmount: buckets.cash.totalAmount,
      },
      {
        key: "card",
        label: buckets.card.label,
        billCount: buckets.card.billIds.size,
        totalAmount: buckets.card.totalAmount,
      },
      {
        key: "bank",
        label: buckets.bank.label,
        billCount: buckets.bank.billIds.size,
        totalAmount: buckets.bank.totalAmount,
      },
      {
        key: "credit",
        label: buckets.credit.label,
        billCount: buckets.credit.billIds.size,
        totalAmount: buckets.credit.totalAmount,
      },
    ];

    if (buckets.other.paymentCount > 0) {
      rows.push({
        key: "other",
        label: buckets.other.label,
        billCount: buckets.other.billIds.size,
        totalAmount: buckets.other.totalAmount,
      });
    }

    return rows;
  };

  const getSalesCreditUsageLabel = () => {
    if (activeTab === "daily") return "Credit Used This Day";
    if (activeTab === "monthly") return "Credit Used This Month";
    if (activeTab === "yearly") return "Credit Used This Year";
    if (activeTab === "range") return "Credit Used In Selected Range";
    return "Credit Used In This Report";
  };

  const getSalesCreditSummary = (paymentBreakdownRows: SalesPaymentBreakdownRow[]): SalesCreditSummary => {
    const creditBreakdown = paymentBreakdownRows.find((row) => row.key === "credit");

    return {
      usageLabel: getSalesCreditUsageLabel(),
      usedAmount: creditBreakdown?.totalAmount || 0,
      usedBillCount: creditBreakdown?.billCount || 0,
      remainingAmount: totalSystemCreditRemaining,
    };
  };

  const formatSalesReportPdfDateTime = (value?: string | Date | null) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  const getSalesPaymentStatusExportLabel = (
    paymentStatus: Pick<SalesPaymentStatusMeta, "label">,
  ) => {
    return paymentStatus.label;
  };

  const getSalesPaymentPartialDateLabel = (
    paymentStatus: Pick<SalesPaymentHistoryMeta, "firstPartialPaymentDate">,
    formatter: (value: string | Date) => string,
  ) => {
    if (!paymentStatus.firstPartialPaymentDate) {
      return null;
    }

    return `Partial: ${formatter(paymentStatus.firstPartialPaymentDate)}`;
  };

  const getSalesPaymentPaidDateLabel = (
    value: string | Date | null | undefined,
    formatter: (value: string | Date) => string,
  ) => {
    if (!value) {
      return null;
    }

    return `Paid: ${formatter(value)}`;
  };

  const getOrderPaidDateLabelForPdf = (order: Order, period: ReportPeriod) => {
    const paidDate = getOrderPaidDateDisplay(order, period);
    return paidDate ? formatSalesReportPdfDateTime(paidDate) : "-";
  };

  const getOrderPaymentMethodForPeriod = (order: Order, period: ReportPeriod) => {
    if (!order.billId) {
      return order.paymentMethod ? formatSalesPaymentMethodLabel(order.paymentMethod) : "-";
    }

    const paymentsForBill = billPaymentsByBillId.get(order.billId) || [];
    if (paymentsForBill.length === 0) {
      return order.paymentMethod ? formatSalesPaymentMethodLabel(order.paymentMethod) : "-";
    }

    const periodEndTime = getPeriodEndDate(period).getTime();
    const paymentMethods = paymentsForBill
      .filter((payment: any) => {
        const paymentTime = getSalesPaymentRecordTime(payment?.paymentDate || payment?.date);
        return Number.isFinite(paymentTime) && paymentTime <= periodEndTime;
      })
      .map((payment: any) => payment.paymentMethod);

    if (paymentMethods.length === 0) {
      return "-";
    }

    return buildSalesPaymentMethodLabel(paymentMethods) || "-";
  };

  const renderSalesSummaryCardsHtml = (summary: {
    totalDiscount: number;
    totalPaid: number;
    totalDelivery: number;
    deliveryOrders: Order[];
    totalTakeaway: number;
    takeawayOrders: Order[];
  }, paymentBreakdownRows: SalesPaymentBreakdownRow[]) => {
    const cashBreakdown = paymentBreakdownRows.find((row) => row.key === "cash");
    const cardBreakdown = paymentBreakdownRows.find((row) => row.key === "card");
    const bankBreakdown = paymentBreakdownRows.find((row) => row.key === "bank");
    const creditBreakdown = paymentBreakdownRows.find((row) => row.key === "credit");
    const otherBreakdown = paymentBreakdownRows.find((row) => row.key === "other");
    const creditSummary = getSalesCreditSummary(paymentBreakdownRows);

    const formatBillsLine = (label: string, billCount: number, totalAmount: number) =>
      `${label}: ${billCount} bill${billCount === 1 ? "" : "s"} = ${totalAmount.toFixed(2)} AED`;

    const cards = [
      ...(summary.totalDiscount > 0
        ? [{
            label: "Total Discounts",
            value: `-${summary.totalDiscount.toFixed(2)} AED`,
            note: "Applied discounts",
            bg: "#fff7ed",
            valueColor: "#ea580c",
          }]
        : []),
      {
        label: "Collected Amount",
        value: `${summary.totalPaid.toFixed(2)} AED`,
        note: "Paid sales total",
        bg: "#f0fdf4",
        valueColor: "#16a34a",
      },
      {
        label: "Order Type Breakdown",
        lines: [
          { text: `Take-away: ${summary.takeawayOrders.length} order${summary.takeawayOrders.length === 1 ? "" : "s"}`, color: "#0891b2" },
          { text: `Delivery: ${summary.deliveryOrders.length} order${summary.deliveryOrders.length === 1 ? "" : "s"}`, color: "#ea580c" },
        ],
        bg: "#eff6ff",
      },
      {
        label: "Payment Method Breakdown",
        lines: [
          { text: formatBillsLine("Cash", cashBreakdown?.billCount || 0, cashBreakdown?.totalAmount || 0), color: "#16a34a" },
          { text: formatBillsLine("Card", cardBreakdown?.billCount || 0, cardBreakdown?.totalAmount || 0), color: "#2563eb" },
          { text: formatBillsLine("Bank Transfer", bankBreakdown?.billCount || 0, bankBreakdown?.totalAmount || 0), color: "#7c3aed" },
          { text: formatBillsLine("Credit", creditBreakdown?.billCount || 0, creditBreakdown?.totalAmount || 0), color: "#d97706" },
          ...(otherBreakdown
            ? [{ text: formatBillsLine(otherBreakdown.label, otherBreakdown.billCount, otherBreakdown.totalAmount), color: "#6b7280" }]
            : []),
        ],
        bg: "#eef2ff",
      },
      {
        label: "Credit Overview",
        lines: [
          { text: `${creditSummary.usageLabel}: ${creditSummary.usedAmount.toFixed(2)} AED`, color: "#d97706" },
          { text: `Bills paid from credit: ${creditSummary.usedBillCount}`, color: "#b45309" },
          { text: `System credit remaining: ${creditSummary.remainingAmount.toFixed(2)} AED`, color: "#059669" },
        ],
        bg: "#fffbeb",
      },
    ];

    const cardWidth =
      cards.length >= 5
        ? "18.4%"
        : cards.length === 4
          ? "23%"
          : cards.length === 3
            ? "31%"
            : `${(100 / Math.max(cards.length, 1)).toFixed(2)}%`;

    return `
      <table style="width: 94%; margin: 0 auto 10px; border-collapse: separate; border-spacing: 6px 0; table-layout: fixed;">
        <tr>
          ${cards.map((card) => `
            <td style="width: ${cardWidth}; padding: 0; vertical-align: top;">
              <div style="background: ${card.bg}; border: 1px solid #e5e7eb; border-radius: 8px; padding: 7px 6px; text-align: center; min-height: 56px;">
                <div style="color: #666; font-size: 7.2px; line-height: 1.15;">${card.label}</div>
                ${"value" in card ? `
                  <div style="color: ${card.valueColor}; font-size: 11.5px; font-weight: bold; margin: 3px 0 2px; line-height: 1.1;">${card.value}</div>
                  <div style="color: #666; font-size: 6.8px; line-height: 1.1;">${card.note}</div>
                ` : `
                  <div style="margin-top: 4px; text-align: center;">
                    ${card.lines.map((line) => `<div style="color: ${line.color}; font-size: 6.8px; line-height: 1.3; font-weight: 700; margin-top: 2px; text-align: center;">${line.text}</div>`).join("")}
                  </div>
                `}
              </div>
            </td>
          `).join("")}
        </tr>
      </table>
    `;
  };

  const renderSalesOrderSectionHtml = (
    title: string,
    titleColor: string,
    orders: Order[],
    sectionTotal: number,
    showPriorityBreakdown: boolean,
    startOnNewPage = true,
    firstPageReservedHeightMm = 0,
    onPagination?: (meta: { finalPageUsedHeightMm: number; finalPageRemainingHeightMm: number; pageCount: number }) => void,
  ) => {
    if (orders.length === 0) return "";

    const printablePageHeightMm = 281;
    const firstPageRemainingHeightMm = Math.max(0, printablePageHeightMm - firstPageReservedHeightMm);
    const shouldStartFreshOrderPage =
      !startOnNewPage &&
      firstPageReservedHeightMm > 0 &&
      firstPageRemainingHeightMm < 112;
    const effectiveStartOnNewPage = startOnNewPage || shouldStartFreshOrderPage;
    const effectiveFirstPageReservedHeightMm = effectiveStartOnNewPage ? 0 : firstPageReservedHeightMm;
    const sectionDiscount = orders.reduce((sum, order) => sum + getOrderBillAmounts(order).discount, 0);
    const sectionBillTotal = orders.reduce((sum, order) => sum + getOrderBillAmounts(order).originalAmount, 0);
    const sectionSummary = getOrderSectionSummary(orders);
    const reportPeriod = getActiveReportPeriod();
    const fallbackFirstPageRows = effectiveStartOnNewPage ? 28 : 24;
    const fallbackContinuationRows = 30;

    const sectionHeaderHtml = `
      <div style="color: ${titleColor}; font-weight: bold; font-size: 11px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin: 10px 0 5px; page-break-after: avoid;">
        ${escapeHtml(title)} (${orders.length}) - ${sectionTotal.toFixed(2)} AED
        ${showPriorityBreakdown ? `| <span style="color: #dc2626;">Urgent: ${sectionSummary.urgentCount}</span> | <span style="color: #16a34a;">Normal: ${sectionSummary.normalCount}</span> | <span style="color: #059669;">Paid: ${sectionSummary.paidAmount.toFixed(2)} AED</span> | <span style="color: #dc2626;">Unpaid: ${sectionSummary.unpaidAmount.toFixed(2)} AED</span>` : ""}
      </div>
    `;

    const tableHeaderHtml = `
        <thead>
          <tr style="background: #f3f4f6;">
            <th style="padding: 4px 3px; text-align: center; border: 1px solid #e5e7eb; width: 4%;">#</th>
            <th style="padding: 4px 3px; text-align: left; border: 1px solid #e5e7eb; width: 30%;">Client</th>
            <th style="padding: 4px 3px; text-align: left; border: 1px solid #e5e7eb; width: 18%;">Order Details</th>
            <th style="padding: 4px 3px; text-align: center; border: 1px solid #e5e7eb; width: 12%;">Type</th>
            <th style="padding: 4px 3px; text-align: left; border: 1px solid #e5e7eb; width: 18%;">Amounts</th>
            <th style="padding: 4px 3px; text-align: left; border: 1px solid #e5e7eb; width: 18%;">Paid / Status</th>
          </tr>
        </thead>
    `;

    const renderOrderRowHtml = (order: Order, rowNumber: number) => {
      const client = getClientById(order.clientId);
      const amounts = getOrderBillAmounts(order);
      const customerName = getOrderCustomerName(order, client);
      const customerAddress = getOrderCustomerAddress(order, client);
      const customerPhone = getOrderCustomerPhone(order, client);
      const createdDate = formatSalesReportPdfDateTime(order.entryDate ? String(order.entryDate) : null);
      const paidDate = getOrderPaidDateLabelForPdf(order, reportPeriod);
      const paymentStatus = getOrderPaymentStatus(order, reportPeriod);
      const workflowStatus = getOrderStatus(order);
      const discountLabel = amounts.discount > 0 ? `-${amounts.discount.toFixed(2)} AED` : "-";
      const typeLabel = order.deliveryType === "delivery" ? "Delivery" : "Take-away";
      const priorityLabel = order.urgent ? "Urgent" : "Normal";
      const paymentStatusColor =
        paymentStatus.label === "Fully Paid"
          ? "#16a34a"
          : paymentStatus.label === "Partially Paid"
            ? "#d97706"
            : "#2563eb";
      const partialDateLabel = getSalesPaymentPartialDateLabel(paymentStatus, formatSalesReportPdfDateTime);
      const paidDateLabel =
        paidDate === "-"
          ? "No payment date"
          : partialDateLabel
            ? getSalesPaymentPaidDateLabel(paidDate, formatSalesReportPdfDateTime)
            : paidDate;

      return `
              <tr class="${order.urgent ? "sales-pdf-urgent-row" : ""}" style="page-break-inside: avoid;">
                <td style="padding: 4px 3px; text-align: center; border: 1px solid #e5e7eb; color: #666; vertical-align: top;">${rowNumber}</td>
                <td style="padding: 4px 3px; border: 1px solid #e5e7eb; vertical-align: top; overflow: hidden; word-wrap: break-word;">${buildPdfClientCell(customerName, customerAddress, customerPhone)}</td>
                <td style="padding: 4px 3px; border: 1px solid #e5e7eb; vertical-align: top;">
                  <div style="font-weight: 700; color: #111;">#${escapeHtml(String(order.orderNumber || order.id))}</div>
                  <div style="margin-top: 2px; font-size: 6.3px; color: #6b7280; line-height: 1.18;">Created: ${escapeHtml(createdDate)}</div>
                </td>
                <td style="padding: 4px 3px; text-align: center; border: 1px solid #e5e7eb; vertical-align: top;">
                  <div style="font-weight: 700; color: #111;">${typeLabel}</div>
                  <div style="margin-top: 2px; color: ${order.urgent ? "#dc2626" : "#16a34a"}; font-weight: 700;">${priorityLabel}</div>
                </td>
                <td style="padding: 4px 3px; border: 1px solid #e5e7eb; vertical-align: top; line-height: 1.18;">
                  <span style="display: block; color: #6b7280;">Bill: ${amounts.originalAmount.toFixed(2)} AED</span>
                  <span style="display: block; color: ${amounts.discount > 0 ? "#ea580c" : "#9ca3af"};">Disc: ${discountLabel}</span>
                  <span style="display: block; color: #2563eb; font-weight: 700;">Final: ${amounts.finalAmount.toFixed(2)} AED</span>
                </td>
                <td style="padding: 4px 3px; border: 1px solid #e5e7eb; vertical-align: top;">
                  <div style="font-size: 6.3px; color: ${paymentStatusColor}; font-weight: 700; line-height: 1.18;">
                    Payment: ${escapeHtml(getSalesPaymentStatusExportLabel(paymentStatus))}
                  </div>
                  ${partialDateLabel ? `<div style="margin-top: 2px; font-size: 6.1px; color: #b45309; font-weight: 700; line-height: 1.18;">${escapeHtml(partialDateLabel)}</div>` : ""}
                  <div style="margin-top: 2px; font-size: 6.1px; color: ${paidDate === "-" ? "#6b7280" : paymentStatusColor}; line-height: 1.18;">
                    ${escapeHtml(paidDateLabel || "No payment date")}
                  </div>
                  <div style="margin-top: 3px; color: #6b7280; font-size: 6.1px;">Order: <span style="color: #111827; font-weight: 700;">${escapeHtml(workflowStatus.label)}</span></div>
                </td>
              </tr>
            `;
    };

    const totalRowHtml = `
          <tr style="background: #f3f4f6; font-weight: bold;">
            <td colspan="4" style="padding: 4px 3px; border: 1px solid #e5e7eb; text-align: right;">Total:</td>
            <td style="padding: 4px 3px; border: 1px solid #e5e7eb; line-height: 1.18;">
              <span style="display: block; color: #6b7280;">Bill: ${sectionBillTotal.toFixed(2)} AED</span>
              <span style="display: block; color: #ea580c;">Disc: ${sectionDiscount > 0 ? `-${sectionDiscount.toFixed(2)} AED` : "-"}</span>
              <span style="display: block; color: #2563eb; font-weight: 700;">Final: ${sectionTotal.toFixed(2)} AED</span>
            </td>
            <td style="padding: 4px 3px; border: 1px solid #e5e7eb;"></td>
          </tr>
    `;

    type SalesOrderPdfRow = { html: string; rowNumber: number };
    const orderRows: SalesOrderPdfRow[] = orders.map((order, index) => ({
      html: renderOrderRowHtml(order, index + 1),
      rowNumber: index + 1,
    }));

    const paginateOrderRows = (): {
      pages: SalesOrderPdfRow[][];
      finalPageUsedHeightMm: number;
      finalPageRemainingHeightMm: number;
    } => {
      if (orderRows.length === 0) {
        return { pages: [[]], finalPageUsedHeightMm: 0, finalPageRemainingHeightMm: 281 };
      }

      if (typeof document === "undefined") {
        const pages: SalesOrderPdfRow[][] = [];
        let cursor = 0;
        let currentLimit = fallbackFirstPageRows;

        while (cursor < orderRows.length) {
          pages.push(orderRows.slice(cursor, cursor + currentLimit));
          cursor += currentLimit;
          currentLimit = fallbackContinuationRows;
        }

        const finalPageRows = pages[pages.length - 1]?.length || 0;
        const approximateUsedHeightMm = Math.min(
          281,
          (pages.length === 1 ? effectiveFirstPageReservedHeightMm : 0) + 14 + (finalPageRows * 8) + 8,
        );
        return {
          pages,
          finalPageUsedHeightMm: approximateUsedHeightMm,
          finalPageRemainingHeightMm: Math.max(0, 281 - approximateUsedHeightMm),
        };
      }

      const measurementHost = document.createElement("div");
      measurementHost.style.cssText = [
        "position:absolute",
        "left:-10000px",
        "top:0",
        "width:194mm",
        "box-sizing:border-box",
        "font-family:Arial,sans-serif",
        "color:#333",
        "font-size:8.5px",
        "background:#fff",
        "padding:10px",
        "visibility:hidden",
        "pointer-events:none",
      ].join(";");
      document.body.appendChild(measurementHost);

      try {
        const pageHeightProbe = document.createElement("div");
        pageHeightProbe.style.height = "281mm";
        measurementHost.appendChild(pageHeightProbe);
        const pageHeightPx = pageHeightProbe.getBoundingClientRect().height;

        const firstPageReservedProbe = document.createElement("div");
        firstPageReservedProbe.style.height = `${effectiveFirstPageReservedHeightMm}mm`;
        measurementHost.appendChild(firstPageReservedProbe);
        const firstPageReservedHeightPx = firstPageReservedProbe.getBoundingClientRect().height;

        const measureHtmlHeight = (html: string) => {
          const probe = document.createElement("div");
          probe.innerHTML = html;
          measurementHost.appendChild(probe);
          const height = probe.getBoundingClientRect().height;
          probe.remove();
          return height;
        };

        const sectionHeaderHeightPx = measureHtmlHeight(sectionHeaderHtml);
        const continuationHeaderHeightPx = measureHtmlHeight(`
          <div style="color: ${titleColor}; font-weight: bold; font-size: 11px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin: 10px 0 5px; page-break-after: avoid;">
            ${escapeHtml(title)} continued
          </div>
        `);

        const rowTable = document.createElement("table");
        rowTable.style.cssText = "width:100%;border-collapse:collapse;margin-bottom:12px;font-size:7.2px;table-layout:fixed;";
        rowTable.innerHTML = `${tableHeaderHtml}<tbody>${orderRows.map((row) => row.html).join("")}${totalRowHtml}</tbody>`;
        measurementHost.appendChild(rowTable);

        const tableHeaderHeightPx = rowTable.querySelector("thead")?.getBoundingClientRect().height || 0;
        const totalRowHeightPx = rowTable.querySelector("tbody tr:last-child")?.getBoundingClientRect().height || 0;
        const rowHeightsPx = Array.from(rowTable.querySelectorAll("tbody tr"))
          .slice(0, orderRows.length)
          .map((row) => row.getBoundingClientRect().height);
        const fallbackRowHeightPx = rowHeightsPx[0] || 1;
        rowTable.remove();

        const safeBufferPx = 14;
        const getPageLimitPx = (pageIndex: number) => {
          const isFirstPage = pageIndex === 0;
          const reservedHeightPx = isFirstPage ? firstPageReservedHeightPx : 0;
          const headerHeightPx = isFirstPage ? sectionHeaderHeightPx : continuationHeaderHeightPx;
          return Math.max(
            fallbackRowHeightPx,
            pageHeightPx - reservedHeightPx - headerHeightPx - tableHeaderHeightPx - safeBufferPx,
          );
        };

        const pages: SalesOrderPdfRow[][] = [];
        const pageRowHeightsPx: number[] = [];
        let currentPage: SalesOrderPdfRow[] = [];
        let currentHeightPx = 0;
        let currentPageIndex = 0;

        orderRows.forEach((row, index) => {
          const rowHeightPx = Math.ceil((rowHeightsPx[index] || fallbackRowHeightPx) + 1);
          const isFinalRow = index === orderRows.length - 1;
          const totalHeightForFinalPage = isFinalRow ? totalRowHeightPx : 0;
          const currentLimitPx = getPageLimitPx(currentPageIndex);

          if (
            currentPage.length > 0 &&
            currentHeightPx + rowHeightPx + totalHeightForFinalPage > currentLimitPx
          ) {
            pages.push(currentPage);
            pageRowHeightsPx.push(currentHeightPx);
            currentPage = [row];
            currentHeightPx = rowHeightPx;
            currentPageIndex += 1;
            return;
          }

          currentPage.push(row);
          currentHeightPx += rowHeightPx;
        });

        if (currentPage.length > 0) {
          pages.push(currentPage);
          pageRowHeightsPx.push(currentHeightPx);
        }

        const finalPages = pages.length > 0 ? pages : [orderRows];
        const finalPageIndex = finalPages.length - 1;
        const finalPageReservedHeightPx = finalPageIndex === 0 ? firstPageReservedHeightPx : 0;
        const finalHeaderHeightPx = finalPageIndex === 0 ? sectionHeaderHeightPx : continuationHeaderHeightPx;
        const finalRowsHeightPx = pageRowHeightsPx[finalPageIndex] || rowHeightsPx.reduce((sum, height) => sum + height, 0);
        const finalPageUsedHeightPx = Math.min(
          pageHeightPx,
          finalPageReservedHeightPx + finalHeaderHeightPx + tableHeaderHeightPx + finalRowsHeightPx + totalRowHeightPx + 18,
        );
        const pixelsPerMm = pageHeightPx / 281;

        return {
          pages: finalPages,
          finalPageUsedHeightMm: finalPageUsedHeightPx / pixelsPerMm,
          finalPageRemainingHeightMm: Math.max(0, (pageHeightPx - finalPageUsedHeightPx) / pixelsPerMm),
        };
      } finally {
        measurementHost.remove();
      }
    };

    const orderPagination = paginateOrderRows();
    const orderPages = orderPagination.pages;
    onPagination?.({
      finalPageUsedHeightMm: orderPagination.finalPageUsedHeightMm,
      finalPageRemainingHeightMm: orderPagination.finalPageRemainingHeightMm,
      pageCount: orderPages.length,
    });

    return orderPages.map((pageOrders, pageIndex) => `
      <div style="page-break-before: ${pageIndex === 0 ? (effectiveStartOnNewPage ? "always" : "auto") : "always"}; break-before: ${pageIndex === 0 ? (effectiveStartOnNewPage ? "page" : "auto") : "page"}; page-break-inside: avoid; break-inside: avoid-page;">
        ${pageIndex === 0 ? sectionHeaderHtml : `
          <div style="color: ${titleColor}; font-weight: bold; font-size: 11px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin: 10px 0 5px; page-break-after: avoid;">
            ${escapeHtml(title)} continued (${pageIndex + 1} of ${orderPages.length})
          </div>
        `}
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 7.2px; table-layout: fixed;">
          ${tableHeaderHtml}
          <tbody>
            ${pageOrders.map((row) => row.html).join("")}
            ${pageIndex === orderPages.length - 1 ? totalRowHtml : ""}
          </tbody>
        </table>
      </div>
    `).join("");
  };

  const renderSalesPaymentsSectionHtml = (
    payments: any[],
    paymentBreakdownRows: SalesPaymentBreakdownRow[],
    startOnNewPage = true,
    firstPageReservedHeightMm = 0,
    flowContinuously = false,
  ) => {
    if (payments.length === 0) return "";

    const printablePageHeightMm = 281;
    const firstPageRemainingHeightMm = Math.max(0, printablePageHeightMm - firstPageReservedHeightMm);
    const shouldStartFreshPaymentPage =
      flowContinuously &&
      !startOnNewPage &&
      firstPageReservedHeightMm > 0 &&
      firstPageRemainingHeightMm < 92;
    const effectiveStartOnNewPage = startOnNewPage || shouldStartFreshPaymentPage;
    const effectiveFirstPageReservedHeightMm = effectiveStartOnNewPage ? 0 : firstPageReservedHeightMm;

    const totalSalesAmount = payments.reduce(
      (sum, payment) => sum + parseFloat(String(payment.amount || "0")),
      0,
    );
    const totalSalesLabel = `Total Sales (${payments.length}) | ${totalSalesAmount.toFixed(2)} AED`;
    const paymentRows = payments.map((payment, index) => {
      const bill = getBillById(payment.billId) || null;
      const client = getSalesPaymentClient(payment, bill);
      const paymentStatus = getSalesPaymentStatusMeta(payment, bill);
      const paymentStatusColor =
        paymentStatus.label === "Fully Paid"
          ? "#16a34a"
          : paymentStatus.label === "Partially Paid"
            ? "#d97706"
            : "#2563eb";
      const customerName = payment.clientName || client?.name || "Unknown";
      const customerAddress = getPaymentCustomerAddress(payment, client);
      const customerPhone = getPaymentCustomerPhone(payment, client);
      const methodLines = getPaymentBreakdownLines(payment);
      const description = String(payment.description || "-");
      const partialDateLabel = getSalesPaymentPartialDateLabel(paymentStatus, formatSalesReportPdfDateTime);
      const paidDateLabel = partialDateLabel
        ? getSalesPaymentPaidDateLabel(payment.date, formatSalesReportPdfDateTime)
        : null;

      return {
        amountLabel: `${parseFloat(String(payment.amount || "0")).toFixed(2)} AED`,
        clientCellHtml: buildPdfClientCell(customerName, customerAddress, customerPhone),
        descriptionHtml: escapeHtml(description),
        methodLines,
        paidDateLabel,
        partialDateLabel,
        paymentStatus,
        paymentStatusColor,
        rowNumber: index + 1,
      };
    });
    type PaymentRow = (typeof paymentRows)[number];

    const renderPaymentSectionTitleHtml = (label: string, pageLabel: string, dataAttribute = "") => `
      <div ${dataAttribute} style="display: flex; justify-content: space-between; align-items: flex-end; gap: 8px; color: #16a34a; font-weight: bold; font-size: 11px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin: 10px 0 5px;">
        <span>${escapeHtml(label)}</span>
        ${pageLabel ? `<span style="color: #6b7280; font-size: 8px; font-weight: 600;">${escapeHtml(pageLabel)}</span>` : ""}
      </div>
    `;

    const paymentTableHeader = `
      <tbody data-sales-payment-header-group="true">
        <tr data-sales-payment-header-row="true" style="background: #1d4ed8; page-break-inside: avoid; break-inside: avoid-page;">
          <td style="padding: 3px 2px; text-align: center; border: 1px solid #93c5fd; width: 5%; background: #1d4ed8; color: #ffffff; font-weight: 700;">#</td>
          <td style="padding: 3px 2px; text-align: left; border: 1px solid #93c5fd; width: 28%; background: #1d4ed8; color: #ffffff; font-weight: 700;">Client</td>
          <td style="padding: 3px 2px; text-align: left; border: 1px solid #93c5fd; width: 37%; background: #1d4ed8; color: #ffffff; font-weight: 700;">Details</td>
          <td style="padding: 3px 2px; text-align: center; border: 1px solid #93c5fd; width: 15%; background: #1d4ed8; color: #ffffff; font-weight: 700;">Payment Status</td>
          <td style="padding: 3px 2px; text-align: right; border: 1px solid #93c5fd; width: 15%; background: #1d4ed8; color: #ffffff; font-weight: 700;">Amount Paid</td>
        </tr>
      </tbody>
    `;

    const renderPaymentRowHtml = (paymentRow: PaymentRow) => `
      <tr data-sales-payment-row="true" style="page-break-inside: avoid; break-inside: avoid-page;">
        <td style="padding: 3px 2px; text-align: center; border: 1px solid #e5e7eb; color: #666; vertical-align: top; white-space: nowrap;">${paymentRow.rowNumber}</td>
        <td style="padding: 3px 2px; border: 1px solid #e5e7eb; vertical-align: top; white-space: normal; overflow-wrap: anywhere; word-break: break-word;">${paymentRow.clientCellHtml}</td>
        <td style="padding: 3px 2px; border: 1px solid #e5e7eb; vertical-align: top; white-space: normal; overflow-wrap: anywhere; word-break: break-word;">
          <div style="color: #111; line-height: 1.18;">${paymentRow.descriptionHtml}</div>
          <div style="margin-top: 2px; color: #1e40af; font-size: 5.8px; font-weight: 700; line-height: 1.18;">${paymentRow.methodLines.map((line: string) => `Method: ${escapeHtml(line)}`).join("<br />")}</div>
        </td>
        <td style="padding: 3px 2px; text-align: center; border: 1px solid #e5e7eb; vertical-align: top; color: ${paymentRow.paymentStatusColor}; font-weight: 700; white-space: normal; overflow-wrap: anywhere; word-break: break-word;">
          <div style="line-height: 1.18;">${escapeHtml(getSalesPaymentStatusExportLabel(paymentRow.paymentStatus))}</div>
          ${paymentRow.partialDateLabel ? `<div style="margin-top: 2px; color: #b45309; font-size: 5.8px; font-weight: 700; line-height: 1.18;">${escapeHtml(paymentRow.partialDateLabel)}</div>` : ""}
          ${paymentRow.paidDateLabel ? `<div style="margin-top: 2px; color: #16a34a; font-size: 5.8px; font-weight: 700; line-height: 1.18;">${escapeHtml(paymentRow.paidDateLabel)}</div>` : ""}
        </td>
        <td style="padding: 3px 2px; text-align: right; border: 1px solid #e5e7eb; color: #16a34a; font-weight: bold; vertical-align: top; white-space: nowrap;">${paymentRow.amountLabel}</td>
      </tr>
    `;

    const renderPaymentTotalRowHtml = () => `
      <tr data-sales-payment-total-row="true" style="background: #f3f4f6; font-weight: bold;">
        <td colspan="4" style="padding: 4px 3px; border: 1px solid #e5e7eb; text-align: right;">Total:</td>
        <td style="padding: 4px 3px; text-align: right; border: 1px solid #e5e7eb; color: #16a34a;">${totalSalesAmount.toFixed(2)} AED</td>
      </tr>
    `;

    const renderPaymentBreakdownHtml = (forceNewPage: boolean) => paymentBreakdownRows.length > 0 ? `
      <div style="page-break-before: ${forceNewPage ? "always" : "auto"}; page-break-inside: avoid; break-inside: avoid-page;">
      <div style="color: #1e40af; font-weight: bold; font-size: 11px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin: 10px 0 5px; page-break-after: avoid; break-after: avoid;">Payment Method Breakdown</div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 8px; table-layout: fixed;">
        <thead>
          <tr style="background: #f3f4f6;">
            <th style="padding: 4px; text-align: left; border: 1px solid #e5e7eb; width: 40%;">Method</th>
            <th style="padding: 4px; text-align: center; border: 1px solid #e5e7eb; width: 25%;">Bills Paid</th>
            <th style="padding: 4px; text-align: right; border: 1px solid #e5e7eb; width: 35%;">Total (AED)</th>
          </tr>
        </thead>
        <tbody>
          ${paymentBreakdownRows.map((row) => `
            <tr style="page-break-inside: avoid;">
              <td style="padding: 4px; border: 1px solid #e5e7eb; font-weight: 600;">${row.label}</td>
              <td style="padding: 4px; text-align: center; border: 1px solid #e5e7eb;">${row.billCount}</td>
              <td style="padding: 4px; text-align: right; border: 1px solid #e5e7eb; color: #16a34a; font-weight: bold;">${row.totalAmount.toFixed(2)} AED</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      </div>
    ` : "";

    const paymentPages = (() => {
      if (typeof document === "undefined") {
        const firstPageRowLimit = effectiveFirstPageReservedHeightMm > 0
          ? Math.max(3, 24 - Math.ceil(effectiveFirstPageReservedHeightMm / 8))
          : 24;
        const pages: PaymentRow[][] = [];
        let cursor = 0;
        let currentLimit = firstPageRowLimit;

        while (cursor < paymentRows.length) {
          pages.push(paymentRows.slice(cursor, cursor + currentLimit));
          cursor += currentLimit;
          currentLimit = 24;
        }

        return pages.length > 0 ? pages : [paymentRows];
      }

      const measurementHost = document.createElement("div");
      measurementHost.style.cssText = [
        "position:fixed",
        "left:-10000px",
        "top:0",
        "width:194mm",
        "box-sizing:border-box",
        "padding:10px",
        "font-family:Arial,sans-serif",
        "color:#333",
        "font-size:8.5px",
        "background:#fff",
        "visibility:hidden",
        "pointer-events:none",
        "z-index:-1",
      ].join(";");

      const pageHeightProbe = document.createElement("div");
      pageHeightProbe.style.height = "281mm";
      measurementHost.appendChild(pageHeightProbe);
      const firstPageReservedHeightProbe = document.createElement("div");
      firstPageReservedHeightProbe.style.height = `${effectiveFirstPageReservedHeightMm}mm`;
      measurementHost.appendChild(firstPageReservedHeightProbe);

      const measurementTable = document.createElement("div");
      measurementTable.style.cssText = "width:100%;box-sizing:border-box;font-family:Arial,sans-serif;color:#333;font-size:8.5px;background:#fff;";
      measurementTable.innerHTML = `
        ${renderPaymentSectionTitleHtml(totalSalesLabel, "Page 99 of 99", 'data-sales-payment-title="true"')}
        ${renderPaymentSectionTitleHtml("Total Sales continued (99 of 99)", "Page 99 of 99", 'data-sales-payment-continuation-title="true"')}
        <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:6.6px;table-layout:fixed;">
          ${paymentTableHeader}
          <tbody>
            ${paymentRows.map((paymentRow) => renderPaymentRowHtml(paymentRow)).join("")}
            ${renderPaymentTotalRowHtml()}
          </tbody>
        </table>
      `;
      measurementHost.appendChild(measurementTable);
      document.body.appendChild(measurementHost);

      try {
        const printablePageHeightPx = pageHeightProbe.getBoundingClientRect().height;
        const firstPageReservedHeightPx = firstPageReservedHeightProbe.getBoundingClientRect().height;
        const firstTitleHeightPx =
          measurementTable.querySelector('[data-sales-payment-title="true"]')?.getBoundingClientRect().height || 0;
        const continuationTitleHeightPx =
          measurementTable.querySelector('[data-sales-payment-continuation-title="true"]')?.getBoundingClientRect().height || firstTitleHeightPx;
        const tableHeaderHeightPx =
          measurementTable.querySelector('[data-sales-payment-header-row="true"]')?.getBoundingClientRect().height || 0;
        const totalRowHeightPx =
          measurementTable.querySelector('[data-sales-payment-total-row="true"]')?.getBoundingClientRect().height || 0;
        const rowHeightsPx = Array.from(measurementTable.querySelectorAll('[data-sales-payment-row="true"]')).map(
          (row) => row.getBoundingClientRect().height,
        );
        const fallbackRowHeightPx = rowHeightsPx[0] || 1;
        const safeBufferPx = 36;
        const getPageLimitPx = (pageIndex: number) => Math.max(
          fallbackRowHeightPx,
          printablePageHeightPx
            - (pageIndex === 0 ? firstPageReservedHeightPx : 0)
            - (pageIndex === 0 ? firstTitleHeightPx : continuationTitleHeightPx)
            - tableHeaderHeightPx
            - safeBufferPx,
        );

        const pages: PaymentRow[][] = [];
        let currentPage: PaymentRow[] = [];
        let currentHeightPx = 0;
        let currentPageIndex = 0;

        paymentRows.forEach((paymentRow, index) => {
          const rowHeightPx = Math.ceil((rowHeightsPx[index] || fallbackRowHeightPx) + 1);
          const isFinalRow = index === paymentRows.length - 1;
          const totalHeightForFinalPage = isFinalRow ? totalRowHeightPx : 0;
          const currentPageLimitPx = getPageLimitPx(currentPageIndex);

          if (currentPage.length > 0 && currentHeightPx + rowHeightPx + totalHeightForFinalPage > currentPageLimitPx) {
            pages.push(currentPage);
            currentPage = [paymentRow];
            currentHeightPx = rowHeightPx;
            currentPageIndex += 1;
            return;
          }

          currentPage.push(paymentRow);
          currentHeightPx += rowHeightPx;
        });

        if (currentPage.length > 0) {
          pages.push(currentPage);
        }

        return pages.length > 0 ? pages : [paymentRows];
      } finally {
        document.body.removeChild(measurementHost);
      }
    })();

    const getPaymentPageStyle = (pageIndex: number) => {
      const isFirstPage = pageIndex === 0;
      const isLastPage = pageIndex === paymentPages.length - 1;
      const pageBreakBefore = isFirstPage && effectiveStartOnNewPage ? "always" : "auto";
      const breakBefore = isFirstPage && effectiveStartOnNewPage ? "page" : "auto";
      const pageCarryoverMm = 6;
      const pageHeightMm = isFirstPage && !effectiveStartOnNewPage
        ? Math.max(40, firstPageRemainingHeightMm + pageCarryoverMm)
        : printablePageHeightMm + pageCarryoverMm;
      const fixedPageStyle = !isLastPage
        ? `height: ${pageHeightMm.toFixed(2)}mm; overflow: hidden;`
        : "";

      return [
        `page-break-before: ${pageBreakBefore}`,
        `break-before: ${breakBefore}`,
        "box-sizing: border-box",
        fixedPageStyle,
      ].filter(Boolean).join("; ");
    };

    const paymentPagesHtml = paymentPages.map((pagePayments, pageIndex) => `
      <div style="${getPaymentPageStyle(pageIndex)}">
        ${renderPaymentSectionTitleHtml(
          pageIndex === 0 ? totalSalesLabel : `Total Sales continued (${pageIndex + 1} of ${paymentPages.length})`,
          paymentPages.length > 1 ? `Page ${pageIndex + 1} of ${paymentPages.length}` : "",
        )}
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 6.6px; table-layout: fixed;">
          ${paymentTableHeader}
          <tbody>
            ${pagePayments.map((paymentRow) => renderPaymentRowHtml(paymentRow)).join("")}
            ${pageIndex === paymentPages.length - 1 ? renderPaymentTotalRowHtml() : ""}
          </tbody>
        </table>
      </div>
    `).join("");

    return `
      ${paymentPagesHtml}
      ${renderPaymentBreakdownHtml(!flowContinuously)}
    `;
  };

  const renderSalesCreditManagementSectionHtml = (creditData: SalesCreditManagementData) => {
    if (creditData.entries.length === 0) return "";

    const netChange = creditData.totalAdded - creditData.totalUsed;

    return `
      <div style="color: #d97706; font-weight: bold; font-size: 11px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin: 10px 0 5px;">
        ${creditManagementLogLabel} (${creditData.entries.length}) |
        <span style="color: #16a34a;"> Added: ${creditData.totalAdded.toFixed(2)} AED</span> |
        <span style="color: #ea580c;"> Deducted: ${creditData.totalUsed.toFixed(2)} AED</span> |
        <span style="color: ${netChange >= 0 ? "#059669" : "#dc2626"};"> Net: ${netChange.toFixed(2)} AED</span>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 7.2px; table-layout: fixed;">
        <thead>
          <tr style="background: #f3f4f6;">
            <th style="padding: 4px 3px; text-align: center; border: 1px solid #e5e7eb; width: 4%;">#</th>
            <th style="padding: 4px 3px; text-align: center; border: 1px solid #e5e7eb; width: 12%;">Date</th>
            <th style="padding: 4px 3px; text-align: left; border: 1px solid #e5e7eb; width: 12%;">Account</th>
            <th style="padding: 4px 3px; text-align: left; border: 1px solid #e5e7eb; width: 18%;">Client</th>
            <th style="padding: 4px 3px; text-align: center; border: 1px solid #e5e7eb; width: 11%;">Entry</th>
            <th style="padding: 4px 3px; text-align: center; border: 1px solid #e5e7eb; width: 8%;">Bill</th>
            <th style="padding: 4px 3px; text-align: right; border: 1px solid #e5e7eb; width: 11%;">Amount</th>
            <th style="padding: 4px 3px; text-align: left; border: 1px solid #e5e7eb; width: 24%;">Description</th>
          </tr>
        </thead>
        <tbody>
          ${creditData.entries.map((transaction, index) => {
            const actionDisplay = getCreditManagementActionDisplay(transaction);
            return `
              <tr style="page-break-inside: avoid;">
                <td style="padding: 4px 3px; text-align: center; border: 1px solid #e5e7eb; color: #666; vertical-align: top;">${index + 1}</td>
                <td style="padding: 4px 3px; text-align: center; border: 1px solid #e5e7eb; color: #666; vertical-align: top;">${escapeHtml(formatSalesReportPdfDateTime(transaction.date))}</td>
                <td style="padding: 4px 3px; border: 1px solid #e5e7eb; vertical-align: top; font-family: monospace;">${escapeHtml(transaction.accountLabel)}</td>
                <td style="padding: 4px 3px; border: 1px solid #e5e7eb; vertical-align: top;">${escapeHtml(transaction.customerName)}</td>
                <td style="padding: 4px 3px; text-align: center; border: 1px solid #e5e7eb; vertical-align: top;">
                  <div style="font-weight: 700; color: ${transaction.isDeduction ? "#c2410c" : "#15803d"};">${escapeHtml(actionDisplay.label)}</div>
                  <div style="font-size: 6.1px; color: #6b7280; margin-top: 2px;">${escapeHtml(actionDisplay.note)}</div>
                </td>
                <td style="padding: 4px 3px; text-align: center; border: 1px solid #e5e7eb; vertical-align: top;">${transaction.billId ? `#${escapeHtml(String(transaction.billDisplayNumber))}` : "-"}</td>
                <td style="padding: 4px 3px; text-align: right; border: 1px solid #e5e7eb; color: ${transaction.isDeduction ? "#ea580c" : "#16a34a"}; font-weight: 700; vertical-align: top;">${transaction.isDeduction ? "-" : "+"}${transaction.amountValue.toFixed(2)} AED</td>
                <td style="padding: 4px 3px; border: 1px solid #e5e7eb; vertical-align: top;">${escapeHtml(transaction.displayDescription)}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  };

  const chunkPdfRows = <T,>(rows: T[], chunkSize: number) => {
    if (rows.length === 0) return [] as T[][];

    const pages: T[][] = [];
    for (let index = 0; index < rows.length; index += chunkSize) {
      pages.push(rows.slice(index, index + chunkSize));
    }
    return pages;
  };

  const chunkOrders = (orders: Order[], chunkSize: number) => {
    const pages = chunkPdfRows(orders, chunkSize);
    return pages.length > 0 ? pages : ([[]] as Order[][]);
  };

  const getPdfExportOptions = (
    fileName: string,
    orientation: "portrait" | "landscape",
    pagebreakModes: string[],
  ) => {
    const deviceScale = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const renderScale = Math.min(2.5, Math.max(2, Number((deviceScale * 1.25).toFixed(2))));

    return {
      margin: 8,
      filename: fileName,
      image: { type: "jpeg", quality: 0.92 },
      html2canvas: {
        scale: renderScale,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      },
      jsPDF: {
        unit: "mm",
        format: "a4",
        orientation,
        compress: true,
      },
      pagebreak: { mode: pagebreakModes },
    };
  };

  const renderSalesPdfPrintColorStyle = () => `
    <style>
      .sales-pdf-report,
      .sales-pdf-report * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .sales-pdf-report {
        color: #0f172a !important;
        background: #ffffff !important;
      }

      .sales-pdf-report div[style*="text-align:center"][style*="border-bottom:2px"],
      .sales-pdf-report div[style*="text-align: center"][style*="border-bottom: 2px"] {
        background: #eff6ff !important;
        border-bottom-color: #1d4ed8 !important;
      }

      .sales-pdf-report div[style*="font-size:16px"][style*="font-weight:bold"],
      .sales-pdf-report div[style*="font-size: 16px"][style*="font-weight: bold"] {
        color: #0f3ea5 !important;
      }

      .sales-pdf-report div[style*="font-size:13px"][style*="font-weight:bold"],
      .sales-pdf-report div[style*="font-size: 13px"][style*="font-weight: bold"] {
        color: #0f172a !important;
      }

      .sales-pdf-report thead tr {
        background: #1d4ed8 !important;
      }

      .sales-pdf-report th {
        background: #1d4ed8 !important;
        border-color: #93c5fd !important;
        color: #ffffff !important;
        font-weight: 700 !important;
      }

      .sales-pdf-report tr[data-sales-payment-header-row="true"] td {
        background: #1d4ed8 !important;
        border-color: #93c5fd !important;
        color: #ffffff !important;
        font-weight: 700 !important;
      }

      .sales-pdf-report td {
        border-color: #bfdbfe !important;
      }

      .sales-pdf-report tbody tr:nth-child(even) td {
        background-color: #f8fbff;
      }

      .sales-pdf-report tbody tr[style*="background: #f3f4f6"] td,
      .sales-pdf-report tbody tr[style*="background:#f3f4f6"] td {
        background: #dbeafe !important;
        border-color: #93c5fd !important;
      }

      .sales-pdf-report tr.sales-pdf-urgent-row td {
        background-color: #fff1f2 !important;
        border-color: #fecdd3 !important;
      }

      .sales-pdf-report div[style*="font-weight: bold"][style*="border-bottom: 1px solid #e5e7eb"],
      .sales-pdf-report div[style*="font-weight:bold"][style*="border-bottom:1px solid #e5e7eb"] {
        background: #eef6ff !important;
        border-bottom-color: #93c5fd !important;
      }

      .sales-pdf-report table[style*="border-spacing"] div[style*="border: 1px solid #e5e7eb"] {
        border-color: #93c5fd !important;
      }

      .sales-pdf-report div[style*="border-top: 1px solid #e5e7eb"],
      .sales-pdf-report div[style*="border-top:1px solid #e5e7eb"] {
        border-top-color: #93c5fd !important;
        color: #475569 !important;
      }
    </style>
  `;

  const hasMeaningfulAdjustment = (order: Order) => {
    const adjustedRaw = order.adjustedTotal;
    const hasAdjustedValue =
      adjustedRaw !== null &&
      adjustedRaw !== undefined &&
      String(adjustedRaw).trim() !== "";
    if (!hasAdjustedValue) return false;
    return String(order.priceAdjustReason || "").trim().length > 0;
  };

  const getOrderDeliveryChargeAmount = (order: Order) => {
    const charge = parseFloat(String((order as any).deliveryCharge || "0"));
    return Number.isFinite(charge) ? Math.max(0, charge) : 0;
  };

  const getOrderTipsAmount = (order: Order) => {
    const tips = parseFloat(String(order.tips || "0"));
    return Number.isFinite(tips) ? Math.max(0, tips) : 0;
  };

  const getOrderExtraCharges = (order: Order) =>
    getOrderDeliveryChargeAmount(order) + getOrderTipsAmount(order);

  const getOrderWorkReceivedAmount = (order: Order) => {
    if (hasMeaningfulAdjustment(order)) {
      const adjusted = parseFloat(String(order.adjustedTotal ?? "0"));
      return Number.isFinite(adjusted) ? Math.max(0, adjusted) : 0;
    }

    if (order.billId) {
      const linkedBill = getBillById(order.billId);
      const ordersInSameBill = getOrdersForBillId(order.billId);
      if (linkedBill && ordersInSameBill.length <= 1) {
        const billOriginalAmount = parseFloat(String(linkedBill.originalAmount ?? ""));
        if (
          Number.isFinite(billOriginalAmount) &&
          (billOriginalAmount > 0 || String(linkedBill.originalAmount ?? "").trim() !== "")
        ) {
          return Math.max(0, billOriginalAmount);
        }

        const billFinalAmount = parseFloat(String(linkedBill.amount ?? ""));
        const billDiscountAmount = parseFloat(String(linkedBill.discountAmount ?? "0"));
        const billDeliveryCharge = parseFloat(String((linkedBill as any).deliveryCharge ?? "0"));
        if (Number.isFinite(billFinalAmount)) {
          const safeBillDiscount = Number.isFinite(billDiscountAmount) ? Math.max(0, billDiscountAmount) : 0;
          const safeBillDeliveryCharge = Number.isFinite(billDeliveryCharge) ? Math.max(0, billDeliveryCharge) : 0;
          return Math.max(0, billFinalAmount + safeBillDiscount - safeBillDeliveryCharge);
        }
      }
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

  const getOrderDiscountAmount = (order: Order) => {
    const directDiscount = parseFloat(String(order.discountAmount || "0"));
    if (Number.isFinite(directDiscount) && directDiscount > 0) {
      return Math.max(0, directDiscount);
    }

    if (!order.billId) return 0;
    const linkedBill = getBillById(order.billId);
    const billDiscount = parseFloat(String(linkedBill?.discountAmount || "0"));
    if (!Number.isFinite(billDiscount) || billDiscount <= 0) return 0;

    const ordersInSameBill = getOrdersForBillId(order.billId);
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
  };

  const getOrderBillAmounts = (order: Order) => {
    const linkedBill = order.billId ? getBillById(order.billId) : null;
    const ordersInSameBill = order.billId ? getOrdersForBillId(order.billId) : [];

    if (linkedBill && ordersInSameBill.length <= 1) {
      const billDiscountRaw = parseFloat(String(linkedBill.discountAmount || "0"));
      const billDeliveryChargeRaw = parseFloat(String((linkedBill as any).deliveryCharge || "0"));
      const billFinalRaw = parseFloat(String(linkedBill.amount || "0"));
      const billPaidRaw = parseFloat(String(linkedBill.paidAmount || "0"));
      const billOriginalRaw = parseFloat(String(linkedBill.originalAmount ?? ""));

      const discount = Number.isFinite(billDiscountRaw) ? Math.max(0, billDiscountRaw) : 0;
      const deliveryCharge = Number.isFinite(billDeliveryChargeRaw) ? Math.max(0, billDeliveryChargeRaw) : 0;
      const finalAmount = Number.isFinite(billFinalRaw) ? Math.max(0, billFinalRaw) : 0;
      const paidAmount = Number.isFinite(billPaidRaw) ? Math.max(0, billPaidRaw) : 0;
      const originalAmount =
        Number.isFinite(billOriginalRaw) && (billOriginalRaw > 0 || String(linkedBill.originalAmount ?? "").trim() !== "")
          ? Math.max(0, billOriginalRaw)
          : Math.max(0, finalAmount + discount - deliveryCharge);

	      return { discount, deliveryCharge, originalAmount, finalAmount, paidAmount };
    }

	    const discount = getOrderDiscountAmount(order);
	    const deliveryCharge = getOrderDeliveryChargeAmount(order);
	    const originalAmount = getOrderWorkReceivedAmount(order);

    const hasStoredFinalAmount =
      order.finalAmount !== null &&
      order.finalAmount !== undefined &&
      String(order.finalAmount).trim() !== "";
    const explicitFinalAmount = parseFloat(String(order.finalAmount ?? ""));
    const finalAmount = hasStoredFinalAmount && Number.isFinite(explicitFinalAmount)
      ? Math.max(0, explicitFinalAmount)
      : Math.max(0, originalAmount - discount) + getOrderExtraCharges(order);

    const paidAmountRaw = parseFloat(String(order.paidAmount || "0"));
    const paidAmount = Number.isFinite(paidAmountRaw) ? Math.max(0, paidAmountRaw) : 0;

	    return { discount, deliveryCharge, originalAmount, finalAmount, paidAmount };
  };

  const getOrderSectionSummary = (orders: Order[]) => {
    return orders.reduce(
      (summary, order) => {
        const amounts = getOrderBillAmounts(order);
        const safePaid = Math.min(amounts.paidAmount, amounts.finalAmount);

        summary.finalAmount += amounts.finalAmount;
        summary.paidAmount += safePaid;
        summary.unpaidAmount += Math.max(0, amounts.finalAmount - safePaid);
        if (order.urgent) {
          summary.urgentCount += 1;
        } else {
          summary.normalCount += 1;
        }

        return summary;
      },
      {
        finalAmount: 0,
        paidAmount: 0,
        unpaidAmount: 0,
        urgentCount: 0,
        normalCount: 0,
      },
    );
  };

  const filterOrders = (period: 'daily' | 'monthly' | 'yearly' | 'range') => {
    if (!allOrders) return { deliveryOrders: [], takeawayOrders: [], currentDateOrders: [], oldPaidOrders: [], totalDelivery: 0, totalTakeaway: 0, totalBills: 0, totalPaid: 0, totalDiscount: 0, orderCount: 0 };

    const ordersPaidInPeriodIds = new Set<number>();
    if (allBillPayments) {
      allBillPayments.forEach((p: any) => {
        const linkedBill = getBillById(p.billId);
        if (linkedBill) {
          const linkedBillPaidAmount = parseFloat(String(linkedBill.paidAmount || "0"));
          if ((!Number.isFinite(linkedBillPaidAmount) || linkedBillPaidAmount <= 0.009) && !linkedBill.isPaid) {
            return;
          }
        }
        if (p.paymentDate && dateMatchesPeriod(new Date(p.paymentDate), period)) {
          const linkedOrder = getLatestReportOrderForBillId(p.billId);
          if (linkedOrder) ordersPaidInPeriodIds.add(linkedOrder.id);
        }
      });
    }

    const currentDateOrders: Order[] = [];
    const oldPaidOrders: Order[] = [];
    const addedIds = new Set<number>();

    allOrders.forEach((order) => {
      const createdInPeriod = order.entryDate && dateMatchesPeriod(new Date(order.entryDate), period);
      const paidInPeriod = ordersPaidInPeriodIds.has(order.id);

      if (createdInPeriod || paidInPeriod) {
        if (addedIds.has(order.id)) return;
        addedIds.add(order.id);
        if (createdInPeriod) {
          currentDateOrders.push(order);
        } else if (paidInPeriod) {
          oldPaidOrders.push(order);
        }
      }
    });

    const deliveryOrders = currentDateOrders.filter(o => o.deliveryType === 'delivery');
    const takeawayOrders = currentDateOrders.filter(o => o.deliveryType !== 'delivery');

    currentDateOrders.sort((a, b) => {
      const dateA = a.entryDate ? new Date(a.entryDate).getTime() : 0;
      const dateB = b.entryDate ? new Date(b.entryDate).getTime() : 0;
      return dateA - dateB;
    });

    const getLatestPaymentDate = (order: Order): number => {
      if (!order.billId) return 0;
      const payments = billPaymentsByBillId.get(order.billId) || [];
      if (payments.length === 0) return 0;
      return Math.max(...payments.map((p: any) => new Date(p.paymentDate).getTime()));
    };
    oldPaidOrders.sort((a, b) => {
      const timeDelta = getLatestPaymentDate(a) - getLatestPaymentDate(b);
      if (timeDelta !== 0) {
        return timeDelta;
      }
      return a.id - b.id;
    });

    const totalDelivery = deliveryOrders.reduce((sum, o) => sum + getOrderBillAmounts(o).finalAmount, 0);
    const totalTakeaway = takeawayOrders.reduce((sum, o) => sum + getOrderBillAmounts(o).finalAmount, 0);
    const allMatchingOrders = [...currentDateOrders, ...oldPaidOrders];
    const totalBills = allMatchingOrders.reduce((sum, o) => sum + getOrderBillAmounts(o).finalAmount, 0);
    const totalPaid = allMatchingOrders.reduce((sum, o) => sum + getOrderBillAmounts(o).paidAmount, 0);
    const totalDiscount = allMatchingOrders.reduce((sum, o) => sum + getOrderBillAmounts(o).discount, 0);
    const orderCount = allMatchingOrders.length;

    return { deliveryOrders, takeawayOrders, currentDateOrders, oldPaidOrders, totalDelivery, totalTakeaway, totalBills, totalPaid, totalDiscount, orderCount };
  };

  const filterTransactions = (period: 'daily' | 'monthly' | 'yearly' | 'range') => {
    if (!allBillPayments || !allBills || !allClients) {
      return { bills: [], deposits: [], rawDeposits: [], totalBills: 0, totalDeposits: 0 };
    }

    const bills: any[] = [];
    const rawDeposits: any[] = [];

    allBillPayments.forEach((payment: any) => {
      const payDate = new Date(payment.paymentDate);
      if (!dateMatchesPeriod(payDate, period)) return;

      const bill = getBillById(payment.billId);
      if (!bill) return;

      const linkedBillPaidAmount = parseFloat(String(bill.paidAmount || "0"));
      if ((!Number.isFinite(linkedBillPaidAmount) || linkedBillPaidAmount <= 0.009) && !bill.isPaid) {
        return;
      }

      const client = getSalesPaymentClient(payment, bill);
      if (!client) return;
      const linkedOrder = getSalesPaymentLinkedOrder(payment);

      rawDeposits.push({
        id: payment.id,
        clientId: client.id,
        billId: payment.billId,
        billDisplayNumber: getSalesPaymentBillNumber(payment, bill),
        billCreatedBy: bill.createdBy || "",
        billDate: bill.billDate || null,
        clientName: client.name,
        clientPhone: client.phone,
        orderId: linkedOrder?.id || null,
        orderNumber: linkedOrder?.orderNumber || "",
        orderEntryDate: linkedOrder?.entryDate || null,
        orderSummary: getSalesPaymentOrderSummary(payment, bill),
        description: getSalesPaymentDescription(payment, bill),
        paymentMethod: payment.paymentMethod,
        amount: payment.amount,
        date: payment.paymentDate,
        notes: payment.notes || null,
        type: 'payment',
        isBillPaid: !!bill.isPaid,
      });
    });

    const totalBills = bills.reduce((sum, b) => sum + parseFloat(b.amount || "0"), 0);
    const deposits = buildGroupedSalesPayments(rawDeposits);
    const totalDeposits = rawDeposits.reduce((sum, d) => sum + parseFloat(d.amount || "0"), 0);

    return { bills, deposits, rawDeposits, totalBills, totalDeposits };
  };

  const filterCreditManagementTransactions = (): SalesCreditManagementData => {
    if (!allCreditTransactions) {
      return { entries: [], totalAdded: 0, totalUsed: 0, addedCount: 0, usedCount: 0 };
    }

    const visibleTransactions = buildVisibleCreditManagementTransactions(allCreditTransactions)
      .map((transaction): VisibleSalesCreditManagementTransaction => {
        const client = getClientById(transaction.clientId);
        const bill = transaction.billId
          ? getBillById(transaction.billId)
          : null;
        const amountValue = parseCreditManagementAmount(transaction.amount);
        const isDeduction =
          transaction.type === "deposit_used" ||
          transaction.type === "bulk_deposit_used" ||
          transaction.type === "deposit_deduction";

        return {
          ...transaction,
          displayDescription: formatCreditManagementDisplayDescription(transaction, bill),
          customerName: transaction.clientName || client?.name || "Unknown",
          accountLabel: transaction.accountNumber || client?.billNumber || "-",
          amountValue,
          isDeduction,
          billDisplayNumber: bill?.id || transaction.billId || "-",
        };
      })
      .sort(compareCreditManagementTransactionsAsc);

    const totalAdded = visibleTransactions.reduce(
      (sum, transaction) => sum + (transaction.isDeduction ? 0 : transaction.amountValue),
      0,
    );
    const totalUsed = visibleTransactions.reduce(
      (sum, transaction) => sum + (transaction.isDeduction ? transaction.amountValue : 0),
      0,
    );

    return {
      entries: visibleTransactions,
      totalAdded,
      totalUsed,
      addedCount: visibleTransactions.filter((transaction) => !transaction.isDeduction).length,
      usedCount: visibleTransactions.filter((transaction) => transaction.isDeduction).length,
    };
  };

  const currentSalesData = useMemo(
    () => filterTransactions(activeReportPeriod),
    [allBillPayments, allBills, allClients, allOrders, activeReportPeriod, selectedDate, selectedMonth, selectedYear, startDate, endDate],
  );
  const liveCreditManagementData = useMemo(
    () => filterCreditManagementTransactions(),
    [allCreditTransactions, allClients, allBills],
  );
  const creditTransactionsErrorMessage =
    creditTransactionsError instanceof Error ? creditTransactionsError.message : "";
  const creditTransactionsLooksLikeHtmlResponse = /unexpected token '<'|<!doctype/i.test(
    creditTransactionsErrorMessage,
  );

  const currentOrderData = useMemo(
    () => filterOrders(activeReportPeriod),
    [allOrders, allBillPayments, allBills, activeReportPeriod, selectedDate, selectedMonth, selectedYear, startDate, endDate],
  );
  const currentPeriodOrderIds = useMemo(
    () => currentOrderData.currentDateOrders.map((order) => order.id),
    [currentOrderData.currentDateOrders],
  );
  const selectedCurrentOrders = useMemo(
    () => currentOrderData.currentDateOrders.filter((order) => selectedCurrentOrderIds.has(order.id)),
    [currentOrderData.currentDateOrders, selectedCurrentOrderIds],
  );
  const allCurrentOrdersSelected =
    currentOrderData.currentDateOrders.length > 0 &&
    currentOrderData.currentDateOrders.every((order) => selectedCurrentOrderIds.has(order.id));
  const currentTotalSalesPayments = currentSalesData.deposits || [];
  const currentTotalSalesPaymentKeys = useMemo(
    () => currentTotalSalesPayments.map(getTotalSalesPaymentSelectionKey),
    [currentTotalSalesPayments],
  );

  useEffect(() => {
    const visibleOrderIdSet = new Set(currentPeriodOrderIds);
    setSelectedCurrentOrderIds((previous) => {
      const next = Array.from(previous).filter((id) => visibleOrderIdSet.has(id));
      return next.length === previous.size ? previous : new Set(next);
    });
  }, [currentPeriodOrderIds]);

  useEffect(() => {
    const visiblePaymentKeySet = new Set(currentTotalSalesPaymentKeys);
    setSelectedTotalSalesPaymentKeys((previous) => {
      const next = Array.from(previous).filter((selectionKey) => visiblePaymentKeySet.has(selectionKey));
      return next.length === previous.size ? previous : new Set(next);
    });
  }, [currentTotalSalesPaymentKeys]);

  const getCurrentOrderData = () => {
    return currentOrderData;
  };

  const getDateEditActor = () => {
    try {
      return localStorage.getItem("username") || "admin";
    } catch {
      return "admin";
    }
  };

  const getDateEditErrorMessage = (error: unknown, fallback: string) => {
    const message = String((error as any)?.message || "");
    const jsonMessageMatch = message.match(/"message"\s*:\s*"([^"]+)"/);
    if (jsonMessageMatch) {
      return jsonMessageMatch[1];
    }
    return message.trim() || fallback;
  };

  const resetBulkOrderDateEditDialog = () => {
    setBulkOrderDateEditDialog(false);
    setBulkOrderDateEditPin("");
    setBulkOrderDateEditValue("");
    setBulkOrderDateEditReason("");
    setBulkOrderDateEditShiftTagDate(true);
    setBulkOrderDateEditShiftPackDate(true);
    setBulkOrderDateEditShiftDeliveryDate(true);
    setBulkOrderDateEditPreserveSpacing(true);
    setBulkOrderDateEditSpacingMinutes("1");
    setBulkOrderDateEditError("");
  };

  const toggleCurrentOrderSelection = (orderId: number) => {
    if (isMovingPayments) return;
    setSelectedCurrentOrderIds((previous) => {
      const next = new Set(previous);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const toggleAllCurrentOrders = useCallback((orders: Order[]) => {
    if (isMovingPayments) return;
    const allSelected = orders.length > 0 && orders.every((order) => selectedCurrentOrderIds.has(order.id));
    if (allSelected) {
      setSelectedCurrentOrderIds(new Set());
      return;
    }
    setSelectedCurrentOrderIds(new Set(orders.map((order) => order.id)));
  }, [isMovingPayments, selectedCurrentOrderIds]);

  const openBulkCurrentOrderDateEditDialog = () => {
    if (selectedCurrentOrders.length === 0) {
      return;
    }
    setBulkOrderDateEditPin("");
    setBulkOrderDateEditValue(toDateTimeLocal(new Date()));
    setBulkOrderDateEditReason("");
    setBulkOrderDateEditShiftTagDate(true);
    setBulkOrderDateEditShiftPackDate(true);
    setBulkOrderDateEditShiftDeliveryDate(true);
    setBulkOrderDateEditPreserveSpacing(true);
    setBulkOrderDateEditSpacingMinutes("1");
    setBulkOrderDateEditError("");
    setBulkOrderDateEditDialog(true);
  };

  const handleConfirmBulkCurrentOrderDateEdit = async () => {
    if (selectedCurrentOrders.length === 0) {
      setBulkOrderDateEditError("Select at least one current period order");
      return;
    }
    if (!bulkOrderDateEditPin.trim()) {
      setBulkOrderDateEditError("Please enter admin PIN");
      return;
    }
    if (!bulkOrderDateEditValue) {
      setBulkOrderDateEditError("Please select a new date and time");
      return;
    }

    const spacing = Math.max(0, Number(bulkOrderDateEditSpacingMinutes) || 0);
    setBulkOrderDateEditing(true);
    setBulkOrderDateEditError("");

    try {
      const response = await apiRequest("POST", "/api/orders/bulk-edit-date", {
        adminPin: bulkOrderDateEditPin,
        requireAdminPin: true,
        orderIds: selectedCurrentOrders.map((order) => order.id),
        newEntryDate: new Date(bulkOrderDateEditValue).toISOString(),
        preserveOrderSpacing: bulkOrderDateEditPreserveSpacing,
        spacingMinutes: spacing,
        shiftTagDate: bulkOrderDateEditShiftTagDate,
        shiftPackDate: bulkOrderDateEditShiftPackDate,
        shiftDeliveryDate: bulkOrderDateEditShiftDeliveryDate,
        reason: bulkOrderDateEditReason || "Sales report bulk date edit",
        changedBy: getDateEditActor(),
      });
      const data = await response.json();

      toast({
        title: data.failedCount > 0 ? "Order Dates Partially Updated" : "Order Dates Updated",
        description: data.message || `${data.updatedCount || 0} order(s) were moved successfully.`,
      });
      resetBulkOrderDateEditDialog();
      setSelectedCurrentOrderIds(new Set());
      refreshSalesReportQueries();
    } catch (error: any) {
      const errorMessage = String(error?.message || "");
      if (errorMessage.toLowerCase().includes("invalid admin pin")) {
        setBulkOrderDateEditError("Invalid admin PIN");
      } else {
        setBulkOrderDateEditError(getDateEditErrorMessage(error, "Failed to edit order dates"));
      }
    } finally {
      setBulkOrderDateEditing(false);
    }
  };

  const getCurrentCreditManagementData = () => {
    return liveCreditManagementData;
  };

  const formatDateRange = () => {
    const start = parseRangeBoundary(startDate, false);
    const end = parseRangeBoundary(endDate, true);
    const dateFmt: Intl.DateTimeFormatOptions = {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    };
    return `${start.toLocaleDateString('en-GB', dateFmt)} - ${end.toLocaleDateString('en-GB', dateFmt)}`;
  };

  const getCurrentData = () => {
    if (activeTab === 'daily') return { data: currentSalesData, label: formatDate(selectedDate), filename: `sales-${formatDate(selectedDate).replace(/\s+/g, '_').replace(/,|:/g, '')}` };
    if (activeTab === 'monthly') return { data: currentSalesData, label: formatMonth(selectedMonth), filename: `sales-${formatMonth(selectedMonth).replace(/\s+/g, '_').replace(/,|:/g, '')}` };
    if (activeTab === 'range') return { data: currentSalesData, label: formatDateRange(), filename: `sales-${formatDateRange().replace(/\s+/g, '_').replace(/,|:/g, '')}` };
    return { data: currentSalesData, label: `Year ${selectedYear}`, filename: `sales-Year_${selectedYear}` };
  };

  const getReportPeriodExportLabel = () => {
    if (activeTab === 'daily') {
      const dateObj = parseLocalDate(selectedDate);
      return dateObj.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }
    if (activeTab === 'monthly') return formatMonth(selectedMonth);
    if (activeTab === 'yearly') return `Year ${selectedYear}`;
    return formatDateRange();
  };

  const getOldPaidPaymentEntriesForPeriod = (
    orderData: { oldPaidOrders: Order[] } = getCurrentOrderData(),
  ) =>
    orderData.oldPaidOrders
      .flatMap((order) => {
        if (!order.billId) return [];

        const bill = getBillById(order.billId) || null;
        const client = getClientById(order.clientId) || null;
        const payments = (billPaymentsByBillId.get(order.billId) || []).filter((payment: any) => {
          const paymentDate = new Date(payment?.paymentDate || payment?.date || "");
          return Number.isFinite(paymentDate.getTime()) && dateMatchesPeriod(paymentDate, activeReportPeriod);
        });

        return payments.map((payment: any) => ({
          id: Number(payment.id || 0),
          order,
          payment,
          bill,
          client,
        }));
      })
      .sort((left, right) => {
        const timeDelta =
          getSalesPaymentRecordTime(left.payment?.paymentDate || left.payment?.date) -
          getSalesPaymentRecordTime(right.payment?.paymentDate || right.payment?.date);
        if (timeDelta !== 0) {
          return timeDelta;
        }
        return Number(left.payment?.id || 0) - Number(right.payment?.id || 0);
      });

  const currentOldPaidPaymentEntries = useMemo(
    () => getOldPaidPaymentEntriesForPeriod(currentOrderData),
    [activeReportPeriod, billById, billPaymentsByBillId, clientById, currentOrderData],
  );

  useEffect(() => {
    const visiblePaymentIdSet = new Set(
      currentOldPaidPaymentEntries
        .map((entry) => Number(entry.payment?.id || 0))
        .filter((paymentId) => Number.isFinite(paymentId) && paymentId > 0),
    );

    setSelectedOldPaidPayments((previous) => {
      const next = Array.from(previous).filter((paymentId) => visiblePaymentIdSet.has(paymentId));
      return next.length === previous.size ? previous : new Set(next);
    });
  }, [currentOldPaidPaymentEntries]);

  useEffect(() => {
    if (creditOnly || isMobile || isMovingPayments) {
      return;
    }

    const isDialogShortcutContextActive = () =>
      Boolean(document.querySelector('[role="dialog"][data-state="open"], [aria-modal="true"]'));

    const focusReportTable = (tableRef: { current: HTMLDivElement | null }) => {
      const tableElement = tableRef.current;
      if (!tableElement) return;

      tableElement.focus({ preventScroll: true });
      tableElement.scrollIntoView({ block: "nearest", inline: "nearest" });
    };

    const toggleOldPaidPayments = () => {
      if (isMovingPayments) return;
      const paymentIds = currentOldPaidPaymentEntries
        .map((entry) => Number(entry.payment?.id || 0))
        .filter((paymentId) => Number.isFinite(paymentId) && paymentId > 0);

      if (paymentIds.length === 0) return;

      const allSelected = paymentIds.every((paymentId) => selectedOldPaidPayments.has(paymentId));
      setSelectedOldPaidPayments((previous) => {
        const next = new Set(previous);
        paymentIds.forEach((paymentId) => {
          if (allSelected) {
            next.delete(paymentId);
          } else {
            next.add(paymentId);
          }
        });
        return next;
      });
    };

    const handleSalesReportSelectAllShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== "a" || (!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }

      if (isDialogShortcutContextActive()) {
        return;
      }

      const targetNode = event.target instanceof Node ? event.target : null;
      const hoveredTable = hoveredSalesReportTableRef.current;
      const targetIsOldPaidTable =
        hoveredTable === "old-paid" ||
        Boolean(targetNode && salesReportOldPaidTableRef.current?.contains(targetNode));
      const targetIsTotalSalesTable =
        hoveredTable === "total-sales" ||
        Boolean(targetNode && salesReportTotalSalesTableRef.current?.contains(targetNode));
      const targetIsCurrentTable =
        hoveredTable === "current" ||
        Boolean(targetNode && salesReportCurrentOrdersTableRef.current?.contains(targetNode));

      event.preventDefault();

      if (targetIsTotalSalesTable && currentTotalSalesPayments.length > 0) {
        focusReportTable(salesReportTotalSalesTableRef);
        toggleAllTotalSalesPayments(currentTotalSalesPayments);
        return;
      }

      if (targetIsOldPaidTable && currentOldPaidPaymentEntries.length > 0) {
        focusReportTable(salesReportOldPaidTableRef);
        toggleOldPaidPayments();
        return;
      }

      if (targetIsCurrentTable && currentOrderData.currentDateOrders.length > 0) {
        focusReportTable(salesReportCurrentOrdersTableRef);
        toggleAllCurrentOrders(currentOrderData.currentDateOrders);
        return;
      }

      if (currentOrderData.currentDateOrders.length > 0) {
        focusReportTable(salesReportCurrentOrdersTableRef);
        toggleAllCurrentOrders(currentOrderData.currentDateOrders);
        return;
      }

      if (currentOldPaidPaymentEntries.length > 0) {
        focusReportTable(salesReportOldPaidTableRef);
        toggleOldPaidPayments();
        return;
      }

      if (currentTotalSalesPayments.length > 0) {
        focusReportTable(salesReportTotalSalesTableRef);
        toggleAllTotalSalesPayments(currentTotalSalesPayments);
      }
    };

    window.addEventListener("keydown", handleSalesReportSelectAllShortcut);
    return () => {
      window.removeEventListener("keydown", handleSalesReportSelectAllShortcut);
    };
  }, [
    creditOnly,
    currentOldPaidPaymentEntries,
    currentOrderData.currentDateOrders,
    currentTotalSalesPayments,
    isMovingPayments,
    isMobile,
    selectedOldPaidPayments,
    toggleAllCurrentOrders,
    toggleAllTotalSalesPayments,
  ]);

  const exportToExcel = async () => {
    const { data, label, filename } = getCurrentData();
    const orderData = getCurrentOrderData();
    const reportPeriod = getActiveReportPeriod();

    // Format period with full day name (e.g., "Wednesday, 28 January 2026")
    let periodLabel = label;
    if (activeTab === 'daily') {
      const dateObj = parseLocalDate(selectedDate);
      periodLabel = dateObj.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    }

    const formatDateTime = (dateStr: string) => {
      const d = new Date(dateStr);
      return d.toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    };

    const allOrdersList = [...orderData.currentDateOrders, ...orderData.oldPaidOrders];

    const totalBills = allOrdersList.reduce((sum, o) => sum + getOrderBillAmounts(o).finalAmount, 0);
    const totalPaid = allOrdersList.reduce((sum, o) => sum + getOrderBillAmounts(o).paidAmount, 0);
    const totalPending = totalBills - totalPaid;

    const formatPaymentMethod = (order: Order) => {
      const methodLabel = getOrderPaymentMethodForPeriod(order, reportPeriod);
      if (methodLabel && methodLabel !== "-") {
        return methodLabel === "Credit" ? "Deduct from Credit" : methodLabel;
      }
      return "-";
    };

    const getExcelStatus = (order: Order) => {
      return getOrderStatus(order).label;
    };

    const mapOrderToRow = (order: Order) => {
      const client = getClientById(order.clientId);
      const amounts = getOrderBillAmounts(order);
      const paymentStatus = getOrderPaymentStatus(order, reportPeriod);
      const customerName = getOrderCustomerName(order, client);
      const customerAddress = getOrderCustomerAddress(order, client);
      const customerPhone = getOrderCustomerPhone(order, client);
      const paidDateLabel = getOrderPaidDateLabelForPdf(order, reportPeriod);
      const partialHistoryDateLabel = getSalesPaymentPartialDateLabel(paymentStatus, formatSalesReportPdfDateTime);
      const paidStatusDateLabel =
        paidDateLabel !== "-"
          ? partialHistoryDateLabel
            ? getSalesPaymentPaidDateLabel(paidDateLabel, (value) => String(value))
            : paidDateLabel
          : "-";
      return {
        type: order.urgent ? 'Bill (Urgent)' : (order.deliveryType === 'delivery' ? 'Bill (Delivery)' : 'Bill (Take-away)'),
        client: buildExcelClientCell(customerName, customerAddress, customerPhone),
        phone: customerPhone,
	        description: `Order #${order.orderNumber || order.id}`,
	        billAmount: amounts.originalAmount.toFixed(2),
	        deliveryCharge: amounts.deliveryCharge.toFixed(2),
	        discount: amounts.discount.toFixed(2),
        finalAmount: amounts.finalAmount.toFixed(2),
        paymentMethod: formatPaymentMethod(order),
        date: order.entryDate ? new Date(order.entryDate) : new Date(),
        createdDateStr: formatDateTime(order.entryDate ? String(order.entryDate) : new Date().toISOString()),
        paidDateStr: [partialHistoryDateLabel, paidStatusDateLabel !== "-" ? paidStatusDateLabel : null].filter(Boolean).join(" | ") || "-",
        paymentStatus: getSalesPaymentStatusExportLabel(paymentStatus),
        orderStatus: getExcelStatus(order),
      };
    };

    const currentOrderRows = orderData.currentDateOrders.map(mapOrderToRow);
    const oldPaidOrderRows = orderData.oldPaidOrders.map(mapOrderToRow);

    const creditDepositExcelRows: ExcelExportCell[][] = data.deposits.map((payment: any, index: number) => {
      const bill = getBillById(payment.billId) || null;
      const client = getSalesPaymentClient(payment, bill);
      const paymentStatus = getSalesPaymentStatusMeta(payment, bill);
      const paymentAmount = parseFloat(String(payment.amount || "0"));
      const paymentBreakdown = getPaymentBreakdownInline(payment);
      const partialHistoryDateLabel = getSalesPaymentPartialDateLabel(paymentStatus, formatSalesReportPdfDateTime);
      const paidDateLabel = payment.date
        ? partialHistoryDateLabel
          ? getSalesPaymentPaidDateLabel(formatDateTime(payment.date ? String(payment.date) : new Date().toISOString()), (value) => String(value))
          : formatDateTime(payment.date ? String(payment.date) : new Date().toISOString())
        : "-";

      return [
        index + 1,
        'Payment',
        buildExcelClientCell(
          payment.clientName || client?.name || 'Unknown',
          getPaymentCustomerAddress(payment, client),
          getPaymentCustomerPhone(payment, client),
        ),
        getPaymentCustomerPhone(payment, client),
        payment.description || '-',
        `AED ${paymentAmount.toFixed(2)}`,
        paymentBreakdown,
        [partialHistoryDateLabel, paidDateLabel !== "-" ? paidDateLabel : null].filter(Boolean).join(" | ") || "-",
        getSalesPaymentStatusExportLabel(paymentStatus),
      ];
    });

    const currentSummary = getOrderSectionSummary(orderData.currentDateOrders);
    const currentTotal = currentOrderRows.reduce((sum, r) => sum + parseFloat(r.finalAmount), 0);
    const oldPaidTotal = oldPaidOrderRows.reduce((sum, r) => sum + parseFloat(r.finalAmount), 0);

	    const excelHeaders: ExcelExportCell[] = ['#', 'Type', 'Client', 'Phone', 'Description', 'Work Rec. (AED)', 'Delivery Charge (AED)', 'Discount (AED)', 'Final Amt (AED)', 'Payment Method', 'Created', 'Paid On', 'Payment Status', 'Order Status'];
    const salesHeaders: ExcelExportCell[] = ['#', 'Type', 'Client', 'Phone', 'Description', 'Amount Paid (AED)', 'Payment Method', 'Paid On', 'Payment Status'];

    const totalDiscount = [...currentOrderRows, ...oldPaidOrderRows].reduce((sum, r) => sum + parseFloat(r.discount || "0"), 0);

    const summaryData: ExcelExportCell[][] = [
      [salesReportCompanyName],
      ['Sales Report'],
      [`DATE: ${periodLabel}`],
      [],
      [`Current Period Orders (${currentOrderRows.length}) - Total: ${currentTotal.toFixed(2)} AED | Urgent: ${currentSummary.urgentCount} | Normal: ${currentSummary.normalCount} | Paid: ${currentSummary.paidAmount.toFixed(2)} AED | Unpaid: ${currentSummary.unpaidAmount.toFixed(2)} AED`],
      excelHeaders,
	      ...currentOrderRows.map((row, index) => [index + 1, row.type, row.client, row.phone, row.description, `AED ${row.billAmount}`, parseFloat(row.deliveryCharge) > 0 ? `AED ${row.deliveryCharge}` : '', parseFloat(row.discount) > 0 ? `AED ${row.discount}` : '', `AED ${row.finalAmount}`, row.paymentMethod, row.createdDateStr, row.paidDateStr, row.paymentStatus, row.orderStatus]),
    ];

    if (oldPaidOrderRows.length > 0) {
      summaryData.push(
        [],
        [`Old Bills Paid in This Period (${oldPaidOrderRows.length}) - Total: ${oldPaidTotal.toFixed(2)} AED`],
        excelHeaders as any,
	        ...oldPaidOrderRows.map((row, index) => [index + 1, row.type, row.client, row.phone, row.description, `AED ${row.billAmount}`, parseFloat(row.deliveryCharge) > 0 ? `AED ${row.deliveryCharge}` : '', parseFloat(row.discount) > 0 ? `AED ${row.discount}` : '', `AED ${row.finalAmount}`, row.paymentMethod, row.createdDateStr, row.paidDateStr, row.paymentStatus, row.orderStatus]),
      );
    }

    const totalSalesCount = creditDepositExcelRows.length;
    const totalSalesAmount = data.deposits.reduce(
      (sum: number, payment: any) => sum + parseFloat(String(payment.amount || "0")),
      0,
    );
    const paymentBreakdownRows = getSalesPaymentBreakdown(data.rawDeposits || data.deposits);
    const creditSummary = getSalesCreditSummary(paymentBreakdownRows);

    if (creditDepositExcelRows.length > 0) {
      summaryData.push(
        [],
        [`Total Sales (${totalSalesCount}) - Total: ${totalSalesAmount.toFixed(2)} AED`],
        salesHeaders as any,
        ...creditDepositExcelRows,
      );

      summaryData.push(
        [],
        ['Payment Method Breakdown'],
        ['Method', 'Bills Paid', 'Total Amount (AED)'],
        ...paymentBreakdownRows.map((row) => [
          row.label,
          `${row.billCount} bill${row.billCount === 1 ? '' : 's'}`,
          `AED ${row.totalAmount.toFixed(2)}`,
        ]),
      );
    }

    summaryData.push(
      [],
      ['Summary'],
      ['Current Period Orders', `${currentOrderRows.length} orders`, `${currentTotal.toFixed(2)} AED`, `Paid: ${currentSummary.paidAmount.toFixed(2)} AED`, `Unpaid: ${currentSummary.unpaidAmount.toFixed(2)} AED`, `Urgent: ${currentSummary.urgentCount}`, `Normal: ${currentSummary.normalCount}`],
      ['Old Bills Paid', `${oldPaidOrderRows.length} orders`, `${oldPaidTotal.toFixed(2)} AED`],
      ['Total Sales', `${totalSalesCount} payments`, `${totalSalesAmount.toFixed(2)} AED`, `(${currentOrderRows.length} current + ${oldPaidOrderRows.length} old paid)`],
      ['Total Discounts', `${totalDiscount.toFixed(2)} AED`],
      [creditSummary.usageLabel, `${creditSummary.usedAmount.toFixed(2)} AED`, `${creditSummary.usedBillCount} bill${creditSummary.usedBillCount === 1 ? '' : 's'}`],
      ['System Credit Remaining', `${creditSummary.remainingAmount.toFixed(2)} AED`],
    );

    const typeCellStyles: CellStyle[] = [];
    const headerRows: number[] = [];
    const typeCol = 2;
    const headerFillColor = 'FF1E40AF';
    const headerFontColor = 'FFFFFFFF';
    const numCols = excelHeaders.length;

    const styleBodyRow = (row: number, colCount: number) => {
      for (let col = 1; col <= colCount; col++) {
        typeCellStyles.push({
          row,
          col,
          alignment: { wrapText: true, vertical: 'middle' },
        });
      }
    };

    const styleHeaderRow = (row: number, colCount: number = numCols) => {
      headerRows.push(row);
      for (let col = 1; col <= colCount; col++) {
        typeCellStyles.push({
          row,
          col,
          fill: { color: headerFillColor },
          font: { color: headerFontColor, bold: true },
          alignment: { wrapText: true, vertical: 'middle', horizontal: 'center' },
        });
      }
    };

    const currentHeaderRow = 6;
    styleHeaderRow(currentHeaderRow);

    const currentDataStartRow = 7;
    currentOrderRows.forEach((row, i) => {
      const excelRow = currentDataStartRow + i;
      styleBodyRow(excelRow, excelHeaders.length);
      if (row.type.includes('Urgent')) {
        typeCellStyles.push({ row: excelRow, col: typeCol, fill: { color: 'FFFDE8D0' } });
      } else {
        typeCellStyles.push({ row: excelRow, col: typeCol, fill: { color: 'FFD5F5E3' } });
      }
    });

    let nextRow = currentDataStartRow + currentOrderRows.length;

    if (oldPaidOrderRows.length > 0) {
      nextRow += 1;
      const oldHeaderRow = nextRow + 1;
      const oldStartRow = oldHeaderRow + 1;
      styleHeaderRow(oldHeaderRow);
      oldPaidOrderRows.forEach((row, i) => {
        const excelRow = oldStartRow + i;
        styleBodyRow(excelRow, excelHeaders.length);
        if (row.type.includes('Urgent')) {
          typeCellStyles.push({ row: excelRow, col: typeCol, fill: { color: 'FFFDE8D0' } });
        } else {
          typeCellStyles.push({ row: excelRow, col: typeCol, fill: { color: 'FFD5F5E3' } });
        }
      });
      nextRow = oldStartRow + oldPaidOrderRows.length;
    }

    if (creditDepositExcelRows.length > 0) {
      const totalSalesHeaderRow = nextRow + 2;
      styleHeaderRow(totalSalesHeaderRow, salesHeaders.length);
      const totalSalesStartRow = totalSalesHeaderRow + 1;
      creditDepositExcelRows.forEach((_row, i) => {
        styleBodyRow(totalSalesStartRow + i, salesHeaders.length);
      });
      nextRow = totalSalesStartRow + creditDepositExcelRows.length;

      const paymentBreakdownHeaderRow = nextRow + 2;
      styleHeaderRow(paymentBreakdownHeaderRow, 3);
      nextRow = paymentBreakdownHeaderRow + paymentBreakdownRows.length + 1;
    }

    await writeExcel({
      data: summaryData,
      sheetName: "Sales Report",
      fileName: `${filename}.xlsx`,
      columns: [
        { wch: 5 },
        { wch: 20 },
        { wch: 34 },
        { wch: 16 },
        { wch: 44 },
        { wch: 18 },
        { wch: 16 },
        { wch: 18 },
        { wch: 20 },
        { wch: 22 },
        { wch: 22 },
        { wch: 12 },
        { wch: 12 },
      ],
      cellStyles: typeCellStyles,
      rowHeights: headerRows.map((row) => ({ row, height: 26 })),
    });
  };

  const exportCreditManagementToExcel = async () => {
    const creditManagementData = getCurrentCreditManagementData();
    const creditManagementHeaders: ExcelExportCell[] = ['#', 'Date', 'Account #', 'Client', 'Entry', 'Bill', 'Amount (AED)', 'Description'];

    const formatDateTime = (dateStr: string) => {
      const d = new Date(dateStr);
      return d.toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    };

    const creditManagementExcelRows: ExcelExportCell[][] = creditManagementData.entries.map((transaction, index) => {
      const actionDisplay = getCreditManagementActionDisplay(transaction);
      return [
        index + 1,
        formatDateTime(String(transaction.date)),
        transaction.accountLabel,
        transaction.customerName,
        actionDisplay.label,
        transaction.billId ? `#${transaction.billDisplayNumber}` : '-',
        `${transaction.isDeduction ? '-' : '+'}${transaction.amountValue.toFixed(2)} AED`,
        transaction.displayDescription,
      ];
    });

    const exportRows: ExcelExportCell[][] = [
      [salesReportCompanyName],
      [creditManagementLogLabel],
      [`LIVE DATA: ${creditManagementLogDescription}`],
      [],
      [
        `${creditManagementLogLabel} (${creditManagementData.entries.length}) - Added: ${creditManagementData.totalAdded.toFixed(2)} AED | Deducted: ${creditManagementData.totalUsed.toFixed(2)} AED | Net: ${(creditManagementData.totalAdded - creditManagementData.totalUsed).toFixed(2)} AED`,
      ],
      creditManagementHeaders,
      ...creditManagementExcelRows,
    ];

    const cellStyles: CellStyle[] = [];
    const headerRows = [6];
    for (let col = 1; col <= creditManagementHeaders.length; col++) {
      cellStyles.push({
        row: 6,
        col,
        fill: { color: 'FFD97706' },
        font: { color: 'FFFFFFFF', bold: true },
        alignment: { wrapText: true, vertical: 'middle', horizontal: 'center' },
      });
    }

    creditManagementExcelRows.forEach((_row, index) => {
      const row = 7 + index;
      for (let col = 1; col <= creditManagementHeaders.length; col++) {
        cellStyles.push({
          row,
          col,
          alignment: { wrapText: true, vertical: 'middle' },
        });
      }
    });

    await writeExcel({
      data: exportRows,
      sheetName: creditManagementLogLabel,
      fileName: `${creditManagementLogFileBaseName}.xlsx`,
      columns: [
        { wch: 5 },
        { wch: 22 },
        { wch: 14 },
        { wch: 24 },
        { wch: 12 },
        { wch: 10 },
        { wch: 14 },
        { wch: 16 },
        { wch: 60 },
      ],
      cellStyles,
      rowHeights: headerRows.map((row) => ({ row, height: 26 })),
    });
  };

  const getPeriodEndDate = (period: ReportPeriod) => {
    if (period === 'daily') {
      return parseRangeBoundary(selectedDate, true);
    }

    if (period === 'monthly') {
      const [year, month] = selectedMonth.split('-').map(Number);
      return new Date(year, month, 0, 23, 59, 59, 999);
    }

    if (period === 'range') {
      return parseRangeBoundary(endDate, true);
    }

    return new Date(Number(selectedYear), 11, 31, 23, 59, 59, 999);
  };

  const getOrderPaidAmountForPeriod = (order: Order, period: ReportPeriod) => {
    const amounts = getOrderBillAmounts(order);

    if (!order.billId) {
      return amounts.paidAmount;
    }

    const paymentsForBill = billPaymentsByBillId.get(order.billId) || [];
    if (paymentsForBill.length === 0) {
      return amounts.paidAmount;
    }

    const siblingOrders = getOrdersForBillId(order.billId);
    if (siblingOrders.length > 1) {
      return amounts.paidAmount;
    }

    const periodEndTime = getPeriodEndDate(period).getTime();
    const paidAmount = paymentsForBill.reduce((sum, payment) => {
      const paymentTime = new Date(payment?.paymentDate || payment?.date || "").getTime();
      if (!Number.isFinite(paymentTime) || paymentTime > periodEndTime) {
        return sum;
      }

      const paymentAmount = parseFloat(String(payment?.amount || "0"));
      if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
        return sum;
      }

      return sum + paymentAmount;
    }, 0);

    return Math.min(amounts.finalAmount, Math.max(0, paidAmount));
  };

  const getOrderPaymentStatus = (order: Order, period: ReportPeriod): SalesOrderPaymentStatusMeta => {
    const amounts = getOrderBillAmounts(order);
    const paidAmount = getOrderPaidAmountForPeriod(order, period);
    const partialHistoryMeta = getSalesBillPartialHistoryMeta(order.billId);

    if (paidAmount >= amounts.finalAmount - 0.01) {
      return {
        label: 'Fully Paid',
        color: 'text-green-600 bg-green-50 border-green-200',
        ...partialHistoryMeta,
      };
    }

    if (paidAmount > 0.01) {
      return {
        label: 'Partially Paid',
        color: 'text-amber-600 bg-amber-50 border-amber-200',
        ...EMPTY_SALES_PAYMENT_HISTORY_META,
      };
    }

    return {
      label: 'Unpaid',
      color: 'text-blue-600 bg-blue-50 border-blue-200',
      ...EMPTY_SALES_PAYMENT_HISTORY_META,
    };
  };

  const getActiveReportPeriod = (): ReportPeriod => activeReportPeriod;

  const exportCreditManagementToPDF = async () => {
    const creditManagementData = getCurrentCreditManagementData();
    const html2pdf = (await import('html2pdf.js')).default;

    const content = `
      <div class="sales-pdf-report" style="font-family: Arial, sans-serif; padding: 10px; color: #333; font-size: 8.5px;">
        ${renderSalesPdfPrintColorStyle()}
        <div style="text-align: center; border-bottom: 2px solid #d97706; padding-bottom: 10px; margin-bottom: 10px;">
          <div style="font-size: 16px; font-weight: bold; color: #1e40af; margin: 0;">${escapeHtml(salesReportCompanyName)}</div>
          <div style="color: #666; margin: 3px 0; font-size: 9px;">${escapeHtml(salesReportHeaderAddress)}</div>
          <div style="font-size: 13px; font-weight: bold; margin: 8px 0 3px;">${escapeHtml(creditManagementLogLabel)}</div>
          <div style="color: #666; font-size: 10px;">LIVE DATA: ${escapeHtml(creditManagementLogDescription)}</div>
        </div>

        ${renderSalesCreditManagementSectionHtml(creditManagementData)}

        <div style="margin-top: 15px; text-align: center; color: #666; font-size: 9px; border-top: 1px solid #e5e7eb; padding-top: 8px;">
          <div>Generated on ${new Date().toLocaleString()}</div>
          <div style="font-weight: bold; color: #000; font-size: 10px; margin-top: 5px;">${escapeHtml(salesReportPhoneLine)}</div>
        </div>
      </div>
    `;

    const container = document.createElement('div');
    container.innerHTML = content;
    document.body.appendChild(container);

    html2pdf()
      .set(getPdfExportOptions(`${creditManagementLogFileBaseName}.pdf`, "portrait", ['css', 'legacy']) as any)
      .from(container)
      .save()
      .then(() => {
        document.body.removeChild(container);
      });
  };

  const exportToPDF = async () => {
    const { data, label, filename } = getCurrentData();
    const orderData = getCurrentOrderData();
    const reportPeriod = getActiveReportPeriod();
    const html2pdf = (await import('html2pdf.js')).default;
    const paymentBreakdownRows = getSalesPaymentBreakdown(data.rawDeposits || data.deposits);
    let reportTitle = 'Sales Report';
    let reportDate = label;
    if (activeTab === 'range') {
      reportDate = `DATE: ${formatDateRange()}`;
    } else if (activeTab === 'daily') {
      const dateObj = parseLocalDate(selectedDate);
      reportDate = `DATE: ${dateObj.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}`;
    } else if (activeTab === 'monthly') {
      reportDate = `DATE: ${formatMonth(selectedMonth)}`;
    } else if (activeTab === 'yearly') {
      reportDate = `DATE: Year ${selectedYear}`;
    }
    const content = `
      <div class="sales-pdf-report" style="font-family: Arial, sans-serif; padding: 10px; color: #333; font-size: 9px;">
        ${renderSalesPdfPrintColorStyle()}
        <div style="text-align: center; border-bottom: 2px solid #1e40af; padding-bottom: 10px; margin-bottom: 10px;">
          <div style="font-size: 16px; font-weight: bold; color: #1e40af; margin: 0;">${escapeHtml(salesReportCompanyName)}</div>
          <div style="color: #666; margin: 3px 0; font-size: 9px;">${escapeHtml(salesReportHeaderAddress)}</div>
          <div style="font-size: 13px; font-weight: bold; margin: 8px 0 3px;">${reportTitle}</div>
          <div style="color: #666; font-size: 10px;">${reportDate}</div>
        </div>

        ${renderSalesSummaryCardsHtml(orderData, paymentBreakdownRows)}

        ${(() => {
	          const renderPdfOrderTable = (orders: Order[], sectionTotal: number) => {
	            const sectionDiscount = orders.reduce((sum, o) => sum + getOrderBillAmounts(o).discount, 0);
	            const sectionDeliveryCharge = orders.reduce((sum, o) => sum + getOrderBillAmounts(o).deliveryCharge, 0);
	            const sectionBillTotal = orders.reduce((sum, o) => sum + getOrderBillAmounts(o).originalAmount, 0);
            return orders.map((o, i) => {
              const cl = getClientById(o.clientId);
              const amounts = getOrderBillAmounts(o);
              const customerName = getOrderCustomerName(o, cl);
              const customerAddress = getOrderCustomerAddress(o, cl);
              const customerPhone = getOrderCustomerPhone(o, cl);
	              const billAmt = amounts.originalAmount.toFixed(2);
	              const delivery = amounts.deliveryCharge;
	              const finalAmt = amounts.finalAmount.toFixed(2);
              const disc = amounts.discount;
              const createdDate = formatSalesReportPdfDateTime(o.entryDate ? String(o.entryDate) : null);
              const paidDate = getOrderPaidDateLabelForPdf(o, reportPeriod);
              const paymentStatus = getOrderPaymentStatus(o, reportPeriod);
              const orderStatus = getOrderStatus(o);
              const paymentStatusColor =
                paymentStatus.label === 'Fully Paid'
                  ? '#16a34a'
                  : paymentStatus.label === 'Partially Paid'
                    ? '#d97706'
                    : '#2563eb';
              const partialDateLabel = getSalesPaymentPartialDateLabel(paymentStatus, formatSalesReportPdfDateTime);
              const paidDateLabel =
                paidDate === '-'
                  ? 'No payment date'
                  : partialDateLabel
                    ? getSalesPaymentPaidDateLabel(paidDate, (value) => String(value))
                    : paidDate;
              return `
              <tr class="${o.urgent ? "sales-pdf-urgent-row" : ""}" style="page-break-inside: avoid;">
                <td style="padding: 3px 2px; text-align: center; border: 1px solid #e5e7eb; color: #666;">${i + 1}</td>
                <td style="padding: 3px 2px; border: 1px solid #e5e7eb; overflow: hidden; word-wrap: break-word;">${buildPdfClientCell(customerName, customerAddress, customerPhone)}</td>
                <td style="padding: 3px 2px; border: 1px solid #e5e7eb; overflow: hidden;">#${o.orderNumber || o.id}</td>
                <td style="padding: 3px 2px; text-align: center; border: 1px solid #e5e7eb;">${o.deliveryType === 'delivery' ? 'D' : 'T'}</td>
	                <td style="padding: 3px 2px; text-align: center; border: 1px solid #e5e7eb; color: ${o.urgent ? '#dc2626' : '#16a34a'}; font-weight: bold;">${o.urgent ? 'Urgent' : 'Normal'}</td>
	                <td style="padding: 3px 2px; text-align: right; border: 1px solid #e5e7eb; color: #666;">${billAmt}</td>
	                <td style="padding: 3px 2px; text-align: right; border: 1px solid #e5e7eb; color: ${delivery > 0 ? '#2563eb' : '#999'};">${delivery > 0 ? delivery.toFixed(2) : '-'}</td>
	                <td style="padding: 3px 2px; text-align: right; border: 1px solid #e5e7eb; color: ${disc > 0 ? '#ea580c' : '#999'};">${disc > 0 ? '-' + disc.toFixed(2) : '-'}</td>
                <td style="padding: 3px 2px; text-align: right; border: 1px solid #e5e7eb; color: #2563eb; font-weight: bold;">${finalAmt}</td>
                <td style="padding: 3px 2px; text-align: center; border: 1px solid #e5e7eb; color: #666;">${createdDate}</td>
                <td style="padding: 3px 2px; text-align: center; border: 1px solid #e5e7eb; color: ${paymentStatusColor};">
                  <div style="font-weight: bold;">${escapeHtml(getSalesPaymentStatusExportLabel(paymentStatus))}</div>
                  ${partialDateLabel ? `<div style="margin-top: 2px; font-size: 7px; color: #b45309; font-weight: 700;">${escapeHtml(partialDateLabel)}</div>` : ""}
                  <div style="margin-top: 2px; font-size: 7px; color: ${paidDate === '-' ? '#6b7280' : paymentStatusColor};">${escapeHtml(paidDateLabel || 'No payment date')}</div>
                </td>
                <td style="padding: 3px 2px; text-align: center; border: 1px solid #e5e7eb; color: ${orderStatus.color}; font-weight: bold;">${orderStatus.label}</td>
              </tr>`;
            }).join('') + `
	            <tr style="background: #f3f4f6; font-weight: bold;">
	              <td colspan="5" style="padding: 4px 2px; border: 1px solid #e5e7eb; text-align: right;">Total:</td>
	              <td style="padding: 4px 2px; text-align: right; border: 1px solid #e5e7eb; color: #666;">${sectionBillTotal.toFixed(2)} AED</td>
	              <td style="padding: 4px 2px; text-align: right; border: 1px solid #e5e7eb; color: #2563eb;">${sectionDeliveryCharge > 0 ? sectionDeliveryCharge.toFixed(2) : ''}</td>
	              <td style="padding: 4px 2px; text-align: right; border: 1px solid #e5e7eb; color: #ea580c;">${sectionDiscount > 0 ? '-' + sectionDiscount.toFixed(2) : ''}</td>
              <td style="padding: 4px 2px; text-align: right; border: 1px solid #e5e7eb; color: #2563eb;">${sectionTotal.toFixed(2)} AED</td>
              <td colspan="3" style="padding: 4px 2px; border: 1px solid #e5e7eb;"></td>
            </tr>`;
          };

          const pdfTableHeader = `
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 4px 2px; text-align: center; border: 1px solid #e5e7eb; width: 3%;">#</th>
	              <th style="padding: 4px 2px; text-align: left; border: 1px solid #e5e7eb; width: 12%;">Client</th>
	              <th style="padding: 4px 2px; text-align: left; border: 1px solid #e5e7eb; width: 7%;">Order</th>
	              <th style="padding: 4px 2px; text-align: center; border: 1px solid #e5e7eb; width: 5%;">Type</th>
	              <th style="padding: 4px 2px; text-align: center; border: 1px solid #e5e7eb; width: 6%;">Priority</th>
	              <th style="padding: 4px 2px; text-align: right; border: 1px solid #e5e7eb; width: 9%;">Bill Amt</th>
	              <th style="padding: 4px 2px; text-align: right; border: 1px solid #e5e7eb; width: 8%;">Delivery</th>
	              <th style="padding: 4px 2px; text-align: right; border: 1px solid #e5e7eb; width: 7%;">Discount</th>
              <th style="padding: 4px 2px; text-align: right; border: 1px solid #e5e7eb; width: 9%;">Final Amt</th>
              <th style="padding: 4px 2px; text-align: center; border: 1px solid #e5e7eb; width: 12%;">Created</th>
              <th style="padding: 4px 2px; text-align: center; border: 1px solid #e5e7eb; width: 12%;">Payment</th>
              <th style="padding: 4px 2px; text-align: center; border: 1px solid #e5e7eb; width: 8%;">Order Status</th>
            </tr>
          </thead>`;

          const currentSummary = getOrderSectionSummary(orderData.currentDateOrders);
          const currentTotal = orderData.currentDateOrders.reduce((sum: number, o: Order) => sum + getOrderBillAmounts(o).finalAmount, 0);
          const oldPaidTotal = orderData.oldPaidOrders.reduce((sum: number, o: Order) => sum + getOrderBillAmounts(o).finalAmount, 0);

          let html = '';
          if (orderData.currentDateOrders.length > 0) {
            html += `
        <div style="color: #2563eb; font-weight: bold; font-size: 11px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin-bottom: 5px;">Current Period Orders (${orderData.currentDateOrders.length}) - ${currentTotal.toFixed(2)} AED | <span style="color: #dc2626;">Urgent: ${currentSummary.urgentCount}</span> | <span style="color: #16a34a;">Normal: ${currentSummary.normalCount}</span> | <span style="color: #059669;">Paid: ${currentSummary.paidAmount.toFixed(2)} AED</span> | <span style="color: #dc2626;">Unpaid: ${currentSummary.unpaidAmount.toFixed(2)} AED</span></div>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 8px; table-layout: fixed;">
          ${pdfTableHeader}
          <tbody>
            ${renderPdfOrderTable(orderData.currentDateOrders, currentTotal)}
          </tbody>
        </table>`;
          }

          if (orderData.oldPaidOrders.length > 0) {
            html += `
        <div style="color: #16a34a; font-weight: bold; font-size: 11px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin-bottom: 5px;">Old Bills Paid in This Period (${orderData.oldPaidOrders.length}) - ${oldPaidTotal.toFixed(2)} AED</div>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 8px; table-layout: fixed;">
          ${pdfTableHeader}
          <tbody>
            ${renderPdfOrderTable(orderData.oldPaidOrders, oldPaidTotal)}
          </tbody>
        </table>`;
          }

          return html;
        })()}

        ${data.deposits.length > 0 ? (() => {
          const pdfGetPriority = (dep: any): boolean => {
            if (!allOrders) return false;
            if (dep.description) {
              const orderMatch = dep.description.match(/ORD-(\d+)/);
              if (orderMatch) {
                const orderNum = `ORD-${orderMatch[1]}`;
                const order = orderByNumber.get(orderNum.toUpperCase());
                if (order) return !!order.urgent;
              }
            }
            if (dep.billId) {
              const order = getSalesPaymentLinkedOrder(dep);
              if (order) return !!order.urgent;
            }
            return false;
          };
          const totalSalesCount = data.deposits.length;
          const totalSalesAmount = data.deposits.reduce(
            (sum, deposit) => sum + parseFloat(String(deposit.amount || "0")),
            0,
          );
          return `
        <div style="color: #16a34a; font-weight: bold; font-size: 11px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin-bottom: 5px; page-break-before: auto;">Total Sales (${totalSalesCount}) | ${totalSalesAmount.toFixed(2)} AED</div>
        <table style="width: 100%; border-collapse: collapse; font-size: 9px; table-layout: fixed;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 4px; text-align: center; border: 1px solid #e5e7eb; width: 4%;">#</th>
              <th style="padding: 4px; text-align: left; border: 1px solid #e5e7eb; width: 22%;">Client</th>
              <th style="padding: 4px; text-align: left; border: 1px solid #e5e7eb; width: 38%;">Description</th>
              <th style="padding: 4px; text-align: center; border: 1px solid #e5e7eb; width: 14%;">Method</th>
              <th style="padding: 4px; text-align: center; border: 1px solid #e5e7eb; width: 12%;">Payment Status</th>
              <th style="padding: 4px; text-align: right; border: 1px solid #e5e7eb; width: 10%;">Amount Paid</th>
            </tr>
          </thead>
          <tbody>
            ${data.deposits.map((d, i) => {
              const linkedBill = getBillById(d.billId) || null;
              const cl = getSalesPaymentClient(d, linkedBill);
              const paymentStatus = getSalesPaymentStatusMeta(d, linkedBill);
              const paymentStatusColor =
                paymentStatus.label === 'Fully Paid'
                  ? '#16a34a'
                  : paymentStatus.label === 'Partially Paid'
                    ? '#d97706'
                    : '#2563eb';
              const customerName = d.clientName || cl?.name || 'Unknown';
              const customerAddress = getPaymentCustomerAddress(d, cl);
              const customerPhone = getPaymentCustomerPhone(d, cl);
              const methodLines = getPaymentBreakdownLines(d);
              const partialDateLabel = getSalesPaymentPartialDateLabel(paymentStatus, formatSalesReportPdfDateTime);
              const paidDateLabel = partialDateLabel
                ? getSalesPaymentPaidDateLabel(d.date, formatSalesReportPdfDateTime)
                : null;
              return `
              <tr style="page-break-inside: avoid;">
                <td style="padding: 3px 4px; text-align: center; border: 1px solid #e5e7eb; color: #666;">${i + 1}</td>
                <td style="padding: 3px 4px; border: 1px solid #e5e7eb; overflow: hidden; word-wrap: break-word;">${buildPdfClientCell(customerName, customerAddress, customerPhone)}</td>
                <td style="padding: 3px 4px; border: 1px solid #e5e7eb; overflow: hidden; word-wrap: break-word;">${escapeHtml(String(d.description || '-'))}</td>
                <td style="padding: 3px 4px; text-align: center; border: 1px solid #e5e7eb; color: ${paymentStatus.label === 'Partially Paid' ? '#d97706' : '#1e40af'}; font-weight: ${paymentStatus.label === 'Partially Paid' ? '700' : '500'};">${methodLines.map((line: string) => escapeHtml(line)).join('<br />')}</td>
                <td style="padding: 3px 4px; text-align: center; border: 1px solid #e5e7eb; color: ${paymentStatusColor}; font-weight: 700;">
                  <div>${escapeHtml(getSalesPaymentStatusExportLabel(paymentStatus))}</div>
                  ${partialDateLabel ? `<div style="margin-top: 2px; color: #b45309; font-size: 7px; font-weight: 700; line-height: 1.18;">${escapeHtml(partialDateLabel)}</div>` : ""}
                  ${paidDateLabel ? `<div style="margin-top: 2px; color: #16a34a; font-size: 7px; font-weight: 700; line-height: 1.18;">${escapeHtml(paidDateLabel)}</div>` : ""}
                </td>
                <td style="padding: 3px 4px; text-align: right; border: 1px solid #e5e7eb; color: #16a34a; font-weight: bold;">${parseFloat(d.amount).toFixed(2)} AED</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        ${paymentBreakdownRows.length > 0 ? `
          <div style="color: #1e40af; font-weight: bold; font-size: 11px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin: 10px 0 5px;">Payment Method Breakdown</div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 9px; table-layout: fixed;">
            <thead>
              <tr style="background: #f3f4f6;">
                <th style="padding: 4px; text-align: left; border: 1px solid #e5e7eb; width: 40%;">Method</th>
                <th style="padding: 4px; text-align: center; border: 1px solid #e5e7eb; width: 25%;">Bills Paid</th>
                <th style="padding: 4px; text-align: right; border: 1px solid #e5e7eb; width: 35%;">Total (AED)</th>
              </tr>
            </thead>
            <tbody>
              ${paymentBreakdownRows.map((row) => `
                <tr style="page-break-inside: avoid;">
                  <td style="padding: 4px; border: 1px solid #e5e7eb; font-weight: 600;">${row.label}</td>
                  <td style="padding: 4px; text-align: center; border: 1px solid #e5e7eb;">${row.billCount}</td>
                  <td style="padding: 4px; text-align: right; border: 1px solid #e5e7eb; color: #16a34a; font-weight: bold;">${row.totalAmount.toFixed(2)} AED</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}`;
        })() : ''}
        <div style="margin-top: 15px; text-align: center; color: #666; font-size: 9px; border-top: 1px solid #e5e7eb; padding-top: 8px;">
          <div>Generated on ${new Date().toLocaleString()}</div>
          <div style="font-weight: bold; color: #000; font-size: 10px; margin-top: 5px;">${escapeHtml(salesReportPhoneLine)}</div>
        </div>
      </div>
    `;

    const container = document.createElement('div');
    container.innerHTML = content;
    document.body.appendChild(container);

    html2pdf()
      .set(getPdfExportOptions(`${filename}.pdf`, "landscape", ['avoid-all', 'css', 'legacy']) as any)
      .from(container)
      .save()
      .then(() => {
        document.body.removeChild(container);
      });
  };

  const exportPortraitSalesReportToPDF = async () => {
    const { data, label, filename } = getCurrentData();
    const orderData = getCurrentOrderData();
    const html2pdf = (await import('html2pdf.js')).default;
    const paymentBreakdownRows = getSalesPaymentBreakdown(data.rawDeposits || data.deposits);

    let reportTitle = 'Sales Report';
    let reportDate = label;
    if (activeTab === 'range') {
      reportDate = `DATE: ${formatDateRange()}`;
    } else if (activeTab === 'daily') {
      const dateObj = parseLocalDate(selectedDate);
      reportDate = `DATE: ${dateObj.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}`;
    } else if (activeTab === 'monthly') {
      reportDate = `DATE: ${formatMonth(selectedMonth)}`;
    } else if (activeTab === 'yearly') {
      reportDate = `DATE: Year ${selectedYear}`;
    }

    const currentTotal = orderData.currentDateOrders.reduce((sum, order) => sum + getOrderBillAmounts(order).finalAmount, 0);
    const oldPaidTotal = orderData.oldPaidOrders.reduce((sum, order) => sum + getOrderBillAmounts(order).finalAmount, 0);
    let fullReportTrailingReservedHeightMm = 58;
    const currentOrdersSectionHtml = renderSalesOrderSectionHtml(
      "Current Period Orders",
      "#2563eb",
      orderData.currentDateOrders,
      currentTotal,
      true,
      false,
      58,
      (meta) => {
        fullReportTrailingReservedHeightMm = meta.finalPageUsedHeightMm;
      },
    );
    const oldPaidOrdersSectionHtml = renderSalesOrderSectionHtml(
      "Old Bills Paid in This Period",
      "#16a34a",
      orderData.oldPaidOrders,
      oldPaidTotal,
      false,
      false,
      fullReportTrailingReservedHeightMm,
      (meta) => {
        fullReportTrailingReservedHeightMm = meta.finalPageUsedHeightMm;
      },
    );
    const totalSalesSectionHtml = renderSalesPaymentsSectionHtml(
      data.deposits,
      paymentBreakdownRows,
      false,
      fullReportTrailingReservedHeightMm,
      true,
    );

    const content = `
      <div class="sales-pdf-report" style="font-family: Arial, sans-serif; padding: 10px; color: #333; font-size: 8.5px;">
        ${renderSalesPdfPrintColorStyle()}
        <div style="text-align: center; border-bottom: 2px solid #1e40af; padding-bottom: 10px; margin-bottom: 10px;">
          <div style="font-size: 16px; font-weight: bold; color: #1e40af; margin: 0;">${escapeHtml(salesReportCompanyName)}</div>
          <div style="color: #666; margin: 3px 0; font-size: 9px;">${escapeHtml(salesReportHeaderAddress)}</div>
          <div style="font-size: 13px; font-weight: bold; margin: 8px 0 3px;">${reportTitle}</div>
          <div style="color: #666; font-size: 10px;">${reportDate}</div>
        </div>

        ${renderSalesSummaryCardsHtml(orderData, paymentBreakdownRows)}
        ${currentOrdersSectionHtml}
        ${oldPaidOrdersSectionHtml}
        ${totalSalesSectionHtml}
        <div style="margin-top: 15px; text-align: center; color: #666; font-size: 9px; border-top: 1px solid #e5e7eb; padding-top: 8px;">
          <div>Generated on ${new Date().toLocaleString()}</div>
          <div style="font-weight: bold; color: #000; font-size: 10px; margin-top: 5px;">${escapeHtml(salesReportPhoneLine)}</div>
        </div>
      </div>
    `;

    const container = document.createElement('div');
    container.innerHTML = content;
    document.body.appendChild(container);

    html2pdf()
      .set(getPdfExportOptions(`${filename}.pdf`, "portrait", ['css', 'legacy']) as any)
      .from(container)
      .save()
      .then(() => {
        document.body.removeChild(container);
      });
  };

  const exportCurrentOrdersToExcel = async () => {
    const { filename } = getCurrentData();
    const orderData = getCurrentOrderData();

    let periodLabel = '';
    if (activeTab === 'daily') {
      const dateObj = parseLocalDate(selectedDate);
      periodLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } else if (activeTab === 'monthly') {
      periodLabel = formatMonth(selectedMonth);
    } else if (activeTab === 'yearly') {
      periodLabel = `Year ${selectedYear}`;
    } else if (activeTab === 'range') {
      periodLabel = formatDateRange();
    }

    const formatDateTime = (dateStr: string) => {
      const d = new Date(dateStr);
      return d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    };

    const orders = orderData.currentDateOrders;
    const rows = orders.map((order, index) => {
      const client = getClientById(order.clientId);
      const amounts = getOrderBillAmounts(order);
      const customerName = getOrderCustomerName(order, client);
      const customerAddress = getOrderCustomerAddress(order, client);
      const customerPhone = getOrderCustomerPhone(order, client);
      const phone = customerPhone;
      const orderRef = `#${order.orderNumber || order.id}`;
      const typeLabel = order.deliveryType === 'delivery' ? 'D' : 'T';
	      const priority = order.urgent ? 'Urgent' : 'Normal';
	      const billAmt = `AED ${amounts.originalAmount.toFixed(2)}`;
	      const delivery = amounts.deliveryCharge > 0.009 ? `AED ${amounts.deliveryCharge.toFixed(2)}` : '';
	      const disc = amounts.discount > 0 ? `AED ${amounts.discount.toFixed(2)}` : '';
	      const finalAmt = `AED ${amounts.finalAmount.toFixed(2)}`;
	      const createdDate = order.entryDate ? formatDateTime(String(order.entryDate)) : '-';
	      const statusLabel = order.delivered ? 'Delivered' : order.packingDone ? 'Ready' : order.washingDone ? 'Washed' : order.tagDone ? 'Tagged' : 'Entry';
	      return [index + 1, buildExcelClientCell(customerName, customerAddress, customerPhone), phone, orderRef, typeLabel, priority, billAmt, delivery, disc, finalAmt, createdDate, statusLabel];
	    });

	    const totalBill = orders.reduce((sum, o) => sum + getOrderBillAmounts(o).originalAmount, 0);
	    const totalDeliveryCharge = orders.reduce((sum, o) => sum + getOrderBillAmounts(o).deliveryCharge, 0);
	    const totalDisc = orders.reduce((sum, o) => sum + getOrderBillAmounts(o).discount, 0);
	    const totalFinal = orders.reduce((sum, o) => sum + getOrderBillAmounts(o).finalAmount, 0);
    const currentSummary = getOrderSectionSummary(orders);

	    const headers: ExcelExportCell[] = ['#', 'Client', 'Phone', 'Order', 'Type', 'Priority', 'Bill Amt', 'Delivery Charge', 'Discount', 'Final Amt', 'Created', 'Status'];

    const summaryData: ExcelExportCell[][] = [
      [salesReportCompanyName],
      [salesReportHeaderAddress],
      ['Current Period Orders'],
      [`DATE: ${periodLabel}`],
      [],
      [`Current Period Orders (${orders.length}) - AED ${totalFinal.toFixed(2)} | Urgent: ${currentSummary.urgentCount} | Normal: ${currentSummary.normalCount} | Paid: ${currentSummary.paidAmount.toFixed(2)} AED | Unpaid: ${currentSummary.unpaidAmount.toFixed(2)} AED`],
      headers,
      ...rows,
      [],
	      ['', '', '', '', '', 'Total:', `AED ${totalBill.toFixed(2)}`, totalDeliveryCharge > 0 ? `AED ${totalDeliveryCharge.toFixed(2)}` : '', totalDisc > 0 ? `AED ${totalDisc.toFixed(2)}` : '', `AED ${totalFinal.toFixed(2)}`, '', ''],
    ];

    const typeCellStyles: CellStyle[] = [];
    const headerRows: number[] = [];
    const styleHeaderRow = (row: number, colCount: number) => {
      headerRows.push(row);
      for (let col = 1; col <= colCount; col++) {
        typeCellStyles.push({
          row,
          col,
          fill: { color: 'FF1E40AF' },
          font: { color: 'FFFFFFFF', bold: true },
          alignment: { wrapText: true, vertical: 'middle', horizontal: 'center' },
        });
      }
    };
    const styleBodyRow = (row: number, colCount: number) => {
      for (let col = 1; col <= colCount; col++) {
        typeCellStyles.push({
          row,
          col,
          alignment: { wrapText: true, vertical: 'middle' },
        });
      }
    };
    const dataStartRow = 8;
    styleHeaderRow(7, headers.length);
    rows.forEach((_row, i) => {
      const excelRow = dataStartRow + i;
      styleBodyRow(excelRow, headers.length);
      const priority = orders[i].urgent;
      if (priority) {
        typeCellStyles.push({ row: excelRow, col: 6, fill: { color: 'FFFDE8D0' } });
      } else {
        typeCellStyles.push({ row: excelRow, col: 6, fill: { color: 'FFD5F5E3' } });
      }
    });

    await writeExcel({
      data: summaryData,
      sheetName: "Current Period Orders",
      fileName: `Current_Period_Orders_${filename}.xlsx`,
      columns: [
        { wch: 4 },
        { wch: 34 },
        { wch: 15 },
        { wch: 16 },
        { wch: 8 },
        { wch: 10 },
	        { wch: 16 },
	        { wch: 14 },
	        { wch: 16 },
	        { wch: 16 },
	        { wch: 22 },
        { wch: 12 },
      ],
      cellStyles: typeCellStyles,
      rowHeights: headerRows.map((row) => ({ row, height: 26 })),
    });
  };

  const exportCurrentOrdersToPDF = async () => {
    const { filename } = getCurrentData();
    const orderData = getCurrentOrderData();
    const html2pdf = (await import('html2pdf.js')).default;

    let periodLabel = '';
    if (activeTab === 'daily') {
      const dateObj = parseLocalDate(selectedDate);
      periodLabel = `DATE: ${dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
    } else if (activeTab === 'monthly') {
      periodLabel = `DATE: ${formatMonth(selectedMonth)}`;
    } else if (activeTab === 'yearly') {
      periodLabel = `DATE: Year ${selectedYear}`;
    } else if (activeTab === 'range') {
      periodLabel = `DATE: ${formatDateRange()}`;
    }

	    const orders = orderData.currentDateOrders;
	    const totalBill = orders.reduce((sum, o) => sum + getOrderBillAmounts(o).originalAmount, 0);
	    const totalDeliveryCharge = orders.reduce((sum, o) => sum + getOrderBillAmounts(o).deliveryCharge, 0);
	    const totalDisc = orders.reduce((sum, o) => sum + getOrderBillAmounts(o).discount, 0);
	    const totalFinal = orders.reduce((sum, o) => sum + getOrderBillAmounts(o).finalAmount, 0);
    const currentSummary = getOrderSectionSummary(orders);
    const printablePageHeightMm = 279;
    const tableHeaderHeightMm = 6;
    const tableRowHeightMm = 6.6;
    const totalRowHeightMm = 6;
    const tableFontSizePx = 5.8;
    const pageSummary = `Current Period Orders (${orders.length}) - AED ${totalFinal.toFixed(2)} | <span style="color:#dc2626;">Urgent: ${currentSummary.urgentCount}</span> | <span style="color:#16a34a;">Normal: ${currentSummary.normalCount}</span> | <span style="color:#059669;">Paid: ${currentSummary.paidAmount.toFixed(2)} AED</span> | <span style="color:#dc2626;">Unpaid: ${currentSummary.unpaidAmount.toFixed(2)} AED</span>`;
    const generatedAt = new Date().toLocaleString();

    const tableHeader = `
      <thead>
        <tr style="background:#f3f4f6;height:${tableHeaderHeightMm}mm;">
	          <th style="padding:2px 2px;text-align:center;border:1px solid #e5e7eb;width:3%;line-height:1.1;white-space:nowrap;">#</th>
	          <th style="padding:2px 2px;text-align:left;border:1px solid #e5e7eb;width:20%;line-height:1.1;white-space:nowrap;">Client</th>
	          <th style="padding:2px 2px;text-align:left;border:1px solid #e5e7eb;width:8%;line-height:1.1;white-space:nowrap;">Order</th>
	          <th style="padding:2px 2px;text-align:center;border:1px solid #e5e7eb;width:4%;line-height:1.1;white-space:nowrap;">Type</th>
	          <th style="padding:2px 2px;text-align:center;border:1px solid #e5e7eb;width:7%;line-height:1.1;white-space:nowrap;">Priority</th>
	          <th style="padding:2px 2px;text-align:right;border:1px solid #e5e7eb;width:10%;line-height:1.1;white-space:nowrap;">Bill Amt</th>
	          <th style="padding:2px 2px;text-align:right;border:1px solid #e5e7eb;width:9%;line-height:1.1;white-space:nowrap;">Delivery</th>
	          <th style="padding:2px 2px;text-align:right;border:1px solid #e5e7eb;width:8%;line-height:1.1;white-space:nowrap;">Discount</th>
	          <th style="padding:2px 2px;text-align:right;border:1px solid #e5e7eb;width:10%;line-height:1.1;white-space:nowrap;">Final Amt</th>
	          <th style="padding:2px 2px;text-align:center;border:1px solid #e5e7eb;width:13%;line-height:1.1;white-space:nowrap;">Created</th>
	          <th style="padding:2px 2px;text-align:center;border:1px solid #e5e7eb;width:8%;line-height:1.1;white-space:nowrap;">Status</th>
        </tr>
      </thead>`;

    const renderOrderRow = (order: Order, rowNumber: number) => {
      const client = getClientById(order.clientId);
      const amounts = getOrderBillAmounts(order);
      const customerName = getOrderCustomerName(order, client);
      const customerAddress = getOrderCustomerAddress(order, client);
      const customerPhone = getOrderCustomerPhone(order, client);
      const orderRef = `#${order.orderNumber || order.id}`;
	      const typeLabel = order.deliveryType === 'delivery' ? 'D' : 'T';
	      const billAmt = `AED ${amounts.originalAmount.toFixed(2)}`;
	      const delivery = amounts.deliveryCharge > 0.009 ? `AED ${amounts.deliveryCharge.toFixed(2)}` : '-';
	      const disc = amounts.discount > 0 ? `AED ${amounts.discount.toFixed(2)}` : '-';
	      const finalAmt = `AED ${amounts.finalAmount.toFixed(2)}`;
      const createdDate = order.entryDate ? new Date(order.entryDate).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '-';
      const statusLabel = order.delivered ? 'Delivered' : order.packingDone ? 'Ready' : order.washingDone ? 'Washed' : order.tagDone ? 'Tagged' : 'Entry';
      const statusColor = order.delivered ? '#16a34a' : order.packingDone ? '#2563eb' : order.washingDone ? '#9333ea' : order.tagDone ? '#ea580c' : '#666';
      return `
        <tr class="${order.urgent ? "sales-pdf-urgent-row" : ""}" data-current-order-row="true" style="page-break-inside:avoid;break-inside:avoid;height:${tableRowHeightMm}mm;">
          <td style="padding:2px 2px;text-align:center;border:1px solid #e5e7eb;color:#666;line-height:1.15;height:${tableRowHeightMm}mm;white-space:nowrap;vertical-align:top;">${rowNumber}</td>
          <td style="padding:1px 2px;border:1px solid #e5e7eb;line-height:1.08;min-height:${tableRowHeightMm}mm;vertical-align:top;font-size:${tableFontSizePx}px;word-wrap:break-word;">${buildPdfClientCell(customerName, customerAddress, customerPhone, true)}</td>
          <td style="padding:2px 2px;border:1px solid #e5e7eb;line-height:1.15;height:${tableRowHeightMm}mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:top;">${orderRef}</td>
          <td style="padding:2px 2px;text-align:center;border:1px solid #e5e7eb;line-height:1.15;height:${tableRowHeightMm}mm;white-space:nowrap;vertical-align:top;">${typeLabel}</td>
	          <td style="padding:2px 2px;text-align:center;border:1px solid #e5e7eb;color:${order.urgent ? '#dc2626' : '#16a34a'};font-weight:bold;line-height:1.15;height:${tableRowHeightMm}mm;white-space:nowrap;vertical-align:top;">${order.urgent ? 'Urgent' : 'Normal'}</td>
	          <td style="padding:2px 2px;text-align:right;border:1px solid #e5e7eb;color:#666;white-space:nowrap;line-height:1.15;height:${tableRowHeightMm}mm;vertical-align:top;">${billAmt}</td>
	          <td style="padding:2px 2px;text-align:right;border:1px solid #e5e7eb;color:${amounts.deliveryCharge > 0.009 ? '#2563eb' : '#999'};white-space:nowrap;line-height:1.15;height:${tableRowHeightMm}mm;vertical-align:top;">${delivery}</td>
	          <td style="padding:2px 2px;text-align:right;border:1px solid #e5e7eb;color:${amounts.discount > 0 ? '#ea580c' : '#999'};white-space:nowrap;line-height:1.15;height:${tableRowHeightMm}mm;vertical-align:top;">${disc}</td>
          <td style="padding:2px 2px;text-align:right;border:1px solid #e5e7eb;color:#2563eb;font-weight:bold;white-space:nowrap;line-height:1.15;height:${tableRowHeightMm}mm;vertical-align:top;">${finalAmt}</td>
          <td style="padding:2px 2px;text-align:center;border:1px solid #e5e7eb;color:#666;line-height:1.15;height:${tableRowHeightMm}mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:top;">${createdDate}</td>
          <td style="padding:2px 2px;text-align:center;border:1px solid #e5e7eb;color:${statusColor};font-weight:bold;line-height:1.15;height:${tableRowHeightMm}mm;white-space:nowrap;vertical-align:top;">${statusLabel}</td>
        </tr>`;
    };

    const tableStyle = `width:100%;border-collapse:collapse;font-size:${tableFontSizePx}px;table-layout:fixed;`;
    const reportFooterHtml = `
      <div style="text-align:center;color:#666;font-size:8px;border-top:1px solid #e5e7eb;padding-top:6px;">
        <div>Generated on ${generatedAt}</div>
        <div style="font-weight:bold;color:#000;font-size:9px;margin-top:4px;">${escapeHtml(salesReportPhoneLine)}</div>
      </div>
    `;
    const pageSummaryHtml = `
      <div style="color:#2563eb;font-weight:bold;font-size:9px;border-bottom:1px solid #e5e7eb;padding-bottom:3px;margin-bottom:4px;">
        ${pageSummary}
      </div>
    `;
    const renderReportHeaderHtml = (pageIndex: number, totalPages: number) => `
      <div style="text-align:center;border-bottom:2px solid #1e40af;padding-bottom:7px;margin-bottom:6px;">
        <div style="font-size:16px;font-weight:bold;color:#1e40af;margin:0;">${escapeHtml(salesReportCompanyName)}</div>
        <div style="color:#666;margin:3px 0;font-size:9px;">${escapeHtml(salesReportHeaderAddress)}</div>
        <div style="font-size:13px;font-weight:bold;margin:6px 0 3px;">Current Period Orders</div>
        <div style="color:#666;font-size:10px;">${periodLabel}</div>
        <div style="color:#666;font-size:9px;margin-top:4px;">Page ${pageIndex + 1} of ${totalPages}</div>
      </div>
    `;
    const totalRowHtml = `
      <tr style="background:#f3f4f6;font-weight:bold;height:${totalRowHeightMm}mm;">
	        <td colspan="5" style="padding:2px 2px;border:1px solid #e5e7eb;text-align:right;height:${totalRowHeightMm}mm;white-space:nowrap;">Total:</td>
	        <td style="padding:2px 2px;text-align:right;border:1px solid #e5e7eb;color:#666;white-space:nowrap;height:${totalRowHeightMm}mm;">AED ${totalBill.toFixed(2)}</td>
	        <td style="padding:2px 2px;text-align:right;border:1px solid #e5e7eb;color:#2563eb;white-space:nowrap;height:${totalRowHeightMm}mm;">${totalDeliveryCharge > 0 ? 'AED ' + totalDeliveryCharge.toFixed(2) : ''}</td>
	        <td style="padding:2px 2px;text-align:right;border:1px solid #e5e7eb;color:#ea580c;white-space:nowrap;height:${totalRowHeightMm}mm;">${totalDisc > 0 ? 'AED ' + totalDisc.toFixed(2) : ''}</td>
	        <td style="padding:2px 2px;text-align:right;border:1px solid #e5e7eb;color:#2563eb;white-space:nowrap;height:${totalRowHeightMm}mm;">AED ${totalFinal.toFixed(2)}</td>
        <td colspan="2" style="padding:2px 2px;border:1px solid #e5e7eb;height:${totalRowHeightMm}mm;"></td>
      </tr>
    `;

    type CurrentOrderPdfRow = { html: string };
    const orderRows: CurrentOrderPdfRow[] = orders.map((order, index) => ({
      html: renderOrderRow(order, index + 1),
    }));

    const paginateCurrentOrderRows = () => {
      if (orderRows.length === 0) return [[]] as CurrentOrderPdfRow[][];
      if (typeof document === "undefined") {
        return [orderRows];
      }

      const measurementHost = document.createElement("div");
      measurementHost.style.cssText = [
        "position:absolute",
        "left:-10000px",
        "top:0",
        "width:194mm",
        "box-sizing:border-box",
        "font-family:Arial,sans-serif",
        "color:#333",
        "font-size:8px",
        "background:#fff",
        "visibility:hidden",
        "pointer-events:none",
      ].join(";");
      document.body.appendChild(measurementHost);

      try {
        const pageHeightProbe = document.createElement("div");
        pageHeightProbe.style.height = `${printablePageHeightMm}mm`;
        measurementHost.appendChild(pageHeightProbe);
        const pageHeightPx = pageHeightProbe.getBoundingClientRect().height;

        const measureReservedHeight = (withReportHeader: boolean, includeClosingBlock: boolean) => {
          const probe = document.createElement("section");
          probe.style.cssText = "padding:8px 10px;box-sizing:border-box;width:194mm;font-family:Arial,sans-serif;color:#333;font-size:8px;";
          probe.innerHTML = `
            ${withReportHeader ? renderReportHeaderHtml(0, 1) : ""}
            ${withReportHeader ? pageSummaryHtml : ""}
            <table style="${tableStyle}">
              ${tableHeader}
              <tbody>${includeClosingBlock ? totalRowHtml : ""}</tbody>
            </table>
            ${includeClosingBlock ? reportFooterHtml : ""}
          `;
          measurementHost.appendChild(probe);
          const heightPx = probe.getBoundingClientRect().height;
          probe.remove();
          return heightPx;
        };

        const rowTable = document.createElement("table");
        rowTable.style.cssText = tableStyle;
        rowTable.innerHTML = `${tableHeader}<tbody>${orderRows.map((row) => row.html).join("")}</tbody>`;
        measurementHost.appendChild(rowTable);
        const rowHeightsPx = Array.from(rowTable.querySelectorAll('[data-current-order-row="true"]')).map(
          (row) => row.getBoundingClientRect().height,
        );
        const fallbackRowHeightPx = rowHeightsPx[0] || 1;
        rowTable.remove();

        const safeBufferPx = 10;
        const firstPageOpenLimitPx = Math.max(
          fallbackRowHeightPx,
          pageHeightPx - measureReservedHeight(true, false) - safeBufferPx,
        );
        const firstPageFinalLimitPx = Math.max(
          fallbackRowHeightPx,
          pageHeightPx - measureReservedHeight(true, true) - safeBufferPx,
        );
        const continuationPageOpenLimitPx = Math.max(
          fallbackRowHeightPx,
          pageHeightPx - measureReservedHeight(false, false) - safeBufferPx,
        );
        const continuationPageFinalLimitPx = Math.max(
          fallbackRowHeightPx,
          pageHeightPx - measureReservedHeight(false, true) - safeBufferPx,
        );

        const pages: CurrentOrderPdfRow[][] = [];
        let currentPage: CurrentOrderPdfRow[] = [];
        let currentHeightPx = 0;

        orderRows.forEach((row, index) => {
          const isFinalRow = index === orderRows.length - 1;
          const isFirstPage = pages.length === 0;
          const currentPageLimitPx = isFirstPage
            ? isFinalRow ? firstPageFinalLimitPx : firstPageOpenLimitPx
            : isFinalRow ? continuationPageFinalLimitPx : continuationPageOpenLimitPx;
          const rowHeightPx = Math.ceil((rowHeightsPx[index] || fallbackRowHeightPx) + 1);
          const shouldStartNextPage =
            currentPage.length > 0 &&
            currentHeightPx + rowHeightPx > currentPageLimitPx;

          if (shouldStartNextPage) {
            pages.push(currentPage);
            currentPage = [row];
            currentHeightPx = rowHeightPx;
            return;
          }

          currentPage.push(row);
          currentHeightPx += rowHeightPx;
        });

        if (currentPage.length > 0) pages.push(currentPage);
        return pages.length > 0 ? pages : ([[]] as CurrentOrderPdfRow[][]);
      } finally {
        measurementHost.remove();
      }
    };

    const orderPages = paginateCurrentOrderRows();

    const content = `
      <div class="sales-pdf-report" style="font-family:Arial,sans-serif;color:#333;font-size:8px;">
        ${renderSalesPdfPrintColorStyle()}
        ${orderPages.map((pageOrders, pageIndex) => `
          <section style="padding:8px 10px; box-sizing:border-box; height:${printablePageHeightMm}mm; overflow:hidden; display:flex; flex-direction:column; page-break-inside:avoid; page-break-after:${pageIndex === orderPages.length - 1 ? 'auto' : 'always'};">
            <div style="flex:1; display:flex; flex-direction:column;">
              ${pageIndex === 0 ? renderReportHeaderHtml(pageIndex, orderPages.length) : ''}

              ${pageIndex === 0 ? pageSummaryHtml : ''}

              <table style="${tableStyle}">
                ${tableHeader}
                <tbody>
                  ${pageOrders.map((row) => row.html).join('')}
                  ${pageIndex === orderPages.length - 1 ? totalRowHtml : ''}
                </tbody>
              </table>
            </div>

            ${pageIndex === orderPages.length - 1 ? reportFooterHtml : ''}
          </section>
        `).join('')}
      </div>
    `;

    const container = document.createElement('div');
    container.innerHTML = content;
    document.body.appendChild(container);

    html2pdf()
      .set(getPdfExportOptions(`Current_Period_Orders_${filename}.pdf`, "portrait", ['css', 'legacy']) as any)
      .from(container)
      .save()
      .then(() => {
        document.body.removeChild(container);
      });
  };

  const exportOldPaidBillsToExcel = async () => {
    const { filename } = getCurrentData();
    const entries = getOldPaidPaymentEntriesForPeriod();
    const periodLabel = getReportPeriodExportLabel();
    const headers: ExcelExportCell[] = [
      '#',
      'Order #',
      'Client',
      'Phone',
	      'Priority',
	      'Work Rec. (AED)',
	      'Delivery Charge (AED)',
	      'Discount (AED)',
	      'Final Amount (AED)',
      'Created',
      'Paid Amount (AED)',
      'Payment Method',
      'Paid On',
      'Payment Status',
      'Order Status',
    ];

    const rows: ExcelExportCell[][] = entries.map((entry, index) => {
      const { order, payment, bill, client } = entry;
      const amounts = getOrderBillAmounts(order);
      const paymentStatus = getSalesPaymentStatusMeta(payment, bill);
      const workflowStatus = getOrderStatus(order);
      const paymentAmount = parseFloat(String(payment?.amount || "0"));
      const paidDateSource = payment?.paymentDate || payment?.date;
      const partialDateLabel = getSalesPaymentPartialDateLabel(paymentStatus, formatSalesReportPdfDateTime);
      const paidDateLabel = paidDateSource
        ? partialDateLabel
          ? getSalesPaymentPaidDateLabel(paidDateSource, formatSalesReportPdfDateTime)
          : formatSalesReportPdfDateTime(paidDateSource)
        : "-";
      const customerName = getOrderCustomerName(order, client || undefined);
      const customerAddress = getOrderCustomerAddress(order, client || undefined);
      const customerPhone = getOrderCustomerPhone(order, client || undefined);

      return [
        index + 1,
        order.orderNumber || order.id,
        buildExcelClientCell(customerName, customerAddress, customerPhone),
        customerPhone,
	        order.urgent ? "Urgent" : "Normal",
	        `AED ${amounts.originalAmount.toFixed(2)}`,
	        amounts.deliveryCharge > 0.009 ? `AED ${amounts.deliveryCharge.toFixed(2)}` : "",
	        amounts.discount > 0 ? `AED ${amounts.discount.toFixed(2)}` : "",
        `AED ${amounts.finalAmount.toFixed(2)}`,
        order.entryDate ? formatSalesReportPdfDateTime(order.entryDate) : "-",
        Number.isFinite(paymentAmount) ? `AED ${paymentAmount.toFixed(2)}` : "-",
        formatSalesPaymentMethodLabel(payment?.paymentMethod),
        [partialDateLabel, paidDateLabel !== "-" ? paidDateLabel : null].filter(Boolean).join(" | ") || "-",
        getSalesPaymentStatusExportLabel(paymentStatus),
        workflowStatus.label,
      ];
    });

    const totalPaid = entries.reduce((sum, entry) => {
      const paymentAmount = parseFloat(String(entry.payment?.amount || "0"));
      return Number.isFinite(paymentAmount) ? sum + paymentAmount : sum;
    }, 0);
    const cellStyles: CellStyle[] = [];
    const headerRows: number[] = [];
    const styleHeaderRow = (row: number, colCount: number) => {
      headerRows.push(row);
      for (let col = 1; col <= colCount; col++) {
        cellStyles.push({
          row,
          col,
          fill: { color: 'FF1E40AF' },
          font: { color: 'FFFFFFFF', bold: true },
          alignment: { wrapText: true, vertical: 'middle', horizontal: 'center' },
        });
      }
    };
    const styleBodyRow = (row: number, colCount: number) => {
      for (let col = 1; col <= colCount; col++) {
        cellStyles.push({
          row,
          col,
          alignment: { wrapText: true, vertical: 'middle' },
        });
      }
    };

    styleHeaderRow(7, headers.length);
    rows.forEach((_row, index) => {
      const excelRow = 8 + index;
      styleBodyRow(excelRow, headers.length);
      cellStyles.push({
        row: excelRow,
        col: 5,
        fill: { color: entries[index]?.order?.urgent ? 'FFFDE8D0' : 'FFD5F5E3' },
      });
    });

    await writeExcel({
      data: [
        [salesReportCompanyName],
        [salesReportHeaderAddress],
        ['Old Bill Payments in This Period'],
        [`DATE: ${periodLabel}`],
        [],
        [`Old Bill Payments in This Period (${entries.length}) - Total Paid: ${totalPaid.toFixed(2)} AED`],
        headers,
        ...rows,
        [],
	        ['', '', '', '', '', '', '', '', '', 'Total Paid:', `AED ${totalPaid.toFixed(2)}`, '', '', '', ''],
      ],
      sheetName: "Old Bill Payments",
      fileName: `Old_Bill_Payments_${filename}.xlsx`,
      columns: [
        { wch: 4 },
        { wch: 16 },
        { wch: 34 },
        { wch: 15 },
	        { wch: 10 },
	        { wch: 14 },
	        { wch: 16 },
	        { wch: 14 },
        { wch: 16 },
        { wch: 22 },
        { wch: 16 },
        { wch: 18 },
        { wch: 32 },
        { wch: 18 },
        { wch: 14 },
      ],
      cellStyles,
      rowHeights: headerRows.map((row) => ({ row, height: 26 })),
    });
  };

  const exportOldPaidBillsToPDF = async () => {
    const { filename } = getCurrentData();
    const entries = getOldPaidPaymentEntriesForPeriod();
    const html2pdf = (await import('html2pdf.js')).default;
    const periodLabel = `DATE: ${getReportPeriodExportLabel()}`;
    const totalPaid = entries.reduce((sum, entry) => {
      const paymentAmount = parseFloat(String(entry.payment?.amount || "0"));
      return Number.isFinite(paymentAmount) ? sum + paymentAmount : sum;
    }, 0);

    const rowsHtml = entries.map((entry, index) => {
      const { order, payment, bill, client } = entry;
      const amounts = getOrderBillAmounts(order);
      const paymentStatus = getSalesPaymentStatusMeta(payment, bill);
      const workflowStatus = getOrderStatus(order);
      const paymentAmount = parseFloat(String(payment?.amount || "0"));
      const paidDateSource = payment?.paymentDate || payment?.date;
      const partialDateLabel = getSalesPaymentPartialDateLabel(paymentStatus, formatSalesReportPdfDateTime);
      const paidDateLabel = paidDateSource
        ? partialDateLabel
          ? getSalesPaymentPaidDateLabel(paidDateSource, formatSalesReportPdfDateTime)
          : formatSalesReportPdfDateTime(paidDateSource)
        : "No payment date";
      const customerName = getOrderCustomerName(order, client || undefined);
      const customerAddress = getOrderCustomerAddress(order, client || undefined);
      const customerPhone = getOrderCustomerPhone(order, client || undefined);

      return `
        <tr class="${order.urgent ? "sales-pdf-urgent-row" : ""}" style="page-break-inside: avoid;">
          <td style="padding:3px 2px;text-align:center;border:1px solid #e5e7eb;color:#666;">${index + 1}</td>
          <td style="padding:3px 2px;border:1px solid #e5e7eb;font-weight:700;">#${escapeHtml(String(order.orderNumber || order.id))}</td>
	          <td style="padding:3px 2px;border:1px solid #e5e7eb;overflow-wrap:anywhere;">${buildPdfClientCell(customerName, customerAddress, customerPhone)}</td>
	          <td style="padding:3px 2px;text-align:center;border:1px solid #e5e7eb;color:${order.urgent ? "#dc2626" : "#16a34a"};font-weight:700;">${order.urgent ? "Urgent" : "Normal"}</td>
	          <td style="padding:3px 2px;text-align:right;border:1px solid #e5e7eb;color:#6b7280;">${amounts.originalAmount.toFixed(2)}</td>
	          <td style="padding:3px 2px;text-align:right;border:1px solid #e5e7eb;color:${amounts.deliveryCharge > 0.009 ? "#2563eb" : "#9ca3af"};">${amounts.deliveryCharge > 0.009 ? amounts.deliveryCharge.toFixed(2) : "-"}</td>
	          <td style="padding:3px 2px;text-align:right;border:1px solid #e5e7eb;color:${amounts.discount > 0 ? "#ea580c" : "#9ca3af"};">${amounts.discount > 0 ? `-${amounts.discount.toFixed(2)}` : "-"}</td>
          <td style="padding:3px 2px;text-align:right;border:1px solid #e5e7eb;color:#2563eb;font-weight:700;">${amounts.finalAmount.toFixed(2)}</td>
          <td style="padding:3px 2px;text-align:right;border:1px solid #e5e7eb;color:#059669;font-weight:700;">${Number.isFinite(paymentAmount) ? paymentAmount.toFixed(2) : "-"}</td>
          <td style="padding:3px 2px;text-align:center;border:1px solid #e5e7eb;color:#6b7280;">${escapeHtml(formatSalesPaymentMethodLabel(payment?.paymentMethod))}</td>
          <td style="padding:3px 2px;text-align:center;border:1px solid #e5e7eb;color:#111827;">
            <div style="font-weight:700;">${escapeHtml(getSalesPaymentStatusExportLabel(paymentStatus))}</div>
            ${partialDateLabel ? `<div style="margin-top:2px;color:#b45309;font-size:6px;font-weight:700;">${escapeHtml(partialDateLabel)}</div>` : ""}
            <div style="margin-top:2px;color:#6b7280;font-size:6px;">${escapeHtml(paidDateLabel || "No payment date")}</div>
            <div style="margin-top:2px;color:#6b7280;font-size:6px;">Order: ${escapeHtml(workflowStatus.label)}</div>
          </td>
        </tr>
      `;
    }).join("");

    const content = `
      <div class="sales-pdf-report" style="font-family:Arial,sans-serif;color:#333;font-size:7px;padding:10px;">
        ${renderSalesPdfPrintColorStyle()}
        <div style="text-align:center;border-bottom:2px solid #16a34a;padding-bottom:8px;margin-bottom:8px;">
          <div style="font-size:16px;font-weight:bold;color:#1e40af;">${escapeHtml(salesReportCompanyName)}</div>
          <div style="color:#666;margin:3px 0;font-size:9px;">${escapeHtml(salesReportHeaderAddress)}</div>
          <div style="font-size:13px;font-weight:bold;margin:6px 0 3px;">Old Bill Payments in This Period</div>
          <div style="color:#666;font-size:10px;">${escapeHtml(periodLabel)}</div>
        </div>
        <div style="color:#16a34a;font-weight:bold;font-size:10px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-bottom:5px;">
          Old Bill Payments in This Period (${entries.length}) - Total Paid: ${totalPaid.toFixed(2)} AED
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:6.6px;table-layout:fixed;">
          <thead>
            <tr style="background:#f3f4f6;">
	              <th style="padding:3px 2px;border:1px solid #e5e7eb;width:4%;">#</th>
	              <th style="padding:3px 2px;border:1px solid #e5e7eb;width:8%;">Order</th>
	              <th style="padding:3px 2px;border:1px solid #e5e7eb;width:21%;">Client</th>
	              <th style="padding:3px 2px;border:1px solid #e5e7eb;width:7%;">Priority</th>
	              <th style="padding:3px 2px;border:1px solid #e5e7eb;width:8%;">Work Rec.</th>
	              <th style="padding:3px 2px;border:1px solid #e5e7eb;width:8%;">Delivery</th>
	              <th style="padding:3px 2px;border:1px solid #e5e7eb;width:7%;">Discount</th>
	              <th style="padding:3px 2px;border:1px solid #e5e7eb;width:8%;">Final</th>
	              <th style="padding:3px 2px;border:1px solid #e5e7eb;width:8%;">Paid</th>
	              <th style="padding:3px 2px;border:1px solid #e5e7eb;width:8%;">Method</th>
	              <th style="padding:3px 2px;border:1px solid #e5e7eb;width:13%;">Status</th>
            </tr>
          </thead>
          <tbody>
	            ${rowsHtml || `<tr><td colspan="11" style="padding:16px;text-align:center;border:1px solid #e5e7eb;color:#6b7280;">No old bill payments found for this period.</td></tr>`}
	            <tr style="background:#f3f4f6;font-weight:bold;">
	              <td colspan="8" style="padding:4px 3px;border:1px solid #e5e7eb;text-align:right;">Total Paid:</td>
	              <td style="padding:4px 3px;text-align:right;border:1px solid #e5e7eb;color:#059669;">${totalPaid.toFixed(2)}</td>
	              <td colspan="2" style="padding:4px 3px;border:1px solid #e5e7eb;"></td>
            </tr>
          </tbody>
        </table>
        <div style="margin-top:15px;text-align:center;color:#666;font-size:8px;border-top:1px solid #e5e7eb;padding-top:6px;">
          <div>Generated on ${new Date().toLocaleString()}</div>
          <div style="font-weight:bold;color:#000;font-size:9px;margin-top:4px;">${escapeHtml(salesReportPhoneLine)}</div>
        </div>
      </div>
    `;

    const container = document.createElement('div');
    container.innerHTML = content;
    document.body.appendChild(container);

    html2pdf()
      .set(getPdfExportOptions(`Old_Bill_Payments_${filename}.pdf`, "portrait", ['css', 'legacy']) as any)
      .from(container)
      .save()
      .then(() => {
        document.body.removeChild(container);
      });
  };

  const exportTotalSalesToExcel = async () => {
    const { data, filename } = getCurrentData();
    const periodLabel = getReportPeriodExportLabel();
    const payments = data.deposits || [];
    const totalPaid = payments.reduce((sum: number, payment: any) => sum + parseFloat(String(payment.amount || "0")), 0);
    const headers: ExcelExportCell[] = ['#', 'Client', 'Phone', 'Description', 'Bill', 'Payment Method', 'Paid On', 'Payment Status', 'Amount Paid (AED)'];
    const rows: ExcelExportCell[][] = payments.map((payment: any, index: number) => {
      const bill = getBillById(payment.billId) || null;
      const client = getSalesPaymentClient(payment, bill);
      const paymentStatus = getSalesPaymentStatusMeta(payment, bill);
      const partialDateLabel = getSalesPaymentPartialDateLabel(paymentStatus, formatSalesReportPdfDateTime);
      const paidDateLabel = payment.date
        ? partialDateLabel
          ? getSalesPaymentPaidDateLabel(payment.date, formatSalesReportPdfDateTime)
          : formatSalesReportPdfDateTime(payment.date)
        : "-";
      const paymentAmount = parseFloat(String(payment.amount || "0"));

      return [
        index + 1,
        buildExcelClientCell(
          payment.clientName || client?.name || 'Unknown',
          getPaymentCustomerAddress(payment, client),
          getPaymentCustomerPhone(payment, client),
        ),
        getPaymentCustomerPhone(payment, client),
        payment.orderSummary || payment.description || "-",
        payment.billId ? `#${payment.billDisplayNumber || payment.billId}` : "-",
        getPaymentBreakdownInline(payment),
        [partialDateLabel, paidDateLabel !== "-" ? paidDateLabel : null].filter(Boolean).join(" | ") || "-",
        getSalesPaymentStatusExportLabel(paymentStatus),
        Number.isFinite(paymentAmount) ? `AED ${paymentAmount.toFixed(2)}` : "-",
      ];
    });
    const paymentBreakdownRows = getSalesPaymentBreakdown(data.rawDeposits || payments);
    const cellStyles: CellStyle[] = [];
    const headerRows: number[] = [];
    const styleHeaderRow = (row: number, colCount: number) => {
      headerRows.push(row);
      for (let col = 1; col <= colCount; col++) {
        cellStyles.push({
          row,
          col,
          fill: { color: 'FF1E40AF' },
          font: { color: 'FFFFFFFF', bold: true },
          alignment: { wrapText: true, vertical: 'middle', horizontal: 'center' },
        });
      }
    };
    const styleBodyRow = (row: number, colCount: number) => {
      for (let col = 1; col <= colCount; col++) {
        cellStyles.push({
          row,
          col,
          alignment: { wrapText: true, vertical: 'middle' },
        });
      }
    };
    const paymentHeaderRow = 7;
    const paymentDataStartRow = paymentHeaderRow + 1;
    const paymentBreakdownHeaderRow = payments.length + 12;

    styleHeaderRow(paymentHeaderRow, headers.length);
    rows.forEach((_row, index) => styleBodyRow(paymentDataStartRow + index, headers.length));
    styleHeaderRow(paymentBreakdownHeaderRow, 3);
    paymentBreakdownRows.forEach((_row, index) => styleBodyRow(paymentBreakdownHeaderRow + 1 + index, 3));

    await writeExcel({
      data: [
        [salesReportCompanyName],
        [salesReportHeaderAddress],
        ['Total Sales'],
        [`DATE: ${periodLabel}`],
        [],
        [`Total Sales (${payments.length}) - Total Paid: ${totalPaid.toFixed(2)} AED`],
        headers,
        ...rows,
        [],
        ['', '', '', '', '', '', '', 'Total Paid:', `AED ${totalPaid.toFixed(2)}`],
        [],
        ['Payment Method Breakdown'],
        ['Method', 'Bills Paid', 'Total Amount (AED)'],
        ...paymentBreakdownRows.map((row) => [
          row.label,
          `${row.billCount} bill${row.billCount === 1 ? '' : 's'}`,
          `AED ${row.totalAmount.toFixed(2)}`,
        ]),
      ],
      sheetName: "Total Sales",
      fileName: `Total_Sales_${filename}.xlsx`,
      columns: [
        { wch: 4 },
        { wch: 34 },
        { wch: 15 },
        { wch: 42 },
        { wch: 14 },
        { wch: 28 },
        { wch: 32 },
        { wch: 18 },
        { wch: 16 },
      ],
      cellStyles,
      rowHeights: headerRows.map((row) => ({ row, height: 26 })),
    });
  };

  const exportTotalSalesToPDF = async () => {
    const { data, label, filename } = getCurrentData();
    const html2pdf = (await import('html2pdf.js')).default;
    const payments = data.deposits || [];
    const paymentBreakdownRows = getSalesPaymentBreakdown(data.rawDeposits || payments);
    const reportDate = activeTab === 'range' ? `DATE: ${formatDateRange()}` : `DATE: ${getReportPeriodExportLabel()}`;
    const sectionHtml =
      payments.length > 0
        ? renderSalesPaymentsSectionHtml(payments, paymentBreakdownRows, false, 34, true)
        : `<div style="padding:20px;text-align:center;color:#6b7280;border:1px solid #e5e7eb;">No paid sales found for this period.</div>`;

    const content = `
      <div class="sales-pdf-report" style="font-family:Arial,sans-serif;color:#333;font-size:8px;padding:10px;">
        ${renderSalesPdfPrintColorStyle()}
        <div style="text-align:center;border-bottom:2px solid #16a34a;padding-bottom:8px;margin-bottom:8px;">
          <div style="font-size:16px;font-weight:bold;color:#1e40af;">${escapeHtml(salesReportCompanyName)}</div>
          <div style="color:#666;margin:3px 0;font-size:9px;">${escapeHtml(salesReportHeaderAddress)}</div>
          <div style="font-size:13px;font-weight:bold;margin:6px 0 3px;">Total Sales</div>
          <div style="color:#666;font-size:10px;">${escapeHtml(reportDate || label)}</div>
        </div>
        ${sectionHtml}
        <div style="margin-top:15px;text-align:center;color:#666;font-size:8px;border-top:1px solid #e5e7eb;padding-top:6px;">
          <div>Generated on ${new Date().toLocaleString()}</div>
          <div style="font-weight:bold;color:#000;font-size:9px;margin-top:4px;">${escapeHtml(salesReportPhoneLine)}</div>
        </div>
      </div>
    `;

    const container = document.createElement('div');
    container.innerHTML = content;
    document.body.appendChild(container);

    html2pdf()
      .set(getPdfExportOptions(`Total_Sales_${filename}.pdf`, "portrait", ['css', 'legacy']) as any)
      .from(container)
      .save()
      .then(() => {
        document.body.removeChild(container);
      });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-AE', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatMonth = (monthStr: string) => {
    const [year, month] = monthStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleDateString('en-AE', { year: 'numeric', month: 'long' });
  };

  const getOrderStatus = (order: Order) => {
    if (order.delivered) return { label: 'Delivered', color: 'text-green-600 bg-green-50 border-green-200' };
    if (order.packingDone) return { label: 'Ready', color: 'text-blue-600 bg-blue-50 border-blue-200' };
    if (order.washingDone) return { label: 'Washed', color: 'text-purple-600 bg-purple-50 border-purple-200' };
    if (order.tagDone) return { label: 'Tagged', color: 'text-orange-600 bg-orange-50 border-orange-200' };
    return { label: 'Entry', color: 'text-gray-600 bg-gray-50 border-gray-200' };
  };

  const getOrderStatusDateDisplay = (order: Order) => {
    if (order.delivered && order.deliveryDate) return new Date(order.deliveryDate);
    if (order.packingDone && order.packingDate) return new Date(order.packingDate);
    if (order.washingDone && order.washingDate) return new Date(order.washingDate);
    if (order.tagDone && order.tagDate) return new Date(order.tagDate);
    if (order.entryDate) return new Date(order.entryDate);
    return null;
  };

  const getOrderPaidDateDisplay = (order: Order, period: ReportPeriod) => {
    if (!order.billId) return null;

    const payments = billPaymentsByBillId.get(order.billId) || [];
    if (payments.length === 0) {
      return null;
    }

    const periodEndTime = getPeriodEndDate(period).getTime();
    const eligiblePayments = payments.filter((payment: any) => {
      const paymentTime = new Date(payment?.paymentDate || payment?.date || "").getTime();
      return Number.isFinite(paymentTime) && paymentTime <= periodEndTime;
    });

    if (eligiblePayments.length === 0) {
      return null;
    }

    const latestPayment = eligiblePayments[eligiblePayments.length - 1];
    return latestPayment?.paymentDate ? new Date(latestPayment.paymentDate) : null;
  };

  const compareOrdersByPaidDateAsc = (left: Order, right: Order) => {
    const reportPeriod = getActiveReportPeriod();
    const leftPaidTime = getOrderPaidDateDisplay(left, reportPeriod)?.getTime() ?? 0;
    const rightPaidTime = getOrderPaidDateDisplay(right, reportPeriod)?.getTime() ?? 0;
    const timeDelta = leftPaidTime - rightPaidTime;
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.id - right.id;
  };

  const formatShortDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const useA4ReportPaper = embedded && !isMobile;
  const a4ReportPaperCardClass = useA4ReportPaper
    ? "screen-a4-paper mx-auto flex w-full max-w-[297mm] flex-col overflow-hidden rounded-sm border border-border bg-card shadow-[0_14px_34px_rgba(15,23,42,0.14)]"
    : "";
  const a4ReportPaperCardStyle = useA4ReportPaper
    ? { height: "min(297mm, max(640px, calc(100vh - 12rem)))" }
    : undefined;
  const a4ReportPaperHeaderClass = useA4ReportPaper ? "shrink-0" : "";
  const a4ReportPaperContentClass = useA4ReportPaper ? "min-h-0 overflow-auto" : "";
  const a4ReportTableShellClass = useA4ReportPaper ? "screen-a4-table-shell" : "overflow-x-auto";
  const mobileCompactReportTableShellClass = "mobile-compact-report-table-shell";
  const mobileCompactReportTableClass = "mobile-compact-report-table";

  const renderOrderSummaryCards = (
    orderData: {
      deliveryOrders: Order[];
      takeawayOrders: Order[];
      totalDelivery: number;
      totalTakeaway: number;
      totalBills: number;
      totalPaid: number;
      totalDiscount: number;
      orderCount: number;
    },
    deposits: any[] = [],
  ) => {
    const paymentBreakdownRows = getSalesPaymentBreakdown(deposits);
    const cashBreakdown = paymentBreakdownRows.find((row) => row.key === "cash");
    const cardBreakdown = paymentBreakdownRows.find((row) => row.key === "card");
    const bankBreakdown = paymentBreakdownRows.find((row) => row.key === "bank");
    const creditBreakdown = paymentBreakdownRows.find((row) => row.key === "credit");
    const otherBreakdown = paymentBreakdownRows.find((row) => row.key === "other");

    const formatBillsLine = (label: string, billCount: number, totalAmount: number) =>
      `${label}: ${billCount} bill${billCount === 1 ? "" : "s"} = ${totalAmount.toFixed(2)} AED`;

    if (isMobile) {
      return (
        <Card className="mb-3 overflow-hidden border-primary/20">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
            aria-expanded={mobileSalesSummaryOpen}
            onClick={() => setMobileSalesSummaryOpen((open) => !open)}
            data-testid="button-mobile-sales-summary-toggle"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/10">
                <Banknote className="h-4 w-4 text-green-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground">Sales Summary</p>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-base font-bold leading-tight text-green-600">
                    {orderData.totalPaid.toFixed(2)} AED
                  </span>
                  {orderData.totalDiscount > 0 ? (
                    <span className="text-[11px] font-semibold text-orange-600">
                      Disc -{orderData.totalDiscount.toFixed(2)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                mobileSalesSummaryOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {mobileSalesSummaryOpen ? (
            <CardContent className="space-y-2 border-t px-3 pb-3 pt-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border bg-muted/20 px-2.5 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Tag className="h-3.5 w-3.5 text-orange-500" />
                    Discounts
                  </div>
                  <p className="mt-0.5 text-sm font-bold leading-tight text-orange-600">
                    -{orderData.totalDiscount.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/20 px-2.5 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ShoppingBag className="h-3.5 w-3.5 text-sky-500" />
                    Orders
                  </div>
                  <p className="mt-0.5 text-[11px] font-semibold leading-snug text-cyan-600">
                    Take-away: {orderData.takeawayOrders.length}
                  </p>
                  <p className="text-[11px] font-semibold leading-snug text-orange-600">
                    Delivery: {orderData.deliveryOrders.length}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/20 px-2.5 py-2">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Wallet className="h-3.5 w-3.5 text-indigo-500" />
                  Payment Methods
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] leading-snug">
                  <p className="font-medium text-green-600">{formatBillsLine("Cash", cashBreakdown?.billCount || 0, cashBreakdown?.totalAmount || 0)}</p>
                  <p className="font-medium text-blue-600">{formatBillsLine("Card", cardBreakdown?.billCount || 0, cardBreakdown?.totalAmount || 0)}</p>
                  <p className="font-medium text-purple-600">{formatBillsLine("Bank", bankBreakdown?.billCount || 0, bankBreakdown?.totalAmount || 0)}</p>
                  <p className="font-medium text-amber-600">{formatBillsLine("Credit", creditBreakdown?.billCount || 0, creditBreakdown?.totalAmount || 0)}</p>
                  {otherBreakdown ? (
                    <p className="col-span-2 font-medium text-slate-600">{formatBillsLine(otherBreakdown.label, otherBreakdown.billCount, otherBreakdown.totalAmount)}</p>
                  ) : null}
                </div>
              </div>
            </CardContent>
          ) : null}
        </Card>
      );
    }

    return (
      <div className={`flex flex-wrap justify-center ${isMobile ? "gap-2 mb-3" : "gap-3 mb-6"}`}>
        {orderData.totalDiscount > 0 && (
          <Card className={`w-full ${isMobile ? "" : "sm:w-[320px]"}`}>
            <CardContent className={isMobile ? "p-3" : "p-4"}>
              <div className={`flex items-start ${isMobile ? "gap-2.5" : "gap-3"}`}>
                <div className={`${isMobile ? "w-8 h-8" : "w-9 h-9"} rounded-full bg-orange-500/10 flex items-center justify-center shrink-0`}>
                  <Tag className="w-4.5 h-4.5 text-orange-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Total Discounts</p>
                  <p className={`${isMobile ? "text-lg" : "text-xl"} font-bold text-orange-600 leading-tight`}>-{orderData.totalDiscount.toFixed(2)} AED</p>
                  <p className="text-[11px] text-muted-foreground">Applied discounts</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className={`w-full ${isMobile ? "" : "sm:w-[320px]"}`}>
          <CardContent className={isMobile ? "p-3" : "p-4"}>
            <div className={`flex items-start ${isMobile ? "gap-2.5" : "gap-3"}`}>
              <div className={`${isMobile ? "w-8 h-8" : "w-9 h-9"} rounded-full bg-green-500/10 flex items-center justify-center shrink-0`}>
                <Banknote className="w-4.5 h-4.5 text-green-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Total Sales (Paid)</p>
                <p className={`${isMobile ? "text-lg" : "text-xl"} font-bold text-green-600 leading-tight`}>{orderData.totalPaid.toFixed(2)} AED</p>
                <p className="text-[11px] text-muted-foreground">Collected amount</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={`w-full ${isMobile ? "" : "sm:w-[320px]"}`}>
          <CardContent className={isMobile ? "p-3" : "p-4"}>
            <div className={`flex items-start ${isMobile ? "gap-2.5" : "gap-3"}`}>
              <div className={`${isMobile ? "w-8 h-8" : "w-9 h-9"} rounded-full bg-sky-500/10 flex items-center justify-center shrink-0`}>
                <ShoppingBag className="w-4.5 h-4.5 text-sky-500" />
              </div>
              <div className="min-w-0 w-full">
                <p className="text-xs text-muted-foreground">Order Type Breakdown</p>
                <div className={`mt-1.5 space-y-1 ${isMobile ? "text-[11px] leading-[1.15rem]" : "text-[12px] leading-5"}`}>
                  <p className="text-cyan-600 font-medium">Take-away: {orderData.takeawayOrders.length} order{orderData.takeawayOrders.length === 1 ? "" : "s"}</p>
                  <p className="text-orange-600 font-medium">Delivery: {orderData.deliveryOrders.length} order{orderData.deliveryOrders.length === 1 ? "" : "s"}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={`w-full ${isMobile ? "" : "sm:w-[320px]"}`}>
          <CardContent className={isMobile ? "p-3" : "p-4"}>
            <div className={`flex items-start ${isMobile ? "gap-2.5" : "gap-3"}`}>
              <div className={`${isMobile ? "w-8 h-8" : "w-9 h-9"} rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0`}>
                <Wallet className="w-4.5 h-4.5 text-indigo-500" />
              </div>
              <div className="min-w-0 w-full">
                <p className="text-xs text-muted-foreground">Payment Method Breakdown</p>
                <div className={`mt-1.5 space-y-1 ${isMobile ? "text-[11px] leading-[1.15rem]" : "text-[12px] leading-5"}`}>
                  <p className="font-medium text-green-600">{formatBillsLine("Cash", cashBreakdown?.billCount || 0, cashBreakdown?.totalAmount || 0)}</p>
                  <p className="font-medium text-blue-600">{formatBillsLine("Card", cardBreakdown?.billCount || 0, cardBreakdown?.totalAmount || 0)}</p>
                  <p className="font-medium text-purple-600">{formatBillsLine("Bank Transfer", bankBreakdown?.billCount || 0, bankBreakdown?.totalAmount || 0)}</p>
                  <p className="font-medium text-amber-600">{formatBillsLine("Credit", creditBreakdown?.billCount || 0, creditBreakdown?.totalAmount || 0)}</p>
                  {otherBreakdown ? (
                    <p className="font-medium text-slate-600">{formatBillsLine(otherBreakdown.label, otherBreakdown.billCount, otherBreakdown.totalAmount)}</p>
                  ) : null}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderOrderTable = (orders: Order[], prefix: string, amountColor: string) => (
    <div className="space-y-3">
      {selectedCurrentOrders.length > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 p-2 flex-wrap">
          <span className="text-sm font-medium">{selectedCurrentOrders.length} selected</span>
          <span className="text-sm text-muted-foreground">Move order date/time with the same controls used in Order Tracking.</span>
          <Button
            size="sm"
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
            onClick={openBulkCurrentOrderDateEditDialog}
            data-testid="button-open-sales-report-bulk-date-edit"
          >
            <Calendar className="w-3.5 h-3.5 mr-1" />
            Edit Dates
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedCurrentOrderIds(new Set())}
            data-testid="button-clear-sales-report-order-selection"
          >
            Cancel
          </Button>
        </div>
      )}

      <div
        ref={salesReportCurrentOrdersTableRef}
        tabIndex={-1}
        onMouseEnter={() => {
          hoveredSalesReportTableRef.current = "current";
        }}
        onMouseLeave={() => {
          if (hoveredSalesReportTableRef.current === "current") {
            hoveredSalesReportTableRef.current = null;
          }
        }}
        className={isMobile ? mobileCompactReportTableShellClass : a4ReportTableShellClass}
      >
        <Table className={isMobile ? mobileCompactReportTableClass : useA4ReportPaper ? "screen-a4-table screen-a4-order-table" : undefined}>
          <TableHeader>
            {isMobile ? (
              <TableRow>
                <TableHead className="w-[28px] px-1">
                  <Checkbox
                    checked={allCurrentOrdersSelected ? true : selectedCurrentOrders.length > 0 ? "indeterminate" : false}
                    disabled={isMovingPayments}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        toggleAllCurrentOrders(orders);
                      } else {
                        setSelectedCurrentOrderIds(new Set());
                      }
                    }}
                    data-testid="checkbox-select-all-current-period-orders"
                  />
                </TableHead>
                <TableHead className="w-[26px] px-1">#</TableHead>
                <TableHead>Order / Customer</TableHead>
                <TableHead className="w-[68px] text-center">Priority</TableHead>
                <TableHead className="w-[82px] text-right">Amount</TableHead>
              </TableRow>
            ) : (
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allCurrentOrdersSelected ? true : selectedCurrentOrders.length > 0 ? "indeterminate" : false}
                    disabled={isMovingPayments}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        toggleAllCurrentOrders(orders);
                      } else {
                        setSelectedCurrentOrderIds(new Set());
                      }
                    }}
                    data-testid="checkbox-select-all-current-period-orders"
                  />
                </TableHead>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
	                <TableHead className="text-center">Priority</TableHead>
	                <TableHead className="text-right">Work Rec.</TableHead>
	                <TableHead className="text-right">Delivery</TableHead>
	                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Final Amount</TableHead>
                <TableHead className="text-center">Created</TableHead>
                <TableHead className="text-center">Payment Status</TableHead>
                <TableHead className="text-center">Order Status</TableHead>
              </TableRow>
            )}
          </TableHeader>
          <TableBody>
            {orders.map((order, index) => {
              const client = getClientById(order.clientId);
              const reportPeriod = getActiveReportPeriod();
              const workflowStatus = getOrderStatus(order);
              const paymentStatus = getOrderPaymentStatus(order, reportPeriod);
              const paidDate = getOrderPaidDateDisplay(order, reportPeriod);
              const paymentDateColorClass = paidDate
                ? paymentStatus.label === "Partially Paid"
                  ? "text-amber-600"
                  : paymentStatus.label === "Fully Paid"
                    ? "text-green-600"
                    : "text-muted-foreground"
                : "text-muted-foreground";
              const amounts = getOrderBillAmounts(order);
              const isSelected = selectedCurrentOrderIds.has(order.id);
              const partialDateLabel = getSalesPaymentPartialDateLabel(paymentStatus, formatShortDate);
              const paidDateLabel = paidDate
                ? partialDateLabel
                  ? getSalesPaymentPaidDateLabel(paidDate, formatShortDate)
                  : formatShortDate(paidDate)
                : "No payment yet";
              if (isMobile) {
                return (
                  <TableRow
                    key={order.id}
                    className={isSelected ? "bg-primary/5" : undefined}
                    onClickCapture={(event) =>
                      handleSalesReportShortcutSelection(event, () => toggleCurrentOrderSelection(order.id))
                    }
                  >
                    <TableCell className="px-1">
                      <Checkbox
                        checked={isSelected}
                        disabled={isMovingPayments}
                        onCheckedChange={() => toggleCurrentOrderSelection(order.id)}
                        data-testid={`checkbox-select-current-period-order-${order.id}`}
                      />
                    </TableCell>
                    <TableCell className="px-1 font-medium text-muted-foreground" data-testid={`text-${prefix}-order-count-${index}`}>
                      {index + 1}
                    </TableCell>
                    <TableCell>
                      <div className="compact-main-line font-mono">{order.orderNumber}</div>
                      <div className="compact-muted-line">
                        {client?.name || order.customerName || "Walk-in"}
                        {client?.billNumber ? ` (${client.billNumber})` : ""}
                        {order.deliveryType === "delivery" ? " (D)" : " (T)"}
                      </div>
                      <div className="compact-muted-line" data-testid={`text-created-${prefix}-${order.id}`}>
                        {order.entryDate ? formatShortDate(order.entryDate) : "-"}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {order.urgent ? (
                        <Badge variant="outline" className="compact-nowrap gap-0.5 border-red-300 bg-red-100 px-1.5 py-0 text-[10px] text-red-600 dark:border-red-700 dark:bg-red-900/30 dark:text-red-400">
                          <Zap className="h-2.5 w-2.5" /> Urgent
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="compact-nowrap gap-0.5 border-green-300 bg-green-100 px-1.5 py-0 text-[10px] text-green-600 dark:border-green-700 dark:bg-green-900/30 dark:text-green-400">
                          <Clock className="h-2.5 w-2.5" /> Normal
                        </Badge>
                      )}
                      <div className="compact-muted-line compact-nowrap">Work: {amounts.originalAmount.toFixed(2)}</div>
	                      {amounts.deliveryCharge > 0.009 ? (
	                        <div className="compact-muted-line text-blue-600 dark:text-blue-400" data-testid={`text-delivery-charge-${prefix}-${order.id}`}>
	                          Delivery: {amounts.deliveryCharge.toFixed(2)}
	                        </div>
	                      ) : null}
	                      {amounts.discount > 0 ? (
                        <div className="compact-muted-line text-orange-600 dark:text-orange-400" data-testid={`text-discount-${prefix}-${order.id}`}>
                          Disc: -{amounts.discount.toFixed(2)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className={`text-right ${amountColor}`}>
                      <div className="compact-nowrap font-semibold">{amounts.finalAmount.toFixed(2)} AED</div>
                      <Badge variant="outline" className={`mt-1 compact-nowrap px-1.5 py-0 text-[10px] ${paymentStatus.color}`} data-testid={`badge-payment-status-${prefix}-${order.id}`}>
                        {paymentStatus.label}
                      </Badge>
                      <div className={`compact-muted-line ${paymentDateColorClass}`}>
                        {partialDateLabel || paidDateLabel}
                      </div>
                      <div className="compact-muted-line" data-testid={`badge-order-status-${prefix}-${order.id}`}>
                        {workflowStatus.label}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }
              return (
                <TableRow
                  key={order.id}
                  className={isSelected ? "bg-primary/5" : undefined}
                  onClickCapture={(event) =>
                    handleSalesReportShortcutSelection(event, () => toggleCurrentOrderSelection(order.id))
                  }
                >
                  <TableCell className="w-8">
                    <Checkbox
                      checked={isSelected}
                      disabled={isMovingPayments}
                      onCheckedChange={() => toggleCurrentOrderSelection(order.id)}
                      data-testid={`checkbox-select-current-period-order-${order.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground font-medium" data-testid={`text-${prefix}-order-count-${index}`}>{index + 1}</TableCell>
                  <TableCell className="font-mono">{order.orderNumber}</TableCell>
                  <TableCell>
                    {client?.name || order.customerName || 'Walk-in'}
                    {client?.billNumber && <span className="ml-1 text-xs text-muted-foreground">({client.billNumber})</span>}
                    {order.deliveryType === 'delivery' ? <span className="ml-1 text-xs text-orange-500">(D)</span> : <span className="ml-1 text-xs text-cyan-500">(T)</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    {order.urgent ? (
                      <Badge variant="outline" className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-300 dark:border-red-700 gap-0.5">
                        <Zap className="w-3 h-3" /> Urgent
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 border-green-300 dark:border-green-700 gap-0.5">
                        <Clock className="w-3 h-3" /> Normal
                      </Badge>
                    )}
                  </TableCell>
	                  <TableCell className="text-right font-semibold text-muted-foreground">
	                    {amounts.originalAmount.toFixed(2)} AED
	                  </TableCell>
	                  <TableCell className="text-right text-xs">
	                    {amounts.deliveryCharge > 0.009 ? (
	                      <span className="font-medium text-blue-600 dark:text-blue-400" data-testid={`text-delivery-charge-${prefix}-${order.id}`}>
	                        {amounts.deliveryCharge.toFixed(2)}
	                      </span>
	                    ) : (
	                      <span className="text-muted-foreground">-</span>
	                    )}
	                  </TableCell>
	                  <TableCell className="text-right text-xs">
                    {amounts.discount > 0 ? (
                      <span className="text-orange-600 dark:text-orange-400 font-medium" data-testid={`text-discount-${prefix}-${order.id}`}>
                        -{amounts.discount.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className={`text-right font-semibold ${amountColor}`}>
                    {amounts.finalAmount.toFixed(2)} AED
                  </TableCell>
                  <TableCell className="text-center text-xs text-muted-foreground" data-testid={`text-created-${prefix}-${order.id}`}>
                    {order.entryDate ? formatShortDate(order.entryDate) : '-'}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex flex-col items-center gap-1">
                      <Badge variant="outline" className={`text-xs ${paymentStatus.color}`} data-testid={`badge-payment-status-${prefix}-${order.id}`}>
                        {paymentStatus.label}
                      </Badge>
                      {partialDateLabel ? (
                        <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
                          {partialDateLabel}
                        </span>
                      ) : null}
                      <span className={`text-[11px] ${paymentDateColorClass}`}>
                        {paidDateLabel}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={`text-xs ${workflowStatus.color}`} data-testid={`badge-order-status-${prefix}-${order.id}`}>
                      {workflowStatus.label}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  const getDepositPriority = (deposit: any): boolean => {
    if (!allOrders) return false;
    if (deposit.description) {
      const orderMatch = deposit.description.match(/ORD-(\d+)/);
      if (orderMatch) {
        const orderNum = `ORD-${orderMatch[1]}`;
        const order = orderByNumber.get(orderNum.toUpperCase());
        if (order) return !!order.urgent;
      }
    }
    if (deposit.billId) {
      const order = getSalesPaymentLinkedOrder(deposit);
      if (order) return !!order.urgent;
    }
    return false;
  };

  const getDepositOrderInfo = (deposit: any): { orderNumber: string; createdDate: string } => {
    if (!allOrders) return { orderNumber: '-', createdDate: '-' };
    let order: Order | undefined;
    if (deposit.description) {
      const orderMatch = deposit.description.match(/ORD-(\d+)/);
      if (orderMatch) {
        const orderNum = `ORD-${orderMatch[1]}`;
        order = orderByNumber.get(orderNum.toUpperCase());
      }
    }
    if (!order && deposit.billId) {
      order = getSalesPaymentLinkedOrder(deposit);
    }
    if (order) {
      return {
        orderNumber: order.orderNumber,
        createdDate: order.entryDate ? formatShortDate(order.entryDate) : '-',
      };
    }
    return { orderNumber: '-', createdDate: '-' };
  };

  const renderDepositsTable = (deposits: any[]) => {
    const totalPaid = deposits.reduce((sum: number, d: any) => sum + parseFloat(d.amount || "0"), 0);
    const selectableDeposits = deposits.filter((payment) => getTotalSalesPaymentSourceIds(payment).length > 0);
    const selectedDeposits = deposits.filter((payment) =>
      selectedTotalSalesPaymentKeys.has(getTotalSalesPaymentSelectionKey(payment)),
    );
    const selectedTotalSalesPaymentIds = selectedDeposits.flatMap(getTotalSalesPaymentSourceIds);
    const selectedTotalSalesAmount = selectedDeposits.reduce((sum: number, payment: any) => {
      const amount = parseFloat(String(payment.amount || "0"));
      return Number.isFinite(amount) ? sum + amount : sum;
    }, 0);
    const allTotalSalesSelected =
      selectableDeposits.length > 0 &&
      selectableDeposits.every((payment) =>
        selectedTotalSalesPaymentKeys.has(getTotalSalesPaymentSelectionKey(payment)),
      );

    return (
      <div className="space-y-3">
        {selectedDeposits.length > 0 && (
          <div className="flex items-center gap-2 rounded-md bg-muted/50 p-2 flex-wrap">
            <span className="text-sm font-medium">
              {selectedDeposits.length} selected
            </span>
            <span className="text-sm text-muted-foreground">
              Total: {selectedTotalSalesAmount.toFixed(2)} AED
            </span>
            <Button
              variant="destructive"
              size="sm"
              disabled={revertSalesReportBillPaymentMutation.isPending}
              onClick={() =>
                openSalesReportPaymentsRevertDialog(
                  selectedTotalSalesPaymentIds,
                  `${selectedDeposits.length} total sales payment${selectedDeposits.length === 1 ? "" : "s"}`,
                )
              }
              data-testid="button-revert-selected-total-sales-payments"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Revert
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedTotalSalesPaymentKeys(new Set())}
              data-testid="button-clear-total-sales-payment-selection"
            >
              Cancel
            </Button>
          </div>
        )}

      <div
        ref={salesReportTotalSalesTableRef}
        tabIndex={-1}
        onMouseEnter={() => {
          hoveredSalesReportTableRef.current = "total-sales";
        }}
        onMouseLeave={() => {
          if (hoveredSalesReportTableRef.current === "total-sales") {
            hoveredSalesReportTableRef.current = null;
          }
        }}
        className={isMobile ? mobileCompactReportTableShellClass : a4ReportTableShellClass}
      >
        <Table className={isMobile ? mobileCompactReportTableClass : useA4ReportPaper ? "screen-a4-table screen-a4-sales-table" : undefined}>
          <TableHeader>
            {isMobile ? (
              <TableRow>
                <TableHead className="w-[28px] px-1">
                  <Checkbox
                    checked={allTotalSalesSelected ? true : selectedDeposits.length > 0 ? "indeterminate" : false}
                    disabled={isMovingPayments}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        toggleAllTotalSalesPayments(deposits);
                      } else {
                        setSelectedTotalSalesPaymentKeys(new Set());
                      }
                    }}
                    data-testid="checkbox-select-all-total-sales"
                  />
                </TableHead>
                <TableHead className="w-[28px] px-1">#</TableHead>
                <TableHead>Sale</TableHead>
                <TableHead className="w-[76px] text-center">Bill</TableHead>
                <TableHead className="w-[86px] text-right">Amount</TableHead>
              </TableRow>
            ) : (
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allTotalSalesSelected ? true : selectedDeposits.length > 0 ? "indeterminate" : false}
                    disabled={isMovingPayments}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        toggleAllTotalSalesPayments(deposits);
                      } else {
                        setSelectedTotalSalesPaymentKeys(new Set());
                      }
                    }}
                    data-testid="checkbox-select-all-total-sales"
                  />
                </TableHead>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Bill</TableHead>
                <TableHead className="text-center">Method</TableHead>
                <TableHead className="text-center">Payment Status</TableHead>
                <TableHead className="text-right">Amount Paid</TableHead>
              </TableRow>
            )}
          </TableHeader>
          <TableBody>
            {deposits.map((d, index) => {
              const linkedBill = getBillById(d.billId) || null;
              const client = getSalesPaymentClient(d, linkedBill);
              const paymentStatus = getSalesPaymentStatusMeta(d, linkedBill);
              const isPartiallyPaid = paymentStatus.label === "Partially Paid";
              const accountLabel = client?.billNumber ? ` (${client.billNumber})` : '';
              const methodLines = getPaymentBreakdownLines(d);
              const partialDateLabel = getSalesPaymentPartialDateLabel(paymentStatus, formatShortDate);
              const paidDateLabel = partialDateLabel
                ? getSalesPaymentPaidDateLabel(d.date, formatShortDate)
                : null;
              const selectionKey = getTotalSalesPaymentSelectionKey(d);
              const isSelected = selectedTotalSalesPaymentKeys.has(selectionKey);
              const isSelectable = getTotalSalesPaymentSourceIds(d).length > 0;
              if (isMobile) {
                return (
                  <TableRow
                    key={d.id || index}
                    className={isSelected ? "bg-muted/40" : ""}
                    onClickCapture={(event) =>
                      isSelectable
                        ? handleSalesReportShortcutSelection(event, () =>
                            toggleTotalSalesPaymentSelection(selectionKey),
                          )
                        : undefined
                    }
                  >
                    <TableCell className="px-1">
                      <Checkbox
                        checked={isSelected}
                        disabled={!isSelectable || isMovingPayments}
                        onCheckedChange={() => toggleTotalSalesPaymentSelection(selectionKey)}
                        data-testid={`checkbox-total-sales-${selectionKey}`}
                      />
                    </TableCell>
                    <TableCell className="px-1 font-medium text-muted-foreground">{index + 1}</TableCell>
                    <TableCell>
                      <div className="compact-main-line">{d.clientName}{accountLabel}</div>
                      <div className="compact-muted-line">{d.orderSummary || d.description || "-"}</div>
                      <div className={`compact-muted-line ${isPartiallyPaid ? "font-medium text-amber-600" : ""}`}>
                        {methodLines.join(" | ")}
                      </div>
                      {d.billDate ? (
                        <div className="compact-muted-line">Bill: {formatShortDate(d.billDate)}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-center">
                      {d.billId ? (
                        <div className="flex flex-col items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={`h-auto px-1 py-0 font-mono text-[10px] ${
                              isPartiallyPaid
                                ? "text-amber-600 hover:text-amber-700"
                                : "text-primary"
                            }`}
                            onClick={() => openSalesReportBillDetails(d)}
                            data-testid={`button-sales-report-bill-${d.billId}`}
                          >
                            #{d.billDisplayNumber || d.billId}
                          </Button>
                          {d.billCreatedBy ? (
                            <span className="compact-muted-line mt-0">By: {d.billCreatedBy}</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="compact-nowrap font-semibold text-green-600">{parseFloat(d.amount).toFixed(2)} AED</div>
                      <Badge variant="outline" className={`mt-1 compact-nowrap px-1.5 py-0 text-[10px] ${paymentStatus.badgeClass}`}>
                        {paymentStatus.label}
                      </Badge>
                      {partialDateLabel || paidDateLabel ? (
                        <div className="compact-muted-line text-green-700 dark:text-green-300">
                          {partialDateLabel || paidDateLabel}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              }
              return (
                <TableRow
                  key={d.id || index}
                  className={isSelected ? "bg-muted/40" : ""}
                  onClickCapture={(event) =>
                    isSelectable
                      ? handleSalesReportShortcutSelection(event, () =>
                          toggleTotalSalesPaymentSelection(selectionKey),
                        )
                      : undefined
                  }
                >
                  <TableCell>
                    <Checkbox
                      checked={isSelected}
                      disabled={!isSelectable || isMovingPayments}
                      onCheckedChange={() => toggleTotalSalesPaymentSelection(selectionKey)}
                      data-testid={`checkbox-total-sales-${selectionKey}`}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground font-medium">{index + 1}</TableCell>
                  <TableCell>
                    <div className="font-medium">{d.clientName}{accountLabel}</div>
                  </TableCell>
                  <TableCell className="text-xs max-w-[420px]">
                    <div className="font-medium text-foreground">{d.orderSummary || d.description || '-'}</div>
                    {d.billDate ? (
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Bill recorded: {formatShortDate(d.billDate)}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {d.billId ? (
                      <div className="flex flex-col items-start">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={`font-mono h-auto py-1 px-1 text-xs ${
                            isPartiallyPaid
                              ? "text-amber-600 hover:text-amber-700"
                              : "text-primary"
                          }`}
                          onClick={() => openSalesReportBillDetails(d)}
                          data-testid={`button-sales-report-bill-${d.billId}`}
                        >
                          <Receipt className="w-3 h-3" />
                          #{d.billDisplayNumber || d.billId}
                          {paymentStatus.label === "Fully Paid" ? (
                            <CheckCircle className="w-3 h-3 text-green-700 ml-1" />
                          ) : null}
                        </Button>
                        {d.billCreatedBy ? (
                          <span className="text-[10px] text-muted-foreground pl-1">
                            Billed by: {d.billCreatedBy}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center text-xs">
                    <div
                      className={`mx-auto max-w-[180px] whitespace-normal break-words leading-4 ${
                        isPartiallyPaid ? "font-medium text-amber-600" : ""
                      }`}
                    >
                      {methodLines.map((line: string, lineIndex: number) => (
                        <div key={`${d.id || index}-method-${lineIndex}`}>{line}</div>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex flex-col items-center gap-1">
                      <Badge variant="outline" className={`text-xs ${paymentStatus.badgeClass}`}>
                        {paymentStatus.label}
                      </Badge>
                      {partialDateLabel ? (
                        <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
                          {partialDateLabel}
                        </span>
                      ) : null}
                      {paidDateLabel ? (
                        <span className="text-[10px] font-medium text-green-700 dark:text-green-300">
                          {paidDateLabel}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-green-600">{parseFloat(d.amount).toFixed(2)} AED</TableCell>
                </TableRow>
              );
            })}
            <TableRow className="bg-muted/50 font-bold">
              <TableCell colSpan={isMobile ? 4 : 7} className="text-right">Total Paid:</TableCell>
              <TableCell className="text-right text-green-600">{totalPaid.toFixed(2)} AED</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      </div>
    );
  };

  const getCreditManagementActionDisplay = (transaction: VisibleSalesCreditManagementTransaction) => {
    if (transaction.isDeduction) {
      return {
        label: "Deducted",
        note:
          transaction.type === "deposit_deduction"
            ? "Removed by admin"
            : transaction.billId
              ? `Used for bill #${transaction.billDisplayNumber}`
              : "Used from account credit",
        className: "bg-orange-100 text-orange-700 border-orange-200",
      };
    }

    const normalizedDescription = String(transaction.displayDescription || transaction.description || "").toLowerCase();
    const methodLabel =
      transaction.paymentMethod && String(transaction.paymentMethod).trim()
        ? formatSalesPaymentMethodLabel(transaction.paymentMethod)
        : null;

    if (normalizedDescription.includes("returned after payment method change")) {
      return {
        label: "Returned",
        note: transaction.billId
          ? `Credit returned from bill #${transaction.billDisplayNumber}`
          : "Credit returned to account",
        className: "bg-emerald-100 text-emerald-700 border-emerald-200",
      };
    }

    return {
      label: "Added",
      note: methodLabel ? `Via ${methodLabel}` : "Added to account",
      className: "bg-green-100 text-green-700 border-green-200",
    };
  };

  const renderCreditManagementTable = (creditData: SalesCreditManagementData) => {
    const netChange = creditData.totalAdded - creditData.totalUsed;

    return (
      <Card className={a4ReportPaperCardClass} style={a4ReportPaperCardStyle}>
        <CardHeader className={isMobile ? "px-3 pb-2 pt-3" : `pb-3 ${a4ReportPaperHeaderClass}`}>
          <CardTitle className={`flex items-center gap-2 text-amber-600 flex-wrap ${isMobile ? "text-[15px]" : ""}`}>
            <Wallet className={`${isMobile ? "w-4 h-4" : "w-5 h-5"}`} />
            {creditManagementLogLabel} ({creditData.entries.length})
            <span className={`flex items-center ${isMobile ? "gap-1" : "gap-2"}`}>
              <Button
                size="sm"
                variant="outline"
                onClick={exportCreditManagementToExcel}
                disabled={isLoading}
                data-testid="button-export-credit-excel"
                className={isMobile ? "h-7 rounded-lg px-2 gap-1 !text-[11px]" : "h-8 gap-1 px-3 text-xs"}
              >
                <FileSpreadsheet className={isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} />
                Excel
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={exportCreditManagementToPDF}
                disabled={isLoading}
                data-testid="button-export-credit-pdf"
                className={isMobile ? "h-7 rounded-lg px-2 gap-1 !text-[11px]" : "h-8 gap-1 px-3 text-xs"}
              >
                <Download className={isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} />
                PDF
              </Button>
            </span>
            <span className={`flex items-center flex-wrap ${isMobile ? "gap-2 ml-0 w-full text-[11px]" : "gap-3 ml-auto"}`}>
              <span className="text-xs font-medium text-green-600">
                Added: {creditData.totalAdded.toFixed(2)} AED
              </span>
              <span className="text-xs font-medium text-orange-600">
                Deducted: {creditData.totalUsed.toFixed(2)} AED
              </span>
              <span className={`text-xs font-medium ${netChange >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                Net: {netChange.toFixed(2)} AED
              </span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className={isMobile ? "px-3 pb-3" : a4ReportPaperContentClass}>
          {creditData.entries.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No credit log entries found</p>
          ) : (
            <div className={isMobile ? mobileCompactReportTableShellClass : a4ReportTableShellClass}>
              <Table className={isMobile ? mobileCompactReportTableClass : useA4ReportPaper ? "screen-a4-table screen-a4-credit-table" : undefined}>
                <TableHeader>
                  {isMobile ? (
                    <TableRow>
                      <TableHead className="w-[30px] px-1 text-center compact-nowrap">#</TableHead>
                      <TableHead className="w-[66px]">Date / Acc.</TableHead>
                      <TableHead>Client / Entry</TableHead>
                      <TableHead className="w-[100px] text-right">Amount</TableHead>
                    </TableRow>
                  ) : (
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Account #</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead className="text-center">Entry</TableHead>
                      <TableHead>Bill</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  )}
                </TableHeader>
                <TableBody>
                  {creditData.entries.map((transaction, index) => {
                    const actionDisplay = getCreditManagementActionDisplay(transaction);
                    if (isMobile) {
                      return (
                        <TableRow key={transaction.id}>
                          <TableCell className="w-[30px] px-1 text-center font-medium tabular-nums text-muted-foreground compact-nowrap">{index + 1}</TableCell>
                          <TableCell>
                            <div className="compact-muted-line mt-0">{formatShortDate(transaction.date)}</div>
                            <div className="compact-main-line font-mono text-[10px]">{transaction.accountLabel}</div>
                          </TableCell>
                          <TableCell>
                            <div className="compact-main-line">{transaction.customerName}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <Badge variant="outline" className={`compact-nowrap px-1.5 py-0 text-[10px] ${actionDisplay.className}`}>
                                {actionDisplay.label}
                              </Badge>
                              {transaction.billId ? (
                                <span className="compact-muted-line mt-0 font-mono">#{transaction.billDisplayNumber}</span>
                              ) : null}
                            </div>
                            <div className="compact-muted-line">{actionDisplay.note}</div>
                            <div className="compact-muted-line">{transaction.displayDescription}</div>
                          </TableCell>
                          <TableCell className={`w-[100px] pr-3 text-right ${transaction.isDeduction ? "text-orange-600" : "text-green-600"}`}>
                            <div className="compact-nowrap font-semibold">
                              {transaction.isDeduction ? "-" : "+"}
                              {transaction.amountValue.toFixed(2)} AED
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }
                    return (
                      <TableRow key={transaction.id}>
                        <TableCell className="text-muted-foreground font-medium">{index + 1}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatShortDate(transaction.date)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{transaction.accountLabel}</TableCell>
                        <TableCell>
                          <div className="font-medium">{transaction.customerName}</div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-1">
                            <Badge variant="outline" className={`text-[11px] ${actionDisplay.className}`}>
                              {actionDisplay.label}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">{actionDisplay.note}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {transaction.billId ? (
                            <span className="font-mono text-xs">
                              #{transaction.billDisplayNumber}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${transaction.isDeduction ? "text-orange-600" : "text-green-600"}`}>
                          {transaction.isDeduction ? "-" : "+"}
                          {transaction.amountValue.toFixed(2)} AED
                        </TableCell>
                        <TableCell className="text-xs max-w-[360px]">
                          <div className="font-medium text-foreground">{transaction.displayDescription}</div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/50 font-bold">
                    {isMobile ? (
                      <>
                        <TableCell colSpan={3} className="text-right">Credit Totals:</TableCell>
                        <TableCell className="w-[100px] pr-3 text-right">
                          <div className="compact-nowrap text-green-600">+{creditData.totalAdded.toFixed(2)} AED</div>
                          <div className="compact-nowrap text-orange-600">-{creditData.totalUsed.toFixed(2)} AED</div>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell colSpan={5} className="text-right">Credit Totals:</TableCell>
                        <TableCell className="text-right">
                          <div className="text-green-600">+{creditData.totalAdded.toFixed(2)} AED</div>
                          <div className="text-orange-600">-{creditData.totalUsed.toFixed(2)} AED</div>
                        </TableCell>
                        <TableCell colSpan={2} className="text-xs text-muted-foreground">
                          Added: {creditData.addedCount} entry{creditData.addedCount === 1 ? "" : "s"} | Deducted: {creditData.usedCount} entry{creditData.usedCount === 1 ? "" : "s"}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderSectionExportButtons = (
    keyPrefix: string,
    onExcel: () => void | Promise<void>,
    onPdf: () => void | Promise<void>,
    disabled = false,
  ) => (
    <span className={`flex items-center ${isMobile ? "gap-1" : "gap-1.5"}`}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onExcel}
        disabled={isLoading || disabled}
        data-testid={`button-export-${keyPrefix}-excel`}
        className={isMobile ? "h-7 rounded-lg px-2 gap-1 !text-[11px]" : "h-7 gap-1 px-2 text-xs"}
      >
        <FileSpreadsheet className={isMobile ? "h-3.5 w-3.5" : "h-3.5 w-3.5"} />
        Excel
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onPdf}
        disabled={isLoading || disabled}
        data-testid={`button-export-${keyPrefix}-pdf`}
        className={isMobile ? "h-7 rounded-lg px-2 gap-1 !text-[11px]" : "h-7 gap-1 px-2 text-xs"}
      >
        <Download className={isMobile ? "h-3.5 w-3.5" : "h-3.5 w-3.5"} />
        PDF
      </Button>
    </span>
  );

  const renderOrderTables = (
    orderData: { currentDateOrders: Order[]; oldPaidOrders: Order[]; deliveryOrders: Order[]; takeawayOrders: Order[] },
    deposits?: any[],
    creditData?: SalesCreditManagementData,
  ) => {
    const currentSummary = getOrderSectionSummary(orderData.currentDateOrders);
    const currentTotal = orderData.currentDateOrders.reduce((sum, o) => sum + getOrderBillAmounts(o).finalAmount, 0);
    const oldPaidPaymentEntries = getOldPaidPaymentEntriesForPeriod(orderData);
    const oldPaidTotal = oldPaidPaymentEntries.reduce((sum, entry) => {
      const paymentAmount = parseFloat(String(entry.payment?.amount || "0"));
      return Number.isFinite(paymentAmount) ? sum + paymentAmount : sum;
    }, 0);
    const selectedOldPaidPaymentIdsForPeriod = oldPaidPaymentEntries
      .map((entry) => Number(entry.payment?.id || 0))
      .filter((paymentId) => Number.isFinite(paymentId) && paymentId > 0 && selectedOldPaidPayments.has(paymentId));
    const selectedOldPaidPaymentCount = selectedOldPaidPaymentIdsForPeriod.length;
    const visibleDeposits = deposits || [];
    const depositsTotal = visibleDeposits.reduce((sum: number, d: any) => sum + parseFloat(d.amount || "0"), 0);

    return (
      <div className={`${isMobile ? "space-y-3 mb-3" : useA4ReportPaper ? "w-full space-y-8 overflow-x-auto pb-2 mb-8" : "space-y-6 mb-6"}`}>
        <Card className={a4ReportPaperCardClass} style={a4ReportPaperCardStyle}>
          <CardHeader className={isMobile ? "px-3 pb-2 pt-3" : `pb-3 ${a4ReportPaperHeaderClass}`}>
              <CardTitle className={`flex items-center gap-2 text-blue-600 flex-wrap ${isMobile ? "text-[15px]" : ""}`}>
                <Receipt className={`${isMobile ? "w-4 h-4" : "w-5 h-5"}`} />
                Current Period Orders ({orderData.currentDateOrders.length})
                {renderSectionExportButtons(
                  "current-orders",
                  exportCurrentOrdersToExcel,
                  exportCurrentOrdersToPDF,
                  orderData.currentDateOrders.length === 0,
                )}
                <span className={`flex items-center flex-wrap ${isMobile ? "gap-2 ml-0 w-full text-[11px]" : "gap-3 ml-auto"}`}>
                <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                  <Zap className="w-3.5 h-3.5" />
                  Urgent: {currentSummary.urgentCount}
                </span>
                <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                  <Clock className="w-3.5 h-3.5" />
                  Normal: {currentSummary.normalCount}
                </span>
                <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                  Paid: {currentSummary.paidAmount.toFixed(2)} AED
                </span>
                <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                  Unpaid: {currentSummary.unpaidAmount.toFixed(2)} AED
                </span>
                <span className={`${isMobile ? "text-xs" : "text-sm"} font-normal text-muted-foreground`}>{currentTotal.toFixed(2)} AED</span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className={isMobile ? "px-3 pb-3" : a4ReportPaperContentClass}>
            {orderData.currentDateOrders.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">No orders created in this period</p>
            ) : (
              renderOrderTable(orderData.currentDateOrders, "current", "text-blue-600")
            )}
          </CardContent>
        </Card>

        {(useA4ReportPaper || oldPaidPaymentEntries.length > 0) && (
          <Card className={`overflow-hidden ${a4ReportPaperCardClass}`} style={a4ReportPaperCardStyle}>
            <CardHeader className={isMobile ? "px-3 pb-2 pt-3" : `pb-3 ${a4ReportPaperHeaderClass}`}>
              <CardTitle className={`flex items-center gap-2 text-green-600 flex-wrap ${isMobile ? "text-[15px]" : ""}`}>
                <Wallet className={`${isMobile ? "w-4 h-4" : "w-5 h-5"}`} />
                Old Bill Payments in This Period ({oldPaidPaymentEntries.length})
                {renderSectionExportButtons(
                  "old-paid",
                  exportOldPaidBillsToExcel,
                  exportOldPaidBillsToPDF,
                  oldPaidPaymentEntries.length === 0,
                )}
                <span className={`${isMobile ? "text-xs ml-0 w-full" : "text-sm ml-auto"} font-normal text-muted-foreground`}>{oldPaidTotal.toFixed(2)} AED</span>
              </CardTitle>
            </CardHeader>
            <CardContent
              className={`${isMobile ? "px-3 pb-3" : a4ReportPaperContentClass} relative space-y-3`}
              aria-busy={isMovingPayments}
              data-clock-overlay-root
            >
              {isMovingPayments && (
                <div
                  className="absolute inset-0 z-20 flex items-center justify-center bg-background/85 px-4 backdrop-blur-[2px]"
                  role="alert"
                  aria-live="assertive"
                >
                  <div className="w-full max-w-md rounded-2xl border border-border bg-card/95 p-5 text-center shadow-xl">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                    <p className="mt-3 text-sm font-semibold text-foreground">
                      Do not interrupt while moving bills payment. It will be halted.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Please wait until all selected bill payments finish moving.
                    </p>
                  </div>
                </div>
              )}
              {oldPaidPaymentEntries.length > 0 && selectedOldPaidPaymentCount > 0 && (
                <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md flex-wrap">
                  <span className="text-sm font-medium">{selectedOldPaidPaymentCount} selected</span>
                  <span className="text-sm text-muted-foreground">- Move payment date/time to:</span>
                  <div
                    className="flex items-center gap-1.5"
                    data-testid="input-move-payment-date-time"
                  >
                    <CenteredDatePicker
                      value={movePaymentDatePart}
                      onChange={(date) => {
                        setMovePaymentDateTimeValue(`${date}T${movePaymentTimePart}`);
                        setMovePaymentError("");
                      }}
                      testIdPrefix="move-payment-"
                      triggerClassName="h-8 w-[132px] justify-center px-2 text-sm"
                      triggerTestId="input-move-payment-date"
                      hideQuickOptions
                    />
                    <AnalogClockPicker
                      value={movePaymentTimePart}
                      onChange={(time) => {
                        setMovePaymentDateTimeValue(`${movePaymentDatePart}T${time}`);
                        setMovePaymentError("");
                      }}
                      testIdPrefix="move-payment-"
                      floatingPlacement="container-center"
                      floatingBoundarySelector="[data-clock-overlay-root]"
                      triggerClassName="h-8 w-[104px] justify-center px-2 text-sm"
                    />
                  </div>
                  <Popover
                    open={movePaymentConfirmOpen}
                    onOpenChange={(open) => {
                      setMovePaymentConfirmOpen(open);
                      if (!open && !isMovingPayments) {
                        setMovePaymentError("");
                      }
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        size="sm"
                        disabled={!movePaymentDateTimeValue || isMovingPayments}
                        data-testid="button-move-payment-dates"
                      >
                        {isMovingPayments ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                        Move
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 space-y-3" align="start">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">Confirm payment date move</p>
                        <p className="text-xs text-muted-foreground">
                          Enter admin PIN to move {selectedOldPaidPaymentCount} payment{selectedOldPaidPaymentCount === 1 ? "" : "s"}.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="move-payment-admin-pin" className="text-sm">Admin PIN</Label>
                        <Input
                          id="move-payment-admin-pin"
                          type="password"
                          inputMode="numeric"
                          maxLength={5}
                          value={movePaymentPin}
                          onChange={(e) => {
                            setMovePaymentPin(e.target.value.replace(/\D/g, "").slice(0, 5));
                            setMovePaymentError("");
                          }}
                          placeholder="Enter admin PIN"
                          data-testid="input-move-payment-pin"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && movePaymentPin.trim() && !isMovingPayments) {
                              handleMovePaymentDates(oldPaidPaymentEntries);
                            }
                          }}
                        />
                      </div>
                      {movePaymentError ? (
                        <div className="text-xs text-destructive">{movePaymentError}</div>
                      ) : null}
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setMovePaymentConfirmOpen(false);
                            setMovePaymentError("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          disabled={!movePaymentPin.trim() || isMovingPayments}
                          onClick={() => handleMovePaymentDates(oldPaidPaymentEntries)}
                          data-testid="button-confirm-move-payment-dates"
                        >
                          {isMovingPayments ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                          Confirm Move
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={revertSalesReportBillPaymentMutation.isPending}
                    onClick={() =>
                      openSalesReportPaymentsRevertDialog(
                        selectedOldPaidPaymentIdsForPeriod,
                        `${selectedOldPaidPaymentCount} old bill payment${selectedOldPaidPaymentCount === 1 ? "" : "s"}`,
                      )
                    }
                    data-testid="button-revert-selected-old-paid-payments"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    Revert
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setSelectedOldPaidPayments(new Set()); setMovePaymentDateTimeValue(""); setMovePaymentPin(""); setMovePaymentError(""); setMovePaymentConfirmOpen(false); }}>
                    Cancel
                  </Button>
                </div>
              )}
              {oldPaidPaymentEntries.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No old bill payments found for this period.
                </p>
              ) : (
              <div
                ref={salesReportOldPaidTableRef}
                tabIndex={-1}
                onMouseEnter={() => {
                  hoveredSalesReportTableRef.current = "old-paid";
                }}
                onMouseLeave={() => {
                  if (hoveredSalesReportTableRef.current === "old-paid") {
                    hoveredSalesReportTableRef.current = null;
                  }
                }}
                className={isMobile ? mobileCompactReportTableShellClass : a4ReportTableShellClass}
              >
                <Table className={isMobile ? mobileCompactReportTableClass : useA4ReportPaper ? "screen-a4-table screen-a4-old-paid-table" : undefined}>
                  <TableHeader>
                    {isMobile ? (
                      <TableRow>
                        <TableHead className="w-[28px] px-1">
                          <Checkbox
                            checked={
                              selectedOldPaidPaymentCount === oldPaidPaymentEntries.length && oldPaidPaymentEntries.length > 0
                                ? true
                                : selectedOldPaidPaymentCount > 0
                                  ? "indeterminate"
                                  : false
                            }
                            disabled={isMovingPayments}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedOldPaidPayments(
                                  new Set(
                                    oldPaidPaymentEntries
                                      .map((entry) => Number(entry.payment?.id || 0))
                                      .filter((paymentId) => Number.isFinite(paymentId) && paymentId > 0),
                                  ),
                                );
                              } else {
                                setSelectedOldPaidPayments(new Set());
                              }
                            }}
                            data-testid="checkbox-select-all-old-paid"
                          />
                        </TableHead>
                        <TableHead className="w-[26px] px-1">#</TableHead>
                        <TableHead>Order / Customer</TableHead>
                        <TableHead className="w-[68px] text-center">Priority</TableHead>
                        <TableHead className="w-[82px] text-right">Paid</TableHead>
                      </TableRow>
                    ) : (
                      <TableRow>
                        <TableHead className="w-8">
                          <Checkbox
                            checked={
                              selectedOldPaidPaymentCount === oldPaidPaymentEntries.length && oldPaidPaymentEntries.length > 0
                                ? true
                                : selectedOldPaidPaymentCount > 0
                                  ? "indeterminate"
                                  : false
                            }
                            disabled={isMovingPayments}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedOldPaidPayments(
                                  new Set(
                                    oldPaidPaymentEntries
                                      .map((entry) => Number(entry.payment?.id || 0))
                                      .filter((paymentId) => Number.isFinite(paymentId) && paymentId > 0),
                                  ),
                                );
                              } else {
                                setSelectedOldPaidPayments(new Set());
                              }
                            }}
                            data-testid="checkbox-select-all-old-paid"
                          />
                        </TableHead>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Order #</TableHead>
                        <TableHead>Customer</TableHead>
	                        <TableHead className="text-center">Priority</TableHead>
	                        <TableHead className="text-right">Work Rec.</TableHead>
	                        <TableHead className="text-right">Delivery</TableHead>
	                        <TableHead className="text-right">Discount</TableHead>
                        <TableHead className="text-right">Final Amount</TableHead>
                        <TableHead className="text-center">Created</TableHead>
                        <TableHead className="text-right">Paid Amount</TableHead>
                        <TableHead className="text-center">Payment Status</TableHead>
                        <TableHead className="text-center">Order Status</TableHead>
                      </TableRow>
                    )}
                  </TableHeader>
                  <TableBody>
                    {oldPaidPaymentEntries.map((entry, index) => {
                      const { order, payment, bill, client } = entry;
                      const workflowStatus = getOrderStatus(order);
                      const paymentStatus = getSalesPaymentStatusMeta(payment, bill);
                      const paidDate = payment?.paymentDate ? new Date(payment.paymentDate) : null;
                      const paymentDateColorClass = paidDate
                        ? paymentStatus.label === "Partially Paid"
                          ? "text-amber-600"
                          : paymentStatus.label === "Fully Paid"
                            ? "text-green-600"
                            : "text-muted-foreground"
                        : "text-muted-foreground";
                      const amounts = getOrderBillAmounts(order);
                      const paymentAmount = parseFloat(String(payment?.amount || "0"));
                      const partialDateLabel = getSalesPaymentPartialDateLabel(paymentStatus, formatShortDate);
                      const paidDateLabel = paidDate
                        ? partialDateLabel
                          ? getSalesPaymentPaidDateLabel(paidDate, formatShortDate)
                          : formatShortDate(paidDate)
                        : "No payment yet";
                      if (isMobile) {
                        const isSelected = selectedOldPaidPayments.has(Number(payment.id || 0));
                        return (
                          <TableRow
                            key={`${order.id}-${payment.id}`}
                            className={isSelected ? "bg-muted/40" : ""}
                            onClickCapture={(event) =>
                              handleSalesReportShortcutSelection(event, () =>
                                toggleOldPaidPaymentSelection(Number(payment.id || 0)),
                              )
                            }
                          >
                            <TableCell className="px-1">
                              <Checkbox
                                checked={isSelected}
                                disabled={isMovingPayments}
                                onCheckedChange={() => toggleOldPaidPaymentSelection(Number(payment.id || 0))}
                                data-testid={`checkbox-old-paid-${payment.id}`}
                              />
                            </TableCell>
                            <TableCell className="px-1 font-medium text-muted-foreground" data-testid={`text-oldpaid-order-count-${index}`}>
                              {index + 1}
                            </TableCell>
                            <TableCell>
                              <div className="compact-main-line font-mono">{order.orderNumber}</div>
                              <div className="compact-muted-line">
                                {client?.name || order.customerName || "Walk-in"}
                                {client?.billNumber ? ` (${client.billNumber})` : ""}
                                {order.deliveryType === "delivery" ? " (D)" : " (T)"}
                              </div>
                              <div className="compact-muted-line" data-testid={`text-created-oldpaid-${payment.id}`}>
                                {order.entryDate ? formatShortDate(order.entryDate) : "-"}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              {order.urgent ? (
                                <Badge variant="outline" className="compact-nowrap gap-0.5 border-red-300 bg-red-100 px-1.5 py-0 text-[10px] text-red-600 dark:border-red-700 dark:bg-red-900/30 dark:text-red-400">
                                  <Zap className="h-2.5 w-2.5" /> Urgent
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="compact-nowrap gap-0.5 border-green-300 bg-green-100 px-1.5 py-0 text-[10px] text-green-600 dark:border-green-700 dark:bg-green-900/30 dark:text-green-400">
                                  <Clock className="h-2.5 w-2.5" /> Normal
                                </Badge>
                              )}
                              <div className="compact-muted-line compact-nowrap">Work: {amounts.originalAmount.toFixed(2)}</div>
	                              {amounts.deliveryCharge > 0.009 ? (
	                                <div className="compact-muted-line text-blue-600 dark:text-blue-400" data-testid={`text-delivery-charge-oldpaid-${payment.id}`}>
	                                  Delivery: {amounts.deliveryCharge.toFixed(2)}
	                                </div>
	                              ) : null}
	                              {amounts.discount > 0 ? (
                                <div className="compact-muted-line text-orange-600 dark:text-orange-400" data-testid={`text-discount-oldpaid-${payment.id}`}>
                                  Disc: -{amounts.discount.toFixed(2)}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="compact-nowrap font-semibold text-emerald-600">
                                {Number.isFinite(paymentAmount) ? `${paymentAmount.toFixed(2)} AED` : "-"}
                              </div>
                              <div className="compact-muted-line text-green-600">
                                Final: {amounts.finalAmount.toFixed(2)}
                              </div>
                              <Badge variant="outline" className={`mt-1 compact-nowrap px-1.5 py-0 text-[10px] ${paymentStatus.badgeClass}`} data-testid={`badge-payment-status-oldpaid-${payment.id}`}>
                                {paymentStatus.label}
                              </Badge>
                              <div className={`compact-muted-line ${paymentDateColorClass}`}>
                                {partialDateLabel || paidDateLabel}
                              </div>
                              <div className="compact-muted-line" data-testid={`badge-order-status-oldpaid-${payment.id}`}>
                                {workflowStatus.label}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }
                      return (
                        <TableRow
                          key={`${order.id}-${payment.id}`}
                          className={selectedOldPaidPayments.has(Number(payment.id || 0)) ? "bg-muted/40" : ""}
                          onClickCapture={(event) =>
                            handleSalesReportShortcutSelection(event, () =>
                              toggleOldPaidPaymentSelection(Number(payment.id || 0)),
                            )
                          }
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedOldPaidPayments.has(Number(payment.id || 0))}
                              disabled={isMovingPayments}
                              onCheckedChange={() => toggleOldPaidPaymentSelection(Number(payment.id || 0))}
                              data-testid={`checkbox-old-paid-${payment.id}`}
                            />
                          </TableCell>
                          <TableCell className="text-muted-foreground font-medium" data-testid={`text-oldpaid-order-count-${index}`}>{index + 1}</TableCell>
                          <TableCell className="font-mono">{order.orderNumber}</TableCell>
                          <TableCell>
                            {client?.name || order.customerName || 'Walk-in'}
                            {client?.billNumber && <span className="ml-1 text-xs text-muted-foreground">({client.billNumber})</span>}
                            {order.deliveryType === 'delivery' ? <span className="ml-1 text-xs text-orange-500">(D)</span> : <span className="ml-1 text-xs text-cyan-500">(T)</span>}
                          </TableCell>
                          <TableCell className="text-center">
                            {order.urgent ? (
                              <Badge variant="outline" className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-300 dark:border-red-700 gap-0.5">
                                <Zap className="w-3 h-3" /> Urgent
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 border-green-300 dark:border-green-700 gap-0.5">
                                <Clock className="w-3 h-3" /> Normal
                              </Badge>
                            )}
                          </TableCell>
	                          <TableCell className="text-right font-semibold text-muted-foreground">
	                            {amounts.originalAmount.toFixed(2)} AED
	                          </TableCell>
	                          <TableCell className="text-right text-xs">
	                            {amounts.deliveryCharge > 0.009 ? (
	                              <span className="font-medium text-blue-600 dark:text-blue-400" data-testid={`text-delivery-charge-oldpaid-${payment.id}`}>
	                                {amounts.deliveryCharge.toFixed(2)}
	                              </span>
	                            ) : (
	                              <span className="text-muted-foreground">-</span>
	                            )}
	                          </TableCell>
	                          <TableCell className="text-right text-xs">
                            {amounts.discount > 0 ? (
                              <span className="text-orange-600 dark:text-orange-400 font-medium" data-testid={`text-discount-oldpaid-${payment.id}`}>
                                -{amounts.discount.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-green-600">
                            {amounts.finalAmount.toFixed(2)} AED
                          </TableCell>
                          <TableCell className="text-center text-xs text-muted-foreground" data-testid={`text-created-oldpaid-${payment.id}`}>
                            {order.entryDate ? formatShortDate(order.entryDate) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-emerald-600">
                            {Number.isFinite(paymentAmount) ? `${paymentAmount.toFixed(2)} AED` : "-"}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex flex-col items-center gap-1">
                              <Badge variant="outline" className={`text-xs ${paymentStatus.badgeClass}`} data-testid={`badge-payment-status-oldpaid-${payment.id}`}>
                                {paymentStatus.label}
                              </Badge>
                              {partialDateLabel ? (
                                <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
                                  {partialDateLabel}
                                </span>
                              ) : null}
                              <span className={`text-[11px] ${paymentDateColorClass}`}>
                                {paidDateLabel}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className={`text-xs ${workflowStatus.color}`} data-testid={`badge-order-status-oldpaid-${payment.id}`}>
                              {workflowStatus.label}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              )}
            </CardContent>
          </Card>
        )}

        {(useA4ReportPaper || visibleDeposits.length > 0) && (
          <Card className={a4ReportPaperCardClass} style={a4ReportPaperCardStyle}>
            <CardHeader className={isMobile ? "px-3 pb-2 pt-3" : `pb-3 ${a4ReportPaperHeaderClass}`}>
              <CardTitle className={`flex items-center gap-2 text-green-600 flex-wrap ${isMobile ? "text-[15px]" : ""}`}>
                <Banknote className={`${isMobile ? "w-4 h-4" : "w-5 h-5"}`} />
                Total Sales ({visibleDeposits.length})
                {renderSectionExportButtons(
                  "total-sales",
                  exportTotalSalesToExcel,
                  exportTotalSalesToPDF,
                  visibleDeposits.length === 0,
                )}
                <span className={`${isMobile ? "text-xs ml-0 w-full" : "text-sm ml-auto"} font-normal text-muted-foreground`}>{depositsTotal.toFixed(2)} AED</span>
              </CardTitle>
            </CardHeader>
            <CardContent className={isMobile ? "px-3 pb-3" : a4ReportPaperContentClass}>
              {visibleDeposits.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No paid sales found for this period.</p>
              ) : (
                renderDepositsTable(visibleDeposits)
              )}
            </CardContent>
          </Card>
        )}

        {creditData ? renderCreditManagementTable(creditData) : null}
      </div>
    );
  };

  const hasExternalDates = !!externalActiveTab;

  if (creditOnly) {
    return (
      <div className={`space-y-4 ${embedded ? "" : "container mx-auto px-4 py-6"}`}>
        <div className={`flex items-center justify-between flex-wrap ${isMobile ? "gap-2" : "gap-4"}`}>
          <div className={isMobile ? "w-full space-y-1" : "space-y-1"}>
            <div className={isMobile ? "flex items-center justify-between gap-2" : ""}>
              <h2 className={`${isMobile ? "min-w-0 text-lg" : "text-xl"} font-display font-bold text-foreground flex items-center gap-2`}>
                <Wallet className={`${isMobile ? "w-4 h-4" : "w-5 h-5"} flex-shrink-0 text-amber-600`} />
                <span className={isMobile ? "truncate" : ""}>{creditManagementLogLabel}</span>
              </h2>
            </div>
            <p className="text-sm text-muted-foreground">{creditManagementLogDescription}</p>
          </div>
        </div>

        {isLoadingCreditTransactions ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
          </div>
        ) : creditTransactionsError ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-destructive">
              Failed to load {creditManagementLogLabel} data.{" "}
              {creditTransactionsLooksLikeHtmlResponse
                ? "The API returned HTML instead of JSON. Restart the development server so the backend route reloads, then refresh this page."
                : creditTransactionsErrorMessage}
            </CardContent>
          </Card>
        ) : (
          renderCreditManagementTable(liveCreditManagementData)
        )}
      </div>
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
      {!hasExternalDates && (
      <div className="sticky top-0 z-30 w-full bg-card border-b border-border shadow-sm">
        <div className="px-6 py-4 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-primary" />
              Sales Reports
            </h1>
            <div className="flex items-center gap-3 flex-wrap">
              {activeTab === "daily" && (
                <div className="flex items-center gap-2 bg-primary/10 px-3 py-2 rounded-lg">
                  <Calendar className="w-4 h-4 text-primary" />
                  <Label htmlFor="header-date" className="text-sm font-medium">Date:</Label>
                  <Input
                    id="header-date"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-40 h-8"
                    data-testid="input-header-daily-date"
                  />
                </div>
              )}
              {activeTab === "monthly" && (
                <div className="flex items-center gap-2 bg-primary/10 px-3 py-2 rounded-lg">
                  <CalendarDays className="w-4 h-4 text-primary" />
                  <Label htmlFor="header-month" className="text-sm font-medium">Month:</Label>
                  <Input
                    id="header-month"
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-40 h-8"
                    data-testid="input-header-monthly-date"
                  />
                </div>
              )}
              {activeTab === "yearly" && (
                <div className="flex items-center gap-2 bg-primary/10 px-3 py-2 rounded-lg">
                  <CalendarRange className="w-4 h-4 text-primary" />
                  <Label htmlFor="header-year" className="text-sm font-medium">Year:</Label>
                  <Input
                    id="header-year"
                    type="number"
                    min="2020"
                    max="2030"
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="w-24 h-8"
                    data-testid="input-header-yearly-date"
                  />
                </div>
              )}
              {activeTab === "range" && (
                <div className="flex items-center gap-2 bg-primary/10 px-3 py-2 rounded-lg">
                  <DateTimeRangePicker
                    start={startDate}
                    end={endDate}
                    onChange={(nextStart, nextEnd) => {
                      setStartDate(nextStart);
                      setEndDate(nextEnd);
                    }}
                  />
                </div>
              )}
            </div>
          </div>
          <TabsList>
            <TabsTrigger value="daily" className="gap-2">
              <Calendar className="w-4 h-4" />
              Daily
            </TabsTrigger>
            <TabsTrigger value="monthly" className="gap-2">
              <CalendarDays className="w-4 h-4" />
              Monthly
            </TabsTrigger>
            <TabsTrigger value="yearly" className="gap-2">
              <CalendarRange className="w-4 h-4" />
              Yearly
            </TabsTrigger>
            <TabsTrigger value="range" className="gap-2">
              <CalendarRange className="w-4 h-4" />
              Date Range
            </TabsTrigger>
                      </TabsList>
        </div>
      </div>
      )}
      {hasExternalDates && (
        <div className={`flex items-center justify-between flex-wrap ${isMobile ? "gap-2 mb-3" : "gap-4 mb-4"}`}>
          <h2 className={`${isMobile ? "text-lg" : "text-xl"} font-display font-bold text-foreground flex items-center gap-2`}>
            <TrendingUp className={`${isMobile ? "w-4 h-4" : "w-5 h-5"} text-primary`} />
            Sales Reports
          </h2>
          <div className={`flex items-center ${isMobile ? "w-full flex-nowrap gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "flex-wrap gap-2"}`}>
            <Button
              size="sm"
              variant="outline"
              onClick={exportToExcel}
              disabled={isLoading}
              data-testid="button-export-excel"
              className={isMobile ? "h-8 flex-none rounded-lg px-2 gap-1 !text-[11px]" : "gap-1"}
            >
              <FileSpreadsheet className={isMobile ? "w-3.5 h-3.5" : "w-4 h-4"} />
              {isMobile ? "Full XLS" : "Full Excel"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={exportPortraitSalesReportToPDF}
              disabled={isLoading}
              data-testid="button-export-pdf"
              className={isMobile ? "h-8 flex-none rounded-lg px-2 gap-1 !text-[11px]" : "gap-1"}
            >
              <Download className={isMobile ? "w-3.5 h-3.5" : "w-4 h-4"} />
              Full PDF
            </Button>
          </div>
        </div>
      )}

      <main className={`flex-1 container mx-auto overflow-auto ${isMobile ? "px-2.5 py-3" : "px-4 py-6"}`}>
          <TabsContent value="daily">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
              </div>
            ) : (
              <>
                {renderOrderSummaryCards(currentOrderData, currentSalesData.rawDeposits)}
                {renderOrderTables(currentOrderData, currentSalesData.deposits)}
              </>
            )}
          </TabsContent>

          <TabsContent value="monthly">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
              </div>
            ) : (
              <>
                {renderOrderSummaryCards(currentOrderData, currentSalesData.rawDeposits)}
                {renderOrderTables(currentOrderData, currentSalesData.deposits)}
              </>
            )}
          </TabsContent>

          <TabsContent value="yearly">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
              </div>
            ) : (
              <>
                {renderOrderSummaryCards(currentOrderData, currentSalesData.rawDeposits)}
                {renderOrderTables(currentOrderData, currentSalesData.deposits)}
              </>
            )}
          </TabsContent>

          <TabsContent value="range">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
              </div>
            ) : (
              <>
                {renderOrderSummaryCards(currentOrderData, currentSalesData.rawDeposits)}
                {renderOrderTables(currentOrderData, currentSalesData.deposits)}
              </>
            )}
          </TabsContent>
      </main>

      {isMovingPayments && (
        <div
          className="fixed inset-0 z-[100] flex cursor-wait items-center justify-center bg-background/85 px-4 backdrop-blur-[2px]"
          role="alert"
          aria-live="assertive"
          aria-busy="true"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onWheel={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-5 text-center shadow-2xl">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
            <p className="mt-3 text-sm font-semibold text-foreground">
              Moving payment dates...
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Please wait until selected bill payments finish moving.
            </p>
          </div>
        </div>
      )}

      <Dialog
        open={bulkOrderDateEditDialog}
        onOpenChange={(open) => {
          if (open) {
            setBulkOrderDateEditDialog(true);
          } else {
            resetBulkOrderDateEditDialog();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-indigo-600">
              <Calendar className="w-5 h-5" />
              Bulk Edit Order Date/Time
            </DialogTitle>
            <DialogDescription>
              Apply a target date/time to the checked stages for {selectedCurrentOrders.length} selected order{selectedCurrentOrders.length === 1 ? "" : "s"}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label className="text-sm">Target Date & Time</Label>
              <Input
                type="datetime-local"
                value={bulkOrderDateEditValue}
                onChange={(e) => {
                  setBulkOrderDateEditValue(e.target.value);
                  setBulkOrderDateEditError("");
                }}
                data-testid="input-sales-report-bulk-date-edit-value"
              />
            </div>

            <div>
              <Label className="text-sm">Reason</Label>
              <Input
                value={bulkOrderDateEditReason}
                onChange={(e) => setBulkOrderDateEditReason(e.target.value)}
                placeholder="Reason for date change"
                data-testid="input-sales-report-bulk-date-edit-reason"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Apply target date/time to these stages</Label>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="sales-report-bulk-date-edit-shift-tag"
                    checked={bulkOrderDateEditShiftTagDate}
                    onCheckedChange={(value) => setBulkOrderDateEditShiftTagDate(value === true)}
                    data-testid="checkbox-sales-report-bulk-date-edit-shift-tag"
                  />
                  <Label htmlFor="sales-report-bulk-date-edit-shift-tag" className="text-sm cursor-pointer">
                    Entry and Tag
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="sales-report-bulk-date-edit-shift-pack"
                    checked={bulkOrderDateEditShiftPackDate}
                    onCheckedChange={(value) => setBulkOrderDateEditShiftPackDate(value === true)}
                    data-testid="checkbox-sales-report-bulk-date-edit-shift-pack"
                  />
                  <Label htmlFor="sales-report-bulk-date-edit-shift-pack" className="text-sm cursor-pointer">
                    Pack
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="sales-report-bulk-date-edit-shift-delivery"
                    checked={bulkOrderDateEditShiftDeliveryDate}
                    onCheckedChange={(value) => setBulkOrderDateEditShiftDeliveryDate(value === true)}
                    data-testid="checkbox-sales-report-bulk-date-edit-shift-delivery"
                  />
                  <Label htmlFor="sales-report-bulk-date-edit-shift-delivery" className="text-sm cursor-pointer">
                    Delivery
                  </Label>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                If Entry and Tag is selected, unchecked Pack and Delivery keep their original date and update only the time. Otherwise, unchecked stages stay unchanged.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="sales-report-bulk-date-edit-spacing"
                checked={bulkOrderDateEditPreserveSpacing}
                onCheckedChange={(value) => setBulkOrderDateEditPreserveSpacing(value === true)}
                data-testid="checkbox-sales-report-bulk-date-edit-spacing"
              />
              <Label htmlFor="sales-report-bulk-date-edit-spacing" className="text-sm cursor-pointer">
                Preserve order spacing
              </Label>
            </div>

            {bulkOrderDateEditPreserveSpacing && (
              <div>
                <Label className="text-sm">Spacing (minutes)</Label>
                <Input
                  type="number"
                  min="0"
                  value={bulkOrderDateEditSpacingMinutes}
                  onChange={(e) => setBulkOrderDateEditSpacingMinutes(e.target.value)}
                  data-testid="input-sales-report-bulk-date-edit-spacing"
                />
              </div>
            )}

            <div>
              <Label className="text-sm">Admin PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={5}
                value={bulkOrderDateEditPin}
                onChange={(e) => {
                  setBulkOrderDateEditPin(e.target.value.replace(/\D/g, "").slice(0, 5));
                  setBulkOrderDateEditError("");
                }}
                placeholder="Enter admin PIN"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleConfirmBulkCurrentOrderDateEdit();
                  }
                }}
                data-testid="input-sales-report-bulk-date-edit-pin"
              />
            </div>

            {bulkOrderDateEditError && <p className="text-xs text-destructive">{bulkOrderDateEditError}</p>}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={resetBulkOrderDateEditDialog}
            >
              Cancel
            </Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handleConfirmBulkCurrentOrderDateEdit}
              disabled={bulkOrderDateEditing}
              data-testid="button-confirm-sales-report-bulk-date-edit"
            >
              {bulkOrderDateEditing ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  Saving...
                </>
              ) : (
                <>
                  <Calendar className="w-3 h-3 mr-1" />
                  Update Dates
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!salesReportBillDetailsEntry}
        onOpenChange={(open) => {
          if (!open) {
            setSalesReportBillDetailsEntry(null);
          }
        }}
      >
        <DialogContent className="w-[min(96vw,44rem)] max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>Bill Details</DialogTitle>
            <DialogDescription>Read-only bill details from the sales report.</DialogDescription>
          </DialogHeader>
          {(() => {
            const billId = Number(salesReportBillDetailsEntry?.billId || 0);
            const bill = getBillById(billId) || null;

            if (!bill) {
              return (
                <div className="py-6 text-sm text-muted-foreground">
                  Bill details are not available for this sale.
                </div>
              );
            }

            const client = getClientById(bill.clientId) || getClientById(salesReportBillDetailsEntry?.clientId) || null;
            const linkedOrder = getSalesPaymentLinkedOrder({ billId: bill.id });
            const displayAmounts = getSalesReportBillDisplayAmounts(bill);
            const statusMeta = getSalesReportBillStatusMeta(bill);
            const latestPaymentDate = getSalesReportBillLatestPaymentDate(bill.id);
            const partialHistoryMeta = getSalesBillPartialHistoryMeta(bill.id);
            const customerName =
              bill.customerName || client?.name || salesReportBillDetailsEntry?.clientName || "Walk-in";
            const accountLabel = String(client?.billNumber || "").trim();
            const addressText = linkedOrder
              ? getOrderCustomerAddress(linkedOrder, client)
              : getPaymentCustomerAddress(salesReportBillDetailsEntry, client);
            const phoneText = linkedOrder
              ? getOrderCustomerPhone(linkedOrder, client)
              : getPaymentCustomerPhone(salesReportBillDetailsEntry, client);
            const paymentMethodLabel = formatSalesPaymentMethodLabel(
              bill.paymentMethod || salesReportBillDetailsEntry?.paymentMethod,
            );
            const isBroker = String((client as any)?.clientType || "").trim().toLowerCase() === "broker";
            const accountBadgeLabel = isBroker
              ? "Broker Account"
              : client?.company
                ? `Company: ${client.company}`
                : "Regular Account";
            const parsedItems = parseSalesReportDescriptionItems(String(bill.description || ""), products);
            const hasPaidAmount = displayAmounts.paidAmount > 0.01;

            return (
              <div className="space-y-3">
                <div className={`relative overflow-hidden rounded-[22px] border shadow-[0_18px_40px_-32px_rgba(15,23,42,0.38)] ${statusMeta.cardClass}`}>
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
                              {bill.referenceNumber ? (
                                <span className="truncate rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-border/60">
                                  Ref {bill.referenceNumber}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                              <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                Bill #{bill.id}
                              </span>
                              <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                {formatSalesReportBillHeaderDate(bill.billDate)}
                              </span>
                              {accountLabel ? (
                                <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                  Acc {accountLabel}
                                </span>
                              ) : null}
                              {bill.createdBy ? (
                                <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                  By {bill.createdBy}
                                </span>
                              ) : null}
                              {partialHistoryMeta.firstPartialPaymentDate ? (
                                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300">
                                  Partial {formatSalesReportBillChipDate(partialHistoryMeta.firstPartialPaymentDate)}
                                </span>
                              ) : null}
                              {latestPaymentDate ? (
                                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                                  Paid {formatSalesReportBillChipDate(latestPaymentDate)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <Badge className={`text-[10px] shadow-sm ${statusMeta.badgeClass}`}>
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
                    <p className={isMobile ? "truncate text-lg font-bold" : "text-xl font-bold"}>
                      {customerName}
                      {accountLabel ? (
                        <span className="ml-2 text-sm font-normal text-muted-foreground">({accountLabel})</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Bill #</span>
                      <span className="font-medium">#{bill.id}</span>
                    </div>
                    {accountLabel ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Bill Number</span>
                        <span className="font-medium">{accountLabel}</span>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Created On</span>
                      <span className="font-medium">{formatShortDate(bill.billDate)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Paid On</span>
                      <span className={latestPaymentDate ? "font-medium text-green-600" : "text-muted-foreground"}>
                        {latestPaymentDate ? formatShortDate(latestPaymentDate) : "-"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        {accountBadgeLabel}
                      </Badge>
                    </div>
                    {client?.company ? (
                      <div className="flex items-center gap-2 text-sm text-blue-600">
                        <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{client.company}</span>
                      </div>
                    ) : null}
                    {phoneText ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{phoneText}</span>
                      </div>
                    ) : null}
                    {addressText ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{addressText}</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className={`grid gap-3 ${bill.isPaid || hasPaidAmount ? "grid-cols-3" : "grid-cols-2"}`}>
                  <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                    <p className="text-xs text-muted-foreground">Work Received</p>
                    <p className="text-2xl font-bold text-primary">
                      {displayAmounts.originalAmount.toFixed(2)} <span className="text-sm">AED</span>
                    </p>
                    {displayAmounts.discount > 0 ? (
                      <div className="mt-1">
                        <p className="text-xs text-orange-600">Disc: -{displayAmounts.discount.toFixed(2)}</p>
                        <p className="text-sm font-semibold text-green-700">Final: {displayAmounts.finalAmount.toFixed(2)} AED</p>
                      </div>
                    ) : null}
                  </div>
                  <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="text-lg font-semibold">
                      {formatSalesReportBillHeaderDate(bill.billDate)}
                    </p>
                  </div>
                  {(bill.isPaid || hasPaidAmount) ? (
                    <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                      <p className="text-xs text-muted-foreground mb-1">Payment Method</p>
                      <div className="flex min-h-9 items-center rounded-md border bg-background px-3 py-1 text-sm font-medium leading-5">
                        <span className="whitespace-normal break-words">
                          {paymentMethodLabel}
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>

                {bill.description ? (
                  <BillItemsPopover
                    items={parsedItems}
                    rawDescription={bill.description}
                    title={`Bill #${bill.id} Items`}
                    subtitle={`${customerName} - ${formatSalesReportBillHeaderDate(bill.billDate)}`}
                    dataTestId={`button-sales-report-bill-items-popover-${bill.id}`}
                    disablePortal
                  />
                ) : null}

                {(bill as any).notes ? (
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
                    <p className="text-xs text-blue-700 dark:text-blue-400 font-semibold mb-2">History</p>
                    <div className="text-xs text-blue-600 dark:text-blue-300 whitespace-pre-wrap">
                      {(bill as any).notes}
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2 pt-2">
                  {(bill.isPaid || hasPaidAmount) ? (
                    <Button
                      variant="destructive"
                      className="flex-1"
                      disabled={revertSalesReportBillPaymentMutation.isPending}
                      onClick={() => openSalesReportRevertDialog(bill.id)}
                      data-testid="button-revert-payment-sales-report-bill"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      {revertSalesReportBillPaymentMutation.isPending ? "Reverting..." : "Revert Payment"}
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setSalesReportBillDetailsEntry(null);
                      setLocation(`/bills?printBill=${bill.id}`);
                    }}
                    data-testid="button-print-sales-report-bill"
                  >
                    <Printer className="w-4 h-4 mr-2" />
                    Print
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setSalesReportBillDetailsEntry(null)}
                    data-testid="button-close-sales-report-bill"
                  >
                    Close
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!salesReportRevertBillId || !!salesReportRevertPaymentIds?.length}
        onOpenChange={(open) => {
          if (!open && !revertSalesReportBillPaymentMutation.isPending) {
            setSalesReportRevertBillId(null);
            setSalesReportRevertPaymentIds(null);
            setSalesReportRevertTargetLabel("payment");
            setSalesReportRevertPin("");
            setSalesReportRevertError("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {salesReportRevertPaymentIds?.length ? "Revert Selected Payments" : "Revert Bill Payment"}
            </DialogTitle>
            <DialogDescription>
              {salesReportRevertPaymentIds?.length
                ? `This will reset linked bills for ${salesReportRevertTargetLabel} to unpaid and remove their payment records. Enter the admin PIN to confirm.`
                : "This will reset the bill to unpaid and remove payment records. Enter the admin PIN to confirm."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Admin PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={5}
                value={salesReportRevertPin}
                onChange={(event) => {
                  setSalesReportRevertPin(event.target.value.replace(/\D/g, "").slice(0, 5));
                  setSalesReportRevertError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    confirmSalesReportBillRevert();
                  }
                }}
                placeholder="Enter 5-digit admin PIN"
                data-testid="input-sales-report-revert-payment-pin"
              />
              {salesReportRevertError ? (
                <p className="mt-1 text-xs text-destructive">{salesReportRevertError}</p>
              ) : null}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSalesReportRevertBillId(null);
                setSalesReportRevertPaymentIds(null);
                setSalesReportRevertTargetLabel("payment");
                setSalesReportRevertPin("");
                setSalesReportRevertError("");
              }}
              disabled={revertSalesReportBillPaymentMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revertSalesReportBillPaymentMutation.isPending}
              onClick={confirmSalesReportBillRevert}
              data-testid="button-confirm-sales-report-revert-payment"
            >
              {revertSalesReportBillPaymentMutation.isPending
                ? "Reverting..."
                : salesReportRevertPaymentIds?.length
                  ? "Revert Payments"
                  : "Revert Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
