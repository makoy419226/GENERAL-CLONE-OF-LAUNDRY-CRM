import { useState, useMemo, useEffect, useContext, useRef, useCallback } from "react";
import { AnalogClockPicker } from "@/components/AnalogClockPicker";
import { CenteredDatePicker } from "@/components/CenteredDatePicker";
import { getInvoiceItemDescriptionHtml } from "@/components/InvoiceItemDescription";
import { useSearch } from "wouter";
import { UserContext } from "@/App";
import { useProducts, useUpdateProduct } from "@/hooks/use-products";
import { useClients, useCreateClient } from "@/hooks/use-clients";
import { ClientForm } from "@/components/ClientForm";
import { InternationalPhoneInput } from "@/components/InternationalPhoneInput";
import { PayBillDialog } from "@/components/PayBillDialog";
import { useBills } from "@/hooks/use-bills";
import { getProductImage } from "@/lib/productImages";
import {
  escapeHtml,
  formatCompanyPhoneLine,
  getCompanyAddressLines,
  useCompanyContactInfo,
} from "@/lib/companyContact";
import {
  Loader2,
  Search,
  Shirt,
  Footprints,
  Home,
  Sparkles,
  Check,
  X,
  Plus,
  Minus,
  ShoppingCart,
  Clock,
  Package,
  Truck,
  Zap,
  Lock,
  AlertCircle,
  AlertTriangle,
  Pencil,
  Edit,
  Printer,
  Tag,
  GripVertical,
  Banknote,
  Star,
  ChevronDown,
  ChevronUp,
  User,
  Phone,
  MapPin,
  Building2,
  ArrowRightLeft,
  CheckCircle2,
} from "lucide-react";
import html2pdf from "html2pdf.js";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import type { Bill, Client, Order, Product } from "@shared/schema";
import {
  hasPhoneDigits,
  isPlausiblePhoneNumber,
  normalizePhoneForComparison,
} from "@shared/phone";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useProductCategorySettings } from "@/lib/productCategories";
import {
  DEFAULT_PRODUCT_CATEGORY_NAME,
  FAVORITES_PRODUCT_CATEGORY_NAME,
  UNCATEGORIZED_PRODUCT_CATEGORY_NAME,
  getProductCategoryDisplayName,
  getProductCategoryGroupName,
  normalizeCategoryNames as normalizeSharedCategoryNames,
  normalizeStoredProductCategoryName,
  normalizeProductIdOrder,
} from "@shared/productCategories";
import { format } from "date-fns";
const getCategoryIcon = (category: string | null, size: string = "w-5 h-5") => {
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

const normalizeCategoryNames = (input: unknown): string[] => {
  return normalizeSharedCategoryNames(input);
};

const formatCompactAmount = (amount: number) =>
  Number.isInteger(amount)
    ? amount.toString()
    : amount.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

const isBrokerClient = (client?: Client | null) =>
  ((client as any)?.clientType || "").trim().toLowerCase() === "broker";

const isCompanyClient = (client?: Client | null) =>
  Boolean(String((client as any)?.company || "").trim());

const isAddressSearchableClient = (client?: Client | null) => {
  const address = String(client?.address || "").trim();
  return Boolean(address && address !== "-" && address !== "0");
};

const isPhoneSearchableClient = (client?: Client | null) =>
  hasPhoneDigits(client?.phone || "");

const getDefaultDeliveryTypeForExistingClient = (client?: Client | null) => {
  if (!client || isBrokerClient(client)) return "pickup";
  const address = String(client.address || "").trim();
  return address && address !== "-" ? "delivery" : "pickup";
};

const safeGetLocalStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeRemoveLocalStorage = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage access failures (e.g. blocked storage in embedded previews)
  }
};

type StaffPinPreview = {
  name: string;
  roleLabel: string;
};

type VerifiedOrderStaff = {
  name: string;
  pin: string;
  role: string | null;
};

