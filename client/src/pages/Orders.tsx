import { useState, useEffect, useMemo, useRef, useContext, useCallback, useLayoutEffect, forwardRef, useImperativeHandle } from "react";

import React from "react";
type BillWithPaymentRecorder = Bill & {
  paymentProcessedBy?: string | null;
  paymentProcessedAt?: string | null;
};

type OrderPayBillDialogHandle = {
  openBill: (billId: number) => void;
};

const OrderPayBillDialogHost = forwardRef<OrderPayBillDialogHandle>((_, ref) => {
  const [billId, setBillId] = useState<number | null>(null);
  const { data: bills } = useBills({ enabled: billId !== null });
  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: billId !== null,
    staleTime: 30000,
  });

  useImperativeHandle(
    ref,
    () => ({
      openBill: (nextBillId: number) => setBillId(nextBillId),
    }),
    [],
  );

  const bill = useMemo(
    () => (billId ? (bills || []).find((candidate) => candidate.id === billId) || null : null),
    [billId, bills],
  );
  const client = useMemo(
    () =>
      bill?.clientId
        ? (clients || []).find((candidate) => candidate.id === bill.clientId) || null
        : null,
    [bill?.clientId, clients],
  );

  return (
    <PayBillDialog
      bill={bill}
      client={client}
      open={billId !== null}
      onOpenChange={(open) => {
        if (!open) setBillId(null);
      }}
    />
  );
});

OrderPayBillDialogHost.displayName = "OrderPayBillDialogHost";

type TrackingSelectionItem = Pick<
  Order,
  "id" | "tagDone" | "packingDone" | "delivered" | "urgent" | "deliveryType" | "expectedDeliveryAt"
> & {
  billIsPaid: boolean | null;
};

type TrackingSearchFieldKey =
  | "accountNumber"
  | "orderNumber"
  | "billAmount"
  | "billNumber"
  | "nameAddress"
  | "mobileNumber"
  | "companyName";

type TrackingSearchFilters = Record<TrackingSearchFieldKey, string>;
type TrackingSortOrder = "newest" | "oldest";

const TRACKING_SEARCH_FIELD_KEYS: TrackingSearchFieldKey[] = [
  "accountNumber",
  "orderNumber",
  "billAmount",
  "billNumber",
  "nameAddress",
  "mobileNumber",
  "companyName",
];

const EMPTY_TRACKING_SEARCH_FILTERS: TrackingSearchFilters = {
  accountNumber: "",
  orderNumber: "",
  billAmount: "",
  billNumber: "",
  nameAddress: "",
  mobileNumber: "",
  companyName: "",
};

function hasTrackingSearchFilters(filters: TrackingSearchFilters): boolean {
  return TRACKING_SEARCH_FIELD_KEYS.some((key) => filters[key].trim().length > 0);
}

function areTrackingSearchFiltersEqual(
  first: TrackingSearchFilters,
  second: TrackingSearchFilters,
): boolean {
  return TRACKING_SEARCH_FIELD_KEYS.every((key) => first[key] === second[key]);
}

function normalizeTrackingReferenceSearch(value: string): string {
  return value.trim().replace(/^#/, "").toLowerCase();
}

function normalizeTrackingExactBillNumber(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^#/, "")
    .replace(/^bill[-\s#]*/i, "")
    .toLowerCase();
}

function normalizeTrackingExactOrderNumber(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^#/, "")
    .replace(/^ord[-\s#]*/i, "")
    .toLowerCase();
}

function normalizeTrackingMoneySearch(value: string): string {
  return value
    .trim()
    .replace(/\baed\b/gi, "")
    .replace(/,/g, "")
    .trim()
    .toLowerCase();
}

function matchesTrackingMoneySearch(amount: number, normalizedSearch: string): boolean {
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

function getTrackingSearchFiltersFromParams(params: URLSearchParams): TrackingSearchFilters {
  const fieldFilters: TrackingSearchFilters = {
    accountNumber: params.get("accountNumber") || "",
    orderNumber: params.get("orderNumber") || "",
    billAmount: params.get("billAmount") || "",
    billNumber: params.get("billNumber") || "",
    nameAddress: params.get("nameAddress") || "",
    mobileNumber: params.get("mobileNumber") || "",
    companyName: params.get("companyName") || "",
  };

  if (hasTrackingSearchFilters(fieldFilters)) {
    return fieldFilters;
  }

  const legacySearch = (params.get("search") || "").trim();
  if (!legacySearch) {
    return fieldFilters;
  }

  const normalizedPhone = normalizePhoneForComparison(legacySearch);
  const normalizedReference = legacySearch.replace(/^#/, "").trim();

  if (/^acc-/i.test(normalizedReference)) {
    return {
      ...EMPTY_TRACKING_SEARCH_FILTERS,
      accountNumber: legacySearch,
    };
  }

  if (normalizedPhone.length >= 7) {
    return {
      ...EMPTY_TRACKING_SEARCH_FILTERS,
      mobileNumber: legacySearch,
    };
  }

  if (/^\d+$/.test(normalizedReference)) {
    return normalizedReference.length <= 5
      ? {
          ...EMPTY_TRACKING_SEARCH_FILTERS,
          billNumber: normalizedReference,
        }
      : {
          ...EMPTY_TRACKING_SEARCH_FILTERS,
          orderNumber: normalizedReference,
        };
  }

  return {
    ...EMPTY_TRACKING_SEARCH_FILTERS,
    nameAddress: legacySearch,
  };
}

function appendTrackingSearchFilters(
  params: URLSearchParams,
  filters: TrackingSearchFilters,
) {
  TRACKING_SEARCH_FIELD_KEYS.forEach((key) => {
    const value = filters[key].trim();
    if (value) {
      params.set(key, value);
    }
  });
}

function isAdminOrCounterRole(role?: string | null): boolean {
  const normalizedRole = String(role || "").toLowerCase();
  return normalizedRole === "admin" || normalizedRole === "counter" || normalizedRole === "reception";
}

const isAccountCreditDeductionType = (type?: string | null) =>
  type === "deposit_used" || type === "bulk_deposit_used" || type === "deposit_deduction";

const getAccountActivityTypeDisplay = (transaction: ClientTransaction) => {
  if (transaction.type === "deposit") {
    return { label: "Add Credit", color: "bg-green-100 text-green-700" };
  }

  if (transaction.type === "deposit_used" || transaction.type === "bulk_deposit_used") {
    return { label: "Paid with Credit", color: "bg-orange-100 text-orange-700" };
  }

  if (transaction.type === "deposit_deduction") {
    return { label: "Deduct Credit", color: "bg-rose-100 text-rose-700" };
  }

  if (transaction.type === "payment_reverted") {
    return { label: "Payment Reverted", color: "bg-rose-100 text-rose-700" };
  }

  if (transaction.type === "bill") {
    return { label: "Bill", color: "bg-blue-100 text-blue-700" };
  }

  if (transaction.type === "bulk_payment") {
    return {
      label: `Bulk Payment (${formatOrderPaymentMethodLabel(transaction.paymentMethod || "cash")})`,
      color: "bg-amber-100 text-amber-700",
    };
  }

  if (transaction.type === "payment" || transaction.paymentMethod) {
    return {
      label: `Paid in ${formatOrderPaymentMethodLabel(transaction.paymentMethod || "cash")}`,
      color: "bg-purple-100 text-purple-700",
    };
  }

  return { label: transaction.type || "Activity", color: "bg-gray-100 text-gray-700" };
};

const getBillRecordedByLabel = (bill?: BillWithPaymentRecorder | null) => {
  const processedBy = String(bill?.paymentProcessedBy || "").trim();
  return processedBy || "-";
};

type ErrorBoundaryProps = {
  children?: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: unknown;
};

// ErrorBoundary for catching runtime errors in dialogs
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return <div style={{ color: 'red', padding: 16 }}>Something went wrong in this dialog.<br/>{String(this.state.error)}</div>;
    }
    return this.props.children;
  }
}

import { UserContext } from "@/App";
import {
  getInvoiceItemDescriptionHtml,
  getInvoiceItemDisplayDetails,
} from "@/components/InvoiceItemDescription";
import { ClientForm } from "@/components/ClientForm";
import {
  escapeHtml,
  formatCompanyPhoneLine,
  getCompanyAddressLines,
  getWorkspaceLogoUrl,
  useCompanyContactInfo,
} from "@/lib/companyContact";
import { isEditableKeyboardShortcutTarget } from "@/lib/keyboardShortcuts";
import { normalizePhoneForComparison } from "@shared/phone";
import { useSearch, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getProductImage as getStockProductImage } from "@/lib/productImages";
import logoImage from "@/assets/images/lwl-logo.png";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as ShadcnCalendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Loader2,
  Package,
  Shirt,
  CheckCircle,
  CheckCircle2,
  Truck,
  Clock,
  AlertTriangle,
  Plus,
  Minus,
  Search,
  Bell,
  Printer,
  User,
  Receipt,
  Download,
  Camera,
  Image,
  X,
  Tag,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Home,
  Sparkles,
  ShoppingCart,
  Footprints,
  RotateCcw,
  MapPin,
  Phone,
  Edit,
  Store,
  CreditCard,
  Banknote,
  Users,
  Calendar as CalendarIcon,
  Zap,
  Check,
  Trash2,
  DollarSign,
  NotepadText,
  Building2,
  Wallet,
  ExternalLink,
  Undo2,
  ChevronUp,
  GripVertical,
  Save,
  Key,
  Lock,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const DEFAULT_DELIVERY_CHARGE_AMOUNT = 10;

function parseSqmDescriptionPart(
  part: string,
  products?: any[],
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
  const cleanName = rawName
    .replace(/\s*\(base\s*[\d.]+\s*AED\)\s*/gi, " ")
    .replace(/\s*\(\s*[\d.]+\s*AED\s*\)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const productLookupName = cleanName
    .replace(/\s*\(per\s*SQ\s*MTR\)\s*$/i, "")
    .replace(/\s*\[[^\]]*\]\s*/g, "")
    .trim();
  const sqmProduct = products?.find(
    (product: any) => product.name.toLowerCase() === productLookupName.toLowerCase(),
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

function getEditOrderItemTotal(item: { name: string; quantity: number; price: number }): number {
  return item.quantity * Number(item.price || 0);
}

function getEmbeddedUnitPrice(name: string): number | null {
  const embeddedPriceMatch = String(name || "").match(/@\s*([\d.]+)\s*AED/i);
  if (!embeddedPriceMatch) return null;
  const parsed = parseFloat(embeddedPriceMatch[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function getEmbeddedBaseUnitPrice(name: string): number | null {
  const embeddedBasePriceMatch = String(name || "").match(/\(base\s*([\d.]+)\s*AED\)/i);
  if (!embeddedBasePriceMatch) return null;
  const parsed = parseFloat(embeddedBasePriceMatch[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSqmBaseUnitPriceFromCurrentPrice(
  itemName: string,
  currentUnitPrice: number,
  products?: any[],
): number | null {
  const sqmItem = parseSqmDescriptionPart(itemName, products);
  if (!sqmItem) return null;
  const embeddedBaseUnitPrice = getEmbeddedBaseUnitPrice(itemName);
  if (Number.isFinite(embeddedBaseUnitPrice)) {
    return Number(embeddedBaseUnitPrice);
  }
  const safeCurrentUnitPrice = Number.isFinite(currentUnitPrice) ? currentUnitPrice : sqmItem.price;
  return /\*URG\*/i.test(itemName) ? safeCurrentUnitPrice / 2 : safeCurrentUnitPrice;
}

function parseDescriptionItems(description: string, products?: any[]): { name: string; qty: number; price: number; total: number }[] {
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
      const isUrgent = name.includes('*URG*');
      const serviceMatch = name.match(/\[(N|DC|IO|D|I)\]/i);
      const serviceTag = serviceMatch ? serviceMatch[1].toUpperCase() : 'N';
      const isDC = serviceTag === 'DC' || serviceTag === 'D';
      const isIO = serviceTag === 'IO' || serviceTag === 'I';
      const sizeMatch = name.match(/\((Small|Medium|Large)\)/i);
      const size = sizeMatch ? sizeMatch[1].toLowerCase() : null;

      const baseName = name
        .replace(/\s*\*URG\*\s*/g, '')
        .replace(/\s*\[[^\]]*\]\s*/g, '')
        .replace(/\s*\(Small\)|\(Medium\)|\(Large\)|\(folding\)|\(hanger\)|\(hanging\)/gi, '')
        .replace(/\s*@\s*[\d.]+\s*AED/gi, '')
        .trim();
      let product = products?.find((p: any) => p.name.toLowerCase() === baseName.toLowerCase());
      if (!product) {
        product = products?.find((p: any) => p.name.toLowerCase() === name.replace(/\s*\[[^\]]*\]\s*/g, '').replace(/\s*\*URG\*\s*/g, '').trim().toLowerCase());
      }

      let price = 0;
      if (product) {
        let basePrice = parseFloat(product.price || '0');
        if (size === 'small' && product.smallPrice) basePrice = parseFloat(product.smallPrice);
        else if (size === 'medium' && product.mediumPrice) basePrice = parseFloat(product.mediumPrice);
        else if (size === 'large' && product.largePrice) basePrice = parseFloat(product.largePrice);

        if (isUrgent) {
          if (isIO) {
            if (size === 'small' && product.smallUrgentIronOnlyPrice) price = parseFloat(product.smallUrgentIronOnlyPrice);
            else if (size === 'medium' && product.mediumUrgentIronOnlyPrice) price = parseFloat(product.mediumUrgentIronOnlyPrice);
            else if (size === 'large' && product.largeUrgentIronOnlyPrice) price = parseFloat(product.largeUrgentIronOnlyPrice);
            else if (product.urgentIronOnlyPrice) price = parseFloat(product.urgentIronOnlyPrice);
            else {
              let ioPrice = basePrice / 2;
              if (size === 'small' && product.smallIronOnlyPrice) ioPrice = parseFloat(product.smallIronOnlyPrice);
              else if (size === 'medium' && product.mediumIronOnlyPrice) ioPrice = parseFloat(product.mediumIronOnlyPrice);
              else if (size === 'large' && product.largeIronOnlyPrice) ioPrice = parseFloat(product.largeIronOnlyPrice);
              else if (product.ironOnlyPrice) ioPrice = parseFloat(product.ironOnlyPrice);
              price = ioPrice * 2;
            }
          } else if (isDC) {
            if (size === 'small' && product.smallUrgentDryCleanPrice) price = parseFloat(product.smallUrgentDryCleanPrice);
            else if (size === 'medium' && product.mediumUrgentDryCleanPrice) price = parseFloat(product.mediumUrgentDryCleanPrice);
            else if (size === 'large' && product.largeUrgentDryCleanPrice) price = parseFloat(product.largeUrgentDryCleanPrice);
            else if (product.urgentDryCleanPrice) price = parseFloat(product.urgentDryCleanPrice);
            else {
              if (size === 'small' && product.smallDryCleanPrice) price = parseFloat(product.smallDryCleanPrice) * 2;
              else if (size === 'medium' && product.mediumDryCleanPrice) price = parseFloat(product.mediumDryCleanPrice) * 2;
              else if (size === 'large' && product.largeDryCleanPrice) price = parseFloat(product.largeDryCleanPrice) * 2;
              else price = parseFloat(product.dryCleanPrice || String(basePrice)) * 2;
            }
          } else {
            if (size === 'small' && product.smallUrgentPrice) price = parseFloat(product.smallUrgentPrice);
            else if (size === 'medium' && product.mediumUrgentPrice) price = parseFloat(product.mediumUrgentPrice);
            else if (size === 'large' && product.largeUrgentPrice) price = parseFloat(product.largeUrgentPrice);
            else price = basePrice * 2;
          }
        } else if (isDC) {
          if (size === 'small' && product.smallDryCleanPrice) price = parseFloat(product.smallDryCleanPrice);
          else if (size === 'medium' && product.mediumDryCleanPrice) price = parseFloat(product.mediumDryCleanPrice);
          else if (size === 'large' && product.largeDryCleanPrice) price = parseFloat(product.largeDryCleanPrice);
          else price = parseFloat(product.dryCleanPrice || String(basePrice * 2));
        } else if (isIO) {
          if (size === 'small' && product.smallIronOnlyPrice) price = parseFloat(product.smallIronOnlyPrice);
          else if (size === 'medium' && product.mediumIronOnlyPrice) price = parseFloat(product.mediumIronOnlyPrice);
          else if (size === 'large' && product.largeIronOnlyPrice) price = parseFloat(product.largeIronOnlyPrice);
          else price = parseFloat(product.ironOnlyPrice || String(basePrice / 2));
        } else {
          price = basePrice;
        }
      }
      return { name: displayName, qty, price, total: qty * price };
    }
    return { name: stripEmbeddedItemPriceText(part), qty: 1, price: 0, total: 0 };
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

function toDateOnlyKey(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateOnlyKey(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const getCategoryIcon = (category: string | null, size: string = "w-4 h-4") => {
  switch (category) {
    case "Arabic Clothes":
      return <Shirt className={`${size} text-amber-600`} />;
    case "Men's Clothes":
      return <Shirt className={`${size} text-blue-600`} />;
    case "Ladies' Clothes":
      return <Sparkles className={`${size} text-pink-500`} />;
    case "Baby Clothes":
      return <Sparkles className={`${size} text-purple-500`} />;
    case "Linens":
      return <Home className={`${size} text-green-600`} />;
    case "Shop Items":
      return <ShoppingCart className={`${size} text-cyan-600`} />;
    case "General Items":
    case "All Items":
    case "Uncategorized":
      return <Package className={`${size} text-gray-600`} />;
    default:
      return <Shirt className={`${size} text-primary`} />;
  }
};
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBills } from "@/hooks/use-bills";
import { apiRequest, extractApiErrorMessage, queryClient } from "@/lib/queryClient";
import {
  buildItemPickupStatusJson,
  getItemPickupCompletedQuantityFromMap,
  parseItemPickupStatusMap,
} from "@/lib/itemPickupStatus";
import { useProductCategorySettings } from "@/lib/productCategories";
import { OrderReceipt } from "@/components/OrderReceipt";
import { StageChecklist } from "@/components/StageChecklist";
import { BillItemsPopover } from "@/components/BillItemsPopover";
import { PayBillDialog } from "@/components/PayBillDialog";
import type { Order, Client, Product, Bill, ClientTransaction } from "@shared/schema";
import {
  DEFAULT_PRODUCT_CATEGORY_NAME,
  FAVORITES_PRODUCT_CATEGORY_NAME,
  UNCATEGORIZED_PRODUCT_CATEGORY_NAME,
  getProductCategoryDisplayName,
  getProductCategoryGroupName,
  normalizeCategoryNames,
  normalizeStoredProductCategoryName,
} from "@shared/productCategories";
import { addDays, format as fnsFormat, isSameDay, isValid } from "date-fns";

type StaffPinPreviewKey =
  | "packing"
  | "tag"
  | "delivery"
  | "discount"
  | "bulkTag"
  | "bulkPack"
  | "bulkDeliver"
  | "bulkTakeaway";

type StaffPinPreview = {
  name: string;
  roleLabel: string;
};

const EMPTY_STAFF_PIN_PREVIEWS: Record<StaffPinPreviewKey, StaffPinPreview | null> = {
  packing: null,
  tag: null,
  delivery: null,
  discount: null,
  bulkTag: null,
  bulkPack: null,
  bulkDeliver: null,
  bulkTakeaway: null,
};

const STAFF_PIN_PREVIEW_ENDPOINTS: Record<StaffPinPreviewKey, string> = {
  packing: "/api/packing/verify-pin",
  tag: "/api/delivery/verify-pin",
  delivery: "/api/delivery/verify-pin",
  discount: "/api/discounts/verify-pin",
  bulkTag: "/api/orders/bulk-stage/verify-pin",
  bulkPack: "/api/orders/bulk-stage/verify-pin",
  bulkDeliver: "/api/orders/bulk-stage/verify-pin",
  bulkTakeaway: "/api/orders/bulk-stage/verify-pin",
};

const formatStaffPinPreviewRole = (role: unknown): string => {
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
};

const getStaffPinPreview = (data: any): StaffPinPreview | null => {
  const rawName = data?.worker?.name || data?.member?.name || data?.user?.name;
  if (typeof rawName !== "string" || !rawName.trim()) return null;

  const rawRole =
    data?.worker?.role ||
    data?.worker?.roleType ||
    data?.member?.roleType ||
    data?.member?.role ||
    data?.user?.role ||
    data?.user?.type;

  return {
    name: rawName.trim(),
    roleLabel: formatStaffPinPreviewRole(rawRole),
  };
};

const safeFormat = (date: Date | string | number | null | undefined, fmt: string, fallback = "-"): string => {
  if (!date) return fallback;
  const d = date instanceof Date ? date : new Date(date);
  return isValid(d) ? fnsFormat(d, fmt) : fallback;
};

const format = (date: Date | number, fmt: string): string => {
  if (!date) return "-";
  const d = date instanceof Date ? date : new Date(date);
  return isValid(d) ? fnsFormat(d, fmt) : "-";
};
import html2pdf from "html2pdf.js";

const ORDERS_INITIAL_LOAD_COUNT = 50;
const ORDERS_LOAD_MORE_COUNT = 30;
const ORDERS_LOAD_MORE_THRESHOLD_PX = 160;
const PAYMENT_SETTLED_EPSILON = 0.009;
type OrderPaymentMethod = "cash" | "card" | "transfer" | "deposit";
type OrderBillStatusMeta = {
  label: "PAID" | "PARTIAL" | "UNPAID";
  badgeClass: string;
  mobileCardClass: string;
  accentClass: string;
  summaryClass: string;
};

const buildOrderSplitPaymentGroupId = () =>
  `SP-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;

const getOrderSplitPaymentTag = (groupId: string) => `[SPLIT:${groupId}]`;

const appendOrderSplitPaymentTag = (notes: string | undefined, groupId: string) => {
  const trimmedNotes = String(notes || "").trim();
  const tag = getOrderSplitPaymentTag(groupId);
  return trimmedNotes ? `${trimmedNotes} ${tag}` : tag;
};

function formatOrderPaymentMethodLabel(method?: string | null): string {
  const normalized = String(method || "").trim();
  if (!normalized) return "-";

  const parts = normalized
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    return parts.map((part) => formatOrderPaymentMethodLabel(part)).join(" + ");
  }

  switch (normalized.toLowerCase()) {
    case "cash":
      return "Cash";
    case "card":
      return "Card";
    case "transfer":
    case "bank":
      return "Bank Transfer";
    case "deposit":
      return "Account Credit";
    default:
      return normalized.toUpperCase();
  }
}

function isBillPaidForTracking(
  bill?: Pick<Bill, "amount" | "paidAmount" | "isPaid"> | null,
): boolean {
  if (!bill) return false;
  if (bill.isPaid) return true;

  const amount = parseFloat(String(bill.amount ?? "0"));
  const paidAmount = parseFloat(String(bill.paidAmount ?? "0"));

  if (!Number.isFinite(amount) || !Number.isFinite(paidAmount)) {
    return false;
  }

  return paidAmount >= Math.max(0, amount - PAYMENT_SETTLED_EPSILON);
}

function getEditableOrderPaymentMethodValue(method?: string | null): string | null {
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

function formatOrderSplitPaymentMethodLabel(method?: string | null): string {
  if (String(method || "").trim().toLowerCase() === "deposit") {
    return "Account Credit";
  }

  return formatOrderPaymentMethodLabel(method);
}

function isDeliveryOrderType(deliveryType?: string | null): boolean {
  return String(deliveryType || "").trim().toLowerCase() === "delivery";
}

function isIronOnlyOrderType(deliveryType?: string | null): boolean {
  return String(deliveryType || "").trim().toLowerCase() === "iron_only";
}

type StoredOrderItemServiceType = "normal" | "dc" | "iron_only";
type EditOrderItem = {
  name: string;
  quantity: number;
  price: number;
  baseUnitPrice?: number;
};
type EditOrderSplitDialogState =
  | {
      index: number;
      mode: "service";
      nextServiceType: StoredOrderItemServiceType;
    }
  | {
      index: number;
      mode: "urgent";
      nextUrgent: boolean;
    };
type EditOrderItemMixSummary = {
  firstIndex: number;
  lineCount: number;
  totalQuantity: number;
  urgentCount: number;
  serviceCounts: Record<StoredOrderItemServiceType, number>;
};

function getStoredOrderItemServiceType(
  itemName: string,
  deliveryType?: string | null,
): StoredOrderItemServiceType {
  const normalizedItemName = String(itemName || "");
  if (/\[(?:IO|I)\]/i.test(normalizedItemName)) {
    return "iron_only";
  }
  if (/\[(?:DC|D)\]/i.test(normalizedItemName)) {
    return "dc";
  }
  if (/\[N\]/i.test(normalizedItemName)) {
    return "normal";
  }

  const normalizedDeliveryType = String(deliveryType || "").trim().toLowerCase();
  if (normalizedDeliveryType === "dry_clean") {
    return "dc";
  }
  if (normalizedDeliveryType === "iron_only") {
    return "iron_only";
  }

  return "normal";
}

function getStoredOrderItemServiceTypeLabel(
  serviceType: StoredOrderItemServiceType,
): string {
  if (serviceType === "dc") {
    return "Dry Clean";
  }
  if (serviceType === "iron_only") {
    return "Iron Only";
  }
  return "Normal";
}

function getEditOrderItemMixKey(itemName: string): string {
  return stripEmbeddedItemPriceText(itemName)
    .replace(/\s*\*URG\*\s*/gi, " ")
    .replace(/\s*\[(?:N|DC|D|IO|I)\]\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .toLowerCase();
}

function shouldShowEditOrderItemMixSummary(
  summary?: EditOrderItemMixSummary | null,
): boolean {
  if (!summary) return false;
  const serviceBucketCount = [
    summary.serviceCounts.normal,
    summary.serviceCounts.dc,
    summary.serviceCounts.iron_only,
  ].filter((count) => count > 0).length;
  const hasMixedUrgency =
    summary.urgentCount > 0 && summary.urgentCount < summary.totalQuantity;

  return summary.lineCount > 1 || serviceBucketCount > 1 || hasMixedUrgency;
}

function formatEditOrderItemMixSummary(summary: EditOrderItemMixSummary): string {
  const parts: string[] = [];
  if (summary.serviceCounts.normal > 0) {
    parts.push(`Normal ${summary.serviceCounts.normal}`);
  }
  if (summary.serviceCounts.dc > 0) {
    parts.push(`Dry Clean ${summary.serviceCounts.dc}`);
  }
  if (summary.serviceCounts.iron_only > 0) {
    parts.push(`Iron Only ${summary.serviceCounts.iron_only}`);
  }
  if (summary.urgentCount > 0) {
    parts.push(`Urgent ${summary.urgentCount}`);
  }
  return `Mix: ${parts.join(" | ")}`;
}

function getOrderTrackingTypeLabel(deliveryType?: string | null): string {
  if (isIronOnlyOrderType(deliveryType)) {
    return "Iron Only";
  }

  return isDeliveryOrderType(deliveryType) ? "Delivery" : "Take-away";
}

function getOrderCompletedStatusLabel(deliveryType?: string | null): string {
  if (isDeliveryOrderType(deliveryType)) {
    return "Delivered";
  }

  if (isIronOnlyOrderType(deliveryType)) {
    return "Iron Done";
  }

  return "Taken Away";
}

function getOrderFinalTrackingLabel(
  deliveryType?: string | null,
  delivered?: boolean | null,
): string {
  if (delivered) {
    return getOrderCompletedStatusLabel(deliveryType);
  }

  return isDeliveryOrderType(deliveryType) ? "Deliver" : "Take-away";
}

function getOrderCompletionByLabel(deliveryType?: string | null): string {
  if (isDeliveryOrderType(deliveryType)) {
    return "Delivered by";
  }

  if (isIronOnlyOrderType(deliveryType)) {
    return "Completed by";
  }

  return "Taken away by";
}

function formatActorLabel(value?: string | null): string {
  return String(value || "")
    .replace(/\s*\(bulk\)\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getOrderCompletionDateLabel(deliveryType?: string | null): string {
  if (isDeliveryOrderType(deliveryType)) {
    return "Delivery";
  }

  if (isIronOnlyOrderType(deliveryType)) {
    return "Completed";
  }

  return "Taken away";
}

function getOrderExpectedTimeLabel(deliveryType?: string | null): string {
  return isDeliveryOrderType(deliveryType) ? "Expected Delivery" : "Pickup";
}

function hasExpectedDate(
  order: Pick<Order, "expectedDeliveryAt">,
): boolean {
  if (!order.expectedDeliveryAt) return false;
  return !Number.isNaN(new Date(order.expectedDeliveryAt).getTime());
}

export default function Orders() {
  const user = useContext(UserContext);
  const isMobile = useIsMobile();
    // --- Discount and Order Total Preview State ---
  const canDeliver = user?.role === "driver" || user?.role === "admin";
  const canConfirmPickup = true; // All roles can confirm pickup
  const searchParams = useSearch();
  const initialUrlParams = new URLSearchParams(searchParams);
  const initialFocusDate = parseDateOnlyKey(initialUrlParams.get("focusDate"));
  const initialFocusTab =
    initialUrlParams.get("focusTab") === "delivery" ? "delivery" : "all";
  const initialTrackingSearchFilters = getTrackingSearchFiltersFromParams(initialUrlParams);
  const [trackingSearchFilters, setTrackingSearchFilters] = useState<TrackingSearchFilters>(initialTrackingSearchFilters);
  const [debouncedTrackingSearchFilters, setDebouncedTrackingSearchFilters] = useState<TrackingSearchFilters>(initialTrackingSearchFilters);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobileOrdersScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileOrdersScrollTopRef = useRef(0);
  const desktopOrdersTableScrollRef = useRef<HTMLDivElement | null>(null);
  const desktopOrdersScrollTopRef = useRef(0);
  const previousOrdersScrollContextRef = useRef<string | null>(null);
  const [showDesktopOrdersJumpers, setShowDesktopOrdersJumpers] = useState(false);
  const handleTrackingSearchChange = useCallback((field: TrackingSearchFieldKey, value: string) => {
    setTrackingSearchFilters((current) => {
      const next = { ...current, [field]: value };
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => setDebouncedTrackingSearchFilters(next), 250);
      return next;
    });
  }, []);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [accountActivityClientId, setAccountActivityClientId] = useState<number | null>(null);
  const [editingClientId, setEditingClientId] = useState<number | null>(null);

  useEffect(() => {
    const nextFilters = getTrackingSearchFiltersFromParams(new URLSearchParams(searchParams));
    setTrackingSearchFilters((current) => {
      if (areTrackingSearchFiltersEqual(current, nextFilters)) {
        return current;
      }

      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      return nextFilters;
    });
    setDebouncedTrackingSearchFilters((current) =>
      areTrackingSearchFiltersEqual(current, nextFilters) ? current : nextFilters,
    );
  }, [searchParams]);
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);
  const [activeTab, setActiveTab] = useState(initialFocusTab);
  const trackingDateField: "entry" | "delivery" =
    activeTab === "delivery" ? "delivery" : "entry";
  const [dateFilter, setDateFilter] = useState<"all_time" | "today" | "yesterday" | "custom" | "exact">(
    "exact",
  );
  const [trackingSortOrder, setTrackingSortOrder] = useState<TrackingSortOrder>("oldest");
  const [ordersProcessing, setOrdersProcessing] = useState(false);
  const [rangeApplied, setRangeApplied] = useState(false);
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");
  const [exactDate, setExactDate] = useState<Date | undefined>(initialFocusDate ?? new Date());
  const [showUrgentOnly, setShowUrgentOnly] = useState(false);
  const [showNormalOnly, setShowNormalOnly] = useState(false);
  const [showExpectedDateOnly, setShowExpectedDateOnly] = useState(false);
  const [deliveryTypeFilter, setDeliveryTypeFilter] = useState<"all" | "takeaway" | "delivery">("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [mobileSearchCurtainOpen, setMobileSearchCurtainOpen] = useState(false);
  const [mobileDateCurtainOpen, setMobileDateCurtainOpen] = useState(false);
  const [mobileViewCurtainOpen, setMobileViewCurtainOpen] = useState(false);
  const [visibleAllTimeOrderCount, setVisibleAllTimeOrderCount] = useState(
    ORDERS_INITIAL_LOAD_COUNT,
  );
  const [forcedVisibleOrderId, setForcedVisibleOrderId] = useState<number | null>(null);
  const [forcedVisibleDateKey, setForcedVisibleDateKey] = useState<string | null>(null);
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [packingPinDialog, setPackingPinDialog] = useState<{
    orderId: number;
  } | null>(null);
  const [pinError, setPinError] = useState("");
  const [packingNotes, setPackingNotes] = useState("");
  const [deliveryPinDialog, setDeliveryPinDialog] = useState<{
    orderId: number;
  } | null>(null);
  const [deliveryConfirmDialog, setDeliveryConfirmDialog] = useState<{
    orderId: number;
  } | null>(null);
  const [deliveryPin, setDeliveryPin] = useState("");
  const [deliveryPinError, setDeliveryPinError] = useState("");
  const [itemCountVerified, setItemCountVerified] = useState(false);
  const [deliveryPhotos, setDeliveryPhotos] = useState<string[]>([]);
  const [deliveryPhotoPreviews, setDeliveryPhotoPreviews] = useState<string[]>(
    [],
  );
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [tagPinDialog, setTagPinDialog] = useState<{ orderId: number } | null>(
    null,
  );
  const [tagPinError, setTagPinError] = useState("");
  const [newCreatedOrder, setNewCreatedOrder] = useState<Order | null>(null);
  const [highlightedOrderId, setHighlightedOrderId] = useState<number | null>(null);
  const [pendingFocusOrderId, setPendingFocusOrderId] = useState<number | null>(null);
  const [viewPhotoOrder, setViewPhotoOrder] = useState<Order | null>(null);
  const pdfReceiptRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { companyContact } = useCompanyContactInfo();
  const workspaceLogoUrl = getWorkspaceLogoUrl(logoImage);
  const companyAddressLines = getCompanyAddressLines(companyContact);
  const companyAddressHtml = companyAddressLines.map(escapeHtml).join("<br />");
  const companyPhoneLine = formatCompanyPhoneLine(companyContact);
  const companyPhoneHtml = escapeHtml(companyPhoneLine);
  const [logoBase64, setLogoBase64] = useState<string>("");
  const [tagLogoBase64, setTagLogoBase64] = useState<string>("");

  useEffect(() => {
    const img = document.createElement("img");
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const dataURL = canvas.toDataURL("image/png");
        setLogoBase64(dataURL);
      }
    };
    img.src = workspaceLogoUrl;

    const tagImg = document.createElement("img");
    tagImg.crossOrigin = "anonymous";
    tagImg.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = tagImg.width;
      canvas.height = tagImg.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(tagImg, 0, 0);
        setTagLogoBase64(canvas.toDataURL("image/png"));
      }
    };
    tagImg.src = workspaceLogoUrl;
  }, [workspaceLogoUrl]);

  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const urlParams = new URLSearchParams(searchString);
  const urlBillId = urlParams.get("billId");
  const urlClientId = urlParams.get("clientId");
  const urlPayOrderId = urlParams.get("payOrder");
  const urlPayBillId = urlParams.get("payBill");
  const urlFocusOrderId = urlParams.get("focusOrderId");
  const urlFocusBillId = urlParams.get("focusBillId");
  const urlFocusDate = urlParams.get("focusDate");
  const urlFocusDateField = urlParams.get("focusDateField");
  const urlFocusTab = urlParams.get("focusTab");
  const urlHighlightOrderNumber = urlParams.get("highlight");

  const [prefilledClientId, setPrefilledClientId] = useState<
    string | undefined
  >();
  const [prefilledBillId, setPrefilledBillId] = useState<string | undefined>();
  const [showBillDialog, setShowBillDialog] = useState(false);
  const [selectedBill, setSelectedBill] = useState<BillWithPaymentRecorder | null>(null);
  const [orderTransferBillDialog, setOrderTransferBillDialog] =
    useState<BillWithPaymentRecorder | null>(null);
  const [orderTransferTargetClientId, setOrderTransferTargetClientId] = useState("");
  const [orderTransferBillSearch, setOrderTransferBillSearch] = useState("");
  const [orderTransferBillAdminPin, setOrderTransferBillAdminPin] = useState("");
  const [orderTransferBillReason, setOrderTransferBillReason] = useState("");
  const payBillDialogRef = useRef<OrderPayBillDialogHandle>(null);

  // Payment state for bill dialog
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showPaymentChoice, setShowPaymentChoice] = useState(false);
  const [payAllBills, setPayAllBills] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<OrderPaymentMethod>("cash");
  const [splitPaymentEnabled, setSplitPaymentEnabled] = useState(false);
  const [splitPaymentAmount, setSplitPaymentAmount] = useState("");
  const [remainingPaymentMethod, setRemainingPaymentMethod] = useState<OrderPaymentMethod>("card");
  const [isSplitPaymentSubmitting, setIsSplitPaymentSubmitting] = useState(false);
  const paymentPinInputRef = useRef<HTMLInputElement | null>(null);
  const discountAmountInputRef = useRef<HTMLInputElement | null>(null);
  const [paymentPin, setPaymentPin] = useState("");
  const [paymentPinError, setPaymentPinError] = useState("");
  const [applyDiscount, setApplyDiscount] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");

  const depositPaymentMethodOption = { value: "deposit" as const, label: "Account Credit", Icon: Wallet };
  const basePaymentMethodOptions = [
    { value: "cash" as const, label: "Cash", Icon: Banknote },
    { value: "card" as const, label: "Card", Icon: CreditCard },
    { value: "transfer" as const, label: "Bank Transfer", Icon: Building2 },
  ];

  const focusPaymentPinInput = () => {
    requestAnimationFrame(() => {
      paymentPinInputRef.current?.focus();
      paymentPinInputRef.current?.select();
    });
  };

  const focusDiscountAmountInput = () => {
    requestAnimationFrame(() => {
      discountAmountInputRef.current?.focus();
      discountAmountInputRef.current?.select();
    });
  };

  const resetOrderBillPaymentState = useCallback(() => {
    setShowPaymentForm(false);
    setShowPaymentChoice(false);
    setPayAllBills(false);
    setPaymentAmount("");
    setPaymentMethod("cash");
    setSplitPaymentEnabled(false);
    setSplitPaymentAmount("");
    setRemainingPaymentMethod("card");
    setIsSplitPaymentSubmitting(false);
    setPaymentPin("");
    setPaymentPinError("");
    setApplyDiscount(false);
    setDiscountAmount("");
  }, []);

  const [deleteOrderConfirmDialog, setDeleteOrderConfirmDialog] = useState(false);
  const [deleteOrderDialog, setDeleteOrderDialog] = useState(false);
  const [deleteOrderAdminPassword, setDeleteOrderAdminPassword] = useState("");
  const [deleteOrderAdminError, setDeleteOrderAdminError] = useState("");
  const [pendingDeleteOrderId, setPendingDeleteOrderId] = useState<number | null>(null);

  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(new Set());
  const [bulkDeleteConfirmDialog, setBulkDeleteConfirmDialog] = useState(false);
  const [bulkDeleteAdminPassword, setBulkDeleteAdminPassword] = useState("");
  const [bulkDeleteAdminError, setBulkDeleteAdminError] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [bulkTagDialog, setBulkTagDialog] = useState(false);
  const [bulkTagAdminPassword, setBulkTagAdminPassword] = useState("");
  const [bulkTagAdminError, setBulkTagAdminError] = useState("");
  const [bulkTagging, setBulkTagging] = useState(false);

  const [bulkPackDialog, setBulkPackDialog] = useState(false);
  const [bulkPackAdminPassword, setBulkPackAdminPassword] = useState("");
  const [bulkPackAdminError, setBulkPackAdminError] = useState("");
  const [bulkPacking, setBulkPacking] = useState(false);

  const [bulkDeliverDialog, setBulkDeliverDialog] = useState(false);
  const [bulkDeliverAdminError, setBulkDeliverAdminError] = useState("");
  const [bulkDelivering, setBulkDelivering] = useState(false);

  const [bulkTakeawayDialog, setBulkTakeawayDialog] = useState(false);
  const [bulkTakeawayAdminError, setBulkTakeawayAdminError] = useState("");
  const [bulkTakeawaying, setBulkTakeawaying] = useState(false);
  const bulkTagStaffPinInputRef = useRef<HTMLInputElement>(null);
  const bulkPackStaffPinInputRef = useRef<HTMLInputElement>(null);
  const bulkDeliverStaffPinInputRef = useRef<HTMLInputElement>(null);
  const bulkTakeawayStaffPinInputRef = useRef<HTMLInputElement>(null);
  const [staffPinPreviews, setStaffPinPreviews] = useState<Record<StaffPinPreviewKey, StaffPinPreview | null>>({
    ...EMPTY_STAFF_PIN_PREVIEWS,
  });
  const staffPinPreviewRequestIds = useRef<Record<StaffPinPreviewKey, number>>({
    packing: 0,
    tag: 0,
    delivery: 0,
    discount: 0,
    bulkTag: 0,
    bulkPack: 0,
    bulkDeliver: 0,
    bulkTakeaway: 0,
  });

  const clearStaffPinPreview = useCallback((key: StaffPinPreviewKey) => {
    staffPinPreviewRequestIds.current[key] += 1;
    setStaffPinPreviews((current) => {
      if (!current[key]) return current;
      return { ...current, [key]: null };
    });
  }, []);

  const [bulkUntagDialog, setBulkUntagDialog] = useState(false);
  const [bulkUntagAdminPin, setBulkUntagAdminPin] = useState("");
  const [bulkUntagAdminError, setBulkUntagAdminError] = useState("");
  const [bulkUntagging, setBulkUntagging] = useState(false);

  const [bulkUnpackDialog, setBulkUnpackDialog] = useState(false);
  const [bulkUnpackAdminPin, setBulkUnpackAdminPin] = useState("");
  const [bulkUnpackAdminError, setBulkUnpackAdminError] = useState("");
  const [bulkUnpacking, setBulkUnpacking] = useState(false);

  const [bulkDateEditDialog, setBulkDateEditDialog] = useState(false);
  const [bulkDateEditPin, setBulkDateEditPin] = useState("");
  const [bulkDateEditValue, setBulkDateEditValue] = useState("");
  const [bulkDateEditReason, setBulkDateEditReason] = useState("");
  const [bulkDateEditShiftTagDate, setBulkDateEditShiftTagDate] = useState(true);
  const [bulkDateEditShiftPackDate, setBulkDateEditShiftPackDate] = useState(true);
  const [bulkDateEditShiftDeliveryDate, setBulkDateEditShiftDeliveryDate] = useState(true);
  const [bulkDateEditPreserveSpacing, setBulkDateEditPreserveSpacing] = useState(true);
  const [bulkDateEditSpacingMinutes, setBulkDateEditSpacingMinutes] = useState("1");
  const [bulkDateEditing, setBulkDateEditing] = useState(false);
  const [bulkDateEditError, setBulkDateEditError] = useState("");

  const [singleDateEditDialog, setSingleDateEditDialog] = useState<Order | null>(null);
  const [singleDateEditValue, setSingleDateEditValue] = useState("");
  const [singleDateEditReason, setSingleDateEditReason] = useState("");
  const [singleDateEditShiftTagDate, setSingleDateEditShiftTagDate] = useState(true);
  const [singleDateEditShiftPackDate, setSingleDateEditShiftPackDate] = useState(true);
  const [singleDateEditShiftDeliveryDate, setSingleDateEditShiftDeliveryDate] = useState(true);
  const [singleDateEditLoading, setSingleDateEditLoading] = useState(false);
  const [singleDateEditError, setSingleDateEditError] = useState("");

  const { data: staffMembersList } = useQuery<any[]>({
    queryKey: ["/api/staff-members"],
  });

  const toggleOrderSelection = (id: number) => {
    setSelectedOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const isCtrlLeftClick = (event: React.MouseEvent<HTMLElement>) =>
    event.button === 0 && event.ctrlKey;

  const isNestedInteractiveClickTarget = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return false;

    const interactiveTarget = target.closest(
      'button,a,input,textarea,select,[role="button"]',
    );

    return Boolean(interactiveTarget && interactiveTarget !== event.currentTarget);
  };

  const toggleOrderSelectionFromShortcut = (
    event: React.MouseEvent<HTMLElement>,
    order: Pick<Order, "id">,
  ) => {
    if (!isCtrlLeftClick(event)) return false;

    event.preventDefault();
    event.stopPropagation();
    toggleOrderSelection(order.id);
    return true;
  };

  const handleTrackingOrderShortcutSelectionCapture = (
    event: React.MouseEvent<HTMLElement>,
    order: Pick<Order, "id">,
  ) => {
    if (isNestedInteractiveClickTarget(event)) return;

    toggleOrderSelectionFromShortcut(event, order);
  };

  const handleOrderDetailShortcutClick = (
    event: React.MouseEvent<HTMLElement>,
    order: Order,
  ) => {
    if (toggleOrderSelectionFromShortcut(event, order)) return;

    setOrderDetailDialog(order);
  };

  const selectOrders = useCallback((ordersList: Array<Pick<Order, "id">>) => {
    setSelectedOrderIds(new Set(ordersList.map((order) => order.id)));
  }, []);

  const clearSelectedOrders = useCallback(() => {
    setSelectedOrderIds(new Set());
  }, []);

  const toggleAllOrders = useCallback((ordersList: Array<Pick<Order, "id">>) => {
    const allOrdersSelected =
      ordersList.length > 0 &&
      ordersList.every((order) => selectedOrderIds.has(order.id));

    if (allOrdersSelected) {
      setSelectedOrderIds(new Set());
    } else {
      selectOrders(ordersList);
    }
  }, [selectOrders, selectedOrderIds]);

  const handleBulkDelete = () => {
    if (selectedOrderIds.size === 0) return;
    setBulkDeleteAdminPassword("");
    setBulkDeleteAdminError("");
    setBulkDeleteConfirmDialog(true);
  };

  const getSelectedPendingTagCount = () => {
    return selectedTrackingItems.filter((order) => !order.tagDone).length;
  };

  const getSelectedTaggedCount = () => {
    return selectedTrackingItems.filter((order) => order.tagDone && !order.packingDone).length;
  };

  const getSelectedWashingPackCount = () => {
    return selectedTrackingItems.filter((order) => order.tagDone && !order.packingDone).length;
  };

  const getSelectedPackedCount = () => {
    return selectedTrackingItems.filter((order) => order.packingDone && !order.delivered).length;
  };

  const getSelectedPackedDeliveryOrderIds = () => {
    return selectedTrackingItems
      .filter(
        (o) =>
          o.packingDone &&
          !o.delivered &&
          o.deliveryType === "delivery",
      )
      .map((o) => o.id);
  };

  const getSelectedPackedTakeawayOrderIds = () => {
    return selectedTrackingItems
      .filter(
        (o) =>
          o.packingDone &&
          !o.delivered &&
          o.deliveryType !== "delivery",
      )
      .map((o) => o.id);
  };

  const getSelectedPackedDeliveryCount = () => getSelectedPackedDeliveryOrderIds().length;

  const getSelectedPackedTakeawayCount = () => getSelectedPackedTakeawayOrderIds().length;

  // Normalize staff options defensively to avoid runtime crashes from unexpected API shapes.
  const allStaffMembers = useMemo<
    { id: string; numericId: number; name: string; roleType: string }[]
  >(() => {
    const source = Array.isArray(staffMembersList) ? staffMembersList : [];
    const normalized: { id: string; numericId: number; name: string; roleType: string }[] = [];

    for (const raw of source) {
      if (!raw || raw.active === false) continue;
      const numericId = Number(raw.id);
      if (!Number.isFinite(numericId)) continue;
      const id = String(numericId);
      if (!id) continue;

      const name =
        typeof raw.name === "string" && raw.name.trim()
          ? raw.name.trim()
          : "Unknown";
      const roleType =
        typeof raw.roleType === "string" && raw.roleType.trim()
          ? raw.roleType.trim()
          : "staff";

      normalized.push({ id, numericId, name, roleType });
    }

    if (!normalized.some((member) => member.numericId === 0 || member.name.toLowerCase() === "admin")) {
      normalized.push({ id: "0", numericId: 0, name: "Admin", roleType: "admin" });
    }

    const deduped = new Map<string, { id: string; numericId: number; name: string; roleType: string }>();
    for (const member of normalized) {
      if (!deduped.has(member.id)) {
        deduped.set(member.id, member);
      }
    }
    return Array.from(deduped.values());
  }, [staffMembersList]);

  const handleBulkTag = () => {
    if (selectedOrderIds.size === 0) return;
    setBulkTagAdminPassword("");
    setBulkTagAdminError("");
    clearStaffPinInput(bulkTagStaffPinInputRef);
    clearStaffPinPreview("bulkTag");
    setBulkTagDialog(true);
    focusStaffPinInput(bulkTagStaffPinInputRef);
  };

  const parseApiErrorMessage = (error: unknown, fallback: string): string => {
    if (!error) return fallback;
    const raw = typeof error === "string"
      ? error
      : error instanceof Error
      ? error.message
      : String(error);

    try {
      const messageMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
      if (messageMatch?.[1]) return messageMatch[1];
    } catch {}

    if (raw.trim()) return raw;
    return fallback;
  };

  const parseApiJsonResponse = async <T = any>(
    res: Response,
    fallbackMessage: string,
  ): Promise<T> => {
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const raw = await res.text();
    const trimmed = raw.trim().toLowerCase();

    if (!contentType.includes("application/json")) {
      if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
        throw new Error("API route not active. Restart the server and try again.");
      }
      throw new Error(fallbackMessage);
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(fallbackMessage);
    }
  };

  const sanitizeStaffPinValue = (value: string) =>
    value.replace(/\D/g, "").slice(0, 5);

  const clearStaffPinInput = (
    inputRef: { current: HTMLInputElement | null },
  ) => {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const readStaffPinInput = (
    inputRef: { current: HTMLInputElement | null },
  ) => {
    const normalizedValue = sanitizeStaffPinValue(inputRef.current?.value || "");
    if (inputRef.current && inputRef.current.value !== normalizedValue) {
      inputRef.current.value = normalizedValue;
    }
    return normalizedValue;
  };

  const normalizeStaffPinField = (
    event: React.FormEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const normalizedValue = sanitizeStaffPinValue(input.value);
    if (input.value !== normalizedValue) {
      input.value = normalizedValue;
    }
  };

  const focusStaffPinInput = (
    inputRef: { current: HTMLInputElement | null },
  ) => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const updateStaffPinPreview = useCallback(
    async (key: StaffPinPreviewKey, value: string) => {
      const normalizedPin = sanitizeStaffPinValue(value);
      if (normalizedPin.length !== 5) {
        clearStaffPinPreview(key);
        return;
      }

      const requestId = staffPinPreviewRequestIds.current[key] + 1;
      staffPinPreviewRequestIds.current[key] = requestId;
      setStaffPinPreviews((current) => {
        if (!current[key]) return current;
        return { ...current, [key]: null };
      });

      try {
        const res = await apiRequest("POST", STAFF_PIN_PREVIEW_ENDPOINTS[key], {
          pin: normalizedPin,
        });
        const data = await res.json();
        const staffPreview = getStaffPinPreview(data);

        if (staffPinPreviewRequestIds.current[key] !== requestId) return;

        setStaffPinPreviews((current) => ({
          ...current,
          [key]: staffPreview,
        }));
      } catch {
        if (staffPinPreviewRequestIds.current[key] !== requestId) return;
        setStaffPinPreviews((current) => {
          if (!current[key]) return current;
          return { ...current, [key]: null };
        });
      }
    },
    [clearStaffPinPreview],
  );

  const renderStaffPinPreview = (key: StaffPinPreviewKey) => {
    const staffPreview = staffPinPreviews[key];
    if (!staffPreview) return null;

    return (
      <div
        className="mb-2 flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
        data-testid={`text-${key}-staff-pin-preview`}
        aria-live="polite"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>{staffPreview.roleLabel}: {staffPreview.name}</span>
      </div>
    );
  };

  const reloadAfterBulkAction = () => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-count"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-selection"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/orders/due-soon"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/bill-payments"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/client-transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/daily-sales"] }),
    ]);
  };

  const handleConfirmBulkTag = async () => {
    const bulkTagStaffPin = readStaffPinInput(bulkTagStaffPinInputRef);
    if (bulkTagStaffPin.length !== 5) {
      setBulkTagAdminError("Staff PIN must be 5 digits");
      return;
    }
    setBulkTagging(true);
    try {
      const res = await apiRequest("POST", "/api/orders/bulk-tag", {
        orderIds: Array.from(selectedOrderIds),
        staffPin: bulkTagStaffPin,
      });
      const data = await res.json();
      if (res.ok) {
        const taggedIds = new Set<number>(
          Array.isArray(data.taggedOrderIds)
            ? data.taggedOrderIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isFinite(id))
            : Array.from(selectedOrderIds),
        );

        queryClient.setQueryData<Order[]>(["/api/orders"], (current) =>
          current?.map((order) =>
            taggedIds.has(order.id)
              ? {
                  ...order,
                  tagDone: true,
                  tagDate: data.tagDate ?? order.tagDate,
                  tagBy: data.tagBy ?? order.tagBy,
                  tagWorkerId: data.tagWorkerId ?? order.tagWorkerId,
                }
              : order,
          ) || current,
        );
        setOrderDetailDialog((current) =>
          current && taggedIds.has(current.id)
            ? {
                ...current,
                tagDone: true,
                tagDate: data.tagDate ?? current.tagDate,
                tagBy: data.tagBy ?? current.tagBy,
                tagWorkerId: data.tagWorkerId ?? current.tagWorkerId,
              }
            : current,
        );

        toast({
          title: "Bulk Tagging Complete",
          description: data.message || `${data.tagged} order(s) tagged.`,
        });
        setBulkTagDialog(false);
        setSelectedOrderIds(new Set());
        setBulkTagAdminPassword("");
        setBulkTagAdminError("");
        clearStaffPinInput(bulkTagStaffPinInputRef);
        clearStaffPinPreview("bulkTag");
        reloadAfterBulkAction();
      } else {
        setBulkTagAdminError(data.message || "Failed to tag orders");
        clearStaffPinPreview("bulkTag");
      }
    } catch (error) {
      setBulkTagAdminError(parseApiErrorMessage(error, "Failed to tag orders"));
      clearStaffPinPreview("bulkTag");
    } finally {
      setBulkTagging(false);
    }
  };

  const handleBulkUntag = () => {
    if (selectedOrderIds.size === 0) return;
    setBulkUntagAdminPin("");
    setBulkUntagAdminError("");
    setBulkUntagDialog(true);
  };

  const handleConfirmBulkUntag = async () => {
    if (bulkUntagAdminPin.length !== 5) {
      setBulkUntagAdminError("Admin PIN must be 5 digits");
      return;
    }
    setBulkUntagging(true);
    try {
      const res = await apiRequest("POST", "/api/orders/bulk-untag", {
        orderIds: Array.from(selectedOrderIds),
        adminPin: bulkUntagAdminPin,
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "Bulk Untag Complete",
          description: data.message || `${data.untagged} order(s) untagged.`,
        });
        setBulkUntagDialog(false);
        setSelectedOrderIds(new Set());
        setBulkUntagAdminPin("");
        setBulkUntagAdminError("");
        reloadAfterBulkAction();
      } else {
        setBulkUntagAdminError(data.message || "Failed to untag orders");
      }
    } catch {
      setBulkUntagAdminError("Invalid admin PIN");
    } finally {
      setBulkUntagging(false);
    }
  };

  const handleBulkPack = () => {
    if (selectedOrderIds.size === 0) return;
    setBulkPackAdminPassword("");
    setBulkPackAdminError("");
    clearStaffPinInput(bulkPackStaffPinInputRef);
    clearStaffPinPreview("bulkPack");
    setBulkPackDialog(true);
    focusStaffPinInput(bulkPackStaffPinInputRef);
  };

  const handleConfirmBulkPack = async () => {
    const bulkPackStaffPin = readStaffPinInput(bulkPackStaffPinInputRef);
    if (bulkPackStaffPin.length !== 5) {
      setBulkPackAdminError("Staff PIN must be 5 digits");
      return;
    }
    setBulkPacking(true);
    try {
      const res = await apiRequest("POST", "/api/orders/bulk-pack", {
        orderIds: Array.from(selectedOrderIds),
        staffPin: bulkPackStaffPin,
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "Bulk Packing Complete",
          description: data.message || `${data.packed} order(s) packed.`,
        });
        setBulkPackDialog(false);
        setSelectedOrderIds(new Set());
        setBulkPackAdminPassword("");
        setBulkPackAdminError("");
        clearStaffPinInput(bulkPackStaffPinInputRef);
        clearStaffPinPreview("bulkPack");
        reloadAfterBulkAction();
      } else {
        setBulkPackAdminError(data.message || "Failed to pack orders");
        clearStaffPinPreview("bulkPack");
      }
    } catch (error) {
      setBulkPackAdminError(parseApiErrorMessage(error, "Failed to pack orders"));
      clearStaffPinPreview("bulkPack");
    } finally {
      setBulkPacking(false);
    }
  };

  const handleBulkDeliver = () => {
    if (getSelectedPackedDeliveryCount() === 0) return;
    setBulkDeliverAdminError("");
    clearStaffPinInput(bulkDeliverStaffPinInputRef);
    clearStaffPinPreview("bulkDeliver");
    setBulkDeliverDialog(true);
    focusStaffPinInput(bulkDeliverStaffPinInputRef);
  };

  const handleConfirmBulkDeliver = async () => {
    const bulkDeliverStaffPin = readStaffPinInput(bulkDeliverStaffPinInputRef);
    if (bulkDeliverStaffPin.length !== 5) {
      setBulkDeliverAdminError("Staff PIN must be 5 digits");
      return;
    }
    const deliveryOrderIds = getSelectedPackedDeliveryOrderIds();
    if (deliveryOrderIds.length === 0) {
      setBulkDeliverAdminError("No delivery orders selected");
      return;
    }
    setBulkDelivering(true);
    try {
      const res = await apiRequest("POST", "/api/orders/bulk-deliver", {
        orderIds: deliveryOrderIds,
        staffPin: bulkDeliverStaffPin,
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "Bulk Delivery Complete",
          description: data.message || `${data.delivered} order(s) delivered.`,
        });
        setBulkDeliverDialog(false);
        setSelectedOrderIds(new Set());
        setBulkDeliverAdminError("");
        clearStaffPinInput(bulkDeliverStaffPinInputRef);
        clearStaffPinPreview("bulkDeliver");
        reloadAfterBulkAction();
      } else {
        setBulkDeliverAdminError(data.message || "Failed to deliver orders");
        clearStaffPinPreview("bulkDeliver");
      }
    } catch (error) {
      setBulkDeliverAdminError(parseApiErrorMessage(error, "Failed to deliver orders"));
      clearStaffPinPreview("bulkDeliver");
    } finally {
      setBulkDelivering(false);
    }
  };

  const handleBulkTakeaway = () => {
    if (getSelectedPackedTakeawayCount() === 0) return;
    setBulkTakeawayAdminError("");
    clearStaffPinInput(bulkTakeawayStaffPinInputRef);
    clearStaffPinPreview("bulkTakeaway");
    setBulkTakeawayDialog(true);
    focusStaffPinInput(bulkTakeawayStaffPinInputRef);
  };

  const handleConfirmBulkTakeaway = async () => {
    const bulkTakeawayStaffPin = readStaffPinInput(bulkTakeawayStaffPinInputRef);
    if (bulkTakeawayStaffPin.length !== 5) {
      setBulkTakeawayAdminError("Staff PIN must be 5 digits");
      return;
    }
    const takeawayOrderIds = getSelectedPackedTakeawayOrderIds();
    if (takeawayOrderIds.length === 0) {
      setBulkTakeawayAdminError("No takeaway orders selected");
      return;
    }
    setBulkTakeawaying(true);
    try {
      const res = await apiRequest("POST", "/api/orders/bulk-takeaway", {
        orderIds: takeawayOrderIds,
        staffPin: bulkTakeawayStaffPin,
      });
      const data = await parseApiJsonResponse<{
        message?: string;
        pickedUp?: number;
      }>(res, "Invalid response from bulk takeaway API");
      if (res.ok) {
        toast({
          title: "Bulk Takeaway Complete",
          description: data.message || `${data.pickedUp} order(s) marked as taken away.`,
        });
        setBulkTakeawayDialog(false);
        setSelectedOrderIds(new Set());
        setBulkTakeawayAdminError("");
        clearStaffPinInput(bulkTakeawayStaffPinInputRef);
        clearStaffPinPreview("bulkTakeaway");
        reloadAfterBulkAction();
      } else {
        setBulkTakeawayAdminError(data.message || "Failed to complete takeaway orders");
        clearStaffPinPreview("bulkTakeaway");
      }
    } catch (error) {
      setBulkTakeawayAdminError(parseApiErrorMessage(error, "Failed to complete takeaway orders"));
      clearStaffPinPreview("bulkTakeaway");
    } finally {
      setBulkTakeawaying(false);
    }
  };

  const handleBulkUnpack = () => {
    if (selectedOrderIds.size === 0) return;
    setBulkUnpackAdminPin("");
    setBulkUnpackAdminError("");
    setBulkUnpackDialog(true);
  };

  const handleConfirmBulkUnpack = async () => {
    if (bulkUnpackAdminPin.length !== 5) {
      setBulkUnpackAdminError("Admin PIN must be 5 digits");
      return;
    }
    setBulkUnpacking(true);
    try {
      const res = await apiRequest("POST", "/api/orders/bulk-unpack", {
        orderIds: Array.from(selectedOrderIds),
        adminPin: bulkUnpackAdminPin,
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "Bulk Unpack Complete",
          description: data.message || `${data.unpacked} order(s) unpacked.`,
        });
        setBulkUnpackDialog(false);
        setSelectedOrderIds(new Set());
        setBulkUnpackAdminPin("");
        setBulkUnpackAdminError("");
        reloadAfterBulkAction();
      } else {
        setBulkUnpackAdminError(data.message || "Failed to unpack orders");
      }
    } catch {
      setBulkUnpackAdminError("Invalid admin PIN");
    } finally {
      setBulkUnpacking(false);
    }
  };

  const handleConfirmBulkDelete = async () => {
    if (!bulkDeleteAdminPassword.trim()) {
      setBulkDeleteAdminError("Please enter admin PIN");
      return;
    }
    setBulkDeleting(true);
    try {
      const res = await apiRequest("POST", "/api/orders/bulk-delete", {
        orderIds: Array.from(selectedOrderIds),
        adminPin: bulkDeleteAdminPassword,
      }, {
        headers: {
          "X-Admin-Pin": bulkDeleteAdminPassword,
        },
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "Orders Deleted",
          description: data.message || `${data.deleted} order(s) deleted.`,
        });
        setBulkDeleteConfirmDialog(false);
        setSelectedOrderIds(new Set());
        setBulkDeleteAdminPassword("");
        setBulkDeleteAdminError("");
        reloadAfterBulkAction();
      } else {
        setBulkDeleteAdminError(data.message || "Failed to delete orders");
      }
    } catch {
      setBulkDeleteAdminError("Invalid admin PIN");
    } finally {
      setBulkDeleting(false);
    }
  };

  const getDateEditActor = () => {
    return (
      (user as any)?.name ||
      (user as any)?.username ||
      localStorage.getItem("username") ||
      "admin"
    );
  };

  const getDateEditErrorMessage = (error: unknown, fallback: string) => {
    const message = String((error as any)?.message || "");
    const jsonMessageMatch = message.match(/"message"\s*:\s*"([^"]+)"/);
    if (jsonMessageMatch) {
      return jsonMessageMatch[1];
    }
    return message.trim() || fallback;
  };

  const handleBulkEditDate = () => {
    if (selectedOrderIds.size === 0) return;
    setBulkDateEditPin("");
    setBulkDateEditValue(toDateTimeLocal(new Date()));
    setBulkDateEditReason("");
    setBulkDateEditShiftTagDate(true);
    setBulkDateEditShiftPackDate(true);
    setBulkDateEditShiftDeliveryDate(true);
    setBulkDateEditPreserveSpacing(true);
    setBulkDateEditSpacingMinutes("1");
    setBulkDateEditError("");
    setBulkDateEditDialog(true);
  };

  const handleConfirmBulkEditDate = async () => {
    if (!bulkDateEditPin.trim()) {
      setBulkDateEditError("Please enter admin or counter PIN");
      return;
    }
    if (!bulkDateEditValue) {
      setBulkDateEditError("Please select a new date and time");
      return;
    }

    const spacing = Math.max(0, Number(bulkDateEditSpacingMinutes) || 0);
    setBulkDateEditing(true);
    setBulkDateEditError("");
    try {
      const res = await apiRequest("POST", "/api/orders/bulk-edit-date", {
        staffPin: bulkDateEditPin,
        orderIds: Array.from(selectedOrderIds),
        newEntryDate: new Date(bulkDateEditValue).toISOString(),
        preserveOrderSpacing: bulkDateEditPreserveSpacing,
        spacingMinutes: spacing,
        shiftTagDate: bulkDateEditShiftTagDate,
        shiftPackDate: bulkDateEditShiftPackDate,
        shiftDeliveryDate: bulkDateEditShiftDeliveryDate,
        reason: bulkDateEditReason || "Bulk date edit",
        changedBy: getDateEditActor(),
      });
      const data = await res.json();
      toast({
        title: data.failedCount > 0 ? "Order Dates Partially Updated" : "Order Dates Updated",
        description: data.message || `${data.updatedCount || 0} order(s) were moved successfully.`,
      });
      setBulkDateEditDialog(false);
      setSelectedOrderIds(new Set());
      reloadAfterBulkAction();
    } catch (error) {
      setBulkDateEditError(getDateEditErrorMessage(error, "Failed to bulk edit dates"));
    } finally {
      setBulkDateEditing(false);
    }
  };

  const openSingleDateEditDialog = (order: Order) => {
    setSingleDateEditDialog(order);
    setSingleDateEditValue(toDateTimeLocal(order.entryDate));
    setSingleDateEditReason("");
    setSingleDateEditShiftTagDate(true);
    setSingleDateEditShiftPackDate(true);
    setSingleDateEditShiftDeliveryDate(true);
    setSingleDateEditError("");
  };

  const handleConfirmSingleDateEdit = async () => {
    if (!singleDateEditDialog) return;
    if (!singleDateEditValue) {
      setSingleDateEditError("Please select a new date and time");
      return;
    }
    if (!editOrderPin.trim()) {
      setSingleDateEditError("Admin or counter PIN is required. Unlock edit mode first.");
      return;
    }

    setSingleDateEditLoading(true);
    setSingleDateEditError("");
    try {
      const res = await apiRequest(
        "POST",
        `/api/orders/${singleDateEditDialog.id}/edit-date`,
        {
          staffPin: editOrderPin,
          newEntryDate: new Date(singleDateEditValue).toISOString(),
          shiftTagDate: singleDateEditShiftTagDate,
          shiftPackDate: singleDateEditShiftPackDate,
          shiftDeliveryDate: singleDateEditShiftDeliveryDate,
          reason: singleDateEditReason || "Single date edit",
          changedBy: getDateEditActor(),
        },
      );
      const data = await res.json();
      toast({
        title: "Order Date Updated",
        description: data.message || `Order ${singleDateEditDialog.orderNumber} was updated successfully.`,
      });
      if (orderDetailDialog && orderDetailDialog.id === singleDateEditDialog.id) {
        setOrderDetailDialog(data.order || null);
      }
      setSingleDateEditDialog(null);
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/credit-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/date-change-audit"] });
    } catch (error) {
      setSingleDateEditError(getDateEditErrorMessage(error, "Failed to edit order date"));
    } finally {
      setSingleDateEditLoading(false);
    }
  };

  const [incidentReportOrder, setIncidentReportOrder] = useState<Order | null>(
    null,
  );
  const [incidentType, setIncidentType] = useState("missing_item");
  const [incidentItems, setIncidentItems] = useState<string[]>([]);
  const [incidentReason, setIncidentReason] = useState("");
  const [incidentNotes, setIncidentNotes] = useState("");
  const [reporterName, setReporterName] = useState("");

  const [stageChecklistDialog, setStageChecklistDialog] = useState<{
    order: Order;
    stage: "tagging" | "washing" | "sorting" | "folding" | "packing";
  } | null>(null);
  const [stageChecklistReadyToContinue, setStageChecklistReadyToContinue] = useState(false);

  const [editItemsDialog, setEditItemsDialog] = useState<Order | null>(null);
  const [editItemsNames, setEditItemsNames] = useState<Record<string, string>>({});
  const [editItemsQuantities, setEditItemsQuantities] = useState<Record<string, number>>({});
  const [editItemsPackaging, setEditItemsPackaging] = useState<Record<string, "folding" | "hanger">>({});
  const [editItemsUnitPrices, setEditItemsUnitPrices] = useState<Record<string, number>>({});
  const [editItemsBaseUnitPrices, setEditItemsBaseUnitPrices] = useState<Record<string, number>>({});
  const [editItemsPin, setEditItemsPin] = useState("");
  const [editItemsPinError, setEditItemsPinError] = useState("");
  const [isEditingItems, setIsEditingItems] = useState(false);

  const [editOrderPin, setEditOrderPin] = useState("");
  const [editOrderAdminError, setEditOrderAdminError] = useState("");
  const [editOrderAuthenticated, setEditOrderAuthenticated] = useState(false);
  const [editOrderAuthLevel, setEditOrderAuthLevel] = useState<"admin" | "counter" | null>(null);
  const [editOrderPriorityUrgent, setEditOrderPriorityUrgent] = useState(false);
  const [editOrderItems, setEditOrderItems] = useState<EditOrderItem[]>([]);
  const [editOrderSplitDialog, setEditOrderSplitDialog] = useState<EditOrderSplitDialogState | null>(null);
  const [editOrderSplitQuantity, setEditOrderSplitQuantity] = useState("");
  const [editOrderNewPrice, setEditOrderNewPrice] = useState("");
  const [editOrderPriceReason, setEditOrderPriceReason] = useState("");
  const [editOrderPaidAmount, setEditOrderPaidAmount] = useState("");
  const [editOrderDiscount, setEditOrderDiscount] = useState("");
  const [editOrderApplyDeliveryCharge, setEditOrderApplyDeliveryCharge] = useState(false);
  const [editOrderDeliveryCharge, setEditOrderDeliveryCharge] = useState("");
  const [editOrderRevertingPayment, setEditOrderRevertingPayment] = useState(false);
  const [billRevertDialogOpen, setBillRevertDialogOpen] = useState(false);
  const [billRevertTargetId, setBillRevertTargetId] = useState<number | null>(null);
  const [billRevertPin, setBillRevertPin] = useState("");
  const [billRevertError, setBillRevertError] = useState("");
  const [editOrderSaving, setEditOrderSaving] = useState(false);
  const [editOrderAddItemSearch, setEditOrderAddItemSearch] = useState("");

  const [editDeliveryTimeDialog, setEditDeliveryTimeDialog] = useState<Order | null>(null);
  const [editDeliveryDate, setEditDeliveryDate] = useState("");
  const [editDeliveryHour, setEditDeliveryHour] = useState("12");
  const [editDeliveryMinute, setEditDeliveryMinute] = useState("00");
  const [editDeliveryPeriod, setEditDeliveryPeriod] = useState<"AM" | "PM">("PM");

  const [orderDetailDialog, setOrderDetailDialog] = useState<Order | null>(null);
  const [editingNoteOrderId, setEditingNoteOrderId] = useState<number | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [adjustPriceDialog, setAdjustPriceDialog] = useState<Order | null>(null);
  const [adjustPriceValue, setAdjustPriceValue] = useState("");
  const [adjustPriceReason, setAdjustPriceReason] = useState("");
  const [adjustPricePin, setAdjustPricePin] = useState("");
  const [adjustPricePinError, setAdjustPricePinError] = useState("");
  const [isAdjustingPrice, setIsAdjustingPrice] = useState(false);
  const [editingDiscountOrderId, setEditingDiscountOrderId] = useState<number | null>(null);
  const [editingDiscountValue, setEditingDiscountValue] = useState("");
  const [editingDiscountStaffPin, setEditingDiscountStaffPin] = useState("");
  const [editingDiscountAppliedBy, setEditingDiscountAppliedBy] = useState("");
  const [discountPinDialogOrder, setDiscountPinDialogOrder] = useState<Order | null>(null);
  const [discountPin, setDiscountPin] = useState("");
  const [discountPinError, setDiscountPinError] = useState("");
  const [isDiscountPinVerifying, setIsDiscountPinVerifying] = useState(false);
  const [undoDeliveryDialog, setUndoDeliveryDialog] = useState<Order | null>(null);
  const [undoDeliveryPin, setUndoDeliveryPin] = useState("");
  const [undoDeliveryPinError, setUndoDeliveryPinError] = useState("");
  const editOrderPinInputRef = useRef<HTMLInputElement>(null);
  const packingPinInputRef = useRef<HTMLInputElement>(null);
  const tagPinInputRef = useRef<HTMLInputElement>(null);
  const deliveryPinInputRef = useRef<HTMLInputElement>(null);
  const pendingOrderDiscountFocusIdRef = useRef<number | null>(null);
  const stageChecklistDialogContentRef = useRef<HTMLDivElement>(null);

  const focusOrderDiscountInput = useCallback((orderId: number) => {
    const focusInput = () => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(
        `input[data-testid="input-discount-${orderId}"]`,
      ));
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
        if (pendingOrderDiscountFocusIdRef.current === orderId) {
          pendingOrderDiscountFocusIdRef.current = null;
        }
      }, 35);
    });
  }, []);

  useEffect(() => {
    if (editingDiscountOrderId === null) return;
    focusOrderDiscountInput(editingDiscountOrderId);
  }, [editingDiscountOrderId, focusOrderDiscountInput]);

  useEffect(() => {
    setStageChecklistReadyToContinue(false);
  }, [stageChecklistDialog?.order.id, stageChecklistDialog?.stage]);

  useEffect(() => {
    if (!orderDetailDialog || !editOrderAuthenticated) {
      setEditOrderSplitDialog(null);
      setEditOrderSplitQuantity("");
    }
  }, [editOrderAuthenticated, orderDetailDialog]);

  useEffect(() => {
    if (!orderDetailDialog || editOrderAuthenticated) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      editOrderPinInputRef.current?.focus();
      editOrderPinInputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [editOrderAuthenticated, orderDetailDialog]);

  const trackingOrdersQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (hasTrackingSearchFilters(debouncedTrackingSearchFilters)) {
      appendTrackingSearchFilters(params, debouncedTrackingSearchFilters);
    }

    if (activeTab !== "all") {
      params.set("stage", activeTab);
    }

    if (showUrgentOnly) {
      params.set("priority", "urgent");
    } else if (showNormalOnly) {
      params.set("priority", "normal");
    }

    if (showExpectedDateOnly) {
      params.set("expectedDate", "only");
    }

    if (deliveryTypeFilter !== "all") {
      params.set("deliveryType", deliveryTypeFilter);
    }

    if (paymentStatusFilter !== "all") {
      params.set("paymentStatus", paymentStatusFilter);
    }

    if (trackingDateField === "delivery") {
      params.set("dateField", "delivery");
    }

    params.set("sortOrder", trackingSortOrder);

    if (dateFilter === "today" || dateFilter === "yesterday") {
      const baseDate = new Date();
      baseDate.setHours(0, 0, 0, 0);
      if (dateFilter === "yesterday") {
        baseDate.setDate(baseDate.getDate() - 1);
      }

      const start = new Date(baseDate);
      const end = new Date(baseDate);
      end.setHours(23, 59, 59, 999);

      params.set("from", start.toISOString());
      params.set("to", end.toISOString());
    } else if (dateFilter === "custom") {
      if (!rangeApplied) return null;

      if (customDateFrom) {
        const from = new Date(customDateFrom);
        if (!Number.isNaN(from.getTime())) {
          params.set("from", from.toISOString());
        }
      }

      if (customDateTo) {
        const to = new Date(customDateTo);
        if (!Number.isNaN(to.getTime())) {
          params.set("to", to.toISOString());
        }
      }
    } else if (dateFilter === "exact") {
      if (!exactDate) return null;

      const start = new Date(exactDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);

      params.set("from", start.toISOString());
      params.set("to", end.toISOString());
    }

    if (dateFilter === "all_time") {
      params.set("page", "1");
      params.set("limit", String(visibleAllTimeOrderCount));
    }

    return params.toString();
  }, [
    activeTab,
    trackingDateField,
    trackingSortOrder,
    debouncedTrackingSearchFilters,
    dateFilter,
    visibleAllTimeOrderCount,
    rangeApplied,
    customDateFrom,
    customDateTo,
    exactDate,
    showUrgentOnly,
    showNormalOnly,
    showExpectedDateOnly,
    deliveryTypeFilter,
    paymentStatusFilter,
  ]);

  const trackingOrdersCountQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (hasTrackingSearchFilters(debouncedTrackingSearchFilters)) {
      appendTrackingSearchFilters(params, debouncedTrackingSearchFilters);
    }

    if (trackingDateField === "delivery") {
      params.set("dateField", "delivery");
    }

    if (activeTab !== "all") {
      params.set("stage", activeTab);
    }

    if (showUrgentOnly) {
      params.set("priority", "urgent");
    } else if (showNormalOnly) {
      params.set("priority", "normal");
    }

    if (showExpectedDateOnly) {
      params.set("expectedDate", "only");
    }

    if (deliveryTypeFilter !== "all") {
      params.set("deliveryType", deliveryTypeFilter);
    }

    if (paymentStatusFilter !== "all") {
      params.set("paymentStatus", paymentStatusFilter);
    }

    if (dateFilter === "today" || dateFilter === "yesterday") {
      const baseDate = new Date();
      baseDate.setHours(0, 0, 0, 0);
      if (dateFilter === "yesterday") {
        baseDate.setDate(baseDate.getDate() - 1);
      }

      const start = new Date(baseDate);
      const end = new Date(baseDate);
      end.setHours(23, 59, 59, 999);

      params.set("from", start.toISOString());
      params.set("to", end.toISOString());
    } else if (dateFilter === "custom") {
      if (!rangeApplied) return null;

      if (customDateFrom) {
        const from = new Date(customDateFrom);
        if (!Number.isNaN(from.getTime())) {
          params.set("from", from.toISOString());
        }
      }

      if (customDateTo) {
        const to = new Date(customDateTo);
        if (!Number.isNaN(to.getTime())) {
          params.set("to", to.toISOString());
        }
      }
    } else if (dateFilter === "exact") {
      if (!exactDate) return null;

      const start = new Date(exactDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);

      params.set("from", start.toISOString());
      params.set("to", end.toISOString());
    }

    return params.toString();
  }, [
    debouncedTrackingSearchFilters,
    trackingDateField,
    activeTab,
    showUrgentOnly,
    showNormalOnly,
    showExpectedDateOnly,
    deliveryTypeFilter,
    paymentStatusFilter,
    dateFilter,
    rangeApplied,
    customDateFrom,
    customDateTo,
    exactDate,
  ]);

  const trackingOverviewQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (hasTrackingSearchFilters(debouncedTrackingSearchFilters)) {
      appendTrackingSearchFilters(params, debouncedTrackingSearchFilters);
    }

    if (trackingDateField === "delivery") {
      params.set("dateField", "delivery");
    }

    if (dateFilter === "today" || dateFilter === "yesterday") {
      const baseDate = new Date();
      baseDate.setHours(0, 0, 0, 0);
      if (dateFilter === "yesterday") {
        baseDate.setDate(baseDate.getDate() - 1);
      }

      const start = new Date(baseDate);
      const end = new Date(baseDate);
      end.setHours(23, 59, 59, 999);

      params.set("from", start.toISOString());
      params.set("to", end.toISOString());
    } else if (dateFilter === "custom") {
      if (!rangeApplied) return null;

      if (customDateFrom) {
        const from = new Date(customDateFrom);
        if (!Number.isNaN(from.getTime())) {
          params.set("from", from.toISOString());
        }
      }

      if (customDateTo) {
        const to = new Date(customDateTo);
        if (!Number.isNaN(to.getTime())) {
          params.set("to", to.toISOString());
        }
      }
    } else if (dateFilter === "exact") {
      if (!exactDate) return null;

      const start = new Date(exactDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);

      params.set("from", start.toISOString());
      params.set("to", end.toISOString());
    }

    return params.toString();
  }, [
    debouncedTrackingSearchFilters,
    trackingDateField,
    dateFilter,
    rangeApplied,
    customDateFrom,
    customDateTo,
    exactDate,
  ]);

  const shouldPollOrders = dateFilter !== "all_time";

  const { data: orders, isLoading, isFetching, refetch: refetchOrders } = useQuery<Order[]>({
    queryKey: ["/api/orders", "tracking", trackingOrdersQueryString ?? "disabled"],
    enabled: trackingOrdersQueryString !== null,
    queryFn: async ({ signal }) => {
      const url = trackingOrdersQueryString
        ? `/api/orders?${trackingOrdersQueryString}`
        : "/api/orders";
      const res = await apiRequest("GET", url, undefined, { signal });
      return await res.json();
    },
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: shouldPollOrders,
    refetchInterval: shouldPollOrders ? 60000 : false,
    staleTime: shouldPollOrders ? 30000 : 5 * 60 * 1000,
  });

  const { data: trackingOrderCount } = useQuery<{ count: number }>({
    queryKey: ["/api/orders/tracking-count", trackingOrdersCountQueryString ?? "disabled"],
    enabled: trackingOrdersCountQueryString !== null,
    queryFn: async ({ signal }) => {
      const url = trackingOrdersCountQueryString
        ? `/api/orders/tracking-count?${trackingOrdersCountQueryString}`
        : "/api/orders/tracking-count";
      const res = await apiRequest("GET", url, undefined, { signal });
      return await res.json();
    },
    staleTime: shouldPollOrders ? 30000 : 5 * 60 * 1000,
  });

	  const { data: trackingOrderSummary } = useQuery<{
	    count: number;
	    workReceived: number;
	    discount: number;
	    deliveryCharge: number;
	    finalAmount: number;
	    paidAmount: number;
	    dueAmount: number;
  }>({
    queryKey: ["/api/orders/tracking-summary", trackingOrdersCountQueryString ?? "disabled"],
    enabled: trackingOrdersCountQueryString !== null,
    queryFn: async ({ signal }) => {
      const url = trackingOrdersCountQueryString
        ? `/api/orders/tracking-summary?${trackingOrdersCountQueryString}`
        : "/api/orders/tracking-summary";
      const res = await apiRequest("GET", url, undefined, { signal });
      return await res.json();
    },
    staleTime: shouldPollOrders ? 30000 : 5 * 60 * 1000,
  });

  const { data: trackingSelectionItems } = useQuery<TrackingSelectionItem[]>({
    queryKey: ["/api/orders/tracking-selection", trackingOrdersCountQueryString ?? "disabled"],
    enabled: trackingOrdersCountQueryString !== null,
    queryFn: async ({ signal }) => {
      const url = trackingOrdersCountQueryString
        ? `/api/orders/tracking-selection?${trackingOrdersCountQueryString}`
        : "/api/orders/tracking-selection";
      const res = await apiRequest("GET", url, undefined, { signal });
      return await res.json();
    },
    staleTime: shouldPollOrders ? 30000 : 5 * 60 * 1000,
  });

  const { data: trackingOverviewItems } = useQuery<TrackingSelectionItem[]>({
    queryKey: ["/api/orders/tracking-selection", "overview", trackingOverviewQueryString ?? "disabled"],
    enabled: trackingOverviewQueryString !== null,
    queryFn: async ({ signal }) => {
      const url = trackingOverviewQueryString
        ? `/api/orders/tracking-selection?${trackingOverviewQueryString}`
        : "/api/orders/tracking-selection";
      const res = await apiRequest("GET", url, undefined, { signal });
      return await res.json();
    },
    placeholderData: (previousData) => previousData,
    staleTime: shouldPollOrders ? 30000 : 5 * 60 * 1000,
  });

  const selectedTrackingItems = useMemo(
    () => (trackingSelectionItems || []).filter((item) => selectedOrderIds.has(item.id)),
    [selectedOrderIds, trackingSelectionItems],
  );

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    refetchOnMount: "always",
    staleTime: 30000,
  });

  const clientMap = useMemo(() => {
    const map = new Map<number, Client>();
    if (clients) {
      for (const c of clients) map.set(c.id, c);
    }
    return map;
  }, [clients]);

  const editingClient = useMemo(() => {
    if (editingClientId === null) return null;
    return clientMap.get(editingClientId) || null;
  }, [clientMap, editingClientId]);

  const accountActivityClient = useMemo(() => {
    if (accountActivityClientId === null) return null;
    return clientMap.get(accountActivityClientId) || null;
  }, [accountActivityClientId, clientMap]);

  const { data: accountActivityTransactions, isLoading: accountActivityTransactionsLoading } = useQuery<ClientTransaction[]>({
    queryKey: ["/api/clients", accountActivityClientId, "transactions"],
    enabled: accountActivityClientId !== null,
  });

  const { data: accountActivityUnpaidBills, isLoading: accountActivityUnpaidBillsLoading } = useQuery<Bill[]>({
    queryKey: ["/api/clients", accountActivityClientId, "unpaid-bills"],
    enabled: accountActivityClientId !== null,
  });

  const accountActivityRows = useMemo(() => {
    const sortedTransactions = [...(accountActivityTransactions || [])].sort((left, right) => {
      const timeDelta = new Date(left.date).getTime() - new Date(right.date).getTime();
      return timeDelta !== 0 ? timeDelta : left.id - right.id;
    });

    let creditBalance = 0;
    return sortedTransactions.map((transaction) => {
      if (transaction.type === "deposit") {
        creditBalance += parseFloat(transaction.amount || "0");
      } else if (isAccountCreditDeductionType(transaction.type)) {
        creditBalance -= parseFloat(transaction.amount || "0");
      }

      return {
        transaction,
        creditBalance,
        typeDisplay: getAccountActivityTypeDisplay(transaction),
      };
    });
  }, [accountActivityTransactions]);

  const accountActivitySummary = useMemo(() => {
    const unpaidTotal = (accountActivityUnpaidBills || []).reduce((sum, bill) => {
      const total = parseFloat(bill.amount || "0");
      const paid = parseFloat(bill.paidAmount || "0");
      return sum + Math.max(0, total - paid);
    }, 0);

    const totalPaid = (accountActivityTransactions || []).reduce((sum, transaction) => {
      if (
        transaction.type === "payment" ||
        transaction.type === "bulk_payment" ||
        transaction.type === "deposit_used" ||
        transaction.type === "bulk_deposit_used"
      ) {
        return sum + parseFloat(transaction.amount || "0");
      }

      return sum;
    }, 0);

    const creditBalance = accountActivityRows.length > 0
      ? accountActivityRows[accountActivityRows.length - 1].creditBalance
      : 0;

    return {
      unpaidTotal,
      totalPaid,
      availableCredit: Math.max(0, creditBalance),
    };
  }, [accountActivityRows, accountActivityTransactions, accountActivityUnpaidBills]);

  const selectedOrderTransferTargetClient = useMemo(
    () =>
      (clients || []).find(
        (client) => client.id === Number(orderTransferTargetClientId),
      ) || null,
    [clients, orderTransferTargetClientId],
  );

  const orderTransferTargetClients = useMemo(() => {
    const excludedClientId = orderTransferBillDialog?.clientId ?? null;
    const search = orderTransferBillSearch.trim().toLowerCase();
    const normalizedPhoneSearch = normalizePhoneForComparison(orderTransferBillSearch);

    return (clients || [])
      .filter((client) => {
        if (excludedClientId && client.id === excludedClientId) {
          return false;
        }

        if (!search && !normalizedPhoneSearch) {
          return true;
        }

        const searchableText = [
          client.name,
          client.billNumber,
          client.phone,
          client.company,
          client.address,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return (
          searchableText.includes(search) ||
          (!!normalizedPhoneSearch &&
            normalizePhoneForComparison(client.phone).includes(normalizedPhoneSearch))
        );
      })
      .slice(0, 10);
  }, [clients, orderTransferBillDialog?.clientId, orderTransferBillSearch]);

  const isBrokerClient = useCallback((client?: Client | null) => {
    return ((client as any)?.clientType || "").trim().toLowerCase() === "broker";
  }, []);

  const getOrderDisplayAddress = useCallback((order: Order, client?: Client | null) => {
    const orderAddress = String(order.deliveryAddress || "").trim();
    const linkedClient =
      client ?? (order.clientId ? clientMap.get(order.clientId) : undefined);

    const clientAddr = String(linkedClient?.address || "").trim();
    if (clientAddr && clientAddr !== "-" && clientAddr !== "0") return clientAddr;
    if (isBrokerClient(linkedClient)) {
      return orderAddress && orderAddress !== "-" && orderAddress !== "0"
        ? orderAddress
        : "";
    }

    return orderAddress && orderAddress !== "-" && orderAddress !== "0"
      ? orderAddress
      : "";
  }, [clientMap, isBrokerClient]);

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const editOrderItemMixSummaryByIndex = useMemo(() => {
    const summaries = new Map<
      string,
      EditOrderItemMixSummary & { indices: number[] }
    >();

    editOrderItems.forEach((item, index) => {
      if (item.quantity <= 0 || parseSqmDescriptionPart(item.name, products)) {
        return;
      }

      const key = getEditOrderItemMixKey(item.name);
      const serviceType = getStoredOrderItemServiceType(
        item.name,
        orderDetailDialog?.deliveryType,
      );
      const existingSummary = summaries.get(key);
      const summary =
        existingSummary ||
        ({
          firstIndex: index,
          lineCount: 0,
          totalQuantity: 0,
          urgentCount: 0,
          serviceCounts: {
            normal: 0,
            dc: 0,
            iron_only: 0,
          },
          indices: [],
        } satisfies EditOrderItemMixSummary & { indices: number[] });

      summary.lineCount += 1;
      summary.totalQuantity += item.quantity;
      summary.serviceCounts[serviceType] += item.quantity;
      if (/\*URG\*/i.test(item.name)) {
        summary.urgentCount += item.quantity;
      }
      summary.indices.push(index);
      summaries.set(key, summary);
    });

    const summaryByIndex = new Map<number, EditOrderItemMixSummary>();
    summaries.forEach((summary) => {
      const mappedSummary: EditOrderItemMixSummary = {
        firstIndex: summary.firstIndex,
        lineCount: summary.lineCount,
        totalQuantity: summary.totalQuantity,
        urgentCount: summary.urgentCount,
        serviceCounts: summary.serviceCounts,
      };
      summary.indices.forEach((index) => {
        summaryByIndex.set(index, mappedSummary);
      });
    });

    return summaryByIndex;
  }, [editOrderItems, orderDetailDialog?.deliveryType, products]);

  const editOrderSplitSourceItem = editOrderSplitDialog
    ? editOrderItems[editOrderSplitDialog.index] || null
    : null;
  const editOrderSplitMaxQuantity = editOrderSplitSourceItem?.quantity || 0;
  const editOrderSplitParsedQuantity = Number.parseInt(editOrderSplitQuantity, 10);
  const editOrderSplitSafeQuantity =
    editOrderSplitMaxQuantity > 0
      ? Math.max(
          1,
          Math.min(
            editOrderSplitMaxQuantity,
            Number.isFinite(editOrderSplitParsedQuantity)
              ? editOrderSplitParsedQuantity
              : editOrderSplitMaxQuantity,
          ),
        )
      : 0;
  const editOrderSplitTargetLabel = editOrderSplitDialog
    ? editOrderSplitDialog.mode === "service"
      ? getStoredOrderItemServiceTypeLabel(editOrderSplitDialog.nextServiceType)
      : editOrderSplitDialog.nextUrgent
        ? "Urgent"
        : "Normal"
    : "Normal";

  const { data: dueSoonOrders } = useQuery<Order[]>({
    queryKey: ["/api/orders/due-soon"],
    refetchInterval: 120000, // Refresh every 2 minutes
  });

  const { data: bills } = useBills();
  const billMap = useMemo(() => {
    const map = new Map<number, BillWithPaymentRecorder>();
    if (bills) {
      for (const bill of bills) map.set(bill.id, bill);
    }
    return map;
  }, [bills]);
  const isOrderBillPaidForTracking = useCallback(
    (order: Pick<Order, "billId">) =>
      isBillPaidForTracking(order.billId ? billMap.get(order.billId) : null),
    [billMap],
  );

  const billsById = useMemo(() => {
    const map = new Map<number, BillWithPaymentRecorder>();
    (bills || []).forEach((bill) => {
      map.set(bill.id, bill);
    });
    return map;
  }, [bills]);

  const openOrderPayBillDialog = useCallback(
    (bill?: BillWithPaymentRecorder | Bill | null) => {
      if (!bill) {
        toast({
          title: "No Bill Found",
          description: "This order does not have a linked bill yet.",
          variant: "destructive",
        });
        return;
      }

      if (isBillPaidForTracking(bill)) {
        toast({
          title: "Already Paid",
          description: `Bill #${bill.id} is already paid.`,
        });
        return;
      }

      payBillDialogRef.current?.openBill(bill.id);
    },
    [toast],
  );

  const openOrderBillDetailsDialog = useCallback(
    (bill?: BillWithPaymentRecorder | Bill | null) => {
      if (!bill) {
        toast({
          title: "No Bill Found",
          description: "This order does not have a linked bill yet.",
          variant: "destructive",
        });
        return;
      }

      resetOrderBillPaymentState();
      setSelectedBill(bill as BillWithPaymentRecorder);
      setShowBillDialog(true);
    },
    [resetOrderBillPaymentState, toast],
  );

  const ordersByBillId = useMemo(() => {
    const map = new Map<number, Order[]>();
    (orders || []).forEach((order) => {
      if (!order.billId) return;
      const current = map.get(order.billId);
      if (current) {
        current.push(order);
        return;
      }
      map.set(order.billId, [order]);
    });
    return map;
  }, [orders]);

  const hasMeaningfulAdjustment = useCallback((order: Order): boolean => {
    const adjustedRaw = order.adjustedTotal;
    const hasAdjustedValue =
      adjustedRaw !== null &&
      adjustedRaw !== undefined &&
      String(adjustedRaw).trim() !== "";
    if (!hasAdjustedValue) return false;
    return String(order.priceAdjustReason || "").trim().length > 0;
  }, []);

  const getOrderDeliveryChargeAmount = useCallback((order: Order): number => {
    const charge = parseFloat(String((order as any).deliveryCharge || "0"));
    return Number.isFinite(charge) ? Math.max(0, charge) : 0;
  }, []);

  const getOrderTipsAmount = useCallback((order: Order): number => {
    const tips = parseFloat(String(order.tips || "0"));
    return Number.isFinite(tips) ? Math.max(0, tips) : 0;
  }, []);

  const getOrderExtraCharges = useCallback(
    (order: Order): number =>
      getOrderDeliveryChargeAmount(order) + getOrderTipsAmount(order),
    [getOrderDeliveryChargeAmount, getOrderTipsAmount],
  );

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

    const finalAmount = parseFloat(String(order.finalAmount ?? "0"));
    if (!Number.isFinite(finalAmount)) return 0;
    const directDiscount = parseFloat(String(order.discountAmount || "0"));
    const safeDiscount = Number.isFinite(directDiscount) ? Math.max(0, directDiscount) : 0;
    return Math.max(0, finalAmount + safeDiscount - getOrderExtraCharges(order));
  }, [billsById, getOrderExtraCharges, hasMeaningfulAdjustment, ordersByBillId]);

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

    const billBaseTotal = ordersInSameBill.reduce((sum, o) => sum + getOrderWorkReceivedAmount(o), 0);
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

    if (order.billId && bills) {
      const linkedBill = bills.find((bill) => bill.id === order.billId);
      const ordersInSameBill = (orders || []).filter((candidate) => candidate.billId === order.billId);
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

    // Final amount should always be derived from work-received amount minus discount.
    const workReceived = getOrderWorkReceivedAmount(order);
    return Math.max(0, workReceived - getOrderDiscountAmount(order)) + getOrderExtraCharges(order);
  }, [bills, orders, getOrderDiscountAmount, getOrderExtraCharges, getOrderWorkReceivedAmount]);

  const getBillDisplayAmounts = useCallback((bill: Bill) => {
    const linkedOrders = (orders || []).filter((candidate) => candidate.billId === bill.id);

    const fallbackOriginalRaw = parseFloat(String((bill as any).originalAmount ?? bill.amount ?? "0"));
    const fallbackDiscountRaw = parseFloat(String(bill.discountAmount || "0"));
    const fallbackDeliveryChargeRaw = parseFloat(String((bill as any).deliveryCharge || "0"));
    const fallbackFinalRaw = parseFloat(String(bill.amount || "0"));
    const paidAmountRaw = parseFloat(String(bill.paidAmount || "0"));

    const fallbackOriginalAmount = Number.isFinite(fallbackOriginalRaw) ? Math.max(0, fallbackOriginalRaw) : 0;
    const fallbackDiscount = Number.isFinite(fallbackDiscountRaw) ? Math.max(0, fallbackDiscountRaw) : 0;
    const fallbackDeliveryCharge = Number.isFinite(fallbackDeliveryChargeRaw) ? Math.max(0, fallbackDeliveryChargeRaw) : 0;
    const fallbackFinalAmount = Number.isFinite(fallbackFinalRaw) ? Math.max(0, fallbackFinalRaw) : 0;

	    let originalAmount = fallbackOriginalAmount;
	    let discount = fallbackDiscount;
	    let deliveryCharge = fallbackDeliveryCharge;
	    let finalAmount = fallbackFinalAmount;
	    const paidAmount = Number.isFinite(paidAmountRaw) ? Math.max(0, paidAmountRaw) : 0;

	    if (linkedOrders.length > 0) {
	      originalAmount = linkedOrders.reduce((sum, order) => sum + getOrderWorkReceivedAmount(order), 0);
	      discount = linkedOrders.reduce((sum, order) => sum + getOrderDiscountAmount(order), 0);
	      deliveryCharge = linkedOrders.reduce((sum, order) => sum + getOrderDeliveryChargeAmount(order), 0);
	      finalAmount = linkedOrders.reduce((sum, order) => sum + getOrderFinalAmount(order), 0);
	    }

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

    return {
	      originalAmount,
	      discount,
	      deliveryCharge,
	      finalAmount,
	      paidAmount,
	      due: Math.max(0, finalAmount - paidAmount),
	    };
	  }, [orders, getOrderDeliveryChargeAmount, getOrderDiscountAmount, getOrderFinalAmount, getOrderWorkReceivedAmount]);

  const getOrderBillVisualMeta = useCallback((bill?: Bill | null) => {
    if (!bill) {
      return {
        isPaid: false,
        isPartial: false,
        buttonTextClass: "text-primary",
        iconClass: "text-primary",
      };
    }

    const displayAmounts = getBillDisplayAmounts(bill);
    const isPaid = bill.isPaid || displayAmounts.due <= 0.01;
    const isPartial = !isPaid && displayAmounts.paidAmount > 0.01;

    if (isPartial) {
      return {
        isPaid,
        isPartial,
        buttonTextClass: "text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300",
        iconClass: "text-amber-500 dark:text-amber-400",
      };
    }

    if (isPaid) {
      return {
        isPaid,
        isPartial,
        buttonTextClass: "text-primary",
        iconClass: "text-green-600 dark:text-green-400",
      };
    }

    return {
      isPaid,
      isPartial,
      buttonTextClass: "text-primary",
      iconClass: "text-primary",
    };
  }, [getBillDisplayAmounts]);

  const getOrderBillStatusMeta = useCallback(
    (bill: Bill, displayAmounts: ReturnType<typeof getBillDisplayAmounts>): OrderBillStatusMeta => {
      const isPaid = bill.isPaid || displayAmounts.due <= 0.01;
      const isPartiallyPaid = !isPaid && displayAmounts.paidAmount > 0.01;

      if (isPaid) {
        return {
          label: "PAID",
          badgeClass: "bg-green-500 hover:bg-green-600",
          mobileCardClass: "border-emerald-200/80 bg-gradient-to-br from-white via-emerald-50/70 to-emerald-100/70 dark:from-card dark:via-emerald-950/20 dark:to-emerald-950/35",
          accentClass: "from-emerald-400 via-green-500 to-teal-500",
          summaryClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        };
      }

      if (isPartiallyPaid) {
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
    },
    [getBillDisplayAmounts],
  );

  const getOrderBillLatestPaymentDate = useCallback((bill?: BillWithPaymentRecorder | null) => {
    if (!bill) return null;
    const displayAmounts = getBillDisplayAmounts(bill);
    if (!bill.isPaid && displayAmounts.paidAmount <= 0.009) return null;
    return bill.paymentProcessedAt || null;
  }, [getBillDisplayAmounts]);

  const formatOrderBillCreatedDate = useCallback((value?: string | Date | null) => {
    if (!value) return "-";
    return format(new Date(value), "dd/MM/yyyy");
  }, []);

  const formatOrderBillDateTime = useCallback((value?: string | Date | null) => {
    if (!value) return "-";
    return format(new Date(value), "dd/MM/yyyy hh:mm a");
  }, []);

  const formatOrderBillPaymentDate = useCallback(
    (value?: string | Date | null) => formatOrderBillDateTime(value),
    [formatOrderBillDateTime],
  );

  const getOrderBillAddressLines = useCallback(
    (bill: Bill, client?: Client | null) => {
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

      const linkedClient = client ?? (bill.clientId ? clientMap.get(bill.clientId) : undefined);
      if (isBrokerClient(linkedClient)) return orderAddresses;

      const clientAddress = String(linkedClient?.address || "").trim();
      return isUsefulAddress(clientAddress) ? [clientAddress] : orderAddresses;
    },
    [clientMap, isBrokerClient, ordersByBillId],
  );

  const getOrderClientAccountLabel = useCallback(
    (clientId?: number | null) => {
      if (!clientId) return "";
      return clientMap.get(clientId)?.billNumber?.trim() || "";
    },
    [clientMap],
  );

  const currentSelectedBill = useMemo(() => {
    if (!selectedBill) return null;
    return billsById.get(selectedBill.id) || selectedBill;
  }, [selectedBill, billsById]);

  const selectedBillDisplayAmounts = useMemo(() => {
    return currentSelectedBill ? getBillDisplayAmounts(currentSelectedBill) : null;
  }, [currentSelectedBill, getBillDisplayAmounts]);

  const canRecordCurrentBillPayment = Boolean(
    currentSelectedBill &&
      selectedBillDisplayAmounts &&
      !currentSelectedBill.isPaid &&
      selectedBillDisplayAmounts.due > 0.009,
  );

  useEffect(() => {
    if (showBillDialog) {
      resetOrderBillPaymentState();
    }
  }, [showBillDialog, selectedBill?.id, resetOrderBillPaymentState]);

  useEffect(() => {
    if (!showBillDialog) return;
    if (canRecordCurrentBillPayment || (!showPaymentForm && !showPaymentChoice)) return;

    setShowPaymentForm(false);
    setShowPaymentChoice(false);
    setPayAllBills(false);
    setPaymentPin("");
    setPaymentPinError("");
  }, [showBillDialog, canRecordCurrentBillPayment, showPaymentForm, showPaymentChoice]);

  const sanitizeBillPdfTitle = useCallback((value: string) => {
    const normalized = value
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return normalized || "Document";
  }, []);

  const getOrderBillPdfTitle = useCallback((bill: Bill) => {
    const client = clients?.find((candidate) => candidate.id === bill.clientId);
    return sanitizeBillPdfTitle(
      [
        String(bill.referenceNumber || `Bill-${bill.id}`),
        bill.customerName || client?.name || "Customer",
        client?.billNumber?.trim() || "",
      ]
        .filter(Boolean)
        .join(" - "),
    );
  }, [clients, sanitizeBillPdfTitle]);

  const addBillPdfHeader = useCallback((doc: jsPDF, title: string, subtitleLines: string[] = []) => {
    const pageWidth = doc.internal.pageSize.getWidth();
    let cursorY = 12;
    let headerTextY = cursorY;

    if (logoBase64) {
      const logoWidth = 28;
      const logoHeight = 20;
      doc.addImage(logoBase64, "PNG", (pageWidth - logoWidth) / 2, cursorY, logoWidth, logoHeight);
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
  }, [logoBase64, companyContact.companyName, companyAddressLines, companyPhoneLine]);

  const downloadBillPdfFromOrders = useCallback((bill: Bill) => {
    const parsedItems = parseDescriptionItems(bill.description || "", products);
    const client = clients?.find((candidate) => candidate.id === bill.clientId);
    const customerName = bill.customerName || client?.name || "Walk-in Customer";
    const customerAccountNumber = client?.billNumber?.trim() || "";
    const displayAmounts = getBillDisplayAmounts(bill);
    const relatedOrder = orders?.find((order) => order.billId === bill.id);
    const priceAdjustReason = (bill as any).priceAdjustReason || relatedOrder?.priceAdjustReason;
    const billIsUrgent = Boolean(relatedOrder?.urgent);
    const subTotal = parsedItems.reduce((sum, item) => sum + item.total, 0);
    const adjustedTotal =
      relatedOrder?.adjustedTotal != null ? parseFloat(relatedOrder.adjustedTotal) : displayAmounts.originalAmount;
    const originalTotal = displayAmounts.originalAmount;
    const printDocumentTitle = getOrderBillPdfTitle(bill);
    const parsedItemDisplayDetails = parsedItems.map((item) => getInvoiceItemDisplayDetails(item.name));
    const billTypeLabel = billIsUrgent ? "URGENT" : "NORMAL";
    const billTypeColor: [number, number, number] = billIsUrgent ? [220, 38, 38] : [22, 163, 74];

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    let cursorY = addBillPdfHeader(doc, "INVOICE", [
      `Ref: ${bill.referenceNumber || bill.id}`,
      `Bill #: ${bill.id}`,
      `Date: ${bill.billDate ? format(new Date(bill.billDate), "dd/MM/yyyy HH:mm") : "-"}`,
    ]);

    const customerInfoLines = [
      `Bill #: ${bill.id}`,
      `Customer: ${customerName}`,
      customerAccountNumber ? `Acc #: ${customerAccountNumber}` : "",
      getDisplayPhone(bill.customerPhone, client?.phone)
        ? `Phone: ${getDisplayPhone(bill.customerPhone, client?.phone)}`
        : "",
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
        `Payment Method: ${bill.paymentMethod === "deposit" ? "Account Credit" : formatOrderPaymentMethodLabel(bill.paymentMethod || "cash")}`,
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
    doc.save(printDocumentTitle.toLowerCase().endsWith(".pdf") ? printDocumentTitle : `${printDocumentTitle}.pdf`);
  }, [
    products,
    clients,
    orders,
    getBillDisplayAmounts,
    getOrderBillPdfTitle,
    addBillPdfHeader,
    companyContact.companyName,
  ]);

  const getClientAvailableDeposit = useCallback((clientId?: number | null) => {
    if (!clientId || !clients) return 0;
    const client = clients.find((candidate) => candidate.id === clientId);
    return Math.max(0, parseFloat(client?.deposit || "0"));
  }, [clients]);

  const selectedBillClientDeposit = useMemo(
    () => getClientAvailableDeposit(currentSelectedBill?.clientId),
    [getClientAvailableDeposit, currentSelectedBill?.clientId],
  );

  const paymentMethodOptions = useMemo(
    () =>
      selectedBillClientDeposit > 0.01
        ? [...basePaymentMethodOptions, depositPaymentMethodOption]
        : basePaymentMethodOptions,
    [selectedBillClientDeposit],
  );
  const splitPaymentMethodOptions = useMemo(
    () =>
      [
        ...basePaymentMethodOptions,
        ...(selectedBillClientDeposit > 0.01 ? [depositPaymentMethodOption] : []),
      ].filter(({ value }) => value !== paymentMethod),
    [paymentMethod, selectedBillClientDeposit],
  );

  useEffect(() => {
    if (paymentMethod === "deposit" && selectedBillClientDeposit <= 0.01) {
      setPaymentMethod("cash");
    }
  }, [paymentMethod, selectedBillClientDeposit]);
  useEffect(() => {
    if (!splitPaymentMethodOptions.some(({ value }) => value === remainingPaymentMethod)) {
      setRemainingPaymentMethod(splitPaymentMethodOptions[0]?.value || "card");
    }
  }, [splitPaymentMethodOptions, remainingPaymentMethod]);

  useEffect(() => {
    if (!splitPaymentEnabled || payAllBills) return;

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
        ? Math.min(totalAmount, selectedBillClientDeposit)
        : totalAmount;

    if (!Number.isFinite(currentSplitAmount) || currentSplitAmount <= 0) {
      return;
    }

    if (currentSplitAmount > maxAllowedAmount + 0.009) {
      setSplitPaymentAmount(maxAllowedAmount.toFixed(2));
    }
  }, [
    payAllBills,
    splitPaymentEnabled,
    paymentAmount,
    splitPaymentAmount,
    paymentMethod,
    selectedBillClientDeposit,
  ]);

  const requestedPaymentAmount = parseFloat(paymentAmount || "0");
  const normalizedRequestedPaymentAmount = Number.isFinite(requestedPaymentAmount)
    ? requestedPaymentAmount
    : 0;
  const requestedDiscountAmount = parseFloat(discountAmount || "0");
  const normalizedRequestedDiscountAmount =
    applyDiscount && !payAllBills && Number.isFinite(requestedDiscountAmount)
      ? Math.max(0, requestedDiscountAmount)
      : 0;
  const selectedBillDiscountToApply = selectedBillDisplayAmounts
    ? Math.min(normalizedRequestedDiscountAmount, selectedBillDisplayAmounts.originalAmount)
    : 0;
  const selectedBillExpectedDueAfterDiscount = selectedBillDisplayAmounts
    ? applyDiscount
      ? Math.max(
          0,
          selectedBillDisplayAmounts.originalAmount -
            selectedBillDiscountToApply -
            selectedBillDisplayAmounts.paidAmount,
        )
      : selectedBillDisplayAmounts.due
    : 0;
  const showOrderPartialPaymentNotice =
    !payAllBills &&
    normalizedRequestedPaymentAmount > 0.009 &&
    selectedBillExpectedDueAfterDiscount > 0.009 &&
    normalizedRequestedPaymentAmount < selectedBillExpectedDueAfterDiscount - 0.009;
  const orderPartialPaymentRemainingAfterPayment = Math.max(
    0,
    selectedBillExpectedDueAfterDiscount - normalizedRequestedPaymentAmount,
  );
  const requestedSplitPaymentAmount = parseFloat(splitPaymentAmount || "0");
  const normalizedSplitPaymentAmount = Number.isFinite(requestedSplitPaymentAmount)
    ? requestedSplitPaymentAmount
    : 0;
  const splitRemainingAmount =
    splitPaymentEnabled && !payAllBills
      ? Math.max(0, normalizedRequestedPaymentAmount - normalizedSplitPaymentAmount)
      : 0;
  const hasActiveSplitPayment =
    splitPaymentEnabled &&
    !payAllBills &&
    normalizedSplitPaymentAmount > 0.009 &&
    splitRemainingAmount > 0.009;

  const { data: incidents } = useQuery<{ orderId: number }[]>({
    queryKey: ["/api/incidents"],
  });

  // Check if an order has any incident
  const orderHasIncident = (orderId: number): boolean => {
    if (!incidents) return false;
    return incidents.some(incident => incident.orderId === orderId);
  };

  // Calculate client's due balance from actual orders (unpaid amounts)
  const getClientDueBalance = (clientId: number): number => {
    if (!orders) return 0;
    const clientOrders = orders.filter(order => order.clientId === clientId);
    return clientOrders.reduce((sum, order) => {
      const total = parseFloat(order.totalAmount || "0");
      const paid = parseFloat(order.paidAmount || "0");
      return sum + (total - paid);
    }, 0);
  };

  useEffect(() => {
    if (urlBillId && urlClientId && bills) {
      const bill = bills.find((b) => b.id === parseInt(urlBillId));
      if (bill && bill.clientId === parseInt(urlClientId) && !bill.isPaid) {
        setPrefilledClientId(urlClientId);
        setPrefilledBillId(urlBillId);
        setIsCreateOpen(true);
        setLocation("/orders", { replace: true });
      } else {
        setLocation("/orders", { replace: true });
        toast({
          title: "Invalid Bill",
          description:
            "The selected bill is no longer available or has been paid.",
          variant: "destructive",
        });
      }
    }
  }, [urlBillId, urlClientId, bills]);

  useEffect(() => {
    if (urlPayOrderId && orders && bills) {
      const orderId = parseInt(urlPayOrderId);
      const order = orders.find((o) => o.id === orderId);
      if (order && order.billId) {
        const bill = bills.find((b) => b.id === order.billId);
        if (bill && !bill.isPaid) {
          payBillDialogRef.current?.openBill(bill.id);
          setLocation("/orders", { replace: true });
        }
      }
    }
  }, [urlPayOrderId, orders, bills, setLocation]);

  useEffect(() => {
    if (urlPayBillId && bills) {
      const billId = parseInt(urlPayBillId);
      const bill = bills.find((b) => b.id === billId);
      if (bill && !bill.isPaid) {
        payBillDialogRef.current?.openBill(bill.id);
        setLocation("/orders", { replace: true });
      }
    }
  }, [urlPayBillId, bills, setLocation]);

  useEffect(() => {
    if ((!urlFocusOrderId && !urlFocusBillId && !urlHighlightOrderNumber) || !orders) return;

    const parsedFocusOrderId = urlFocusOrderId ? parseInt(urlFocusOrderId, 10) : NaN;
    const parsedFocusBillId = urlFocusBillId ? parseInt(urlFocusBillId, 10) : NaN;
    const requestedFocusDate = parseDateOnlyKey(urlFocusDate);
    const requestedFocusDateField =
      urlFocusDateField === "delivery" ? "delivery" : "entry";
    const requestedFocusTab =
      urlFocusTab === "delivery" ? "delivery" : "all";
    const targetOrder =
      (Number.isFinite(parsedFocusOrderId) ? orders.find((order) => order.id === parsedFocusOrderId) : undefined) ||
      (Number.isFinite(parsedFocusBillId) ? orders.find((order) => order.billId === parsedFocusBillId) : undefined) ||
      (urlHighlightOrderNumber ? orders.find((order) => order.orderNumber === urlHighlightOrderNumber) : undefined);

    if (!targetOrder) {
      if (requestedFocusDate) {
        const requestedFocusDateKey = toDateOnlyKey(requestedFocusDate);
        if (dateFilter !== "exact" || toDateOnlyKey(exactDate) !== requestedFocusDateKey) {
          setDateFilter("exact");
          setExactDate(requestedFocusDate);
          return;
        }
      }

      if (isLoading || isFetching) return;
      setLocation("/orders", { replace: true });
      return;
    }

    const focusDate = requestedFocusDate;
    const fallbackFocusDateKey =
      getTrackingDateKey(targetOrder, requestedFocusDateField) || toDateOnlyKey(targetOrder.entryDate);
    const resolvedFocusDate = focusDate || parseDateOnlyKey(fallbackFocusDateKey);
    const resolvedFocusDateKey = toDateOnlyKey(resolvedFocusDate);

    setActiveTab(requestedFocusTab);
    setShowUrgentOnly(false);
    setShowNormalOnly(false);
    setNewCreatedOrder(null);
    setHighlightedOrderId(targetOrder.id);
    setPendingFocusOrderId(targetOrder.id);

    if (resolvedFocusDate) {
      setDateFilter("exact");
      setExactDate(resolvedFocusDate);
      setForcedVisibleOrderId(targetOrder.id);
      setForcedVisibleDateKey(resolvedFocusDateKey || null);
    } else {
      setDateFilter("all_time");
      setExactDate(undefined);
      setForcedVisibleOrderId(null);
      setForcedVisibleDateKey(null);
    }

    setLocation("/orders", { replace: true });
  }, [urlFocusOrderId, urlFocusBillId, urlFocusDate, urlFocusDateField, urlFocusTab, urlHighlightOrderNumber, orders, dateFilter, exactDate, isLoading, isFetching, setLocation, trackingDateField]);

  const handleDialogClose = (open: boolean) => {
    setIsCreateOpen(open);
    if (!open) {
      setPrefilledClientId(undefined);
      setPrefilledBillId(undefined);
    }
  };

  const getClientBills = (clientId: number) => {
    return bills?.filter((b) => b.clientId === clientId) || [];
  };

  const getClientUnpaidBills = (clientId: number) => {
    return getClientBills(clientId).filter((b) => !b.isPaid);
  };

  const openClientTransactions = (clientId: number) => {
    setAccountActivityClientId(clientId);
  };

  const openClientEdit = (clientId: number) => {
    setEditingClientId(clientId);
  };

  const parseOrderItems = (
    itemsString: string | null,
  ): Array<{ name: string; quantity: number }> => {
    if (!itemsString) return [];

    const trimmed = itemsString.trim();

    // Try parsing as JSON first (array of objects format)
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item: any) => ({
            name: item.name || item.productName || "Unknown",
            quantity: item.quantity || item.qty || 1,
          }));
        }
      } catch (e) {
        // Fall through to string parsing
      }
    }

    // String format: "2x Shirt, 3x Pants" (quantity first) or "Shirt x2, Pants x3" (name first)
    return itemsString.split(", ").map((item) => {
      // Try "2x ProductName" format first (current format used in order creation)
      const quantityFirstMatch = item.match(/^(\d+)x\s+(.+)$/);
      if (quantityFirstMatch) {
        return {
          name: quantityFirstMatch[2].trim(),
          quantity: parseInt(quantityFirstMatch[1]),
        };
      }

      // Try "ProductName x2" format (legacy)
      const nameFirstMatch = item.match(/^(.+)\s+x(\d+)$/);
      if (nameFirstMatch) {
        return {
          name: nameFirstMatch[1].trim(),
          quantity: parseInt(nameFirstMatch[2]),
        };
      }

      // No quantity found, assume 1
      return { name: item.trim(), quantity: 1 };
    });
  };

  const getOrderItemDoneStatus = (order: Pick<Order, "deliveryType">) =>
    order.deliveryType === "delivery" ? "delivered" : "picked_up";

  const getOrderItemCompletedQuantity = (
    order: Pick<Order, "deliveryType" | "delivered" | "itemPickupStatus">,
    itemIndex: number,
    itemQuantity: number,
  ) => {
    const doneStatus = getOrderItemDoneStatus(order);
    const pickupStatusMap = parseItemPickupStatusMap(order.itemPickupStatus);
    return getItemPickupCompletedQuantityFromMap(
      pickupStatusMap,
      itemIndex,
      itemQuantity,
      doneStatus,
      order.delivered === true,
    );
  };

  const getOrderItemCompletionSummary = (
    order: Pick<Order, "items" | "deliveryType" | "delivered" | "itemPickupStatus">,
  ) => {
    const items = parseOrderItems(order.items);
    const doneStatus = getOrderItemDoneStatus(order);
    const pickupStatusMap = parseItemPickupStatusMap(order.itemPickupStatus);
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const completedQuantity = items.reduce(
      (sum, item, itemIndex) =>
        sum +
        getItemPickupCompletedQuantityFromMap(
          pickupStatusMap,
          itemIndex,
          item.quantity,
          doneStatus,
          order.delivered === true,
        ),
      0,
    );
    const completedLineCount = items.reduce((sum, item, itemIndex) => {
      const itemCompletedQuantity = getItemPickupCompletedQuantityFromMap(
        pickupStatusMap,
        itemIndex,
        item.quantity,
        doneStatus,
        order.delivered === true,
      );
      return sum + (itemCompletedQuantity >= item.quantity ? 1 : 0);
    }, 0);

    return {
      items,
      totalQuantity,
      completedQuantity,
      completedLineCount,
    };
  };

  const updateOrderItemCompletedQuantity = (
    order: Pick<Order, "id" | "itemPickupStatus" | "deliveryType">,
    itemIndex: number,
    itemQuantity: number,
    completedQuantity: number,
  ) => {
    updateOrderMutation.mutate({
      id: order.id,
      updates: {
        itemPickupStatus: buildItemPickupStatusJson(
          order.itemPickupStatus,
          itemIndex,
          itemQuantity,
          completedQuantity,
          getOrderItemDoneStatus(order),
        ),
      },
    });
  };

  const getProductImage = (productName: string) => {
    const product = products?.find(
      (p) => p.name.toLowerCase() === productName.toLowerCase(),
    );
    return product?.imageUrl || getStockProductImage(productName);
  };

  const getItemPrice = (itemName: string, deliveryType?: string | null, isUrgent?: boolean): number => {
    const customPriceMatch = itemName.match(/(.+?)\s*@\s*([\d.]+)\s*AED/i);
    if (customPriceMatch) {
      return parseFloat(customPriceMatch[2]);
    }

    const serviceType = getStoredOrderItemServiceType(itemName, deliveryType);
    const hasUrgTag = itemName.includes('*URG*');
    const itemUrgent = isUrgent || hasUrgTag;

    const sizeMatch = itemName.match(/\((Small|Medium|Large)\)/i);
    const size = sizeMatch ? sizeMatch[1].toLowerCase() : null;

    const baseProductName = itemName
      .replace(/\s*\[N\]\s*/g, '')
      .replace(/\s*\[DC?\]\s*/g, '')
      .replace(/\s*\[IO?\]\s*/g, '')
      .replace(/\s*\(folding\)\s*/gi, '')
      .replace(/\s*\(hanger\)\s*/gi, '')
      .replace(/\s*\(hanging\)\s*/gi, '')
      .replace(/\s*\(Small\)\s*/gi, '')
      .replace(/\s*\(Medium\)\s*/gi, '')
      .replace(/\s*\(Large\)\s*/gi, '')
      .replace(/\s*\*URG\*\s*/g, '')
      .replace(/\s*@\s*[\d.]+\s*AED/gi, '')
      .trim();

    const product = products?.find((p) => p.name.toLowerCase() === baseProductName.toLowerCase());
    if (product) {
      let basePrice = parseFloat(product.price || "0");
      if (size === 'small' && product.smallPrice) basePrice = parseFloat(product.smallPrice);
      else if (size === 'medium' && product.mediumPrice) basePrice = parseFloat(product.mediumPrice);
      else if (size === 'large' && product.largePrice) basePrice = parseFloat(product.largePrice);

      if (serviceType === "iron_only") {
        if (itemUrgent) {
          if (size === 'small' && product.smallUrgentIronOnlyPrice) return parseFloat(product.smallUrgentIronOnlyPrice);
          if (size === 'medium' && product.mediumUrgentIronOnlyPrice) return parseFloat(product.mediumUrgentIronOnlyPrice);
          if (size === 'large' && product.largeUrgentIronOnlyPrice) return parseFloat(product.largeUrgentIronOnlyPrice);
          if (product.urgentIronOnlyPrice) return parseFloat(product.urgentIronOnlyPrice);
        }
        let ioPrice = basePrice / 2;
        if (size === 'small' && product.smallIronOnlyPrice) ioPrice = parseFloat(product.smallIronOnlyPrice);
        else if (size === 'medium' && product.mediumIronOnlyPrice) ioPrice = parseFloat(product.mediumIronOnlyPrice);
        else if (size === 'large' && product.largeIronOnlyPrice) ioPrice = parseFloat(product.largeIronOnlyPrice);
        else if (product.ironOnlyPrice) ioPrice = parseFloat(product.ironOnlyPrice);
        if (itemUrgent) ioPrice *= 2;
        return ioPrice;
      }
      if (serviceType === "dc") {
        if (itemUrgent) {
          if (size === 'small' && product.smallUrgentDryCleanPrice) return parseFloat(product.smallUrgentDryCleanPrice);
          if (size === 'medium' && product.mediumUrgentDryCleanPrice) return parseFloat(product.mediumUrgentDryCleanPrice);
          if (size === 'large' && product.largeUrgentDryCleanPrice) return parseFloat(product.largeUrgentDryCleanPrice);
          if (product.urgentDryCleanPrice) return parseFloat(product.urgentDryCleanPrice);
        }
        let dcPrice = basePrice;
        if (size === 'small' && product.smallDryCleanPrice) dcPrice = parseFloat(product.smallDryCleanPrice);
        else if (size === 'medium' && product.mediumDryCleanPrice) dcPrice = parseFloat(product.mediumDryCleanPrice);
        else if (size === 'large' && product.largeDryCleanPrice) dcPrice = parseFloat(product.largeDryCleanPrice);
        else dcPrice = parseFloat(product.dryCleanPrice || String(basePrice * 2));
        if (itemUrgent) dcPrice *= 2;
        return dcPrice;
      }
      if (itemUrgent) {
        if (size === 'small' && product.smallUrgentPrice) return parseFloat(product.smallUrgentPrice);
        if (size === 'medium' && product.mediumUrgentPrice) return parseFloat(product.mediumUrgentPrice);
        if (size === 'large' && product.largeUrgentPrice) return parseFloat(product.largeUrgentPrice);
        return basePrice * 2;
      }
      return basePrice;
    }

    return 0;
  };

  const calculateEditItemsTotal = (): number => {
    if (!editItemsDialog) return 0;
    let total = 0;
    Object.entries(editItemsQuantities).forEach(([lineKey, qty]) => {
      const snapshotPrice = editItemsUnitPrices[lineKey];
      const unitPrice = Number.isFinite(snapshotPrice)
        ? snapshotPrice
        : getItemPrice(
            editItemsNames[lineKey] || "",
            editItemsDialog.deliveryType,
            editItemsDialog.urgent === true,
          );
      total += unitPrice * qty;
    });
    return total;
  };

  useEffect(() => {
    if (dueSoonOrders && dueSoonOrders.length > 0) {
      toast({
        title: "Delivery Alert",
        description: `${dueSoonOrders.length} order(s) due for delivery soon!`,
        variant: "destructive",
      });
    }
  }, [dueSoonOrders?.length]);

  useEffect(() => {
    if (packingPinDialog) {
      clearStaffPinInput(packingPinInputRef);
      clearStaffPinPreview("packing");
      setPinError("");
      setTimeout(() => {
        packingPinInputRef.current?.focus();
        packingPinInputRef.current?.click();
      }, 300);
    }
  }, [packingPinDialog]);

  useEffect(() => {
    if (tagPinDialog) {
      clearStaffPinInput(tagPinInputRef);
      clearStaffPinPreview("tag");
      setTagPinError("");
      setTimeout(() => {
        tagPinInputRef.current?.focus();
        tagPinInputRef.current?.click();
      }, 300);
    }
  }, [tagPinDialog]);

  useEffect(() => {
    if (deliveryPinDialog) {
      clearStaffPinPreview("delivery");
      setTimeout(() => {
        deliveryPinInputRef.current?.focus();
        deliveryPinInputRef.current?.select();
        deliveryPinInputRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 300);
    }
  }, [deliveryPinDialog]);

  const updateOrderMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      const res = await apiRequest("PUT", `/api/orders/${id}`, updates);
      return res.json() as Promise<Order>;
    },
    onMutate: async ({ id, updates }: { id: number; updates: any }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/orders"] });

      const previousOrders = queryClient.getQueryData<Order[]>(["/api/orders"]);

      queryClient.setQueryData<Order[]>(["/api/orders"], (current) =>
        current?.map((order) =>
          order.id === id ? { ...order, ...updates } : order,
        ) || current,
      );

      setOrderDetailDialog((current) =>
        current && current.id === id ? { ...current, ...updates } : current,
      );

      return { previousOrders };
    },
    onSuccess: (updatedOrder, variables) => {
      queryClient.setQueryData<Order[]>(["/api/orders"], (current) =>
        current?.map((order) =>
          order.id === updatedOrder.id ? { ...order, ...updatedOrder } : order,
        ) || current,
      );
      setOrderDetailDialog((current) =>
        current && current.id === updatedOrder.id
          ? { ...current, ...updatedOrder }
          : current,
      );

      if (selectedBill && updatedOrder.billId && selectedBill.id === updatedOrder.billId) {
        setSelectedBill((current) => current ? { ...current } : current);
      }

      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/products/allocated-stock"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "Order Updated",
        description: "Status updated successfully",
      });
    },
    onError: (error: any, _variables, context) => {
      if (context?.previousOrders) {
        queryClient.setQueryData(["/api/orders"], context.previousOrders);
      }
      let message = "Failed to update order";
      try {
        const errorMsg = String(error.message || "");
        const msgMatch = errorMsg.match(/"message"\s*:\s*"([^"]+)"/);
        if (msgMatch) message = msgMatch[1];
      } catch {}
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const createOrderMutation = useMutation({
    mutationFn: async (orderData: any) => {
      const res = await apiRequest("POST", "/api/orders", orderData);
      return res.json();
    },
    onSuccess: (createdOrder: Order) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/products/allocated-stock"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] }); // Refresh products to show updated stock
      setIsCreateOpen(false);
      setPrefilledClientId(undefined);
      setPrefilledBillId(undefined);
      setNewCreatedOrder(createdOrder);
      toast({
        title: "Order Created",
        description: "New order has been created. Generating PDF...",
      });
    },
    onError: (error: any) => {
      let cleanMessage = "Failed to create order";
      let isCustomerExists = false;
      let isBillingRights = false;

      try {
        const errorMsg = String(error.message || error || "");
        console.log("Order error raw:", errorMsg);

        // Format is typically "403: {json}" or "400: {json}"
        // First try to extract the message directly using regex
        const msgMatch = errorMsg.match(/"message"\s*:\s*"([^"]+)"/);
        if (msgMatch) {
          cleanMessage = msgMatch[1];
        } else {
          // Try to find and parse JSON after status code
          const jsonStartIdx = errorMsg.indexOf("{");
          if (jsonStartIdx !== -1) {
            const jsonStr = errorMsg.substring(jsonStartIdx);
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.message) {
                cleanMessage = parsed.message;
              }
            } catch {
              // If JSON parse fails, use the raw message
            }
          }
        }

        console.log("Parsed message:", cleanMessage);

        isCustomerExists = cleanMessage.toLowerCase().includes("customer details already exist") ||
                          cleanMessage.toLowerCase().includes("customer already exists");
        isBillingRights = cleanMessage.toLowerCase().includes("billing rights") ||
                          cleanMessage.toLowerCase().includes("admin pin");
      } catch (err) {
        console.error("Error parsing order error:", err);
      }

      toast({
        title: isBillingRights ? "PIN Not Authorized" : (isCustomerExists ? "Customer Already Exists" : "Error"),
        description: cleanMessage,
        variant: "destructive",
      });
    },
  });

  const generatePDF = async () => {
    if (pdfReceiptRef.current && newCreatedOrder) {
      const opt = {
        margin: 8,
        filename: `Order_${newCreatedOrder.orderNumber}.pdf`,
        image: { type: "jpeg" as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: {
          unit: "mm" as const,
          format: "a5" as const,
          orientation: "portrait" as const,
        },
      };

      try {
        await html2pdf().set(opt).from(pdfReceiptRef.current).save();
        toast({
          title: "PDF Downloaded",
          description: `Order ${newCreatedOrder.orderNumber} PDF saved`,
        });
      } catch (err) {
        toast({
          title: "PDF Error",
          description: "Failed to generate PDF",
          variant: "destructive",
        });
      }
    }
  };

  const generateTagReceipt = (order: Order) => {
    const client = clients?.find((c) => c.id === order.clientId);
    const linkedBill = order.billId ? bills?.find((b) => b.id === order.billId) : null;
    const linkedBillNumber = linkedBill
      ? `#${linkedBill.id}${linkedBill.referenceNumber ? ` (${linkedBill.referenceNumber})` : ""}`
      : order.billId
        ? `#${order.billId}`
        : "N/A";
    const parsedItems = parseOrderItems(order.items);
    const isUrgent = order.urgent === true;

    const previousBills =
      bills?.filter((b) => b.clientId === order.clientId && b.id !== order.billId) || [];
    const unpaidBills = previousBills.filter((b) => !b.isPaid);
    const totalPreviousDue = unpaidBills.reduce((sum, b) => {
      const billTotal = parseFloat(b.amount) || 0;
      const billPaid = parseFloat(b.paidAmount || "0") || 0;
      return sum + (billTotal - billPaid);
    }, 0);

    // Aggressive font scaling to fit everything on 1 page
    const totalItems = parsedItems.length + unpaidBills.length;
    const baseFontSize = totalItems > 30 ? 6 : totalItems > 25 ? 7 : totalItems > 20 ? 7.5 : 8;
    const headerSize = baseFontSize + 2;
    const titleSize = baseFontSize + 4;

    const itemRows = parsedItems.map((item, idx) => {
      const itemIsUrgent = item.name.includes("*URG*");
      const unitPrice = getItemPrice(item.name, order.deliveryType, itemIsUrgent);
      const lineTotal = unitPrice * item.quantity;
      const formattedName = item.name.replace(/\s*@\s*[\d.]+\s*AED/i, "");
      const rowStyle = itemIsUrgent
        ? "border-bottom: 1px solid #e5e5e5; background: #fef2f2; color: #dc2626;"
        : "border-bottom: 1px solid #e5e5e5;";
      const itemDescriptionHtml = getInvoiceItemDescriptionHtml(formattedName, {
        fontSizePx: baseFontSize,
        indicatorFontSizePx: Math.max(baseFontSize, 7),
        packingFontSizePx: Math.max(baseFontSize, 7),
        packingGapPx: 10,
        packingMarginTopPx: 3,
        boxSizePx: Math.max(baseFontSize + 3, 10),
      });

      return {
        html: `<tr style="${rowStyle}">
          <td style="padding: 2px; font-size: ${baseFontSize}px;">${idx + 1}</td>
          <td style="padding: 3px 2px; font-size: ${baseFontSize}px; font-weight: ${itemIsUrgent ? "bold" : "normal"}; vertical-align: top;">${itemDescriptionHtml}</td>
          <td style="padding: 2px; font-size: ${baseFontSize}px; text-align: center; font-weight: bold;">${item.quantity}</td>
          <td style="padding: 2px; font-size: ${baseFontSize}px; text-align: right;">${unitPrice.toFixed(2)}</td>
          <td style="padding: 2px; font-size: ${baseFontSize}px; text-align: right; font-weight: bold;">${lineTotal.toFixed(2)}</td>
        </tr>`,
      };
    });
    const totalItemQuantity = parsedItems.reduce((sum, item) => sum + item.quantity, 0);
    const currentOrderTotal = parseFloat(
      order.adjustedTotal != null ? order.adjustedTotal : (order.finalAmount ?? order.totalAmount),
    );
    const discountAmount = parseFloat(order.discountAmount || "0");

    const renderTagItemsTable = (rows: typeof itemRows) => `
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #ddd; table-layout: fixed;">
        <thead>
          <tr style="background: #f0f0f0;">
            <th style="padding: 3px 2px; text-align: left; font-size: ${baseFontSize - 1}px; border-bottom: 1px solid #000; width: 18px;">#</th>
            <th style="padding: 3px 2px; text-align: left; font-size: ${baseFontSize - 1}px; border-bottom: 1px solid #000;">Item</th>
            <th style="padding: 3px 2px; text-align: center; font-size: ${baseFontSize - 1}px; border-bottom: 1px solid #000; width: 25px;">Qty</th>
            <th style="padding: 3px 2px; text-align: right; font-size: ${baseFontSize - 1}px; border-bottom: 1px solid #000; width: 40px;">Price</th>
            <th style="padding: 3px 2px; text-align: right; font-size: ${baseFontSize - 1}px; border-bottom: 1px solid #000; width: 45px;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => row.html).join("")}
        </tbody>
      </table>
    `;

    const renderTagItemsSection = (leftRows: typeof itemRows, rightRows: typeof itemRows) => `
      <div style="margin-bottom: 8px;">
        <div style="font-size: ${headerSize}px; font-weight: bold; margin-bottom: 4px; border-bottom: 1px solid #000; padding-bottom: 2px;">ITEMS DETAIL</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: start;">
          <div>${renderTagItemsTable(leftRows)}</div>
          <div>${rightRows.length > 0 ? renderTagItemsTable(rightRows) : ""}</div>
        </div>
        <div style="background: #f8f9fa; border: 1px solid #ddd; border-top: 2px solid #000; padding: 4px; margin-top: 2px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: ${baseFontSize + 1}px; font-weight: bold;">Total: ${totalItemQuantity} items</span>
            <span style="font-size: ${headerSize + 2}px; font-weight: bold;">AED ${currentOrderTotal.toFixed(2)}</span>
          </div>
          ${
            discountAmount > 0
              ? `<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px; padding-top: 2px; border-top: 1px dashed #ccc;">
                <span style="font-size: ${baseFontSize}px; color: #666;">Original: AED ${parseFloat(order.totalAmount || "0").toFixed(2)}</span>
                <span style="font-size: ${baseFontSize}px; color: #ea580c; font-weight: bold;">Discount: -${discountAmount.toFixed(2)} AED</span>
              </div>`
              : ""
          }
        </div>
        ${order.priceAdjustReason ? `<div style="padding: 2px; font-size: ${baseFontSize}px; color: #b45309; font-style: italic;">Price adjusted: ${order.priceAdjustReason}</div>` : ""}
      </div>
    `;

    const renderTagDocument = (itemsSectionHtml: string) => `
      <div style="font-family: Arial, sans-serif; padding: 8px; max-width: 190mm; color: #000; background: #fff; font-size: ${baseFontSize}px;">
        <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px;">
          ${tagLogoBase64 ? `<img src="${tagLogoBase64}" alt="Logo" style="width: 120px; height: auto; margin: 0 auto 4px; display: block;" />` : `<div style="font-size: ${titleSize}px; font-weight: bold; letter-spacing: 1px;">${escapeHtml(companyContact.companyName.toUpperCase())}</div>`}
          <div style="font-size: ${baseFontSize}px; margin-top: 2px; color: #666;">${companyAddressHtml}</div>
          <div style="font-size: ${baseFontSize - 1}px; margin-top: 1px; color: #888;">${companyPhoneHtml}</div>
        </div>

        ${isUrgent ? `<div style="text-align: center; padding: 4px; margin: 6px 0; background: #fef2f2; border: 2px solid #dc2626; font-weight: bold; color: #dc2626; font-size: ${headerSize}px; border-radius: 3px;">*** URGENT ORDER ***</div>` : ""}

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
          <div>
            <div style="font-size: ${baseFontSize - 1}px; color: #666; text-transform: uppercase; margin-bottom: 2px;">Order Number</div>
            <div style="font-size: ${titleSize}px; font-weight: bold; color: #000; border: 2px dashed #000; padding: 4px 8px; display: inline-block;">${order.orderNumber}</div>
            <div style="font-size: ${baseFontSize - 1}px; color: #666; text-transform: uppercase; margin-top: 5px; margin-bottom: 2px;">Bill Number</div>
            <div style="font-size: ${headerSize}px; font-weight: bold; color: #1d4ed8;">${linkedBillNumber}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: ${baseFontSize - 1}px; color: #666;">Entry Date</div>
            <div style="font-size: ${headerSize}px; font-weight: bold;">${format(new Date(order.entryDate), "dd MMM yyyy")}</div>
            <div style="font-size: ${baseFontSize}px; color: #666;">${format(new Date(order.entryDate), "hh:mm a")}</div>
            ${
              order.expectedDeliveryAt
                ? `
            <div style="font-size: ${baseFontSize - 1}px; color: #666; margin-top: 3px;">Expected Delivery</div>
            <div style="font-size: ${headerSize}px; font-weight: bold; color: #2563eb;">${format(new Date(order.expectedDeliveryAt), "dd MMM yyyy")}</div>
            `
                : ""
            }
          </div>
        </div>

        <div style="margin-bottom: 8px; font-size: ${baseFontSize}px; line-height: 1.6;">
          <div><strong>Name:</strong> ${client?.name || order.customerName || "Walk-in"}</div>
          ${getDisplayPhone(client?.phone) ? `<div><strong>Phone:</strong> ${getDisplayPhone(client?.phone)}</div>` : ""}
          ${getOrderDisplayAddress(order, client) ? `<div><strong>Address:</strong> ${getOrderDisplayAddress(order, client)}</div>` : ""}
        </div>

        ${order.notes ? `
        <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 3px; padding: 6px; margin-bottom: 8px;">
          <div style="font-family: Arial, sans-serif; font-size: ${baseFontSize - 1}px; color: #92400e; text-transform: uppercase; margin-bottom: 2px; font-weight: bold;">Notes</div>
          <div style="font-family: Arial, sans-serif; font-size: ${baseFontSize}px; color: #78350f;">${order.notes}</div>
        </div>
        ` : ''}

        ${itemsSectionHtml}

        ${
          totalPreviousDue > 0
            ? `
        <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 4px; padding: 8px; margin-bottom: 8px;">
          <div style="font-size: ${headerSize}px; font-weight: bold; color: #856404; margin-bottom: 6px; border-bottom: 1px solid #ffc107; padding-bottom: 3px;">PREVIOUS BILLS (${unpaidBills.length})</div>
          <table style="width: 100%; border-collapse: collapse; font-size: ${baseFontSize}px;">
            <thead>
              <tr style="background: #ffeeba;">
                <th style="padding: 3px; text-align: left; border-bottom: 1px solid #d39e00;">Bill #</th>
                <th style="padding: 3px; text-align: left; border-bottom: 1px solid #d39e00;">Date</th>
                <th style="padding: 3px; text-align: right; border-bottom: 1px solid #d39e00;">Due</th>
              </tr>
            </thead>
            <tbody>
              ${unpaidBills.map(bill => {
                const billTotal = parseFloat(bill.amount) || 0;
                const billPaid = parseFloat(bill.paidAmount || "0") || 0;
                const billDue = billTotal - billPaid;
                return `<tr style="border-bottom: 1px dashed #d39e00;">
                  <td style="padding: 2px 3px;">#${bill.referenceNumber || bill.id}</td>
                  <td style="padding: 2px 3px;">${format(new Date(bill.billDate), "dd/MM/yy")}</td>
                  <td style="padding: 2px 3px; text-align: right; font-weight: bold; color: #dc3545;">${billDue.toFixed(2)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; padding-top: 4px; border-top: 2px solid #d39e00;">
            <span style="font-size: ${baseFontSize + 1}px; font-weight: bold; color: #856404;">TOTAL PREVIOUS DUE:</span>
            <span style="font-size: ${baseFontSize + 4}px; font-weight: bold; color: #dc3545;">AED ${totalPreviousDue.toFixed(2)}</span>
          </div>
        </div>
        `
            : ""
        }

        ${
          totalPreviousDue > 0
            ? `
        <div style="background: #dc3545; color: white; border-radius: 4px; padding: 12px; margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px; font-weight: bold;">GRAND TOTAL DUE:</span>
            <span style="font-size: 18px; font-weight: bold;">AED ${(currentOrderTotal + totalPreviousDue).toFixed(2)}</span>
          </div>
          <div style="font-size: 9px; margin-top: 4px; opacity: 0.9;">(Current: ${currentOrderTotal.toFixed(2)} + Previous: ${totalPreviousDue.toFixed(2)})</div>
        </div>
        `
            : ""
        }

        <div style="display: flex; justify-content: space-between; margin-top: 15px; padding-top: 10px; border-top: 1px dashed #ccc;">
          <div>
            <div style="font-size: 8px; color: #888;">Packing</div>
            <div style="font-size: 10px; font-weight: bold;">${order.packingDone ? "Done" : "Pending"}</div>
          </div>
          <div>
            <div style="font-size: 8px; color: #888;">Status</div>
            <div style="font-size: 10px; font-weight: bold; text-transform: uppercase;">${order.status}</div>
          </div>
          <div>
            <div style="font-size: 8px; color: #888;">Tag</div>
            <div style="font-size: 10px; font-weight: bold; color: ${order.tagDone ? "#16a34a" : "#dc2626"};">${order.tagDone ? "Done" : "Pending"}</div>
          </div>
        </div>

        <div style="text-align: center; margin-top: 15px; padding-top: 10px; border-top: 1px solid #000; color: #888; font-size: 8px;">
          <div>Thank you for choosing ${escapeHtml(companyContact.companyName)}</div>
          <div style="margin-top: 4px; font-weight: bold; color: #000; font-size: 9px;">${companyPhoneHtml}</div>
          <div style="margin-top: 3px;">Generated on ${format(new Date(), "dd MMM yyyy 'at' hh:mm a")}</div>
        </div>
      </div>
    `;

    const measureLeftColumnItemCount = () => {
      if (itemRows.length <= 1) {
        return itemRows.length;
      }

      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;left:-10000px;top:0;width:190mm;visibility:hidden;pointer-events:none;z-index:-1;background:#fff;";

      const emptyDocument = document.createElement("div");
      emptyDocument.innerHTML = renderTagDocument(renderTagItemsSection([], []));
      probe.appendChild(emptyDocument);

      const rowProbe = document.createElement("div");
      rowProbe.style.cssText = `width: calc((190mm - 8px) / 2); font-family: Arial, sans-serif; font-size: ${baseFontSize}px;`;
      rowProbe.innerHTML = renderTagItemsTable(itemRows);
      probe.appendChild(rowProbe);

      document.body.appendChild(probe);
      try {
        const cssPixelsPerMm = 96 / 25.4;
        const printableA4HeightPx = (297 - 12) * cssPixelsPerMm;
        const emptyDocumentHeight = emptyDocument.getBoundingClientRect().height;
        const availableRowsHeight = Math.max(0, printableA4HeightPx - emptyDocumentHeight - 2);
        const rowElements = Array.from(rowProbe.querySelectorAll("tbody tr"));

        let usedHeight = 0;
        let rowCount = 0;
        for (const rowElement of rowElements) {
          const rowHeight = rowElement.getBoundingClientRect().height;
          if (rowCount > 0 && usedHeight + rowHeight > availableRowsHeight) {
            break;
          }
          usedHeight += rowHeight;
          rowCount += 1;
        }

        return Math.max(1, Math.min(itemRows.length, rowCount || 1));
      } finally {
        probe.remove();
      }
    };

    const leftColumnItemCount = measureLeftColumnItemCount();
    const leftItemRows = itemRows.slice(0, leftColumnItemCount);
    const rightItemRows = itemRows.slice(leftColumnItemCount);

    const content = document.createElement("div");
    content.innerHTML = renderTagDocument(renderTagItemsSection(leftItemRows, rightItemRows));

    const opt = {
      margin: [6, 6, 6, 6] as [number, number, number, number],
      filename: `${order.orderNumber}.pdf`,
      image: { type: "jpeg" as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: {
        unit: "mm",
        format: "a4" as const,
        orientation: "portrait" as const,
      },
    };

    html2pdf().set(opt).from(content).save();
    toast({
      title: "Tag Downloaded",
      description: `Tag for ${order.orderNumber} saved`,
    });
  };

  const generateWashingReceipt = (order: Order) => {
    const client = clients?.find((c) => c.id === order.clientId);
    const isUrgent = order.urgent;

    const content = document.createElement("div");
    content.innerHTML = `
      <div style="font-family: 'Courier New', monospace; padding: 10px; width: 70mm; font-size: 11px; color: #000;">
        <div style="text-align: center; border-bottom: 2px dashed ${isUrgent ? "#dc2626" : "#000"}; padding-bottom: 8px; margin-bottom: 8px;">
          <div style="font-size: 14px; font-weight: bold; color: ${isUrgent ? "#dc2626" : "#000"};">${escapeHtml(companyContact.companyName.toUpperCase())}</div>
          <div style="font-size: 9px; margin-top: 3px;">WASHING SECTION</div>
        </div>

        ${
          isUrgent
            ? `
        <div style="text-align: center; padding: 8px; margin: 8px 0; background: #fef2f2; border: 2px solid #dc2626; font-weight: bold; color: #dc2626; font-size: 14px;">
          *** URGENT ORDER ***
        </div>
        `
            : ""
        }

        <div style="text-align: center; font-size: 18px; font-weight: bold; padding: 10px; border: 2px dashed #000; margin: 10px 0; color: ${isUrgent ? "#dc2626" : "#000"};">
          ${order.orderNumber}
        </div>

        <div style="margin: 10px 0; padding: 8px; background: #f5f5f5; border-radius: 4px;">
          <div style="margin-bottom: 5px;"><strong>Client:</strong> ${client?.name || "Walk-in"}</div>
          ${getDisplayPhone(client?.phone) ? `<div style="margin-bottom: 5px;"><strong>Phone:</strong> ${getDisplayPhone(client?.phone)}</div>` : ""}
          <div><strong>Date:</strong> ${format(new Date(order.entryDate), "dd/MM/yyyy HH:mm")}</div>
        </div>

        <div style="margin: 10px 0; border-top: 1px dashed #000; padding-top: 10px;">
          <div style="font-weight: bold; margin-bottom: 8px; font-size: 12px;">ITEMS FOR WASHING:</div>
          <div style="line-height: 1.8; font-size: 12px;">
            ${
              order.items
                ?.split(",")
                .map(
                  (item) =>
                    `<div style="padding: 3px 0; border-bottom: 1px dotted #ccc;">${item.trim()}</div>`,
                )
                .join("") || "No items"
            }
          </div>
        </div>

        ${
          order.notes
            ? `
        <div style="margin: 10px 0; padding: 8px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px;">
          <div style="font-weight: bold; font-size: 10px;">NOTES:</div>
          <div style="font-size: 11px;">${order.notes}</div>
        </div>
        `
            : ""
        }

        <div style="text-align: center; margin-top: 15px; padding-top: 10px; border-top: 2px dashed #000; font-size: 9px; color: #666;">
          <div>Printed: ${format(new Date(), "dd/MM/yyyy HH:mm")}</div>
          <div style="font-weight: bold; color: #000; font-size: 10px; margin-top: 5px;">${companyPhoneHtml}</div>
        </div>
      </div>
    `;

    const opt = {
      margin: 2,
      filename: `Washing_${order.orderNumber}.pdf`,
      image: { type: "jpeg" as const, quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: {
        unit: "mm",
        format: [80, 150] as [number, number],
        orientation: "portrait" as const,
      },
    };

    html2pdf().set(opt).from(content).save();
    toast({
      title: "Washing Receipt Downloaded",
      description: `Thermal receipt for ${order.orderNumber} saved`,
    });
  };

  useEffect(() => {
    if (newCreatedOrder && pdfReceiptRef.current) {
      const timer = setTimeout(() => {
        generatePDF();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [newCreatedOrder]);

  useEffect(() => {
    if (highlightedOrderId) {
      const timer = setTimeout(() => setHighlightedOrderId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightedOrderId]);

  const navigateToOrderTracking = (order: Order, printTag: boolean) => {
    const focusDateKey = toDateOnlyKey(order.entryDate);
    const focusDate = parseDateOnlyKey(focusDateKey);

    setActiveTab("all");
    if (focusDate) {
      setDateFilter("exact");
      setExactDate(focusDate);
      setForcedVisibleOrderId(order.id);
      setForcedVisibleDateKey(focusDateKey || null);
    } else {
      setDateFilter("today");
      setExactDate(undefined);
      setForcedVisibleOrderId(null);
      setForcedVisibleDateKey(null);
    }
    setHighlightedOrderId(order.id);
    setPendingFocusOrderId(order.id);
    if (printTag) {
      generateTagReceipt(order);
    }
    setNewCreatedOrder(null);
  };

  const verifyPinMutation = useMutation({
    mutationFn: async (pin: string) => {
      const res = await apiRequest("POST", "/api/packing/verify-pin", { pin });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success && packingPinDialog) {
        const existingOrder = orders?.find(
          (o) => o.id === packingPinDialog.orderId,
        );
        const combinedNotes = packingNotes
          ? existingOrder?.notes
            ? `${existingOrder.notes}\n[Packing: ${packingNotes}]`
            : `[Packing: ${packingNotes}]`
          : existingOrder?.notes;
        updateOrderMutation.mutate({
          id: packingPinDialog.orderId,
          updates: {
            packingDone: true,
            packingDate: new Date().toISOString(),
            packingBy: data.worker.name,
            packingWorkerId: data.worker.id,
            notes: combinedNotes,
          },
        });
        setPackingPinDialog(null);
        clearStaffPinInput(packingPinInputRef);
        clearStaffPinPreview("packing");
        setPinError("");
        setPackingNotes("");
      }
    },
    onError: () => {
      setPinError("Invalid PIN. Please try again.");
      clearStaffPinPreview("packing");
    },
  });

  const handlePackingWithPin = async (orderId: number) => {
    try {
      const res = await fetch(`/api/stage-checklists/order/${orderId}/packing`);
      if (res.ok) {
        const checklist = await res.json();
        if (!checklist || !checklist.isComplete) {
          toast({
            title: "Checklist Incomplete",
            description: "Please complete the packing checklist before entering your PIN.",
            variant: "destructive",
          });
          return;
        }
      }
    } catch (error) {
      console.error("Error checking packing checklist:", error);
    }
    setPackingPinDialog({ orderId });
    clearStaffPinInput(packingPinInputRef);
    clearStaffPinPreview("packing");
    setPinError("");
    setPackingNotes("");
  };

  const submitPackingPin = () => {
    const packingPin = readStaffPinInput(packingPinInputRef);
    if (packingPin.length !== 5) {
      setPinError("PIN must be 5 digits");
      return;
    }
    verifyPinMutation.mutate(packingPin);
  };

  const verifyDeliveryPinMutation = useMutation({
    mutationFn: async (pin: string) => {
      const res = await apiRequest("POST", "/api/delivery/verify-pin", { pin });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success && deliveryPinDialog) {
        const currentOrder = orders?.find(
          (o) => o.id === deliveryPinDialog.orderId,
        );
        const isDeliveryOrder = currentOrder?.deliveryType === "delivery";
        const doneStatus = isDeliveryOrder ? "delivered" : "picked_up";
        const items = currentOrder ? parseOrderItems(currentOrder.items) : [];
        const fullPickupStatus: Record<string, { status: string; quantity: number }> = {};
        items.forEach((item, idx) => {
          fullPickupStatus[String(idx)] = {
            status: doneStatus,
            quantity: item.quantity,
          };
        });
        updateOrderMutation.mutate(
          {
            id: deliveryPinDialog.orderId,
            updates: {
              delivered: true,
              deliveryDate: new Date().toISOString(),
              deliveryBy: data.worker.name,
              deliveredByWorkerId: data.worker.id,
              deliveryPhoto: deliveryPhotos[0] || null,
              deliveryPhotos: deliveryPhotos.length > 0 ? deliveryPhotos : null,
              deliveryAddress: deliveryAddress || null,
              itemCountVerified: itemCountVerified,
              verifiedAt: itemCountVerified ? new Date().toISOString() : null,
              verifiedByWorkerId: itemCountVerified ? data.worker.id : null,
              verifiedByWorkerName: itemCountVerified ? data.worker.name : null,
              itemPickupStatus: JSON.stringify(fullPickupStatus),
            },
          },
        );
        setDeliveryPinDialog(null);
        setDeliveryPin("");
        clearStaffPinPreview("delivery");
        setDeliveryPinError("");
        setDeliveryPhotos([]);
        setDeliveryPhotoPreviews([]);
        setDeliveryAddress("");
      }
    },
    onError: () => {
      setDeliveryPinError("Invalid PIN. Please try again.");
      clearStaffPinPreview("delivery");
    },
  });

  const handleUndoDelivery = async () => {
    if (!undoDeliveryDialog) return;
    if (undoDeliveryPin.length !== 5) {
      setUndoDeliveryPinError("PIN must be 5 digits");
      return;
    }
    try {
      const res = await apiRequest("POST", "/api/staff-members/verify-pin", { pin: undoDeliveryPin });
      const data = await res.json();
      if (!data.success) {
        setUndoDeliveryPinError("Invalid PIN");
        return;
      }
      if (data.member.roleType !== "admin") {
        setUndoDeliveryPinError("Only admin can undo delivery");
        return;
      }
      updateOrderMutation.mutate({
        id: undoDeliveryDialog.id,
        updates: {
          delivered: false,
          deliveryDate: null,
          deliveryBy: null,
          deliveredByWorkerId: null,
          deliveryPhoto: null,
          deliveryPhotos: null,
          itemPickupStatus: "{}",
          itemCountVerified: false,
          verifiedAt: null,
          verifiedByWorkerId: null,
          verifiedByWorkerName: null,
        },
      });
      toast({ title: "Delivery Undone", description: `Delivery status reversed by ${data.member.name}` });
      setUndoDeliveryDialog(null);
      setUndoDeliveryPin("");
      setUndoDeliveryPinError("");
    } catch {
      setUndoDeliveryPinError("Failed to verify PIN");
    }
  };

  const handleDeliveryPhotoChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      if (deliveryPhotos.length >= 1) {
        toast({
          title: "Maximum Photos",
          description: "You can only upload 1 photo",
          variant: "destructive",
        });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "Error",
          description: "Photo must be less than 5MB",
          variant: "destructive",
        });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setDeliveryPhotos((prev) => [...prev, base64]);
        setDeliveryPhotoPreviews((prev) => [...prev, base64]);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  };

  const removeDeliveryPhoto = (index: number) => {
    setDeliveryPhotos((prev) => prev.filter((_, i) => i !== index));
    setDeliveryPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const clearDeliveryPhotos = () => {
    setDeliveryPhotos([]);
    setDeliveryPhotoPreviews([]);
  };

  const handleDeliveryWithPin = (orderId: number) => {
    const order = orders?.find(o => o.id === orderId);
    const client = order?.clientId ? clients?.find(c => c.id === order.clientId) : null;
    setDeliveryPinDialog({ orderId });
    setDeliveryPin("");
    clearStaffPinPreview("delivery");
    setDeliveryPinError("");
    setItemCountVerified(false);
    setDeliveryAddress(order ? getOrderDisplayAddress(order, client || undefined) : "");
  };

  const submitDeliveryPin = () => {
    if (deliveryPin.length !== 5) {
      setDeliveryPinError("PIN must be 5 digits");
      return;
    }
    verifyDeliveryPinMutation.mutate(deliveryPin);
  };

  const invalidateOrderBillPaymentQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-count"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-selection"] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    queryClient.invalidateQueries({ queryKey: ["/api/bill-payments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/reports/credit-transactions"] });
  }, []);

  // Payment mutation for bill dialog
  const recordPaymentMutation = useMutation({
    mutationFn: async ({ billId, amount, method, staffName }: { billId: number; amount: number; method: string; staffName: string }) => {
      const response = await apiRequest("POST", `/api/bills/${billId}/pay`, {
        amount: amount.toFixed(2),
        paymentMethod: method,
        notes: `Recorded by ${staffName} via Orders`,
        processedBy: staffName,
      });
      return response.json();
    },
    onSuccess: () => {
      invalidateOrderBillPaymentQueries();
      toast({
        title: "Payment Recorded",
        description: "The payment has been successfully recorded.",
      });
      resetOrderBillPaymentState();
      setShowBillDialog(false);
    },
    onError: (error: any) => {
      toast({
        title: "Payment Failed",
        description: error.message || "Failed to record payment",
        variant: "destructive",
      });
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

  const resetOrderTransferBillDialog = useCallback(() => {
    setOrderTransferBillDialog(null);
    setOrderTransferTargetClientId("");
    setOrderTransferBillSearch("");
    setOrderTransferBillAdminPin("");
    setOrderTransferBillReason("");
  }, []);

  const openOrderTransferBillDialog = useCallback((bill: BillWithPaymentRecorder) => {
    setOrderTransferBillDialog(bill);
    setOrderTransferTargetClientId("");
    setOrderTransferBillSearch("");
    setOrderTransferBillAdminPin("");
    setOrderTransferBillReason("");
  }, []);

  const transferOrderBillMutation = useMutation({
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
      const updatedBill = data?.bill as BillWithPaymentRecorder | undefined;
      if (updatedBill) {
        queryClient.setQueryData<BillWithPaymentRecorder[] | undefined>(
          ["/api/bills"],
          (existingBills) =>
            existingBills?.map((bill) =>
              bill.id === updatedBill.id ? { ...bill, ...updatedBill } : bill,
            ),
        );
        setSelectedBill(updatedBill);
      }

      invalidateOrderBillPaymentQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/client-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-sales"] });
      resetOrderTransferBillDialog();
      toast({
        title: "Bill Transferred",
        description: data?.message || "The bill was transferred to the selected client account.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Transfer Failed",
        description: extractApiErrorMessage(error, "Failed to transfer the bill to another client account."),
        variant: "destructive",
      });
    },
  });

  const handleOrderTransferBillSubmit = async () => {
    if (!orderTransferBillDialog) return;

    const targetClientId = Number(orderTransferTargetClientId);
    if (!Number.isFinite(targetClientId) || targetClientId <= 0) {
      toast({
        title: "Select Client",
        description: "Choose the client account that should receive this bill.",
        variant: "destructive",
      });
      return;
    }

    if (orderTransferBillAdminPin.trim().length !== 5) {
      toast({
        title: "Admin PIN Required",
        description: "Enter the 5-digit admin PIN to confirm the transfer.",
        variant: "destructive",
      });
      return;
    }

    await transferOrderBillMutation.mutateAsync({
      billId: orderTransferBillDialog.id,
      targetClientId,
      adminPin: orderTransferBillAdminPin.trim(),
      reason: orderTransferBillReason.trim() || undefined,
      processedBy: localStorage.getItem("username") || undefined,
    });
  };

  const updateOrderDiscountMutation = useMutation({
    mutationFn: async (data: {
      billId: number;
      discountAmount: string;
      staffPin: string;
      appliedBy?: string;
    }) => {
      const response = await apiRequest("POST", `/api/bills/${data.billId}/apply-discount`, {
        discountAmount: data.discountAmount,
        staffPin: data.staffPin,
        appliedBy: data.appliedBy || localStorage.getItem("username") || undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      invalidateOrderBillPaymentQueries();
      toast({
        title: "Discount Updated",
        description: "Discount and final amount were recalculated.",
      });
      setEditingDiscountOrderId(null);
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

  const openBillPaymentRevertDialog = useCallback((billId?: number | null) => {
    if (!billId) return;
    setBillRevertTargetId(billId);
    setBillRevertPin("");
    setBillRevertError("");
    setBillRevertDialogOpen(true);
  }, []);

  const handleBillPaymentRevertConfirm = async () => {
    if (!/^\d{5}$/.test(billRevertPin.trim())) {
      setBillRevertError("Please enter the 5-digit admin PIN");
      return;
    }
    if (!billRevertTargetId) return;

    setEditOrderRevertingPayment(true);
    setBillRevertError("");

    try {
      const currentUser = localStorage.getItem("username") || "";
      const res = await apiRequest("POST", `/api/bills/${billRevertTargetId}/revert-payment`, {
        adminPin: billRevertPin,
        revertedBy: currentUser,
      });

      if (!res.ok) {
        const data = await res.json();
        setBillRevertError(data.message || "Failed to revert payment");
        return;
      }

      invalidateOrderBillPaymentQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/sales-data"] });

      toast({
        title: "Payment Reverted",
        description: `Bill #${billRevertTargetId} has been reverted to unpaid.`,
      });

      setBillRevertDialogOpen(false);
      setBillRevertTargetId(null);
      setBillRevertPin("");
      setBillRevertError("");
      resetOrderBillPaymentState();
    } catch {
      setBillRevertError("Failed to revert payment");
    } finally {
      setEditOrderRevertingPayment(false);
    }
  };

  const handleRecordPayment = async () => {
    if (!currentSelectedBill) return;
    if (!selectedBillDisplayAmounts || currentSelectedBill.isPaid || selectedBillDisplayAmounts.due <= 0.009) {
      resetOrderBillPaymentState();
      toast({
        title: "Already Paid",
        description: `Bill #${currentSelectedBill.id} has already been paid.`,
      });
      return;
    }
    if (paymentPin.length !== 5) {
      setPaymentPinError("PIN must be 5 digits");
      return;
    }
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Invalid Amount", description: "Please enter a valid payment amount", variant: "destructive" });
      return;
    }

    const requestedDiscount = applyDiscount ? parseFloat(discountAmount || "0") : 0;
    if (
      Number.isFinite(requestedDiscount) &&
      requestedDiscount > selectedBillDisplayAmounts.originalAmount + 0.009
    ) {
      toast({
        title: "Invalid Discount",
        description: `Discount cannot exceed bill amount (${selectedBillDisplayAmounts.originalAmount.toFixed(2)} AED).`,
        variant: "destructive",
      });
      return;
    }

    if (!payAllBills && paymentMethod === "deposit" && amount > selectedBillClientDeposit + 0.009) {
      toast({
        title: "Credit Not Enough",
        description: `Available credit is ${selectedBillClientDeposit.toFixed(2)} AED. Add another payment method or reduce the credit amount.`,
        variant: "destructive",
      });
      return;
    }
    if (!payAllBills && splitPaymentEnabled) {
      if (!Number.isFinite(normalizedSplitPaymentAmount) || normalizedSplitPaymentAmount <= 0) {
        toast({
          title: "Invalid Split Amount",
          description: `Enter a valid amount for ${formatOrderSplitPaymentMethodLabel(paymentMethod)}.`,
          variant: "destructive",
        });
        return;
      }

      if (normalizedSplitPaymentAmount >= amount - 0.009) {
        toast({
          title: "Second Payment Needed",
          description: "Enter a smaller first payment amount so the second payment method can cover the remaining balance.",
          variant: "destructive",
        });
        return;
      }

      if (paymentMethod === "deposit" && normalizedSplitPaymentAmount > selectedBillClientDeposit + 0.009) {
        toast({
          title: "Credit Not Enough",
          description: `Available credit is ${selectedBillClientDeposit.toFixed(2)} AED. Reduce the credit amount or choose another split.`,
          variant: "destructive",
        });
        return;
      }

      if (remainingPaymentMethod === "deposit" && splitRemainingAmount > selectedBillClientDeposit + 0.009) {
        toast({
          title: "Credit Not Enough",
          description: `Remaining credit available is ${selectedBillClientDeposit.toFixed(2)} AED. Reduce the remaining credit amount or choose another method.`,
          variant: "destructive",
        });
        return;
      }
    }

    try {
      const res = await apiRequest("POST", "/api/staff-members/verify-pin", { pin: paymentPin });
      const data = await res.json();
      if (data.success) {
        const memberRole = data.member?.roleType || data.member?.role;
        if (
          applyDiscount &&
          discountAmount &&
          parseFloat(discountAmount) > 0 &&
          !isAdminOrCounterRole(memberRole)
        ) {
          setPaymentPinError("Discounts can only be applied with an admin or counter PIN");
          return;
        }

        if (applyDiscount && discountAmount && parseFloat(discountAmount) > 0) {
          await apiRequest("POST", `/api/bills/${currentSelectedBill.id}/apply-discount`, {
            discountAmount: discountAmount,
            appliedBy: data.member.name,
            staffPin: paymentPin,
          });
        }

        if (payAllBills) {
          const otherUnpaidBills = bills?.filter(
            (b) => b.clientId === currentSelectedBill.clientId &&
                   b.id !== currentSelectedBill.id &&
                   !b.isPaid
          ) || [];
          const allBillsToPay = [currentSelectedBill, ...otherUnpaidBills];
          for (const bill of allBillsToPay) {
            const billDisplayAmounts = getBillDisplayAmounts(bill);
            let billAmt = billDisplayAmounts.finalAmount;
            if (applyDiscount && bill.id === currentSelectedBill.id && discountAmount && parseFloat(discountAmount) > 0) {
              const origAmt = billDisplayAmounts.originalAmount;
              billAmt = origAmt - parseFloat(discountAmount);
            }
            const billDue = billAmt - billDisplayAmounts.paidAmount;
            if (billDue > 0) {
              await apiRequest("POST", `/api/bills/${bill.id}/pay`, {
                amount: billDue.toFixed(2),
                paymentMethod: paymentMethod,
                notes: `Recorded by ${data.member.name} via Orders (batch payment)`,
                processedBy: data.member.name,
              });
            }
          }
          invalidateOrderBillPaymentQueries();
          toast({
            title: "Payment Recorded",
            description: `${allBillsToPay.length} bill(s) have been paid successfully.`,
          });
          resetOrderBillPaymentState();
          setShowBillDialog(false);
        } else if (splitPaymentEnabled) {
          const splitParts = [
            {
              amount: normalizedSplitPaymentAmount,
              paymentMethod,
              label: formatOrderSplitPaymentMethodLabel(paymentMethod),
            },
            {
              amount: splitRemainingAmount,
              paymentMethod: remainingPaymentMethod,
              label: formatOrderSplitPaymentMethodLabel(remainingPaymentMethod),
            },
          ];
          const splitGroupId = buildOrderSplitPaymentGroupId();
          const splitTaggedNotes = appendOrderSplitPaymentTag(
            `Recorded by ${data.member.name} via Orders`,
            splitGroupId,
          );

          setIsSplitPaymentSubmitting(true);
          try {
            for (const part of splitParts) {
              await apiRequest("POST", `/api/bills/${currentSelectedBill.id}/pay`, {
                amount: part.amount.toFixed(2),
                paymentMethod: part.paymentMethod,
                notes: splitTaggedNotes,
                processedBy: data.member.name,
              });
            }

            invalidateOrderBillPaymentQueries();
            toast({
              title: "Payment Recorded",
              description: `Paid ${splitParts[0].amount.toFixed(2)} AED with ${splitParts[0].label} and ${splitParts[1].amount.toFixed(2)} AED with ${splitParts[1].label}.`,
            });
            resetOrderBillPaymentState();
            setShowBillDialog(false);
          } catch (error: any) {
            toast({
              title: "Payment Failed",
              description: extractApiErrorMessage(error, "Failed to process split payment."),
              variant: "destructive",
            });
          } finally {
            setIsSplitPaymentSubmitting(false);
          }
        } else {
          recordPaymentMutation.mutate({
            billId: currentSelectedBill.id,
            amount,
            method: paymentMethod,
            staffName: data.member.name,
          });
        }
      } else {
        setPaymentPinError("Invalid PIN");
      }
    } catch (error: any) {
      const message = extractApiErrorMessage(error, "Invalid PIN");
      if (/pin/i.test(message)) {
        setPaymentPinError(message);
      } else {
        toast({
          title: "Payment Failed",
          description: message,
          variant: "destructive",
        });
      }
    }
  };

  const handleDeleteOrder = (orderId: number) => {
    setPendingDeleteOrderId(orderId);
    setDeleteOrderAdminPassword("");
    setDeleteOrderAdminError("");
    setDeleteOrderConfirmDialog(true);
  };

  const handleConfirmDeleteOrder = async () => {
    if (!deleteOrderAdminPassword.trim()) {
      setDeleteOrderAdminError("Please enter admin PIN");
      return;
    }
    try {
      if (pendingDeleteOrderId !== null) {
        await apiRequest("POST", `/api/orders/${pendingDeleteOrderId}/delete`, {
          adminPin: deleteOrderAdminPassword,
        }, {
          headers: {
            "X-Admin-Pin": deleteOrderAdminPassword,
          },
        });
        toast({
          title: "Order Deleted",
          description: "The order and its linked bill have been removed.",
        });
        setDeleteOrderDialog(false);
        setPendingDeleteOrderId(null);
        setDeleteOrderAdminPassword("");
        setDeleteOrderAdminError("");
        window.location.reload();
      }
    } catch {
      setDeleteOrderAdminError("Invalid admin PIN");
    }
  };

  const [pendingTagWorkerName, setPendingTagWorkerName] = useState<
    string | null
  >(null);

  const verifyTagPinMutation = useMutation({
    mutationFn: async (pin: string) => {
      const res = await apiRequest("POST", "/api/delivery/verify-pin", { pin });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success && tagPinDialog) {
        const currentOrderId = tagPinDialog.orderId;
        setPendingTagWorkerName(data.worker.name);

        // Find next order BEFORE updating current one
        const pendingTagOrders =
          orders?.filter((o) => !o.tagDone && o.id !== currentOrderId) || [];
        const nextOrder =
          pendingTagOrders.length > 0 ? pendingTagOrders[0] : null;

        // Close dialog immediately
        setTagPinDialog(null);
        clearStaffPinInput(tagPinInputRef);
        clearStaffPinPreview("tag");
        setTagPinError("");

        updateOrderMutation.mutate(
          {
            id: currentOrderId,
            updates: {
              tagDone: true,
              tagDate: new Date().toISOString(),
              tagBy: data.worker.name,
              tagWorkerId: data.worker.id,
            },
          },
          {
            onSuccess: () => {
              toast({
                title: "Tag Complete",
                description: `Order tagged successfully by ${data.worker.name}`,
              });
            },
          },
        );
      }
    },
    onError: () => {
      setTagPinError("Invalid PIN. Please try again.");
      clearStaffPinPreview("tag");
    },
  });

  const handleTagWithPin = async (orderId: number) => {
    try {
      const res = await fetch(`/api/stage-checklists/order/${orderId}/tagging`);
      if (res.ok) {
        const checklist = await res.json();
        if (!checklist || !checklist.isComplete) {
          toast({
            title: "Checklist Incomplete",
            description: "Please complete the tagging checklist before entering your PIN.",
            variant: "destructive",
          });
          return;
        }
      }
    } catch (error) {
      console.error("Error checking tagging checklist:", error);
    }
    setTagPinDialog({ orderId });
    clearStaffPinInput(tagPinInputRef);
    clearStaffPinPreview("tag");
    setTagPinError("");
  };

  const submitTagPin = () => {
    const tagPin = readStaffPinInput(tagPinInputRef);
    if (tagPin.length !== 5) {
      setTagPinError("PIN must be 5 digits");
      return;
    }
    verifyTagPinMutation.mutate(tagPin);
  };

  const triggerStageChecklistContinue = useCallback(() => {
    if (!stageChecklistDialog || !stageChecklistReadyToContinue) return;

    const orderId = stageChecklistDialog.order.id;
    const stage = stageChecklistDialog.stage;
    setStageChecklistDialog(null);

    if (stage === "tagging") {
      void handleTagWithPin(orderId);
      return;
    }

    if (stage === "packing") {
      void handlePackingWithPin(orderId);
    }
  }, [handlePackingWithPin, handleTagWithPin, stageChecklistDialog, stageChecklistReadyToContinue]);

  const createIncidentMutation = useMutation({
    mutationFn: async (data: {
      customerName: string;
      customerPhone?: string;
      orderId: number;
      orderNumber: string;
      itemName: string;
      reason: string;
      notes?: string;
      responsibleStaffId?: number;
      responsibleStaffName?: string;
      reporterName?: string;
      incidentType: string;
      incidentDate: string;
    }) => {
      const res = await apiRequest("POST", "/api/incidents", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      toast({
        title: "Incident Reported",
        description: "The incident has been recorded successfully.",
      });
      resetIncidentForm();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to report incident",
        variant: "destructive",
      });
    },
  });

  const resetIncidentForm = () => {
    setIncidentReportOrder(null);
    setIncidentType("missing_item");
    setIncidentItems([]);
    setIncidentReason("");
    setIncidentNotes("");
    setReporterName("");
  };

  const handleEditItems = (order: Order) => {
    const parsedItems = parseOrderItems(order.items);
    const names: Record<string, string> = {};
    const quantities: Record<string, number> = {};
    const packaging: Record<string, "folding" | "hanger"> = {};
    const unitPrices: Record<string, number> = {};
    const baseUnitPrices: Record<string, number> = {};
    parsedItems.forEach((item, index) => {
      const lineKey = `line-${index}`;
      const normalizedName = stripEmbeddedItemPriceText(item.name);
      names[lineKey] = normalizedName;
      quantities[lineKey] = item.quantity;
      const embeddedUnitPrice = getEmbeddedUnitPrice(item.name);
      const embeddedBaseUnitPrice = getEmbeddedBaseUnitPrice(item.name);
      const fallbackBaseUnitPrice = embeddedBaseUnitPrice ?? (
        !/\*URG\*/i.test(normalizedName) && order.urgent !== true
          ? embeddedUnitPrice ?? getItemPrice(normalizedName, order.deliveryType, false)
          : getItemPrice(
              normalizedName.replace(/\s*\*URG\*\s*/gi, " ").replace(/\s{2,}/g, " ").trim(),
              order.deliveryType,
              false,
            )
      );
      unitPrices[lineKey] = embeddedUnitPrice ?? getItemPrice(
        normalizedName,
        order.deliveryType,
        order.urgent === true,
      );
      baseUnitPrices[lineKey] = fallbackBaseUnitPrice;
      if (/\(hanger\)/i.test(normalizedName)) {
        packaging[lineKey] = "hanger";
      } else {
        packaging[lineKey] = "folding";
      }
    });
    setEditItemsNames(names);
    setEditItemsQuantities(quantities);
    setEditItemsPackaging(packaging);
    setEditItemsUnitPrices(unitPrices);
    setEditItemsBaseUnitPrices(baseUnitPrices);
    setEditItemsDialog(order);
    setEditItemsPin("");
    setEditItemsPinError("");
  };

  const handleUpdateItemQuantity = (lineKey: string, delta: number) => {
    setEditItemsQuantities((prev) => {
      const newQty = Math.max(0, (prev[lineKey] || 0) + delta);
      if (newQty === 0) {
        const { [lineKey]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [lineKey]: newQty };
    });
  };

  const handleTogglePackaging = (lineKey: string) => {
    const itemName = editItemsNames[lineKey] || "";
    const currentPkg = editItemsPackaging[lineKey] || "folding";
    const newPkg = currentPkg === "folding" ? "hanger" : "folding";
    const baseName = itemName
      .replace(/\s*\(folding\)\s*/gi, '')
      .replace(/\s*\(hanger\)\s*/gi, '')
      .replace(/\s*\(hanging\)\s*/gi, '')
      .trim();
    const newName = `${baseName} (${newPkg})`;
    setEditItemsNames((prev) => ({ ...prev, [lineKey]: newName }));
    setEditItemsPackaging((prev) => ({ ...prev, [lineKey]: newPkg }));
  };

  const getEditItemNonUrgentServicePrice = (itemName: string) => {
    const nonUrgentName = String(itemName || "")
      .replace(/\s*\*URG\*\s*/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return getItemPrice(nonUrgentName, editItemsDialog?.deliveryType, false);
  };

  const rebuildEditItemNameWithService = (
    itemName: string,
    serviceTag: "N" | "DC" | "IO",
    packingType: "folding" | "hanger" = "folding",
  ) => {
    const shouldKeepUrgTag = itemName.includes("*URG*") || editItemsDialog?.urgent === true;
    const packingSuffix = packingType === "hanger" ? " (hanger)" : " (folding)";
    const baseName = itemName
      .replace(/\s*\*URG\*\s*/g, "")
      .replace(/\s*\[(?:N|DC|D|IO|I)\]\s*/g, "")
      .replace(/\s*\((folding|hanger|hanging)\)\s*/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    return `${baseName} [${serviceTag}]${shouldKeepUrgTag ? " *URG*" : ""}${packingSuffix}`;
  };

  const resolveEditItemUnitPrice = (lineKey: string) => {
    const snapshotPrice = editItemsUnitPrices[lineKey];
    if (Number.isFinite(snapshotPrice)) {
      return snapshotPrice;
    }
    return getItemPrice(
      editItemsNames[lineKey] || "",
      editItemsDialog?.deliveryType,
      editItemsDialog?.urgent === true,
    );
  };

  const resolveEditItemBaseUnitPrice = (lineKey: string) => {
    const snapshotPrice = editItemsBaseUnitPrices[lineKey];
    if (Number.isFinite(snapshotPrice)) {
      return snapshotPrice;
    }
    return getEditItemNonUrgentServicePrice(editItemsNames[lineKey] || "");
  };

  const submitOrderDiscountEdit = async (order: Order) => {
    if (!order.billId) return;

    const orderBill = bills?.find((b) => b.id === order.billId);
    if (!orderBill) {
      setEditingDiscountOrderId(null);
      setEditingDiscountValue("");
      return;
    }

    if (orderBill.isPaid) {
      toast({
        title: "Discount Locked",
        description: "Cannot edit discount for paid bills.",
        variant: "destructive",
      });
      setEditingDiscountOrderId(null);
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

    const billOriginalAmount = getBillDisplayAmounts(orderBill).originalAmount;
    if (nextDiscount > billOriginalAmount + 0.009) {
      toast({
        title: "Invalid Discount",
        description: `Discount cannot exceed bill amount (${billOriginalAmount.toFixed(2)} AED).`,
        variant: "destructive",
      });
      return;
    }

    const currentDiscount = parseFloat(orderBill.discountAmount || "0");
    if (Math.abs(currentDiscount - nextDiscount) < 0.009) {
      setEditingDiscountOrderId(null);
      setEditingDiscountValue("");
      setEditingDiscountStaffPin("");
      setEditingDiscountAppliedBy("");
      return;
    }

    if (!editingDiscountStaffPin) {
      setDiscountPinDialogOrder(order);
      setDiscountPin("");
      setDiscountPinError("Enter admin or counter PIN to update the discount.");
      return;
    }

    await updateOrderDiscountMutation.mutateAsync({
      billId: order.billId,
      discountAmount: nextDiscount.toFixed(2),
      staffPin: editingDiscountStaffPin,
      appliedBy: editingDiscountAppliedBy || undefined,
    });
  };

  const cancelOrderDiscountEdit = () => {
    setEditingDiscountOrderId(null);
    setEditingDiscountValue("");
    setEditingDiscountStaffPin("");
    setEditingDiscountAppliedBy("");
  };

  const openOrderDiscountEdit = (order: Order) => {
    const orderBill = bills?.find((b) => b.id === order.billId);
    if (!order.billId || orderBill?.isPaid) {
      return;
    }
    if (editingDiscountOrderId === order.id) return;
    pendingOrderDiscountFocusIdRef.current = null;
    setDiscountPinDialogOrder(order);
    setDiscountPin("");
    setDiscountPinError("");
    clearStaffPinPreview("discount");
  };

  const verifyOrderDiscountPin = async () => {
    const targetOrder = discountPinDialogOrder;
    const normalizedPin = discountPin.replace(/\D/g, "").slice(0, 5);
    if (!targetOrder) return;
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
      const orderBill = bills?.find((b) => b.id === targetOrder.billId);
      pendingOrderDiscountFocusIdRef.current = targetOrder.id;
      setEditingDiscountOrderId(targetOrder.id);
      setEditingDiscountValue(parseFloat(orderBill?.discountAmount || "0").toFixed(2));
      setEditingDiscountStaffPin(normalizedPin);
      setEditingDiscountAppliedBy(data.member?.name || "");
      setDiscountPinDialogOrder(null);
      setDiscountPin("");
      clearStaffPinPreview("discount");
    } catch (error: any) {
      setDiscountPinError(extractApiErrorMessage(error, "Invalid admin or counter PIN."));
    } finally {
      setIsDiscountPinVerifying(false);
    }
  };

  const submitAdjustPrice = async () => {
    if (!adjustPriceDialog) return;
    const orderBillCheck = bills?.find(b => b.id === adjustPriceDialog.billId);
    if (adjustPriceDialog.status === "delivered" || adjustPriceDialog.status === "picked_up" || orderBillCheck?.isPaid) {
      setAdjustPricePinError("Cannot adjust price for delivered orders or paid bills");
      return;
    }
    if (adjustPricePin.length !== 5) {
      setAdjustPricePinError("PIN must be 5 digits");
      return;
    }
    if (!adjustPriceValue || parseFloat(adjustPriceValue) < 0) {
      setAdjustPricePinError("Please enter a valid work received amount");
      return;
    }
    if (!adjustPriceReason.trim()) {
      setAdjustPricePinError("Please enter a reason for the price change");
      return;
    }

    setIsAdjustingPrice(true);
    try {
      const res = await fetch(`/api/orders/${adjustPriceDialog.id}/adjust-total`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjustedTotal: adjustPriceValue,
          reason: adjustPriceReason.trim(),
          staffPin: adjustPricePin,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setAdjustPricePinError(data.message || "Failed to adjust price");
        return;
      }

      toast({
        title: "Work Received Updated",
        description: (() => {
          const workReceived = parseFloat(adjustPriceValue);
          const discount = getOrderDiscountAmount(adjustPriceDialog);
          const finalAmount =
            Math.max(0, workReceived - discount) + getOrderExtraCharges(adjustPriceDialog);
          return `Work received set to AED ${workReceived.toFixed(2)}. Final amount is AED ${finalAmount.toFixed(2)}.`;
        })(),
      });
      setAdjustPriceDialog(null);
      setAdjustPriceValue("");
      setAdjustPriceReason("");
      setAdjustPricePin("");
      setAdjustPricePinError("");
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    } catch (err) {
      setAdjustPricePinError("Failed to adjust price");
    } finally {
      setIsAdjustingPrice(false);
    }
  };

  const submitEditItems = async () => {
    if (!editItemsDialog) return;
    if (editItemsPin.length !== 5) {
      setEditItemsPinError("PIN must be 5 digits");
      return;
    }

    const items = Object.entries(editItemsQuantities)
      .filter(([_, qty]) => qty > 0)
      .map(([lineKey, quantity]) => ({
        name: editItemsNames[lineKey] || "",
        quantity,
        unitPrice: resolveEditItemUnitPrice(lineKey),
        baseUnitPrice: resolveEditItemBaseUnitPrice(lineKey),
      }))
      .filter((item) => item.name)
      .reduce<Array<{
        name: string;
        quantity: number;
        unitPrice: number;
        baseUnitPrice: number;
      }>>((mergedItems, item) => {
        const mergeTargetIndex = mergedItems.findIndex(
          (candidate) =>
            candidate.name === item.name &&
            Math.abs(candidate.unitPrice - item.unitPrice) < 0.009 &&
            Math.abs(candidate.baseUnitPrice - item.baseUnitPrice) < 0.009,
        );

        if (mergeTargetIndex === -1) {
          mergedItems.push(item);
          return mergedItems;
        }

        mergedItems[mergeTargetIndex] = {
          ...mergedItems[mergeTargetIndex],
          quantity: mergedItems[mergeTargetIndex].quantity + item.quantity,
        };
        return mergedItems;
      }, []);

    if (items.length === 0) {
      setEditItemsPinError("Order must have at least one item");
      return;
    }

    setIsEditingItems(true);
    try {
      const res = await fetch(`/api/orders/${editItemsDialog.id}/update-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, staffPin: editItemsPin }),
      });

      if (!res.ok) {
        const data = await res.json();
        setEditItemsPinError(data.message || "Failed to update items");
        return;
      }

      const data = await res.json();
      toast({
        title: "Items Updated",
        description: data.message || `Order items updated by ${data.updatedBy}. Bill has been recalculated.`,
      });
      setEditItemsDialog(null);
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    } catch (err) {
      setEditItemsPinError("Failed to update items");
    } finally {
      setIsEditingItems(false);
    }
  };

  const getEditOrderBaseUnitPrice = (item: { name: string; price: number; baseUnitPrice?: number }) => {
    if (Number.isFinite(item.baseUnitPrice)) {
      return Number(item.baseUnitPrice);
    }
    const sqmBaseUnitPrice = getSqmBaseUnitPriceFromCurrentPrice(item.name, item.price, products);
    if (Number.isFinite(sqmBaseUnitPrice)) {
      return Number(sqmBaseUnitPrice);
    }
    const embeddedBaseUnitPrice = getEmbeddedBaseUnitPrice(item.name);
    if (Number.isFinite(embeddedBaseUnitPrice)) {
      return Number(embeddedBaseUnitPrice);
    }
    if (!/\*URG\*/i.test(item.name)) {
      return Number(item.price || 0);
    }
    return getItemPrice(
      String(item.name || "").replace(/\s*\*URG\*\s*/gi, " ").replace(/\s{2,}/g, " ").trim(),
      orderDetailDialog?.deliveryType,
      false,
    );
  };

  const rebuildEditOrderPackingName = (
    itemName: string,
    packingType: "folding" | "hanger",
  ) => {
    const baseName = String(itemName || "")
      .replace(/\s*\((?:folding|hanger|hanging)\)\s*/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return `${baseName} (${packingType})`;
  };

  const rebuildEditOrderUrgencyName = (itemName: string, urgent: boolean) => {
    const normalizedName = String(itemName || "")
      .replace(/\s*\*URG\*\s*/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!urgent) {
      return normalizedName;
    }

    const tagIndex = normalizedName.indexOf("[");
    if (tagIndex > 0) {
      return `${normalizedName.slice(0, tagIndex).trim()} *URG* ${normalizedName.slice(tagIndex).trim()}`.replace(/\s{2,}/g, " ").trim();
    }

    return `${normalizedName} *URG*`.replace(/\s{2,}/g, " ").trim();
  };

  const rebuildEditOrderServiceName = (
    itemName: string,
    serviceType: StoredOrderItemServiceType,
  ) => {
    const serviceTag = serviceType === "dc" ? "[DC]" : serviceType === "iron_only" ? "[IO]" : "[N]";
    const normalizedName = String(itemName || "")
      .replace(/\s*\[(?:N|DC|D|IO|I)\]\s*/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    const packingMatch = normalizedName.match(/\((?:folding|hanger|hanging)\)\s*$/i);

    if (packingMatch && packingMatch.index !== undefined) {
      const packingSuffix = packingMatch[0].trim();
      const baseName = normalizedName.slice(0, packingMatch.index).trim();
      return `${baseName} ${serviceTag} ${packingSuffix}`.replace(/\s{2,}/g, " ").trim();
    }

    return `${normalizedName} ${serviceTag}`.replace(/\s{2,}/g, " ").trim();
  };

  const transformEditOrderItemService = (
    item: { name: string; quantity: number; price: number; baseUnitPrice?: number },
    serviceType: StoredOrderItemServiceType,
  ) => {
    if (parseSqmDescriptionPart(item.name, products)) {
      return item;
    }
    const currentBaseUnitPrice = getEditOrderBaseUnitPrice(item);
    const currentNonUrgentName = rebuildEditOrderUrgencyName(item.name, false);
    const currentCatalogBasePrice = getItemPrice(
      currentNonUrgentName,
      orderDetailDialog?.deliveryType,
      false,
    );
    const nextName = rebuildEditOrderServiceName(item.name, serviceType);
    const nextNonUrgentName = rebuildEditOrderUrgencyName(nextName, false);
    const nextCatalogBasePrice = getItemPrice(
      nextNonUrgentName,
      orderDetailDialog?.deliveryType,
      false,
    );
    const adjustmentRatio =
      Number.isFinite(currentCatalogBasePrice) && currentCatalogBasePrice > 0
        ? currentBaseUnitPrice / currentCatalogBasePrice
        : 1;
    const nextBaseUnitPrice =
      Number.isFinite(nextCatalogBasePrice) && nextCatalogBasePrice > 0
        ? nextCatalogBasePrice * adjustmentRatio
        : currentBaseUnitPrice;

    return {
      ...item,
      name: nextName,
      price: getEditOrderItemUnitPriceFromBase(nextName, nextBaseUnitPrice),
      baseUnitPrice: nextBaseUnitPrice,
    };
  };

  const getEditOrderItemUnitPriceFromBase = (
    itemName: string,
    baseUnitPrice: number,
  ) => {
    const sqmItem = parseSqmDescriptionPart(itemName, products);
    if (sqmItem) {
      const safeBaseUnitPrice = Number.isFinite(baseUnitPrice) ? baseUnitPrice : sqmItem.price;
      return /\*URG\*/i.test(itemName) ? safeBaseUnitPrice * 2 : safeBaseUnitPrice;
    }
    const normalizedNonUrgentName = String(itemName || "")
      .replace(/\s*\*URG\*\s*/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    const catalogBasePrice = getItemPrice(
      normalizedNonUrgentName,
      orderDetailDialog?.deliveryType,
      false,
    );
    const safeBaseUnitPrice = Number.isFinite(baseUnitPrice) ? baseUnitPrice : catalogBasePrice;
    const isUrgent = /\*URG\*/i.test(itemName);

    if (!isUrgent) {
      return safeBaseUnitPrice;
    }

    const catalogUrgentPrice = getItemPrice(
      itemName,
      orderDetailDialog?.deliveryType,
      true,
    );

    if (
      Number.isFinite(catalogBasePrice) &&
      catalogBasePrice > 0 &&
      Number.isFinite(catalogUrgentPrice) &&
      catalogUrgentPrice > 0
    ) {
      return safeBaseUnitPrice * (catalogUrgentPrice / catalogBasePrice);
    }

    return safeBaseUnitPrice * 2;
  };

  const getEditOrderBaseUnitPriceFromCurrentUnitPrice = (
    itemName: string,
    currentUnitPrice: number,
  ) => {
    const sqmBaseUnitPrice = getSqmBaseUnitPriceFromCurrentPrice(itemName, currentUnitPrice, products);
    if (Number.isFinite(sqmBaseUnitPrice)) {
      return Number(sqmBaseUnitPrice);
    }
    const safeCurrentUnitPrice = Number.isFinite(currentUnitPrice) ? currentUnitPrice : 0;
    const isUrgent = /\*URG\*/i.test(itemName);
    if (!isUrgent) {
      return safeCurrentUnitPrice;
    }

    const normalizedNonUrgentName = String(itemName || "")
      .replace(/\s*\*URG\*\s*/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    const catalogBasePrice = getItemPrice(
      normalizedNonUrgentName,
      orderDetailDialog?.deliveryType,
      false,
    );
    const catalogUrgentPrice = getItemPrice(
      itemName,
      orderDetailDialog?.deliveryType,
      true,
    );

    if (
      Number.isFinite(catalogBasePrice) &&
      catalogBasePrice > 0 &&
      Number.isFinite(catalogUrgentPrice) &&
      catalogUrgentPrice > 0
    ) {
      return safeCurrentUnitPrice * (catalogBasePrice / catalogUrgentPrice);
    }

    return safeCurrentUnitPrice / 2;
  };

  const buildEditOrderUrgencyTransformedItem = (
    item: EditOrderItem,
    urgent: boolean,
  ): EditOrderItem => {
    const baseUnitPrice = getEditOrderBaseUnitPrice(item);
    const nextName = rebuildEditOrderUrgencyName(item.name, urgent);
    return {
      ...item,
      name: nextName,
      price: getEditOrderItemUnitPriceFromBase(nextName, baseUnitPrice),
      baseUnitPrice,
    };
  };

  const canMergeEditOrderItems = (left: EditOrderItem, right: EditOrderItem) => {
    const leftBaseUnitPrice = Number.isFinite(Number(left.baseUnitPrice))
      ? Number(left.baseUnitPrice)
      : null;
    const rightBaseUnitPrice = Number.isFinite(Number(right.baseUnitPrice))
      ? Number(right.baseUnitPrice)
      : null;

    return (
      left.name === right.name &&
      Math.abs(Number(left.price || 0) - Number(right.price || 0)) < 0.009 &&
      ((leftBaseUnitPrice === null && rightBaseUnitPrice === null) ||
        (leftBaseUnitPrice !== null &&
          rightBaseUnitPrice !== null &&
          Math.abs(leftBaseUnitPrice - rightBaseUnitPrice) < 0.009))
    );
  };

  const normalizeEditOrderItems = (items: EditOrderItem[]) => {
    const normalizedItems: EditOrderItem[] = [];

    items.forEach((item) => {
      const safeQuantity = Math.max(0, Math.round(Number(item.quantity) || 0));
      const normalizedItem: EditOrderItem = {
        ...item,
        quantity: safeQuantity,
        price: Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
        baseUnitPrice: Number.isFinite(Number(item.baseUnitPrice))
          ? Number(item.baseUnitPrice)
          : item.baseUnitPrice,
      };

      if (safeQuantity <= 0) {
        normalizedItems.push(normalizedItem);
        return;
      }

      const mergeTargetIndex = normalizedItems.findIndex(
        (candidate) =>
          candidate.quantity > 0 && canMergeEditOrderItems(candidate, normalizedItem),
      );

      if (mergeTargetIndex !== -1) {
        normalizedItems[mergeTargetIndex] = {
          ...normalizedItems[mergeTargetIndex],
          quantity: normalizedItems[mergeTargetIndex].quantity + safeQuantity,
        };
        return;
      }

      normalizedItems.push(normalizedItem);
    });

    return normalizedItems;
  };

  const closeEditOrderSplitDialog = () => {
    setEditOrderSplitDialog(null);
    setEditOrderSplitQuantity("");
  };

  const handleOpenEditOrderSplitDialog = (dialog: EditOrderSplitDialogState) => {
    const sourceItem = editOrderItems[dialog.index];
    if (!sourceItem) return;
    setEditOrderSplitDialog(dialog);
    setEditOrderSplitQuantity(String(sourceItem.quantity));
  };

  const splitEditOrderItemQuantity = (
    index: number,
    movedQuantity: number,
    transform: (item: EditOrderItem) => EditOrderItem,
  ) => {
    setEditOrderItems((prev) => {
      const sourceItem = prev[index];
      if (!sourceItem) return prev;

      const safeQuantity = Math.max(
        1,
        Math.min(sourceItem.quantity, Math.round(movedQuantity)),
      );
      const transformedItem = transform(sourceItem);

      if (canMergeEditOrderItems(sourceItem, transformedItem)) {
        return prev;
      }

      const targetItem: EditOrderItem = {
        ...transformedItem,
        quantity: safeQuantity,
      };
      const mergeTargetIndex = prev.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex !== index &&
          candidate.quantity > 0 &&
          canMergeEditOrderItems(candidate, targetItem),
      );
      const nextItems = [...prev];

      if (safeQuantity >= sourceItem.quantity) {
        if (mergeTargetIndex !== -1) {
          nextItems[mergeTargetIndex] = {
            ...nextItems[mergeTargetIndex],
            quantity: nextItems[mergeTargetIndex].quantity + sourceItem.quantity,
          };
          nextItems.splice(index, 1);
          return normalizeEditOrderItems(nextItems);
        }

        nextItems[index] = {
          ...targetItem,
          quantity: sourceItem.quantity,
        };
        return normalizeEditOrderItems(nextItems);
      }

      nextItems[index] = {
        ...sourceItem,
        quantity: sourceItem.quantity - safeQuantity,
      };

      if (mergeTargetIndex !== -1) {
        nextItems[mergeTargetIndex] = {
          ...nextItems[mergeTargetIndex],
          quantity: nextItems[mergeTargetIndex].quantity + safeQuantity,
        };
        return normalizeEditOrderItems(nextItems);
      }

      nextItems.splice(index + 1, 0, targetItem);
      return normalizeEditOrderItems(nextItems);
    });
  };

  const handleEditOrderPackingChange = (
    index: number,
    packingType: "folding" | "hanger",
  ) => {
    setEditOrderItems((prev) =>
      normalizeEditOrderItems(
        prev.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                name: rebuildEditOrderPackingName(item.name, packingType),
              }
            : item,
        ),
      ),
    );
  };

  const handleEditOrderUrgencyChange = (index: number, urgent: boolean) => {
    setEditOrderItems((prev) =>
      normalizeEditOrderItems(
        prev.map((item, itemIndex) => {
          if (itemIndex !== index) return item;
          return buildEditOrderUrgencyTransformedItem(item, urgent);
        }),
      ),
    );
  };

  const handleEditOrderServiceChange = (
    index: number,
    serviceType: StoredOrderItemServiceType,
  ) => {
    setEditOrderItems((prev) =>
      normalizeEditOrderItems(
        prev.map((item, itemIndex) =>
          itemIndex === index ? transformEditOrderItemService(item, serviceType) : item,
        ),
      ),
    );
  };

  const handleEditOrderServiceAction = (
    index: number,
    serviceType: StoredOrderItemServiceType,
  ) => {
    const sourceItem = editOrderItems[index];
    if (!sourceItem) return;
    if (sourceItem.quantity > 1) {
      handleOpenEditOrderSplitDialog({
        index,
        mode: "service",
        nextServiceType: serviceType,
      });
      return;
    }
    handleEditOrderServiceChange(index, serviceType);
  };

  const handleEditOrderUrgencyAction = (index: number, urgent: boolean) => {
    const sourceItem = editOrderItems[index];
    if (!sourceItem) return;
    const isUrgentItem = /\*URG\*/i.test(sourceItem.name);
    if (isUrgentItem === urgent) {
      return;
    }
    if (sourceItem.quantity > 1) {
      handleOpenEditOrderSplitDialog({
        index,
        mode: "urgent",
        nextUrgent: urgent,
      });
      return;
    }
    handleEditOrderUrgencyChange(index, urgent);
  };

  const handleEditOrderSplitQuantityAdjust = (delta: number) => {
    if (!editOrderSplitMaxQuantity) return;
    const currentValue = Number.isFinite(editOrderSplitParsedQuantity)
      ? editOrderSplitParsedQuantity
      : editOrderSplitMaxQuantity;
    const nextValue = Math.max(
      1,
      Math.min(editOrderSplitMaxQuantity, currentValue + delta),
    );
    setEditOrderSplitQuantity(String(nextValue));
  };

  const handleApplyEditOrderSplit = () => {
    if (!editOrderSplitDialog || !editOrderSplitSourceItem || !editOrderSplitSafeQuantity) {
      closeEditOrderSplitDialog();
      return;
    }

    if (editOrderSplitDialog.mode === "service") {
      splitEditOrderItemQuantity(
        editOrderSplitDialog.index,
        editOrderSplitSafeQuantity,
        (item) => transformEditOrderItemService(item, editOrderSplitDialog.nextServiceType),
      );
    } else {
      splitEditOrderItemQuantity(
        editOrderSplitDialog.index,
        editOrderSplitSafeQuantity,
        (item) => buildEditOrderUrgencyTransformedItem(item, editOrderSplitDialog.nextUrgent),
      );
    }

    closeEditOrderSplitDialog();
  };

  const handleEditOrderPriorityChange = (urgent: boolean) => {
    setEditOrderPriorityUrgent(urgent);
    setEditOrderItems((prev) =>
      normalizeEditOrderItems(
        prev.map((item) => {
          return buildEditOrderUrgencyTransformedItem(item, urgent);
        }),
      ),
    );
  };

  const handleEditOrderServiceAllChange = (serviceType: StoredOrderItemServiceType) => {
    setEditOrderItems((prev) =>
      normalizeEditOrderItems(
        prev.map((item) => transformEditOrderItemService(item, serviceType)),
      ),
    );
  };

  const handleEditOrderAuth = () => {
    const normalizedPin = editOrderPin.replace(/\D/g, "").slice(0, 5);
    if (normalizedPin.length !== 5) {
      setEditOrderAdminError("Please enter the 5-digit admin or counter PIN");
      return;
    }
    apiRequest("POST", "/api/staff-members/verify-pin", { pin: normalizedPin })
      .then((res) => res.json())
      .then((data) => {
        const normalizedRole = String(data?.member?.roleType || "").toLowerCase();
        const isAdminAuth = normalizedRole === "admin";
        const isCounterAuth = normalizedRole === "counter" || normalizedRole === "reception";
        if (isAdminAuth || isCounterAuth) {
          setEditOrderAuthenticated(true);
          setEditOrderAuthLevel(isAdminAuth ? "admin" : "counter");
          setEditOrderPriorityUrgent(Boolean(orderDetailDialog?.urgent));
          setEditOrderAdminError("");
          if (orderDetailDialog) {
            const itemsStr = orderDetailDialog.items || "";
            const parts = itemsStr.split(',').map((s: string) => s.trim()).filter(Boolean);
            const editItems: Array<{ name: string; quantity: number; price: number; baseUnitPrice?: number }> = [];
            parts.forEach(part => {
              const sqmItem = parseSqmDescriptionPart(part, products);
              if (sqmItem) {
                const hasEmbeddedBasePrice = Number.isFinite(getEmbeddedBaseUnitPrice(part));
                const hasEmbeddedCurrentPrice = /@\s*[\d.]+\s*AED/i.test(part);
                const currentSqmPrice =
                  orderDetailDialog?.urgent === true && !hasEmbeddedBasePrice && !hasEmbeddedCurrentPrice
                    ? sqmItem.price * 2
                    : sqmItem.price;
                const sqmNameRaw = stripEmbeddedItemPriceText(sqmItem.name).replace(/\s*\(custom\)\s*$/i, '').trim();
                const sqmName = orderDetailDialog?.urgent === true
                  ? rebuildEditOrderUrgencyName(sqmNameRaw, true)
                  : sqmNameRaw;
                editItems.push({
                  name: sqmName,
                  quantity: sqmItem.qty,
                  price: currentSqmPrice,
                  baseUnitPrice:
                    getEmbeddedBaseUnitPrice(part) ??
                    ((/\*URG\*/i.test(part) || orderDetailDialog?.urgent === true)
                      ? currentSqmPrice / 2
                      : currentSqmPrice),
                });
                return;
              }
              const match = part.match(/^(\d+)x\s+(.+?)(?:\s+@\s*([\d.]+)\s*AED)?$/i);
              if (match) {
                let price = match[3]
                  ? parseFloat(match[3])
                  : getItemPrice(match[2].trim(), orderDetailDialog?.deliveryType, orderDetailDialog?.urgent === true);
                const baseUnitPrice = getEmbeddedBaseUnitPrice(match[2].trim());
                if (!match[3] && products && orderDetailDialog?.urgent !== true) {
                  const itemName = match[2].trim();
                  const baseName = itemName
                    .replace(/\s*\[N\]\s*/g, '').replace(/\s*\[DC?\]\s*/g, '').replace(/\s*\[IO?\]\s*/g, '')
                    .replace(/\s*\*URG\*\s*/g, '').replace(/\s*\(folding\)\s*/gi, '').replace(/\s*\(hanger\)\s*/gi, '')
                    .replace(/\s*\(hanging\)\s*/gi, '').replace(/\s*\(Small\)\s*/gi, '').replace(/\s*\(Medium\)\s*/gi, '')
                    .replace(/\s*\(Large\)\s*/gi, '').trim();
                  const prod = products.find(p => p.name.toLowerCase() === baseName.toLowerCase());
                  if (prod) price = parseFloat(prod.price || "0");
                }
                const normalizedNameRaw = stripEmbeddedItemPriceText(match[2].trim());
                const normalizedName = orderDetailDialog?.urgent === true
                  ? rebuildEditOrderUrgencyName(normalizedNameRaw, true)
                  : normalizedNameRaw;
                editItems.push({
                  name: normalizedName,
                  quantity: parseInt(match[1]),
                  price,
                  baseUnitPrice: Number.isFinite(baseUnitPrice)
                    ? Number(baseUnitPrice)
                    : (!/\*URG\*/i.test(normalizedName) && orderDetailDialog?.urgent !== true
                        ? price
                        : getItemPrice(
                            normalizedNameRaw.replace(/\s*\*URG\*\s*/gi, " ").replace(/\s{2,}/g, " ").trim(),
                            orderDetailDialog?.deliveryType,
                            false,
                          )),
                });
              } else {
                editItems.push({ name: stripEmbeddedItemPriceText(part), quantity: 1, price: 0, baseUnitPrice: 0 });
              }
            });
            setEditOrderItems(normalizeEditOrderItems(editItems));
            setEditOrderNewPrice("");
            setEditOrderPriceReason("");
	            setEditOrderPaidAmount("");
	            setEditOrderDiscount("");
	            const currentDeliveryCharge = getOrderDeliveryChargeAmount(orderDetailDialog);
	            setEditOrderApplyDeliveryCharge(currentDeliveryCharge > 0.009);
	            setEditOrderDeliveryCharge(currentDeliveryCharge > 0.009 ? currentDeliveryCharge.toFixed(2) : "");
	            setEditOrderRevertingPayment(false);
	            setEditOrderAddItemSearch("");
          }
        } else {
          setEditOrderAdminError("Only admin or counter PIN can edit orders");
        }
      })
      .catch((error) => {
        const errorMessage = error instanceof Error ? error.message : "";
        const jsonStartIdx = errorMessage.indexOf("{");
        if (jsonStartIdx !== -1) {
          try {
            const parsed = JSON.parse(errorMessage.substring(jsonStartIdx));
            if (parsed?.message) {
              setEditOrderAdminError(parsed.message);
              return;
            }
          } catch {
            // Fall through to the generic PIN error below.
          }
        }
        setEditOrderAdminError("Invalid admin or counter PIN");
      });
  };

  const handleSaveEditOrder = async () => {
    if (!orderDetailDialog) return;
    setEditOrderSaving(true);
    setEditOrderAdminError("");
    try {
      const items = normalizeEditOrderItems(editOrderItems)
        .filter(item => item.quantity > 0)
        .map(item => ({
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          baseUnitPrice: getEditOrderBaseUnitPrice(item),
        }));

	      if (items.length === 0) {
	        setEditOrderAdminError("Order must have at least one item");
	        setEditOrderSaving(false);
	        return;
	      }

	      const parsedEditDeliveryCharge = parseFloat(editOrderDeliveryCharge);
	      const requestedEditDeliveryCharge = editOrderApplyDeliveryCharge
	        ? Number.isFinite(parsedEditDeliveryCharge)
	          ? Math.max(0, parsedEditDeliveryCharge)
	          : DEFAULT_DELIVERY_CHARGE_AMOUNT
	        : 0;

	      const res = await apiRequest("POST", `/api/orders/${orderDetailDialog.id}/edit-order`, {
	        items,
	        urgent: editOrderPriorityUrgent,
	        newPrice: editOrderNewPrice ? parseFloat(editOrderNewPrice) : undefined,
	        priceReason: editOrderPriceReason || undefined,
	        newPaidAmount: editOrderPaidAmount !== "" ? parseFloat(editOrderPaidAmount) : undefined,
	        discountAmount: editOrderDiscount ? parseFloat(editOrderDiscount) : undefined,
	        deliveryCharge: requestedEditDeliveryCharge,
	        undoBill: false,
	        staffPin: editOrderPin,
	      });
      const data = await res.json();
      if (res.ok) {
        if (data?.order) {
          queryClient.setQueryData<Order[]>(["/api/orders"], (current) =>
            current?.map((existing) =>
              existing.id === data.order.id ? { ...existing, ...data.order } : existing,
            ) || current,
          );
        }
        if (data?.bill) {
          queryClient.setQueryData<Bill[]>(["/api/bills"], (current) =>
            current?.map((existing) =>
              existing.id === data.bill.id ? { ...existing, ...data.bill } : existing,
            ) || current,
          );
          setSelectedBill((current) =>
            current && current.id === data.bill.id ? { ...current, ...data.bill } : current,
          );
        }
        toast({
          title: "Order Updated",
          description: data.message || "Order has been updated successfully",
        });
        setOrderDetailDialog(null);
        setEditOrderAuthenticated(false);
        setEditOrderAuthLevel(null);
	        setEditOrderPriorityUrgent(false);
	        setEditOrderPin("");
	        setEditOrderApplyDeliveryCharge(false);
	        setEditOrderDeliveryCharge("");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["/api/orders"] }),
          queryClient.invalidateQueries({ queryKey: ["/api/bills"] }),
          queryClient.invalidateQueries({ queryKey: ["/api/clients"] }),
          queryClient.invalidateQueries({ queryKey: ["/api/bill-payments"] }),
          queryClient.invalidateQueries({ queryKey: ["/api/daily-sales"] }),
          queryClient.invalidateQueries({ queryKey: ["/api/client-transactions"] }),
        ]);
      } else {
        setEditOrderAdminError(data.message || "Failed to update order");
      }
    } catch {
      setEditOrderAdminError("Failed to update order");
    } finally {
      setEditOrderSaving(false);
    }
  };

  const handleReportIncident = (order: Order) => {
    setIncidentReportOrder(order);
    setIncidentType("missing_item");
    setIncidentItems([]);
    setIncidentReason("");
    setIncidentNotes("");
  };

  const submitIncidentReport = () => {
    if (!incidentReportOrder) return;
    if (incidentItems.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one item",
        variant: "destructive",
      });
      return;
    }
    if (!incidentReason.trim()) {
      toast({
        title: "Error",
        description: "Please provide a reason",
        variant: "destructive",
      });
      return;
    }
    if (!reporterName.trim()) {
      toast({
        title: "Error",
        description: "Please enter your name as the reporter",
        variant: "destructive",
      });
      return;
    }

    const client = incidentReportOrder.clientId
      ? clients?.find((c) => c.id === incidentReportOrder.clientId)
      : null;

    createIncidentMutation.mutate({
      customerName:
        client?.name || incidentReportOrder.customerName || "Unknown",
      customerPhone: getDisplayPhone(client?.phone) || undefined,
      orderId: incidentReportOrder.id,
      orderNumber: incidentReportOrder.orderNumber,
      itemName: incidentItems.join(", "),
      reason: incidentReason,
      notes: incidentNotes || undefined,
      responsibleStaffId: incidentReportOrder.packingWorkerId || undefined,
      responsibleStaffName: incidentReportOrder.packingBy || undefined,
      reporterName: reporterName,
      incidentType: incidentType,
      incidentDate: new Date().toISOString(),
    });
  };

  const getTrackingDateValue = (
    order: Order,
    field: "entry" | "delivery" = trackingDateField,
  ) => {
    if (field === "delivery") {
      return order.deliveryDate || null;
    }
    return order.entryDate || null;
  };

  const getTrackingDateKey = (
    order: Order,
    field: "entry" | "delivery" = trackingDateField,
  ) => toDateOnlyKey(getTrackingDateValue(order, field));

  const dateBounds = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(23, 59, 59, 999);
    let fromTs: number | null = null;
    let toTs: number | null = null;
    if (dateFilter === "today") {
      fromTs = today.getTime(); toTs = todayEnd.getTime();
    } else if (dateFilter === "yesterday") {
      fromTs = yesterday.getTime(); toTs = yesterdayEnd.getTime();
    } else if (dateFilter === "custom") {
      if (customDateFrom) {
        const d = new Date(customDateFrom);
        if (!Number.isNaN(d.getTime())) fromTs = d.getTime();
      }
      if (customDateTo) {
        const d = new Date(customDateTo);
        if (!Number.isNaN(d.getTime())) toTs = d.getTime();
      }
    } else if (dateFilter === "exact" && exactDate) {
      const s = new Date(exactDate); s.setHours(0, 0, 0, 0);
      const e = new Date(s); e.setHours(23, 59, 59, 999);
      fromTs = s.getTime(); toTs = e.getTime();
    }
    return { isAllTime: dateFilter === "all_time", fromTs, toTs };
  }, [dateFilter, customDateFrom, customDateTo, exactDate]);

  const dateFilteredOrders = useMemo(() => {
    if (!orders) return [];
    if (dateFilter === "custom" && !rangeApplied) return [];
    if (dateFilter === "exact" && !exactDate) return [];
    const filtered = dateBounds.isAllTime
      ? orders
      : orders.filter(order => {
          const trackingDate = getTrackingDateValue(order);
          if (!trackingDate) return false;
          const t = new Date(trackingDate).getTime();
          if (Number.isNaN(t)) return false;
          if (dateBounds.fromTs !== null && t < dateBounds.fromTs) return false;
          if (dateBounds.toTs !== null && t > dateBounds.toTs) return false;
          return true;
        });
    const merged = [...filtered];

    if (
      dateFilter === "exact" &&
      exactDate &&
      forcedVisibleOrderId &&
      forcedVisibleDateKey &&
      toDateOnlyKey(exactDate) === forcedVisibleDateKey &&
      !merged.some((order) => order.id === forcedVisibleOrderId)
    ) {
      const forcedOrder = orders.find((order) => order.id === forcedVisibleOrderId);
      if (forcedOrder) {
        merged.push(forcedOrder);
      }
    }

    const sortMultiplier = trackingSortOrder === "newest" ? -1 : 1;
    return merged.sort((a, b) => {
      const aTime = new Date(getTrackingDateValue(a) || a.entryDate).getTime();
      const bTime = new Date(getTrackingDateValue(b) || b.entryDate).getTime();
      const safeATime = Number.isFinite(aTime) ? aTime : 0;
      const safeBTime = Number.isFinite(bTime) ? bTime : 0;
      const timeDiff = safeATime - safeBTime;

      if (timeDiff !== 0) {
        return timeDiff * sortMultiplier;
      }

      return (a.id - b.id) * sortMultiplier;
    });
  }, [orders, dateBounds, dateFilter, rangeApplied, exactDate, forcedVisibleOrderId, forcedVisibleDateKey, trackingDateField, trackingSortOrder]);

  const urgentDateFilteredOrders = useMemo(() => {
    return dateFilteredOrders.filter(o => o.urgent && !o.delivered);
  }, [dateFilteredOrders]);

  const dueSoonDateFilteredOrders = useMemo(() => {
    const now = Date.now();
    const in48h = now + 48 * 60 * 60 * 1000;
    return dateFilteredOrders.filter(o => {
      if (o.delivered) return false;
      if (!o.expectedDeliveryAt) return false;
      const due = new Date(o.expectedDeliveryAt).getTime();
      return due <= in48h;
    }).sort((a, b) => {
      const aTime = new Date(a.expectedDeliveryAt!).getTime();
      const bTime = new Date(b.expectedDeliveryAt!).getTime();
      return aTime - bTime;
    });
  }, [dateFilteredOrders]);

  const searchMatchedOrders = useMemo(() => {
    if (!dateFilteredOrders) return [];
    const orderNumberTerm = normalizeTrackingExactOrderNumber(
      debouncedTrackingSearchFilters.orderNumber,
    );
    const billAmountTerm = normalizeTrackingMoneySearch(
      debouncedTrackingSearchFilters.billAmount,
    );
    const accountNumberTerm = normalizeTrackingReferenceSearch(
      debouncedTrackingSearchFilters.accountNumber,
    );
    const billNumberTerm = normalizeTrackingExactBillNumber(
      debouncedTrackingSearchFilters.billNumber,
    );
    const nameAddressTerm = debouncedTrackingSearchFilters.nameAddress.toLowerCase().trim();
    const normalizedPhoneTerm = normalizePhoneForComparison(
      debouncedTrackingSearchFilters.mobileNumber,
    );
    const companyNameTerm = debouncedTrackingSearchFilters.companyName.toLowerCase().trim();

    return dateFilteredOrders.filter((order) => {
      const client = order.clientId ? clientMap.get(order.clientId) : undefined;
      const bill = order.billId ? billMap.get(order.billId) : undefined;

      if (
        orderNumberTerm &&
        normalizeTrackingExactOrderNumber(order.orderNumber) !==
          normalizeTrackingExactOrderNumber(orderNumberTerm)
      ) {
        return false;
      }

      if (billAmountTerm) {
        const amount = bill ? getBillDisplayAmounts(bill).finalAmount : getOrderFinalAmount(order);
        if (!matchesTrackingMoneySearch(amount, billAmountTerm)) {
          return false;
        }
      }

      if (
        accountNumberTerm &&
        !(client?.billNumber || "").toLowerCase().includes(accountNumberTerm)
      ) {
        return false;
      }

      if (
        billNumberTerm &&
        normalizeTrackingExactBillNumber(order.billId) !==
          normalizeTrackingExactBillNumber(billNumberTerm)
      ) {
        return false;
      }

      if (nameAddressTerm) {
        const matchesNameAddress =
          (order.customerName || "").toLowerCase().includes(nameAddressTerm) ||
          (order.deliveryAddress || "").toLowerCase().includes(nameAddressTerm) ||
          (!!client &&
            (
              (client.name || "").toLowerCase().includes(nameAddressTerm) ||
              (client.address || "").toLowerCase().includes(nameAddressTerm)
            )) ||
          (!!bill &&
            (bill.customerName || "").toLowerCase().includes(nameAddressTerm));

        if (!matchesNameAddress) {
          return false;
        }
      }

      if (normalizedPhoneTerm) {
        const clientPhoneMatches =
          !!client?.phone &&
          normalizePhoneForComparison(client.phone).includes(normalizedPhoneTerm);
        const billPhoneMatches =
          !!bill?.customerPhone &&
          normalizePhoneForComparison(bill.customerPhone).includes(normalizedPhoneTerm);

        if (!clientPhoneMatches && !billPhoneMatches) {
          return false;
        }
      }

      if (
        companyNameTerm &&
        !(client?.company || "").toLowerCase().includes(companyNameTerm)
      ) {
        return false;
      }

      return true;
    });
  }, [
    billMap,
    clientMap,
    dateFilteredOrders,
    debouncedTrackingSearchFilters,
    getBillDisplayAmounts,
    getOrderFinalAmount,
  ]);

  const filteredOrders = useMemo(() => {
    return searchMatchedOrders.filter((order) => {
      if (showUrgentOnly && !order.urgent) return false;
      if (showNormalOnly && order.urgent) return false;
      if (showExpectedDateOnly && !hasExpectedDate(order)) return false;
      if (deliveryTypeFilter === "delivery" && !isDeliveryOrderType(order.deliveryType)) return false;
      if (deliveryTypeFilter === "takeaway" && isDeliveryOrderType(order.deliveryType)) return false;
      if (paymentStatusFilter === "paid" && !isOrderBillPaidForTracking(order)) return false;
      if (paymentStatusFilter === "unpaid" && isOrderBillPaidForTracking(order)) return false;

      if (activeTab === "all") return true;
      if (activeTab === "create") return !order.tagDone;
      if (activeTab === "tag-complete") return order.tagDone && !order.packingDone;
      if (activeTab === "packing-done") return order.packingDone && !order.delivered;
      if (activeTab === "delivery") return order.delivered;
      return true;
    });
  }, [
    searchMatchedOrders,
    showUrgentOnly,
    showNormalOnly,
    showExpectedDateOnly,
    deliveryTypeFilter,
    paymentStatusFilter,
    isOrderBillPaidForTracking,
    activeTab,
  ]);

  useEffect(() => {
    setVisibleAllTimeOrderCount(ORDERS_INITIAL_LOAD_COUNT);
  }, [
    dateFilter,
    trackingSortOrder,
    debouncedTrackingSearchFilters,
    showUrgentOnly,
    showNormalOnly,
    showExpectedDateOnly,
    deliveryTypeFilter,
    paymentStatusFilter,
    activeTab,
    rangeApplied,
    exactDate,
  ]);

  const paginatesOrders = dateFilter === "all_time";
  const visibleOrders = filteredOrders;
  const totalOrderCount = paginatesOrders
    ? (trackingOrderCount?.count ?? filteredOrders.length)
    : filteredOrders.length;
  const pageStartIndex = totalOrderCount === 0
    ? 0
    : 1;
  const pageEndIndex = totalOrderCount === 0
    ? 0
    : visibleOrders.length;
  const hasMoreVisibleOrders = paginatesOrders && visibleOrders.length < totalOrderCount;

  const allVisibleOrdersSelected =
    visibleOrders.length > 0 &&
    visibleOrders.every((order) => selectedOrderIds.has(order.id));

  const selectableVisibleOrders = useMemo(
    () => visibleOrders,
    [visibleOrders],
  );

  const selectableFilteredOrders = useMemo(
    () => trackingSelectionItems || [],
    [trackingSelectionItems],
  );

  const ordersScrollContextKey = useMemo(() => JSON.stringify({
    activeTab,
    trackingDateField,
    dateFilter,
    trackingSortOrder,
    debouncedTrackingSearchFilters,
    showUrgentOnly,
    showNormalOnly,
    showExpectedDateOnly,
    deliveryTypeFilter,
    paymentStatusFilter,
    rangeApplied,
    customDateFrom,
    customDateTo,
    exactDate: toDateOnlyKey(exactDate),
  }), [
    activeTab,
    trackingDateField,
    dateFilter,
    trackingSortOrder,
    debouncedTrackingSearchFilters,
    showUrgentOnly,
    showNormalOnly,
    showExpectedDateOnly,
    deliveryTypeFilter,
    paymentStatusFilter,
    rangeApplied,
    customDateFrom,
    customDateTo,
    exactDate,
  ]);

  useEffect(() => {
    if (
      previousOrdersScrollContextRef.current &&
      previousOrdersScrollContextRef.current !== ordersScrollContextKey
    ) {
      mobileOrdersScrollTopRef.current = 0;
      desktopOrdersScrollTopRef.current = 0;
    }

    previousOrdersScrollContextRef.current = ordersScrollContextKey;
  }, [ordersScrollContextKey]);

  const maybeLoadMoreOrders = useCallback((container?: HTMLElement | null) => {
    if (
      !paginatesOrders ||
      !hasMoreVisibleOrders ||
      isLoading ||
      isFetching ||
      ordersProcessing ||
      !container
    ) {
      return;
    }

    const remainingScroll =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    if (remainingScroll > ORDERS_LOAD_MORE_THRESHOLD_PX) {
      return;
    }

    setVisibleAllTimeOrderCount((current) =>
      Math.min(totalOrderCount, current + ORDERS_LOAD_MORE_COUNT),
    );
  }, [paginatesOrders, hasMoreVisibleOrders, isLoading, isFetching, ordersProcessing, totalOrderCount]);

  const scrollTrackingOrderIntoCenter = useCallback((orderId: number) => {
    const target = document.querySelector<HTMLElement>(
      `[data-order-id="${orderId}"], [data-testid="card-order-${orderId}"], [data-testid="row-order-${orderId}"]`,
    );

    if (!target) {
      return false;
    }

    const scroller = isMobile
      ? mobileOrdersScrollRef.current
      : desktopOrdersTableScrollRef.current;

    if (scroller && scroller.contains(target)) {
      const scrollerRect = scroller.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetTop = scroller.scrollTop + targetRect.top - scrollerRect.top;
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const nextScrollTop = Math.min(
        maxScrollTop,
        Math.max(0, targetTop - scroller.clientHeight / 2 + targetRect.height / 2),
      );

      scroller.scrollTo({ top: nextScrollTop, behavior: "smooth" });
      if (isMobile) {
        mobileOrdersScrollTopRef.current = nextScrollTop;
      } else {
        desktopOrdersScrollTopRef.current = nextScrollTop;
      }
    } else {
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }

    return true;
  }, [isMobile]);

  useLayoutEffect(() => {
    if (isLoading || ordersProcessing) return;

    const scroller = isMobile
      ? mobileOrdersScrollRef.current
      : desktopOrdersTableScrollRef.current;

    if (!scroller) return;

    const savedScrollTop = isMobile
      ? mobileOrdersScrollTopRef.current
      : desktopOrdersScrollTopRef.current;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);

    scroller.scrollTop = Math.min(savedScrollTop, maxScrollTop);
  }, [isLoading, ordersProcessing, isMobile, visibleOrders.length, orders?.length]);

  useEffect(() => {
    if (!paginatesOrders || isLoading || isFetching || ordersProcessing) return;

    const scroller = isMobile
      ? mobileOrdersScrollRef.current
      : desktopOrdersTableScrollRef.current;

    maybeLoadMoreOrders(scroller);
  }, [
    isLoading,
    isFetching,
    isMobile,
    maybeLoadMoreOrders,
    ordersProcessing,
    paginatesOrders,
    visibleOrders.length,
  ]);

  useEffect(() => {
    if (
      pendingFocusOrderId === null ||
      isLoading ||
      isFetching ||
      ordersProcessing ||
      !visibleOrders.some((order) => order.id === pendingFocusOrderId) ||
      typeof window === "undefined"
    ) {
      return;
    }

    let attempts = 0;
    let timeoutId: number | undefined;
    let animationFrameId: number | undefined;

    const attemptScroll = () => {
      animationFrameId = window.requestAnimationFrame(() => {
        if (scrollTrackingOrderIntoCenter(pendingFocusOrderId)) {
          setPendingFocusOrderId(null);
          return;
        }

        attempts += 1;
        if (attempts < 8) {
          timeoutId = window.setTimeout(attemptScroll, 100);
        }
      });
    };

    timeoutId = window.setTimeout(attemptScroll, 80);

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
    };
  }, [
    pendingFocusOrderId,
    isLoading,
    isFetching,
    ordersProcessing,
    scrollTrackingOrderIntoCenter,
    visibleOrders,
  ]);

  useEffect(() => {
    if (isMobile) {
      return;
    }

    const isDialogShortcutContextActive = () =>
      Boolean(document.querySelector('[role="dialog"][data-state="open"], [aria-modal="true"]'));

    const focusDesktopOrdersTable = () => {
      const tableScroller = desktopOrdersTableScrollRef.current;
      if (!tableScroller) return;

      tableScroller.focus({ preventScroll: true });
      tableScroller.scrollIntoView({ block: "nearest", inline: "nearest" });
    };

    const handleTableSelectAllShortcut = (event: KeyboardEvent) => {
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
      focusDesktopOrdersTable();

      if (visibleOrders.length > 0) {
        toggleAllOrders(visibleOrders);
      }
    };

    window.addEventListener("keydown", handleTableSelectAllShortcut);
    return () => {
      window.removeEventListener("keydown", handleTableSelectAllShortcut);
    };
  }, [isMobile, toggleAllOrders, visibleOrders]);

  const filteredOrderTotals = useMemo(() => {
    const billAmountsCache = new Map<number, ReturnType<typeof getBillDisplayAmounts>>();

    return filteredOrders.reduce(
      (totals, order) => {
	        const workReceived = getOrderWorkReceivedAmount(order);
	        const discount = getOrderDiscountAmount(order);
	        const deliveryCharge = getOrderDeliveryChargeAmount(order);
	        const finalAmount = getOrderFinalAmount(order);

        let paidAmount = 0;
        let dueAmount = Math.max(0, finalAmount);

        if (order.billId) {
          const linkedBill = billsById.get(order.billId);
          if (linkedBill) {
            const cachedBillAmounts =
              billAmountsCache.get(linkedBill.id) || getBillDisplayAmounts(linkedBill);
            billAmountsCache.set(linkedBill.id, cachedBillAmounts);

            const linkedOrders = ordersByBillId.get(linkedBill.id) || [];
            if (linkedOrders.length <= 1) {
              paidAmount = cachedBillAmounts.paidAmount;
              dueAmount = cachedBillAmounts.due;
            } else {
              const totalFinalForBill = linkedOrders.reduce(
                (sum, candidate) => sum + getOrderFinalAmount(candidate),
                0,
              );
              const totalWorkReceivedForBill = linkedOrders.reduce(
                (sum, candidate) => sum + getOrderWorkReceivedAmount(candidate),
                0,
              );

              let share = 1 / linkedOrders.length;
              if (totalFinalForBill > 0 && finalAmount > 0) {
                share = finalAmount / totalFinalForBill;
              } else if (totalWorkReceivedForBill > 0 && workReceived > 0) {
                share = workReceived / totalWorkReceivedForBill;
              }

              paidAmount = cachedBillAmounts.paidAmount * share;
              dueAmount = cachedBillAmounts.due * share;
            }
          }
        }

	        totals.workReceived += workReceived;
	        totals.discount += discount;
	        totals.deliveryCharge += deliveryCharge;
	        totals.finalAmount += finalAmount;
        totals.paidAmount += paidAmount;
        totals.dueAmount += dueAmount;
        return totals;
      },
      {
	        workReceived: 0,
	        discount: 0,
	        deliveryCharge: 0,
	        finalAmount: 0,
        paidAmount: 0,
        dueAmount: 0,
      },
    );
  }, [
    billsById,
    filteredOrders,
	    getBillDisplayAmounts,
	    getOrderDeliveryChargeAmount,
	    getOrderDiscountAmount,
    getOrderFinalAmount,
    getOrderWorkReceivedAmount,
    ordersByBillId,
  ]);

  const footerPaymentOrderCounts = useMemo(() => {
    const billAmountsCache = new Map<number, ReturnType<typeof getBillDisplayAmounts>>();

    return filteredOrders.reduce(
      (totals, order) => {
        const workReceived = getOrderWorkReceivedAmount(order);
        const finalAmount = getOrderFinalAmount(order);

        let paidAmount = 0;
        let dueAmount = Math.max(0, finalAmount);

        if (order.billId) {
          const linkedBill = billsById.get(order.billId);
          if (linkedBill) {
            const cachedBillAmounts =
              billAmountsCache.get(linkedBill.id) || getBillDisplayAmounts(linkedBill);
            billAmountsCache.set(linkedBill.id, cachedBillAmounts);

            const linkedOrders = ordersByBillId.get(linkedBill.id) || [];
            if (linkedOrders.length <= 1) {
              paidAmount = cachedBillAmounts.paidAmount;
              dueAmount = cachedBillAmounts.due;
            } else {
              const totalFinalForBill = linkedOrders.reduce(
                (sum, candidate) => sum + getOrderFinalAmount(candidate),
                0,
              );
              const totalWorkReceivedForBill = linkedOrders.reduce(
                (sum, candidate) => sum + getOrderWorkReceivedAmount(candidate),
                0,
              );

              let share = 1 / linkedOrders.length;
              if (totalFinalForBill > 0 && finalAmount > 0) {
                share = finalAmount / totalFinalForBill;
              } else if (totalWorkReceivedForBill > 0 && workReceived > 0) {
                share = workReceived / totalWorkReceivedForBill;
              }

              paidAmount = cachedBillAmounts.paidAmount * share;
              dueAmount = cachedBillAmounts.due * share;
            }
          }
        }

        if (paidAmount > 0.01) {
          totals.paidOrders += 1;
        }

        if (dueAmount > 0.01) {
          totals.dueOrders += 1;
        }

        return totals;
      },
      {
        paidOrders: 0,
        dueOrders: 0,
      },
    );
  }, [
    billsById,
    filteredOrders,
    getBillDisplayAmounts,
    getOrderFinalAmount,
    getOrderWorkReceivedAmount,
    ordersByBillId,
  ]);

  const footerOrderCount = totalOrderCount;
  const footerOrderTotals = trackingOrderSummary ?? filteredOrderTotals;
  const renderOrderFooterSummary = (testId: string) => (
    <div
      className="shrink-0 border-t bg-muted/10 px-3 py-2.5 text-[11px] leading-relaxed lg:px-4"
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-slate-700 dark:text-slate-200">
          Orders: {footerOrderCount}
        </span>
        <span className="font-medium text-sky-700 dark:text-sky-300">
          Work Rec.: {footerOrderTotals.workReceived.toFixed(2)} AED
        </span>
	        <span className="font-medium text-amber-700 dark:text-amber-300">
	          Discount: {footerOrderTotals.discount.toFixed(2)} AED
	        </span>
	        <span className="font-medium text-blue-700 dark:text-blue-300">
	          Delivery: {(footerOrderTotals.deliveryCharge || 0).toFixed(2)} AED
	        </span>
	        <span className="font-medium text-primary">
          Final: {footerOrderTotals.finalAmount.toFixed(2)} AED
        </span>
        <span className="font-medium text-emerald-700 dark:text-emerald-300">
          Paid: {footerOrderTotals.paidAmount.toFixed(2)} AED ({footerPaymentOrderCounts.paidOrders} order{footerPaymentOrderCounts.paidOrders === 1 ? "" : "s"})
        </span>
        <span className="font-medium text-rose-700 dark:text-rose-300">
          Due: {footerOrderTotals.dueAmount.toFixed(2)} AED ({footerPaymentOrderCounts.dueOrders} order{footerPaymentOrderCounts.dueOrders === 1 ? "" : "s"})
        </span>
      </div>
    </div>
  );

  const updateDesktopOrdersJumperVisibility = useCallback((scroller?: HTMLDivElement | null) => {
    const nextScroller = scroller ?? desktopOrdersTableScrollRef.current;
    setShowDesktopOrdersJumpers(
      !!nextScroller && nextScroller.scrollHeight > nextScroller.clientHeight + 1,
    );
  }, []);

  const jumpDesktopOrdersTable = useCallback((direction: "top" | "bottom") => {
    const scroller = desktopOrdersTableScrollRef.current;
    if (!scroller) return;

    scroller.scrollTo({
      top: direction === "top" ? 0 : scroller.scrollHeight,
      behavior: "auto",
    });
  }, []);

  useEffect(() => {
    if (isMobile) {
      setShowDesktopOrdersJumpers(false);
      return;
    }

    updateDesktopOrdersJumperVisibility();

    if (typeof window === "undefined") return;

    const handleResize = () => updateDesktopOrdersJumperVisibility();
    window.addEventListener("resize", handleResize);

    const scroller = desktopOrdersTableScrollRef.current;
    if (typeof ResizeObserver !== "undefined" && scroller) {
      const resizeObserver = new ResizeObserver(() => {
        updateDesktopOrdersJumperVisibility(scroller);
      });
      resizeObserver.observe(scroller);
      if (scroller.firstElementChild) {
        resizeObserver.observe(scroller.firstElementChild);
      }

      return () => {
        window.removeEventListener("resize", handleResize);
        resizeObserver.disconnect();
      };
    }

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [activeTab, isMobile, updateDesktopOrdersJumperVisibility, visibleOrders.length]);

  const tabCounts = useMemo(() => {
    const sourceItems = trackingOverviewItems || [];

    return {
      all: sourceItems.length,
      create: sourceItems.filter((order) => !order.tagDone).length,
      tagComplete: sourceItems.filter((order) => order.tagDone && !order.packingDone).length,
      packingDone: sourceItems.filter((order) => order.packingDone && !order.delivered).length,
      delivery: sourceItems.filter((order) => order.delivered).length,
    };
  }, [trackingOverviewItems]);

  const urgentFilterCounts = useMemo(() => {
    const sourceItems = trackingOverviewItems || [];

    return {
      normal: sourceItems.filter((order) => !order.urgent).length,
      urgent: sourceItems.filter((order) => !!order.urgent).length,
    };
  }, [trackingOverviewItems]);
  const expectedDateFilterCount = useMemo(() => {
    const sourceItems = trackingOverviewItems || [];

    return sourceItems.filter((order) => hasExpectedDate(order)).length;
  }, [trackingOverviewItems]);
  const deliveryTypeFilterCounts = useMemo(() => {
    const sourceItems = trackingOverviewItems || [];

    return {
      takeaway: sourceItems.filter((order) => !isDeliveryOrderType(order.deliveryType)).length,
      delivery: sourceItems.filter((order) => isDeliveryOrderType(order.deliveryType)).length,
    };
  }, [trackingOverviewItems]);
  const paymentStatusFilterCounts = useMemo(() => {
    const sourceItems = trackingOverviewItems || [];

    return {
      paid: sourceItems.filter((order) => order.billIsPaid).length,
      unpaid: sourceItems.filter((order) => !order.billIsPaid).length,
    };
  }, [trackingOverviewItems]);

  const todayDateInputValue = format(new Date(), "yyyy-MM-dd");
  const defaultRangeStartValue = `${todayDateInputValue}T00:00`;
  const defaultRangeEndValue = `${todayDateInputValue}T23:59`;
  const dateFilterButtonClassName = isMobile
    ? "h-9 w-full justify-center px-2.5 text-[11px]"
    : "";
  const trackingSortButtonBaseClassName = isMobile
    ? "h-9 w-full justify-center gap-1 rounded-xl px-2 text-[11px] font-semibold touch-manipulation"
    : "h-8 min-w-[112px] justify-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold";
  const newestSortButtonClassName = `${trackingSortButtonBaseClassName} ${
    trackingSortOrder === "newest"
      ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
      : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
  }`;
  const oldestSortButtonClassName = `${trackingSortButtonBaseClassName} ${
    trackingSortOrder === "oldest"
      ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
      : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
  }`;
  const trackingFilterTileClassName = isMobile
    ? "h-auto min-h-[2.65rem] w-full px-2.5 py-1.5 text-[11px] font-medium touch-manipulation flex-col items-center justify-center gap-0.5 text-center whitespace-normal leading-tight"
    : "h-auto min-h-[3.1rem] w-[7.5rem] px-2.5 py-1.5 text-xs sm:text-sm touch-manipulation flex-col items-center justify-center gap-1 text-center";
  const priorityFilterButtonClassName = isMobile
    ? "h-8 w-full justify-center gap-1 rounded-full px-2 text-[10px] font-semibold leading-none whitespace-nowrap touch-manipulation"
    : "h-8 min-w-[118px] justify-center gap-1 rounded-full px-2.5 text-[11px] font-semibold";
  const normalPriorityFilterClassName = `${priorityFilterButtonClassName} border-emerald-200/80 bg-emerald-50/75 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100/80 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200 dark:hover:bg-emerald-950/35 ${
    showNormalOnly
      ? "border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-500 dark:border-emerald-400 dark:bg-emerald-500 dark:text-white shadow-[0_14px_28px_-24px_rgba(16,185,129,0.95)]"
      : ""
  }`;
  const urgentPriorityFilterClassName = `${priorityFilterButtonClassName} border-red-200/80 bg-red-50/75 text-red-700 hover:border-red-300 hover:bg-red-100/80 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200 dark:hover:bg-red-950/35 ${
    showUrgentOnly
      ? "border-red-500 bg-red-500 text-white hover:bg-red-500 dark:border-red-400 dark:bg-red-500 dark:text-white shadow-[0_14px_28px_-24px_rgba(239,68,68,0.95)]"
      : ""
  }`;
  const expectedDateFilterClassName = `${priorityFilterButtonClassName} border-amber-200/80 bg-amber-50/75 text-amber-700 hover:border-amber-300 hover:bg-amber-100/80 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200 dark:hover:bg-amber-950/35 ${
    showExpectedDateOnly
      ? "border-amber-500 bg-amber-500 text-white hover:bg-amber-500 dark:border-amber-400 dark:bg-amber-500 dark:text-white shadow-[0_14px_28px_-24px_rgba(245,158,11,0.95)]"
      : ""
  }`;
  const takeawayTypeFilterClassName = `${priorityFilterButtonClassName} border-teal-200/80 bg-teal-50/75 text-teal-700 hover:border-teal-300 hover:bg-teal-100/80 dark:border-teal-900/60 dark:bg-teal-950/20 dark:text-teal-200 dark:hover:bg-teal-950/35 ${
    deliveryTypeFilter === "takeaway"
      ? "border-teal-500 bg-teal-500 text-white hover:bg-teal-500 dark:border-teal-400 dark:bg-teal-500 dark:text-white shadow-[0_14px_28px_-24px_rgba(20,184,166,0.95)]"
      : ""
  }`;
  const deliveryTypeFilterClassName = `${priorityFilterButtonClassName} border-sky-200/80 bg-sky-50/75 text-sky-700 hover:border-sky-300 hover:bg-sky-100/80 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200 dark:hover:bg-sky-950/35 ${
    deliveryTypeFilter === "delivery"
      ? "border-sky-500 bg-sky-500 text-white hover:bg-sky-500 dark:border-sky-400 dark:bg-sky-500 dark:text-white shadow-[0_14px_28px_-24px_rgba(14,165,233,0.95)]"
      : ""
  }`;
  const paidStatusFilterClassName = `${priorityFilterButtonClassName} border-green-200/80 bg-green-50/75 text-green-700 hover:border-green-300 hover:bg-green-100/80 dark:border-green-900/60 dark:bg-green-950/20 dark:text-green-200 dark:hover:bg-green-950/35 ${
    paymentStatusFilter === "paid"
      ? "border-green-500 bg-green-500 text-white hover:bg-green-500 dark:border-green-400 dark:bg-green-500 dark:text-white shadow-[0_14px_28px_-24px_rgba(34,197,94,0.95)]"
      : ""
  }`;
  const unpaidStatusFilterClassName = `${priorityFilterButtonClassName} border-rose-200/80 bg-rose-50/75 text-rose-700 hover:border-rose-300 hover:bg-rose-100/80 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-200 dark:hover:bg-rose-950/35 ${
    paymentStatusFilter === "unpaid"
      ? "border-rose-500 bg-rose-500 text-white hover:bg-rose-500 dark:border-rose-400 dark:bg-rose-500 dark:text-white shadow-[0_14px_28px_-24px_rgba(244,63,94,0.95)]"
      : ""
  }`;
  const mobileFilterBarClassName = "mb-2 grid grid-cols-2 gap-2";
  const mobileFilterButtonClassName = "flex min-w-0 items-center gap-2 rounded-xl border border-border/60 bg-card/95 px-2.5 py-2 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.4)]";
  const mobileFilterPanelClassName = "mb-3 overflow-hidden rounded-[16px] border border-border/60 bg-card/95 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.4)]";
  const mobileFilterPanelContentClassName = "bg-gradient-to-b from-background via-background to-primary/5 px-2.5 pb-2.5 pt-2";
  const mobileSearchButtonClassName = `flex w-full min-w-0 items-center gap-2 rounded-[18px] border px-2.5 py-2.5 shadow-[0_16px_30px_-26px_rgba(15,23,42,0.55)] transition-all ${
    mobileSearchCurtainOpen
      ? "border-primary/30 bg-primary/[0.07]"
      : "border-border/60 bg-card/95"
  }`;
  const mobileTrackingActionButtonClassName = "h-8 min-w-0 justify-center px-2 text-[12px] font-semibold leading-none whitespace-nowrap";
  const mobileTrackingActionIconClassName = "mr-1 h-3.5 w-3.5 shrink-0";
  const mobileDeliveryTypeLabelClassName = "flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] font-semibold leading-none";
  const trackingSearchGridClassName = isMobile
    ? "grid grid-cols-1 gap-2.5"
    : "grid w-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7";
  const trackingSearchInputClassName = isMobile
    ? "h-10 w-full rounded-xl border-border/70 bg-background/95 pl-8.5 pr-3 text-[12px] touch-manipulation"
    : "h-10 w-full rounded-xl border-border/70 bg-background/95 pl-9 pr-3 text-sm shadow-sm";
  const trackingSearchIconClassName = isMobile
    ? "absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
    : "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground";
  const trackingSearchLabelClassName = isMobile
    ? "mb-1.5 block px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
    : "mb-1.5 block whitespace-nowrap px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
  const trackingSearchFieldConfigs: Array<{
    key: TrackingSearchFieldKey;
    label: string;
    placeholder: string;
    inputMode?: React.InputHTMLAttributes<HTMLInputElement>["inputMode"];
    testId: string;
  }> = [
    {
      key: "accountNumber",
      label: "Account Number",
      placeholder: "Search account #",
      testId: "input-search-orders-account-number",
    },
    {
      key: "orderNumber",
      label: "Order Number",
      placeholder: "Search order #",
      inputMode: "numeric",
      testId: "input-search-orders",
    },
    {
      key: "billAmount",
      label: "Bill Amount",
      placeholder: "Search amount",
      inputMode: "decimal",
      testId: "input-search-orders-bill-amount",
    },
    {
      key: "billNumber",
      label: "Bill Number",
      placeholder: "Search bill #",
      inputMode: "numeric",
      testId: "input-search-orders-bill-number",
    },
    {
      key: "nameAddress",
      label: "Name / Address",
      placeholder: "Search customer or address",
      testId: "input-search-orders-name-address",
    },
    {
      key: "mobileNumber",
      label: "Mobile Number",
      placeholder: "Search mobile #",
      inputMode: "tel",
      testId: "input-search-orders-mobile-number",
    },
    {
      key: "companyName",
      label: "Company Name",
      placeholder: "Search company",
      testId: "input-search-orders-company-name",
    },
  ];
  const activeTrackingSearchFilterCount = useMemo(
    () =>
      TRACKING_SEARCH_FIELD_KEYS.reduce(
        (count, key) => count + (trackingSearchFilters[key].trim() ? 1 : 0),
        0,
      ),
    [trackingSearchFilters],
  );
  const hasActiveTrackingSearchFilters = activeTrackingSearchFilterCount > 0;
  const mobileSearchSummaryLabel = hasActiveTrackingSearchFilters
    ? `${activeTrackingSearchFilterCount} active`
    : "Account, order, bill, customer";
  const trackingSearchFields = (
    <div className={trackingSearchGridClassName}>
      {trackingSearchFieldConfigs.map((field) => (
        <div key={field.key} className="min-w-0 text-left">
          <Label className={trackingSearchLabelClassName}>
            {field.label}
          </Label>
          <div className="relative">
            <Search className={trackingSearchIconClassName} />
            <Input
              placeholder={field.placeholder}
              value={trackingSearchFilters[field.key]}
              onChange={(event) => handleTrackingSearchChange(field.key, event.target.value)}
              className={trackingSearchInputClassName}
              inputMode={field.inputMode}
              data-testid={field.testId}
            />
          </div>
        </div>
      ))}
    </div>
  );
  const trackingSortSummaryLabel = trackingSortOrder === "newest" ? "Newest First" : "Oldest First";
  const mobileDateSummaryLabel = useMemo(() => {
    const withSort = (label: string) => `${label} / ${trackingSortSummaryLabel}`;
    if (dateFilter === "all_time") return withSort("All Time");
    if (dateFilter === "yesterday") return withSort("Yesterday");
    if (dateFilter === "today") return withSort("Today");
    if (dateFilter === "exact") {
      return withSort(exactDate ? format(exactDate, "dd MMM yyyy") : "Pick Date");
    }
    if (!rangeApplied || !customDateFrom || !customDateTo) return withSort("Custom Range");
    return withSort(`${format(new Date(customDateFrom), "dd MMM")} - ${format(new Date(customDateTo), "dd MMM")}`);
  }, [customDateFrom, customDateTo, dateFilter, exactDate, rangeApplied, trackingSortSummaryLabel]);
  const activeTabSummaryLabel = useMemo(() => {
    switch (activeTab) {
      case "create":
        return "Create";
      case "tag-complete":
        return "Tagged";
      case "packing-done":
        return "Ready";
      case "delivery":
        return "Completed";
      default:
        return "All";
    }
  }, [activeTab]);
  const prioritySummaryLabel = showUrgentOnly
    ? "Urgent Only"
    : showNormalOnly
      ? "Normal Only"
      : null;
  const expectedDateSummaryLabel = showExpectedDateOnly
    ? "Expected Date"
    : null;
  const deliveryTypeSummaryLabel = deliveryTypeFilter === "delivery"
    ? "Delivery Only"
    : deliveryTypeFilter === "takeaway"
      ? "Take-away Only"
      : null;
  const paymentStatusSummaryLabel = paymentStatusFilter === "paid"
    ? "Paid Bills"
    : paymentStatusFilter === "unpaid"
      ? "Unpaid Bills"
      : null;
  const mobileViewSummaryLabel = [
    activeTabSummaryLabel,
    prioritySummaryLabel,
    expectedDateSummaryLabel,
    deliveryTypeSummaryLabel,
    paymentStatusSummaryLabel,
  ]
    .filter((part): part is string => !!part)
    .join(" / ");
  const closeMobileDateCurtain = useCallback(() => {
    if (isMobile) {
      setMobileDateCurtainOpen(false);
    }
  }, [isMobile]);
  const closeMobileViewCurtain = useCallback(() => {
    if (isMobile) {
      setMobileViewCurtainOpen(false);
    }
  }, [isMobile]);
  const handleMobileSearchCurtainToggle = useCallback(() => {
    setMobileSearchCurtainOpen((open) => {
      const next = !open;
      if (next) {
        setMobileDateCurtainOpen(false);
        setMobileViewCurtainOpen(false);
      }
      return next;
    });
  }, []);
  const handleMobileDateCurtainToggle = useCallback(() => {
    setMobileDateCurtainOpen((open) => {
      const next = !open;
      if (next) {
        setMobileSearchCurtainOpen(false);
        setMobileViewCurtainOpen(false);
      }
      return next;
    });
  }, []);
  const handleMobileViewCurtainToggle = useCallback(() => {
    setMobileViewCurtainOpen((open) => {
      const next = !open;
      if (next) {
        setMobileSearchCurtainOpen(false);
        setMobileDateCurtainOpen(false);
      }
      return next;
    });
  }, []);
  const clearTrackingSearchFilters = useCallback(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    const nextFilters = { ...EMPTY_TRACKING_SEARCH_FILTERS };
    setTrackingSearchFilters(nextFilters);
    setDebouncedTrackingSearchFilters(nextFilters);
  }, []);
  const handleActiveTabChange = useCallback((value: string) => {
    setActiveTab(value);
  }, []);
  const handleNormalOnlyToggle = useCallback(() => {
    setShowNormalOnly((current) => {
      const next = !current;
      if (next) setShowUrgentOnly(false);
      return next;
    });
  }, []);
  const handleUrgentOnlyToggle = useCallback(() => {
    setShowUrgentOnly((current) => {
      const next = !current;
      if (next) setShowNormalOnly(false);
      return next;
    });
  }, []);
  const handleExpectedDateOnlyToggle = useCallback(() => {
    setShowExpectedDateOnly((current) => !current);
  }, []);
  const handleDeliveryTypeFilterToggle = useCallback((value: "takeaway" | "delivery") => {
    setDeliveryTypeFilter((current) => (current === value ? "all" : value));
  }, []);
  const handlePaymentStatusFilterToggle = useCallback((value: "paid" | "unpaid") => {
    setPaymentStatusFilter((current) => (current === value ? "all" : value));
  }, []);
  const shiftExactTrackingDate = useCallback((direction: -1 | 1, options?: { keepMobilePanelOpen?: boolean }) => {
    setOrdersProcessing(true);
    setTimeout(() => {
      const baseDate = exactDate ?? new Date();
      setExactDate(addDays(baseDate, direction));
      setOrdersProcessing(false);
      if (!options?.keepMobilePanelOpen) {
        closeMobileDateCurtain();
      }
    }, 50);
  }, [closeMobileDateCurtain, exactDate]);

  const getStatusBadge = (order: Order) => {
    if (order.delivered)
      return (
        <Badge className="bg-green-500 dark:bg-green-600 text-white text-xs sm:text-sm transition-all duration-200">
          {getOrderCompletedStatusLabel(order.deliveryType)}
        </Badge>
      );
    if (order.packingDone)
      return (
        <Badge className="bg-purple-500 dark:bg-purple-600 text-white text-xs sm:text-sm transition-all duration-200">
          Ready
        </Badge>
      );
    if (order.tagDone)
      return (
        <Badge className="bg-blue-500 dark:bg-blue-600 text-white text-xs sm:text-sm transition-all duration-200">
          Washing
        </Badge>
      );
    return (
      <Badge className="bg-orange-500 dark:bg-orange-600 text-white text-xs sm:text-sm transition-all duration-200">
        Pending
      </Badge>
    );
  };

  const getTimeRemaining = (expectedDeliveryAt: Date | null) => {
    if (!expectedDeliveryAt) return null;
    const now = new Date();
    const diff = new Date(expectedDeliveryAt).getTime() - now.getTime();
    if (diff <= 0)
      return (
        <Badge
          variant="destructive"
          className="animate-pulse text-xs sm:text-sm transition-all duration-200 whitespace-nowrap"
        >
          Overdue
        </Badge>
      );
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      return (
        <Badge
          variant="secondary"
          className="text-xs sm:text-sm transition-all duration-200 whitespace-nowrap"
        >
          {hours}h {minutes % 60}m
        </Badge>
      );
    }
    if (minutes <= 30) {
      return (
        <Badge
          variant="destructive"
          className="animate-pulse text-xs sm:text-sm transition-all duration-200 whitespace-nowrap"
        >
          {minutes}m
        </Badge>
      );
    }
    return (
      <Badge
        variant="secondary"
        className="text-xs sm:text-sm transition-all duration-200 whitespace-nowrap"
      >
        {minutes}m
      </Badge>
    );
  };

  const handleStatusUpdate = (
    orderId: number,
    field: string,
    value: boolean,
  ) => {
    const updates: any = { [field]: value };
    if (value) {
      updates[
        field.replace("Done", "Date").replace("delivered", "deliveryDate")
      ] = new Date().toISOString();
    }
    updateOrderMutation.mutate({ id: orderId, updates });
  };

  const isTodayShortcutActive =
    dateFilter === "today" ||
    (dateFilter === "exact" && !!exactDate && isSameDay(exactDate, new Date()));

  const isYesterdayShortcutActive =
    dateFilter === "yesterday" ||
    (dateFilter === "exact" &&
      !!exactDate &&
      isSameDay(exactDate, addDays(new Date(), -1)));

  const trackingSortControls = (
    <div className={isMobile ? "grid grid-cols-2 gap-1.5" : "flex items-center gap-1"}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={newestSortButtonClassName}
        onClick={() => setTrackingSortOrder("newest")}
        data-testid="button-sort-tracking-newest"
      >
        <ChevronDown className="h-3.5 w-3.5" />
        <span>Newest First</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={oldestSortButtonClassName}
        onClick={() => setTrackingSortOrder("oldest")}
        data-testid="button-sort-tracking-oldest"
      >
        <ChevronUp className="h-3.5 w-3.5" />
        <span>Oldest First</span>
      </Button>
    </div>
  );

  const dateFilterControls = (
    <div className={isMobile ? "space-y-2.5" : "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"}>
      {!isMobile && (
        <span className="text-sm font-medium text-muted-foreground">Date:</span>
      )}
      <div className="grid w-full grid-cols-3 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:gap-1">
        <Button
          variant={dateFilter === "all_time" ? "default" : "outline"}
          size="sm"
          className={dateFilterButtonClassName}
          onClick={() => {
            setDateFilter("all_time");
            setExactDate(new Date());
            setOrdersProcessing(false);
            closeMobileDateCurtain();
          }}
          data-testid="button-filter-all-time"
        >
          All Time
        </Button>
        <Button
          variant={isYesterdayShortcutActive ? "default" : "outline"}
          size="sm"
          className={dateFilterButtonClassName}
          onClick={() => {
            setDateFilter("yesterday");
            setExactDate(addDays(new Date(), -1));
            setOrdersProcessing(false);
            closeMobileDateCurtain();
          }}
          data-testid="button-filter-yesterday"
        >
          Yesterday
        </Button>
        <Button
          variant={isTodayShortcutActive ? "default" : "outline"}
          size="sm"
          className={dateFilterButtonClassName}
          onClick={() => {
            setDateFilter("today");
            setExactDate(new Date());
            setOrdersProcessing(false);
            closeMobileDateCurtain();
          }}
          data-testid="button-filter-today"
        >
          Today
        </Button>
      </div>
      <div className="w-full sm:w-auto">
          {isMobile ? (
            <div className="flex w-full items-center gap-2 sm:w-[260px]">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  setDateFilter("exact");
                  shiftExactTrackingDate(-1, { keepMobilePanelOpen: true });
                }}
                className="h-9 w-9 rounded-xl border-border bg-background p-0 text-foreground shadow-sm hover:bg-accent"
                data-testid="button-pick-date-prev"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="relative min-w-0 flex-1">
                <Input
                  type="date"
                  value={exactDate ? format(exactDate, "yyyy-MM-dd") : ""}
                  onChange={(event) => {
                    const { value } = event.target;
                    setDateFilter("exact");
                    setOrdersProcessing(true);
                    setTimeout(() => {
                      setExactDate(value ? new Date(`${value}T00:00:00`) : undefined);
                      setOrdersProcessing(false);
                    }, 50);
                  }}
                  className="h-9 w-full rounded-xl border-border bg-background pr-10 text-foreground shadow-sm [color-scheme:light] dark:[color-scheme:dark]"
                  data-testid="input-pick-date"
                />
                <CalendarIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  setDateFilter("exact");
                  shiftExactTrackingDate(1, { keepMobilePanelOpen: true });
                }}
                className="h-9 w-9 rounded-xl border-border bg-background p-0 text-foreground shadow-sm hover:bg-accent"
                data-testid="button-pick-date-next"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  setDateFilter("exact");
                  shiftExactTrackingDate(-1);
                }}
                className="h-8 w-8 rounded-lg p-0"
                data-testid="button-pick-date-prev"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 min-w-[140px] justify-start text-left font-normal"
                    data-testid="input-pick-date"
                  >
                    <CalendarIcon className="w-3.5 h-3.5 mr-1.5" />
                    {exactDate ? format(exactDate, "dd MMM yyyy") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <ShadcnCalendar
                    mode="single"
                    selected={exactDate}
                    onSelect={(date) => {
                      if (date) {
                        setDateFilter("exact");
                        setOrdersProcessing(true);
                        setTimeout(() => {
                          setExactDate(date);
                          setOrdersProcessing(false);
                        }, 50);
                      }
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  setDateFilter("exact");
                  shiftExactTrackingDate(1);
                }}
                className="h-8 w-8 rounded-lg p-0"
                data-testid="button-pick-date-next"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
      </div>
      {trackingSortControls}
    </div>
  );

  const trackingViewControls = (
    <div className={isMobile ? "space-y-1.5" : "flex w-full flex-wrap items-stretch gap-1"}>
      <TabsList className={isMobile ? "grid h-auto grid-cols-2 gap-1.5 bg-transparent p-0" : "flex h-auto flex-wrap items-stretch justify-start gap-1 bg-transparent p-0"}>
        <TabsTrigger
          value="all"
          className={`${trackingFilterTileClassName} border border-border bg-background data-[state=active]:shadow-none`}
        >
          <span>All</span>
          <span className="inline-flex min-w-[1.6rem] items-center justify-center rounded-sm border border-current/20 bg-current/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
            {tabCounts.all}
          </span>
        </TabsTrigger>
        <TabsTrigger
          value="create"
          className={`${trackingFilterTileClassName} bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-200 data-[state=active]:bg-blue-500 data-[state=active]:text-white`}
        >
          <span className="flex items-center justify-center gap-1 leading-none">
            <Plus className="w-3.5 h-3.5" />
            <span>1.Create</span>
          </span>
          <span className="inline-flex min-w-[1.6rem] items-center justify-center rounded-sm border border-current/20 bg-current/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
            {tabCounts.create}
          </span>
        </TabsTrigger>
        <TabsTrigger
          value="tag-complete"
          className={`${trackingFilterTileClassName} bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-200 data-[state=active]:bg-sky-500 data-[state=active]:text-white`}
        >
          <span className="flex items-center justify-center gap-1 leading-none">
            <Tag className="w-3.5 h-3.5" />
            <span>2.Tagged</span>
          </span>
          <span className="inline-flex min-w-[1.6rem] items-center justify-center rounded-sm border border-current/20 bg-current/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
            {tabCounts.tagComplete}
          </span>
        </TabsTrigger>
        <TabsTrigger
          value="packing-done"
          className={`${trackingFilterTileClassName} bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-200 data-[state=active]:bg-purple-500 data-[state=active]:text-white`}
          data-testid="tab-ready"
        >
          <span className="flex items-center justify-center gap-1 leading-none">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>3.Ready</span>
          </span>
          <span className="inline-flex min-w-[1.6rem] items-center justify-center rounded-sm border border-current/20 bg-current/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
            {tabCounts.packingDone}
          </span>
        </TabsTrigger>
        <TabsTrigger
          value="delivery"
          className={`${trackingFilterTileClassName} ${isMobile ? "col-span-2" : ""} bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-200 data-[state=active]:bg-green-500 data-[state=active]:text-white`}
        >
          <span className="flex items-center justify-center gap-1 leading-none">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>4.Completed</span>
          </span>
          <span className="inline-flex min-w-[1.6rem] items-center justify-center rounded-sm border border-current/20 bg-current/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
            {tabCounts.delivery}
          </span>
        </TabsTrigger>
      </TabsList>
      <div className={isMobile ? "grid grid-cols-2 gap-1.5" : "flex flex-wrap items-center gap-1.5"}>
        <Button
          variant="outline"
          size="sm"
          className={normalPriorityFilterClassName}
          onClick={handleNormalOnlyToggle}
          data-testid="button-toggle-normal"
        >
          <span className="flex items-center justify-center gap-1 leading-none">
            <Clock className="w-3.25 h-3.25" />
            <span>Normal Only</span>
          </span>
          <span className="inline-flex min-w-[1.3rem] items-center justify-center rounded-full border border-current/20 bg-current/10 px-1.25 py-0.5 text-[9px] font-semibold leading-none">
            {urgentFilterCounts.normal}
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={urgentPriorityFilterClassName}
          onClick={handleUrgentOnlyToggle}
          data-testid="button-toggle-urgent"
        >
          <span className="flex items-center justify-center gap-1 leading-none">
            <Zap className="w-3.25 h-3.25" />
            <span>Urgent Only</span>
          </span>
          <span className="inline-flex min-w-[1.3rem] items-center justify-center rounded-full border border-current/20 bg-current/10 px-1.25 py-0.5 text-[9px] font-semibold leading-none">
            {urgentFilterCounts.urgent}
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={expectedDateFilterClassName}
          onClick={handleExpectedDateOnlyToggle}
          data-testid="button-toggle-expected-date"
        >
          <span className="flex items-center justify-center gap-1 leading-none">
            <CalendarIcon className="w-3.25 h-3.25" />
            <span>Expected Date</span>
          </span>
          <span className="inline-flex min-w-[1.3rem] items-center justify-center rounded-full border border-current/20 bg-current/10 px-1.25 py-0.5 text-[9px] font-semibold leading-none">
            {expectedDateFilterCount}
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={takeawayTypeFilterClassName}
          onClick={() => handleDeliveryTypeFilterToggle("takeaway")}
          data-testid="button-toggle-takeaway"
        >
          <span className="flex items-center justify-center gap-1 leading-none">
            <Footprints className="w-3.25 h-3.25" />
            <span>Take-away</span>
          </span>
          <span className="inline-flex min-w-[1.3rem] items-center justify-center rounded-full border border-current/20 bg-current/10 px-1.25 py-0.5 text-[9px] font-semibold leading-none">
            {deliveryTypeFilterCounts.takeaway}
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={deliveryTypeFilterClassName}
          onClick={() => handleDeliveryTypeFilterToggle("delivery")}
          data-testid="button-toggle-delivery"
        >
          <span className="flex items-center justify-center gap-1 leading-none">
            <Truck className="w-3.25 h-3.25" />
            <span>Delivery</span>
          </span>
          <span className="inline-flex min-w-[1.3rem] items-center justify-center rounded-full border border-current/20 bg-current/10 px-1.25 py-0.5 text-[9px] font-semibold leading-none">
            {deliveryTypeFilterCounts.delivery}
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={paidStatusFilterClassName}
          onClick={() => handlePaymentStatusFilterToggle("paid")}
          data-testid="button-toggle-paid-bill"
        >
          <span className="flex items-center justify-center gap-1 leading-none">
            <Wallet className="w-3.25 h-3.25" />
            <span>Paid Bill</span>
          </span>
          <span className="inline-flex min-w-[1.3rem] items-center justify-center rounded-full border border-current/20 bg-current/10 px-1.25 py-0.5 text-[9px] font-semibold leading-none">
            {paymentStatusFilterCounts.paid}
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={unpaidStatusFilterClassName}
          onClick={() => handlePaymentStatusFilterToggle("unpaid")}
          data-testid="button-toggle-unpaid-bill"
        >
          <span className="flex items-center justify-center gap-1 leading-none">
            <Receipt className="w-3.25 h-3.25" />
            <span>Unpaid Bill</span>
          </span>
          <span className="inline-flex min-w-[1.3rem] items-center justify-center rounded-full border border-current/20 bg-current/10 px-1.25 py-0.5 text-[9px] font-semibold leading-none">
            {paymentStatusFilterCounts.unpaid}
          </span>
        </Button>
      </div>
    </div>
  );

  const orderPaginationControls = paginatesOrders && totalOrderCount > 0 ? (
    <div className="flex items-center justify-between gap-3 px-4 md:px-2 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          Showing {pageStartIndex}-{pageEndIndex} of {totalOrderCount} matching orders
          {hasMoreVisibleOrders ? `, scroll down to load ${ORDERS_LOAD_MORE_COUNT} more` : ""}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => selectOrders(selectableVisibleOrders)}
          disabled={selectableVisibleOrders.length === 0}
          data-testid="button-select-current-page-orders"
        >
          Select loaded ({selectableVisibleOrders.length})
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => selectOrders(selectableFilteredOrders)}
          disabled={selectableFilteredOrders.length === 0}
          data-testid="button-select-all-filtered-orders"
        >
          Select all filtered ({selectableFilteredOrders.length})
        </Button>
        {selectedOrderIds.size > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => clearSelectedOrders()}
            data-testid="button-clear-selected-orders"
          >
            Clear selection
          </Button>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-30 w-full bg-card border-b border-border shadow-sm">
        <div className="px-4 py-3 lg:px-6 lg:py-4 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-lg lg:text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <Package className="w-5 h-5 lg:w-6 lg:h-6 text-primary" />
              <span className="hidden sm:inline">System Order Tracking</span>
              <span className="sm:hidden">Tracking</span>
            </h1>
            {dueSoonOrders && dueSoonOrders.length > 0 && (
              <Badge
                variant="destructive"
                className="animate-pulse flex items-center gap-1"
              >
                <Bell className="w-4 h-4" />
                <span className="hidden sm:inline">
                  {dueSoonOrders.length} Due Soon
                </span>
                <span className="sm:hidden">{dueSoonOrders.length}</span>
              </Badge>
            )}
          </div>
          <div className="mx-auto flex w-full max-w-7xl justify-center">
            {isMobile ? (
              <div className="w-full">
                <button
                  type="button"
                  className={mobileSearchButtonClassName}
                  onClick={handleMobileSearchCurtainToggle}
                  aria-expanded={mobileSearchCurtainOpen}
                  data-testid="button-toggle-mobile-search-curtain"
                >
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background shadow-sm">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Search
                    </p>
                    <p className="truncate text-[12px] font-semibold text-foreground">
                      {mobileSearchSummaryLabel}
                    </p>
                  </div>
                  {hasActiveTrackingSearchFilters ? (
                    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                      {activeTrackingSearchFilterCount}
                    </span>
                  ) : null}
                  {mobileSearchCurtainOpen ? (
                    <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>

                <div className={`grid transition-all duration-300 ease-out ${mobileSearchCurtainOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-90"}`}>
                  <div className="min-h-0 overflow-hidden">
                    <div className={`${mobileFilterPanelClassName} mt-2`}>
                      <div className={mobileFilterPanelContentClassName}>
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              Search Tracking
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              Narrow results with one or more fields.
                            </p>
                          </div>
                          {hasActiveTrackingSearchFilters ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 shrink-0 rounded-full px-2.5 text-[11px]"
                              onClick={clearTrackingSearchFilters}
                              data-testid="button-clear-mobile-search-filters"
                            >
                              Clear
                            </Button>
                          ) : null}
                        </div>
                        {trackingSearchFields}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="w-full rounded-[20px] border border-border/70 bg-background/95 px-3 py-2.5 shadow-[0_18px_36px_-30px_rgba(15,23,42,0.45)]">
                <div className={hasActiveTrackingSearchFilters ? "mb-2 flex justify-end" : "hidden"}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-full px-2.5 text-[11px]"
                    onClick={clearTrackingSearchFilters}
                    data-testid="button-clear-tracking-search-filters"
                  >
                    Clear
                  </Button>
                </div>
                {trackingSearchFields}
              </div>
            )}
          </div>
        </div>
      </div>

      <main className="flex-1 container mx-auto px-4 py-4 lg:py-6 overflow-hidden flex flex-col">
        <Tabs value={activeTab} onValueChange={handleActiveTabChange} className="flex-1 min-h-0 flex flex-col">
          {isMobile ? (
            <>
              <div className={mobileFilterBarClassName}>
                <button
                  type="button"
                  className={mobileFilterButtonClassName}
                  onClick={handleMobileDateCurtainToggle}
                  data-testid="button-toggle-mobile-date-curtain"
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background shadow-sm">
                    <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px]">
                    <span className="shrink-0 font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Date
                    </span>
                    <span className="truncate font-semibold text-foreground">
                      {mobileDateSummaryLabel}
                    </span>
                  </div>
                  {mobileDateCurtainOpen ? (
                    <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>

                <button
                  type="button"
                  className={mobileFilterButtonClassName}
                  onClick={handleMobileViewCurtainToggle}
                  data-testid="button-toggle-mobile-view-curtain"
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background shadow-sm">
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px]">
                    <span className="shrink-0 font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      View
                    </span>
                    <span className="truncate font-semibold text-foreground">
                      {mobileViewSummaryLabel}
                    </span>
                  </div>
                  {mobileViewCurtainOpen ? (
                    <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </div>

              <div className={`grid transition-all duration-300 ease-out ${mobileDateCurtainOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-90"}`}>
                <div className="min-h-0 overflow-hidden">
                  <div className={mobileFilterPanelClassName}>
                    <div className={mobileFilterPanelContentClassName}>
                      {dateFilterControls}
                    </div>
                  </div>
                </div>
              </div>

              <div className={`grid transition-all duration-300 ease-out ${mobileViewCurtainOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-90"}`}>
                <div className="min-h-0 overflow-hidden">
                  <div className={mobileFilterPanelClassName}>
                    <div className={mobileFilterPanelContentClassName}>
                      {trackingViewControls}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="mb-4 rounded-lg border bg-muted/50 p-3">
                {dateFilterControls}
              </div>
              <div className="mb-4 w-full overflow-visible">
                {trackingViewControls}
              </div>
            </>
          )}

          <TabsContent
            value={activeTab}
            ref={mobileOrdersScrollRef}
            className="flex-1 min-h-0 pr-1 overflow-y-auto md:overflow-hidden flex flex-col"
            onScroll={(event) => {
              mobileOrdersScrollTopRef.current = event.currentTarget.scrollTop;
              maybeLoadMoreOrders(event.currentTarget);
            }}
          >
              {isLoading || ordersProcessing ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
                  <p>{ordersProcessing ? "Please wait while orders are loading..." : "Loading orders..."}</p>
                </div>
              ) : filteredOrders?.length === 0 ? (
                <div className="text-center py-20 text-muted-foreground">
                  <Package className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p>{dateFilter === "exact" && !exactDate ? "Pick a date above to view orders" : "No orders found"}</p>
                </div>
              ) : (
                <>
                  {selectedOrderIds.size > 0 && (
                    <div className="flex justify-end gap-1.5 flex-wrap px-4 md:px-2 py-2 text-sm text-muted-foreground">
                      <span className="mr-auto" data-testid="selected-orders-bills-summary">
                        {selectedOrderIds.size} selected order{selectedOrderIds.size === 1 ? "" : "s"}
                      </span>
                      {getSelectedPendingTagCount() > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1 border-blue-500 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                          onClick={handleBulkTag}
                          data-testid="button-bulk-tag-orders"
                        >
                          <Tag className="w-3 h-3" />
                          Tag {getSelectedPendingTagCount()}
                        </Button>
                      )}
                      {getSelectedTaggedCount() > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1 border-orange-500 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950"
                          onClick={handleBulkUntag}
                          data-testid="button-bulk-untag-orders"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Untag {getSelectedTaggedCount()}
                        </Button>
                      )}
                      {getSelectedWashingPackCount() > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1 border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950"
                          onClick={handleBulkPack}
                          data-testid="button-bulk-pack-orders"
                        >
                          <Package className="w-3 h-3" />
                          Pack {getSelectedWashingPackCount()}
                        </Button>
                      )}
                      {getSelectedPackedDeliveryCount() > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1 border-cyan-500 text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-950"
                          onClick={handleBulkDeliver}
                          data-testid="button-bulk-deliver-orders"
                        >
                          <Truck className="w-3 h-3" />
                          Deliver {getSelectedPackedDeliveryCount()}
                        </Button>
                      )}
                      {getSelectedPackedTakeawayCount() > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1 border-emerald-500 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                          onClick={handleBulkTakeaway}
                          data-testid="button-bulk-takeaway-orders"
                        >
                          <Home className="w-3 h-3" />
                          Takeaway {getSelectedPackedTakeawayCount()}
                        </Button>
                      )}
                      {getSelectedPackedCount() > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1 border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950"
                          onClick={handleBulkUnpack}
                          data-testid="button-bulk-unpack-orders"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Unpack {getSelectedPackedCount()}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1 border-indigo-500 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950"
                        onClick={handleBulkEditDate}
                        data-testid="button-bulk-edit-date-orders"
                      >
                        <CalendarIcon className="w-3 h-3" />
                        Edit Date {selectedOrderIds.size}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={handleBulkDelete}
                        data-testid="button-bulk-delete-orders"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete {selectedOrderIds.size}
                      </Button>
                    </div>
                  )}
                  {orderPaginationControls}
                  {/* Mobile Card Layout */}
                  {isMobile && (
                  <div className="space-y-3">
                    {visibleOrders && visibleOrders.length > 0 && (
                      <div className="flex items-center gap-2 px-1">
                        <Checkbox
                          checked={allVisibleOrdersSelected}
                          onCheckedChange={() => toggleAllOrders(visibleOrders)}
                          data-testid="checkbox-mobile-select-all-orders"
                        />
                        <span className="text-xs text-muted-foreground">
                          {selectedOrderIds.size > 0
                            ? `${selectedOrderIds.size} selected order${selectedOrderIds.size === 1 ? "" : "s"}`
                            : "Select all"}
                        </span>
                      </div>
                    )}
                    {visibleOrders?.map((order, mobileIdx) => {
                      const client = order.clientId
                        ? clientMap.get(order.clientId)
                        : null;
                      const clientIsBroker = isBrokerClient(client);
                      const displayName =
                        client?.name || order.customerName || "Walk-in";
                      const items = parseOrderItems(order.items);
                      const totalItems = items.reduce(
                        (sum, item) => sum + item.quantity,
                        0,
                      );
                      const linkedBill = order.billId
                        ? billsById.get(order.billId) || null
                        : null;
                      const linkedBillVisual = getOrderBillVisualMeta(linkedBill);
                      const mobileRowNumber = pageStartIndex + mobileIdx;

                      return (
                        <Card
                          key={order.id}
                          className={`shadow-sm transition-all duration-500 ${order.urgent ? "border-2 border-red-500 dark:border-red-600 bg-red-50/80 dark:bg-red-950/50 ring-1 ring-red-300 dark:ring-red-800" : "border"} ${selectedOrderIds.has(order.id) ? "ring-2 ring-primary/40 ring-offset-2 bg-primary/5" : ""} ${highlightedOrderId === order.id ? "ring-2 ring-primary ring-offset-2 bg-primary/5 animate-order-focus-glow" : ""}`}
                          data-order-id={order.id}
                          data-testid={`card-order-${order.id}`}
                          onClickCapture={(event) => handleTrackingOrderShortcutSelectionCapture(event, order)}
                        >
                          <CardHeader className={`flex flex-row items-center justify-between gap-2 p-3 pb-2 ${order.urgent ? "bg-red-100 dark:bg-red-950/50" : "bg-muted/30"}`}>
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={selectedOrderIds.has(order.id)}
                                onCheckedChange={() => toggleOrderSelection(order.id)}
                                data-testid={`checkbox-mobile-select-order-${order.id}`}
                              />
                              <span className="text-xs font-bold text-muted-foreground" data-testid={`text-mobile-row-number-${order.id}`}>{mobileRowNumber}.</span>
                              <button
                                className={`font-mono font-bold text-primary hover:underline cursor-pointer ${highlightedOrderId === order.id ? "animate-order-focus-text" : ""}`}
                                onClick={(event) => handleOrderDetailShortcutClick(event, order)}
                                data-testid={`button-order-detail-${order.id}`}
                              >
                                {order.orderNumber}
                              </button>
                              <button
                                className="text-orange-600 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-300"
                                onClick={() => generateTagReceipt(order)}
                                title="Download Tag"
                                data-testid={`button-download-tag-mobile-${order.id}`}
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5 border ${order.urgent ? "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 border-red-300 dark:border-red-700" : "bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400 border-green-300 dark:border-green-700"} ${order.delivered ? "opacity-60" : ""}`}
                                data-testid={`badge-order-priority-${order.id}`}
                              >
                                {order.urgent ? <><Zap className="w-3 h-3" /> URGENT</> : <><Clock className="w-3 h-3" /> NORMAL</>}
                              </span>
                              {order.deliveryType === "delivery" && (
                                <Truck className="w-4 h-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              {getStatusBadge(order)}
                              {order.packingDate && (
                                <span className="text-xs text-muted-foreground">
                                  {format(new Date(order.packingDate), "MMM d, h:mm a")}
                                </span>
                              )}
                              {order.notes ? (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-xs text-amber-600 dark:text-amber-400 max-w-[120px] truncate flex items-center gap-1 hover:underline cursor-pointer" data-testid={`button-note-${order.id}`}>
                                      <NotepadText className="w-3 h-3" /> {order.notes}
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-64 p-0" align="end">
                                    <div className="bg-amber-50 dark:bg-amber-900/30 border-2 border-amber-200 dark:border-amber-700 rounded-lg shadow-lg">
                                      <div className="bg-amber-100 dark:bg-amber-800/50 px-3 py-1.5 border-b border-amber-200 dark:border-amber-700 rounded-t-lg flex items-center justify-between gap-2">
                                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">Order Note</span>
                                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-amber-700 dark:text-amber-300" onClick={() => { setEditingNoteOrderId(order.id); setEditingNoteText(order.notes || ""); }} data-testid={`button-edit-note-${order.id}`}>
                                          <Edit className="w-3 h-3 mr-1" /> Edit
                                        </Button>
                                      </div>
                                      <div className="p-3 min-h-[60px]" style={{ fontFamily: "Arial, sans-serif" }}>
                                        <p className="text-sm text-amber-800 dark:text-amber-200 whitespace-pre-wrap leading-relaxed">
                                          {order.notes}
                                        </p>
                                      </div>
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              ) : (
                                <button
                                  className="text-xs text-muted-foreground flex items-center gap-1 hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer"
                                  onClick={() => { setEditingNoteOrderId(order.id); setEditingNoteText(""); }}
                                  data-testid={`button-add-note-${order.id}`}
                                >
                                  <NotepadText className="w-3 h-3" /> Add Note
                                </button>
                              )}
                            </div>
                          </CardHeader>

                          <CardContent className="p-3 pt-2 space-y-3">
                            {/* Client Row */}
                            <div className="flex items-center justify-between gap-2">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="font-medium text-left justify-start gap-2 h-auto py-1"
                                    data-testid={`button-mobile-client-${order.id}`}
                                  >
                                    <User className="w-4 h-4 text-primary shrink-0" />
                                    <div className="flex flex-col items-start">
                                      <div className="flex items-center gap-1 max-w-[140px]">
                                        <span className="truncate">
                                          {displayName}
                                        </span>
                                        {clientIsBroker && (
                                          <Badge
                                            variant="outline"
                                            className="h-4 shrink-0 border-violet-300 bg-violet-50 px-1.5 text-[9px] text-violet-700 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-300"
                                          >
                                            Broker
                                          </Badge>
                                        )}
                                      </div>
                                      {client?.company && (
                                        <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium truncate max-w-[140px] flex items-center gap-0.5">
                                          <Building2 className="h-2.5 w-2.5 shrink-0 text-blue-500 dark:text-blue-400" />
                                          {client.company}
                                        </span>
                                      )}
                                      {getDisplayPhone(client?.phone) && (
                                        <span className="flex max-w-[140px] items-center gap-0.5 truncate text-[10px] text-muted-foreground">
                                          <Phone className="h-2.5 w-2.5 shrink-0 text-cyan-500 dark:text-cyan-400" />
                                          {getDisplayPhone(client?.phone)}
                                        </span>
                                      )}
                                      {getOrderDisplayAddress(order, client) && (
                                        <span className="flex max-w-[140px] items-center gap-0.5 truncate text-xs font-normal text-muted-foreground">
                                          <MapPin className="h-2.5 w-2.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
                                          {getOrderDisplayAddress(order, client)}
                                        </span>
                                      )}
                                    </div>
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-72" align="start">
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2 border-b pb-2">
                                      <User className="w-5 h-5 text-primary" />
                                      <div>
                                        <p className="font-semibold flex items-center gap-2 flex-wrap">
                                          <span>{client?.name || displayName}</span>
                                          {clientIsBroker && (
                                            <Badge
                                              variant="outline"
                                              className="h-5 border-violet-300 bg-violet-50 px-2 text-[10px] text-violet-700 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-300"
                                            >
                                              Broker Account
                                            </Badge>
                                          )}
                                        </p>
                                        {client?.company && (
                                          <p className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400">
                                            <Building2 className="h-3 w-3 shrink-0 text-blue-500 dark:text-blue-400" />
                                            {client.company}
                                          </p>
                                        )}
                                        {client?.billNumber && (
                                          <p className="text-xs text-muted-foreground">
                                            Account: {client.billNumber}
                                          </p>
                                        )}
                                        {getDisplayPhone(client?.phone) && (
                                          <p className="flex items-center gap-1 text-sm text-muted-foreground">
                                            <Phone className="h-3 w-3 shrink-0 text-cyan-500 dark:text-cyan-400" />
                                            {getDisplayPhone(client?.phone)}
                                          </p>
                                        )}
                                        {getOrderDisplayAddress(order, client) && (
                                          <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                                            <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500 dark:text-emerald-400" />
                                            <span>{getOrderDisplayAddress(order, client)}</span>
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                    {client && (
                                      <>
                                        <div className="flex justify-between items-center gap-2">
                                          <span className="text-sm">
                                            Bill Balance:
                                          </span>
                                          <span
                                            className={`font-bold ${getClientDueBalance(client.id) === 0 ? "text-green-600" : "text-red-600"}`}
                                          >
                                            {getClientDueBalance(client.id).toFixed(2)}{" "}
                                            AED
                                          </span>
                                        </div>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="w-full mt-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                                          data-testid={`link-mobile-client-history-${client.id}`}
                                          onClick={() => openClientTransactions(client.id)}
                                        >
                                          <ExternalLink className="w-3 h-3 mr-1" />
                                          Account Activity
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="w-full text-amber-600 border-amber-200 hover:bg-amber-50"
                                          data-testid={`link-mobile-client-edit-${client.id}`}
                                          onClick={() => openClientEdit(client.id)}
                                        >
                                          <Edit className="w-3 h-3 mr-1" />
                                          Edit Account Details
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                </PopoverContent>
                              </Popover>
                              <span
                                className="font-semibold text-sm"
                              >
                                {(() => {
                                  const workReceived = getOrderWorkReceivedAmount(order);
                                  const disc = getOrderDiscountAmount(order);
                                  const finalAmt = getOrderFinalAmount(order);
                                  if (disc > 0) {
                                    return (
                                      <>
                                        <span className="line-through text-muted-foreground text-xs mr-1">{workReceived.toFixed(2)}</span>
                                        {finalAmt.toFixed(2)} AED
                                      </>
                                    );
                                  }
                                  return <>{finalAmt.toFixed(2)} AED</>;
                                })()}
                              </span>
                              {(() => {
                                const disc = getOrderDiscountAmount(order);
                                if (disc > 0) {
                                  return <span className="text-[10px] text-orange-500 ml-1">(-{disc.toFixed(2)} disc)</span>;
                                }
                                return null;
                              })()}
                            </div>

                            {/* Staff Tracking Info */}
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid={`staff-tracking-mobile-${order.id}`}>
                              {order.entryBy && (
                                <span data-testid={`text-created-by-mobile-${order.id}`}><User className="w-3 h-3 inline mr-1" />Created: <span className="font-medium text-foreground">{order.entryBy}</span></span>
                              )}
                              {order.tagBy && (
                                <span data-testid={`text-tagged-by-mobile-${order.id}`}><Tag className="w-3 h-3 inline mr-1" />Tagged: <span className="font-medium text-foreground">{order.tagBy}</span></span>
                              )}
                              {order.packingBy && (
                                <span data-testid={`text-packed-by-mobile-${order.id}`}><Package className="w-3 h-3 inline mr-1" />Packed: <span className="font-medium text-foreground">{order.packingBy}</span></span>
                              )}
                              {formatActorLabel(order.deliveryBy) && (
                                <span data-testid={`text-delivered-by-mobile-${order.id}`}><Truck className="w-3 h-3 inline mr-1" />{getOrderCompletionByLabel(order.deliveryType)}: <span className="font-medium text-foreground">{formatActorLabel(order.deliveryBy)}</span>{order.deliveryDate && <span className="text-muted-foreground"> • {format(new Date(order.deliveryDate), "MMM d, hh:mm a")}</span>}</span>
                              )}
                            </div>

                            {/* Expected D&T - Centered - Clickable to edit */}
                            <div
                              className={`flex items-center justify-center py-2 rounded-lg border cursor-pointer hover-elevate ${
                                order.expectedDeliveryAt
                                  ? "bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-200 dark:border-blue-800"
                                  : "bg-muted/30 border-dashed border-muted-foreground/30"
                              }`}
                              onClick={() => {
                                if (order.delivered) return;
                                setEditDeliveryTimeDialog(order);
                                if (order.expectedDeliveryAt) {
                                  const d = new Date(order.expectedDeliveryAt);
                                  setEditDeliveryDate(format(d, "yyyy-MM-dd"));
                                  let h = d.getHours();
                                  const period = h >= 12 ? "PM" : "AM";
                                  if (h > 12) h -= 12;
                                  if (h === 0) h = 12;
                                  setEditDeliveryHour(h.toString());
                                  setEditDeliveryMinute(d.getMinutes().toString().padStart(2, "0"));
                                  setEditDeliveryPeriod(period);
                                } else {
                                  const tomorrow = new Date();
                                  tomorrow.setDate(tomorrow.getDate() + 1);
                                  setEditDeliveryDate(format(tomorrow, "yyyy-MM-dd"));
                                  setEditDeliveryHour("6");
                                  setEditDeliveryMinute("00");
                                  setEditDeliveryPeriod("PM");
                                }
                              }}
                              data-testid={`edit-expected-delivery-mobile-${order.id}`}
                            >
                              <div className="flex items-center gap-2 text-center">
                                {!order.delivered && order.expectedDeliveryAt && new Date(order.expectedDeliveryAt).getTime() - Date.now() < 48 * 60 * 60 * 1000 && (
                                  <div className="relative shrink-0">
                                    <span className="w-2 h-2 bg-red-500 rounded-full animate-ping absolute" />
                                    <span className="w-2 h-2 bg-red-500 rounded-full block" />
                                  </div>
                                )}
                                <CalendarIcon className={`w-4 h-4 ${order.expectedDeliveryAt ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`} />
                                <div>
                                  <span className="text-xs text-muted-foreground uppercase font-medium">
                                    Expected {order.deliveryType === "delivery" ? "Delivery" : "Pickup"}
                                  </span>
                                  {order.expectedDeliveryAt ? (
                                    <p className="font-semibold text-blue-700 dark:text-blue-300">
                                      {format(new Date(order.expectedDeliveryAt), "MMM d, h:mm a")}
                                    </p>
                                  ) : (
                                    <p className="text-sm text-muted-foreground italic">Not set - tap to edit</p>
                                  )}
                                </div>
                                {order.expectedDeliveryAt && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300 font-medium">
                                    {getTimeRemaining(order.expectedDeliveryAt)}
                                  </span>
                                )}
                                {!order.delivered && (
                                  <Edit className="w-3 h-3 text-muted-foreground" />
                                )}
                              </div>
                            </div>

                            {/* Items & Delivery Info Row */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button data-testid={`button-items-popup-${order.id}`}>
                                      {(() => {
                                        const completionSummary = getOrderItemCompletionSummary(order);
                                        const total = completionSummary.totalQuantity;
                                        const completed = completionSummary.completedQuantity;
                                        return completed > 0 && completed >= total ? (
                                          <Badge variant="outline" className="gap-1 cursor-pointer bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700">
                                            <CheckCircle className="w-3 h-3" />
                                            {total} items
                                          </Badge>
                                        ) : completed > 0 ? (
                                          <Badge variant="outline" className="gap-1 cursor-pointer bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700">
                                            <Package className="w-3 h-3" />
                                            {completed}/{total} done
                                          </Badge>
                                        ) : (
                                          <Badge variant="outline" className="gap-1 cursor-pointer">
                                            <Package className="w-3 h-3" />
                                            {total} items
                                          </Badge>
                                        );
                                      })()}
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-80 p-0" align="start">
                                    <div className="p-3">
                                      <h4 className="font-semibold text-sm mb-2">Order Items</h4>
                                      <div className="space-y-1 max-h-60 overflow-y-auto">
                                        {(() => {
                                          const checkedSet = new Set<number>((() => { try { return JSON.parse(order.checkedItems || "[]"); } catch { return []; } })());
                                          const pickupStatusRaw = order.itemPickupStatus || "{}";
                                          const pickupStatusMap = parseItemPickupStatusMap(pickupStatusRaw);
                                          return items.map((item, idx) => {
                                            const isDelivered = order.delivered === true;
                                            const isChecked = isDelivered || checkedSet.has(idx);
                                            const isUrgentItem = item.name.includes("*URG*");
                                            const isDeliveryOrder = order.deliveryType === "delivery";
                                            const doneStatus = isDeliveryOrder ? "delivered" : "picked_up";
                                            const itemCompletedQuantity = getItemPickupCompletedQuantityFromMap(
                                              pickupStatusMap,
                                              idx,
                                              item.quantity,
                                              doneStatus,
                                              isDelivered,
                                            );
                                            const isDone = itemCompletedQuantity >= item.quantity;
                                            return (
                                              <div key={idx} className={`flex items-center gap-2 text-sm py-1.5 border-b last:border-0 ${isChecked ? "opacity-60" : ""}`}>
                                                <Checkbox
                                                  checked={isChecked}
                                                  disabled={isDelivered}
                                                  onCheckedChange={(checked) => {
                                                    if (isDelivered) return;
                                                    const newSet = new Set(checkedSet);
                                                    if (checked) newSet.add(idx); else newSet.delete(idx);
                                                    updateOrderMutation.mutate({ id: order.id, updates: { checkedItems: JSON.stringify(Array.from(newSet)) } });
                                                  }}
                                                  data-testid={`checkbox-mobile-item-${order.id}-${idx}`}
                                                />
                                                <span className={`flex-1 ${isChecked ? "line-through text-muted-foreground" : ""} ${isUrgentItem ? "text-red-600 dark:text-red-400 font-semibold" : "text-muted-foreground"}`}>
                                                  {isUrgentItem && <Zap className="w-3 h-3 inline mr-1" />}
                                                  {item.name}
                                                </span>
                                                <Badge variant="secondary" className="text-xs">{item.quantity}</Badge>
                                                <Badge
                                                  variant="outline"
                                                  className={`${isDelivered ? "cursor-not-allowed" : "cursor-pointer"} text-[10px] gap-0.5 ${
                                                    isDone
                                                      ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700"
                                                      : itemCompletedQuantity > 0
                                                        ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700"
                                                        : ""
                                                  }`}
                                                  onClick={() => {
                                                    if (isDelivered) return;
                                                    updateOrderMutation.mutate({
                                                      id: order.id,
                                                      updates: {
                                                        itemPickupStatus: buildItemPickupStatusJson(
                                                          pickupStatusRaw,
                                                          idx,
                                                          item.quantity,
                                                          isDone ? 0 : item.quantity,
                                                          doneStatus,
                                                        ),
                                                      },
                                                    });
                                                  }}
                                                  data-testid={`btn-pickup-status-mobile-${order.id}-${idx}`}
                                                >
                                                  {isDone
                                                    ? (isDeliveryOrder ? <><Truck className="w-3 h-3" /> Delivered</> : <><Package className="w-3 h-3" /> Taken Away</>)
                                                    : (isDeliveryOrder ? <><Truck className="w-3 h-3" /> —</> : <><Package className="w-3 h-3" /> —</>)
                                                  }
                                                </Badge>
                                              </div>
                                            );
                                          });
                                        })()}
                                      </div>
                                      {(() => {
                                        const completionSummary = getOrderItemCompletionSummary(order);
                                        const isDeliveryOrder = order.deliveryType === "delivery";
                                        return (
                                          <div className="border-t mt-2 pt-2 space-y-1">
                                            <div className="flex justify-between font-semibold text-sm">
                                              <span>Total</span>
                                              <span>{completionSummary.totalQuantity}</span>
                                            </div>
                                            {completionSummary.completedQuantity > 0 && (
                                              <div className="flex justify-between text-xs">
                                                <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                                                  {isDeliveryOrder ? <Truck className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                                                  {isDeliveryOrder ? "Delivered" : "Taken Away"}
                                                </span>
                                                <span className="font-semibold text-green-600 dark:text-green-400">{completionSummary.completedQuantity}/{completionSummary.totalQuantity}</span>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  </PopoverContent>
                                </Popover>
                                <Select
                                  value={order.deliveryType || ""}
                                  onValueChange={(newType) => {
                                    updateOrderMutation.mutate({
                                      id: order.id,
                                      updates: { deliveryType: newType },
                                    });
                                  }}
                                  disabled={order.delivered === true}
                                >
                                  <SelectTrigger
                                    className={`h-8 w-[7.75rem] shrink-0 px-2 text-[11px] font-semibold leading-none whitespace-nowrap ${order.delivered ? "opacity-60 cursor-not-allowed" : ""}`}
                                    data-testid={`select-mobile-delivery-type-${order.id}`}
                                  >
                                    <SelectValue>
                                      {order.deliveryType === "delivery" ? (
                                        <div className={mobileDeliveryTypeLabelClassName}>
                                          <Truck className="h-3 w-3 shrink-0" />
                                          Delivery
                                        </div>
                                      ) : order.deliveryType === "iron_only" ? (
                                        <div className={mobileDeliveryTypeLabelClassName}>
                                          Iron Only
                                        </div>
                                      ) : (
                                        <div className={mobileDeliveryTypeLabelClassName}>
                                          <Store className="h-3 w-3 shrink-0" />
                                          Take-away
                                        </div>
                                      )}
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="pickup" className="text-xs font-semibold">Take-away</SelectItem>
                                    <SelectItem value="delivery" className="text-xs font-semibold">Delivery</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                          </CardContent>

                          {/* Card Footer - Actions */}
                          <div className="flex items-center gap-2 px-3 pb-3 flex-wrap">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => handleDeleteOrder(order.id)}
                              title="Delete Order"
                              data-testid={`button-delete-order-${order.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className={`flex-1 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800 ${mobileTrackingActionButtonClassName}`}
                              onClick={() => generateTagReceipt(order)}
                              data-testid={`button-mobile-print-tag-${order.id}`}
                            >
                              <Tag className={mobileTrackingActionIconClassName} />
                              Print Tag
                            </Button>
                            {order.billId && linkedBillVisual.isPaid ? (
                              <div className="flex flex-1 flex-col items-stretch gap-1">
                                <span className="px-1 text-[10px] font-semibold text-muted-foreground">
                                  Bill #{linkedBill?.id ?? order.billId}
                                </span>
                                <button
                                  type="button"
                                  className={`flex items-center rounded-md border border-green-200 bg-green-50 text-green-700 transition-colors hover:border-green-300 hover:bg-green-100 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300 dark:hover:bg-green-900/40 ${mobileTrackingActionButtonClassName}`}
                                  onClick={() => openOrderBillDetailsDialog(linkedBill)}
                                  data-testid={`indicator-mobile-paid-bill-${order.id}`}
                                >
                                  <CheckCircle className={mobileTrackingActionIconClassName} />
                                  Paid
                                </button>
                              </div>
                            ) : order.billId ? (
                              <div className="flex flex-1 flex-col items-stretch gap-1">
                                <span className="px-1 text-[10px] font-semibold text-muted-foreground">
                                  Bill #{linkedBill?.id ?? order.billId}
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className={`w-full border-primary/25 bg-primary/5 text-primary ${mobileTrackingActionButtonClassName}`}
                                  onClick={() => openOrderBillDetailsDialog(linkedBill)}
                                  data-testid={`button-mobile-bill-${order.id}`}
                                >
                                  <Wallet className={mobileTrackingActionIconClassName} />
                                  Pay
                                </Button>
                              </div>
                            ) : null}
                            {!order.tagDone && (
                              <Button
                                size="sm"
                                variant="outline"
                                className={`flex-1 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 ${mobileTrackingActionButtonClassName}`}
                                onClick={() =>
                                  setStageChecklistDialog({
                                    order,
                                    stage: "tagging",
                                  })
                                }
                                data-testid={`button-mobile-checklist-tagging-${order.id}`}
                              >
                                <CheckCircle2 className={mobileTrackingActionIconClassName} />
                                Tagging List
                              </Button>
                            )}

                            {order.tagDone && !order.packingDone && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className={`flex-1 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800 ${mobileTrackingActionButtonClassName}`}
                                  onClick={() => {
                                    updateOrderMutation.mutate({
                                      id: order.id,
                                      updates: { washingDone: true, washingDate: new Date().toISOString() },
                                    });
                                    generateWashingReceipt(order);
                                  }}
                                  data-testid={`button-mobile-washing-${order.id}`}
                                >
                                  <Printer className={mobileTrackingActionIconClassName} />
                                  Washing
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className={`flex-1 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 ${mobileTrackingActionButtonClassName}`}
                                  onClick={() =>
                                    setStageChecklistDialog({
                                      order,
                                      stage: "packing",
                                    })
                                  }
                                  data-testid={`button-mobile-checklist-${order.id}`}
                                >
                                  <CheckCircle2 className={mobileTrackingActionIconClassName} />
                                  Packing List
                                </Button>
                              </>
                            )}

                            {order.packingDone &&
                              !order.delivered &&
                              order.deliveryType === "delivery" && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  className={`flex-1 ${mobileTrackingActionButtonClassName}`}
                                  onClick={() =>
                                    canDeliver && handleDeliveryWithPin(order.id)
                                  }
                                  disabled={!canDeliver}
                                  title={!canDeliver ? "Only drivers can confirm delivery" : ""}
                                  data-testid={`button-mobile-deliver-${order.id}`}
                                >
                                  <Truck className={mobileTrackingActionIconClassName} />
                                  Deliver
                                </Button>
                              )}

                            {order.packingDone &&
                              !order.delivered &&
                              order.deliveryType !== "delivery" && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  className={`flex-1 ${mobileTrackingActionButtonClassName}`}
                                  onClick={() => handleDeliveryWithPin(order.id)}
                                  data-testid={`button-mobile-pickup-${order.id}`}
                                >
                                  <Package className={mobileTrackingActionIconClassName} />
                                  Ready for Pickup
                                </Button>
                              )}

                            {order.delivered && (
                              <>
                                <div className="flex-1 flex flex-col">
                                  <Button
                                    size="sm"
                                    variant="default"
                                    className={`w-full bg-green-600 hover:bg-green-600 cursor-default ${mobileTrackingActionButtonClassName}`}
                                    disabled
                                  >
                                    <CheckCircle2 className={mobileTrackingActionIconClassName} />
                                    {getOrderCompletedStatusLabel(order.deliveryType)}
                                  </Button>
                                  {formatActorLabel(order.deliveryBy) && (
                                    <span className="text-xs text-muted-foreground text-center mt-1">
                                      {getOrderCompletionByLabel(order.deliveryType)}: {formatActorLabel(order.deliveryBy)}
                                      {order.deliveryDate && <span className="block">{format(new Date(order.deliveryDate), "MMM d, yyyy • hh:mm a")}</span>}
                                    </span>
                                  )}
                                </div>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setViewPhotoOrder(order)}
                                  data-testid={`button-mobile-photo-${order.id}`}
                                >
                                  <Camera
                                    className={`w-4 h-4 ${(order.deliveryPhotos && order.deliveryPhotos.length > 0) || order.deliveryPhoto ? "text-blue-600" : "text-muted-foreground"}`}
                                  />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className={orderHasIncident(order.id) ? "text-orange-500" : "text-muted-foreground"}
                                  onClick={() => handleReportIncident(order)}
                                  data-testid={`button-mobile-report-incident-${order.id}`}
                                  title="Report Incident"
                                >
                                  <AlertTriangle className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="text-red-500 hover:text-red-700"
                                  onClick={() => {
                                    setUndoDeliveryDialog(order);
                                    setUndoDeliveryPin("");
                                    setUndoDeliveryPinError("");
                                  }}
                                  title="Undo Delivery"
                                  data-testid={`button-mobile-undo-delivery-${order.id}`}
                                >
                                  <Undo2 className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                    {filteredOrders && filteredOrders.length > 0 && (
                      renderOrderFooterSummary("orders-total-amount-mobile")
                    )}
                  </div>
                  )}

                  {/* Desktop Table Layout */}
                  {!isMobile && (
                  <Card className="responsive-card flex flex-col flex-1 min-h-0 overflow-hidden">
                    <div className="relative flex-1 min-h-0">
                      <div
                        ref={desktopOrdersTableScrollRef}
                        tabIndex={-1}
                        className="h-full min-h-0 overflow-auto"
                        onScroll={(event) => {
                          desktopOrdersScrollTopRef.current = event.currentTarget.scrollTop;
                          updateDesktopOrdersJumperVisibility(event.currentTarget);
                          maybeLoadMoreOrders(event.currentTarget);
                        }}
                      >
                      <Table className="w-full min-w-max">
                        <TableHeader>
                          <TableRow className="transition-all duration-200 text-xs">
                            <TableHead className="w-[32px] px-1">
                              <Checkbox
                                checked={allVisibleOrdersSelected}
                                onCheckedChange={() => toggleAllOrders(visibleOrders)}
                                data-testid="checkbox-select-all-orders"
                              />
                            </TableHead>
                            <TableHead className="w-[80px] px-1">
                              Date
                            </TableHead>
                            <TableHead className="w-[65px] px-1">
                              Order
                            </TableHead>
                            <TableHead className="hidden md:table-cell w-[55px] px-1">
                              Bill
                            </TableHead>
                            <TableHead className="w-[100px] px-1">
                              Client
                            </TableHead>
                            {activeTab === "for-delivery" && (
                              <TableHead className="w-[100px] px-1">
                                Address
                              </TableHead>
                            )}
                            {activeTab === "for-delivery" && (
                              <TableHead className="w-[80px] px-1">
                                Phone
                              </TableHead>
                            )}
                            <TableHead className="w-[40px] px-1">
                              Items
                            </TableHead>
	                            {activeTab !== "create" && (
	                              <TableHead className="hidden md:table-cell w-[65px] px-1">
	                                Work Rec.
	                              </TableHead>
	                            )}
	                            {activeTab !== "create" && (
	                              <TableHead className="hidden md:table-cell w-[65px] px-1">
	                                Delivery
	                              </TableHead>
	                            )}
	                            {activeTab !== "create" && (
	                              <TableHead className="hidden md:table-cell w-[60px] px-1">
	                                Discount
                              </TableHead>
                            )}
                            {activeTab !== "create" && (
                              <TableHead className="hidden md:table-cell w-[70px] px-1">
                                Final Amt
                              </TableHead>
                            )}
                            <TableHead className="hidden md:table-cell w-[65px] px-1">
                              Priority
                            </TableHead>
                            <TableHead className="hidden md:table-cell w-[65px] px-1">
                              Type
                            </TableHead>
                            <TableHead className="hidden md:table-cell w-[80px] px-1">
                              Expected
                            </TableHead>
                            <TableHead className="w-[65px] px-1">
                              Status
                            </TableHead>
                            <TableHead className="hidden md:table-cell w-[80px] px-1">
                              Ready D&T
                            </TableHead>
                            <TableHead className="w-[90px] px-1">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(() => {
                            return visibleOrders?.map((order, idx) => {
                                  const client = order.clientId
                                    ? clientMap.get(order.clientId)
                                    : null;
                                  const linkedBill = order.billId
                                    ? billsById.get(order.billId)
                                    : undefined;
                                  const linkedBillVisual = getOrderBillVisualMeta(linkedBill);
                                  const clientIsBroker = isBrokerClient(client);
                                  const displayName =
                                    client?.name ||
                                    order.customerName ||
                                    "Walk-in Customer";
                                  const rowNumber = pageStartIndex + idx;
                                  return (
                                  <TableRow
                                    key={order.id}
                                    className={`${order.urgent ? "bg-red-100/80 dark:bg-red-950/40 border-l-4 border-l-red-500" : ""} ${selectedOrderIds.has(order.id) ? "bg-primary/5" : ""} ${highlightedOrderId === order.id ? "order-focus-row" : ""}`}
                                    data-order-id={order.id}
                                    data-testid={`row-order-${order.id}`}
                                    onClickCapture={(event) => handleTrackingOrderShortcutSelectionCapture(event, order)}
                                  >
                                    <TableCell className="px-1">
                                      <Checkbox
                                        checked={selectedOrderIds.has(order.id)}
                                        onCheckedChange={() => toggleOrderSelection(order.id)}
                                        data-testid={`checkbox-select-order-${order.id}`}
                                      />
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground px-1">
                                      <div className="flex flex-col">
                                        <div className="flex items-center gap-1">
                                          <span className="font-bold text-foreground text-sm" data-testid={`text-row-number-${order.id}`}>{rowNumber}.</span>
                                        </div>
                                        {order.entryDate && (
                                          <>
                                            <span>{format(new Date(order.entryDate), "MMM dd, yyyy")}</span>
                                            <span>{format(new Date(order.entryDate), "h:mm a")}</span>
                                          </>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell className="font-mono font-bold text-xs truncate px-1">
                                      <div className="flex items-center gap-1">
                                        <button
                                          className={`text-primary hover:underline cursor-pointer ${highlightedOrderId === order.id ? "animate-order-focus-text" : ""}`}
                                          onClick={(event) => handleOrderDetailShortcutClick(event, order)}
                                          data-testid={`button-order-detail-table-${order.id}`}
                                        >
                                          {order.orderNumber.replace("ORD-", "")}
                                        </button>
                                        <button
                                          className="text-orange-600 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-300"
                                          onClick={() => generateTagReceipt(order)}
                                          title="Download Tag"
                                          data-testid={`button-download-tag-table-${order.id}`}
                                        >
                                          <Download className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell px-1">
                                      {order.billId ? (
                                        <div className="flex flex-col items-start gap-1">
                                          <span className="pl-1 text-[10px] font-semibold text-muted-foreground">
                                            Bill #{linkedBill?.id ?? order.billId}
                                          </span>
                                          {linkedBillVisual.isPaid ? (
                                            <button
                                              type="button"
                                              className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 text-xs font-semibold text-green-700 transition-colors hover:border-green-300 hover:bg-green-100 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300 dark:hover:bg-green-900/40"
                                              onClick={() => openOrderBillDetailsDialog(linkedBill)}
                                              data-testid={`indicator-paid-bill-${order.billId}`}
                                            >
                                              <CheckCircle className="h-3.5 w-3.5" />
                                              Paid
                                            </button>
                                          ) : (
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className={`h-7 gap-1 px-2 text-xs font-semibold ${
                                                linkedBillVisual.isPartial
                                                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
                                                  : "border-primary/25 bg-primary/5 text-primary"
                                              }`}
                                              onClick={() => openOrderBillDetailsDialog(linkedBill)}
                                              data-testid={`button-bill-${order.billId}`}
                                            >
                                              <Wallet className="h-3.5 w-3.5" />
                                              Pay
                                              {linkedBillVisual.isPartial && (
                                                <span className="text-[9px] font-bold">PP</span>
                                              )}
                                            </Button>
                                          )}
                                          {(() => {
                                            return linkedBill?.isPaid || parseFloat(linkedBill?.paidAmount || "0") > 0 ? (
                                              <span className="text-[10px] text-muted-foreground pl-1">
                                                Bill Recorded By: {getBillRecordedByLabel(linkedBill)}
                                              </span>
                                            ) : null;
                                          })()}
                                        </div>
                                      ) : (
                                        <span className="text-muted-foreground text-xs">
                                          -
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell className="p-0">
                                          <Popover>
                                            <PopoverTrigger asChild>
                                              <Button
                                                variant="ghost"
                                                className="w-full h-auto justify-start px-1 lg:px-2 py-1 font-semibold touch-manipulation"
                                                data-testid={`button-client-${order.id}`}
                                              >
                                                <div className="flex flex-col items-start text-left w-full">
                                                  <div className="flex items-center gap-1 w-full">
                                                    <User className="w-3 h-3 lg:w-4 lg:h-4 mr-1 shrink-0" />
                                                    <span className="truncate text-xs lg:text-sm max-w-[80px] lg:max-w-[120px] font-semibold">
                                                      {displayName}
                                                    </span>
                                                    {clientIsBroker && (
                                                      <Badge
                                                        variant="outline"
                                                        className="h-4 shrink-0 border-violet-300 bg-violet-50 px-1.5 text-[9px] text-violet-700 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-300"
                                                      >
                                                        Broker
                                                      </Badge>
                                                    )}
                                                  </div>
                                                  {client?.company && (
                                                    <div className="flex items-center gap-0.5">
                                                      <Building2 className="w-2.5 h-2.5 text-blue-600 dark:text-blue-400 shrink-0" />
                                                      <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium truncate max-w-[90px] lg:max-w-[130px]">
                                                        {client.company}
                                                      </span>
                                                    </div>
                                                  )}
                                                  {getDisplayPhone(client?.phone) && (
                                                    <div className="flex items-center gap-0.5">
                                                      <Phone className="h-2.5 w-2.5 shrink-0 text-cyan-500 dark:text-cyan-400" />
                                                      <span className="text-[10px] text-muted-foreground truncate max-w-[90px] lg:max-w-[130px]">
                                                        {getDisplayPhone(client?.phone)}
                                                      </span>
                                                    </div>
                                                  )}
                                                  {getOrderDisplayAddress(order, client) && (
                                                    <div className="flex items-center gap-0.5">
                                                      <MapPin className="h-2.5 w-2.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
                                                      <span className="text-[10px] text-muted-foreground truncate max-w-[90px] lg:max-w-[130px]">
                                                        {getOrderDisplayAddress(order, client)}
                                                      </span>
                                                    </div>
                                                  )}
                                                </div>
                                              </Button>
                                            </PopoverTrigger>
                                            <PopoverContent
                                              className="w-80"
                                              align="start"
                                            >
                                              <div className="space-y-3">
                                                <div className="flex items-center gap-2 border-b pb-2">
                                                  <User className="w-5 h-5 text-primary" />
                                                  <div>
                                                    <p className="font-semibold flex items-center gap-2 flex-wrap">
                                                      <span>{client?.name || displayName}</span>
                                                      {clientIsBroker && (
                                                        <Badge
                                                          variant="outline"
                                                          className="h-5 border-violet-300 bg-violet-50 px-2 text-[10px] text-violet-700 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-300"
                                                        >
                                                          Broker Account
                                                        </Badge>
                                                      )}
                                                    </p>
                                                    {client?.company && (
                                                      <p className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400">
                                                        <Building2 className="h-3 w-3 shrink-0 text-blue-500 dark:text-blue-400" />
                                                        {client.company}
                                                      </p>
                                                    )}
                                                    {client?.billNumber && (
                                                      <p className="text-xs text-muted-foreground">
                                                        Account: {client.billNumber}
                                                      </p>
                                                    )}
                                                    {getDisplayPhone(client?.phone) && (
                                                      <p className="flex items-center gap-1 text-sm text-muted-foreground">
                                                        <Phone className="h-3 w-3 shrink-0 text-cyan-500 dark:text-cyan-400" />
                                                        {getDisplayPhone(client?.phone)}
                                                      </p>
                                                    )}
                                                    {getOrderDisplayAddress(order, client) && (
                                                      <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                                                        <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500 dark:text-emerald-400" />
                                                        <span>{getOrderDisplayAddress(order, client)}</span>
                                                      </p>
                                                    )}
                                                  </div>
                                                </div>
                                                <div className="flex justify-between items-center gap-2">
                                                  <span className="text-sm">
                                                    Bill Balance:
                                                  </span>
                                                  <span
                                                    className={`font-bold ${client && getClientDueBalance(client.id) === 0 ? "text-green-600" : "text-red-600"}`}
                                                  >
                                                    {client ? getClientDueBalance(client.id).toFixed(2) : "0.00"}{" "}
                                                    AED
                                                  </span>
                                                </div>
                                                {client && (
                                                  <>
                                                    <Button
                                                      variant="outline"
                                                      size="sm"
                                                      className="w-full mt-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                                                      data-testid={`link-desktop-client-history-${client.id}`}
                                                      onClick={() => openClientTransactions(client.id)}
                                                    >
                                                      <ExternalLink className="w-3 h-3 mr-1" />
                                                      Account Activity
                                                    </Button>
                                                    <Button
                                                      variant="outline"
                                                      size="sm"
                                                      className="w-full text-amber-600 border-amber-200 hover:bg-amber-50"
                                                      data-testid={`link-desktop-client-edit-${client.id}`}
                                                      onClick={() => openClientEdit(client.id)}
                                                    >
                                                      <Edit className="w-3 h-3 mr-1" />
                                                      Edit Account Details
                                                    </Button>
                                                  </>
                                                )}
                                              </div>
                                            </PopoverContent>
                                          </Popover>
                                        </TableCell>
                                        {activeTab === "for-delivery" && (
                                          <TableCell
                                            className="text-xs text-muted-foreground"
                                          >
                                            <div className="truncate max-w-[150px]" title={getOrderDisplayAddress(order, client)}>
                                              {getOrderDisplayAddress(order, client)}
                                            </div>
                                          </TableCell>
                                        )}
                                        {activeTab === "for-delivery" && (
                                          <TableCell
                                            className="text-xs"
                                          >
                                            {getDisplayPhone(client?.phone) ? (
                                              <a href={`tel:${getDisplayPhone(client?.phone)}`} className="text-blue-600 hover:underline">
                                                {getDisplayPhone(client?.phone)}
                                              </a>
                                            ) : null}
                                          </TableCell>
                                        )}
                                    <TableCell>
                                      <Popover>
                                        <PopoverTrigger asChild>
                                          <button className="flex items-center gap-1 text-xs sm:text-sm cursor-pointer hover:underline" data-testid={`button-items-popup-table-${order.id}`}>
                                            {(() => {
                                              const completionSummary = getOrderItemCompletionSummary(order);
                                              const total = completionSummary.totalQuantity;
                                              const completed = completionSummary.completedQuantity;
                                              return completed > 0 && completed >= total ? (
                                                <><CheckCircle className="w-3 h-3 text-green-600" /><span className="font-medium text-green-600">{total}</span></>
                                              ) : completed > 0 ? (
                                                <><Package className="w-3 h-3 text-blue-600" /><span className="font-medium text-blue-600">{completed}/{total}</span></>
                                              ) : (
                                                <><Package className="w-3 h-3 text-muted-foreground" /><span className="font-medium">{total}</span></>
                                              );
                                            })()}
                                          </button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-80 p-0" align="start">
                                          <div className="p-3">
                                            <h4 className="font-semibold text-sm mb-2">Order Items</h4>
                                            <div className="space-y-1 max-h-60 overflow-y-auto">
                                              {(() => {
                                                const checkedSet = new Set<number>((() => { try { return JSON.parse(order.checkedItems || "[]"); } catch { return []; } })());
                                                const parsedItems = parseOrderItems(order.items);
                                                const pickupStatusMap = parseItemPickupStatusMap(order.itemPickupStatus);
                                                return parsedItems.map((item, idx) => {
                                                  const isDelivered = order.delivered === true;
                                                  const isChecked = isDelivered || checkedSet.has(idx);
                                                  const isUrgentItem = item.name.includes("*URG*");
                                                  const isDeliveryOrder = order.deliveryType === "delivery";
                                                  const doneStatus = isDeliveryOrder ? "delivered" : "picked_up";
                                                  const itemCompletedQuantity = getItemPickupCompletedQuantityFromMap(
                                                    pickupStatusMap,
                                                    idx,
                                                    item.quantity,
                                                    doneStatus,
                                                    isDelivered,
                                                  );
                                                  const isDone = itemCompletedQuantity >= item.quantity;
                                                  const hasPartialDone = itemCompletedQuantity > 0 && !isDone;
                                                  return (
                                                    <div key={idx} className={`flex items-center gap-2 text-sm py-1.5 border-b last:border-0 ${isChecked ? "opacity-60" : ""}`}>
                                                      <Checkbox
                                                        checked={isChecked}
                                                        disabled={isDelivered}
                                                        onCheckedChange={(checked) => {
                                                          if (isDelivered) return;
                                                          const newSet = new Set(checkedSet);
                                                          if (checked) newSet.add(idx); else newSet.delete(idx);
                                                          updateOrderMutation.mutate({ id: order.id, updates: { checkedItems: JSON.stringify(Array.from(newSet)) } });
                                                        }}
                                                        data-testid={`checkbox-item-${order.id}-${idx}`}
                                                      />
                                                      <span className={`flex-1 ${isChecked ? "line-through text-muted-foreground" : ""} ${isUrgentItem ? "text-red-600 dark:text-red-400 font-semibold" : "text-muted-foreground"}`}>
                                                        {isUrgentItem && <Zap className="w-3 h-3 inline mr-1" />}
                                                        {item.name}
                                                      </span>
                                                      <Badge variant="secondary" className="text-xs">{item.quantity}</Badge>
                                                      <div className="flex items-center gap-1">
                                                        {!isDelivered && itemCompletedQuantity > 0 && (
                                                          <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="outline"
                                                            className="h-6 w-6"
                                                            onClick={() =>
                                                              updateOrderItemCompletedQuantity(
                                                                order,
                                                                idx,
                                                                item.quantity,
                                                                itemCompletedQuantity - 1,
                                                              )
                                                            }
                                                            data-testid={`button-pickup-minus-${order.id}-${idx}`}
                                                          >
                                                            <Minus className="w-3 h-3" />
                                                          </Button>
                                                        )}
                                                        <Button
                                                          type="button"
                                                          size="sm"
                                                          variant="outline"
                                                          disabled={isDelivered || (item.quantity > 1 && itemCompletedQuantity >= item.quantity)}
                                                          className={`h-6 px-2 text-[10px] gap-1 ${
                                                          isDone
                                                            ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700"
                                                            : hasPartialDone
                                                              ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700"
                                                              : ""
                                                        }`}
                                                          onClick={() => {
                                                            if (isDelivered) return;
                                                            const nextCompletedQuantity =
                                                              item.quantity > 1
                                                                ? Math.min(item.quantity, itemCompletedQuantity + 1)
                                                                : isDone
                                                                  ? 0
                                                                  : 1;
                                                            updateOrderItemCompletedQuantity(
                                                              order,
                                                              idx,
                                                              item.quantity,
                                                              nextCompletedQuantity,
                                                            );
                                                          }}
                                                          data-testid={`btn-pickup-status-${order.id}-${idx}`}
                                                        >
                                                          {item.quantity > 1 ? (
                                                            <>
                                                              {isDeliveryOrder ? <Truck className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                                                              {`${itemCompletedQuantity}/${item.quantity}`}
                                                            </>
                                                          ) : isDone ? (
                                                            isDeliveryOrder ? <><Truck className="w-3 h-3" /> Delivered</> : <><Package className="w-3 h-3" /> Taken Away</>
                                                          ) : (
                                                            isDeliveryOrder ? <><Truck className="w-3 h-3" /> -</> : <><Package className="w-3 h-3" /> -</>
                                                          )}
                                                        </Button>
                                                      </div>
                                                    </div>
                                                  );
                                                });
                                              })()}
                                            </div>
                                            {(() => {
                                              const completionSummary = getOrderItemCompletionSummary(order);
                                              const isDeliveryOrder = order.deliveryType === "delivery";
                                              return (
                                                <div className="border-t mt-2 pt-2 space-y-1">
                                                  <div className="flex justify-between font-semibold text-sm">
                                                    <span>Total</span>
                                                    <span>{completionSummary.totalQuantity}</span>
                                                  </div>
                                                  {completionSummary.completedQuantity > 0 && (
                                                    <div className="flex justify-between text-xs">
                                                      <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                                                        {isDeliveryOrder ? <Truck className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                                                        {isDeliveryOrder ? "Delivered" : "Taken Away"}
                                                      </span>
                                                      <span className="font-semibold text-green-600 dark:text-green-400">{completionSummary.completedQuantity}/{completionSummary.totalQuantity}</span>
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })()}
                                          </div>
                                        </PopoverContent>
                                      </Popover>
                                    </TableCell>
	                                    {activeTab !== "create" && (
	                                      <TableCell
	                                        className="hidden md:table-cell text-xs px-1"
	                                        data-testid={`text-work-received-${order.id}`}
	                                      >
	                                        {getOrderWorkReceivedAmount(order).toFixed(2)} AED
	                                      </TableCell>
	                                    )}
	                                    {activeTab !== "create" && (
	                                      <TableCell
	                                        className="hidden md:table-cell text-xs px-1"
	                                        data-testid={`text-delivery-charge-${order.id}`}
	                                      >
	                                        {(() => {
	                                          const charge = getOrderDeliveryChargeAmount(order);
	                                          return charge > 0.009 ? (
	                                            <span className="text-blue-600 dark:text-blue-400">{charge.toFixed(2)} AED</span>
	                                          ) : (
	                                            <span className="text-muted-foreground">-</span>
	                                          );
	                                        })()}
	                                      </TableCell>
	                                    )}
	                                    {activeTab !== "create" && (
	                                      <TableCell
                                        className={`hidden md:table-cell text-xs px-1 ${(() => {
                                          const orderBill = bills?.find((b) => b.id === order.billId);
                                          return order.billId && !orderBill?.isPaid
                                            ? "cursor-pointer hover:underline"
                                            : "";
                                        })()}`}
                                        data-testid={`text-discount-${order.id}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openOrderDiscountEdit(order);
                                        }}
                                      >
                                        {editingDiscountOrderId === order.id ? (
                                          <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            autoFocus
                                            value={editingDiscountValue}
                                            onChange={(e) => setEditingDiscountValue(e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            onBlur={cancelOrderDiscountEdit}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                void submitOrderDiscountEdit(order);
                                              }
                                              if (e.key === "Escape") {
                                                cancelOrderDiscountEdit();
                                              }
                                            }}
                                            disabled={updateOrderDiscountMutation.isPending}
                                            className="h-7 w-24 text-xs text-right"
                                            data-testid={`input-discount-${order.id}`}
                                          />
                                        ) : (
                                          (() => {
                                            const disc = getOrderDiscountAmount(order);
                                            const orderBill = bills?.find((b) => b.id === order.billId);
                                            const editable =
                                              !!order.billId &&
                                              !orderBill?.isPaid;
                                            return (
                                              <span className="inline-flex items-center gap-1">
                                                {editable && <Edit className="w-3 h-3 text-orange-500 shrink-0" />}
                                                {disc > 0 ? (
                                                  <span className="text-orange-500">{disc.toFixed(2)} AED</span>
                                                ) : (
                                                  <span className="text-muted-foreground">-</span>
                                                )}
                                              </span>
                                            );
                                          })()
                                        )}
                                      </TableCell>
                                    )}
                                    {activeTab !== "create" && (
                                      <TableCell
                                        className="font-semibold hidden md:table-cell text-xs px-1"
                                        data-testid={`text-total-desktop-${order.id}`}
                                      >
                                        {(() => {
                                          return <>{getOrderFinalAmount(order).toFixed(2)} AED</>;
                                        })()}
                                      </TableCell>
                                    )}
                                    <TableCell className="hidden md:table-cell px-1">
                                      <span
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${order.urgent ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" : "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"} ${order.delivered ? "opacity-60" : ""}`}
                                        data-testid={`badge-toggle-priority-${order.id}`}
                                      >
                                        {order.urgent ? <><Zap className="w-3 h-3" /> Urgent</> : <><Clock className="w-3 h-3" /> Normal</>}
                                      </span>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell px-1">
                                      <Select
                                        value={order.deliveryType || ""}
                                        onValueChange={(newType) => {
                                          updateOrderMutation.mutate({
                                            id: order.id,
                                            updates: { deliveryType: newType },
                                          });
                                        }}
                                        disabled={order.delivered === true}
                                      >
                                        <SelectTrigger className={`w-28 h-7 text-xs ${order.delivered ? "opacity-60 cursor-not-allowed" : ""}`}>
                                          <SelectValue>
                                            {order.deliveryType ===
                                            "delivery" ? (
                                              <div className="flex items-center gap-1">
                                                <Truck className="w-3 h-3" />
                                                Del
                                              </div>
                                            ) : order.deliveryType === "iron_only" ? (
                                              "Iron"
                                            ) : (
                                              "Take-away"
                                            )}
                                          </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="pickup">
                                            Take-away
                                          </SelectItem>
                                          <SelectItem value="delivery">
                                            Delivery
                                          </SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell text-xs px-1">
                                      <div
                                        className={`cursor-pointer hover:underline ${order.expectedDeliveryAt ? "text-muted-foreground" : "text-muted-foreground/60 italic"}`}
                                        onClick={() => {
                                          if (order.delivered) return;
                                          setEditDeliveryTimeDialog(order);
                                          if (order.expectedDeliveryAt) {
                                            const d = new Date(order.expectedDeliveryAt);
                                            setEditDeliveryDate(format(d, "yyyy-MM-dd"));
                                            let h = d.getHours();
                                            const period = h >= 12 ? "PM" : "AM";
                                            if (h > 12) h -= 12;
                                            if (h === 0) h = 12;
                                            setEditDeliveryHour(h.toString());
                                            setEditDeliveryMinute(d.getMinutes().toString().padStart(2, "0"));
                                            setEditDeliveryPeriod(period);
                                          } else {
                                            const tomorrow = new Date();
                                            tomorrow.setDate(tomorrow.getDate() + 1);
                                            setEditDeliveryDate(format(tomorrow, "yyyy-MM-dd"));
                                            setEditDeliveryHour("6");
                                            setEditDeliveryMinute("00");
                                            setEditDeliveryPeriod("PM");
                                          }
                                        }}
                                        data-testid={`edit-expected-delivery-desktop-${order.id}`}
                                      >
                                        {order.expectedDeliveryAt ? (
                                          <div className="flex items-center gap-1">
                                            {!order.delivered && new Date(order.expectedDeliveryAt).getTime() - Date.now() < 48 * 60 * 60 * 1000 && (
                                              <div className="relative shrink-0">
                                                <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-ping absolute" />
                                                <span className="w-2.5 h-2.5 bg-red-500 rounded-full block" />
                                              </div>
                                            )}
                                            <div>
                                              <div>{format(new Date(order.expectedDeliveryAt), "MMM d, yyyy")}</div>
                                              <div>{format(new Date(order.expectedDeliveryAt), "hh:mm a")}</div>
                                            </div>
                                          </div>
                                        ) : (
                                          <span className="flex items-center gap-1">
                                            Not set <Edit className="w-3 h-3" />
                                          </span>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <div className="space-y-1">
                                        {getStatusBadge(order)}
                                        {order.notes ? (
                                          <Popover>
                                            <PopoverTrigger asChild>
                                              <button className="text-xs text-amber-600 dark:text-amber-400 max-w-[150px] truncate flex items-center gap-1 hover:underline cursor-pointer" data-testid={`button-desktop-note-${order.id}`}>
                                                <NotepadText className="w-3 h-3" /> {order.notes}
                                              </button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-72 p-0" align="start">
                                              <div className="bg-amber-50 dark:bg-amber-900/30 border-2 border-amber-200 dark:border-amber-700 rounded-lg shadow-lg">
                                                <div className="bg-amber-100 dark:bg-amber-800/50 px-3 py-1.5 border-b border-amber-200 dark:border-amber-700 rounded-t-lg flex items-center justify-between gap-2">
                                                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">Order Note</span>
                                                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-amber-700 dark:text-amber-300" onClick={() => { setEditingNoteOrderId(order.id); setEditingNoteText(order.notes || ""); }} data-testid={`button-edit-desktop-note-${order.id}`}>
                                                    <Edit className="w-3 h-3 mr-1" /> Edit
                                                  </Button>
                                                </div>
                                                <div className="p-4 min-h-[80px]" style={{ fontFamily: "Arial, sans-serif" }}>
                                                  <p className="text-sm text-amber-800 dark:text-amber-200 whitespace-pre-wrap leading-relaxed">
                                                    {order.notes}
                                                  </p>
                                                </div>
                                              </div>
                                            </PopoverContent>
                                          </Popover>
                                        ) : (
                                          <button
                                            className="text-xs text-muted-foreground flex items-center gap-1 hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer"
                                            onClick={() => { setEditingNoteOrderId(order.id); setEditingNoteText(""); }}
                                            data-testid={`button-add-desktop-note-${order.id}`}
                                          >
                                            <NotepadText className="w-3 h-3" /> Add Note
                                          </button>
                                        )}
                                        <div className="text-[10px] text-muted-foreground leading-tight" data-testid={`staff-tracking-desktop-${order.id}`}>
                                          {order.entryBy && <div data-testid={`text-created-by-${order.id}`}>Created: {order.entryBy}</div>}
                                          {order.tagBy && <div data-testid={`text-tagged-by-${order.id}`}>Tagged: {order.tagBy}</div>}
                                          {order.packingBy && <div data-testid={`text-packed-by-${order.id}`}>Packed: {order.packingBy}</div>}
                                          {formatActorLabel(order.deliveryBy) && <div data-testid={`text-delivered-by-${order.id}`}>{getOrderCompletionByLabel(order.deliveryType)}: {formatActorLabel(order.deliveryBy)}{order.deliveryDate && <span className="ml-1">• {format(new Date(order.deliveryDate), "MMM d, hh:mm a")}</span>}</div>}
                                        </div>
                                      </div>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground px-1">
                                      {order.packingDate ? (
                                        <div>
                                          <div>{format(new Date(order.packingDate), "MMM d, yyyy")}</div>
                                          <div>time: {format(new Date(order.packingDate), "hh:mm a")}</div>
                                        </div>
                                      ) : "-"}
                                    </TableCell>
                                    <TableCell className="px-1 py-1">
                                      <div className="action-buttons">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="bg-orange-100 text-orange-700 border-orange-300 whitespace-nowrap touch-manipulation"
                                          onClick={() =>
                                            generateTagReceipt(order)
                                          }
                                          data-testid={`button-print-tag-${order.id}`}
                                        >
                                          <Tag className="w-3 h-3 sm:mr-1" />
                                          <span className="hidden sm:inline">
                                            Print Tag
                                          </span>
                                        </Button>
                                        {!order.tagDone && (
                                          <>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="bg-green-100 text-green-700 border-green-300 whitespace-nowrap touch-manipulation"
                                              onClick={() =>
                                                setStageChecklistDialog({
                                                  order,
                                                  stage: "tagging",
                                                })
                                              }
                                              data-testid={`button-checklist-tagging-${order.id}`}
                                            >
                                              <CheckCircle2 className="w-3 h-3 sm:mr-1" />
                                              <span className="hidden sm:inline">
                                                Tagging List
                                              </span>
                                            </Button>
                                          </>
                                        )}
                                        {order.tagDone &&
                                          !order.packingDone && (
                                            <>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="bg-blue-100 text-blue-700 border-blue-300 whitespace-nowrap touch-manipulation"
                                                onClick={() => {
                                                  updateOrderMutation.mutate({
                                                    id: order.id,
                                                    updates: { washingDone: true, washingDate: new Date().toISOString() },
                                                  });
                                                  generateWashingReceipt(order);
                                                }}
                                                data-testid={`button-washing-receipt-${order.id}`}
                                              >
                                                <Printer className="w-3 h-3 sm:mr-1" />
                                                <span className="hidden sm:inline">
                                                  Washing
                                                </span>
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="bg-green-100 text-green-700 border-green-300 whitespace-nowrap touch-manipulation"
                                                onClick={() =>
                                                  setStageChecklistDialog({
                                                    order,
                                                    stage: "packing",
                                                  })
                                                }
                                                data-testid={`button-checklist-${order.id}`}
                                              >
                                                <CheckCircle2 className="w-3 h-3 sm:mr-1" />
                                                <span className="hidden sm:inline">
                                                  Packing List
                                                </span>
                                              </Button>
                                            </>
                                          )}
                                        {order.packingDone &&
                                          !order.delivered &&
                                          order.deliveryType === "delivery" && (
                                            <Button
                                              size="sm"
                                              variant="default"
                                              className="whitespace-nowrap touch-manipulation"
                                              onClick={() =>
                                                canDeliver && handleDeliveryWithPin(order.id)
                                              }
                                              disabled={!canDeliver}
                                              title={!canDeliver ? "Only drivers can confirm delivery" : ""}
                                              data-testid={`button-deliver-${order.id}`}
                                            >
                                              <Truck className="w-3 h-3 sm:mr-1" />
                                              <span className="hidden sm:inline">
                                                Deliver
                                              </span>
                                            </Button>
                                          )}
                                        {order.packingDone &&
                                          !order.delivered &&
                                          order.deliveryType !== "delivery" && (
                                            <Button
                                              size="sm"
                                              variant="default"
                                              className="whitespace-nowrap touch-manipulation"
                                              onClick={() => handleDeliveryWithPin(order.id)}
                                              data-testid={`button-pickup-${order.id}`}
                                            >
                                              <Package className="w-3 h-3 sm:mr-1" />
                                              <span className="hidden sm:inline">
                                                Take-away
                                              </span>
                                            </Button>
                                          )}
                                        {order.delivered && (
                                          <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                                            <div className="flex flex-col">
                                              <Button
                                                size="sm"
                                                variant="default"
                                                className="bg-green-600 hover:bg-green-600 cursor-default whitespace-nowrap"
                                                disabled
                                              >
                                                <CheckCircle2 className="w-3 h-3 sm:mr-1" />
                                                <span className="hidden sm:inline">
                                                  {getOrderCompletedStatusLabel(order.deliveryType)}
                                                </span>
                                              </Button>
                                              {formatActorLabel(order.deliveryBy) && (
                                                <span className="text-xs text-muted-foreground mt-1">
                                                  {getOrderCompletionByLabel(order.deliveryType)}: {formatActorLabel(order.deliveryBy)}
                                                  {order.deliveryDate && <span className="block">{format(new Date(order.deliveryDate), "MMM d, yyyy • hh:mm a")}</span>}
                                                </span>
                                              )}
                                            </div>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              className="shrink-0 touch-manipulation"
                                              onClick={() =>
                                                setViewPhotoOrder(order)
                                              }
                                              data-testid={`button-view-photo-${order.id}`}
                                              title={
                                                order.deliveryPhoto
                                                  ? "View Delivery Photo"
                                                  : "No photo available"
                                              }
                                            >
                                              <Camera
                                                className={`w-4 h-4 ${(order.deliveryPhotos && order.deliveryPhotos.length > 0) || order.deliveryPhoto ? "text-blue-900 dark:text-blue-400" : "text-red-500"}`}
                                              />
                                            </Button>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              className={`shrink-0 touch-manipulation ${orderHasIncident(order.id) ? "text-orange-500" : "text-muted-foreground"}`}
                                              onClick={() =>
                                                handleReportIncident(order)
                                              }
                                              data-testid={`button-report-incident-${order.id}`}
                                              title="Report Incident"
                                            >
                                              <AlertTriangle className="w-4 h-4" />
                                            </Button>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              className="text-red-500 hover:text-red-700"
                                              onClick={() => {
                                                setUndoDeliveryDialog(order);
                                                setUndoDeliveryPin("");
                                                setUndoDeliveryPinError("");
                                              }}
                                              title="Undo Delivery"
                                              data-testid={`button-undo-delivery-${order.id}`}
                                            >
                                              <Undo2 className="w-4 h-4" />
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                  );
                            });
                          })()}
                        </TableBody>
                      </Table>
                      </div>
                      {showDesktopOrdersJumpers && (
                        <div className="pointer-events-none absolute inset-y-1 right-1 z-10 flex flex-col justify-between">
                          <button
                            type="button"
                            className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background/95 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() => jumpDesktopOrdersTable("top")}
                            title="Jump to top"
                            aria-label="Jump to top"
                            data-testid="button-orders-scroll-top"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background/95 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() => jumpDesktopOrdersTable("bottom")}
                            title="Jump to bottom"
                            aria-label="Jump to bottom"
                            data-testid="button-orders-scroll-bottom"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    {filteredOrders && filteredOrders.length > 0 && (
                      renderOrderFooterSummary("orders-total-amount")
                    )}
                  </Card>
                  )}
                </>
              )}
            </TabsContent>
        </Tabs>
      </main>

      {printOrder && (
        <OrderReceipt
          order={printOrder}
          client={clients?.find((c) => c.id === printOrder.clientId)}
          onClose={() => setPrintOrder(null)}
        />
      )}

      <Dialog
        open={accountActivityClientId !== null}
        onOpenChange={(open) => {
          if (!open) setAccountActivityClientId(null);
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className={
            isMobile
              ? "flex h-[calc(100dvh-1rem)] !max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none flex-col !overflow-hidden rounded-2xl p-0"
              : "flex !max-h-[88vh] w-[min(95vw,64rem)] max-w-[64rem] flex-col !overflow-hidden p-0"
          }
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <DialogHeader className={isMobile ? "border-b px-4 pb-3 pt-4 text-center" : "px-6 pb-4 pt-5 text-center"}>
              <DialogTitle className={isMobile ? "text-lg font-display text-primary" : "text-2xl font-display text-primary"}>
                {accountActivityClient?.name || "Account"}
              </DialogTitle>
              <DialogDescription className="font-medium uppercase tracking-[0.14em]">
                Account Activity
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {accountActivityClient ? (
                <div className={isMobile ? "space-y-4 p-3.5 pb-5" : "space-y-6 p-6 pt-0"}>
                <div className={isMobile ? "grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-3" : "grid grid-cols-3 gap-4 rounded-lg bg-muted/50 p-4"}>
                  <div className={isMobile ? "rounded-lg border bg-background/90 px-2.5 py-2 text-center" : "text-center"}>
                    <p className="text-sm text-muted-foreground">Unpaid Bills</p>
                    <p className="text-xl font-bold text-blue-600">
                      {accountActivitySummary.unpaidTotal.toFixed(2)} AED
                    </p>
                  </div>
                  <div className={isMobile ? "rounded-lg border bg-background/90 px-2.5 py-2 text-center" : "text-center"}>
                    <p className="text-sm text-muted-foreground">Total Paid</p>
                    <p className="text-xl font-bold text-purple-600">
                      {accountActivitySummary.totalPaid.toFixed(2)} AED
                    </p>
                  </div>
                  <div className={isMobile ? "col-span-2 rounded-lg border bg-background/90 px-2.5 py-2 text-center" : "text-center"}>
                    <p className="text-sm text-muted-foreground">Credits Available</p>
                    <p className="text-xl font-bold text-green-600">
                      {accountActivitySummary.availableCredit.toFixed(2)} AED
                    </p>
                  </div>
                </div>

                <div className={isMobile ? "space-y-4" : "grid gap-4 lg:grid-cols-[0.9fr_1.1fr]"}>
                  <div className="rounded-lg border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h4 className="flex items-center gap-2 font-semibold text-foreground">
                        <Receipt className="h-4 w-4 text-primary" />
                        Unpaid Bills
                      </h4>
                      <Badge variant="secondary">{accountActivityUnpaidBills?.length || 0}</Badge>
                    </div>
                    {accountActivityUnpaidBillsLoading ? (
                      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading unpaid bills...
                      </div>
                    ) : accountActivityUnpaidBills && accountActivityUnpaidBills.length > 0 ? (
                      <ScrollArea className={isMobile ? "h-64" : "h-[22rem]"}>
                        <div className="space-y-2 pr-3">
                          {accountActivityUnpaidBills.map((bill) => {
                            const total = parseFloat(bill.amount || "0");
                            const paid = parseFloat(bill.paidAmount || "0");
                            const due = Math.max(0, total - paid);

                            return (
                              <div key={bill.id} className="rounded-lg border bg-background p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="font-semibold text-primary">Bill #{bill.id}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {format(new Date(bill.billDate), "dd/MM/yyyy")}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-xs text-muted-foreground">Due</p>
                                    <p className="font-semibold text-destructive">{due.toFixed(2)} AED</p>
                                  </div>
                                </div>
                                {bill.description ? (
                                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                                    {bill.description}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    ) : (
                      <div className="rounded-lg border border-dashed bg-background/80 py-8 text-center text-sm text-muted-foreground">
                        This account has 0 unpaid bills.
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h4 className="flex items-center gap-2 font-semibold text-foreground">
                        <Wallet className="h-4 w-4 text-primary" />
                        Transaction History
                      </h4>
                      <Badge variant="secondary">{accountActivityRows.length}</Badge>
                    </div>
                    {accountActivityTransactionsLoading ? (
                      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading account activity...
                      </div>
                    ) : accountActivityRows.length > 0 ? (
                      <ScrollArea className={isMobile ? "h-72" : "h-[22rem]"}>
                        <div className="space-y-2 pr-3">
                          {[...accountActivityRows].reverse().map(({ transaction, creditBalance, typeDisplay }) => {
                            const amount = parseFloat(transaction.amount || "0");
                            const amountPrefix = transaction.type === "deposit"
                              ? "+"
                              : isAccountCreditDeductionType(transaction.type)
                                ? "-"
                                : "";

                            return (
                              <div key={transaction.id} className="rounded-lg border bg-background p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-xs text-muted-foreground">
                                      {format(new Date(transaction.date), "dd/MM/yyyy HH:mm")}
                                    </p>
                                    <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${typeDisplay.color}`}>
                                      {typeDisplay.label}
                                    </span>
                                  </div>
                                  <div className="shrink-0 text-right">
                                    <p className={`text-sm font-semibold ${
                                      transaction.type === "deposit"
                                        ? "text-green-600"
                                        : isAccountCreditDeductionType(transaction.type)
                                          ? "text-orange-600"
                                          : "text-muted-foreground"
                                    }`}>
                                      {amountPrefix}{amount.toFixed(2)} AED
                                    </p>
                                    <p className={`text-[11px] font-medium ${creditBalance >= 0 ? "text-green-600" : "text-red-600"}`}>
                                      Credit Balance: {creditBalance.toFixed(2)} AED
                                    </p>
                                  </div>
                                </div>
                                <p className="mt-2 break-words text-sm leading-snug text-muted-foreground">
                                  {transaction.description || "No description"}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    ) : (
                      <div className="rounded-lg border border-dashed bg-background/80 py-8 text-center text-sm text-muted-foreground">
                        No account activity yet.
                      </div>
                    )}
                  </div>
                </div>
                </div>
              ) : (
                <div className="flex min-h-[18rem] items-center justify-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading account...
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingClientId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingClientId(null);
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-display text-primary">
              Edit Client
            </DialogTitle>
          </DialogHeader>
          {editingClient ? (
            <ClientForm
              mode="edit"
              client={editingClient}
              onSuccess={() => setEditingClientId(null)}
            />
          ) : (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading client...
            </div>
          )}
        </DialogContent>
      </Dialog>

      {newCreatedOrder && (
        <Dialog
          open={!!newCreatedOrder}
          onOpenChange={(open) => !open && setNewCreatedOrder(null)}
        >
          <DialogContent aria-describedby={undefined} className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-primary" />
                Order Created - {newCreatedOrder.orderNumber}
              </DialogTitle>
              <DialogDescription>
                Your order has been created successfully.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2 mb-4">
              <Button
                onClick={generatePDF}
                variant="default"
                data-testid="button-download-pdf"
              >
                <Download className="w-4 h-4 mr-2" />
                Download PDF
              </Button>
              <Button
                onClick={() => generateWashingReceipt(newCreatedOrder)}
                variant="secondary"
                className="bg-orange-500 hover:bg-orange-600 text-white"
                data-testid="button-washing-receipt"
              >
                <Printer className="w-4 h-4 mr-2" />
                Washing Receipt
              </Button>
              <Button
                onClick={() => navigateToOrderTracking(newCreatedOrder!, false)}
                variant="ghost"
                data-testid="button-print-tag-later"
              >
                Go to Tracking
              </Button>
            </div>
            <OrderReceipt
              order={newCreatedOrder}
              client={clients?.find((c) => c.id === newCreatedOrder.clientId)}
              onClose={() => setNewCreatedOrder(null)}
              embedded
            />
          </DialogContent>
        </Dialog>
      )}

      <Dialog
        open={!!packingPinDialog}
        onOpenChange={(open) => {
          if (!open) {
            setPackingPinDialog(null);
            clearStaffPinInput(packingPinInputRef);
            clearStaffPinPreview("packing");
            setPinError("");
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shirt className="w-5 h-5 text-primary" />
              Enter Packing PIN
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Add notes if needed, then enter your PIN to confirm packing.
            </p>
            {renderStaffPinPreview("packing")}
            <Input
              ref={packingPinInputRef}
              id="packing-pin"
              type="tel"
              inputMode="numeric"
              maxLength={5}
              placeholder="Enter 5-digit PIN"
              autoComplete="off"
              onInput={(e) => {
                normalizeStaffPinField(e);
                void updateStaffPinPreview("packing", e.currentTarget.value);
                if (pinError) setPinError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitPackingPin();
                }
              }}
              className="text-center text-2xl tracking-widest [-webkit-text-security:disc]"
              data-testid="input-packing-pin"
            />
            <Textarea
              placeholder="Notes (e.g., missing clothes, damage report...)"
              value={packingNotes}
              onChange={(e) => setPackingNotes(e.target.value)}
              className="min-h-[60px]"
              data-testid="input-packing-notes"
            />
            {pinError && (
              <p className="text-sm text-destructive text-center">{pinError}</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setPackingPinDialog(null);
                  clearStaffPinInput(packingPinInputRef);
                  clearStaffPinPreview("packing");
                  setPinError("");
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={submitPackingPin}
                disabled={verifyPinMutation.isPending}
                data-testid="button-submit-pin"
              >
                {verifyPinMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Confirm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!tagPinDialog}
        onOpenChange={(open) => {
          if (!open) {
            setTagPinDialog(null);
            clearStaffPinInput(tagPinInputRef);
            clearStaffPinPreview("tag");
            setTagPinError("");
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5 text-orange-500" />
              Enter Staff PIN
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter your staff PIN to confirm all tags are done for this order.
            </p>
            {renderStaffPinPreview("tag")}
            <Input
              ref={tagPinInputRef}
              id="tag-pin"
              type="tel"
              inputMode="numeric"
              maxLength={5}
              placeholder="Enter 5-digit PIN"
              autoComplete="off"
              onInput={(e) => {
                normalizeStaffPinField(e);
                void updateStaffPinPreview("tag", e.currentTarget.value);
                if (tagPinError) setTagPinError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitTagPin();
                }
              }}
              className="text-center text-2xl tracking-widest [-webkit-text-security:disc]"
              data-testid="input-tag-pin"
            />
            {tagPinError && (
              <p className="text-sm text-destructive text-center">
                {tagPinError}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setTagPinDialog(null);
                  clearStaffPinInput(tagPinInputRef);
                  clearStaffPinPreview("tag");
                  setTagPinError("");
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-orange-500 hover:bg-orange-600"
                onClick={submitTagPin}
                disabled={verifyTagPinMutation.isPending}
                data-testid="button-submit-tag-pin"
              >
                {verifyTagPinMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Confirm Tag
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!stageChecklistDialog}
        onOpenChange={(open) => !open && setStageChecklistDialog(null)}
      >
        <DialogContent
          ref={stageChecklistDialogContentRef}
          aria-describedby={undefined}
          tabIndex={-1}
          className="w-[96vw] max-w-4xl max-h-[92vh] overflow-y-auto px-4 py-4 sm:px-6"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => {
              stageChecklistDialogContentRef.current?.focus({ preventScroll: true });
            });
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              stageChecklistReadyToContinue &&
              (stageChecklistDialog?.stage === "tagging" ||
                stageChecklistDialog?.stage === "packing")
            ) {
              event.preventDefault();
              event.stopPropagation();
              triggerStageChecklistContinue();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-blue-500" />
              Stage Checklist -{" "}
              {stageChecklistDialog?.stage
                ? stageChecklistDialog.stage.charAt(0).toUpperCase() +
                  stageChecklistDialog.stage.slice(1)
                : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Please verify all items before marking this stage as complete.
            </p>
            {stageChecklistDialog && (
              <StageChecklist
                orderId={stageChecklistDialog.order.id}
                orderNumber={stageChecklistDialog.order.orderNumber}
                stage={stageChecklistDialog.stage}
                items={stageChecklistDialog.order.items}
                onComplete={() => {
                  toast({
                    title: "Checklist Complete",
                    description: `All items verified for ${stageChecklistDialog.stage}`,
                  });
                }}
                onCompletionChange={setStageChecklistReadyToContinue}
              />
            )}
            <div className="flex gap-2">
              {stageChecklistDialog?.stage === "tagging" && (
                <Button
                  variant="default"
                  className="flex-1"
                  onClick={triggerStageChecklistContinue}
                  disabled={!stageChecklistReadyToContinue}
                  data-testid="button-checklist-tag-done"
                >
                  <CheckCircle2 className="w-4 h-4 mr-1" />
                  Tag Done
                </Button>
              )}
              {stageChecklistDialog?.stage === "packing" && (
                <Button
                  variant="default"
                  className="flex-1"
                  onClick={triggerStageChecklistContinue}
                  disabled={!stageChecklistReadyToContinue}
                  data-testid="button-checklist-pack-done"
                >
                  <Package className="w-4 h-4 mr-1" />
                  Pack Done
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deliveryPinDialog}
        onOpenChange={(open) => {
          if (!open) {
            setDeliveryPinDialog(null);
            clearDeliveryPhotos();
            clearStaffPinPreview("delivery");
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-primary" />
              Confirm Delivery
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-800 dark:text-amber-200 font-medium flex items-center gap-1">
                <AlertTriangle className="w-4 h-4" />
                This action cannot be undone
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                Order status and delivery type cannot be changed after confirmation.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Camera className="w-4 h-4" />
                Delivery Photo (Optional)
              </Label>

              {deliveryPhotoPreviews.length > 0 ? (
                <div className="relative w-full">
                  <img
                    src={deliveryPhotoPreviews[0]}
                    alt="Delivery proof"
                    className="w-full h-32 object-cover rounded-lg border"
                  />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-2 right-2 h-7 w-7"
                    onClick={() => removeDeliveryPhoto(0)}
                    data-testid="button-remove-photo-0"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                  <Camera className="w-6 h-6 text-muted-foreground mb-1" />
                  <span className="text-xs text-muted-foreground">
                    Tap to open camera
                  </span>
                  <input
                    type="file"
                    accept="image/*,.heic,.heif"
                    capture="environment"
                    className="hidden"
                    onChange={handleDeliveryPhotoChange}
                    data-testid="input-delivery-photo"
                  />
                </label>
              )}
            </div>

            {/* Item Count Verification Section */}
            {deliveryPinDialog &&
              (() => {
                const order = orders?.find(
                  (o) => o.id === deliveryPinDialog.orderId,
                );
                const itemCount = order?.items
                  ? parseOrderItems(order.items).reduce(
                      (sum: number, item: any) => sum + (item.quantity || 1),
                      0,
                    )
                  : 0;
                return (
                  <div className="p-3 bg-muted rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        Item Count at Intake
                      </span>
                      <Badge
                        variant="outline"
                        className="text-lg font-bold"
                        data-testid="text-item-count"
                      >
                        {itemCount} items
                      </Badge>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="itemVerified"
                        checked={itemCountVerified}
                        onCheckedChange={(checked) =>
                          setItemCountVerified(checked === true)
                        }
                        data-testid="checkbox-item-verified"
                      />
                      <label
                        htmlFor="itemVerified"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        I confirm all {itemCount} items are present and match
                        intake
                      </label>
                    </div>
                  </div>
                );
              })()}

            {/* Delivery Address - only shown for delivery orders, not pickup */}
            {deliveryPinDialog && orders?.find(o => o.id === deliveryPinDialog.orderId)?.deliveryType === "delivery" && (
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Delivery Address
                </Label>
                <Textarea
                  value={deliveryAddress}
                  readOnly
                  className="min-h-[80px] resize-none uppercase bg-muted cursor-default"
                  data-testid="input-delivery-address"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-sm font-medium">Enter Staff PIN</Label>
              {renderStaffPinPreview("delivery")}
              <Input
                ref={deliveryPinInputRef}
                id="delivery-pin"
                type="tel"
                inputMode="numeric"
                maxLength={5}
                placeholder="Enter 5-digit PIN"
                value={deliveryPin}
                autoComplete="off"
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "").slice(0, 5);
                  setDeliveryPin(val);
                  void updateStaffPinPreview("delivery", val);
                  setDeliveryPinError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && submitDeliveryPin()}
                className="text-center text-2xl tracking-widest [-webkit-text-security:disc]"
                data-testid="input-delivery-pin"
              />
            </div>
            {deliveryPinError && (
              <p className="text-sm text-destructive text-center">
                {deliveryPinError}
              </p>
            )}
            {!itemCountVerified && (
              <p className="text-sm text-muted-foreground text-center">
                Unchecked deliveries are saved without item verification.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setDeliveryPinDialog(null);
                  clearDeliveryPhotos();
                  clearStaffPinPreview("delivery");
                }}
                data-testid="button-cancel-delivery"
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={submitDeliveryPin}
                disabled={
                  deliveryPin.length !== 5 ||
                  verifyDeliveryPinMutation.isPending
                }
                data-testid="button-submit-delivery-pin"
              >
                {verifyDeliveryPinMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Confirm Delivery
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!viewPhotoOrder}
        onOpenChange={(open) => !open && setViewPhotoOrder(null)}
      >
        <DialogContent aria-describedby={undefined} className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5" />
              Delivery Photos - Order #{viewPhotoOrder?.orderNumber}
            </DialogTitle>
            <DialogDescription>
              Photos captured at delivery confirmation
            </DialogDescription>
          </DialogHeader>
          {(viewPhotoOrder?.deliveryPhotos &&
            viewPhotoOrder.deliveryPhotos.length > 0) ||
          viewPhotoOrder?.deliveryPhoto ? (
            <div className="space-y-3">
              {viewPhotoOrder?.deliveryPhotos &&
              viewPhotoOrder.deliveryPhotos.length > 0 ? (
                <div className="grid grid-cols-1 gap-3">
                  {viewPhotoOrder.deliveryPhotos.map((photo, index) => (
                    <img
                      key={index}
                      src={photo}
                      alt={`Delivery proof ${index + 1}`}
                      className="w-full max-h-[300px] rounded-lg object-contain border"
                      data-testid={`img-delivery-photo-${index}`}
                    />
                  ))}
                </div>
              ) : viewPhotoOrder?.deliveryPhoto ? (
                <div className="flex justify-center">
                  <img
                    src={viewPhotoOrder.deliveryPhoto}
                    alt="Delivery proof"
                    className="max-w-full max-h-[400px] rounded-lg object-contain"
                    data-testid="img-delivery-photo"
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Camera className="w-12 h-12 mb-2 opacity-50" />
              <p>No delivery photos available</p>
            </div>
          )}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setViewPhotoOrder(null)}
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>

      <OrderPayBillDialogHost ref={payBillDialogRef} />

      {/* Bill Details Dialog */}
      <Dialog
        open={showBillDialog}
        onOpenChange={(open) => {
          setShowBillDialog(open);
          if (!open) {
            resetOrderBillPaymentState();
          }
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className={`w-[min(96vw,44rem)] max-w-xl max-h-[85vh] overflow-y-auto ${
            currentSelectedBill?.isPaid
              ? "bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/50 border-green-200 dark:border-green-800"
              : currentSelectedBill && parseFloat(currentSelectedBill.paidAmount || "0") > 0
                ? "bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/50 dark:to-yellow-950/50 border-amber-200 dark:border-amber-800"
                : "bg-gradient-to-br from-blue-50 to-sky-50 dark:from-blue-950/50 dark:to-sky-950/50 border-blue-200 dark:border-blue-800"
          }`}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Bill Details</DialogTitle>
            <DialogDescription>View bill details, payment status, and payment method.</DialogDescription>
          </DialogHeader>

          {currentSelectedBill && selectedBillDisplayAmounts && (() => {
            const paidAmount = selectedBillDisplayAmounts.paidAmount;
            const dueAmount = selectedBillDisplayAmounts.due;
            const hasPaidAmount = paidAmount > 0.009;
            const statusMeta = getOrderBillStatusMeta(currentSelectedBill, selectedBillDisplayAmounts);
            const latestPaymentDate = getOrderBillLatestPaymentDate(currentSelectedBill);
            const orderBillClient = currentSelectedBill.clientId
              ? clientMap.get(currentSelectedBill.clientId) || null
              : null;
            const billClientName = currentSelectedBill.customerName || orderBillClient?.name || "Walk-in";
            const accountLabel = getOrderClientAccountLabel(currentSelectedBill.clientId);
            const clientBillNumber = orderBillClient?.billNumber?.trim();
            const billPhone = getDisplayPhone(currentSelectedBill.customerPhone, orderBillClient?.phone);
            const addressLines = getOrderBillAddressLines(currentSelectedBill, orderBillClient);
            const isBroker = isBrokerClient(orderBillClient);

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
                              {currentSelectedBill.referenceNumber && (
                                <span className="truncate rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-border/60">
                                  Ref {currentSelectedBill.referenceNumber}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                              <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                Bill #{currentSelectedBill.id}
                              </span>
                              <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                {format(new Date(currentSelectedBill.billDate), isMobile ? "dd MMM yyyy" : "MMM dd, yyyy")}
                              </span>
                              {clientBillNumber && (
                                <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                  Acc {clientBillNumber}
                                </span>
                              )}
                              {currentSelectedBill.createdBy && (
                                <span className="rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
                                  By {currentSelectedBill.createdBy}
                                </span>
                              )}
                              {latestPaymentDate && (
                                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                                  Paid {formatOrderBillCreatedDate(latestPaymentDate)}
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
                  <div className="min-w-0">
                    <p className={isMobile ? "truncate text-lg font-bold" : "text-xl font-bold"}>
                      {billClientName}
                      {accountLabel && (
                        <span className="ml-2 text-sm font-normal text-muted-foreground">({accountLabel})</span>
                      )}
                    </p>
                  </div>
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Bill #</span>
                      <span className="font-medium">#{currentSelectedBill.id}</span>
                    </div>
                    {clientBillNumber && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Bill Number</span>
                        <span className="font-medium">{clientBillNumber}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Created On</span>
                      <span className="font-medium">{formatOrderBillDateTime(currentSelectedBill.billDate)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Paid On</span>
                      <span className={latestPaymentDate ? "font-medium text-green-600" : "text-muted-foreground"}>
                        {formatOrderBillPaymentDate(latestPaymentDate)}
                      </span>
                    </div>
                  </div>

                  {orderBillClient && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isBroker ? (
                          <Badge variant="secondary" className="text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border-violet-200 dark:border-violet-700">
                            Broker Account
                          </Badge>
                        ) : orderBillClient.company ? (
                          <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-700">
                            Company: {orderBillClient.company}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Regular Account
                          </Badge>
                        )}
                      </div>
                      {orderBillClient.company && (
                        <div className="flex items-center gap-2 text-sm text-blue-600">
                          <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{orderBillClient.company}</span>
                        </div>
                      )}
                      {billPhone && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{billPhone}</span>
                        </div>
                      )}
                      {addressLines.map((address, index) => (
                        <div key={`${currentSelectedBill.id}-address-${index}`} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{address}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className={`grid gap-3 ${currentSelectedBill.isPaid || hasPaidAmount ? "grid-cols-3" : "grid-cols-2"}`}>
                  <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                    <p className="text-xs text-muted-foreground">Work Received</p>
                    <p className="text-2xl font-bold text-primary">
                      {selectedBillDisplayAmounts.originalAmount.toFixed(2)} <span className="text-sm">AED</span>
                    </p>
                    {selectedBillDisplayAmounts.discount > 0 && (
                      <div className="mt-1">
                        <p className="text-xs text-orange-600">Disc: -{selectedBillDisplayAmounts.discount.toFixed(2)}</p>
                        <p className="text-sm font-semibold text-green-700">
                          Final: {selectedBillDisplayAmounts.finalAmount.toFixed(2)} AED
                        </p>
                      </div>
                    )}
                  </div>
                  <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="text-lg font-semibold">
                      {format(new Date(currentSelectedBill.billDate), "dd MMM yyyy")}
                    </p>
                  </div>
                  {(currentSelectedBill.isPaid || hasPaidAmount) && (
                    <div className={`bg-muted/50 ${isMobile ? "rounded-xl p-2.5" : "rounded-lg p-3"}`}>
                      <p className="text-xs text-muted-foreground mb-1">Payment Method</p>
                      {(() => {
                        const editablePaymentMethod = getEditableOrderPaymentMethodValue(currentSelectedBill.paymentMethod);

                        if (!editablePaymentMethod) {
                          return (
                            <div className="flex min-h-9 items-center rounded-md border bg-background px-3 py-1 text-sm font-medium leading-5">
                              <span className="whitespace-normal break-words">
                                {formatOrderPaymentMethodLabel(currentSelectedBill.paymentMethod)}
                              </span>
                            </div>
                          );
                        }

                        return (
                          <Select
                            value={editablePaymentMethod}
                            onValueChange={(value) => {
                              updateBillPaymentMethodMutation.mutate({ billId: currentSelectedBill.id, paymentMethod: value });
                              setSelectedBill({ ...currentSelectedBill, paymentMethod: value });
                            }}
                          >
                            <SelectTrigger className="h-9" data-testid="select-payment-method-order">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">Cash</SelectItem>
                              <SelectItem value="card">Card</SelectItem>
                              <SelectItem value="transfer">Bank Transfer</SelectItem>
                              {(selectedBillClientDeposit > 0.01 || editablePaymentMethod === "deposit") && (
                                <SelectItem value="deposit">Account Credit</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {currentSelectedBill.description && (
                  <BillItemsPopover
                    items={parseDescriptionItems(currentSelectedBill.description, products)}
                    rawDescription={currentSelectedBill.description}
                    title={`Bill #${currentSelectedBill.id} Items`}
                    subtitle={`${billClientName} - ${format(new Date(currentSelectedBill.billDate), "dd MMM yyyy")}`}
                    dataTestId={`button-order-bill-items-popover-${currentSelectedBill.id}`}
                    disablePortal
                  />
                )}

                {(currentSelectedBill as any).priceAdjustReason && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 rounded-lg">
                    <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold mb-1">Price Adjustment</p>
                    {selectedBillDisplayAmounts.originalAmount > 0 && (
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">Original:</span>
                        <span className="line-through text-muted-foreground">
                          {selectedBillDisplayAmounts.originalAmount.toFixed(2)} AED
                        </span>
                      </div>
                    )}
                    <div className="text-sm text-amber-700 dark:text-amber-400 italic">
                      {(currentSelectedBill as any).priceAdjustReason}
                    </div>
                  </div>
                )}

                {!currentSelectedBill.isPaid && hasPaidAmount && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 rounded-lg">
                    <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold mb-2">Payment Breakdown</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Previously Paid:</span>
                        <span className="font-medium text-green-600">{paidAmount.toFixed(2)} AED</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">New Total:</span>
                        <span className="font-medium">{selectedBillDisplayAmounts.finalAmount.toFixed(2)} AED</span>
                      </div>
                      <div className="flex justify-between border-t border-amber-200 dark:border-amber-700 pt-1 mt-1">
                        <span className="font-semibold text-amber-700 dark:text-amber-400">Amount Due:</span>
                        <span className="font-bold text-red-600">{dueAmount.toFixed(2)} AED</span>
                      </div>
                    </div>
                  </div>
                )}

                {(currentSelectedBill as any).notes && (
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
                    <p className="text-xs text-blue-700 dark:text-blue-400 font-semibold mb-2">History</p>
                    <div className="text-xs text-blue-600 dark:text-blue-300 whitespace-pre-wrap">
                      {(currentSelectedBill as any).notes}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2">
                  {!currentSelectedBill.isPaid && dueAmount > 0.009 && (
                    <Button
                      className="flex-1 bg-blue-600 hover:bg-blue-700"
                      onClick={() => {
                        setShowBillDialog(false);
                        openOrderPayBillDialog(currentSelectedBill);
                      }}
                      data-testid="button-pay-now-bill-order"
                    >
                      <DollarSign className="w-4 h-4 mr-2" />
                      Pay Now
                    </Button>
                  )}
                  {(currentSelectedBill.isPaid || hasPaidAmount) && (
                    <Button
                      variant="destructive"
                      className="flex-1"
                      disabled={editOrderRevertingPayment}
                      onClick={() => openBillPaymentRevertDialog(currentSelectedBill.id)}
                      data-testid="button-revert-payment-bill-order"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      {editOrderRevertingPayment ? "Reverting..." : "Revert Payment"}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      openOrderTransferBillDialog(currentSelectedBill);
                    }}
                    title={currentSelectedBill.clientId ? "Transfer Account" : "Assign Account"}
                    data-testid="button-open-bill-from-orders"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    {currentSelectedBill.clientId ? "Transfer Account" : "Assign Account"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      downloadBillPdfFromOrders(currentSelectedBill);
                    }}
                    data-testid="button-print-bill-summary"
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

      <Dialog
        open={!!orderTransferBillDialog}
        onOpenChange={(open) => {
          if (!open && !transferOrderBillMutation.isPending) {
            resetOrderTransferBillDialog();
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {orderTransferBillDialog?.clientId
                ? "Transfer Bill to Another Account"
                : "Assign Bill to Client Account"}
            </DialogTitle>
            <DialogDescription>
              Move this bill, its linked orders, payment records, and bill history to the correct client account.
            </DialogDescription>
          </DialogHeader>
          {orderTransferBillDialog && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Bill</span>
                  <span className="font-semibold">
                    #{orderTransferBillDialog.id}
                    {orderTransferBillDialog.referenceNumber
                      ? ` - ${orderTransferBillDialog.referenceNumber}`
                      : ""}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Current Account</span>
                  <span className="text-right font-medium">
                    {orderTransferBillDialog.clientId
                      ? (() => {
                          const currentClient = clientMap.get(orderTransferBillDialog.clientId);
                          if (!currentClient) return `Client #${orderTransferBillDialog.clientId}`;
                          return currentClient.billNumber
                            ? `${currentClient.name} (${currentClient.billNumber})`
                            : currentClient.name;
                        })()
                      : "Not assigned"}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="order-transfer-bill-client-search">Find Target Client</Label>
                <Input
                  id="order-transfer-bill-client-search"
                  value={orderTransferBillSearch}
                  onChange={(event) => setOrderTransferBillSearch(event.target.value)}
                  placeholder="Search name, account, phone, company, or address"
                  data-testid="input-order-transfer-bill-search"
                />
                <ScrollArea className="h-52 rounded-md border">
                  <div className="divide-y">
                    {orderTransferTargetClients.length > 0 ? (
                      orderTransferTargetClients.map((client) => {
                        const isSelected = Number(orderTransferTargetClientId) === client.id;
                        return (
                          <button
                            key={client.id}
                            type="button"
                            className={`flex w-full flex-col items-start gap-1 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                              isSelected ? "bg-primary/10 text-primary" : ""
                            }`}
                            onClick={() => setOrderTransferTargetClientId(String(client.id))}
                            data-testid={`option-order-transfer-bill-client-${client.id}`}
                          >
                            <span className="font-semibold">
                              {client.name}
                              {client.billNumber ? (
                                <span className="ml-1 text-xs font-normal text-muted-foreground">
                                  ({client.billNumber})
                                </span>
                              ) : null}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {[client.phone, client.company, client.address]
                                .filter(Boolean)
                                .join(" - ") || "No extra details"}
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                        No matching clients found.
                      </div>
                    )}
                  </div>
                </ScrollArea>
                {selectedOrderTransferTargetClient && (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-xs text-primary">
                    Target: {selectedOrderTransferTargetClient.name}
                    {selectedOrderTransferTargetClient.billNumber
                      ? ` (${selectedOrderTransferTargetClient.billNumber})`
                      : ""}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="order-transfer-bill-admin-pin">Admin PIN</Label>
                  <Input
                    id="order-transfer-bill-admin-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={5}
                    value={orderTransferBillAdminPin}
                    onChange={(event) =>
                      setOrderTransferBillAdminPin(
                        event.target.value.replace(/\D/g, "").slice(0, 5),
                      )
                    }
                    placeholder="5-digit PIN"
                    data-testid="input-order-transfer-bill-admin-pin"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="order-transfer-bill-reason">Reason</Label>
                  <Textarea
                    id="order-transfer-bill-reason"
                    value={orderTransferBillReason}
                    onChange={(event) => setOrderTransferBillReason(event.target.value)}
                    placeholder="Optional note"
                    className="min-h-10"
                    data-testid="input-order-transfer-bill-reason"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => resetOrderTransferBillDialog()}
              disabled={transferOrderBillMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleOrderTransferBillSubmit()}
              disabled={
                transferOrderBillMutation.isPending ||
                !orderTransferBillDialog ||
                !orderTransferTargetClientId ||
                orderTransferBillAdminPin.trim().length !== 5
              }
              data-testid="button-confirm-order-transfer-bill"
            >
              {transferOrderBillMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Transfer Bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Legacy Bill Preview Dialog (replaced by the Bills-style dialog above) */}
      <Dialog
        open={false}
        onOpenChange={(open) => {
          setShowBillDialog(open);
          if (!open) {
            resetOrderBillPaymentState();
          }
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="w-[min(96vw,44rem)] max-w-xl max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt
                className={`w-5 h-5 ${
                  getOrderBillVisualMeta(currentSelectedBill).isPartial
                    ? "text-amber-500"
                    : getOrderBillVisualMeta(currentSelectedBill).isPaid
                      ? "text-green-600"
                      : "text-primary"
                }`}
              />
              Bill #{currentSelectedBill?.id}
            </DialogTitle>
            <DialogDescription>
              Bill details and payment status
            </DialogDescription>
          </DialogHeader>
          {currentSelectedBill && selectedBillDisplayAmounts && (
            <div className="space-y-3 lg:space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">Client:</div>
                <div className="font-medium">
                  {clients?.find((c) => c.id === currentSelectedBill.clientId)?.name}
                </div>

                <div className="text-muted-foreground">Bill Date:</div>
                <div className="font-medium">
                  {format(new Date(currentSelectedBill.billDate), "dd/MM/yyyy")}
                </div>

                {selectedBillDisplayAmounts.discount > 0 ? (
                  <>
                    <div className="text-muted-foreground">Work Received:</div>
                    <div className="font-semibold">
                      {selectedBillDisplayAmounts.originalAmount.toFixed(2)} AED
                    </div>
                    <div className="text-muted-foreground">Discount:</div>
                    <div className="font-medium text-orange-600">
                      -{selectedBillDisplayAmounts.discount.toFixed(2)} AED
                      {currentSelectedBill.discountAppliedBy && <span className="text-xs text-muted-foreground ml-1">by {currentSelectedBill.discountAppliedBy}</span>}
                    </div>
                    <div className="text-muted-foreground">Final Amount:</div>
                    <div className="font-semibold text-green-700">
                      {selectedBillDisplayAmounts.finalAmount.toFixed(2)} AED
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-muted-foreground">Work Received:</div>
                    <div className="font-semibold">
                      {selectedBillDisplayAmounts.finalAmount.toFixed(2)} AED
                    </div>
                  </>
                )}

                <div className="text-muted-foreground">Paid Amount:</div>
                <div className="font-medium text-green-600">
                  {selectedBillDisplayAmounts.paidAmount.toFixed(2)} AED
                </div>

                <div className="text-muted-foreground">Balance:</div>
                <div
                  className={`font-semibold ${selectedBillDisplayAmounts.due > 0 ? "text-destructive" : "text-green-600"}`}
                >
                  {selectedBillDisplayAmounts.due.toFixed(2)} AED
                </div>

                <div className="text-muted-foreground">Status:</div>
                <div>
                  {currentSelectedBill.isPaid ? (
                    <Badge className="bg-green-500">Paid</Badge>
                  ) : selectedBillDisplayAmounts.paidAmount > 0 ? (
                    <Badge className="bg-amber-500">Partially Paid</Badge>
                  ) : (
                    <Badge className="bg-blue-500">Unpaid</Badge>
                  )}
                </div>

                {(currentSelectedBill.isPaid || selectedBillDisplayAmounts.paidAmount > 0) && (
                  <>
                    <div className="text-muted-foreground">Payment Method:</div>
                    <div>
                      {(() => {
                        const editablePaymentMethod = getEditableOrderPaymentMethodValue(currentSelectedBill.paymentMethod);

                        if (!editablePaymentMethod) {
                          return (
                            <div className="flex h-8 min-w-[130px] items-center rounded-md border bg-background px-3 text-sm font-medium">
                              {formatOrderPaymentMethodLabel(currentSelectedBill.paymentMethod)}
                            </div>
                          );
                        }

                        return (
                          <Select
                            value={editablePaymentMethod}
                            onValueChange={(value) => {
                              updateBillPaymentMethodMutation.mutate({ billId: currentSelectedBill.id, paymentMethod: value });
                              setSelectedBill({ ...currentSelectedBill, paymentMethod: value });
                            }}
                          >
                            <SelectTrigger className="h-8 w-[130px]" data-testid="select-payment-method-order">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="card">Card</SelectItem>
                            <SelectItem value="transfer">Bank Transfer</SelectItem>
                            {(selectedBillClientDeposit > 0.01 || editablePaymentMethod === "deposit") && (
                                <SelectItem value="deposit">Account Credit</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        );
                      })()}
                    </div>
                  </>
                )}

                {(currentSelectedBill.isPaid || parseFloat(currentSelectedBill.paidAmount || "0") > 0) && (
                  <>
                    <div className="text-muted-foreground">Bill Recorded By:</div>
                    <div className="font-medium">{getBillRecordedByLabel(currentSelectedBill)}</div>
                  </>
                )}
              </div>

              {currentSelectedBill.description && (
                <div className="border-t pt-3">
                  <BillItemsPopover
                    items={parseDescriptionItems(currentSelectedBill.description, products)}
                    rawDescription={currentSelectedBill.description}
                    title={`Bill #${currentSelectedBill.id} Items`}
                    subtitle={`${
                      clients?.find((c) => c.id === currentSelectedBill.clientId)?.name || "Customer"
                    } • ${format(new Date(currentSelectedBill.billDate), "dd MMM yyyy")}`}
                    dataTestId={`button-order-bill-items-popover-${currentSelectedBill.id}`}
                    disablePortal
                  />
                </div>
              )}

              {/* Previous Unpaid Bills Section */}
              {(() => {
                const currentBillDue = selectedBillDisplayAmounts.due;
                const otherUnpaidBills = bills?.filter(
                  (b) => b.clientId === currentSelectedBill.clientId &&
                         b.id !== currentSelectedBill.id &&
                         !b.isPaid
                ) || [];
                const totalPreviousDue = otherUnpaidBills.reduce((sum, b) => {
                  return sum + getBillDisplayAmounts(b).due;
                }, 0);
                const grandTotalDue = currentBillDue + totalPreviousDue;

                return (
                  <>
                    {otherUnpaidBills.length > 0 && (
                      <div className="border-t pt-3">
                        <div className="bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600" />
                            <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                              Previous Unpaid Bills ({otherUnpaidBills.length})
                            </span>
                          </div>
                          <ScrollArea className="max-h-32">
                            <div className="space-y-1">
                              {otherUnpaidBills.map((bill) => {
                                const due = getBillDisplayAmounts(bill).due;
                                return (
                                  <div
                                    key={bill.id}
                                    className="flex justify-between items-center text-sm bg-background rounded px-2 py-1"
                                  >
                                    <span className="text-muted-foreground">
                                      Bill #{bill.id} - {format(new Date(bill.billDate), "dd/MM/yy")}
                                    </span>
                                    <span className="font-medium text-destructive">
                                      {due.toFixed(2)} AED
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </ScrollArea>
                          <div className="flex justify-between items-center mt-2 pt-2 border-t border-amber-300 dark:border-amber-700">
                            <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                              Total Previous Due:
                            </span>
                            <span className="font-bold text-destructive">
                              {totalPreviousDue.toFixed(2)} AED
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Grand Total Due */}
                    <div className="border-t pt-3">
                      <div className="bg-primary/10 border border-primary/30 rounded-lg p-3">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold">Total Amount Due:</span>
                          <span className="text-xl font-bold text-primary">
                            {grandTotalDue.toFixed(2)} AED
                          </span>
                        </div>
                        {otherUnpaidBills.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            (This bill: {currentBillDue.toFixed(2)} + Previous: {totalPreviousDue.toFixed(2)})
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* Bill Recorded message for paid bills */}
              {currentSelectedBill.isPaid && !showPaymentForm && (
                <div className="border-t pt-4 mt-4">
                  <div className="flex items-center gap-2 text-green-600 bg-green-50 dark:bg-green-950/30 rounded px-3 py-2">
                    <Check className="w-4 h-4" />
                    <span className="font-medium text-sm">Bill Recorded</span>
                  </div>
                </div>
              )}

              {/* Payment Choice - current bill only or all bills */}
              {showPaymentChoice && !showPaymentForm && canRecordCurrentBillPayment && (() => {
                const otherUnpaidBills = bills?.filter(
                  (b) => b.clientId === currentSelectedBill.clientId &&
                         b.id !== currentSelectedBill.id &&
                         !b.isPaid
                ) || [];
                const currentBillDue = selectedBillDisplayAmounts.due;
                const totalPreviousDue = otherUnpaidBills.reduce((sum, b) => sum + getBillDisplayAmounts(b).due, 0);
                const grandTotal = currentBillDue + totalPreviousDue;
                return (
                  <div className="border-t pt-4 mt-4 space-y-3">
                    <h4 className="font-medium text-sm">This client has {otherUnpaidBills.length} previous unpaid bill(s). How would you like to pay?</h4>
                    <div className="space-y-2">
                      <Button
                        variant="outline"
                        className="w-full justify-between"
                        onClick={() => {
                          setPaymentAmount(currentBillDue.toFixed(2));
                          setPayAllBills(false);
                          setShowPaymentChoice(false);
                          setShowPaymentForm(true);
                        }}
                        data-testid="button-pay-current-only"
                      >
                        <span>Pay Current Bill Only</span>
                        <span className="font-bold text-blue-600">{currentBillDue.toFixed(2)} AED</span>
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full justify-between border-amber-400 bg-amber-50 dark:bg-amber-950/30"
                        onClick={() => {
                          setPaymentAmount(grandTotal.toFixed(2));
                          setPayAllBills(true);
                          setShowPaymentChoice(false);
                          setShowPaymentForm(true);
                        }}
                        data-testid="button-pay-all-bills"
                      >
                        <span>Pay All Bills ({otherUnpaidBills.length + 1})</span>
                        <span className="font-bold text-amber-600">{grandTotal.toFixed(2)} AED</span>
                      </Button>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setShowPaymentChoice(false)}>
                      Cancel
                    </Button>
                  </div>
                );
              })()}

              {/* Payment Form */}
              {showPaymentForm && canRecordCurrentBillPayment && (
                <div className="border-t pt-4 mt-4 space-y-3">
                  <h4 className="font-medium text-sm">{payAllBills ? "Pay All Bills" : "Record Payment"}</h4>
                  {selectedBillClientDeposit > 0.01 && (
                    <>
                      <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
                        <p className="text-sm font-medium text-green-700 dark:text-green-400">
                          Customer has AED {selectedBillClientDeposit.toFixed(2)} account credit balance available
                        </p>
                      </div>
                      {paymentMethod !== "deposit" && (
                        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                            Reminder: Customer still has account credit balance. Consider using "Account Credit" instead.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                  {!currentSelectedBill.isPaid && !payAllBills && selectedBillDisplayAmounts.discount === 0 && (
                    <div className="p-3 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="apply-discount-toggle"
                          checked={applyDiscount}
                          onChange={(e) => {
                            setApplyDiscount(e.target.checked);
                            if (e.target.checked) {
                              focusDiscountAmountInput();
                            } else {
                              setDiscountAmount("");
                              const billDue = selectedBillDisplayAmounts.due;
                              setPaymentAmount(billDue.toFixed(2));
                            }
                          }}
                          className="rounded"
                          data-testid="toggle-apply-discount"
                        />
                        <Label htmlFor="apply-discount-toggle" className="text-sm font-medium text-orange-700 dark:text-orange-400 cursor-pointer">
                          Apply Discount
                        </Label>
                      </div>
                      {applyDiscount && (
                        <div>
                          <Label className="text-xs">Discount Amount (AED)</Label>
                          <Input
                            ref={discountAmountInputRef}
                            type="number"
                            step="0.01"
                            min="0"
                            value={discountAmount}
                            onChange={(e) => {
                              setDiscountAmount(e.target.value);
                              const disc = parseFloat(e.target.value) || 0;
                              const origAmount = selectedBillDisplayAmounts.originalAmount;
                              const newAmount = Math.max(0, origAmount - disc);
                              const paid = selectedBillDisplayAmounts.paidAmount;
                              setPaymentAmount(Math.max(0, newAmount - paid).toFixed(2));
                            }}
                            placeholder="0.00"
                            data-testid="input-discount-amount"
                          />
                          {discountAmount && parseFloat(discountAmount) > 0 && (
                            <p className="text-xs text-orange-600 mt-1">
                              New bill total: {(selectedBillDisplayAmounts.originalAmount - parseFloat(discountAmount)).toFixed(2)} AED
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">Amount (AED)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="0.00"
                      data-testid="input-payment-amount"
                    />
                    {showOrderPartialPaymentNotice && (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-semibold">Partial payment notice</p>
                            <p>
                              This bill will be marked partially paid because the given amount is lower than the current bill amount.
                            </p>
                            <p className="mt-1 font-medium">
                              Remaining after payment: {orderPartialPaymentRemainingAfterPayment.toFixed(2)} AED
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs">Method</Label>
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
                            onClick={() => {
                              setPaymentMethod(value);
                              focusPaymentPinInput();
                            }}
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
                  {!payAllBills && (
                    <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="enable-order-split-payment"
                          checked={splitPaymentEnabled}
                          onChange={(e) => {
                            const enabled = e.target.checked;
                            setSplitPaymentEnabled(enabled);

                            if (enabled) {
                              const suggestedSplitAmount =
                                paymentMethod === "deposit"
                                  ? Math.min(normalizedRequestedPaymentAmount, selectedBillClientDeposit)
                                  : normalizedRequestedPaymentAmount;
                              setSplitPaymentAmount(
                                suggestedSplitAmount > 0 ? suggestedSplitAmount.toFixed(2) : "",
                              );
                              setRemainingPaymentMethod(splitPaymentMethodOptions[0]?.value || "card");
                            } else {
                              setSplitPaymentAmount("");
                            }
                          }}
                          className="rounded"
                          data-testid="toggle-enable-order-split-payment"
                        />
                        <Label htmlFor="enable-order-split-payment" className="text-sm font-medium cursor-pointer">
                          Add another payment method
                        </Label>
                      </div>
                      {splitPaymentEnabled && (
                        <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-3 space-y-3 dark:border-sky-800 dark:bg-sky-950/20">
                          <div>
                            <Label className="text-xs">
                              Amount to pay with {formatOrderSplitPaymentMethodLabel(paymentMethod)}
                            </Label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={splitPaymentAmount}
                              onChange={(e) => setSplitPaymentAmount(e.target.value)}
                              placeholder="0.00"
                              data-testid="input-order-split-payment-amount"
                            />
                            {paymentMethod === "deposit" && (
                              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                                <span className="text-muted-foreground">
                                  Available credit: {selectedBillClientDeposit.toFixed(2)} AED
                                </span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7"
                                  onClick={() =>
                                    setSplitPaymentAmount(
                                      Math.min(normalizedRequestedPaymentAmount, selectedBillClientDeposit).toFixed(2),
                                    )
                                  }
                                >
                                  Use Full Credit
                                </Button>
                              </div>
                            )}
                            {paymentMethod === "deposit" &&
                              normalizedSplitPaymentAmount > selectedBillClientDeposit + 0.009 && (
                                <p className="mt-2 text-xs text-destructive">
                                  Credit amount cannot be more than {selectedBillClientDeposit.toFixed(2)} AED.
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
                                    key={`order-split-${value}`}
                                    type="button"
                                    variant={isSelected ? "default" : "outline"}
                                    className={`h-auto justify-start gap-2 px-3 py-2 text-left whitespace-normal ${
                                      isSelected ? "" : "hover:border-primary/50"
                                    }`}
                                    onClick={() => setRemainingPaymentMethod(value)}
                                    aria-pressed={isSelected}
                                    data-testid={`button-order-remaining-payment-method-${value}`}
                                  >
                                    <Icon className="w-4 h-4 flex-shrink-0" />
                                    <span className="text-sm leading-tight">{label}</span>
                                  </Button>
                                );
                              })}
                            </div>
                          </div>
                          <div className="rounded-md border bg-background/80 px-3 py-2 text-sm">
                            Remaining for {formatOrderSplitPaymentMethodLabel(remainingPaymentMethod)}:{" "}
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
                              {formatOrderSplitPaymentMethodLabel(remainingPaymentMethod)}.
                            </p>
                          )}
                          {remainingPaymentMethod === "deposit" &&
                            splitRemainingAmount > selectedBillClientDeposit + 0.009 && (
                              <p className="text-xs text-destructive">
                                Remaining credit payment cannot be more than {selectedBillClientDeposit.toFixed(2)} AED.
                              </p>
                            )}
                        </div>
                      )}
                      {!splitPaymentEnabled &&
                        paymentMethod === "deposit" &&
                        normalizedRequestedPaymentAmount > selectedBillClientDeposit + 0.009 && (
                          <div className="text-sm text-amber-700 dark:text-amber-400">
                            Credit is not enough for the full amount. Turn on "Add another payment method" to split the payment.
                          </div>
                        )}
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">Staff PIN For Bill Recorded By (5 digits)</Label>
                    <Input
                      ref={paymentPinInputRef}
                      type="password"
                      inputMode="numeric"
                      maxLength={5}
                      value={paymentPin}
                      onChange={(e) => { setPaymentPin(e.target.value.replace(/\D/g, '')); setPaymentPinError(''); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleRecordPayment();
                        }
                      }}
                      placeholder="Enter your staff PIN"
                      data-testid="input-payment-pin"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      The verified staff PIN name will be saved as Bill Recorded By and reused by Credit Management Log.
                    </p>
                    {paymentPinError && <p className="text-xs text-destructive mt-1">{paymentPinError}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => resetOrderBillPaymentState()}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleRecordPayment} disabled={recordPaymentMutation.isPending || isSplitPaymentSubmitting}>
                      {recordPaymentMutation.isPending || isSplitPaymentSubmitting ? "Processing..." : "Confirm Payment"}
                    </Button>
                  </div>
                </div>
              )}

              {currentSelectedBill.notes && (
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
                  <p className="text-xs text-blue-700 dark:text-blue-400 font-semibold mb-2">History</p>
                  <div className="text-xs text-blue-600 dark:text-blue-300 whitespace-pre-wrap">
                    {currentSelectedBill.notes}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2 flex-wrap">
                {!showPaymentForm && !showPaymentChoice && canRecordCurrentBillPayment && (
                  <Button
                    variant="default"
                    className="flex-1"
                    onClick={() => {
                      const otherUnpaidBills = bills?.filter(
                        (b) => b.clientId === currentSelectedBill.clientId &&
                               b.id !== currentSelectedBill.id &&
                               !b.isPaid
                      ) || [];
                      if (otherUnpaidBills.length > 0) {
                        setShowPaymentChoice(true);
                      } else {
                        const remainingAmount = selectedBillDisplayAmounts.due;
                        setPaymentAmount(remainingAmount.toFixed(2));
                        setPayAllBills(false);
                        setShowPaymentForm(true);
                      }
                    }}
                    data-testid="button-record-payment"
                  >
                    <CreditCard className="w-4 h-4 mr-2" />
                    Pay
                  </Button>
                )}
                {(currentSelectedBill.isPaid || selectedBillDisplayAmounts.paidAmount > 0) && (
                  <Button
                    variant="destructive"
                    className="flex-1"
                    disabled={editOrderRevertingPayment}
                    onClick={() => openBillPaymentRevertDialog(currentSelectedBill.id)}
                    data-testid="button-revert-payment-bill-order"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {editOrderRevertingPayment ? "Reverting..." : "Revert Payment"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    downloadBillPdfFromOrders(currentSelectedBill);
                  }}
                  data-testid="button-print-bill-summary"
                >
                  <Printer className="w-4 h-4 mr-2" />
                  Print
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={billRevertDialogOpen}
        onOpenChange={(open) => {
          setBillRevertDialogOpen(open);
          if (!open) {
            setBillRevertTargetId(null);
            setBillRevertPin("");
            setBillRevertError("");
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Revert Bill Payment</DialogTitle>
            <DialogDescription>
              This will reset this bill payment to unpaid, remove payment records and transaction history. Enter the admin PIN to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Admin PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={5}
                value={billRevertPin}
                onChange={(e) => {
                  setBillRevertPin(e.target.value.replace(/\D/g, "").slice(0, 5));
                  setBillRevertError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleBillPaymentRevertConfirm();
                  }
                }}
                placeholder="Enter 5-digit admin PIN"
                data-testid="input-order-bill-revert-pin"
              />
              {billRevertError && <p className="text-xs text-destructive mt-1">{billRevertError}</p>}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setBillRevertDialogOpen(false);
                setBillRevertTargetId(null);
                setBillRevertPin("");
                setBillRevertError("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={editOrderRevertingPayment}
              onClick={handleBillPaymentRevertConfirm}
              data-testid="button-confirm-order-bill-revert"
            >
              {editOrderRevertingPayment ? "Reverting..." : "Revert Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Items Dialog */}
      <Dialog
        open={!!editItemsDialog}
        onOpenChange={(open) => !open && setEditItemsDialog(null)}
      >
        <DialogContent
          aria-describedby={undefined}
          className="w-[min(96vw,46rem)] max-w-2xl max-h-[90vh] overflow-x-hidden overflow-y-auto px-4 sm:px-6"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5 text-amber-500" />
              Edit Order Items
            </DialogTitle>
            <DialogDescription>
              Adjust item quantities for order #{editItemsDialog?.orderNumber}. The bill will be recalculated automatically.
            </DialogDescription>
          </DialogHeader>
          {editItemsDialog && (
            <div className="space-y-4">
              <div className="space-y-2 rounded-lg bg-muted p-3">
                <div className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Order:</span>
                  <span className="min-w-0 text-right font-medium break-words">{editItemsDialog.orderNumber}</span>
                </div>
                <div className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Customer:</span>
                  <span className="min-w-0 text-right font-medium break-words">
                    {clients?.find((c) => c.id === editItemsDialog.clientId)?.name || editItemsDialog.customerName || "Walk-in"}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Current Total:</span>
                  <span className="text-right font-medium">AED {editItemsDialog.adjustedTotal != null ? editItemsDialog.adjustedTotal : (editItemsDialog.finalAmount ?? editItemsDialog.totalAmount)}</span>
                </div>
                <div className="mt-2 flex items-start justify-between gap-3 border-t pt-2 text-sm">
                  <span className="text-muted-foreground">New Total:</span>
                  <span className="text-right font-bold text-primary">AED {calculateEditItemsTotal().toFixed(2)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <Label>Items</Label>
                  <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
                    <div className="flex flex-wrap items-center justify-start gap-1 sm:justify-end">
                      <span className="text-[10px] text-muted-foreground mr-1">Pack:</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px] bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800"
                        onClick={() => {
                          const newPackaging: Record<string, "folding" | "hanger"> = {};
                          const newQuantities: Record<string, number> = {};
                          const newUnitPrices: Record<string, number> = { ...editItemsUnitPrices };
                          Object.entries(editItemsQuantities).forEach(([itemName, qty]) => {
                            const baseName = itemName.replace(/\s*\(folding\)\s*/gi, '').replace(/\s*\(hanger\)\s*/gi, '').replace(/\s*\(hanging\)\s*/gi, '').trim();
                            const newName = `${baseName} (folding)`;
                            newPackaging[newName] = "folding";
                            newQuantities[newName] = qty;
                            newUnitPrices[newName] = resolveEditItemUnitPrice(itemName);
                          });
                          setEditItemsPackaging(newPackaging);
                          setEditItemsQuantities(newQuantities);
                          setEditItemsUnitPrices(newUnitPrices);
                        }}
                        data-testid="button-fold-all"
                      >
                        Fold All
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px] bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                        onClick={() => {
                          const newPackaging: Record<string, "folding" | "hanger"> = {};
                          const newQuantities: Record<string, number> = {};
                          const newUnitPrices: Record<string, number> = { ...editItemsUnitPrices };
                          Object.entries(editItemsQuantities).forEach(([itemName, qty]) => {
                            const baseName = itemName.replace(/\s*\(folding\)\s*/gi, '').replace(/\s*\(hanger\)\s*/gi, '').replace(/\s*\(hanging\)\s*/gi, '').trim();
                            const newName = `${baseName} (hanger)`;
                            newPackaging[newName] = "hanger";
                            newQuantities[newName] = qty;
                            newUnitPrices[newName] = resolveEditItemUnitPrice(itemName);
                          });
                          setEditItemsPackaging(newPackaging);
                          setEditItemsQuantities(newQuantities);
                          setEditItemsUnitPrices(newUnitPrices);
                        }}
                        data-testid="button-hang-all"
                      >
                        Hang All
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center justify-start gap-1 sm:justify-end">
                      <span className="text-[10px] text-muted-foreground mr-1">Service:</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px] bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                        onClick={() => {
                          const newQuantities: Record<string, number> = {};
                          const newPackaging: Record<string, "folding" | "hanger"> = {};
                          const newUnitPrices: Record<string, number> = { ...editItemsUnitPrices };
                          Object.entries(editItemsQuantities).forEach(([itemName, qty]) => {
                            const finalName = rebuildEditItemNameWithService(itemName, "N");
                            newQuantities[finalName] = qty;
                            newPackaging[finalName] = editItemsPackaging[itemName] || 'folding';
                            newUnitPrices[finalName] = resolveEditItemUnitPrice(finalName);
                          });
                          setEditItemsQuantities(newQuantities);
                          setEditItemsPackaging(newPackaging);
                          setEditItemsUnitPrices(newUnitPrices);
                        }}
                        data-testid="button-normal-all"
                      >
                        Normal All
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px] bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800"
                        onClick={() => {
                          const newQuantities: Record<string, number> = {};
                          const newPackaging: Record<string, "folding" | "hanger"> = {};
                          const newUnitPrices: Record<string, number> = { ...editItemsUnitPrices };
                          Object.entries(editItemsQuantities).forEach(([itemName, qty]) => {
                            const finalName = rebuildEditItemNameWithService(itemName, "DC");
                            newQuantities[finalName] = qty;
                            newPackaging[finalName] = editItemsPackaging[itemName] || 'folding';
                            newUnitPrices[finalName] = resolveEditItemUnitPrice(finalName);
                          });
                          setEditItemsQuantities(newQuantities);
                          setEditItemsPackaging(newPackaging);
                          setEditItemsUnitPrices(newUnitPrices);
                        }}
                        data-testid="button-dc-all"
                      >
                        DC All
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px] bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800"
                        onClick={() => {
                          const newQuantities: Record<string, number> = {};
                          const newPackaging: Record<string, "folding" | "hanger"> = {};
                          const newUnitPrices: Record<string, number> = { ...editItemsUnitPrices };
                          Object.entries(editItemsQuantities).forEach(([itemName, qty]) => {
                            const finalName = rebuildEditItemNameWithService(itemName, "IO");
                            newQuantities[finalName] = qty;
                            newPackaging[finalName] = editItemsPackaging[itemName] || 'folding';
                            newUnitPrices[finalName] = resolveEditItemUnitPrice(finalName);
                          });
                          setEditItemsQuantities(newQuantities);
                          setEditItemsPackaging(newPackaging);
                          setEditItemsUnitPrices(newUnitPrices);
                        }}
                        data-testid="button-io-all"
                      >
                        IO All
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="max-h-60 overflow-y-auto rounded-lg border divide-y">
                  {(() => {
                    const pickupStatus: Record<string, string> = (() => { try { return JSON.parse(editItemsDialog.itemPickupStatus || "{}"); } catch { return {}; } })();
                    const isDeliveryOrder = editItemsDialog.deliveryType === "delivery";
                    return Object.entries(editItemsQuantities).map(([itemName, qty], idx) => {
                    const itemPrice = resolveEditItemUnitPrice(itemName);
                    const lineTotal = itemPrice * qty;
                    const baseName = itemName
                      .replace(/\s*\(folding\)\s*/gi, '')
                      .replace(/\s*\(hanger\)\s*/gi, '')
                      .replace(/\s*\(hanging\)\s*/gi, '')
                      .replace(/\s*\[N\]\s*/g, '')
                      .replace(/\s*\[D\]\s*/g, '')
                      .replace(/\s*\[IO\]\s*/g, '')
                      .replace(/\s*\*URG\*\s*/g, '')
                      .trim();
                    const pkg = editItemsPackaging[itemName] || "folding";
                    const isHanger = pkg === "hanger";
                    const itemDoneStatus = pickupStatus[String(idx)] || "";
                    const isItemDone = itemDoneStatus === "delivered" || itemDoneStatus === "picked_up";
                    return (
                      <div
                        key={itemName}
                        className={`flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between ${isItemDone ? "bg-muted/30 opacity-50" : ""}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {getCategoryIcon(
                              getProductCategoryGroupName(
                                products?.find((p) => p.name === baseName)
                                  ?.category || null,
                              ),
                              "w-4 h-4",
                            )}
                            <span className="min-w-0 break-words text-sm font-medium">{baseName}</span>
                            {isItemDone && (
                              <Badge variant="outline" className="text-[10px] gap-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700">
                                {isDeliveryOrder ? <><Truck className="w-3 h-3" /> Delivered</> : <><Package className="w-3 h-3" /> Taken Away</>}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 sm:ml-6">
                            <div className="text-xs text-muted-foreground">
                              {itemPrice.toFixed(2)} AED each = <span className="font-medium text-foreground">{lineTotal.toFixed(2)} AED</span>
                            </div>
                          </div>
                          {!isItemDone && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1 sm:ml-6">
                            <Button
                              type="button"
                              size="sm"
                              variant={isHanger ? "outline" : "default"}
                              className={`h-6 px-2 text-xs ${!isHanger ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}`}
                              onClick={() => { if (isHanger) handleTogglePackaging(itemName); }}
                              data-testid={`button-folding-${baseName}`}
                            >
                              Folding
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={isHanger ? "default" : "outline"}
                              className={`h-6 px-2 text-xs ${isHanger ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}`}
                              onClick={() => { if (!isHanger) handleTogglePackaging(itemName); }}
                              data-testid={`button-hanger-${baseName}`}
                            >
                              Hanger
                            </Button>
                          </div>
                          )}
                        </div>
                        {isItemDone ? (
                          <div className="ml-auto flex items-center gap-2 self-end sm:self-auto">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                          </div>
                        ) : (
                        <div className="ml-auto flex items-center gap-2 self-end sm:self-auto">
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            onClick={() => handleUpdateItemQuantity(itemName, -1)}
                            data-testid={`button-decrease-${baseName}`}
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                          <Input
                            type="text"
                            inputMode="numeric"
                            className="w-12 h-8 text-center font-medium p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            value={qty}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, "");
                              const newQty = val === "" ? 0 : parseInt(val);
                              setEditItemsQuantities((prev) => {
                                if (newQty === 0) {
                                  const { [itemName]: _, ...rest } = prev;
                                  return rest;
                                }
                                return { ...prev, [itemName]: newQty };
                              });
                            }}
                            data-testid={`input-quantity-${baseName}`}
                          />
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            onClick={() => handleUpdateItemQuantity(itemName, 1)}
                            data-testid={`button-increase-${baseName}`}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                        )}
                      </div>
                    );
                  });
                  })()}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Staff PIN (5 digits)</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="Enter your 5-digit PIN"
                  value={editItemsPin}
                  onChange={(e) => {
                    setEditItemsPin(e.target.value.replace(/\D/g, "").slice(0, 5));
                    setEditItemsPinError("");
                  }}
                  data-testid="input-edit-items-pin"
                />
                {editItemsPinError && (
                  <p className="text-sm text-destructive">{editItemsPinError}</p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setEditItemsDialog(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={submitEditItems}
                  disabled={isEditingItems || editItemsPin.length !== 5}
                  data-testid="button-submit-edit-items"
                >
                  {isEditingItems ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    "Update Items"
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!discountPinDialogOrder}
        onOpenChange={(open) => {
          if (!open) {
            setDiscountPinDialogOrder(null);
            setDiscountPin("");
            setDiscountPinError("");
            setIsDiscountPinVerifying(false);
            clearStaffPinPreview("discount");
          }
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="sm:max-w-sm"
          onCloseAutoFocus={(event) => {
            if (pendingOrderDiscountFocusIdRef.current !== null) {
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
              <Label htmlFor="order-discount-pin">Admin or Counter PIN</Label>
              {renderStaffPinPreview("discount")}
              <Input
                id="order-discount-pin"
                type="password"
                inputMode="numeric"
                maxLength={5}
                value={discountPin}
                onChange={(event) => {
                  const normalizedPin = event.target.value.replace(/\D/g, "").slice(0, 5);
                  setDiscountPin(normalizedPin);
                  setDiscountPinError("");
                  void updateStaffPinPreview("discount", normalizedPin);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void verifyOrderDiscountPin();
                  }
                }}
                placeholder="Enter 5-digit PIN"
                data-testid="input-order-discount-pin"
              />
              {discountPinError && (
                <p className="mt-1 text-sm text-destructive">{discountPinError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  pendingOrderDiscountFocusIdRef.current = null;
                  setDiscountPinDialogOrder(null);
                  setDiscountPin("");
                  setDiscountPinError("");
                  clearStaffPinPreview("discount");
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void verifyOrderDiscountPin()}
                disabled={isDiscountPinVerifying || discountPin.length !== 5}
                data-testid="button-verify-order-discount-pin"
              >
                {isDiscountPinVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Unlock
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Adjust Price Dialog */}
      <Dialog
        open={!!adjustPriceDialog}
        onOpenChange={(open) => {
          if (!open) {
            setAdjustPriceDialog(null);
            setAdjustPriceValue("");
            setAdjustPriceReason("");
            setAdjustPricePin("");
            setAdjustPricePinError("");
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-orange-500" />
              Adjust Work Received
            </DialogTitle>
            <DialogDescription>
              Change the work received amount for order #{adjustPriceDialog?.orderNumber}. Final amount updates automatically after discount.
            </DialogDescription>
          </DialogHeader>
          {adjustPriceDialog && (() => {
            const adjustBill = bills?.find(b => b.id === adjustPriceDialog.billId);
            const isLocked = adjustPriceDialog.status === "delivered" || adjustPriceDialog.status === "picked_up" || !!adjustBill?.isPaid;
            const currentDiscount = getOrderDiscountAmount(adjustPriceDialog);
            const currentWorkReceived = getOrderWorkReceivedAmount(adjustPriceDialog);
            const currentFinal = getOrderFinalAmount(adjustPriceDialog);
            const parsedNewWorkReceived = parseFloat(adjustPriceValue);
            const newWorkReceived = Number.isFinite(parsedNewWorkReceived) ? Math.max(0, parsedNewWorkReceived) : 0;
            const newFinalAmount = Math.max(0, newWorkReceived - currentDiscount);
            return (
            <div className="space-y-4">
              {isLocked && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive font-medium">
                  {(adjustPriceDialog.status === "delivered" || adjustPriceDialog.status === "picked_up") ? "This order has been delivered." : "This bill has been paid."} Work received amount cannot be adjusted.
                </div>
              )}
              <div className="p-3 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Order:</span>
                  <span className="font-medium">{adjustPriceDialog.orderNumber}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Customer:</span>
                  <span className="font-medium">
                    {clients?.find((c) => c.id === adjustPriceDialog.clientId)?.name || adjustPriceDialog.customerName || "Walk-in"}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Original Total:</span>
                  <span className="font-medium">AED {parseFloat(adjustPriceDialog.totalAmount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Work Received:</span>
                  <span className="font-medium">AED {currentWorkReceived.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Discount:</span>
                  <span className="font-medium text-orange-600 dark:text-orange-400">
                    {currentDiscount > 0 ? `AED ${currentDiscount.toFixed(2)}` : "-"}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Final Amount:</span>
                  <span className="font-medium">AED {currentFinal.toFixed(2)}</span>
                </div>
                {adjustPriceDialog.priceAdjustReason && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Previous Reason:</span>
                    <span className="font-medium text-orange-600 dark:text-orange-400 text-xs">{adjustPriceDialog.priceAdjustReason}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>New Work Received (AED)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Enter new work received amount"
                  value={adjustPriceValue}
                  onChange={(e) => setAdjustPriceValue(e.target.value)}
                  disabled={isLocked}
                  data-testid="input-adjust-price-value"
                />
                <p className="text-xs text-muted-foreground">
                  Final amount preview: <span className="font-semibold">{newFinalAmount.toFixed(2)} AED</span>
                  {currentDiscount > 0 && (
                    <span> (Work Received {newWorkReceived.toFixed(2)} - Discount {currentDiscount.toFixed(2)})</span>
                  )}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Reason for Work Received Change</Label>
                <Textarea
                  placeholder="e.g. Customer negotiation, damaged items, loyalty discount..."
                  value={adjustPriceReason}
                  onChange={(e) => setAdjustPriceReason(e.target.value)}
                  disabled={isLocked}
                  rows={2}
                  data-testid="input-adjust-price-reason"
                />
              </div>

              <div className="space-y-2">
                <Label>Staff PIN (5 digits)</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="Enter your 5-digit PIN"
                  value={adjustPricePin}
                  onChange={(e) => {
                    setAdjustPricePin(e.target.value.replace(/\D/g, "").slice(0, 5));
                    setAdjustPricePinError("");
                  }}
                  disabled={isLocked}
                  data-testid="input-adjust-price-pin"
                />
                {adjustPricePinError && (
                  <p className="text-sm text-destructive">{adjustPricePinError}</p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setAdjustPriceDialog(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={submitAdjustPrice}
                  disabled={isLocked || isAdjustingPrice || adjustPricePin.length !== 5 || !adjustPriceReason.trim()}
                  data-testid="button-submit-adjust-price"
                >
                  {isAdjustingPrice ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    "Update Price"
                  )}
                </Button>
              </DialogFooter>
            </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Edit Expected Delivery Time Dialog */}
      <Dialog
        open={!!editDeliveryTimeDialog}
        onOpenChange={(open) => !open && setEditDeliveryTimeDialog(null)}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-blue-500" />
              Edit Expected {editDeliveryTimeDialog?.deliveryType === "delivery" ? "Delivery" : "Pickup"} Time
            </DialogTitle>
            <DialogDescription>
              Set when order #{editDeliveryTimeDialog?.orderNumber} should be ready
            </DialogDescription>
          </DialogHeader>
          {editDeliveryTimeDialog && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={editDeliveryDate}
                  onChange={(e) => setEditDeliveryDate(e.target.value)}
                  min={format(new Date(), "yyyy-MM-dd")}
                  data-testid="input-edit-delivery-date"
                />
              </div>

              <div className="space-y-2">
                <Label>Time</Label>
                <div className="flex gap-2 items-center">
                  <select
                    value={editDeliveryHour}
                    onChange={(e) => setEditDeliveryHour(e.target.value)}
                    className="flex h-9 w-20 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    data-testid="select-edit-delivery-hour"
                  >
                    {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => (
                      <option key={h} value={h.toString()}>{h}</option>
                    ))}
                  </select>
                  <span className="text-lg font-bold">:</span>
                  <select
                    value={editDeliveryMinute}
                    onChange={(e) => setEditDeliveryMinute(e.target.value)}
                    className="flex h-9 w-20 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    data-testid="select-edit-delivery-minute"
                  >
                    {["00", "15", "30", "45"].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <select
                    value={editDeliveryPeriod}
                    onChange={(e) => setEditDeliveryPeriod(e.target.value as "AM" | "PM")}
                    className="flex h-9 w-20 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    data-testid="select-edit-delivery-period"
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
              </div>

              <DialogFooter className="flex-row gap-2">
                <Button
                  variant="destructive"
                  onClick={() => {
                    updateOrderMutation.mutate(
                      { id: editDeliveryTimeDialog.id, updates: { expectedDeliveryAt: null } },
                      {
                        onSuccess: () => {
                          toast({ title: "Expected date/time cleared" });
                          setEditDeliveryTimeDialog(null);
                        },
                      }
                    );
                  }}
                  disabled={updateOrderMutation.isPending}
                  data-testid="button-clear-delivery-time"
                >
                  Clear
                </Button>
                <div className="flex-1" />
                <Button variant="outline" onClick={() => setEditDeliveryTimeDialog(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (!editDeliveryDate) {
                      toast({ title: "Please select a date", variant: "destructive" });
                      return;
                    }
                    let hour = parseInt(editDeliveryHour);
                    if (editDeliveryPeriod === "PM" && hour !== 12) hour += 12;
                    if (editDeliveryPeriod === "AM" && hour === 12) hour = 0;
                    const dateTime = new Date(`${editDeliveryDate}T${hour.toString().padStart(2, "0")}:${editDeliveryMinute}:00`);

                    updateOrderMutation.mutate(
                      { id: editDeliveryTimeDialog.id, updates: { expectedDeliveryAt: dateTime.toISOString() } },
                      {
                        onSuccess: () => {
                          toast({ title: "Expected delivery time updated" });
                          setEditDeliveryTimeDialog(null);
                        },
                      }
                    );
                  }}
                  disabled={updateOrderMutation.isPending}
                  data-testid="button-save-delivery-time"
                >
                  {updateOrderMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Incident Report Dialog */}
      <Dialog
        open={!!incidentReportOrder}
        onOpenChange={(open) => !open && resetIncidentForm()}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              Report Incident / Missing Item
            </DialogTitle>
            <DialogDescription>
              Report an issue with order #{incidentReportOrder?.orderNumber}
            </DialogDescription>
          </DialogHeader>
          {incidentReportOrder && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Order:</span>
                  <span className="font-medium">
                    {incidentReportOrder.orderNumber}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Customer:</span>
                  <span className="font-medium">
                    {clients?.find((c) => c.id === incidentReportOrder.clientId)
                      ?.name ||
                      incidentReportOrder.customerName ||
                      "Walk-in"}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Responsible Staff:
                  </span>
                  <span className="font-medium">
                    {incidentReportOrder.packingBy || "Not assigned"}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Incident Type</Label>
                <select
                  value={incidentType}
                  onChange={(e) => setIncidentType(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  data-testid="select-incident-type"
                >
                  <option value="missing_item">Missing Item</option>
                  <option value="damage">Damage</option>
                  <option value="complaint">Customer Complaint</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label>Select Item(s)</Label>
                <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                  {parseOrderItems(incidentReportOrder.items).map(
                    (item, idx) => (
                      <div key={idx} className="flex items-center space-x-2">
                        <Checkbox
                          id={`item-${idx}`}
                          checked={incidentItems.includes(
                            `${item.name} x${item.quantity}`,
                          )}
                          onCheckedChange={(checked) => {
                            const itemStr = `${item.name} x${item.quantity}`;
                            if (checked) {
                              setIncidentItems([...incidentItems, itemStr]);
                            } else {
                              setIncidentItems(
                                incidentItems.filter((i) => i !== itemStr),
                              );
                            }
                          }}
                          data-testid={`checkbox-item-${idx}`}
                        />
                        <label
                          htmlFor={`item-${idx}`}
                          className="text-sm flex-1"
                        >
                          {item.name} x{item.quantity}
                        </label>
                      </div>
                    ),
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Reason / Description</Label>
                <Textarea
                  placeholder="Describe the incident..."
                  value={incidentReason}
                  onChange={(e) => setIncidentReason(e.target.value)}
                  data-testid="input-incident-reason"
                />
              </div>

              <div className="space-y-2">
                <Label>Additional Notes (Optional)</Label>
                <Textarea
                  placeholder="Any additional details..."
                  value={incidentNotes}
                  onChange={(e) => setIncidentNotes(e.target.value)}
                  data-testid="input-incident-notes"
                />
              </div>

              <div className="space-y-2">
                <Label>Your Name (Reporter)</Label>
                <Input
                  placeholder="Enter your name"
                  value={reporterName}
                  onChange={(e) => setReporterName(e.target.value)}
                  data-testid="input-reporter-name"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={resetIncidentForm}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-orange-500 hover:bg-orange-600"
                  onClick={submitIncidentReport}
                  disabled={createIncidentMutation.isPending}
                  data-testid="button-submit-incident"
                >
                  {createIncidentMutation.isPending && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  Report Incident
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Order Detail Dialog */}
      <Dialog
        open={!!orderDetailDialog}
        onOpenChange={(open) => {
          if (!open) {
            setOrderDetailDialog(null);
            setEditOrderAuthenticated(false);
            setEditOrderAuthLevel(null);
            setEditOrderPriorityUrgent(false);
            setEditOrderPin("");
            setEditOrderAdminError("");
            setEditOrderSaving(false);
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="w-[96vw] max-w-4xl max-h-[92vh] overflow-y-auto px-4 py-4 sm:px-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" />
              Order #{orderDetailDialog?.orderNumber}
            </DialogTitle>
            <DialogDescription>
              {editOrderAuthenticated ? (editOrderAuthLevel === "admin" ? "Edit mode - modify items, price, or bill" : "Edit mode - add/adjust items") : "Order details and tracking"}
            </DialogDescription>
          </DialogHeader>
          {orderDetailDialog && (
            <div className="space-y-3 lg:space-y-4">
              {/* Processing Phase Indicator */}
              <div className="bg-muted/50 rounded-lg p-2.5 lg:p-3">
                <div className="flex items-center justify-between gap-1">
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${!orderDetailDialog.tagDone ? "bg-blue-600 text-white ring-2 ring-blue-300" : "bg-green-600 text-white"}`}>
                      <Tag className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] mt-1 font-medium">Tag</span>
                  </div>
                  <div className={`flex-1 h-1 max-w-4 ${orderDetailDialog.tagDone ? "bg-green-600" : "bg-gray-200 dark:bg-gray-700"}`} />
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${orderDetailDialog.tagDone && !orderDetailDialog.washingDone ? "bg-blue-600 text-white ring-2 ring-blue-300" : orderDetailDialog.washingDone ? "bg-green-600 text-white" : "bg-gray-200 dark:bg-gray-700"}`}>
                      <Clock className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] mt-1 font-medium">Wash</span>
                  </div>
                  <div className={`flex-1 h-1 max-w-4 ${orderDetailDialog.washingDone ? "bg-green-600" : "bg-gray-200 dark:bg-gray-700"}`} />
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${orderDetailDialog.washingDone && !orderDetailDialog.packingDone ? "bg-blue-600 text-white ring-2 ring-blue-300" : orderDetailDialog.packingDone ? "bg-green-600 text-white" : "bg-gray-200 dark:bg-gray-700"}`}>
                      <Package className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] mt-1 font-medium">Pack</span>
                  </div>
                  <div className={`flex-1 h-1 max-w-4 ${orderDetailDialog.delivered ? "bg-green-600" : "bg-gray-200 dark:bg-gray-700"}`} />
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${orderDetailDialog.packingDone && !orderDetailDialog.delivered ? "bg-blue-600 text-white ring-2 ring-blue-300" : orderDetailDialog.delivered ? "bg-green-600 text-white" : "bg-gray-200 dark:bg-gray-700"}`}>
                      {orderDetailDialog.delivered ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : isDeliveryOrderType(orderDetailDialog.deliveryType) ? (
                        <Truck className="w-4 h-4" />
                      ) : (
                        <Package className="w-4 h-4" />
                      )}
                    </div>
                    <span className="text-[10px] mt-1 font-medium">
                      {getOrderFinalTrackingLabel(
                        orderDetailDialog.deliveryType,
                        orderDetailDialog.delivered,
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Order Info */}
              <div className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-3 xl:grid-cols-5">
                <div>
                  <span className="text-muted-foreground text-xs">Customer:</span>
                  {orderDetailDialog.clientId ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="font-medium text-blue-600 hover:text-blue-800 cursor-pointer hover:underline flex items-center gap-1 text-sm"
                          data-testid={`link-client-details-${orderDetailDialog.clientId}`}
                        >
                          {(() => {
                            const c = clients?.find((c) => c.id === orderDetailDialog.clientId);
                            const clientIsBroker = isBrokerClient(c);
                            return (
                              <>
                                <span>{c?.name || orderDetailDialog.customerName || "Walk-in"}</span>
                                {clientIsBroker && (
                                  <Badge
                                    variant="outline"
                                    className="h-5 border-violet-300 bg-violet-50 px-2 text-[10px] text-violet-700 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-300"
                                  >
                                    Broker
                                  </Badge>
                                )}
                              </>
                            );
                          })()}
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56" align="start">
                        <div className="space-y-2">
                          {(() => {
                            const c = clients?.find((c) => c.id === orderDetailDialog.clientId);
                            const address = getOrderDisplayAddress(orderDetailDialog, c);
                            return (
                              <>
                                {c?.company ? (
                                  <p className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400">
                                    <Building2 className="h-3 w-3 shrink-0 text-blue-500 dark:text-blue-400" />
                                    {c.company}
                                  </p>
                                ) : null}
                                {c?.billNumber ? (
                                  <p className="text-xs text-muted-foreground">
                                    Account: {c.billNumber}
                                  </p>
                                ) : null}
                                {getDisplayPhone(c?.phone) ? (
                                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Phone className="h-3 w-3 shrink-0 text-cyan-500 dark:text-cyan-400" />
                                    {getDisplayPhone(c?.phone)}
                                  </p>
                                ) : null}
                                {address ? (
                                  <p className="flex items-start gap-1 text-xs text-muted-foreground">
                                    <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500 dark:text-emerald-400" />
                                    <span className="break-words">{address}</span>
                                  </p>
                                ) : null}
                              </>
                            );
                          })()}
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full justify-start text-blue-600 border-blue-200 hover:bg-blue-50"
                            data-testid={`button-order-detail-client-history-${orderDetailDialog.clientId}`}
                            onClick={() => {
                              setOrderDetailDialog(null);
                              openClientTransactions(orderDetailDialog.clientId!);
                            }}
                          >
                            <ExternalLink className="w-3 h-3 mr-2" />
                            Account Activity
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full justify-start text-amber-600 border-amber-200 hover:bg-amber-50"
                            data-testid={`button-order-detail-client-edit-${orderDetailDialog.clientId}`}
                            onClick={() => {
                              setOrderDetailDialog(null);
                              openClientEdit(orderDetailDialog.clientId!);
                            }}
                          >
                            <Edit className="w-3 h-3 mr-2" />
                            Edit Account Details
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <p className="font-medium text-sm">{orderDetailDialog.customerName || "Walk-in"}</p>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Phone:</span>
                  <p className="font-medium text-sm">{clients?.find((c) => c.id === orderDetailDialog.clientId)?.phone || "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Type:</span>
                  <p className="font-medium text-sm">{getOrderTrackingTypeLabel(orderDetailDialog.deliveryType)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Payment:</span>
                  {(() => {
                    const bill = bills?.find(b => b.id === orderDetailDialog.billId);
                    if (!bill) return <p className="font-medium text-muted-foreground text-sm">No bill</p>;
                    const isPaid = bill.isPaid || parseFloat(bill.paidAmount || "0") >= parseFloat(bill.amount);
                    const isPartial = !isPaid && parseFloat(bill.paidAmount || "0") > 0;
                    return (
                      <div className="flex items-center gap-1">
                        <Badge variant={isPaid ? "default" : "destructive"} className={`text-[10px] ${isPartial ? "bg-amber-500 hover:bg-amber-600" : ""}`}>
                          {isPaid ? "Paid" : isPartial ? "Partial" : "Unpaid"}
                        </Badge>
                        <span className="text-xs font-medium">AED {parseFloat(bill.amount).toFixed(2)}</span>
                      </div>
                    );
                  })()}
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Entry:</span>
                  <p className="font-medium text-sm">
                    {orderDetailDialog.entryDate
                      ? format(new Date(orderDetailDialog.entryDate), "dd/MM/yyyy hh:mm a")
                      : "-"}
                  </p>
                </div>
                {orderDetailDialog.expectedDeliveryAt && (
                  <div>
                    <span className="text-muted-foreground text-xs">{getOrderExpectedTimeLabel(orderDetailDialog.deliveryType)}:</span>
                    <p className="font-medium text-sm">
                      {typeof orderDetailDialog.expectedDeliveryAt === 'string'
                        ? orderDetailDialog.expectedDeliveryAt
                        : format(new Date(orderDetailDialog.expectedDeliveryAt), "dd/MM/yyyy hh:mm a")}
                    </p>
                  </div>
                )}
              </div>

              {orderDetailDialog.billId && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => {
                      const targetBillId = orderDetailDialog.billId;
                      setOrderDetailDialog(null);
                      setLocation(`/bills?billId=${targetBillId}`);
                    }}
                    data-testid={`button-open-linked-bill-${orderDetailDialog.billId}`}
                  >
                    <Receipt className="w-4 h-4" />
                    Open Linked Bill
                  </Button>
                </div>
              )}

              {/* Items List — view or edit mode */}
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">
                  {editOrderAuthenticated ? "Edit Items (qty, price, add/remove)" : "Items in Order"}
                </p>
                {editOrderAuthenticated && (
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    For mixed quantities, click a service or urgency button and choose how many pieces should move to that type.
                  </p>
                )}
                <div className="border rounded-lg divide-y max-h-72 overflow-y-auto lg:max-h-none lg:overflow-visible">
                  {editOrderAuthenticated ? (
                    <>
                      {editOrderItems.map((item, idx) => (
                        <div key={idx} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 p-2.5">
                          <div className="flex-1 min-w-0">
                            {(() => {
                              const isSqmItem = !!parseSqmDescriptionPart(item.name, products);
                              const isHanger = /\((?:hanger|hanging)\)/i.test(item.name);
                              const isUrgentItem = /\*URG\*/i.test(item.name);
                              const itemServiceType = getStoredOrderItemServiceType(
                                item.name,
                                orderDetailDialog?.deliveryType,
                              );
                              const mixSummary = editOrderItemMixSummaryByIndex.get(idx);
                              const showMixSummary =
                                !isSqmItem &&
                                mixSummary?.firstIndex === idx &&
                                shouldShowEditOrderItemMixSummary(mixSummary);
                              return (
                                <>
                                  <span className={`block text-xs leading-4 break-words ${item.quantity === 0 ? "text-red-500 line-through" : ""}`}>{stripEmbeddedItemPriceText(item.name)}</span>
                                  <span className="block text-[10px] leading-4 text-muted-foreground break-words">
                                    {(() => {
                                      const qtyPrefix = item.quantity > 1 ? `${item.quantity}x ` : "";
                                      return `Bill line: ${qtyPrefix}${stripEmbeddedItemPriceText(item.name)}`;
                                    })()}
                                  </span>
                                  {showMixSummary && mixSummary && (
                                    <span className="block text-[10px] leading-4 text-sky-700 dark:text-sky-300 break-words">
                                      {formatEditOrderItemMixSummary(mixSummary)}
                                    </span>
                                  )}
                                  <div className="mt-1 flex flex-wrap items-center gap-1">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={isHanger ? "outline" : "default"}
                                      className={`h-6 px-2 text-[10px] ${!isHanger ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}`}
                                      onClick={() => handleEditOrderPackingChange(idx, "folding")}
                                      data-testid={`button-edit-order-folding-${idx}`}
                                    >
                                      Folding
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={isHanger ? "default" : "outline"}
                                      className={`h-6 px-2 text-[10px] ${isHanger ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}`}
                                      onClick={() => handleEditOrderPackingChange(idx, "hanger")}
                                      data-testid={`button-edit-order-hanger-${idx}`}
                                    >
                                      Hanger
                                    </Button>
                                    {!isSqmItem && (
                                      <>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant={itemServiceType === "dc" ? "default" : "outline"}
                                          className={`h-6 px-2 text-[10px] ${itemServiceType === "dc" ? "bg-blue-600 hover:bg-blue-700 text-white" : "text-blue-700 border-blue-300 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-950/30"}`}
                                          onClick={() => handleEditOrderServiceAction(idx, itemServiceType === "dc" ? "normal" : "dc")}
                                          data-testid={`button-edit-order-service-dc-${idx}`}
                                        >
                                          Dry Clean
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant={itemServiceType === "iron_only" ? "default" : "outline"}
                                          className={`h-6 px-2 text-[10px] ${itemServiceType === "iron_only" ? "bg-orange-600 hover:bg-orange-700 text-white" : "text-orange-700 border-orange-300 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-800 dark:hover:bg-orange-950/30"}`}
                                          onClick={() => handleEditOrderServiceAction(idx, itemServiceType === "iron_only" ? "normal" : "iron_only")}
                                          data-testid={`button-edit-order-service-iron-${idx}`}
                                        >
                                          Iron Only
                                        </Button>
                                      </>
                                    )}
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={isUrgentItem ? "outline" : "default"}
                                      className={`h-6 px-2 text-[10px] ${!isUrgentItem ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                                      onClick={() => handleEditOrderUrgencyAction(idx, false)}
                                      data-testid={`button-edit-order-normal-${idx}`}
                                    >
                                      Normal
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={isUrgentItem ? "default" : "outline"}
                                      className={`h-6 px-2 text-[10px] ${isUrgentItem ? "bg-red-600 hover:bg-red-700 text-white" : ""}`}
                                      onClick={() => handleEditOrderUrgencyAction(idx, true)}
                                      data-testid={`button-edit-order-urgent-${idx}`}
                                    >
                                      Urgent
                                    </Button>
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-1 shrink-0 self-start">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => {
                                setEditOrderItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: Math.max(0, it.quantity - 1) } : it));
                              }}
                              data-testid={`button-edit-item-minus-${idx}`}
                            >
                              <Minus className="w-3 h-3" />
                            </Button>
                            <span className={`w-5 text-center text-xs font-bold ${item.quantity === 0 ? "text-red-500" : ""}`}>{item.quantity}</span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => {
                                setEditOrderItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: it.quantity + 1 } : it));
                              }}
                              data-testid={`button-edit-item-plus-${idx}`}
                            >
                              <Plus className="w-3 h-3" />
                            </Button>
                            {editOrderAuthLevel === "admin" ? (
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={item.price || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const nextPrice = val === "" ? 0 : parseFloat(val);
                                  setEditOrderItems(prev => prev.map((it, i) => i === idx ? {
                                    ...it,
                                    price: nextPrice,
                                    baseUnitPrice: getEditOrderBaseUnitPriceFromCurrentUnitPrice(it.name, nextPrice),
                                  } : it));
                                }}
                                placeholder="Price"
                                className="h-6 w-16 text-xs px-1 text-right"
                                data-testid={`input-edit-item-price-${idx}`}
                              />
                            ) : (
                              <span className="text-xs w-16 text-right">{(item.price || 0).toFixed(1)}</span>
                            )}
                            {editOrderAuthLevel === "admin" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={() => {
                                  setEditOrderItems(prev => prev.filter((_, i) => i !== idx));
                                }}
                                data-testid={`button-edit-item-remove-${idx}`}
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                      {/* Add new item */}
                      <div className="p-2 bg-muted/30">
                        <div className="relative">
                          <Input
                            value={editOrderAddItemSearch}
                            onChange={(e) => setEditOrderAddItemSearch(e.target.value)}
                            placeholder="Search to add item..."
                            className="h-7 text-xs pr-6"
                            data-testid="input-edit-add-item-search"
                          />
                          <Search className="w-3 h-3 absolute right-2 top-2 text-muted-foreground" />
                        </div>
                        {editOrderAddItemSearch.trim().length > 0 && (
                        <div className="mt-1 max-h-40 overflow-y-auto border rounded bg-background">
                            {products?.filter(p =>
                              p.name.toLowerCase().includes(editOrderAddItemSearch.toLowerCase())
                            ).slice(0, 8).map(product => (
                              <button
                                key={product.id}
                                className="w-full text-left px-2 py-1 text-xs hover:bg-muted flex justify-between items-center"
                                onClick={() => {
                                  const basePrice = parseFloat(product.price || "0");
                                  setEditOrderItems((prev) =>
                                    normalizeEditOrderItems([
                                      ...prev,
                                      {
                                        name: `${product.name} [N] (folding)`,
                                        quantity: 1,
                                        price: basePrice,
                                        baseUnitPrice: basePrice,
                                      },
                                    ]),
                                  );
                                  setEditOrderAddItemSearch("");
                                }}
                                data-testid={`button-add-product-${product.id}`}
                              >
                                <span>{product.name}</span>
                                <span className="text-muted-foreground">{parseFloat(product.price || "0").toFixed(2)} AED</span>
                              </button>
                            ))}
                            {products?.filter(p => p.name.toLowerCase().includes(editOrderAddItemSearch.toLowerCase())).length === 0 && (
                              <div className="px-2 py-1 text-xs text-muted-foreground">No items found</div>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    parseOrderItems(orderDetailDialog.items).map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 hover:bg-muted/30">
                        <div className="flex items-center gap-2">
                          {getCategoryIcon(
                            getProductCategoryGroupName(
                              products?.find((p) => p.name === item.name)
                                ?.category || null,
                            ),
                            "w-4 h-4",
                          )}
                          <span className="text-sm break-words">{stripEmbeddedItemPriceText(item.name)}</span>
                        </div>
                        <Badge variant="secondary" className="text-xs">x{item.quantity}</Badge>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex justify-between items-center mt-2 pt-2 border-t">
                  <span className="font-medium text-sm">Total:</span>
                  {editOrderAuthenticated ? (
                    <div className="text-right">
                      <span className="font-bold text-sm">
                        {editOrderItems.reduce((s, it) => s + it.quantity, 0)} items
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">
                        = {editOrderItems.filter(it => it.quantity > 0).reduce((s, it) => s + getEditOrderItemTotal(it), 0).toFixed(2)} AED
                      </span>
                    </div>
                  ) : (
                    <span className="font-bold text-sm">
                      {parseOrderItems(orderDetailDialog.items).reduce((sum, item) => sum + item.quantity, 0)} items
                    </span>
                  )}
                </div>
              </div>

              {/* Edit Mode: Price Override, Discount & Undo Bill - Admin auth only */}
              {editOrderAuthenticated && editOrderAuthLevel === "admin" && (
                <div className="space-y-3 border rounded-lg p-3 bg-blue-50/50 dark:bg-blue-950/20">
                  <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1">
                    <Edit className="w-4 h-4" /> Edit Options
                  </p>
                  <div className="space-y-2">
                    <div className="rounded-md border bg-white/70 dark:bg-slate-950/20 px-3 py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Order Priority</p>
                          <p className="text-[11px] text-muted-foreground">
                            Change the whole order priority here instead of from the table.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={editOrderPriorityUrgent ? "outline" : "default"}
                            className={`${!editOrderPriorityUrgent ? "bg-green-600 hover:bg-green-700 text-white" : "text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/30"}`}
                            onClick={() => handleEditOrderPriorityChange(false)}
                            data-testid="button-edit-order-priority-normal"
                          >
                            <Clock className="w-3.5 h-3.5 mr-1" />
                            Normal
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={editOrderPriorityUrgent ? "default" : "outline"}
                            className={`${editOrderPriorityUrgent ? "bg-red-600 hover:bg-red-700 text-white" : "text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950/30"}`}
                            onClick={() => handleEditOrderPriorityChange(true)}
                            data-testid="button-edit-order-priority-urgent"
                          >
                            <Zap className="w-3.5 h-3.5 mr-1" />
                            Urgent
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-md border bg-white/70 dark:bg-slate-950/20 px-3 py-3">
                      {(() => {
                        const editableServiceItems = editOrderItems.filter(
                          (item) => !parseSqmDescriptionPart(item.name, products),
                        );
                        const allDryClean =
                          editableServiceItems.length > 0 &&
                          editableServiceItems.every(
                            (item) =>
                              getStoredOrderItemServiceType(
                                item.name,
                                orderDetailDialog?.deliveryType,
                              ) === "dc",
                          );
                        const allIronOnly =
                          editableServiceItems.length > 0 &&
                          editableServiceItems.every(
                            (item) =>
                              getStoredOrderItemServiceType(
                                item.name,
                                orderDetailDialog?.deliveryType,
                              ) === "iron_only",
                          );

                        return (
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">All Item Service</p>
                              <p className="text-[11px] text-muted-foreground">
                                Toggle dry clean or iron only for every line. Click the active one again to return all items to normal.
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant={allDryClean ? "default" : "outline"}
                                className={`${allDryClean ? "bg-blue-600 hover:bg-blue-700 text-white" : "text-blue-700 border-blue-300 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-950/30"}`}
                                onClick={() => handleEditOrderServiceAllChange(allDryClean ? "normal" : "dc")}
                                data-testid="button-edit-order-service-all-dc"
                              >
                                Dry Clean All
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant={allIronOnly ? "default" : "outline"}
                                className={`${allIronOnly ? "bg-orange-600 hover:bg-orange-700 text-white" : "text-orange-700 border-orange-300 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-800 dark:hover:bg-orange-950/30"}`}
                                onClick={() => handleEditOrderServiceAllChange(allIronOnly ? "normal" : "iron_only")}
                                data-testid="button-edit-order-service-all-iron"
                              >
                                Iron Only All
                              </Button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    {(() => {
                      const liveOrder = orders?.find((candidate) => candidate.id === orderDetailDialog.id) || orderDetailDialog;
                      const liveBill = liveOrder.billId ? bills?.find((bill) => bill.id === liveOrder.billId) : null;
                      const currentAmounts = liveBill
                        ? getBillDisplayAmounts(liveBill)
                        : {
	                            originalAmount: getOrderWorkReceivedAmount(liveOrder),
	                            discount: getOrderDiscountAmount(liveOrder),
	                            deliveryCharge: getOrderDeliveryChargeAmount(liveOrder),
	                            finalAmount: getOrderFinalAmount(liveOrder),
	                            paidAmount: parseFloat(String(liveOrder.paidAmount || "0")) || 0,
	                            due: 0,
	                          };

	                      return (
	                        <div className="rounded-md border bg-white/70 dark:bg-slate-950/20 px-3 py-2 text-[11px] text-muted-foreground">
	                          Current: Work Received {currentAmounts.originalAmount.toFixed(2)} AED | Delivery {currentAmounts.deliveryCharge.toFixed(2)} AED | Discount {currentAmounts.discount.toFixed(2)} AED | Final {currentAmounts.finalAmount.toFixed(2)} AED | Paid {currentAmounts.paidAmount.toFixed(2)} AED
	                        </div>
	                      );
	                    })()}
	                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
	                      <div>
	                        <Label className="text-xs">Work Received</Label>
	                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editOrderNewPrice}
                          onChange={(e) => setEditOrderNewPrice(e.target.value)}
                          placeholder={`${(() => {
                            const bill = bills?.find(b => b.id === orderDetailDialog.billId);
                            if (!bill) return "0.00";
                            return getBillDisplayAmounts(bill).originalAmount.toFixed(2);
                          })()}`}
                          className="h-8 text-sm"
	                          data-testid="input-edit-order-price"
	                        />
	                      </div>
	                      <div>
	                        <div className="flex items-center justify-between gap-2">
	                          <Label className="text-xs">Delivery Charge</Label>
	                          <Switch
	                            checked={editOrderApplyDeliveryCharge}
	                            onCheckedChange={(checked) => {
	                              const nextChecked = checked === true;
	                              setEditOrderApplyDeliveryCharge(nextChecked);
	                              if (nextChecked && !editOrderDeliveryCharge) {
	                                const bill = bills?.find(b => b.id === orderDetailDialog.billId);
	                                const liveOrder =
	                                  orders?.find((candidate) => candidate.id === orderDetailDialog.id) ||
	                                  orderDetailDialog;
	                                const currentDelivery = bill
	                                  ? getBillDisplayAmounts(bill).deliveryCharge
	                                  : getOrderDeliveryChargeAmount(liveOrder);
	                                setEditOrderDeliveryCharge(
	                                  currentDelivery > 0.009
	                                    ? currentDelivery.toFixed(2)
	                                    : DEFAULT_DELIVERY_CHARGE_AMOUNT.toFixed(2),
	                                );
	                              }
	                            }}
	                            aria-label="Edit delivery charge"
	                            data-testid="switch-edit-order-delivery-charge"
	                          />
	                        </div>
	                        <Input
	                          type="number"
	                          step="0.01"
	                          min="0"
	                          value={editOrderDeliveryCharge}
	                          onChange={(e) => setEditOrderDeliveryCharge(e.target.value)}
	                          disabled={!editOrderApplyDeliveryCharge}
	                          placeholder={`${(() => {
	                            const bill = bills?.find(b => b.id === orderDetailDialog.billId);
	                            if (!bill) return "0.00";
	                            return getBillDisplayAmounts(bill).deliveryCharge.toFixed(2);
	                          })()}`}
	                          className="h-8 text-sm"
	                          data-testid="input-edit-order-delivery-charge"
	                        />
	                      </div>
	                      <div>
	                        <Label className="text-xs">Paid Amount</Label>
	                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editOrderPaidAmount}
                          onChange={(e) => setEditOrderPaidAmount(e.target.value)}
                          placeholder={`${(() => {
                            const bill = bills?.find(b => b.id === orderDetailDialog.billId);
                            if (!bill) return "0.00";
                            return getBillDisplayAmounts(bill).paidAmount.toFixed(2);
                          })()}`}
                          className="h-8 text-sm"
                          data-testid="input-edit-order-paid-amount"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Discount</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editOrderDiscount}
                          onChange={(e) => setEditOrderDiscount(e.target.value)}
                          placeholder={`${(() => {
                            const bill = bills?.find(b => b.id === orderDetailDialog.billId);
                            if (!bill) return "0.00";
                            return getBillDisplayAmounts(bill).discount.toFixed(2);
                          })()}`}
                          className="h-8 text-sm"
                          data-testid="input-edit-order-discount"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Final Amount</Label>
                        <Input
                          readOnly
                          value={(() => {
                            const bill = bills?.find(b => b.id === orderDetailDialog.billId);
	                            const currentAmounts = bill
	                              ? getBillDisplayAmounts(bill)
	                              : { originalAmount: 0, discount: 0, deliveryCharge: 0, finalAmount: 0, paidAmount: 0, due: 0 };
	                            const parsedWorkReceived = parseFloat(editOrderNewPrice);
	                            const parsedDiscount = parseFloat(editOrderDiscount);
	                            const parsedDeliveryCharge = parseFloat(editOrderDeliveryCharge);
	                            const workReceived = Number.isFinite(parsedWorkReceived)
	                              ? parsedWorkReceived
	                              : currentAmounts.originalAmount;
	                            const discount = Number.isFinite(parsedDiscount)
	                              ? Math.max(0, parsedDiscount)
	                              : currentAmounts.discount;
	                            const deliveryCharge = editOrderApplyDeliveryCharge
	                              ? Number.isFinite(parsedDeliveryCharge)
	                                ? Math.max(0, parsedDeliveryCharge)
	                                : DEFAULT_DELIVERY_CHARGE_AMOUNT
	                              : 0;
	                            const liveOrder =
	                              orders?.find((candidate) => candidate.id === orderDetailDialog.id) ||
	                              orderDetailDialog;
	                            return (
	                              Math.max(0, workReceived - discount) +
	                              getOrderTipsAmount(liveOrder) +
	                              deliveryCharge
	                            ).toFixed(2);
	                          })()}
                          className="h-8 text-sm font-semibold bg-muted/50"
                          data-testid="input-edit-order-final-amount"
                        />
                      </div>
                    </div>
                    {editOrderDiscount && parseFloat(editOrderDiscount) > 0 && (
                      <p className="text-xs text-green-700 bg-green-50 dark:bg-green-950/30 dark:text-green-300 rounded p-1.5">
                        Discount of AED {parseFloat(editOrderDiscount).toFixed(2)} will be applied. Final amount: AED {(() => {
                          const bill = bills?.find(b => b.id === orderDetailDialog.billId);
	                          const currentAmounts = bill
	                            ? getBillDisplayAmounts(bill)
	                            : { originalAmount: 0, discount: 0, deliveryCharge: 0, finalAmount: 0, paidAmount: 0, due: 0 };
	                          const parsedWorkReceived = parseFloat(editOrderNewPrice);
	                          const parsedDeliveryCharge = parseFloat(editOrderDeliveryCharge);
	                          const base = Number.isFinite(parsedWorkReceived)
	                            ? parsedWorkReceived
	                            : currentAmounts.originalAmount;
	                          const liveOrder =
	                            orders?.find((candidate) => candidate.id === orderDetailDialog.id) ||
	                            orderDetailDialog;
	                          const deliveryCharge = editOrderApplyDeliveryCharge
	                            ? Number.isFinite(parsedDeliveryCharge)
	                              ? Math.max(0, parsedDeliveryCharge)
	                              : DEFAULT_DELIVERY_CHARGE_AMOUNT
	                            : 0;
	                          return (
	                            Math.max(0, base - parseFloat(editOrderDiscount)) +
	                            getOrderTipsAmount(liveOrder) +
	                            deliveryCharge
	                          ).toFixed(2);
	                        })()}
                      </p>
                    )}
                    {editOrderNewPrice && (
                      <div>
                        <Label className="text-xs">Reason for Price Change</Label>
                        <Input
                          value={editOrderPriceReason}
                          onChange={(e) => setEditOrderPriceReason(e.target.value)}
                          placeholder="e.g. added extra items, discount"
                          className="h-8 text-sm"
                          data-testid="input-edit-order-price-reason"
                        />
                      </div>
                    )}
                    {orderDetailDialog.billId && (() => {
                      const linkedBill = bills?.find(b => b.id === orderDetailDialog.billId);
                      const hasPaid = linkedBill && parseFloat(linkedBill.paidAmount || "0") > 0;
                      if (!hasPaid) return null;
                      return (
                        <div className="border-t pt-2">
                          <Button
                            variant="destructive"
                            size="sm"
                            className="w-full h-8"
                            disabled={editOrderRevertingPayment}
                            onClick={() => openBillPaymentRevertDialog(orderDetailDialog.billId)}
                            data-testid="button-revert-payment-order"
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                            {editOrderRevertingPayment ? "Reverting..." : "Revert to Unpaid"}
                          </Button>
                          <p className="text-[10px] text-muted-foreground mt-1">Reset bill payment status and remove payment records</p>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Notes */}
              {orderDetailDialog.notes && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-medium mb-1">Notes</p>
                  <p className="text-sm text-amber-900 dark:text-amber-200">{orderDetailDialog.notes}</p>
                </div>
              )}

              {/* Staff Info */}
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                {orderDetailDialog.tagBy && (
                  <div>Tagged by: <span className="font-medium text-foreground">{orderDetailDialog.tagBy}</span></div>
                )}
                {orderDetailDialog.packingBy && (
                  <div>Packed by: <span className="font-medium text-foreground">{orderDetailDialog.packingBy}</span></div>
                )}
                {formatActorLabel(orderDetailDialog.deliveryBy) && (
                  <div>{getOrderCompletionByLabel(orderDetailDialog.deliveryType)}: <span className="font-medium text-foreground">{formatActorLabel(orderDetailDialog.deliveryBy)}</span></div>
                )}
                {orderDetailDialog.deliveryDate && (
                  <div>{getOrderCompletionDateLabel(orderDetailDialog.deliveryType)}: <span className="font-medium text-foreground">{format(new Date(orderDetailDialog.deliveryDate), "MMM d, yyyy hh:mm a")}</span></div>
                )}
              </div>

              {/* Password / Edit Toggle */}
              {!editOrderAuthenticated ? (
                <div className="border rounded-lg p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">Enter admin or counter PIN to edit this order</p>
                  <div className="flex gap-2">
                    <Input
                      ref={editOrderPinInputRef}
                      type="password"
                      inputMode="numeric"
                      maxLength={5}
                      value={editOrderPin}
                      onChange={(e) => { setEditOrderPin(e.target.value.replace(/\D/g, "").slice(0, 5)); setEditOrderAdminError(""); }}
                      placeholder="Enter 5-digit PIN"
                      className="h-8 text-sm flex-1"
                      onKeyDown={(e) => { if (e.key === "Enter") handleEditOrderAuth(); }}
                      data-testid="input-edit-order-admin-password"
                    />
                    <Button size="sm" className="h-8" onClick={handleEditOrderAuth} data-testid="button-unlock-edit-order">
                      <Lock className="w-3 h-3 mr-1" /> Unlock
                    </Button>
                  </div>
                  {editOrderAdminError && <p className="text-xs text-destructive">{editOrderAdminError}</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  {editOrderAdminError && <p className="text-xs text-destructive">{editOrderAdminError}</p>}
                  {editOrderAuthLevel === "admin" && (
                    <Button
                      variant="outline"
                      className="w-full h-8 text-xs gap-1 border-indigo-500 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950"
                      onClick={() => orderDetailDialog && openSingleDateEditDialog(orderDetailDialog)}
                      data-testid="button-single-edit-date-order"
                    >
                      <CalendarIcon className="w-3 h-3" />
                      Edit Entry Date / Time
                    </Button>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 h-9"
                      onClick={() => {
                        setEditOrderAuthenticated(false);
                        setEditOrderAuthLevel(null);
                        setEditOrderPriorityUrgent(Boolean(orderDetailDialog?.urgent));
                        setEditOrderPin("");
                        setEditOrderAdminError("");
                        setEditOrderItems([]);
                        setEditOrderNewPrice("");
                        setEditOrderPriceReason("");
	                        setEditOrderPaidAmount("");
	                        setEditOrderDiscount("");
	                        setEditOrderApplyDeliveryCharge(false);
	                        setEditOrderDeliveryCharge("");
	                        setEditOrderRevertingPayment(false);
                        setEditOrderAddItemSearch("");
                      }}
                      data-testid="button-cancel-edit-order"
                    >
                      Cancel Edit
                    </Button>
                    <Button
                      className="flex-1 h-9 bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={handleSaveEditOrder}
                      disabled={editOrderSaving}
                      data-testid="button-save-edit-order"
                    >
                      {editOrderSaving ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Saving...</> : <><Save className="w-3 h-3 mr-1" /> Save Changes</>}
                    </Button>
                  </div>
                </div>
              )}

              {/* Bottom actions when NOT editing */}
              {!editOrderAuthenticated && (
                <div className="flex gap-2 w-full">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setOrderDetailDialog(null)}
                    data-testid="button-close-order-detail"
                  >
                    Close
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (orderDetailDialog) {
                        setPendingDeleteOrderId(orderDetailDialog.id);
                        setOrderDetailDialog(null);
                        setDeleteOrderConfirmDialog(true);
                      }
                    }}
                    data-testid="button-delete-order-detail"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editOrderSplitDialog} onOpenChange={(open) => { if (!open) closeEditOrderSplitDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Split Mixed Item</DialogTitle>
            <DialogDescription>
              Choose how many pieces should move to {editOrderSplitTargetLabel}. The remaining quantity will stay on the current line.
            </DialogDescription>
          </DialogHeader>
          {editOrderSplitSourceItem && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
                <p className="font-medium text-foreground">
                  {stripEmbeddedItemPriceText(editOrderSplitSourceItem.name)}
                </p>
                <p className="text-muted-foreground">
                  Current line quantity: {editOrderSplitSourceItem.quantity}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Move to {editOrderSplitTargetLabel}</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => handleEditOrderSplitQuantityAdjust(-1)}
                    disabled={editOrderSplitSafeQuantity <= 1}
                    data-testid="button-edit-order-split-minus"
                  >
                    <Minus className="w-3 h-3" />
                  </Button>
                  <Input
                    type="number"
                    min="1"
                    max={editOrderSplitMaxQuantity || 1}
                    value={editOrderSplitQuantity}
                    onChange={(e) => setEditOrderSplitQuantity(e.target.value.replace(/\D/g, ""))}
                    className="h-8 text-center"
                    data-testid="input-edit-order-split-quantity"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => handleEditOrderSplitQuantityAdjust(1)}
                    disabled={editOrderSplitSafeQuantity >= editOrderSplitMaxQuantity}
                    data-testid="button-edit-order-split-plus"
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {editOrderSplitSafeQuantity > 0
                    ? `${editOrderSplitSafeQuantity} piece${editOrderSplitSafeQuantity === 1 ? "" : "s"} will move to ${editOrderSplitTargetLabel}, and ${Math.max(editOrderSplitMaxQuantity - editOrderSplitSafeQuantity, 0)} will stay on this line.`
                    : "Enter a valid quantity to continue."}
                </p>
              </div>
              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeEditOrderSplitDialog}
                  data-testid="button-edit-order-split-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={handleApplyEditOrderSplit}
                  data-testid="button-edit-order-split-apply"
                >
                  Apply Split
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editingNoteOrderId !== null} onOpenChange={(open) => { if (!open) { setEditingNoteOrderId(null); setEditingNoteText(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingNoteText ? "Edit" : "Add"} Order Note</DialogTitle>
            <DialogDescription>
              {editingNoteText ? "Update the note for this order." : "Add a note to this order."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editingNoteText}
            onChange={(e) => setEditingNoteText(e.target.value)}
            placeholder="Enter order note..."
            className="min-h-[100px]"
            style={{ fontFamily: "Arial, sans-serif" }}
            data-testid="input-order-note"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setEditingNoteOrderId(null); setEditingNoteText(""); }} data-testid="button-cancel-note">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editingNoteOrderId !== null) {
                  updateOrderMutation.mutate(
                    { id: editingNoteOrderId, updates: { notes: editingNoteText.trim() || null } },
                    { onSuccess: () => {
                      toast({ title: "Note Updated", description: editingNoteText.trim() ? "Order note has been saved." : "Order note has been removed." });
                      setEditingNoteOrderId(null);
                      setEditingNoteText("");
                    }}
                  );
                }
              }}
              disabled={updateOrderMutation.isPending}
              data-testid="button-save-note"
            >
              {updateOrderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Save Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOrderConfirmDialog} onOpenChange={(open) => { if (!open) { setDeleteOrderConfirmDialog(false); setPendingDeleteOrderId(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Order</DialogTitle>
            <DialogDescription>
              Deleting this order will also delete its linked bill and only the transaction history of this specific bill. If the bill was paid by credit, the credits will be added back to the client. Other client history will not be affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setDeleteOrderConfirmDialog(false); setPendingDeleteOrderId(null); }} data-testid="button-cancel-delete-confirm">
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => { setDeleteOrderConfirmDialog(false); setDeleteOrderDialog(true); }} data-testid="button-proceed-delete-confirm">
              Proceed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOrderDialog} onOpenChange={(open) => { if (!open) { setDeleteOrderDialog(false); setPendingDeleteOrderId(null); setDeleteOrderAdminPassword(""); setDeleteOrderAdminError(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Admin Authorization Required</DialogTitle>
            <DialogDescription>Enter admin PIN to delete this order and its linked bill.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Admin PIN</Label>
              <Input
                type="password"
                value={deleteOrderAdminPassword}
                onChange={(e) => { setDeleteOrderAdminPassword(e.target.value.replace(/\D/g, "").slice(0, 5)); setDeleteOrderAdminError(""); }}
                placeholder="Enter 5-digit admin PIN"
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirmDeleteOrder(); }}
                data-testid="input-admin-delete-order-password"
              />
              {deleteOrderAdminError && <p className="text-xs text-destructive mt-1">{deleteOrderAdminError}</p>}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setDeleteOrderDialog(false); setPendingDeleteOrderId(null); setDeleteOrderAdminPassword(""); setDeleteOrderAdminError(""); }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeleteOrder} data-testid="button-confirm-delete-order">
              Delete Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteConfirmDialog} onOpenChange={(open) => { if (!open) { setBulkDeleteConfirmDialog(false); setBulkDeleteAdminPassword(""); setBulkDeleteAdminError(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Delete {selectedOrderIds.size} Order{selectedOrderIds.size > 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the selected order{selectedOrderIds.size > 1 ? "s" : ""} and their linked bills. Credits from paid bills will be refunded to clients. Enter admin PIN to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Admin PIN</Label>
              <Input
                type="password"
                value={bulkDeleteAdminPassword}
                onChange={(e) => { setBulkDeleteAdminPassword(e.target.value.replace(/\D/g, "").slice(0, 5)); setBulkDeleteAdminError(""); }}
                placeholder="Enter 5-digit admin PIN"
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirmBulkDelete(); }}
                data-testid="input-admin-bulk-delete-password"
              />
              {bulkDeleteAdminError && <p className="text-xs text-destructive mt-1">{bulkDeleteAdminError}</p>}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setBulkDeleteConfirmDialog(false); setBulkDeleteAdminPassword(""); setBulkDeleteAdminError(""); }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmBulkDelete} disabled={bulkDeleting} data-testid="button-confirm-bulk-delete">
              {bulkDeleting ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Deleting...</> : `Delete ${selectedOrderIds.size} Order${selectedOrderIds.size > 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ErrorBoundary>
      <Dialog open={bulkTagDialog} onOpenChange={(open) => { if (!open) { setBulkTagDialog(false); setBulkTagAdminError(""); clearStaffPinInput(bulkTagStaffPinInputRef); clearStaffPinPreview("bulkTag"); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blue-600">
              <Tag className="w-5 h-5" />
              Bulk Tag {getSelectedPendingTagCount()} Order{getSelectedPendingTagCount() > 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              This will mark {getSelectedPendingTagCount()} pending order{getSelectedPendingTagCount() > 1 ? "s" : ""} as tagged. Enter the staff PIN and the system will match the staff member automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm" htmlFor="bulk-tag-staff-pin">Staff PIN</Label>
              {renderStaffPinPreview("bulkTag")}
              <Input
                ref={bulkTagStaffPinInputRef}
                id="bulk-tag-staff-pin"
                type="password"
                maxLength={5}
                inputMode="numeric"
                onInput={(e) => {
                  normalizeStaffPinField(e);
                  void updateStaffPinPreview("bulkTag", e.currentTarget.value);
                  if (bulkTagAdminError) setBulkTagAdminError("");
                }}
                placeholder="Enter 5-digit PIN"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleConfirmBulkTag();
                  }
                }}
                data-testid="input-bulk-tag-staff-pin"
                name="bulk-tag-staff-pin"
              />
              <p className="mt-1 text-xs text-muted-foreground">Staff name will be matched automatically from this PIN.</p>
              {bulkTagAdminError && <p className="text-xs text-destructive mt-1">{bulkTagAdminError}</p>}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setBulkTagDialog(false); setBulkTagAdminError(""); clearStaffPinInput(bulkTagStaffPinInputRef); clearStaffPinPreview("bulkTag"); }}>
              Cancel
            </Button>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleConfirmBulkTag} disabled={bulkTagging} data-testid="button-confirm-bulk-tag">
              {bulkTagging ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Tagging...</> : `Tag ${getSelectedPendingTagCount()} Order${getSelectedPendingTagCount() > 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </ErrorBoundary>

      <Dialog open={bulkUntagDialog} onOpenChange={(open) => { if (!open) { setBulkUntagDialog(false); setBulkUntagAdminPin(""); setBulkUntagAdminError(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <RotateCcw className="w-5 h-5" />
              Bulk Untag {getSelectedTaggedCount()} Order{getSelectedTaggedCount() > 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              This will reverse the tag status for {getSelectedTaggedCount()} tagged order{getSelectedTaggedCount() > 1 ? "s" : ""}. Only tagged (not yet packed) orders will be affected. Enter admin PIN to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Admin PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={5}
                value={bulkUntagAdminPin}
                onChange={(e) => { setBulkUntagAdminPin(sanitizeStaffPinValue(e.target.value)); setBulkUntagAdminError(""); }}
                placeholder="Enter 5-digit PIN"
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirmBulkUntag(); }}
                data-testid="input-admin-bulk-untag-password"
              />
              {bulkUntagAdminError && <p className="text-xs text-destructive mt-1">{bulkUntagAdminError}</p>}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setBulkUntagDialog(false); setBulkUntagAdminPin(""); setBulkUntagAdminError(""); }}>
              Cancel
            </Button>
            <Button className="bg-orange-600 hover:bg-orange-700 text-white" onClick={handleConfirmBulkUntag} disabled={bulkUntagging} data-testid="button-confirm-bulk-untag">
              {bulkUntagging ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Untagging...</> : `Untag ${getSelectedTaggedCount()} Order${getSelectedTaggedCount() > 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ErrorBoundary>
      <Dialog open={bulkPackDialog} onOpenChange={(open) => { if (!open) { setBulkPackDialog(false); setBulkPackAdminError(""); clearStaffPinInput(bulkPackStaffPinInputRef); clearStaffPinPreview("bulkPack"); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <Package className="w-5 h-5" />
              Bulk Pack {getSelectedWashingPackCount()} Order{getSelectedWashingPackCount() > 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              This will mark {getSelectedWashingPackCount()} tagged order{getSelectedWashingPackCount() > 1 ? "s" : ""} as packed. Enter the staff PIN and the system will match the staff member automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm" htmlFor="bulk-pack-staff-pin">Staff PIN</Label>
              {renderStaffPinPreview("bulkPack")}
              <Input
                ref={bulkPackStaffPinInputRef}
                id="bulk-pack-staff-pin"
                type="password"
                maxLength={5}
                inputMode="numeric"
                onInput={(e) => {
                  normalizeStaffPinField(e);
                  void updateStaffPinPreview("bulkPack", e.currentTarget.value);
                  if (bulkPackAdminError) setBulkPackAdminError("");
                }}
                placeholder="Enter 5-digit PIN"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleConfirmBulkPack();
                  }
                }}
                data-testid="input-bulk-pack-staff-pin"
                name="bulk-pack-staff-pin"
              />
              <p className="mt-1 text-xs text-muted-foreground">Staff name will be matched automatically from this PIN.</p>
              {bulkPackAdminError && <p className="text-xs text-destructive mt-1">{bulkPackAdminError}</p>}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setBulkPackDialog(false); setBulkPackAdminError(""); clearStaffPinInput(bulkPackStaffPinInputRef); clearStaffPinPreview("bulkPack"); }}>
              Cancel
            </Button>
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={handleConfirmBulkPack} disabled={bulkPacking} data-testid="button-confirm-bulk-pack">
              {bulkPacking ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Packing...</> : `Pack ${getSelectedWashingPackCount()} Order${getSelectedWashingPackCount() > 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </ErrorBoundary>

      <ErrorBoundary>
      <Dialog open={bulkDeliverDialog} onOpenChange={(open) => { if (!open) { setBulkDeliverDialog(false); setBulkDeliverAdminError(""); clearStaffPinInput(bulkDeliverStaffPinInputRef); clearStaffPinPreview("bulkDeliver"); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-cyan-600">
              <Truck className="w-5 h-5" />
              Bulk Deliver {getSelectedPackedDeliveryCount()} Order{getSelectedPackedDeliveryCount() > 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              This will mark {getSelectedPackedDeliveryCount()} delivery order{getSelectedPackedDeliveryCount() > 1 ? "s" : ""} as delivered. Enter the staff PIN and the system will match the staff member automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm" htmlFor="bulk-deliver-staff-pin">Staff PIN</Label>
              {renderStaffPinPreview("bulkDeliver")}
              <Input
                ref={bulkDeliverStaffPinInputRef}
                id="bulk-deliver-staff-pin"
                type="password"
                maxLength={5}
                inputMode="numeric"
                onInput={(e) => {
                  normalizeStaffPinField(e);
                  void updateStaffPinPreview("bulkDeliver", e.currentTarget.value);
                  if (bulkDeliverAdminError) setBulkDeliverAdminError("");
                }}
                placeholder="Enter 5-digit PIN"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleConfirmBulkDeliver();
                  }
                }}
                data-testid="input-bulk-deliver-staff-pin"
                name="bulk-deliver-staff-pin"
              />
              <p className="mt-1 text-xs text-muted-foreground">Staff name will be matched automatically from this PIN.</p>
              {bulkDeliverAdminError && <p className="text-xs text-destructive mt-1">{bulkDeliverAdminError}</p>}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setBulkDeliverDialog(false); setBulkDeliverAdminError(""); clearStaffPinInput(bulkDeliverStaffPinInputRef); clearStaffPinPreview("bulkDeliver"); }}>
              Cancel
            </Button>
            <Button className="bg-cyan-600 hover:bg-cyan-700 text-white" onClick={handleConfirmBulkDeliver} disabled={bulkDelivering} data-testid="button-confirm-bulk-deliver">
              {bulkDelivering ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Delivering...</> : `Deliver ${getSelectedPackedDeliveryCount()} Order${getSelectedPackedDeliveryCount() > 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </ErrorBoundary>

      <ErrorBoundary>
      <Dialog open={bulkTakeawayDialog} onOpenChange={(open) => { if (!open) { setBulkTakeawayDialog(false); setBulkTakeawayAdminError(""); clearStaffPinInput(bulkTakeawayStaffPinInputRef); clearStaffPinPreview("bulkTakeaway"); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <Home className="w-5 h-5" />
              Bulk Takeaway {getSelectedPackedTakeawayCount()} Order{getSelectedPackedTakeawayCount() > 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              This will mark {getSelectedPackedTakeawayCount()} packed takeaway order{getSelectedPackedTakeawayCount() > 1 ? "s" : ""} as taken away. Enter the staff PIN and the system will match the staff member automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm" htmlFor="bulk-takeaway-staff-pin">Staff PIN</Label>
              {renderStaffPinPreview("bulkTakeaway")}
              <Input
                ref={bulkTakeawayStaffPinInputRef}
                id="bulk-takeaway-staff-pin"
                type="password"
                maxLength={5}
                inputMode="numeric"
                onInput={(e) => {
                  normalizeStaffPinField(e);
                  void updateStaffPinPreview("bulkTakeaway", e.currentTarget.value);
                  if (bulkTakeawayAdminError) setBulkTakeawayAdminError("");
                }}
                placeholder="Enter 5-digit PIN"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleConfirmBulkTakeaway();
                  }
                }}
                data-testid="input-bulk-takeaway-staff-pin"
                name="bulk-takeaway-staff-pin"
              />
              <p className="mt-1 text-xs text-muted-foreground">Staff name will be matched automatically from this PIN.</p>
              {bulkTakeawayAdminError && <p className="text-xs text-destructive mt-1">{bulkTakeawayAdminError}</p>}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setBulkTakeawayDialog(false); setBulkTakeawayAdminError(""); clearStaffPinInput(bulkTakeawayStaffPinInputRef); clearStaffPinPreview("bulkTakeaway"); }}>
              Cancel
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleConfirmBulkTakeaway} disabled={bulkTakeawaying} data-testid="button-confirm-bulk-takeaway">
              {bulkTakeawaying ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Processing...</> : `Takeaway ${getSelectedPackedTakeawayCount()} Order${getSelectedPackedTakeawayCount() > 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </ErrorBoundary>

      <Dialog open={bulkUnpackDialog} onOpenChange={(open) => { if (!open) { setBulkUnpackDialog(false); setBulkUnpackAdminPin(""); setBulkUnpackAdminError(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <RotateCcw className="w-5 h-5" />
              Bulk Unpack {getSelectedPackedCount()} Order{getSelectedPackedCount() > 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              This will reverse the packing status for {getSelectedPackedCount()} packed order{getSelectedPackedCount() > 1 ? "s" : ""}. Only packed (not yet delivered) orders will be affected. Enter admin PIN to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Admin PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={5}
                value={bulkUnpackAdminPin}
                onChange={(e) => { setBulkUnpackAdminPin(sanitizeStaffPinValue(e.target.value)); setBulkUnpackAdminError(""); }}
                placeholder="Enter 5-digit PIN"
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirmBulkUnpack(); }}
                data-testid="input-admin-bulk-unpack-password"
              />
              {bulkUnpackAdminError && <p className="text-xs text-destructive mt-1">{bulkUnpackAdminError}</p>}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setBulkUnpackDialog(false); setBulkUnpackAdminPin(""); setBulkUnpackAdminError(""); }}>
              Cancel
            </Button>
            <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={handleConfirmBulkUnpack} disabled={bulkUnpacking} data-testid="button-confirm-bulk-unpack">
              {bulkUnpacking ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Unpacking...</> : `Unpack ${getSelectedPackedCount()} Order${getSelectedPackedCount() > 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkDateEditDialog}
        onOpenChange={(open) => {
          if (!open) {
            setBulkDateEditDialog(false);
            setBulkDateEditPin("");
            setBulkDateEditValue("");
            setBulkDateEditReason("");
            setBulkDateEditShiftTagDate(true);
            setBulkDateEditShiftPackDate(true);
            setBulkDateEditShiftDeliveryDate(true);
            setBulkDateEditPreserveSpacing(true);
            setBulkDateEditSpacingMinutes("1");
            setBulkDateEditError("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-indigo-600">
              <CalendarIcon className="w-5 h-5" />
              Bulk Edit Order Date/Time
            </DialogTitle>
            <DialogDescription>
              Apply a target date/time to the checked stages for {selectedOrderIds.size} selected order{selectedOrderIds.size > 1 ? "s" : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Target Date & Time</Label>
              <Input
                type="datetime-local"
                value={bulkDateEditValue}
                onChange={(e) => {
                  setBulkDateEditValue(e.target.value);
                  setBulkDateEditError("");
                }}
                data-testid="input-bulk-date-edit-value"
              />
            </div>
            <div>
              <Label className="text-sm">Reason</Label>
              <Input
                value={bulkDateEditReason}
                onChange={(e) => setBulkDateEditReason(e.target.value)}
                placeholder="Reason for date change"
                data-testid="input-bulk-date-edit-reason"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Apply target date/time to these stages</Label>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="bulk-date-edit-shift-tag"
                    checked={bulkDateEditShiftTagDate}
                    onCheckedChange={(value) => setBulkDateEditShiftTagDate(value === true)}
                    data-testid="checkbox-bulk-date-edit-shift-tag"
                  />
                  <Label htmlFor="bulk-date-edit-shift-tag" className="text-sm cursor-pointer">
                    Entry and Tag
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="bulk-date-edit-shift-pack"
                    checked={bulkDateEditShiftPackDate}
                    onCheckedChange={(value) => setBulkDateEditShiftPackDate(value === true)}
                    data-testid="checkbox-bulk-date-edit-shift-pack"
                  />
                  <Label htmlFor="bulk-date-edit-shift-pack" className="text-sm cursor-pointer">
                    Pack
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="bulk-date-edit-shift-delivery"
                    checked={bulkDateEditShiftDeliveryDate}
                    onCheckedChange={(value) => setBulkDateEditShiftDeliveryDate(value === true)}
                    data-testid="checkbox-bulk-date-edit-shift-delivery"
                  />
                  <Label htmlFor="bulk-date-edit-shift-delivery" className="text-sm cursor-pointer">
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
                id="bulk-date-edit-spacing"
                checked={bulkDateEditPreserveSpacing}
                onCheckedChange={(value) => setBulkDateEditPreserveSpacing(value === true)}
                data-testid="checkbox-bulk-date-edit-spacing"
              />
              <Label htmlFor="bulk-date-edit-spacing" className="text-sm cursor-pointer">
                Preserve order spacing
              </Label>
            </div>
            {bulkDateEditPreserveSpacing && (
              <div>
                <Label className="text-sm">Spacing (minutes)</Label>
                <Input
                  type="number"
                  min="0"
                  value={bulkDateEditSpacingMinutes}
                  onChange={(e) => setBulkDateEditSpacingMinutes(e.target.value)}
                  data-testid="input-bulk-date-edit-spacing"
                />
              </div>
            )}
            <div>
              <Label className="text-sm">Admin or Counter PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={5}
                value={bulkDateEditPin}
                onChange={(e) => {
                  setBulkDateEditPin(e.target.value.replace(/\D/g, "").slice(0, 5));
                  setBulkDateEditError("");
                }}
                placeholder="Enter 5-digit PIN"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConfirmBulkEditDate();
                }}
                data-testid="input-bulk-date-edit-pin"
              />
            </div>
            {bulkDateEditError && <p className="text-xs text-destructive">{bulkDateEditError}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setBulkDateEditDialog(false);
                setBulkDateEditError("");
              }}
            >
              Cancel
            </Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handleConfirmBulkEditDate}
              disabled={bulkDateEditing}
              data-testid="button-confirm-bulk-date-edit"
            >
              {bulkDateEditing ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  Saving...
                </>
              ) : (
                <>
                  <CalendarIcon className="w-3 h-3 mr-1" />
                  Update Dates
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!singleDateEditDialog}
        onOpenChange={(open) => {
          if (!open) {
            setSingleDateEditDialog(null);
            setSingleDateEditValue("");
            setSingleDateEditReason("");
            setSingleDateEditShiftTagDate(true);
            setSingleDateEditShiftPackDate(true);
            setSingleDateEditShiftDeliveryDate(true);
            setSingleDateEditError("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-indigo-600">
              <CalendarIcon className="w-5 h-5" />
              Edit Order Date
            </DialogTitle>
            <DialogDescription>
              Apply a target date/time to the checked stages for order #{singleDateEditDialog?.orderNumber}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Target Date & Time</Label>
              <Input
                type="datetime-local"
                value={singleDateEditValue}
                onChange={(e) => {
                  setSingleDateEditValue(e.target.value);
                  setSingleDateEditError("");
                }}
                data-testid="input-single-date-edit-value"
              />
            </div>
            <div>
              <Label className="text-sm">Reason</Label>
              <Input
                value={singleDateEditReason}
                onChange={(e) => setSingleDateEditReason(e.target.value)}
                placeholder="Reason for date change"
                data-testid="input-single-date-edit-reason"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Apply target date/time to these stages</Label>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="single-date-edit-shift-tag"
                    checked={singleDateEditShiftTagDate}
                    onCheckedChange={(value) => setSingleDateEditShiftTagDate(value === true)}
                    data-testid="checkbox-single-date-edit-shift-tag"
                  />
                  <Label htmlFor="single-date-edit-shift-tag" className="text-sm cursor-pointer">
                    Entry and Tag
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="single-date-edit-shift-pack"
                    checked={singleDateEditShiftPackDate}
                    onCheckedChange={(value) => setSingleDateEditShiftPackDate(value === true)}
                    data-testid="checkbox-single-date-edit-shift-pack"
                  />
                  <Label htmlFor="single-date-edit-shift-pack" className="text-sm cursor-pointer">
                    Pack
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="single-date-edit-shift-delivery"
                    checked={singleDateEditShiftDeliveryDate}
                    onCheckedChange={(value) => setSingleDateEditShiftDeliveryDate(value === true)}
                    data-testid="checkbox-single-date-edit-shift-delivery"
                  />
                  <Label htmlFor="single-date-edit-shift-delivery" className="text-sm cursor-pointer">
                    Delivery
                  </Label>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                If Entry and Tag is selected, unchecked Pack and Delivery keep their original date and update only the time. Otherwise, unchecked stages stay unchanged.
              </p>
            </div>
            {singleDateEditError && <p className="text-xs text-destructive">{singleDateEditError}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSingleDateEditDialog(null);
                setSingleDateEditError("");
              }}
            >
              Cancel
            </Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handleConfirmSingleDateEdit}
              disabled={singleDateEditLoading}
              data-testid="button-confirm-single-date-edit"
            >
              {singleDateEditLoading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  Saving...
                </>
              ) : (
                <>
                  <CalendarIcon className="w-3 h-3 mr-1" />
                  Update Date
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!undoDeliveryDialog} onOpenChange={(open) => { if (!open) { setUndoDeliveryDialog(null); setUndoDeliveryPin(""); setUndoDeliveryPinError(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Undo2 className="w-5 h-5" />
              Undo Delivery
            </DialogTitle>
            <DialogDescription>
              This will reverse the delivery status for order #{undoDeliveryDialog?.orderNumber}. Admin PIN is required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Admin PIN (5 digits)</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={5}
                value={undoDeliveryPin}
                onChange={(e) => { setUndoDeliveryPin(e.target.value.replace(/\D/g, "").slice(0, 5)); setUndoDeliveryPinError(""); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleUndoDelivery();
                  }
                }}
                placeholder="Enter admin PIN"
                data-testid="input-undo-delivery-pin"
              />
              {undoDeliveryPinError && <p className="text-sm text-destructive mt-1">{undoDeliveryPinError}</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setUndoDeliveryDialog(null); setUndoDeliveryPin(""); setUndoDeliveryPinError(""); }}>Cancel</Button>
              <Button variant="destructive" className="flex-1" onClick={handleUndoDelivery} data-testid="button-confirm-undo-delivery">Undo Delivery</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrderForm({
  clients,
  bills,
  products,
  onSubmit,
  isLoading,
  initialClientId,
  createdByUser,
  creatorRole,
}: {
  clients: Client[];
  bills: Bill[];
  products: Product[];
  onSubmit: (data: any) => void;
  isLoading: boolean;
  initialClientId?: string;
  createdByUser?: string;
  creatorRole?: string;
}) {
  const { toast } = useToast();

  // Get user role from localStorage for permission checking
  const storedUser = localStorage.getItem("user");
  const userInfo = storedUser ? JSON.parse(storedUser) : null;
  const userRole = userInfo?.role || creatorRole || "";

  const initialClient = initialClientId ? clients.find((c) => c.id === parseInt(initialClientId)) : null;
  const initialClientIsBroker = ((initialClient as any)?.clientType || "").trim().toLowerCase() === "broker";
  const [formData, setFormData] = useState({
    clientId: initialClientId || "",
    orderType: "normal",
    deliveryType: "pickup",
    paymentOption: "pay_later",
    expectedDeliveryAt: "",
    deliveryAddress: initialClient && !initialClientIsBroker && initialClient.address && initialClient.address !== "-" ? initialClient.address.toUpperCase() : "",
    notes: "",
    customerName: initialClient ? (initialClient.name || "").toUpperCase() : "",
    customerPhone: initialClient ? getDisplayPhone(initialClient.phone) : "",
    walkinCompany: "",
  });

  const [newCompanyInput, setNewCompanyInput] = useState("");
  const [showNewCompanyInput, setShowNewCompanyInput] = useState(false);

  const { data: companiesList } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/companies"],
  });
  const existingCompanies = useMemo(() => {
    return (companiesList || []).map(c => c.name).sort();
  }, [companiesList]);
  type ItemEntry = {
    productId: number;
    quantity: number;
    size?: 'small' | 'medium' | 'large';
    serviceType: 'normal' | 'dc' | 'iron_only';
    urgent?: boolean;
    sqm?: number;
    addedAt?: number;
  };
  const [itemEntries, setItemEntries] = useState<Record<string, ItemEntry>>({});
  const [sqmDialog, setSqmDialog] = useState<{ open: boolean; productId: number | null; productName: string; sqmPrice: string }>({
    open: false,
    productId: null,
    productName: "",
    sqmPrice: "12.00"
  });
  const [sqmInput, setSqmInput] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [applyDiscount, setApplyDiscount] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [deliveryCharge, setDeliveryCharge] = useState("");
  const {
    settings: sharedCategorySettings,
    updateSettings: updateSharedCategorySettings,
  } = useProductCategorySettings();
  const allItemsCategoryName = DEFAULT_PRODUCT_CATEGORY_NAME;
  const uncategorizedCategoryName = UNCATEGORIZED_PRODUCT_CATEGORY_NAME;
  const favoritesCategoryName = FAVORITES_PRODUCT_CATEGORY_NAME;
  const isReservedCategoryName = (name: string) =>
    [allItemsCategoryName, uncategorizedCategoryName, favoritesCategoryName].some(
      (reservedName) =>
        reservedName.toLowerCase() === name.trim().toLowerCase(),
    );
  const [userCategoryOrder, setUserCategoryOrder] = useState<string[]>(() => {
    return sharedCategorySettings.orderDisplayOrder;
  });
  const [isReordering, setIsReordering] = useState(false);
  const [showCategoryManagerDialog, setShowCategoryManagerDialog] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [renameFromCategory, setRenameFromCategory] = useState("");
  const [renameToCategory, setRenameToCategory] = useState("");
  const [categoryActionError, setCategoryActionError] = useState("");
  const [categoryActionLoading, setCategoryActionLoading] = useState(false);

  useEffect(() => {
    setUserCategoryOrder(sharedCategorySettings.orderDisplayOrder);
  }, [sharedCategorySettings.orderDisplayOrder]);

  const persistCategoryOrder = async (next: string[]) => {
    const normalized = normalizeCategoryNames(next);
    setUserCategoryOrder(normalized);

    await updateSharedCategorySettings({
      orderDisplayOrder: normalized,
      inventoryDisplayOrder: normalized,
    });
  };

  const allCategoryOptions = useMemo(() => {
    const fromProducts = (products || [])
      .map((p) =>
        normalizeStoredProductCategoryName(p.category, [
          ...sharedCategorySettings.baseCategories,
          ...sharedCategorySettings.customCategories,
          ...sharedCategorySettings.inventoryDisplayOrder,
          ...sharedCategorySettings.orderDisplayOrder,
          ...userCategoryOrder,
        ]),
      )
      .filter((categoryName): categoryName is string => Boolean(categoryName));
    return normalizeCategoryNames([
      ...sharedCategorySettings.baseCategories,
      ...sharedCategorySettings.customCategories,
      ...userCategoryOrder,
      ...fromProducts,
    ]);
  }, [
    products,
    sharedCategorySettings.baseCategories,
    sharedCategorySettings.customCategories,
    sharedCategorySettings.inventoryDisplayOrder,
    sharedCategorySettings.orderDisplayOrder,
    userCategoryOrder,
  ]);

  const handleCreateCategory = async () => {
    const rawName = newCategoryName.trim();
    if (!rawName) {
      setCategoryActionError("Enter a category name");
      return;
    }
    const normalizedName =
      normalizeStoredProductCategoryName(rawName, allCategoryOptions);
    const name = normalizedName || rawName;
    if (!normalizedName || isReservedCategoryName(name)) {
      setCategoryActionError(`"${rawName}" is reserved and cannot be created`);
      return;
    }
    if (allCategoryOptions.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setCategoryActionError("Category already exists");
      return;
    }

    setCategoryActionLoading(true);
    setCategoryActionError("");
    try {
      const nextOrder = [...userCategoryOrder, name];
      await updateSharedCategorySettings({
        customCategories: [...sharedCategorySettings.customCategories, name],
        orderDisplayOrder: nextOrder,
        inventoryDisplayOrder: [...sharedCategorySettings.inventoryDisplayOrder, name],
      });
      setUserCategoryOrder(nextOrder);
      setNewCategoryName("");
      toast({
        title: "Category Created",
        description: `${name} is now available in Orders and Inventory categories.`,
      });
    } catch {
      setCategoryActionError("Failed to create category");
    } finally {
      setCategoryActionLoading(false);
    }
  };

  const handleRenameCategory = async () => {
    const fromCategory = renameFromCategory.trim();
    const rawToCategory = renameToCategory.trim();
    const normalizedToCategory =
      normalizeStoredProductCategoryName(
        rawToCategory,
        allCategoryOptions,
      );
    const toCategory = normalizedToCategory || rawToCategory;
    if (!fromCategory || !toCategory) {
      setCategoryActionError("Choose source and target category names");
      return;
    }
    if (isReservedCategoryName(fromCategory)) {
      setCategoryActionError(`"${fromCategory}" is reserved and cannot be renamed`);
      return;
    }
    if (!normalizedToCategory || isReservedCategoryName(toCategory)) {
      setCategoryActionError(`"${rawToCategory}" is reserved and cannot be used as a category name`);
      return;
    }
    if (fromCategory.toLowerCase() === toCategory.toLowerCase()) {
      setCategoryActionError("New category name must be different");
      return;
    }

    const normalizedFromCategory =
      normalizeStoredProductCategoryName(fromCategory, allCategoryOptions) ||
      fromCategory;
    const affectedProducts = (products || []).filter(
      (p) =>
        (
          normalizeStoredProductCategoryName(p.category, allCategoryOptions) ||
          ""
        ).toLowerCase() === normalizedFromCategory.toLowerCase(),
    );
    setCategoryActionLoading(true);
    setCategoryActionError("");
    try {
      for (const product of affectedProducts) {
        await apiRequest("PUT", `/api/products/${product.id}`, { category: toCategory });
      }

      const renamedOrder = userCategoryOrder.map((categoryName) =>
        categoryName.toLowerCase() === fromCategory.toLowerCase() ? toCategory : categoryName,
      );
      const nextCustomCategories = sharedCategorySettings.customCategories
        .map((categoryName) =>
          categoryName.toLowerCase() === fromCategory.toLowerCase() ? toCategory : categoryName,
        )
        .filter(
          (name, index, categories) =>
            categories.findIndex((value) => value.toLowerCase() === name.toLowerCase()) === index,
        );
      const nextBaseCategories = sharedCategorySettings.baseCategories
        .map((categoryName) =>
          categoryName.toLowerCase() === fromCategory.toLowerCase() ? toCategory : categoryName,
        )
        .filter(
          (name, index, categories) =>
            categories.findIndex((value) => value.toLowerCase() === name.toLowerCase()) === index,
        );
      const nextInventoryDisplayOrder = sharedCategorySettings.inventoryDisplayOrder
        .map((categoryName) =>
          categoryName.toLowerCase() === fromCategory.toLowerCase() ? toCategory : categoryName,
        )
        .filter(
          (name, index, categories) =>
            categories.findIndex((value) => value.toLowerCase() === name.toLowerCase()) === index,
        );

      await updateSharedCategorySettings({
        customCategories: nextCustomCategories,
        baseCategories: nextBaseCategories,
        inventoryDisplayOrder: nextInventoryDisplayOrder,
        orderDisplayOrder: renamedOrder,
      });
      setUserCategoryOrder(renamedOrder);
      setRenameFromCategory("");
      setRenameToCategory("");
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "Category Renamed",
        description: `"${fromCategory}" renamed to "${toCategory}" and inventory categories updated.`,
      });
    } catch {
      setCategoryActionError("Failed to rename category");
    } finally {
      setCategoryActionLoading(false);
    }
  };

  const moveCategoryUp = (index: number) => {
    if (index <= 0) return;
    const next = [...userCategoryOrder];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setUserCategoryOrder(next);
    void persistCategoryOrder(next);
  };
  const moveCategoryDown = (index: number) => {
    if (index >= userCategoryOrder.length - 1) return;
    const next = [...userCategoryOrder];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setUserCategoryOrder(next);
    void persistCategoryOrder(next);
  };
  const [sizePickerDialog, setSizePickerDialog] = useState<{ open: boolean; productId: number | null; productName: string }>({
    open: false,
    productId: null,
    productName: "",
  });

  const getEntryKey = (productId: number, size?: string) => {
    return size ? `${productId}-${size}` : `${productId}`;
  };

  const quantities = useMemo(() => {
    const q: Record<number, number> = {};
    Object.values(itemEntries).forEach(entry => {
      q[entry.productId] = (q[entry.productId] || 0) + entry.quantity;
    });
    return q;
  }, [itemEntries]);

  const sqmValues = useMemo(() => {
    const s: Record<number, number> = {};
    Object.values(itemEntries).forEach(entry => {
      if (entry.sqm) s[entry.productId] = entry.sqm;
    });
    return s;
  }, [itemEntries]);

  const selectedClient = clients.find(
    (c) => c.id === parseInt(formData.clientId),
  );
  const selectedClientIsBroker = ((selectedClient as any)?.clientType || "").trim().toLowerCase() === "broker";
  const selectedBrokerAddresses = useMemo(() => {
    if (!selectedClientIsBroker) return [] as string[];
    return Array.from(
      new Set(
        (((selectedClient as any)?.brokerAddresses || []) as string[])
          .map((address) => String(address || "").trim().toUpperCase())
          .filter(Boolean),
      ),
    );
  }, [selectedClient, selectedClientIsBroker]);

  const clientUnpaidBills = useMemo(() => {
    if (!formData.clientId || !bills) return [];
    const clientId = parseInt(formData.clientId);
    return bills.filter((b) => b.clientId === clientId && !b.isPaid);
  }, [formData.clientId, bills]);

  const clientTotalDue = useMemo(() => {
    return clientUnpaidBills.reduce((sum, b) => {
      const billAmount = parseFloat(b.amount) || 0;
      const paidAmount = parseFloat(b.paidAmount || "0") || 0;
      return sum + (billAmount - paidAmount);
    }, 0);
  }, [clientUnpaidBills]);

  const filteredProducts = products?.filter((p) =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()),
  );

  const groupedProducts = useMemo(() => {
    if (!filteredProducts) return {};
    const groups: Record<string, typeof filteredProducts> = {};

    filteredProducts.forEach((product) => {
      const category = getProductCategoryGroupName(
        product.category,
        allCategoryOptions,
      );
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(product);
    });

    const allCategories = Object.keys(groups);
    const editableCategories = allCategories.filter(
      (categoryName) =>
        categoryName !== allItemsCategoryName &&
        categoryName !== uncategorizedCategoryName,
    );
    const mergedEditableOrder = [
      ...userCategoryOrder.filter((categoryName) =>
        editableCategories.includes(categoryName),
      ),
      ...editableCategories.filter(
        (categoryName) => !userCategoryOrder.includes(categoryName),
      ),
    ];
    if (
      JSON.stringify(mergedEditableOrder) !== JSON.stringify(userCategoryOrder)
    ) {
      setTimeout(() => {
        void persistCategoryOrder(mergedEditableOrder);
      }, 0);
    }
    const mergedOrder = groups[uncategorizedCategoryName]
      ? [uncategorizedCategoryName, ...mergedEditableOrder]
      : mergedEditableOrder;

    const sortedGroups: Record<string, typeof filteredProducts> = {};
    mergedOrder.forEach((cat) => {
      if (groups[cat]) {
        sortedGroups[cat] = groups[cat];
      }
    });
    allCategories.forEach((cat) => {
      if (!sortedGroups[cat]) {
        sortedGroups[cat] = groups[cat];
      }
    });

    return sortedGroups;
  }, [
    allCategoryOptions,
    allItemsCategoryName,
    filteredProducts,
    uncategorizedCategoryName,
    userCategoryOrder,
  ]);

  const hasSizes = (product: Product) => {
    return product.smallPrice || product.mediumPrice || product.largePrice;
  };

  const handleQuantityChange = (productId: number, delta: number) => {
    const product = products?.find(p => p.id === productId);
    if (!product) return;

    if (product.isSqmPriced && delta > 0) {
      const currentQty = quantities[productId] || 0;
      if (currentQty === 0) {
        setSqmDialog({
          open: true,
          productId,
          productName: product.name,
          sqmPrice: product.sqmPrice || "12.00"
        });
        setSqmInput("");
        return;
      }
    }

    if (hasSizes(product) && delta > 0) {
      setSizePickerDialog({ open: true, productId, productName: product.name });
      return;
    }

    if (hasSizes(product) && delta < 0) {
      setItemEntries((prev) => {
        const sizedKeys = Object.keys(prev).filter(k => k.startsWith(`${productId}-`));
        if (sizedKeys.length === 0) return prev;
        const lastKey = sizedKeys[sizedKeys.length - 1];
        const entry = prev[lastKey];
        const newQty = entry.quantity - 1;
        if (newQty <= 0) {
          const { [lastKey]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [lastKey]: { ...entry, quantity: newQty } };
      });
      return;
    }

    const key = getEntryKey(productId);
    setItemEntries((prev) => {
      const entry = prev[key];
      if (delta < 0 && !entry) return prev;
      const current = entry?.quantity || 0;
      const newQty = Math.max(0, current + delta);
      if (newQty === 0) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: { ...entry, productId, quantity: newQty, serviceType: entry?.serviceType || 'normal', addedAt: entry?.addedAt || Date.now() } };
    });
  };

  const handleAddSizedItem = (productId: number, size: 'small' | 'medium' | 'large') => {
    const key = getEntryKey(productId, size);
    setItemEntries((prev) => {
      const entry = prev[key];
      const current = entry?.quantity || 0;
      return { ...prev, [key]: { productId, quantity: current + 1, size, serviceType: entry?.serviceType || 'normal', addedAt: entry?.addedAt || Date.now() } };
    });
    setSizePickerDialog({ open: false, productId: null, productName: "" });
  };

  const handleRemoveEntry = (key: string) => {
    setItemEntries((prev) => {
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  };

  const handleEntryQuantityChange = (key: string, delta: number) => {
    setItemEntries((prev) => {
      const entry = prev[key];
      if (!entry) return prev;
      const newQty = Math.max(0, entry.quantity + delta);
      if (newQty === 0) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: { ...entry, quantity: newQty } };
    });
  };

  const handleServiceTypeChange = (key: string, serviceType: 'normal' | 'dc' | 'iron_only') => {
    setItemEntries((prev) => {
      const entry = prev[key];
      if (!entry) return prev;
      return { ...prev, [key]: { ...entry, serviceType } };
    });
  };

  const handleUrgentToggle = (key: string) => {
    setItemEntries((prev) => {
      const entry = prev[key];
      if (!entry) return prev;
      return { ...prev, [key]: { ...entry, urgent: !entry.urgent } };
    });
  };

  const handleSqmConfirm = () => {
    const sqm = parseFloat(sqmInput);
    if (!sqm || sqm <= 0 || !sqmDialog.productId) {
      toast({ title: "Please enter a valid square meter value", variant: "destructive" });
      return;
    }

    const key = getEntryKey(sqmDialog.productId);
    setItemEntries(prev => ({ ...prev, [key]: { productId: sqmDialog.productId!, quantity: 1, serviceType: 'normal', sqm, addedAt: Date.now() } }));
    setSqmDialog({ open: false, productId: null, productName: "", sqmPrice: "12.00" });
    setSqmInput("");
  };

  const handleManualQuantity = (productId: number, value: string) => {
    const product = products?.find(p => p.id === productId);

    if (product?.isSqmPriced) {
      const qty = parseInt(value) || 0;
      if (qty > 0 && !sqmValues[productId]) {
        setSqmDialog({
          open: true,
          productId,
          productName: product.name,
          sqmPrice: product.sqmPrice || "12.00"
        });
        setSqmInput("");
        return;
      }
    }

    if (product && hasSizes(product)) {
      setSizePickerDialog({ open: true, productId, productName: product.name });
      return;
    }

    const qty = parseInt(value) || 0;
    const key = getEntryKey(productId);
    setItemEntries((prev) => {
      if (qty <= 0) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      const entry = prev[key];
      return { ...prev, [key]: { ...entry, productId, quantity: qty, serviceType: entry?.serviceType || 'normal', addedAt: entry?.addedAt || Date.now() } };
    });
  };

  const orderItems = useMemo(() => {
    if (!products) return [];
    return Object.entries(itemEntries)
      .filter(([_, entry]) => entry.quantity > 0)
      .map(([key, entry]) => {
        const product = products.find((p) => p.id === entry.productId);
        return product ? { key, product, quantity: entry.quantity, sqm: entry.sqm, size: entry.size, serviceType: entry.serviceType, urgent: entry.urgent || false, addedAt: entry.addedAt || 0 } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (a!.addedAt) - (b!.addedAt)) as { key: string; product: Product; quantity: number; sqm?: number; size?: 'small' | 'medium' | 'large'; serviceType: 'normal' | 'dc' | 'iron_only'; urgent: boolean; addedAt: number }[];
  }, [itemEntries, products]);

  const getItemEntryPrice = (product: Product, entry: { size?: string; serviceType: string; urgent?: boolean; sqm?: number; quantity: number }) => {
    const isUrgentOrder = formData.orderType === "urgent";
    const isItemUrgent = entry.urgent || isUrgentOrder;
    if (product.isSqmPriced && entry.sqm) {
      return entry.sqm * parseFloat(product.sqmPrice || product.price || "0") * entry.quantity;
    }
    let basePrice = parseFloat(product.price || "0");
    if (entry.size === 'small' && product.smallPrice) basePrice = parseFloat(product.smallPrice);
    else if (entry.size === 'medium' && product.mediumPrice) basePrice = parseFloat(product.mediumPrice);
    else if (entry.size === 'large' && product.largePrice) basePrice = parseFloat(product.largePrice);

    if (entry.serviceType === 'iron_only') {
      if (isItemUrgent) {
        if (entry.size === 'small' && product.smallUrgentIronOnlyPrice) return parseFloat(product.smallUrgentIronOnlyPrice) * entry.quantity;
        if (entry.size === 'medium' && product.mediumUrgentIronOnlyPrice) return parseFloat(product.mediumUrgentIronOnlyPrice) * entry.quantity;
        if (entry.size === 'large' && product.largeUrgentIronOnlyPrice) return parseFloat(product.largeUrgentIronOnlyPrice) * entry.quantity;
        if (product.urgentIronOnlyPrice) return parseFloat(product.urgentIronOnlyPrice) * entry.quantity;
      }
      let ioPrice = basePrice / 2;
      if (entry.size === 'small' && product.smallIronOnlyPrice) ioPrice = parseFloat(product.smallIronOnlyPrice);
      else if (entry.size === 'medium' && product.mediumIronOnlyPrice) ioPrice = parseFloat(product.mediumIronOnlyPrice);
      else if (entry.size === 'large' && product.largeIronOnlyPrice) ioPrice = parseFloat(product.largeIronOnlyPrice);
      else if (product.ironOnlyPrice) ioPrice = parseFloat(product.ironOnlyPrice);
      if (isItemUrgent) ioPrice *= 2;
      return ioPrice * entry.quantity;
    }
    if (entry.serviceType === 'dc') {
      if (isItemUrgent) {
        if (entry.size === 'small' && product.smallUrgentDryCleanPrice) return parseFloat(product.smallUrgentDryCleanPrice) * entry.quantity;
        if (entry.size === 'medium' && product.mediumUrgentDryCleanPrice) return parseFloat(product.mediumUrgentDryCleanPrice) * entry.quantity;
        if (entry.size === 'large' && product.largeUrgentDryCleanPrice) return parseFloat(product.largeUrgentDryCleanPrice) * entry.quantity;
        if (product.urgentDryCleanPrice) return parseFloat(product.urgentDryCleanPrice) * entry.quantity;
      }
      let dcPrice = basePrice;
      if (entry.size === 'small' && product.smallDryCleanPrice) dcPrice = parseFloat(product.smallDryCleanPrice);
      else if (entry.size === 'medium' && product.mediumDryCleanPrice) dcPrice = parseFloat(product.mediumDryCleanPrice);
      else if (entry.size === 'large' && product.largeDryCleanPrice) dcPrice = parseFloat(product.largeDryCleanPrice);
      else dcPrice = parseFloat(product.dryCleanPrice || String(basePrice * 2));
      if (isItemUrgent) dcPrice *= 2;
      return dcPrice * entry.quantity;
    }
    if (isItemUrgent) {
      if (entry.size === 'small' && product.smallUrgentPrice) return parseFloat(product.smallUrgentPrice) * entry.quantity;
      if (entry.size === 'medium' && product.mediumUrgentPrice) return parseFloat(product.mediumUrgentPrice) * entry.quantity;
      if (entry.size === 'large' && product.largeUrgentPrice) return parseFloat(product.largeUrgentPrice) * entry.quantity;
      return basePrice * 2 * entry.quantity;
    }
    return basePrice * entry.quantity;
  };

  const orderTotal = useMemo(() => {
    return orderItems.reduce((sum, item) => {
      return sum + getItemEntryPrice(item.product, item);
    }, 0);
  }, [orderItems]);
  const enteredDiscountAmount = applyDiscount ? parseFloat(discountAmount || "0") : 0;
  const appliedDiscountAmount = Number.isFinite(enteredDiscountAmount)
    ? Math.min(Math.max(0, enteredDiscountAmount), orderTotal)
    : 0;
  const deliveryChargeAmount = Number.isFinite(parseFloat(deliveryCharge || "0"))
    ? Math.max(0, parseFloat(deliveryCharge || "0"))
    : 0;
  const orderFinalTotal =
    Math.max(0, orderTotal - appliedDiscountAmount) + deliveryChargeAmount;

  // Check if entered info matches an existing client (moved before handleSubmit)
  const clientMatch = useMemo(() => {
    if (formData.clientId !== "walkin") return null;

    const normalizedPhone = formData.customerPhone?.replace(/\D/g, '').replace(/^(00971|971|\+971|0)/, '') || '';
    const enteredName = formData.customerName?.trim().toLowerCase() || '';
    const enteredAddress = formData.deliveryAddress?.trim().toLowerCase() || '';

    for (const client of clients) {
      const clientPhone = client.phone?.replace(/\D/g, '').replace(/^(00971|971|\+971|0)/, '') || '';
      const clientName = client.name?.trim().toLowerCase() || '';
      const clientAddress = client.address?.trim().toLowerCase() || '';

      const phoneMatches = clientPhone && normalizedPhone && clientPhone === normalizedPhone && normalizedPhone.length >= 7;
      const nameMatches = clientName && enteredName && clientName === enteredName;
      const addressMatches = clientAddress && enteredAddress && clientAddress === enteredAddress;

      if (phoneMatches) {
        if (nameMatches && addressMatches) {
          return { client, matchType: 'full', message: 'Name, phone number, and address match an existing client' };
        } else if (nameMatches) {
          return { client, matchType: 'name_phone', message: 'Name and phone number match an existing client' };
        } else {
          return { client, matchType: 'phone', message: 'Phone number matches an existing client' };
        }
      }
    }
    return null;
  }, [formData.customerPhone, formData.customerName, formData.deliveryAddress, formData.clientId, clients]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (orderItems.length === 0) return;
    if (formData.clientId === "walkin" && !formData.customerName.trim()) {
      toast({ title: "Please enter customer name", variant: "destructive" });
      return;
    }
    if (selectedClientIsBroker && !formData.deliveryAddress.trim()) {
      toast({
        title: "Select broker order address",
        description: "Choose one of the broker's saved addresses or enter the order address.",
        variant: "destructive",
      });
      return;
    }
    if (formData.clientId === "walkin" && clientMatch) {
      toast({
        title: "This client is already in the system!",
        description: `Please use the existing client: ${clientMatch.client.name}`,
        variant: "destructive"
      });
      return;
    }
    if (!formData.clientId) return;

    const isWalkIn = formData.clientId === "walkin";
    const walkinCompanyValue = isWalkIn && formData.walkinCompany && formData.walkinCompany !== "__new__" ? formData.walkinCompany.toUpperCase() : "";

    if (walkinCompanyValue && showNewCompanyInput) {
      const alreadyExists = (companiesList || []).some(c => c.name.toUpperCase() === walkinCompanyValue.toUpperCase());
      if (!alreadyExists) {
        try {
          await apiRequest("POST", "/api/companies", { name: walkinCompanyValue.toUpperCase() });
          queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
        } catch (err) {
          toast({ title: "Failed to save new company", variant: "destructive" });
        }
      }
    }

    const hasAnyPerItemUrgent = orderItems.some(item => item.urgent);
    const isOrderUrgent = formData.orderType === "urgent" || hasAnyPerItemUrgent;
    const hasAnyIronOnly = orderItems.some(item => item.serviceType === 'iron_only');
    const allIronOnly = orderItems.every(item => item.serviceType === 'iron_only');

    const itemsText = orderItems
      .map((item) => {
        if (item.product.isSqmPriced && item.sqm) {
          const basePrice = item.sqm * parseFloat(item.product.sqmPrice || item.product.price || "0");
          const itemIsUrgent = item.urgent || formData.orderType === 'urgent';
          const currentPrice = itemIsUrgent ? basePrice * 2 : basePrice;
          return `${item.sqm} sqm ${item.product.name}${itemIsUrgent ? " *URG*" : ""} (base ${basePrice.toFixed(2)} AED) @ ${currentPrice.toFixed(2)} AED`;
        }
        let name = item.product.name;
        if (item.size) {
          name = `${name} (${item.size.charAt(0).toUpperCase() + item.size.slice(1)})`;
        }
        let svcTag = item.serviceType === 'dc' ? ' [DC]' : item.serviceType === 'iron_only' ? ' [IO]' : ' [N]';
        const itemIsUrgent = item.urgent || formData.orderType === 'urgent';
        if (itemIsUrgent) svcTag += ' *URG*';
        const price = getItemEntryPrice(item.product, item);
        return `${item.quantity}x ${name}${svcTag} @ ${(price / item.quantity).toFixed(2)} AED`;
      })
      .join(", ");
    const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;

    onSubmit({
      ...formData,
      clientId: isWalkIn ? null : parseInt(formData.clientId),
      billId: null,
      orderNumber,
      items: itemsText,
      totalAmount: orderTotal.toFixed(2),
      discountAmount: appliedDiscountAmount.toFixed(2),
      deliveryCharge: deliveryChargeAmount.toFixed(2),
      finalAmount: orderFinalTotal.toFixed(2),
      entryDate: new Date().toISOString(),
      customerName: formData.customerName,
      customerPhone: formData.customerPhone,
      paymentOption: formData.paymentOption,
      expectedDeliveryAt: formData.expectedDeliveryAt || null,
      createdBy: createdByUser || "Staff",
      creatorRole: userRole,
      walkinCompany: walkinCompanyValue,
      urgent: isOrderUrgent,
      deliveryType: allIronOnly ? "iron_only" : formData.deliveryType,
      orderType: formData.orderType,
    });
  };

  function handleClientChange(clientId: string) {
    if (clientId === "walkin") {
      setFormData({
        ...formData,
        clientId,
        customerName: "",
        customerPhone: "",
        deliveryAddress: "",
        walkinCompany: "",
      });
      setShowNewCompanyInput(false);
      setNewCompanyInput("");
    } else {
      const client = clients.find((c) => c.id === parseInt(clientId));
      const clientIsBroker = ((client as any)?.clientType || "").trim().toLowerCase() === "broker";
      setFormData({
        ...formData,
        clientId,
        customerName: (client?.name || "").toUpperCase(),
        customerPhone: getDisplayPhone(client?.phone),
        deliveryAddress: clientIsBroker ? "" : ((client?.address && client.address !== "-") ? client.address.toUpperCase() : ""),
      });
    }
  }
  useEffect(() => {
    console.log("Form Data Updated:", formData);
  }, [formData]); // This runs every time formData changes

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label className="text-base">Client</Label>
        <select
          value={formData.clientId}
          onChange={(e) => handleClientChange(e.target.value)}
          className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="select-client"
        >
          <option value="">Select client</option>
          <option value="walkin">Walk-in Customer</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id.toString()}>
              {client.name} - {client.phone}
            </option>
          ))}
        </select>
      </div>

      {selectedClientIsBroker && (
        <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-800 dark:bg-violet-950/20">
          <Label className="text-base text-violet-700 dark:text-violet-300">Broker Order Address</Label>
          <p className="text-xs text-muted-foreground">
            Broker addresses are saved per order. Pick one below or type a new one in the address box.
          </p>
          {selectedBrokerAddresses.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedBrokerAddresses.map((address, index) => {
                const isSelected = formData.deliveryAddress.trim().toUpperCase() === address;
                return (
                  <Button
                    key={`${address}-${index}`}
                    type="button"
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    className={`max-w-full ${isSelected ? "bg-violet-600 hover:bg-violet-700" : "border-violet-300 text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-950/40"}`}
                    onClick={() => setFormData((prev) => ({ ...prev, deliveryAddress: address }))}
                  >
                    <span className="truncate">{address}</span>
                  </Button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No saved broker addresses yet. Enter the address below for this order.
            </p>
          )}
        </div>
      )}

      {formData.clientId === "walkin" && (
        <>
          <div className="space-y-2">
            <Label className="text-base">Customer Name</Label>
            <Input
              placeholder="Enter customer name"
              value={formData.customerName}
              onChange={(e) => setFormData({ ...formData, customerName: e.target.value.toUpperCase() })}
              data-testid="input-customer-name"
              className="h-12 text-base uppercase"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-base">Phone Number</Label>
            <div className="flex flex-col gap-1">
              <Input
                className={`h-12 text-base ${(formData.customerPhone?.replace(/\D/g, "").length || 0) >= 10 ? "border-green-500 focus-visible:ring-green-500" : ""}`}
                placeholder="05XXXXXXXX"
                value={formData.customerPhone?.replace(/\D/g, "").slice(0, 10) || ""}
                onChange={(e) => {
                  let digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                  if (digits.length > 0 && !digits.startsWith("0")) {
                    digits = "0" + digits.slice(0, 9);
                  }
                  setFormData({ ...formData, customerPhone: digits });
                }}
                inputMode="numeric"
                maxLength={10}
                data-testid="input-customer-phone"
              />
              {(formData.customerPhone?.replace(/\D/g, "").length || 0) >= 10 && (
                <p className="text-xs text-green-600 font-medium">10 digits - complete</p>
              )}
            </div>
            {clientMatch && (
              <div className="p-4 border-2 border-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg mt-2 animate-pulse">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  <span className="font-bold text-red-700 dark:text-red-400 text-base">
                    CUSTOMER ALREADY EXISTS!
                  </span>
                </div>
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                  {clientMatch.message}: <strong className="text-red-700">{clientMatch.client.name}</strong>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Phone: {clientMatch.client.phone}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="mt-3 bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => handleClientChange(clientMatch.client.id.toString())}
                  data-testid="button-use-existing-client"
                >
                  Click here to use existing client: {clientMatch.client.name}
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-base">Company (Optional)</Label>
            <select
              value={showNewCompanyInput ? "__new__" : formData.walkinCompany}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  setShowNewCompanyInput(true);
                  setNewCompanyInput("");
                  setFormData({ ...formData, walkinCompany: "" });
                } else {
                  setShowNewCompanyInput(false);
                  setNewCompanyInput("");
                  setFormData({ ...formData, walkinCompany: e.target.value });
                }
              }}
              className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              data-testid="select-walkin-company"
            >
              <option value="">No Company</option>
              {existingCompanies.map((company) => (
                <option key={company} value={company}>{company}</option>
              ))}
              <option value="__new__">+ Add New Company</option>
            </select>
            {showNewCompanyInput && (
              <Input
                placeholder="Enter company name"
                value={newCompanyInput}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  setNewCompanyInput(val);
                  setFormData({ ...formData, walkinCompany: val });
                }}
                data-testid="input-walkin-company-new"
                className="h-12 text-base uppercase"
              />
            )}
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label className="text-base">Delivery Type</Label>
        <select
          value={formData.deliveryType}
          onChange={(e) => setFormData({ ...formData, deliveryType: e.target.value })}
          className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          data-testid="select-delivery-type"
        >
          <option value="pickup">Take-away</option>
          <option value="delivery">Delivery</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label className="text-base">Order Priority</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={formData.orderType === "normal" ? "default" : "outline"}
            className={`flex-1 h-12 text-base ${formData.orderType === "normal" ? "" : ""}`}
            onClick={() => setFormData({ ...formData, orderType: "normal" })}
            data-testid="btn-order-normal"
          >
            Normal
          </Button>
          <Button
            type="button"
            variant={formData.orderType === "urgent" ? "default" : "outline"}
            className={`flex-1 h-12 text-base ${formData.orderType === "urgent" ? "bg-red-600 hover:bg-red-700 text-white" : "text-red-600 border-red-300 hover:bg-red-50"}`}
            onClick={() => setFormData({ ...formData, orderType: "urgent" })}
            data-testid="btn-order-urgent"
          >
            Urgent
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-base">Payment Option</Label>
        <select
          value={formData.paymentOption}
          onChange={(e) => setFormData({ ...formData, paymentOption: e.target.value })}
          className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          data-testid="select-payment-option"
        >
          <option value="pay_later">Pay Later</option>
          <option value="pay_now">Pay Now</option>
        </select>
      </div>

      {(formData.deliveryType === "delivery" || selectedClientIsBroker) && (
        <div className="space-y-2">
          <Label className="text-base">{selectedClientIsBroker ? "Broker Order Address *" : "Delivery Address *"}</Label>
          <Textarea
            placeholder={selectedClientIsBroker ? "Select or enter the broker order address..." : "Enter delivery address..."}
            value={formData.deliveryAddress}
            onChange={(e) =>
              setFormData({ ...formData, deliveryAddress: e.target.value.toUpperCase() })
            }
            data-testid="input-delivery-address"
            className="min-h-[80px] text-base uppercase"
            required
          />
        </div>
      )}

      <div className="space-y-2">
          <Label className="text-base">{formData.deliveryType === "delivery" ? "Expected Delivery" : "Pickup Date"}</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={formData.expectedDeliveryAt?.startsWith(format(new Date(), "yyyy-MM-dd")) ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => {
                const today = new Date();
                const time = formData.expectedDeliveryAt?.split("T")[1] || "12:00";
                setFormData({ ...formData, expectedDeliveryAt: `${format(today, "yyyy-MM-dd")}T${time}` });
              }}
              data-testid="button-date-today"
            >
              Today
            </Button>
            <Button
              type="button"
              variant={formData.expectedDeliveryAt?.startsWith(format(new Date(Date.now() + 86400000), "yyyy-MM-dd")) ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => {
                const tomorrow = new Date(Date.now() + 86400000);
                const time = formData.expectedDeliveryAt?.split("T")[1] || "12:00";
                setFormData({ ...formData, expectedDeliveryAt: `${format(tomorrow, "yyyy-MM-dd")}T${time}` });
              }}
              data-testid="button-date-tomorrow"
            >
              Tomorrow
            </Button>
            <Input
              type="date"
              className="flex-1 h-9"
              value={formData.expectedDeliveryAt?.split("T")[0] || ""}
              onChange={(e) => {
                const time = formData.expectedDeliveryAt?.split("T")[1] || "12:00";
                setFormData({ ...formData, expectedDeliveryAt: `${e.target.value}T${time}` });
              }}
              data-testid="input-custom-date"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">Time:</Label>
            <Input
              type="time"
              className="flex-1 h-9"
              value={formData.expectedDeliveryAt?.split("T")[1] || "12:00"}
              onChange={(e) => {
                const date = formData.expectedDeliveryAt?.split("T")[0] || format(new Date(), "yyyy-MM-dd");
                setFormData({ ...formData, expectedDeliveryAt: `${date}T${e.target.value}` });
              }}
              data-testid="input-pickup-time"
            />
            {formData.expectedDeliveryAt && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFormData({ ...formData, expectedDeliveryAt: "" })}
                data-testid="button-clear-expected-date"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

      {selectedClient && clientTotalDue > 0 && (
        <div className="p-3 border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-orange-600" />
            <span className="font-medium text-orange-700 dark:text-orange-400">
              Client has due bills
            </span>
          </div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-muted-foreground">
              {clientUnpaidBills.length} unpaid bill(s)
            </span>
            <span className="font-bold text-orange-600">
              {clientTotalDue.toFixed(2)} AED
            </span>
          </div>
          <div className="space-y-2 max-h-24 overflow-auto">
            {clientUnpaidBills.map((bill) => (
              <div
                key={bill.id}
                className="flex justify-between items-center text-sm bg-muted/50 rounded px-2 py-1"
              >
                <span className="text-muted-foreground">
                  Bill #{bill.referenceNumber || bill.id} -{" "}
                  {format(new Date(bill.billDate), "dd/MM/yy")}
                </span>
                <span className="font-medium text-orange-600">
                  {(
                    parseFloat(bill.amount) - parseFloat(bill.paidAmount || "0")
                  ).toFixed(2)}{" "}
                  AED
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedClient && clientUnpaidBills.length > 0 && (
        <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-sm text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200">
          Each new order now creates its own unique bill number. Existing unpaid bills remain separate.
        </div>
      )}

      {/* Always show selected items when there are any */}
      {orderItems.length > 0 && productSearch && (
        <div className="p-3 bg-accent/30 rounded-lg border border-accent mb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-foreground">Selected Items ({orderItems.reduce((sum, item) => sum + item.quantity, 0)})</span>
            <span className="text-sm font-bold text-primary">{orderTotal.toFixed(2)} AED</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {orderItems.map((item) => {
              const itemPrice = getItemEntryPrice(item.product, item);
              const sizeLabel = item.size ? ` (${item.size.charAt(0).toUpperCase() + item.size.slice(1)})` : '';
              const tags: string[] = [];
              if (item.serviceType === 'dc') tags.push('DC');
              if (item.serviceType === 'iron_only') tags.push('IO');
              if (item.urgent) tags.push('URG');
              const tagLabel = tags.join('+');
              const hasDc = item.serviceType === 'dc';
              const hasIo = item.serviceType === 'iron_only';
              const borderClass = item.urgent && (hasDc || hasIo) ? 'border-purple-400 bg-purple-50 dark:bg-purple-950/30' : item.urgent ? 'border-red-400 bg-red-50 dark:bg-red-950/30' : hasDc ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30' : hasIo ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/30' : '';
              const textClass = item.urgent && (hasDc || hasIo) ? 'text-purple-600' : item.urgent ? 'text-red-600' : hasDc ? 'text-blue-600' : 'text-orange-600';
              return (
                <Badge
                  key={item.key}
                  variant="secondary"
                  className={`text-xs cursor-pointer hover:bg-destructive/20 ${borderClass}`}
                  onClick={() => handleRemoveEntry(item.key)}
                >
                  {item.sqm ? `${item.sqm} sqm` : `${item.quantity}x`} {item.product.name}{sizeLabel}{tagLabel && <span className={`ml-1 font-bold ${textClass}`}>{tagLabel}</span>} ({itemPrice.toFixed(0)} AED)
                  <X className="w-3 h-3 ml-1" />
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-base">Select Items</Label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 border-indigo-500 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950"
              onClick={() => {
                setShowCategoryManagerDialog(true);
                setCategoryActionError("");
              }}
              data-testid="button-manage-order-categories"
            >
              <Tag className="w-3 h-3" />
              Manage
            </Button>
            <Button
              type="button"
              variant={isReordering ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setIsReordering(!isReordering)}
              data-testid="button-reorder-categories"
            >
              <GripVertical className="w-3 h-3" />
              {isReordering ? "Done" : "Reorder"}
            </Button>
          </div>
        </div>
        <Input
          placeholder="Search items..."
          value={productSearch}
          onChange={(e) => setProductSearch(e.target.value)}
          className="mb-2 h-12 text-base"
          data-testid="input-product-search"
        />
        <ScrollArea className="h-80 border rounded-lg">
          <Accordion type="multiple" defaultValue={Object.keys(groupedProducts)} className="w-full">
            {Object.entries(groupedProducts).map(([category, categoryProducts], catIndex) => (
              <AccordionItem key={category} value={category}>
                <div className="flex items-center">
                  {isReordering && (
                    <div className="flex flex-col px-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={(e) => { e.stopPropagation(); moveCategoryUp(catIndex); }}
                        disabled={catIndex === 0}
                        data-testid={`button-move-up-${category}`}
                      >
                        <ChevronUp className="w-3 h-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={(e) => { e.stopPropagation(); moveCategoryDown(catIndex); }}
                        disabled={catIndex === Object.keys(groupedProducts).length - 1}
                        data-testid={`button-move-down-${category}`}
                      >
                        <ChevronDown className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                  <AccordionTrigger className="px-3 py-2 text-sm font-semibold bg-muted/30 hover:bg-muted/50 flex-1">
                    <div className="flex items-center gap-2">
                      {getCategoryIcon(category, "w-5 h-5")}
                      <span>{getProductCategoryDisplayName(category)}</span>
                      <Badge variant="secondary" className="text-xs">
                        {categoryProducts?.length || 0}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                </div>
                <AccordionContent className="pb-0">
                  <Table>
                    <TableBody>
                      {categoryProducts?.map((product) => (
                        <TableRow
                          key={product.id}
                          className={quantities[product.id] ? "bg-primary/5" : ""}
                        >
                          <TableCell className="font-medium text-sm py-2">
                            {product.name}
                            {product.isSqmPriced && sqmValues[product.id] && (
                              <Badge variant="outline" className="ml-2 text-xs">
                                {sqmValues[product.id]} sqm
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm text-primary font-semibold w-20 py-2">
                            {product.isSqmPriced ? (
                              <span className="text-xs">{parseFloat(product.sqmPrice || product.price || "0").toFixed(0)}/sqm</span>
                            ) : product.price ? (
                              `${parseFloat(product.price).toFixed(0)}`
                            ) : "-"}
                          </TableCell>
                          <TableCell className="w-40 py-2">
                            {product.isSqmPriced ? (
                              <div className="flex items-center justify-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={quantities[product.id] ? "destructive" : "default"}
                                  className="h-10 touch-manipulation"
                                  onClick={() => {
                                    if (quantities[product.id]) {
                                      handleQuantityChange(product.id, -1);
                                    } else {
                                      handleQuantityChange(product.id, 1);
                                    }
                                  }}
                                  data-testid={`button-sqm-${product.id}`}
                                >
                                  {quantities[product.id] ? "Remove" : "Add"}
                                </Button>
                              </div>
                            ) : hasSizes(product) ? (
                              <div className="flex items-center justify-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-10 touch-manipulation"
                                  onClick={() => setSizePickerDialog({ open: true, productId: product.id, productName: product.name })}
                                  data-testid={`button-size-pick-${product.id}`}
                                >
                                  {quantities[product.id] ? (
                                    <span className="flex items-center gap-1">
                                      <Badge variant="secondary" className="text-xs">{quantities[product.id]}</Badge>
                                      Add More
                                    </span>
                                  ) : (
                                    <span className="flex items-center gap-1"><Plus className="w-4 h-4" /> Pick Size</span>
                                  )}
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-2">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  className="h-10 w-10 touch-manipulation"
                                  onClick={() => handleQuantityChange(product.id, -1)}
                                  disabled={!quantities[product.id]}
                                >
                                  <Minus className="w-4 h-4" />
                                </Button>
                                <Input
                                  type="number"
                                  min="0"
                                  value={quantities[product.id] || ""}
                                  onChange={(e) =>
                                    handleManualQuantity(product.id, e.target.value)
                                  }
                                  className="w-14 h-10 text-center text-base font-bold p-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  placeholder="0"
                                  data-testid={`input-qty-${product.id}`}
                                />
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  className="h-10 w-10 touch-manipulation"
                                  onClick={() => handleQuantityChange(product.id, 1)}
                                >
                                  <Plus className="w-4 h-4" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </ScrollArea>
      </div>

      <Dialog
        open={showCategoryManagerDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowCategoryManagerDialog(false);
            setCategoryActionError("");
            setNewCategoryName("");
            setRenameFromCategory("");
            setRenameToCategory("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5 text-indigo-600" />
              Manage Categories
            </DialogTitle>
            <DialogDescription>
              Create and rename the shared categories used by Orders and Inventory.
              Uncategorized is the no-category bucket and cannot be edited here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2 p-3 border rounded-md bg-muted/20">
              <Label className="text-sm font-semibold">Create Category</Label>
              <div className="flex gap-2">
                <Input
                  value={newCategoryName}
                  onChange={(e) => {
                    setNewCategoryName(e.target.value);
                    setCategoryActionError("");
                  }}
                  placeholder="Enter category name"
                  data-testid="input-order-create-category-name"
                />
                <Button type="button" onClick={handleCreateCategory} data-testid="button-order-create-category">
                  Add
                </Button>
              </div>
            </div>

            <div className="space-y-2 p-3 border rounded-md bg-muted/20">
              <Label className="text-sm font-semibold">Rename Category</Label>
              <Select
                value={renameFromCategory}
                onValueChange={(value) => {
                  setRenameFromCategory(value);
                  setCategoryActionError("");
                }}
              >
                <SelectTrigger data-testid="select-order-rename-category-from">
                  <SelectValue placeholder="Select current category" />
                </SelectTrigger>
                <SelectContent>
                  {allCategoryOptions.map((categoryName) => (
                    <SelectItem key={`order-rename-${categoryName}`} value={categoryName}>
                      {getProductCategoryDisplayName(categoryName)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={renameToCategory}
                onChange={(e) => {
                  setRenameToCategory(e.target.value);
                  setCategoryActionError("");
                }}
                placeholder="New category name"
                data-testid="input-order-rename-category-to"
              />
              <Button
                type="button"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={handleRenameCategory}
                disabled={categoryActionLoading}
                data-testid="button-order-rename-category"
              >
                {categoryActionLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Renaming...
                  </>
                ) : (
                  "Rename Category"
                )}
              </Button>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Available Categories</Label>
              <div className="flex flex-wrap gap-1.5">
                {[uncategorizedCategoryName, ...allCategoryOptions].map((categoryName) => (
                  <Badge key={`order-category-${categoryName}`} variant="secondary">
                    {getProductCategoryDisplayName(categoryName)}
                  </Badge>
                ))}
              </div>
            </div>

            {categoryActionError && <p className="text-xs text-destructive">{categoryActionError}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCategoryManagerDialog(false);
                setCategoryActionError("");
              }}
              data-testid="button-close-order-category-manager"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {orderItems.length > 0 && (
        <div className="p-3 bg-primary/5 rounded-lg border">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium">
              {orderItems.reduce((sum, item) => sum + item.quantity, 0)} item(s) selected
            </span>
            <span className="text-lg font-bold text-primary">
              {orderTotal.toFixed(2)} AED
            </span>
          </div>
          <div className="space-y-2 mb-3 pb-3 border-b">
            {orderItems.map((item) => {
              const itemPrice = getItemEntryPrice(item.product, item);
              const sizeLabel = item.size ? ` (${item.size.charAt(0).toUpperCase() + item.size.slice(1)})` : '';
              const borderColor = item.urgent && item.serviceType !== 'normal' ? 'border-purple-300 bg-purple-50 dark:bg-purple-950/20' : item.urgent ? 'border-red-300 bg-red-50 dark:bg-red-950/20' : item.serviceType === 'dc' ? 'border-blue-300 bg-blue-50 dark:bg-blue-950/20' : item.serviceType === 'iron_only' ? 'border-orange-300 bg-orange-50 dark:bg-orange-950/20' : 'border-border bg-background';
              return (
                <div key={item.key} className={`p-2 rounded-md border ${borderColor}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Button type="button" size="icon" variant="outline" className="h-6 w-6" onClick={() => handleEntryQuantityChange(item.key, -1)} data-testid={`btn-entry-minus-${item.key}`}>
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
                        <Button type="button" size="icon" variant="outline" className="h-6 w-6" onClick={() => handleEntryQuantityChange(item.key, 1)} data-testid={`btn-entry-plus-${item.key}`}>
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                      <span className="text-sm font-medium">{item.product.name}{sizeLabel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-primary">{itemPrice.toFixed(2)}</span>
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => handleRemoveEntry(item.key)} data-testid={`btn-entry-remove-${item.key}`}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  {!item.product.isSqmPriced && (
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant={item.serviceType === 'normal' ? 'default' : 'outline'} className="h-6 text-xs px-2 flex-1" onClick={() => handleServiceTypeChange(item.key, 'normal')} data-testid={`btn-svc-normal-${item.key}`}>
                      N
                    </Button>
                    <Button type="button" size="sm" variant={item.serviceType === 'dc' ? 'default' : 'outline'} className={`h-6 text-xs px-2 flex-1 ${item.serviceType === 'dc' ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'text-blue-600 border-blue-300 hover:bg-blue-50'}`} onClick={() => handleServiceTypeChange(item.key, 'dc')} data-testid={`btn-svc-dc-${item.key}`}>
                      DC
                    </Button>
                    <Button type="button" size="sm" variant={item.serviceType === 'iron_only' ? 'default' : 'outline'} className={`h-6 text-xs px-2 flex-1 ${item.serviceType === 'iron_only' ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'text-orange-600 border-orange-300 hover:bg-orange-50'}`} onClick={() => handleServiceTypeChange(item.key, 'iron_only')} data-testid={`btn-svc-iron-${item.key}`}>
                      Iron
                    </Button>
                    <Button type="button" size="sm" variant={item.urgent ? 'default' : 'outline'} className={`h-6 text-xs px-2 flex-1 ${item.urgent ? 'bg-red-600 hover:bg-red-700 text-white' : 'text-red-600 border-red-300 hover:bg-red-50'}`} onClick={() => handleUrgentToggle(item.key)} data-testid={`btn-svc-urgent-${item.key}`}>
                      <Zap className="w-3 h-3 mr-0.5" />Urgent
                    </Button>
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-base">Notes</Label>
        <Textarea
          placeholder="Any special instructions..."
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          data-testid="input-notes"
          className="text-base min-h-[80px]"
        />
      </div>

      {/* Apply Discount Option */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="apply-discount"
            checked={applyDiscount}
            onCheckedChange={(checked) => setApplyDiscount(checked === true)}
            data-testid="toggle-apply-discount"
          />
          <Label htmlFor="apply-discount" className="text-base font-medium cursor-pointer">
            Apply Discount
          </Label>
        </div>
        {applyDiscount && (
          <div className="space-y-2 p-3 bg-orange-50/50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg">
            <Label className="text-sm">Discount Amount (AED)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={discountAmount}
              onChange={(e) => {
                setDiscountAmount(e.target.value);
              }}
              placeholder="0.00"
              data-testid="input-discount-amount"
            />
            {discountAmount && parseFloat(discountAmount) > 0 && (
              <div className="text-sm text-orange-600">
                New order total: {(
                  Math.max(0, orderTotal - appliedDiscountAmount) + deliveryChargeAmount
                ).toFixed(2)} AED
              </div>
            )}
          </div>
        )}
      </div>

      {(formData.deliveryType === "delivery" || selectedClientIsBroker) && (
        <div className="space-y-2">
          <Label className="text-base">Delivery Charge (AED)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={deliveryCharge}
            onChange={(e) => setDeliveryCharge(e.target.value)}
            placeholder="0.00"
            data-testid="input-delivery-charge"
          />
        </div>
      )}

      {(appliedDiscountAmount > 0 || deliveryChargeAmount > 0) && (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{orderTotal.toFixed(2)} AED</span>
          </div>
          {appliedDiscountAmount > 0 && (
            <div className="flex justify-between text-orange-600">
              <span>Discount</span>
              <span>-{appliedDiscountAmount.toFixed(2)} AED</span>
            </div>
          )}
          {deliveryChargeAmount > 0 && (
            <div className="flex justify-between text-blue-600">
              <span>Delivery Charge</span>
              <span>+{deliveryChargeAmount.toFixed(2)} AED</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
            <span>Total</span>
            <span>{orderFinalTotal.toFixed(2)} AED</span>
          </div>
        </div>
      )}

      <Button
        type="submit"
        className="w-full h-14 text-lg font-semibold touch-manipulation"
        disabled={
          isLoading ||
          !formData.clientId ||
          orderItems.length === 0 ||
          ((formData.deliveryType === "delivery" || selectedClientIsBroker) &&
            !formData.deliveryAddress.trim()) ||
          !!clientMatch
        }
        data-testid="button-submit-order"
      >
        {isLoading && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
        {clientMatch ? "Use existing client above" : `Create Order (${orderFinalTotal.toFixed(2)} AED)`}
      </Button>
      {clientMatch && (
        <p className="text-sm text-red-600 text-center font-medium">
          Cannot create order - Customer "{clientMatch.client.name}" already exists with this phone number
        </p>
      )}
      {(formData.deliveryType === "delivery" || selectedClientIsBroker) &&
        !formData.deliveryAddress.trim() && (
          <p className="text-sm text-orange-600 text-center">
            {selectedClientIsBroker ? "Broker order address is required for broker orders" : "Delivery address is required for delivery orders"}
          </p>
        )}

      {/* Square Meter Dialog for Carpet */}
      <Dialog open={sqmDialog.open} onOpenChange={(open) => !open && setSqmDialog({ open: false, productId: null, productName: "", sqmPrice: "12.00" })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enter Carpet Size</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {sqmDialog.productName} is priced at <span className="font-bold text-foreground">{sqmDialog.sqmPrice} AED per square meter</span>
            </p>
            <div className="space-y-2">
              <Label htmlFor="sqm-input">Square Meters (SQM)</Label>
              <Input
                id="sqm-input"
                type="number"
                step="0.1"
                min="0.1"
                placeholder="e.g., 5.5"
                value={sqmInput}
                onChange={(e) => setSqmInput(e.target.value)}
                autoFocus
                data-testid="input-sqm"
              />
            </div>
            {sqmInput && parseFloat(sqmInput) > 0 && (
              <div className="p-3 bg-primary/10 rounded-lg">
                <p className="text-sm">
                  Total: <span className="font-bold text-lg">{(parseFloat(sqmInput) * parseFloat(sqmDialog.sqmPrice)).toFixed(2)} AED</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {sqmInput} sqm × {sqmDialog.sqmPrice} AED/sqm
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setSqmDialog({ open: false, productId: null, productName: "", sqmPrice: "12.00" })}
              data-testid="button-sqm-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSqmConfirm}
              disabled={!sqmInput || parseFloat(sqmInput) <= 0}
              data-testid="button-sqm-confirm"
            >
              Add to Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Size Picker Dialog for products with sizes */}
      <Dialog open={sizePickerDialog.open} onOpenChange={(open) => !open && setSizePickerDialog({ open: false, productId: null, productName: "" })}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Select Size - {sizePickerDialog.productName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {sizePickerDialog.productId && (() => {
              const product = products?.find(p => p.id === sizePickerDialog.productId);
              if (!product) return null;
              const allSizes: { key: 'small' | 'medium' | 'large'; label: string; price: string | null }[] = [
                { key: 'small' as const, label: 'Small', price: product.smallPrice },
                { key: 'medium' as const, label: 'Medium', price: product.mediumPrice },
                { key: 'large' as const, label: 'Large', price: product.largePrice },
              ];
              const sizes = allSizes.filter(s => s.price);
              return sizes.map(s => {
                const entryKey = getEntryKey(product.id, s.key);
                const currentQty = itemEntries[entryKey]?.quantity || 0;
                return (
                  <Button
                    key={s.key}
                    type="button"
                    variant="outline"
                    className="w-full h-14 justify-between text-base"
                    onClick={() => handleAddSizedItem(product.id, s.key)}
                    data-testid={`btn-size-${s.key}`}
                  >
                    <span className="font-medium">{s.label}</span>
                    <div className="flex items-center gap-2">
                      {currentQty > 0 && <Badge variant="secondary" className="text-xs">{currentQty} in order</Badge>}
                      <span className="font-bold text-primary">{parseFloat(s.price!).toFixed(2)} AED</span>
                    </div>
                  </Button>
                );
              });
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSizePickerDialog({ open: false, productId: null, productName: "" })} data-testid="btn-size-cancel">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </form>
  );
}
