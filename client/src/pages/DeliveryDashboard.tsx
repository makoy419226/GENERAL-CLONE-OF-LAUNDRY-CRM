import { useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as ShadcnCalendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Truck,
  MapPin,
  History,
  Phone,
  Mail,
  Globe,
  Clock,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  ArrowUpDown,
  Search,
  RefreshCw,
  Camera,
  AlertTriangle,
  Calendar,
  Zap,
  Wallet,
  Receipt,
  DollarSign,
  RotateCcw,
  Printer,
} from "lucide-react";
import { format } from "date-fns";
import { useCompanyContactInfo } from "@/lib/companyContact";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { BillItemsPopover } from "@/components/BillItemsPopover";
import DeliveryHistorySection from "@/components/DeliveryHistorySection";
import { PayBillDialog } from "@/components/PayBillDialog";
import type { Order, Client, Bill } from "@shared/schema";

const PAYMENT_SETTLED_EPSILON = 0.009;
const ALL_TIME_INITIAL_ORDER_LIMIT = 30;
const ALL_TIME_LOAD_INCREMENT = 15;
type DeliveryDateFilter = "all" | "today" | "yesterday" | "exact";
type DeliverySortOrder = "newest" | "oldest";
type DeliveryBillItemRow = {
  name: string;
  qty: number;
  price: number;
  total: number;
};

// Compress image to reduce size before upload
const compressImage = (file: File, maxWidth: number = 1200, quality: number = 0.7): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Scale down if larger than maxWidth
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
};

const parseOrderItems = (
  itemsString: string | null,
): Array<{ name: string; quantity: number }> => {
  if (!itemsString) return [];

  const trimmed = itemsString.trim();

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item: any) => ({
          name: item.name || item.productName || "Unknown",
          quantity: item.quantity || item.qty || 1,
        }));
      }
    } catch {
      // Fall back to string parsing below.
    }
  }

  return itemsString.split(", ").map((item) => {
    const quantityFirstMatch = item.match(/^(\d+)x\s+(.+)$/);
    if (quantityFirstMatch) {
      return {
        name: quantityFirstMatch[2].trim(),
        quantity: parseInt(quantityFirstMatch[1], 10),
      };
    }

    const nameFirstMatch = item.match(/^(.+)\s+x(\d+)$/);
    if (nameFirstMatch) {
      return {
        name: nameFirstMatch[1].trim(),
        quantity: parseInt(nameFirstMatch[2], 10),
      };
    }

    return { name: item.trim(), quantity: 1 };
  });
};

const parseMoneyValue = (value: unknown) => {
  const parsed = parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const stripDeliveryItemPriceText = (name: string) =>
  String(name || "")
    .replace(/\s*\(base\s*[\d.]+\s*AED\)/gi, "")
    .replace(/\s*@\s*[\d.]+\s*AED(?:\s*\((custom|min\s*50|admin\s*edited)\))?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const parseDeliveryBillItems = (
  description?: string | null,
  fallbackItems?: string | null,
): DeliveryBillItemRow[] => {
  const source = String(description || fallbackItems || "").trim();
  if (!source) return [];

  if (source.startsWith("[")) {
    try {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item: any) => {
            const qty = parseInt(String(item.quantity ?? item.qty ?? "1"), 10);
            const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 1;
            const price = parseMoneyValue(item.price ?? item.unitPrice);
            const total = parseMoneyValue(item.total);

            return {
              name: stripDeliveryItemPriceText(
                item.name || item.productName || "Unknown",
              ),
              qty: safeQty,
              price,
              total: total > 0 ? total : safeQty * price,
            };
          })
          .filter((item) => item.name.length > 0);
      }
    } catch {
      // Fall back to comma-separated parsing below.
    }
  }

  const orderPrefixMatch = source.match(/Order #[A-Z0-9-]+:\s*/i);
  const itemsText = orderPrefixMatch ? source.replace(orderPrefixMatch[0], "") : source;

  return itemsText
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(\d+)x\s+(.+)$/i);
      const qty = match ? parseInt(match[1], 10) : 1;
      const rawName = match ? match[2].trim() : part;
      const embeddedPriceMatch = rawName.match(/@\s*([\d.]+)\s*AED/i);
      const price = embeddedPriceMatch ? parseMoneyValue(embeddedPriceMatch[1]) : 0;
      const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 1;

      return {
        name: stripDeliveryItemPriceText(rawName),
        qty: safeQty,
        price,
        total: safeQty * price,
      };
    })
    .filter((item) => item.name.length > 0);
};

const isDeliveryOrderType = (deliveryType?: string | null) =>
  String(deliveryType || "").trim().toLowerCase() === "delivery";

const hasExpectedDate = (order: Pick<Order, "expectedDeliveryAt">) => {
  if (!order.expectedDeliveryAt) return false;
  return !Number.isNaN(new Date(order.expectedDeliveryAt).getTime());
};

const isBillPaidForDeliveryFilter = (
  bill?: Pick<Bill, "amount" | "paidAmount" | "isPaid"> | null,
) => {
  if (!bill) return false;
  if (bill.isPaid) return true;

  const amount = parseFloat(String(bill.amount ?? "0"));
  const paidAmount = parseFloat(String(bill.paidAmount ?? "0"));

  if (!Number.isFinite(amount) || !Number.isFinite(paidAmount)) {
    return false;
  }

  return paidAmount >= Math.max(0, amount - PAYMENT_SETTLED_EPSILON);
};

const getDeliveryBillDisplayAmounts = (bill: Bill) => {
  const finalAmount = parseMoneyValue(bill.amount);
  const paidAmount = parseMoneyValue(bill.paidAmount);
  const discount = parseMoneyValue((bill as any).discountAmount);
  const originalRaw = parseFloat(String((bill as any).originalAmount ?? ""));
  const originalAmount =
    Number.isFinite(originalRaw) && String((bill as any).originalAmount ?? "").trim()
      ? Math.max(0, originalRaw)
      : Math.max(0, finalAmount + discount);

  return {
    originalAmount,
    discount,
    finalAmount,
    paidAmount,
    due: Math.max(0, finalAmount - paidAmount),
  };
};

const getDeliveryBillStatusMeta = (bill: Bill, displayAmounts: ReturnType<typeof getDeliveryBillDisplayAmounts>) => {
  const isPaid = bill.isPaid || displayAmounts.due <= 0.01;
  const isPartial = !isPaid && displayAmounts.paidAmount > 0.01;

  if (isPaid) {
    return {
      label: "PAID",
      badgeClass: "bg-green-500 hover:bg-green-600",
      mobileCardClass: "border-emerald-200/80 bg-gradient-to-br from-white via-emerald-50/70 to-emerald-100/70 dark:from-card dark:via-emerald-950/20 dark:to-emerald-950/35",
      accentClass: "from-emerald-400 via-green-500 to-teal-500",
      summaryClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }

  if (isPartial) {
    return {
      label: "PARTIAL",
      badgeClass: "bg-amber-500 hover:bg-amber-600",
      mobileCardClass: "border-amber-200/80 bg-gradient-to-br from-white via-amber-50/70 to-orange-100/70 dark:from-card dark:via-amber-950/20 dark:to-orange-950/30",
      accentClass: "from-amber-400 via-orange-500 to-yellow-500",
      summaryClass: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }

  return {
    label: "UNPAID",
    badgeClass: "bg-blue-500 hover:bg-blue-600",
    mobileCardClass: "border-sky-200/80 bg-gradient-to-br from-white via-sky-50/70 to-blue-100/70 dark:from-card dark:via-sky-950/20 dark:to-blue-950/30",
    accentClass: "from-sky-400 via-blue-500 to-indigo-500",
    summaryClass: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  };
};

const formatDeliveryPaymentMethodLabel = (method?: string | null): string => {
  const normalized = String(method || "").trim();
  if (!normalized) return "-";

  const parts = normalized
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    return parts.map((part) => formatDeliveryPaymentMethodLabel(part)).join(" + ");
  }

  switch (normalized.toLowerCase()) {
    case "cash":
      return "Cash";
    case "card":
      return "Card";
    case "bank":
    case "transfer":
      return "Bank Transfer";
    case "deposit":
      return "Account Credit";
    default:
      return normalized.toUpperCase();
  }
};

const formatDeliveryBillDateTime = (value?: string | Date | null) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : format(date, "dd/MM/yyyy hh:mm a");
};

