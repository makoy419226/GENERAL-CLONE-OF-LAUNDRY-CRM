import { useEffect, useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Plus,
  Users,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Package,
  Truck,
  Search,
  Calendar,
  BarChart3,
  Tag,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Receipt,
  UserCog,
  Mail,
  Lock,
  Key,
  AlertCircle,
  Eye,
  EyeOff,
  Download,
  Check,
  Wallet,
  Phone,
  MapPin,
  Star as StarIcon,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { escapeHtml, formatCompanyPhoneLine, useCompanyContactInfo } from "@/lib/companyContact";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  getItemPickupCompletedQuantityFromMap,
  parseItemPickupStatusMap,
} from "@/lib/itemPickupStatus";
import {
  format,
  addDays,
  addMonths,
  addYears,
  startOfDay,
  endOfDay,
  subDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  parseISO,
} from "date-fns";
import type { Order, Bill, BillPayment, Client, Product } from "@shared/schema";
import { exportToExcel as writeExcel, CellStyle, ExcelExportCell } from "@/lib/excelExport";
import html2pdf from "html2pdf.js";
import SalesReports from "./SalesReports";
import { DateTimeRangePicker } from "@/components/ui/DateTimeRangePicker";

interface PackingWorker {
  id: number;
  name: string;
  active: boolean;
}

interface SystemUser {
  id: number;
  username: string;
  role: string;
  name: string | null;
  email: string | null;
  active: boolean;
  password?: string;
  pin?: string | null;
}

interface StaffMember {
  id: number;
  name: string;
  pin: string;
  roleType: string;
  active: boolean;
}

const loginUserRoleOptions = [
  { value: "counter", label: "Counter" },
  { value: "section", label: "Section" },
  { value: "driver", label: "Delivery Driver" },
] as const;

function normalizeUserRoleForForm(role: string | null | undefined) {
  const normalizedRole = String(role || "").toLowerCase();

  if (normalizedRole === "reception") return "counter";
  if (normalizedRole === "staff") return "section";
  if (normalizedRole === "driver") return "driver";
  if (normalizedRole === "section") return "section";

  return "counter";
}

type DateFilter =
  | "today"
  | "yesterday"
  | "exact_date"
  | "month"
  | "monthly"
  | "yearly"
  | "custom"
  | "all";

type StaffPerformanceActivity = "created" | "tagged" | "packed" | "delivered" | "paid";

type PerformanceRow = {
  kind: "admin" | "staff";
  id: string;
  workerId: number | null;
  name: string;
  roleType: string;
  active: boolean;
  ordersCreated: number;
  taggedCount: number;
  packedCount: number;
  deliveredCount: number;
  billsCreated: number;
};

type ManagementSalesReportBill = Bill & {
  paymentProcessedBy?: string | null;
  paymentProcessedAt?: string | Date | null;
};

type ManagementSalesPeriodResponse = {
  period: {
    period: "daily" | "monthly" | "yearly" | "range";
    from: string;
    to: string;
  };
  clients: Client[];
  orders: Order[];
  bills: ManagementSalesReportBill[];
  billPayments: BillPayment[];
};

