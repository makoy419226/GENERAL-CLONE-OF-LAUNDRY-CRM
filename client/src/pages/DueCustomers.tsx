import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { DateTimeRangePicker } from "@/components/ui/DateTimeRangePicker";
import { useClients } from "@/hooks/use-clients";
import { useBills } from "@/hooks/use-bills";
import { useProducts } from "@/hooks/use-products";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Loader2,
  Phone,
  Search,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  FileText,
  Package,
  Receipt,
  DollarSign,
  Printer,
  MapPin,
  Building2,
  User,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { BillItemsPopover } from "@/components/BillItemsPopover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, isAfter, isSameDay, startOfMonth, startOfYear } from "date-fns";
import type { Bill, Client, Order, Product } from "@shared/schema";

const DUE_CUSTOMERS_INITIAL_LOAD_COUNT = 50;
const DUE_CUSTOMERS_LOAD_MORE_COUNT = 30;
const DUE_CUSTOMERS_LOAD_MORE_THRESHOLD_PX = 160;

function extractDueBillOrderNumber(bill: {
  referenceNumber?: string | null;
  description?: string | null;
}): string | null {
  const candidates = [bill.referenceNumber, bill.description];

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text) continue;

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
  }

  return null;
}

function formatDueBillReferenceLabel(bill: {
  id: number;
  referenceNumber?: string | null;
  description?: string | null;
}): string {
  const orderNumber = extractDueBillOrderNumber(bill);
  const compactOrderNumber = orderNumber?.replace(/^ORD-/i, "") || null;
  return compactOrderNumber ? `BILL#${bill.id} - ${compactOrderNumber}` : `BILL#${bill.id}`;
}

function parseSqmDescriptionPart(
  part: string,
  products?: Product[],
): { name: string; qty: number; sqm: number; price: number; total: number } | null {
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

  const sqmDisplayName = cleanName.replace(/\s*\(per\s*SQ\s*MTR\)\s*$/i, "").trim();
  const baseName = /\(per\s*SQ\s*MTR\)/i.test(cleanName)
    ? cleanName
    : `${cleanName} (per SQ MTR)`;

  return {
    name: `${sqm} sqm ${sqmDisplayName === cleanName ? baseName : sqmDisplayName}`.trim(),
    qty,
    sqm,
    price: Number.isFinite(linePrice) ? linePrice : 0,
    total: Number.isFinite(linePrice) ? qty * linePrice : 0,
  };
}