const formatDeliveryBillDate = (value?: string | Date | null) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : format(date, "dd MMM yyyy");
};

export default function DeliveryDashboard() {
  const { companyContact } = useCompanyContactInfo();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [pinDialogOrder, setPinDialogOrder] = useState<Order | null>(null);
  const [deliveryPin, setDeliveryPin] = useState("");
  const [deliveryPhoto, setDeliveryPhoto] = useState<string | null>(null);
  const [itemCountVerified, setItemCountVerified] = useState(false);
  const [payBillDialogBillId, setPayBillDialogBillId] = useState<number | null>(null);
  const [deliveryBillDetailsId, setDeliveryBillDetailsId] = useState<number | null>(null);
  const [deliveryBillRevertTargetId, setDeliveryBillRevertTargetId] = useState<number | null>(null);
  const [deliveryBillRevertPin, setDeliveryBillRevertPin] = useState("");
  const [deliveryBillRevertError, setDeliveryBillRevertError] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const deliveryListScrollRef = useRef<HTMLDivElement>(null);
  
  const [dateFilter, setDateFilter] = useState<DeliveryDateFilter>("today");
  const [exactDate, setExactDate] = useState<Date | undefined>(undefined);
  const [deliverySortOrder, setDeliverySortOrder] = useState<DeliverySortOrder>("newest");
  const [visibleAllTimeOrderLimit, setVisibleAllTimeOrderLimit] = useState(
    ALL_TIME_INITIAL_ORDER_LIMIT,
  );
  const [showUrgentOnly, setShowUrgentOnly] = useState(false);
  const [showNormalOnly, setShowNormalOnly] = useState(false);
  const [showExpectedDateOnly, setShowExpectedDateOnly] = useState(false);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<"all" | "paid" | "unpaid">("all");

  const formatOrderTrackingDateParam = (value: string | Date | null | undefined) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const openOrderInTracking = (order: Order) => {
    const params = new URLSearchParams();
    params.set("focusOrderId", String(order.id));
    if (order.billId) {
      params.set("focusBillId", String(order.billId));
    }
    params.set("focusDateField", "entry");
    params.set("focusTab", "all");

    const focusDate = formatOrderTrackingDateParam(order.entryDate);
    if (focusDate) {
      params.set("focusDate", focusDate);
    }

    setLocation(`/orders?${params.toString()}`);
  };

  const getUrgencyCardClasses = (urgent: boolean) =>
    urgent
      ? "border border-red-200/80 bg-red-50/75 shadow-[0_12px_26px_-24px_rgba(239,68,68,0.9)] dark:border-red-900/60 dark:bg-red-950/20"
      : "border border-emerald-200/75 bg-emerald-50/45 shadow-[0_12px_26px_-24px_rgba(16,185,129,0.75)] dark:border-emerald-900/60 dark:bg-emerald-950/15";

  const getUrgencyBadgeClasses = (urgent: boolean) =>
    urgent
      ? "bg-red-500 px-2 py-0 text-[11px] text-white"
      : "border border-emerald-200/80 bg-emerald-50 px-2 py-0 text-[11px] font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200";

  const { data: orders, isLoading: ordersLoading } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
    refetchOnWindowFocus: true,
    refetchInterval: 60000, // Refresh every 60 seconds to reduce load
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: bills } = useQuery<Bill[]>({
    queryKey: ["/api/bills"],
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const clientMap = useMemo(() => {
    const map = new Map<number, Client>();
    (clients || []).forEach((client) => map.set(client.id, client));
    return map;
  }, [clients]);

  const billMap = useMemo(() => {
    const map = new Map<number, Bill>();
    (bills || []).forEach((bill) => map.set(bill.id, bill));
    return map;
  }, [bills]);
  const payBillDialogBill = payBillDialogBillId
    ? billMap.get(payBillDialogBillId) || null
    : null;
  const payBillDialogClient = payBillDialogBill?.clientId
    ? clientMap.get(payBillDialogBill.clientId) || null
    : null;
  const deliveryBillDetailsBill = deliveryBillDetailsId
    ? billMap.get(deliveryBillDetailsId) || null
    : null;
  const deliveryBillDetailsClient = deliveryBillDetailsBill?.clientId
    ? clientMap.get(deliveryBillDetailsBill.clientId) || null
    : null;
  const deliveryBillDetailsOrder = useMemo(
    () =>
      deliveryBillDetailsId
        ? (orders || []).find((order) => order.billId === deliveryBillDetailsId) || null
        : null,
    [deliveryBillDetailsId, orders],
  );

  const deliverMutation = useMutation({
    mutationFn: async ({ orderId, pin, photo, verified }: { orderId: number; pin: string; photo: string | null; verified: boolean }) => {
      return apiRequest("POST", `/api/orders/${orderId}/deliver-by-driver`, {
        pin,
        deliveryPhoto: photo,
        itemCountVerified: verified,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Success", description: "Order marked as delivered" });
      setPinDialogOrder(null);
      setDeliveryPin("");
      setDeliveryPhoto(null);
      setItemCountVerified(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const revertDeliveryBillPaymentMutation = useMutation({
    mutationFn: async ({ billId, adminPin }: { billId: number; adminPin: string }) => {
      const currentUser = localStorage.getItem("username") || "";
      return apiRequest("POST", `/api/bills/${billId}/revert-payment`, {
        adminPin,
        revertedBy: currentUser,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bill-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-selection"] });
      toast({
        title: "Payment Reverted",
        description: `Bill #${deliveryBillRevertTargetId} has been reverted to unpaid.`,
      });
      setDeliveryBillRevertTargetId(null);
      setDeliveryBillRevertPin("");
      setDeliveryBillRevertError("");
    },
    onError: (error: Error) => {
      setDeliveryBillRevertError(error.message || "Failed to revert payment");
    },
  });

  const getClient = (order: Order) => {
    return clients?.find((c) => c.id === order.clientId);
  };

  const normalizeAddress = (value: string | null | undefined) => {
    const trimmed = String(value || "").trim();
    if (!trimmed || trimmed === "-" || trimmed === "0") return "";
    return trimmed;
  };

  const getOrderDisplayAddress = (order: Order, client?: Client | null) => {
    const orderAddress = normalizeAddress(order.deliveryAddress);
    if (orderAddress) return orderAddress;

    const linkedClient =
      client ?? (order.clientId ? clientMap.get(order.clientId) : undefined);

    const clientAddress = normalizeAddress(linkedClient?.address);
    if (clientAddress) return clientAddress;

    const brokerAddress = ((((linkedClient as any)?.brokerAddresses || []) as string[])
      .map((address) => normalizeAddress(address))
      .find(Boolean)) || "";

    return brokerAddress;
  };

  const dateBounds = useMemo(() => {
    let fromTs: number | null = null;
    let toTs: number | null = null;

    if (dateFilter === "all") {
      return { fromTs, toTs };
    }

    if (dateFilter === "today" || dateFilter === "yesterday") {
      const start = new Date();
      if (dateFilter === "yesterday") {
        start.setDate(start.getDate() - 1);
      }
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      fromTs = start.getTime();
      toTs = end.getTime();
    } else if (dateFilter === "exact" && exactDate) {
      const start = new Date(exactDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      fromTs = start.getTime();
      toTs = end.getTime();
    }

    return { fromTs, toTs };
  }, [dateFilter, exactDate]);

  const readyForDeliveryOrders = orders?.filter((order) => {
    if (!order.packingDone) return false;
    if (order.delivered) return false;
    if (dateFilter === "exact" && !exactDate) return false;

    const orderDate = order.entryDate ? new Date(order.entryDate) : null;
    if (!orderDate || Number.isNaN(orderDate.getTime())) return false;
    if (dateBounds.fromTs !== null && orderDate.getTime() < dateBounds.fromTs) return false;
    if (dateBounds.toTs !== null && orderDate.getTime() > dateBounds.toTs) return false;
    return true;
  }) || [];

  const filteredOrders = readyForDeliveryOrders.filter((order) => {
    const client = getClient(order);
    const searchLower = searchTerm.toLowerCase();
    return (
      order.orderNumber?.toLowerCase().includes(searchLower) ||
      order.customerName?.toLowerCase().includes(searchLower) ||
      (client?.phone || "").toLowerCase().includes(searchLower) ||
      getOrderDisplayAddress(order, client).toLowerCase().includes(searchLower)
    );
  });

  const isOrderBillPaid = (order: Pick<Order, "billId">) =>
    isBillPaidForDeliveryFilter(order.billId ? billMap.get(order.billId) : null);

  const deliveryFilterSourceOrders = filteredOrders.filter((order) =>
    isDeliveryOrderType(order.deliveryType),
  );

  const deliveryOrders = filteredOrders
    .filter((o) => {
      if (!isDeliveryOrderType(o.deliveryType)) return false;
      if (showUrgentOnly && !o.urgent) return false;
      if (showNormalOnly && o.urgent) return false;
      if (showExpectedDateOnly && !hasExpectedDate(o)) return false;
      if (paymentStatusFilter === "paid" && !isOrderBillPaid(o)) return false;
      if (paymentStatusFilter === "unpaid" && isOrderBillPaid(o)) return false;
      return true;
    })
    .sort((a, b) => {
      const dateA = a.entryDate ? new Date(a.entryDate).getTime() : 0;
      const dateB = b.entryDate ? new Date(b.entryDate).getTime() : 0;
      if (dateA !== dateB) {
        return deliverySortOrder === "oldest" ? dateA - dateB : dateB - dateA;
      }
      return deliverySortOrder === "oldest" ? a.id - b.id : b.id - a.id;
    });

  const visibleDeliveryOrders =
    dateFilter === "all"
      ? deliveryOrders.slice(0, visibleAllTimeOrderLimit)
      : deliveryOrders;
  const hasMoreAllTimeDeliveryOrders =
    dateFilter === "all" && visibleDeliveryOrders.length < deliveryOrders.length;

  const deliveryPriorityCounts = useMemo(
    () => ({
      normal: deliveryFilterSourceOrders.filter((order) => !order.urgent).length,
      urgent: deliveryFilterSourceOrders.filter((order) => order.urgent).length,
    }),
    [deliveryFilterSourceOrders],
  );
  const expectedDateFilterCount = useMemo(
    () => deliveryFilterSourceOrders.filter((order) => hasExpectedDate(order)).length,
    [deliveryFilterSourceOrders],
  );
  const paymentStatusFilterCounts = useMemo(
    () => ({
      paid: deliveryFilterSourceOrders.filter((order) => isOrderBillPaid(order)).length,
      unpaid: deliveryFilterSourceOrders.filter((order) => !isOrderBillPaid(order)).length,
    }),
    [billMap, deliveryFilterSourceOrders],
  );
  const handleNormalOnlyToggle = () => {
    setShowNormalOnly((current) => {
      const next = !current;
      if (next) setShowUrgentOnly(false);
      return next;
    });
  };
  const handleUrgentOnlyToggle = () => {
    setShowUrgentOnly((current) => {
      const next = !current;
      if (next) setShowNormalOnly(false);
      return next;
    });
  };
  const handleExpectedDateOnlyToggle = () => {
    setShowExpectedDateOnly((current) => !current);
  };
  const handlePaymentStatusFilterToggle = (value: "paid" | "unpaid") => {
    setPaymentStatusFilter((current) => (current === value ? "all" : value));
  };
  const handleDeliveryListScroll = () => {
    if (!hasMoreAllTimeDeliveryOrders) return;

    const list = deliveryListScrollRef.current;
    if (!list) return;

    const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (distanceToBottom > 8) return;

    setVisibleAllTimeOrderLimit(
      Math.min(visibleAllTimeOrderLimit + ALL_TIME_LOAD_INCREMENT, deliveryOrders.length),
    );
  };
  const getTodayFilterDate = () => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  };
  const getYesterdayFilterDate = () => {
    const date = getTodayFilterDate();
    date.setDate(date.getDate() - 1);
    return date;
  };
  const isSameCalendarDay = (left: Date | undefined, right: Date) => {
    if (!left) return false;
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    );
  };
  const activeDateFilterLabel = useMemo(() => {
    if (dateFilter === "all") return "All Time";
    if (dateFilter === "yesterday") return "Yesterday";
    if (dateFilter === "today") return "Today";

    if (dateFilter === "exact") {
      return exactDate ? format(exactDate, "dd MMM yyyy") : "Pick a specific day";
    }

    return "All Time";
  }, [dateFilter, exactDate]);

  useEffect(() => {
    setVisibleAllTimeOrderLimit(ALL_TIME_INITIAL_ORDER_LIMIT);
  }, [
    dateFilter,
    deliverySortOrder,
    exactDate,
    paymentStatusFilter,
    searchTerm,
    showExpectedDateOnly,
    showNormalOnly,
    showUrgentOnly,
  ]);
  const hasActiveDeliveryQueueFilters =
    searchTerm.trim().length > 0 ||
    showNormalOnly ||
    showUrgentOnly ||
    showExpectedDateOnly ||
    paymentStatusFilter !== "all";

  const currentFilterDate = useMemo(() => {
    const base =
      dateFilter === "exact" && exactDate
        ? new Date(exactDate)
        : dateFilter === "yesterday"
          ? getYesterdayFilterDate()
          : getTodayFilterDate();
    base.setHours(0, 0, 0, 0);
    return base;
  }, [dateFilter, exactDate]);
  const isTodayShortcutActive =
    dateFilter === "today" ||
    (dateFilter === "exact" && isSameCalendarDay(exactDate, getTodayFilterDate()));
  const isYesterdayShortcutActive =
    dateFilter === "yesterday" ||
    (dateFilter === "exact" && isSameCalendarDay(exactDate, getYesterdayFilterDate()));

  const changeFilterDate = (delta: number) => {
    const next = new Date(currentFilterDate);
    next.setDate(next.getDate() + delta);
    setDateFilter("exact");
    setExactDate(next);
  };

  const deliveryOrderGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        date: Date;
        orders: Order[];
      }
    >();

    visibleDeliveryOrders.forEach((order) => {
      if (!order.entryDate) return;
      const orderDate = new Date(order.entryDate);
      if (Number.isNaN(orderDate.getTime())) return;

      const dateOnly = new Date(orderDate);
      dateOnly.setHours(0, 0, 0, 0);
      const key = format(dateOnly, "yyyy-MM-dd");
      const existing = groups.get(key);

      if (existing) {
        existing.orders.push(order);
        return;
      }

      groups.set(key, {
        date: dateOnly,
        orders: [order],
      });
    });

    return Array.from(groups.entries())
      .map(([key, group]) => ({
        key,
        date: group.date,
        orders: group.orders.sort((a, b) => {
          const aTime = a.entryDate ? new Date(a.entryDate).getTime() : 0;
          const bTime = b.entryDate ? new Date(b.entryDate).getTime() : 0;
          if (aTime !== bTime) {
            return deliverySortOrder === "oldest" ? aTime - bTime : bTime - aTime;
          }
          return deliverySortOrder === "oldest" ? a.id - b.id : b.id - a.id;
        }),
      }))
      .sort((a, b) =>
        deliverySortOrder === "oldest"
          ? a.date.getTime() - b.date.getTime()
          : b.date.getTime() - a.date.getTime(),
      )
      .map((group) => ({
        ...group,
        urgentCount: group.orders.filter((order) => !!order.urgent).length,
      }));
  }, [deliverySortOrder, visibleDeliveryOrders]);

  const deliveryFilterButtonClassName =
    "h-8 w-full justify-center gap-1 rounded-full px-2 text-[10px] font-semibold shadow-none sm:w-auto sm:min-w-[118px]";
  const deliveryNormalButtonClassName = cn(
    deliveryFilterButtonClassName,
    "border-emerald-200/80 bg-emerald-50/75 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100/80 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200 dark:hover:bg-emerald-950/35",
    showNormalOnly &&
      "border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-500 dark:border-emerald-400 dark:bg-emerald-500 dark:text-white shadow-[0_14px_28px_-24px_rgba(16,185,129,0.95)]",
  );
  const deliveryUrgentButtonClassName = cn(
    deliveryFilterButtonClassName,
    "border-red-200/80 bg-red-50/75 text-red-700 hover:border-red-300 hover:bg-red-100/80 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200 dark:hover:bg-red-950/35",
    showUrgentOnly &&
      "border-red-500 bg-red-500 text-white hover:bg-red-500 dark:border-red-400 dark:bg-red-500 dark:text-white shadow-[0_14px_28px_-24px_rgba(239,68,68,0.95)]",
  );
  const deliveryExpectedDateButtonClassName = cn(
    deliveryFilterButtonClassName,
    "border-amber-200/80 bg-amber-50/75 text-amber-700 hover:border-amber-300 hover:bg-amber-100/80 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200 dark:hover:bg-amber-950/35",
    showExpectedDateOnly &&
      "border-amber-500 bg-amber-500 text-white hover:bg-amber-500 dark:border-amber-400 dark:bg-amber-500 dark:text-white shadow-[0_14px_28px_-24px_rgba(245,158,11,0.95)]",
  );
  const deliveryPaidButtonClassName = cn(
    deliveryFilterButtonClassName,
    "border-green-200/80 bg-green-50/75 text-green-700 hover:border-green-300 hover:bg-green-100/80 dark:border-green-900/60 dark:bg-green-950/20 dark:text-green-200 dark:hover:bg-green-950/35",
    paymentStatusFilter === "paid" &&
      "border-green-500 bg-green-500 text-white hover:bg-green-500 dark:border-green-400 dark:bg-green-500 dark:text-white shadow-[0_14px_28px_-24px_rgba(34,197,94,0.95)]",
  );
  const deliveryUnpaidButtonClassName = cn(
    deliveryFilterButtonClassName,
    "border-rose-200/80 bg-rose-50/75 text-rose-700 hover:border-rose-300 hover:bg-rose-100/80 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-200 dark:hover:bg-rose-950/35",
    paymentStatusFilter === "unpaid" &&
      "border-rose-500 bg-rose-500 text-white hover:bg-rose-500 dark:border-rose-400 dark:bg-rose-500 dark:text-white shadow-[0_14px_28px_-24px_rgba(244,63,94,0.95)]",
  );
  const deliveryFilterControls = (
    <div className="grid w-full grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:justify-start">
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          setDeliverySortOrder((current) =>
            current === "newest" ? "oldest" : "newest",
          )
        }
        data-testid="button-toggle-delivery-sort"
        className={cn(
          deliveryFilterButtonClassName,
          "border-sky-200/80 bg-sky-50/75 text-sky-700 hover:border-sky-300 hover:bg-sky-100/80 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200 dark:hover:bg-sky-950/35",
        )}
      >
        <ArrowUpDown className="h-3.25 w-3.25" />
        <span>{deliverySortOrder === "newest" ? "Newest First" : "Oldest First"}</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={handleNormalOnlyToggle}
        data-testid="button-toggle-normal-delivery"
        className={deliveryNormalButtonClassName}
      >
        <Clock className="h-3.25 w-3.25" />
        <span>Normal Only</span>
        <span className="inline-flex min-w-[1.3rem] items-center justify-center rounded-full border border-current/20 bg-current/10 px-1.25 py-0.5 text-[9px] font-semibold leading-none">
          {deliveryPriorityCounts.normal}
        </span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={handleUrgentOnlyToggle}
        data-testid="button-toggle-urgent-delivery"
        className={deliveryUrgentButtonClassName}
      >
        <Zap className="h-3.25 w-3.25" />
        <span>Urgent Only</span>
        <span className="inline-flex min-w-[1.3rem] items-center justify-center rounded-full border border-current/20 bg-current/10 px-1.25 py-0.5 text-[9px] font-semibold leading-none">
          {deliveryPriorityCounts.urgent}
        </span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={handleExpectedDateOnlyToggle}
        data-testid="button-toggle-expected-date-delivery"
        className={deliveryExpectedDateButtonClassName}
      >
        <Calendar className="h-3.25 w-3.25" />
        <span>Expected Date</span>
        <span className="inline-flex min-w-[1.3rem] items-center justify-center rounded-full border border-current/20 bg-current/10 px-1.25 py-0.5 text-[9px] font-semibold leading-none">
          {expectedDateFilterCount}
        </span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => handlePaymentStatusFilterToggle("paid")}
        data-testid="button-toggle-paid-bill-delivery"
        className={deliveryPaidButtonClassName}
      >
        <Wallet className="h-3.25 w-3.25" />
        <span>Paid Bill</span>
        <span className="inline-flex min-w-[1.3rem] items-center justify-center rounded-full border border-current/20 bg-current/10 px-1.25 py-0.5 text-[9px] font-semibold leading-none">
          {paymentStatusFilterCounts.paid}
        </span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => handlePaymentStatusFilterToggle("unpaid")}
        data-testid="button-toggle-unpaid-bill-delivery"
        className={deliveryUnpaidButtonClassName}
      >
        <Receipt className="h-3.25 w-3.25" />
        <span>Unpaid Bill</span>
        <span className="inline-flex min-w-[1.3rem] items-center justify-center rounded-full border border-current/20 bg-current/10 px-1.25 py-0.5 text-[9px] font-semibold leading-none">
          {paymentStatusFilterCounts.unpaid}
        </span>
      </Button>
    </div>
  );
  const deliveryListHeader = (
    <div className="space-y-3 border-b border-sky-200/70 bg-gradient-to-r from-sky-50/85 via-emerald-50/75 to-amber-50/70 px-4 py-4 dark:border-sky-900/40 dark:from-sky-950/25 dark:via-emerald-950/20 dark:to-amber-950/20 md:px-5">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          Delivery orders by date, sorted {deliverySortOrder === "newest" ? "newest first" : "oldest first"}.
        </p>
        {dateFilter === "all" && (
          <p className="text-xs font-medium text-muted-foreground">
            Showing {visibleDeliveryOrders.length} of {deliveryOrders.length} all-time ready orders.
          </p>
        )}
      </div>
      {deliveryFilterControls}
    </div>
  );

  const openDeliveryBillDetails = (bill?: Bill | null) => {
    if (!bill) {
      toast({
        title: "No Bill Found",
        description: "This delivery order does not have a linked bill yet.",
        variant: "destructive",
      });
      return;
    }

    setDeliveryBillDetailsId(bill.id);
  };

  const openDeliveryBillPayment = (bill?: Bill | null) => {
    if (!bill) {
      toast({
        title: "No Bill Found",
        description: "This delivery order does not have a linked bill yet.",
        variant: "destructive",
      });
      return;
    }

    if (isBillPaidForDeliveryFilter(bill)) {
      toast({
        title: "Already Paid",
        description: `Bill #${bill.id} is already settled.`,
      });
      return;
    }

    setPayBillDialogBillId(bill.id);
  };

  const openDeliveryBillRevertDialog = (billId?: number | null) => {
    if (!billId) return;
    setDeliveryBillRevertTargetId(billId);
    setDeliveryBillRevertPin("");
    setDeliveryBillRevertError("");
  };

  const confirmDeliveryBillRevert = () => {
    if (!deliveryBillRevertTargetId) return;
    if (!/^\d{5}$/.test(deliveryBillRevertPin.trim())) {
      setDeliveryBillRevertError("Please enter the 5-digit admin PIN");
      return;
    }

    setDeliveryBillRevertError("");
    revertDeliveryBillPaymentMutation.mutate({
      billId: deliveryBillRevertTargetId,
      adminPin: deliveryBillRevertPin,
    });
  };

  const handleDeliveryConfirm = (order: Order) => {
    setDeliveryPin("");
    setDeliveryPhoto(null);
    setItemCountVerified(false);
    setPinDialogOrder(order);
  };

  const pinDialogItemCount = useMemo(() => {
    if (!pinDialogOrder) return 0;

    const parsedCount = parseOrderItems(pinDialogOrder.items).reduce(
      (sum, item) => sum + (item.quantity || 1),
      0,
    );

    return pinDialogOrder.itemCountAtIntake ?? parsedCount;
  }, [pinDialogOrder]);

  const pinDialogBill =
    pinDialogOrder?.billId ? billMap.get(pinDialogOrder.billId) || null : null;
  const pinDialogItemRows = useMemo(
    () =>
      parseDeliveryBillItems(
        pinDialogBill?.description,
        pinDialogOrder?.items,
      ),
    [pinDialogBill?.description, pinDialogOrder?.items],
  );

  const handlePinSubmit = () => {
    if (!pinDialogOrder || deliveryPin.length !== 5 || !itemCountVerified) return;
    deliverMutation.mutate({
      orderId: pinDialogOrder.id,
      pin: deliveryPin,
      photo: deliveryPhoto,
      verified: itemCountVerified,
    });
  };

  useEffect(() => {
    if (!pinDialogOrder || !itemCountVerified) return;

    const focusTimer = window.setTimeout(() => {
      pinInputRef.current?.focus();
      pinInputRef.current?.select();
    }, 50);

    return () => window.clearTimeout(focusTimer);
  }, [pinDialogOrder, itemCountVerified]);

  if (ordersLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-sky-50/35 via-background to-emerald-50/30 p-3 dark:from-sky-950/15 dark:via-background dark:to-emerald-950/10 md:p-6">
      <div className="relative mx-auto max-w-7xl space-y-4 md:space-y-6">
        <div
          className="overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-md"
          data-testid="delivery-dashboard-contact-strip"
        >
          <div className="animate-marquee flex min-w-max whitespace-nowrap">
            {Array.from({ length: 6 }, (_, copyIndex) => (
              <div
                key={`delivery-dashboard-contact-strip-${copyIndex}`}
                className="flex shrink-0 items-center gap-8 pr-8 py-2 text-[11px] font-medium sm:gap-12 sm:pr-12 sm:text-xs"
                aria-hidden={copyIndex > 0}
              >
                <span className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5" />
                  <span>Phone: {companyContact.mobilePhone || "-"}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5" />
                  <span>Email: {companyContact.email || "-"}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5" />
                  <span>{companyContact.website || "-"}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5" />
                  <span>Tel: {companyContact.telephone || "-"}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-3 lg:p-4">
          <div className="grid items-center justify-items-center gap-2 lg:grid-cols-[minmax(16rem,1fr)_auto_minmax(16rem,1fr)]">
            <div className="relative w-full max-w-[32rem] min-w-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search orders, clients, phone, or address..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 border-sky-200/80 bg-sky-50/40 pl-9 text-sm focus-visible:ring-sky-500 dark:border-sky-900/50 dark:bg-sky-950/10"
                data-testid="input-search-delivery"
              />
            </div>

            <div className="flex min-w-0 justify-center">
              <div className="inline-flex max-w-full rounded-xl border border-amber-200/80 bg-amber-50/50 px-2 py-1.5 dark:border-amber-900/50 dark:bg-amber-950/10">
                <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-1.5">
                  <Button
                    variant={dateFilter === "all" ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setDateFilter("all");
                      setExactDate(undefined);
                    }}
                    data-testid="button-delivery-all-time"
                    className="h-7 gap-1 px-2.5 text-[10px]"
                  >
                    <History className="h-3 w-3" />
                    All Time
                  </Button>
                  <Button
                    variant={isYesterdayShortcutActive ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setDateFilter("yesterday");
                      setExactDate(getYesterdayFilterDate());
                    }}
                    data-testid="button-delivery-yesterday-shortcut"
                    className="h-7 px-2.5 text-[10px]"
                  >
                    Yesterday
                  </Button>
                  <Button
                    variant={isTodayShortcutActive ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setDateFilter("today");
                      setExactDate(getTodayFilterDate());
                    }}
                    data-testid="button-delivery-today-shortcut"
                    className="h-7 px-2.5 text-[10px]"
                  >
                    Today
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => changeFilterDate(-1)}
                    data-testid="button-prev-delivery-date"
                    className="h-7 w-7"
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 min-w-[118px] justify-center gap-1.5 px-2.5 text-center text-[10px] font-medium"
                        data-testid="input-delivery-date-selector"
                      >
                        <Calendar className="h-3 w-3" />
                        {format(currentFilterDate, "dd MMM yyyy")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="center" className="w-auto p-0">
                      <ShadcnCalendar
                        mode="single"
                        selected={currentFilterDate}
                        onSelect={(date) => {
                          if (!date) return;
                          setDateFilter("exact");
                          setExactDate(date);
                        }}
                        initialFocus
                        className="p-2"
                        classNames={{
                          months: "flex flex-col",
                          month: "space-y-2",
                          caption: "relative flex items-center justify-center pt-0",
                          caption_label: "text-xs font-semibold",
                          nav: "flex items-center space-x-1",
                          nav_button:
                            "inline-flex h-6 w-6 items-center justify-center rounded-md border border-input bg-background p-0 text-muted-foreground opacity-70 hover:bg-accent hover:text-accent-foreground hover:opacity-100",
                          nav_button_previous: "absolute left-1",
                          nav_button_next: "absolute right-1",
                          table: "w-full border-collapse",
                          head_row: "flex",
                          head_cell:
                            "w-7 rounded-md text-[0.65rem] font-medium text-muted-foreground",
                          row: "mt-1 flex w-full",
                          cell: "relative h-7 w-7 p-0 text-center text-[11px] focus-within:relative focus-within:z-20",
                          day: "inline-flex h-7 w-7 items-center justify-center rounded-md p-0 text-[11px] font-normal hover:bg-accent hover:text-accent-foreground aria-selected:opacity-100",
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => changeFilterDate(1)}
                    data-testid="button-next-delivery-date"
                    className="h-7 w-7"
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                  <Badge className="h-7 border border-primary/15 bg-primary/10 px-2.5 py-0 text-[10px] font-semibold text-primary">
                    {activeDateFilterLabel}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <Button
                size="sm"
                variant={isHistoryOpen ? "default" : "outline"}
                onClick={() => setIsHistoryOpen(true)}
                data-testid="button-toggle-delivery-history"
                className="h-8 gap-2 border-blue-200/80 bg-blue-50/80 px-3 text-[11px] text-blue-700 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-200"
              >
                <History className="h-3.5 w-3.5" />
                Delivery History
              </Button>
            </div>
          </div>
        </div>

        {deliveryOrderGroups.length > 0 && (
          <Card className="overflow-hidden border border-emerald-200/70 bg-background/95 shadow-sm dark:border-emerald-900/40">
            {deliveryListHeader}

            <div
              ref={deliveryListScrollRef}
              onScroll={handleDeliveryListScroll}
              className="max-h-[calc(100vh-23rem)] min-h-[18rem] overflow-y-auto px-4 pb-12 pt-4 scroll-pb-12 md:max-h-[calc(100vh-25rem)] md:px-5"
            >
              <div className="space-y-5 pb-2">
                {deliveryOrderGroups.map((group) => (
                  <section key={group.key} className="space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200/70 bg-sky-50/70 px-3 py-2 dark:border-sky-900/50 dark:bg-sky-950/15">
                      <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-100">
                        {format(group.date, "EEEE, MMM d, yyyy")}
                      </h2>
                      <Badge className="border border-sky-200/80 bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
                        {group.orders.length} {group.orders.length === 1 ? "order" : "orders"}
                      </Badge>
                      {group.urgentCount > 0 && (
                        <Badge className="border border-red-200/70 bg-red-50/80 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
                          {group.urgentCount} urgent
                        </Badge>
                      )}
                    </div>

                    <div className="space-y-2">
                      {group.orders.map((order) => {
                        const client = getClient(order);
                        const displayAddress = getOrderDisplayAddress(order, client);
                        const isUrgent = !!order.urgent;
                        const orderBill = order.billId ? billMap.get(order.billId) : null;
                        const isCardBillPaid =
                          !!orderBill && isBillPaidForDeliveryFilter(orderBill);

                        return (
                          <div
                            key={order.id}
                            className={cn(
                              "grid w-full gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-150 hover:bg-white/55 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center dark:hover:bg-white/5",
                              getUrgencyCardClasses(isUrgent),
                            )}
                            data-testid={`card-delivery-${order.id}`}
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-sky-200/80 bg-sky-50 px-2.5 py-1 text-sm font-bold text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/25 dark:text-sky-200">
                                  #{order.orderNumber}
                                </span>
                                <Badge className={getUrgencyBadgeClasses(isUrgent)}>
                                  {isUrgent ? "Urgent" : "Normal"}
                                </Badge>
                              </div>

                              <div className="mt-2">
                                <p className="text-sm font-semibold text-foreground md:text-base">
                                  {order.customerName || client?.name || "Unknown Customer"}
                                </p>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                  {client?.phone && (
                                    <span className="inline-flex items-center gap-1">
                                      <Phone className="h-3.5 w-3.5" />
                                      {client.phone}
                                    </span>
                                  )}
                                  <span className="inline-flex min-w-0 items-center gap-1">
                                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                                    <span className="max-w-[30rem] truncate">
                                      {displayAddress || "No delivery address provided"}
                                    </span>
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="grid w-full grid-cols-3 gap-2 lg:w-auto lg:justify-self-center">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openOrderInTracking(order)}
                                data-testid={`button-open-order-${order.id}`}
                                className="h-9 min-w-0 justify-center border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-700 hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200 sm:min-w-[6rem]"
                              >
                                Tracking
                              </Button>
                              {isCardBillPaid ? (
                                <button
                                  type="button"
                                  onClick={() => openDeliveryBillDetails(orderBill)}
                                  data-testid={`indicator-paid-bill-delivery-${order.id}`}
                                  className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-3 text-xs font-semibold text-green-700 dark:border-green-900/60 dark:bg-green-950/20 dark:text-green-200 sm:min-w-[6rem]"
                                >
                                  <CheckCircle className="h-4 w-4" />
                                  Paid
                                </button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openDeliveryBillDetails(orderBill)}
                                  data-testid={`button-record-payment-delivery-${order.id}`}
                                  className="h-9 min-w-0 justify-center gap-1.5 border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-200 sm:min-w-[6rem]"
                                >
                                  <Wallet className="h-4 w-4" />
                                  Pay
                                </Button>
                              )}
                              <Button
                                size="sm"
                                onClick={() => handleDeliveryConfirm(order)}
                                data-testid={`button-deliver-${order.id}`}
                                className="h-9 min-w-0 justify-center gap-1.5 bg-emerald-600 px-3 text-xs font-semibold hover:bg-emerald-700 sm:min-w-[6rem]"
                              >
                                <CheckCircle className="h-4 w-4" />
                                Deliver
                              </Button>
                            </div>

                            <div className="min-w-0 text-xs text-muted-foreground sm:text-center md:text-sm lg:justify-self-end lg:text-right">
                              <p className="truncate">
                                {order.entryDate ? format(new Date(order.entryDate), "dd MMM yyyy, h:mm a") : "No timestamp"}
                              </p>
                              <p className="mt-1 truncate text-amber-600 dark:text-amber-300">
                                Due: {order.expectedDeliveryAt
                                  ? format(new Date(order.expectedDeliveryAt), "dd MMM yyyy, h:mm a")
                                  : "No delivery date set"}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              {hasMoreAllTimeDeliveryOrders && (
                <div
                  className="flex justify-center px-4 py-4 text-xs font-semibold text-muted-foreground"
                  data-testid="delivery-autoload-sentinel"
                >
                  Loading more orders...
                </div>
              )}
            </div>
          </Card>
        )}

        {deliveryOrderGroups.length === 0 && (
          <Card className="overflow-hidden border border-sky-200/70 bg-background/95 shadow-sm dark:border-sky-900/40">
            {deliveryListHeader}
            <div className="p-8 text-center md:p-10">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl border border-sky-200/80 bg-sky-50 text-sky-600 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200">
                <Truck className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-foreground">No delivery orders in this queue</h2>
              <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {dateFilter === "exact" && !exactDate
                    ? "Pick a specific date above to load the delivery queue for that day."
                      : hasActiveDeliveryQueueFilters
                        ? "No delivery orders match the selected filters."
                      : dateFilter === "exact" && exactDate
                        ? `No orders are ready for delivery on ${format(exactDate, "dd MMM yyyy")}.`
                        : dateFilter === "yesterday"
                          ? "No orders were packed and ready for delivery yesterday."
                        : dateFilter === "today"
                          ? "No orders are currently packed and ready for delivery today."
                          : "No orders are currently packed and ready for delivery."}
              </p>
            </div>
          </Card>
        )}

      </div>

      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] border-none bg-transparent p-0 shadow-none sm:w-[40vw] sm:max-w-[40vw]"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Delivery History</DialogTitle>
          </DialogHeader>
          <DeliveryHistorySection
            variant="panel"
            onOrderRedirect={() => setIsHistoryOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deliveryBillDetailsId}
        onOpenChange={(open) => {
          if (!open) setDeliveryBillDetailsId(null);
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className={`w-[min(96vw,44rem)] max-w-xl max-h-[85vh] overflow-y-auto ${
            deliveryBillDetailsBill?.isPaid
              ? "bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/50 border-green-200 dark:border-green-800"
              : deliveryBillDetailsBill && parseMoneyValue(deliveryBillDetailsBill.paidAmount) > 0
                ? "bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/50 dark:to-yellow-950/50 border-amber-200 dark:border-amber-800"
                : "bg-gradient-to-br from-blue-50 to-sky-50 dark:from-blue-950/50 dark:to-sky-950/50 border-blue-200 dark:border-blue-800"
          }`}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Bill Details</DialogTitle>
            <DialogDescription>View bill details, payment status, and payment actions.</DialogDescription>
          </DialogHeader>

          {deliveryBillDetailsBill && (() => {
            const bill = deliveryBillDetailsBill;
            const displayAmounts = getDeliveryBillDisplayAmounts(bill);
            const statusMeta = getDeliveryBillStatusMeta(bill, displayAmounts);
            const hasPaidAmount = displayAmounts.paidAmount > 0.009;
            const latestPaymentDate = (bill as any).paymentProcessedAt || null;
            const customerName = bill.customerName || deliveryBillDetailsClient?.name || deliveryBillDetailsOrder?.customerName || "Unknown Customer";
            const accountNumber = deliveryBillDetailsClient?.billNumber?.trim();
            const phone = deliveryBillDetailsClient?.phone || bill.customerPhone || "";
            const address = deliveryBillDetailsOrder
              ? getOrderDisplayAddress(deliveryBillDetailsOrder, deliveryBillDetailsClient)
              : deliveryBillDetailsClient?.address || "";
            const itemRows = parseDeliveryBillItems(bill.description, deliveryBillDetailsOrder?.items);

            return (
              <div className="space-y-3">
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
                              {bill.referenceNumber && (
                                <span className="truncate rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-border/60">
                                  Ref {bill.referenceNumber}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                              <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                Bill #{bill.id}
                              </span>
                              <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                {formatDeliveryBillDate(bill.billDate)}
                              </span>
                              {accountNumber && (
                                <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                  Acc {accountNumber}
                                </span>
                              )}
                              {bill.createdBy && (
                                <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                  By {bill.createdBy}
                                </span>
                              )}
                              {latestPaymentDate && (
                                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                                  Paid {formatDeliveryBillDate(latestPaymentDate)}
                                </span>
                              )}
                            </div>
                          </div>
                          <Badge className={`shrink-0 text-[10px] text-white shadow-sm ${statusMeta.badgeClass}`}>
                            {statusMeta.label}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={`rounded-xl border border-border/50 bg-background/70 ${isMobile ? "p-3" : "p-4"}`}>
                  <p className={isMobile ? "truncate text-lg font-bold" : "text-xl font-bold"}>
                    {customerName}
                    {accountNumber && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">({accountNumber})</span>
                    )}
                  </p>
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Bill #</span>
                      <span className="font-medium">#{bill.id}</span>
                    </div>
                    {accountNumber && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Bill Number</span>
                        <span className="font-medium">{accountNumber}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Created On</span>
                      <span className="font-medium">{formatDeliveryBillDateTime(bill.billDate)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Paid On</span>
                      <span className={latestPaymentDate ? "font-medium text-green-600" : "text-muted-foreground"}>
                        {formatDeliveryBillDateTime(latestPaymentDate)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 space-y-1">
                    {deliveryBillDetailsClient?.company && (
                      <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-700">
                        Company: {deliveryBillDetailsClient.company}
                      </Badge>
                    )}
                    {phone && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{phone}</span>
                      </div>
                    )}
                    {address && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{address}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className={`grid gap-3 ${bill.isPaid || hasPaidAmount ? "grid-cols-3" : "grid-cols-2"}`}>
                  <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                    <p className="text-xs text-muted-foreground">Work Received</p>
                    <p className="text-2xl font-bold text-primary">
                      {displayAmounts.originalAmount.toFixed(2)} <span className="text-sm">AED</span>
                    </p>
                    {displayAmounts.discount > 0 && (
                      <div className="mt-1">
                        <p className="text-xs text-orange-600">Disc: -{displayAmounts.discount.toFixed(2)}</p>
                        <p className="text-sm font-semibold text-green-700">Final: {displayAmounts.finalAmount.toFixed(2)} AED</p>
                      </div>
                    )}
                  </div>
                  <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="text-lg font-semibold">{formatDeliveryBillDate(bill.billDate)}</p>
                  </div>
                  {(bill.isPaid || hasPaidAmount) && (
                    <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                      <p className="text-xs text-muted-foreground mb-1">Payment Method</p>
                      <div className="flex min-h-9 items-center rounded-md border bg-background px-3 py-1 text-sm font-medium leading-5">
                        <span className="whitespace-normal break-words">
                          {formatDeliveryPaymentMethodLabel(bill.paymentMethod)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {itemRows.length > 0 && (
                  <BillItemsPopover
                    items={itemRows}
                    rawDescription={bill.description || deliveryBillDetailsOrder?.items || ""}
                    title={`Bill #${bill.id} Items`}
                    subtitle={`${customerName} - ${formatDeliveryBillDate(bill.billDate)}`}
                    dataTestId={`button-delivery-bill-items-popover-${bill.id}`}
                    disablePortal
                  />
                )}

                {!bill.isPaid && hasPaidAmount && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 rounded-lg">
                    <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold mb-2">Payment Breakdown</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Previously Paid:</span>
                        <span className="font-medium text-green-600">{displayAmounts.paidAmount.toFixed(2)} AED</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">New Total:</span>
                        <span className="font-medium">{displayAmounts.finalAmount.toFixed(2)} AED</span>
                      </div>
                      <div className="flex justify-between border-t border-amber-200 dark:border-amber-700 pt-1 mt-1">
                        <span className="font-semibold text-amber-700 dark:text-amber-400">Amount Due:</span>
                        <span className="font-bold text-red-600">{displayAmounts.due.toFixed(2)} AED</span>
                      </div>
                    </div>
                  </div>
                )}

                {(bill as any).notes && (
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
                    <p className="text-xs text-blue-700 dark:text-blue-400 font-semibold mb-2">History</p>
                    <div className="text-xs text-blue-600 dark:text-blue-300 whitespace-pre-wrap">
                      {(bill as any).notes}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2">
                  {!bill.isPaid && displayAmounts.due > 0.009 && (
                    <Button
                      className="flex-1 bg-blue-600 hover:bg-blue-700"
                      onClick={() => {
                        setDeliveryBillDetailsId(null);
                        openDeliveryBillPayment(bill);
                      }}
                      data-testid="button-pay-now-delivery-bill"
                    >
                      <DollarSign className="w-4 h-4 mr-2" />
                      Pay Now
                    </Button>
                  )}
                  {(bill.isPaid || hasPaidAmount) && (
                    <Button
                      variant="outline"
                      className="flex-1 text-orange-600 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                      disabled={revertDeliveryBillPaymentMutation.isPending}
                      onClick={() => openDeliveryBillRevertDialog(bill.id)}
                      data-testid="button-revert-payment-delivery-bill"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      {revertDeliveryBillPaymentMutation.isPending ? "Reverting..." : "Revert Payment"}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setDeliveryBillDetailsId(null);
                      setLocation(`/bills?printBill=${bill.id}`);
                    }}
                    data-testid="button-print-delivery-bill"
                  >
                    <Printer className="w-4 h-4 mr-2" />
                    Print
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <PayBillDialog
        bill={payBillDialogBill}
        client={payBillDialogClient}
        open={!!payBillDialogBillId}
        onOpenChange={(open) => {
          if (!open) setPayBillDialogBillId(null);
        }}
      />

      <Dialog
        open={!!deliveryBillRevertTargetId}
        onOpenChange={(open) => {
          if (!open && !revertDeliveryBillPaymentMutation.isPending) {
            setDeliveryBillRevertTargetId(null);
            setDeliveryBillRevertPin("");
            setDeliveryBillRevertError("");
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Revert Bill Payment</DialogTitle>
            <DialogDescription>
              This will reset the bill to unpaid and remove payment records. Enter the admin PIN to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Admin PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={5}
                value={deliveryBillRevertPin}
                onChange={(event) => {
                  setDeliveryBillRevertPin(event.target.value.replace(/\D/g, "").slice(0, 5));
                  setDeliveryBillRevertError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    confirmDeliveryBillRevert();
                  }
                }}
                placeholder="Enter 5-digit admin PIN"
                data-testid="input-delivery-bill-revert-pin"
              />
              {deliveryBillRevertError && (
                <p className="mt-1 text-xs text-destructive">{deliveryBillRevertError}</p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDeliveryBillRevertTargetId(null);
                setDeliveryBillRevertPin("");
                setDeliveryBillRevertError("");
              }}
              disabled={revertDeliveryBillPaymentMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              className="bg-orange-600 hover:bg-orange-700"
              disabled={revertDeliveryBillPaymentMutation.isPending}
              onClick={confirmDeliveryBillRevert}
              data-testid="button-confirm-delivery-bill-revert"
            >
              {revertDeliveryBillPaymentMutation.isPending ? "Reverting..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pinDialogOrder} onOpenChange={() => { 
        setPinDialogOrder(null); 
        setDeliveryPin(""); 
        setDeliveryPhoto(null);
        setItemCountVerified(false);
      }}>
        <DialogContent aria-describedby={undefined} className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5" />
              Confirm Delivery
            </DialogTitle>
          </DialogHeader>
          
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-200">This action cannot be undone</p>
                <p className="text-amber-700 dark:text-amber-300">Order status and delivery type cannot be changed after confirmation.</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <Label className="flex items-center gap-2 mb-2">
                <Camera className="w-4 h-4" />
                Delivery Photo (Optional)
              </Label>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    try {
                      const compressed = await compressImage(file, 1200, 0.7);
                      setDeliveryPhoto(compressed);
                    } catch (err) {
                      toast({ title: "Error", description: "Failed to process photo", variant: "destructive" });
                    }
                  }
                }}
              />
              {deliveryPhoto ? (
                <div className="relative">
                  <img src={deliveryPhoto} alt="Delivery" className="w-full h-32 object-cover rounded-lg" />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute top-2 right-2"
                    onClick={() => setDeliveryPhoto(null)}
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full h-20 border-dashed"
                  onClick={() => photoInputRef.current?.click()}
                >
                  <Camera className="w-5 h-5 mr-2" />
                  Tap to open camera
                </Button>
              )}
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Confirm Items</p>
                  <p className="text-xs text-muted-foreground">
                    Verify the release count before final delivery.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <Badge
                    variant="outline"
                    className="border-primary/20 bg-primary/5 px-2.5 py-1 text-sm font-bold text-primary"
                    data-testid="badge-delivery-item-count"
                  >
                    {pinDialogItemCount} items
                  </Badge>
                  {pinDialogOrder && pinDialogItemRows.length > 0 && (
                    <BillItemsPopover
                      items={pinDialogItemRows}
                      rawDescription={pinDialogBill?.description || pinDialogOrder.items}
                      title={`Order #${pinDialogOrder.orderNumber} Items`}
                      subtitle={`${pinDialogItemRows.length} line item${
                        pinDialogItemRows.length === 1 ? "" : "s"
                      }`}
                      trigger={
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 rounded-lg border-primary/20 bg-background/90 px-2.5 text-xs text-primary hover:bg-primary/5"
                          data-testid={`button-delivery-confirm-items-table-${pinDialogOrder.id}`}
                        >
                          <Receipt className="h-3.5 w-3.5" />
                          View Table
                        </Button>
                      }
                      disablePortal
                    />
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-start gap-3">
                <Checkbox
                  id="delivery-item-verified"
                  checked={itemCountVerified}
                  onCheckedChange={(checked) => setItemCountVerified(checked === true)}
                  data-testid="checkbox-delivery-item-verified"
                />
                <label
                  htmlFor="delivery-item-verified"
                  className="text-sm leading-snug text-foreground"
                >
                  I confirm all {pinDialogItemCount} items are present and match intake.
                </label>
              </div>
            </div>

            <div>
              <Label className="flex items-center gap-2 mb-2">
                <MapPin className="w-4 h-4" />
                Delivery Address
              </Label>
              <Textarea
                value={(pinDialogOrder ? getOrderDisplayAddress(pinDialogOrder, getClient(pinDialogOrder)) : "") || "n/a"}
                readOnly
                className="resize-none bg-muted"
                rows={2}
              />
            </div>

            <div>
              <Label className="mb-2 block">Enter Driver PIN</Label>
              <Input
                ref={pinInputRef}
                type="password"
                inputMode="numeric"
                placeholder={itemCountVerified ? "Enter 5-digit PIN" : "Confirm items first"}
                value={deliveryPin}
                onChange={(e) => setDeliveryPin(e.target.value.replace(/\D/g, "").slice(0, 5))}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !isMobile &&
                    !deliverMutation.isPending &&
                    deliveryPin.length === 5 &&
                    itemCountVerified
                  ) {
                    e.preventDefault();
                    handlePinSubmit();
                  }
                }}
                maxLength={5}
                disabled={!itemCountVerified || deliverMutation.isPending}
                className="text-center text-lg tracking-widest"
                data-testid="input-driver-pin"
              />
              {!itemCountVerified && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Item confirmation required before PIN entry.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setPinDialogOrder(null);
                  setDeliveryPin("");
                  setDeliveryPhoto(null);
                  setItemCountVerified(false);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-amber-500 hover:bg-amber-600"
                onClick={handlePinSubmit}
                disabled={deliverMutation.isPending || deliveryPin.length !== 5 || !itemCountVerified}
                data-testid="button-submit-delivery"
              >
                {deliverMutation.isPending
                  ? "Confirming..."
                  : itemCountVerified
                    ? "Confirm Delivery"
                    : "Confirm Items First"}
              </Button>
            </div>
            {!itemCountVerified && (
              <p className="text-center text-sm text-amber-600 dark:text-amber-400">
                Please confirm the item count before delivery.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