type ManagementCreditTransaction = {
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

type PdfRgb = [number, number, number];
type PdfDocument = InstanceType<typeof jsPDF>;

function ReviewsSection() {
  const { data: reviews = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/reviews"],
  });

  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/reviews/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reviews"] });
      toast({ title: "Review deleted" });
    },
  });

  const avgRating = reviews.length > 0
    ? (reviews.reduce((sum: number, r: any) => sum + r.stars, 0) / reviews.length).toFixed(1)
    : "0.0";

  const starCounts = [5, 4, 3, 2, 1].map(s => ({
    stars: s,
    count: reviews.filter((r: any) => r.stars === s).length,
  }));

  const clientReviews = useMemo(() => {
    const map = new Map<string, { clientName: string; accountNumber: string; reviews: any[]; avgStars: number }>();
    reviews.forEach((r: any) => {
      const key = r.clientName || "Unknown";
      if (!map.has(key)) {
        map.set(key, { clientName: r.clientName, accountNumber: r.accountNumber || "-", reviews: [], avgStars: 0 });
      }
      map.get(key)!.reviews.push(r);
    });
    map.forEach((v) => {
      v.avgStars = v.reviews.reduce((s: number, r: any) => s + r.stars, 0) / v.reviews.length;
    });
    return Array.from(map.values()).sort((a, b) => b.reviews.length - a.reviews.length);
  }, [reviews]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-3xl font-bold text-amber-500">{avgRating}</div>
            <div className="flex justify-center gap-0.5 my-1">
              {[1, 2, 3, 4, 5].map(s => (
                <StarIcon key={s} className={`h-4 w-4 ${s <= Math.round(parseFloat(avgRating)) ? "fill-amber-400 text-amber-400" : "text-gray-300"}`} />
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{reviews.length} total reviews</p>
          </CardContent>
        </Card>
        {starCounts.map(({ stars, count }) => (
          <Card key={stars} className={count > 0 ? "" : "opacity-50"}>
            <CardContent className="pt-4 flex items-center gap-3">
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map(s => (
                  <StarIcon key={s} className={`h-3 w-3 ${s <= stars ? "fill-amber-400 text-amber-400" : "text-gray-300"}`} />
                ))}
              </div>
              <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 rounded-full"
                  style={{ width: reviews.length > 0 ? `${(count / reviews.length) * 100}%` : "0%" }}
                />
              </div>
              <span className="text-sm font-medium w-8 text-right">{count}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {clientReviews.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Reviews by Client</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {clientReviews.map((client) => (
                <Accordion key={client.clientName} type="single" collapsible>
                  <AccordionItem value={client.clientName} className="border rounded-lg px-3">
                    <AccordionTrigger className="py-2 hover:no-underline">
                      <div className="flex items-center gap-3 flex-1">
                        <div className="text-left">
                          <span className="font-medium">{client.clientName}</span>
                          <span className="text-xs text-muted-foreground ml-2">#{client.accountNumber}</span>
                        </div>
                        <div className="flex items-center gap-1 ml-auto mr-4">
                          <div className="flex gap-0.5">
                            {[1, 2, 3, 4, 5].map(s => (
                              <StarIcon key={s} className={`h-3 w-3 ${s <= Math.round(client.avgStars) ? "fill-amber-400 text-amber-400" : "text-gray-300"}`} />
                            ))}
                          </div>
                          <span className="text-sm text-muted-foreground">({client.reviews.length})</span>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Order #</TableHead>
                            <TableHead>Rating</TableHead>
                            <TableHead>Comment</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {client.reviews.map((r: any) => (
                            <TableRow key={r.id}>
                              <TableCell className="font-mono text-xs" data-testid={`text-review-order-${r.id}`}>{r.orderNumber}</TableCell>
                              <TableCell>
                                <div className="flex gap-0.5">
                                  {[1, 2, 3, 4, 5].map(s => (
                                    <StarIcon key={s} className={`h-3 w-3 ${s <= r.stars ? "fill-amber-400 text-amber-400" : "text-gray-300"}`} />
                                  ))}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm max-w-[300px] truncate">{r.comment || "-"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "-"}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-red-500 hover:text-red-700"
                                  onClick={() => deleteMutation.mutate(r.id)}
                                  data-testid={`button-delete-review-${r.id}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {reviews.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <StarIcon className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-muted-foreground">No reviews yet</p>
            <p className="text-sm text-muted-foreground mt-1">Reviews will appear here when customers rate their orders on the public tracking page.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function Workers() {
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editWorker, setEditWorker] = useState<PackingWorker | null>(null);
  const [formData, setFormData] = useState({ name: "", role: "Reception", pin: "" });
  const [customRole, setCustomRole] = useState("");
  const [isCustomRole, setIsCustomRole] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  
  const predefinedRoles = ["Reception", "Packer", "Delivery Driver", "Manager", "Supervisor"];
  const [activeTab, setActiveTab] = useState("stats");
  const [statsSubTab, setStatsSubTab] = useState<"staff-stats" | "daily-summary" | "sales-reports" | "delivery-report" | "credit-management" | "reviews">("staff-stats");
  const [salesReportsReloadKey, setSalesReportsReloadKey] = useState(0);
  const [creditManagementReloadKey, setCreditManagementReloadKey] = useState(0);
  const [reviewsReloadKey, setReviewsReloadKey] = useState(0);
  const isStatsTab = activeTab === "stats";
  const isUsersTab = activeTab === "users";
  const isStaffStatsTab = isStatsTab && statsSubTab === "staff-stats";
  const isDailySummaryTab = isStatsTab && statsSubTab === "daily-summary";
  const isSalesReportsTab = isStatsTab && statsSubTab === "sales-reports";
  const isDeliveryReportTab = isStatsTab && statsSubTab === "delivery-report";
  const isCreditManagementTab = isStatsTab && statsSubTab === "credit-management";
  const shouldLoadManagementSummaryData = isStatsTab;
  const shouldLoadOrders = shouldLoadManagementSummaryData;
  const shouldLoadBills = shouldLoadManagementSummaryData;
  const shouldLoadClients = shouldLoadManagementSummaryData;
  const shouldLoadProducts = shouldLoadManagementSummaryData;
  const shouldLoadStaffMembers = isUsersTab || shouldLoadManagementSummaryData;
  const shouldLoadSystemUsers = isUsersTab;
  const workerQueryOptions = {
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false as const,
    refetchOnReconnect: false as const,
  };

  const uaeToday = (() => {
    const now = new Date();
    const uaeOffset = 4 * 60;
    const localOffset = now.getTimezoneOffset();
    const uaeTime = new Date(now.getTime() + (uaeOffset + localOffset) * 60000);
    return format(uaeTime, "yyyy-MM-dd");
  })();
  const uaeCurrentMonth = (() => {
    const now = new Date();
    const uaeOffset = 4 * 60;
    const localOffset = now.getTimezoneOffset();
    const uaeTime = new Date(now.getTime() + (uaeOffset + localOffset) * 60000);
    return format(uaeTime, "yyyy-MM");
  })();

  const [universalDateMode, setUniversalDateMode] = useState<"daily" | "monthly" | "yearly" | "range">("daily");
  const [universalSelectedDate, setUniversalSelectedDate] = useState(uaeToday);
  const [universalSelectedMonth, setUniversalSelectedMonth] = useState(uaeCurrentMonth);
  const [universalSelectedYear, setUniversalSelectedYear] = useState(new Date().getFullYear().toString());
  const [universalStartDate, setUniversalStartDate] = useState(`${uaeToday}T00:00`);
  const [universalEndDate, setUniversalEndDate] = useState(`${uaeToday}T23:59`);
  const shiftUniversalDate = (direction: -1 | 1) => {
    if (universalDateMode === "daily") {
      const baseDate = universalSelectedDate ? parseISO(universalSelectedDate) : parseISO(uaeToday);
      setUniversalSelectedDate(format(addDays(baseDate, direction), "yyyy-MM-dd"));
      return;
    }

    if (universalDateMode === "monthly") {
      const baseMonth = universalSelectedMonth ? parseISO(`${universalSelectedMonth}-01`) : parseISO(`${uaeCurrentMonth}-01`);
      setUniversalSelectedMonth(format(addMonths(baseMonth, direction), "yyyy-MM"));
      return;
    }

    if (universalDateMode === "yearly") {
      const safeYear = Number.parseInt(universalSelectedYear, 10) || new Date().getFullYear();
      setUniversalSelectedYear(String(addYears(new Date(safeYear, 0, 1), direction).getFullYear()));
    }
  };

  const dateFilter = useMemo<DateFilter>(() => {
    if (universalDateMode === "daily") return "exact_date";
    if (universalDateMode === "monthly") return "monthly";
    if (universalDateMode === "yearly") return "yearly";
    if (universalDateMode === "range") return "custom";
    return "today";
  }, [universalDateMode]);
  const customExactDate = universalSelectedDate;
  const customFromDate = universalStartDate;
  const customToDate = universalEndDate;
  const selectedMonth = useMemo(() => {
    if (universalSelectedMonth) {
      const parts = universalSelectedMonth.split("-");
      return parseInt(parts[1]) - 1;
    }
    return new Date().getMonth();
  }, [universalSelectedMonth]);
  const selectedYear = useMemo(() => {
    if (universalDateMode === "yearly") return parseInt(universalSelectedYear);
    if (universalDateMode === "monthly" && universalSelectedMonth) {
      return parseInt(universalSelectedMonth.split("-")[0]);
    }
    return new Date().getFullYear();
  }, [universalDateMode, universalSelectedYear, universalSelectedMonth]);
  const { toast } = useToast();
  const { companyContact } = useCompanyContactInfo();
  const companyPhoneLine = formatCompanyPhoneLine(companyContact);
  const companyNameHtml = escapeHtml(companyContact.companyName.toUpperCase());
  const companyPhoneLineHtml = escapeHtml(companyPhoneLine);

  const [dailySummaryItemDialog, setDailySummaryItemDialog] = useState<{ itemName: string; type: "received" | "delivered" | "remaining"; orders: any[] } | null>(null);
  const [mobileDailySummaryCardsOpen, setMobileDailySummaryCardsOpen] = useState(false);
  const dailySummaryDate = universalSelectedDate;

  const [isUserCreateOpen, setIsUserCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<SystemUser | null>(null);
  const [userFormData, setUserFormData] = useState({
    username: "",
    password: "",
    name: "",
    email: "",
    role: "counter",
    pin: "",
  });
  
  // Visibility toggles for password/PIN per user
  const [visiblePasswords, setVisiblePasswords] = useState<Set<number>>(new Set());
  const [visiblePins, setVisiblePins] = useState<Set<number>>(new Set());
  
  // Driver delivery history dialog
  const [selectedDriverHistory, setSelectedDriverHistory] = useState<{id: number; name: string} | null>(null);
  
  // Staff member management
  const [isStaffMemberCreateOpen, setIsStaffMemberCreateOpen] = useState(false);
  const [editStaffMember, setEditStaffMember] = useState<StaffMember | null>(null);
  const [staffMemberFormData, setStaffMemberFormData] = useState({
    name: "",
    pin: "",
    roleType: "counter" as "counter" | "section" | "driver",
  });
  const [visibleStaffPins, setVisibleStaffPins] = useState<Set<number>>(new Set());
  const [selectedStaffOrders, setSelectedStaffOrders] = useState<{
    staffId: number;
    staffName: string;
    type: "created" | "tagged" | "packed" | "delivered" | "paid";
  } | null>(null);
  
  // Report tab state
  const [reportStartDate, setReportStartDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [reportEndDate, setReportEndDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const reportTableRef = useRef<HTMLDivElement>(null);
  const completionReportRef = useRef<HTMLDivElement | null>(null);
  const [logoBase64, setLogoBase64] = useState<string>("");
  const [selectedDeliveryReportOrders, setSelectedDeliveryReportOrders] = useState<Set<number>>(new Set());
  const [moveDeliveryToDate, setMoveDeliveryToDate] = useState<Date | undefined>(undefined);
  const [isMovingDeliveryDates, setIsMovingDeliveryDates] = useState(false);

  const openOrderInTracking = (
    order: any,
    options?: { focusDateField?: "entry" | "delivery"; focusTab?: "all" | "delivery" },
  ) => {
    const params = new URLSearchParams({
      focusOrderId: String(order.id),
    });

    const focusDateField = options?.focusDateField || "entry";
    const focusDateSource =
      focusDateField === "delivery" ? order?.deliveryDate : order?.entryDate;

    if (focusDateSource) {
      try {
        params.set("focusDate", format(new Date(focusDateSource), "yyyy-MM-dd"));
        if (focusDateField === "delivery") {
          params.set("focusDateField", "delivery");
        }
        if (options?.focusTab === "delivery") {
          params.set("focusTab", "delivery");
        }
      } catch {
        // Ignore invalid dates and fall back to focus by order ID only.
      }
    }

    setDailySummaryItemDialog(null);
    setSelectedDriverHistory(null);
    setSelectedStaffOrders(null);
    setSelectedAdminOrders(null);
    setLocation(`/orders?${params.toString()}`);
  };

  const openBillInBills = (billId: number | null | undefined) => {
    if (!billId) return;
    const params = new URLSearchParams({
      tab: "bills",
      highlightBill: String(billId),
      billId: String(billId),
    });
    setDailySummaryItemDialog(null);
    setSelectedDriverHistory(null);
    setSelectedStaffOrders(null);
    setSelectedAdminOrders(null);
    setLocation(`/bills?${params.toString()}`);
  };
  
  const toggleStaffPinVisibility = (memberId: number) => {
    setVisibleStaffPins(prev => {
      const newSet = new Set(prev);
      if (newSet.has(memberId)) {
        newSet.delete(memberId);
      } else {
        newSet.add(memberId);
      }
      return newSet;
    });
  };
  
  const togglePasswordVisibility = (userId: number) => {
    setVisiblePasswords(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };
  
  const togglePinVisibility = (userId: number) => {
    setVisiblePins(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  const { data: workers, isLoading: isLoadingWorkers } = useQuery<PackingWorker[]>({
    queryKey: ["/api/packing-workers"],
    enabled: isUsersTab,
    ...workerQueryOptions,
  });

  const { data: orders, isLoading: isLoadingOrders } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
    enabled: shouldLoadOrders,
    ...workerQueryOptions,
  });

  const { data: bills, isLoading: isLoadingBills } = useQuery<Bill[]>({
    queryKey: ["/api/bills"],
    enabled: shouldLoadBills,
    ...workerQueryOptions,
  });

  const { data: clients, isLoading: isLoadingClients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: shouldLoadClients,
    ...workerQueryOptions,
  });

  const { data: products, isLoading: isLoadingProducts } = useQuery<Product[]>({
    queryKey: ["/api/products"],
    enabled: shouldLoadProducts,
    ...workerQueryOptions,
  });

  const { data: systemUsers, isLoading: isLoadingUsers } = useQuery<
    SystemUser[]
  >({
    queryKey: ["/api/users"],
    enabled: shouldLoadSystemUsers,
    ...workerQueryOptions,
  });

  // Staff members for counter and section roles
  const { data: staffMembers, isLoading: isLoadingStaffMembers } = useQuery<StaffMember[]>({
    queryKey: ["/api/staff-members"],
    enabled: shouldLoadStaffMembers,
    ...workerQueryOptions,
  });

  const counterStaffMembers = useMemo(() => {
    return staffMembers?.filter(m => m.roleType === 'counter') || [];
  }, [staffMembers]);

  const sectionStaffMembers = useMemo(() => {
    return staffMembers?.filter(m => m.roleType === 'section') || [];
  }, [staffMembers]);

  const driverStaffMembers = useMemo(() => {
    return staffMembers?.filter(m => m.roleType === 'driver') || [];
  }, [staffMembers]);

  // Fetch active sessions to show online status
  const { data: activeSessions } = useQuery<{ activeUserIds: number[] }>({
    queryKey: ["/api/auth/active-sessions"],
    refetchInterval: 120000, // Refresh every 2 minutes to reduce load
    enabled: isUsersTab,
  });

  const isLoading =
    (isUsersTab && (isLoadingUsers || isLoadingStaffMembers || isLoadingWorkers)) ||
    (isStaffStatsTab && (isLoadingOrders || isLoadingBills || isLoadingStaffMembers)) ||
    (isDailySummaryTab && (isLoadingOrders || isLoadingProducts)) ||
    (isDeliveryReportTab && (isLoadingOrders || isLoadingBills || isLoadingClients));

  const reloadCurrentWorkersTab = () => {
    if (isUsersTab) {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff-members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/packing-workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/active-sessions"] });
      return;
    }

    if (isStaffStatsTab) {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff-members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      return;
    }

    if (isDailySummaryTab) {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      return;
    }

    if (isDeliveryReportTab) {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      return;
    }

    if (isSalesReportsTab) {
      setSalesReportsReloadKey((current) => current + 1);
      return;
    }

    if (isCreditManagementTab) {
      setCreditManagementReloadKey((current) => current + 1);
      return;
    }

    if (isStatsTab && statsSubTab === "reviews") {
      queryClient.invalidateQueries({ queryKey: ["/api/reviews"] });
      setReviewsReloadKey((current) => current + 1);
    }
  };

  const handleWorkersMainTabClick = (nextTab: "stats" | "users") => {
    if (nextTab === activeTab) {
      reloadCurrentWorkersTab();
      return;
    }
    setActiveTab(nextTab);
  };

  const handleStatsSubTabClick = (
    nextTab: "staff-stats" | "daily-summary" | "sales-reports" | "delivery-report" | "credit-management" | "reviews",
  ) => {
    if (nextTab === statsSubTab) {
      reloadCurrentWorkersTab();
      return;
    }
    setStatsSubTab(nextTab);
  };

  useEffect(() => {
    setSelectedDeliveryReportOrders(new Set());
    setMoveDeliveryToDate(undefined);
  }, [
    universalDateMode,
    universalSelectedDate,
    universalSelectedMonth,
    universalSelectedYear,
    universalStartDate,
    universalEndDate,
  ]);

  const isUserOnline = (userId: number) => {
    return activeSessions?.activeUserIds?.includes(userId) || false;
  };

  const getNextUsername = (role: string) => {
    const roleUsers = systemUsers?.filter(u => u.role === role) || [];
    return `${role}${roleUsers.length + 1}`;
  };

  const getDateRange = () => {
    const now = new Date();
    switch (dateFilter) {
      case "today":
        return { start: startOfDay(now), end: endOfDay(now) };
      case "yesterday":
        const yesterday = subDays(now, 1);
        return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
      case "exact_date":
        if (customExactDate) {
          const d = parseISO(customExactDate);
          return { start: startOfDay(d), end: endOfDay(d) };
        }
        return { start: startOfDay(now), end: endOfDay(now) };
      case "month":
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case "monthly":
        const monthDate = new Date(selectedYear, selectedMonth, 1);
        return { start: startOfMonth(monthDate), end: endOfMonth(monthDate) };
      case "yearly":
        const yearDate = new Date(selectedYear, 0, 1);
        return { start: startOfYear(yearDate), end: endOfYear(yearDate) };
      case "custom":
        if (customFromDate && customToDate) {
          const parsedStart = parseISO(customFromDate);
          const parsedEnd = parseISO(customToDate);
          return {
            start: isNaN(parsedStart.getTime()) ? startOfDay(now) : parsedStart,
            end: isNaN(parsedEnd.getTime()) ? endOfDay(now) : parsedEnd,
          };
        }
        return { start: startOfDay(now), end: endOfDay(now) };
      case "all":
      default:
        return { start: new Date(0), end: now };
    }
  };

  const managementSummaryPeriod = useMemo<"daily" | "monthly" | "yearly" | "range">(() => {
    if (universalDateMode === "monthly") return "monthly";
    if (universalDateMode === "yearly") return "yearly";
    if (universalDateMode === "range") return "range";
    return "daily";
  }, [universalDateMode]);

  const managementSummaryPeriodBounds = useMemo(() => {
    const { start, end } = getDateRange();
    return { from: start, to: end };
  }, [
    dateFilter,
    customFromDate,
    customToDate,
    customExactDate,
    selectedMonth,
    selectedYear,
  ]);

  const managementSalesPeriodUrl = useMemo(() => {
    const params = new URLSearchParams({
      period: managementSummaryPeriod,
      from: managementSummaryPeriodBounds.from.toISOString(),
      to: managementSummaryPeriodBounds.to.toISOString(),
    });

    return `/api/reports/sales-period?${params.toString()}`;
  }, [managementSummaryPeriod, managementSummaryPeriodBounds.from, managementSummaryPeriodBounds.to]);

  const {
    data: managementSalesPeriodData,
    isLoading: isLoadingManagementSalesPeriodData,
  } = useQuery<ManagementSalesPeriodResponse>({
    queryKey: [managementSalesPeriodUrl],
    enabled: shouldLoadManagementSummaryData,
    ...workerQueryOptions,
  });

  const {
    data: managementCreditTransactions,
    isLoading: isLoadingManagementCreditTransactions,
  } = useQuery<ManagementCreditTransaction[]>({
    queryKey: ["/api/reports/credit-transactions"],
    enabled: shouldLoadManagementSummaryData,
    ...workerQueryOptions,
  });

  const normalizeActorName = (value: string | null | undefined): string => {
    return (value || "")
      .toLowerCase()
      .replace(/\s*\(bulk\)\s*$/i, "")
      .trim();
  };

  const isOrderCompleted = (order: Order): boolean => {
    if (order.delivered === true) return true;
    const status = String(order.status || "").toLowerCase();
    return status === "delivered" || status === "picked_up";
  };

  const getCompletionMode = (order: Order): "Delivery" | "Take-away" => {
    return order.deliveryType === "delivery" ? "Delivery" : "Take-away";
  };


  // All individual staff members (tracked by PIN) - universal tracking
  const allStaffMembers = useMemo(() => {
    return staffMembers || [];
  }, [staffMembers]);

  // Universal worker stats - all individual staff members tracked by PIN
  // Match by NAME instead of ID to avoid ID collision between users and staff_members tables
  const workerStats = useMemo(() => {
    if (!allStaffMembers.length || !orders) return [];
    const { start, end } = getDateRange();

    return allStaffMembers
      .map((worker) => {
        const workerName = normalizeActorName(worker.name);
        
        // Orders created by this worker - match by name
        const createdOrders = orders.filter((o) => {
          const entryName = normalizeActorName(o.entryBy);
          if (entryName !== workerName) return false;
          if (!o.entryDate) return false;
          try {
            const entryDate = new Date(o.entryDate);
            return entryDate >= start && entryDate <= end;
          } catch {
            return false;
          }
        });


        // Bulk tagging: count by order entry date (so moved orders stay correct)
        const taggedOrdersRaw = orders.filter((o) => {
          const tagName = normalizeActorName(o.tagBy);
          if (tagName !== workerName) return false;
          if (!o.tagDone) return false;
          if (!o.entryDate) return false;
          try {
            const orderDate = new Date(o.entryDate);
            return orderDate >= start && orderDate <= end;
          } catch {
            return false;
          }
        });
        // Group by entryDate (ISO string) and count unique
        const taggedBulkSet = new Set(
          taggedOrdersRaw.map((o) => `${normalizeActorName(o.tagBy)}|${o.entryDate}`)
        );
        const taggedCount = taggedBulkSet.size;

        const packedOrdersRaw = orders.filter((o) => {
          const packName = normalizeActorName(o.packingBy);
          if (packName !== workerName) return false;
          if (!o.packingDate) return false;
          try {
            const packDate = new Date(o.packingDate);
            return packDate >= start && packDate <= end;
          } catch {
            return false;
          }
        });
        // Group by packingDate (ISO string) and count unique
        const packedBulkSet = new Set(
          packedOrdersRaw.map((o) => `${normalizeActorName(o.packingBy)}|${o.packingDate}`)
        );
        const packedCount = packedBulkSet.size;

        const deliveredOrdersRaw = orders.filter((o) => {
          const delName = normalizeActorName(o.deliveryBy);
          if (delName !== workerName) return false;
          if (!isOrderCompleted(o)) return false;
          if (!o.deliveryDate) return false;
          try {
            const delDate = new Date(o.deliveryDate);
            return delDate >= start && delDate <= end;
          } catch {
            return false;
          }
        });
        // Group by deliveryDate (ISO string) and count unique
        const deliveredBulkSet = new Set(
          deliveredOrdersRaw.map((o) => `${normalizeActorName(o.deliveryBy)}|${o.deliveryDate}`)
        );
        const deliveredCount = deliveredBulkSet.size;

        const createdBills =
          bills?.filter((b) => {
            const billName = normalizeActorName(b.createdBy);
            if (billName !== workerName) return false;
            if (!b.isPaid) return false; // Only count paid bills
            if (!b.billDate) return false;
            try {
              const billDate = new Date(b.billDate);
              return billDate >= start && billDate <= end;
            } catch {
              return false;
            }
          }) || [];

        const billsTotal = createdBills.reduce(
          (sum, b) => sum + parseFloat(b.amount || "0"),
          0,
        );

        return {
          worker,
          ordersCreated: createdOrders.length,
          taggedCount,
          packedCount,
          deliveredCount,
          billsCreated: createdBills.length,
          billsTotal,
          totalTasks:
            createdOrders.length +
            taggedCount +
            packedCount +
            deliveredCount +
            createdBills.length,
        };
      })
      .sort((a, b) => b.totalTasks - a.totalTasks);
  }, [allStaffMembers, orders, bills, dateFilter, customFromDate, customToDate, customExactDate, selectedMonth, selectedYear]);

  const totals = useMemo(() => {
    return workerStats.reduce(
      (acc, s) => ({
        ordersCreated: acc.ordersCreated + s.ordersCreated,
        tagged: acc.tagged + s.taggedCount,
        packed: acc.packed + s.packedCount,
        delivered: acc.delivered + s.deliveredCount,
        billsPaid: acc.billsPaid + s.billsCreated,
        billsTotal: acc.billsTotal + s.billsTotal,
      }),
      { ordersCreated: 0, tagged: 0, packed: 0, delivered: 0, billsPaid: 0, billsTotal: 0 },
    );
  }, [workerStats]);

  const adminStats = useMemo(() => {
    if (!orders || !bills) return { 
      orders: [] as Order[], 
      ordersCreated: 0,
      billsPaid: 0, 
      billsTotal: 0,
      taggedOrders: [] as Order[],
      packedOrders: [] as Order[],
      deliveredOrders: [] as Order[],
    };
    const { start, end } = getDateRange();
    
    // Match by name "Admin" or "Administrator" (case insensitive) instead of checking for null IDs
    const isAdmin = (name: string | null | undefined) => {
      if (!name) return false;
      const lowerName = normalizeActorName(name);
      return lowerName === 'admin' || lowerName === 'administrator';
    };
    
    // Orders created by admin (match by name)
    const adminOrders = orders.filter((o) => {
      if (!isAdmin(o.entryBy)) return false;
      if (!o.entryDate) return false;
      try {
        const entryDate = new Date(o.entryDate);
        return entryDate >= start && entryDate <= end;
      } catch {
        return false;
      }
    });
    
    // Paid bills by admin (match by name)
    const adminBills = bills.filter((b) => {
      if (!isAdmin(b.createdBy)) return false;
      if (!b.isPaid) return false; // Only count paid bills
      if (!b.billDate) return false;
      try {
        const billDate = new Date(b.billDate);
        return billDate >= start && billDate <= end;
      } catch {
        return false;
      }
    });
    
    // Tagged by admin (match by name) — count by order entry date
    const taggedOrders = orders.filter((o) => {
      if (!isAdmin(o.tagBy)) return false;
      if (!o.tagDone) return false;
      if (!o.entryDate) return false;
      try {
        const orderDateVal = new Date(o.entryDate);
        return orderDateVal >= start && orderDateVal <= end;
      } catch {
        return false;
      }
    });
    
    // Packed by admin (match by name)
    const packedOrders = orders.filter((o) => {
      if (!isAdmin(o.packingBy)) return false;
      if (!o.packingDate) return false;
      try {
        const packingDateVal = new Date(o.packingDate);
        return packingDateVal >= start && packingDateVal <= end;
      } catch {
        return false;
      }
    });
    
    // Delivered by admin (match by name)
    const deliveredOrders = orders.filter((o) => {
      if (!isAdmin(o.deliveryBy)) return false;
      if (!isOrderCompleted(o)) return false;
      if (!o.deliveryDate) return false;
      try {
        const delDateVal = new Date(o.deliveryDate);
        return delDateVal >= start && delDateVal <= end;
      } catch {
        return false;
      }
    });
    
    const billsTotal = adminBills.reduce((sum, b) => sum + parseFloat(b.amount || "0"), 0);
    
    return {
      orders: adminOrders,
      ordersCreated: adminOrders.length,
      billsPaid: adminBills.length,
      billsTotal,
      taggedOrders,
      packedOrders,
      deliveredOrders,
    };
  }, [orders, bills, dateFilter, customFromDate, customToDate, customExactDate, selectedMonth, selectedYear]);

  const smartCardTotals = useMemo(
    () => ({
      ordersCreated: totals.ordersCreated + adminStats.ordersCreated,
      tagged: totals.tagged + adminStats.taggedOrders.length,
      packed: totals.packed + adminStats.packedOrders.length,
      delivered: totals.delivered + adminStats.deliveredOrders.length,
      billsPaid: totals.billsPaid + adminStats.billsPaid,
      billsTotal: totals.billsTotal + adminStats.billsTotal,
    }),
    [totals, adminStats],
  );

  const deliveryReportOrders = useMemo(() => {
    if (!orders) return [];
    const { start, end } = getDateRange();

    return [...orders]
      .filter((order) => {
        if (!isOrderCompleted(order) || !order.deliveryDate) return false;
        try {
          const deliveryDate = new Date(order.deliveryDate);
          return deliveryDate >= start && deliveryDate <= end;
        } catch {
          return false;
        }
      })
      .sort((a, b) => {
        const aTime = a.deliveryDate ? new Date(a.deliveryDate).getTime() : 0;
        const bTime = b.deliveryDate ? new Date(b.deliveryDate).getTime() : 0;
        return bTime - aTime;
      });
  }, [orders, dateFilter, customFromDate, customToDate, customExactDate, selectedMonth, selectedYear]);

  const deliveryCompletionOrders = useMemo(
    () => deliveryReportOrders.filter((order) => getCompletionMode(order) === "Delivery"),
    [deliveryReportOrders],
  );

  const takeAwayCompletionOrders = useMemo(
    () => deliveryReportOrders.filter((order) => getCompletionMode(order) === "Take-away"),
    [deliveryReportOrders],
  );

  const visibleCompletionOrdersWithDates = useMemo(
    () => deliveryReportOrders.filter((order) => Boolean(order.deliveryDate)),
    [deliveryReportOrders],
  );

  const selectedVisibleCompletionOrders = useMemo(
    () => deliveryReportOrders.filter((order) => selectedDeliveryReportOrders.has(order.id)),
    [deliveryReportOrders, selectedDeliveryReportOrders],
  );

  const deliveryReportSummary = useMemo(() => {
    return deliveryReportOrders.reduce(
      (acc, order) => {
        const mode = getCompletionMode(order);
        acc.total += 1;
        if (mode === "Delivery") {
          acc.deliveryCount += 1;
        } else {
          acc.takeAwayCount += 1;
        }
        return acc;
      },
      { total: 0, deliveryCount: 0, takeAwayCount: 0 },
    );
  }, [deliveryReportOrders]);

  const parseSummaryAmount = (value: unknown) => {
    const parsed = parseFloat(String(value ?? "0"));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const isInManagementSummaryPeriod = (value: string | Date | null | undefined) => {
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    return (
      Number.isFinite(timestamp) &&
      timestamp >= managementSummaryPeriodBounds.from.getTime() &&
      timestamp <= managementSummaryPeriodBounds.to.getTime()
    );
  };

  const getOrderFinalAmountForSummary = (
    order: Order,
    billLookup: ReadonlyMap<number, Bill | ManagementSalesReportBill>,
    ordersByBillIdLookup: ReadonlyMap<number, Order[]>,
  ) => {
    const billId = Number(order.billId || 0);
    const linkedBill = Number.isFinite(billId) && billId > 0 ? billLookup.get(billId) : undefined;
    const billOrders = Number.isFinite(billId) && billId > 0 ? ordersByBillIdLookup.get(billId) || [] : [];

    if (linkedBill && billOrders.length <= 1) {
      return Math.max(0, parseSummaryAmount(linkedBill.amount));
    }

    const finalAmount = parseSummaryAmount(order.finalAmount);
    if (finalAmount > 0 || String(order.finalAmount ?? "").trim() !== "") {
      return Math.max(0, finalAmount);
    }

    const originalAmount = parseSummaryAmount(order.totalAmount);
    const discountAmount = parseSummaryAmount(order.discountAmount);
    return Math.max(0, originalAmount - discountAmount);
  };

  const dailyItemCountSummary = useMemo(() => {
    const uaeOffsetMs = 4 * 60 * 60000;
    const uaeNow = new Date(Date.now() + uaeOffsetMs);
    const selectedDate =
      dailySummaryDate ||
      `${uaeNow.getUTCFullYear()}-${String(uaeNow.getUTCMonth() + 1).padStart(2, "0")}-${String(uaeNow.getUTCDate()).padStart(2, "0")}`;
    const [yyyy, mm, dd] = selectedDate.split("-").map(Number);
    const safeDate = Number.isFinite(yyyy) && Number.isFinite(mm) && Number.isFinite(dd)
      ? new Date(yyyy, mm - 1, dd)
      : new Date();
    const dayStartUTC = Date.UTC(safeDate.getFullYear(), safeDate.getMonth(), safeDate.getDate(), 0, 0, 0, 0) - uaeOffsetMs;
    const dayEndUTC = Date.UTC(safeDate.getFullYear(), safeDate.getMonth(), safeDate.getDate(), 23, 59, 59, 999) - uaeOffsetMs;
    const inventoryProducts = products || [];
    const inventoryNameMap = new Map(
      inventoryProducts.map((product) => [product.name.trim().toLowerCase(), product.name]),
    );

    const matchItemToInventoryName = (rawName: string) => {
      let normalizedName = String(rawName || "")
        .replace(/\s*\(base\s*[\d.]+\s*AED\)/gi, " ")
        .replace(/\s*@\s*[\d.]+\s*AED(?:\s*\((custom|min\s*50|admin\s*edited)\))?/gi, " ")
        .replace(/\s*\[(N|DC|IO|D|I)\]\s*/gi, " ")
        .replace(/\s*\*URG\*\s*/gi, " ")
        .replace(/\s*\((folding|hanger|hanging)\)\s*/gi, " ")
        .replace(/\s*\((custom|min\s*50|admin\s*edited)\)\s*$/gi, " ")
        .trim();

      normalizedName = normalizedName.replace(/^\d+(?:\.\d+)?\s*sqm\s+/i, "").trim();
      normalizedName = normalizedName.replace(/\s+/g, " ");
      if (!normalizedName) return null;

      const directMatch = inventoryNameMap.get(normalizedName.toLowerCase());
      if (directMatch) return directMatch;

      const withoutLastParen = normalizedName.replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (withoutLastParen) {
        const fallbackExactMatch = inventoryNameMap.get(withoutLastParen.toLowerCase());
        if (fallbackExactMatch) return fallbackExactMatch;

        const fallbackProduct = inventoryProducts.find(
          (product) =>
            product.name.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase() ===
            withoutLastParen.toLowerCase(),
        );

        if (fallbackProduct?.name) return fallbackProduct.name;
      }

      return normalizedName;
    };

    type DailySummaryParsedItem = {
      index: number;
      name: string;
      quantity: number;
    };

    const parseItems = (itemsStr: string): DailySummaryParsedItem[] => {
      if (!itemsStr) return [];
      const trimmed = itemsStr.trim();
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed
              .map((item: any, index: number) => {
                const matchedName = matchItemToInventoryName(
                  item.name || item.productName || item.itemName || "Unknown",
                );
                if (!matchedName) return null;
                const quantity = Number(item.quantity ?? item.qty ?? 1);
                return {
                  index,
                  name: matchedName,
                  quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
                };
              })
              .filter((item): item is DailySummaryParsedItem => !!item);
          }
        } catch (e) {}
      }

      return itemsStr
        .split(/,\s*/)
        .map((item, index) => {
          const m = item.match(/^(\d+)x\s+(.+)$/);
          if (m) {
            const matchedName = matchItemToInventoryName(m[2]);
            if (!matchedName) return null;
            return { index, name: matchedName, quantity: parseInt(m[1], 10) };
          }
          const m2 = item.match(/^(.+)\s+x(\d+)$/);
          if (m2) {
            const matchedName = matchItemToInventoryName(m2[1]);
            if (!matchedName) return null;
            return { index, name: matchedName, quantity: parseInt(m2[2], 10) };
          }
          const matchedName = matchItemToInventoryName(item.trim());
          if (!matchedName) return null;
          return { index, name: matchedName, quantity: 1 };
        })
        .filter((item): item is DailySummaryParsedItem => !!item);
    };

    const receivedOrders = (orders || []).filter((order) => {
      if (!order.entryDate) return false;
      const timestamp = new Date(order.entryDate).getTime();
      return timestamp >= dayStartUTC && timestamp <= dayEndUTC;
    });
    const receivedMap = new Map<string, number>();
    const completedMap = new Map<string, number>();

    receivedOrders.forEach((order) => {
      const parsedOrderItems = parseItems(order.items || "");
      const pickupStatusMap = parseItemPickupStatusMap((order as any).itemPickupStatus);
      const doneStatus = order.deliveryType === "delivery" ? "delivered" : "picked_up";

      parsedOrderItems.forEach(({ index, name, quantity }) => {
        receivedMap.set(name, (receivedMap.get(name) || 0) + quantity);
        const completedQuantity = getItemPickupCompletedQuantityFromMap(
          pickupStatusMap,
          index,
          quantity,
          doneStatus,
          order.delivered === true,
        );
        if (completedQuantity > 0) {
          completedMap.set(name, (completedMap.get(name) || 0) + completedQuantity);
        }
      });
    });

    const rows = Array.from(new Set([...Array.from(receivedMap.keys()), ...Array.from(completedMap.keys())]))
      .map((name) => {
        const received = receivedMap.get(name) || 0;
        const completed = completedMap.get(name) || 0;
        return {
          name,
          received,
          completed,
          remaining: Math.max(0, received - completed),
        };
      })
      .filter((row) => row.received > 0 || row.completed > 0)
      .sort((left, right) => right.received - left.received || left.name.localeCompare(right.name));

    const totalReceived = rows.reduce((sum, row) => sum + row.received, 0);
    const totalCompleted = rows.reduce((sum, row) => sum + row.completed, 0);

    return {
      dateLabel: format(safeDate, "MMMM d, yyyy"),
      receivedOrdersCount: receivedOrders.length,
      totalReceived,
      totalCompleted,
      totalRemaining: Math.max(0, totalReceived - totalCompleted),
      rows,
    };
  }, [orders, products, dailySummaryDate]);

  const managementSalesSummary = useMemo(() => {
    const salesOrders = managementSalesPeriodData?.orders || [];
    const salesBills = managementSalesPeriodData?.bills || [];
    const salesPayments = managementSalesPeriodData?.billPayments || [];
    const billLookup = new Map<number, ManagementSalesReportBill>();
    salesBills.forEach((bill) => billLookup.set(bill.id, bill));

    const ordersByBillIdLookup = new Map<number, Order[]>();
    salesOrders.forEach((order) => {
      const billId = Number(order.billId || 0);
      if (!Number.isFinite(billId) || billId <= 0) return;
      const existing = ordersByBillIdLookup.get(billId);
      if (existing) {
        existing.push(order);
      } else {
        ordersByBillIdLookup.set(billId, [order]);
      }
    });

    const currentOrders = salesOrders
      .filter((order) => isInManagementSummaryPeriod(order.entryDate))
      .sort((left, right) => {
        const leftTime = new Date(left.entryDate || "").getTime();
        const rightTime = new Date(right.entryDate || "").getTime();
        return leftTime - rightTime;
      });
    const currentOrderBillIds = new Set(
      currentOrders
        .map((order) => Number(order.billId || 0))
        .filter((billId) => Number.isFinite(billId) && billId > 0),
    );
    const currentOrdersTotal = currentOrders.reduce(
      (sum, order) => sum + getOrderFinalAmountForSummary(order, billLookup, ordersByBillIdLookup),
      0,
    );

    const periodPayments = salesPayments
      .filter((payment) => {
        if (!isInManagementSummaryPeriod(payment.paymentDate)) return false;
        const bill = billLookup.get(Number(payment.billId || 0));
        const paidAmount = parseSummaryAmount(bill?.paidAmount);
        return !bill || bill.isPaid || paidAmount > 0.009;
      })
      .sort((left, right) => {
        const leftTime = new Date(left.paymentDate || "").getTime();
        const rightTime = new Date(right.paymentDate || "").getTime();
        return leftTime - rightTime || Number(left.id || 0) - Number(right.id || 0);
      });

    const normalizeMethodKey = (method?: string | null) => {
      const normalized = String(method || "cash").trim().toLowerCase();
      if (normalized === "cash") return "cash";
      if (normalized === "card") return "card";
      if (normalized === "bank" || normalized === "transfer" || normalized === "bank transfer") return "bank";
      if (normalized === "deposit" || normalized === "bulk_deposit" || normalized === "credit") return "credit";
      return "other";
    };
    const methodLabels = {
      cash: "Cash",
      card: "Card",
      bank: "Bank",
      credit: "Credit",
      other: "Other",
    };
    const breakdownMap = new Map<
      "cash" | "card" | "bank" | "credit" | "other",
      { key: "cash" | "card" | "bank" | "credit" | "other"; label: string; paymentCount: number; billIds: Set<number>; totalAmount: number }
    >();
    (["cash", "card", "bank", "credit", "other"] as const).forEach((key) => {
      breakdownMap.set(key, {
        key,
        label: methodLabels[key],
        paymentCount: 0,
        billIds: new Set<number>(),
        totalAmount: 0,
      });
    });

    periodPayments.forEach((payment) => {
      const key = normalizeMethodKey(payment.paymentMethod);
      const bucket = breakdownMap.get(key)!;
      const amount = parseSummaryAmount(payment.amount);
      const billId = Number(payment.billId || 0);
      bucket.paymentCount += 1;
      bucket.totalAmount += amount;
      if (Number.isFinite(billId) && billId > 0) {
        bucket.billIds.add(billId);
      }
    });

    const currentPaymentRows = periodPayments.filter((payment) => currentOrderBillIds.has(Number(payment.billId || 0)));
    const oldPaymentRows = periodPayments.filter((payment) => !currentOrderBillIds.has(Number(payment.billId || 0)));
    const currentPaidBillIds = new Set(
      currentPaymentRows
        .map((payment) => Number(payment.billId || 0))
        .filter((billId) => Number.isFinite(billId) && billId > 0),
    );
    const oldPaidBillIds = new Set(
      oldPaymentRows
        .map((payment) => Number(payment.billId || 0))
        .filter((billId) => Number.isFinite(billId) && billId > 0),
    );

    const paymentBreakdownRows = Array.from(breakdownMap.values())
      .filter((row) => row.paymentCount > 0 || row.key !== "other")
      .map((row) => ({
        key: row.key,
        label: row.label,
        paymentCount: row.paymentCount,
        billCount: row.billIds.size,
        totalAmount: row.totalAmount,
      }));

    return {
      currentOrdersCount: currentOrders.length,
      currentOrdersTotal,
      totalSalesPaymentCount: periodPayments.length,
      totalSalesAmount: periodPayments.reduce((sum, payment) => sum + parseSummaryAmount(payment.amount), 0),
      currentPaidBillCount: currentPaidBillIds.size,
      currentPaidAmount: currentPaymentRows.reduce((sum, payment) => sum + parseSummaryAmount(payment.amount), 0),
      oldPaidBillCount: oldPaidBillIds.size,
      oldPaidAmount: oldPaymentRows.reduce((sum, payment) => sum + parseSummaryAmount(payment.amount), 0),
      paymentBreakdownRows,
    };
  }, [
    managementSalesPeriodData,
    managementSummaryPeriodBounds.from,
    managementSummaryPeriodBounds.to,
  ]);

  const managementCreditSummary = useMemo(() => {
    const transactions = (managementCreditTransactions || [])
      .slice()
      .sort((left, right) => {
        const timeDelta = new Date(left.date).getTime() - new Date(right.date).getTime();
        if (timeDelta !== 0) return timeDelta;
        return left.id - right.id;
      });

    const collectBillIds = (value?: string | null) =>
      Array.from(
        new Set(
          (String(value || "").match(/#(\d+)/g) || [])
            .map((token) => Number(token.replace("#", "")))
            .filter((billId) => Number.isFinite(billId) && billId > 0),
        ),
      );

    const isDeductionType = (type: string) =>
      type === "deposit_used" || type === "bulk_deposit_used" || type === "deposit_deduction";

    const shouldHideBulkDepositSummary = (transaction: ManagementCreditTransaction) => {
      if (transaction.type !== "bulk_deposit_used") return false;
      const summaryBillIds = collectBillIds(transaction.description);
      if (summaryBillIds.length === 0) return false;

      const matchingRows = transactions.filter((candidate) => {
        if (candidate.type !== "deposit_used" || !candidate.billId) return false;
        return summaryBillIds.includes(candidate.billId);
      });
      if (matchingRows.length === 0) return false;

      const matchedBillIds = new Set(
        matchingRows
          .map((candidate) => candidate.billId)
          .filter((billId): billId is number => Number.isFinite(billId)),
      );
      if (summaryBillIds.some((billId) => !matchedBillIds.has(billId))) return false;

      const summaryAmount = parseSummaryAmount(transaction.amount);
      const usedAmount = matchingRows.reduce((sum, candidate) => sum + parseSummaryAmount(candidate.amount), 0);
      return Math.abs(summaryAmount - usedAmount) <= 0.01;
    };

    const entries = transactions
      .filter((transaction) => !shouldHideBulkDepositSummary(transaction))
      .filter((transaction) => isInManagementSummaryPeriod(transaction.date))
      .map((transaction) => {
        const amountValue = parseSummaryAmount(transaction.amount);
        return {
          ...transaction,
          amountValue,
          isDeduction: isDeductionType(transaction.type),
          actor: String(transaction.processedBy || "Unassigned").trim() || "Unassigned",
        };
      });

    const actorMap = new Map<string, { actor: string; entries: number; added: number; used: number }>();
    entries.forEach((entry) => {
      const current = actorMap.get(entry.actor) || { actor: entry.actor, entries: 0, added: 0, used: 0 };
      current.entries += 1;
      if (entry.isDeduction) {
        current.used += entry.amountValue;
      } else {
        current.added += entry.amountValue;
      }
      actorMap.set(entry.actor, current);
    });

    const actorRows = Array.from(actorMap.values()).sort(
      (left, right) =>
        right.entries - left.entries ||
        right.added + right.used - (left.added + left.used) ||
        left.actor.localeCompare(right.actor),
    );
    const totalAdded = entries.reduce((sum, entry) => sum + (entry.isDeduction ? 0 : entry.amountValue), 0);
    const totalUsed = entries.reduce((sum, entry) => sum + (entry.isDeduction ? entry.amountValue : 0), 0);

    return {
      entries,
      actorRows,
      totalAdded,
      totalUsed,
      addedCount: entries.filter((entry) => !entry.isDeduction).length,
      usedCount: entries.filter((entry) => entry.isDeduction).length,
    };
  }, [
    managementCreditTransactions,
    managementSummaryPeriodBounds.from,
    managementSummaryPeriodBounds.to,
  ]);

  const isManagementSummaryLoading =
    shouldLoadManagementSummaryData &&
    (isLoadingOrders ||
      isLoadingBills ||
      isLoadingClients ||
      isLoadingProducts ||
      isLoadingStaffMembers ||
      isLoadingManagementSalesPeriodData ||
      isLoadingManagementCreditTransactions);

  const formatReportDate = (value: string | Date | null | undefined) => {
    if (!value) return "-";
    try {
      return format(new Date(value), isMobile ? "dd MMM yyyy" : "dd MMM yyyy, hh:mm a");
    } catch {
      return "-";
    }
  };

  const formatDateTimeLocalInput = (value: string | Date | null | undefined) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return format(date, "yyyy-MM-dd'T'HH:mm");
  };

  const moveDeliveryDatePreservingTime = (_currentValue: string | Date, targetDate: Date) => {
    return new Date(targetDate);
  };

  const handleMoveDeliveryDates = async (scope: "selected" | "all" = "selected") => {
    const ordersToMove =
      scope === "all" ? visibleCompletionOrdersWithDates : selectedVisibleCompletionOrders;
    if (!moveDeliveryToDate || ordersToMove.length === 0) return;

    setIsMovingDeliveryDates(true);
    try {
      const results = await Promise.allSettled(
        ordersToMove.map(async (order) => {
          if (!order.deliveryDate) {
            throw new Error(`Order ${order.orderNumber} is missing a completion date`);
          }
          const movedDate = moveDeliveryDatePreservingTime(order.deliveryDate, moveDeliveryToDate);
          await apiRequest("PUT", `/api/orders/${order.id}`, {
            deliveryDate: movedDate.toISOString(),
          });
        }),
      );

      const movedCount = results.filter((result) => result.status === "fulfilled").length;

      if (movedCount === 0) {
        throw new Error("No delivery dates were updated");
      }

      await queryClient.invalidateQueries({ queryKey: ["/api/orders"] });

      toast({
        title: "Completion dates updated",
        description: `Moved ${movedCount} completed order${movedCount === 1 ? "" : "s"} to ${moveDeliveryToDate.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}.`,
      });

      setSelectedDeliveryReportOrders(new Set());
      setMoveDeliveryToDate(undefined);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to move completion dates",
        variant: "destructive",
      });
    } finally {
      setIsMovingDeliveryDates(false);
    }
  };

  const toggleCompletionOrderSelection = (orderId: number, checked: boolean) => {
    setSelectedDeliveryReportOrders((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(orderId);
      } else {
        next.delete(orderId);
      }
      return next;
    });
  };

  useEffect(() => {
    if (isMobile || !isDeliveryReportTab) {
      return;
    }

    const isDialogShortcutContextActive = () =>
      Boolean(document.querySelector('[role="dialog"][data-state="open"], [aria-modal="true"]'));

    const focusCompletionReport = () => {
      const reportElement = completionReportRef.current;
      if (!reportElement) return;

      reportElement.focus({ preventScroll: true });
      reportElement.scrollIntoView({ block: "nearest", inline: "nearest" });
    };

    const handleCompletionReportSelectAllShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== "a" || (!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }

      if (isDialogShortcutContextActive()) {
        return;
      }

      event.preventDefault();
      focusCompletionReport();

      if (visibleCompletionOrdersWithDates.length === 0) {
        return;
      }

      const allVisibleSelected = visibleCompletionOrdersWithDates.every((order) =>
        selectedDeliveryReportOrders.has(order.id),
      );

      setSelectedDeliveryReportOrders((prev) => {
        const next = new Set(prev);
        visibleCompletionOrdersWithDates.forEach((order) => {
          if (allVisibleSelected) {
            next.delete(order.id);
          } else {
            next.add(order.id);
          }
        });
        return next;
      });
    };

    window.addEventListener("keydown", handleCompletionReportSelectAllShortcut);
    return () => {
      window.removeEventListener("keydown", handleCompletionReportSelectAllShortcut);
    };
  }, [
    isDeliveryReportTab,
    isMobile,
    selectedDeliveryReportOrders,
    visibleCompletionOrdersWithDates,
  ]);

  const normalizeCompletionReportValue = (value: string | null | undefined) => {
    const trimmed = String(value || "").trim();
    return trimmed || "-";
  };

  const getCompletionReportCustomerName = (order: Order, client?: Client | null) =>
    client?.name || order.customerName || "Walk-in";

  const getCompletionReportPhone = (order: Order, client?: Client | null) =>
    normalizeCompletionReportValue(client?.phone || (order as any).customerPhone);

  const getCompletionReportAddress = (order: Order, client?: Client | null) =>
    normalizeCompletionReportValue(order.deliveryAddress || client?.address);

  const getCompletionReportPaymentStatus = (order: Order) => {
    const linkedBill = order.billId ? bills?.find((entry) => entry.id === order.billId) : undefined;
    const paidAmount = parseFloat(String(linkedBill?.paidAmount || order.paidAmount || "0")) || 0;
    const totalAmount = parseFloat(
      String(linkedBill?.amount || order.finalAmount || order.totalAmount || "0"),
    ) || 0;

    if (linkedBill?.isPaid || (totalAmount > 0 && paidAmount >= totalAmount - 0.01)) {
      return "Paid";
    }
    if (paidAmount > 0.01) {
      return "Partial";
    }
    return "Unpaid";
  };

  const getCompletionReportPaymentBadgeClassName = (paymentStatus: string) => {
    if (paymentStatus === "Paid") {
      return "bg-green-500 text-white hover:bg-green-600";
    }
    if (paymentStatus === "Partial") {
      return "bg-amber-500 text-white hover:bg-amber-600";
    }
    return "bg-blue-500 text-white hover:bg-blue-600";
  };

  const getCompletionReportCustomerCellText = (order: Order, client?: Client | null) => {
    const customerName = getCompletionReportCustomerName(order, client);
    const customerPhone = getCompletionReportPhone(order, client);
    const customerAddress = getCompletionReportAddress(order, client);

    return [customerName, customerPhone, customerAddress]
      .filter((value, index) => index === 0 || value !== "-")
      .join("\n");
  };

  const completionReportTableHeaders = [
    "#",
    "Order #",
    "Bill #",
    "Customer",
    "Completed By",
    "Created",
    "Completed",
    "Payment Status",
  ];

  const renderCompletionReportTable = (
    mode: "delivery" | "takeaway",
    title: string,
    sectionOrders: Order[],
  ) => {
    const isDeliverySection = mode === "delivery";
    const selectedCount = sectionOrders.filter((order) => selectedDeliveryReportOrders.has(order.id)).length;
    const allSelected = sectionOrders.length > 0 && selectedCount === sectionOrders.length;

    if (isMobile) {
      return (
        <div className={`space-y-2.5 ${mobileSurfaceCardClass}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {isDeliverySection ? (
                <Truck className="h-4 w-4 flex-shrink-0 text-green-500" />
              ) : (
                <Package className="h-4 w-4 flex-shrink-0 text-blue-500" />
              )}
              <h3 className="truncate text-[13px] font-semibold text-foreground">{title}</h3>
            </div>
            <Badge variant="outline" className="rounded-xl px-2.5 py-0.5 text-[10px]">
              {sectionOrders.length}
            </Badge>
          </div>

          {sectionOrders.length === 0 ? (
            <p className="py-5 text-center text-[12px] text-muted-foreground">
              No {isDeliverySection ? "delivery" : "take-away"} completions found for this period.
            </p>
          ) : (
            <>
              <div className={`flex items-center justify-between px-3 py-2 ${mobileSubtleCardClass}`}>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) => {
                      setSelectedDeliveryReportOrders((prev) => {
                        const next = new Set(prev);
                        sectionOrders.forEach((order) => {
                          if (checked) {
                            next.add(order.id);
                          } else {
                            next.delete(order.id);
                          }
                        });
                        return next;
                      });
                    }}
                    data-testid={`checkbox-select-all-completion-report-${mode}`}
                  />
                  <span className="text-[12px] font-medium text-foreground">Select all</span>
                </div>
                <span className="text-[11px] text-muted-foreground">{selectedCount} selected</span>
              </div>

              <div className="space-y-2">
                {sectionOrders.map((order, index) => {
                  const client = clients?.find((entry) => entry.id === order.clientId);
                  const customerName = getCompletionReportCustomerName(order, client);
                  const customerPhone = getCompletionReportPhone(order, client);
                  const customerAddress = getCompletionReportAddress(order, client);
                  const paymentStatus = getCompletionReportPaymentStatus(order);

                  return (
                    <div
                      key={`${mode}-${order.id}`}
                      className={`rounded-[16px] border px-3 py-2.5 shadow-[0_1px_0_rgba(15,23,42,0.04)] ${
                        selectedDeliveryReportOrders.has(order.id)
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/70 bg-card"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <Checkbox
                          checked={selectedDeliveryReportOrders.has(order.id)}
                          onCheckedChange={(checked) =>
                            toggleCompletionOrderSelection(order.id, Boolean(checked))
                          }
                          data-testid={`checkbox-completion-report-${mode}-${order.id}`}
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span>{index + 1}.</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-auto px-0 py-0 font-mono text-[12px] font-semibold text-primary hover:bg-transparent hover:text-primary hover:underline"
                                  onClick={() =>
                                    openOrderInTracking(order, {
                                      focusDateField: "delivery",
                                      focusTab: "delivery",
                                    })
                                  }
                                  data-testid={`button-completion-report-order-${mode}-${order.id}`}
                                >
                                  {order.orderNumber}
                                </Button>
                                {order.billId ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-auto px-0 py-0 font-mono text-[11px] text-primary/80 hover:bg-transparent hover:text-primary hover:underline"
                                    onClick={() => openBillInBills(order.billId)}
                                    data-testid={`button-completion-report-bill-${mode}-${order.id}`}
                                  >
                                    #{order.billId}
                                  </Button>
                                ) : null}
                              </div>
                              <div className="mt-1 text-[13px] font-semibold text-foreground">{customerName}</div>
                            </div>
                            <Badge className={`rounded-full px-2 py-0.5 text-[10px] ${getCompletionReportPaymentBadgeClassName(paymentStatus)}`}>
                              {paymentStatus}
                            </Badge>
                          </div>

                          <div className="space-y-1.5 text-[11px] text-muted-foreground">
                            {customerPhone !== "-" && (
                              <div className="flex items-center gap-1.5">
                                <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                                <span>{customerPhone}</span>
                              </div>
                            )}
                            {customerAddress !== "-" && (
                              <div className="flex items-start gap-1.5">
                                <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                                <span>{customerAddress}</span>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-3 gap-2 rounded-[12px] bg-muted/45 px-2.5 py-2 text-[10px]">
                            <div>
                              <div className="text-muted-foreground">By</div>
                              <div className="font-medium text-foreground">{order.deliveryBy || "-"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Created</div>
                              <div className="font-medium text-foreground">{formatReportDate(order.entryDate)}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Completed</div>
                              <div className="font-medium text-foreground">{formatReportDate(order.deliveryDate)}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-2 rounded-lg border bg-background/70 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isDeliverySection ? (
              <Truck className="h-4 w-4 text-green-500" />
            ) : (
              <Package className="h-4 w-4 text-blue-500" />
            )}
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          </div>
          <Badge variant="outline" className="text-[11px]">
            {sectionOrders.length} orders
          </Badge>
        </div>

        {sectionOrders.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No {isDeliverySection ? "delivery" : "take-away"} completions found for this period.
          </p>
        ) : (
          <div className={managementA4TableShellClass}>
            <Table className="screen-a4-table screen-a4-completion-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9 w-8 px-2 py-2">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(checked) => {
                        setSelectedDeliveryReportOrders((prev) => {
                          const next = new Set(prev);
                          sectionOrders.forEach((order) => {
                            if (checked) {
                              next.add(order.id);
                            } else {
                              next.delete(order.id);
                            }
                          });
                          return next;
                        });
                      }}
                      data-testid={`checkbox-select-all-completion-report-${mode}`}
                    />
                  </TableHead>
                  <TableHead className="h-9 w-10 px-2 py-2 text-[11px]">#</TableHead>
                  <TableHead className="h-9 px-2 py-2 text-[11px]">Order #</TableHead>
                  <TableHead className="h-9 px-2 py-2 text-[11px]">Bill #</TableHead>
                  <TableHead className="h-9 px-2 py-2 text-[11px]">Customer</TableHead>
                  <TableHead className="h-9 px-2 py-2 text-[11px]">Completed By</TableHead>
                  <TableHead className="h-9 px-2 py-2 text-center text-[11px]">Created</TableHead>
                  <TableHead className="h-9 px-2 py-2 text-center text-[11px]">Completed</TableHead>
                  <TableHead className="h-9 px-2 py-2 text-center text-[11px]">Payment Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sectionOrders.map((order, index) => {
                  const client = clients?.find((entry) => entry.id === order.clientId);
                  const customerName = getCompletionReportCustomerName(order, client);
                  const customerPhone = getCompletionReportPhone(order, client);
                  const customerAddress = getCompletionReportAddress(order, client);
                  const paymentStatus = getCompletionReportPaymentStatus(order);

                  return (
                    <TableRow
                      key={`${mode}-${order.id}`}
                      className={selectedDeliveryReportOrders.has(order.id) ? "bg-muted/40" : ""}
                    >
                      <TableCell className="px-2 py-2 align-top">
                        <Checkbox
                          checked={selectedDeliveryReportOrders.has(order.id)}
                          onCheckedChange={(checked) =>
                            toggleCompletionOrderSelection(order.id, Boolean(checked))
                          }
                          data-testid={`checkbox-completion-report-${mode}-${order.id}`}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-2 align-top font-medium text-muted-foreground">
                        {index + 1}
                      </TableCell>
                      <TableCell className="px-2 py-2 align-top font-mono">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto px-0 py-0.5 font-mono text-[12px] text-primary hover:bg-transparent hover:text-primary hover:underline"
                          onClick={() =>
                            openOrderInTracking(order, {
                              focusDateField: "delivery",
                              focusTab: "delivery",
                            })
                          }
                          data-testid={`button-completion-report-order-${mode}-${order.id}`}
                        >
                          {order.orderNumber}
                        </Button>
                      </TableCell>
                      <TableCell className="px-2 py-2 align-top">
                        {order.billId ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto px-0 py-0.5 font-mono text-[12px] text-primary hover:bg-transparent hover:text-primary hover:underline"
                            onClick={() => openBillInBills(order.billId)}
                            data-testid={`button-completion-report-bill-${mode}-${order.id}`}
                          >
                            #{order.billId}
                          </Button>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[220px] whitespace-normal break-words px-2 py-2 align-top">
                        <div className="space-y-0.5">
                          <div className="text-[12px] font-medium">{customerName}</div>
                          {customerPhone !== "-" && (
                            <div className="flex items-center gap-1 text-[11px] leading-4 text-muted-foreground">
                              <Phone className="h-3 w-3 flex-shrink-0" />
                              <span>{customerPhone}</span>
                            </div>
                          )}
                          {customerAddress !== "-" && (
                            <div className="flex items-start gap-1 text-[11px] leading-4 text-muted-foreground">
                              <MapPin className="mt-0.5 h-3 w-3 flex-shrink-0" />
                              <span>{customerAddress}</span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-2 align-top text-[11px]">{order.deliveryBy || "-"}</TableCell>
                      <TableCell className="px-2 py-2 align-top text-center text-[11px] leading-4 text-muted-foreground">
                        {formatReportDate(order.entryDate)}
                      </TableCell>
                      <TableCell className="px-2 py-2 align-top text-center text-[11px] leading-4 font-medium">
                        {formatReportDate(order.deliveryDate)}
                      </TableCell>
                      <TableCell className="px-2 py-2 align-top text-center">
                        <Badge className={`px-1.5 py-0.5 text-[10px] ${getCompletionReportPaymentBadgeClassName(paymentStatus)}`}>
                          {paymentStatus}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );
  };

  const [expandedAdminOrders, setExpandedAdminOrders] = useState<Set<number>>(new Set());
  const [selectedAdminOrders, setSelectedAdminOrders] = useState<{ type: "created" | "tagged" | "packed" | "delivered" | "paid"; orders: Order[] } | null>(null);
  
  const getReportPeriodLabel = () => {
    const { start, end } = getDateRange();
    if (dateFilter === "today" || dateFilter === "yesterday" || dateFilter === "exact_date") {
      return format(start, "MMMM d, yyyy");
    } else if (dateFilter === "monthly" || dateFilter === "month") {
      return format(start, "MMMM yyyy");
    } else if (dateFilter === "yearly") {
      return format(start, "yyyy");
    } else if (dateFilter === "all") {
      return "All Time";
    } else {
      return `${format(start, "MMMM d, yyyy")} to ${format(end, "MMMM d, yyyy")}`;
    }
  };
  

  const getDateRangeLabel = () => {
    const { start, end } = getDateRange();
    return `${format(start, "dd/MM/yyyy")} - ${format(end, "dd/MM/yyyy")}`;
  };

  const mapCompletionReportRows = (sectionOrders: Order[]): Array<Array<string | number>> =>
    sectionOrders.map((order, index) => {
      const client = clients?.find((entry) => entry.id === order.clientId);

      return [
        index + 1,
        order.orderNumber,
        order.billId ? `#${order.billId}` : "-",
        getCompletionReportCustomerCellText(order, client),
        order.deliveryBy || "-",
        formatReportDate(order.entryDate),
        formatReportDate(order.deliveryDate),
        getCompletionReportPaymentStatus(order),
      ];
    });

  const mapCompletionReportPdfRows = (sectionOrders: Order[]): Array<Array<string | number>> =>
    sectionOrders.map((order, index) => {
      const client = clients?.find((entry) => entry.id === order.clientId);
      const formatPdfDate = (value: string | Date | null | undefined) => {
        if (!value) return "-";
        try {
          return format(new Date(value), "dd/MM/yy\nhh:mm a");
        } catch {
          return "-";
        }
      };

      return [
        index + 1,
        order.orderNumber,
        order.billId ? `#${order.billId}` : "-",
        getCompletionReportCustomerCellText(order, client),
        order.deliveryBy || "-",
        formatPdfDate(order.entryDate),
        formatPdfDate(order.deliveryDate),
        getCompletionReportPaymentStatus(order),
      ];
    });

  const exportCompletionReportExcel = async () => {
    const periodLabel = getReportPeriodLabel();
    const deliveryRows = mapCompletionReportRows(deliveryCompletionOrders);
    const takeAwayRows = mapCompletionReportRows(takeAwayCompletionOrders);
    const deliveryExportRows =
      deliveryRows.length > 0
        ? deliveryRows
        : [["-", "-", "-", "No orders found", "-", "-", "-", "-"]];
    const takeAwayExportRows =
      takeAwayRows.length > 0
        ? takeAwayRows
        : [["-", "-", "-", "No orders found", "-", "-", "-", "-"]];

    const reportHeaderRows: ExcelExportCell[][] = [
      [companyContact.companyName],
      ["Completion Report"],
      [`Report Period: ${periodLabel}`],
      [`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`],
    ];
    const summaryRows: ExcelExportCell[][] = [
      ["Summary"],
      ["Completed Orders", deliveryReportSummary.total],
      ["Delivery Orders", deliveryReportSummary.deliveryCount],
      ["Take-away Orders", deliveryReportSummary.takeAwayCount],
    ];

    const data: ExcelExportCell[][] = [
      ...reportHeaderRows,
      [],
      ...summaryRows,
      [],
      ["Delivery Orders"],
      completionReportTableHeaders,
      ...deliveryExportRows,
      [],
      ["Take-away Orders"],
      completionReportTableHeaders,
      ...takeAwayExportRows,
    ];

    const deliveryHeaderRow = reportHeaderRows.length + summaryRows.length + 4;
    const deliveryBodyStartRow = deliveryHeaderRow + 1;
    const deliveryBodyCount = deliveryExportRows.length;
    const takeAwayHeaderRow = deliveryHeaderRow + deliveryBodyCount + 3;
    const takeAwayBodyStartRow = takeAwayHeaderRow + 1;

    const cellStyles: CellStyle[] = [];
    const headerRows: number[] = [];
    const headerFillColor = "FF1E40AF";
    const headerFontColor = "FFFFFFFF";

    const styleHeaderRow = (row: number) => {
      headerRows.push(row);
      completionReportTableHeaders.forEach((_, index) => {
        cellStyles.push({
          row,
          col: index + 1,
          fill: { color: headerFillColor },
          font: { color: headerFontColor, bold: true },
          alignment: { wrapText: true, vertical: "middle", horizontal: "center" },
        });
      });
    };

    const styleBodyRows = (startRow: number, rowCount: number) => {
      for (let row = startRow; row < startRow + rowCount; row += 1) {
        completionReportTableHeaders.forEach((_, index) => {
          cellStyles.push({
            row,
            col: index + 1,
            alignment: {
              wrapText: true,
              vertical: "middle",
              horizontal:
                index === 0 || index === completionReportTableHeaders.length - 1 ? "center" : "left",
            },
          });
        });
      }
    };

    styleHeaderRow(deliveryHeaderRow);
    styleBodyRows(deliveryBodyStartRow, deliveryBodyCount);
    styleHeaderRow(takeAwayHeaderRow);
    styleBodyRows(takeAwayBodyStartRow, takeAwayExportRows.length);

    await writeExcel({
      data,
      sheetName: "Completion Report",
      fileName: `Completion_Report_${format(new Date(), "yyyy-MM-dd")}.xlsx`,
      columns: [
        { wch: 5 },
        { wch: 12 },
        { wch: 10 },
        { wch: 30 },
        { wch: 14 },
        { wch: 15 },
        { wch: 15 },
        { wch: 12 },
      ],
      cellStyles,
      rowHeights: headerRows.map((row) => ({ row, height: 22 })),
    });

    toast({
      title: "Excel Downloaded",
      description: "Completion report saved",
    });
  };

  const exportCompletionReportPDF = () => {
    const periodLabel = getReportPeriodLabel();
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const getCenteredTableMargin = (tableWidth: number) => ({
      left: Math.max(6, (pageWidth - tableWidth) / 2),
      right: Math.max(6, (pageWidth - tableWidth) / 2),
    });
    const summaryTableWidth = 88;
    const completionTableWidth = 146;
    const completionTableMargin = getCenteredTableMargin(completionTableWidth);
    let currentY = 12;

    if (logoBase64) {
      const logoWidth = 30;
      const logoHeight = 22;
      const logoX = (pageWidth - logoWidth) / 2;
      doc.addImage(logoBase64, "PNG", logoX, currentY, logoWidth, logoHeight);
      currentY += logoHeight + 4;
    }

    doc.setFontSize(16);
    doc.text(companyContact.companyName, pageWidth / 2, currentY, { align: "center" });
    currentY += 6;
    doc.setFontSize(12);
    doc.text("Completion Report", pageWidth / 2, currentY, { align: "center" });
    currentY += 5;
    doc.setFontSize(9);
    doc.text(periodLabel, pageWidth / 2, currentY, { align: "center" });
    currentY += 4;
    doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, pageWidth / 2, currentY, { align: "center" });

    autoTable(doc, {
      startY: currentY + 5,
      head: [["Summary", "Value"]],
      body: [
        ["Completed Orders", String(deliveryReportSummary.total)],
        ["Delivery Orders", String(deliveryReportSummary.deliveryCount)],
        ["Take-away Orders", String(deliveryReportSummary.takeAwayCount)],
      ],
      margin: getCenteredTableMargin(summaryTableWidth),
      tableWidth: summaryTableWidth,
      theme: "grid",
      headStyles: { fillColor: [14, 116, 144] },
      styles: { fontSize: 8, cellPadding: 1.2, halign: "center", valign: "middle" },
      columnStyles: {
        0: { cellWidth: 58, halign: "center" },
        1: { cellWidth: 30, halign: "center" },
      },
    });

    const renderPdfSection = (title: string, sectionOrders: Order[]) => {
      const lastTableY = (doc as any).lastAutoTable?.finalY || currentY + 6;
      let sectionY = lastTableY + 7;

      if (sectionY > pageHeight - 30) {
        doc.addPage();
        sectionY = 14;
      }

      doc.setFontSize(11);
      doc.text(title, pageWidth / 2, sectionY, { align: "center" });

      const bodyRows = mapCompletionReportPdfRows(sectionOrders);

      autoTable(doc, {
        startY: sectionY + 3,
        head: [completionReportTableHeaders],
        body: bodyRows.length > 0 ? bodyRows : [["-", "-", "-", "No orders found", "-", "-", "-", "-"]],
        margin: completionTableMargin,
        tableWidth: completionTableWidth,
        theme: "grid",
        headStyles: {
          fillColor: title === "Delivery Orders" ? [34, 197, 94] : [59, 130, 246],
          fontSize: 5.8,
          cellPadding: 0.9,
          halign: "center",
          valign: "middle",
        },
        styles: {
          fontSize: 5.5,
          cellPadding: 0.8,
          overflow: "linebreak",
          valign: "middle",
          halign: "center",
        },
        columnStyles: {
          0: { cellWidth: 6, halign: "center" },
          1: { cellWidth: 16, halign: "center" },
          2: { cellWidth: 12, halign: "center" },
          3: { cellWidth: 52, halign: "left" },
          4: { cellWidth: 15, halign: "center" },
          5: { cellWidth: 16, halign: "center" },
          6: { cellWidth: 16, halign: "center" },
          7: { cellWidth: 13, halign: "center" },
        },
      });
    };

    renderPdfSection("Delivery Orders", deliveryCompletionOrders);
    renderPdfSection("Take-away Orders", takeAwayCompletionOrders);

    doc.save(`Completion_Report_${format(new Date(), "yyyy-MM-dd")}.pdf`);
    toast({
      title: "PDF Downloaded",
      description: "Completion report saved",
    });
  };

  const exportToExcel = async () => {
    const dateRangeStr = getReportPeriodLabel();
    
    const headerRows = [
      [companyContact.companyName],
      ["Staff Performance Report"],
      [`Report Period: ${dateRangeStr}`],
      [],
      ["Staff Name", "Created (by order date)", "Tagged (by order date)", "Packed (by action date)", "Completed (by action date)", "Paid Bills"],
    ];
    
    const dataRows = filteredStats.map((s) => [
      s.worker.name,
      s.ordersCreated,
      s.taggedCount,
      s.packedCount,
      s.deliveredCount,
      s.billsCreated,
    ]);
    
    dataRows.push([
      "TOTAL",
      totals.ordersCreated,
      totals.tagged,
      totals.packed,
      totals.delivered,
      totals.billsPaid,
    ]);
    
    const adminTotal = adminStats.ordersCreated + adminStats.taggedOrders.length + adminStats.packedOrders.length + 
                       adminStats.deliveredOrders.length + adminStats.billsPaid;
    
    const adminSection = [
      [],
      ["Admin Performance"],
      ["Activity", "Count"],
      ["Created Orders", adminStats.ordersCreated],
      ["Tagged", adminStats.taggedOrders.length],
      ["Packed", adminStats.packedOrders.length],
      ["Completed", adminStats.deliveredOrders.length],
      ["Paid Bills", adminStats.billsPaid],
      ["TOTAL", adminTotal],
    ];

    await writeExcel({
      data: [...headerRows, ...dataRows, ...adminSection],
      sheetName: "Staff Report",
      fileName: `Staff_Report_${format(new Date(), "yyyy-MM-dd")}.xlsx`,
      columns: [
        { wch: 15 },
        { wch: 12 },
        { wch: 12 },
        { wch: 14 },
        { wch: 12 },
        { wch: 14 },
      ],
    });
    toast({ title: "Excel Downloaded", description: "Staff report saved" });
  };

  const performancePdfActivities = [
    {
      key: "ordersCreated",
      label: "Created Orders",
      shortLabel: "Created",
      note: "by order date",
      color: [37, 99, 235] as PdfRgb,
      lightColor: [219, 234, 254] as PdfRgb,
    },
    {
      key: "taggedCount",
      label: "Tagged Orders",
      shortLabel: "Tagged",
      note: "by order date",
      color: [234, 88, 12] as PdfRgb,
      lightColor: [255, 237, 213] as PdfRgb,
    },
    {
      key: "packedCount",
      label: "Packed Orders",
      shortLabel: "Packed",
      note: "by action date",
      color: [22, 163, 74] as PdfRgb,
      lightColor: [220, 252, 231] as PdfRgb,
    },
    {
      key: "deliveredCount",
      label: "Completed Orders",
      shortLabel: "Completed",
      note: "by action date",
      color: [124, 58, 237] as PdfRgb,
      lightColor: [237, 233, 254] as PdfRgb,
    },
    {
      key: "billsCreated",
      label: "Paid Bills",
      shortLabel: "Paid",
      note: "paid bills",
      color: [8, 145, 178] as PdfRgb,
      lightColor: [207, 250, 254] as PdfRgb,
    },
  ] as const;

  const getPerformanceRowTotal = (row: Pick<PerformanceRow, "ordersCreated" | "taggedCount" | "packedCount" | "deliveredCount" | "billsCreated">) =>
    row.ordersCreated + row.taggedCount + row.packedCount + row.deliveredCount + row.billsCreated;

  const drawPerformancePdfHeader = (
    doc: PdfDocument,
    title: string,
    subtitle: string,
    detail: string,
    accentColor: PdfRgb,
  ) => {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    doc.setFillColor(248, 250, 252);
    doc.rect(0, 0, pageWidth, pageHeight, "F");
    doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.rect(0, 0, pageWidth, 20, "F");

    if (logoBase64) {
      doc.addImage(logoBase64, "PNG", 12, 5, 22, 16);
    }

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(companyContact.companyName.toUpperCase(), pageWidth / 2, 8.5, { align: "center" });
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.text(title, pageWidth / 2, 14.5, { align: "center" });

    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(subtitle, 10, 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(detail, 10, 36);
    doc.setDrawColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.setLineWidth(0.6);
    doc.line(10, 40, pageWidth - 10, 40);
  };

  const drawPerformanceMetricCards = (
    doc: PdfDocument,
    metrics: Array<{ label: string; value: number; note: string; color: PdfRgb; lightColor: PdfRgb }>,
    startY: number,
  ) => {
    const cardGap = 3;
    const cardWidth = (190 - cardGap * (metrics.length - 1)) / metrics.length;

    metrics.forEach((metric, index) => {
      const x = 10 + index * (cardWidth + cardGap);
      doc.setFillColor(metric.lightColor[0], metric.lightColor[1], metric.lightColor[2]);
      doc.roundedRect(x, startY, cardWidth, 19, 2, 2, "F");
      doc.setDrawColor(metric.color[0], metric.color[1], metric.color[2]);
      doc.setLineWidth(0.25);
      doc.roundedRect(x, startY, cardWidth, 19, 2, 2, "S");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(metric.color[0], metric.color[1], metric.color[2]);
      doc.text(String(metric.value), x + 4, startY + 8);
      doc.setFontSize(6.8);
      doc.setTextColor(30, 41, 59);
      doc.text(metric.label, x + 4, startY + 13);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.8);
      doc.setTextColor(100, 116, 139);
      doc.text(metric.note, x + 4, startY + 16.5);
    });
  };

  const addPerformancePdfFooters = (doc: PdfDocument) => {
    const pageCount = doc.getNumberOfPages();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const generatedAt = format(new Date(), "dd/MM/yyyy HH:mm");

    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setDrawColor(203, 213, 225);
      doc.line(10, pageHeight - 14, pageWidth - 10, pageHeight - 14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated: ${generatedAt} | ${companyPhoneLine}`, 10, pageHeight - 8);
      doc.text(`Page ${page} of ${pageCount}`, pageWidth - 10, pageHeight - 8, { align: "right" });
    }
  };

  const exportToPDF = () => {
    const dateRangeStr = getReportPeriodLabel();
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const staffRows = filteredStats.map((s, index) => [
      String(index + 1),
      s.worker.name,
      getStaffRoleLabel(s.worker.roleType),
      String(s.ordersCreated),
      String(s.taggedCount),
      String(s.packedCount),
      String(s.deliveredCount),
      String(s.billsCreated),
    ]);
    const staffTotalRow = [
      "",
      "TOTAL",
      "",
      String(totals.ordersCreated),
      String(totals.tagged),
      String(totals.packed),
      String(totals.delivered),
      String(totals.billsPaid),
    ];

    drawPerformancePdfHeader(
      doc,
      "Staff Performance Report",
      "Staff Performance Summary",
      `${dateRangeStr} | ${filteredStats.length} staff members`,
      [30, 64, 175],
    );

    autoTable(doc, {
      startY: 46,
      head: [["#", "Staff", "Role", "Created\nOrder", "Tagged\nOrder", "Packed\nAction", "Completed\nAction", "Paid"]],
      body: staffRows.length > 0 ? [...staffRows, staffTotalRow] : [["", "No staff found", "", "0", "0", "0", "0", "0"]],
      margin: { left: 10, right: 10, bottom: 18 },
      tableWidth: 190,
      theme: "grid",
      headStyles: {
        fillColor: [30, 64, 175],
        textColor: [255, 255, 255],
        fontSize: 7.2,
        cellPadding: 1.1,
        halign: "center",
      },
      styles: {
        fontSize: 7,
        cellPadding: 0.95,
        lineColor: [203, 213, 225],
        lineWidth: 0.12,
        overflow: "linebreak",
        valign: "middle",
      },
      alternateRowStyles: { fillColor: [239, 246, 255] },
      columnStyles: {
        0: { cellWidth: 8, halign: "center" },
        1: { cellWidth: 40 },
        2: { cellWidth: 24, halign: "center" },
        3: { cellWidth: 22, halign: "center", textColor: [37, 99, 235] },
        4: { cellWidth: 22, halign: "center", textColor: [234, 88, 12] },
        5: { cellWidth: 22, halign: "center", textColor: [22, 163, 74] },
        6: { cellWidth: 28, halign: "center", textColor: [124, 58, 237] },
        7: { cellWidth: 24, halign: "center", textColor: [8, 145, 178] },
      },
      didParseCell: (data: any) => {
        const totalRowIndex = staffRows.length;
        if (data.section === "body" && data.row.index === totalRowIndex && staffRows.length > 0) {
          data.cell.styles.fillColor = [15, 23, 42];
          data.cell.styles.textColor = [255, 255, 255];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });

    doc.addPage();

    const adminReportRow: PerformanceRow = {
      kind: "admin",
      id: "admin",
      workerId: null,
      name: "Admin",
      roleType: "admin",
      active: true,
      ordersCreated: adminStats.ordersCreated,
      taggedCount: adminStats.taggedOrders.length,
      packedCount: adminStats.packedOrders.length,
      deliveredCount: adminStats.deliveredOrders.length,
      billsCreated: adminStats.billsPaid,
    };
    const adminMetrics = performancePdfActivities.map((activity) => ({
      label: activity.shortLabel,
      value: adminReportRow[activity.key],
      note: activity.note,
      color: activity.color,
      lightColor: activity.lightColor,
    }));

    drawPerformancePdfHeader(
      doc,
      "Staff Performance Report",
      "Admin Performance",
      `${dateRangeStr} | Admin summary`,
      [124, 58, 237],
    );
    drawPerformanceMetricCards(doc, adminMetrics, 47);

    autoTable(doc, {
      startY: 73,
      head: [["Activity", "Period Basis", "Count"]],
      body: [
        ...performancePdfActivities.map((activity) => [
          activity.label,
          activity.note,
          String(adminReportRow[activity.key]),
        ]),
        ["TOTAL ACTIONS", "", String(getPerformanceRowTotal(adminReportRow))],
      ],
      margin: { left: 10, right: 10, bottom: 18 },
      tableWidth: 190,
      theme: "grid",
      headStyles: {
        fillColor: [124, 58, 237],
        textColor: [255, 255, 255],
        fontSize: 8,
        cellPadding: 1.3,
      },
      styles: {
        fontSize: 8,
        cellPadding: 1.1,
        lineColor: [203, 213, 225],
        lineWidth: 0.12,
        valign: "middle",
      },
      alternateRowStyles: { fillColor: [245, 243, 255] },
      columnStyles: {
        0: { cellWidth: 90 },
        1: { cellWidth: 60, textColor: [100, 116, 139] },
        2: { cellWidth: 40, halign: "center", fontStyle: "bold" },
      },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.row.index === performancePdfActivities.length) {
          data.cell.styles.fillColor = [15, 23, 42];
          data.cell.styles.textColor = [255, 255, 255];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });

    addPerformancePdfFooters(doc);
    doc.save(`Staff_Report_${format(new Date(), "yyyy-MM-dd")}.pdf`);
    toast({ title: "PDF Downloaded", description: "Staff report saved" });
  };

  const effectiveStaffSearchTerm = isMobile ? "" : searchTerm;
  const filteredStats = workerStats.filter((s) =>
    (s.worker.name || '').toLowerCase().includes(effectiveStaffSearchTerm.toLowerCase()),
  );
  const performanceRows: PerformanceRow[] = [
    {
      kind: "admin",
      id: "admin",
      workerId: null,
      name: "Admin",
      roleType: "admin",
      active: true,
      ordersCreated: adminStats.ordersCreated,
      taggedCount: adminStats.taggedOrders.length,
      packedCount: adminStats.packedOrders.length,
      deliveredCount: adminStats.deliveredOrders.length,
      billsCreated: adminStats.billsPaid,
    },
    ...filteredStats.map((s) => ({
      kind: "staff" as const,
      id: `staff-${s.worker.id}`,
      workerId: s.worker.id,
      name: s.worker.name,
      roleType: s.worker.roleType,
      active: s.worker.active,
      ordersCreated: s.ordersCreated,
      taggedCount: s.taggedCount,
      packedCount: s.packedCount,
      deliveredCount: s.deliveredCount,
      billsCreated: s.billsCreated,
    })),
  ];
  const getPerformanceRowActivityCount = (
    row: PerformanceRow,
    type: StaffPerformanceActivity,
  ) => {
    if (type === "created") return row.ordersCreated;
    if (type === "tagged") return row.taggedCount;
    if (type === "packed") return row.packedCount;
    if (type === "delivered") return row.deliveredCount;
    return row.billsCreated;
  };
  const openPerformanceRowActivity = (
    row: PerformanceRow,
    type: StaffPerformanceActivity,
  ) => {
    if (getPerformanceRowActivityCount(row, type) <= 0) return;

    if (row.kind === "admin") {
      const adminOrdersByActivity: Record<StaffPerformanceActivity, Order[]> = {
        created: adminStats.orders,
        tagged: adminStats.taggedOrders,
        packed: adminStats.packedOrders,
        delivered: adminStats.deliveredOrders,
        paid: adminStats.orders,
      };

      setSelectedAdminOrders({ type, orders: adminOrdersByActivity[type] });
      return;
    }

    if (row.workerId === null) return;
    setSelectedStaffOrders({
      staffId: row.workerId,
      staffName: row.name,
      type,
    });
  };
  const managementA4PaperCardClass = isMobile
    ? ""
    : "screen-a4-paper mx-auto flex w-full max-w-[297mm] flex-col overflow-hidden rounded-sm border border-border bg-card shadow-[0_14px_34px_rgba(15,23,42,0.14)]";
  const managementA4PaperCardStyle = isMobile
    ? undefined
    : { height: "min(297mm, max(640px, calc(100vh - 12rem)))" };
  const managementA4PaperHeaderClass = isMobile ? "" : "shrink-0";
  const managementA4PaperContentClass = isMobile ? "" : "min-h-0 flex-1 overflow-auto";
  const managementA4TableShellClass = isMobile ? "overflow-x-auto" : "screen-a4-table-shell";
  const mobileSummaryCardClass = isMobile
    ? "rounded-[18px] border-border/70 bg-card shadow-[0_1px_0_rgba(15,23,42,0.06)] dark:shadow-none"
    : "";
  const mobilePanelCardClass = isMobile
    ? "rounded-[20px] border-border/70 bg-card shadow-[0_1px_0_rgba(15,23,42,0.06)] dark:shadow-none"
    : "";
  const mobileTableShellClass = isMobile
    ? "overflow-hidden rounded-[18px] border border-border/70 bg-muted/20"
    : "border overflow-hidden rounded-lg";
  const mobileTableClass = isMobile ? "min-w-[760px]" : "";
  const mobileTableHeadClass = isMobile
    ? "h-auto px-3 py-2.5 text-[11px] font-semibold text-muted-foreground"
    : "";
  const mobileTableCellClass = isMobile ? "px-3 py-3 text-[13px]" : "";
  const staffStatsSectionClass = isMobile
    ? "space-y-3"
    : "mx-auto w-full max-w-[297mm] space-y-4";
  const screenReportCardClass = isMobile ? "" : "mx-auto w-full max-w-[297mm]";
  const mobileCompactInfoTextClass = isMobile
    ? "text-[12px] leading-5 text-muted-foreground"
    : "text-sm text-muted-foreground";
  const mobileSurfaceCardClass = isMobile
    ? "rounded-[18px] border border-border/70 bg-card p-3 shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:shadow-none"
    : "";
  const mobileSubtleCardClass = isMobile
    ? "rounded-[14px] border border-border/70 bg-muted/35"
    : "";
  const mobileSurfaceButtonClass = isMobile
    ? "border-border bg-background text-foreground shadow-[0_1px_0_rgba(15,23,42,0.04)] hover:bg-muted/60 dark:shadow-none"
    : "";
  const mobileSurfaceInputClass = isMobile
    ? "border-border bg-background text-foreground shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:shadow-none"
    : "";
  const mobileOutlineBadgeClass = isMobile
    ? "rounded-xl border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground"
    : "ml-2";
  const mobileSummaryLabelClass = isMobile
    ? "truncate text-[12px] font-medium text-muted-foreground"
    : "text-xs text-muted-foreground";
  const mobileSummaryValueClass = isMobile
    ? "text-xl leading-none tracking-tight text-foreground"
    : "text-2xl";
  const mobileSectionDescriptionClass = isMobile
    ? "text-[11px] leading-4 text-muted-foreground"
    : "text-xs text-muted-foreground";
  const mobileToneCardClasses = {
    blue: {
      container: "border-blue-200 bg-blue-50 hover:bg-blue-100 dark:border-blue-900/70 dark:bg-blue-950/35 dark:hover:bg-blue-950/50",
      label: "text-blue-700 dark:text-blue-300",
      value: "text-blue-900 dark:text-blue-100",
      meta: "text-blue-600 dark:text-blue-300/80",
    },
    orange: {
      container: "border-orange-200 bg-orange-50 hover:bg-orange-100 dark:border-orange-900/70 dark:bg-orange-950/35 dark:hover:bg-orange-950/50",
      label: "text-orange-700 dark:text-orange-300",
      value: "text-orange-900 dark:text-orange-100",
      meta: "text-orange-600 dark:text-orange-300/80",
    },
    green: {
      container: "border-green-200 bg-green-50 hover:bg-green-100 dark:border-green-900/70 dark:bg-green-950/35 dark:hover:bg-green-950/50",
      label: "text-green-700 dark:text-green-300",
      value: "text-green-900 dark:text-green-100",
      meta: "text-green-600 dark:text-green-300/80",
    },
    purple: {
      container: "border-purple-200 bg-purple-50 hover:bg-purple-100 dark:border-purple-900/70 dark:bg-purple-950/35 dark:hover:bg-purple-950/50",
      label: "text-purple-700 dark:text-purple-300",
      value: "text-purple-900 dark:text-purple-100",
      meta: "text-purple-600 dark:text-purple-300/80",
    },
    cyan: {
      container: "border-cyan-200 bg-cyan-50 hover:bg-cyan-100 dark:border-cyan-900/70 dark:bg-cyan-950/35 dark:hover:bg-cyan-950/50",
      label: "text-cyan-700 dark:text-cyan-300",
      value: "text-cyan-900 dark:text-cyan-100",
      meta: "text-cyan-600 dark:text-cyan-300/80",
    },
  } as const;
  const mobileUserAccordionItemClass = isMobile
    ? "rounded-[16px] px-3"
    : "border rounded-lg px-4";
  const mobileUserTableClass = isMobile ? "min-w-[440px]" : "";
  const mobileUserHeaderButtonClass = isMobile
    ? "h-10 rounded-xl px-4 text-[13px] font-semibold"
    : "";
  const mobileUserActionButtonClass = isMobile
    ? "h-9 rounded-xl px-3 text-[13px] font-semibold"
    : "";
  const mobileUserIconButtonClass = isMobile ? "h-8 w-8 rounded-xl" : "";
  const mobileUserBadgeClass = isMobile ? "rounded-xl px-2.5 py-0.5 text-[11px]" : "";
  const mobileUserListCardClass = isMobile
    ? "rounded-[16px] border border-slate-200 bg-white p-3 shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950/40"
    : "";
  const mobileUserFieldCardClass = isMobile
    ? "rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/70"
    : "";
  const mobileUserFieldLabelClass = isMobile
    ? "text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400"
    : "";
  const mobileUserFieldValueClass = isMobile
    ? "mt-1 text-[13px] font-medium leading-5 text-slate-900 dark:text-slate-100"
    : "";
  const mobileUserSecondaryActionButtonClass = isMobile
    ? "h-8 rounded-xl px-3 text-[12px] font-semibold"
    : "";
  const compactStatsSubTabButtonClass = (active: boolean) =>
    isMobile
      ? `h-6 min-h-0 flex-shrink-0 gap-1 rounded-none border-0 bg-transparent px-1 py-0 !text-[11px] font-semibold leading-none shadow-none hover:bg-transparent hover:text-primary hover:shadow-none focus-visible:ring-0 active:scale-100 ${active ? "text-primary" : "text-muted-foreground"}`
      : "";
  const statsSubTabIconClass = isMobile ? "h-3 w-3" : "mr-2 h-4 w-4";
  const getStaffRoleBadgeClass = (roleType: string) => {
    if (roleType === "counter") {
      return `bg-blue-500/10 text-blue-600 border-blue-500/30 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900/60 ${isMobile ? "rounded-xl px-2.5 py-0.5 text-[11px]" : ""}`;
    }

    if (roleType === "section") {
      return `bg-purple-500/10 text-purple-600 border-purple-500/30 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-900/60 ${isMobile ? "rounded-xl px-2.5 py-0.5 text-[11px]" : ""}`;
    }

    return `bg-green-500/10 text-green-600 border-green-500/30 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900/60 ${isMobile ? "rounded-xl px-2.5 py-0.5 text-[11px]" : ""}`;
  };
  const getStaffRoleLabel = (roleType: string) =>
    roleType === "counter" ? "Counter" : roleType === "section" ? "Section" : "Driver";

  const getManagementSummaryFileSuffix = () => {
    if (universalDateMode === "daily") {
      return universalSelectedDate || uaeToday;
    }

    if (universalDateMode === "monthly") {
      return universalSelectedMonth || uaeCurrentMonth;
    }

    if (universalDateMode === "yearly") {
      return universalSelectedYear || String(selectedYear);
    }

    const sanitizeDateTime = (value: string) =>
      String(value || "")
        .trim()
        .replace(/[^\dA-Za-z]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return `${sanitizeDateTime(universalStartDate)}_to_${sanitizeDateTime(universalEndDate)}`;
  };

  const showManagementSummaryLoadingToast = () => {
    toast({
      title: "Summary is loading",
      description: "Please wait until the report data finishes loading.",
    });
  };

  const getManagementSummaryStaffRows = () =>
    performanceRows.filter((row) => row.kind === "admin" || row.active);

  const getManagementSummaryStaffTotals = (rows: PerformanceRow[]) =>
    rows.reduce(
      (acc, row) => ({
        ordersCreated: acc.ordersCreated + row.ordersCreated,
        taggedCount: acc.taggedCount + row.taggedCount,
        packedCount: acc.packedCount + row.packedCount,
        deliveredCount: acc.deliveredCount + row.deliveredCount,
        billsCreated: acc.billsCreated + row.billsCreated,
        totalActivity: acc.totalActivity + getPerformanceRowTotal(row),
      }),
      {
        ordersCreated: 0,
        taggedCount: 0,
        packedCount: 0,
        deliveredCount: 0,
        billsCreated: 0,
        totalActivity: 0,
      },
    );

  const exportManagementOnePageSummaryExcel = async () => {
    if (isManagementSummaryLoading) {
      showManagementSummaryLoadingToast();
      return;
    }

    const periodLabel = getReportPeriodLabel();
    const generatedAt = format(new Date(), "dd/MM/yyyy HH:mm");
    const formatAed = (value: number) => `${value.toFixed(2)} AED`;
    const totalCreditNet = managementCreditSummary.totalAdded - managementCreditSummary.totalUsed;
    const staffRowsForSummary = getManagementSummaryStaffRows();
    const staffTotalsForSummary = getManagementSummaryStaffTotals(staffRowsForSummary);
    const orderedSalesPaymentRows = ["Cash", "Card", "Bank", "Bank Transfer"]
      .map((label) => managementSalesSummary.paymentBreakdownRows.find((row) => row.label === label))
      .filter((row): row is (typeof managementSalesSummary.paymentBreakdownRows)[number] => !!row)
      .filter((row, index, rows) => rows.findIndex((candidate) => candidate.key === row.key) === index)
      .filter((row) => row.paymentCount > 0 || row.totalAmount > 0);

    const data: ExcelExportCell[][] = [
      [companyContact.companyName],
      ["One-Page Management Summary"],
      [`Report Period: ${periodLabel}`],
      [`Generated: ${generatedAt}`],
      [],
      ["Sales Report and Payment Breakdown"],
      ["Type", "Bills/Orders", "Payments", "Amount"],
      ["Current Period Orders", managementSalesSummary.currentOrdersCount, "", formatAed(managementSalesSummary.currentOrdersTotal)],
      ...orderedSalesPaymentRows.map((row) => [row.label.replace("Bank Transfer", "Bank"), row.billCount, row.paymentCount, formatAed(row.totalAmount)]),
      ["Total Sales", "", managementSalesSummary.totalSalesPaymentCount, formatAed(managementSalesSummary.totalSalesAmount)],
      [],
      ["Active Staff Performance Activity"],
      ["Staff", "Role", "Created", "Tagged", "Packed", "Completed", "Paid", "Total"],
      ...staffRowsForSummary.map((row) => [
        row.name,
        row.kind === "admin" ? "Admin" : getStaffRoleLabel(row.roleType),
        row.ordersCreated,
        row.taggedCount,
        row.packedCount,
        row.deliveredCount,
        row.billsCreated,
        getPerformanceRowTotal(row),
      ]),
      [
        "TOTAL",
        "",
        staffTotalsForSummary.ordersCreated,
        staffTotalsForSummary.taggedCount,
        staffTotalsForSummary.packedCount,
        staffTotalsForSummary.deliveredCount,
        staffTotalsForSummary.billsCreated,
        staffTotalsForSummary.totalActivity,
      ],
      [],
      ["Credit Management Log Activity"],
      ["Metric", "Value"],
      ["Entries", managementCreditSummary.entries.length],
      ["Added", `${managementCreditSummary.addedCount} | ${formatAed(managementCreditSummary.totalAdded)}`],
      ["Deducted", `${managementCreditSummary.usedCount} | ${formatAed(managementCreditSummary.totalUsed)}`],
      ["Net", formatAed(totalCreditNet)],
      [],
      ["Credit Activity by Staff"],
      ["Staff", "Entries", "Added", "Deducted"],
      ...managementCreditSummary.actorRows.map((row) => [
        row.actor,
        row.entries,
        formatAed(row.added),
        formatAed(row.used),
      ]),
      [],
      ["Daily Item Count"],
      ["Metric", "Value"],
      ["Orders Received", dailyItemCountSummary.receivedOrdersCount],
      ["Items Received", dailyItemCountSummary.totalReceived],
      ["Items Completed", dailyItemCountSummary.totalCompleted],
      ["Items Remaining", dailyItemCountSummary.totalRemaining],
    ];

    const maxExcelColumns = 8;
    const paddedData = data.map((row) => [
      ...row,
      ...Array.from({ length: Math.max(0, maxExcelColumns - row.length) }, () => ""),
    ]);
    const findExcelRow = (label: string) => data.findIndex((row) => row[0] === label) + 1;
    const salesTitleRow = findExcelRow("Sales Report and Payment Breakdown");
    const salesHeaderRow = salesTitleRow + 1;
    const salesTotalRow = findExcelRow("Total Sales");
    const staffTitleRow = findExcelRow("Active Staff Performance Activity");
    const staffHeaderRow = staffTitleRow + 1;
    const staffTotalRow = findExcelRow("TOTAL");
    const creditTitleRow = findExcelRow("Credit Management Log Activity");
    const creditHeaderRow = creditTitleRow + 1;
    const creditNetRow = findExcelRow("Net");
    const creditStaffTitleRow = findExcelRow("Credit Activity by Staff");
    const creditStaffHeaderRow = creditStaffTitleRow + 1;
    const dailyTitleRow = findExcelRow("Daily Item Count");
    const dailyHeaderRow = dailyTitleRow + 1;

    type SummaryExcelStyle = Omit<CellStyle, "row" | "col">;

    const cellStyles: CellStyle[] = [];
    const styleRange = (row: number, fromCol: number, toCol: number, style: SummaryExcelStyle) => {
      if (row < 1) return;
      for (let col = fromCol; col <= toCol; col += 1) {
        cellStyles.push({ row, col, ...style });
      }
    };
    const styleTableBody = (
      startRow: number,
      endRow: number,
      colCount: number,
      centerCols: number[] = [],
      rightCols: number[] = [],
    ) => {
      if (startRow < 1 || endRow < startRow) return;
      for (let row = startRow; row <= endRow; row += 1) {
        const fillColor = row % 2 === 0 ? "FFF8FAFC" : "FFFFFFFF";
        for (let col = 1; col <= colCount; col += 1) {
          cellStyles.push({
            row,
            col,
            fill: { color: fillColor },
            alignment: {
              wrapText: true,
              vertical: "middle",
              horizontal: rightCols.includes(col) ? "right" : centerCols.includes(col) ? "center" : "left",
            },
          });
        }
      }
    };

    const whiteBold = { color: "FFFFFFFF", bold: true };
    const mutedFill = { color: "FFF8FAFC" };
    const salesColor = "FF0891B2";
    const staffColor = "FF1E40AF";
    const creditColor = "FFD97706";
    const dailyColor = "FF16A34A";

    styleRange(1, 1, maxExcelColumns, {
      fill: { color: "FF0F172A" },
      font: whiteBold,
      alignment: { vertical: "middle", horizontal: "left" },
    });
    styleRange(2, 1, maxExcelColumns, {
      fill: { color: "FFE0F2FE" },
      font: { color: "FF0F172A", bold: true },
      alignment: { vertical: "middle", horizontal: "left" },
    });
    [3, 4].forEach((row) => {
      styleRange(row, 1, maxExcelColumns, {
        fill: mutedFill,
        font: { color: "FF334155", bold: false },
        alignment: { vertical: "middle", horizontal: "left" },
      });
    });

    [
      { row: salesTitleRow, color: salesColor },
      { row: staffTitleRow, color: staffColor },
      { row: creditTitleRow, color: creditColor },
      { row: creditStaffTitleRow, color: creditColor },
      { row: dailyTitleRow, color: dailyColor },
    ].forEach(({ row, color }) => {
      styleRange(row, 1, maxExcelColumns, {
        fill: { color },
        font: whiteBold,
        alignment: { vertical: "middle", horizontal: "left" },
      });
    });

    [
      { row: salesHeaderRow, cols: 4, color: salesColor },
      { row: staffHeaderRow, cols: 8, color: staffColor },
      { row: creditHeaderRow, cols: 2, color: creditColor },
      { row: creditStaffHeaderRow, cols: 4, color: creditColor },
      { row: dailyHeaderRow, cols: 2, color: dailyColor },
    ].forEach(({ row, cols, color }) => {
      styleRange(row, 1, cols, {
        fill: { color },
        font: whiteBold,
        alignment: { wrapText: true, vertical: "middle", horizontal: "center" },
      });
    });

    styleTableBody(salesHeaderRow + 1, salesTotalRow, 4, [2, 3], [4]);
    styleTableBody(staffHeaderRow + 1, staffTotalRow - 1, 8, [3, 4, 5, 6, 7, 8]);
    styleTableBody(creditHeaderRow + 1, creditNetRow, 2, [], [2]);
    styleTableBody(creditStaffHeaderRow + 1, dailyTitleRow - 2, 4, [2], [3, 4]);
    styleTableBody(dailyHeaderRow + 1, paddedData.length, 2, [2]);

    styleRange(salesTotalRow, 1, 4, {
      fill: { color: "FFE0F2FE" },
      font: { color: "FF0F172A", bold: true },
      alignment: { vertical: "middle", horizontal: "center" },
    });
    styleRange(staffTotalRow, 1, 8, {
      fill: { color: "FF0F172A" },
      font: whiteBold,
      alignment: { vertical: "middle", horizontal: "center" },
    });

    await writeExcel({
      data: paddedData,
      sheetName: "One Page Summary",
      fileName: `Management_One_Page_Summary_${getManagementSummaryFileSuffix()}.xlsx`,
      columns: [
        { wch: 28 },
        { wch: 16 },
        { wch: 14 },
        { wch: 16 },
        { wch: 14 },
        { wch: 14 },
        { wch: 12 },
        { wch: 12 },
      ],
      cellStyles,
      rowHeights: [
        { row: 1, height: 22 },
        { row: 2, height: 19 },
        { row: 3, height: 17 },
        { row: 4, height: 17 },
        ...[salesTitleRow, staffTitleRow, creditTitleRow, creditStaffTitleRow, dailyTitleRow].map((row) => ({ row, height: 21 })),
        ...[salesHeaderRow, staffHeaderRow, creditHeaderRow, creditStaffHeaderRow, dailyHeaderRow].map((row) => ({ row, height: 18 })),
      ],
    });

    toast({
      title: "Excel Downloaded",
      description: "One-page management summary exported for the selected calendar period",
    });
  };

  const exportManagementOnePageSummaryPDF = () => {
    if (isManagementSummaryLoading) {
      showManagementSummaryLoadingToast();
      return;
    }

    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 8;
    const contentWidth = pageWidth - margin * 2;
    const generatedAt = format(new Date(), "dd/MM/yyyy HH:mm");
    const periodLabel = getReportPeriodLabel();
    const formatAed = (value: number) => `${value.toFixed(2)} AED`;
    const compactText = (value: string, maxLength = 22) => {
      const text = String(value || "-");
      return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
    };
    const totalCreditNet = managementCreditSummary.totalAdded - managementCreditSummary.totalUsed;
    const staffRowsForSummary = getManagementSummaryStaffRows();
    const staffTotalsForSummary = getManagementSummaryStaffTotals(staffRowsForSummary);
    const orderedSalesPaymentRows = ["Cash", "Card", "Bank", "Bank Transfer"]
      .map((label) => managementSalesSummary.paymentBreakdownRows.find((row) => row.label === label))
      .filter((row): row is (typeof managementSalesSummary.paymentBreakdownRows)[number] => !!row)
      .filter((row, index, rows) => rows.findIndex((candidate) => candidate.key === row.key) === index)
      .filter((row) => row.paymentCount > 0 || row.totalAmount > 0);

    doc.setFillColor(248, 250, 252);
    doc.rect(0, 0, pageWidth, pageHeight, "F");
    doc.setFillColor(30, 64, 175);
    doc.rect(0, 0, pageWidth, 19, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(companyContact.companyName.toUpperCase(), pageWidth / 2, 7.5, { align: "center" });
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text("One-Page Management Summary", pageWidth / 2, 13.2, { align: "center" });

    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(periodLabel, margin, 25);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Generated: ${generatedAt}`, pageWidth - margin, 25, { align: "right" });

    const drawSectionTitle = (title: string, x: number, y: number, width: number, color: PdfRgb) => {
      doc.setFillColor(color[0], color[1], color[2]);
      doc.roundedRect(x, y, width, 6, 1.5, 1.5, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.7);
      doc.text(title, x + 2.5, y + 4.1);
    };

    const tableBase = {
      theme: "grid" as const,
      pageBreak: "avoid" as const,
      rowPageBreak: "avoid" as const,
      styles: {
        fontSize: 5.4,
        cellPadding: 0.75,
        lineColor: [203, 213, 225] as PdfRgb,
        lineWidth: 0.1,
        overflow: "linebreak" as const,
        valign: "middle" as const,
      },
      headStyles: {
        textColor: [255, 255, 255] as PdfRgb,
        fontSize: 5.3,
        cellPadding: 0.8,
        halign: "center" as const,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] as PdfRgb },
    };

    const staffRows = [
      ...staffRowsForSummary.map((row) => [
        compactText(row.name, 18),
        row.kind === "admin" ? "Admin" : getStaffRoleLabel(row.roleType),
        row.ordersCreated,
        row.taggedCount,
        row.packedCount,
        row.deliveredCount,
        row.billsCreated,
        getPerformanceRowTotal(row),
      ]),
      [
        "TOTAL",
        "-",
        staffTotalsForSummary.ordersCreated,
        staffTotalsForSummary.taggedCount,
        staffTotalsForSummary.packedCount,
        staffTotalsForSummary.deliveredCount,
        staffTotalsForSummary.billsCreated,
        staffTotalsForSummary.totalActivity,
      ],
    ];

    const salesRows = [
      ["Current Period Orders", managementSalesSummary.currentOrdersCount, "-", formatAed(managementSalesSummary.currentOrdersTotal)],
      ...orderedSalesPaymentRows.map((row) => [row.label.replace("Bank Transfer", "Bank"), row.billCount, row.paymentCount, formatAed(row.totalAmount)]),
      ["Total Sales", "-", managementSalesSummary.totalSalesPaymentCount, formatAed(managementSalesSummary.totalSalesAmount)],
    ];

    drawSectionTitle("Sales Report and Payment Breakdown", margin, 34, contentWidth, [8, 145, 178]);
    autoTable(doc, {
      ...tableBase,
      startY: 41,
      margin: { left: margin, right: margin },
      tableWidth: contentWidth,
      head: [["Type", "Bills", "Pays", "Amount"]],
      body: salesRows,
      headStyles: { ...tableBase.headStyles, fillColor: [8, 145, 178] },
      columnStyles: {
        0: { cellWidth: 72 },
        1: { cellWidth: 28, halign: "center", fontStyle: "bold" },
        2: { cellWidth: 28, halign: "center", fontStyle: "bold" },
        3: { cellWidth: contentWidth - 128, halign: "right", fontStyle: "bold" },
      },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.row.index === salesRows.length - 1) {
          data.cell.styles.fillColor = [224, 242, 254];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });

    const staffStartY = ((doc as any).lastAutoTable?.finalY || 72) + 7;
    drawSectionTitle("Active Staff Performance Activity", margin, staffStartY, contentWidth, [30, 64, 175]);
    autoTable(doc, {
      ...tableBase,
      startY: staffStartY + 7,
      margin: { left: margin, right: margin },
      tableWidth: contentWidth,
      head: [["Staff", "Role", "Created", "Tagged", "Packed", "Done", "Paid", "Total"]],
      body: staffRows,
      headStyles: { ...tableBase.headStyles, fillColor: [30, 64, 175] },
      styles: { ...tableBase.styles, fontSize: 4.8, cellPadding: 0.55 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 39 },
        1: { cellWidth: 22, halign: "center" },
        2: { cellWidth: 20, halign: "center" },
        3: { cellWidth: 20, halign: "center" },
        4: { cellWidth: 20, halign: "center" },
        5: { cellWidth: 20, halign: "center" },
        6: { cellWidth: 20, halign: "center" },
        7: { cellWidth: 33, halign: "center", fontStyle: "bold" },
      },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.row.index === staffRows.length - 1) {
          data.cell.styles.fillColor = [15, 23, 42];
          data.cell.styles.textColor = [255, 255, 255];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });

    const creditRows = [
      ["Entries", `${managementCreditSummary.entries.length}`],
      ["Added", `${managementCreditSummary.addedCount} | ${formatAed(managementCreditSummary.totalAdded)}`],
      ["Deducted", `${managementCreditSummary.usedCount} | ${formatAed(managementCreditSummary.totalUsed)}`],
      ["Net", formatAed(totalCreditNet)],
      ...managementCreditSummary.actorRows.slice(0, 4).map((row) => [
        compactText(row.actor, 18),
        `${row.entries} | +${row.added.toFixed(2)} / -${row.used.toFixed(2)}`,
      ]),
    ];

    const creditStartY = ((doc as any).lastAutoTable?.finalY || staffStartY + 46) + 7;
    drawSectionTitle("Credit Management Log Activity", margin, creditStartY, contentWidth, [217, 119, 6]);
    autoTable(doc, {
      ...tableBase,
      startY: creditStartY + 7,
      margin: { left: margin, right: margin },
      tableWidth: contentWidth,
      head: [["Metric / Staff", "Value"]],
      body: creditRows,
      headStyles: { ...tableBase.headStyles, fillColor: [217, 119, 6] },
      columnStyles: {
        0: { cellWidth: 74 },
        1: { cellWidth: contentWidth - 74, fontStyle: "bold" },
      },
    });

    const dailyRows = [
      ["Orders Received", dailyItemCountSummary.receivedOrdersCount],
      ["Items Received", dailyItemCountSummary.totalReceived],
      ["Items Completed", dailyItemCountSummary.totalCompleted],
      ["Items Remaining", dailyItemCountSummary.totalRemaining],
    ];

    const dailyStartY = ((doc as any).lastAutoTable?.finalY || creditStartY + 34) + 7;
    drawSectionTitle("Daily Item Count", margin, dailyStartY, contentWidth, [22, 163, 74]);
    autoTable(doc, {
      ...tableBase,
      startY: dailyStartY + 7,
      margin: { left: margin, right: margin },
      tableWidth: contentWidth,
      head: [["Metric", "Value"]],
      body: dailyRows,
      headStyles: { ...tableBase.headStyles, fillColor: [22, 163, 74] },
      columnStyles: {
        0: { cellWidth: 98 },
        1: { cellWidth: contentWidth - 98, halign: "center", fontStyle: "bold" },
      },
    });

    doc.setDrawColor(203, 213, 225);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(100, 116, 139);
    doc.text(companyPhoneLine, margin, pageHeight - 7);
    doc.text("Portrait A4 summary", pageWidth - margin, pageHeight - 7, { align: "right" });

    doc.save(`Management_One_Page_Summary_${getManagementSummaryFileSuffix()}.pdf`);
    toast({
      title: "PDF Downloaded",
      description: "One-page portrait management summary saved for the selected calendar period",
    });
  };

  // Get orders for a specific staff member by type
  const getStaffOrders = (staffId: number, type: "created" | "tagged" | "packed" | "delivered" | "paid") => {
    if (!orders) return [];
    const { start, end } = getDateRange();
    
    const staffMember = allStaffMembers.find(s => s.id === staffId);
    const staffName = normalizeActorName(staffMember?.name);
    
    if (type === "paid") {
      return bills?.filter(b => {
        const matchById = b.createdByWorkerId === staffId;
        const matchByName = staffName && b.createdBy?.toLowerCase() === staffName;
        if (!matchById && !matchByName) return false;
        if (!b.isPaid) return false;
        if (!b.billDate) return false;
        const billDate = new Date(b.billDate);
        return billDate >= start && billDate <= end;
      }) || [];
    }
    
    return orders.filter((o) => {
      let dateField: string | Date | null | undefined;
      let workerField: number | null | undefined;
      let nameField: string | null | undefined;
      
      if (type === "created") {
        dateField = o.entryDate;
        workerField = o.entryByWorkerId;
        nameField = o.entryBy;
      } else if (type === "tagged") {
        dateField = o.entryDate;
        workerField = o.tagWorkerId;
        nameField = o.tagBy;
      } else if (type === "packed") {
        dateField = o.packingDate;
        workerField = o.packingWorkerId;
        nameField = o.packingBy;
      } else if (type === "delivered") {
        dateField = o.deliveryDate;
        workerField = o.deliveredByWorkerId;
        nameField = o.deliveryBy;
      }
      if (type === "delivered" && !isOrderCompleted(o)) return false;
      
      const matchById = workerField === staffId;
      const matchByName = staffName && normalizeActorName(nameField) === staffName;
      if (!matchById && !matchByName) return false;
      if (!dateField) return false;
      const date = new Date(dateField);
      return date >= start && date <= end;
    });
  };

  // Generate compact, color-rich individual admin/staff PDF report.
  const generatePerformancePDF = (row: PerformanceRow) => {
    const dateRangeStr = getReportPeriodLabel();
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const roleLabel = row.kind === "admin" ? "Admin" : getStaffRoleLabel(row.roleType);
    const accentColor: PdfRgb = row.kind === "admin" ? [124, 58, 237] : [30, 64, 175];
    const totalActions = getPerformanceRowTotal(row);
    const metrics = performancePdfActivities.map((activity) => ({
      label: activity.shortLabel,
      value: row[activity.key],
      note: activity.note,
      color: activity.color,
      lightColor: activity.lightColor,
    }));

    drawPerformancePdfHeader(
      doc,
      row.kind === "admin" ? "Admin Individual Performance Report" : "Staff Individual Performance Report",
      row.name,
      `${dateRangeStr} | ${roleLabel} | ${row.active ? "Active" : "Inactive"}`,
      accentColor,
    );

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(10, 46, 190, 16, 2, 2, "F");
    doc.setDrawColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.setLineWidth(0.25);
    doc.roundedRect(10, 46, 190, 16, 2, 2, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text("Performance Snapshot", 14, 52);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Total actions: ${totalActions}`, 14, 57);
    doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 196, 57, { align: "right" });

    drawPerformanceMetricCards(doc, metrics, 69);

    autoTable(doc, {
      startY: 95,
      head: [["Activity", "Basis", "Count"]],
      body: [
        ...performancePdfActivities.map((activity) => [
          activity.label,
          activity.note,
          String(row[activity.key]),
        ]),
        ["TOTAL ACTIONS", "", String(totalActions)],
      ],
      margin: { left: 10, right: 10, bottom: 18 },
      tableWidth: 190,
      theme: "grid",
      headStyles: {
        fillColor: accentColor,
        textColor: [255, 255, 255],
        fontSize: 8,
        cellPadding: 1.2,
      },
      styles: {
        fontSize: 8,
        cellPadding: 1,
        lineColor: [203, 213, 225],
        lineWidth: 0.12,
        valign: "middle",
      },
      alternateRowStyles: { fillColor: row.kind === "admin" ? [245, 243, 255] : [239, 246, 255] },
      columnStyles: {
        0: { cellWidth: 94 },
        1: { cellWidth: 56, textColor: [100, 116, 139] },
        2: { cellWidth: 40, halign: "center", fontStyle: "bold" },
      },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.row.index === performancePdfActivities.length) {
          data.cell.styles.fillColor = [15, 23, 42];
          data.cell.styles.textColor = [255, 255, 255];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });

    addPerformancePdfFooters(doc);
    const safeName = row.name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_");
    doc.save(`${row.kind === "admin" ? "Admin" : "Staff"}_Report_${safeName}_${format(new Date(), "yyyy-MM-dd")}.pdf`);
    toast({
      title: "PDF Downloaded",
      description: `${roleLabel} report for ${row.name} exported to PDF`,
    });
  };


  const createMutation = useMutation({
    mutationFn: async (data: { name: string; role: string; pin: string }) => {
      return apiRequest("POST", "/api/packing-workers", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/packing-workers"] });
      setIsCreateOpen(false);
      setFormData({ name: "", role: "Reception", pin: "" });
      setCustomRole("");
      setIsCustomRole(false);
      toast({ title: "Staff Created", description: "New staff member added" });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to create worker",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      return apiRequest("PUT", `/api/packing-workers/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/packing-workers"] });
      setEditWorker(null);
      setFormData({ name: "", role: "Reception", pin: "" });
      setCustomRole("");
      setIsCustomRole(false);
      toast({ title: "Staff Updated", description: "Staff details updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/packing-workers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/packing-workers"] });
      toast({
        title: "Staff Deleted",
        description: "Staff member has been removed",
      });
    },
  });

  const handleCreate = () => {
    if (!formData.name || formData.pin.length !== 5) {
      toast({
        title: "Error",
        description: "Name and 5-digit PIN are required",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate(formData);
  };

  const handleUpdate = () => {
    if (!editWorker || !formData.name) return;
    const updates: any = { name: formData.name, role: formData.role };
    if (formData.pin && formData.pin.length === 5) {
      updates.pin = formData.pin;
    }
    updateMutation.mutate({ id: editWorker.id, updates });
  };

  const toggleActive = (worker: PackingWorker) => {
    updateMutation.mutate({
      id: worker.id,
      updates: { active: !worker.active },
    });
  };

  const createUserMutation = useMutation({
    mutationFn: async (data: {
      username: string;
      password: string;
      name: string;
      email: string;
      role: string;
    }) => {
      return apiRequest("POST", "/api/users", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsUserCreateOpen(false);
      setUserFormData({
        username: "",
        password: "",
        name: "",
        email: "",
        role: "counter",
        pin: "",
      });
      toast({ title: "User Created", description: "New user account added" });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to create user",
        variant: "destructive",
      });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      return apiRequest("PUT", `/api/users/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditUser(null);
      setUserFormData({
        username: "",
        password: "",
        name: "",
        email: "",
        role: "counter",
        pin: "",
      });
      toast({ title: "User Updated", description: "User details updated" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "User Deleted",
        description: "User account has been removed",
      });
    },
  });

  // Staff member mutations
  const createStaffMemberMutation = useMutation({
    mutationFn: async (data: { name: string; pin: string; roleType: string }) => {
      return apiRequest("POST", "/api/staff-members", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff-members"] });
      setIsStaffMemberCreateOpen(false);
      setStaffMemberFormData({ name: "", pin: "", roleType: "counter" });
      toast({
        title: "Staff Member Added",
        description: "New staff member has been created",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to create staff member",
        variant: "destructive",
      });
    },
  });

  const updateStaffMemberMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<StaffMember> }) => {
      return apiRequest("PUT", `/api/staff-members/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff-members"] });
      setEditStaffMember(null);
      toast({
        title: "Staff Member Updated",
        description: "Staff member details have been updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to update staff member",
        variant: "destructive",
      });
    },
  });

  const deleteStaffMemberMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/staff-members/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff-members"] });
      toast({
        title: "Staff Member Deleted",
        description: "Staff member has been removed",
      });
    },
  });

  const handleCreateStaffMember = () => {
    if (!staffMemberFormData.name || !staffMemberFormData.pin) {
      toast({
        title: "Error",
        description: "Name and PIN are required",
        variant: "destructive",
      });
      return;
    }
    if (!/^\d{5}$/.test(staffMemberFormData.pin)) {
      toast({
        title: "Error",
        description: "PIN must be exactly 5 digits",
        variant: "destructive",
      });
      return;
    }
    createStaffMemberMutation.mutate(staffMemberFormData);
  };

  const handleUpdateStaffMember = () => {
    if (!editStaffMember) return;
    const updates: any = {};
    if (staffMemberFormData.name && staffMemberFormData.name !== editStaffMember.name) {
      updates.name = staffMemberFormData.name;
    }
    if (staffMemberFormData.pin && staffMemberFormData.pin !== editStaffMember.pin) {
      if (!/^\d{5}$/.test(staffMemberFormData.pin)) {
        toast({
          title: "Error",
          description: "PIN must be exactly 5 digits",
          variant: "destructive",
        });
        return;
      }
      updates.pin = staffMemberFormData.pin;
    }
    updateStaffMemberMutation.mutate({ id: editStaffMember.id, updates });
  };

  const toggleStaffMemberActive = (member: StaffMember) => {
    updateStaffMemberMutation.mutate({
      id: member.id,
      updates: { active: !member.active },
    });
  };

  const openUserEditor = (user: SystemUser | undefined) => {
    if (!user) return;
    setEditUser(user);
    setUserFormData({
      username: user.username,
      password: "",
      name: user.name || "",
      email: user.email || "",
      role: normalizeUserRoleForForm(user.role),
      pin: "",
    });
  };

  const openStaffMemberEditor = (
    member: StaffMember,
    roleType: "counter" | "section" | "driver",
  ) => {
    setEditStaffMember(member);
    setStaffMemberFormData({ name: member.name, pin: member.pin, roleType });
  };

  const getDriverDeliveryCount = (member: StaffMember) =>
    orders?.filter(
      (o) => o.delivered && (o.deliveredByWorkerId === member.id || o.deliveryBy === member.name),
    ).length || 0;

  const renderMobileLoginAccountCard = (
    user: SystemUser | undefined,
    options: {
      emptyText: string;
      toneClassName: string;
      editTestId?: string;
    },
  ) => {
    if (!user) {
      return <p className="py-4 text-center text-muted-foreground">{options.emptyText}</p>;
    }

    const isPasswordVisible = visiblePasswords.has(user.id);

    return (
      <div className={`rounded-[16px] border p-3 shadow-[0_1px_0_rgba(15,23,42,0.04)] ${options.toneClassName}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={mobileUserFieldLabelClass}>Login Account</p>
            <p className="mt-1 truncate text-[14px] font-semibold leading-5 text-slate-900 dark:text-slate-100">
              {user.username}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className={mobileUserActionButtonClass}
            onClick={() => openUserEditor(user)}
            data-testid={options.editTestId}
          >
            <Pencil className="mr-1.5 h-3 w-3" />
            Edit
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2">
          <div className={mobileUserFieldCardClass}>
            <p className={mobileUserFieldLabelClass}>Username</p>
            <p className={`${mobileUserFieldValueClass} truncate`}>{user.username}</p>
          </div>

          <div className={mobileUserFieldCardClass}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={mobileUserFieldLabelClass}>Password</p>
                <p className={`${mobileUserFieldValueClass} font-mono`}>
                  {user.password ? (isPasswordVisible ? user.password : "*****") : "-"}
                </p>
              </div>
              {user.password ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className={mobileUserIconButtonClass}
                  onClick={() => togglePasswordVisibility(user.id)}
                  data-testid={`button-toggle-user-password-${user.id}`}
                >
                  {isPasswordVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </Button>
              ) : null}
            </div>
          </div>

          {user.email ? (
            <div className={mobileUserFieldCardClass}>
              <p className={mobileUserFieldLabelClass}>Email</p>
              <p className={`${mobileUserFieldValueClass} break-all`}>{user.email}</p>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderMobileStaffMemberCards = (
    members: StaffMember[],
    options: {
      emptyText: string;
      roleType: "counter" | "section" | "driver";
      editTestIdPrefix: string;
      deleteTestIdPrefix: string;
      showDeliveries?: boolean;
    },
  ) => {
    if (members.length === 0) {
      return <p className="py-4 text-center text-muted-foreground">{options.emptyText}</p>;
    }

    return (
      <div className="space-y-2.5">
        {members.map((member) => {
          const isPinVisible = visibleStaffPins.has(member.id);
          const deliveryCount = options.showDeliveries ? getDriverDeliveryCount(member) : 0;

          return (
            <div key={member.id} className={mobileUserListCardClass}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold leading-5 text-slate-900 dark:text-slate-100">
                    {member.name}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {options.showDeliveries ? "Delivery staff member" : "Staff member"}
                  </p>
                </div>
                <Badge variant={member.active ? "default" : "secondary"} className={mobileUserBadgeClass}>
                  {member.active ? "Active" : "Inactive"}
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2">
                <div className={mobileUserFieldCardClass}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={mobileUserFieldLabelClass}>Login PIN</p>
                      <p className={`${mobileUserFieldValueClass} font-mono`}>
                        {isPinVisible ? member.pin : "*****"}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className={mobileUserIconButtonClass}
                      onClick={() => toggleStaffPinVisibility(member.id)}
                      data-testid={`button-toggle-staff-pin-${member.id}`}
                    >
                      {isPinVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>

                {options.showDeliveries ? (
                  <div className={mobileUserFieldCardClass}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className={mobileUserFieldLabelClass}>Deliveries</p>
                        <p className={mobileUserFieldValueClass}>{deliveryCount}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className={mobileUserSecondaryActionButtonClass}
                        onClick={() => setSelectedDriverHistory({ id: member.id, name: member.name })}
                        data-testid={`button-view-deliveries-${member.id}`}
                      >
                        <Truck className="mr-1.5 h-3 w-3" />
                        View
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Switch checked={member.active} onCheckedChange={() => toggleStaffMemberActive(member)} />
                  <span className="text-[12px] text-muted-foreground">Allow login</span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className={mobileUserSecondaryActionButtonClass}
                    onClick={() => openStaffMemberEditor(member, options.roleType)}
                    data-testid={`${options.editTestIdPrefix}${member.id}`}
                  >
                    <Pencil className="mr-1.5 h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className={`${mobileUserSecondaryActionButtonClass} text-destructive`}
                    onClick={() => {
                      if (confirm(`Remove staff member "${member.name}"?`)) {
                        deleteStaffMemberMutation.mutate(member.id);
                      }
                    }}
                    data-testid={`${options.deleteTestIdPrefix}${member.id}`}
                  >
                    <Trash2 className="mr-1.5 h-3 w-3" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const handleCreateUser = () => {
    if (!userFormData.username || !userFormData.password) {
      toast({
        title: "Error",
        description: "Username and password are required",
        variant: "destructive",
      });
      return;
    }
    if (userFormData.role === "admin") {
      toast({
        title: "Error",
        description: "The system supports only one admin account.",
        variant: "destructive",
      });
      return;
    }
    createUserMutation.mutate(userFormData);
  };

  const handleUpdateUser = () => {
    if (!editUser) return;
    const updates: any = {};
    const currentRoleForForm = normalizeUserRoleForForm(editUser.role);

    if (userFormData.username && userFormData.username !== editUser.username) {
      updates.username = userFormData.username;
    }
    if (userFormData.name) updates.name = userFormData.name;
    if (userFormData.email) updates.email = userFormData.email;
    if (userFormData.password) updates.password = userFormData.password;
    if (userFormData.role === "admin") {
      toast({
        title: "Error",
        description: "The system supports only one admin account.",
        variant: "destructive",
      });
      return;
    }
    if (userFormData.role && userFormData.role !== currentRoleForForm) {
      updates.role = userFormData.role;
    }
    if (userFormData.pin && /^\d{5}$/.test(userFormData.pin)) updates.pin = userFormData.pin;
    updateUserMutation.mutate({ id: editUser.id, updates });
  };

  const toggleUserActive = (user: SystemUser) => {
    updateUserMutation.mutate({
      id: user.id,
      updates: { active: !user.active },
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-30 w-full bg-card border-b border-border shadow-sm">
        <div className={`${isMobile ? "h-16 px-4 gap-3" : "h-20 px-6 gap-4"} flex items-center justify-between`}>
          <h1 className={`${isMobile ? "text-lg" : "text-2xl"} font-display font-bold text-foreground flex items-center gap-2`}>
            <Users className={`${isMobile ? "w-5 h-5" : "w-6 h-6"} text-primary`} />
            Management
          </h1>
        </div>
      </div>

      <main className={`flex-1 overflow-auto ${isMobile ? "p-3" : "p-6"}`}>
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className={`mb-3 ${isMobile ? "flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl bg-muted/45 p-1" : ""}`}>
              <TabsTrigger
                value="stats"
                data-testid="tab-stats"
                className={isMobile ? "h-8 rounded-lg px-2.5 py-1 text-[11px] font-semibold" : ""}
                onClick={() => handleWorkersMainTabClick("stats")}
              >
                <BarChart3 className="w-4 h-4 mr-1" />
                Statistics
              </TabsTrigger>
              <TabsTrigger
                value="users"
                data-testid="tab-users"
                className={isMobile ? "h-8 rounded-lg px-2.5 py-1 text-[11px] font-semibold" : ""}
                onClick={() => handleWorkersMainTabClick("users")}
              >
                <UserCog className="w-4 h-4 mr-1" />
                User Account Management
              </TabsTrigger>
            </TabsList>

            <TabsContent value="stats">
              <div className={isMobile ? "space-y-3" : "space-y-4"}>
                {/* Sub-tabs for User Stats */}
                <div className={isMobile ? "mb-2 w-full" : "mb-4 flex items-center justify-between gap-4 flex-wrap"}>
                  <div
                    className={
                      isMobile
                        ? "w-full overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        : ""
                    }
                  >
                    <div className={isMobile ? "flex min-w-max gap-1 pr-1" : "flex flex-wrap gap-2"}>
                    <Button
                      variant={isMobile ? "ghost" : statsSubTab === "staff-stats" ? "default" : "outline"}
                      onClick={() => handleStatsSubTabClick("staff-stats")}
                      className={compactStatsSubTabButtonClass(statsSubTab === "staff-stats")}
                      data-testid="button-staff-stats-tab"
                    >
                      <Users className={statsSubTabIconClass} />
                      Staff Stats
                    </Button>
                    <Button
                      variant={isMobile ? "ghost" : statsSubTab === "daily-summary" ? "default" : "outline"}
                      onClick={() => handleStatsSubTabClick("daily-summary")}
                      className={compactStatsSubTabButtonClass(statsSubTab === "daily-summary")}
                      data-testid="button-daily-summary-tab"
                    >
                      <ClipboardList className={statsSubTabIconClass} />
                      {isMobile ? "Item Count" : "Daily Item Count"}
                    </Button>
                    <Button
                      variant={isMobile ? "ghost" : statsSubTab === "sales-reports" ? "default" : "outline"}
                      onClick={() => handleStatsSubTabClick("sales-reports")}
                      className={compactStatsSubTabButtonClass(statsSubTab === "sales-reports")}
                      data-testid="button-sales-reports-tab"
                    >
                      <FileSpreadsheet className={statsSubTabIconClass} />
                      Sales Reports
                    </Button>
                    <Button
                      variant={isMobile ? "ghost" : statsSubTab === "delivery-report" ? "default" : "outline"}
                      onClick={() => handleStatsSubTabClick("delivery-report")}
                      className={compactStatsSubTabButtonClass(statsSubTab === "delivery-report")}
                      data-testid="button-delivery-report-tab"
                    >
                      <ClipboardList className={statsSubTabIconClass} />
                      Completion Report
                    </Button>
                    <Button
                      variant={isMobile ? "ghost" : statsSubTab === "credit-management" ? "default" : "outline"}
                      onClick={() => handleStatsSubTabClick("credit-management")}
                      className={compactStatsSubTabButtonClass(statsSubTab === "credit-management")}
                      data-testid="button-credit-management-tab"
                    >
                      <Wallet className={statsSubTabIconClass} />
                      Credit Management Log
                    </Button>
                    <Button
                      variant={isMobile ? "ghost" : statsSubTab === "reviews" ? "default" : "outline"}
                      onClick={() => handleStatsSubTabClick("reviews")}
                      className={compactStatsSubTabButtonClass(statsSubTab === "reviews")}
                      data-testid="button-reviews-tab"
                    >
                      <StarIcon className={statsSubTabIconClass} />
                      Reviews
                    </Button>
                    </div>
                  </div>
                </div>

                {statsSubTab !== "credit-management" && (
                <div className={`mb-3 ${isMobile ? "space-y-1.5" : "flex items-center justify-start gap-5 flex-wrap"}`}>
                  <div className={`flex items-center ${isMobile ? "justify-start gap-1.5" : "gap-2"}`}>
                    <div className={`flex flex-wrap justify-start ${isMobile ? "gap-1.5" : "gap-3"}`}>
                      {(["daily", "monthly", "yearly", "range"] as const).map((mode) => (
                        <Button
                          key={mode}
                          size="sm"
                          variant="ghost"
                          onClick={() => setUniversalDateMode(mode)}
                          className={`h-6 min-h-0 rounded-none border-0 bg-transparent px-0 py-0 shadow-none hover:bg-transparent hover:text-primary hover:shadow-none focus-visible:ring-0 active:scale-100 ${isMobile ? "!text-[11px]" : "text-sm"} ${
                            universalDateMode === mode
                              ? "font-semibold text-primary underline decoration-primary/50 underline-offset-4"
                              : "font-medium text-muted-foreground"
                          }`}
                          data-testid={`button-date-mode-${mode}`}
                        >
                          {mode === "daily" ? "Daily" : mode === "monthly" ? "Monthly" : mode === "yearly" ? "Yearly" : "Date Range"}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className={`flex items-center ${isMobile ? "w-full justify-start" : ""} ${isMobile ? "gap-1.5" : "gap-2"}`}>
                    {universalDateMode === "daily" && (
                      <div className={`flex items-center ${isMobile ? "justify-start" : ""} ${isMobile ? "gap-1.5" : "gap-2"}`}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => shiftUniversalDate(-1)}
                          className="h-7 w-7 rounded-none border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-primary hover:shadow-none focus-visible:ring-0"
                          data-testid="button-universal-date-prev"
                        >
                          <ChevronLeft className={isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} />
                        </Button>
                        <div className={`relative ${isMobile ? "w-32" : "w-36"}`}>
                          <Input
                            type="date"
                            value={universalSelectedDate}
                            onChange={(e) => setUniversalSelectedDate(e.target.value)}
                            className={`h-7 w-full rounded-none border-0 bg-transparent px-0 text-center font-semibold text-foreground shadow-none focus-visible:ring-0 ${isMobile ? "!text-[12px]" : "text-sm"}`}
                            data-testid="input-universal-daily-date"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => shiftUniversalDate(1)}
                          className="h-7 w-7 rounded-none border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-primary hover:shadow-none focus-visible:ring-0"
                          data-testid="button-universal-date-next"
                        >
                          <ChevronRight className={isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} />
                        </Button>
                      </div>
                    )}
                    {universalDateMode === "monthly" && (
                      <div className={`flex items-center ${isMobile ? "justify-start" : ""} ${isMobile ? "gap-1.5" : "gap-2"}`}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => shiftUniversalDate(-1)}
                          className="h-7 w-7 rounded-none border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-primary hover:shadow-none focus-visible:ring-0"
                          data-testid="button-universal-month-prev"
                        >
                          <ChevronLeft className={isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} />
                        </Button>
                        <div className={`relative ${isMobile ? "w-28" : "w-32"}`}>
                          <Input
                            type="month"
                            value={universalSelectedMonth}
                            onChange={(e) => setUniversalSelectedMonth(e.target.value)}
                            className={`h-7 w-full rounded-none border-0 bg-transparent px-0 text-center font-semibold text-foreground shadow-none focus-visible:ring-0 ${isMobile ? "!text-[12px]" : "text-sm"}`}
                            data-testid="input-universal-monthly-date"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => shiftUniversalDate(1)}
                          className="h-7 w-7 rounded-none border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-primary hover:shadow-none focus-visible:ring-0"
                          data-testid="button-universal-month-next"
                        >
                          <ChevronRight className={isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} />
                        </Button>
                      </div>
                    )}
                    {universalDateMode === "yearly" && (
                      <div className={`flex items-center ${isMobile ? "justify-start" : ""} ${isMobile ? "gap-1.5" : "gap-2"}`}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => shiftUniversalDate(-1)}
                          className="h-7 w-7 rounded-none border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-primary hover:shadow-none focus-visible:ring-0"
                          data-testid="button-universal-year-prev"
                        >
                          <ChevronLeft className={isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} />
                        </Button>
                        <Input
                          type="number"
                          min="2020"
                          max="2030"
                          value={universalSelectedYear}
                          onChange={(e) => setUniversalSelectedYear(e.target.value)}
                          className={`h-7 rounded-none border-0 bg-transparent px-0 text-center font-semibold text-foreground shadow-none focus-visible:ring-0 ${isMobile ? "w-16 !text-[12px]" : "w-20 text-sm"}`}
                          data-testid="input-universal-yearly-date"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => shiftUniversalDate(1)}
                          className="h-7 w-7 rounded-none border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-primary hover:shadow-none focus-visible:ring-0"
                          data-testid="button-universal-year-next"
                        >
                          <ChevronRight className={isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} />
                        </Button>
                      </div>
                    )}
                    {universalDateMode === "range" && (
                      <div className={`${isMobile ? "w-full max-w-[320px] min-w-0" : "flex-1 min-w-[320px]"}`}>
                        <DateTimeRangePicker
                          start={universalStartDate}
                          end={universalEndDate}
                          onChange={(start, end) => {
                            setUniversalStartDate(start);
                            setUniversalEndDate(end);
                          }}
                          textOnly
                        />
                      </div>
                    )}
                  </div>
                  <div className={`flex items-center ${isMobile ? "w-full gap-1.5" : "gap-2"}`}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={exportManagementOnePageSummaryExcel}
                      disabled={isManagementSummaryLoading}
                      className={
                        isMobile
                          ? `h-8 flex-1 rounded-lg px-2 !text-[11px] font-semibold ${mobileSurfaceButtonClass}`
                          : "h-8 gap-1 px-3 text-xs"
                      }
                      data-testid="button-management-one-page-summary-excel"
                    >
                      {isManagementSummaryLoading ? (
                        <Loader2 className={isMobile ? "mr-1 h-3.5 w-3.5 animate-spin" : "mr-1 h-4 w-4 animate-spin"} />
                      ) : (
                        <FileSpreadsheet className={isMobile ? "mr-1 h-3.5 w-3.5" : "mr-1 h-4 w-4"} />
                      )}
                      Summary Excel
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={exportManagementOnePageSummaryPDF}
                      disabled={isManagementSummaryLoading}
                      className={
                        isMobile
                          ? `h-8 flex-1 rounded-lg px-2 !text-[11px] font-semibold ${mobileSurfaceButtonClass}`
                          : "h-8 gap-1 px-3 text-xs"
                      }
                      data-testid="button-management-one-page-summary-pdf"
                    >
                      {isManagementSummaryLoading ? (
                        <Loader2 className={isMobile ? "mr-1 h-3.5 w-3.5 animate-spin" : "mr-1 h-4 w-4 animate-spin"} />
                      ) : (
                        <FileText className={isMobile ? "mr-1 h-3.5 w-3.5" : "mr-1 h-4 w-4"} />
                      )}
                      Summary PDF
                    </Button>
                  </div>
                </div>
                )}

                {statsSubTab === "staff-stats" && (
                <div className={staffStatsSectionClass}>
                {!isMobile ? (
                <div className="flex items-center flex-wrap gap-4">
                    <div className="relative flex-1 max-w-xs">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search worker..."
                        className="pl-9"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        data-testid="input-search-worker"
                      />
                    </div>
                </div>
                ) : null}

                <div className={isMobile ? "flex items-center gap-4 overflow-x-auto pb-1 text-[12px] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "flex flex-wrap items-center gap-x-7 gap-y-2 text-sm"}>
                  <div className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                    <Plus className={`${isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} text-blue-500`} />
                    <span className="font-medium">Created</span>
                    <span className="font-bold text-foreground">{smartCardTotals.ordersCreated}</span>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                    <Tag className={`${isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} text-orange-500`} />
                    <span className="font-medium">Tagged</span>
                    <span className="font-bold text-foreground">{smartCardTotals.tagged}</span>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                    <Package className={`${isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} text-green-500`} />
                    <span className="font-medium">Packed</span>
                    <span className="font-bold text-foreground">{smartCardTotals.packed}</span>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                    <Check className={`${isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} text-purple-500`} />
                    <span className="font-medium">Completed</span>
                    <span className="font-bold text-foreground">{smartCardTotals.delivered}</span>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                    <Receipt className={`${isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} text-cyan-500`} />
                    <span className="font-medium">
                      {isMobile ? `Billed | ${smartCardTotals.billsTotal.toFixed(0)} AED` : `Billed Orders (${smartCardTotals.billsTotal.toFixed(0)} AED)`}
                    </span>
                    <span className="font-bold text-foreground">{smartCardTotals.billsPaid}</span>
                  </div>
                </div>

                {/* Admin Orders Popup Dialog */}
                <Dialog open={!!selectedAdminOrders} onOpenChange={(open) => !open && setSelectedAdminOrders(null)}>
                  <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        {selectedAdminOrders?.type === "created" && <FileText className="w-5 h-5 text-blue-500" />}
                        {selectedAdminOrders?.type === "tagged" && <Tag className="w-5 h-5 text-orange-500" />}
                        {selectedAdminOrders?.type === "packed" && <Package className="w-5 h-5 text-green-500" />}
                        {selectedAdminOrders?.type === "delivered" && <Truck className="w-5 h-5 text-purple-500" />}
                        {selectedAdminOrders?.type === "paid" && <Receipt className="w-5 h-5 text-cyan-500" />}
                        Admin - {selectedAdminOrders?.type === "created" ? "Orders Created" : 
                                 selectedAdminOrders?.type === "tagged" ? "Orders Tagged" :
                                 selectedAdminOrders?.type === "packed" ? "Orders Packed" : 
                                 selectedAdminOrders?.type === "delivered" ? "Orders Completed" : "Paid Bills"}
                        <Badge variant="outline" className="ml-2">{selectedAdminOrders?.orders.length || 0}</Badge>
                      </DialogTitle>
                    </DialogHeader>
                    {selectedAdminOrders && (
                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Order #</TableHead>
                              <TableHead>Client</TableHead>
                              <TableHead>Date</TableHead>
                              {selectedAdminOrders.type === "delivered" && (
                                <TableHead>Mode</TableHead>
                              )}
                              <TableHead>Items</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedAdminOrders.orders.map((order) => {
                              const clientName = clients?.find(c => c.id === order.clientId)?.name || order.customerName || "Walk-in";
                              return (
                                <TableRow key={order.id} data-testid={`row-admin-popup-order-${order.id}`}>
                                  <TableCell className="font-medium text-blue-600">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      className="h-auto p-0 font-semibold text-primary hover:bg-transparent hover:text-primary hover:underline"
                                      onClick={() =>
                                        openOrderInTracking(
                                          order,
                                          selectedAdminOrders.type === "delivered"
                                            ? { focusDateField: "delivery", focusTab: "delivery" }
                                            : undefined,
                                        )
                                      }
                                      data-testid={`button-admin-popup-order-${order.id}`}
                                    >
                                      {order.orderNumber}
                                    </Button>
                                  </TableCell>
                                  <TableCell>{clientName}</TableCell>
                                  <TableCell>
                                    {selectedAdminOrders.type === "created" && order.entryDate && format(new Date(order.entryDate), "MMM d, yyyy")}
                                    {selectedAdminOrders.type === "tagged" && order.tagDate && format(new Date(order.tagDate), "MMM d, yyyy")}
                                    {selectedAdminOrders.type === "packed" && order.packingDate && format(new Date(order.packingDate), "MMM d, yyyy")}
                                    {selectedAdminOrders.type === "delivered" && order.deliveryDate && format(new Date(order.deliveryDate), "MMM d, yyyy")}
                                  </TableCell>
                                  {selectedAdminOrders.type === "delivered" && (
                                    <TableCell>
                                      <Badge
                                        variant="outline"
                                        className={getCompletionMode(order) === "Delivery"
                                          ? "bg-cyan-50 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-300"
                                          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"}
                                      >
                                        {getCompletionMode(order)}
                                      </Badge>
                                    </TableCell>
                                  )}
                                  <TableCell className="max-w-xs truncate text-muted-foreground text-sm">
                                    {order.items || "No items"}
                                  </TableCell>
                                  <TableCell className="text-right">{order.finalAmount} AED</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </DialogContent>
                </Dialog>

                {/* Universal Staff Stats Table - All staff tracked by PIN */}
                <Card
                  className={`${mobilePanelCardClass} ${isMobile ? screenReportCardClass : managementA4PaperCardClass}`}
                  style={managementA4PaperCardStyle}
                >
                  <CardHeader className={isMobile ? "px-4 pb-2 pt-4" : `pb-2 ${managementA4PaperHeaderClass}`}>
                    <CardTitle className={`text-base ${isMobile ? "flex items-start justify-between gap-2" : "flex items-center gap-2"}`}>
                      <span className={`flex min-w-0 items-center ${isMobile ? "flex-wrap gap-1.5" : "gap-2"}`}>
                        <Users className={`${isMobile ? "w-4 h-4" : "w-5 h-5"}`} />
                        <span>Performance Table</span>
                        <span className={`ml-1 flex items-center ${isMobile ? "gap-1" : "gap-2"}`}>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={exportToExcel}
                              className={isMobile ? `h-7 rounded-lg px-2 !text-[11px] font-semibold ${mobileSurfaceButtonClass}` : "h-8 gap-1 px-3 text-xs"}
                              data-testid="button-export-excel"
                            >
                              <FileSpreadsheet className={isMobile ? "mr-1 h-3.5 w-3.5" : "mr-1 h-4 w-4"} />
                              Excel
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={exportToPDF}
                              className={isMobile ? `h-7 rounded-lg px-2 !text-[11px] font-semibold ${mobileSurfaceButtonClass}` : "h-8 gap-1 px-3 text-xs"}
                              data-testid="button-export-pdf"
                            >
                              <FileText className={isMobile ? "mr-1 h-3.5 w-3.5" : "mr-1 h-4 w-4"} />
                              PDF
                            </Button>
                          </span>
                      </span>
                      <Badge variant="outline" className={mobileOutlineBadgeClass}>
                        {performanceRows.length} accounts
                      </Badge>
                    </CardTitle>
                    <p className={mobileSectionDescriptionClass}>
                      Admin is pinned first; staff are tracked by PIN across all activities
                    </p>
                  </CardHeader>
                  <CardContent className={isMobile ? "px-4 pb-4" : managementA4PaperContentClass}>
                    {isMobile ? (
                        <div className="space-y-3">
                          {performanceRows.map((row) => (
                            <div
                              key={row.id}
                              className={mobileSurfaceCardClass}
                              data-testid={row.kind === "admin" ? "row-admin-stats" : `row-stats-${row.workerId}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-[14px] font-semibold text-foreground">
                                    {row.name}
                                  </p>
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className={
                                        row.kind === "admin"
                                          ? "rounded-xl border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 text-[11px] text-purple-600 dark:border-purple-900/60 dark:bg-purple-950/30 dark:text-purple-300"
                                          : getStaffRoleBadgeClass(row.roleType)
                                      }
                                    >
                                      {row.kind === "admin" ? "Admin" : getStaffRoleLabel(row.roleType)}
                                    </Badge>
                                    <Badge variant={row.active ? "default" : "secondary"} className="rounded-xl px-2.5 py-0.5 text-[11px]">
                                      {row.active ? "Active" : "Inactive"}
                                    </Badge>
                                  </div>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => generatePerformancePDF(row)}
                                  className={`h-9 w-9 flex-shrink-0 rounded-xl p-0 ${mobileSurfaceButtonClass}`}
                                  data-testid={row.kind === "admin" ? "button-pdf-admin" : `button-pdf-${row.workerId}`}
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                              </div>

                              <div className="mt-3 grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  className={`rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-70 ${mobileToneCardClasses.blue.container}`}
                                  onClick={() => openPerformanceRowActivity(row, "created")}
                                  disabled={row.ordersCreated === 0}
                                  data-testid={row.kind === "admin" ? "badge-admin-created" : `badge-created-${row.workerId}`}
                                >
                                  <div className={`flex items-center gap-1.5 text-[11px] font-medium ${mobileToneCardClasses.blue.label}`}>
                                    <FileText className="h-3.5 w-3.5" />
                                    Created
                                  </div>
                                  <p className={`mt-1 text-lg font-semibold leading-none ${mobileToneCardClasses.blue.value}`}>{row.ordersCreated}</p>
                                  <p className={`mt-1 text-[10px] ${mobileToneCardClasses.blue.meta}`}>By order date</p>
                                </button>
                                <button
                                  type="button"
                                  className={`rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-70 ${mobileToneCardClasses.orange.container}`}
                                  onClick={() => openPerformanceRowActivity(row, "tagged")}
                                  disabled={row.taggedCount === 0}
                                  data-testid={row.kind === "admin" ? "badge-admin-tagged" : `badge-tagged-${row.workerId}`}
                                >
                                  <div className={`flex items-center gap-1.5 text-[11px] font-medium ${mobileToneCardClasses.orange.label}`}>
                                    <Tag className="h-3.5 w-3.5" />
                                    Tagged
                                  </div>
                                  <p className={`mt-1 text-lg font-semibold leading-none ${mobileToneCardClasses.orange.value}`}>{row.taggedCount}</p>
                                  <p className={`mt-1 text-[10px] ${mobileToneCardClasses.orange.meta}`}>By order date</p>
                                </button>
                                <button
                                  type="button"
                                  className={`rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-70 ${mobileToneCardClasses.green.container}`}
                                  onClick={() => openPerformanceRowActivity(row, "packed")}
                                  disabled={row.packedCount === 0}
                                  data-testid={row.kind === "admin" ? "badge-admin-packed" : `badge-packed-${row.workerId}`}
                                >
                                  <div className={`flex items-center gap-1.5 text-[11px] font-medium ${mobileToneCardClasses.green.label}`}>
                                    <Package className="h-3.5 w-3.5" />
                                    Packed
                                  </div>
                                  <p className={`mt-1 text-lg font-semibold leading-none ${mobileToneCardClasses.green.value}`}>{row.packedCount}</p>
                                  <p className={`mt-1 text-[10px] ${mobileToneCardClasses.green.meta}`}>By action date</p>
                                </button>
                                <button
                                  type="button"
                                  className={`rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-70 ${mobileToneCardClasses.purple.container}`}
                                  onClick={() => openPerformanceRowActivity(row, "delivered")}
                                  disabled={row.deliveredCount === 0}
                                  data-testid={row.kind === "admin" ? "badge-admin-delivered" : `badge-delivered-${row.workerId}`}
                                >
                                  <div className={`flex items-center gap-1.5 text-[11px] font-medium ${mobileToneCardClasses.purple.label}`}>
                                    <Truck className="h-3.5 w-3.5" />
                                    Completed
                                  </div>
                                  <p className={`mt-1 text-lg font-semibold leading-none ${mobileToneCardClasses.purple.value}`}>{row.deliveredCount}</p>
                                  <p className={`mt-1 text-[10px] ${mobileToneCardClasses.purple.meta}`}>By action date</p>
                                </button>
                              </div>

                              <button
                                type="button"
                                className={`mt-2 flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-70 ${mobileToneCardClasses.cyan.container}`}
                                onClick={() => openPerformanceRowActivity(row, "paid")}
                                disabled={row.billsCreated === 0}
                                data-testid={row.kind === "admin" ? "badge-admin-paid" : `badge-paid-${row.workerId}`}
                              >
                                <div className={`flex items-center gap-1.5 text-[11px] font-medium ${mobileToneCardClasses.cyan.label}`}>
                                  <Receipt className="h-3.5 w-3.5" />
                                  Paid Bills
                                </div>
                                <span className={`text-lg font-semibold leading-none ${mobileToneCardClasses.cyan.value}`}>{row.billsCreated}</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={managementA4TableShellClass}>
                          <Table className={isMobile ? mobileTableClass : "screen-a4-table screen-a4-performance-table"}>
                            <TableHeader>
                              <TableRow>
                                <TableHead className={`${mobileTableHeadClass} ${isMobile ? "" : "w-[23%]"}`}>Staff Name</TableHead>
                                <TableHead className={`${mobileTableHeadClass} text-center ${isMobile ? "" : "w-[13%]"}`}>Role</TableHead>
                                <TableHead className={`${mobileTableHeadClass} text-center ${isMobile ? "" : "w-[9%]"}`}>
                                  <div className="flex flex-col items-center gap-0.5">
                                    <div className="flex items-center gap-1">
                                      <FileText className="w-4 h-4 text-blue-500" />
                                      Created
                                    </div>
                                    <span className="text-[9px] font-normal text-blue-500">(by order date)</span>
                                  </div>
                                </TableHead>
                                <TableHead className={`${mobileTableHeadClass} text-center ${isMobile ? "" : "w-[9%]"}`}>
                                  <div className="flex flex-col items-center gap-0.5">
                                    <div className="flex items-center gap-1">
                                      <Tag className="w-4 h-4 text-orange-500" />
                                      Tagged
                                    </div>
                                    <span className="text-[9px] font-normal text-blue-500">(by order date)</span>
                                  </div>
                                </TableHead>
                                <TableHead className={`${mobileTableHeadClass} text-center ${isMobile ? "" : "w-[9%]"}`}>
                                  <div className="flex flex-col items-center gap-0.5">
                                    <div className="flex items-center gap-1">
                                      <Package className="w-4 h-4 text-green-500" />
                                      Packed
                                    </div>
                                    <span className="text-[9px] font-normal text-amber-600">(by action date)</span>
                                  </div>
                                </TableHead>
                                <TableHead className={`${mobileTableHeadClass} text-center ${isMobile ? "" : "w-[9%]"}`}>
                                  <div className="flex flex-col items-center gap-0.5">
                                    <div className="flex items-center gap-1">
                                      <Truck className="w-4 h-4 text-purple-500" />
                                      Completed
                                    </div>
                                    <span className="text-[9px] font-normal text-amber-600">(by action date)</span>
                                  </div>
                                </TableHead>
                                <TableHead className={`${mobileTableHeadClass} text-center ${isMobile ? "" : "w-[9%]"}`}>
                                  <div className="flex items-center justify-center gap-1">
                                    <Receipt className="w-4 h-4 text-cyan-500" />
                                    Paid
                                  </div>
                                </TableHead>
                                <TableHead className={`${mobileTableHeadClass} text-center ${isMobile ? "" : "w-[12%]"}`}>Status</TableHead>
                                <TableHead className={`${mobileTableHeadClass} text-center ${isMobile ? "" : "w-[7%]"}`}>PDF</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {performanceRows.map((row) => (
                                <TableRow
                                  key={row.id}
                                  className={row.kind === "admin" ? "bg-purple-500/5" : undefined}
                                  data-testid={row.kind === "admin" ? "row-admin-stats" : `row-stats-${row.workerId}`}
                                >
                                  <TableCell className={`${mobileTableCellClass} font-medium ${isMobile ? "" : "whitespace-normal break-words"}`}>
                                    {row.name}
                                  </TableCell>
                                  <TableCell className={`${mobileTableCellClass} text-center`}>
                                    <Badge
                                      variant="outline"
                                      className={
                                        row.kind === "admin"
                                          ? "bg-purple-500/10 text-purple-600 border-purple-500/30"
                                          : getStaffRoleBadgeClass(row.roleType)
                                      }
                                    >
                                      {row.kind === "admin" ? "Admin" : getStaffRoleLabel(row.roleType)}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className={`${mobileTableCellClass} text-center`}>
                                    <Badge
                                      variant="outline"
                                      className={`bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/40 ${isMobile ? "min-w-9 rounded-xl px-2 py-0.5 text-[11px]" : ""}`}
                                      onClick={() => openPerformanceRowActivity(row, "created")}
                                      data-testid={row.kind === "admin" ? "badge-admin-created" : `badge-created-${row.workerId}`}
                                    >
                                      {row.ordersCreated}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className={`${mobileTableCellClass} text-center`}>
                                    <Badge
                                      variant="outline"
                                      className={`bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300 cursor-pointer hover:bg-orange-100 dark:hover:bg-orange-900/40 ${isMobile ? "min-w-9 rounded-xl px-2 py-0.5 text-[11px]" : ""}`}
                                      onClick={() => openPerformanceRowActivity(row, "tagged")}
                                      data-testid={row.kind === "admin" ? "badge-admin-tagged" : `badge-tagged-${row.workerId}`}
                                    >
                                      {row.taggedCount}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className={`${mobileTableCellClass} text-center`}>
                                    <Badge
                                      variant="outline"
                                      className={`bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300 cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/40 ${isMobile ? "min-w-9 rounded-xl px-2 py-0.5 text-[11px]" : ""}`}
                                      onClick={() => openPerformanceRowActivity(row, "packed")}
                                      data-testid={row.kind === "admin" ? "badge-admin-packed" : `badge-packed-${row.workerId}`}
                                    >
                                      {row.packedCount}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className={`${mobileTableCellClass} text-center`}>
                                    <Badge
                                      variant="outline"
                                      className={`bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40 ${isMobile ? "min-w-9 rounded-xl px-2 py-0.5 text-[11px]" : ""}`}
                                      onClick={() => openPerformanceRowActivity(row, "delivered")}
                                      data-testid={row.kind === "admin" ? "badge-admin-delivered" : `badge-delivered-${row.workerId}`}
                                    >
                                      {row.deliveredCount}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className={`${mobileTableCellClass} text-center`}>
                                    <Badge
                                      variant="outline"
                                      className={`bg-cyan-50 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-300 cursor-pointer hover:bg-cyan-100 dark:hover:bg-cyan-900/40 ${isMobile ? "min-w-9 rounded-xl px-2 py-0.5 text-[11px]" : ""}`}
                                      onClick={() => openPerformanceRowActivity(row, "paid")}
                                      data-testid={row.kind === "admin" ? "badge-admin-paid" : `badge-paid-${row.workerId}`}
                                    >
                                      {row.billsCreated}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className={`${mobileTableCellClass} text-center`}>
                                    <Badge variant={row.active ? "default" : "secondary"} className={isMobile ? "rounded-xl px-2.5 py-0.5 text-[11px]" : ""}>
                                      {row.active ? "Active" : "Inactive"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className={`${mobileTableCellClass} text-center`}>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => generatePerformancePDF(row)}
                                      className={isMobile ? "h-8 w-8 rounded-xl border-slate-300 p-0 hover:bg-slate-50" : "h-7 w-7 p-0"}
                                      data-testid={row.kind === "admin" ? "button-pdf-admin" : `button-pdf-${row.workerId}`}
                                    >
                                      <Download className="w-4 h-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )
                    }
                  </CardContent>
                </Card>
              </div>
                )}


                {statsSubTab === "daily-summary" && (
                  <Card
                    className={isMobile ? screenReportCardClass : managementA4PaperCardClass}
                    style={managementA4PaperCardStyle}
                  >
                    <CardContent className={isMobile ? "px-3 pb-3 pt-3" : `p-6 pt-6 ${managementA4PaperContentClass}`}>
                      {(() => {
                        const uaeOffsetMs = 4 * 60 * 60000;

                        const uaeNow = new Date(Date.now() + uaeOffsetMs);
                        const selectedDate = dailySummaryDate || `${uaeNow.getUTCFullYear()}-${String(uaeNow.getUTCMonth() + 1).padStart(2, "0")}-${String(uaeNow.getUTCDate()).padStart(2, "0")}`;
                        const [yyyy, mm, dd] = selectedDate.split("-").map(Number);
                        const dayStartUTC = Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0) - uaeOffsetMs;
                        const dayEndUTC = Date.UTC(yyyy, mm - 1, dd, 23, 59, 59, 999) - uaeOffsetMs;

                        const isOnDate = (dateStr: string | Date | null | undefined) => {
                          if (!dateStr) return false;
                          const ts = new Date(dateStr).getTime();
                          return ts >= dayStartUTC && ts <= dayEndUTC;
                        };

                        const receivedOrders = orders?.filter((o) => isOnDate(o.entryDate)) || [];

                        const inventoryProducts = products || [];
                        const inventoryNameMap = new Map(
                          inventoryProducts.map((product) => [product.name.trim().toLowerCase(), product.name]),
                        );

                        const matchItemToInventoryName = (rawName: string) => {
                          let normalizedName = String(rawName || "")
                            .replace(/\s*\(base\s*[\d.]+\s*AED\)/gi, " ")
                            .replace(/\s*@\s*[\d.]+\s*AED(?:\s*\((custom|min\s*50|admin\s*edited)\))?/gi, " ")
                            .replace(/\s*\[(N|DC|IO|D|I)\]\s*/gi, " ")
                            .replace(/\s*\*URG\*\s*/gi, " ")
                            .replace(/\s*\((folding|hanger|hanging)\)\s*/gi, " ")
                            .replace(/\s*\((custom|min\s*50|admin\s*edited)\)\s*$/gi, " ")
                            .trim();

                          normalizedName = normalizedName.replace(/^\d+(?:\.\d+)?\s*sqm\s+/i, "").trim();
                          normalizedName = normalizedName.replace(/\s+/g, " ");
                          if (!normalizedName) return null;

                          const directMatch = inventoryNameMap.get(normalizedName.toLowerCase());
                          if (directMatch) return directMatch;

                          const withoutLastParen = normalizedName.replace(/\s*\([^)]*\)\s*$/, "").trim();
                          if (withoutLastParen) {
                            const fallbackExactMatch = inventoryNameMap.get(withoutLastParen.toLowerCase());
                            if (fallbackExactMatch) return fallbackExactMatch;

                            const fallbackProduct = inventoryProducts.find(
                              (product) =>
                                product.name.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase() ===
                                withoutLastParen.toLowerCase(),
                            );

                            if (fallbackProduct?.name) return fallbackProduct.name;
                          }

                          return normalizedName;
                        };

                        type DailySummaryParsedItem = {
                          index: number;
                          name: string;
                          quantity: number;
                        };

                        const parseItems = (itemsStr: string): DailySummaryParsedItem[] => {
                          if (!itemsStr) return [];
                          const trimmed = itemsStr.trim();
                          if (trimmed.startsWith("[")) {
                            try {
                              const parsed = JSON.parse(trimmed);
                              if (Array.isArray(parsed)) {
                                return parsed
                                  .map((item: any, index: number) => {
                                    const matchedName = matchItemToInventoryName(
                                      item.name || item.productName || item.itemName || "Unknown",
                                    );
                                    if (!matchedName) return null;
                                    const quantity = Number(item.quantity ?? item.qty ?? 1);
                                    return {
                                      index,
                                      name: matchedName,
                                      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
                                    };
                                  })
                                  .filter((item): item is DailySummaryParsedItem => !!item);
                              }
                            } catch (e) {}
                          }
                          return itemsStr.split(/,\s*/).map((item, index) => {
                            const m = item.match(/^(\d+)x\s+(.+)$/);
                            if (m) {
                              const matchedName = matchItemToInventoryName(m[2]);
                              if (!matchedName) return null;
                              return { index, name: matchedName, quantity: parseInt(m[1], 10) };
                            }
                            const m2 = item.match(/^(.+)\s+x(\d+)$/);
                            if (m2) {
                              const matchedName = matchItemToInventoryName(m2[1]);
                              if (!matchedName) return null;
                              return { index, name: matchedName, quantity: parseInt(m2[2], 10) };
                            }
                            const matchedName = matchItemToInventoryName(item.trim());
                            if (!matchedName) return null;
                            return { index, name: matchedName, quantity: 1 };
                          }).filter((item): item is DailySummaryParsedItem => !!item);
                        };

                        const getOrderDoneStatus = (order: any) =>
                          order.deliveryType === "delivery" ? "delivered" : "picked_up";

                        const getItemQtyInOrder = (
                          order: any,
                          name: string,
                          type: "received" | "delivered" | "remaining" = "received",
                        ) => {
                          const parsedOrderItems = parseItems(order.items || "");
                          const pickupStatusMap = parseItemPickupStatusMap(order.itemPickupStatus);
                          const doneStatus = getOrderDoneStatus(order);
                          let received = 0;
                          let completed = 0;

                          parsedOrderItems.forEach((item) => {
                            if (item.name !== name) return;
                            received += item.quantity;
                            completed += getItemPickupCompletedQuantityFromMap(
                              pickupStatusMap,
                              item.index,
                              item.quantity,
                              doneStatus,
                              order.delivered === true,
                            );
                          });

                          if (type === "received") return received;
                          if (type === "delivered") return completed;
                          return Math.max(0, received - completed);
                        };

                        const receivedMap: Record<string, number> = {};
                        const receivedOrdersMap: Record<string, any[]> = {};
                        const completedMap: Record<string, number> = {};
                        const completedOrdersMap: Record<string, any[]> = {};

                        receivedOrders.forEach((order) => {
                          const parsedOrderItems = parseItems(order.items || "");
                          const pickupStatusMap = parseItemPickupStatusMap(order.itemPickupStatus);
                          const doneStatus = getOrderDoneStatus(order);

                          parsedOrderItems.forEach(({ index, name, quantity }) => {
                            receivedMap[name] = (receivedMap[name] || 0) + quantity;
                            if (!receivedOrdersMap[name]) receivedOrdersMap[name] = [];
                            receivedOrdersMap[name].push(order);

                            const completedQuantity = getItemPickupCompletedQuantityFromMap(
                              pickupStatusMap,
                              index,
                              quantity,
                              doneStatus,
                              order.delivered === true,
                            );
                            if (completedQuantity > 0) {
                              completedMap[name] = (completedMap[name] || 0) + completedQuantity;
                              if (!completedOrdersMap[name]) completedOrdersMap[name] = [];
                              completedOrdersMap[name].push(order);
                            }
                          });
                        });

                        const allItemNames = new Set([
                          ...Object.keys(receivedMap),
                          ...Object.keys(completedMap),
                        ]);
                        const sortedItems = Array.from(allItemNames).sort();
                        const visibleSortedItems = sortedItems.filter((itemName) => {
                          const received = receivedMap[itemName] || 0;
                          const completed = completedMap[itemName] || 0;
                          return received > 0 || completed > 0;
                        });

                        const totalReceived = Object.values(receivedMap).reduce((s, v) => s + v, 0);
                        const totalCompleted = Object.values(completedMap).reduce((s, v) => s + v, 0);
                        const totalRemaining = Math.max(0, totalReceived - totalCompleted);

                        const dateLabel = format(new Date(yyyy, mm - 1, dd), "MMMM d, yyyy");

                        const handleBadgeClick = (itemName: string, type: "received" | "delivered" | "remaining") => {
                          let relevantOrders: any[] = [];
                          if (type === "received") {
                            relevantOrders = receivedOrdersMap[itemName] || [];
                          } else if (type === "delivered") {
                            relevantOrders = (completedOrdersMap[itemName] || []).filter(
                              (order: any) => getItemQtyInOrder(order, itemName, "delivered") > 0,
                            );
                          } else {
                            relevantOrders = (receivedOrdersMap[itemName] || []).filter(
                              (order: any) => getItemQtyInOrder(order, itemName, "remaining") > 0,
                            );
                          }
                          const unique = Array.from(new Map(relevantOrders.map((o: any) => [o.id, o])).values());
                          const ordersWithQty = unique
                            .map((o: any) => ({ ...o, _itemQty: getItemQtyInOrder(o, itemName, type) }))
                            .filter((o: any) => o._itemQty > 0);
                          if (ordersWithQty.length > 0) {
                            setDailySummaryItemDialog({ itemName, type, orders: ordersWithQty });
                          }
                        };

                        const exportDailySummaryExcel = async () => {
                          const wsData: (string | number)[][] = [];
                          wsData.push([companyContact.companyName]);
                          wsData.push(["Daily Item Count"]);
                          wsData.push([`Date: ${dateLabel}`]);
                          wsData.push([`Total Orders Received: ${receivedOrders.length} | Items Completed: ${totalCompleted}`]);
                          wsData.push([]);
                          wsData.push(["#", "Item Name", "Received", "Completed", "Remaining"]);

                          let rowNum = 1;
                          visibleSortedItems.forEach((itemName) => {
                            const received = receivedMap[itemName] || 0;
                            const completed = completedMap[itemName] || 0;
                            const remaining = Math.max(0, received - completed);
                            wsData.push([rowNum, itemName, received, completed, remaining]);
                            rowNum++;
                          });

                          wsData.push([]);
                          wsData.push(["", "TOTAL", totalReceived, totalCompleted, totalRemaining]);

                          await writeExcel({
                            data: wsData,
                            sheetName: "Daily Item Count",
                            fileName: `Daily_Item_Count_${dailySummaryDate}.xlsx`,
                            columns: [
                              { wch: 5 },
                              { wch: 30 },
                              { wch: 12 },
                              { wch: 12 },
                              { wch: 12 },
                            ],
                          });
                          toast({
                            title: "Excel Downloaded",
                            description: "Daily item count exported to Excel",
                          });
                        };

                        const exportDailySummaryPDF = () => {
                          const rows = visibleSortedItems.map((itemName, idx) => {
                            const received = receivedMap[itemName] || 0;
                            const completed = completedMap[itemName] || 0;
                            const remaining = Math.max(0, received - completed);
                            return `
                              <tr>
                                <td style="padding: 4px 6px; border: 1px solid #ddd; text-align: center;">${idx + 1}</td>
                                <td style="padding: 4px 6px; border: 1px solid #ddd;">${itemName}</td>
                                <td style="padding: 4px 6px; border: 1px solid #ddd; text-align: center;">${received}</td>
                                <td style="padding: 4px 6px; border: 1px solid #ddd; text-align: center;">${completed}</td>
                                <td style="padding: 4px 6px; border: 1px solid #ddd; text-align: center; font-weight: ${remaining > 0 ? 'bold' : 'normal'};">${remaining}</td>
                              </tr>
                            `;
                          }).join("");

                          const content = document.createElement("div");
                          content.innerHTML = `
                            <div style="font-family: Arial, sans-serif; padding: 20px; color: #000; background: #fff;">
                              <div style="text-align: center; border-bottom: 2px solid #1e40af; padding-bottom: 15px; margin-bottom: 20px;">
                                <div style="font-size: 20px; font-weight: bold; color: #1e40af;">${companyNameHtml}</div>
                                <div style="font-size: 14px; margin-top: 5px; font-weight: bold;">Daily Item Count</div>
                                <div style="font-size: 11px; margin-top: 5px; color: #666;">${dateLabel}</div>
                              </div>

                              <div style="display: flex; justify-content: space-around; margin-bottom: 15px;">
                                <div style="text-align: center;">
                                  <div style="font-size: 11px; color: #666;">Orders Received</div>
                                  <div style="font-size: 18px; font-weight: bold;">${receivedOrders.length}</div>
                                </div>
                                <div style="text-align: center;">
                                  <div style="font-size: 11px; color: #666;">Items Received</div>
                                  <div style="font-size: 18px; font-weight: bold;">${totalReceived}</div>
                                </div>
                                <div style="text-align: center;">
                                  <div style="font-size: 11px; color: #666;">Items Completed</div>
                                  <div style="font-size: 18px; font-weight: bold;">${totalCompleted}</div>
                                </div>
                                <div style="text-align: center;">
                                  <div style="font-size: 11px; color: #666;">Remaining</div>
                                  <div style="font-size: 18px; font-weight: bold;">${totalRemaining}</div>
                                </div>
                              </div>

                              <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 15px;">
                                <thead>
                                  <tr style="background: #f3f4f6;">
                                    <th style="padding: 6px 4px; border: 1px solid #ddd; text-align: center; width: 40px;">#</th>
                                    <th style="padding: 6px 4px; border: 1px solid #ddd; text-align: left;">Item Name</th>
                                    <th style="padding: 6px 4px; border: 1px solid #ddd; text-align: center;">Received</th>
                                    <th style="padding: 6px 4px; border: 1px solid #ddd; text-align: center;">Completed</th>
                                    <th style="padding: 6px 4px; border: 1px solid #ddd; text-align: center;">Remaining</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  ${rows}
                                  <tr style="background: #f3f4f6; font-weight: bold;">
                                    <td style="padding: 6px 4px; border: 1px solid #ddd;"></td>
                                    <td style="padding: 6px 4px; border: 1px solid #ddd;">TOTAL</td>
                                    <td style="padding: 6px 4px; border: 1px solid #ddd; text-align: center;">${totalReceived}</td>
                                    <td style="padding: 6px 4px; border: 1px solid #ddd; text-align: center;">${totalCompleted}</td>
                                    <td style="padding: 6px 4px; border: 1px solid #ddd; text-align: center;">${totalRemaining}</td>
                                  </tr>
                                </tbody>
                              </table>

                              <div style="text-align: center; margin-top: 20px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 9px; color: #888;">
                                Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")} | ${companyPhoneLineHtml}
                              </div>
                            </div>
                          `;

                          const opt = {
                            margin: 10,
                            filename: `Daily_Item_Count_${dailySummaryDate}.pdf`,
                            image: { type: "jpeg" as const, quality: 0.98 },
                            html2canvas: { scale: 2, useCORS: true },
                            jsPDF: {
                              unit: "mm" as const,
                              format: "a4" as const,
                              orientation: "portrait" as const,
                            },
                          };

                          html2pdf().set(opt).from(content).save();
                          toast({
                            title: "PDF Downloaded",
                            description: "Daily item count exported to PDF",
                          });
                        };

                        const dailySummaryStatClass = isMobile
                          ? "min-w-0 px-1 py-1 text-center"
                          : "min-w-0 px-2 py-2 text-center";
                        const dailySummaryLabelClass = isMobile
                          ? "text-[11px] font-medium leading-4 text-muted-foreground"
                          : "text-xs font-medium leading-4 text-muted-foreground";
                        const dailySummaryCountValueClass = isMobile
                          ? "mt-0.5 text-lg font-semibold leading-6 text-foreground"
                          : "mt-1 text-2xl font-semibold leading-7 text-foreground";
                        const dailySummaryCounts = [
                          { label: "Orders", value: receivedOrders.length, testId: "text-daily-orders-received", Icon: ClipboardList, iconClass: "text-blue-500" },
                          { label: "Received", value: totalReceived, testId: "text-daily-items-received", Icon: Package, iconClass: "text-green-500" },
                          { label: "Completed", value: totalCompleted, testId: "text-daily-items-delivered", Icon: Check, iconClass: "text-orange-500" },
                          { label: "Remaining", value: totalRemaining, testId: "text-daily-items-remaining", Icon: Package, iconClass: "text-red-500" },
                        ];
                        const dailySummaryTextRows = (
                          <div className={isMobile ? "" : "mb-6 border-y border-border/70 py-3"}>
                            <div className={`grid grid-cols-2 sm:grid-cols-4 ${isMobile ? "gap-x-4 gap-y-2" : "gap-x-8 gap-y-2"}`}>
                              {dailySummaryCounts.map(({ label, value, testId, Icon, iconClass }) => (
                                <div key={label} className={dailySummaryStatClass}>
                                  <div className={`flex items-center justify-center ${isMobile ? "gap-1.5" : "gap-2"}`}>
                                    <Icon className={`${isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} ${iconClass}`} />
                                    <p className={dailySummaryLabelClass}>{label}</p>
                                  </div>
                                  <p className={dailySummaryCountValueClass} data-testid={testId}>
                                    {value}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        );

                        return (
                          <>
                            <div className={`flex flex-wrap items-center justify-between ${isMobile ? "gap-2 mb-3" : "gap-3 mb-5"}`}>
                              <div className={`flex items-center ${isMobile ? "gap-1.5 text-base" : "gap-2 text-base"} font-semibold`}>
                                <ClipboardList className={`${isMobile ? "w-4 h-4" : "w-5 h-5"}`} />
                                <span>Daily Item Count</span>
                              </div>
                              <div className={`flex items-center ${isMobile ? "gap-1" : "gap-2"}`}>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={exportDailySummaryExcel}
                                  className={isMobile ? `h-7 rounded-lg px-2 !text-[11px] ${mobileSurfaceButtonClass}` : "h-8 gap-1 px-3 text-xs"}
                                  data-testid="button-daily-summary-export-excel"
                                >
                                  <Download className={`${isMobile ? "w-3.5 h-3.5 mr-1" : "w-4 h-4 mr-1"}`} />
                                  {isMobile ? "Excel" : "Export Excel"}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={exportDailySummaryPDF}
                                  className={isMobile ? `h-7 rounded-lg px-2 !text-[11px] ${mobileSurfaceButtonClass}` : "h-8 gap-1 px-3 text-xs"}
                                  data-testid="button-daily-summary-export-pdf"
                                >
                                  <FileText className={`${isMobile ? "w-3.5 h-3.5 mr-1" : "w-4 h-4 mr-1"}`} />
                                  {isMobile ? "PDF" : "Export PDF"}
                                </Button>
                              </div>
                            </div>

                            {isMobile ? (
                              <div className="mb-3 border-y border-border/70 py-2">
                                <button
                                  type="button"
                                  className="flex w-full items-center justify-between gap-3 py-1.5 text-left"
                                  aria-expanded={mobileDailySummaryCardsOpen}
                                  onClick={() => setMobileDailySummaryCardsOpen((open) => !open)}
                                  data-testid="button-mobile-daily-summary-cards-toggle"
                                >
                                  <div className="min-w-0">
                                    <p className="text-[11px] font-medium text-muted-foreground">Item Count Totals</p>
                                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                      <span className="text-base font-semibold leading-tight text-foreground">
                                        {receivedOrders.length} orders
                                      </span>
                                      <span className="text-[11px] font-semibold text-muted-foreground">
                                        {totalReceived} received
                                      </span>
                                      <span className="text-[11px] font-semibold text-muted-foreground">
                                        {totalRemaining} remaining
                                      </span>
                                    </div>
                                  </div>
                                  <ChevronDown
                                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                                      mobileDailySummaryCardsOpen ? "rotate-180" : ""
                                    }`}
                                  />
                                </button>

                                {mobileDailySummaryCardsOpen ? (
                                  <div className="border-t border-border/60 pt-3">
                                    {dailySummaryTextRows}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            {!isMobile ? dailySummaryTextRows : null}

                            <div className={isMobile ? "mobile-compact-report-table-shell" : "border overflow-hidden rounded-lg"}>
                              <div className={isMobile ? "" : managementA4TableShellClass}>
                              <Table className={isMobile ? "mobile-compact-report-table" : "screen-a4-table screen-a4-summary-table"}>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className={isMobile ? "w-[34px] px-2 text-center" : "w-[7%]"}>#</TableHead>
                                    <TableHead className={isMobile ? "" : "w-[45%]"}>Item Name</TableHead>
                                    <TableHead className={isMobile ? "w-[42px] text-center" : "w-[16%] text-center"}>
                                      {isMobile ? "Rec" : "Received"}
                                    </TableHead>
                                    <TableHead className={isMobile ? "w-[48px] text-center" : "w-[16%] text-center"}>
                                      {isMobile ? "Done" : "Completed"}
                                    </TableHead>
                                    <TableHead className={isMobile ? "w-[42px] text-center" : "w-[16%] text-center"}>
                                      {isMobile ? "Left" : "Remaining"}
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {visibleSortedItems.map((itemName, idx) => {
                                    const received = receivedMap[itemName] || 0;
                                    const completed = completedMap[itemName] || 0;
                                    const remaining = Math.max(0, received - completed);
                                    return (
                                      <TableRow key={itemName} data-testid={`row-daily-item-${itemName}`}>
                                        <TableCell className={isMobile ? "compact-nowrap px-2 text-center tabular-nums text-muted-foreground" : "text-muted-foreground"}>{idx + 1}</TableCell>
                                        <TableCell className={isMobile ? "compact-main-line" : "font-medium whitespace-normal break-words"}>{itemName}</TableCell>
                                        <TableCell className="text-center">
                                          {received > 0 ? (
                                            <Badge
                                              variant="outline"
                                              className={`text-blue-600 cursor-pointer ${isMobile ? "compact-nowrap px-1.5 py-0 text-[10px]" : ""}`}
                                              onClick={() => handleBadgeClick(itemName, "received")}
                                              data-testid={`badge-received-${itemName}`}
                                            >
                                              {received}
                                            </Badge>
                                          ) : (
                                            <span className={isMobile ? "compact-nowrap text-[10px] text-muted-foreground" : "text-muted-foreground"}>0</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-center">
                                          {completed > 0 ? (
                                            <Badge
                                              variant="outline"
                                              className={`text-green-600 cursor-pointer ${isMobile ? "compact-nowrap px-1.5 py-0 text-[10px]" : ""}`}
                                              onClick={() => handleBadgeClick(itemName, "delivered")}
                                              data-testid={`badge-delivered-${itemName}`}
                                            >
                                              {completed}
                                            </Badge>
                                          ) : (
                                            <span className={isMobile ? "compact-nowrap text-[10px] text-muted-foreground" : "text-muted-foreground"}>0</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-center">
                                          {remaining > 0 ? (
                                            <Badge
                                              variant="outline"
                                              className={`text-orange-600 cursor-pointer ${isMobile ? "compact-nowrap px-1.5 py-0 text-[10px]" : ""}`}
                                              onClick={() => handleBadgeClick(itemName, "remaining")}
                                              data-testid={`badge-remaining-${itemName}`}
                                            >
                                              {remaining}
                                            </Badge>
                                          ) : (
                                            <span className={isMobile ? "compact-nowrap text-[10px] text-muted-foreground" : "text-muted-foreground"}>0</span>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                  <TableRow className="bg-muted/30 font-bold">
                                    <TableCell></TableCell>
                                    <TableCell>Total</TableCell>
                                    <TableCell className="text-center">{totalReceived}</TableCell>
                                    <TableCell className="text-center">{totalCompleted}</TableCell>
                                    <TableCell className="text-center">{totalRemaining}</TableCell>
                                  </TableRow>
                                </TableBody>
                              </Table>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </CardContent>
                  </Card>
                )}
                
                <Dialog open={!!dailySummaryItemDialog} onOpenChange={(open) => !open && setDailySummaryItemDialog(null)}>
                  <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <ClipboardList className="w-5 h-5 text-primary" />
                        {dailySummaryItemDialog?.itemName}
                        <Badge variant="outline" className="ml-2 capitalize">
                          {dailySummaryItemDialog?.type === "delivered" ? "completed" : dailySummaryItemDialog?.type}
                        </Badge>
                        <span className="ml-auto text-sm font-semibold">
                          {dailySummaryItemDialog?.orders.length || 0} order{(dailySummaryItemDialog?.orders.length || 0) !== 1 ? "s" : ""}
                        </span>
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      {dailySummaryItemDialog?.orders.map((order, idx) => {
                        const client = clients?.find((c) => c.id === order.clientId);
                        return (
                          <div key={order.id} className="border rounded-lg p-3" data-testid={`row-daily-summary-order-${order.id}`}>
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm text-muted-foreground">{idx + 1}.</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="h-auto p-0 font-semibold text-primary hover:bg-transparent hover:text-primary"
                                  onClick={() => openOrderInTracking(order)}
                                  data-testid={`button-open-order-${order.id}`}
                                >
                                  {order.orderNumber}
                                </Button>
                              </div>
                              <Badge variant="secondary" className="font-mono">
                                Qty {order._itemQty || 0}
                              </Badge>
                            </div>
                            <div className="text-sm space-y-1 text-muted-foreground">
                              <div className="flex items-center gap-2">
                                <Users className="w-3.5 h-3.5" />
                                <span className="font-medium text-foreground">{client?.name || order.customerName || "Walk-in"}</span>
                              </div>
                              {(client?.phone || order.customerPhone) && (
                                <div className="flex items-center gap-2">
                                  <Phone className="w-3.5 h-3.5" />
                                  <span>{client?.phone || order.customerPhone}</span>
                                </div>
                              )}
                              {(order.deliveryAddress || client?.address) && (
                                <div className="flex items-center gap-2">
                                  <MapPin className="w-3.5 h-3.5" />
                                  <span>{order.deliveryAddress || client?.address}</span>
                                </div>
                              )}
                              {order.entryBy && (
                                <div className="flex items-center gap-2">
                                  <UserCog className="w-3.5 h-3.5" />
                                  <span>Created by {order.entryBy}</span>
                                </div>
                              )}
                              {order.items && (
                                <div className="mt-1 pt-1 border-t text-xs">
                                  {order.items}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </DialogContent>
                </Dialog>

                {statsSubTab === "sales-reports" && (
                  <SalesReports
                    key={`sales-reports-${salesReportsReloadKey}`}
                    embedded
                    externalActiveTab={universalDateMode}
                    externalSelectedDate={universalSelectedDate}
                    externalSelectedMonth={universalSelectedMonth}
                    externalSelectedYear={universalSelectedYear}
                    externalStartDate={universalStartDate}
                    externalEndDate={universalEndDate}
                  />
                )}

                {statsSubTab === "delivery-report" && (
                  <div className={isMobile ? "space-y-3" : `${screenReportCardClass} space-y-4`}>
                    <div className={isMobile ? "flex items-center gap-4 overflow-x-auto pb-1 text-[12px] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "flex flex-wrap items-center gap-x-7 gap-y-2 text-sm"}>
                      <div className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                        <Check className={`${isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} text-cyan-500`} />
                        <span className="font-medium">Completed</span>
                        <span className="font-bold text-foreground">{deliveryReportSummary.total}</span>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                        <Truck className={`${isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} text-green-500`} />
                        <span className="font-medium">Delivery</span>
                        <span className="font-bold text-foreground">{deliveryReportSummary.deliveryCount}</span>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                        <Package className={`${isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} text-blue-500`} />
                        <span className="font-medium">Take-away</span>
                        <span className="font-bold text-foreground">{deliveryReportSummary.takeAwayCount}</span>
                      </div>
                    </div>

                    <Card
                      ref={completionReportRef}
                      tabIndex={-1}
                      className={`${mobilePanelCardClass} ${isMobile ? screenReportCardClass : managementA4PaperCardClass}`}
                      style={managementA4PaperCardStyle}
                    >
                      <CardHeader className={isMobile ? "px-4 pb-2 pt-4" : `pb-3 ${managementA4PaperHeaderClass}`}>
                        <CardTitle className={`flex items-center gap-2 ${isMobile ? "text-[15px]" : "text-base"}`}>
                          <ClipboardList className={`${isMobile ? "w-4 h-4" : "w-5 h-5"} text-cyan-500`} />
                          Completion Report
                          <Badge variant="outline" className={isMobile ? "rounded-xl px-2.5 py-0.5 text-[10px]" : "ml-1"}>
                            {deliveryReportOrders.length} orders
                          </Badge>
                          <span className={`flex items-center ${isMobile ? "ml-1 gap-1" : "ml-auto gap-2"}`}>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={exportCompletionReportExcel}
                              disabled={deliveryReportOrders.length === 0}
                              className={isMobile ? `h-7 rounded-lg px-2 !text-[11px] ${mobileSurfaceButtonClass}` : "h-8 gap-1 px-3 text-xs"}
                              data-testid="button-export-completion-report-excel"
                            >
                              <FileSpreadsheet className={isMobile ? "w-3.5 h-3.5 mr-1" : "w-4 h-4 mr-1"} />
                              Excel
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={exportCompletionReportPDF}
                              disabled={deliveryReportOrders.length === 0}
                              className={isMobile ? `h-7 rounded-lg px-2 !text-[11px] ${mobileSurfaceButtonClass}` : "h-8 gap-1 px-3 text-xs"}
                              data-testid="button-export-completion-report-pdf"
                            >
                              <FileText className={isMobile ? "w-3.5 h-3.5 mr-1" : "w-4 h-4 mr-1"} />
                              PDF
                            </Button>
                          </span>
                        </CardTitle>
                        <p className={isMobile ? "text-[11px] leading-4 text-muted-foreground" : "text-sm text-muted-foreground"}>
                          Completed delivery and take-away orders are grouped by completion date for the selected period. Move selected rows or all visible completion dates to another day and the completed counts in Staff Stats will refresh with them.
                        </p>
                      </CardHeader>
                      <CardContent className={`${isMobile ? "px-4 pb-4" : managementA4PaperContentClass} space-y-3`}>
                        {visibleCompletionOrdersWithDates.length > 0 && (
                          <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-2 flex-wrap">
                            <span className="text-sm font-medium">
                              {selectedVisibleCompletionOrders.length > 0
                                ? `${selectedVisibleCompletionOrders.length} selected`
                                : `${visibleCompletionOrdersWithDates.length} visible`}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {selectedVisibleCompletionOrders.length > 0
                                ? "Move completion date to:"
                                : "Move visible completion dates to:"}
                            </span>
                            <div className="relative">
                              <Input
                                type="datetime-local"
                                value={formatDateTimeLocalInput(moveDeliveryToDate)}
                                onChange={(event) => {
                                  setMoveDeliveryToDate(event.target.value ? new Date(event.target.value) : undefined);
                                }}
                                className="h-8 min-w-[190px] rounded-lg pl-8 text-xs"
                                aria-label="Move completion date and time"
                                data-testid="input-move-delivery-date-time"
                              />
                              <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            </div>
                            <Button
                              size="sm"
                              disabled={!moveDeliveryToDate || isMovingDeliveryDates || selectedVisibleCompletionOrders.length === 0}
                              onClick={() => handleMoveDeliveryDates("selected")}
                              data-testid="button-move-delivery-dates"
                            >
                              {isMovingDeliveryDates ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                              ) : (
                                <Check className="w-3.5 h-3.5 mr-1" />
                              )}
                              Move Selected
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!moveDeliveryToDate || isMovingDeliveryDates || visibleCompletionOrdersWithDates.length === 0}
                              onClick={() => handleMoveDeliveryDates("all")}
                              data-testid="button-move-all-delivery-dates"
                            >
                              {isMovingDeliveryDates ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                              ) : (
                                <Check className="w-3.5 h-3.5 mr-1" />
                              )}
                              Move All Visible
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedDeliveryReportOrders(new Set());
                                setMoveDeliveryToDate(undefined);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        )}

                        {deliveryReportOrders.length === 0 ? (
                          <p className="py-8 text-center text-muted-foreground">
                            No completed orders found for this period.
                          </p>
                        ) : (
                          <div className="space-y-4">
                            {renderCompletionReportTable("delivery", "Delivery Orders", deliveryCompletionOrders)}
                            {renderCompletionReportTable("takeaway", "Take-away Orders", takeAwayCompletionOrders)}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}

                {statsSubTab === "credit-management" && (
                  <div className={screenReportCardClass}>
                    <SalesReports key={`credit-management-${creditManagementReloadKey}`} embedded creditOnly />
                  </div>
                )}

                {statsSubTab === "reviews" && (
                  <div className={screenReportCardClass}>
                    <ReviewsSection key={`reviews-${reviewsReloadKey}`} />
                  </div>
                )}

              </div>
            </TabsContent>

            <TabsContent value="users">
              <div className={isMobile ? "mb-3 rounded-[14px] border border-blue-200 bg-blue-50 p-2.5 dark:border-blue-800 dark:bg-blue-950/30" : "mb-4 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg"}>
                <p className={isMobile ? "text-[12px] leading-5 text-blue-700 dark:text-blue-300" : "text-sm text-blue-700 dark:text-blue-300"}>
                  <Key className="w-4 h-4 inline mr-1" />
                  <strong>All staff PINs work universally</strong> - Any staff member's PIN can be used for billing, tracking, and other functions across the entire system.
                </p>
              </div>
              <Card className={mobilePanelCardClass}>
                <CardHeader className={isMobile ? "flex flex-row items-start justify-between gap-3 px-4 pb-3 pt-4" : "flex flex-row items-center justify-between gap-4 pb-4"}>
                  <CardTitle className={isMobile ? "flex items-center gap-2 text-[15px] leading-6" : "flex items-center gap-2"}>
                    <UserCog className="w-5 h-5" />
                    System User Accounts
                  </CardTitle>
                  <Button
                    onClick={() => setIsUserCreateOpen(true)}
                    className={mobileUserHeaderButtonClass}
                    data-testid="button-add-user"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add User
                  </Button>
                </CardHeader>
                <CardContent className={isMobile ? "px-4 pb-4 pt-0" : undefined}>
                  <p className={`${mobileCompactInfoTextClass} mb-4`}>
                    Manage login accounts for staff. Users with email addresses
                    can use the "Forgot Password" feature.
                  </p>
                  {isLoadingUsers ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                  ) : !systemUsers || systemUsers.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No user accounts found
                    </div>
                  ) : (
                    <Accordion type="multiple" defaultValue={["counter", "section", "driver"]} className={isMobile ? "space-y-3" : "space-y-2"}>
                      <AccordionItem value="counter" className={mobileUserAccordionItemClass}>
                        <AccordionTrigger className={isMobile ? "py-3 hover:no-underline" : "hover:no-underline"}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={`bg-blue-500/10 text-blue-600 border-blue-500/30 ${mobileUserBadgeClass}`}>Counter</Badge>
                            <span className={mobileCompactInfoTextClass}>
                              ({systemUsers.filter(u => u.role === "counter" || u.role === "reception").length} login{systemUsers.filter(u => u.role === "counter" || u.role === "reception").length !== 1 ? "s" : ""}, {counterStaffMembers.length} staff)
                            </span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className={isMobile ? "space-y-3" : "space-y-4"}>
                            <div>
                              <h4 className={isMobile ? "mb-2 text-[13px] font-semibold" : "font-medium text-sm mb-2"}>Login Details</h4>
                              {isMobile ? (
                                renderMobileLoginAccountCard(
                                  systemUsers.find(u => u.role === "counter" || u.role === "reception"),
                                  {
                                    emptyText: "No counter login found",
                                    toneClassName: "border-blue-200 bg-blue-50/90 dark:border-blue-800 dark:bg-blue-950/30",
                                    editTestId: "button-edit-counter-login",
                                  },
                                )
                              ) : (
                                <div className={isMobile ? "mb-2 rounded-[14px] border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30" : "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-3"}>
                                  <div className={isMobile ? "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2" : "flex items-center justify-between flex-wrap gap-2"}>
                                    <div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">Username</p>
                                        <p className={`font-medium ${isMobile ? "truncate text-[13px]" : ""}`}>{systemUsers.find(u => u.role === "counter" || u.role === "reception")?.username}</p>
                                      </div>
                                    </div>
                                      <div className={isMobile ? "border-l pl-3" : "border-l pl-4"}>
                                        <p className="text-xs text-muted-foreground">Password</p>
                                        <p className={`font-mono ${isMobile ? "text-[13px]" : "text-sm"}`}>{systemUsers.find(u => u.role === "counter" || u.role === "reception")?.password}</p>
                                      </div>
                                    <Button size="sm" variant="outline" className={mobileUserActionButtonClass} onClick={() => openUserEditor(systemUsers.find(u => u.role === "counter" || u.role === "reception"))}>
                                      <Pencil className="w-3 h-3 mr-1" />
                                      Edit
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className={isMobile ? "border-t pt-3" : "border-t pt-4"}>
                              <div className={isMobile ? "mb-2 flex items-start justify-between gap-2" : "flex items-center justify-between mb-3"}>
                                <h4 className={isMobile ? "max-w-[11rem] text-[13px] leading-5 font-semibold" : "font-medium text-sm"}>Staff Members (each has their own PIN)</h4>
                                <Button size="sm" variant="outline" className={mobileUserActionButtonClass} onClick={() => { setStaffMemberFormData({ name: "", pin: "", roleType: "counter" }); setIsStaffMemberCreateOpen(true); }} data-testid="button-add-counter-staff">
                                  <Plus className="w-3 h-3 mr-1" />
                                  Add Staff
                                </Button>
                              </div>
                              {isMobile ? (
                                renderMobileStaffMemberCards(counterStaffMembers, {
                                  emptyText: "No staff members assigned to counter role",
                                  roleType: "counter",
                                  editTestIdPrefix: "button-edit-staff-",
                                  deleteTestIdPrefix: "button-delete-staff-",
                                })
                              ) : (
                                <div className={mobileTableShellClass}>
                                <Table className={mobileUserTableClass}>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className={mobileTableHeadClass}>Name</TableHead>
                                      <TableHead className={mobileTableHeadClass}>Login PIN</TableHead>
                                      <TableHead className={`${mobileTableHeadClass} text-center`}>Active</TableHead>
                                      <TableHead className={`${mobileTableHeadClass} text-right`}>Actions</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {counterStaffMembers.map((member) => (
                                      <TableRow key={member.id}>
                                        <TableCell className={`${mobileTableCellClass} font-medium`}>{member.name}</TableCell>
                                        <TableCell className={mobileTableCellClass}>
                                          <div className="flex items-center gap-1">
                                            <span className={`font-mono ${isMobile ? "text-[13px]" : "text-sm"}`}>
                                              {visibleStaffPins.has(member.id) ? member.pin : "•••••"}
                                            </span>
                                            <Button size="icon" variant="ghost" className={mobileUserIconButtonClass} onClick={() => toggleStaffPinVisibility(member.id)}>
                                              {visibleStaffPins.has(member.id) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                            </Button>
                                          </div>
                                        </TableCell>
                                        <TableCell className={`${mobileTableCellClass} text-center`}>
                                          <div className={isMobile ? "flex items-center justify-center gap-1.5" : "flex items-center justify-center gap-2"}>
                                            <Switch checked={member.active} onCheckedChange={() => toggleStaffMemberActive(member)} />
                                            <Badge variant={member.active ? "default" : "secondary"} className={mobileUserBadgeClass}>{member.active ? "Active" : "Inactive"}</Badge>
                                          </div>
                                        </TableCell>
                                        <TableCell className={mobileTableCellClass}>
                                          <div className="flex justify-end gap-1">
                                            <Button size="icon" variant="ghost" className={mobileUserIconButtonClass} onClick={() => openStaffMemberEditor(member, "counter")} data-testid={`button-edit-staff-${member.id}`}>
                                              <Pencil className="w-4 h-4" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className={`${mobileUserIconButtonClass} text-destructive`} onClick={() => { if (confirm(`Remove staff member "${member.name}"?`)) { deleteStaffMemberMutation.mutate(member.id); } }} data-testid={`button-delete-staff-${member.id}`}>
                                              <Trash2 className="w-4 h-4" />
                                            </Button>
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                                </div>
                              )}
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                      
                      <AccordionItem value="section" className={mobileUserAccordionItemClass}>
                        <AccordionTrigger className={isMobile ? "py-3 hover:no-underline" : "hover:no-underline"}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={`bg-purple-500/10 text-purple-600 border-purple-500/30 ${mobileUserBadgeClass}`}>Section</Badge>
                            <span className={mobileCompactInfoTextClass}>
                              ({systemUsers.filter(u => u.role === "section" || u.role === "staff").length} login{systemUsers.filter(u => u.role === "section" || u.role === "staff").length !== 1 ? "s" : ""}, {sectionStaffMembers.length} staff)
                            </span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className={isMobile ? "space-y-3" : "space-y-4"}>
                            <div>
                              <h4 className={isMobile ? "mb-2 text-[13px] font-semibold" : "font-medium text-sm mb-2"}>Login Details</h4>
                              {isMobile ? (
                                renderMobileLoginAccountCard(
                                  systemUsers.find(u => u.role === "section" || u.role === "staff"),
                                  {
                                    emptyText: "No section login found",
                                    toneClassName: "border-purple-200 bg-purple-50/90 dark:border-purple-800 dark:bg-purple-950/30",
                                    editTestId: "button-edit-section-login",
                                  },
                                )
                              ) : (
                                <div className={isMobile ? "mb-2 rounded-[14px] border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-950/30" : "bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg p-4 mb-3"}>
                                  <div className={isMobile ? "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2" : "flex items-center justify-between flex-wrap gap-2"}>
                                    <div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">Username</p>
                                        <p className={`font-medium ${isMobile ? "truncate text-[13px]" : ""}`}>{systemUsers.find(u => u.role === "section" || u.role === "staff")?.username}</p>
                                      </div>
                                    </div>
                                      <div className={isMobile ? "border-l pl-3" : "border-l pl-4"}>
                                        <p className="text-xs text-muted-foreground">Password</p>
                                        <p className={`font-mono ${isMobile ? "text-[13px]" : "text-sm"}`}>{systemUsers.find(u => u.role === "section" || u.role === "staff")?.password}</p>
                                      </div>
                                    <Button size="sm" variant="outline" className={mobileUserActionButtonClass} onClick={() => openUserEditor(systemUsers.find(u => u.role === "section" || u.role === "staff"))}>
                                      <Pencil className="w-3 h-3 mr-1" />
                                      Edit
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className={isMobile ? "border-t pt-3" : "border-t pt-4"}>
                              <div className={isMobile ? "mb-2 flex items-start justify-between gap-2" : "flex items-center justify-between mb-3"}>
                                <h4 className={isMobile ? "max-w-[11rem] text-[13px] leading-5 font-semibold" : "font-medium text-sm"}>Staff Members (each has their own PIN)</h4>
                                <Button size="sm" variant="outline" className={mobileUserActionButtonClass} onClick={() => { setStaffMemberFormData({ name: "", pin: "", roleType: "section" }); setIsStaffMemberCreateOpen(true); }} data-testid="button-add-section-staff">
                                  <Plus className="w-3 h-3 mr-1" />
                                  Add Staff
                                </Button>
                              </div>
                              {isMobile ? (
                                renderMobileStaffMemberCards(sectionStaffMembers, {
                                  emptyText: "No staff members assigned to section role",
                                  roleType: "section",
                                  editTestIdPrefix: "button-edit-staff-",
                                  deleteTestIdPrefix: "button-delete-staff-",
                                })
                              ) : (
                                <div className={mobileTableShellClass}>
                                <Table className={mobileUserTableClass}>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className={mobileTableHeadClass}>Name</TableHead>
                                      <TableHead className={mobileTableHeadClass}>Login PIN</TableHead>
                                      <TableHead className={`${mobileTableHeadClass} text-center`}>Active</TableHead>
                                      <TableHead className={`${mobileTableHeadClass} text-right`}>Actions</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {sectionStaffMembers.map((member) => (
                                      <TableRow key={member.id}>
                                        <TableCell className={`${mobileTableCellClass} font-medium`}>{member.name}</TableCell>
                                        <TableCell className={mobileTableCellClass}>
                                          <div className="flex items-center gap-1">
                                            <span className={`font-mono ${isMobile ? "text-[13px]" : "text-sm"}`}>
                                              {visibleStaffPins.has(member.id) ? member.pin : "•••••"}
                                            </span>
                                            <Button size="icon" variant="ghost" className={mobileUserIconButtonClass} onClick={() => toggleStaffPinVisibility(member.id)}>
                                              {visibleStaffPins.has(member.id) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                            </Button>
                                          </div>
                                        </TableCell>
                                        <TableCell className={`${mobileTableCellClass} text-center`}>
                                          <div className={isMobile ? "flex items-center justify-center gap-1.5" : "flex items-center justify-center gap-2"}>
                                            <Switch checked={member.active} onCheckedChange={() => toggleStaffMemberActive(member)} />
                                            <Badge variant={member.active ? "default" : "secondary"} className={mobileUserBadgeClass}>{member.active ? "Active" : "Inactive"}</Badge>
                                          </div>
                                        </TableCell>
                                        <TableCell className={mobileTableCellClass}>
                                          <div className="flex justify-end gap-1">
                                            <Button size="icon" variant="ghost" className={mobileUserIconButtonClass} onClick={() => openStaffMemberEditor(member, "section")} data-testid={`button-edit-staff-${member.id}`}>
                                              <Pencil className="w-4 h-4" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className={`${mobileUserIconButtonClass} text-destructive`} onClick={() => { if (confirm(`Remove staff member "${member.name}"?`)) { deleteStaffMemberMutation.mutate(member.id); } }} data-testid={`button-delete-staff-${member.id}`}>
                                              <Trash2 className="w-4 h-4" />
                                            </Button>
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                                </div>
                              )}
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="driver" className={mobileUserAccordionItemClass}>
                        <AccordionTrigger className={isMobile ? "py-3 hover:no-underline" : "hover:no-underline"}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={`bg-green-500/10 text-green-600 border-green-500/30 ${mobileUserBadgeClass}`}>Driver</Badge>
                            <span className={mobileCompactInfoTextClass}>
                              ({systemUsers.filter(u => u.role === "driver").length} login{systemUsers.filter(u => u.role === "driver").length !== 1 ? "s" : ""}, {driverStaffMembers.length} staff)
                            </span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className={isMobile ? "space-y-3" : "space-y-4"}>
                            <div>
                              <h4 className={isMobile ? "mb-2 text-[13px] font-semibold" : "font-medium text-sm mb-2"}>Login Details</h4>
                              {isMobile ? (
                                renderMobileLoginAccountCard(
                                  systemUsers.find(u => u.role === "driver"),
                                  {
                                    emptyText: "No driver login found",
                                    toneClassName: "border-green-200 bg-green-50/90 dark:border-green-800 dark:bg-green-950/30",
                                    editTestId: "button-edit-driver-login",
                                  },
                                )
                              ) : (
                                <div className={isMobile ? "mb-2 rounded-[14px] border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/30" : "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-3"}>
                                  <div className={isMobile ? "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2" : "flex items-center justify-between flex-wrap gap-2"}>
                                    <div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">Username</p>
                                        <p className={`font-medium ${isMobile ? "truncate text-[13px]" : ""}`}>{systemUsers.find(u => u.role === "driver")?.username}</p>
                                      </div>
                                    </div>
                                      <div className={isMobile ? "border-l pl-3" : "border-l pl-4"}>
                                        <p className="text-xs text-muted-foreground">Password</p>
                                        <p className={`font-mono ${isMobile ? "text-[13px]" : "text-sm"}`}>{systemUsers.find(u => u.role === "driver")?.password}</p>
                                      </div>
                                    <Button size="sm" variant="outline" className={mobileUserActionButtonClass} onClick={() => openUserEditor(systemUsers.find(u => u.role === "driver"))}>
                                      <Pencil className="w-3 h-3 mr-1" />
                                      Edit
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className={isMobile ? "border-t pt-3" : "border-t pt-4"}>
                              <div className={isMobile ? "mb-2 flex items-start justify-between gap-2" : "flex items-center justify-between mb-3"}>
                                <h4 className={isMobile ? "max-w-[11rem] text-[13px] leading-5 font-semibold" : "font-medium text-sm"}>Staff Members (each has their own PIN)</h4>
                                <Button size="sm" variant="outline" className={mobileUserActionButtonClass} onClick={() => { setStaffMemberFormData({ name: "", pin: "", roleType: "driver" }); setIsStaffMemberCreateOpen(true); }} data-testid="button-add-driver-staff">
                                  <Plus className="w-3 h-3 mr-1" />
                                  Add Staff
                                </Button>
                              </div>
                              {isMobile ? (
                                renderMobileStaffMemberCards(driverStaffMembers, {
                                  emptyText: "No staff members assigned to driver role",
                                  roleType: "driver",
                                  editTestIdPrefix: "button-edit-driver-staff-",
                                  deleteTestIdPrefix: "button-delete-driver-staff-",
                                  showDeliveries: true,
                                })
                              ) : (
                                <div className={mobileTableShellClass}>
                                <Table className={mobileUserTableClass}>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className={mobileTableHeadClass}>Name</TableHead>
                                      <TableHead className={mobileTableHeadClass}>PIN</TableHead>
                                      <TableHead className={`${mobileTableHeadClass} text-center`}>Deliveries</TableHead>
                                      <TableHead className={`${mobileTableHeadClass} text-center`}>Active</TableHead>
                                      <TableHead className={`${mobileTableHeadClass} text-right`}>Actions</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {driverStaffMembers.map((member) => {
                                      const memberDeliveries = getDriverDeliveryCount(member);
                                      return (
                                      <TableRow key={member.id}>
                                        <TableCell className={`${mobileTableCellClass} font-medium`}>{member.name}</TableCell>
                                        <TableCell className={mobileTableCellClass}>
                                          <div className="flex items-center gap-1">
                                            <span className={`font-mono ${isMobile ? "text-[13px]" : "text-sm"}`}>
                                              {visibleStaffPins.has(member.id) ? member.pin : "•••••"}
                                            </span>
                                            <Button size="icon" variant="ghost" className={mobileUserIconButtonClass} onClick={() => toggleStaffPinVisibility(member.id)}>
                                              {visibleStaffPins.has(member.id) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                            </Button>
                                          </div>
                                        </TableCell>
                                        <TableCell className={`${mobileTableCellClass} text-center`}>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className={isMobile ? "h-8 rounded-xl px-2 text-[12px] font-semibold" : ""}
                                            onClick={() => setSelectedDriverHistory({ id: member.id, name: member.name })}
                                            data-testid={`button-view-deliveries-${member.id}`}
                                          >
                                            <Truck className="w-3 h-3 mr-1" />
                                            {memberDeliveries}
                                          </Button>
                                        </TableCell>
                                        <TableCell className={`${mobileTableCellClass} text-center`}>
                                          <div className={isMobile ? "flex items-center justify-center gap-1.5" : "flex items-center justify-center gap-2"}>
                                            <Switch checked={member.active} onCheckedChange={() => toggleStaffMemberActive(member)} />
                                            <Badge variant={member.active ? "default" : "secondary"} className={mobileUserBadgeClass}>{member.active ? "Active" : "Inactive"}</Badge>
                                          </div>
                                        </TableCell>
                                        <TableCell className={mobileTableCellClass}>
                                          <div className="flex justify-end gap-1">
                                            <Button size="icon" variant="ghost" className={mobileUserIconButtonClass} onClick={() => openStaffMemberEditor(member, "driver")} data-testid={`button-edit-driver-staff-${member.id}`}>
                                              <Pencil className="w-4 h-4" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className={`${mobileUserIconButtonClass} text-destructive`} onClick={() => { if (confirm(`Remove staff member "${member.name}"?`)) { deleteStaffMemberMutation.mutate(member.id); } }} data-testid={`button-delete-driver-staff-${member.id}`}>
                                              <Trash2 className="w-4 h-4" />
                                            </Button>
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                                </div>
                              )}
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

          </Tabs>
        )}
      </main>

      <Dialog
        open={!!editWorker}
        onOpenChange={(open) => !open && setEditWorker(null)}
      >
        <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Worker</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Staff Name</Label>
              <Input
                placeholder="Enter name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                data-testid="input-edit-worker-name"
              />
            </div>
            <div className="space-y-2">
              <Label>New PIN (optional)</Label>
              <Input
                id="edit-worker-pin"
                type="tel"
                inputMode="numeric"
                maxLength={5}
                placeholder="Leave empty to keep current PIN"
                value={formData.pin}
                autoComplete="off"
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    pin: e.target.value.replace(/\D/g, "").slice(0, 5),
                  })
                }
                className="text-center tracking-widest [-webkit-text-security:disc]"
                data-testid="input-edit-worker-pin"
              />
            </div>
            <Button
              className="w-full"
              onClick={handleUpdate}
              disabled={updateMutation.isPending || !formData.name}
              data-testid="button-update-worker"
            >
              {updateMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Update Worker
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isUserCreateOpen} onOpenChange={(open) => {
              if (open) {
                const defaultRole = "counter";
                setUserFormData({ username: getNextUsername(defaultRole), password: "", name: "", email: "", role: defaultRole, pin: "" });
              }
              setIsUserCreateOpen(open);
            }}>
        <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="w-5 h-5" />
              Add User Account
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={userFormData.role}
                onValueChange={(value) =>
                  setUserFormData({ ...userFormData, role: value, username: getNextUsername(value) })
                }
              >
                <SelectTrigger data-testid="select-new-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {loginUserRoleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The main admin account is managed from Admin Settings and cannot be added here.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-username">Username (auto-generated)</Label>
              <Input
                id="new-user-username"
                name="new_user_username"
                placeholder="Username"
                value={userFormData.username}
                onChange={(e) =>
                  setUserFormData({ ...userFormData, username: e.target.value })
                }
                className="bg-muted"
                data-testid="input-new-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-password">Password</Label>
              <Input
                id="new-user-password"
                name="new_user_password"
                type="password"
                placeholder="Enter password"
                value={userFormData.password}
                onChange={(e) =>
                  setUserFormData({ ...userFormData, password: e.target.value })
                }
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-display-name">Display Name</Label>
              <Input
                id="new-user-display-name"
                name="new_user_display_name"
                placeholder="Enter display name"
                value={userFormData.name}
                onChange={(e) =>
                  setUserFormData({ ...userFormData, name: e.target.value })
                }
                data-testid="input-new-name"
              />
            </div>
            <Button
              className="w-full"
              onClick={handleCreateUser}
              disabled={
                createUserMutation.isPending ||
                !userFormData.username ||
                !userFormData.password
              }
              data-testid="button-submit-user"
            >
              {createUserMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Create User
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editUser}
        onOpenChange={(open) => !open && setEditUser(null)}
      >
        <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5" />
              Edit User: {editUser?.username}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-user-username" className="flex items-center gap-1">
                <UserCog className="w-3 h-3" />
                Username
              </Label>
              <Input
                id="edit-user-username"
                name="edit_user_username"
                placeholder="Enter username"
                value={userFormData.username}
                disabled
                className="bg-muted"
                data-testid="input-edit-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-user-display-name">Display Name</Label>
              <Input
                id="edit-user-display-name"
                name="edit_user_display_name"
                placeholder="Enter display name"
                value={userFormData.name}
                onChange={(e) =>
                  setUserFormData({ ...userFormData, name: e.target.value })
                }
                data-testid="input-edit-user-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-user-password" className="flex items-center gap-1">
                <Lock className="w-3 h-3" />
                New Password (leave empty to keep current)
              </Label>
              <Input
                id="edit-user-password"
                name="edit_user_password"
                type="password"
                placeholder="Enter new password"
                value={userFormData.password}
                onChange={(e) =>
                  setUserFormData({ ...userFormData, password: e.target.value })
                }
                data-testid="input-edit-user-password"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={userFormData.role}
                onValueChange={(value) =>
                  setUserFormData({ ...userFormData, role: value })
                }
              >
                <SelectTrigger data-testid="select-edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {loginUserRoleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              onClick={handleUpdateUser}
              disabled={updateUserMutation.isPending}
              data-testid="button-update-user"
            >
              {updateUserMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Update User
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Driver Delivery History Dialog */}
      <Dialog open={!!selectedDriverHistory} onOpenChange={() => setSelectedDriverHistory(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-green-600" />
              Orders Delivered
              {(() => {
                const dId = selectedDriverHistory?.id;
                const dName = selectedDriverHistory?.name;
                const count = orders?.filter(order => 
                  order.delivered && (order.deliveredByWorkerId === dId || order.deliveryBy === dName)
                ).length || 0;
                return <Badge variant="outline" className="ml-1">{count}</Badge>;
              })()}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Delivered by: {selectedDriverHistory?.name}
            </p>
          </DialogHeader>
          {(() => {
            const driverId = selectedDriverHistory?.id;
            const driverName = selectedDriverHistory?.name;
            const deliveredOrders = orders?.filter(order => 
              order.delivered && (
                order.deliveredByWorkerId === driverId || 
                order.deliveryBy === driverName
              )
            ).sort((a, b) => {
              const dateA = a.deliveryDate ? new Date(a.deliveryDate).getTime() : 0;
              const dateB = b.deliveryDate ? new Date(b.deliveryDate).getTime() : 0;
              return dateB - dateA;
            }) || [];
            
            if (deliveredOrders.length === 0) {
              return (
                <div className="text-center py-8 text-muted-foreground">
                  No deliveries found for this driver
                </div>
              );
            }
            
            return (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Delivery Date</TableHead>
                      <TableHead>Delivered By</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deliveredOrders.map((order) => {
                      const clientName = clients?.find(c => c.id === order.clientId)?.name || order.customerName || "-";
                      return (
                        <TableRow key={order.id} data-testid={`row-driver-delivery-${order.id}`}>
                          <TableCell className="font-medium text-blue-600">
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-auto p-0 font-semibold text-primary hover:bg-transparent hover:text-primary hover:underline"
                              onClick={() => openOrderInTracking(order)}
                              data-testid={`button-driver-history-order-${order.id}`}
                            >
                              {order.orderNumber}
                            </Button>
                          </TableCell>
                          <TableCell>{clientName}</TableCell>
                          <TableCell>
                            {order.deliveryDate && (
                              <div>
                                <div>{format(new Date(order.deliveryDate), "MMM d, yyyy")}</div>
                                <div className="text-xs text-muted-foreground">{format(new Date(order.deliveryDate), "hh:mm a")}</div>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{order.deliveryBy || "-"}</TableCell>
                          <TableCell className="max-w-xs truncate text-muted-foreground text-sm">
                            {order.items || "No items"}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {order.adjustedTotal != null ? order.adjustedTotal : (order.finalAmount ?? order.totalAmount ?? "0")} AED
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Staff Orders Dialog */}
      <Dialog open={!!selectedStaffOrders} onOpenChange={() => setSelectedStaffOrders(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedStaffOrders?.type === "created" && <FileText className="w-5 h-5 text-blue-500" />}
              {selectedStaffOrders?.type === "tagged" && <Tag className="w-5 h-5 text-orange-500" />}
              {selectedStaffOrders?.type === "packed" && <Package className="w-5 h-5 text-green-500" />}
              {selectedStaffOrders?.type === "delivered" && <Truck className="w-5 h-5 text-purple-500" />}
              {selectedStaffOrders?.type === "paid" && <Receipt className="w-5 h-5 text-cyan-500" />}
              {selectedStaffOrders?.staffName} - {selectedStaffOrders?.type === "created" ? "Orders Created" : 
               selectedStaffOrders?.type === "tagged" ? "Orders Tagged" : 
               selectedStaffOrders?.type === "packed" ? "Orders Packed" : 
               selectedStaffOrders?.type === "delivered" ? "Orders Completed" : "Paid Bills"}
              <Badge variant="outline" className="ml-2">
                {selectedStaffOrders?.type === "paid" 
                  ? getStaffOrders(selectedStaffOrders?.staffId || 0, "paid").length
                  : (getStaffOrders(selectedStaffOrders?.staffId || 0, selectedStaffOrders?.type || "tagged") as Order[]).length}
              </Badge>
            </DialogTitle>
          </DialogHeader>
          {selectedStaffOrders && (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order #</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Date</TableHead>
                    {selectedStaffOrders.type === "delivered" && (
                      <TableHead>Mode</TableHead>
                    )}
                    <TableHead>Items</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedStaffOrders.type === "paid" ? (
                    // Show paid bills
                    getStaffOrders(selectedStaffOrders.staffId, "paid").map((bill: any) => {
                      const order = orders?.find(o => o.billId === bill.id);
                      const clientName = order ? (clients?.find(c => c.id === order.clientId)?.name || order.customerName || "Walk-in") : "N/A";
                      return (
                        <TableRow key={bill.id} data-testid={`row-staff-bill-${bill.id}`}>
                          <TableCell className="font-medium text-blue-600">
                            {order?.id ? (
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-auto p-0 font-semibold text-primary hover:bg-transparent hover:text-primary hover:underline"
                                onClick={() => openOrderInTracking(order)}
                                data-testid={`button-staff-paid-order-${order.id}`}
                              >
                                {order.orderNumber}
                              </Button>
                            ) : (
                              order?.orderNumber || `Bill #${bill.id}`
                            )}
                          </TableCell>
                          <TableCell>{clientName}</TableCell>
                          <TableCell>
                            {bill.billDate && format(new Date(bill.billDate), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell className="max-w-xs truncate text-muted-foreground text-sm">
                            {order?.items || "N/A"}
                          </TableCell>
                          <TableCell className="text-right">{bill.amount} AED</TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    // Show orders (created, tagged, packed, delivered)
                    (getStaffOrders(selectedStaffOrders.staffId, selectedStaffOrders.type) as Order[]).map((order) => {
                      const clientName = clients?.find(c => c.id === order.clientId)?.name || order.customerName || "Walk-in";
                      return (
                        <TableRow key={order.id} data-testid={`row-staff-order-${order.id}`}>
                          <TableCell className="font-medium text-blue-600">
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-auto p-0 font-semibold text-primary hover:bg-transparent hover:text-primary hover:underline"
                              onClick={() =>
                                openOrderInTracking(
                                  order,
                                  selectedStaffOrders.type === "delivered"
                                    ? { focusDateField: "delivery", focusTab: "delivery" }
                                    : undefined,
                                )
                              }
                              data-testid={`button-staff-order-${order.id}`}
                            >
                              {order.orderNumber}
                            </Button>
                          </TableCell>
                          <TableCell>{clientName}</TableCell>
                          <TableCell>
                            {selectedStaffOrders.type === "created" && order.entryDate && format(new Date(order.entryDate), "MMM d, yyyy")}
                            {selectedStaffOrders.type === "tagged" && order.tagDate && format(new Date(order.tagDate), "MMM d, yyyy")}
                            {selectedStaffOrders.type === "packed" && order.packingDate && format(new Date(order.packingDate), "MMM d, yyyy")}
                            {selectedStaffOrders.type === "delivered" && order.deliveryDate && format(new Date(order.deliveryDate), "MMM d, yyyy")}
                          </TableCell>
                          {selectedStaffOrders.type === "delivered" && (
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={getCompletionMode(order) === "Delivery"
                                  ? "bg-cyan-50 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-300"
                                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"}
                              >
                                {getCompletionMode(order)}
                              </Badge>
                            </TableCell>
                          )}
                          <TableCell className="max-w-xs truncate text-muted-foreground text-sm">
                            {order.items || "No items"}
                          </TableCell>
                          <TableCell className="text-right">{order.finalAmount} AED</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                  {selectedStaffOrders.type === "paid" && getStaffOrders(selectedStaffOrders.staffId, "paid").length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No paid bills found for this staff member
                      </TableCell>
                    </TableRow>
                  )}
                  {selectedStaffOrders.type !== "paid" && (getStaffOrders(selectedStaffOrders.staffId, selectedStaffOrders.type) as Order[]).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={selectedStaffOrders.type === "delivered" ? 6 : 5} className="text-center py-8 text-muted-foreground">
                        No orders found for this staff member
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Staff Member Dialog */}
      <Dialog open={isStaffMemberCreateOpen} onOpenChange={(open) => {
        setIsStaffMemberCreateOpen(open);
        if (!open) setStaffMemberFormData({ name: "", pin: "", roleType: "counter" });
      }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              Add Staff Member
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-staff-name">Name</Label>
              <Input
                id="new-staff-name"
                name="new_staff_name"
                placeholder="Staff member name"
                value={staffMemberFormData.name}
                onChange={(e) => setStaffMemberFormData({ ...staffMemberFormData, name: e.target.value })}
                data-testid="input-staff-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-staff-pin" className="flex items-center gap-1">
                <Key className="w-4 h-4" />
                PIN (5 digits)
              </Label>
              <Input
                id="new-staff-pin"
                name="new_staff_pin"
                type="tel"
                inputMode="numeric"
                maxLength={5}
                placeholder="Enter 5-digit PIN"
                value={staffMemberFormData.pin}
                autoComplete="off"
                onChange={(e) => setStaffMemberFormData({ ...staffMemberFormData, pin: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                className="text-center tracking-widest"
                data-testid="input-staff-pin"
              />
              <p className="text-xs text-muted-foreground">Staff will use this PIN to identify themselves when taking actions</p>
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={staffMemberFormData.roleType}
                onValueChange={(value: "counter" | "section" | "driver") => setStaffMemberFormData({ ...staffMemberFormData, roleType: value })}
              >
                <SelectTrigger data-testid="select-staff-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="counter">Counter</SelectItem>
                  <SelectItem value="section">Section</SelectItem>
                  <SelectItem value="driver">Driver</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              onClick={handleCreateStaffMember}
              disabled={createStaffMemberMutation.isPending}
              data-testid="button-save-staff"
            >
              {createStaffMemberMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add Staff Member
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Staff Member Dialog */}
      <Dialog open={!!editStaffMember} onOpenChange={(open) => {
        if (!open) {
          setEditStaffMember(null);
          setStaffMemberFormData({ name: "", pin: "", roleType: "counter" });
        }
      }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5 text-primary" />
              Edit Staff Member
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-staff-name">Name</Label>
              <Input
                id="edit-staff-name"
                name="edit_staff_name"
                placeholder="Staff member name"
                value={staffMemberFormData.name}
                onChange={(e) => setStaffMemberFormData({ ...staffMemberFormData, name: e.target.value })}
                data-testid="input-edit-staff-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-staff-pin" className="flex items-center gap-1">
                <Key className="w-4 h-4" />
                New PIN (leave blank to keep current)
              </Label>
              <Input
                id="edit-staff-pin"
                name="edit_staff_pin"
                type="tel"
                inputMode="numeric"
                maxLength={5}
                placeholder="Enter new 5-digit PIN"
                value={staffMemberFormData.pin}
                autoComplete="off"
                onChange={(e) => setStaffMemberFormData({ ...staffMemberFormData, pin: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                className="text-center tracking-widest"
                data-testid="input-edit-staff-pin"
              />
            </div>
            <Button
              className="w-full"
              onClick={handleUpdateStaffMember}
              disabled={updateStaffMemberMutation.isPending}
              data-testid="button-update-staff"
            >
              {updateStaffMemberMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Update Staff Member
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