function stripEmbeddedItemPriceText(name: string): string {
  return String(name || "")
    .replace(/\s*\(base\s*[\d.]+\s*AED\)/gi, "")
    .replace(/\s*@\s*[\d.]+\s*AED(?:\s*\((custom|min\s*50|admin\s*edited)\))?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseDescriptionItems(
  description: string,
  products?: Product[],
): { name: string; qty: number; price: number; total: number }[] {
  if (!description) return [];

  const orderMatch = description.match(/Order #[A-Z0-9-]+:\s*/i);
  const itemsText = orderMatch ? description.replace(orderMatch[0], "") : description;
  const itemParts = itemsText.split(",").map((item) => item.trim()).filter(Boolean);

  return itemParts.map((part) => {
    const sqmItem = parseSqmDescriptionPart(part, products);
    if (sqmItem) {
      return {
        name: sqmItem.name,
        qty: sqmItem.qty,
        price: sqmItem.price,
        total: sqmItem.total,
      };
    }

    const match = part.match(/^(\d+)x\s+(.+)$/i);
    if (match) {
      const qty = parseInt(match[1], 10);
      const name = match[2].trim();
      const displayName = stripEmbeddedItemPriceText(name);
      const embeddedPriceMatch = name.match(/@\s*([\d.]+)\s*AED/i);

      if (embeddedPriceMatch) {
        const price = parseFloat(embeddedPriceMatch[1]);
        return { name: displayName, qty, price, total: qty * price };
      }

      const serviceMatch = name.match(/\[(N|DC|I)\]/i);
      const serviceType = serviceMatch ? serviceMatch[1].toUpperCase() : "N";
      const sizeMatch = name.match(/\((Small|Medium|Large)\)/i);
      const size = sizeMatch ? sizeMatch[1].toLowerCase() : null;

      const baseName = name
        .replace(/\s*\([^)]*\)\s*$/g, "")
        .replace(/\s*\[[^\]]*\]\s*/g, "")
        .trim();
      let product = products?.find(
        (candidate) => candidate.name.toLowerCase() === baseName.toLowerCase(),
      );

      if (!product) {
        const nameWithoutAll = name
          .replace(/\s*\(Small\)|\(Medium\)|\(Large\)|\(folding\)|\(hanger\)/gi, "")
          .replace(/\s*\[[^\]]*\]/g, "")
          .trim();
        product = products?.find(
          (candidate) => candidate.name.toLowerCase() === nameWithoutAll.toLowerCase(),
        );
      }

      if (!product) {
        product = products?.find(
          (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
        );
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

    return { name: stripEmbeddedItemPriceText(part), qty: 1, price: 0, total: 0 };
  });
}

function formatDueBillDate(value?: string | Date | null, pattern = "dd MMM yyyy") {
  if (!value) return "-";
  return format(new Date(value), pattern);
}

function formatDueBillDateTime(value?: string | Date | null) {
  if (!value) return "-";
  return format(new Date(value), "dd/MM/yyyy hh:mm a");
}

function getDueBillStatusMeta(bill: Bill, paidAmount: number) {
  const isPartiallyPaid = !bill.isPaid && paidAmount > 0.01;

  if (bill.isPaid) {
    return {
      label: "PAID",
      badgeClass: "bg-green-500 hover:bg-green-600",
      accentClass: "from-emerald-400 via-green-500 to-teal-500",
      summaryClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      cardClass:
        "border-emerald-200/80 bg-gradient-to-br from-white via-emerald-50/70 to-emerald-100/70 dark:from-card dark:via-emerald-950/20 dark:to-emerald-950/35",
    };
  }

  if (isPartiallyPaid) {
    return {
      label: "PARTIAL",
      badgeClass: "bg-amber-500 hover:bg-amber-600",
      accentClass: "from-amber-400 via-orange-500 to-yellow-500",
      summaryClass: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      cardClass:
        "border-amber-200/80 bg-gradient-to-br from-white via-amber-50/70 to-orange-100/70 dark:from-card dark:via-amber-950/20 dark:to-orange-950/30",
    };
  }

  return {
    label: "UNPAID",
    badgeClass: "bg-blue-500 hover:bg-blue-600",
    accentClass: "from-sky-400 via-blue-500 to-indigo-500",
    summaryClass: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    cardClass:
      "border-sky-200/80 bg-gradient-to-br from-white via-sky-50/70 to-blue-100/70 dark:from-card dark:via-sky-950/20 dark:to-blue-950/30",
  };
}

function formatDueClientType(type?: string | null) {
  const normalized = String(type || "").trim();
  if (!normalized) return null;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatDuePaymentMethodLabel(method?: string | null) {
  const normalized = String(method || "").trim().toLowerCase();
  if (!normalized) return "-";
  if (normalized === "cash") return "Cash";
  if (normalized === "card") return "Card";
  if (normalized === "bank" || normalized === "transfer") return "Bank Transfer";
  if (normalized === "deposit") return "Account Credit";
  return String(method || "-");
}

type DueBillStatusFilter = "all" | "unpaid" | "partial";
type DueOrderPaymentStatus = "paid" | "partial" | "unpaid";
type DueBillTimePeriod =
  | "today"
  | "month"
  | "year"
  | "all"
  | "date"
  | "custom";

export default function DueCustomers() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { data: clients, isLoading: clientsLoading } = useClients();
  const { data: bills, isLoading: billsLoading } = useBills();
  const { data: products } = useProducts();
  const { data: orders, isLoading: ordersLoading } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
  });
  const { data: trackingOrderCount, isLoading: trackingOrderCountLoading } = useQuery<{
    count: number;
  }>({
    queryKey: ["/api/orders/tracking-count", "all-time"],
    queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", "/api/orders/tracking-count", undefined, {
        signal,
      });
      return res.json();
    },
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [dueBillStatusFilter, setDueBillStatusFilter] =
    useState<DueBillStatusFilter>("all");
  const [dueBillTimePeriod, setDueBillTimePeriod] =
    useState<DueBillTimePeriod>("all");
  const [exactDate, setExactDate] = useState("");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");
  const [dueBillsRangeApplied, setDueBillsRangeApplied] = useState(false);
  const [billSortMode, setBillSortMode] = useState<
    "date_desc" | "date_asc" | "amount_desc" | "amount_asc"
  >("date_desc");
  const [visibleUnpaidBillsCount, setVisibleUnpaidBillsCount] = useState(
    DUE_CUSTOMERS_INITIAL_LOAD_COUNT,
  );
  const unpaidBillsTableScrollRef = useRef<HTMLDivElement | null>(null);
  const [showUnpaidBillsJumpers, setShowUnpaidBillsJumpers] = useState(false);

  // Payment dialog state
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedDueBill, setSelectedDueBill] = useState<Bill | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentNotes, setPaymentNotes] = useState("");

  const isLoading =
    clientsLoading || billsLoading || ordersLoading || trackingOrderCountLoading;

  const billsById = useMemo(
    () => new Map((bills || []).map((bill) => [bill.id, bill])),
    [bills],
  );
  const clientById = useMemo(
    () => new Map((clients || []).map((client) => [client.id, client])),
    [clients],
  );
  const ordersByBillId = useMemo(() => {
    const map = new Map<number, Order[]>();

    (orders || []).forEach((order) => {
      if (!order.billId) return;
      const existing = map.get(order.billId);
      if (existing) {
        existing.push(order);
      } else {
        map.set(order.billId, [order]);
      }
    });

    return map;
  }, [orders]);

  const getBillAddressLines = useCallback(
    (bill: Bill, client?: Client | null) => {
      const linkedOrders = ordersByBillId.get(bill.id) || [];
      const orderAddresses = Array.from(
        new Set(
          linkedOrders
            .map((order) => String(order.deliveryAddress || "").trim())
            .filter(Boolean),
        ),
      );
      if (orderAddresses.length > 0) return orderAddresses;

      const linkedClient = client ?? (bill.clientId ? clientById.get(bill.clientId) : undefined);
      const isBroker = String(linkedClient?.clientType || "").trim().toLowerCase() === "broker";
      if (isBroker) return [] as string[];

      const clientAddress = String(linkedClient?.address || "").trim();
      return clientAddress ? [clientAddress] : [];
    },
    [clientById, ordersByBillId],
  );

  const hasMeaningfulAdjustment = useCallback((order: Order): boolean => {
    const adjustedRaw = order.adjustedTotal;
    const hasAdjustedValue =
      adjustedRaw !== null &&
      adjustedRaw !== undefined &&
      String(adjustedRaw).trim() !== "";
    if (!hasAdjustedValue) return false;
    return String(order.priceAdjustReason || "").trim().length > 0;
  }, []);

  const getOrderWorkReceivedAmount = useCallback((order: Order): number => {
    if (hasMeaningfulAdjustment(order)) {
      const adjusted = parseFloat(String(order.adjustedTotal ?? "0"));
      return Number.isFinite(adjusted) ? Math.max(0, adjusted) : 0;
    }

    const original = parseFloat(String(order.totalAmount ?? ""));
    if (Number.isFinite(original)) {
      return Math.max(0, original);
    }

    if (order.billId) {
      const linkedBill = billsById.get(order.billId);
      const ordersInSameBill = ordersByBillId.get(order.billId) || [];
      if (linkedBill && ordersInSameBill.length <= 1) {
        const billOriginalAmount = parseFloat(
          String(linkedBill.originalAmount ?? ""),
        );
        if (
          Number.isFinite(billOriginalAmount) &&
          (billOriginalAmount > 0 ||
            String(linkedBill.originalAmount ?? "").trim() !== "")
        ) {
          return Math.max(0, billOriginalAmount);
        }

        const billFinalAmount = parseFloat(String(linkedBill.amount ?? ""));
        const billDiscountAmount = parseFloat(
          String(linkedBill.discountAmount ?? "0"),
        );
        if (Number.isFinite(billFinalAmount)) {
          const safeBillDiscount = Number.isFinite(billDiscountAmount)
            ? Math.max(0, billDiscountAmount)
            : 0;
          return Math.max(0, billFinalAmount + safeBillDiscount);
        }
      }
    }

    const finalAmount = parseFloat(String(order.finalAmount ?? "0"));
    if (!Number.isFinite(finalAmount)) return 0;
    const directDiscount = parseFloat(String(order.discountAmount || "0"));
    const safeDiscount = Number.isFinite(directDiscount)
      ? Math.max(0, directDiscount)
      : 0;
    return Math.max(0, finalAmount + safeDiscount);
  }, [billsById, hasMeaningfulAdjustment, ordersByBillId]);

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
  }, [billsById, getOrderWorkReceivedAmount, ordersByBillId]);

  const getOrderFinalAmount = useCallback((order: Order): number => {
    const explicitFinalAmount = parseFloat(String(order.finalAmount ?? ""));
    if (
      Number.isFinite(explicitFinalAmount) &&
      String(order.finalAmount ?? "").trim() !== ""
    ) {
      return Math.max(0, explicitFinalAmount);
    }

    if (order.billId) {
      const linkedBill = billsById.get(order.billId);
      const ordersInSameBill = ordersByBillId.get(order.billId) || [];
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
    return Math.max(0, workReceived - getOrderDiscountAmount(order));
  }, [billsById, getOrderDiscountAmount, getOrderWorkReceivedAmount, ordersByBillId]);

  const billDisplayAmountsById = useMemo(() => {
    const mapped = new Map<
      number,
      {
        originalAmount: number;
        discount: number;
        finalAmount: number;
        paidAmount: number;
        due: number;
      }
    >();

    (bills || []).forEach((bill) => {
      const linkedOrders = ordersByBillId.get(bill.id) || [];

      const fallbackOriginalRaw = parseFloat(
        String((bill as any).originalAmount ?? bill.amount ?? "0"),
      );
      const fallbackDiscountRaw = parseFloat(
        String(bill.discountAmount || "0"),
      );
      const fallbackFinalRaw = parseFloat(String(bill.amount || "0"));
      const paidAmountRaw = parseFloat(String(bill.paidAmount || "0"));

      const fallbackOriginalAmount = Number.isFinite(fallbackOriginalRaw)
        ? Math.max(0, fallbackOriginalRaw)
        : 0;
      const fallbackDiscount = Number.isFinite(fallbackDiscountRaw)
        ? Math.max(0, fallbackDiscountRaw)
        : 0;
      const fallbackFinalAmount = Number.isFinite(fallbackFinalRaw)
        ? Math.max(0, fallbackFinalRaw)
        : 0;
      const paidAmount = Number.isFinite(paidAmountRaw)
        ? Math.max(0, paidAmountRaw)
        : 0;

      let originalAmount =
        linkedOrders.length > 0
          ? linkedOrders.reduce(
              (sum, order) => sum + getOrderWorkReceivedAmount(order),
              0,
            )
          : fallbackOriginalAmount;

      let discount =
        linkedOrders.length > 0
          ? linkedOrders.reduce(
              (sum, order) => sum + getOrderDiscountAmount(order),
              0,
            )
          : fallbackDiscount;

      let finalAmount =
        linkedOrders.length > 0
          ? linkedOrders.reduce(
              (sum, order) => sum + getOrderFinalAmount(order),
              0,
            )
          : fallbackFinalAmount;

      if (originalAmount <= 0.009 && fallbackOriginalAmount > 0) {
        originalAmount = fallbackOriginalAmount;
      }
      if (discount <= 0.009 && fallbackDiscount > 0) {
        discount = fallbackDiscount;
      }
      if (finalAmount <= 0.009 && fallbackFinalAmount > 0) {
        finalAmount = fallbackFinalAmount;
      }
      if (originalAmount <= 0.009 && (finalAmount > 0 || discount > 0)) {
        originalAmount = Math.max(0, finalAmount + discount);
      }

      mapped.set(bill.id, {
        originalAmount,
        discount,
        finalAmount,
        paidAmount,
        due: Math.max(0, finalAmount - paidAmount),
      });
    });

    return mapped;
  }, [
    bills,
    getOrderDiscountAmount,
    getOrderFinalAmount,
    getOrderWorkReceivedAmount,
    ordersByBillId,
  ]);

  const getBillDisplayAmounts = useCallback((bill: Bill) => {
    return billDisplayAmountsById.get(bill.id) || {
      originalAmount:
        parseFloat(String((bill as any).originalAmount ?? bill.amount ?? "0")) ||
        0,
      discount: parseFloat(String(bill.discountAmount || "0")) || 0,
      finalAmount: parseFloat(String(bill.amount || "0")) || 0,
      paidAmount: parseFloat(String(bill.paidAmount || "0")) || 0,
      due: Math.max(
        0,
        (parseFloat(String(bill.amount || "0")) || 0) -
          (parseFloat(String(bill.paidAmount || "0")) || 0),
      ),
    };
  }, [billDisplayAmountsById]);

  const getBillPaymentStatus = useCallback(
    (bill: Bill): DueOrderPaymentStatus => {
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

  const isPendingBill = useCallback(
    (bill: Bill) => getBillPaymentStatus(bill) !== "paid",
    [getBillPaymentStatus],
  );

  const getOrderPaymentStatus = useCallback(
    (order: Order): DueOrderPaymentStatus => {
      if (order.billId) {
        const linkedBill = billsById.get(order.billId);
        if (linkedBill) {
          return getBillPaymentStatus(linkedBill);
        }
      }

      const finalAmount = getOrderFinalAmount(order);
      const paidAmountRaw = parseFloat(String(order.paidAmount || "0"));
      const paidAmount = Number.isFinite(paidAmountRaw)
        ? Math.max(0, paidAmountRaw)
        : 0;

      if (finalAmount > 0.01 && paidAmount >= finalAmount - 0.01) {
        return "paid";
      }

      if (paidAmount > 0.01) {
        return "partial";
      }

      return "unpaid";
    },
    [billsById, getBillPaymentStatus, getOrderFinalAmount],
  );

  const pendingBillsByClient = useMemo(() => {
    const map: Record<number, { count: number; amount: number }> = {};
    (bills || []).forEach((bill) => {
      if (!bill.clientId || !isPendingBill(bill)) return;

      const billBalance = getBillDisplayAmounts(bill).due;
      if (!map[bill.clientId]) {
        map[bill.clientId] = { count: 0, amount: 0 };
      }
      map[bill.clientId].count += 1;
      map[bill.clientId].amount += billBalance;
    });
    return map;
  }, [bills, getBillDisplayAmounts, isPendingBill]);

  const orderPaymentCounts = useMemo(
    () =>
      (orders || []).reduce(
        (totals, order) => {
          const paymentStatus = getOrderPaymentStatus(order);
          totals[paymentStatus] += 1;
          return totals;
        },
        { paid: 0, partial: 0, unpaid: 0 },
      ),
    [orders, getOrderPaymentStatus],
  );

  const allTimeOrderCount =
    trackingOrderCount?.count ??
    orderPaymentCounts.paid + orderPaymentCounts.partial + orderPaymentCounts.unpaid;
  const paidOrdersCount = orderPaymentCounts.paid;
  const partialPaidOrdersCount = orderPaymentCounts.partial;
  const unpaidOrdersCount = orderPaymentCounts.unpaid;

  const matchesDueBillTimePeriod = useCallback(
    (bill: Bill) => {
      if (dueBillTimePeriod === "custom" && !dueBillsRangeApplied) {
        return false;
      }

      if (dueBillTimePeriod === "date" && !exactDate) {
        return false;
      }

      const billDate = new Date(bill.billDate);
      if (Number.isNaN(billDate.getTime())) {
        return false;
      }

      if (dueBillTimePeriod === "date" && exactDate) {
        const selectedDate = new Date(`${exactDate}T00:00:00`);
        return !Number.isNaN(selectedDate.getTime()) && isSameDay(billDate, selectedDate);
      }

      if (dueBillTimePeriod === "custom" && customDateFrom) {
        const fromDate = new Date(`${customDateFrom}T00:00:00`);
        const toDate = customDateTo
          ? new Date(`${customDateTo}T23:59:59`)
          : new Date(`${customDateFrom}T23:59:59`);

        if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
          return false;
        }

        return billDate >= fromDate && billDate <= toDate;
      }

      const now = new Date();

      if (dueBillTimePeriod === "today") {
        return isSameDay(billDate, now);
      }

      if (dueBillTimePeriod === "month") {
        const monthStart = startOfMonth(now);
        return isAfter(billDate, monthStart) || isSameDay(billDate, monthStart);
      }

      if (dueBillTimePeriod === "year") {
        const yearStart = startOfYear(now);
        return isAfter(billDate, yearStart) || isSameDay(billDate, yearStart);
      }

      return true;
    },
    [
      customDateFrom,
      customDateTo,
      dueBillTimePeriod,
      dueBillsRangeApplied,
      exactDate,
    ],
  );

  const unpaidBills = useMemo(() => {
    return (bills || [])
      .filter((bill) => isPendingBill(bill))
      .filter((bill) => matchesDueBillTimePeriod(bill))
      .filter((bill) => {
        if (dueBillStatusFilter === "all") return true;
        return getBillPaymentStatus(bill) === dueBillStatusFilter;
      })
      .filter((bill) => {
        if (!searchTerm) return true;
        const client = bill.clientId ? clientById.get(bill.clientId) : undefined;
        const clientName = client?.name?.toLowerCase() || "";
        const clientPhone = client?.phone?.toLowerCase() || "";
        const billRef = bill.referenceNumber?.toLowerCase() || "";
        const search = searchTerm.toLowerCase();
        return (
          clientName.includes(search) ||
          clientPhone.includes(search) ||
          billRef.includes(search)
        );
      });
  }, [
    bills,
    clientById,
    customDateFrom,
    customDateTo,
    dueBillStatusFilter,
    dueBillTimePeriod,
    dueBillsRangeApplied,
    exactDate,
    getBillPaymentStatus,
    isPendingBill,
    matchesDueBillTimePeriod,
    searchTerm,
  ]);

  const sortedGroupedUnpaidBills = useMemo(() => {
    const byDate = new Map<string, Bill[]>();

    unpaidBills.forEach((bill) => {
      const dateKey = format(new Date(bill.billDate), "yyyy-MM-dd");
      const existing = byDate.get(dateKey);
      if (existing) {
        existing.push(bill);
      } else {
        byDate.set(dateKey, [bill]);
      }
    });

    return Array.from(byDate.entries())
      .sort(([dateA], [dateB]) => {
        if (billSortMode === "date_asc") {
          return dateA.localeCompare(dateB);
        }
        return dateB.localeCompare(dateA);
      })
      .map(([dateKey, billsForDate]) => ({
        dateKey,
        bills: [...billsForDate].sort((a, b) => {
          if (billSortMode === "amount_desc" || billSortMode === "amount_asc") {
            const amountA = getBillDisplayAmounts(a).finalAmount;
            const amountB = getBillDisplayAmounts(b).finalAmount;
            if (amountA !== amountB) {
              return billSortMode === "amount_desc"
                ? amountB - amountA
                : amountA - amountB;
            }
          }
          const timeA = new Date(a.billDate).getTime();
          const timeB = new Date(b.billDate).getTime();
          if (timeA !== timeB) {
            return billSortMode === "date_asc" ? timeA - timeB : timeB - timeA;
          }
          return billSortMode === "date_asc" ? a.id - b.id : b.id - a.id;
        }),
      }));
  }, [billSortMode, getBillDisplayAmounts, unpaidBills]);

  const sortedUnpaidBills = useMemo(
    () =>
      sortedGroupedUnpaidBills.flatMap(({ bills: billsForDate }) => billsForDate),
    [sortedGroupedUnpaidBills],
  );

  const visibleUnpaidBills = useMemo(
    () => sortedUnpaidBills.slice(0, visibleUnpaidBillsCount),
    [sortedUnpaidBills, visibleUnpaidBillsCount],
  );

  const groupedVisibleUnpaidBills = useMemo(() => {
    const byDate = new Map<string, Bill[]>();

    visibleUnpaidBills.forEach((bill) => {
      const dateKey = format(new Date(bill.billDate), "yyyy-MM-dd");
      const existing = byDate.get(dateKey);
      if (existing) {
        existing.push(bill);
      } else {
        byDate.set(dateKey, [bill]);
      }
    });

    return Array.from(byDate.entries()).map(([dateKey, billsForDate]) => ({
      dateKey,
      bills: billsForDate,
    }));
  }, [visibleUnpaidBills]);

  const hasMoreVisibleUnpaidBills = visibleUnpaidBills.length < sortedUnpaidBills.length;

  const updateUnpaidBillsJumperVisibility = useCallback(
    (viewport?: HTMLDivElement | null) => {
      if (!viewport) {
        setShowUnpaidBillsJumpers(false);
        return;
      }

      setShowUnpaidBillsJumpers(viewport.scrollHeight > viewport.clientHeight + 4);
    },
    [],
  );

  const loadMoreVisibleUnpaidBills = useCallback(() => {
    setVisibleUnpaidBillsCount((current) => {
      if (current >= sortedUnpaidBills.length) {
        return current;
      }

      return Math.min(
        sortedUnpaidBills.length,
        current + DUE_CUSTOMERS_LOAD_MORE_COUNT,
      );
    });
  }, [sortedUnpaidBills.length]);

  const maybeLoadMoreVisibleUnpaidBills = useCallback(
    (viewport?: HTMLDivElement | null) => {
      if (!viewport) return;

      const remainingScroll =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;

      if (remainingScroll > DUE_CUSTOMERS_LOAD_MORE_THRESHOLD_PX) {
        return;
      }

      loadMoreVisibleUnpaidBills();
    },
    [loadMoreVisibleUnpaidBills],
  );

  const handleUnpaidBillsListScroll = useCallback(
    (viewport: HTMLDivElement) => {
      updateUnpaidBillsJumperVisibility(viewport);
      maybeLoadMoreVisibleUnpaidBills(viewport);
    },
    [maybeLoadMoreVisibleUnpaidBills, updateUnpaidBillsJumperVisibility],
  );

  const jumpUnpaidBillsTable = useCallback(
    (position: "top" | "bottom") => {
      const viewport = unpaidBillsTableScrollRef.current;
      if (!viewport) return;

      viewport.scrollTo({
        top: position === "top" ? 0 : viewport.scrollHeight,
        behavior: "smooth",
      });
    },
    [],
  );

  const getBillPaymentHref = (billId: number) =>
    `/bills?tab=bills&highlightBill=${billId}&billId=${billId}`;
  const getBillPrintHref = (billId: number) => `/bills?printBill=${billId}`;
  const selectedDueBillItems = useMemo(
    () =>
      selectedDueBill
        ? parseDescriptionItems(selectedDueBill.description || "", products)
        : [],
    [products, selectedDueBill],
  );

  useEffect(() => {
    setVisibleUnpaidBillsCount(DUE_CUSTOMERS_INITIAL_LOAD_COUNT);
    unpaidBillsTableScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [
    billSortMode,
    customDateFrom,
    customDateTo,
    dueBillStatusFilter,
    dueBillTimePeriod,
    dueBillsRangeApplied,
    exactDate,
    searchTerm,
  ]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const viewport = unpaidBillsTableScrollRef.current;
      updateUnpaidBillsJumperVisibility(viewport);
      maybeLoadMoreVisibleUnpaidBills(viewport);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    maybeLoadMoreVisibleUnpaidBills,
    updateUnpaidBillsJumperVisibility,
    visibleUnpaidBills.length,
  ]);

  useEffect(() => {
    const handleResize = () => {
      updateUnpaidBillsJumperVisibility(unpaidBillsTableScrollRef.current);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateUnpaidBillsJumperVisibility]);

  const sendWhatsAppReminder = (client: Client) => {
    const pendingBillAmount = pendingBillsByClient[client.id]?.amount || 0;
    const message = `Dear ${client.name},%0A%0AThis is a friendly reminder that you have an outstanding balance of AED ${pendingBillAmount.toFixed(2)} at Liquid Washes Laundry.%0A%0APlease visit us at your earliest convenience to settle your account.%0A%0AThank you!%0A%0ALiquid Washes Laundry%0ACentra Market D/109, Al Dhanna City%0AAl Ruwais, Abu Dhabi-UAE`;
    window.open(
      `https://wa.me/${client.phone?.replace(/[^0-9]/g, "")}?text=${message}`,
      "_blank",
    );
  };

  const payBillMutation = useMutation({
    mutationFn: async (data: {
      clientId: number;
      amount: string;
      paymentMethod: string;
      notes?: string;
    }) => {
      // Find the oldest unpaid bill for this client
      const clientUnpaidBills =
        bills
          ?.filter(
            (bill) =>
              bill.clientId === data.clientId && isPendingBill(bill),
          )
          .sort(
            (a, b) =>
              new Date(a.billDate).getTime() - new Date(b.billDate).getTime(),
          ) || [];
      if (clientUnpaidBills.length === 0) {
        throw new Error("No unpaid bills found for this client");
      }

      const response = await apiRequest(
        "POST",
        `/api/bills/${clientUnpaidBills[0].id}/pay`,
        {
          amount: data.amount,
          paymentMethod: data.paymentMethod,
          notes: data.notes,
        },
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setShowPaymentDialog(false);
      setSelectedClient(null);
      toast({
        title: "Payment Successful",
        description: "Payment has been processed successfully.",
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

  const handlePayNow = (client: Client) => {
    const pendingBillAmount = pendingBillsByClient[client.id]?.amount || 0;

    setSelectedClient(client);
    setPaymentAmount(pendingBillAmount.toFixed(2));
    setPaymentNotes(`Payment for ${client.name}'s outstanding balance`);
    setPaymentMethod("cash");
    setShowPaymentDialog(true);
  };

  const handleProcessPayment = () => {
    if (!selectedClient || !paymentAmount || parseFloat(paymentAmount) <= 0) {
      toast({
        title: "Error",
        description: "Please enter a valid payment amount.",
        variant: "destructive",
      });
      return;
    }

    payBillMutation.mutate({
      clientId: selectedClient.id,
      amount: paymentAmount,
      paymentMethod,
      notes: paymentNotes,
    });
  };

  const handleDueBillsViewChange = (value: DueBillTimePeriod) => {
    setDueBillTimePeriod(value);
    setExactDate("");
    setCustomDateFrom("");
    setCustomDateTo("");
    setDueBillsRangeApplied(false);
  };

  const dueBillsEmptyHeading =
    dueBillTimePeriod === "custom" && !dueBillsRangeApplied
      ? "Select a date range"
      : dueBillTimePeriod === "date" && !exactDate
        ? "Pick a date"
        : searchTerm
          ? "No matching bills"
          : dueBillStatusFilter === "partial"
            ? "No partial due bills"
            : dueBillStatusFilter === "unpaid"
              ? "No unpaid bills"
              : "No due bills";
  const dueBillsEmptyDescription =
    dueBillTimePeriod === "custom" && !dueBillsRangeApplied
      ? "Pick your start and end dates above, then click Apply Range to view bills."
      : dueBillTimePeriod === "date" && !exactDate
        ? "Select an exact date above to view bills."
        : searchTerm
          ? "Try another client name, phone number, or bill reference."
          : dueBillStatusFilter === "partial"
            ? "No partially paid bills are waiting for the remaining balance."
            : dueBillStatusFilter === "unpaid"
              ? "No fully unpaid bills are waiting for payment."
              : "All bills have been paid.";

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="sticky top-0 z-30 w-full bg-background/80 backdrop-blur-md border-b border-border shadow-sm">
        <div className={`${isMobile ? "h-16 px-4 gap-3" : "h-20 px-6 gap-4"} flex items-center`}>
          <CircleDollarSign className={`${isMobile ? "w-5 h-5" : "w-6 h-6"} text-destructive`} />
          <div>
            <h1 className={`${isMobile ? "text-lg" : "text-2xl"} font-display font-bold text-foreground`}>
              Due Bills
            </h1>
            <p className={`${isMobile ? "text-xs" : "text-sm"} text-muted-foreground`}>
              Bills with outstanding balance
            </p>
          </div>
        </div>
      </div>

      <div className={`${isMobile ? "p-3" : "container mx-auto px-4 py-8"} flex min-h-0 flex-1 flex-col overflow-hidden`}>
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4 overflow-hidden">
        <div className="mx-auto w-full max-w-6xl shrink-0">
          <Card className="overflow-hidden border-border/70 bg-gradient-to-br from-white via-slate-50/80 to-blue-50/60 dark:from-card dark:via-slate-950/30 dark:to-blue-950/20">
            <CardHeader className={`${isMobile ? "space-y-3 px-3 pb-2 pt-3" : "flex flex-row items-start justify-between gap-4 pb-3"}`}>
              <div className="min-w-0">
                <CardTitle className={`${isMobile ? "text-sm" : "text-base"} font-semibold`}>
                  Bills Overview
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Total orders follow the all-time order tracking count in the system.
                </p>
              </div>
            </CardHeader>
            <CardContent className={`${isMobile ? "px-3 pb-3 pt-1" : "pt-0"}`}>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-sky-200/80 bg-sky-50/70 p-3 dark:border-sky-900/60 dark:bg-sky-950/20">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-700 dark:text-sky-300">
                      Unpaid Bills
                    </p>
                    <FileText className="h-4 w-4 text-sky-500" />
                  </div>
                  <div
                    className="mt-2 text-2xl font-bold text-sky-700 dark:text-sky-300"
                    data-testid="text-due-bills-count"
                  >
                    {unpaidOrdersCount}
                  </div>
                  <p className="text-xs text-sky-700/80 dark:text-sky-300/80">
                    order{unpaidOrdersCount === 1 ? "" : "s"}
                  </p>
                </div>

                <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
                      Partial Paid Bills
                    </p>
                    <Receipt className="h-4 w-4 text-amber-500" />
                  </div>
                  <div
                    className="mt-2 text-2xl font-bold text-amber-700 dark:text-amber-300"
                    data-testid="text-partial-orders-count"
                  >
                    {partialPaidOrdersCount}
                  </div>
                  <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
                    order{partialPaidOrdersCount === 1 ? "" : "s"}
                  </p>
                </div>

                <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/70 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                      Paid Bills
                    </p>
                    <DollarSign className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div
                    className="mt-2 text-2xl font-bold text-emerald-700 dark:text-emerald-300"
                    data-testid="text-paid-bills-count"
                  >
                    {paidOrdersCount}
                  </div>
                  <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
                    order{paidOrdersCount === 1 ? "" : "s"}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/30">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700 dark:text-slate-300">
                      Total Number Of Orders
                    </p>
                    <Package className="h-4 w-4 text-slate-500" />
                  </div>
                  <div
                    className="mt-2 text-2xl font-bold text-slate-800 dark:text-slate-100"
                    data-testid="text-total-orders-count"
                  >
                    {allTimeOrderCount}
                  </div>
                  <p className="text-xs text-slate-700/80 dark:text-slate-300/80">
                    all-time orders
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Unpaid Bills Section */}
        <Card className="responsive-card flex min-h-0 flex-1 flex-col overflow-hidden">
          <CardHeader className={`${isMobile ? "px-3 pb-3 pt-3" : ""} shrink-0`}>
            {isMobile ? (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or phone..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-9 rounded-xl pl-9 text-sm"
                    data-testid="input-search-bills"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1 rounded-full border border-border/70 bg-card/85 px-2 shadow-sm">
                    <span className="shrink-0 pl-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Status
                    </span>
                    <Select
                      value={dueBillStatusFilter}
                      onValueChange={(value) =>
                        setDueBillStatusFilter(value as DueBillStatusFilter)
                      }
                    >
                      <SelectTrigger
                        className="h-7 w-full min-w-0 border-0 bg-transparent px-1 text-[11px] shadow-none focus:ring-0 focus:ring-offset-0 [&>span]:truncate"
                        data-testid="select-due-bill-status-filter"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Due Bills</SelectItem>
                        <SelectItem value="unpaid">Unpaid Bills</SelectItem>
                        <SelectItem value="partial">Partial Paid Bills</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1 rounded-full border border-border/70 bg-card/85 px-2 shadow-sm">
                    <span className="shrink-0 pl-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      View
                    </span>
                    <Select
                      value={dueBillTimePeriod}
                      onValueChange={(value) =>
                        handleDueBillsViewChange(value as DueBillTimePeriod)
                      }
                    >
                      <SelectTrigger
                        className="h-7 w-full min-w-0 border-0 bg-transparent px-1 text-[11px] shadow-none focus:ring-0 focus:ring-offset-0 [&>span]:truncate"
                        data-testid="select-due-bill-time-period"
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
                {dueBillTimePeriod === "date" && (
                  <div className="flex items-center gap-1.5 rounded-full border border-border/70 bg-card/85 px-2 shadow-sm">
                    <span className="shrink-0 pl-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Date
                    </span>
                    <Input
                      type="date"
                      className="h-7 w-full min-w-0 border-0 bg-transparent px-1 text-[11px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      value={exactDate}
                      onChange={(event) => setExactDate(event.target.value)}
                      data-testid="input-due-bills-exact-date"
                    />
                  </div>
                )}
                {dueBillTimePeriod === "custom" && (
                  <div className="rounded-xl border border-border/70 bg-card/85 px-2 py-1.5 shadow-sm">
                    <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Range
                    </div>
                    <DateTimeRangePicker
                      start={customDateFrom || new Date().toISOString().split("T")[0] + "T00:00"}
                      end={customDateTo || new Date().toISOString().split("T")[0] + "T23:59"}
                      onChange={(start, end) => {
                        setCustomDateFrom(start.split("T")[0]);
                        setCustomDateTo(end.split("T")[0]);
                        setDueBillsRangeApplied(true);
                      }}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={billSortMode}
                    onValueChange={(value) =>
                      setBillSortMode(
                        value as
                          | "date_desc"
                          | "date_asc"
                          | "amount_desc"
                          | "amount_asc",
                      )
                    }
                  >
                    <SelectTrigger
                      className="h-9 rounded-xl text-xs"
                      data-testid="button-sort"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <ArrowUpDown className="h-4 w-4" />
                        <SelectValue />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="date_desc">Newest First</SelectItem>
                      <SelectItem value="date_asc">Oldest First</SelectItem>
                      <SelectItem value="amount_desc">Highest Bill First</SelectItem>
                      <SelectItem value="amount_asc">Lowest Bill First</SelectItem>
                    </SelectContent>
                  </Select>
                  <Link href="/bills">
                    <Button
                      variant="default"
                      className="h-9 w-full justify-center rounded-xl text-xs"
                      data-testid="button-go-to-bills"
                    >
                      <FileText className="mr-1.5 h-4 w-4" />
                      Go to Bills
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name or phone..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9 w-64"
                      data-testid="input-search-bills"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground">Status:</span>
                  <Select
                    value={dueBillStatusFilter}
                    onValueChange={(value) =>
                      setDueBillStatusFilter(value as DueBillStatusFilter)
                    }
                  >
                    <SelectTrigger
                      className="w-44"
                      data-testid="select-due-bill-status-filter"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Due Bills</SelectItem>
                      <SelectItem value="unpaid">Unpaid Bills</SelectItem>
                      <SelectItem value="partial">Partial Paid Bills</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground">View:</span>
                  <Select
                    value={dueBillTimePeriod}
                    onValueChange={(value) =>
                      handleDueBillsViewChange(value as DueBillTimePeriod)
                    }
                  >
                    <SelectTrigger
                      className="w-36"
                      data-testid="select-due-bill-time-period"
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
                  {dueBillTimePeriod === "date" && (
                    <Input
                      type="date"
                      className="w-40 h-9"
                      value={exactDate}
                      onChange={(event) => setExactDate(event.target.value)}
                      data-testid="input-due-bills-exact-date"
                    />
                  )}
                  {dueBillTimePeriod === "custom" && (
                    <DateTimeRangePicker
                      start={customDateFrom || new Date().toISOString().split("T")[0] + "T00:00"}
                      end={customDateTo || new Date().toISOString().split("T")[0] + "T23:59"}
                      onChange={(start, end) => {
                        setCustomDateFrom(start.split("T")[0]);
                        setCustomDateTo(end.split("T")[0]);
                        setDueBillsRangeApplied(true);
                      }}
                    />
                  )}
                  <Select
                    value={billSortMode}
                    onValueChange={(value) =>
                      setBillSortMode(
                        value as
                          | "date_desc"
                          | "date_asc"
                          | "amount_desc"
                          | "amount_asc",
                      )
                    }
                  >
                    <SelectTrigger className="w-48" data-testid="button-sort">
                      <div className="flex items-center gap-2 truncate">
                        <ArrowUpDown className="h-4 w-4" />
                        <SelectValue />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="date_desc">Newest First</SelectItem>
                      <SelectItem value="date_asc">Oldest First</SelectItem>
                      <SelectItem value="amount_desc">Highest Bill First</SelectItem>
                      <SelectItem value="amount_asc">Lowest Bill First</SelectItem>
                    </SelectContent>
                  </Select>
                  <Link href="/bills">
                    <Button variant="default" data-testid="button-go-to-bills">
                      <FileText className="w-4 h-4 mr-2" />
                      Go to Bills for Payment
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent className={`${isMobile ? "px-3 pb-3" : ""} flex min-h-0 flex-1 flex-col overflow-hidden`}>
            {(() => {
              if (unpaidBills.length === 0) {
                return (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium">{dueBillsEmptyHeading}</p>
                    <p className="text-sm">{dueBillsEmptyDescription}</p>
                  </div>
                );
              }
              
              if (isMobile) {
                return (
                  <div
                    ref={unpaidBillsTableScrollRef}
                    className="min-h-0 flex-1 overflow-auto pr-1"
                    onScroll={(event) => handleUnpaidBillsListScroll(event.currentTarget)}
                  >
                    <div className="space-y-3">
                      {groupedVisibleUnpaidBills.map(({ dateKey, bills: billsForDate }) => (
                        <div key={dateKey} className="space-y-2.5">
                          <div className="flex items-center gap-2 px-1">
                            <span className="text-[11px] font-semibold text-muted-foreground">
                              {format(new Date(`${dateKey}T00:00:00`), "EEEE, MMM dd, yyyy")}
                            </span>
                            <Badge variant="secondary" className="text-[10px]">
                              {billsForDate.length}
                            </Badge>
                            <div className="flex-1 border-t border-border/70" />
                          </div>

                          {billsForDate.map((bill) => {
                            const displayAmounts = getBillDisplayAmounts(bill);
                            const statusMeta = getDueBillStatusMeta(
                              bill,
                              displayAmounts.paidAmount,
                            );
                            const client = bill.clientId ? clientById.get(bill.clientId) : undefined;
                            const clientTypeLabel = formatDueClientType(client?.clientType);
                            const accountLabel = [
                              client?.billNumber?.trim() || null,
                              clientTypeLabel && clientTypeLabel.toLowerCase() !== "regular"
                                ? clientTypeLabel
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" - ");
                            const customerName = client?.name || bill.customerName || "-";
                            const phoneLine = bill.customerPhone || client?.phone || "";
                            const addressLine = getBillAddressLines(bill, client)[0] || "";
                            const linkedOrders = ordersByBillId.get(bill.id) || [];

                            return (
                              <Card
                                key={bill.id}
                                data-testid={`row-unpaid-bill-${bill.id}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelectedDueBill(bill)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    setSelectedDueBill(bill);
                                  }
                                }}
                                className={`relative overflow-hidden rounded-[24px] border shadow-[0_18px_40px_-32px_rgba(15,23,42,0.38)] transition-all active:scale-[0.99] ${statusMeta.cardClass}`}
                              >
                                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${statusMeta.accentClass}`} />
                                <CardContent className="p-4">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex items-start gap-2">
                                      <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${statusMeta.summaryClass}`}>
                                        <Receipt className="h-4 w-4" />
                                      </div>
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-base font-bold text-primary">
                                            #{bill.id}
                                          </span>
                                          {bill.referenceNumber && (
                                            <span className="rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                              {bill.referenceNumber}
                                            </span>
                                          )}
                                        </div>
                                        <div className="mt-1 text-xs text-muted-foreground">
                                          {formatDueBillDateTime(bill.billDate)}
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
                                            {customerName}
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
                                          {client?.company && (
                                            <span className="inline-flex items-center gap-1">
                                              <Building2 className="h-3 w-3" />
                                              {client.company}
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
                                      <p className="mt-1 text-lg font-bold text-foreground">
                                        {displayAmounts.finalAmount.toFixed(2)} <span className="text-xs font-medium text-muted-foreground">AED</span>
                                      </p>
                                      {displayAmounts.discount > 0 && (
                                        <p className="mt-1 text-[11px] text-orange-600">
                                          Discount {displayAmounts.discount.toFixed(2)}
                                        </p>
                                      )}
                                    </div>
                                    <div className="rounded-2xl border border-border/60 bg-background/70 p-3">
                                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Due</p>
                                      <p className="mt-1 text-lg font-bold text-red-600 dark:text-red-400">
                                        {displayAmounts.due.toFixed(2)} <span className="text-xs font-medium text-muted-foreground">AED</span>
                                      </p>
                                      <p className="mt-1 text-[11px] text-muted-foreground">
                                        Paid {displayAmounts.paidAmount.toFixed(2)} AED
                                      </p>
                                    </div>
                                    <div className="rounded-2xl border border-border/60 bg-background/70 p-3">
                                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Work Rec.</p>
                                      <p className="mt-1 text-sm font-semibold text-foreground">
                                        {displayAmounts.originalAmount.toFixed(2)} AED
                                      </p>
                                    </div>
                                    <div className="rounded-2xl border border-border/60 bg-background/70 p-3">
                                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Orders</p>
                                      <p className="mt-1 text-sm font-semibold text-foreground">
                                        {linkedOrders.length} order{linkedOrders.length === 1 ? "" : "s"}
                                      </p>
                                      <p className="mt-1 text-[11px] text-muted-foreground">
                                        {displayAmounts.paidAmount > 0.01
                                          ? "Partial payment recorded"
                                          : "Awaiting payment"}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="mt-3 rounded-[20px] border border-border/60 bg-muted/35 p-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                          Bill Details
                                        </p>
                                        <p className="mt-1 text-sm text-foreground line-clamp-2">
                                          {bill.description || "No description available"}
                                        </p>
                                      </div>
                                      <div className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${statusMeta.summaryClass}`}>
                                        Tap to view
                                      </div>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      ))}
                      <div className="px-1 pb-1 text-center text-[11px] text-muted-foreground">
                        Showing {visibleUnpaidBills.length} of {unpaidBills.length} unpaid bills
                        {hasMoreVisibleUnpaidBills
                          ? `, scroll down to load ${DUE_CUSTOMERS_LOAD_MORE_COUNT} more`
                          : ", all matching unpaid bills loaded"}
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70 md:flex">
                  <div
                    ref={unpaidBillsTableScrollRef}
                    className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1"
                    onScroll={(event) => handleUnpaidBillsListScroll(event.currentTarget)}
                    style={{ scrollbarGutter: "stable" }}
                  >
                    <div className="space-y-4 p-4">
                      {groupedVisibleUnpaidBills.map(({ dateKey, bills: billsForDate }) => (
                        <div key={dateKey} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground">
                              {format(new Date(`${dateKey}T00:00:00`), "EEEE, MMM dd, yyyy")}
                            </span>
                            <Badge variant="secondary" className="text-[10px]">
                              {billsForDate.length}
                            </Badge>
                            <div className="flex-1 border-t border-border" />
                          </div>

                          <table className="w-full table-fixed text-xs">
                            <TableHeader>
                              <TableRow className="text-xs">
                                <TableHead className="w-[120px] px-2">Date</TableHead>
                                <TableHead className="w-[90px] px-2">Bill</TableHead>
                                <TableHead className="w-[220px] px-2">Client</TableHead>
                                <TableHead className="w-[240px] px-2">Details</TableHead>
                                <TableHead className="w-[90px] px-2 text-right">Work Rec.</TableHead>
                                <TableHead className="w-[90px] px-2 text-right">Discount</TableHead>
                                <TableHead className="w-[90px] px-2 text-right">Final Amt</TableHead>
                                <TableHead className="w-[90px] px-2 text-right">Paid</TableHead>
                                <TableHead className="w-[90px] px-2 text-right">Due</TableHead>
                                <TableHead className="w-[90px] px-2">Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {billsForDate.map((bill) => {
                                const displayAmounts = getBillDisplayAmounts(bill);
                                const statusMeta = getDueBillStatusMeta(
                                  bill,
                                  displayAmounts.paidAmount,
                                );
                                const client = bill.clientId ? clientById.get(bill.clientId) : undefined;
                                const clientTypeLabel = formatDueClientType(client?.clientType);
                                const accountLabel = [
                                  client?.billNumber?.trim() || null,
                                  clientTypeLabel && clientTypeLabel.toLowerCase() !== "regular"
                                    ? clientTypeLabel
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" - ");
                                const phoneLine = bill.customerPhone || client?.phone || "-";
                                const addressLine = getBillAddressLines(bill, client)[0] || "";
                                const hasPartialPayment = displayAmounts.paidAmount > 0.01;

                                return (
                                  <TableRow
                                    key={bill.id}
                                    data-testid={`row-unpaid-bill-${bill.id}`}
                                    onClick={() => setSelectedDueBill(bill)}
                                    className={`cursor-pointer transition-colors ${
                                      statusMeta.label === "PARTIAL"
                                        ? "bg-amber-50/40 hover:bg-amber-100/70 dark:bg-amber-950/20 dark:hover:bg-amber-950/40"
                                        : "bg-blue-50/30 hover:bg-blue-100/70 dark:bg-blue-950/10 dark:hover:bg-blue-950/30"
                                    }`}
                                  >
                                    <TableCell className="px-2 py-3 align-top">
                                      <div className="flex flex-col leading-tight">
                                        <span className="font-medium text-foreground">
                                          {formatDueBillDateTime(bill.billDate)}
                                        </span>
                                        <span
                                          className={`text-[11px] ${
                                            hasPartialPayment
                                              ? "text-green-600"
                                              : "text-muted-foreground"
                                          }`}
                                        >
                                          Paid: {hasPartialPayment ? "Recorded" : "-"}
                                        </span>
                                      </div>
                                    </TableCell>
                                    <TableCell className="px-2 py-3 align-top">
                                      <div className="flex flex-col leading-tight">
                                        <span className="font-semibold text-primary">
                                          #{bill.id}
                                        </span>
                                        <span className="text-[11px] text-muted-foreground">
                                          {bill.referenceNumber || "-"}
                                        </span>
                                      </div>
                                    </TableCell>
                                    <TableCell className="px-2 py-3 align-top">
                                      <div className="px-1 py-0.5">
                                        <div className="flex w-full flex-col items-start text-left leading-tight">
                                          <div className="flex items-center gap-1 w-full">
                                          <User className="w-3 h-3 shrink-0 text-primary" />
                                            <span className="truncate text-sm font-semibold text-foreground max-w-[120px]">
                                              {client?.name || bill.customerName || "Unknown Client"}
                                            </span>
                                          </div>
                                          {accountLabel && (
                                            <span className="text-[11px] text-muted-foreground">
                                              {accountLabel}
                                            </span>
                                          )}
                                          <span className="text-[11px] text-muted-foreground">
                                            {phoneLine}
                                          </span>
                                          {addressLine && (
                                            <span className="text-[11px] text-muted-foreground truncate max-w-[220px]">
                                              {addressLine}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </TableCell>
                                    <TableCell className="px-2 py-3 align-top">
                                      <div className="flex w-full min-w-0 flex-col px-1 py-0.5 text-left">
                                        <span className="text-[11px] font-medium text-muted-foreground">
                                          Items
                                        </span>
                                        <span className="text-[11px] text-muted-foreground line-clamp-2">
                                          {bill.description || "-"}
                                        </span>
                                      </div>
                                    </TableCell>
                                    <TableCell className="px-2 py-3 text-right align-top font-medium">
                                      {displayAmounts.originalAmount.toFixed(2)} AED
                                    </TableCell>
                                    <TableCell className="px-2 py-3 text-right align-top text-orange-500">
                                      {displayAmounts.discount > 0
                                        ? `${displayAmounts.discount.toFixed(2)} AED`
                                        : "-"}
                                    </TableCell>
                                    <TableCell className="px-2 py-3 text-right align-top font-semibold">
                                      {displayAmounts.finalAmount.toFixed(2)} AED
                                    </TableCell>
                                    <TableCell className="px-2 py-3 text-right align-top text-green-600 dark:text-green-400">
                                      {displayAmounts.paidAmount > 0
                                        ? `${displayAmounts.paidAmount.toFixed(2)} AED`
                                        : "-"}
                                    </TableCell>
                                    <TableCell className="px-2 py-3 text-right align-top font-semibold text-red-600 dark:text-red-400">
                                      {displayAmounts.due > 0
                                        ? `${displayAmounts.due.toFixed(2)} AED`
                                        : "-"}
                                    </TableCell>
                                    <TableCell className="px-2 py-3 align-top">
                                      <div className="flex flex-col items-start gap-1">
                                        <Badge className={`text-[10px] text-white ${statusMeta.badgeClass}`}>
                                          {statusMeta.label}
                                        </Badge>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </table>
                        </div>
                      ))}
                      <div className="text-center text-[11px] text-muted-foreground">
                        Showing {visibleUnpaidBills.length} of {unpaidBills.length} unpaid bills
                        {hasMoreVisibleUnpaidBills
                          ? `, scroll down to load ${DUE_CUSTOMERS_LOAD_MORE_COUNT} more`
                          : ", all matching unpaid bills loaded"}
                      </div>
                    </div>
                  </div>
                  {showUnpaidBillsJumpers && (
                    <div className="flex w-7 shrink-0 flex-col items-center justify-between border-l border-border/70 bg-muted/20 py-1">
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                        onClick={() => jumpUnpaidBillsTable("top")}
                        title="Jump to top"
                        aria-label="Jump to top"
                        data-testid="button-due-customers-scroll-top"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                        onClick={() => jumpUnpaidBillsTable("bottom")}
                        title="Jump to bottom"
                        aria-label="Jump to bottom"
                        data-testid="button-due-customers-scroll-bottom"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <Dialog
          open={!!selectedDueBill}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedDueBill(null);
            }
          }}
        >
          <DialogContent
            aria-describedby={undefined}
            className="w-[min(96vw,44rem)] max-w-xl max-h-[85vh] overflow-y-auto"
          >
            <DialogHeader className="sr-only">
              <DialogTitle>Bill Details</DialogTitle>
              <DialogDescription>
                Review this bill without leaving Due Bills.
              </DialogDescription>
            </DialogHeader>

            {selectedDueBill && (() => {
              const displayAmounts = getBillDisplayAmounts(selectedDueBill);
              const statusMeta = getDueBillStatusMeta(
                selectedDueBill,
                displayAmounts.paidAmount,
              );
              const client = selectedDueBill.clientId
                ? clientById.get(selectedDueBill.clientId)
                : undefined;
              const customerName = client?.name || selectedDueBill.customerName || "-";
              const customerPhone = client?.phone || selectedDueBill.customerPhone || "";
              const clientTypeLabel = formatDueClientType(client?.clientType);
              const isBroker = String(client?.clientType || "").trim().toLowerCase() === "broker";
              const accountLabelParts = [
                client?.billNumber?.trim() || null,
                clientTypeLabel && clientTypeLabel.toLowerCase() !== "regular"
                  ? clientTypeLabel
                  : null,
              ].filter(Boolean);
              const accountLabel = accountLabelParts.length > 0
                ? accountLabelParts.join(" - ")
                : null;
              const addressLines = getBillAddressLines(selectedDueBill, client);
              const showPaymentMethodCard =
                selectedDueBill.isPaid || displayAmounts.paidAmount > 0.01;
              const paidStatusText = selectedDueBill.isPaid
                ? formatDueBillDateTime(selectedDueBill.billDate)
                : displayAmounts.paidAmount > 0.01
                  ? "Partial payment recorded"
                  : "-";

              return (
                <div className="space-y-3">
                  <div
                    className={`relative overflow-hidden rounded-[22px] border shadow-[0_18px_40px_-32px_rgba(15,23,42,0.38)] ${statusMeta.cardClass}`}
                  >
                    <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${statusMeta.accentClass}`} />
                    <div className={isMobile ? "p-3" : "p-4"}>
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${statusMeta.summaryClass}`}
                        >
                          <Receipt className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <p className="shrink-0 text-sm font-semibold text-foreground">
                                  Bill Details
                                </p>
                                {selectedDueBill.referenceNumber && (
                                  <span className="truncate rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-border/60">
                                    Ref {selectedDueBill.referenceNumber}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                                <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                  Bill #{selectedDueBill.id}
                                </span>
                                <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                  {formatDueBillDate(
                                    selectedDueBill.billDate,
                                    isMobile ? "dd MMM yyyy" : "MMM dd, yyyy",
                                  )}
                                </span>
                                {client?.billNumber?.trim() && (
                                  <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                    Acc {client.billNumber.trim()}
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

                  <div
                    className={`rounded-xl border border-border/50 bg-background/70 ${
                      isMobile ? "p-3" : "p-4"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className={isMobile ? "truncate text-lg font-bold" : "text-xl font-bold"}>
                        {customerName}
                        {accountLabel && (
                          <span className="ml-2 text-sm font-normal text-muted-foreground">
                            ({accountLabel})
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="mt-2 space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Bill #</span>
                        <span className="font-medium">#{selectedDueBill.id}</span>
                      </div>
                      {client?.billNumber?.trim() && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Bill Number</span>
                          <span className="font-medium">{client.billNumber.trim()}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Created On</span>
                        <span className="font-medium">
                          {formatDueBillDateTime(selectedDueBill.billDate)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Paid On</span>
                        <span
                          className={
                            selectedDueBill.isPaid
                              ? "font-medium text-green-600"
                              : displayAmounts.paidAmount > 0.01
                                ? "font-medium text-amber-600"
                                : "text-muted-foreground"
                          }
                        >
                          {paidStatusText}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isBroker ? (
                          <Badge
                            variant="secondary"
                            className="text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border-violet-200 dark:border-violet-700"
                          >
                            Broker Account
                          </Badge>
                        ) : client?.company ? (
                          <Badge
                            variant="secondary"
                            className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-700"
                          >
                            Company Account
                          </Badge>
                        ) : client?.billNumber ? (
                          <Badge variant="secondary" className="text-xs">
                            Customer Account
                          </Badge>
                        ) : null}
                      </div>
                      {client?.company && (
                        <div className="flex items-center gap-2 text-sm text-blue-600">
                          <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{client.company}</span>
                        </div>
                      )}
                      {customerPhone && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{customerPhone}</span>
                        </div>
                      )}
                      {addressLines.map((address, index) => (
                        <div
                          key={`${selectedDueBill.id}-address-${index}`}
                          className="flex items-center gap-2 text-sm text-muted-foreground"
                        >
                          <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{address}</span>
                        </div>
                      ))}
                      {selectedDueBill.referenceNumber && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Reference</span>
                          <span className="font-medium text-foreground">
                            {selectedDueBill.referenceNumber}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    className={`grid gap-3 ${
                      showPaymentMethodCard ? "grid-cols-3" : "grid-cols-2"
                    }`}
                  >
                    <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                      <p className="text-xs text-muted-foreground">Work Received</p>
                      <p className="text-2xl font-bold text-primary">
                        {displayAmounts.originalAmount.toFixed(2)}{" "}
                        <span className="text-sm">AED</span>
                      </p>
                      {displayAmounts.discount > 0 && (
                        <div className="mt-1">
                          <p className="text-xs text-orange-600">
                            Disc: -{displayAmounts.discount.toFixed(2)}
                          </p>
                          <p className="text-sm font-semibold text-green-700">
                            Final: {displayAmounts.finalAmount.toFixed(2)} AED
                          </p>
                        </div>
                      )}
                    </div>
                    <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                      <p className="text-xs text-muted-foreground">Date</p>
                      <p className="text-lg font-semibold">
                        {formatDueBillDate(selectedDueBill.billDate)}
                      </p>
                    </div>
                    {showPaymentMethodCard && (
                      <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                        <p className="text-xs text-muted-foreground mb-1">
                          Payment Method
                        </p>
                        <div className="flex min-h-9 items-center rounded-md border bg-background px-3 py-1 text-sm font-medium leading-5">
                          <span className="whitespace-normal break-words">
                            {formatDuePaymentMethodLabel(selectedDueBill.paymentMethod)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {(selectedDueBill.description || selectedDueBillItems.length > 0) && (
                    <BillItemsPopover
                      items={selectedDueBillItems}
                      rawDescription={selectedDueBill.description}
                      title={`Bill #${selectedDueBill.id} Items`}
                      subtitle={`${customerName} - ${formatDueBillDate(selectedDueBill.billDate)}`}
                      dataTestId={`button-due-bill-items-popover-${selectedDueBill.id}`}
                      disablePortal
                    />
                  )}

                  {(selectedDueBill as any).priceAdjustReason && (
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 rounded-lg">
                      <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold mb-1">
                        Price Adjustment
                      </p>
                      <div className="text-sm text-amber-700 dark:text-amber-400 italic">
                        {(selectedDueBill as any).priceAdjustReason}
                      </div>
                    </div>
                  )}

                  {!selectedDueBill.isPaid && displayAmounts.paidAmount > 0.01 && (
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 rounded-lg">
                      <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold mb-2">
                        Payment Breakdown
                      </p>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Previously Paid:</span>
                          <span className="font-medium text-green-600">
                            {displayAmounts.paidAmount.toFixed(2)} AED
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">New Total:</span>
                          <span className="font-medium">
                            {displayAmounts.finalAmount.toFixed(2)} AED
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-amber-200 dark:border-amber-700 pt-1 mt-1">
                          <span className="font-semibold text-amber-700 dark:text-amber-400">
                            Amount Due:
                          </span>
                          <span className="font-bold text-red-600">
                            {displayAmounts.due.toFixed(2)} AED
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {(selectedDueBill as any).notes && (
                    <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
                      <p className="text-xs text-blue-700 dark:text-blue-400 font-semibold mb-2">
                        History
                      </p>
                      <div className="text-xs text-blue-600 dark:text-blue-300 whitespace-pre-wrap">
                        {(selectedDueBill as any).notes}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {displayAmounts.due > 0.01 && (
                      <Link href={getBillPaymentHref(selectedDueBill.id)}>
                        <Button
                          className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700"
                          onClick={() => setSelectedDueBill(null)}
                          data-testid={`button-pay-due-bill-${selectedDueBill.id}`}
                        >
                          <DollarSign className="w-4 h-4 mr-2" />
                          Pay Now
                        </Button>
                      </Link>
                    )}
                    <Link href={getBillPrintHref(selectedDueBill.id)}>
                      <Button
                        variant="outline"
                        className="w-full sm:w-auto"
                        onClick={() => setSelectedDueBill(null)}
                        data-testid={`button-print-due-bill-${selectedDueBill.id}`}
                      >
                        <Printer className="w-4 h-4 mr-2" />
                        Print
                      </Button>
                    </Link>
                    <Link href={getBillPaymentHref(selectedDueBill.id)}>
                      <Button
                        variant="outline"
                        className="w-full sm:w-auto"
                        onClick={() => setSelectedDueBill(null)}
                        data-testid={`button-open-due-bill-in-bills-${selectedDueBill.id}`}
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        Open in Bills
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      onClick={() => setSelectedDueBill(null)}
                      className="w-full sm:w-auto"
                    >
                      Close
                    </Button>
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>

        {/* Payment Dialog */}
        <Dialog
          open={showPaymentDialog}
          onOpenChange={(open) => {
            setShowPaymentDialog(open);
            if (!open) {
              setSelectedClient(null);
              setPaymentAmount("");
              setPaymentNotes("");
            }
          }}
        >
          <DialogContent aria-describedby={undefined} className="sm:max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Package className="w-5 h-5 text-primary" />
                Pay Outstanding Balance
              </DialogTitle>
              <DialogDescription>
                Process payment for {selectedClient?.name}
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
                {selectedClient && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Current Balance: AED{" "}
                    {(pendingBillsByClient[selectedClient.id]?.amount || 0).toFixed(2)}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="paymentMethod">Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select payment method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="bank">Bank Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
                  onClick={() => setShowPaymentDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleProcessPayment}
                  disabled={payBillMutation.isPending}
                >
                  {payBillMutation.isPending ? "Processing..." : "Pay Now"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>
    </div>
  );
}