const formatStaffPinPreviewRole = (role: unknown): string => {
  const normalizedRole = String(role || "staff").trim().toLowerCase();
  const roleLabels: Record<string, string> = {
    admin: "Admin",
    counter: "Counter",
    reception: "Counter",
    cashier: "Cashier",
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

type ProductCategoryTab = {
  id: string;
  label: string;
  isFavorites?: boolean;
  dbCategories?: string[];
  targetCategory?: string;
};

type CategoryTabDropTarget = {
  tabId: string;
  placement: "before" | "after" | "end";
};

type CategoryTabMenuMode = "menu" | "rename" | "delete";

const CATEGORY_TAB_END_DROP_ZONE_ID = "__category-tab-end-drop-zone__";
const UNCATEGORIZED_CATEGORY_TAB_ID = "uncategorized";

export default function Products() {
  const user = useContext(UserContext);
  const canManageItems = user?.role === "admin" || user?.role === "counter";
  const { companyContact } = useCompanyContactInfo();
  const companyAddressLines = getCompanyAddressLines(companyContact);
  const companyAddressHtml = companyAddressLines.map(escapeHtml).join("<br />");
  const companyPhoneLine = formatCompanyPhoneLine(companyContact);
  const companyPhoneHtml = escapeHtml(companyPhoneLine);
  const searchParams = useSearch();
  const urlSearch = new URLSearchParams(searchParams).get("search") || "";
  const urlClientId = new URLSearchParams(searchParams).get("clientId");
  const [searchTerm, setSearchTerm] = useState(urlSearch);
  const [initialClientLoaded, setInitialClientLoaded] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const newSearch = params.get("search") || "";
    if (newSearch !== searchTerm) {
      setSearchTerm(newSearch);
    }
  }, [searchParams]);

  const { data: clients } = useClients();
  const { data: bills } = useBills();

  useEffect(() => {
    if (urlClientId && clients && !initialClientLoaded) {
      const clientIdNum = parseInt(urlClientId, 10);
      if (!isNaN(clientIdNum)) {
        const client = clients.find((c) => c.id === clientIdNum);
        if (client) {
          setSelectedClientId(client.id);
          setIsBroker(isBrokerClient(client));
          setCustomerName(client.name);
          setCustomerPhone(client.phone || "");
          setDeliveryType(getDefaultDeliveryTypeForExistingClient(client));
        }
      }
      setInitialClientLoaded(true);
    }
  }, [urlClientId, clients, initialClientLoaded]);

  const [editingImageId, setEditingImageId] = useState<number | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [editingPriceProduct, setEditingPriceProduct] = useState<{
    id: number;
    name: string;
    price: string;
    dryCleanPrice: string;
    ironOnlyPrice: string;
    urgentIronOnlyPrice: string;
    urgentDryCleanPrice: string;
  } | null>(null);
  // Simple quantities: productId -> total quantity
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  // Service type splits: how many of each product are DC or Iron Only
  const [dcQuantities, setDcQuantities] = useState<Record<number, number>>({});
  const [ironQuantities, setIronQuantities] = useState<Record<number, number>>(
    {},
  );
  const [defaultBulkServiceType, setDefaultBulkServiceType] = useState<
    "normal" | "dc" | "iron"
  >("normal");
  // Dialog for selecting service type quantity
  const [serviceTypeDialog, setServiceTypeDialog] = useState<{
    productId: number;
    productName: string;
    type: "dc" | "iron";
    maxQty: number;
  } | null>(null);
  const [serviceTypeQty, setServiceTypeQty] = useState("");
  const [customPrices, setCustomPrices] = useState<Record<string, number>>({});
  const [packingTypes, setPackingTypes] = useState<
    Record<number, "hanging" | "folding">
  >({});
  const [defaultBulkPackingType, setDefaultBulkPackingType] = useState<
    "hanging" | "folding" | null
  >(null);
  const [urgentQuantities, setUrgentQuantities] = useState<
    Record<number, number>
  >({});
  const [urgentDialog, setUrgentDialog] = useState<{
    productId: number;
    productName: string;
    maxQty: number;
  } | null>(null);
  const [urgentQtyInput, setUrgentQtyInput] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [isWalkIn, setIsWalkIn] = useState(false);
  const [isBroker, setIsBroker] = useState(false);
  const [brokerDeliveryAddress, setBrokerDeliveryAddress] = useState("");
  const [showAddNewBrokerAddress, setShowAddNewBrokerAddress] = useState(false);
  const [newBrokerAddress, setNewBrokerAddress] = useState("");
  const [manualBrokerAddresses, setManualBrokerAddresses] = useState<string[]>(
    [],
  );
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [walkInAddress, setWalkInAddress] = useState("");
  const [walkInCompany, setWalkInCompany] = useState("");
  const [showNewCompanyInput, setShowNewCompanyInput] = useState(false);
  const [newCompanyInput, setNewCompanyInput] = useState("");
  const walkInNameInputRef = useRef<HTMLInputElement | null>(null);
  const walkInPhoneInputRef = useRef<HTMLInputElement | null>(null);
  const walkInAddressInputRef = useRef<HTMLInputElement | null>(null);
  const walkInCompanySelectRef = useRef<HTMLSelectElement | null>(null);
  const walkInNewCompanyInputRef = useRef<HTMLInputElement | null>(null);
  const serviceTypeQtyInputRef = useRef<HTMLInputElement | null>(null);
  const discountAmountInputRef = useRef<HTMLInputElement | null>(null);
  const rightShiftPlaceOrderRef = useRef(false);
  const [orderType, setOrderType] = useState<"normal" | "urgent">("normal");
  const [deliveryType, setDeliveryType] = useState<
    "pickup" | "delivery" | "iron_only"
  >("pickup");
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [applyDiscount, setApplyDiscount] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [tips, setTips] = useState("");
  const [applyDeliveryCharge, setApplyDeliveryCharge] = useState(false);
  const [deliveryCharge, setDeliveryCharge] = useState("");
  const [adjustedOrderTotal, setAdjustedOrderTotal] = useState<string | null>(
    null,
  );
  const [adjustOrderReason, setAdjustOrderReason] = useState("");
  const [showAdjustTotalDialog, setShowAdjustTotalDialog] = useState(false);
  const [adjustTotalPin, setAdjustTotalPin] = useState("");
  const [adjustTotalValue, setAdjustTotalValue] = useState("");
  const [adjustTotalError, setAdjustTotalError] = useState("");
  const [isVerifyingAdjustPin, setIsVerifyingAdjustPin] = useState(false);
  const [showUrgentDialog, setShowUrgentDialog] = useState(false);
  const [showNewClientDialog, setShowNewClientDialog] = useState(false);
  const [newClientMode, setNewClientMode] = useState<"regular" | "broker">(
    "regular",
  );
  const [editClientDialog, setEditClientDialog] = useState<any>(null);
  const [showCartPopup, setShowCartPopup] = useState(false);
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [clientSearchTerm, setClientSearchTerm] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [brokerOnlyClientFilter, setBrokerOnlyClientFilter] = useState(false);
  const [companyOnlyClientFilter, setCompanyOnlyClientFilter] = useState(false);
  const [addressOnlyClientFilter, setAddressOnlyClientFilter] = useState(false);
  const [phoneOnlyClientFilter, setPhoneOnlyClientFilter] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientAddress, setNewClientAddress] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientContact, setNewClientContact] = useState("");
  const [newClientPaymentMethod, setNewClientPaymentMethod] = useState("cash");
  const [newClientDiscount, setNewClientDiscount] = useState("");
  const [suggestedExistingClient, setSuggestedExistingClient] = useState<{
    id: number;
    name: string;
    phone: string;
    address: string | null;
  } | null>(null);
  const [customItems, setCustomItems] = useState<
    {
      name: string;
      price: number;
      quantity: number;
      normalPrice?: number;
      serviceType?: "normal" | "dc" | "iron";
      priceEdited?: boolean;
      urgentPrice?: number;
      dryCleanPrice?: number;
      ironOnlyPrice?: number;
      urgentIronOnlyPrice?: number;
      urgentDryCleanPrice?: number;
      isUrgent?: boolean;
    }[]
  >([]);
  const [showOtherItemDialog, setShowOtherItemDialog] = useState(false);
  const [otherItemName, setOtherItemName] = useState("");
  const [otherItemPrice, setOtherItemPrice] = useState("");
  const [otherItemQty, setOtherItemQty] = useState("1");
  const [showSizeDialog, setShowSizeDialog] = useState(false);

  const focusWalkInNameInput = () => {
    requestAnimationFrame(() => {
      walkInNameInputRef.current?.focus();
      walkInNameInputRef.current?.select();
    });
  };

  const focusWalkInPhoneInput = () => {
    requestAnimationFrame(() => {
      walkInPhoneInputRef.current?.focus();
      walkInPhoneInputRef.current?.select();
    });
  };

  const focusWalkInAddressInput = () => {
    requestAnimationFrame(() => {
      walkInAddressInputRef.current?.focus();
      walkInAddressInputRef.current?.select();
    });
  };

  const focusWalkInNewCompanyInput = () => {
    requestAnimationFrame(() => {
      walkInNewCompanyInputRef.current?.focus();
      walkInNewCompanyInputRef.current?.select();
    });
  };

  const focusServiceTypeQtyInput = () => {
    requestAnimationFrame(() => {
      serviceTypeQtyInputRef.current?.focus();
      serviceTypeQtyInputRef.current?.select();
    });
  };
  const [sizeDialogServiceType, setSizeDialogServiceType] = useState<
    "normal" | "dc" | "iron"
  >("normal");
  const [sizeDialogProduct, setSizeDialogProduct] = useState<{
    id: number;
    name: string;
    smallPrice: string | null;
    mediumPrice: string | null;
    largePrice: string | null;
    price: string | null;
    smallUrgentPrice: string | null;
    mediumUrgentPrice: string | null;
    largeUrgentPrice: string | null;
    smallDryCleanPrice: string | null;
    mediumDryCleanPrice: string | null;
    largeDryCleanPrice: string | null;
    smallIronOnlyPrice: string | null;
    mediumIronOnlyPrice: string | null;
    largeIronOnlyPrice: string | null;
    smallUrgentIronOnlyPrice: string | null;
    mediumUrgentIronOnlyPrice: string | null;
    largeUrgentIronOnlyPrice: string | null;
    smallUrgentDryCleanPrice: string | null;
    mediumUrgentDryCleanPrice: string | null;
    largeUrgentDryCleanPrice: string | null;
  } | null>(null);
  const [showSizedServicePicker, setShowSizedServicePicker] = useState(false);
  const [sizedServicePickerProduct, setSizedServicePickerProduct] = useState<{
    id: number;
    name: string;
    price: string | null;
    smallPrice: string | null;
    mediumPrice: string | null;
    largePrice: string | null;
    smallUrgentPrice: string | null;
    mediumUrgentPrice: string | null;
    largeUrgentPrice: string | null;
    smallDryCleanPrice: string | null;
    mediumDryCleanPrice: string | null;
    largeDryCleanPrice: string | null;
    smallIronOnlyPrice: string | null;
    mediumIronOnlyPrice: string | null;
    largeIronOnlyPrice: string | null;
    smallUrgentIronOnlyPrice: string | null;
    mediumUrgentIronOnlyPrice: string | null;
    largeUrgentIronOnlyPrice: string | null;
    smallUrgentDryCleanPrice: string | null;
    mediumUrgentDryCleanPrice: string | null;
    largeUrgentDryCleanPrice: string | null;
  } | null>(null);
  const [sizedServicePickerType, setSizedServicePickerType] = useState<
    "dc" | "iron"
  >("dc");
  const [showSizedUrgentPicker, setShowSizedUrgentPicker] = useState(false);
  const [sizedUrgentPickerProductName, setSizedUrgentPickerProductName] =
    useState("");
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [staffPin, setStaffPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [staffPinPreview, setStaffPinPreview] = useState<StaffPinPreview | null>(null);
  const staffPinPreviewRequestIdRef = useRef(0);
  const [pendingUrgent, setPendingUrgent] = useState(false);
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const [payNowAfterOrder, setPayNowAfterOrder] = useState(false);
  const [editingStockId, setEditingStockId] = useState<number | null>(null);
  const [stockValue, setStockValue] = useState("");
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null);
  const [showPrintTagDialog, setShowPrintTagDialog] = useState(false);
  const [payNowBillId, setPayNowBillId] = useState<number | null>(null);
  const [payNowBill, setPayNowBill] = useState<Bill | null>(null);
  const [payNowVerifiedStaff, setPayNowVerifiedStaff] =
    useState<VerifiedOrderStaff | null>(null);
  const pendingPayNowStaffRef = useRef<VerifiedOrderStaff | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("favorites");
  const [showNewProductDialog, setShowNewProductDialog] = useState(false);
  const [newProductName, setNewProductName] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductDryCleanPrice, setNewProductDryCleanPrice] = useState("");
  const [newProductCategory, setNewProductCategory] = useState("");
  const [showMoveItemDialog, setShowMoveItemDialog] = useState(false);
  const [moveItemTargetCategory, setMoveItemTargetCategory] = useState("");
  const [moveItemSearch, setMoveItemSearch] = useState("");
  const [showCreateCategoryDialog, setShowCreateCategoryDialog] =
    useState(false);
  const [newCategoryTabName, setNewCategoryTabName] = useState("");
  const [newCategoryTabSearch, setNewCategoryTabSearch] = useState("");
  const [newCategoryTabProductIds, setNewCategoryTabProductIds] = useState<
    number[]
  >([]);
  const [isCreatingCategoryFromTab, setIsCreatingCategoryFromTab] =
    useState(false);
  const [showEditModePinDialog, setShowEditModePinDialog] =
    useState(false);
  const [editModeAdminPin, setEditModeAdminPin] = useState("");
  const [editModePinError, setEditModePinError] = useState("");
  const [isVerifyingEditModePin, setIsVerifyingEditModePin] =
    useState(false);
  const [categoryTabMenu, setCategoryTabMenu] = useState<{
    categoryName: string;
    x: number;
    y: number;
  } | null>(null);
  const [categoryTabMenuMode, setCategoryTabMenuMode] =
    useState<CategoryTabMenuMode>("menu");
  const [categoryTabRenameValue, setCategoryTabRenameValue] = useState("");
  const [categoryActionError, setCategoryActionError] = useState("");
  const [isCategoryActionLoading, setIsCategoryActionLoading] = useState(false);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const categoryTabLongPressTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryTabLongPressTriggeredRef = useRef(false);
  const selectedClient =
    selectedClientId != null
      ? (clients?.find((client) => client.id === selectedClientId) ?? null)
      : null;
  const activePayNowBill =
    payNowBill ||
    (payNowBillId
      ? bills?.find((bill) => bill.id === payNowBillId) || null
      : null);
  const activePayNowClient =
    activePayNowBill?.clientId
      ? clients?.find((client) => client.id === activePayNowBill.clientId) || null
      : null;
  const selectedClientIsBroker = isBrokerClient(selectedClient);
  const isManualBrokerEntry = isBroker && !selectedClientId;
  const isBrokerOrder = isManualBrokerEntry || selectedClientIsBroker;
  const isManualClientEntry = isWalkIn || isManualBrokerEntry;
  const manualClientType = isManualBrokerEntry ? "broker" : "regular";
  const manualClientLabel = isManualBrokerEntry
    ? "Broker Client"
    : "Regular Client";
  const selectedClientTypeLabel = selectedClientIsBroker
    ? "Broker Client"
    : "Regular Client";
  const selectedBrokerAddresses: string[] = selectedClientIsBroker
    ? ((selectedClient as any)?.brokerAddresses as string[]) || []
    : [];
  const brokerAddressOptions = isManualBrokerEntry
    ? manualBrokerAddresses
    : selectedBrokerAddresses;
  const resetBrokerAddressState = () => {
    setBrokerDeliveryAddress("");
    setShowAddNewBrokerAddress(false);
    setNewBrokerAddress("");
    setManualBrokerAddresses([]);
  };
  const resetManualClientFields = () => {
    setWalkInName("");
    setWalkInPhone("");
    setWalkInAddress("");
    setWalkInCompany("");
    setShowNewCompanyInput(false);
    setNewCompanyInput("");
  };
  const handleUseExistingClient = (client: Client) => {
    const matchedClientIsBroker = isBrokerClient(client);
    setIsWalkIn(false);
    setIsBroker(matchedClientIsBroker);
    resetManualClientFields();
    resetBrokerAddressState();
    setSelectedClientId(client.id);
    setCustomerName(client.name);
    setCustomerPhone(client.phone || "");
    setDeliveryType(getDefaultDeliveryTypeForExistingClient(client));
    setClientSearchTerm("");
  };
  const selectedClientAddress =
    !selectedClientIsBroker &&
    selectedClient?.address &&
    selectedClient.address !== "-"
      ? selectedClient.address.trim().toUpperCase()
      : "";
  const normalizedWalkInAddress = walkInAddress.trim().toUpperCase();
  const normalizedBrokerDeliveryAddress = brokerDeliveryAddress
    .trim()
    .toUpperCase();
  const orderDeliveryAddress = isBrokerOrder
    ? normalizedBrokerDeliveryAddress
    : isManualClientEntry
      ? normalizedWalkInAddress
      : selectedClientAddress;
  const canChooseDelivery = orderDeliveryAddress.length > 0;
  const clientSelectorDisplayValue = showClientDropdown
    ? clientSearchTerm
    : clientSearchTerm ||
      (selectedClientId
        ? `${selectedClientTypeLabel}: ${customerName || selectedClient?.name || ""}`
        : isManualClientEntry
          ? manualClientLabel
          : "");
  const clientSearchResults = useMemo(() => {
    const search = clientSearchTerm.trim().toLowerCase();
    const normalizedPhoneSearch = normalizePhoneForComparison(clientSearchTerm);

    return (clients || []).filter((client) => {
      if (brokerOnlyClientFilter && !isBrokerClient(client)) return false;
      if (companyOnlyClientFilter && !isCompanyClient(client)) return false;
      const hasSearchableAddress = isAddressSearchableClient(client);
      const hasSearchablePhone = isPhoneSearchableClient(client);

      if (addressOnlyClientFilter && !hasSearchableAddress) return false;
      if (phoneOnlyClientFilter && !hasSearchablePhone) return false;
      if (!search) return true;

      const addressMatches =
        hasSearchableAddress &&
        String(client.address).toLowerCase().includes(search);
      const phoneMatches =
        hasSearchablePhone &&
        (String(client.phone).toLowerCase().includes(search) ||
          (!!normalizedPhoneSearch &&
            normalizePhoneForComparison(client.phone).includes(
              normalizedPhoneSearch,
            )));

      if (addressOnlyClientFilter) return addressMatches;
      if (phoneOnlyClientFilter) return phoneMatches;

      return (
        client.name.toLowerCase().includes(search) ||
        phoneMatches ||
        addressMatches ||
        ((client as any).company &&
          String((client as any).company).toLowerCase().includes(search))
      );
    });
  }, [
    addressOnlyClientFilter,
    brokerOnlyClientFilter,
    clientSearchTerm,
    clients,
    companyOnlyClientFilter,
    phoneOnlyClientFilter,
  ]);
  const handleSelectBrokerAddress = (address: string) => {
    setBrokerDeliveryAddress(address);
    setShowAddNewBrokerAddress(false);
    setNewBrokerAddress("");
  };
  const handleAddManualBrokerAddress = () => {
    const normalizedAddress = newBrokerAddress.trim().toUpperCase();
    if (!normalizedAddress) return;

    setManualBrokerAddresses((prev) => {
      if (prev.some((address) => address.toUpperCase() === normalizedAddress)) {
        return prev;
      }
      return [...prev, normalizedAddress];
    });
    setBrokerDeliveryAddress(normalizedAddress);
    setShowAddNewBrokerAddress(false);
    setNewBrokerAddress("");
  };
  const syncClientInCache = (updatedClient: Client) => {
    queryClient.setQueriesData(
      { queryKey: ["/api/clients"] },
      (oldData: unknown) => {
        if (!Array.isArray(oldData)) return oldData;
        return oldData.map((client) =>
          client.id === updatedClient.id ? updatedClient : client,
        );
      },
    );
  };

  useEffect(() => {
    if (!selectedClientId || !selectedClient || isManualClientEntry) return;

    setCustomerName(selectedClient.name || "");
    setCustomerPhone(
      selectedClient.phone && selectedClient.phone !== "0"
        ? selectedClient.phone
        : "",
    );
  }, [isManualClientEntry, selectedClient, selectedClientId]);

  useEffect(() => {
    if (!selectedClientId || selectedClientIsBroker) return;

    setBrokerDeliveryAddress("");
    setShowAddNewBrokerAddress(false);
    setNewBrokerAddress("");
  }, [selectedClientId, selectedClientIsBroker]);

  useEffect(() => {
    if (!selectedClientId || !selectedClientIsBroker || !brokerDeliveryAddress)
      return;

    const hasSelectedAddress = selectedBrokerAddresses.some(
      (address) =>
        address.toUpperCase() === brokerDeliveryAddress.toUpperCase(),
    );

    if (!hasSelectedAddress) {
      setBrokerDeliveryAddress("");
    }
  }, [
    brokerDeliveryAddress,
    selectedBrokerAddresses,
    selectedClientId,
    selectedClientIsBroker,
  ]);

  useEffect(() => {
    if (!isManualBrokerEntry || !brokerDeliveryAddress) return;

    const hasSelectedAddress = manualBrokerAddresses.some(
      (address) =>
        address.toUpperCase() === brokerDeliveryAddress.toUpperCase(),
    );

    if (!hasSelectedAddress) {
      setBrokerDeliveryAddress("");
    }
  }, [brokerDeliveryAddress, isManualBrokerEntry, manualBrokerAddresses]);

  useEffect(() => {
    if (!canChooseDelivery && deliveryType === "delivery") {
      setDeliveryType("pickup");
    }
  }, [canChooseDelivery, deliveryType]);

  const [draggedFavId, setDraggedFavId] = useState<number | null>(null);
  const [dragOverFavId, setDragOverFavId] = useState<number | null>(null);
  const legacyFavoritesOrderSyncRef = useRef(false);
  const touchStartRef = useRef<{
    id: number;
    x: number;
    y: number;
    el: HTMLElement | null;
  } | null>(null);
  const [touchDragging, setTouchDragging] = useState(false);
  const [draggingCategoryName, setDraggingCategoryName] = useState<
    string | null
  >(null);
  const [dragOverCategoryTarget, setDragOverCategoryTarget] =
    useState<CategoryTabDropTarget | null>(null);
  const [draftCategoryDisplayOrder, setDraftCategoryDisplayOrder] = useState<
    string[] | null
  >(null);
  const [pendingProductCategoryChanges, setPendingProductCategoryChanges] =
    useState<Record<number, string>>({});

  useEffect(() => {
    if (!applyDiscount) {
      setDiscountAmount("");
      return;
    }

    const focusTimer = window.setTimeout(() => {
      discountAmountInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [applyDiscount]);

  const getSortedFavorites = (products: Product[]) => {
    const starred = products.filter((product) => product.starred);
    if (favoritesOrder.length === 0) return starred;

    const ordered: Product[] = [];
    favoritesOrder.forEach((id) => {
      const found = starred.find((product) => product.id === id);
      if (found) ordered.push(found);
    });

    starred.forEach((product) => {
      if (!favoritesOrder.includes(product.id)) ordered.push(product);
    });

    return ordered;
  };

  const buildFavOrder = () => {
    const starred = allProducts?.filter((product) => product.starred) || [];
    return favoritesOrder.length > 0
      ? [
          ...favoritesOrder.filter((id) =>
            starred.some((product) => product.id === id),
          ),
          ...starred
            .filter((product) => !favoritesOrder.includes(product.id))
            .map((product) => product.id),
        ]
      : starred.map((product) => product.id);
  };

  const handleFavDrop = (dragId: number, dropId: number) => {
    if (dragId === dropId) return;
    const currentOrder = buildFavOrder();
    const fromIdx = currentOrder.indexOf(dragId);
    const toIdx = currentOrder.indexOf(dropId);
    if (fromIdx === -1 || toIdx === -1) return;
    currentOrder.splice(fromIdx, 1);
    currentOrder.splice(toIdx, 0, dragId);
    void updateSharedCategorySettings({ favoritesOrder: currentOrder }).catch(
      () => {
        toast({
          title: "Favorites Sync Failed",
          description: "Could not save the favorites arrangement for all browsers.",
          variant: "destructive",
        });
      },
    );
  };

  const [draggingProduct, setDraggingProduct] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [dragOverTab, setDragOverTab] = useState<string | null>(null);

  // SQM pricing dialog state (for carpet and similar items)
  const [sqmDialog, setSqmDialog] = useState<{
    open: boolean;
    productId: number | null;
    productName: string;
    sqmPrice: string;
  }>({
    open: false,
    productId: null,
    productName: "",
    sqmPrice: "12.00",
  });
  const [sqmInput, setSqmInput] = useState("");
  const sqmDialogProcessing = useRef(false); // Prevent rapid clicks from crashing
  const [sqmValues, setSqmValues] = useState<Record<number, number>>({});

  // Track multiple carpet entries with different sqm values
  const [carpetEntries, setCarpetEntries] = useState<
    Array<{
      id: string; // unique id for each entry
      productId: number;
      sqm: number;
      serviceType: "normal" | "dc" | "iron";
    }>
  >([]);

  // Stock orders dialog - shows which orders contain a product
  const [stockOrdersDialog, setStockOrdersDialog] = useState<{
    open: boolean;
    productName: string;
    count: number;
  }>({ open: false, productName: "", count: 0 });
  const { data: stockProductOrders, isLoading: stockOrdersLoading } = useQuery<
    { orderNumber: string; quantity: number; orderId: number }[]
  >({
    queryKey: [
      "/api/products/orders-by-product",
      stockOrdersDialog.productName,
    ],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/products/orders-by-product?name=${encodeURIComponent(stockOrdersDialog.productName)}`,
        { signal },
      );
      return res.json();
    },
    enabled: stockOrdersDialog.open && !!stockOrdersDialog.productName,
  });

  // Dialog for selecting which carpet to apply DC/Iron to
  const [carpetServiceDialog, setCarpetServiceDialog] = useState<{
    open: boolean;
    productId: number | null;
    productName: string;
    serviceType: "dc" | "iron";
  }>({ open: false, productId: null, productName: "", serviceType: "dc" });

  // Check if a product has size pricing defined in the database
  const hasSizeOption = (product: {
    name: string;
    smallPrice?: string | null;
    mediumPrice?: string | null;
    largePrice?: string | null;
  }) => {
    // Product has size option if it has at least small and large prices defined
    const hasDbPrices = !!(product.smallPrice || product.largePrice);
    // Also check it's not already a sized variant
    const isNotSizedVariant =
      !product.name.includes("(Small)") &&
      !product.name.includes("(Medium)") &&
      !product.name.includes("(Large)");
    return hasDbPrices && isNotSizedVariant;
  };

  // Legacy function for backwards compatibility - checks product name patterns
  const hasSizeOptionByName = (productName: string) => {
    const sizeKeywords = [
      "Towel",
      "Comfort",
      "Blanket",
      "Duvet Cover",
      "Bed Sheet",
      "Curtain",
      "Window Screen",
    ];
    return sizeKeywords.some(
      (key) =>
        productName.toLowerCase().includes(key.toLowerCase()) &&
        !productName.includes("(Small)") &&
        !productName.includes("(Medium)") &&
        !productName.includes("(Large)"),
    );
  };

  // Get the total quantity of sized items for a product (from customItems)
  const getSizedItemQuantity = (productName: string): number => {
    return customItems
      .filter((item) =>
        item.name.toLowerCase().startsWith(productName.toLowerCase()),
      )
      .reduce((sum, item) => sum + item.quantity, 0);
  };

  // Check if a product is selected (either in cart or in customItems for sized items)
  const isProductSelected = (product: {
    id: number;
    name: string;
    smallPrice?: string | null;
    largePrice?: string | null;
  }) => {
    // Check if in cart (any service type)
    if (getTotalQuantityForProduct(product.id) > 0) return true;
    // Check if size-based product is in customItems
    if (hasSizeOption(product)) {
      return customItems.some((item) =>
        item.name.toLowerCase().startsWith(product.name.toLowerCase()),
      );
    }
    // Check if gutra product is in customItems
    if (isGutraProduct(product.name)) {
      return customItems.some((item) =>
        item.name.toLowerCase().includes("gutra"),
      );
    }
    return false;
  };

  // Get total quantity for a product (uses carpetEntries for sqm products)
  const getTotalQuantityForProduct = (productId: number): number => {
    const product = products?.find((p) => p.id === productId);
    if (product?.isSqmPriced) {
      return carpetEntries.filter((e) => e.productId === productId).length;
    }
    return quantities[productId] || 0;
  };

  // Check if product has DC items (uses carpetEntries for sqm products)
  const hasDcItems = (productId: number): boolean => {
    const product = products?.find((p) => p.id === productId);
    if (product?.isSqmPriced) {
      return carpetEntries.some(
        (e) => e.productId === productId && e.serviceType === "dc",
      );
    }
    return (dcQuantities[productId] || 0) > 0;
  };

  // Check if product has Iron Only items (uses carpetEntries for sqm products, customItems for sized)
  const hasIronItems = (productId: number): boolean => {
    const product = products?.find((p) => p.id === productId);
    if (product?.isSqmPriced) {
      return carpetEntries.some(
        (e) => e.productId === productId && e.serviceType === "iron",
      );
    }
    if (product && hasSizeOption(product)) {
      return customItems.some(
        (item) =>
          item.name.toLowerCase().startsWith(product.name.toLowerCase()) &&
          item.serviceType === "iron",
      );
    }
    return (ironQuantities[productId] || 0) > 0;
  };

  const hasDcItemsForProduct = (productId: number): boolean => {
    const product = products?.find((p) => p.id === productId);
    if (product?.isSqmPriced) {
      return carpetEntries.some(
        (e) => e.productId === productId && e.serviceType === "dc",
      );
    }
    if (product && hasSizeOption(product)) {
      return customItems.some(
        (item) =>
          item.name.toLowerCase().startsWith(product.name.toLowerCase()) &&
          item.serviceType === "dc",
      );
    }
    return (dcQuantities[productId] || 0) > 0;
  };

  const checkExistingClientByPhone = (phone: string) => {
    if (!clients) return;

    if (!isPlausiblePhoneNumber(phone)) {
      setSuggestedExistingClient(null);
      return;
    }

    const normalizedInput = normalizePhoneForComparison(phone);

    const matchingClient = clients.find((client) => {
      if (!client.phone) return false;
      const normalizedClientPhone = normalizePhoneForComparison(client.phone);
      return normalizedClientPhone === normalizedInput;
    });

    if (matchingClient) {
      setSuggestedExistingClient({
        id: matchingClient.id,
        name: matchingClient.name,
        phone: matchingClient.phone || "",
        address: matchingClient.address,
      });
    } else {
      setSuggestedExistingClient(null);
    }
  };

  const [showGutraDialog, setShowGutraDialog] = useState(false);
  const [gutraDialogProduct, setGutraDialogProduct] = useState<{
    id: number;
    name: string;
    price: number;
  } | null>(null);
  const [gutraNisha, setGutraNisha] = useState<"nisha" | "without-nisha" | "">(
    "",
  );
  const [gutraStyle, setGutraStyle] = useState<"line" | "straight" | "">("");

  const isGutraProduct = (productName: string) => {
    return (
      productName.toLowerCase().includes("gutra") &&
      !productName.includes("Nisha") &&
      !productName.includes("Line") &&
      !productName.includes("Straight")
    );
  };

  const { data: products, isLoading, isError } = useProducts(searchTerm);
  const { data: allProducts } = useProducts(""); // Fetch all products for order lookups
  const { data: allOrders } = useQuery<Order[]>({ queryKey: ["/api/orders"] });
  const { data: companiesList } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/companies"],
  });
  const existingCompanies = useMemo(() => {
    return (companiesList || []).map((c) => c.name).sort();
  }, [companiesList]);
  const { data: allocatedStock } = useQuery<Record<string, number>>({
    queryKey: ["/api/products/allocated-stock"],
    staleTime: 30000, // 30 seconds cache
  });
  const { mutate: createClient, isPending: isCreatingClient } =
    useCreateClient();
  const updateProduct = useUpdateProduct();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const {
    settings: sharedCategorySettings,
    updateSettings: updateSharedCategorySettings,
  } = useProductCategorySettings();
  const favoritesOrder = sharedCategorySettings.favoritesOrder;

  const allItemsCategoryName = DEFAULT_PRODUCT_CATEGORY_NAME;
  const uncategorizedCategoryName = UNCATEGORIZED_PRODUCT_CATEGORY_NAME;
  const favoritesCategoryName = FAVORITES_PRODUCT_CATEGORY_NAME;

  const getDisplayCategoryName = (rawCategory: string | null | undefined) => {
    return getProductCategoryGroupName(rawCategory, [
        ...sharedCategorySettings.customCategories,
        ...sharedCategorySettings.inventoryDisplayOrder,
        ...sharedCategorySettings.orderDisplayOrder,
        ...((allProducts || []).map((product) => product.category || "")),
      ]);
  };

  const baseCategoryDefaults = sharedCategorySettings.baseCategories;
  const customCategories = sharedCategorySettings.customCategories;
  const categoryDisplayOrder = sharedCategorySettings.inventoryDisplayOrder;

  const persistBaseCategories = (categories: string[]) => {
    return updateSharedCategorySettings({
      baseCategories: normalizeCategoryNames(categories),
    });
  };

  const persistCustomCategories = (categories: string[]) => {
    return updateSharedCategorySettings({
      customCategories: normalizeCategoryNames(categories),
    });
  };

  const persistCategoryDisplayOrder = (categories: string[]) => {
    const normalizedCategories = normalizeCategoryNames(categories);

    return updateSharedCategorySettings({
      inventoryDisplayOrder: normalizedCategories,
      orderDisplayOrder: normalizedCategories,
    });
  };

  useEffect(() => {
    if (legacyFavoritesOrderSyncRef.current) return;

    const savedFavoritesOrder = safeGetLocalStorage("favoritesOrder");
    if (!savedFavoritesOrder) return;

    if (favoritesOrder.length > 0) {
      legacyFavoritesOrderSyncRef.current = true;
      safeRemoveLocalStorage("favoritesOrder");
      return;
    }

    if (!allProducts) return;

    let parsedFavoritesOrder: unknown;
    try {
      parsedFavoritesOrder = JSON.parse(savedFavoritesOrder);
    } catch {
      legacyFavoritesOrderSyncRef.current = true;
      safeRemoveLocalStorage("favoritesOrder");
      return;
    }

    const starredProductIds = new Set(
      allProducts.filter((product) => product.starred).map((product) => product.id),
    );
    const migratedFavoritesOrder = normalizeProductIdOrder(
      parsedFavoritesOrder,
    ).filter((productId) => starredProductIds.has(productId));

    legacyFavoritesOrderSyncRef.current = true;

    if (migratedFavoritesOrder.length === 0) {
      safeRemoveLocalStorage("favoritesOrder");
      return;
    }

    void updateSharedCategorySettings({
      favoritesOrder: migratedFavoritesOrder,
    })
      .then(() => {
        safeRemoveLocalStorage("favoritesOrder");
      })
      .catch(() => {
        legacyFavoritesOrderSyncRef.current = false;
        toast({
          title: "Favorites Sync Failed",
          description: "Could not move the saved favorites order to shared storage yet.",
          variant: "destructive",
        });
      });
  }, [allProducts, favoritesOrder, toast, updateSharedCategorySettings]);

  const categoryOptions = useMemo(() => {
    const dynamicFromProducts = (allProducts || [])
      .map((p) =>
        normalizeStoredProductCategoryName(p.category, [
          ...baseCategoryDefaults,
          ...customCategories,
          ...sharedCategorySettings.inventoryDisplayOrder,
          ...sharedCategorySettings.orderDisplayOrder,
        ]),
      )
      .filter((categoryName): categoryName is string => Boolean(categoryName));
    return normalizeCategoryNames([
      ...baseCategoryDefaults,
      ...customCategories,
      ...sharedCategorySettings.inventoryDisplayOrder,
      ...sharedCategorySettings.orderDisplayOrder,
      ...dynamicFromProducts,
    ]);
  }, [
    allProducts,
    baseCategoryDefaults,
    customCategories,
    sharedCategorySettings.inventoryDisplayOrder,
    sharedCategorySettings.orderDisplayOrder,
  ]);

  const orderedCategoryOptions = useMemo(() => {
    if (categoryDisplayOrder.length === 0) return categoryOptions;

    const ordered: string[] = [];
    const includedKeys = new Set<string>();

    categoryDisplayOrder.forEach((savedCategory) => {
      const match = categoryOptions.find(
        (categoryName) =>
          categoryName.toLowerCase() === savedCategory.toLowerCase(),
      );
      if (!match) return;
      const key = match.toLowerCase();
      if (includedKeys.has(key)) return;
      includedKeys.add(key);
      ordered.push(match);
    });

    categoryOptions.forEach((categoryName) => {
      const key = categoryName.toLowerCase();
      if (includedKeys.has(key)) return;
      includedKeys.add(key);
      ordered.push(categoryName);
    });

    return ordered;
  }, [categoryDisplayOrder, categoryOptions]);

  const effectiveCategoryDisplayOrder = useMemo(() => {
    if (!isEditMode) return orderedCategoryOptions;
    return draftCategoryDisplayOrder ?? orderedCategoryOptions;
  }, [draftCategoryDisplayOrder, isEditMode, orderedCategoryOptions]);

  const hasPendingProductMoveChanges = useMemo(
    () => Object.keys(pendingProductCategoryChanges).length > 0,
    [pendingProductCategoryChanges],
  );

  useEffect(() => {
    if (!isEditMode) {
      setDraftCategoryDisplayOrder(null);
    }
  }, [isEditMode, orderedCategoryOptions]);

  const updateDraftCategoryDisplayOrder = (
    updater: (draftCategories: string[]) => string[],
  ) => {
    setDraftCategoryDisplayOrder((prev) => {
      if (prev === null) return prev;
      return normalizeCategoryNames(updater(prev));
    });
  };

  const replacePendingCategoryTarget = (
    fromCategory: string,
    toCategory: string,
  ) => {
    const normalizedFromCategory = fromCategory.trim().toLowerCase();
    const normalizedToCategory = toCategory.trim();
    if (!normalizedFromCategory || !normalizedToCategory) return;

    setPendingProductCategoryChanges((current) => {
      let changed = false;
      const next: Record<number, string> = {};

      Object.entries(current).forEach(([productId, targetCategory]) => {
        if (
          targetCategory.trim().toLowerCase() === normalizedFromCategory
        ) {
          next[Number(productId)] = normalizedToCategory;
          changed = true;
          return;
        }

        next[Number(productId)] = targetCategory;
      });

      return changed ? next : current;
    });
  };

  const getEffectiveProductCategory = (product: Product) =>
    pendingProductCategoryChanges[product.id] ?? product.category;

  const hardcodedCategoryNames = [
    allItemsCategoryName,
    uncategorizedCategoryName,
    favoritesCategoryName,
  ];
  const isHardcodedCategoryName = (name: string) =>
    hardcodedCategoryNames.some(
      (hardcodedName) =>
        hardcodedName.toLowerCase() === name.trim().toLowerCase(),
    );

  const editableCategoryOptions = useMemo(
    () =>
      orderedCategoryOptions.filter(
        (categoryName) => !isHardcodedCategoryName(categoryName),
      ),
    [orderedCategoryOptions],
  );

  const newProductCategoryOptions = useMemo(
    () => [uncategorizedCategoryName, ...orderedCategoryOptions],
    [orderedCategoryOptions, uncategorizedCategoryName],
  );

  const getCategoryTabId = (categoryName: string) => {
    const normalized = categoryName.trim().toLowerCase();
    const slug = normalized
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "");
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
    }
    return `category-${slug || "item"}-${Math.abs(hash).toString(36)}`;
  };

  useEffect(() => {
    if (
      !Array.isArray(allProducts) ||
      isEditMode ||
      hasPendingProductMoveChanges
    ) {
      return;
    }

    const availableCategories = normalizeCategoryNames([
      ...baseCategoryDefaults,
      ...customCategories,
      ...categoryDisplayOrder,
      ...sharedCategorySettings.orderDisplayOrder,
    ]);
    if (availableCategories.length === 0) return;

    const activeCategoryKeys = new Set(
      allProducts
        .map((product) =>
          normalizeStoredProductCategoryName(product.category, availableCategories),
        )
        .filter((categoryName): categoryName is string => Boolean(categoryName))
        .map((categoryName) => categoryName.toLowerCase()),
    );

    const emptyCategoryKeys = new Set(
      availableCategories
        .filter((categoryName) => !isHardcodedCategoryName(categoryName))
        .filter(
          (categoryName) => !activeCategoryKeys.has(categoryName.toLowerCase()),
        )
        .map((categoryName) => categoryName.toLowerCase()),
    );
    if (emptyCategoryKeys.size === 0) return;

    const removeEmptyCategories = (categories: string[]) =>
      normalizeCategoryNames(categories).filter(
        (categoryName) => !emptyCategoryKeys.has(categoryName.toLowerCase()),
      );
    const nextBaseCategories = removeEmptyCategories(baseCategoryDefaults);
    const nextCustomCategories = removeEmptyCategories(customCategories);
    const nextInventoryDisplayOrder = removeEmptyCategories(categoryDisplayOrder);
    const nextOrderDisplayOrder = removeEmptyCategories(
      sharedCategorySettings.orderDisplayOrder,
    );
    const arraysMatch = (left: string[], right: string[]) =>
      left.length === right.length &&
      left.every((value, index) => value === right[index]);

    if (
      arraysMatch(nextBaseCategories, baseCategoryDefaults) &&
      arraysMatch(nextCustomCategories, customCategories) &&
      arraysMatch(nextInventoryDisplayOrder, categoryDisplayOrder) &&
      arraysMatch(nextOrderDisplayOrder, sharedCategorySettings.orderDisplayOrder)
    ) {
      return;
    }

    void updateSharedCategorySettings({
      baseCategories: nextBaseCategories,
      customCategories: nextCustomCategories,
      inventoryDisplayOrder: nextInventoryDisplayOrder,
      orderDisplayOrder: nextOrderDisplayOrder,
    }).then(() => {
      const selectedEmptyCategory = availableCategories.some(
        (categoryName) =>
          emptyCategoryKeys.has(categoryName.toLowerCase()) &&
          selectedCategory === getCategoryTabId(categoryName),
      );
      if (selectedEmptyCategory) {
        setSelectedCategory("favorites");
      }
    });
  }, [
    allProducts,
    baseCategoryDefaults,
    categoryDisplayOrder,
    customCategories,
    hasPendingProductMoveChanges,
    isEditMode,
    selectedCategory,
    sharedCategorySettings.orderDisplayOrder,
    updateSharedCategorySettings,
  ]);

  const safeNewProductCategory = useMemo(
    () =>
      newProductCategoryOptions.some(
        (categoryName) =>
          categoryName.toLowerCase() ===
          newProductCategory.trim().toLowerCase(),
      )
        ? newProductCategory
        : "",
    [newProductCategory, newProductCategoryOptions],
  );

  useEffect(() => {
    if (newProductCategory && !safeNewProductCategory) {
      setNewProductCategory("");
    }
  }, [newProductCategory, safeNewProductCategory]);

  const createCategoryCandidateProducts = useMemo(() => {
    const query = newCategoryTabSearch.trim().toLowerCase();
    return (allProducts || [])
      .filter((product) => {
        if (!query) return true;
        return (
          product.name.toLowerCase().includes(query) ||
          getDisplayCategoryName(product.category).toLowerCase().includes(query)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allProducts, newCategoryTabSearch]);

  const selectedNewCategoryProducts = useMemo(() => {
    const selectedIds = new Set(newCategoryTabProductIds);
    return (allProducts || []).filter((product) => selectedIds.has(product.id));
  }, [allProducts, newCategoryTabProductIds]);

  const resetCreateCategoryDialog = () => {
    setNewCategoryTabName("");
    setNewCategoryTabSearch("");
    setNewCategoryTabProductIds([]);
    setCategoryActionError("");
  };

  const openCreateCategoryDialog = () => {
    resetCreateCategoryDialog();
    setShowCreateCategoryDialog(true);
  };

  const requestCreateCategoryDialog = () => {
    if (!isEditMode || user?.role !== "admin") return;
    openCreateCategoryDialog();
  };

  const requestEditMode = () => {
    setEditModeAdminPin("");
    setEditModePinError("");
    setShowEditModePinDialog(true);
  };

  const verifyEditModeAdminPin = async () => {
    if (editModeAdminPin.length !== 5) {
      setEditModePinError("Admin PIN must be 5 digits");
      return;
    }

    setIsVerifyingEditModePin(true);
    setEditModePinError("");
    try {
      const res = await fetch("/api/workers/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: editModeAdminPin }),
      });

      if (!res.ok) {
        setEditModePinError("Invalid admin PIN");
        return;
      }

      const data = await res.json();
      const role = String(data?.worker?.role || "").trim().toLowerCase();
      if (role !== "admin") {
        setEditModePinError("Admin PIN required");
        return;
      }

      setShowEditModePinDialog(false);
      setEditModeAdminPin("");
      setEditModePinError("");
      enterEditMode();
    } catch {
      setEditModePinError("Failed to verify admin PIN");
    } finally {
      setIsVerifyingEditModePin(false);
    }
  };

  const toggleNewCategoryProductSelection = (productId: number) => {
    setNewCategoryTabProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
    setCategoryActionError("");
  };

  const handleCreateCategoryFromTab = async () => {
    const rawNewName = newCategoryTabName.trim();
    if (!rawNewName) {
      setCategoryActionError("Enter a category name");
      return;
    }

    if (selectedNewCategoryProducts.length === 0) {
      setCategoryActionError("Select at least 1 item for this category");
      return;
    }

    const normalizedNewName = normalizeStoredProductCategoryName(
      rawNewName,
      orderedCategoryOptions,
    );
    const newName = normalizedNewName || rawNewName;
    if (!normalizedNewName) {
      setCategoryActionError(`"${rawNewName}" is reserved and cannot be created`);
      return;
    }
    if (
      orderedCategoryOptions.some(
        (categoryName) =>
          categoryName.toLowerCase() === newName.toLowerCase(),
      )
    ) {
      setCategoryActionError("Category already exists");
      return;
    }

    const selectedProducts = selectedNewCategoryProducts;
    setIsCreatingCategoryFromTab(true);
    setCategoryActionError("");
    setPendingProductCategoryChanges((current) => {
      const next = { ...current };
      selectedProducts.forEach((product) => {
        next[product.id] = newName;
      });
      return next;
    });

    try {
      await updateSharedCategorySettings({
        customCategories: [...customCategories, newName],
        inventoryDisplayOrder: [...orderedCategoryOptions, newName],
        orderDisplayOrder: [
          ...sharedCategorySettings.orderDisplayOrder,
          newName,
        ],
      });

      updateDraftCategoryDisplayOrder((draftCategories) => [
        ...draftCategories,
        newName,
      ]);

      await Promise.all(
        selectedProducts.map((product) =>
          apiRequest("PUT", `/api/products/${product.id}`, {
            category: newName,
          }),
        ),
      );
      await queryClient.invalidateQueries({ queryKey: ["/api/products"] });

      setSelectedCategory(getCategoryTabId(newName));
      setShowCreateCategoryDialog(false);
      resetCreateCategoryDialog();
      toast({
        title: "Category Created",
        description: `${newName} created with ${selectedProducts.length} item${selectedProducts.length === 1 ? "" : "s"}.`,
      });
    } catch {
      setCategoryActionError("Failed to create category");
    } finally {
      setIsCreatingCategoryFromTab(false);
      setPendingProductCategoryChanges((current) => {
        const next = { ...current };
        selectedProducts.forEach((product) => {
          delete next[product.id];
        });
        return next;
      });
    }
  };

  const closeCategoryTabMenu = () => {
    setCategoryTabMenu(null);
    setCategoryTabMenuMode("menu");
    setCategoryTabRenameValue("");
    setCategoryActionError("");
  };

  const openCategoryTabMenu = (
    categoryName: string,
    clientX: number,
    clientY: number,
  ) => {
    const trimmedCategoryName = categoryName.trim();
    if (
      !isEditMode ||
      user?.role !== "admin" ||
      !trimmedCategoryName ||
      isHardcodedCategoryName(trimmedCategoryName)
    ) {
      return;
    }

    const viewportWidth =
      typeof window === "undefined" ? 320 : window.innerWidth;
    const viewportHeight =
      typeof window === "undefined" ? 480 : window.innerHeight;
    const menuWidth = 256;
    const menuHeight = 220;
    const x = Math.min(
      Math.max(8, clientX),
      Math.max(8, viewportWidth - menuWidth - 8),
    );
    const y = Math.min(
      Math.max(8, clientY),
      Math.max(8, viewportHeight - menuHeight - 8),
    );

    setCategoryTabMenu({ categoryName: trimmedCategoryName, x, y });
    setCategoryTabMenuMode("menu");
    setCategoryTabRenameValue(trimmedCategoryName);
    setCategoryActionError("");
  };

  const clearCategoryTabLongPress = () => {
    if (categoryTabLongPressTimerRef.current) {
      clearTimeout(categoryTabLongPressTimerRef.current);
      categoryTabLongPressTimerRef.current = null;
    }
  };

  const startCategoryTabLongPress = (
    event: React.TouchEvent<HTMLButtonElement>,
    categoryName: string,
  ) => {
    const touch = event.touches[0];
    if (!touch) return;

    clearCategoryTabLongPress();
    categoryTabLongPressTriggeredRef.current = false;
    categoryTabLongPressTimerRef.current = setTimeout(() => {
      categoryTabLongPressTriggeredRef.current = true;
      openCategoryTabMenu(categoryName, touch.clientX, touch.clientY);
    }, 550);
  };

  const finishCategoryTabLongPress = (
    event: React.TouchEvent<HTMLButtonElement>,
  ) => {
    clearCategoryTabLongPress();
    if (categoryTabLongPressTriggeredRef.current) {
      event.preventDefault();
      event.stopPropagation();
      window.setTimeout(() => {
        categoryTabLongPressTriggeredRef.current = false;
      }, 0);
    }
  };

  const renameCategory = async (
    fromCategoryInput: string,
    rawToCategoryInput: string,
  ) => {
    const fromCategory = fromCategoryInput.trim();
    const rawToCategory = rawToCategoryInput.trim();
    const normalizedToCategory = normalizeStoredProductCategoryName(
      rawToCategory,
      orderedCategoryOptions,
    );
    const toCategory = normalizedToCategory || rawToCategory;
    if (!fromCategory || !toCategory) {
      setCategoryActionError("Select a source and target category name");
      return;
    }
    if (isHardcodedCategoryName(fromCategory)) {
      setCategoryActionError(
        `"${fromCategory}" is hardcoded and cannot be renamed`,
      );
      return;
    }
    if (!normalizedToCategory) {
      setCategoryActionError(
        `"${rawToCategory}" is reserved and cannot be used as a category name`,
      );
      return;
    }
    if (fromCategory.toLowerCase() === toCategory.toLowerCase()) {
      setCategoryActionError("New category name must be different");
      return;
    }

    const normalizedFromCategory =
      normalizeStoredProductCategoryName(fromCategory, orderedCategoryOptions) ||
      fromCategory;
    const productsToMove = (allProducts || []).filter(
      (p) =>
        (
          normalizeStoredProductCategoryName(p.category, orderedCategoryOptions) ||
          ""
        ).toLowerCase() === normalizedFromCategory.toLowerCase(),
    );
    if (productsToMove.length === 0) {
      setCategoryActionError(`No products found in "${fromCategory}"`);
      return;
    }

    setIsCategoryActionLoading(true);
    setCategoryActionError("");
    try {
      for (const product of productsToMove) {
        await apiRequest("PUT", `/api/products/${product.id}`, {
          category: toCategory,
        });
      }

      const nextCustom = customCategories
        .map((name) =>
          name.toLowerCase() === fromCategory.toLowerCase() ? toCategory : name,
        )
        .filter(
          (name, idx, arr) =>
            arr.findIndex((v) => v.toLowerCase() === name.toLowerCase()) ===
            idx,
        );
      const nextDisplayOrder = categoryDisplayOrder
        .map((name) =>
          name.toLowerCase() === fromCategory.toLowerCase() ? toCategory : name,
        )
        .filter(
          (name, idx, arr) =>
            arr.findIndex((v) => v.toLowerCase() === name.toLowerCase()) ===
            idx,
        );
      const nextBaseCategories = baseCategoryDefaults
        .map((name) =>
          name.toLowerCase() === fromCategory.toLowerCase() ? toCategory : name,
        )
        .filter(
          (name, idx, arr) =>
            arr.findIndex((v) => v.toLowerCase() === name.toLowerCase()) ===
            idx,
        );
      const nextOrderDisplay = sharedCategorySettings.orderDisplayOrder
        .map((name) =>
          name.toLowerCase() === fromCategory.toLowerCase() ? toCategory : name,
        )
        .filter(
          (name, idx, arr) =>
            arr.findIndex((v) => v.toLowerCase() === name.toLowerCase()) ===
            idx,
        );

      await updateSharedCategorySettings({
        customCategories: nextCustom,
        inventoryDisplayOrder: nextDisplayOrder,
        baseCategories: nextBaseCategories,
        orderDisplayOrder: nextOrderDisplay,
      });

      updateDraftCategoryDisplayOrder((draftCategories) =>
        draftCategories.map((categoryName) =>
          categoryName.toLowerCase() === fromCategory.toLowerCase()
            ? toCategory
            : categoryName,
        ),
      );
      replacePendingCategoryTarget(fromCategory, toCategory);
      if (newProductCategory.toLowerCase() === fromCategory.toLowerCase()) {
        setNewProductCategory(toCategory);
      }
      if (selectedCategory === getCategoryTabId(fromCategory)) {
        setSelectedCategory(getCategoryTabId(toCategory));
      }
      closeCategoryTabMenu();
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "Category Renamed",
        description: `"${fromCategory}" was renamed to "${toCategory}" across inventory products.`,
      });
    } catch {
      setCategoryActionError("Failed to rename category");
    } finally {
      setIsCategoryActionLoading(false);
    }
  };

  // Define tab categories for the UI
  const tabCategories = useMemo<ProductCategoryTab[]>(() => {
    const seenTabIds = new Set<string>();
    const dynamicTabs: ProductCategoryTab[] = [];

    effectiveCategoryDisplayOrder.forEach((categoryName) => {
      const normalizedCategory = categoryName;
      if (isHardcodedCategoryName(normalizedCategory)) return;
      const tabId = getCategoryTabId(normalizedCategory);
      if (seenTabIds.has(tabId)) return;
      seenTabIds.add(tabId);
      dynamicTabs.push({
        id: tabId,
        label: getProductCategoryDisplayName(normalizedCategory),
        dbCategories: [normalizedCategory],
        targetCategory: normalizedCategory,
      });
    });

    return [
      {
        id: "all",
        label: allItemsCategoryName,
      },
      {
        id: UNCATEGORIZED_CATEGORY_TAB_ID,
        label: uncategorizedCategoryName,
        dbCategories: [uncategorizedCategoryName],
        targetCategory: uncategorizedCategoryName,
      },
      { id: "favorites", label: favoritesCategoryName, isFavorites: true },
      ...dynamicTabs,
    ];
  }, [
    allItemsCategoryName,
    effectiveCategoryDisplayOrder,
    favoritesCategoryName,
    uncategorizedCategoryName,
  ]);

  const tabIdToCategory = useMemo(() => {
    const map: Record<string, string> = {};
    tabCategories.forEach((tab) => {
      if (tab.targetCategory) {
        map[tab.id] = tab.targetCategory;
      }
    });
    return map;
  }, [tabCategories]);

  const activeSelectedCategory = useMemo(
    () =>
      tabCategories.some((tab) => tab.id === selectedCategory)
        ? selectedCategory
        : "favorites",
    [selectedCategory, tabCategories],
  );

  useEffect(() => {
    if (selectedCategory !== activeSelectedCategory) {
      setSelectedCategory(activeSelectedCategory);
    }
  }, [activeSelectedCategory, selectedCategory]);

  const groupedProducts = useMemo(() => {
    if (!products) return {};
    const groups: Record<string, typeof products> = {};
    const categoryOrder = [
      uncategorizedCategoryName,
      ...effectiveCategoryDisplayOrder,
    ];

    products.forEach((product) => {
      const category = getDisplayCategoryName(
        getEffectiveProductCategory(product),
      );
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(product);
    });

    const sortedGroups: Record<string, typeof products> = {};
    categoryOrder.forEach((cat) => {
      if (groups[cat]) {
        sortedGroups[cat] = groups[cat];
      }
    });
    Object.keys(groups).forEach((cat) => {
      if (!sortedGroups[cat]) {
        sortedGroups[cat] = groups[cat];
      }
    });

    return sortedGroups;
  }, [
    effectiveCategoryDisplayOrder,
    pendingProductCategoryChanges,
    products,
    uncategorizedCategoryName,
  ]);

  // Filter products by selected tab
  const filteredGroupedProducts = useMemo(() => {
    const selectedTab = tabCategories.find(
      (t) => t.id === activeSelectedCategory,
    );
    if (!selectedTab) return groupedProducts;

    // Handle favorites tab
    if (selectedTab.isFavorites) {
      const favoriteProducts = allProducts?.filter((p) => p.starred) || [];
      if (favoriteProducts.length === 0) return {};

      // Group favorites by their original category
      const grouped: Record<string, typeof products> = {};
      favoriteProducts.forEach((product) => {
        const cat = getDisplayCategoryName(
          getEffectiveProductCategory(product),
        );
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat]!.push(product);
      });
      return grouped;
    }

    const tabDbCategories = selectedTab.dbCategories;
    if (!tabDbCategories) return groupedProducts;

    const filtered: Record<string, typeof products> = {};
    Object.entries(groupedProducts).forEach(([cat, prods]) => {
      const matchesTab = tabDbCategories.some((dbCat) => cat === dbCat);
      if (matchesTab) {
        filtered[cat] = prods;
      }
    });
    return filtered;
  }, [
    activeSelectedCategory,
    allProducts,
    groupedProducts,
    pendingProductCategoryChanges,
    tabCategories,
  ]);

  const { data: clientBalance } = useQuery<{
    totalDue: string;
    billCount: number;
    latestBillDate: string | null;
  }>({
    queryKey: ["/api/clients", selectedClientId, "unpaid-balance"],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/clients/${selectedClientId}/unpaid-balance`,
        { signal },
      );
      return res.json();
    },
    enabled: !!selectedClientId,
  });

  const todaysOrders = useMemo(() => {
    if (!allOrders) return [];
    const today = format(new Date(), "yyyy-MM-dd");
    return allOrders.filter((order) => {
      const orderDate = order.entryDate
        ? format(new Date(order.entryDate), "yyyy-MM-dd")
        : null;
      return orderDate === today;
    });
  }, [allOrders]);

  const pendingWashing = todaysOrders.filter((o) => !o.washingDone);
  const pendingPacking = todaysOrders.filter(
    (o) => o.washingDone && !o.packingDone,
  );
  const pendingDelivery = todaysOrders.filter(
    (o) => o.packingDone && !o.delivered,
  );

  const handleEditImage = (productId: number, currentUrl: string | null) => {
    setEditingImageId(productId);
    setImageUrl(currentUrl || "");
  };

  const handleSaveImage = (productId: number) => {
    updateProduct.mutate(
      { id: productId, imageUrl },
      {
        onSuccess: () => {
          setEditingImageId(null);
          setImageUrl("");
        },
      },
    );
  };

  const handleCancelEdit = () => {
    setEditingImageId(null);
    setImageUrl("");
  };

  const handleEditStock = (productId: number, currentStock: number | null) => {
    setEditingStockId(productId);
    setStockValue(currentStock?.toString() || "0");
  };

  const handleSaveStock = (productId: number) => {
    const newStock = parseInt(stockValue) || 0;
    updateProduct.mutate(
      { id: productId, stockQuantity: newStock },
      {
        onSuccess: () => {
          setEditingStockId(null);
          setStockValue("");
          toast({
            title: "Stock updated",
            description: `Stock quantity updated to ${newStock}`,
          });
        },
        onError: (error: any) => {
          let message = "Failed to update stock";
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
      },
    );
  };

  const handleCancelStockEdit = () => {
    setEditingStockId(null);
    setStockValue("");
  };

  // Handle quantity change - simple add/remove from total quantity
  const handleQuantityChange = (productId: number, delta: number) => {
    const product =
      allProducts?.find((p) => p.id === productId) ||
      products?.find((p) => p.id === productId);

    // Check if sqm-priced (carpet) - ALWAYS prompt for sqm on every add
    if (product?.isSqmPriced && delta > 0) {
      // Prevent rapid clicks from crashing - ignore if dialog is already processing
      if (sqmDialogProcessing.current || sqmDialog.open) {
        return;
      }
      sqmDialogProcessing.current = true;

      // Always show sqm dialog for carpet - allows multiple entries with different sqm
      setSqmDialog({
        open: true,
        productId,
        productName: product.name,
        sqmPrice: product.sqmPrice || product.price || "12.00",
      });
      setSqmInput("");

      // Reset processing flag after a short delay
      setTimeout(() => {
        sqmDialogProcessing.current = false;
      }, 300);
      return;
    }

    // If removing sqm-priced product, remove the last carpet entry
    if (product?.isSqmPriced && delta < 0) {
      const entriesForProduct = carpetEntries.filter(
        (e) => e.productId === productId,
      );
      if (entriesForProduct.length > 0) {
        // Remove the last entry for this product
        const lastEntry = entriesForProduct[entriesForProduct.length - 1];
        setCarpetEntries((prev) => prev.filter((e) => e.id !== lastEntry.id));
      }
      return;
    }

    const hangingDefaults = ["kandoora", "cover all", "ghutra"];
    if (delta > 0 && product && !packingTypes[productId]) {
      if (defaultBulkPackingType) {
        setPackingTypes((prev) => ({
          ...prev,
          [productId]: defaultBulkPackingType,
        }));
      } else {
        const nameLC = product.name.toLowerCase();
        if (hangingDefaults.some((h) => nameLC.includes(h))) {
          setPackingTypes((prev) => ({ ...prev, [productId]: "hanging" }));
        }
      }
    }

    if (delta > 0 && defaultBulkServiceType !== "normal") {
      const updateServiceQuantities =
        defaultBulkServiceType === "iron" ? setIronQuantities : setDcQuantities;
      updateServiceQuantities((prev) => ({
        ...prev,
        [productId]: (prev[productId] || 0) + delta,
      }));
    }

    setQuantities((prev) => {
      const current = prev[productId] || 0;
      const newQty = Math.max(0, current + delta);
      if (newQty === 0) {
        const { [productId]: _, ...rest } = prev;
        setDcQuantities((p) => {
          const { [productId]: __, ...r } = p;
          return r;
        });
        setIronQuantities((p) => {
          const { [productId]: __, ...r } = p;
          return r;
        });
        setUrgentQuantities((p) => {
          const { [productId]: __, ...r } = p;
          return r;
        });
        return rest;
      }
      // If reducing quantity, also reduce DC/Iron if needed
      if (delta < 0) {
        const dcQty = dcQuantities[productId] || 0;
        const ironQty = ironQuantities[productId] || 0;
        const totalSpecial = dcQty + ironQty;
        if (totalSpecial > newQty) {
          let excess = totalSpecial - newQty;
          if (ironQty > 0) {
            const reduceIron = Math.min(excess, ironQty);
            setIronQuantities((p) => ({
              ...p,
              [productId]: ironQty - reduceIron,
            }));
            excess -= reduceIron;
          }
          if (excess > 0 && dcQty > 0) {
            setDcQuantities((p) => ({ ...p, [productId]: dcQty - excess }));
          }
        }
        const currentUrgent = urgentQuantities[productId] || 0;
        if (currentUrgent > newQty) {
          setUrgentQuantities((p) => ({ ...p, [productId]: newQty }));
        }
      }
      return { ...prev, [productId]: newQty };
    });
  };

  // Handle SQM dialog confirmation
  const handleSqmConfirm = () => {
    const sqm = parseFloat(sqmInput);
    if (!sqm || sqm <= 0 || !sqmDialog.productId) {
      toast({
        title: "Please enter a valid square meter value",
        variant: "destructive",
      });
      return;
    }

    // Add new carpet entry with unique ID
    const newEntry = {
      id: `carpet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      productId: sqmDialog.productId,
      sqm,
      serviceType: defaultBulkServiceType,
    };
    setCarpetEntries((prev) => [...prev, newEntry]);
    setSqmDialog({
      open: false,
      productId: null,
      productName: "",
      sqmPrice: "12.00",
    });
    setSqmInput("");
  };

  // Handle applying DC/Iron to a specific carpet entry
  const handleCarpetServiceSelect = (entryId: string) => {
    const serviceType = carpetServiceDialog.serviceType;
    setCarpetEntries((prev) =>
      prev.map((entry) => {
        if (entry.id === entryId) {
          // Toggle: if already this service, set to normal; otherwise set to service
          const newServiceType =
            entry.serviceType === serviceType ? "normal" : serviceType;
          return { ...entry, serviceType: newServiceType };
        }
        return entry;
      }),
    );
    setCarpetServiceDialog({
      open: false,
      productId: null,
      productName: "",
      serviceType: "dc",
    });
  };

  // Open dialog to set DC quantity
  const openServiceTypeDialog = (
    productId: number,
    productName: string,
    type: "dc" | "iron",
  ) => {
    const product = products?.find((p) => p.id === productId);

    // Carpet (sqm-priced) items have no DC/Iron option
    if (product?.isSqmPriced) return;

    // For sized items, check if items exist in order first
    if (product && hasSizeOption(product)) {
      const existingItems = customItems.filter((item) =>
        item.name.toLowerCase().startsWith(product.name.toLowerCase() + " ("),
      );

      const productData = {
        id: product.id,
        name: product.name,
        price: product.price || null,
        smallPrice: product.smallPrice || null,
        mediumPrice: product.mediumPrice || null,
        largePrice: product.largePrice || null,
        smallUrgentPrice: product.smallUrgentPrice || null,
        mediumUrgentPrice: product.mediumUrgentPrice || null,
        largeUrgentPrice: product.largeUrgentPrice || null,
        smallDryCleanPrice: product.smallDryCleanPrice || null,
        mediumDryCleanPrice: product.mediumDryCleanPrice || null,
        largeDryCleanPrice: product.largeDryCleanPrice || null,
        smallIronOnlyPrice: product.smallIronOnlyPrice || null,
        mediumIronOnlyPrice: product.mediumIronOnlyPrice || null,
        largeIronOnlyPrice: product.largeIronOnlyPrice || null,
        smallUrgentIronOnlyPrice: product.smallUrgentIronOnlyPrice || null,
        mediumUrgentIronOnlyPrice: product.mediumUrgentIronOnlyPrice || null,
        largeUrgentIronOnlyPrice: product.largeUrgentIronOnlyPrice || null,
        smallUrgentDryCleanPrice: product.smallUrgentDryCleanPrice || null,
        mediumUrgentDryCleanPrice: product.mediumUrgentDryCleanPrice || null,
        largeUrgentDryCleanPrice: product.largeUrgentDryCleanPrice || null,
      };

      if (existingItems.length > 0) {
        setSizedServicePickerProduct(productData);
        setSizedServicePickerType(type);
        setShowSizedServicePicker(true);
      } else {
        setSizeDialogProduct(productData);
        setSizeDialogServiceType(type);
        setShowSizeDialog(true);
      }
      return;
    }

    const totalQty = quantities[productId] || 0;
    if (totalQty === 0) return;

    const currentDc = dcQuantities[productId] || 0;
    const currentIron = ironQuantities[productId] || 0;
    const currentValue = type === "dc" ? currentDc : currentIron;

    setServiceTypeDialog({
      productId,
      productName,
      type,
      maxQty: totalQty,
    });
    setServiceTypeQty(currentValue.toString());
  };

  // Apply service type quantity from dialog
  const applyServiceTypeQty = () => {
    if (!serviceTypeDialog) return;

    const qty = parseInt(serviceTypeQty) || 0;
    const { productId, type, maxQty } = serviceTypeDialog;
    const otherQty =
      type === "dc"
        ? ironQuantities[productId] || 0
        : dcQuantities[productId] || 0;
    const clampedQty = Math.min(Math.max(0, qty), maxQty - otherQty);

    if (type === "dc") {
      setDcQuantities((prev) => ({ ...prev, [productId]: clampedQty }));
    } else {
      setIronQuantities((prev) => ({ ...prev, [productId]: clampedQty }));
    }

    setServiceTypeDialog(null);
    setServiceTypeQty("");
  };

  const openUrgentDialog = (productId: number, productName: string) => {
    const totalQty = quantities[productId] || 0;
    if (totalQty === 0) return;
    const currentUrgent = urgentQuantities[productId] || 0;
    setUrgentDialog({ productId, productName, maxQty: totalQty });
    setUrgentQtyInput(currentUrgent.toString());
  };

  const applyUrgentQty = () => {
    if (!urgentDialog) return;
    const qty = parseInt(urgentQtyInput) || 0;
    const { productId, maxQty } = urgentDialog;
    const clampedQty = Math.min(Math.max(0, qty), maxQty);
    setUrgentQuantities((prev) => ({ ...prev, [productId]: clampedQty }));
    setUrgentDialog(null);
    setUrgentQtyInput("");
  };

  // Get normal quantity (total - dc - iron)
  const getNormalQuantity = (productId: number): number => {
    const total = quantities[productId] || 0;
    const dc = dcQuantities[productId] || 0;
    const iron = ironQuantities[productId] || 0;
    return Math.max(0, total - dc - iron);
  };

  const renderProductServiceQuantitySummary = (
    product: Pick<Product, "id" | "isSqmPriced" | "sqmPrice" | "price">,
  ) => {
    if (product.isSqmPriced) {
      const sqmPrice = product.sqmPrice
        ? parseFloat(product.sqmPrice).toFixed(0)
        : product.price
          ? parseFloat(product.price).toFixed(0)
          : "12";

      return (
        <span className="text-[10px] font-black leading-none text-primary sm:text-xs">
          {sqmPrice}aed/sqm
        </span>
      );
    }

    const serviceQuantities = [
      {
        key: "normal",
        label: "N",
        quantity: getNormalQuantity(product.id),
        className: "text-blue-600 dark:text-blue-400",
      },
      {
        key: "dc",
        label: "DC",
        quantity: dcQuantities[product.id] || 0,
        className: "text-purple-600 dark:text-purple-400",
      },
      {
        key: "iron",
        label: "IO",
        quantity: ironQuantities[product.id] || 0,
        className: "text-orange-600 dark:text-orange-400",
      },
    ].filter((entry) => entry.quantity > 0);

    if (serviceQuantities.length === 0) {
      return (
        <span className="text-[10px] font-black leading-none text-primary sm:text-xs">
          {product.price ? parseFloat(product.price).toFixed(0) : "-"} AED
        </span>
      );
    }

    return serviceQuantities.map((entry) => (
      <span
        key={entry.key}
        className={`text-[10px] font-black leading-none sm:text-xs ${entry.className}`}
      >
        {entry.quantity}x {entry.label}
      </span>
    ));
  };

  const handleProductClick = (product: {
    id: number;
    name: string;
    price?: string | null;
    smallPrice?: string | null;
    mediumPrice?: string | null;
    largePrice?: string | null;
    smallUrgentPrice?: string | null;
    mediumUrgentPrice?: string | null;
    largeUrgentPrice?: string | null;
    smallDryCleanPrice?: string | null;
    mediumDryCleanPrice?: string | null;
    largeDryCleanPrice?: string | null;
    smallIronOnlyPrice?: string | null;
    mediumIronOnlyPrice?: string | null;
    largeIronOnlyPrice?: string | null;
    smallUrgentIronOnlyPrice?: string | null;
    mediumUrgentIronOnlyPrice?: string | null;
    largeUrgentIronOnlyPrice?: string | null;
    smallUrgentDryCleanPrice?: string | null;
    mediumUrgentDryCleanPrice?: string | null;
    largeUrgentDryCleanPrice?: string | null;
  }) => {
    if (hasSizeOption(product)) {
      setSizeDialogProduct({
        id: product.id,
        name: product.name,
        price: product.price || null,
        smallPrice: product.smallPrice || null,
        mediumPrice: product.mediumPrice || null,
        largePrice: product.largePrice || null,
        smallUrgentPrice: product.smallUrgentPrice || null,
        mediumUrgentPrice: product.mediumUrgentPrice || null,
        largeUrgentPrice: product.largeUrgentPrice || null,
        smallDryCleanPrice: product.smallDryCleanPrice || null,
        mediumDryCleanPrice: product.mediumDryCleanPrice || null,
        largeDryCleanPrice: product.largeDryCleanPrice || null,
        smallIronOnlyPrice: product.smallIronOnlyPrice || null,
        mediumIronOnlyPrice: product.mediumIronOnlyPrice || null,
        largeIronOnlyPrice: product.largeIronOnlyPrice || null,
        smallUrgentIronOnlyPrice: product.smallUrgentIronOnlyPrice || null,
        mediumUrgentIronOnlyPrice: product.mediumUrgentIronOnlyPrice || null,
        largeUrgentIronOnlyPrice: product.largeUrgentIronOnlyPrice || null,
        smallUrgentDryCleanPrice: product.smallUrgentDryCleanPrice || null,
        mediumUrgentDryCleanPrice: product.mediumUrgentDryCleanPrice || null,
        largeUrgentDryCleanPrice: product.largeUrgentDryCleanPrice || null,
      });
      setSizeDialogServiceType(defaultBulkServiceType);
      setShowSizeDialog(true);
    } else if (isGutraProduct(product.name)) {
      setGutraDialogProduct({
        id: product.id,
        name: product.name,
        price: parseFloat(product.price || "0"),
      });
      setGutraNisha("");
      setGutraStyle("");
      setShowGutraDialog(true);
    } else {
      handleQuantityChange(product.id, 1);
    }
  };

  const isDesktopProductInteractionMode = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 1024px) and (pointer: fine)").matches;

  const decrementCustomProductSelection = (productName: string) => {
    const productPrefix = `${productName.toLowerCase()} (`;
    setCustomItems((prev) => {
      let matchingIndex = -1;
      for (let index = prev.length - 1; index >= 0; index -= 1) {
        if (prev[index].name.toLowerCase().startsWith(productPrefix)) {
          matchingIndex = index;
          break;
        }
      }

      if (matchingIndex < 0) return prev;

      const item = prev[matchingIndex];
      if (item.quantity <= 1) {
        return prev.filter((_, index) => index !== matchingIndex);
      }

      return prev.map((currentItem, index) =>
        index === matchingIndex
          ? { ...currentItem, quantity: currentItem.quantity - 1 }
          : currentItem,
      );
    });
  };

  const handleProductDecrement = (product: Product) => {
    if (hasSizeOption(product) || isGutraProduct(product.name)) {
      decrementCustomProductSelection(product.name);
      return;
    }

    handleQuantityChange(product.id, -1);
  };

  const handleProductCardClick = (product: Product) => {
    if (isEditMode) return;

    if (isDesktopProductInteractionMode()) {
      handleProductClick(product);
      return;
    }

    handleProductClick(product);
  };

  const handleProductCardContextMenu = (
    event: React.MouseEvent<HTMLDivElement>,
    product: Product,
  ) => {
    if (isEditMode || !isDesktopProductInteractionMode()) return;

    event.preventDefault();
    event.stopPropagation();
    handleProductDecrement(product);
  };

  const handleAddGutraItem = () => {
    if (!gutraDialogProduct || !gutraNisha || !gutraStyle) {
      toast({
        title: "Select options",
        description: "Please select both Nisha and Line/Straight options.",
        variant: "destructive",
      });
      return;
    }

    const nishaLabel = gutraNisha === "nisha" ? "Nisha" : "Without Nisha";
    const styleLabel = gutraStyle === "line" ? "Line" : "Straight";
    const itemName = `${gutraDialogProduct.name} (${nishaLabel}, ${styleLabel})`;

    setCustomItems((prev) => {
      const existing = prev.find((item) => item.name === itemName);
      if (existing) {
        return prev.map((item) =>
          item.name === itemName
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [
        ...prev,
        {
          name: itemName,
          price: gutraDialogProduct.price,
          normalPrice: gutraDialogProduct.price,
          quantity: 1,
        },
      ];
    });

    setShowGutraDialog(false);
    setGutraDialogProduct(null);
    setGutraNisha("");
    setGutraStyle("");
    toast({ title: "Added", description: `${itemName} added to order.` });
  };

  const handleAddSizedItem = (size: "small" | "medium" | "large") => {
    if (!sizeDialogProduct) return;

    let price = 0;
    let urgentPrice = 0;
    let dcPrice = 0;
    let ironPrice = 0;
    let urgentIronPrice = 0;
    let urgentDcPrice = 0;
    if (size === "small") {
      price = parseFloat(sizeDialogProduct.smallPrice || "0");
      urgentPrice = parseFloat(
        sizeDialogProduct.smallUrgentPrice || String(price * 2),
      );
      dcPrice = parseFloat(
        sizeDialogProduct.smallDryCleanPrice || String(price * 2),
      );
      ironPrice = parseFloat(
        sizeDialogProduct.smallIronOnlyPrice || String(price / 2),
      );
      urgentIronPrice = parseFloat(
        sizeDialogProduct.smallUrgentIronOnlyPrice || "0",
      );
      urgentDcPrice = parseFloat(
        sizeDialogProduct.smallUrgentDryCleanPrice || "0",
      );
    } else if (size === "medium") {
      price = parseFloat(
        sizeDialogProduct.mediumPrice || sizeDialogProduct.price || "0",
      );
      urgentPrice = parseFloat(
        sizeDialogProduct.mediumUrgentPrice || String(price * 2),
      );
      dcPrice = parseFloat(
        sizeDialogProduct.mediumDryCleanPrice || String(price * 2),
      );
      ironPrice = parseFloat(
        sizeDialogProduct.mediumIronOnlyPrice || String(price / 2),
      );
      urgentIronPrice = parseFloat(
        sizeDialogProduct.mediumUrgentIronOnlyPrice || "0",
      );
      urgentDcPrice = parseFloat(
        sizeDialogProduct.mediumUrgentDryCleanPrice || "0",
      );
    } else if (size === "large") {
      price = parseFloat(sizeDialogProduct.largePrice || "0");
      urgentPrice = parseFloat(
        sizeDialogProduct.largeUrgentPrice || String(price * 2),
      );
      dcPrice = parseFloat(
        sizeDialogProduct.largeDryCleanPrice || String(price * 2),
      );
      ironPrice = parseFloat(
        sizeDialogProduct.largeIronOnlyPrice || String(price / 2),
      );
      urgentIronPrice = parseFloat(
        sizeDialogProduct.largeUrgentIronOnlyPrice || "0",
      );
      urgentDcPrice = parseFloat(
        sizeDialogProduct.largeUrgentDryCleanPrice || "0",
      );
    }

    const sizeLabel =
      size === "small" ? "Small" : size === "medium" ? "Medium" : "Large";
    const itemName = `${sizeDialogProduct.name} (${sizeLabel})`;

    setCustomItems((prev) => {
      const existing = prev.find((item) => item.name === itemName);
      if (existing) {
        return prev.map((item) =>
          item.name === itemName
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [
        ...prev,
        {
          name: itemName,
          price:
            sizeDialogServiceType === "dc"
              ? dcPrice || price
              : sizeDialogServiceType === "iron"
                ? ironPrice || price
                : price,
          normalPrice: price,
          quantity: 1,
          serviceType: sizeDialogServiceType as "normal" | "dc" | "iron",
          urgentPrice: urgentPrice || undefined,
          dryCleanPrice: dcPrice || undefined,
          ironOnlyPrice: ironPrice || undefined,
          urgentIronOnlyPrice: urgentIronPrice || undefined,
          urgentDryCleanPrice: urgentDcPrice || undefined,
        },
      ];
    });

    setShowSizeDialog(false);
    setSizeDialogProduct(null);
    setSizeDialogServiceType("normal");
    const serviceLabel =
      sizeDialogServiceType === "dc"
        ? " (Dry Clean)"
        : sizeDialogServiceType === "iron"
          ? " (Iron Only)"
          : "";
    toast({
      title: "Added",
      description: `${itemName}${serviceLabel} added to order.`,
    });
  };

  const handleConvertSizedItemService = (
    itemName: string,
    itemServiceType: string | undefined,
    convertQty: number,
  ) => {
    if (!sizedServicePickerProduct) return;
    const type = sizedServicePickerType;

    setCustomItems((prev) => {
      const itemIndex = prev.findIndex(
        (ci) =>
          ci.name === itemName &&
          (ci.serviceType || "normal") === (itemServiceType || "normal"),
      );
      if (itemIndex < 0) return prev;
      const item = prev[itemIndex];
      if (!item || convertQty <= 0) return prev;

      const clampedQty = Math.min(convertQty, item.quantity);
      const sizeName = item.name
        .match(/\((Small|Medium|Large)\)/)?.[1]
        ?.toLowerCase() as "small" | "medium" | "large" | undefined;
      if (!sizeName) return prev;

      let basePrice = 0;
      let dcPrice = 0;
      let ironPrice = 0;
      if (sizeName === "small") {
        basePrice = parseFloat(sizedServicePickerProduct.smallPrice || "0");
        dcPrice = parseFloat(
          sizedServicePickerProduct.smallDryCleanPrice || String(basePrice * 2),
        );
        ironPrice = parseFloat(
          sizedServicePickerProduct.smallIronOnlyPrice || String(basePrice / 2),
        );
      } else if (sizeName === "medium") {
        basePrice = parseFloat(
          sizedServicePickerProduct.mediumPrice ||
            sizedServicePickerProduct.price ||
            "0",
        );
        dcPrice = parseFloat(
          sizedServicePickerProduct.mediumDryCleanPrice ||
            String(basePrice * 2),
        );
        ironPrice = parseFloat(
          sizedServicePickerProduct.mediumIronOnlyPrice ||
            String(basePrice / 2),
        );
      } else if (sizeName === "large") {
        basePrice = parseFloat(sizedServicePickerProduct.largePrice || "0");
        dcPrice = parseFloat(
          sizedServicePickerProduct.largeDryCleanPrice || String(basePrice * 2),
        );
        ironPrice = parseFloat(
          sizedServicePickerProduct.largeIronOnlyPrice || String(basePrice / 2),
        );
      }

      const normalPrice = item.normalPrice ?? (basePrice || item.price);
      const servicePrice = type === "dc" ? dcPrice : ironPrice;
      const result = [...prev];

      const existingServiceItem = result.findIndex(
        (ci, i) =>
          i !== itemIndex &&
          ci.name === item.name &&
          ci.serviceType === type &&
          !ci.priceEdited,
      );

      if (clampedQty >= item.quantity) {
        if (existingServiceItem >= 0 && !item.priceEdited) {
          result[existingServiceItem] = {
            ...result[existingServiceItem],
            normalPrice: result[existingServiceItem].normalPrice ?? normalPrice,
            quantity: result[existingServiceItem].quantity + item.quantity,
          };
          result.splice(itemIndex, 1);
        } else {
          result[itemIndex] = {
            ...item,
            normalPrice,
            serviceType: type,
            price: item.priceEdited ? item.price : servicePrice,
            dryCleanPrice: dcPrice || undefined,
            ironOnlyPrice: ironPrice || undefined,
          };
        }
      } else {
        result[itemIndex] = { ...item, quantity: item.quantity - clampedQty };
        if (existingServiceItem >= 0 && !item.priceEdited) {
          result[existingServiceItem] = {
            ...result[existingServiceItem],
            normalPrice: result[existingServiceItem].normalPrice ?? normalPrice,
            quantity: result[existingServiceItem].quantity + clampedQty,
          };
        } else {
          result.push({
            ...item,
            quantity: clampedQty,
            normalPrice,
            serviceType: type,
            price: item.priceEdited ? item.price : servicePrice,
            priceEdited: item.priceEdited,
            dryCleanPrice: dcPrice || undefined,
            ironOnlyPrice: ironPrice || undefined,
          });
        }
      }

      return result;
    });

    const serviceLabel = type === "dc" ? "Dry Clean" : "Iron Only";
    toast({
      title: "Updated",
      description: `${convertQty} item(s) set to ${serviceLabel}.`,
    });
    setShowSizedServicePicker(false);
    setSizedServicePickerProduct(null);
  };

  // Build order items with service type splits (Normal, DC, Iron as separate lines)
  // Also splits by urgent quantity per product
  const orderItems = useMemo(() => {
    if (!allProducts) return [];
    const items: {
      product: (typeof allProducts)[0];
      quantity: number;
      serviceType: "normal" | "dc" | "iron";
      sqm?: number;
      isUrgent?: boolean;
    }[] = [];

    // First, add carpet entries (sqm-priced products) - group identical ones
    const carpetGroups = new Map<
      string,
      {
        product: (typeof allProducts)[0];
        count: number;
        serviceType: "normal" | "dc" | "iron";
        sqm: number;
      }
    >();
    carpetEntries.forEach((entry) => {
      const product = allProducts.find((p) => p.id === entry.productId);
      if (!product) return;
      const key = `${entry.productId}-${entry.sqm}-${entry.serviceType}`;
      const existing = carpetGroups.get(key);
      if (existing) {
        existing.count++;
      } else {
        carpetGroups.set(key, {
          product,
          count: 1,
          serviceType: entry.serviceType,
          sqm: entry.sqm,
        });
      }
    });
    carpetGroups.forEach(({ product, count, serviceType, sqm }) => {
      items.push({ product, quantity: count, serviceType, sqm });
    });

    // Then add regular quantity-based products (excluding sqm-priced ones)
    Object.entries(quantities).forEach(([productIdStr, totalQty]) => {
      const productId = parseInt(productIdStr);
      if (isNaN(productId) || totalQty <= 0) return;

      const product = allProducts.find((p) => p.id === productId);
      if (!product || product.isSqmPriced) return;

      const dcQty = dcQuantities[productId] || 0;
      const ironQty = ironQuantities[productId] || 0;
      const normalQty = Math.max(0, totalQty - dcQty - ironQty);
      const urgentQty = Math.min(urgentQuantities[productId] || 0, totalQty);

      // Distribute urgent qty: Iron Only first, then DC, then Normal
      let urgentRemaining = urgentQty;

      // Iron Only items (split into urgent and non-urgent)
      if (ironQty > 0) {
        const urgentIron = Math.min(urgentRemaining, ironQty);
        urgentRemaining -= urgentIron;
        if (urgentIron > 0) {
          items.push({
            product,
            quantity: urgentIron,
            serviceType: "iron",
            isUrgent: true,
          });
        }
        const nonUrgentIron = ironQty - urgentIron;
        if (nonUrgentIron > 0) {
          items.push({ product, quantity: nonUrgentIron, serviceType: "iron" });
        }
      }
      // DC items (split into urgent and non-urgent)
      if (dcQty > 0) {
        const urgentDc = Math.min(urgentRemaining, dcQty);
        urgentRemaining -= urgentDc;
        if (urgentDc > 0) {
          items.push({
            product,
            quantity: urgentDc,
            serviceType: "dc",
            isUrgent: true,
          });
        }
        const nonUrgentDc = dcQty - urgentDc;
        if (nonUrgentDc > 0) {
          items.push({ product, quantity: nonUrgentDc, serviceType: "dc" });
        }
      }
      // Normal items (split into urgent and non-urgent)
      if (normalQty > 0) {
        const urgentNormal = Math.min(urgentRemaining, normalQty);
        urgentRemaining -= urgentNormal;
        if (urgentNormal > 0) {
          items.push({
            product,
            quantity: urgentNormal,
            serviceType: "normal",
            isUrgent: true,
          });
        }
        const nonUrgentNormal = normalQty - urgentNormal;
        if (nonUrgentNormal > 0) {
          items.push({
            product,
            quantity: nonUrgentNormal,
            serviceType: "normal",
          });
        }
      }
    });

    return items;
  }, [
    quantities,
    dcQuantities,
    ironQuantities,
    urgentQuantities,
    allProducts,
    carpetEntries,
  ]);

  const orderTotal = useMemo(() => {
    const globalUrgent = orderType === "urgent";
    const productTotal = orderItems.reduce((sum, item, idx) => {
      let price: number;
      const isUrgent = globalUrgent || !!item.isUrgent;

      if (item.product.isSqmPriced && item.sqm) {
        const carpetKey = `carpet-${idx}`;
        if (customPrices[carpetKey] !== undefined) {
          return sum + customPrices[carpetKey] * item.quantity;
        }
        const sqmPrice = parseFloat(
          item.product.sqmPrice || item.product.price || "12",
        );
        const calcPrice = item.sqm * sqmPrice;
        const unitCarpetPrice =
          item.sqm < 5 ? Math.max(50, calcPrice) : calcPrice;
        return sum + unitCarpetPrice * item.quantity;
      }

      const priceKey = `${item.product.id}-${item.serviceType}-${isUrgent ? "urgent" : "normal"}`;
      if (customPrices[priceKey] !== undefined) {
        price = customPrices[priceKey];
      } else if (item.serviceType === "iron") {
        if (isUrgent) {
          price = parseFloat(
            item.product.urgentIronOnlyPrice ||
              String(
                parseFloat(
                  item.product.ironOnlyPrice || item.product.price || "0",
                ) * 2,
              ),
          );
        } else {
          price = parseFloat(
            item.product.ironOnlyPrice || item.product.price || "0",
          );
        }
      } else if (item.serviceType === "dc") {
        if (isUrgent) {
          price = parseFloat(
            item.product.urgentDryCleanPrice ||
              String(
                parseFloat(
                  item.product.dryCleanPrice || item.product.price || "0",
                ) * 2,
              ),
          );
        } else {
          price = parseFloat(
            item.product.dryCleanPrice || item.product.price || "0",
          );
        }
      } else {
        const normalPrice = parseFloat(item.product.price || "0");
        if (isUrgent) {
          price = parseFloat(
            item.product.urgentPrice || String(normalPrice * 2),
          );
        } else {
          price = normalPrice;
        }
      }
      return sum + price * item.quantity;
    }, 0);
    const customTotal = customItems.reduce((sum, item) => {
      if (item.priceEdited) {
        return sum + item.price * item.quantity;
      }
      const isUrgent = orderType === "urgent" || !!item.isUrgent;
      let itemPrice = item.price;
      if (item.serviceType === "iron") {
        const ioPrice = item.ironOnlyPrice || item.price;
        itemPrice = isUrgent
          ? item.urgentIronOnlyPrice || ioPrice * 2
          : ioPrice;
      } else if (item.serviceType === "dc") {
        const dcPrice = item.dryCleanPrice || item.price;
        itemPrice = isUrgent
          ? item.urgentDryCleanPrice || dcPrice * 2
          : dcPrice;
      } else {
        if (isUrgent) {
          itemPrice = item.urgentPrice || item.price * 2;
        }
      }
      return sum + itemPrice * item.quantity;
    }, 0);
    return productTotal + customTotal;
  }, [orderItems, customItems, customPrices, orderType]);

  const hasOrderItems =
    orderItems.length > 0 || customItems.length > 0 || carpetEntries.length > 0;
  const discountPercentValue = Math.max(
    0,
    parseFloat(discountPercent) || 0,
  );
  const clientDiscountAmount = Math.min(
    orderTotal,
    (orderTotal * discountPercentValue) / 100,
  );
  const maxFlatDiscountAmount = Math.max(0, orderTotal - clientDiscountAmount);
  const enteredFlatDiscountAmount = Math.max(
    0,
    parseFloat(discountAmount) || 0,
  );
  const appliedFlatDiscountAmount = applyDiscount
    ? Math.min(enteredFlatDiscountAmount, maxFlatDiscountAmount)
    : 0;
  const totalDiscountAmount = clientDiscountAmount + appliedFlatDiscountAmount;
  const tipsAmount = parseFloat(tips) || 0;
  const deliveryChargeAmount = applyDeliveryCharge
    ? Math.max(0, parseFloat(deliveryCharge) || 0)
    : 0;
  const currentOrderFinalTotal =
    Math.max(0, orderTotal - totalDiscountAmount) + tipsAmount + deliveryChargeAmount;

  useEffect(() => {
    if (!applyDiscount || !discountAmount) return;

    const currentDiscountAmount = parseFloat(discountAmount);
    if (!Number.isFinite(currentDiscountAmount)) return;

    const clampedDiscountAmount = Math.min(
      Math.max(0, currentDiscountAmount),
      maxFlatDiscountAmount,
    );

    if (clampedDiscountAmount !== currentDiscountAmount) {
      setDiscountAmount(formatCompactAmount(clampedDiscountAmount));
    }
  }, [applyDiscount, discountAmount, maxFlatDiscountAmount]);

  const selectedNonSqmProductIds = useMemo(() => {
    if (!allProducts) return [];

    const nonSqmProductIds = new Set(
      allProducts
        .filter((product) => !product.isSqmPriced)
        .map((product) => product.id),
    );

    return Object.entries(quantities)
      .map(([productId, qty]) => [parseInt(productId), qty] as const)
      .filter(
        ([productId, qty]) =>
          !isNaN(productId) && qty > 0 && nonSqmProductIds.has(productId),
      )
      .map(([productId]) => productId);
  }, [allProducts, quantities]);

  const selectedPackingProductIds = useMemo(
    () =>
      Object.entries(quantities)
        .map(([productId, qty]) => [parseInt(productId), qty] as const)
        .filter(([productId, qty]) => !isNaN(productId) && qty > 0)
        .map(([productId]) => productId),
    [quantities],
  );

  const hasBulkServiceTargets =
    selectedNonSqmProductIds.length > 0 ||
    customItems.length > 0 ||
    carpetEntries.length > 0;

  const isIronOnlyAllSelected = useMemo(() => {
    if (!hasBulkServiceTargets) return false;

    const allProductsIron = selectedNonSqmProductIds.every(
      (productId) =>
        (ironQuantities[productId] || 0) === (quantities[productId] || 0),
    );
    const allCustomItemsIron = customItems.every(
      (item) => (item.serviceType || "normal") === "iron",
    );
    const allCarpetItemsIron = carpetEntries.every(
      (entry) => entry.serviceType === "iron",
    );

    return allProductsIron && allCustomItemsIron && allCarpetItemsIron;
  }, [
    carpetEntries,
    customItems,
    hasBulkServiceTargets,
    ironQuantities,
    quantities,
    selectedNonSqmProductIds,
  ]);

  const isDryCleanAllSelected = useMemo(() => {
    if (!hasBulkServiceTargets) return defaultBulkServiceType === "dc";

    const allProductsDryClean = selectedNonSqmProductIds.every(
      (productId) =>
        (dcQuantities[productId] || 0) === (quantities[productId] || 0),
    );
    const allCustomItemsDryClean = customItems.every(
      (item) => (item.serviceType || "normal") === "dc",
    );
    const allCarpetItemsDryClean = carpetEntries.every(
      (entry) => entry.serviceType === "dc",
    );

    return (
      allProductsDryClean &&
      allCustomItemsDryClean &&
      allCarpetItemsDryClean
    );
  }, [
    carpetEntries,
    customItems,
    dcQuantities,
    defaultBulkServiceType,
    hasBulkServiceTargets,
    quantities,
    selectedNonSqmProductIds,
  ]);

  const getCustomItemNormalPrice = (item: (typeof customItems)[number]) => {
    if (
      typeof item.normalPrice === "number" &&
      Number.isFinite(item.normalPrice)
    ) {
      return item.normalPrice;
    }

    if (!item.serviceType || item.serviceType === "normal") {
      return item.price;
    }

    if (item.serviceType === "iron") {
      if (
        typeof item.ironOnlyPrice === "number" &&
        item.ironOnlyPrice > 0 &&
        item.price === item.ironOnlyPrice
      ) {
        if (typeof item.dryCleanPrice === "number" && item.dryCleanPrice > 0) {
          return item.dryCleanPrice / 2;
        }

        return item.price * 2;
      }

      return item.price;
    }

    if (
      typeof item.dryCleanPrice === "number" &&
      item.dryCleanPrice > 0 &&
      item.price === item.dryCleanPrice
    ) {
      if (typeof item.ironOnlyPrice === "number" && item.ironOnlyPrice > 0) {
        return item.ironOnlyPrice * 2;
      }

      return item.price / 2;
    }

    return item.price;
  };

  const resetCustomItemsToNormal = (items: typeof customItems) =>
    items.map((item) => {
      const normalPrice = getCustomItemNormalPrice(item);
      return {
        ...item,
        normalPrice,
        serviceType: "normal" as const,
        price: item.priceEdited ? item.price : normalPrice,
      };
    });

  const applyBulkServiceTypeToCustomItems = (
    items: typeof customItems,
    serviceType: "dc" | "iron",
  ) =>
    items.map((item) => {
      const normalPrice = getCustomItemNormalPrice(item);
      const servicePrice =
        serviceType === "iron"
          ? item.ironOnlyPrice || normalPrice / 2
          : item.dryCleanPrice || normalPrice * 2;

      return {
        ...item,
        normalPrice,
        serviceType,
        price: item.priceEdited ? item.price : servicePrice,
      };
    });

  const clearSelectedProductIdsFromServiceQuantities = (
    values: Record<number, number>,
  ) => {
    const nextValues = { ...values };
    selectedNonSqmProductIds.forEach((productId) => {
      delete nextValues[productId];
    });
    return nextValues;
  };

  const isFoldAllSelected = useMemo(() => {
    if (selectedPackingProductIds.length === 0) {
      return defaultBulkPackingType === "folding";
    }

    return selectedPackingProductIds.every(
      (productId) => (packingTypes[productId] || "folding") === "folding",
    );
  }, [defaultBulkPackingType, packingTypes, selectedPackingProductIds]);

  const isHangAllSelected = useMemo(() => {
    if (selectedPackingProductIds.length === 0) {
      return defaultBulkPackingType === "hanging";
    }

    return selectedPackingProductIds.every(
      (productId) => (packingTypes[productId] || "folding") === "hanging",
    );
  }, [defaultBulkPackingType, packingTypes, selectedPackingProductIds]);

  const getBulkToggleButtonClassName = (
    isSelected: boolean,
    selectedClassName: string,
    unselectedClassName: string,
  ) =>
    cn(
      "flex-1 h-7 border px-2 text-[11px]",
      isSelected
        ? selectedClassName
        : `bg-white dark:bg-black ${unselectedClassName}`,
    );

  // Detect if a manual client phone matches an existing client
  const clientMatch = useMemo(() => {
    if (!isManualClientEntry || !isPlausiblePhoneNumber(walkInPhone))
      return null;

    const normalizedWalkIn = normalizePhoneForComparison(walkInPhone);
    if (normalizedWalkIn.length < 8) return null;

    const matchingClient = clients?.find((client) => {
      if (!client.phone) return false;
      const normalizedClient = normalizePhoneForComparison(client.phone);
      if (normalizedClient.length < 8) return false;
      return normalizedClient === normalizedWalkIn;
    });

    if (matchingClient) {
      return {
        client: matchingClient,
        message: "Customer already exists with this phone number",
      };
    }
    return null;
  }, [clients, isManualClientEntry, walkInPhone]);

  const createOrderMutation = useMutation({
    mutationFn: async (orderData: any) => {
      const response = await apiRequest("POST", "/api/orders", orderData);
      return response.json();
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] }); // Refresh clients for walk-in auto-created clients
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] }); // Refresh bills for auto-created bills
      queryClient.invalidateQueries({
        queryKey: ["/api/products/allocated-stock"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] }); // Refresh products to show updated stock
      setQuantities({});
      setDcQuantities({});
      setIronQuantities({});
      setCustomerName("");
      setSearchTerm("");
      setBrokerOnlyClientFilter(false);
      setCompanyOnlyClientFilter(false);

      if (payNowAfterOrder) {
        const linkedBillId = Number(data.billId);
        const verifiedStaff = pendingPayNowStaffRef.current;
        setPayNowAfterOrder(false);
        clearOrder();
        pendingPayNowStaffRef.current = null;

        if (!Number.isFinite(linkedBillId) || linkedBillId <= 0) {
          setPayNowBillId(null);
          setPayNowBill(null);
          setPayNowVerifiedStaff(null);
          toast({
            title: "Bill Not Found",
            description: "The order was created, but no linked bill was available for payment.",
            variant: "destructive",
          });
          return;
        }

        setPayNowBillId(linkedBillId);
        setPayNowVerifiedStaff(verifiedStaff);
        setPayNowBill(null);

        try {
          const billResponse = await apiRequest("GET", `/api/bills/${linkedBillId}`);
          const createdBill = (await billResponse.json()) as Bill;
          setPayNowBill(createdBill);
        } catch {
          toast({
            title: "Opening Payment",
            description: "The order was created. Loading the payment dialog from the bill list.",
          });
        }
        return;
      }

      // Store the created order and show print tag dialog
      setCreatedOrder(data);
      setShowPrintTagDialog(true);
    },
    onError: (error: any) => {
      setPayNowAfterOrder(false);
      pendingPayNowStaffRef.current = null;
      let cleanMessage = "Failed to create order";
      let isCustomerExists = false;
      let isBillingRights = false;

      try {
        const errorMsg = String(error.message || error || "");

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

        isCustomerExists =
          cleanMessage
            .toLowerCase()
            .includes("customer details already exist") ||
          cleanMessage.toLowerCase().includes("customer already exists");
        isBillingRights =
          cleanMessage.toLowerCase().includes("billing rights") ||
          cleanMessage.toLowerCase().includes("admin pin");
      } catch (err) {
        // Keep default message
      }

      toast({
        title: isBillingRights
          ? "PIN Not Authorized"
          : isCustomerExists
            ? "Customer Already Exists"
            : "Error",
        description: cleanMessage,
        variant: "destructive",
      });
    },
  });

  const handleCreateOrder = (options?: { payNow?: boolean }) => {
    if (!selectedClientId && !isManualClientEntry) {
      toast({
        title: "Select a client",
        description: "Please select a client from the dropdown.",
        variant: "destructive",
      });
      return;
    }
    if (deliveryType === "delivery" && !canChooseDelivery) {
      toast({
        title: isBrokerOrder ? "Select broker address" : "Address required",
        description:
          isBrokerOrder
            ? "Choose or add the delivery address for this broker order."
            : "Add an address before choosing delivery for this order.",
        variant: "destructive",
      });
      return;
    }
    if (isManualClientEntry) {
      const hasName = walkInName.trim().length > 0;
      const hasPhone = hasPhoneDigits(walkInPhone);
      const hasAddress = isManualBrokerEntry
        ? brokerDeliveryAddress.trim().length > 0
        : walkInAddress.trim().length > 0;
      const filledFields = [hasName, hasPhone, hasAddress].filter(
        Boolean,
      ).length;

      if (hasPhone && !isPlausiblePhoneNumber(walkInPhone)) {
        toast({
          title: "Invalid phone",
          description:
            "Choose the correct country code and finish the full phone number.",
          variant: "destructive",
        });
        return;
      }

      if (filledFields < 1) {
        toast({
          title: "More details needed",
          description: "Please fill at least 1 field: name, phone, or address.",
          variant: "destructive",
        });
        return;
      }
    }
    if (!hasOrderItems) {
      toast({
        title: "No items",
        description: "Please add items to the order.",
        variant: "destructive",
      });
      return;
    }
    setPayNowAfterOrder(options?.payNow === true);
    setPendingUrgent(orderType === "urgent");
    setShowPinDialog(true);
    setStaffPin("");
    setPinError("");
  };

  const triggerPlaceOrderButtonAction = useCallback(
    (options?: { closePopup?: boolean }) => {
      if (
        createOrderMutation.isPending ||
        (!selectedClientId && !isManualClientEntry)
      ) {
        return;
      }

      if (options?.closePopup) setShowCartPopup(false);

      if (clientMatch) {
        handleUseExistingClient(clientMatch.client);
        toast({
          title: "Existing client selected",
          description: `Using ${clientMatch.client.name} because this phone number already exists.`,
        });
        return;
      }

      setPayNowAfterOrder(false);
      handleCreateOrder();
    },
    [
      clientMatch,
      createOrderMutation.isPending,
      handleCreateOrder,
      handleUseExistingClient,
      isManualClientEntry,
      selectedClientId,
      toast,
    ],
  );

  useEffect(() => {
    const resetRightShiftShortcut = () => {
      rightShiftPlaceOrderRef.current = false;
    };

    const handleShortcutKeyDown = (event: KeyboardEvent) => {
      if (event.code === "ShiftRight") {
        rightShiftPlaceOrderRef.current = true;
        return;
      }

      const isEnterKey = event.code === "Enter" || event.code === "NumpadEnter";
      if (
        !isEnterKey ||
        !rightShiftPlaceOrderRef.current ||
        event.repeat ||
        event.defaultPrevented
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"]')) return;

      event.preventDefault();
      event.stopPropagation();
      triggerPlaceOrderButtonAction();
    };

    const handleShortcutKeyUp = (event: KeyboardEvent) => {
      if (event.code === "ShiftRight") {
        resetRightShiftShortcut();
      }
    };

    window.addEventListener("keydown", handleShortcutKeyDown);
    window.addEventListener("keyup", handleShortcutKeyUp);
    window.addEventListener("blur", resetRightShiftShortcut);

    return () => {
      window.removeEventListener("keydown", handleShortcutKeyDown);
      window.removeEventListener("keyup", handleShortcutKeyUp);
      window.removeEventListener("blur", resetRightShiftShortcut);
    };
  }, [triggerPlaceOrderButtonAction]);

  const clearStaffPinPreview = useCallback(() => {
    staffPinPreviewRequestIdRef.current += 1;
    setStaffPinPreview(null);
  }, []);

  const updateStaffPinPreview = useCallback(
    async (value: string) => {
      const normalizedPin = value.replace(/\D/g, "").slice(0, 5);
      if (normalizedPin.length !== 5) {
        clearStaffPinPreview();
        return;
      }

      const requestId = staffPinPreviewRequestIdRef.current + 1;
      staffPinPreviewRequestIdRef.current = requestId;
      setStaffPinPreview(null);

      try {
        const res = await fetch("/api/workers/verify-pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: normalizedPin }),
        });

        if (!res.ok) {
          throw new Error("Invalid PIN");
        }

        const data = await res.json();
        if (staffPinPreviewRequestIdRef.current !== requestId) return;
        setStaffPinPreview(getStaffPinPreview(data));
      } catch {
        if (staffPinPreviewRequestIdRef.current !== requestId) return;
        setStaffPinPreview(null);
      }
    },
    [clearStaffPinPreview],
  );

  const renderStaffPinPreview = () => {
    if (!staffPinPreview) return null;

    return (
      <div
        className="mx-auto mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
        data-testid="text-create-order-staff-pin-preview"
        aria-live="polite"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>{staffPinPreview.roleLabel}: {staffPinPreview.name}</span>
      </div>
    );
  };

  const submitOrder = (isUrgent: boolean) => {
    setPendingUrgent(isUrgent);
    setShowUrgentDialog(false);
    setShowPinDialog(true);
    setStaffPin("");
    setPinError("");
    clearStaffPinPreview();
    pendingPayNowStaffRef.current = null;
  };

  const verifyPinAndCreateOrder = async () => {
    if (staffPin.length !== 5) {
      setPinError("PIN must be 5 digits");
      return;
    }

    setIsVerifyingPin(true);
    setPinError("");
    pendingPayNowStaffRef.current = null;

    try {
      // Use workers/verify-pin which only accepts admin, reception, and cashier PINs
      const res = await fetch("/api/workers/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: staffPin }),
      });

      if (!res.ok) {
        // Try to get the error message from the response
        try {
          const errorData = await res.json();
          setPinError(
            errorData.message ||
              "This PIN has no billing rights. Use admin or reception/cashier PIN.",
          );
        } catch {
          setPinError(
            "This PIN has no billing rights. Use admin or reception/cashier PIN.",
          );
        }
        setIsVerifyingPin(false);
        return;
      }

      const data = await res.json();
      const verifiedStaff: VerifiedOrderStaff = {
        name: data.worker?.name || "Staff",
        pin: staffPin,
        role: data.worker?.role || null,
      };
      pendingPayNowStaffRef.current = payNowAfterOrder ? verifiedStaff : null;

      const productItemsText = orderItems.map((item, idx) => {
        const packing = packingTypes[item.product.id] || "folding";
        const serviceLabel =
          item.serviceType === "iron"
            ? "IO"
            : item.serviceType === "dc"
              ? "DC"
              : "N";
        const itemIsUrgent = orderType === "urgent" || !!item.isUrgent;
        const itemPriceKey = `${item.product.id}-${item.serviceType}-${itemIsUrgent ? "urgent" : "normal"}`;
        const normalItemPriceKey = `${item.product.id}-${item.serviceType}-normal`;

        if (item.product.isSqmPriced && item.sqm) {
          const carpetKey = `carpet-${idx}`;
          const qtyPrefix = item.quantity > 1 ? `${item.quantity}x ` : "";
          const urgentLabel = itemIsUrgent ? " *URG*" : "";
          if (customPrices[carpetKey] !== undefined) {
            const baseSqmPrice = customPrices[carpetKey];
            const currentSqmPrice = itemIsUrgent
              ? baseSqmPrice * 2
              : baseSqmPrice;
            return `${qtyPrefix}${item.sqm} sqm ${item.product.name}${urgentLabel} (base ${baseSqmPrice.toFixed(2)} AED) @ ${currentSqmPrice.toFixed(2)} AED (custom)`;
          }
          const sqmPrice = parseFloat(
            item.product.sqmPrice || item.product.price || "12",
          );
          const calcPrice = item.sqm * sqmPrice;
          const baseSqmPrice =
            item.sqm < 5 ? Math.max(50, calcPrice) : calcPrice;
          const currentSqmPrice = itemIsUrgent
            ? baseSqmPrice * 2
            : baseSqmPrice;
          return `${qtyPrefix}${item.sqm} sqm ${item.product.name}${urgentLabel} (base ${baseSqmPrice.toFixed(2)} AED) @ ${currentSqmPrice.toFixed(2)} AED${item.sqm < 5 ? " (min 50)" : ""}`;
        }

        const urgentLabel = itemIsUrgent ? " *URG*" : "";
        const normalPrice = parseFloat(item.product.price || "0");
        const baseServicePrice =
          customPrices[normalItemPriceKey] !== undefined
            ? customPrices[normalItemPriceKey]
            : item.serviceType === "iron"
              ? parseFloat(
                  item.product.ironOnlyPrice || String(normalPrice / 2),
                )
              : item.serviceType === "dc"
                ? parseFloat(
                    item.product.dryCleanPrice || String(normalPrice * 2),
                  )
                : normalPrice;

        let displayPrice =
          customPrices[itemPriceKey] !== undefined
            ? customPrices[itemPriceKey]
            : baseServicePrice;

        if (customPrices[itemPriceKey] === undefined && itemIsUrgent) {
          if (item.serviceType === "iron") {
            displayPrice = parseFloat(
              item.product.urgentIronOnlyPrice || String(baseServicePrice * 2),
            );
          } else if (item.serviceType === "dc") {
            displayPrice = parseFloat(
              item.product.urgentDryCleanPrice || String(baseServicePrice * 2),
            );
          } else {
            displayPrice = parseFloat(
              item.product.urgentPrice || String(normalPrice * 2),
            );
          }
        }

        return `${item.quantity}x ${item.product.name} [${serviceLabel}] (${packing})${urgentLabel} (base ${baseServicePrice.toFixed(2)} AED) @ ${displayPrice.toFixed(2)} AED`;
      });
      const customItemsText = customItems.map((item) => {
        const svcLabel =
          item.serviceType === "iron"
            ? " [IO]"
            : item.serviceType === "dc"
              ? " [DC]"
              : "";
        const isItemUrgent = orderType === "urgent" || !!item.isUrgent;
        const urgLabel = isItemUrgent ? " *URG*" : "";
        const baseServicePrice = item.priceEdited
          ? item.price
          : item.serviceType === "iron"
            ? item.ironOnlyPrice || item.price
            : item.serviceType === "dc"
              ? item.dryCleanPrice || item.price
              : item.price;
        let displayPrice = baseServicePrice;
        if (!item.priceEdited) {
          if (item.serviceType === "iron") {
            const ioPrice = item.ironOnlyPrice || item.price;
            displayPrice = isItemUrgent
              ? item.urgentIronOnlyPrice || ioPrice * 2
              : ioPrice;
          } else if (item.serviceType === "dc") {
            const dcPrice = item.dryCleanPrice || item.price;
            displayPrice = isItemUrgent
              ? item.urgentDryCleanPrice || dcPrice * 2
              : dcPrice;
          } else {
            if (isItemUrgent) displayPrice = item.urgentPrice || item.price * 2;
          }
        }
        return `${item.quantity}x ${item.name}${svcLabel}${urgLabel} (base ${baseServicePrice.toFixed(2)} AED) @ ${displayPrice.toFixed(2)} AED`;
      });
      const itemsText = [...productItemsText, ...customItemsText].join(", ");
      const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;

      const hasDCItems =
        orderItems.some((item) => item.serviceType === "dc") ||
        customItems.some((item) => item.serviceType === "dc");
      const hasIronItemsOrder =
        orderItems.some((item) => item.serviceType === "iron") ||
        customItems.some((item) => item.serviceType === "iron");

      let subtotal = orderTotal;
      const discPct = discountPercentValue;
      const pctDiscountAmt = clientDiscountAmount;
      const flatDiscountAmt = appliedFlatDiscountAmount;
      const totalDiscountAmt = pctDiscountAmt + flatDiscountAmt;
      const tipsAmt = tipsAmount;
      const deliveryChargeAmt = deliveryChargeAmount;
      const finalTotal = currentOrderFinalTotal;

      const effectiveFinal =
        adjustedOrderTotal != null
          ? parseFloat(adjustedOrderTotal)
          : finalTotal;

      const walkinCompanyValue =
        isManualClientEntry && walkInCompany && walkInCompany !== "__new__"
          ? walkInCompany.toUpperCase()
          : "";
      if (walkinCompanyValue && showNewCompanyInput) {
        const alreadyExists = (companiesList || []).some(
          (c) => c.name.toUpperCase() === walkinCompanyValue.toUpperCase(),
        );
        if (!alreadyExists) {
          await apiRequest("POST", "/api/companies", {
            name: walkinCompanyValue.toUpperCase(),
          });
          queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
        }
      }

      const normalizedManualBrokerAddresses = manualBrokerAddresses
        .map((address) => address.trim().toUpperCase())
        .filter(
          (address, index, values) =>
            !!address && values.indexOf(address) === index,
        );

      createOrderMutation.mutate({
        clientId: isManualClientEntry ? null : selectedClientId,
        clientType: isManualClientEntry ? manualClientType : undefined,
        brokerAddresses: isManualBrokerEntry
          ? normalizedManualBrokerAddresses
          : undefined,
        customerName: isManualClientEntry
          ? walkInName.trim()
          : customerName.trim(),
        customerPhone: isManualClientEntry
          ? walkInPhone.trim()
          : customerPhone.trim(),
        deliveryAddress: orderDeliveryAddress,
        walkinCompany: walkinCompanyValue,
        orderNumber,
        items: itemsText,
        totalAmount: subtotal.toFixed(2),
        discountPercent: discPct.toFixed(2),
        discountAmount: totalDiscountAmt.toFixed(2),
        tips: tipsAmt.toFixed(2),
        deliveryCharge: deliveryChargeAmt.toFixed(2),
        finalAmount: effectiveFinal.toFixed(2),
        adjustedTotal: adjustedOrderTotal != null ? adjustedOrderTotal : null,
        priceAdjustReason:
          adjustedOrderTotal != null ? adjustOrderReason : null,
        entryDate: new Date().toISOString(),
        expectedDeliveryAt: expectedDeliveryAt.trim() || null,
        deliveryType: deliveryType,
        serviceType: hasIronItemsOrder
          ? "iron_only"
          : hasDCItems
            ? "dry_clean"
            : "normal",
        urgent: pendingUrgent,
        entryBy: verifiedStaff.name,
        entryByWorkerId: data.worker?.id || null,
        createdBy: verifiedStaff.name,
        notes: orderNotes.trim() || null,
      });

      setShowPinDialog(false);
      setStaffPin("");
      clearStaffPinPreview();
    } catch (err) {
      setPinError("Failed to verify PIN");
    } finally {
      setIsVerifyingPin(false);
    }
  };

  const clearOrder = () => {
    setQuantities({});
    setDcQuantities({});
    setIronQuantities({});
    setDefaultBulkServiceType("normal");
    setSqmValues({});
    setCarpetEntries([]);
    setCustomPrices({});
    setPackingTypes({});
    setDefaultBulkPackingType(null);
    setUrgentQuantities({});
    setCustomItems([]);
    setCustomerName("");
    setCustomerPhone("");
    setSelectedClientId(null);
    setIsWalkIn(false);
    setIsBroker(false);
    setBrokerDeliveryAddress("");
    setShowAddNewBrokerAddress(false);
    setNewBrokerAddress("");
    setWalkInName("");
    setWalkInPhone("");
    setWalkInAddress("");
    setWalkInCompany("");
    setShowNewCompanyInput(false);
    setNewCompanyInput("");
    setBrokerOnlyClientFilter(false);
    setCompanyOnlyClientFilter(false);
    setDiscountPercent("");
    setApplyDiscount(false);
    setDiscountAmount("");
    setTips("");
    setApplyDeliveryCharge(false);
    setDeliveryCharge("");
    setAdjustedOrderTotal(null);
    setAdjustOrderReason("");
    setOrderType("normal");
    setDeliveryType("pickup");
    setExpectedDeliveryAt("");
    setOrderNotes("");
  };

  const handleAdjustOrderTotal = async () => {
    if (adjustTotalPin.length !== 5) {
      setAdjustTotalError("PIN must be 5 digits");
      return;
    }
    const parsedVal = parseFloat(adjustTotalValue);
    if (!adjustTotalValue || !Number.isFinite(parsedVal) || parsedVal < 0) {
      setAdjustTotalError("Please enter a valid price");
      return;
    }
    if (!adjustOrderReason.trim()) {
      setAdjustTotalError("Reason is mandatory");
      return;
    }
    setIsVerifyingAdjustPin(true);
    try {
      const res = await fetch("/api/workers/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: adjustTotalPin }),
      });
      if (!res.ok) {
        setAdjustTotalError("Invalid PIN");
        return;
      }
      const data = await res.json();
      setAdjustedOrderTotal(adjustTotalValue);
      setAdjustOrderReason(adjustOrderReason.trim());
      toast({
        title: "Total Price Adjusted",
        description: `Total changed to AED ${parseFloat(adjustTotalValue).toFixed(2)} by ${data.worker?.name || "Staff"}`,
      });
      setShowAdjustTotalDialog(false);
      setAdjustTotalPin("");
      setAdjustTotalError("");
    } catch {
      setAdjustTotalError("Failed to verify PIN");
    } finally {
      setIsVerifyingAdjustPin(false);
    }
  };

  const parseOrderItems = (items: string) => {
    const parsed: { name: string; quantity: number }[] = [];
    const itemParts = items.split(", ");
    for (const part of itemParts) {
      const match = part.match(/^(\d+)x\s+(.+)$/);
      if (match) {
        parsed.push({ name: match[2], quantity: parseInt(match[1], 10) });
      }
    }
    return parsed;
  };

  const generateTagReceipt = (order: Order) => {
    const client = clients?.find((c) => c.id === order.clientId);
    const isUrgent = order.urgent;
    const parsedItems = parseOrderItems(order.items || "");

    const previousBills =
      bills?.filter((b) => b.clientId === order.clientId) || [];
    const unpaidBills = previousBills.filter((b) => !b.isPaid);
    const totalPreviousDue = unpaidBills.reduce((sum, b) => {
      const billTotal = parseFloat(b.amount) || 0;
      const billPaid = parseFloat(b.paidAmount || "0") || 0;
      return sum + (billTotal - billPaid);
    }, 0);

    const itemsHtml = parsedItems
      .map(
        (item, idx) =>
          `<tr style="border-bottom: 1px solid #e5e5e5;">
        <td style="padding: 5px 4px; font-size: 9px;">${idx + 1}</td>
        <td style="padding: 5px 4px; font-size: 9px; vertical-align: top;">${getInvoiceItemDescriptionHtml(
          item.name,
          {
            fontSizePx: 9,
            packingFontSizePx: 9,
            packingGapPx: 10,
            packingMarginTopPx: 3,
            boxSizePx: 11,
          },
        )}</td>
        <td style="padding: 5px 4px; font-size: 9px; text-align: center; font-weight: bold;">${item.quantity}</td>
        <td style="padding: 5px 4px; font-size: 9px; text-align: right;">${item.quantity} pcs</td>
      </tr>`,
      )
      .join("");

    const content = document.createElement("div");
    content.innerHTML = `
      <div style="font-family: Arial, sans-serif; padding: 15px; max-width: 148mm; color: #000; background: #fff;">
        <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px;">
          <div style="font-size: 18px; font-weight: bold; letter-spacing: 1px;">${escapeHtml(companyContact.companyName.toUpperCase())}</div>
          ${companyContact.tagline ? `<div style="font-size: 10px; margin-top: 4px; color: #666;">${escapeHtml(companyContact.tagline)}</div>` : ""}
          <div style="font-size: 9px; margin-top: 2px; color: #888;">${companyPhoneHtml}</div>
          <div style="font-size: 9px; margin-top: 2px; color: #888;">${companyAddressHtml}</div>
        </div>
        
        ${isUrgent ? `<div style="text-align: center; padding: 8px; margin: 10px 0; background: #fef2f2; border: 2px solid #dc2626; font-weight: bold; color: #dc2626; font-size: 12px; border-radius: 4px;">*** URGENT ORDER ***</div>` : ""}
        
        <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
          <div style="flex: 1;">
            <div style="font-size: 9px; color: #666; text-transform: uppercase; margin-bottom: 3px;">Order Number</div>
            <div style="font-size: 20px; font-weight: bold; color: #000; border: 2px dashed #000; padding: 8px 12px; display: inline-block;">${order.orderNumber}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 9px; color: #666;">Entry Date</div>
            <div style="font-size: 11px; font-weight: bold;">${format(new Date(order.entryDate), "dd MMM yyyy")}</div>
            <div style="font-size: 10px; color: #666;">${format(new Date(order.entryDate), "hh:mm a")}</div>
            ${
              order.expectedDeliveryAt
                ? `
            <div style="font-size: 9px; color: #666; margin-top: 5px;">Expected ${order.deliveryType === "delivery" ? "Delivery" : "Takeaway"}</div>
            <div style="font-size: 11px; font-weight: bold; color: #2563eb;">${order.expectedDeliveryAt}</div>
            `
                : ""
            }
          </div>
        </div>
        
        <div style="background: #f8f9fa; border: 1px solid #e5e5e5; border-radius: 4px; padding: 10px; margin-bottom: 15px;">
          <div style="font-size: 9px; color: #666; text-transform: uppercase; margin-bottom: 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px;">Client Information</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div>
              <div style="font-size: 8px; color: #888;">Name</div>
              <div style="font-size: 12px; font-weight: bold;">${client?.name || order.customerName || "Walk-in Customer"}</div>
            </div>
            <div>
              <div style="font-size: 8px; color: #888;">Phone</div>
              <div style="font-size: 12px; font-weight: bold;">${client?.phone || "-"}</div>
            </div>
            <div style="grid-column: span 2;">
              <div style="font-size: 8px; color: #888;">Address</div>
              <div style="font-size: 10px;">${order.deliveryAddress || client?.address || "-"}</div>
            </div>
          </div>
        </div>
        
        <div style="margin-bottom: 15px;">
          <div style="font-size: 11px; font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid #000; padding-bottom: 4px;">ITEMS DETAIL</div>
          <table style="width: 100%; border-collapse: collapse; border: 1px solid #ddd;">
            <thead>
              <tr style="background: #f0f0f0;">
                <th style="padding: 6px 4px; text-align: left; font-size: 9px; border-bottom: 1px solid #000; width: 30px;">#</th>
                <th style="padding: 6px 4px; text-align: left; font-size: 9px; border-bottom: 1px solid #000;">Item Description</th>
                <th style="padding: 6px 4px; text-align: center; font-size: 9px; border-bottom: 1px solid #000; width: 40px;">Qty</th>
                <th style="padding: 6px 4px; text-align: right; font-size: 9px; border-bottom: 1px solid #000; width: 60px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
            <tfoot>
              <tr style="background: #f8f9fa; border-top: 1px solid #000;">
                <td colspan="2" style="padding: 6px 4px; font-size: 10px; font-weight: bold;">Total: ${parsedItems.reduce((sum, item) => sum + item.quantity, 0)} pcs</td>
                <td colspan="2" style="padding: 6px 4px; font-size: 12px; font-weight: bold; text-align: right;">AED ${parseFloat(order.totalAmount).toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        
        ${
          totalPreviousDue > 0
            ? `
        <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 4px; padding: 10px; margin-bottom: 10px;">
          <div style="font-size: 11px; font-weight: bold; color: #856404; margin-bottom: 8px; border-bottom: 1px solid #ffc107; padding-bottom: 4px;">PREVIOUS OUTSTANDING BILLS (${unpaidBills.length})</div>
          <table style="width: 100%; border-collapse: collapse; font-size: 9px;">
            <thead>
              <tr style="background: #ffeeba;">
                <th style="padding: 4px; text-align: left; border-bottom: 1px solid #d39e00;">Bill #</th>
                <th style="padding: 4px; text-align: left; border-bottom: 1px solid #d39e00;">Date</th>
                <th style="padding: 4px; text-align: right; border-bottom: 1px solid #d39e00;">Due</th>
              </tr>
            </thead>
            <tbody>
              ${unpaidBills
                .map((bill) => {
                  const billTotal = parseFloat(bill.amount) || 0;
                  const billPaid = parseFloat(bill.paidAmount || "0") || 0;
                  const billDue = billTotal - billPaid;
                  return `<tr style="border-bottom: 1px dashed #d39e00;">
                  <td style="padding: 3px 4px;">#${bill.referenceNumber || bill.id}</td>
                  <td style="padding: 3px 4px;">${format(new Date(bill.billDate), "dd/MM/yy")}</td>
                  <td style="padding: 3px 4px; text-align: right; font-weight: bold; color: #dc3545;">${billDue.toFixed(2)}</td>
                </tr>`;
                })
                .join("")}
            </tbody>
          </table>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding-top: 6px; border-top: 2px solid #d39e00;">
            <span style="font-size: 10px; font-weight: bold; color: #856404;">TOTAL PREVIOUS DUE:</span>
            <span style="font-size: 14px; font-weight: bold; color: #dc3545;">AED ${totalPreviousDue.toFixed(2)}</span>
          </div>
        </div>
        `
            : ""
        }
        
        ${
          order.notes
            ? `
        <div style="background: #e8f4fd; border: 1px solid #90cdf4; border-radius: 4px; padding: 8px; margin-bottom: 10px;">
          <div style="font-size: 9px; font-weight: bold; color: #2b6cb0; margin-bottom: 3px;">ORDER NOTES</div>
          <div style="font-size: 10px;">${order.notes}</div>
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

    const opt = {
      margin: 8,
      filename: `Tag_${order.orderNumber}.pdf`,
      image: { type: "jpeg" as const, quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: {
        unit: "mm",
        format: "a5" as const,
        orientation: "portrait" as const,
      },
    };

    html2pdf().set(opt).from(content).save();
    toast({
      title: "Tag Downloaded",
      description: `Tag for ${order.orderNumber} saved`,
    });
  };

  const handlePrintTagDialogClose = (printNow: boolean) => {
    if (printNow && createdOrder) {
      generateTagReceipt(createdOrder);
    }
    setShowPrintTagDialog(false);
    setCreatedOrder(null);
    clearOrder();
    toast({
      title: "Order created",
      description: printNow
        ? "Order created and tag downloaded."
        : "Order created. You can print the tag later from Orders page.",
    });
  };

  const handleAddOtherItem = () => {
    if (!otherItemName.trim()) {
      toast({
        title: "Enter item name",
        description: "Please enter item name.",
        variant: "destructive",
      });
      return;
    }
    if (!otherItemPrice || parseFloat(otherItemPrice) <= 0) {
      toast({
        title: "Enter price",
        description: "Please enter a valid price.",
        variant: "destructive",
      });
      return;
    }
    const qty = parseInt(otherItemQty) || 1;
    setCustomItems((prev) => [
      ...prev,
      {
        name: otherItemName.trim(),
        price: parseFloat(otherItemPrice),
        normalPrice: parseFloat(otherItemPrice),
        quantity: qty,
      },
    ]);
    setOtherItemName("");
    setOtherItemPrice("");
    setOtherItemQty("1");
    setShowOtherItemDialog(false);
    toast({
      title: "Item added",
      description: `${otherItemName} added to order.`,
    });
  };

  const removeCustomItem = (index: number) => {
    setCustomItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePackingTypeChange = (
    productId: number,
    type: "hanging" | "folding",
  ) => {
    setPackingTypes((prev) => ({ ...prev, [productId]: type }));
  };

  const handleCreateNewClient = () => {
    if (!newClientName.trim()) {
      toast({
        title: "Enter name",
        description: "Please enter client name.",
        variant: "destructive",
      });
      return;
    }
    if (!newClientPhone.trim()) {
      toast({
        title: "Enter phone",
        description: "Phone number is required.",
        variant: "destructive",
      });
      return;
    }
    if (!isPlausiblePhoneNumber(newClientPhone)) {
      toast({
        title: "Invalid phone",
        description: "Choose the country code and enter a valid phone number.",
        variant: "destructive",
      });
      return;
    }
    createClient(
      {
        name: newClientName.trim(),
        phone: newClientPhone.trim(),
        email: newClientEmail.trim() || "",
        address: newClientAddress.trim() || "",
        clientType: newClientMode,
        brokerAddresses:
          newClientMode === "broker" && newClientAddress.trim()
            ? [newClientAddress.trim().toUpperCase()]
            : [],
        amount: "0",
        deposit: "0",
        balance: "0",
        contact: newClientContact.trim() || "",
        billNumber: "",
        preferredPaymentMethod: newClientPaymentMethod || "cash",
        discountPercent: newClientDiscount || "0",
      },
      {
        onSuccess: (client: Client) => {
          setSelectedClientId(client.id);
          setIsBroker(isBrokerClient(client));
          setIsWalkIn(false);
          resetManualClientFields();
          resetBrokerAddressState();
          setCustomerName(client.name);
          setCustomerPhone(client.phone || "");
          setBrokerDeliveryAddress(
            newClientMode === "broker" ? client.address || "" : "",
          );
          if (client.discountPercent) {
            setDiscountPercent(client.discountPercent);
          }
          setShowNewClientDialog(false);
          setNewClientMode("regular");
          setNewClientName("");
          setNewClientPhone("");
          setNewClientAddress("");
          setNewClientEmail("");
          setNewClientContact("");
          setNewClientPaymentMethod("cash");
          setNewClientDiscount("");
          toast({
            title:
              newClientMode === "broker" ? "Broker created" : "Client created",
            description: `${client.name} has been added as ${newClientMode === "broker" ? "a broker" : "a regular client"}.`,
          });
        },
        onError: (
          error: Error & {
            existingClient?: {
              id: number;
              name: string;
              phone: string;
              address: string | null;
            };
          },
        ) => {
          try {
            const errorData = JSON.parse(error.message);
            if (errorData.existingClient) {
              setSuggestedExistingClient(errorData.existingClient);
              toast({
                title: "Phone number exists",
                description: `This number belongs to "${errorData.existingClient.name}". Use existing client or enter a different number.`,
                variant: "destructive",
              });
              return;
            }
          } catch {
            // Not a JSON error, try to extract message from error string
          }
          let message = "Failed to create client.";
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
      },
    );
  };

  const enterEditMode = () => {
    setDraftCategoryDisplayOrder(orderedCategoryOptions);
    setPendingProductCategoryChanges({});
    setIsEditMode(true);
  };

  const exitEditMode = () => {
    setIsEditMode(false);
    setDraftCategoryDisplayOrder(null);
    setPendingProductCategoryChanges({});
    setDraggingProduct(null);
    setDragOverTab(null);
    setDraggingCategoryName(null);
    setDragOverCategoryTarget(null);
    setCategoryTabMenu(null);
    setCategoryTabMenuMode("menu");
    setCategoryTabRenameValue("");
    setCategoryActionError("");
  };

  // Handle drag start
  const handleDragStart = (
    e: React.DragEvent,
    product: { id: number; name: string },
  ) => {
    if (!isEditMode || !canManageItems) return;
    setDraggingProduct(product);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify(product));
  };

  // Handle drag end
  const handleDragEnd = () => {
    setDraggingProduct(null);
    setDragOverTab(null);
  };

  const handleCategoryDragStart = (
    e: React.DragEvent,
    categoryName: string,
  ) => {
    if (!isEditMode) return;
    setDraggingCategoryName(categoryName);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", categoryName);
  };

  const handleCategoryDragEnd = () => {
    setDraggingCategoryName(null);
    setDragOverCategoryTarget(null);
  };

  const categoryOrdersMatch = (left: string[], right: string[]) =>
    left.length === right.length &&
    left.every((categoryName, index) => categoryName === right[index]);

  const saveCategoryDisplayOrderImmediately = (nextOrder: string[]) => {
    const normalizedOrder = normalizeCategoryNames(nextOrder);
    setDraftCategoryDisplayOrder(normalizedOrder);
    void persistCategoryDisplayOrder(normalizedOrder).catch(() => {
      setDraftCategoryDisplayOrder(orderedCategoryOptions);
      toast({
        title: "Category Order Not Saved",
        description: "Could not save the category tab arrangement.",
        variant: "destructive",
      });
    });
  };

  const moveCategoryWithinDraft = (
    fromCategoryName: string,
    toCategoryName: string,
    placement: "before" | "after",
  ) => {
    const currentOrder = draftCategoryDisplayOrder ?? orderedCategoryOptions;
    const fromCategory = fromCategoryName.trim().toLowerCase();
    const toCategory = toCategoryName.trim().toLowerCase();

    if (!fromCategory || !toCategory || fromCategory === toCategory) {
      return;
    }

    const fromIdx = currentOrder.findIndex(
      (categoryName) => categoryName.toLowerCase() === fromCategory,
    );
    const toIdx = currentOrder.findIndex(
      (categoryName) => categoryName.toLowerCase() === toCategory,
    );
    if (fromIdx === -1 || toIdx === -1) return;

    const nextOrder = [...currentOrder];
    const [moved] = nextOrder.splice(fromIdx, 1);
    const adjustedTargetIndex = fromIdx < toIdx ? toIdx - 1 : toIdx;
    const insertIndex =
      placement === "before"
        ? adjustedTargetIndex
        : adjustedTargetIndex + 1;

    nextOrder.splice(
      Math.max(0, Math.min(insertIndex, nextOrder.length)),
      0,
      moved,
    );

    if (!categoryOrdersMatch(nextOrder, currentOrder)) {
      saveCategoryDisplayOrderImmediately(nextOrder);
    }
  };

  const moveCategoryToDraftEnd = (categoryName: string) => {
    const currentOrder = draftCategoryDisplayOrder ?? orderedCategoryOptions;
    const fromCategory = categoryName.trim().toLowerCase();
    if (!fromCategory) return;

    const fromIdx = currentOrder.findIndex(
      (currentCategory) => currentCategory.toLowerCase() === fromCategory,
    );
    if (fromIdx === -1 || fromIdx === currentOrder.length - 1) return;

    const nextOrder = [...currentOrder];
    const [moved] = nextOrder.splice(fromIdx, 1);
    nextOrder.push(moved);
    saveCategoryDisplayOrderImmediately(nextOrder);
  };

  const getCategoryDropPlacement = (
    e: React.DragEvent<HTMLElement>,
  ): "before" | "after" => {
    const { left, width } = e.currentTarget.getBoundingClientRect();
    return e.clientX - left < width / 2 ? "before" : "after";
  };

  const saveProductCategoryMoveImmediately = async (
    product: Product,
    targetCategory: string,
  ) => {
    const nextDisplayCategory = targetCategory.trim();
    if (!nextDisplayCategory) return;

    setPendingProductCategoryChanges((current) => ({
      ...current,
      [product.id]: nextDisplayCategory,
    }));

    try {
      await apiRequest("PUT", `/api/products/${product.id}`, {
        category:
          nextDisplayCategory.toLowerCase() ===
          uncategorizedCategoryName.toLowerCase()
            ? null
            : nextDisplayCategory,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    } catch {
      toast({
        title: "Move Not Saved",
        description: `Could not move ${product.name} to ${nextDisplayCategory}.`,
        variant: "destructive",
      });
    } finally {
      setPendingProductCategoryChanges((current) => {
        const next = { ...current };
        delete next[product.id];
        return next;
      });
    }
  };

  // Handle drop on tab
  const handleDropOnTab = async (
    e: React.DragEvent<HTMLElement>,
    tabId: string,
  ) => {
    e.preventDefault();
    const targetCategory = tabIdToCategory[tabId];
    if (!targetCategory) return;

    if (draggingCategoryName) {
      if (tabId === "all" || tabId === UNCATEGORIZED_CATEGORY_TAB_ID) {
        setDraggingCategoryName(null);
        setDragOverCategoryTarget(null);
        return;
      }
      const fromCategory = draggingCategoryName.trim();
      const toCategory = targetCategory.trim();
      if (
        fromCategory &&
        toCategory &&
        fromCategory.toLowerCase() !== toCategory.toLowerCase()
      ) {
        const placement =
          dragOverCategoryTarget?.tabId === tabId &&
          dragOverCategoryTarget.placement !== "end"
            ? dragOverCategoryTarget.placement
            : getCategoryDropPlacement(e);
        moveCategoryWithinDraft(fromCategory, toCategory, placement);
      }
      setDraggingCategoryName(null);
      setDragOverCategoryTarget(null);
      return;
    }

    if (!draggingProduct) return;
    const draggedProductRecord = (allProducts || []).find(
      (product) => product.id === draggingProduct.id,
    );
    if (draggedProductRecord) {
      const originalCategory = getDisplayCategoryName(
        getEffectiveProductCategory(draggedProductRecord),
      )
        .trim()
        .toLowerCase();
      const nextCategory = targetCategory.trim();
      if (originalCategory !== nextCategory.toLowerCase()) {
        void saveProductCategoryMoveImmediately(
          draggedProductRecord,
          nextCategory,
        );
      }
    }
    setDraggingProduct(null);
    setDragOverTab(null);
  };

  // Handle drag over tab
  const handleDragOverTab = (
    e: React.DragEvent<HTMLElement>,
    tabId: string,
  ) => {
    e.preventDefault();
    if (!tabIdToCategory[tabId]) return;
    if (draggingCategoryName) {
      if (tabId === "all" || tabId === UNCATEGORIZED_CATEGORY_TAB_ID) return;
      e.dataTransfer.dropEffect = "move";
      setDragOverCategoryTarget({
        tabId,
        placement: getCategoryDropPlacement(e),
      });
      return;
    }
    if (draggingProduct) {
      e.dataTransfer.dropEffect = "move";
      setDragOverTab(tabId);
    }
  };

  const handleCategoryTabDragLeave = (e: React.DragEvent<HTMLElement>) => {
    const nextTarget = e.relatedTarget;
    if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) {
      return;
    }
    setDragOverCategoryTarget(null);
  };

  const handleCategoryEndDragOver = (e: React.DragEvent<HTMLElement>) => {
    if (!draggingCategoryName) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCategoryTarget({
      tabId: CATEGORY_TAB_END_DROP_ZONE_ID,
      placement: "end",
    });
  };

  const handleCategoryEndDrop = (e: React.DragEvent<HTMLElement>) => {
    if (!draggingCategoryName) return;
    e.preventDefault();
    moveCategoryToDraftEnd(draggingCategoryName);
    setDraggingCategoryName(null);
    setDragOverCategoryTarget(null);
  };

  const deleteCategory = async (categoryToDeleteInput: string) => {
    const categoryToDelete = categoryToDeleteInput.trim();
    if (!categoryToDelete) {
      setCategoryActionError("Select a category to delete");
      return;
    }

    if (
      !editableCategoryOptions.some(
        (categoryName) =>
          categoryName.toLowerCase() === categoryToDelete.toLowerCase(),
      )
    ) {
      setCategoryActionError("This category cannot be deleted");
      return;
    }

    setIsCategoryActionLoading(true);
    setCategoryActionError("");
    try {
      const normalizedCategoryToDelete =
        normalizeStoredProductCategoryName(
          categoryToDelete,
          orderedCategoryOptions,
        ) || categoryToDelete;
      const productsToMove = (allProducts || []).filter(
        (p) =>
          (
            normalizeStoredProductCategoryName(
              p.category,
              orderedCategoryOptions,
            ) || ""
          ).toLowerCase() === normalizedCategoryToDelete.toLowerCase(),
      );

      for (const product of productsToMove) {
        await apiRequest("PUT", `/api/products/${product.id}`, {
          category: null,
        });
      }

      const nextCustomCategories = customCategories.filter(
        (categoryName) =>
          categoryName.toLowerCase() !== categoryToDelete.toLowerCase(),
      );
      const nextBaseCategories = baseCategoryDefaults.filter(
        (categoryName) =>
          categoryName.toLowerCase() !== categoryToDelete.toLowerCase(),
      );
      const nextDisplayOrder = categoryDisplayOrder.filter(
        (categoryName) =>
          categoryName.toLowerCase() !== categoryToDelete.toLowerCase(),
      );
      const nextOrderDisplay = sharedCategorySettings.orderDisplayOrder.filter(
        (categoryName) =>
          categoryName.toLowerCase() !== categoryToDelete.toLowerCase(),
      );

      await updateSharedCategorySettings({
        customCategories: nextCustomCategories,
        baseCategories: nextBaseCategories,
        inventoryDisplayOrder: nextDisplayOrder,
        orderDisplayOrder: nextOrderDisplay,
      });

      updateDraftCategoryDisplayOrder((draftCategories) =>
        draftCategories.filter(
          (categoryName) =>
            categoryName.toLowerCase() !== categoryToDelete.toLowerCase(),
        ),
      );
      replacePendingCategoryTarget(categoryToDelete, uncategorizedCategoryName);
      if (newProductCategory.toLowerCase() === categoryToDelete.toLowerCase()) {
        setNewProductCategory(uncategorizedCategoryName);
      }
      if (selectedCategory === getCategoryTabId(categoryToDelete)) {
        setSelectedCategory("favorites");
      }

      closeCategoryTabMenu();
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "Category Deleted",
        description:
          productsToMove.length > 0
            ? `${productsToMove.length} item${productsToMove.length === 1 ? "" : "s"} moved to ${uncategorizedCategoryName}.`
            : `"${categoryToDelete}" removed from categories.`,
      });
    } catch {
      setCategoryActionError("Failed to delete category");
    } finally {
      setIsCategoryActionLoading(false);
    }
  };

  const MarqueeText = ({ children }: { children: React.ReactNode }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLDivElement>(null);
    const [isOverflowing, setIsOverflowing] = useState(false);
    useEffect(() => {
      if (containerRef.current && textRef.current) {
        setIsOverflowing(
          textRef.current.scrollWidth > containerRef.current.clientWidth,
        );
      }
    });
    return (
      <div ref={containerRef} className="whitespace-nowrap overflow-hidden">
        <div
          ref={textRef}
          className={`inline-block ${isOverflowing ? "group-hover/client:animate-[marquee_5s_linear_infinite]" : ""}`}
        >
          {children}
        </div>
      </div>
    );
  };

  // Render order slip content (reusable for both sidebar and popup)
  const renderOrderSlipContent = (isPopup: boolean = false) => {
    const compactSidebarClientForm =
      !isPopup && isManualClientEntry && !isManualBrokerEntry;
    const manualClientCardClassName = compactSidebarClientForm
      ? "grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-2.5 rounded-lg border bg-muted/30 p-2.5"
      : "space-y-2 rounded-lg border bg-muted/30 p-3";
    const manualClientFieldClassName = compactSidebarClientForm
      ? "min-w-0 space-y-1"
      : "";
    const manualClientInputSpacingClassName = compactSidebarClientForm
      ? "mt-0"
      : "mt-1";
    const manualClientPhoneHintClassName = compactSidebarClientForm
      ? "text-[11px] leading-tight"
      : "text-xs";
    const clientListScopeLabel = brokerOnlyClientFilter
      ? "Broker"
      : companyOnlyClientFilter
        ? "Company"
        : "All";
    const clientListModeLabel = addressOnlyClientFilter
      ? "Address Search"
      : phoneOnlyClientFilter
        ? "Phone Search"
        : "Client List";
    const clientSearchPlaceholder = addressOnlyClientFilter
      ? "Search by address..."
      : phoneOnlyClientFilter
        ? "Search by phone number..."
        : "click to select or type to search a client";
    const keepClientDropdownOpen = (event: React.MouseEvent) => {
      if (showClientDropdown) {
        event.preventDefault();
      }
    };
    const clientFilterRowClassName =
      "flex flex-nowrap items-center justify-center gap-x-1.5 overflow-hidden";
    const clientFilterItemClassName =
      "flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-0.5";
    const clientFilterLabelClassName = "flex shrink-0 items-center";
    const clientFilterIconClassName = isPopup
      ? "h-3.5 w-3.5 shrink-0"
      : "h-4 w-4 shrink-0";
    const clientFilterSwitchClassName = isPopup
      ? "h-4 w-7 border-0 shadow-none transition-colors duration-200 ease-out [&>span]:h-3 [&>span]:w-3 [&>span]:bg-white [&>span]:shadow-sm [&>span]:transition-transform [&>span]:duration-200 [&>span]:ease-out [&>span[data-state=checked]]:translate-x-3"
      : "h-5 w-9 border-0 shadow-none transition-colors duration-200 ease-out [&>span]:h-4 [&>span]:w-4 [&>span]:bg-white [&>span]:shadow-sm [&>span]:transition-transform [&>span]:duration-200 [&>span]:ease-out [&>span[data-state=checked]]:translate-x-4";

    return (
      <div
        data-clock-overlay-root
        className={`${isPopup ? "p-3 pb-4" : "p-2 pb-3"} flex flex-1 min-h-0 flex-col gap-2 overflow-hidden`}
      >
      {/* Client Selection */}
      <div className={isPopup ? "space-y-1.5" : "space-y-1"}>
        <div className={clientFilterRowClassName}>
          <div
            className={`${clientFilterItemClassName} bg-violet-50/70 text-violet-600 dark:bg-violet-950/30 dark:text-violet-300`}
            onMouseDown={keepClientDropdownOpen}
          >
            <Label
              htmlFor={isPopup ? "popup-broker-only-filter" : "sidebar-broker-only-filter"}
              className={clientFilterLabelClassName}
              title="Broker Only"
            >
              <User className={clientFilterIconClassName} />
              <span className="sr-only">Broker Only</span>
            </Label>
            <Switch
              id={isPopup ? "popup-broker-only-filter" : "sidebar-broker-only-filter"}
              aria-label="Broker Only"
              checked={brokerOnlyClientFilter}
              onCheckedChange={(checked) => {
                setBrokerOnlyClientFilter(checked);
                if (checked) setCompanyOnlyClientFilter(false);
              }}
              className={`${clientFilterSwitchClassName} data-[state=checked]:bg-violet-400 data-[state=unchecked]:bg-violet-100 dark:data-[state=checked]:bg-violet-500 dark:data-[state=unchecked]:bg-violet-950`}
              data-testid={
                isPopup
                  ? "popup-switch-broker-only-filter"
                  : "sidebar-switch-broker-only-filter"
              }
            />
          </div>
          <div
            className={`${clientFilterItemClassName} bg-blue-50/70 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300`}
            onMouseDown={keepClientDropdownOpen}
          >
            <Label
              htmlFor={isPopup ? "popup-company-only-filter" : "sidebar-company-only-filter"}
              className={clientFilterLabelClassName}
              title="By Company"
            >
              <Building2 className={clientFilterIconClassName} />
              <span className="sr-only">By Company</span>
            </Label>
            <Switch
              id={isPopup ? "popup-company-only-filter" : "sidebar-company-only-filter"}
              aria-label="By Company"
              checked={companyOnlyClientFilter}
              onCheckedChange={(checked) => {
                setCompanyOnlyClientFilter(checked);
                if (checked) setBrokerOnlyClientFilter(false);
              }}
              className={`${clientFilterSwitchClassName} data-[state=checked]:bg-blue-400 data-[state=unchecked]:bg-blue-100 dark:data-[state=checked]:bg-blue-500 dark:data-[state=unchecked]:bg-blue-950`}
              data-testid={
                isPopup
                  ? "popup-switch-company-only-filter"
                  : "sidebar-switch-company-only-filter"
              }
            />
          </div>
          <div
            className={`${clientFilterItemClassName} bg-emerald-50/70 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-300`}
            onMouseDown={keepClientDropdownOpen}
          >
            <Label
              htmlFor={isPopup ? "popup-address-only-filter" : "sidebar-address-only-filter"}
              className={clientFilterLabelClassName}
              title="By Address"
            >
              <MapPin className={clientFilterIconClassName} />
              <span className="sr-only">By Address</span>
            </Label>
            <Switch
              id={isPopup ? "popup-address-only-filter" : "sidebar-address-only-filter"}
              aria-label="By Address"
              checked={addressOnlyClientFilter}
              onCheckedChange={(checked) => {
                setAddressOnlyClientFilter(checked);
                if (checked) setPhoneOnlyClientFilter(false);
              }}
              className={`${clientFilterSwitchClassName} data-[state=checked]:bg-emerald-400 data-[state=unchecked]:bg-emerald-100 dark:data-[state=checked]:bg-emerald-500 dark:data-[state=unchecked]:bg-emerald-950`}
              data-testid={
                isPopup
                  ? "popup-switch-address-only-filter"
                  : "sidebar-switch-address-only-filter"
              }
            />
          </div>
          <div
            className={`${clientFilterItemClassName} bg-amber-50/70 text-amber-600 dark:bg-amber-950/30 dark:text-amber-300`}
            onMouseDown={keepClientDropdownOpen}
          >
            <Label
              htmlFor={isPopup ? "popup-phone-only-filter" : "sidebar-phone-only-filter"}
              className={clientFilterLabelClassName}
              title="Phone Number"
            >
              <Phone className={clientFilterIconClassName} />
              <span className="sr-only">Phone Number</span>
            </Label>
            <Switch
              id={isPopup ? "popup-phone-only-filter" : "sidebar-phone-only-filter"}
              aria-label="Phone Number"
              checked={phoneOnlyClientFilter}
              onCheckedChange={(checked) => {
                setPhoneOnlyClientFilter(checked);
                if (checked) setAddressOnlyClientFilter(false);
              }}
              className={`${clientFilterSwitchClassName} data-[state=checked]:bg-amber-400 data-[state=unchecked]:bg-amber-100 dark:data-[state=checked]:bg-amber-500 dark:data-[state=unchecked]:bg-amber-950`}
              data-testid={
                isPopup
                  ? "popup-switch-phone-only-filter"
                  : "sidebar-switch-phone-only-filter"
              }
            />
          </div>
        </div>
        <div className="relative">
          <Input
            placeholder={clientSearchPlaceholder}
            value={clientSelectorDisplayValue}
            onChange={(e) => {
              setClientSearchTerm(e.target.value);
              setShowClientDropdown(true);
            }}
            onFocus={() => setShowClientDropdown(true)}
            onBlur={() => setTimeout(() => setShowClientDropdown(false), 150)}
            className={
              isPopup
                ? "h-11 pr-8 text-base font-semibold placeholder:font-semibold"
                : "h-9 pr-8 text-sm font-semibold placeholder:font-semibold"
            }
            data-testid={
              isPopup ? "popup-search-client" : "sidebar-search-client"
            }
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </div>
          {showClientDropdown && (
            <div className="absolute left-0 right-0 z-50 mt-1 bg-background border border-input rounded-md shadow-xl max-h-[70vh] sm:max-h-[34rem] overflow-y-auto overscroll-contain">
              {!brokerOnlyClientFilter && !companyOnlyClientFilter && (
                <div
                  className="px-3 py-2.5 cursor-pointer hover:bg-accent font-medium text-primary border-b"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSelectedClientId(null);
                    setIsWalkIn(true);
                    setIsBroker(false);
                    resetBrokerAddressState();
                    resetManualClientFields();
                    setCustomerName("Regular Client");
                    setCustomerPhone("");
                    setClientSearchTerm("");
                    setShowClientDropdown(false);
                    focusWalkInNameInput();
                  }}
                  data-testid="option-walkin"
                >
                  Regular Client
                </div>
              )}
              {!companyOnlyClientFilter && (
                <div
                  className="px-3 py-2.5 cursor-pointer hover:bg-accent font-medium text-violet-600 dark:text-violet-400 border-b"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSelectedClientId(null);
                    setIsWalkIn(false);
                    setIsBroker(true);
                    resetManualClientFields();
                    resetBrokerAddressState();
                    setCustomerName("Broker Client");
                    setCustomerPhone("");
                    setClientSearchTerm("");
                    setShowClientDropdown(false);
                    focusWalkInNameInput();
                  }}
                  data-testid="option-broker"
                >
                  Broker Client
                </div>
              )}
              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40 border-b">
                {clientListScopeLabel} {clientListModeLabel}
              </div>
              {clientSearchResults.length > 0 ? (
                clientSearchResults.map((client) => (
                  <div
                    key={client.id}
                    className="px-3 py-2.5 cursor-pointer hover:bg-accent/40 text-sm overflow-hidden group/client border-b last:border-b-0"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      handleUseExistingClient(client);
                      if (client.discountPercent)
                        setDiscountPercent(client.discountPercent);
                      setClientSearchTerm("");
                      setShowClientDropdown(false);
                    }}
                    data-testid={`option-client-${client.id}`}
                  >
                    <MarqueeText>
                      <span className="font-medium">{client.name}</span>
                      {isBrokerClient(client) && (
                        <Badge
                          variant="outline"
                          className="ml-1 h-4 border-violet-300 bg-violet-50 px-1.5 text-[9px] text-violet-700 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-300"
                        >
                          Broker Client
                        </Badge>
                      )}
                      {" - "}
                      {client.phone || "No phone"}
                      {isCompanyClient(client) && (
                        <span className="text-blue-600 dark:text-blue-400 text-xs ml-1">
                          | {(client as any).company}
                        </span>
                      )}
                      {client.address && (
                        <span className="text-muted-foreground text-xs ml-1">
                          | {client.address}
                        </span>
                      )}
                    </MarqueeText>
                  </div>
                ))
              ) : (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  No matching clients found
                </div>
              )}
            </div>
          )}
        </div>
        {(selectedClientId || isManualClientEntry) && (
          <div
            className={`rounded bg-muted/50 px-2 text-xs text-muted-foreground space-y-0.5 ${isPopup ? "py-1.5" : "py-1"}`}
          >
            {isManualClientEntry ? (
              <>
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className={
                      isManualBrokerEntry
                        ? "h-4 border-violet-300 bg-violet-50 px-1.5 text-[9px] text-violet-700 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-300"
                        : "h-4 border-blue-300 bg-blue-50 px-1.5 text-[9px] text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                    }
                  >
                    {manualClientLabel}
                  </Badge>
                  {isManualBrokerEntry && (
                    <Badge
                      variant="outline"
                      className="h-4 border-violet-200 bg-violet-50/70 px-1.5 text-[9px] text-violet-600 dark:border-violet-800 dark:bg-violet-950/20 dark:text-violet-300"
                    >
                      {manualBrokerAddresses.length}{" "}
                      {manualBrokerAddresses.length === 1
                        ? "Address"
                        : "Addresses"}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  <span
                    className={`font-medium ${isManualBrokerEntry ? "text-violet-600 dark:text-violet-400" : "text-foreground"}`}
                  >
                    {walkInName || "New Client Entry"}
                  </span>
                </div>
                {walkInPhone && (
                  <div className="flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    <span>{walkInPhone}</span>
                  </div>
                )}
                {walkInCompany && (
                  <div className="flex items-center gap-1">
                    <Building2 className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                    <span className="text-blue-600 dark:text-blue-400 font-medium">
                      {walkInCompany}
                    </span>
                  </div>
                )}
                {isManualBrokerEntry ? (
                  <div
                    className={`flex items-center gap-1 ${brokerDeliveryAddress ? "" : "text-amber-600 dark:text-amber-400"}`}
                  >
                    <MapPin className="w-3 h-3" />
                    <span>
                      {brokerDeliveryAddress ||
                        "Select the broker order address from the dropdown"}
                    </span>
                  </div>
                ) : (
                  walkInAddress && (
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      <span>{walkInAddress}</span>
                    </div>
                  )
                )}
              </>
            ) : isBrokerOrder && selectedClientId ? (
              <>
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="h-4 border-violet-300 bg-violet-50 px-1.5 text-[9px] text-violet-700 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-300"
                  >
                    Broker Client
                  </Badge>
                  <Badge
                    variant="outline"
                    className="h-4 border-violet-200 bg-violet-50/70 px-1.5 text-[9px] text-violet-600 dark:border-violet-800 dark:bg-violet-950/20 dark:text-violet-300"
                  >
                    {selectedBrokerAddresses.length}{" "}
                    {selectedBrokerAddresses.length === 1
                      ? "Address"
                      : "Addresses"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  <span className="font-medium text-violet-600 dark:text-violet-400">
                    {customerName}
                  </span>
                </div>
                {customerPhone && (
                  <div className="flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    <span>{customerPhone}</span>
                  </div>
                )}
                <div
                  className={`flex items-center gap-1 ${brokerDeliveryAddress ? "" : "text-amber-600 dark:text-amber-400"}`}
                >
                  <MapPin className="w-3 h-3" />
                  <span>
                    {brokerDeliveryAddress ||
                      "Select the broker order address from the dropdown"}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="h-4 border-blue-300 bg-blue-50 px-1.5 text-[9px] text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                  >
                    Regular Client
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  <span className="font-medium text-foreground">
                    {customerName}
                  </span>
                </div>
                {customerPhone && (
                  <div className="flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    <span>{customerPhone}</span>
                  </div>
                )}
                {selectedClient?.company ? (
                  <div className="flex items-center gap-1">
                    <Building2 className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                    <span className="text-blue-600 dark:text-blue-400 font-medium">
                      {selectedClient.company}
                    </span>
                  </div>
                ) : null}
                {selectedClient?.address ? (
                  <div className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    <span>{selectedClient.address}</span>
                  </div>
                ) : null}
              </>
            )}
            <div className="flex items-center gap-1">
              {!isManualClientEntry && selectedClientId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`h-5 px-1 text-xs ${selectedClientIsBroker ? "text-violet-600 dark:text-violet-400" : "text-blue-600 dark:text-blue-400"}`}
                  onClick={() => {
                    const c = clients?.find(
                      (cl: any) => cl.id === selectedClientId,
                    );
                    if (c) setEditClientDialog(c);
                  }}
                  data-testid="button-edit-client-order-slip"
                >
                  <Pencil className="w-3 h-3 mr-0.5" /> Edit
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-xs"
                onClick={() => {
                  setSelectedClientId(null);
                  setIsWalkIn(false);
                  setIsBroker(false);
                  resetManualClientFields();
                  resetBrokerAddressState();
                  setCustomerName("");
                  setCustomerPhone("");
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Manual Client Fields */}
      {isManualClientEntry && (
        <div className={manualClientCardClassName}>
          <div className={manualClientFieldClassName}>
            <Label className="text-xs font-semibold">Customer Name</Label>
            <Input
              ref={walkInNameInputRef}
              className={`h-8 text-xs ${manualClientInputSpacingClassName}`}
              placeholder="Enter name..."
              value={walkInName}
              onChange={(e) => {
                setWalkInName(e.target.value.toUpperCase());
                setCustomerName(
                  e.target.value.toUpperCase() || manualClientLabel,
                );
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  focusWalkInPhoneInput();
                }
              }}
              data-testid={
                isPopup
                  ? "popup-input-walkin-name"
                  : "sidebar-input-walkin-name"
              }
            />
          </div>
          <div className={manualClientFieldClassName}>
            <Label className="text-xs font-semibold">Phone Number</Label>
            <div
              className={`flex flex-col gap-1 ${manualClientInputSpacingClassName}`}
            >
              <InternationalPhoneInput
                value={walkInPhone}
                onChange={setWalkInPhone}
                inputRef={walkInPhoneInputRef}
                onInputKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    focusWalkInAddressInput();
                  }
                }}
                placeholder="Phone number"
                inputTestId={
                  isPopup
                    ? "popup-input-walkin-phone"
                    : "sidebar-input-walkin-phone"
                }
                selectTestId={
                  isPopup
                    ? "popup-select-walkin-phone-country"
                    : "sidebar-select-walkin-phone-country"
                }
                wrapperClassName={
                  compactSidebarClientForm ? "mt-0 min-w-0 gap-1" : "mt-0"
                }
                selectClassName={
                  compactSidebarClientForm
                    ? "h-8 w-[5.25rem] px-2 text-[11px]"
                    : "h-8 text-xs"
                }
                inputClassName={`h-8 min-w-0 px-2 text-xs ${isPlausiblePhoneNumber(walkInPhone) ? "border-green-500 focus-visible:ring-green-500" : ""} ${clientMatch ? "border-red-500 ring-2 ring-red-300" : ""}`}
              />
              {isPlausiblePhoneNumber(walkInPhone) ? (
                <p
                  className={`${manualClientPhoneHintClassName} font-medium text-green-600`}
                >
                  {compactSidebarClientForm
                    ? "Looks valid."
                    : "Phone number looks valid"}
                </p>
              ) : hasPhoneDigits(walkInPhone) ? (
                <p className={`${manualClientPhoneHintClassName} text-amber-600`}>
                  {compactSidebarClientForm
                    ? "Finish the full phone number."
                    : "Finish entering the international phone number."}
                </p>
              ) : (
                <p
                  className={`${manualClientPhoneHintClassName} text-muted-foreground`}
                >
                  {compactSidebarClientForm
                    ? "Default: UAE +971."
                    : "UAE +971 is default. Pick another country flag if needed."}
                </p>
              )}
            </div>
          </div>
          {clientMatch && (
            <div
              className={`${compactSidebarClientForm ? "col-span-2 " : ""}rounded-lg border border-red-500 bg-red-100 p-2 text-xs dark:bg-red-950`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                <div className="flex-1">
                  <p className="font-bold text-red-700 dark:text-red-300">
                    {clientMatch.message}: {clientMatch.client.name}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-1 text-xs h-7 bg-red-50 dark:bg-red-900 border-red-300"
                    onClick={() => handleUseExistingClient(clientMatch.client)}
                  >
                    Use existing: {clientMatch.client.name}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {isManualBrokerEntry ? (
            <div className="space-y-2 border rounded-lg p-3 bg-violet-50/50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                  Delivery Addresses
                </Label>
                {brokerAddressOptions.length > 0 && (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-violet-500 dark:text-violet-400">
                    {brokerAddressOptions.length} saved
                  </span>
                )}
              </div>
              {brokerAddressOptions.length > 0 ? (
                <div className="space-y-1.5">
                  <Select
                    value={brokerDeliveryAddress || undefined}
                    onValueChange={handleSelectBrokerAddress}
                  >
                    <SelectTrigger
                      className="h-8 text-xs"
                      data-testid="select-manual-broker-address"
                    >
                      <SelectValue placeholder="Choose delivery address" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {brokerAddressOptions.map((addr, idx) => (
                        <SelectItem
                          key={`${addr}-${idx}`}
                          value={addr}
                          className="text-xs whitespace-normal break-words leading-4"
                          data-testid={`manual-broker-address-option-${idx}`}
                        >
                          {addr}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {brokerDeliveryAddress && (
                    <div className="rounded-md border border-violet-200 bg-background/80 px-2 py-2 text-xs text-violet-700 dark:border-violet-800 dark:bg-background/40 dark:text-violet-200">
                      <div className="flex items-center gap-1 text-[11px] font-medium">
                        <MapPin className="w-3 h-3" />
                        <span>Selected Address</span>
                      </div>
                      <div className="mt-1 break-words leading-4">
                        {brokerDeliveryAddress}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-violet-300 bg-background/70 px-2 py-2 text-xs text-violet-700 dark:border-violet-700 dark:text-violet-300">
                  Add at least one delivery address for this broker client.
                </div>
              )}
              {!showAddNewBrokerAddress ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 w-full text-xs text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-700 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                  onClick={() => {
                    setShowAddNewBrokerAddress(true);
                    setNewBrokerAddress("");
                  }}
                  data-testid="btn-add-manual-broker-address"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add Delivery Address
                </Button>
              ) : (
                <div className="flex gap-1.5">
                  <Input
                    className="h-7 text-xs flex-1"
                    placeholder="Enter delivery address..."
                    value={newBrokerAddress}
                    onChange={(e) =>
                      setNewBrokerAddress(e.target.value.toUpperCase())
                    }
                    autoFocus
                    data-testid="input-manual-broker-address"
                  />
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="h-7 px-2 text-xs bg-violet-600 hover:bg-violet-700"
                    disabled={!newBrokerAddress.trim()}
                    onClick={handleAddManualBrokerAddress}
                    data-testid="btn-save-manual-broker-address"
                  >
                    <Check className="w-3 h-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setShowAddNewBrokerAddress(false);
                      setNewBrokerAddress("");
                    }}
                    data-testid="btn-cancel-manual-broker-address"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className={manualClientFieldClassName}>
              <Label className="text-xs font-semibold">
                Address <span className="text-destructive">*</span>
              </Label>
              <Input
                ref={walkInAddressInputRef}
                className={`h-8 text-xs ${manualClientInputSpacingClassName}`}
                placeholder="Enter address..."
                value={walkInAddress}
                onChange={(e) => setWalkInAddress(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (showNewCompanyInput) {
                      focusWalkInNewCompanyInput();
                    } else {
                      walkInCompanySelectRef.current?.focus();
                    }
                  }
                }}
                data-testid={
                  isPopup
                    ? "popup-input-walkin-address"
                    : "sidebar-input-walkin-address"
                }
              />
            </div>
          )}
          <div className={manualClientFieldClassName}>
            <Label className="text-xs font-semibold">Company (Optional)</Label>
            <select
              ref={walkInCompanySelectRef}
              value={showNewCompanyInput ? "__new__" : walkInCompany}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  setShowNewCompanyInput(true);
                  setNewCompanyInput("");
                  setWalkInCompany("");
                  focusWalkInNewCompanyInput();
                } else {
                  setShowNewCompanyInput(false);
                  setNewCompanyInput("");
                  setWalkInCompany(e.target.value);
                }
              }}
              className={`flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${manualClientInputSpacingClassName}`}
              data-testid={
                isPopup
                  ? "popup-select-walkin-company"
                  : "sidebar-select-walkin-company"
              }
            >
              <option value="">No Company</option>
              {existingCompanies.map((company) => (
                <option key={company} value={company}>
                  {company}
                </option>
              ))}
              <option value="__new__">+ Add New Company</option>
            </select>
            {showNewCompanyInput && (
              <Input
                ref={walkInNewCompanyInputRef}
                placeholder="Enter company name"
                value={newCompanyInput}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  setNewCompanyInput(val);
                  setWalkInCompany(val);
                }}
                className={`h-8 text-xs uppercase ${manualClientInputSpacingClassName}`}
                data-testid={
                  isPopup
                    ? "popup-input-walkin-company-new"
                    : "sidebar-input-walkin-company-new"
                }
              />
            )}
          </div>
        </div>
      )}

      {isBrokerOrder && selectedClientId && (
        <div className="space-y-2 border rounded-lg p-3 bg-violet-50/50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800">
          {(() => {
            const selectedBroker = selectedClient;
            const savedAddresses: string[] =
              (selectedBroker as any)?.brokerAddresses || [];
            return (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                    Delivery Address for this Order
                  </Label>
                  {savedAddresses.length > 0 && (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-violet-500 dark:text-violet-400">
                      {savedAddresses.length} saved
                    </span>
                  )}
                </div>
                {savedAddresses.length > 0 && (
                  <div className="mt-1 space-y-1.5">
                    <Select
                      value={brokerDeliveryAddress || undefined}
                      onValueChange={handleSelectBrokerAddress}
                    >
                      <SelectTrigger
                        className="h-8 text-xs"
                        data-testid="select-broker-address"
                      >
                        <SelectValue placeholder="Choose delivery address" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {savedAddresses.map((addr, idx) => (
                          <SelectItem
                            key={`${addr}-${idx}`}
                            value={addr}
                            className="text-xs whitespace-normal break-words leading-4"
                            data-testid={`broker-address-option-${idx}`}
                          >
                            {addr}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {brokerDeliveryAddress && (
                      <div className="rounded-md border border-violet-200 bg-background/80 px-2 py-2 text-xs text-violet-700 dark:border-violet-800 dark:bg-background/40 dark:text-violet-200">
                        <div className="flex items-center gap-1 text-[11px] font-medium">
                          <MapPin className="w-3 h-3" />
                          <span>Selected Address</span>
                        </div>
                        <div className="mt-1 break-words leading-4">
                          {brokerDeliveryAddress}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {!showAddNewBrokerAddress ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1.5 h-7 text-xs text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-700 hover:bg-violet-50 dark:hover:bg-violet-950/30 w-full"
                    onClick={() => {
                      setShowAddNewBrokerAddress(true);
                      setBrokerDeliveryAddress("");
                    }}
                    data-testid="btn-add-broker-address"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add New Address
                  </Button>
                ) : (
                  <div className="mt-1.5 flex gap-1.5">
                    <Input
                      className="h-7 text-xs flex-1"
                      placeholder="Enter new delivery address..."
                      value={newBrokerAddress}
                      onChange={(e) =>
                        setNewBrokerAddress(e.target.value.toUpperCase())
                      }
                      autoFocus
                      data-testid="input-new-broker-address"
                    />
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="h-7 px-2 text-xs bg-violet-600 hover:bg-violet-700"
                      disabled={!newBrokerAddress.trim()}
                      onClick={async () => {
                        if (!newBrokerAddress.trim() || !selectedClientId)
                          return;
                        try {
                          const response = await apiRequest(
                            "POST",
                            `/api/clients/${selectedClientId}/broker-address`,
                            { address: newBrokerAddress.trim() },
                          );
                          const updatedClient =
                            (await response.json()) as Client;
                          syncClientInCache(updatedClient);
                          queryClient.invalidateQueries({
                            queryKey: ["/api/clients"],
                          });
                          setBrokerDeliveryAddress(
                            newBrokerAddress.trim().toUpperCase(),
                          );
                          setNewBrokerAddress("");
                          setShowAddNewBrokerAddress(false);
                        } catch (err) {
                          console.error("Failed to save broker address:", err);
                        }
                      }}
                      data-testid="btn-save-broker-address"
                    >
                      <Check className="w-3 h-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setShowAddNewBrokerAddress(false);
                        setNewBrokerAddress("");
                      }}
                      data-testid="btn-cancel-broker-address"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {/* Items Table */}
        {(orderItems.length > 0 || customItems.length > 0) && (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr className="border-b">
              <th className="text-left py-2 px-2 font-bold">Item</th>
              <th className="text-center py-2 px-1 font-bold">Qty</th>
              <th className="text-right py-2 px-1 font-bold">Unit</th>
              <th className="text-right py-2 px-1 font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {orderItems.map((item, idx) => {
              let basePrice: number;
              let displayPrice: number;

              const carpetPriceKey = item.product.isSqmPriced
                ? `carpet-${idx}`
                : "";
              if (item.product.isSqmPriced && item.sqm) {
                const sqmPrice = parseFloat(
                  item.product.sqmPrice || item.product.price || "12",
                );
                const calcPrice = item.sqm * sqmPrice;
                displayPrice =
                  item.sqm < 5 ? Math.max(50, calcPrice) : calcPrice;
                basePrice = displayPrice;
              } else if (item.serviceType === "iron") {
                const itemUrgent = orderType === "urgent" || !!item.isUrgent;
                if (itemUrgent) {
                  basePrice = parseFloat(
                    item.product.urgentIronOnlyPrice ||
                      String(
                        parseFloat(
                          item.product.ironOnlyPrice ||
                            item.product.price ||
                            "0",
                        ) * 2,
                      ),
                  );
                } else {
                  basePrice = parseFloat(
                    item.product.ironOnlyPrice || item.product.price || "0",
                  );
                }
                displayPrice = basePrice;
              } else if (item.serviceType === "dc") {
                const itemUrgent = orderType === "urgent" || !!item.isUrgent;
                if (itemUrgent) {
                  basePrice = parseFloat(
                    item.product.urgentDryCleanPrice ||
                      String(
                        parseFloat(
                          item.product.dryCleanPrice ||
                            item.product.price ||
                            "0",
                        ) * 2,
                      ),
                  );
                } else {
                  basePrice = parseFloat(
                    item.product.dryCleanPrice || item.product.price || "0",
                  );
                }
                displayPrice = basePrice;
              } else {
                const itemUrgent = orderType === "urgent" || !!item.isUrgent;
                const normalPrice = parseFloat(item.product.price || "0");
                if (itemUrgent) {
                  basePrice = parseFloat(
                    item.product.urgentPrice || String(normalPrice * 2),
                  );
                } else {
                  basePrice = normalPrice;
                }
                displayPrice = basePrice;
              }
              const itemUrgentForKey =
                orderType === "urgent" || !!item.isUrgent;
              const priceKey = item.product.isSqmPriced
                ? carpetPriceKey
                : `${item.product.id}-${item.serviceType}-${itemUrgentForKey ? "urgent" : "normal"}`;
              const unitPrice =
                customPrices[priceKey] !== undefined
                  ? customPrices[priceKey]
                  : basePrice;
              const itemPrice = item.product.isSqmPriced
                ? customPrices[carpetPriceKey] !== undefined
                  ? customPrices[carpetPriceKey] * item.quantity
                  : displayPrice * item.quantity
                : unitPrice * item.quantity;
              const hasCustomPrice = item.product.isSqmPriced
                ? customPrices[carpetPriceKey] !== undefined
                : customPrices[priceKey] !== undefined;
              const bgClass =
                item.serviceType === "iron"
                  ? "bg-orange-50 dark:bg-orange-900/20"
                  : item.serviceType === "dc"
                    ? "bg-purple-50 dark:bg-purple-900/20"
                    : "";
              const itemKey = item.product.isSqmPriced
                ? `carpet-${idx}`
                : `${item.product.id}-${item.serviceType}${item.isUrgent ? "-urg" : ""}`;
              const carpetIndex = item.product.isSqmPriced
                ? orderItems.filter((o, i) => o.product.isSqmPriced && i <= idx)
                    .length
                : 0;
              const displayName =
                item.product.isSqmPriced && item.sqm
                  ? `Carpet #${carpetIndex} (${item.sqm}sqm)`
                  : item.product.name;
              return (
                <tr key={itemKey} className={`border-b ${bgClass}`}>
                  <td className="py-2 px-2 font-medium">
                    {displayName}
                    {item.serviceType === "dc" && (
                      <span className="ml-1 text-[9px] bg-purple-600 text-white px-1 rounded">
                        DC
                      </span>
                    )}
                    {item.serviceType === "iron" && (
                      <span className="ml-1 text-[9px] bg-orange-500 text-white px-1 rounded">
                        IO
                      </span>
                    )}
                    {(item.isUrgent || orderType === "urgent") && (
                      <span className="ml-1 text-[9px] bg-red-500 text-white px-1 rounded">
                        URG
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-1 text-center font-bold">
                    {item.product.isSqmPriced ? (
                      <input
                        type="text"
                        inputMode="numeric"
                        data-testid={`input-qty-carpet-${idx}`}
                        value={item.quantity}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "");
                          const newQty =
                            val === "" ? 0 : Math.max(0, parseInt(val));
                          const carpetEntry = carpetEntries.find(
                            (ce) =>
                              ce.productId === item.product.id &&
                              ce.sqm === item.sqm &&
                              ce.serviceType === item.serviceType,
                          );
                          if (!carpetEntry) return;
                          const matchingEntries = carpetEntries.filter(
                            (ce) =>
                              ce.productId === item.product.id &&
                              ce.sqm === item.sqm &&
                              ce.serviceType === item.serviceType,
                          );
                          const currentCount = matchingEntries.length;
                          if (newQty === 0) {
                            setCarpetEntries((prev) =>
                              prev.filter(
                                (ce) =>
                                  !(
                                    ce.productId === item.product.id &&
                                    ce.sqm === item.sqm &&
                                    ce.serviceType === item.serviceType
                                  ),
                              ),
                            );
                          } else if (newQty > currentCount) {
                            const toAdd = newQty - currentCount;
                            const newEntries = Array.from(
                              { length: toAdd },
                              () => ({
                                id: `carpet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                                productId: item.product.id,
                                sqm: item.sqm!,
                                serviceType: item.serviceType as
                                  | "normal"
                                  | "dc"
                                  | "iron",
                              }),
                            );
                            setCarpetEntries((prev) => [
                              ...prev,
                              ...newEntries,
                            ]);
                          } else if (newQty < currentCount) {
                            const toRemove = currentCount - newQty;
                            let removed = 0;
                            setCarpetEntries((prev) =>
                              prev.filter((ce) => {
                                if (
                                  removed < toRemove &&
                                  ce.productId === item.product.id &&
                                  ce.sqm === item.sqm &&
                                  ce.serviceType === item.serviceType
                                ) {
                                  removed++;
                                  return false;
                                }
                                return true;
                              }),
                            );
                          }
                        }}
                        className="w-10 text-center font-bold px-0 py-0.5 rounded border bg-transparent border-transparent text-xs focus:border-blue-300 focus:bg-blue-50 dark:focus:bg-blue-900/30"
                      />
                    ) : (
                      <input
                        type="text"
                        inputMode="numeric"
                        data-testid={`input-qty-${item.product.id}-${item.serviceType}`}
                        value={item.quantity}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "");
                          const newQty = val === "" ? 0 : parseInt(val);
                          const productId = item.product.id;
                          const currentTotal = quantities[productId] || 0;
                          const currentServiceQty = item.quantity;
                          const otherServicesQty =
                            currentTotal - currentServiceQty;
                          const newTotal = otherServicesQty + newQty;
                          if (newTotal <= 0) {
                            setQuantities((prev) => {
                              const { [productId]: _, ...rest } = prev;
                              return rest;
                            });
                          } else {
                            setQuantities((prev) => ({
                              ...prev,
                              [productId]: newTotal,
                            }));
                          }
                          if (item.serviceType === "dc") {
                            setDcQuantities((prev) => ({
                              ...prev,
                              [productId]: newQty,
                            }));
                          } else if (item.serviceType === "iron") {
                            setIronQuantities((prev) => ({
                              ...prev,
                              [productId]: newQty,
                            }));
                          }
                        }}
                        className="w-10 text-center font-bold px-0 py-0.5 rounded border bg-transparent border-transparent text-xs focus:border-blue-300 focus:bg-blue-50 dark:focus:bg-blue-900/30"
                      />
                    )}
                  </td>
                  <td className="py-1 px-1 text-right">
                    {item.product.isSqmPriced ? (
                      <span className="text-muted-foreground text-[10px]">
                        {item.sqm}sqm
                      </span>
                    ) : (
                      <input
                        type="number"
                        data-testid={`input-price-${item.product.id}`}
                        value={unitPrice}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setCustomPrices((prev) => ({
                            ...prev,
                            [priceKey]: val,
                          }));
                        }}
                        className={`w-14 text-right font-medium px-1 py-0.5 rounded border text-[11px] ${hasCustomPrice ? "bg-blue-50 dark:bg-blue-900/30 border-blue-300" : "bg-transparent border-transparent"}`}
                        min="0"
                        step="0.5"
                      />
                    )}
                  </td>
                  <td className="py-1 px-1 text-right">
                    {item.product.isSqmPriced ? (
                      <input
                        type="number"
                        data-testid={`input-carpet-price-${idx}`}
                        value={itemPrice}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setCustomPrices((prev) => ({
                            ...prev,
                            [carpetPriceKey]: val,
                          }));
                        }}
                        className={`w-16 text-right font-bold px-1 py-0.5 rounded border text-sm ${hasCustomPrice ? "bg-blue-50 dark:bg-blue-900/30 border-blue-300" : "bg-transparent border-transparent"}`}
                        min="0"
                        step="1"
                      />
                    ) : (
                      <input
                        type="number"
                        data-testid={`input-item-total-${item.product.id}`}
                        value={itemPrice}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const newUnit =
                            item.quantity > 0 ? val / item.quantity : 0;
                          setCustomPrices((prev) => ({
                            ...prev,
                            [priceKey]: newUnit,
                          }));
                        }}
                        className={`w-16 text-right font-bold px-1 py-0.5 rounded border text-sm ${hasCustomPrice ? "bg-blue-50 dark:bg-blue-900/30 border-blue-300" : "bg-transparent border-transparent"}`}
                        min="0"
                        step="0.5"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
            {customItems.map((item, idx) => (
              <tr
                key={`custom-${idx}`}
                className={`border-b ${item.isUrgent ? "bg-red-50 dark:bg-red-900/20" : "bg-amber-50 dark:bg-amber-900/20"}`}
              >
                <td className="py-2 px-2 font-medium">
                  <div className="flex items-center gap-1 flex-wrap">
                    {item.name}
                    {item.serviceType === "iron" && (
                      <span className="text-[9px] bg-orange-500 text-white px-1 rounded">
                        IO
                      </span>
                    )}
                    {item.serviceType === "dc" && (
                      <span className="text-[9px] bg-purple-600 text-white px-1 rounded">
                        DC
                      </span>
                    )}
                    {(item.isUrgent || orderType === "urgent") && (
                      <span className="text-[9px] bg-red-500 text-white px-1 rounded">
                        URG
                      </span>
                    )}
                    <button
                      onClick={() => removeCustomItem(idx)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </td>
                <td className="py-2 px-1 text-center font-bold">
                  <input
                    type="text"
                    inputMode="numeric"
                    data-testid={`input-custom-qty-${idx}`}
                    value={item.quantity}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "");
                      const newQty =
                        val === "" ? 1 : Math.max(1, parseInt(val));
                      setCustomItems((prev) =>
                        prev.map((ci, i) =>
                          i === idx ? { ...ci, quantity: newQty } : ci,
                        ),
                      );
                    }}
                    className="w-10 text-center font-bold px-0 py-0.5 rounded border bg-transparent border-transparent text-xs focus:border-blue-300 focus:bg-blue-50 dark:focus:bg-blue-900/30"
                  />
                </td>
                <td className="py-1 px-1 text-right">
                  {(() => {
                    const isItemUrg = orderType === "urgent" || !!item.isUrgent;
                    let displayUnitPrice = item.price;
                    if (!item.priceEdited) {
                      if (item.serviceType === "iron") {
                        const ioPrice = item.ironOnlyPrice || item.price;
                        displayUnitPrice = isItemUrg
                          ? item.urgentIronOnlyPrice || ioPrice * 2
                          : ioPrice;
                      } else if (item.serviceType === "dc") {
                        const dcPrice = item.dryCleanPrice || item.price;
                        displayUnitPrice = isItemUrg
                          ? item.urgentDryCleanPrice || dcPrice * 2
                          : dcPrice;
                      } else {
                        if (isItemUrg)
                          displayUnitPrice = item.urgentPrice || item.price * 2;
                      }
                    }
                    return (
                      <input
                        type="number"
                        data-testid={`input-custom-price-${idx}`}
                        value={displayUnitPrice}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setCustomItems((prev) =>
                            prev.map((ci, i) =>
                              i === idx
                                ? { ...ci, price: val, priceEdited: true }
                                : ci,
                            ),
                          );
                        }}
                        className="w-14 text-right font-medium px-1 py-0.5 rounded border bg-transparent border-transparent text-[11px] focus:border-blue-300 focus:bg-blue-50 dark:focus:bg-blue-900/30"
                        min="0"
                        step="0.5"
                      />
                    );
                  })()}
                </td>
                <td className="py-1 px-1 text-right">
                  {(() => {
                    const isItemUrg = orderType === "urgent" || !!item.isUrgent;
                    let unitPrice = item.price;
                    if (!item.priceEdited) {
                      if (item.serviceType === "iron") {
                        const ioPrice = item.ironOnlyPrice || item.price;
                        unitPrice = isItemUrg
                          ? item.urgentIronOnlyPrice || ioPrice * 2
                          : ioPrice;
                      } else if (item.serviceType === "dc") {
                        const dcPrice = item.dryCleanPrice || item.price;
                        unitPrice = isItemUrg
                          ? item.urgentDryCleanPrice || dcPrice * 2
                          : dcPrice;
                      } else {
                        if (isItemUrg)
                          unitPrice = item.urgentPrice || item.price * 2;
                      }
                    }
                    const total = unitPrice * item.quantity;
                    return (
                      <input
                        type="number"
                        data-testid={`input-custom-total-${idx}`}
                        value={total}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          let newUnit =
                            item.quantity > 0 ? val / item.quantity : 0;
                          setCustomItems((prev) =>
                            prev.map((ci, i) =>
                              i === idx ? { ...ci, price: newUnit } : ci,
                            ),
                          );
                        }}
                        className="w-16 text-right font-bold px-1 py-0.5 rounded border bg-transparent border-transparent text-sm focus:border-blue-300 focus:bg-blue-50 dark:focus:bg-blue-900/30"
                        min="0"
                        step="0.5"
                      />
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
          {(orderItems.length > 0 || customItems.length > 0) && (
            <tfoot>
              <tr className="bg-muted/50 font-bold text-xs">
                <td className="py-2 px-2">Total</td>
                <td
                  className="py-2 px-1 text-center"
                  data-testid="text-total-quantity"
                >
                  {orderItems.reduce((sum, item) => sum + item.quantity, 0) +
                    customItems.reduce((sum, item) => sum + item.quantity, 0)}
                </td>
                <td className="py-2 px-1"></td>
                <td
                  className="py-2 px-1 text-right"
                  data-testid="text-total-price"
                >
                  {orderTotal.toFixed(0)}
                </td>
              </tr>
            </tfoot>
          )}
            </table>
          </div>
        </div>
        )}

        {/* Empty state */}
        {orderItems.length === 0 && customItems.length === 0 && (
        <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
          <ShoppingCart className="w-10 h-10 mx-auto mb-1 opacity-30" />
          <p className="text-sm">No items added yet</p>
          <p className="text-xs">Tap items to add them</p>
        </div>
        )}
      </div>

      <div className="shrink-0 space-y-1.5 border-t bg-background/95 pt-2">

      {/* Totals */}
        <div className="border rounded-lg px-2 py-1.5 space-y-0.5 bg-muted/30">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <div className="flex min-w-0 items-center gap-2">
              <span>Subtotal</span>
              <label
                className="flex items-center gap-1 text-[11px] font-medium text-green-700 dark:text-green-400 cursor-pointer"
                data-testid="label-apply-discount"
              >
                <input
                  type="checkbox"
                  checked={applyDiscount}
                  onChange={(e) => setApplyDiscount(e.target.checked)}
                  className="h-3 w-3 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  data-testid="checkbox-apply-discount"
                />
                Apply Discount
              </label>
            </div>
            <span className="font-semibold">{orderTotal.toFixed(2)} AED</span>
          </div>
          <div className="flex min-h-0 justify-end">
            {applyDiscount && (
              <Input
                ref={discountAmountInputRef}
                type="number"
                min="0"
                step="0.01"
                max={maxFlatDiscountAmount.toFixed(2)}
                placeholder="0.00"
                value={discountAmount}
                onChange={(e) => {
                  const nextDiscountAmount = e.target.value;
                  if (!nextDiscountAmount) {
                    setDiscountAmount("");
                    return;
                  }

                  const parsedDiscountAmount = Number(nextDiscountAmount);
                  if (!Number.isFinite(parsedDiscountAmount)) return;

                  const clampedDiscountAmount = Math.min(
                    Math.max(0, parsedDiscountAmount),
                    maxFlatDiscountAmount,
                  );
                  setDiscountAmount(
                    clampedDiscountAmount === parsedDiscountAmount
                      ? nextDiscountAmount
                      : formatCompactAmount(clampedDiscountAmount),
                  );
                }}
                className="h-6 w-20 py-0.5 text-xs border-green-300 focus:border-green-500"
                data-testid="input-discount-amount"
              />
            )}
          </div>
          {applyDiscount && appliedFlatDiscountAmount > 0 && (
            <div className="flex justify-between text-[11px] text-green-600">
              <span>Discount</span>
              <span>-{appliedFlatDiscountAmount.toFixed(2)} AED</span>
            </div>
          )}
          {clientDiscountAmount > 0 && (
            <div className="flex justify-between text-[11px] text-green-600">
              <span>Client Discount ({discountPercent}%)</span>
              <span>-{clientDiscountAmount.toFixed(2)} AED</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-[11px] text-blue-600">
            <div className="flex min-w-0 items-center gap-2">
              <Switch
                checked={applyDeliveryCharge}
                onCheckedChange={(checked) => {
                  const enabled = checked === true;
                  setApplyDeliveryCharge(enabled);
                  if (!enabled) {
                    setDeliveryCharge("");
                  }
                }}
                className="h-4 w-7 shrink-0 border-0 shadow-none transition-colors duration-200 ease-out [&>span]:h-3 [&>span]:w-3 [&>span]:bg-white [&>span]:shadow-sm [&>span]:transition-transform [&>span]:duration-200 [&>span]:ease-out [&>span[data-state=checked]]:translate-x-3 data-[state=checked]:bg-blue-500 data-[state=unchecked]:bg-blue-100"
                data-testid={
                  isPopup
                    ? "popup-switch-delivery-charge"
                    : "sidebar-switch-delivery-charge"
                }
                aria-label="Delivery Charge"
              />
              <Label
                className="cursor-pointer truncate font-medium"
                onClick={() => {
                  setApplyDeliveryCharge((current) => {
                    const next = !current;
                    if (!next) {
                      setDeliveryCharge("");
                    }
                    return next;
                  });
                }}
              >
                Delivery Charge
              </Label>
            </div>
            {applyDeliveryCharge && (
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={deliveryCharge}
                onChange={(e) => setDeliveryCharge(e.target.value)}
                className="h-6 w-20 py-0.5 text-xs border-blue-300 text-right focus:border-blue-500"
                data-testid="input-delivery-charge"
              />
            )}
          </div>
          {deliveryChargeAmount > 0 && (
            <div className="flex justify-between text-[11px] text-blue-600">
              <span>Delivery Charge</span>
              <span>+{deliveryChargeAmount.toFixed(2)} AED</span>
            </div>
          )}
          {parseFloat(tips) > 0 && (
            <div className="flex justify-between text-[11px] text-blue-600">
              <span>Tips</span>
              <span>+{parseFloat(tips).toFixed(2)} AED</span>
            </div>
          )}
          <div className="flex justify-between text-xs font-bold text-primary border-t pt-1 mt-1">
            <span>TOTAL</span>
            <span
              className="font-semibold"
              data-testid="text-order-final-total"
            >
              {(() => {
                if (adjustedOrderTotal != null) {
                  return parseFloat(adjustedOrderTotal).toFixed(2);
                }
                return currentOrderFinalTotal.toFixed(2);
              })()}{" "}
              AED
            </span>
          </div>
          {adjustedOrderTotal != null && adjustOrderReason && (
            <div className="flex items-center gap-1 text-[10px] text-orange-600 dark:text-orange-400 mt-1">
              <Edit className="w-3 h-3" />
              <span>Adjusted: {adjustOrderReason}</span>
              <button
                type="button"
                className="ml-auto text-destructive hover:underline text-[10px]"
                onClick={() => {
                  setAdjustedOrderTotal(null);
                  setAdjustOrderReason("");
                }}
                data-testid="button-remove-adjustment"
              >
                Remove
              </button>
            </div>
          )}
        </div>

      {/* Order and Delivery Toggles */}
      <div className="grid grid-cols-2 gap-1">
        <Button
          variant={orderType === "normal" ? "default" : "outline"}
          className="h-7 text-[11px]"
          onClick={() => setOrderType("normal")}
          data-testid="button-order-normal"
        >
          <Clock className="w-3 h-3 mr-1" /> Normal
        </Button>
        <Button
          variant={orderType === "urgent" ? "default" : "outline"}
          className={`h-7 text-[11px] ${
            orderType === "urgent"
              ? "border-red-600 bg-red-600 text-white hover:bg-red-700 dark:border-red-500 dark:bg-red-600 dark:text-white dark:hover:bg-red-700"
              : "border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/70 dark:text-red-400 dark:hover:bg-red-950/30"
          }`}
          onClick={() => setOrderType("urgent")}
          data-testid="button-order-urgent"
        >
          <Zap className="w-3 h-3 mr-1" /> Urgent
        </Button>
        <Button
          variant={deliveryType === "pickup" ? "default" : "outline"}
          className="h-7 text-[11px]"
          onClick={() => setDeliveryType("pickup")}
        >
          <Package className="w-3 h-3 mr-1" /> Takeaway
        </Button>
        <Button
          variant={deliveryType === "delivery" ? "default" : "outline"}
          className={`h-7 text-[11px] ${
            deliveryType === "delivery"
              ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 dark:border-emerald-500 dark:bg-emerald-600 dark:text-white dark:hover:bg-emerald-700"
              : "border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:border-muted disabled:text-muted-foreground dark:border-emerald-900/70 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
          }`}
          disabled={!canChooseDelivery}
          onClick={() => setDeliveryType("delivery")}
          title={
            !canChooseDelivery
              ? "Add or select an address to enable delivery"
              : undefined
          }
        >
          <Truck className="w-3 h-3 mr-1" /> Delivery
        </Button>
      </div>
      {(selectedClientId || isManualClientEntry) && !canChooseDelivery && (
        <p className="text-[10px] leading-tight text-muted-foreground">
          Add or select an address to enable delivery.
        </p>
      )}

      {/* Expected Pickup/Delivery Date */}
      <div className="space-y-0.5">
        <Label className="text-[11px] font-semibold">
          {deliveryType === "pickup" ? "Takeaway" : "Delivery"} Date / Time
        </Label>
        <div className="relative flex items-center justify-center gap-1 pr-7">
          <CenteredDatePicker
            value={expectedDeliveryAt?.split("T")[0] || ""}
            onChange={(date) => {
              const time = expectedDeliveryAt?.split("T")[1];
              setExpectedDeliveryAt(time ? `${date}T${time}` : date);
            }}
            testIdPrefix={isPopup ? "popup-" : "sidebar-"}
            floatingBoundarySelector="[data-clock-overlay-root]"
            triggerClassName="h-7 w-[124px] justify-center px-1 text-[11px]"
            triggerTestId={
              isPopup ? "popup-input-custom-date" : "sidebar-input-custom-date"
            }
          />
          <AnalogClockPicker
            value={expectedDeliveryAt?.split("T")[1] || ""}
            onChange={(time) => {
              const date =
                expectedDeliveryAt?.split("T")[0] ||
                format(new Date(), "yyyy-MM-dd");
              if (time) {
                setExpectedDeliveryAt(`${date}T${time}`);
              } else {
                setExpectedDeliveryAt(date);
              }
            }}
            testIdPrefix={isPopup ? "popup-" : "sidebar-"}
            floatingPlacement="container-center"
            floatingBoundarySelector="[data-clock-overlay-root]"
            triggerClassName="h-7 w-[88px] justify-center px-1 text-[11px]"
          />
          {expectedDeliveryAt && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-0 top-1/2 h-7 w-6 -translate-y-1/2 px-0 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => setExpectedDeliveryAt("")}
              data-testid={
                isPopup
                  ? "popup-button-clear-date"
                  : "sidebar-button-clear-date"
              }
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Bulk Service Type Buttons */}
        <div className="grid grid-cols-2 gap-1">
            <Button
              type="button"
              variant={isIronOnlyAllSelected ? "default" : "outline"}
              className={getBulkToggleButtonClassName(
                isIronOnlyAllSelected,
                "bg-orange-500 hover:bg-orange-600 border-orange-500 text-white",
                "border-orange-300 text-orange-600 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/40",
              )}
              data-testid={
                isPopup ? "popup-button-iron-all" : "sidebar-button-iron-all"
              }
              onClick={() => {
                if (isIronOnlyAllSelected) {
                  setDefaultBulkServiceType("normal");
                  if (!hasBulkServiceTargets) return;
                  setIronQuantities((prev) =>
                    clearSelectedProductIdsFromServiceQuantities(prev),
                  );
                  setCustomItems((prev) => resetCustomItemsToNormal(prev));
                  setCarpetEntries((prev) =>
                    prev.map((entry) => ({ ...entry, serviceType: "normal" })),
                  );
                  toast({
                    title: "Updated",
                    description: "Iron Only removed from all items.",
                  });
                  return;
                }

                setDefaultBulkServiceType("normal");
                if (!hasBulkServiceTargets) return;

                const newIron: Record<number, number> = {};
                Object.entries(quantities).forEach(([pid, qty]) => {
                  const id = parseInt(pid);
                  const product = allProducts?.find((p) => p.id === id);
                  if (product && !product.isSqmPriced && qty > 0) {
                    newIron[id] = qty;
                  }
                });
                setIronQuantities(newIron);
                setDcQuantities({});
                setCustomItems((prev) =>
                  applyBulkServiceTypeToCustomItems(prev, "iron"),
                );
                setCarpetEntries((prev) =>
                  prev.map((entry) => ({ ...entry, serviceType: "iron" })),
                );
                toast({
                  title: "Updated",
                  description: "All items set to Iron Only.",
                });
              }}
            >
              Iron Only All
            </Button>
            <Button
              type="button"
              variant={isDryCleanAllSelected ? "default" : "outline"}
              className={getBulkToggleButtonClassName(
                isDryCleanAllSelected,
                "bg-violet-600 hover:bg-violet-700 border-violet-600 text-white",
                "border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-950/40",
              )}
              data-testid={
                isPopup ? "popup-button-dc-all" : "sidebar-button-dc-all"
              }
              onClick={() => {
                if (isDryCleanAllSelected) {
                  setDefaultBulkServiceType("normal");
                  if (!hasBulkServiceTargets) return;
                  setDcQuantities((prev) =>
                    clearSelectedProductIdsFromServiceQuantities(prev),
                  );
                  setCustomItems((prev) => resetCustomItemsToNormal(prev));
                  setCarpetEntries((prev) =>
                    prev.map((entry) => ({ ...entry, serviceType: "normal" })),
                  );
                  toast({
                    title: "Updated",
                    description: "Dry Clean removed from all items.",
                  });
                  return;
                }

                setDefaultBulkServiceType("dc");
                if (!hasBulkServiceTargets) return;

                const newDc: Record<number, number> = {};
                Object.entries(quantities).forEach(([pid, qty]) => {
                  const id = parseInt(pid);
                  const product = allProducts?.find((p) => p.id === id);
                  if (product && !product.isSqmPriced && qty > 0) {
                    newDc[id] = qty;
                  }
                });
                setDcQuantities(newDc);
                setIronQuantities({});
                setCustomItems((prev) =>
                  applyBulkServiceTypeToCustomItems(prev, "dc"),
                );
                setCarpetEntries((prev) =>
                  prev.map((entry) => ({ ...entry, serviceType: "dc" })),
                );
                toast({
                  title: "Updated",
                  description: "All items set to Dry Clean.",
                });
              }}
            >
              Dry Clean All
            </Button>
            <Button
              type="button"
              variant={isFoldAllSelected ? "default" : "outline"}
              className={getBulkToggleButtonClassName(
                isFoldAllSelected,
                "bg-blue-600 hover:bg-blue-700 border-blue-600 text-white",
                "border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950/40",
              )}
              data-testid={
                isPopup ? "popup-button-fold-all" : "sidebar-button-fold-all"
              }
              onClick={() => {
                setDefaultBulkPackingType("folding");
                if (selectedPackingProductIds.length === 0) return;

                const newPackingTypes: Record<number, "hanging" | "folding"> =
                  {};
                allProducts?.forEach((p) => {
                  newPackingTypes[p.id] = "folding";
                });
                setPackingTypes((prev) => ({ ...prev, ...newPackingTypes }));
              }}
            >
              Fold All
            </Button>
            <Button
              type="button"
              variant={isHangAllSelected ? "default" : "outline"}
              className={getBulkToggleButtonClassName(
                isHangAllSelected,
                "bg-amber-600 hover:bg-amber-700 border-amber-600 text-white",
                "border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40",
              )}
              data-testid={
                isPopup ? "popup-button-hang-all" : "sidebar-button-hang-all"
              }
              onClick={() => {
                setDefaultBulkPackingType("hanging");
                if (selectedPackingProductIds.length === 0) return;

                const newPackingTypes: Record<number, "hanging" | "folding"> =
                  {};
                allProducts?.forEach((p) => {
                  newPackingTypes[p.id] = "hanging";
                });
                setPackingTypes((prev) => ({ ...prev, ...newPackingTypes }));
              }}
            >
              Hang All
            </Button>
        </div>

      {/* Order Notes */}
      <div>
        <Input
          type="text"
          aria-label="Notes"
          placeholder="Special instructions..."
          className="h-8 text-xs"
          value={orderNotes}
          onChange={(e) => setOrderNotes(e.target.value)}
          data-testid={
            isPopup ? "popup-input-order-notes" : "sidebar-input-order-notes"
          }
        />
      </div>

      {/* Place Order Buttons */}
      <div className="flex gap-1.5">
        <Button
          className="flex-1 h-9 font-bold"
          onClick={() =>
            triggerPlaceOrderButtonAction({ closePopup: isPopup })
          }
          disabled={
            createOrderMutation.isPending ||
            (!selectedClientId && !isManualClientEntry)
          }
          data-testid={
            isPopup ? "popup-button-place-order" : "sidebar-button-place-order"
          }
        >
          {createOrderMutation.isPending && !payNowAfterOrder ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : null}
          {clientMatch ? "Use existing client" : `Place Order`}
        </Button>
        <Button
          variant="outline"
          className="h-9 font-bold border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"
          onClick={() => {
            if (isPopup) setShowCartPopup(false);
            handleCreateOrder({ payNow: true });
          }}
          disabled={
            createOrderMutation.isPending ||
            (!selectedClientId && !isManualClientEntry) ||
            !!clientMatch
          }
          data-testid={
            isPopup ? "popup-button-pay-now" : "sidebar-button-pay-now"
          }
        >
          {createOrderMutation.isPending && payNowAfterOrder ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1" />
          ) : (
            <Banknote className="w-4 h-4 mr-1" />
          )}
          Pay Now
        </Button>
      </div>
      </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen">
      {categoryTabMenu && isEditMode && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={closeCategoryTabMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeCategoryTabMenu();
            }}
          />
          <div
            className="fixed z-50 w-64 rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"
            style={{
              left: categoryTabMenu.x,
              top: categoryTabMenu.y,
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            data-testid="category-tab-action-menu"
          >
            {categoryTabMenuMode === "menu" && (
              <div className="space-y-1">
                <div className="px-2 py-1">
                  <p className="truncate text-sm font-semibold">
                    {getProductCategoryDisplayName(
                      categoryTabMenu.categoryName,
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Category actions
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-full justify-start gap-2 text-sm"
                  onClick={() => {
                    setCategoryTabMenuMode("rename");
                    setCategoryTabRenameValue(categoryTabMenu.categoryName);
                    setCategoryActionError("");
                  }}
                  data-testid="button-category-tab-rename"
                >
                  <Pencil className="h-4 w-4" />
                  Rename
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-full justify-start gap-2 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    setCategoryTabMenuMode("delete");
                    setCategoryActionError("");
                  }}
                  data-testid="button-category-tab-delete"
                >
                  <X className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            )}

            {categoryTabMenuMode === "rename" && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void renameCategory(
                    categoryTabMenu.categoryName,
                    categoryTabRenameValue,
                  );
                }}
              >
                <div>
                  <Label className="text-xs font-semibold">
                    Rename Category
                  </Label>
                  <Input
                    autoFocus
                    className="mt-1 h-9"
                    value={categoryTabRenameValue}
                    onChange={(e) => {
                      setCategoryTabRenameValue(e.target.value);
                      setCategoryActionError("");
                    }}
                    data-testid="input-category-tab-rename"
                  />
                </div>
                {categoryActionError && (
                  <p className="text-xs text-destructive">
                    {categoryActionError}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 flex-1"
                    onClick={() => {
                      setCategoryTabMenuMode("menu");
                      setCategoryActionError("");
                    }}
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    className="h-9 flex-1"
                    disabled={isCategoryActionLoading}
                    data-testid="button-category-tab-rename-save"
                  >
                    {isCategoryActionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              </form>
            )}

            {categoryTabMenuMode === "delete" && (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold">Delete category?</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Items in{" "}
                    <span className="font-semibold text-foreground">
                      {getProductCategoryDisplayName(
                        categoryTabMenu.categoryName,
                      )}
                    </span>{" "}
                    will move to {uncategorizedCategoryName}.
                  </p>
                </div>
                {categoryActionError && (
                  <p className="text-xs text-destructive">
                    {categoryActionError}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 flex-1"
                    onClick={() => {
                      setCategoryTabMenuMode("menu");
                      setCategoryActionError("");
                    }}
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-9 flex-1"
                    onClick={() =>
                      void deleteCategory(categoryTabMenu.categoryName)
                    }
                    disabled={isCategoryActionLoading}
                    data-testid="button-category-tab-delete-confirm"
                  >
                    {isCategoryActionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Delete"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {/* Left side - New Order */}
      <div className="flex-1 flex flex-col min-w-0 xl:mr-[414.72px]">
        <div className="sticky top-0 z-30 w-full bg-gradient-to-r from-primary/10 via-white to-primary/5 dark:from-primary/20 dark:via-background dark:to-primary/10 backdrop-blur-md border-b border-primary/20 shadow-sm">
          <div className="h-12 px-3 flex items-center justify-between gap-3">
            <h1 className="text-lg font-display font-black text-primary flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow">
                <ShoppingCart className="w-4 h-4 text-white" />
              </div>
              New Order
            </h1>
            <div className="flex-1 max-w-sm relative group">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors">
                <Search className="w-4 h-4" />
              </div>
              <Input
                className="pl-9 pr-8 h-9 rounded-full border-2 border-primary/20 bg-background focus:bg-background focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm shadow-sm"
                placeholder="Search items..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-products"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                  data-testid="button-clear-search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {/* Edit/category controls */}
            {canManageItems && (
              <div className="flex items-center gap-2">
                <Button
                  variant={isEditMode ? "default" : "outline"}
                  size="sm"
                  className={`h-9 gap-1.5 ${isEditMode ? "bg-orange-500 hover:bg-orange-600" : ""}`}
                  onClick={() => {
                    if (isEditMode) {
                      exitEditMode();
                    } else {
                      requestEditMode();
                    }
                  }}
                  data-testid="button-toggle-edit-mode"
                >
                  <Pencil className="w-4 h-4" />
                  <span className="hidden sm:inline">
                    {isEditMode ? "Exit Edit" : "Edit"}
                  </span>
                </Button>
              </div>
            )}
          </div>

          {/* Category Tabs */}
          <div className="px-2 pb-2 overflow-x-auto">
            {isEditMode && (
              <div className="mb-2 px-2 py-1.5 bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700 rounded-lg text-xs text-orange-700 dark:text-orange-300 flex items-center gap-2">
                <GripVertical className="w-4 h-4" />
                <span>
                  Drag category tabs to rearrange, or drag items to tabs to move
                  products. Changes save immediately; right-click or long-press
                  a category tab to rename or delete it.
                </span>
              </div>
            )}
            <Tabs
              value={activeSelectedCategory}
              onValueChange={setSelectedCategory}
              className="w-full"
            >
              <TabsList className="inline-flex h-auto min-w-full items-center justify-start gap-1 bg-transparent p-0.5 w-auto sm:gap-2 sm:p-1">
                {tabCategories.map((tab) => {
                  const isCategoryDragOver =
                    dragOverCategoryTarget?.tabId === tab.id;
                  const isEditableTab =
                    isEditMode &&
                    Boolean(tab.targetCategory) &&
                    tab.id !== "all" &&
                    tab.id !== UNCATEGORIZED_CATEGORY_TAB_ID;
                  const canUseCategoryTabActions =
                    isEditableTab && user?.role === "admin";

                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      className={`px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap border border-border rounded-xl bg-background shadow-sm data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:border-primary transition-all sm:px-4 sm:py-2 sm:text-xs ${
                        isEditableTab
                          ? "border-2 border-dashed"
                          : ""
                      } ${
                        canUseCategoryTabActions ? "cursor-context-menu" : ""
                      } ${
                        isCategoryDragOver
                          ? dragOverCategoryTarget?.placement === "before"
                            ? "border-indigo-500 bg-indigo-100 text-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300 scale-105 shadow-[-4px_0_0_0_rgba(99,102,241,0.95)]"
                            : "border-indigo-500 bg-indigo-100 text-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300 scale-105 shadow-[4px_0_0_0_rgba(99,102,241,0.95)]"
                          : dragOverTab === tab.id
                            ? "border-primary bg-primary/20 scale-105"
                            : ""
                      }`}
                      data-testid={`tab-category-${tab.id}`}
                      draggable={isEditableTab}
                      onDragStart={(e) =>
                        isEditableTab &&
                        tab.targetCategory &&
                        handleCategoryDragStart(e, tab.targetCategory)
                      }
                      onDragEnd={handleCategoryDragEnd}
                      onDragOver={(e) =>
                        isEditMode &&
                        tab.targetCategory &&
                        handleDragOverTab(e, tab.id)
                      }
                      onDragLeave={(e) => {
                        setDragOverTab(null);
                        handleCategoryTabDragLeave(e);
                      }}
                      onDrop={(e) =>
                        isEditMode &&
                        tab.targetCategory &&
                        handleDropOnTab(e, tab.id)
                      }
                      onContextMenu={(e) => {
                        if (!canUseCategoryTabActions || !tab.targetCategory) {
                          return;
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        openCategoryTabMenu(
                          tab.targetCategory,
                          e.clientX,
                          e.clientY,
                        );
                      }}
                      onTouchStart={(e) => {
                        if (!canUseCategoryTabActions || !tab.targetCategory) {
                          return;
                        }
                        startCategoryTabLongPress(e, tab.targetCategory);
                      }}
                      onTouchMove={clearCategoryTabLongPress}
                      onTouchEnd={finishCategoryTabLongPress}
                      onTouchCancel={finishCategoryTabLongPress}
                    >
                      {tab.isFavorites && (
                        <Star className="w-3.5 h-3.5 mr-1 fill-current" />
                      )}
                      {tab.label}
                    </TabsTrigger>
                  );
                })}
                {isEditMode && user?.role === "admin" && (
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "h-[34px] shrink-0 gap-1.5 rounded-xl border-2 border-dashed bg-background px-3 text-[11px] font-semibold text-primary shadow-sm hover:bg-primary/10 sm:h-[40px] sm:px-4 sm:text-xs",
                      dragOverCategoryTarget?.tabId ===
                        CATEGORY_TAB_END_DROP_ZONE_ID
                        ? "border-indigo-500 bg-indigo-100 text-indigo-800 shadow-[4px_0_0_0_rgba(99,102,241,0.95)] dark:bg-indigo-950/30 dark:text-indigo-300"
                        : "border-primary/40",
                    )}
                    onClick={requestCreateCategoryDialog}
                    onDragOver={handleCategoryEndDragOver}
                    onDragLeave={handleCategoryTabDragLeave}
                    onDrop={handleCategoryEndDrop}
                    data-testid="button-new-category-tab"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>New Category</span>
                  </Button>
                )}
              </TabsList>
            </Tabs>
          </div>
        </div>

        <main className="flex-1 flex overflow-hidden">
          <div
            className={`flex-1 overflow-auto px-2 py-2 pb-24 sm:pb-4 ${orderItems.length > 0 ? "pr-0" : ""}`}
          >
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Package className="w-10 h-10 mb-4 text-primary/70" />
                <p>Loading items...</p>
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center justify-center py-20 text-destructive">
                <p className="font-semibold text-lg">Failed to load</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Favorites tab - clean flat grid */}
                {activeSelectedCategory === "favorites" && (
                  <>
                    {allProducts?.filter((p) => p.starred).length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <Star className="w-12 h-12 mb-4 text-yellow-400" />
                        <p className="font-semibold text-lg">
                          No Favorites Yet
                        </p>
                        <p className="text-sm mt-2">
                          Turn on Edit Mode to star items as favorites
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5 sm:gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7">
                        {getSortedFavorites(allProducts || []).map(
                          (product, favIdx) => (
                            <div
                              key={`fav-${product.id}`}
                              draggable={isEditMode}
                              {...(isEditMode
                                ? {
                                    onDragStart: (e: React.DragEvent) => {
                                      setDraggedFavId(product.id);
                                      e.dataTransfer.effectAllowed = "move";
                                      if (e.currentTarget)
                                        (
                                          e.currentTarget as HTMLElement
                                        ).style.opacity = "0.5";
                                    },
                                    onDragEnd: (e: React.DragEvent) => {
                                      setDraggedFavId(null);
                                      setDragOverFavId(null);
                                      if (e.currentTarget)
                                        (
                                          e.currentTarget as HTMLElement
                                        ).style.opacity = "1";
                                    },
                                    onDragOver: (e: React.DragEvent) => {
                                      e.preventDefault();
                                      e.dataTransfer.dropEffect = "move";
                                      setDragOverFavId(product.id);
                                    },
                                    onDragLeave: () => setDragOverFavId(null),
                                    onDrop: (e: React.DragEvent) => {
                                      e.preventDefault();
                                      if (draggedFavId !== null)
                                        handleFavDrop(draggedFavId, product.id);
                                      setDraggedFavId(null);
                                      setDragOverFavId(null);
                                    },
                                    onTouchStart: (e: React.TouchEvent) => {
                                      touchStartRef.current = {
                                        id: product.id,
                                        x: e.touches[0].clientX,
                                        y: e.touches[0].clientY,
                                        el: e.currentTarget as HTMLElement,
                                      };
                                    },
                                    onTouchMove: (e: React.TouchEvent) => {
                                      if (!touchStartRef.current) return;
                                      const dx = Math.abs(
                                        e.touches[0].clientX -
                                          touchStartRef.current.x,
                                      );
                                      const dy = Math.abs(
                                        e.touches[0].clientY -
                                          touchStartRef.current.y,
                                      );
                                      if (dx > 10 || dy > 10)
                                        setTouchDragging(true);
                                      if (touchDragging) {
                                        const el = document.elementFromPoint(
                                          e.touches[0].clientX,
                                          e.touches[0].clientY,
                                        );
                                        const card = el?.closest(
                                          "[data-fav-id]",
                                        ) as HTMLElement | null;
                                        if (card)
                                          setDragOverFavId(
                                            Number(card.dataset.favId),
                                          );
                                      }
                                    },
                                    onTouchEnd: () => {
                                      if (
                                        touchDragging &&
                                        touchStartRef.current &&
                                        dragOverFavId !== null
                                      ) {
                                        handleFavDrop(
                                          touchStartRef.current.id,
                                          dragOverFavId,
                                        );
                                      }
                                      touchStartRef.current = null;
                                      setTouchDragging(false);
                                      setDragOverFavId(null);
                                    },
                                  }
                                : {})}
                              data-fav-id={product.id}
                              className={`relative overflow-hidden rounded-[18px] border-2 p-1.5 sm:rounded-xl sm:p-3 md:p-4 flex flex-col items-center ${isEditMode ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} transition-all duration-150 ${
                                dragOverFavId === product.id &&
                                draggedFavId !== product.id
                                  ? "border-primary border-[3px] scale-105 shadow-xl"
                                  : isProductSelected(product)
                                    ? "border-primary/70 border-[3px] bg-gradient-to-br from-primary/15 via-primary/10 to-background ring-2 ring-primary/30 shadow-[0_14px_28px_-18px_rgba(37,99,235,0.55)]"
                                    : "border-yellow-300/60 dark:border-yellow-700/50 bg-gradient-to-br from-yellow-50 to-amber-50/60 dark:from-yellow-900/20 dark:to-amber-900/10 shadow-[0_10px_24px_-22px_rgba(245,158,11,0.65)] hover:border-yellow-400"
                              }`}
                              onClick={() => handleProductCardClick(product)}
                              onContextMenu={(event) =>
                                handleProductCardContextMenu(event, product)
                              }
                              data-testid={`box-favorite-${product.id}`}
                            >
                              {/* Star indicator */}
                              <div className="absolute left-1 top-1 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-yellow-400 text-yellow-900 shadow-sm sm:h-5 sm:w-5">
                                <Star className="w-3 h-3 fill-current" />
                              </div>
                              <div className="relative mb-1 flex h-16 w-full flex-shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-gradient-to-br from-yellow-100 to-amber-50 shadow-sm dark:from-slate-700 dark:to-slate-800 sm:mb-2 sm:h-24 sm:rounded-lg md:h-28">
                                {(() => {
                                  const imageSrc =
                                    product.imageUrl ||
                                    getProductImage(product.name);
                                  if (imageSrc) {
                                    return (
                                      <img
                                        src={imageSrc}
                                        alt={product.name}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                          e.currentTarget.style.display =
                                            "none";
                                          const fallback =
                                            e.currentTarget.parentElement?.querySelector(
                                              ".fallback-icon",
                                            );
                                          if (fallback)
                                            (
                                              fallback as HTMLElement
                                            ).style.display = "flex";
                                        }}
                                      />
                                    );
                                  }
                                  return null;
                                })()}
                                <div
                                  className="fallback-icon absolute inset-0 flex items-center justify-center"
                                  style={{
                                    display:
                                      product.imageUrl ||
                                      getProductImage(product.name)
                                        ? "none"
                                        : "flex",
                                  }}
                                >
                                  {getCategoryIcon(
                                    getDisplayCategoryName(product.category),
                                  )}
                                </div>
                              </div>
                              <div className="flex min-h-[1.75rem] items-center justify-center px-0.5 text-center text-[11px] font-bold leading-tight text-foreground line-clamp-2 sm:min-h-[2.5rem] sm:px-1 sm:text-sm">
                                {product.name}
                              </div>
                              <div className="mt-0.5 flex w-full flex-col items-center gap-0.5 sm:mt-1">
                                {isProductSelected(product) ? (
                                  <div className="flex min-h-[1rem] max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 px-0.5 text-center">
                                    {renderProductServiceQuantitySummary(
                                      product,
                                    )}
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center gap-0.5 text-[9px] sm:text-xs">
                                    {product.isSqmPriced ? (
                                      <>
                                        <span className="text-primary font-bold">
                                          {product.sqmPrice
                                            ? parseFloat(
                                                product.sqmPrice,
                                              ).toFixed(0)
                                            : product.price
                                              ? parseFloat(
                                                  product.price,
                                                ).toFixed(0)
                                              : "12"}{" "}
                                          AED
                                        </span>
                                        <div className="text-[7px] text-muted-foreground sm:text-[9px]">
                                          per sqm
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <div className="flex items-center gap-0.5 sm:gap-1">
                                          <span className="text-primary font-bold">
                                            {product.price
                                              ? parseFloat(
                                                  product.price,
                                                ).toFixed(0)
                                              : "-"}
                                          </span>
                                          <span className="text-muted-foreground">
                                            /
                                          </span>
                                          <span className="text-purple-600 dark:text-purple-400 font-bold">
                                            {product.dryCleanPrice
                                              ? parseFloat(
                                                  product.dryCleanPrice,
                                                ).toFixed(0)
                                              : "-"}
                                          </span>
                                          <span className="text-muted-foreground">
                                            /
                                          </span>
                                          <span className="text-orange-600 dark:text-orange-400 font-bold">
                                            {product.ironOnlyPrice
                                              ? parseFloat(
                                                  product.ironOnlyPrice,
                                                ).toFixed(0)
                                              : "-"}
                                          </span>
                                        </div>
                                        <div className="text-[7px] text-muted-foreground sm:text-[9px]">
                                          N / DC / IO
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                              {getTotalQuantityForProduct(product.id) > 0 ||
                              (hasSizeOption(product) &&
                                getSizedItemQuantity(product.name) > 0) ? (
                                <>
                                  <div
                                    className="absolute -right-1 -top-1 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-[10px] font-bold text-white shadow-lg ring-2 ring-white dark:ring-background sm:-right-2 sm:-top-2 sm:h-7 sm:w-7 sm:text-sm sm:animate-pulse"
                                    onClick={(e) => e.stopPropagation()}
                                    onContextMenu={(e) => e.stopPropagation()}
                                  >
                                    <span>
                                      {getTotalQuantityForProduct(product.id) ||
                                        getSizedItemQuantity(product.name)}
                                    </span>
                                  </div>
                                  <div
                                    className="mt-1.5 flex w-full flex-col gap-1 sm:mt-2 sm:gap-1"
                                    onClick={(e) => e.stopPropagation()}
                                    onContextMenu={(e) => e.stopPropagation()}
                                  >
                                    <div className="flex gap-0.5">
                                      <Button
                                        size="sm"
                                        variant={
                                          hasDcItemsForProduct(product.id)
                                            ? "default"
                                            : "outline"
                                        }
                                        className={`flex-1 h-6 sm:h-6 md:h-7 px-1 text-[9px] leading-none sm:px-2 sm:text-[10px] md:text-xs ${hasDcItemsForProduct(product.id) ? "bg-purple-600 hover:bg-purple-700" : ""}`}
                                        onClick={() =>
                                          openServiceTypeDialog(
                                            product.id,
                                            product.name,
                                            "dc",
                                          )
                                        }
                                        data-testid={`button-fav-dryClean-${product.id}`}
                                      >
                                        DC{" "}
                                        {(dcQuantities[product.id] || 0) > 0 &&
                                          `(${dcQuantities[product.id]})`}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant={
                                          hasIronItems(product.id)
                                            ? "default"
                                            : "outline"
                                        }
                                        className={`flex-1 h-6 sm:h-6 md:h-7 px-1 text-[9px] leading-none sm:px-2 sm:text-[10px] md:text-xs ${hasIronItems(product.id) ? "bg-orange-500 hover:bg-orange-600" : ""}`}
                                        onClick={() =>
                                          openServiceTypeDialog(
                                            product.id,
                                            product.name,
                                            "iron",
                                          )
                                        }
                                        data-testid={`button-fav-ironOnly-${product.id}`}
                                      >
                                        Iron{" "}
                                        {(ironQuantities[product.id] || 0) >
                                          0 &&
                                          `(${ironQuantities[product.id]})`}
                                      </Button>
                                    </div>
                                    <div className="flex gap-0.5">
                                      <Button
                                        size="sm"
                                        variant={
                                          packingTypes[product.id] === "hanging"
                                            ? "default"
                                            : "outline"
                                        }
                                        className="flex-1 h-6 sm:h-6 md:h-7 px-1 text-[9px] leading-none sm:px-2 sm:text-[10px] md:text-xs"
                                        onClick={() =>
                                          handlePackingTypeChange(
                                            product.id,
                                            "hanging",
                                          )
                                        }
                                        data-testid={`button-fav-hanging-${product.id}`}
                                      >
                                        Hang
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant={
                                          packingTypes[product.id] ===
                                            "folding" ||
                                          !packingTypes[product.id]
                                            ? "default"
                                            : "outline"
                                        }
                                        className="flex-1 h-6 sm:h-6 md:h-7 px-1 text-[9px] leading-none sm:px-2 sm:text-[10px] md:text-xs"
                                        onClick={() =>
                                          handlePackingTypeChange(
                                            product.id,
                                            "folding",
                                          )
                                        }
                                        data-testid={`button-fav-folding-${product.id}`}
                                      >
                                        Fold
                                      </Button>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant={(() => {
                                        if (hasSizeOption(product)) {
                                          return customItems.some(
                                            (ci) =>
                                              ci.name
                                                .toLowerCase()
                                                .startsWith(
                                                  product.name.toLowerCase() +
                                                    " (",
                                                ) && ci.isUrgent,
                                          )
                                            ? "default"
                                            : "outline";
                                        }
                                        return (urgentQuantities[product.id] ||
                                          0) > 0
                                          ? "default"
                                          : "outline";
                                      })()}
                                      className={`w-full h-6 sm:h-6 md:h-7 px-1 text-[9px] leading-none sm:px-2 sm:text-[10px] md:text-xs ${(() => {
                                        if (hasSizeOption(product)) {
                                          return customItems.some(
                                            (ci) =>
                                              ci.name
                                                .toLowerCase()
                                                .startsWith(
                                                  product.name.toLowerCase() +
                                                    " (",
                                                ) && ci.isUrgent,
                                          )
                                            ? "bg-red-500 hover:bg-red-600 text-white"
                                            : "";
                                        }
                                        return (urgentQuantities[product.id] ||
                                          0) > 0
                                          ? "bg-red-500 hover:bg-red-600 text-white"
                                          : "";
                                      })()}`}
                                      onClick={() => {
                                        if (hasSizeOption(product)) {
                                          setSizedUrgentPickerProductName(
                                            product.name,
                                          );
                                          setShowSizedUrgentPicker(true);
                                        } else {
                                          openUrgentDialog(
                                            product.id,
                                            product.name,
                                          );
                                        }
                                      }}
                                      data-testid={`button-fav-urgent-${product.id}`}
                                    >
                                      <Zap className="w-3 h-3 mr-0.5" />
                                      Urgent{" "}
                                      {(() => {
                                        if (hasSizeOption(product)) {
                                          const urgCount = customItems
                                            .filter(
                                              (ci) =>
                                                ci.name
                                                  .toLowerCase()
                                                  .startsWith(
                                                    product.name.toLowerCase() +
                                                      " (",
                                                  ) && ci.isUrgent,
                                            )
                                            .reduce(
                                              (s, ci) => s + ci.quantity,
                                              0,
                                            );
                                          return urgCount > 0
                                            ? `(${urgCount})`
                                            : "";
                                        }
                                        return (urgentQuantities[product.id] ||
                                          0) > 0
                                          ? `(${urgentQuantities[product.id]})`
                                          : "";
                                      })()}
                                    </Button>
                                  </div>
                                  <div
                                    className="mt-1 w-full sm:hidden"
                                    onClick={(e) => e.stopPropagation()}
                                    onContextMenu={(e) => e.stopPropagation()}
                                  >
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 w-full border-destructive/30 bg-destructive/5 px-1 text-[9px] font-semibold leading-none text-destructive hover:bg-destructive/10"
                                      onClick={() =>
                                        handleProductDecrement(product)
                                      }
                                      data-testid={`button-fav-remove-mobile-${product.id}`}
                                    >
                                      <Minus className="mr-1 h-3 w-3" />
                                      Remove
                                    </Button>
                                  </div>
                                  <Button
                                    size="icon"
                                    variant="destructive"
                                    className="absolute -bottom-0.5 -right-0.5 hidden h-4 w-4 rounded-full sm:flex sm:-bottom-1 sm:-right-1 sm:h-5 sm:w-5"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleProductDecrement(product);
                                    }}
                                    data-testid={`button-fav-qty-minus-${product.id}`}
                                  >
                                    <Minus className="w-3 h-3" />
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </>
                )}
                {/* Regular category view */}
                {activeSelectedCategory !== "favorites" &&
                  Object.entries(filteredGroupedProducts).map(
                    ([category, categoryProducts]) => (
                      <div key={category} className="space-y-2">
                        <div className="flex items-center gap-2 px-2 py-2 bg-muted/50 rounded-lg sticky top-0 z-10">
                          {getCategoryIcon(category, "w-6 h-6")}
                          <h3 className="font-bold text-sm">
                            {getProductCategoryDisplayName(category)}
                          </h3>
                          <Badge variant="secondary" className="text-xs">
                            {categoryProducts?.length || 0}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 sm:gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7">
                          {categoryProducts?.map((product) => (
                            <div
                              key={product.id}
                              draggable={isEditMode && canManageItems}
                              onDragStart={(e) =>
                                handleDragStart(e, {
                                  id: product.id,
                                  name: product.name,
                                })
                              }
                              onDragEnd={handleDragEnd}
                              className={`relative overflow-hidden rounded-[18px] border-2 p-1.5 sm:rounded-xl sm:p-3 md:p-4 flex flex-col items-center cursor-pointer transition-all ${
                                isProductSelected(product)
                                  ? "border-primary/70 border-[3px] bg-gradient-to-br from-primary/15 via-primary/10 to-background ring-2 ring-primary/30 shadow-[0_14px_28px_-18px_rgba(37,99,235,0.55)]"
                                  : "border-border/50 bg-gradient-to-br from-card to-muted/30 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.45)] hover:border-primary/60"
                              } ${isEditMode ? "cursor-grab active:cursor-grabbing" : ""} ${
                                draggingProduct?.id === product.id
                                  ? "opacity-50 ring-2 ring-orange-400"
                                  : ""
                              }`}
                              onClick={() => handleProductCardClick(product)}
                              onContextMenu={(event) =>
                                handleProductCardContextMenu(event, product)
                              }
                              data-testid={`box-product-${product.id}`}
                            >
                              {/* Star button - only show in edit mode */}
                              {isEditMode && (
                                <button
                                  className={`absolute top-1 left-1 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                                    product.starred
                                      ? "bg-yellow-400 text-yellow-900 shadow-md"
                                      : "bg-muted/80 text-muted-foreground hover:bg-yellow-200 hover:text-yellow-700"
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateProduct.mutate({
                                      id: product.id,
                                      starred: !product.starred,
                                    });
                                  }}
                                  data-testid={`button-star-${product.id}`}
                                >
                                  <Star
                                    className={`w-3.5 h-3.5 ${product.starred ? "fill-current" : ""}`}
                                  />
                                </button>
                              )}
                              {/* Star indicator when not in edit mode but item is starred */}
                              {!isEditMode && product.starred && (
                                <div className="absolute left-1 top-1 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-yellow-400 text-yellow-900 shadow-sm sm:h-5 sm:w-5">
                                  <Star className="w-3 h-3 fill-current" />
                                </div>
                              )}
                              {/* Edit mode indicator */}
                              {isEditMode && canManageItems && (
                                <div className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded bg-orange-500 text-white">
                                  <GripVertical className="w-3 h-3" />
                                </div>
                              )}
                              <div className="relative mb-1 flex h-16 w-full flex-shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-gradient-to-br from-blue-100 to-blue-50 shadow-sm dark:from-slate-700 dark:to-slate-800 sm:mb-2 sm:h-24 sm:rounded-lg md:h-28">
                                {(() => {
                                  const imageSrc =
                                    product.imageUrl ||
                                    getProductImage(product.name);
                                  if (imageSrc) {
                                    return (
                                      <img
                                        src={imageSrc}
                                        alt={product.name}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                          e.currentTarget.style.display =
                                            "none";
                                          const fallback =
                                            e.currentTarget.parentElement?.querySelector(
                                              ".fallback-icon",
                                            );
                                          if (fallback)
                                            (
                                              fallback as HTMLElement
                                            ).style.display = "flex";
                                        }}
                                      />
                                    );
                                  }
                                  return null;
                                })()}
                                <div
                                  className="fallback-icon absolute inset-0 flex items-center justify-center"
                                  style={{
                                    display:
                                      product.imageUrl ||
                                      getProductImage(product.name)
                                        ? "none"
                                        : "flex",
                                  }}
                                >
                                  {getCategoryIcon(
                                    getDisplayCategoryName(product.category),
                                  )}
                                </div>
                              </div>

                              <div
                                className="flex min-h-[1.75rem] items-center justify-center px-0.5 text-center text-[11px] font-bold leading-tight text-foreground line-clamp-2 sm:min-h-[2.5rem] sm:px-1 sm:text-sm"
                                data-testid={`text-product-name-${product.id}`}
                              >
                                {product.name}
                              </div>

                              <div className="mt-0.5 flex w-full flex-col items-center gap-0.5 sm:mt-1">
                                {isProductSelected(product) ? (
                                  // Show price based on service selection when item is added
                                  <div
                                    className="flex min-h-[1rem] max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 px-0.5 text-center"
                                    data-testid={`text-product-active-price-${product.id}`}
                                  >
                                    {renderProductServiceQuantitySummary(
                                      product,
                                    )}
                                  </div>
                                ) : (
                                  // Show all three prices when item not added
                                  <div className="flex flex-col items-center gap-0.5 text-[9px] sm:text-xs">
                                    {product.isSqmPriced ? (
                                      <>
                                        <span className="text-primary font-bold">
                                          {product.sqmPrice
                                            ? parseFloat(
                                                product.sqmPrice,
                                              ).toFixed(0)
                                            : product.price
                                              ? parseFloat(
                                                  product.price,
                                                ).toFixed(0)
                                              : "12"}{" "}
                                          AED
                                        </span>
                                        <div className="text-[7px] text-muted-foreground sm:text-[9px]">
                                          per sqm
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <div className="flex items-center gap-0.5 sm:gap-1">
                                          <span className="text-primary font-bold">
                                            {product.price
                                              ? parseFloat(
                                                  product.price,
                                                ).toFixed(0)
                                              : "-"}
                                          </span>
                                          <span className="text-muted-foreground">
                                            /
                                          </span>
                                          <span className="text-purple-600 dark:text-purple-400 font-bold">
                                            {product.dryCleanPrice
                                              ? parseFloat(
                                                  product.dryCleanPrice,
                                                ).toFixed(0)
                                              : "-"}
                                          </span>
                                          <span className="text-muted-foreground">
                                            /
                                          </span>
                                          <span className="text-orange-600 dark:text-orange-400 font-bold">
                                            {product.ironOnlyPrice
                                              ? parseFloat(
                                                  product.ironOnlyPrice,
                                                ).toFixed(0)
                                              : "-"}
                                          </span>
                                        </div>
                                        <div className="text-[7px] text-muted-foreground sm:text-[9px]">
                                          N / DC / IO
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>

                              {allocatedStock && (
                                <div className="flex flex-col items-center mt-1 gap-0.5">
                                  <div
                                    className={`text-[10px] font-medium ${(allocatedStock[product.name] || 0) > 0 ? "text-primary cursor-pointer hover:underline font-semibold" : "text-muted-foreground"}`}
                                    data-testid={`text-stock-${product.id}`}
                                    onClick={(e) => {
                                      const count =
                                        allocatedStock[product.name] || 0;
                                      if (count > 0) {
                                        e.stopPropagation();
                                        setStockOrdersDialog({
                                          open: true,
                                          productName: product.name,
                                          count,
                                        });
                                      }
                                    }}
                                  >
                                    Stock: {allocatedStock[product.name] || 0}
                                  </div>
                                </div>
                              )}

                              {getTotalQuantityForProduct(product.id) > 0 ||
                              (hasSizeOption(product) &&
                                getSizedItemQuantity(product.name) > 0) ? (
                                <>
                                  <div
                                    className="absolute -right-1 -top-1 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-[10px] font-bold text-white shadow-lg ring-2 ring-white dark:ring-background sm:-right-2 sm:-top-2 sm:h-7 sm:w-7 sm:text-sm sm:animate-pulse"
                                    onClick={(e) => e.stopPropagation()}
                                    onContextMenu={(e) => e.stopPropagation()}
                                  >
                                    <span
                                      data-testid={`text-qty-${product.id}`}
                                    >
                                      {getTotalQuantityForProduct(product.id) ||
                                        getSizedItemQuantity(product.name)}
                                    </span>
                                  </div>
                                  {!product.isSqmPriced && (
                                    <div
                                      className="mt-1.5 flex w-full flex-col gap-1 sm:mt-2 sm:gap-1"
                                      onClick={(e) => e.stopPropagation()}
                                      onContextMenu={(e) => e.stopPropagation()}
                                    >
                                      <div className="flex gap-0.5">
                                        <Button
                                          size="sm"
                                          variant={
                                            hasDcItemsForProduct(product.id)
                                              ? "default"
                                              : "outline"
                                          }
                                          className={`flex-1 h-6 sm:h-6 md:h-7 px-1 text-[9px] leading-none sm:px-2 sm:text-[10px] md:text-xs ${hasDcItemsForProduct(product.id) ? "bg-purple-600 hover:bg-purple-700" : ""}`}
                                          onClick={() =>
                                            openServiceTypeDialog(
                                              product.id,
                                              product.name,
                                              "dc",
                                            )
                                          }
                                          data-testid={`button-dryClean-${product.id}`}
                                        >
                                          DC{" "}
                                          {(dcQuantities[product.id] || 0) >
                                            0 &&
                                            `(${dcQuantities[product.id]})`}
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant={
                                            hasIronItems(product.id)
                                              ? "default"
                                              : "outline"
                                          }
                                          className={`flex-1 h-6 sm:h-6 md:h-7 px-1 text-[9px] leading-none sm:px-2 sm:text-[10px] md:text-xs ${hasIronItems(product.id) ? "bg-orange-500 hover:bg-orange-600" : ""}`}
                                          onClick={() =>
                                            openServiceTypeDialog(
                                              product.id,
                                              product.name,
                                              "iron",
                                            )
                                          }
                                          data-testid={`button-ironOnly-${product.id}`}
                                        >
                                          Iron{" "}
                                          {(ironQuantities[product.id] || 0) >
                                            0 &&
                                            `(${ironQuantities[product.id]})`}
                                        </Button>
                                      </div>
                                      <div className="flex gap-0.5">
                                        <Button
                                          size="sm"
                                          variant={
                                            packingTypes[product.id] ===
                                            "hanging"
                                              ? "default"
                                              : "outline"
                                          }
                                          className="flex-1 h-6 sm:h-6 md:h-7 px-1 text-[9px] leading-none sm:px-2 sm:text-[10px] md:text-xs"
                                          onClick={() =>
                                            handlePackingTypeChange(
                                              product.id,
                                              "hanging",
                                            )
                                          }
                                          data-testid={`button-hanging-${product.id}`}
                                        >
                                          Hang
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant={
                                            packingTypes[product.id] ===
                                              "folding" ||
                                            !packingTypes[product.id]
                                              ? "default"
                                              : "outline"
                                          }
                                          className="flex-1 h-6 sm:h-6 md:h-7 px-1 text-[9px] leading-none sm:px-2 sm:text-[10px] md:text-xs"
                                          onClick={() =>
                                            handlePackingTypeChange(
                                              product.id,
                                              "folding",
                                            )
                                          }
                                          data-testid={`button-folding-${product.id}`}
                                        >
                                          Fold
                                        </Button>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant={(() => {
                                          if (hasSizeOption(product)) {
                                            return customItems.some(
                                              (ci) =>
                                                ci.name
                                                  .toLowerCase()
                                                  .startsWith(
                                                    product.name.toLowerCase() +
                                                      " (",
                                                  ) && ci.isUrgent,
                                            )
                                              ? "default"
                                              : "outline";
                                          }
                                          return (urgentQuantities[
                                            product.id
                                          ] || 0) > 0
                                            ? "default"
                                            : "outline";
                                        })()}
                                        className={`w-full h-6 sm:h-6 md:h-7 px-1 text-[9px] leading-none sm:px-2 sm:text-[10px] md:text-xs ${(() => {
                                          if (hasSizeOption(product)) {
                                            return customItems.some(
                                              (ci) =>
                                                ci.name
                                                  .toLowerCase()
                                                  .startsWith(
                                                    product.name.toLowerCase() +
                                                      " (",
                                                  ) && ci.isUrgent,
                                            )
                                              ? "bg-red-500 hover:bg-red-600 text-white"
                                              : "";
                                          }
                                          return (urgentQuantities[
                                            product.id
                                          ] || 0) > 0
                                            ? "bg-red-500 hover:bg-red-600 text-white"
                                            : "";
                                        })()}`}
                                        onClick={() => {
                                          if (hasSizeOption(product)) {
                                            setSizedUrgentPickerProductName(
                                              product.name,
                                            );
                                            setShowSizedUrgentPicker(true);
                                          } else {
                                            openUrgentDialog(
                                              product.id,
                                              product.name,
                                            );
                                          }
                                        }}
                                        data-testid={`button-urgent-${product.id}`}
                                      >
                                        <Zap className="w-3 h-3 mr-0.5" />
                                        Urgent{" "}
                                        {(() => {
                                          if (hasSizeOption(product)) {
                                            const urgCount = customItems
                                              .filter(
                                                (ci) =>
                                                  ci.name
                                                    .toLowerCase()
                                                    .startsWith(
                                                      product.name.toLowerCase() +
                                                        " (",
                                                    ) && ci.isUrgent,
                                              )
                                              .reduce(
                                                (s, ci) => s + ci.quantity,
                                                0,
                                              );
                                            return urgCount > 0
                                              ? `(${urgCount})`
                                              : "";
                                          }
                                          return (urgentQuantities[
                                            product.id
                                          ] || 0) > 0
                                            ? `(${urgentQuantities[product.id]})`
                                            : "";
                                        })()}
                                      </Button>
                                    </div>
                                  )}
                                  <div
                                    className="mt-1 w-full sm:hidden"
                                    onClick={(e) => e.stopPropagation()}
                                    onContextMenu={(e) => e.stopPropagation()}
                                  >
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 w-full border-destructive/30 bg-destructive/5 px-1 text-[9px] font-semibold leading-none text-destructive hover:bg-destructive/10"
                                      onClick={() =>
                                        handleProductDecrement(product)
                                      }
                                      data-testid={`button-remove-mobile-${product.id}`}
                                    >
                                      <Minus className="mr-1 h-3 w-3" />
                                      Remove
                                    </Button>
                                  </div>
                                  <Button
                                    size="icon"
                                    variant="destructive"
                                    className="absolute -bottom-0.5 -right-0.5 hidden h-4 w-4 rounded-full sm:flex sm:-bottom-1 sm:-right-1 sm:h-5 sm:w-5"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleProductDecrement(product);
                                    }}
                                    data-testid={`button-qty-minus-${product.id}`}
                                  >
                                    <Minus className="w-3 h-3" />
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          ))}

                          {/* Add New Item Card - Admin/Counter */}
                          {canManageItems && isEditMode && (
                            <div
                              className="relative rounded-lg sm:rounded-xl border-2 border-dashed border-primary/40 p-2 sm:p-3 md:p-4 flex flex-col items-center justify-center cursor-pointer hover-elevate min-h-[160px] sm:min-h-[180px] md:min-h-[200px]"
                              onClick={() => {
                                setNewProductCategory(category);
                                setShowNewProductDialog(true);
                              }}
                              data-testid={`button-add-new-item-${category.replace(/\s+/g, "-").toLowerCase()}`}
                            >
                              <div className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                                <Plus className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 text-primary" />
                              </div>
                              <div className="text-xs sm:text-sm font-bold text-primary text-center">
                                Add New Item
                              </div>
                              <div className="text-[10px] sm:text-xs text-muted-foreground text-center mt-1">
                                to {category}
                              </div>
                            </div>
                          )}
                          {/* Move Existing Item Card - Admin/Counter */}
                          {canManageItems && isEditMode && (
                            <div
                              className="relative rounded-lg sm:rounded-xl border-2 border-dashed border-blue-400/40 p-2 sm:p-3 md:p-4 flex flex-col items-center justify-center cursor-pointer hover-elevate min-h-[160px] sm:min-h-[180px] md:min-h-[200px]"
                              onClick={() => {
                                setMoveItemTargetCategory(category);
                                setMoveItemSearch("");
                                setShowMoveItemDialog(true);
                              }}
                              data-testid={`button-move-item-to-${category.replace(/\s+/g, "-").toLowerCase()}`}
                            >
                              <div className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-2">
                                <ArrowRightLeft className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 text-blue-500" />
                              </div>
                              <div className="text-xs sm:text-sm font-bold text-blue-600 dark:text-blue-400 text-center">
                                Move Item Here
                              </div>
                              <div className="text-[10px] sm:text-xs text-muted-foreground text-center mt-1">
                                from another category
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ),
                  )}
              </div>
            )}
          </div>
        </main>

        {/* Floating Cart Button - Always visible on tablet/mobile (hidden on xl+) */}
        <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 pt-2 lg:left-64 lg:right-3 lg:px-0 lg:pb-4 lg:pt-0 xl:hidden">
          <button
            onClick={() => setShowCartPopup(true)}
            className={`flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 shadow-2xl ${
              hasOrderItems
                ? orderType === "urgent" ||
                  Object.values(urgentQuantities).some((v) => v > 0)
                  ? "bg-gradient-to-r from-orange-500 to-red-500 text-white"
                  : "bg-gradient-to-r from-primary to-primary/90 text-white"
                : "bg-gradient-to-r from-primary/80 to-primary/70 text-white"
            }`}
            data-testid="button-open-cart"
          >
            <div className="relative">
              <ShoppingCart className="h-4 w-4" />
              {hasOrderItems && (
                <span className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-primary/20 bg-background text-[10px] font-bold text-primary">
                  {orderItems.reduce((sum, item) => sum + item.quantity, 0) +
                    customItems.reduce((sum, item) => sum + item.quantity, 0)}
                </span>
              )}
            </div>
            <span className="truncate font-bold text-sm">
              {hasOrderItems ? `${orderTotal.toFixed(0)} AED` : "Order Slip"}
            </span>
          </button>
        </div>
      </div>

      {/* Right Sidebar - Order Slip (Only on xl+ screens) */}
      <div className="hidden xl:flex fixed right-0 top-0 h-screen w-[414.72px] flex-col border-l bg-background z-40">
        <div className="px-3 py-3 border-b bg-gradient-to-r from-primary/10 to-primary/5">
          <div className="flex items-center gap-2 text-primary">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <ShoppingCart className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold">Order Slip</span>
            <Badge className="ml-auto text-xs font-bold bg-primary text-white">
              {orderItems.reduce((sum, item) => sum + item.quantity, 0) +
                customItems.reduce((sum, item) => sum + item.quantity, 0)}{" "}
              items
            </Badge>
          </div>
        </div>
        {renderOrderSlipContent(false)}
      </div>

      {/* Urgent/Normal Service Dialog */}
      <Dialog open={showUrgentDialog} onOpenChange={setShowUrgentDialog}>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-sm max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="text-center">
              Select Service Type
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="text-center text-sm text-muted-foreground mb-4">
              <div className="font-semibold text-foreground text-lg mb-1">
                Order Total: {orderTotal.toFixed(2)} AED
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="h-24 flex flex-col gap-2"
                onClick={() => submitOrder(false)}
                disabled={createOrderMutation.isPending}
                data-testid="button-normal-service"
              >
                <Clock className="w-8 h-8 text-blue-500" />
                <div className="font-semibold">Normal</div>
                <div className="text-xs text-muted-foreground">
                  {orderTotal.toFixed(2)} AED
                </div>
              </Button>
              <Button
                className="h-24 flex flex-col gap-2 bg-orange-500 hover:bg-orange-600 text-white"
                onClick={() => submitOrder(true)}
                disabled={createOrderMutation.isPending}
                data-testid="button-urgent-service"
              >
                <Zap className="w-8 h-8" />
                <div className="font-semibold">Urgent</div>
                <div className="text-xs">{orderTotal.toFixed(2)} AED</div>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Staff PIN Dialog */}
      <Dialog
        open={showPinDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowPinDialog(false);
            setStaffPin("");
            setPinError("");
            clearStaffPinPreview();
            pendingPayNowStaffRef.current = null;
          }
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-w-sm max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="text-center flex items-center justify-center gap-2">
              <Lock className="w-5 h-5 text-primary" />
              Enter PIN
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="text-center text-sm text-muted-foreground mb-2">
              Enter your 5-digit PIN to proceed
            </div>
            {renderStaffPinPreview()}
            <Input
              id="staff-pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={5}
              enterKeyHint="done"
              placeholder="Enter 5-digit PIN"
              value={staffPin}
              autoComplete="one-time-code"
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 5);
                setStaffPin(val);
                setPinError("");
                void updateStaffPinPreview(val);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  verifyPinAndCreateOrder();
                }
              }}
              className="text-center text-2xl tracking-widest [-webkit-text-security:disc]"
              data-testid="input-staff-pin"
            />
            {pinError && (
              <p className="text-sm text-destructive text-center">{pinError}</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowPinDialog(false);
                  setStaffPin("");
                  setPinError("");
                  clearStaffPinPreview();
                  pendingPayNowStaffRef.current = null;
                }}
                data-testid="button-cancel-pin"
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={verifyPinAndCreateOrder}
                disabled={staffPin.length !== 5 || isVerifyingPin}
                data-testid="button-confirm-pin"
              >
                {isVerifyingPin ? "..." : "Confirm"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PayBillDialog
        bill={activePayNowBill}
        client={activePayNowClient}
        open={payNowBillId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPayNowBillId(null);
            setPayNowBill(null);
            setPayNowVerifiedStaff(null);
            pendingPayNowStaffRef.current = null;
          }
        }}
        initialVerifiedCashier={payNowVerifiedStaff}
        requirePin={!payNowVerifiedStaff}
      />

      {/* Other Item Dialog */}
      <Dialog open={showOtherItemDialog} onOpenChange={setShowOtherItemDialog}>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-sm max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Add Other Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Item Name *</Label>
              <Input
                placeholder="Enter item name"
                value={otherItemName}
                onChange={(e) => setOtherItemName(e.target.value)}
                data-testid="input-other-item-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Price (AED) *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={otherItemPrice}
                  onChange={(e) => setOtherItemPrice(e.target.value)}
                  data-testid="input-other-item-price"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Quantity</Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="1"
                  value={otherItemQty}
                  onChange={(e) => setOtherItemQty(e.target.value)}
                  data-testid="input-other-item-qty"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowOtherItemDialog(false);
                  setOtherItemName("");
                  setOtherItemPrice("");
                  setOtherItemQty("1");
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleAddOtherItem}
                data-testid="button-add-other-item-confirm"
              >
                Add Item
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Mode Admin PIN Dialog */}
      <Dialog
        open={showEditModePinDialog}
        onOpenChange={(open) => {
          setShowEditModePinDialog(open);
          if (!open) {
            setEditModeAdminPin("");
            setEditModePinError("");
          }
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-w-sm max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="text-center flex items-center justify-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              Admin PIN Required
            </DialogTitle>
            <DialogDescription className="text-center">
              Enter the admin PIN to unlock edit mode.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={5}
              enterKeyHint="done"
              placeholder="Enter admin PIN"
              value={editModeAdminPin}
              autoComplete="one-time-code"
              onChange={(e) => {
                setEditModeAdminPin(
                  e.target.value.replace(/\D/g, "").slice(0, 5),
                );
                setEditModePinError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  void verifyEditModeAdminPin();
                }
              }}
              className="text-center text-2xl tracking-widest [-webkit-text-security:disc]"
              data-testid="input-edit-mode-admin-pin"
            />
            {editModePinError && (
              <p className="text-center text-sm text-destructive">
                {editModePinError}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowEditModePinDialog(false);
                  setEditModeAdminPin("");
                  setEditModePinError("");
                }}
                data-testid="button-cancel-edit-mode-pin"
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={() => void verifyEditModeAdminPin()}
                disabled={
                  editModeAdminPin.length !== 5 ||
                  isVerifyingEditModePin
                }
                data-testid="button-confirm-edit-mode-pin"
              >
                {isVerifyingEditModePin ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Confirm"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Category Dialog */}
      <Dialog
        open={showCreateCategoryDialog}
        onOpenChange={(open) => {
          setShowCreateCategoryDialog(open);
          if (!open && !isCreatingCategoryFromTab) {
            resetCreateCategoryDialog();
          }
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-w-lg max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              New Category
            </DialogTitle>
            <DialogDescription>
              Choose items to place in the new category.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Category Name *</Label>
              <Input
                value={newCategoryTabName}
                onChange={(e) => {
                  setNewCategoryTabName(e.target.value);
                  setCategoryActionError("");
                }}
                placeholder="e.g. Premium Linens"
                data-testid="input-new-category-tab-name"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-semibold">Items *</Label>
                <Badge variant="secondary" className="text-xs">
                  {selectedNewCategoryProducts.length} selected
                </Badge>
              </div>
              <Input
                value={newCategoryTabSearch}
                onChange={(e) => setNewCategoryTabSearch(e.target.value)}
                placeholder="Search items..."
                data-testid="input-new-category-item-search"
              />
              <div className="max-h-[48vh] space-y-1 overflow-y-auto rounded-md border p-1">
                {createCategoryCandidateProducts.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No items found
                  </p>
                ) : (
                  createCategoryCandidateProducts.map((product) => {
                    const isSelected = newCategoryTabProductIds.includes(
                      product.id,
                    );
                    const categoryName = getDisplayCategoryName(
                      product.category,
                    );
                    const imageSrc =
                      product.imageUrl || getProductImage(product.name);

                    return (
                      <div
                        key={`new-category-product-${product.id}`}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md border p-2 text-left transition-colors",
                          isSelected
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:bg-accent/50",
                        )}
                        onClick={() =>
                          toggleNewCategoryProductSelection(product.id)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleNewCategoryProductSelection(product.id);
                          }
                        }}
                        data-testid={`button-new-category-product-${product.id}`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() =>
                            toggleNewCategoryProductSelection(product.id)
                          }
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`checkbox-new-category-product-${product.id}`}
                        />
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                          {imageSrc ? (
                            <img
                              src={imageSrc}
                              alt={product.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            getCategoryIcon(categoryName, "h-5 w-5")
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">
                            {product.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {getProductCategoryDisplayName(categoryName)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {categoryActionError && (
              <p className="text-xs text-destructive">{categoryActionError}</p>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowCreateCategoryDialog(false);
                  resetCreateCategoryDialog();
                }}
                disabled={isCreatingCategoryFromTab}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={() => void handleCreateCategoryFromTab()}
                disabled={
                  isCreatingCategoryFromTab ||
                  !newCategoryTabName.trim() ||
                  selectedNewCategoryProducts.length === 0
                }
                data-testid="button-create-category-tab-confirm"
              >
                {isCreatingCategoryFromTab ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Category"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add New Product Dialog */}
      <Dialog
        open={showNewProductDialog}
        onOpenChange={setShowNewProductDialog}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-w-md max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              Add New Item to Inventory
            </DialogTitle>
            <DialogDescription>
              This item will be added to{" "}
              <span className="font-semibold text-primary">
                {newProductCategory}
              </span>{" "}
              category and saved to inventory.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Item Name *</Label>
              <Input
                placeholder="e.g., Dress Shirt, Jacket, etc."
                value={newProductName}
                onChange={(e) => setNewProductName(e.target.value)}
                data-testid="input-new-product-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">
                  Normal Price (AED) *
                </Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={newProductPrice}
                  onChange={(e) => setNewProductPrice(e.target.value)}
                  data-testid="input-new-product-price"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">
                  Dry Clean Price (AED)
                </Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={newProductDryCleanPrice}
                  onChange={(e) => setNewProductDryCleanPrice(e.target.value)}
                  data-testid="input-new-product-dryclean-price"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Category</Label>
              <Select
                value={safeNewProductCategory}
                onValueChange={setNewProductCategory}
              >
                <SelectTrigger
                  data-testid="select-new-product-category"
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    setNewProductCategory(uncategorizedCategoryName);
                  }}
                >
                  <SelectValue placeholder={uncategorizedCategoryName} />
                </SelectTrigger>
                <SelectContent>
                  {newProductCategoryOptions
                    .filter(
                      (categoryName) =>
                        typeof categoryName === "string" &&
                        categoryName.trim().length > 0,
                    )
                    .map((categoryName) => (
                      <SelectItem key={categoryName} value={categoryName}>
                        {getProductCategoryDisplayName(categoryName)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowNewProductDialog(false);
                  setNewProductName("");
                  setNewProductPrice("");
                  setNewProductDryCleanPrice("");
                  setNewProductCategory(uncategorizedCategoryName);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={async () => {
                  if (!newProductName.trim() || !newProductPrice) {
                    toast({
                      title: "Missing information",
                      description: "Please enter item name and price",
                      variant: "destructive",
                    });
                    return;
                  }
                  setIsCreatingProduct(true);
                  try {
                    await apiRequest("POST", "/api/products", {
                      name: newProductName.trim(),
                      price: newProductPrice,
                      dryCleanPrice: newProductDryCleanPrice
                        ? newProductDryCleanPrice
                        : null,
                      category: normalizeStoredProductCategoryName(
                        newProductCategory,
                        orderedCategoryOptions,
                      ),
                    });
                    queryClient.invalidateQueries({
                      queryKey: ["/api/products"],
                    });
                    toast({
                      title: "Item added",
                      description: `${newProductName} has been added to inventory`,
                    });
                    setShowNewProductDialog(false);
                    setNewProductName("");
                    setNewProductPrice("");
                    setNewProductDryCleanPrice("");
                    setNewProductCategory(uncategorizedCategoryName);
                  } catch (err: any) {
                    toast({
                      title: "Error",
                      description: err.message || "Failed to add item",
                      variant: "destructive",
                    });
                  } finally {
                    setIsCreatingProduct(false);
                  }
                }}
                disabled={
                  !newProductName.trim() ||
                  !newProductPrice ||
                  isCreatingProduct
                }
                data-testid="button-save-new-product"
              >
                {isCreatingProduct ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  "Add to Inventory"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Move Existing Item Dialog */}
      <Dialog open={showMoveItemDialog} onOpenChange={setShowMoveItemDialog}>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-md max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-blue-500" />
              Move Item to {moveItemTargetCategory}
            </DialogTitle>
            <DialogDescription>
              Select an item from another category to move it to{" "}
              <span className="font-semibold text-primary">
                {moveItemTargetCategory}
              </span>
              .
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="Search items..."
              value={moveItemSearch}
              onChange={(e) => setMoveItemSearch(e.target.value)}
              data-testid="input-move-item-search"
            />
            <div className="max-h-[50vh] overflow-y-auto space-y-1">
              {(allProducts || [])
                .filter(
                  (p: any) =>
                    getDisplayCategoryName(p.category) !==
                    moveItemTargetCategory,
                )
                .filter(
                  (p: any) =>
                    !moveItemSearch ||
                    p.name
                      .toLowerCase()
                      .includes(moveItemSearch.toLowerCase()) ||
                    getDisplayCategoryName(p.category)
                      .toLowerCase()
                      .includes(moveItemSearch.toLowerCase()),
                )
                .map((p: any) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2 rounded-lg border hover:bg-accent/50 cursor-pointer transition-colors"
                    onClick={async () => {
                      try {
                        await apiRequest("PUT", `/api/products/${p.id}`, {
                          category: moveItemTargetCategory,
                        });
                        queryClient.invalidateQueries({
                          queryKey: ["/api/products"],
                        });
                        toast({
                          title: "Item moved",
                          description: `${p.name} moved to ${moveItemTargetCategory}`,
                        });
                        setShowMoveItemDialog(false);
                      } catch (err: any) {
                        toast({
                          title: "Error",
                          description: err.message || "Failed to move item",
                          variant: "destructive",
                        });
                      }
                    }}
                    data-testid={`button-move-product-${p.id}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {getProductCategoryDisplayName(
                          getDisplayCategoryName(p.category),
                        )}
                      </p>
                    </div>
                    <ArrowRightLeft className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </div>
                ))}
              {(allProducts || [])
                .filter(
                  (p: any) =>
                    getDisplayCategoryName(p.category) !==
                    moveItemTargetCategory,
                )
                .filter(
                  (p: any) =>
                    !moveItemSearch ||
                    p.name
                      .toLowerCase()
                      .includes(moveItemSearch.toLowerCase()) ||
                    getDisplayCategoryName(p.category)
                      .toLowerCase()
                      .includes(moveItemSearch.toLowerCase()),
                ).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No items found
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Full New Client Dialog */}
      <Dialog open={showNewClientDialog} onOpenChange={setShowNewClientDialog}>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-md max-h-[80vh] sm:max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>
              {newClientMode === "broker" ? "Add New Broker" : "Add New Client"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 pb-8">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Name *</Label>
                <Input
                  placeholder="Client name"
                  value={newClientName}
                  onChange={(e) =>
                    setNewClientName(e.target.value.toUpperCase())
                  }
                  data-testid="input-new-client-name"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Phone *</Label>
                <div className="space-y-1">
                  <InternationalPhoneInput
                    value={newClientPhone}
                    onChange={(value) => {
                      setNewClientPhone(value);
                      if (value) {
                        checkExistingClientByPhone(value);
                      } else {
                        setSuggestedExistingClient(null);
                      }
                    }}
                    placeholder="Phone number"
                    inputTestId="input-new-client-phone"
                    selectTestId="select-new-client-phone-country"
                  />
                  <p className="text-xs text-muted-foreground">
                    UAE +971 is default. Use another country flag for
                    international numbers.
                  </p>
                </div>
              </div>
            </div>
            {suggestedExistingClient && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-md">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      Phone number already exists
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                      This number belongs to:{" "}
                      <strong>{suggestedExistingClient.name}</strong>
                      {suggestedExistingClient.address && (
                        <span className="block text-muted-foreground">
                          {suggestedExistingClient.address}
                        </span>
                      )}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => {
                        const matchingClient =
                          clients?.find(
                            (client) =>
                              client.id === suggestedExistingClient.id,
                          ) || null;
                        if (matchingClient) {
                          handleUseExistingClient(matchingClient);
                        } else {
                          setSelectedClientId(suggestedExistingClient.id);
                          setIsBroker(false);
                          setCustomerName(suggestedExistingClient.name);
                          setCustomerPhone(suggestedExistingClient.phone || "");
                          setDeliveryType(
                            suggestedExistingClient.address &&
                              suggestedExistingClient.address.trim() &&
                              suggestedExistingClient.address !== "-"
                              ? "delivery"
                              : "pickup",
                          );
                        }
                        setWalkInAddress(suggestedExistingClient.address || "");
                        setIsWalkIn(false);
                        setShowNewClientDialog(false);
                        setSuggestedExistingClient(null);
                        setNewClientName("");
                        setNewClientPhone("");
                        setNewClientAddress("");
                        setNewClientEmail("");
                        setNewClientContact("");
                        setNewClientPaymentMethod("cash");
                        setNewClientDiscount("");
                        toast({
                          title: "Client selected",
                          description: `Using existing client: ${suggestedExistingClient.name}`,
                        });
                      }}
                      data-testid="button-use-existing-client"
                    >
                      Use This Client
                    </Button>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Email</Label>
              <Input
                type="email"
                placeholder="Email address"
                value={newClientEmail}
                onChange={(e) => setNewClientEmail(e.target.value)}
                data-testid="input-new-client-email"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Address</Label>
              <Input
                placeholder="Full address"
                value={newClientAddress}
                onChange={(e) =>
                  setNewClientAddress(e.target.value.toUpperCase())
                }
                data-testid="input-new-client-address"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Contact Person</Label>
              <Input
                placeholder="Contact person name"
                value={newClientContact}
                onChange={(e) =>
                  setNewClientContact(e.target.value.toUpperCase())
                }
                data-testid="input-new-client-contact"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Payment Method</Label>
                <Select
                  value={newClientPaymentMethod}
                  onValueChange={setNewClientPaymentMethod}
                >
                  <SelectTrigger data-testid="select-new-client-payment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="bank">Bank Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Discount %</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="0"
                  value={newClientDiscount}
                  onChange={(e) => setNewClientDiscount(e.target.value)}
                  data-testid="input-new-client-discount"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowNewClientDialog(false);
                  setSuggestedExistingClient(null);
                  setNewClientName("");
                  setNewClientPhone("");
                  setNewClientAddress("");
                  setNewClientEmail("");
                  setNewClientContact("");
                  setNewClientPaymentMethod("cash");
                  setNewClientDiscount("");
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleCreateNewClient}
                disabled={isCreatingClient}
                data-testid="button-create-new-client"
              >
                {isCreatingClient
                  ? "Creating..."
                  : newClientMode === "broker"
                    ? "Create Broker"
                    : "Create Client"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editClientDialog}
        onOpenChange={(open) => !open && setEditClientDialog(null)}
      >
        <DialogContent
          aria-describedby={undefined}
          className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5 text-blue-500" />
              Edit Client
            </DialogTitle>
          </DialogHeader>
          {editClientDialog && (
            <ClientForm
              mode="edit"
              client={editClientDialog}
              onSuccess={() => {
                setEditClientDialog(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Size Selection Dialog */}
      <Dialog
        open={showSizeDialog}
        onOpenChange={(open) => {
          setShowSizeDialog(open);
          if (!open) setSizeDialogServiceType("normal");
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-w-xs max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="text-center">
              {sizeDialogServiceType === "dc"
                ? "Dry Clean - "
                : sizeDialogServiceType === "iron"
                  ? "Iron Only - "
                  : ""}
              Select Size
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="text-center text-sm text-muted-foreground mb-2">
              <div className="font-bold text-foreground text-lg">
                {sizeDialogProduct?.name}
              </div>
              {sizeDialogServiceType !== "normal" && (
                <div
                  className={`text-xs font-semibold mt-1 ${sizeDialogServiceType === "dc" ? "text-purple-600" : "text-orange-600"}`}
                >
                  {sizeDialogServiceType === "dc" ? "Dry Clean" : "Iron Only"}{" "}
                  Service
                </div>
              )}
            </div>

            {sizeDialogProduct && (
              <div className="grid grid-cols-3 gap-3">
                {sizeDialogProduct.smallPrice && (
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="outline"
                      className={`h-24 flex flex-col gap-2 border-2 hover:border-primary hover:bg-primary/10 ${sizeDialogServiceType === "dc" ? "border-purple-300" : sizeDialogServiceType === "iron" ? "border-orange-300" : ""}`}
                      onClick={() => handleAddSizedItem("small")}
                      data-testid="button-size-small"
                    >
                      <div className="text-2xl font-black text-primary">S</div>
                      <div className="font-bold">Small</div>
                      <div
                        className={`text-sm font-bold ${sizeDialogServiceType === "dc" ? "text-purple-600" : sizeDialogServiceType === "iron" ? "text-orange-600" : "text-primary"}`}
                      >
                        {sizeDialogServiceType === "dc"
                          ? parseFloat(
                              sizeDialogProduct.smallDryCleanPrice ||
                                String(
                                  parseFloat(
                                    sizeDialogProduct.smallPrice || "0",
                                  ) * 2,
                                ),
                            ).toFixed(0)
                          : sizeDialogServiceType === "iron"
                            ? parseFloat(
                                sizeDialogProduct.smallIronOnlyPrice ||
                                  String(
                                    parseFloat(
                                      sizeDialogProduct.smallPrice || "0",
                                    ) / 2,
                                  ),
                              ).toFixed(0)
                            : parseFloat(sizeDialogProduct.smallPrice).toFixed(
                                0,
                              )}{" "}
                        AED
                      </div>
                    </Button>
                    {sizeDialogServiceType === "normal" &&
                      sizeDialogProduct.smallUrgentPrice && (
                        <div className="text-[10px] text-center text-red-600 font-medium">
                          Urgent:{" "}
                          {parseFloat(
                            sizeDialogProduct.smallUrgentPrice,
                          ).toFixed(0)}{" "}
                          AED
                        </div>
                      )}
                    {sizeDialogServiceType === "normal" &&
                      sizeDialogProduct.smallDryCleanPrice && (
                        <div className="text-[10px] text-center text-blue-600 font-medium">
                          DC:{" "}
                          {parseFloat(
                            sizeDialogProduct.smallDryCleanPrice,
                          ).toFixed(0)}{" "}
                          AED
                        </div>
                      )}
                    {sizeDialogServiceType === "normal" &&
                      sizeDialogProduct.smallIronOnlyPrice && (
                        <div className="text-[10px] text-center text-orange-600 font-medium">
                          IO:{" "}
                          {parseFloat(
                            sizeDialogProduct.smallIronOnlyPrice,
                          ).toFixed(0)}{" "}
                          AED
                        </div>
                      )}
                  </div>
                )}
                {(sizeDialogProduct.mediumPrice || sizeDialogProduct.price) && (
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="outline"
                      className={`h-24 flex flex-col gap-2 border-2 hover:border-primary hover:bg-primary/10 ${sizeDialogServiceType === "dc" ? "border-purple-300" : sizeDialogServiceType === "iron" ? "border-orange-300" : ""}`}
                      onClick={() => handleAddSizedItem("medium")}
                      data-testid="button-size-medium"
                    >
                      <div className="text-2xl font-black text-primary">M</div>
                      <div className="font-bold">Medium</div>
                      <div
                        className={`text-sm font-bold ${sizeDialogServiceType === "dc" ? "text-purple-600" : sizeDialogServiceType === "iron" ? "text-orange-600" : "text-primary"}`}
                      >
                        {sizeDialogServiceType === "dc"
                          ? parseFloat(
                              sizeDialogProduct.mediumDryCleanPrice ||
                                String(
                                  parseFloat(
                                    sizeDialogProduct.mediumPrice ||
                                      sizeDialogProduct.price ||
                                      "0",
                                  ) * 2,
                                ),
                            ).toFixed(0)
                          : sizeDialogServiceType === "iron"
                            ? parseFloat(
                                sizeDialogProduct.mediumIronOnlyPrice ||
                                  String(
                                    parseFloat(
                                      sizeDialogProduct.mediumPrice ||
                                        sizeDialogProduct.price ||
                                        "0",
                                    ) / 2,
                                  ),
                              ).toFixed(0)
                            : parseFloat(
                                sizeDialogProduct.mediumPrice ||
                                  sizeDialogProduct.price ||
                                  "0",
                              ).toFixed(0)}{" "}
                        AED
                      </div>
                    </Button>
                    {sizeDialogServiceType === "normal" &&
                      sizeDialogProduct.mediumUrgentPrice && (
                        <div className="text-[10px] text-center text-red-600 font-medium">
                          Urgent:{" "}
                          {parseFloat(
                            sizeDialogProduct.mediumUrgentPrice,
                          ).toFixed(0)}{" "}
                          AED
                        </div>
                      )}
                    {sizeDialogServiceType === "normal" &&
                      sizeDialogProduct.mediumDryCleanPrice && (
                        <div className="text-[10px] text-center text-blue-600 font-medium">
                          DC:{" "}
                          {parseFloat(
                            sizeDialogProduct.mediumDryCleanPrice,
                          ).toFixed(0)}{" "}
                          AED
                        </div>
                      )}
                    {sizeDialogServiceType === "normal" &&
                      sizeDialogProduct.mediumIronOnlyPrice && (
                        <div className="text-[10px] text-center text-orange-600 font-medium">
                          IO:{" "}
                          {parseFloat(
                            sizeDialogProduct.mediumIronOnlyPrice,
                          ).toFixed(0)}{" "}
                          AED
                        </div>
                      )}
                  </div>
                )}
                {sizeDialogProduct.largePrice && (
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="outline"
                      className={`h-24 flex flex-col gap-2 border-2 hover:border-primary hover:bg-primary/10 ${sizeDialogServiceType === "dc" ? "border-purple-300" : sizeDialogServiceType === "iron" ? "border-orange-300" : ""}`}
                      onClick={() => handleAddSizedItem("large")}
                      data-testid="button-size-large"
                    >
                      <div className="text-2xl font-black text-primary">L</div>
                      <div className="font-bold">Large</div>
                      <div
                        className={`text-sm font-bold ${sizeDialogServiceType === "dc" ? "text-purple-600" : sizeDialogServiceType === "iron" ? "text-orange-600" : "text-primary"}`}
                      >
                        {sizeDialogServiceType === "dc"
                          ? parseFloat(
                              sizeDialogProduct.largeDryCleanPrice ||
                                String(
                                  parseFloat(
                                    sizeDialogProduct.largePrice || "0",
                                  ) * 2,
                                ),
                            ).toFixed(0)
                          : sizeDialogServiceType === "iron"
                            ? parseFloat(
                                sizeDialogProduct.largeIronOnlyPrice ||
                                  String(
                                    parseFloat(
                                      sizeDialogProduct.largePrice || "0",
                                    ) / 2,
                                  ),
                              ).toFixed(0)
                            : parseFloat(sizeDialogProduct.largePrice).toFixed(
                                0,
                              )}{" "}
                        AED
                      </div>
                    </Button>
                    {sizeDialogServiceType === "normal" &&
                      sizeDialogProduct.largeUrgentPrice && (
                        <div className="text-[10px] text-center text-red-600 font-medium">
                          Urgent:{" "}
                          {parseFloat(
                            sizeDialogProduct.largeUrgentPrice,
                          ).toFixed(0)}{" "}
                          AED
                        </div>
                      )}
                    {sizeDialogServiceType === "normal" &&
                      sizeDialogProduct.largeDryCleanPrice && (
                        <div className="text-[10px] text-center text-blue-600 font-medium">
                          DC:{" "}
                          {parseFloat(
                            sizeDialogProduct.largeDryCleanPrice,
                          ).toFixed(0)}{" "}
                          AED
                        </div>
                      )}
                    {sizeDialogServiceType === "normal" &&
                      sizeDialogProduct.largeIronOnlyPrice && (
                        <div className="text-[10px] text-center text-orange-600 font-medium">
                          IO:{" "}
                          {parseFloat(
                            sizeDialogProduct.largeIronOnlyPrice,
                          ).toFixed(0)}{" "}
                          AED
                        </div>
                      )}
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Sized Item Service Picker Dialog - pick from existing order items */}
      <Dialog
        open={showSizedServicePicker}
        onOpenChange={(open) => {
          if (!open) {
            setShowSizedServicePicker(false);
            setSizedServicePickerProduct(null);
          }
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-w-sm max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="text-center">
              {sizedServicePickerType === "dc" ? "Dry Clean" : "Iron Only"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="text-center">
              <div className="font-bold text-lg">
                {sizedServicePickerProduct?.name}
              </div>
              <div
                className={`text-xs font-semibold mt-1 ${sizedServicePickerType === "dc" ? "text-purple-600" : "text-orange-600"}`}
              >
                Select item & quantity to convert
              </div>
            </div>

            {sizedServicePickerProduct &&
              (() => {
                const matchingItems = customItems.filter(
                  (item) =>
                    item.name
                      .toLowerCase()
                      .startsWith(
                        sizedServicePickerProduct.name.toLowerCase() + " (",
                      ) && item.serviceType !== sizedServicePickerType,
                );

                if (matchingItems.length === 0) {
                  return (
                    <div className="text-center text-sm text-muted-foreground py-4">
                      No items available to convert
                    </div>
                  );
                }

                return matchingItems.map((item, i) => {
                  const sizeName =
                    item.name.match(/\((Small|Medium|Large)\)/)?.[1] || "";
                  const sizeKey = sizeName.toLowerCase() as
                    | "small"
                    | "medium"
                    | "large";
                  let servicePrice = 0;
                  if (sizeKey === "small") {
                    const base = parseFloat(
                      sizedServicePickerProduct.smallPrice || "0",
                    );
                    servicePrice =
                      sizedServicePickerType === "dc"
                        ? parseFloat(
                            sizedServicePickerProduct.smallDryCleanPrice ||
                              String(base * 2),
                          )
                        : parseFloat(
                            sizedServicePickerProduct.smallIronOnlyPrice ||
                              String(base / 2),
                          );
                  } else if (sizeKey === "medium") {
                    const base = parseFloat(
                      sizedServicePickerProduct.mediumPrice ||
                        sizedServicePickerProduct.price ||
                        "0",
                    );
                    servicePrice =
                      sizedServicePickerType === "dc"
                        ? parseFloat(
                            sizedServicePickerProduct.mediumDryCleanPrice ||
                              String(base * 2),
                          )
                        : parseFloat(
                            sizedServicePickerProduct.mediumIronOnlyPrice ||
                              String(base / 2),
                          );
                  } else if (sizeKey === "large") {
                    const base = parseFloat(
                      sizedServicePickerProduct.largePrice || "0",
                    );
                    servicePrice =
                      sizedServicePickerType === "dc"
                        ? parseFloat(
                            sizedServicePickerProduct.largeDryCleanPrice ||
                              String(base * 2),
                          )
                        : parseFloat(
                            sizedServicePickerProduct.largeIronOnlyPrice ||
                              String(base / 2),
                          );
                  }

                  const currentServiceLabel =
                    !item.serviceType || item.serviceType === "normal"
                      ? "Normal"
                      : item.serviceType === "dc"
                        ? "DC"
                        : "IO";

                  return (
                    <div
                      key={`${item.name}-${item.serviceType}-${i}`}
                      className={`border-2 rounded-lg p-3 ${sizedServicePickerType === "dc" ? "border-purple-200" : "border-orange-200"}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="font-bold text-sm">{sizeName}</span>
                          <span
                            className={`ml-1 text-[9px] px-1 rounded text-white ${currentServiceLabel === "DC" ? "bg-purple-600" : currentServiceLabel === "IO" ? "bg-orange-500" : "bg-gray-500"}`}
                          >
                            {currentServiceLabel}
                          </span>
                          <span className="text-xs text-muted-foreground ml-2">
                            x{item.quantity}
                          </span>
                        </div>
                        <div
                          className={`text-sm font-bold ${sizedServicePickerType === "dc" ? "text-purple-600" : "text-orange-600"}`}
                        >
                          {servicePrice.toFixed(0)} AED
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          How many?
                        </span>
                        {Array.from(
                          { length: item.quantity },
                          (_, q) => q + 1,
                        ).map((qty) => (
                          <Button
                            key={qty}
                            size="sm"
                            variant="outline"
                            data-testid={`button-convert-${sizeName.toLowerCase()}-${item.serviceType || "normal"}-qty-${qty}`}
                            className={`min-w-[36px] text-xs font-bold ${sizedServicePickerType === "dc" ? "border-purple-300 text-purple-700" : "border-orange-300 text-orange-700"}`}
                            onClick={() =>
                              handleConvertSizedItemService(
                                item.name,
                                item.serviceType,
                                qty,
                              )
                            }
                          >
                            {qty}
                          </Button>
                        ))}
                      </div>
                    </div>
                  );
                });
              })()}

            <div className="border-t pt-3 mt-3">
              <Button
                variant="outline"
                className="w-full text-sm"
                data-testid="button-add-new-sized-service"
                onClick={() => {
                  setShowSizedServicePicker(false);
                  if (sizedServicePickerProduct) {
                    setSizeDialogProduct(sizedServicePickerProduct);
                    setSizeDialogServiceType(sizedServicePickerType);
                    setShowSizeDialog(true);
                  }
                  setSizedServicePickerProduct(null);
                }}
              >
                + Add New{" "}
                {sizedServicePickerType === "dc" ? "Dry Clean" : "Iron Only"}{" "}
                Item
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sized Item Urgent Picker Dialog */}
      <Dialog
        open={showSizedUrgentPicker}
        onOpenChange={(open) => {
          if (!open) {
            setShowSizedUrgentPicker(false);
            setSizedUrgentPickerProductName("");
          }
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-w-sm max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="text-center">Urgent</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="text-center">
              <div className="font-bold text-lg">
                {sizedUrgentPickerProductName}
              </div>
              <div className="text-xs font-semibold mt-1 text-red-600">
                Toggle urgent for each item
              </div>
            </div>

            {sizedUrgentPickerProductName &&
              (() => {
                const matchingItems = customItems
                  .map((item, idx) => ({ item, idx }))
                  .filter(({ item }) =>
                    item.name
                      .toLowerCase()
                      .startsWith(
                        sizedUrgentPickerProductName.toLowerCase() + " (",
                      ),
                  );

                if (matchingItems.length === 0) {
                  return (
                    <div className="text-center text-sm text-muted-foreground py-4">
                      No items in order
                    </div>
                  );
                }

                return matchingItems.map(({ item, idx }) => {
                  const sizeName =
                    item.name.match(/\((Small|Medium|Large)\)/)?.[1] || "";
                  const serviceLabel =
                    !item.serviceType || item.serviceType === "normal"
                      ? "Normal"
                      : item.serviceType === "dc"
                        ? "DC"
                        : "IO";

                  return (
                    <div
                      key={`${item.name}-${item.serviceType}-${idx}`}
                      className={`border-2 rounded-lg p-3 ${item.isUrgent ? "border-red-300 bg-red-50 dark:bg-red-900/20" : "border-muted"}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-sm">{sizeName}</span>
                          <span
                            className={`text-[9px] px-1 rounded text-white ${serviceLabel === "DC" ? "bg-purple-600" : serviceLabel === "IO" ? "bg-orange-500" : "bg-gray-500"}`}
                          >
                            {serviceLabel}
                          </span>
                          {item.isUrgent && (
                            <span className="text-[9px] px-1 rounded text-white bg-red-500">
                              URG
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            x{item.quantity}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          data-testid={`button-toggle-sized-urgent-${idx}`}
                          variant={item.isUrgent ? "default" : "outline"}
                          className={`h-7 text-xs font-bold ${item.isUrgent ? "bg-red-500 hover:bg-red-600 text-white" : "border-red-300 text-red-600"}`}
                          onClick={() => {
                            setCustomItems((prev) =>
                              prev.map((ci, i) =>
                                i === idx
                                  ? { ...ci, isUrgent: !ci.isUrgent }
                                  : ci,
                              ),
                            );
                          }}
                        >
                          <Zap className="w-3 h-3 mr-0.5" />
                          {item.isUrgent ? "Remove" : "Urgent"}
                        </Button>
                      </div>
                    </div>
                  );
                });
              })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* SQM Pricing Dialog (for Carpet) */}
      <Dialog
        open={sqmDialog.open}
        onOpenChange={(open) =>
          !open &&
          setSqmDialog({
            open: false,
            productId: null,
            productName: "",
            sqmPrice: "12.00",
          })
        }
      >
        <DialogContent aria-describedby={undefined} className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center text-lg">
              Carpet Size
            </DialogTitle>
            <DialogDescription className="text-center">
              {sqmDialog.productName} is priced at{" "}
              <span className="font-bold text-foreground">
                {sqmDialog.sqmPrice} AED per square meter
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                How many square meters is the carpet?
              </Label>
              <Input
                type="number"
                step="0.1"
                min="0.1"
                placeholder="Enter square meters (e.g., 5)"
                value={sqmInput}
                onChange={(e) => setSqmInput(e.target.value)}
                className="text-center text-lg font-bold h-14"
                autoFocus
                data-testid="input-sqm-value"
              />
            </div>
            {sqmInput &&
              parseFloat(sqmInput) > 0 &&
              (() => {
                const sqmVal = parseFloat(sqmInput);
                const calcPrice = sqmVal * parseFloat(sqmDialog.sqmPrice);
                const finalPrice =
                  sqmVal < 5 ? Math.max(50, calcPrice) : calcPrice;
                return (
                  <div className="text-center p-3 bg-primary/10 rounded-lg">
                    <div className="text-sm text-muted-foreground">
                      Total Price:
                    </div>
                    <div className="text-2xl font-bold text-primary">
                      {finalPrice.toFixed(2)} AED
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {sqmVal < 5
                        ? `Min 50 AED (below 5 sqm)`
                        : `${sqmInput} sqm × ${sqmDialog.sqmPrice} AED/sqm`}
                    </div>
                  </div>
                );
              })()}
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 h-12"
                onClick={() =>
                  setSqmDialog({
                    open: false,
                    productId: null,
                    productName: "",
                    sqmPrice: "12.00",
                  })
                }
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-12"
                onClick={handleSqmConfirm}
                disabled={!sqmInput || parseFloat(sqmInput) <= 0}
                data-testid="button-confirm-sqm"
              >
                Add to Order
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Carpet Service Picker Dialog (for DC/Iron on multiple carpets) */}
      <Dialog
        open={carpetServiceDialog.open}
        onOpenChange={(open) =>
          !open &&
          setCarpetServiceDialog({
            open: false,
            productId: null,
            productName: "",
            serviceType: "dc",
          })
        }
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-w-sm max-h-[85vh] overflow-hidden flex flex-col"
        >
          <DialogHeader>
            <DialogTitle className="text-center text-lg">
              Select Carpet for{" "}
              {carpetServiceDialog.serviceType === "dc"
                ? "Dry Clean"
                : "Iron Only"}
            </DialogTitle>
            <DialogDescription className="text-center">
              You have multiple carpets. Which one would you like to apply{" "}
              {carpetServiceDialog.serviceType === "dc"
                ? "Dry Clean"
                : "Iron Only"}{" "}
              to?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4 flex-1 overflow-y-auto max-h-[50vh]">
            {carpetServiceDialog.productId &&
              carpetEntries
                .filter((e) => e.productId === carpetServiceDialog.productId)
                .map((entry, index) => {
                  const product = products?.find(
                    (p) => p.id === entry.productId,
                  );
                  const sqmPrice = parseFloat(
                    product?.sqmPrice || product?.price || "12",
                  );
                  const calcPrice = entry.sqm * sqmPrice;
                  const totalPrice =
                    entry.sqm < 5 ? Math.max(50, calcPrice) : calcPrice;
                  const isSelected =
                    entry.serviceType === carpetServiceDialog.serviceType;

                  return (
                    <Button
                      key={entry.id}
                      variant="outline"
                      className={`w-full h-auto py-3 flex flex-col items-start gap-1 border-2 ${isSelected ? "border-primary bg-primary/10" : ""}`}
                      onClick={() => handleCarpetServiceSelect(entry.id)}
                      data-testid={`button-carpet-select-${index}`}
                    >
                      <div className="flex justify-between w-full">
                        <span className="font-bold">Carpet #{index + 1}</span>
                        <span className="text-sm text-muted-foreground">
                          {entry.serviceType === "normal"
                            ? "Normal"
                            : entry.serviceType === "dc"
                              ? "DC"
                              : "Iron"}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {entry.sqm} sqm = {totalPrice.toFixed(2)} AED
                        {entry.sqm < 5 ? " (min 50)" : ""}
                      </div>
                      {isSelected && (
                        <div className="text-xs text-primary font-semibold">
                          Click to remove{" "}
                          {carpetServiceDialog.serviceType === "dc"
                            ? "DC"
                            : "Iron"}
                        </div>
                      )}
                    </Button>
                  );
                })}
            <Button
              variant="outline"
              className="w-full mt-2"
              onClick={() =>
                setCarpetServiceDialog({
                  open: false,
                  productId: null,
                  productName: "",
                  serviceType: "dc",
                })
              }
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Gutra Options Dialog */}
      <Dialog open={showGutraDialog} onOpenChange={setShowGutraDialog}>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-sm max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="text-center">Gutra Options</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="text-center text-sm text-muted-foreground mb-2">
              <div className="font-bold text-foreground text-lg">
                {gutraDialogProduct?.name}
              </div>
              <div className="text-primary font-bold">
                {gutraDialogProduct?.price?.toFixed(2)} AED
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-semibold">Nisha Option</Label>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className={`h-16 flex flex-col gap-1 border-2 ${gutraNisha === "nisha" ? "border-primary bg-primary/10" : ""}`}
                  onClick={() => setGutraNisha("nisha")}
                  data-testid="button-gutra-nisha"
                >
                  <div className="font-bold">Nisha</div>
                </Button>
                <Button
                  variant="outline"
                  className={`h-16 flex flex-col gap-1 border-2 ${gutraNisha === "without-nisha" ? "border-primary bg-primary/10" : ""}`}
                  onClick={() => setGutraNisha("without-nisha")}
                  data-testid="button-gutra-without-nisha"
                >
                  <div className="font-bold">Without Nisha</div>
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-semibold">Style</Label>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className={`h-16 flex flex-col gap-1 border-2 ${gutraStyle === "line" ? "border-primary bg-primary/10" : ""}`}
                  onClick={() => setGutraStyle("line")}
                  data-testid="button-gutra-line"
                >
                  <div className="font-bold">Line</div>
                </Button>
                <Button
                  variant="outline"
                  className={`h-16 flex flex-col gap-1 border-2 ${gutraStyle === "straight" ? "border-primary bg-primary/10" : ""}`}
                  onClick={() => setGutraStyle("straight")}
                  data-testid="button-gutra-straight"
                >
                  <div className="font-bold">Straight</div>
                </Button>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={handleAddGutraItem}
              disabled={!gutraNisha || !gutraStyle}
              data-testid="button-add-gutra"
            >
              Add to Order
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Service Type Quantity Dialog */}
      <Dialog
        open={!!serviceTypeDialog}
        onOpenChange={(open) => !open && setServiceTypeDialog(null)}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-w-xs"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            focusServiceTypeQtyInput();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-center">
              {serviceTypeDialog?.type === "dc" ? "Dry Clean" : "Iron Only"}{" "}
              Items
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              applyServiceTypeQty();
            }}
          >
            <div className="text-center text-sm text-muted-foreground">
              <div className="font-bold text-foreground text-lg">
                {serviceTypeDialog?.productName}
              </div>
              <div className="text-muted-foreground text-sm mt-1">
                Total items: {serviceTypeDialog?.maxQty}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                How many for{" "}
                {serviceTypeDialog?.type === "dc" ? "Dry Clean" : "Iron Only"}?
              </Label>
              <Input
                ref={serviceTypeQtyInputRef}
                type="number"
                min="0"
                max={serviceTypeDialog?.maxQty || 0}
                value={serviceTypeQty}
                onChange={(e) => setServiceTypeQty(e.target.value)}
                onFocus={(event) => event.target.select()}
                placeholder="0"
                className="text-center text-lg font-bold"
                data-testid="input-service-type-qty"
              />
              <div className="text-xs text-muted-foreground text-center">
                Remaining will be Normal service
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setServiceTypeDialog(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className={`flex-1 ${serviceTypeDialog?.type === "dc" ? "bg-purple-600 hover:bg-purple-700" : "bg-orange-500 hover:bg-orange-600"}`}
                data-testid="button-apply-service-type"
              >
                Apply
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Urgent Quantity Dialog */}
      <Dialog
        open={!!urgentDialog}
        onOpenChange={(open) => !open && setUrgentDialog(null)}
      >
        <DialogContent aria-describedby={undefined} className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-center flex items-center justify-center gap-2">
              <Zap className="w-5 h-5 text-red-500" />
              Urgent Items
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="text-center text-sm text-muted-foreground">
              <div className="font-bold text-foreground text-lg">
                {urgentDialog?.productName}
              </div>
              <div className="text-muted-foreground text-sm mt-1">
                Total items: {urgentDialog?.maxQty}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                How many are Urgent?
              </Label>
              <Input
                type="number"
                min="0"
                max={urgentDialog?.maxQty || 0}
                value={urgentQtyInput}
                onChange={(e) => setUrgentQtyInput(e.target.value)}
                placeholder="0"
                className="text-center text-lg font-bold"
                data-testid="input-urgent-qty"
              />
              <div className="text-xs text-muted-foreground text-center">
                Remaining will be Normal pricing
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setUrgentDialog(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-red-500 hover:bg-red-600"
                onClick={applyUrgentQty}
                data-testid="button-apply-urgent-qty"
              >
                Apply
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Prices Dialog */}
      <Dialog
        open={!!editingPriceProduct}
        onOpenChange={(open) => !open && setEditingPriceProduct(null)}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-w-sm max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Edit Prices - {editingPriceProduct?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                Normal Price (AED)
              </Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={editingPriceProduct?.price || ""}
                onChange={(e) =>
                  setEditingPriceProduct((prev) =>
                    prev ? { ...prev, price: e.target.value } : null,
                  )
                }
                data-testid="input-edit-normal-price"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                Dry Clean Price (AED)
              </Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={editingPriceProduct?.dryCleanPrice || ""}
                onChange={(e) =>
                  setEditingPriceProduct((prev) =>
                    prev ? { ...prev, dryCleanPrice: e.target.value } : null,
                  )
                }
                data-testid="input-edit-dc-price"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                Iron Only Price (AED)
              </Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={editingPriceProduct?.ironOnlyPrice || ""}
                onChange={(e) =>
                  setEditingPriceProduct((prev) =>
                    prev ? { ...prev, ironOnlyPrice: e.target.value } : null,
                  )
                }
                data-testid="input-edit-iron-price"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-red-600">
                Urgent + Iron Only Price (AED)
              </Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Leave empty to use IO × 2"
                value={editingPriceProduct?.urgentIronOnlyPrice || ""}
                onChange={(e) =>
                  setEditingPriceProduct((prev) =>
                    prev
                      ? { ...prev, urgentIronOnlyPrice: e.target.value }
                      : null,
                  )
                }
                data-testid="input-edit-urgent-iron-price"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-red-600">
                Urgent + Dry Clean Price (AED)
              </Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Leave empty to use DC × 2"
                value={editingPriceProduct?.urgentDryCleanPrice || ""}
                onChange={(e) =>
                  setEditingPriceProduct((prev) =>
                    prev
                      ? { ...prev, urgentDryCleanPrice: e.target.value }
                      : null,
                  )
                }
                data-testid="input-edit-urgent-dc-price"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setEditingPriceProduct(null)}
                data-testid="button-cancel-edit-price"
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  if (editingPriceProduct) {
                    updateProduct.mutate({
                      id: editingPriceProduct.id,
                      price: editingPriceProduct.price || undefined,
                      dryCleanPrice:
                        editingPriceProduct.dryCleanPrice || undefined,
                      ironOnlyPrice:
                        editingPriceProduct.ironOnlyPrice || undefined,
                      urgentIronOnlyPrice:
                        editingPriceProduct.urgentIronOnlyPrice || undefined,
                      urgentDryCleanPrice:
                        editingPriceProduct.urgentDryCleanPrice || undefined,
                    });
                    setEditingPriceProduct(null);
                  }
                }}
                disabled={updateProduct.isPending}
                data-testid="button-save-prices"
              >
                {updateProduct.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cart Popup Dialog - Only for tablet/mobile (xl+ uses sidebar) */}
      <Dialog open={showCartPopup} onOpenChange={setShowCartPopup}>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-sm max-h-[70vh] sm:max-h-[85vh] overflow-y-auto p-0 flex flex-col xl:hidden"
        >
          <DialogHeader className="px-4 pt-4 pb-2 border-b bg-gradient-to-r from-primary/10 to-primary/5">
            <DialogTitle className="flex items-center gap-2 text-primary">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <ShoppingCart className="w-4 h-4 text-white" />
              </div>
              Order Slip
              <Badge className="ml-auto text-xs font-bold bg-primary text-white">
                {orderItems.length + customItems.length} items
              </Badge>
            </DialogTitle>
          </DialogHeader>
          {renderOrderSlipContent(true)}
        </DialogContent>
      </Dialog>

      {/* Adjust Total Price Dialog */}
      <Dialog
        open={showAdjustTotalDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowAdjustTotalDialog(false);
            setAdjustTotalError("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5 text-orange-500" />
              Adjust Total Price
            </DialogTitle>
            <DialogDescription>
              Change the total price for this order. Enter your PIN and provide
              a mandatory reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Current Total:</span>
              <span className="font-medium">
                AED {currentOrderFinalTotal.toFixed(2)}
              </span>
            </div>
            {adjustedOrderTotal != null && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Previously Adjusted To:
                </span>
                <span className="font-medium text-orange-600">
                  {parseFloat(adjustedOrderTotal).toFixed(2)} AED
                </span>
              </div>
            )}
            <div className="space-y-2">
              <Label>New Total (AED)</Label>
              <Input
                type="number"
                step="0.5"
                min="0"
                value={adjustTotalValue}
                onChange={(e) => setAdjustTotalValue(e.target.value)}
                data-testid="input-adjust-order-total"
              />
            </div>
            <div className="space-y-2">
              <Label>
                Reason for Adjustment{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={adjustOrderReason}
                onChange={(e) => setAdjustOrderReason(e.target.value)}
                placeholder="Why is the total being changed?"
                rows={2}
                data-testid="input-adjust-order-reason"
              />
            </div>
            <div className="space-y-2">
              <Label>
                Staff PIN (5 digits) <span className="text-destructive">*</span>
              </Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={5}
                value={adjustTotalPin}
                onChange={(e) => {
                  setAdjustTotalPin(e.target.value.replace(/\D/g, ""));
                  setAdjustTotalError("");
                }}
                placeholder="Enter your PIN"
                data-testid="input-adjust-order-pin"
              />
            </div>
            {adjustTotalError && (
              <p className="text-sm text-destructive">{adjustTotalError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAdjustTotalDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAdjustOrderTotal}
              disabled={
                isVerifyingAdjustPin ||
                adjustTotalPin.length !== 5 ||
                !adjustOrderReason.trim()
              }
              data-testid="button-confirm-adjust-order-total"
            >
              {isVerifyingAdjustPin ? "Verifying..." : "Update Total"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print Tag Prompt Dialog */}
      <Dialog
        open={showPrintTagDialog}
        onOpenChange={(open) => {
          if (!open) handlePrintTagDialogClose(false);
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="sm:max-w-md max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5 text-primary" />
              Order Created Successfully!
            </DialogTitle>
            <DialogDescription>
              Order #{createdOrder?.orderNumber} has been created. Would you
              like to print the order tag now?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            {createdOrder && (
              <div className="p-3 bg-muted rounded-lg space-y-2.5">
                {(() => {
                  const matchedClient = clients?.find(
                    (c) => c.id === createdOrder.clientId,
                  );
                  const displayCustomerName =
                    matchedClient?.name ||
                    createdOrder.customerName ||
                    "Walk-in";
                  const displayCustomerPhone =
                    (createdOrder as Order & { customerPhone?: string })
                      .customerPhone ||
                    matchedClient?.phone ||
                    "-";
                  const displayCustomerAddress =
                    createdOrder.deliveryAddress ||
                    matchedClient?.address ||
                    "-";
                  const displayCreatedBy = createdOrder.entryBy || "Staff";

                  return (
                    <>
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">Order:</span>
                        <span className="font-bold text-right break-all">
                          {createdOrder.orderNumber}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">Customer:</span>
                        <span className="font-medium text-right break-words">
                          {displayCustomerName}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">Phone:</span>
                        <span className="font-medium text-right break-all">
                          {displayCustomerPhone}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">Address:</span>
                        <span className="font-medium text-right break-words max-w-[65%]">
                          {displayCustomerAddress}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">
                          Created By:
                        </span>
                        <span className="font-medium text-right break-words">
                          {displayCreatedBy}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">Total:</span>
                        <span className="font-bold text-primary text-right">
                          AED{" "}
                          {createdOrder.adjustedTotal != null
                            ? createdOrder.adjustedTotal
                            : (createdOrder.finalAmount ??
                              createdOrder.totalAmount)}
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
            <div className="flex gap-3">
              <Button
                variant="default"
                className="flex-1"
                onClick={() => handlePrintTagDialogClose(true)}
              >
                <Printer className="w-4 h-4 mr-2" />
                Print Tag Now
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => handlePrintTagDialogClose(false)}
              >
                Print Later
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={stockOrdersDialog.open}
        onOpenChange={(open) =>
          setStockOrdersDialog((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent className="sm:max-w-[400px] max-h-[70vh]">
          <DialogHeader>
            <DialogTitle>{stockOrdersDialog.productName}</DialogTitle>
            <DialogDescription>
              {stockOrdersDialog.count} items across undelivered orders
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[50vh]">
            {stockOrdersLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : stockProductOrders && stockProductOrders.length > 0 ? (
              <div className="space-y-1.5">
                {stockProductOrders.map((order, idx) => (
                  <div
                    key={`${order.orderNumber}-${idx}`}
                    className="flex items-center justify-between p-2.5 rounded-md border"
                    data-testid={`row-stock-order-${order.orderId}`}
                  >
                    <span className="font-mono font-semibold text-sm">
                      {order.orderNumber}
                    </span>
                    <Badge variant="secondary">{order.quantity}x</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No orders found
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
