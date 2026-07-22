import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as ShadcnCalendar } from "@/components/ui/calendar";
import { CenteredDatePicker } from "@/components/CenteredDatePicker";
import { AnalogClockPicker } from "@/components/AnalogClockPicker";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, extractApiErrorMessage, queryClient } from "@/lib/queryClient";
import { type CompanyContactInfo, DEFAULT_COMPANY_CONTACT, normalizeCompanyContactInfo } from "@/lib/companyContact";
import { Settings, AlertTriangle, RotateCcw, Loader2, Mail, Send, Trash2, Calendar, CalendarDays, CalendarRange, User, Key, Lock, Pencil, Shield, Check, Eye, EyeOff, Database, Download, Upload, Clock } from "lucide-react";

type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';
type OrderDeletionPeriod = 'weekly' | 'monthly' | 'yearly' | 'custom';
type ResetSelectionKey = "orders" | "clients" | "staff";
type ResetSelections = Record<ResetSelectionKey, boolean>;
type DatabaseImportPreview = {
  exportedAt: string | null;
  tableCounts: Record<string, number>;
  totalRows: number;
};
type AppLockdownStatus = {
  enabled: boolean;
  reason: string;
  lockedAt: string | null;
  lockedBy: string | null;
  updatedAt: string | null;
};
type SalesReportScheduleSettings = {
  id: number;
  dailyReportDayOffset: number;
  dailyHour: number;
  dailyMinute: number;
  weeklyDay: number;
  weeklyHour: number;
  weeklyMinute: number;
  monthlyDay: number;
  monthlyHour: number;
  monthlyMinute: number;
  yearlyMonth: number;
  yearlyDay: number;
  yearlyHour: number;
  yearlyMinute: number;
  updatedAt: string | null;
};
type SalesReportScheduleForm = {
  dailyReportDayOffset: string;
  dailyTime: string;
  weeklyDay: string;
  weeklyTime: string;
  monthlyDay: string;
  monthlyTime: string;
  yearlyMonth: string;
  yearlyDay: string;
  yearlyTime: string;
};
type SalesReportTimeField = "dailyTime" | "weeklyTime" | "monthlyTime" | "yearlyTime";

const DEFAULT_RESET_SELECTIONS: ResetSelections = {
  orders: false,
  clients: false,
  staff: false,
};

const ORDER_DELETION_MONTH_OPTIONS = [
  { value: "0", label: "January" },
  { value: "1", label: "February" },
  { value: "2", label: "March" },
  { value: "3", label: "April" },
  { value: "4", label: "May" },
  { value: "5", label: "June" },
  { value: "6", label: "July" },
  { value: "7", label: "August" },
  { value: "8", label: "September" },
  { value: "9", label: "October" },
  { value: "10", label: "November" },
  { value: "11", label: "December" },
] as const;

const REPORT_WEEKDAY_OPTIONS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
] as const;

const REPORT_MONTH_OPTIONS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
] as const;

const DAILY_REPORT_DATE_OPTIONS = [
  { value: "0", label: "Same day sales" },
  { value: "1", label: "Previous day sales" },
] as const;

const DEFAULT_REPORT_SCHEDULE_FORM: SalesReportScheduleForm = {
  dailyReportDayOffset: "0",
  dailyTime: "23:59",
  weeklyDay: "6",
  weeklyTime: "23:59",
  monthlyDay: "31",
  monthlyTime: "23:59",
  yearlyMonth: "12",
  yearlyDay: "31",
  yearlyTime: "23:59",
};

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clampInteger(value: string | number, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getReportWeeklyDatePickerValue(weekdayValue: string): string {
  const weekday = clampInteger(weekdayValue, 0, 6, 6);
  const date = new Date();
  date.setDate(date.getDate() + weekday - date.getDay());
  return formatDateInputValue(date);
}

function getReportMonthlyDatePickerValue(dayValue: string): string {
  const year = new Date().getFullYear();
  const day = clampInteger(dayValue, 1, 31, 31);
  return formatDateInputValue(new Date(year, 4, day));
}

function getReportYearlyDatePickerValue(monthValue: string, dayValue: string): string {
  const year = new Date().getFullYear();
  const month = clampInteger(monthValue, 1, 12, 12);
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const day = clampInteger(dayValue, 1, lastDayOfMonth, lastDayOfMonth);
  return formatDateInputValue(new Date(year, month - 1, day));
}

function formatFileTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function parseDateInputValue(value: string): Date | null {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDisplayDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getWeekRange(referenceDate: Date): { start: Date; end: Date } {
  const start = startOfDay(referenceDate);
  start.setDate(start.getDate() - start.getDay());

  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  return {
    start,
    end: endOfDay(end),
  };
}

function getMonthRange(year: number, month: number): { start: Date; end: Date } {
  return {
    start: startOfDay(new Date(year, month, 1)),
    end: endOfDay(new Date(year, month + 1, 0)),
  };
}

function getYearRange(year: number): { start: Date; end: Date } {
  return {
    start: startOfDay(new Date(year, 0, 1)),
    end: endOfDay(new Date(year, 11, 31)),
  };
}

function getDeletionYearOptions(): string[] {
  const currentYear = new Date().getFullYear();
  const years: string[] = [];

  for (let year = currentYear; year >= 2000; year -= 1) {
    years.push(String(year));
  }

  return years;
}

function getMonthLabel(monthValue: string): string {
  return ORDER_DELETION_MONTH_OPTIONS.find((month) => month.value === monthValue)?.label || "Selected month";
}

function getOrderDeletionRange(
  period: OrderDeletionPeriod,
  weeklyReferenceDate: Date,
  monthlyMonth: string,
  monthlyYear: string,
  yearlyYear: string,
  customStartDate: string,
  customEndDate: string,
): { start: Date; end: Date } | null {
  if (period === "weekly") {
    return getWeekRange(weeklyReferenceDate);
  }

  if (period === "monthly") {
    const parsedMonth = Number(monthlyMonth);
    const parsedYear = Number(monthlyYear);
    if (!Number.isInteger(parsedMonth) || parsedMonth < 0 || parsedMonth > 11 || !Number.isInteger(parsedYear)) {
      return null;
    }

    return getMonthRange(parsedYear, parsedMonth);
  }

  if (period === "yearly") {
    const parsedYear = Number(yearlyYear);
    if (!Number.isInteger(parsedYear)) {
      return null;
    }

    return getYearRange(parsedYear);
  }

  const parsedStart = parseDateInputValue(customStartDate);
  const parsedEnd = parseDateInputValue(customEndDate);
  if (!parsedStart || !parsedEnd) {
    return null;
  }

  const start = startOfDay(parsedStart);
  const end = endOfDay(parsedEnd);
  return end.getTime() >= start.getTime() ? { start, end } : null;
}

function getDownloadFileName(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") || "";
  const fileNameMatch =
    disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);

  if (!fileNameMatch?.[1]) {
    return fallback;
  }

  try {
    return decodeURIComponent(fileNameMatch[1].replace(/"/g, "").trim()) || fallback;
  } catch {
    return fileNameMatch[1].replace(/"/g, "").trim() || fallback;
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function fetchDatabaseExport(password: string, fallbackFileName: string) {
  const res = await apiRequest("POST", "/api/admin/export-database", { adminPassword: password });
  const blob = await res.blob();
  return {
    blob,
    fileName: getDownloadFileName(res, fallbackFileName),
  };
}

function getDatabaseImportPreview(databaseExport: unknown): DatabaseImportPreview {
  if (!databaseExport || typeof databaseExport !== "object" || Array.isArray(databaseExport)) {
    throw new Error("Choose a valid LWL database export JSON file");
  }

  const payload = databaseExport as {
    metadata?: {
      format?: unknown;
      exportedAt?: unknown;
      tableCounts?: unknown;
    };
    tables?: unknown;
  };

  if (payload.metadata?.format !== "lwl-database-export-v1") {
    throw new Error("This file is not a supported LWL database export");
  }

  let tableCounts: Record<string, number> = {};

  if (
    payload.metadata.tableCounts &&
    typeof payload.metadata.tableCounts === "object" &&
    !Array.isArray(payload.metadata.tableCounts)
  ) {
    tableCounts = Object.fromEntries(
      Object.entries(payload.metadata.tableCounts as Record<string, unknown>)
        .map(([tableName, count]) => [tableName, Number(count)] as const)
        .filter(([, count]) => Number.isFinite(count) && count >= 0),
    );
  } else if (payload.tables && typeof payload.tables === "object" && !Array.isArray(payload.tables)) {
    tableCounts = Object.fromEntries(
      Object.entries(payload.tables as Record<string, unknown>)
        .filter(([, rows]) => Array.isArray(rows))
        .map(([tableName, rows]) => [tableName, (rows as unknown[]).length]),
    );
  }

  return {
    exportedAt: typeof payload.metadata.exportedAt === "string" ? payload.metadata.exportedAt : null,
    tableCounts,
    totalRows: Object.values(tableCounts).reduce((sum, count) => sum + count, 0),
  };
}

function formatExportedDateTime(value: string | null): string {
  if (!value) return "Unknown";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDashboardClockPreview(date: Date, hour12: boolean): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12,
    timeZone: "Asia/Dubai",
  });
  const parts = formatter.formatToParts(date);

  if (!hour12) {
    return formatter.format(date);
  }

  const time = parts
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
  const period = parts.find((part) => part.type === "dayPeriod")?.value.toUpperCase();

  return period ? `${time} ${period}` : time;
}

function formatReportScheduleTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatReportScheduleDisplay(time: string): string {
  const parsed = parseReportScheduleTime(time);
  if (!parsed) return time;

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2020, 0, 1, parsed.hour, parsed.minute));
}

function parseReportScheduleTime(value: string): { hour: number; minute: number } | null {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

function settingsToReportScheduleForm(settings: SalesReportScheduleSettings): SalesReportScheduleForm {
  return {
    dailyReportDayOffset: String(settings.dailyReportDayOffset ?? 0),
    dailyTime: formatReportScheduleTime(settings.dailyHour, settings.dailyMinute),
    weeklyDay: String(settings.weeklyDay),
    weeklyTime: formatReportScheduleTime(settings.weeklyHour, settings.weeklyMinute),
    monthlyDay: String(settings.monthlyDay),
    monthlyTime: formatReportScheduleTime(settings.monthlyHour, settings.monthlyMinute),
    yearlyMonth: String(settings.yearlyMonth),
    yearlyDay: String(settings.yearlyDay),
    yearlyTime: formatReportScheduleTime(settings.yearlyHour, settings.yearlyMinute),
  };
}

function buildReportSchedulePayload(form: SalesReportScheduleForm) {
  const dailyTime = parseReportScheduleTime(form.dailyTime);
  const weeklyTime = parseReportScheduleTime(form.weeklyTime);
  const monthlyTime = parseReportScheduleTime(form.monthlyTime);
  const yearlyTime = parseReportScheduleTime(form.yearlyTime);
  if (!dailyTime || !weeklyTime || !monthlyTime || !yearlyTime) {
    throw new Error("Choose a valid report time");
  }

  return {
    dailyReportDayOffset: Number(form.dailyReportDayOffset),
    dailyHour: dailyTime.hour,
    dailyMinute: dailyTime.minute,
    weeklyDay: Number(form.weeklyDay),
    weeklyHour: weeklyTime.hour,
    weeklyMinute: weeklyTime.minute,
    monthlyDay: Number(form.monthlyDay),
    monthlyHour: monthlyTime.hour,
    monthlyMinute: monthlyTime.minute,
    yearlyMonth: Number(form.yearlyMonth),
    yearlyDay: Number(form.yearlyDay),
    yearlyHour: yearlyTime.hour,
    yearlyMinute: yearlyTime.minute,
  };
}

function formatReportScheduleSummary(form: SalesReportScheduleForm): string {
  const dailyDateLabel =
    DAILY_REPORT_DATE_OPTIONS.find((option) => option.value === form.dailyReportDayOffset)?.label ||
    "Same day sales";
  const weeklyLabel =
    REPORT_WEEKDAY_OPTIONS.find((option) => option.value === form.weeklyDay)?.label || "Saturday";
  const yearlyMonth =
    REPORT_MONTH_OPTIONS.find((option) => option.value === form.yearlyMonth)?.label || "December";

  return [
    `Daily ${dailyDateLabel} ${formatReportScheduleDisplay(form.dailyTime)}`,
    `Weekly ${weeklyLabel} ${formatReportScheduleDisplay(form.weeklyTime)}`,
    `Monthly day ${form.monthlyDay} ${formatReportScheduleDisplay(form.monthlyTime)}`,
    `Yearly ${yearlyMonth} ${form.yearlyDay} ${formatReportScheduleDisplay(form.yearlyTime)}`,
  ].join(" | ");
}

export default function AdminSettings() {
  const getStoredAdminDisplayName = () => {
    try {
      const storedUser = localStorage.getItem("user");
      if (!storedUser) return "";
      const parsedUser = JSON.parse(storedUser);
      if (parsedUser?.username !== "admin") return "";
      return String(parsedUser?.name || "").trim();
    } catch {
      return "";
    }
  };

  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showResetIncidentsDialog, setShowResetIncidentsDialog] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [incidentsPassword, setIncidentsPassword] = useState("");
  const [resetError, setResetError] = useState("");
  const [incidentsError, setIncidentsError] = useState("");
  const [resetSelections, setResetSelections] = useState<ResetSelections>(DEFAULT_RESET_SELECTIONS);
  const [showSendReportDialog, setShowSendReportDialog] = useState(false);
  const [reportPassword, setReportPassword] = useState("");
  const [reportError, setReportError] = useState("");
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('daily');
  const [reportScheduleForm, setReportScheduleForm] = useState<SalesReportScheduleForm>(DEFAULT_REPORT_SCHEDULE_FORM);
  const [reportSchedulePassword, setReportSchedulePassword] = useState("");
  const [reportScheduleError, setReportScheduleError] = useState("");
  const [showExportDatabaseDialog, setShowExportDatabaseDialog] = useState(false);
  const [exportDatabasePassword, setExportDatabasePassword] = useState("");
  const [exportDatabaseError, setExportDatabaseError] = useState("");
  const [showImportDatabaseDialog, setShowImportDatabaseDialog] = useState(false);
  const [importDatabasePassword, setImportDatabasePassword] = useState("");
  const [importDatabaseError, setImportDatabaseError] = useState("");
  const [importDatabaseFile, setImportDatabaseFile] = useState<File | null>(null);
  const [importDatabasePreview, setImportDatabasePreview] = useState<DatabaseImportPreview | null>(null);
  const [importDatabaseConfirmation, setImportDatabaseConfirmation] = useState("");
  const [showLockdownDialog, setShowLockdownDialog] = useState(false);
  const [pendingLockdownEnabled, setPendingLockdownEnabled] = useState(false);
  const [lockdownPassword, setLockdownPassword] = useState("");
  const [lockdownError, setLockdownError] = useState("");
  const [dashboardClockHour12, setDashboardClockHour12] = useState(DEFAULT_COMPANY_CONTACT.dashboardClockHour12);
  const [displaySettingsError, setDisplaySettingsError] = useState("");
  
  // Admin account states
  const [showEditAccountDialog, setShowEditAccountDialog] = useState(false);
  const [showChangePasswordDialog, setShowChangePasswordDialog] = useState(false);
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPin, setEditPin] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [accountError, setAccountError] = useState("");
  
  // OTP states
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpError, setOtpError] = useState("");
  
  // Visibility toggles for admin password/PIN display
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [showAdminPin, setShowAdminPin] = useState(false);
  
  // Logout all users state
  const [showLogoutAllDialog, setShowLogoutAllDialog] = useState(false);
  const [logoutAllPassword, setLogoutAllPassword] = useState("");
  const [logoutAllError, setLogoutAllError] = useState("");
  
  // Reset users to defaults state
  const [showResetUsersDialog, setShowResetUsersDialog] = useState(false);
  const [resetUsersPassword, setResetUsersPassword] = useState("");
  const [resetUsersError, setResetUsersError] = useState("");

  // Periodic order deletion state
  const [showPeriodicDeleteDialog, setShowPeriodicDeleteDialog] = useState(false);
  const [periodicDeletePassword, setPeriodicDeletePassword] = useState("");
  const [periodicDeleteError, setPeriodicDeleteError] = useState("");
  const [orderDeletionPeriod, setOrderDeletionPeriod] = useState<OrderDeletionPeriod>("weekly");
  const [weeklyDeleteReferenceDate, setWeeklyDeleteReferenceDate] = useState(() => new Date());
  const [monthlyDeleteMonth, setMonthlyDeleteMonth] = useState(() => String(new Date().getMonth()));
  const [monthlyDeleteYear, setMonthlyDeleteYear] = useState(() => String(new Date().getFullYear()));
  const [yearlyDeleteYear, setYearlyDeleteYear] = useState(() => String(new Date().getFullYear()));
  const [customDeleteStartDate, setCustomDeleteStartDate] = useState(() => {
    const now = new Date();
    return formatDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [customDeleteEndDate, setCustomDeleteEndDate] = useState(() => formatDateInputValue(new Date()));
  
  const { toast } = useToast();

  // Fetch admin account settings
  const { data: adminAccount } = useQuery<{ username: string; name: string; email: string; pin?: string; password?: string; hasPin: boolean }>({
    queryKey: ["/api/admin/account"],
  });
  const { data: lockdownStatus } = useQuery<AppLockdownStatus>({
    queryKey: ["/api/security/lockdown"],
    refetchInterval: 15000,
  });
  const { data: companyContactData } = useQuery<CompanyContactInfo>({
    queryKey: ["/api/company-contact"],
  });
  const { data: reportSchedule } = useQuery<SalesReportScheduleSettings>({
    queryKey: ["/api/admin/report-schedule"],
    enabled: false,
  });
  const companyContact = normalizeCompanyContactInfo(companyContactData);

  useEffect(() => {
    const storedAdminName = getStoredAdminDisplayName();
    const queriedName = String(adminAccount?.name || "").trim();
    const nextDisplayName =
      (queriedName && queriedName.toLowerCase() !== "admin" ? queriedName : "") ||
      storedAdminName ||
      queriedName ||
      adminAccount?.username ||
      "Administrator";

    setAdminDisplayName(nextDisplayName);
  }, [adminAccount?.name, adminAccount?.username]);

  useEffect(() => {
    setDashboardClockHour12(companyContact.dashboardClockHour12);
  }, [companyContact.dashboardClockHour12]);

  useEffect(() => {
    if (reportSchedule) {
      setReportScheduleForm(settingsToReportScheduleForm(reportSchedule));
    }
  }, [reportSchedule]);

  const resetAllMutation = useMutation({
    mutationFn: async ({
      password,
      selections,
    }: {
      password: string;
      selections: ResetSelections;
    }) => {
      const res = await apiRequest("POST", "/api/admin/reset-selected", {
        adminPassword: password,
        deleteOrders: selections.orders || selections.clients,
        deleteClients: selections.clients,
        deleteStaff: selections.staff,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/packing-workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff-members"] });
      
      setShowResetDialog(false);
      setAdminPassword("");
      setResetError("");
      setResetSelections(DEFAULT_RESET_SELECTIONS);
      
      toast({
        title: "Deletion Complete",
        description: data.message || "Selected system data has been deleted.",
      });
    },
    onError: (error: any) => {
      const message = String(error?.message || "");
      if (message.includes("Invalid")) {
        setResetError("Invalid admin password");
        return;
      }

      setResetError(message || "Failed to delete selected data");
    },
  });

  const resetIncidentsMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("POST", "/api/incidents/reset-all", { adminPassword: password });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      
      setShowResetIncidentsDialog(false);
      setIncidentsPassword("");
      setIncidentsError("");
      
      toast({
        title: "Incidents Reset Complete",
        description: "All incidents have been deleted.",
      });
    },
    onError: (error: any) => {
      setIncidentsError(error.message?.includes("Invalid") ? "Invalid admin password" : "Failed to reset incidents");
    },
  });

  const sendReportMutation = useMutation({
    mutationFn: async ({ password, period }: { password: string; period: ReportPeriod }) => {
      const res = await apiRequest("POST", "/api/admin/send-report", { adminPassword: password, period });
      return res.json();
    },
    onSuccess: (data) => {
      setShowSendReportDialog(false);
      setReportPassword("");
      setReportError("");
      toast({
        title: "Report Sent",
        description: data.message || "Sales report sent successfully!",
      });
    },
    onError: (error: any) => {
      setReportError(error.message?.includes("Invalid") ? "Invalid admin password" : "Failed to send report");
    },
  });

  const reportScheduleMutation = useMutation({
    mutationFn: async ({
      password,
      form,
    }: {
      password: string;
      form: SalesReportScheduleForm;
    }) => {
      const res = await apiRequest("PUT", "/api/admin/report-schedule", {
        adminPassword: password,
        ...buildReportSchedulePayload(form),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/report-schedule"] });
      if (data?.settings) {
        setReportScheduleForm(settingsToReportScheduleForm(data.settings));
      }
      setReportSchedulePassword("");
      setReportScheduleError("");
      toast({
        title: "Report Schedule Saved",
        description: "Automatic sales report schedule has been updated.",
      });
    },
    onError: (error: any) => {
      const message = extractApiErrorMessage(error, "Failed to update report schedule");
      setReportScheduleError(
        message.includes("Invalid admin password") || message.includes("Invalid")
          ? "Invalid admin password"
          : message,
      );
    },
  });

  const exportDatabaseMutation = useMutation({
    mutationFn: async (password: string) => {
      const fallbackFileName = `lwl-database-export-${formatFileTimestamp()}.json`;
      return fetchDatabaseExport(password, fallbackFileName);
    },
    onSuccess: ({ blob, fileName }) => {
      downloadBlob(blob, fileName);
      setShowExportDatabaseDialog(false);
      setExportDatabasePassword("");
      setExportDatabaseError("");
      toast({
        title: "Database Exported",
        description: "Saved system data has been downloaded.",
      });
    },
    onError: (error: any) => {
      const message = extractApiErrorMessage(error, "Failed to export database");
      setExportDatabaseError(
        message.includes("Admin password") || message.includes("Invalid admin password")
          ? "Invalid admin password"
          : message,
      );
    },
  });

  const importDatabaseMutation = useMutation({
    mutationFn: async ({ password, file }: { password: string; file: File }) => {
      const fileText = await file.text();
      const databaseExport = JSON.parse(fileText);
      getDatabaseImportPreview(databaseExport);

      const rollbackFileName = `lwl-database-before-import-${formatFileTimestamp()}.json`;
      const rollback = await fetchDatabaseExport(password, rollbackFileName);
      downloadBlob(rollback.blob, rollbackFileName);

      const res = await apiRequest("POST", "/api/admin/import-database", {
        adminPassword: password,
        databaseExport,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.clear();
      localStorage.removeItem("isLoggedIn");
      localStorage.removeItem("user");
      localStorage.removeItem("lastActivity");
      setShowImportDatabaseDialog(false);
      setImportDatabasePassword("");
      setImportDatabaseError("");
      setImportDatabaseFile(null);
      setImportDatabasePreview(null);
      setImportDatabaseConfirmation("");

      toast({
        title: "Database Imported",
        description: data?.message || "Database restored. Please log in with the restored admin account.",
      });

      window.setTimeout(() => {
        window.location.reload();
      }, 900);
    },
    onError: (error: any) => {
      const message = extractApiErrorMessage(error, "Failed to import database");
      setImportDatabaseError(
        message.includes("Admin password") || message.includes("Invalid admin password")
          ? "Invalid admin password"
          : message.includes("valid JSON")
            ? "The selected file is not valid JSON"
            : message,
      );
    },
  });

  const lockdownMutation = useMutation({
    mutationFn: async ({
      enabled,
      password,
    }: {
      enabled: boolean;
      password: string;
    }) => {
      const res = await apiRequest("PUT", "/api/admin/lockdown", {
        enabled,
        adminPassword: password,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/security/lockdown"] });
      window.dispatchEvent(new CustomEvent("app-lockdown-status-changed"));
      setShowLockdownDialog(false);
      setLockdownPassword("");
      setLockdownError("");

      toast({
        title: data?.status?.enabled ? "App Lockdown Active" : "App Lockdown Lifted",
        description: data?.message || "Admin security settings have been updated.",
      });
    },
    onError: (error: any) => {
      const message = extractApiErrorMessage(error, "Failed to update app lockdown");
      setLockdownError(
        message.includes("Admin password") || message.includes("Invalid admin password")
          ? "Invalid admin password"
          : message,
      );
    },
  });

  const displaySettingsMutation = useMutation({
    mutationFn: async ({
      clockHour12,
    }: {
      clockHour12: boolean;
    }) => {
      const res = await apiRequest("PUT", "/api/admin/display-settings", {
        dashboardClockHour12: clockHour12,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-contact"] });
      setDisplaySettingsError("");

      toast({
        title: "Display Settings Updated",
        description: "Dashboard clock format has been saved.",
      });
    },
    onError: (error: any) => {
      const message = extractApiErrorMessage(error, "Failed to update display settings");
      setDisplaySettingsError(message);
    },
  });

  const logoutAllMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("POST", "/api/admin/logout-all-users", { adminPassword: password });
      return res.json();
    },
    onSuccess: (data) => {
      setShowLogoutAllDialog(false);
      setLogoutAllPassword("");
      setLogoutAllError("");
      toast({
        title: "Users Logged Out",
        description: data.message || "All non-admin user sessions have been terminated.",
      });
    },
    onError: (error: any) => {
      setLogoutAllError(error.message?.includes("Invalid") ? "Invalid admin password" : "Failed to log out users");
    },
  });

  const resetUsersMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("POST", "/api/admin/reset-users", { adminPassword: password });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/packing-workers"] });
      
      setShowResetUsersDialog(false);
      setResetUsersPassword("");
      setResetUsersError("");
      
      toast({
        title: "Users Reset Complete",
        description: "All users have been reset to defaults: reception1, staff1, driver1.",
      });
    },
    onError: (error: any) => {
      setResetUsersError(error.message?.includes("Invalid") ? "Invalid admin password" : "Failed to reset users");
    },
  });

  const deleteOrdersByPeriodMutation = useMutation({
    mutationFn: async ({
      pin,
      period,
      startDate,
      endDate,
    }: {
      pin: string;
      period: OrderDeletionPeriod;
      startDate?: string;
      endDate?: string;
    }) => {
      const res = await apiRequest("POST", "/api/admin/orders/delete-by-period", {
        adminPin: pin,
        period,
        startDate,
        endDate,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });

      setShowPeriodicDeleteDialog(false);
      setPeriodicDeletePassword("");
      setPeriodicDeleteError("");

      toast({
        title: data.deleted > 0 ? "Orders Deleted" : "No Orders Deleted",
        description: data.message || "Periodic order deletion completed.",
      });
    },
    onError: (error: any) => {
      setPeriodicDeleteError(
        error.message?.includes("Invalid")
          ? "Invalid admin PIN"
          : error.message?.includes("valid")
            ? "Choose a valid date selection before deleting orders"
            : "Failed to delete orders",
      );
    },
  });

  const periodLabels: Record<ReportPeriod, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    yearly: 'Yearly'
  };

  const periodDescriptions: Record<ReportPeriod, string> = {
    daily: "Today's sales",
    weekly: "This week's sales (Sunday to today)",
    monthly: "This month's sales",
    yearly: "This year's sales"
  };

  const updateReportScheduleForm = (updates: Partial<SalesReportScheduleForm>) => {
    setReportScheduleForm((current) => ({ ...current, ...updates }));
    setReportScheduleError("");
  };

  const reportScheduleSummary = formatReportScheduleSummary(reportScheduleForm);
  const reportDailyDateLabel =
    DAILY_REPORT_DATE_OPTIONS.find((option) => option.value === reportScheduleForm.dailyReportDayOffset)?.label ||
    "Same day sales";
  const reportWeeklyDayLabel =
    REPORT_WEEKDAY_OPTIONS.find((option) => option.value === reportScheduleForm.weeklyDay)?.label || "Saturday";
  const reportYearlyMonthLabel =
    REPORT_MONTH_OPTIONS.find((option) => option.value === reportScheduleForm.yearlyMonth)?.label || "December";
  const reportMonthlyDateLabel = `Day ${reportScheduleForm.monthlyDay}`;
  const reportYearlyDateLabel = `${reportYearlyMonthLabel} ${reportScheduleForm.yearlyDay}`;
  const reportWeeklyDateValue = getReportWeeklyDatePickerValue(reportScheduleForm.weeklyDay);
  const reportMonthlyDateValue = getReportMonthlyDatePickerValue(reportScheduleForm.monthlyDay);
  const reportYearlyDateValue = getReportYearlyDatePickerValue(
    reportScheduleForm.yearlyMonth,
    reportScheduleForm.yearlyDay,
  );

  const renderReportTimePicker = (
    value: string,
    updateKey: SalesReportTimeField,
    testId: string,
  ) => (
    <AnalogClockPicker
      value={value}
      onChange={(time) =>
        updateReportScheduleForm({
          [updateKey]: time,
        } as Partial<SalesReportScheduleForm>)
      }
      testIdPrefix={`${testId}-`}
      floatingPlacement="container-center"
      floatingBoundarySelector="[data-clock-overlay-root]"
      triggerClassName="h-9 w-full justify-start gap-2 sm:w-36"
      disabled={reportScheduleMutation.isPending}
    />
  );

  const orderDeletionLabels: Record<OrderDeletionPeriod, string> = {
    weekly: "Weekly",
    monthly: "Monthly",
    yearly: "Yearly",
    custom: "Custom Range",
  };

  const orderDeletionDescriptions: Record<OrderDeletionPeriod, string> = {
    weekly: "Pick any day in the week you want to delete. The full Sunday to Saturday range will be used.",
    monthly: "Choose the exact month and year you want to delete.",
    yearly: "Choose the exact year you want to delete.",
    custom: "Delete orders entered within your chosen custom start and end dates.",
  };

  const deletionYearOptions = getDeletionYearOptions();

  const periodicDeletionRange = getOrderDeletionRange(
    orderDeletionPeriod,
    weeklyDeleteReferenceDate,
    monthlyDeleteMonth,
    monthlyDeleteYear,
    yearlyDeleteYear,
    customDeleteStartDate,
    customDeleteEndDate,
  );

  const effectiveResetSelections: ResetSelections = {
    orders: resetSelections.orders || resetSelections.clients,
    clients: resetSelections.clients,
    staff: resetSelections.staff,
  };

  const selectedResetSummary: string[] = [];
  if (effectiveResetSelections.orders) {
    selectedResetSummary.push(
      effectiveResetSelections.clients
        ? "All orders and linked billing records"
        : "All orders and their linked billing records",
    );
  }
  if (effectiveResetSelections.clients) {
    selectedResetSummary.push("All clients and any remaining client bills or transactions");
  }
  if (effectiveResetSelections.staff) {
    selectedResetSummary.push("All non-admin users, packing workers, and staff members");
  }

  const hasResetSelection = selectedResetSummary.length > 0;

  const handleResetAll = () => {
    if (!adminPassword.trim()) {
      setResetError("Please enter admin password");
      return;
    }

    if (!hasResetSelection) {
      setResetError("Tick at least one type of data to delete");
      return;
    }

    resetAllMutation.mutate({ password: adminPassword, selections: effectiveResetSelections });
  };

  const handleExportDatabase = () => {
    if (!exportDatabasePassword.trim()) {
      setExportDatabaseError("Please enter admin password");
      return;
    }

    exportDatabaseMutation.mutate(exportDatabasePassword);
  };

  const resetImportDatabaseDialogState = () => {
    setShowImportDatabaseDialog(false);
    setImportDatabasePassword("");
    setImportDatabaseError("");
    setImportDatabaseFile(null);
    setImportDatabasePreview(null);
    setImportDatabaseConfirmation("");
  };

  const handleImportDatabaseFileChange = async (file: File | null) => {
    setImportDatabaseFile(file);
    setImportDatabasePreview(null);
    setImportDatabaseError("");

    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text());
      setImportDatabasePreview(getDatabaseImportPreview(parsed));
    } catch (error) {
      setImportDatabaseFile(null);
      setImportDatabaseError(
        error instanceof Error ? error.message : "Choose a valid LWL database export JSON file",
      );
    }
  };

  const handleImportDatabase = () => {
    if (!importDatabaseFile) {
      setImportDatabaseError("Choose a database export file");
      return;
    }

    if (!importDatabasePassword.trim()) {
      setImportDatabaseError("Please enter admin password");
      return;
    }

    if (importDatabaseConfirmation.trim().toUpperCase() !== "IMPORT") {
      setImportDatabaseError("Type IMPORT to confirm this restore");
      return;
    }

    importDatabaseMutation.mutate({
      password: importDatabasePassword,
      file: importDatabaseFile,
    });
  };

  const openLockdownDialog = (enabled: boolean) => {
    setPendingLockdownEnabled(enabled);
    setLockdownPassword("");
    setLockdownError("");
    setShowLockdownDialog(true);
  };

  const handleLockdownToggle = () => {
    if (!lockdownPassword.trim()) {
      setLockdownError("Please enter admin password");
      return;
    }

    lockdownMutation.mutate({
      enabled: pendingLockdownEnabled,
      password: lockdownPassword,
    });
  };

  const resetResetDialogState = () => {
    setShowResetDialog(false);
    setAdminPassword("");
    setResetError("");
    setResetSelections(DEFAULT_RESET_SELECTIONS);
  };

  const handleResetSelectionChange = (key: ResetSelectionKey, checked: boolean) => {
    setResetSelections((current) => ({
      ...current,
      [key]: checked,
    }));
    setResetError("");
  };

  const resetPeriodicDeleteState = () => {
    const now = new Date();
    setShowPeriodicDeleteDialog(false);
    setPeriodicDeletePassword("");
    setPeriodicDeleteError("");
    setOrderDeletionPeriod("weekly");
    setWeeklyDeleteReferenceDate(now);
    setMonthlyDeleteMonth(String(now.getMonth()));
    setMonthlyDeleteYear(String(now.getFullYear()));
    setYearlyDeleteYear(String(now.getFullYear()));
    setCustomDeleteStartDate(formatDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)));
    setCustomDeleteEndDate(formatDateInputValue(now));
  };

  const handleConfirmPeriodicDelete = () => {
    if (!periodicDeletePassword.trim()) {
      setPeriodicDeleteError("Please enter admin PIN");
      return;
    }

    if (!periodicDeletionRange) {
      setPeriodicDeleteError("Choose a valid date range before deleting orders");
      return;
    }

    deleteOrdersByPeriodMutation.mutate({
      pin: periodicDeletePassword,
      period: orderDeletionPeriod,
      startDate: formatDateInputValue(periodicDeletionRange.start),
      endDate: formatDateInputValue(periodicDeletionRange.end),
    });
  };

  // Update admin account mutation
  const updateAccountMutation = useMutation({
    mutationFn: async (data: { currentPassword: string; name: string; email: string; pin: string }) => {
      const res = await apiRequest("PUT", "/api/admin/account", data);
      return res.json();
    },
    onSuccess: (data, variables) => {
      setAdminDisplayName(variables.name.trim());
      queryClient.setQueryData(
        ["/api/admin/account"],
        (current:
          | { username: string; name: string; email: string; pin: string; password: string; hasPin: boolean }
          | undefined) => ({
          username: data?.settings?.username || current?.username || "admin",
          name: data?.settings?.name || variables.name.trim(),
          email: data?.settings?.email ?? variables.email,
          pin: variables.pin ? variables.pin : (current?.pin || ""),
          password: current?.password || "",
          hasPin: variables.pin ? true : (data?.settings?.hasPin ?? current?.hasPin ?? false),
        }),
      );
      queryClient.invalidateQueries({ queryKey: ["/api/admin/account"] });
      const storedUser = localStorage.getItem("user");
      if (storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser);
          if (parsedUser?.username === "admin") {
            localStorage.setItem("user", JSON.stringify({ ...parsedUser, name: variables.name.trim() }));
          }
        } catch {
          // Ignore malformed local session data.
        }
      }
      setShowEditAccountDialog(false);
      setEditName("");
      setEditPassword("");
      setAccountError("");
      toast({
        title: "Account Updated",
        description: "Admin account settings have been updated.",
      });
    },
    onError: (error: any) => {
      setAccountError(error.message?.includes("Invalid") ? "Invalid admin password" : "Failed to update account");
    },
  });

  // Send OTP mutation
  const sendOtpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/send-password-otp", {});
      return res.json();
    },
    onSuccess: (data) => {
      setOtpSent(true);
      if (data.previewCode) {
        setOtpCode(data.previewCode);
      }
      toast({
        title: "OTP Sent",
        description: data.previewCode
          ? `Development OTP code: ${data.previewCode}`
          : data.message || "Check your email for the verification code.",
      });
    },
    onError: (error: any) => {
      setOtpError(error.message || "Failed to send OTP. Please try again.");
    },
  });

  // Change password with OTP mutation
  const changePasswordMutation = useMutation({
    mutationFn: async (data: { otp: string; newPassword: string }) => {
      const res = await apiRequest("POST", "/api/admin/change-password-with-otp", data);
      return res.json();
    },
    onSuccess: () => {
      setShowChangePasswordDialog(false);
      setOtpSent(false);
      setOtpCode("");
      setNewPassword("");
      setConfirmPassword("");
      setOtpError("");
      toast({
        title: "Password Changed",
        description: "Your admin password has been updated successfully.",
      });
    },
    onError: (error: any) => {
      setOtpError(error.message?.includes("Invalid") ? "Invalid OTP code" : error.message?.includes("expired") ? "OTP has expired" : "Failed to change password");
    },
  });

  const handleEditAccountOpen = () => {
    if (adminAccount) {
      setEditName(adminDisplayName || adminAccount.name || adminAccount.username || "admin");
      setEditEmail(adminAccount.email);
      setEditPin("");
      setEditPassword("");
      setAccountError("");
    }
    setShowEditAccountDialog(true);
  };

  const handleChangePasswordOpen = () => {
    setOtpSent(false);
    setOtpCode("");
    setNewPassword("");
    setConfirmPassword("");
    setOtpError("");
    setShowChangePasswordDialog(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card px-4 py-4 lg:px-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Settings className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl lg:text-2xl font-bold text-foreground">Admin Settings</h1>
            <p className="text-sm text-muted-foreground">System administration and data management</p>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-4 py-6 lg:py-8 max-w-4xl">
        {/* Admin Account Section */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <Shield className="w-5 h-5" />
              Admin Account
            </CardTitle>
            <CardDescription>
              View your assigned business administrator account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Account Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-lg bg-muted/50">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Display Name</p>
                  <p className="font-medium flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    {adminDisplayName || adminAccount?.name || adminAccount?.username || "Administrator"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Username</p>
                  <p className="font-medium flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    {adminAccount?.username || "admin"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Email</p>
                  <p className="font-medium flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    {adminAccount?.email || "idusma0010@gmail.com"}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                <p className="font-semibold text-foreground">Managed by the super administrator</p>
                <p className="mt-1 text-muted-foreground">Username, password, and SMTP settings can only be changed from the platform-owner dashboard.</p>
              </div>

              {/* Action Buttons */}
              <div className="hidden flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleEditAccountOpen}
                  data-testid="button-edit-admin-account"
                >
                  <Pencil className="w-4 h-4" />
                  Edit Account Details
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleChangePasswordOpen}
                  data-testid="button-change-admin-password"
                >
                  <Lock className="w-4 h-4" />
                  Change Password (OTP)
                </Button>
              </div>
            </div>

            {/* Edit Account Dialog */}
            <Dialog open={showEditAccountDialog} onOpenChange={(open) => {
              setShowEditAccountDialog(open);
              if (!open) {
                setEditPassword("");
                setAccountError("");
              }
            }}>
              <DialogContent aria-describedby={undefined} className="max-w-md max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Pencil className="w-5 h-5 text-primary" />
                    Edit Admin Account
                  </DialogTitle>
                  <DialogDescription>
                    Update your admin account details. Enter your current password to confirm changes.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="fixed-username">Username</Label>
                    <Input
                      id="fixed-username"
                      value={adminAccount?.username || "admin"}
                      disabled
                      className="bg-muted"
                      data-testid="input-fixed-admin-username"
                    />
                    <p className="text-xs text-muted-foreground">
                      The admin username is fixed and cannot be changed.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-name">Display Name</Label>
                    <Input
                      id="edit-name"
                      placeholder="Enter admin display name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      data-testid="input-edit-admin-name"
                    />
                    <p className="text-xs text-muted-foreground">
                      This is the real name shown for the admin, such as Mark.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-email">Email</Label>
                    <Input
                      id="edit-email"
                      type="email"
                      placeholder="Enter email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      data-testid="input-edit-admin-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-pin">PIN (5 digits)</Label>
                    <Input
                      id="edit-pin"
                      type="password"
                      maxLength={5}
                      placeholder="Enter new PIN or leave empty"
                      value={editPin}
                      onChange={(e) => setEditPin(e.target.value.replace(/\D/g, "").slice(0, 5))}
                      data-testid="input-edit-admin-pin"
                    />
                  </div>
                  <div className="space-y-2 pt-2 border-t">
                    <Label htmlFor="edit-password">Current Password (required)</Label>
                    <Input
                      id="edit-password"
                      type="password"
                      placeholder="Enter current admin password"
                      value={editPassword}
                      onChange={(e) => {
                        setEditPassword(e.target.value);
                        setAccountError("");
                      }}
                      data-testid="input-current-admin-password"
                    />
                    {accountError && (
                      <p className="text-sm text-destructive">{accountError}</p>
                    )}
                  </div>
                </div>
                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowEditAccountDialog(false);
                      setEditPassword("");
                      setAccountError("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => updateAccountMutation.mutate({
                      currentPassword: editPassword,
                      name: editName,
                      email: editEmail,
                      pin: editPin
                    })}
                    disabled={!editPassword || !editName.trim() || updateAccountMutation.isPending}
                    data-testid="button-save-admin-account"
                  >
                    {updateAccountMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4 mr-2" />
                    )}
                    Save Changes
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Change Password via OTP Dialog */}
            <Dialog open={showChangePasswordDialog} onOpenChange={(open) => {
              setShowChangePasswordDialog(open);
              if (!open) {
                setOtpSent(false);
                setOtpCode("");
                setNewPassword("");
                setConfirmPassword("");
                setOtpError("");
              }
            }}>
              <DialogContent aria-describedby={undefined} className="max-w-md max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Lock className="w-5 h-5 text-primary" />
                    Change Admin Password
                  </DialogTitle>
                  <DialogDescription>
                    {!otpSent 
                      ? "We'll send a verification code to your registered email address."
                      : "Enter the OTP code sent to your email and set your new password."}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {!otpSent ? (
                    <div className="text-center py-4">
                      <Mail className="w-12 h-12 mx-auto text-primary mb-4" />
                      <p className="text-sm text-muted-foreground mb-4">
                        Click below to send a one-time password to<br />
                        <span className="font-medium">{adminAccount?.email || "idusma0010@gmail.com"}</span>
                      </p>
                      <Button
                        onClick={() => sendOtpMutation.mutate()}
                        disabled={sendOtpMutation.isPending}
                        data-testid="button-send-otp"
                      >
                        {sendOtpMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4 mr-2" />
                        )}
                        Send OTP
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="otp-code">OTP Code</Label>
                        <Input
                          id="otp-code"
                          placeholder="Enter 6-digit OTP"
                          maxLength={6}
                          value={otpCode}
                          onChange={(e) => {
                            setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                            setOtpError("");
                          }}
                          data-testid="input-otp-code"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-password">New Password</Label>
                        <Input
                          id="new-password"
                          type="password"
                          placeholder="Enter new password (min 6 characters)"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          data-testid="input-new-admin-password"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="confirm-password">Confirm Password</Label>
                        <Input
                          id="confirm-password"
                          type="password"
                          placeholder="Confirm new password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          data-testid="input-confirm-admin-password"
                        />
                      </div>
                      {otpError && (
                        <p className="text-sm text-destructive">{otpError}</p>
                      )}
                      {newPassword && confirmPassword && newPassword !== confirmPassword && (
                        <p className="text-sm text-destructive">Passwords do not match</p>
                      )}
                    </>
                  )}
                </div>
                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowChangePasswordDialog(false);
                      setOtpSent(false);
                      setOtpCode("");
                      setNewPassword("");
                      setConfirmPassword("");
                      setOtpError("");
                    }}
                  >
                    Cancel
                  </Button>
                  {otpSent && (
                    <Button
                      onClick={() => changePasswordMutation.mutate({ otp: otpCode, newPassword })}
                      disabled={
                        !otpCode || 
                        otpCode.length !== 6 || 
                        !newPassword || 
                        newPassword.length < 6 || 
                        newPassword !== confirmPassword ||
                        changePasswordMutation.isPending
                      }
                      data-testid="button-verify-otp-change-password"
                    >
                      {changePasswordMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4 mr-2" />
                      )}
                      Change Password
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <Clock className="w-5 h-5" />
              Display Settings
            </CardTitle>
            <CardDescription>
              Control how shared dashboard information appears across the app.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4 rounded-md border bg-background px-3 py-3">
                  <div>
                    <Label htmlFor="dashboard-clock-format" className="text-sm font-medium">
                      Military Time
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Toggle off for AM/PM time.
                    </p>
                  </div>
                  <Switch
                    id="dashboard-clock-format"
                    checked={!dashboardClockHour12}
                    onCheckedChange={(checked) => {
                      const nextHour12 = !checked;
                      setDashboardClockHour12(nextHour12);
                      setDisplaySettingsError("");
                      displaySettingsMutation.mutate({ clockHour12: nextHour12 });
                    }}
                    disabled={displaySettingsMutation.isPending}
                    data-testid="switch-dashboard-clock-format"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Current preview:{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {formatDashboardClockPreview(new Date(), dashboardClockHour12)}
                  </span>
                </p>
              </div>
            </div>
            {displaySettingsError && (
              <p className="mt-2 text-sm text-destructive">{displaySettingsError}</p>
            )}
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <Shield className="w-5 h-5" />
              Database and Security
            </CardTitle>
            <CardDescription>
              Admin data transfer and emergency security controls.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="mb-3">
                <p className="text-sm font-semibold">Data Import and Export</p>
                <p className="text-xs text-muted-foreground">
                  Export or restore saved system data, account records, settings, and transaction history as a portable JSON backup.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
              <Dialog open={showExportDatabaseDialog} onOpenChange={(open) => {
                setShowExportDatabaseDialog(open);
                if (!open) {
                  setExportDatabasePassword("");
                  setExportDatabaseError("");
                }
              }}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto gap-2"
                    data-testid="button-export-database"
                  >
                    <Download className="w-5 h-5" />
                    Export Database
                  </Button>
                </DialogTrigger>
                <DialogContent aria-describedby={undefined} className="max-w-md max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Database className="w-5 h-5 text-primary" />
                      Export Database
                    </DialogTitle>
                    <DialogDescription>
                      Download a backup file containing all saved app data. Enter the admin password to confirm the export.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="export-database-password">Admin Password</Label>
                      <Input
                        id="export-database-password"
                        type="password"
                        placeholder="Enter admin password..."
                        value={exportDatabasePassword}
                        onChange={(e) => {
                          setExportDatabasePassword(e.target.value);
                          setExportDatabaseError("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !exportDatabaseMutation.isPending) {
                            handleExportDatabase();
                          }
                        }}
                        data-testid="input-export-database-password"
                      />
                      {exportDatabaseError && (
                        <p className="text-sm text-destructive">{exportDatabaseError}</p>
                      )}
                    </div>
                  </div>
                  <DialogFooter className="gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowExportDatabaseDialog(false);
                        setExportDatabasePassword("");
                        setExportDatabaseError("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleExportDatabase}
                      disabled={!exportDatabasePassword || exportDatabaseMutation.isPending}
                      data-testid="button-confirm-export-database"
                    >
                      {exportDatabaseMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4 mr-2" />
                      )}
                      Export Database
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={showImportDatabaseDialog} onOpenChange={(open) => {
                setShowImportDatabaseDialog(open);
                if (!open) {
                  resetImportDatabaseDialogState();
                }
              }}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto gap-2 border-amber-600 text-amber-700 hover:bg-amber-50 dark:border-amber-400 dark:text-amber-300 dark:hover:bg-amber-950"
                    data-testid="button-import-database"
                  >
                    <Upload className="w-5 h-5" />
                    Import Database
                  </Button>
                </DialogTrigger>
                <DialogContent aria-describedby={undefined} className="max-w-md max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                      <Upload className="w-5 h-5" />
                      Import Database
                    </DialogTitle>
                    <DialogDescription>
                      Restore a saved LWL backup file. The current database will download first as a rollback backup, then the selected file will replace the live database.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                      <div className="flex gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <p>
                          Import replaces products, clients, bills, orders, users, settings, and history with the selected backup.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="import-database-file">Backup File</Label>
                      <Input
                        id="import-database-file"
                        type="file"
                        accept=".json,application/json"
                        onChange={(e) => {
                          void handleImportDatabaseFileChange(e.currentTarget.files?.[0] || null);
                        }}
                        data-testid="input-import-database-file"
                      />
                    </div>

                    {importDatabasePreview && (
                      <div className="rounded-md border bg-muted/40 p-3 text-sm">
                        <p className="font-medium">Backup Ready</p>
                        <p className="text-muted-foreground">
                          Exported {formatExportedDateTime(importDatabasePreview!.exportedAt)}
                        </p>
                        <p className="text-muted-foreground">
                          {importDatabasePreview!.totalRows.toLocaleString()} row(s) across {Object.keys(importDatabasePreview!.tableCounts).length} table(s)
                        </p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="import-database-password">Admin Password</Label>
                      <Input
                        id="import-database-password"
                        type="password"
                        placeholder="Enter admin password..."
                        value={importDatabasePassword}
                        onChange={(e) => {
                          setImportDatabasePassword(e.target.value);
                          setImportDatabaseError("");
                        }}
                        data-testid="input-import-database-password"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="import-database-confirmation">Type IMPORT to Confirm</Label>
                      <Input
                        id="import-database-confirmation"
                        value={importDatabaseConfirmation}
                        onChange={(e) => {
                          setImportDatabaseConfirmation(e.target.value);
                          setImportDatabaseError("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !importDatabaseMutation.isPending) {
                            handleImportDatabase();
                          }
                        }}
                        data-testid="input-import-database-confirmation"
                      />
                    </div>

                    {importDatabaseError && (
                      <p className="text-sm text-destructive">{importDatabaseError}</p>
                    )}
                  </div>
                  <DialogFooter className="gap-2">
                    <Button
                      variant="outline"
                      onClick={resetImportDatabaseDialogState}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleImportDatabase}
                      disabled={
                        !importDatabaseFile ||
                        !importDatabasePassword ||
                        importDatabaseConfirmation.trim().toUpperCase() !== "IMPORT" ||
                        importDatabaseMutation.isPending
                      }
                      data-testid="button-confirm-import-database"
                    >
                      {importDatabaseMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4 mr-2" />
                      )}
                      Import Database
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            </div>

            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
                    <Lock className="h-4 w-4" />
                    App Lockdown
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    When active, regular users see the lockdown page and normal API access is blocked until the admin lifts it.
                  </p>
                  {lockdownStatus?.enabled && lockdownStatus?.lockedAt && (
                    <p className="mt-2 text-xs font-medium text-destructive">
                      Active since {formatExportedDateTime(lockdownStatus?.lockedAt || null)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">
                    {lockdownStatus?.enabled ? "Locked" : "Unlocked"}
                  </span>
                  <Switch
                    checked={!!lockdownStatus?.enabled}
                    onCheckedChange={openLockdownDialog}
                    disabled={lockdownMutation.isPending}
                    data-testid="switch-app-lockdown"
                  />
                </div>
              </div>

              <Dialog open={showLockdownDialog} onOpenChange={(open) => {
                setShowLockdownDialog(open);
                if (!open) {
                  setLockdownPassword("");
                  setLockdownError("");
                }
              }}>
                <DialogContent aria-describedby={undefined} className="max-w-md max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-destructive">
                      <Shield className="w-5 h-5" />
                      {pendingLockdownEnabled ? "Enable App Lockdown" : "Lift App Lockdown"}
                    </DialogTitle>
                    <DialogDescription>
                      {pendingLockdownEnabled
                        ? "This will replace the login screen with the security lockdown page for all non-admin users."
                        : "This will restore the normal login screen and app access."}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="lockdown-admin-password">Admin Password</Label>
                      <Input
                        id="lockdown-admin-password"
                        type="password"
                        placeholder="Enter admin password..."
                        value={lockdownPassword}
                        onChange={(e) => {
                          setLockdownPassword(e.target.value);
                          setLockdownError("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !lockdownMutation.isPending) {
                            handleLockdownToggle();
                          }
                        }}
                        data-testid="input-lockdown-admin-password"
                      />
                      {lockdownError && (
                        <p className="text-sm text-destructive">{lockdownError}</p>
                      )}
                    </div>
                  </div>
                  <DialogFooter className="gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowLockdownDialog(false);
                        setLockdownPassword("");
                        setLockdownError("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant={pendingLockdownEnabled ? "destructive" : "default"}
                      onClick={handleLockdownToggle}
                      disabled={!lockdownPassword || lockdownMutation.isPending}
                      data-testid="button-confirm-app-lockdown"
                    >
                      {lockdownMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Shield className="w-4 h-4 mr-2" />
                      )}
                      {pendingLockdownEnabled ? "Enable Lockdown" : "Lift Lockdown"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              System Reset
            </CardTitle>
            <CardDescription>
              Reset all system data including orders, bills, clients, transactions, dues, and inventory stock.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Dialog open={showResetUsersDialog} onOpenChange={(open) => {
                setShowResetUsersDialog(open);
                if (!open) {
                  setResetUsersPassword("");
                  setResetUsersError("");
                }
              }}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto gap-2 border-orange-500 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                    data-testid="button-reset-users"
                  >
                    <RotateCcw className="w-5 h-5" />
                    Reset Default Users
                  </Button>
                </DialogTrigger>
                <DialogContent aria-describedby={undefined} className="max-w-md max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-orange-600">
                      <RotateCcw className="w-5 h-5" />
                      Reset Users to Defaults
                    </DialogTitle>
                    <DialogDescription>
                      This will reset all user accounts to defaults:
                      <ul className="list-disc list-inside mt-2 space-y-1">
                        <li>reception1 (PIN: 11111)</li>
                        <li>staff1 (PIN: 22222)</li>
                        <li>driver1 (PIN: 33333)</li>
                      </ul>
                      <p className="mt-3 text-muted-foreground">Admin account will be preserved.</p>
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="reset-users-password">Admin Password</Label>
                      <Input
                        id="reset-users-password"
                        type="password"
                        placeholder="Enter admin password..."
                        value={resetUsersPassword}
                        onChange={(e) => {
                          setResetUsersPassword(e.target.value);
                          setResetUsersError("");
                        }}
                        data-testid="input-reset-users-password"
                      />
                      {resetUsersError && (
                        <p className="text-sm text-destructive">{resetUsersError}</p>
                      )}
                    </div>
                  </div>
                  <DialogFooter className="gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowResetUsersDialog(false);
                        setResetUsersPassword("");
                        setResetUsersError("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="bg-orange-600 hover:bg-orange-700"
                      onClick={() => resetUsersMutation.mutate(resetUsersPassword)}
                      disabled={!resetUsersPassword || resetUsersMutation.isPending}
                      data-testid="button-confirm-reset-users"
                    >
                      {resetUsersMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <RotateCcw className="w-4 h-4 mr-2" />
                      )}
                      Reset Users
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={showResetDialog} onOpenChange={(open) => {
                setShowResetDialog(open);
                if (!open) {
                  setAdminPassword("");
                  setResetError("");
                  setResetSelections(DEFAULT_RESET_SELECTIONS);
                }
              }}>
                <DialogTrigger asChild>
                  <Button
                    variant="destructive"
                    className="w-full sm:w-auto gap-2"
                    data-testid="button-reset-all"
                  >
                    <Trash2 className="w-5 h-5" />
                    Reset All Data
                  </Button>
                </DialogTrigger>
              <DialogContent aria-describedby={undefined} className="max-w-md max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="w-5 h-5" />
                    Delete System Data
                  </DialogTitle>
                  <DialogDescription>
                    Tick the data you want to delete from the system. Deleting clients will also delete their orders. This action cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Delete List</Label>
                    <div className="space-y-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                      <label
                        className="flex items-start gap-3 rounded-md border border-transparent p-2 transition-colors hover:border-destructive/20"
                        htmlFor="delete-orders"
                      >
                        <Checkbox
                          id="delete-orders"
                          checked={effectiveResetSelections.orders}
                          disabled={resetSelections.clients}
                          onCheckedChange={(checked) => handleResetSelectionChange("orders", checked === true)}
                          data-testid="checkbox-delete-orders"
                        />
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">Delete all orders</p>
                          <p className="text-xs text-muted-foreground">
                            Removes all orders and their linked bill or payment records while keeping clients.
                          </p>
                          {resetSelections.clients && (
                            <p className="text-xs text-destructive">
                              Required because deleting clients also removes their orders.
                            </p>
                          )}
                        </div>
                      </label>
                      <label
                        className="flex items-start gap-3 rounded-md border border-transparent p-2 transition-colors hover:border-destructive/20"
                        htmlFor="delete-clients"
                      >
                        <Checkbox
                          id="delete-clients"
                          checked={resetSelections.clients}
                          onCheckedChange={(checked) => handleResetSelectionChange("clients", checked === true)}
                          data-testid="checkbox-delete-clients"
                        />
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">Delete all clients</p>
                          <p className="text-xs text-muted-foreground">
                            Removes all clients and also clears all orders, bills, and client transactions tied to them.
                          </p>
                        </div>
                      </label>
                      <label
                        className="flex items-start gap-3 rounded-md border border-transparent p-2 transition-colors hover:border-destructive/20"
                        htmlFor="delete-staff"
                      >
                        <Checkbox
                          id="delete-staff"
                          checked={resetSelections.staff}
                          onCheckedChange={(checked) => handleResetSelectionChange("staff", checked === true)}
                          data-testid="checkbox-delete-staff"
                        />
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">Delete all staff</p>
                          <p className="text-xs text-muted-foreground">
                            Removes all non-admin user accounts, packing workers, and staff member records. The admin account stays.
                          </p>
                        </div>
                      </label>
                    </div>
                    <div className="rounded-lg border border-destructive/20 bg-background p-3">
                      <p className="text-sm font-medium text-foreground">Selected for deletion</p>
                      <div className="mt-1 space-y-1">
                        {selectedResetSummary.length > 0 ? (
                          selectedResetSummary.map((item) => (
                            <p key={item} className="text-xs text-muted-foreground">
                              {item}
                            </p>
                          ))
                        ) : (
                          <p className="text-xs text-muted-foreground">Tick at least one item from the list above.</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="admin-password">Admin Password</Label>
                    <Input
                      id="admin-password"
                      type="password"
                      placeholder="Enter admin password..."
                      value={adminPassword}
                      onChange={(e) => {
                        setAdminPassword(e.target.value);
                        setResetError("");
                      }}
                      data-testid="input-admin-password"
                    />
                    {resetError && (
                      <p className="text-sm text-destructive">{resetError}</p>
                    )}
                  </div>
                </div>
                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    onClick={resetResetDialogState}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleResetAll}
                    disabled={!adminPassword || !hasResetSelection || resetAllMutation.isPending}
                    data-testid="button-confirm-reset"
                  >
                    {resetAllMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RotateCcw className="w-4 h-4 mr-2" />
                    )}
                    Delete Selected Data
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
          </CardContent>
        </Card>

        <Card className="hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <CalendarRange className="w-5 h-5" />
              Periodic Order Deletion
            </CardTitle>
            <CardDescription>
              Delete orders by weekly, monthly, yearly, or a custom entry-date range without resetting the whole system. Linked bills and related payment records are removed too.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Dialog
              open={showPeriodicDeleteDialog}
              onOpenChange={(open) => {
                if (open) {
                  setShowPeriodicDeleteDialog(true);
                  return;
                }

                resetPeriodicDeleteState();
              }}
            >
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto gap-2 border-amber-600 text-amber-600 hover:bg-amber-50 dark:border-amber-400 dark:text-amber-400 dark:hover:bg-amber-950"
                  data-testid="button-open-periodic-order-delete"
                >
                  <Trash2 className="w-5 h-5" />
                  Delete Orders By Period
                </Button>
              </DialogTrigger>
              <DialogContent aria-describedby={undefined} className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-destructive">
                    <Trash2 className="w-5 h-5" />
                    Periodic Order Deletion
                  </DialogTitle>
                  <DialogDescription>
                    Choose the deletion period. Orders are matched by entry date, and any linked bills, payments, and refunded credits will be cleaned up with them.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(["weekly", "monthly", "yearly", "custom"] as OrderDeletionPeriod[]).map((period) => (
                      <Button
                        key={period}
                        type="button"
                        variant={orderDeletionPeriod === period ? "default" : "outline"}
                        className="flex flex-col h-auto py-3 gap-1"
                        onClick={() => {
                          setOrderDeletionPeriod(period);
                          setPeriodicDeleteError("");
                        }}
                        data-testid={`button-order-delete-period-${period}`}
                      >
                        {period === "weekly" && <CalendarDays className="w-5 h-5" />}
                        {period === "monthly" && <CalendarRange className="w-5 h-5" />}
                        {period === "yearly" && <CalendarRange className="w-5 h-5" />}
                        {period === "custom" && <Calendar className="w-5 h-5" />}
                        <span className="text-sm font-semibold">{orderDeletionLabels[period]}</span>
                      </Button>
                    ))}
                  </div>

                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 space-y-2">
                    <p className="text-sm font-medium">{orderDeletionLabels[orderDeletionPeriod]} Deletion</p>
                    <p className="text-xs text-muted-foreground">
                      {orderDeletionDescriptions[orderDeletionPeriod]}
                    </p>
                    {periodicDeletionRange ? (
                      <p className="text-xs font-medium text-foreground">
                        Range: {formatDisplayDate(periodicDeletionRange.start)} to {formatDisplayDate(periodicDeletionRange.end)}
                      </p>
                    ) : (
                      <p className="text-xs font-medium text-destructive">
                        Enter a valid start and end date to continue.
                      </p>
                    )}
                  </div>

                  {orderDeletionPeriod === "weekly" && (
                    <div className="space-y-2">
                      <Label>Select Week</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full justify-start text-left font-normal"
                            data-testid="button-select-delete-week"
                          >
                            <CalendarDays className="w-4 h-4 mr-2" />
                            {formatDisplayDate(weeklyDeleteReferenceDate)}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <ShadcnCalendar
                            mode="single"
                            selected={weeklyDeleteReferenceDate}
                            onSelect={(date) => {
                              if (date) {
                                setWeeklyDeleteReferenceDate(date);
                                setPeriodicDeleteError("");
                              }
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <p className="text-xs text-muted-foreground">
                        Pick any day in the week you want to delete. The whole week will be deleted based on the range above.
                      </p>
                    </div>
                  )}

                  {orderDeletionPeriod === "monthly" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="select-delete-month">Month</Label>
                        <Select
                          value={monthlyDeleteMonth}
                          onValueChange={(value) => {
                            setMonthlyDeleteMonth(value);
                            setPeriodicDeleteError("");
                          }}
                        >
                          <SelectTrigger id="select-delete-month" data-testid="select-delete-month">
                            <SelectValue placeholder="Select month" />
                          </SelectTrigger>
                          <SelectContent>
                            {ORDER_DELETION_MONTH_OPTIONS.map((month) => (
                              <SelectItem key={month.value} value={month.value}>
                                {month.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="select-delete-month-year">Year</Label>
                        <Select
                          value={monthlyDeleteYear}
                          onValueChange={(value) => {
                            setMonthlyDeleteYear(value);
                            setPeriodicDeleteError("");
                          }}
                        >
                          <SelectTrigger id="select-delete-month-year" data-testid="select-delete-month-year">
                            <SelectValue placeholder="Select year" />
                          </SelectTrigger>
                          <SelectContent>
                            {deletionYearOptions.map((year) => (
                              <SelectItem key={`delete-month-year-${year}`} value={year}>
                                {year}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        Deleting all orders entered in {getMonthLabel(monthlyDeleteMonth)} {monthlyDeleteYear}.
                      </p>
                    </div>
                  )}

                  {orderDeletionPeriod === "yearly" && (
                    <div className="space-y-2">
                      <Label htmlFor="select-delete-year">Year</Label>
                      <Select
                        value={yearlyDeleteYear}
                        onValueChange={(value) => {
                          setYearlyDeleteYear(value);
                          setPeriodicDeleteError("");
                        }}
                      >
                        <SelectTrigger id="select-delete-year" data-testid="select-delete-year">
                          <SelectValue placeholder="Select year" />
                        </SelectTrigger>
                        <SelectContent>
                          {deletionYearOptions.map((year) => (
                            <SelectItem key={`delete-year-${year}`} value={year}>
                              {year}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Deleting all orders entered in the year {yearlyDeleteYear}.
                      </p>
                    </div>
                  )}

                  {orderDeletionPeriod === "custom" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="custom-delete-start-date">Start Date</Label>
                        <Input
                          id="custom-delete-start-date"
                          type="date"
                          value={customDeleteStartDate}
                          onChange={(e) => {
                            setCustomDeleteStartDate(e.target.value);
                            setPeriodicDeleteError("");
                          }}
                          data-testid="input-custom-delete-start-date"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="custom-delete-end-date">End Date</Label>
                        <Input
                          id="custom-delete-end-date"
                          type="date"
                          value={customDeleteEndDate}
                          onChange={(e) => {
                            setCustomDeleteEndDate(e.target.value);
                            setPeriodicDeleteError("");
                          }}
                          data-testid="input-custom-delete-end-date"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="periodic-delete-password">Admin PIN</Label>
                    <Input
                      id="periodic-delete-password"
                      type="password"
                      placeholder="Enter 5-digit admin PIN..."
                      value={periodicDeletePassword}
                      onChange={(e) => {
                        setPeriodicDeletePassword(e.target.value.replace(/\D/g, "").slice(0, 5));
                        setPeriodicDeleteError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !deleteOrdersByPeriodMutation.isPending) {
                          handleConfirmPeriodicDelete();
                        }
                      }}
                      data-testid="input-periodic-delete-password"
                    />
                    {periodicDeleteError && (
                      <p className="text-sm text-destructive">{periodicDeleteError}</p>
                    )}
                  </div>
                </div>

                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    onClick={resetPeriodicDeleteState}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleConfirmPeriodicDelete}
                    disabled={
                      !periodicDeletePassword ||
                      !periodicDeletionRange ||
                      deleteOrdersByPeriodMutation.isPending
                    }
                    data-testid="button-confirm-periodic-order-delete"
                  >
                    {deleteOrdersByPeriodMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-2" />
                    )}
                    Delete {orderDeletionLabels[orderDeletionPeriod]} Orders
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        <Card className="hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
              <Shield className="w-5 h-5" />
              Session Management
            </CardTitle>
            <CardDescription>
              Log out all active user sessions except the admin account. Users will need to log in again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Dialog open={showLogoutAllDialog} onOpenChange={(open) => {
              setShowLogoutAllDialog(open);
              if (!open) {
                setLogoutAllPassword("");
                setLogoutAllError("");
              }
            }}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto gap-2 border-orange-600 text-orange-600 hover:bg-orange-50 dark:border-orange-400 dark:text-orange-400 dark:hover:bg-orange-950"
                  data-testid="button-logout-all-users"
                >
                  <Lock className="w-5 h-5" />
                  Log Out All Users
                </Button>
              </DialogTrigger>
              <DialogContent aria-describedby={undefined} className="max-w-md max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-orange-600">
                    <Lock className="w-5 h-5" />
                    Log Out All User Sessions
                  </DialogTitle>
                  <DialogDescription>
                    This will terminate all active sessions for non-admin accounts. Users currently logged in will be logged out and need to sign in again.
                    <p className="mt-3 font-semibold">The admin account will not be affected.</p>
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="logout-all-password">Admin Password</Label>
                    <Input
                      id="logout-all-password"
                      type="password"
                      placeholder="Enter admin password..."
                      value={logoutAllPassword}
                      onChange={(e) => {
                        setLogoutAllPassword(e.target.value);
                        setLogoutAllError("");
                      }}
                      data-testid="input-logout-all-password"
                    />
                    {logoutAllError && (
                      <p className="text-sm text-destructive">{logoutAllError}</p>
                    )}
                  </div>
                </div>
                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowLogoutAllDialog(false);
                      setLogoutAllPassword("");
                      setLogoutAllError("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="bg-orange-600 hover:bg-orange-700 text-white"
                    onClick={() => logoutAllMutation.mutate(logoutAllPassword)}
                    disabled={!logoutAllPassword || logoutAllMutation.isPending}
                    data-testid="button-confirm-logout-all"
                  >
                    {logoutAllMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Lock className="w-4 h-4 mr-2" />
                    )}
                    Log Out All Users
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <Mail className="w-5 h-5" />
              Sales Reports
            </CardTitle>
            <CardDescription>
              Send sales reports to {adminAccount?.email || "admin email"}. Automatic schedule: {reportScheduleSummary} UAE time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-4" data-clock-overlay-root>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">Automatic Report Schedule</p>
                    <p className="text-xs text-muted-foreground">Set the date and time for each automatic report.</p>
                  </div>
                  {reportScheduleMutation.isPending && (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  )}
                </div>

                <div className="grid gap-2">
                  <div className="grid gap-3 rounded-md border bg-background p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      Daily
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9 w-full justify-start gap-2 sm:w-44"
                            disabled={reportScheduleMutation.isPending}
                          >
                            <Calendar className="w-4 h-4 shrink-0" />
                            {reportDailyDateLabel}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-60 p-3" align="end">
                          <div className="space-y-2">
                            <Label htmlFor="daily-report-date-mode">Report Date</Label>
                            <Select
                              value={reportScheduleForm.dailyReportDayOffset}
                              onValueChange={(value) => updateReportScheduleForm({ dailyReportDayOffset: value })}
                            >
                              <SelectTrigger id="daily-report-date-mode" data-testid="select-daily-report-date-mode">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {DAILY_REPORT_DATE_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                              Use Previous day sales when sending after midnight.
                            </p>
                          </div>
                        </PopoverContent>
                      </Popover>
                      {renderReportTimePicker(
                        reportScheduleForm.dailyTime,
                        "dailyTime",
                        "input-daily-report-time",
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-md border bg-background p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <CalendarDays className="w-4 h-4 text-muted-foreground" />
                      Weekly
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                      <div className="flex items-center gap-2 sm:w-40">
                        <CenteredDatePicker
                          value={reportWeeklyDateValue}
                          onChange={(dateValue) => {
                            const selectedDate = parseDateInputValue(dateValue);
                            if (!selectedDate) return;
                            updateReportScheduleForm({ weeklyDay: String(selectedDate.getDay()) });
                          }}
                          testIdPrefix="weekly-report-"
                          floatingBoundarySelector="[data-clock-overlay-root]"
                          triggerClassName="h-9 w-full justify-start gap-2 text-sm"
                          triggerTestId="select-weekly-report-day"
                          disabled={reportScheduleMutation.isPending}
                          displayLabel={reportWeeklyDayLabel}
                          hideQuickOptions
                        />
                      </div>
                      {renderReportTimePicker(
                        reportScheduleForm.weeklyTime,
                        "weeklyTime",
                        "input-weekly-report-time",
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-md border bg-background p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <CalendarRange className="w-4 h-4 text-muted-foreground" />
                      Monthly
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                      <div className="flex items-center gap-2 sm:w-36">
                        <CenteredDatePicker
                          value={reportMonthlyDateValue}
                          onChange={(dateValue) => {
                            const selectedDate = parseDateInputValue(dateValue);
                            if (!selectedDate) return;
                            updateReportScheduleForm({ monthlyDay: String(selectedDate.getDate()) });
                          }}
                          testIdPrefix="monthly-report-"
                          floatingBoundarySelector="[data-clock-overlay-root]"
                          triggerClassName="h-9 w-full justify-start gap-2 text-sm"
                          triggerTestId="select-monthly-report-day"
                          disabled={reportScheduleMutation.isPending}
                          displayLabel={reportMonthlyDateLabel}
                          hideQuickOptions
                        />
                      </div>
                      {renderReportTimePicker(
                        reportScheduleForm.monthlyTime,
                        "monthlyTime",
                        "input-monthly-report-time",
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-md border bg-background p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <CalendarRange className="w-4 h-4 text-muted-foreground" />
                      Yearly
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                      <div className="flex items-center gap-2 sm:w-44">
                        <CenteredDatePicker
                          value={reportYearlyDateValue}
                          onChange={(dateValue) => {
                            const selectedDate = parseDateInputValue(dateValue);
                            if (!selectedDate) return;
                            updateReportScheduleForm({
                              yearlyMonth: String(selectedDate.getMonth() + 1),
                              yearlyDay: String(selectedDate.getDate()),
                            });
                          }}
                          testIdPrefix="yearly-report-"
                          floatingBoundarySelector="[data-clock-overlay-root]"
                          triggerClassName="h-9 w-full justify-start gap-2 text-sm"
                          triggerTestId="select-yearly-report-day"
                          disabled={reportScheduleMutation.isPending}
                          displayLabel={reportYearlyDateLabel}
                          hideQuickOptions
                        />
                      </div>
                      {renderReportTimePicker(
                        reportScheduleForm.yearlyTime,
                        "yearlyTime",
                        "input-yearly-report-time",
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div className="space-y-2">
                    <Label htmlFor="report-schedule-password">Admin Password</Label>
                    <Input
                      id="report-schedule-password"
                      type="password"
                      placeholder="Enter admin password..."
                      value={reportSchedulePassword}
                      onChange={(event) => {
                        setReportSchedulePassword(event.target.value);
                        setReportScheduleError("");
                      }}
                      disabled={reportScheduleMutation.isPending}
                      data-testid="input-report-schedule-password"
                    />
                  </div>
                  <Button
                    className="gap-2"
                    onClick={() =>
                      reportScheduleMutation.mutate({
                        password: reportSchedulePassword,
                        form: reportScheduleForm,
                      })
                    }
                    disabled={!reportSchedulePassword || reportScheduleMutation.isPending}
                    data-testid="button-save-report-schedule"
                  >
                    {reportScheduleMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Clock className="w-4 h-4" />
                    )}
                    Save Schedule
                  </Button>
                </div>
                {reportScheduleError && (
                  <p className="text-sm text-destructive">{reportScheduleError}</p>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['daily', 'weekly', 'monthly', 'yearly'] as ReportPeriod[]).map((period) => (
                  <Button
                    key={period}
                    variant={reportPeriod === period ? "default" : "outline"}
                    className="flex flex-col h-auto py-3 gap-1"
                    onClick={() => setReportPeriod(period)}
                    data-testid={`button-period-${period}`}
                  >
                    {period === 'daily' && <Calendar className="w-5 h-5" />}
                    {period === 'weekly' && <CalendarDays className="w-5 h-5" />}
                    {period === 'monthly' && <CalendarRange className="w-5 h-5" />}
                    {period === 'yearly' && <CalendarRange className="w-5 h-5" />}
                    <span className="text-sm font-semibold">{periodLabels[period]}</span>
                  </Button>
                ))}
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center p-4 rounded-lg bg-muted/50">
                <div className="flex-1">
                  <p className="text-sm font-medium">{periodLabels[reportPeriod]} Report</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {periodDescriptions[reportPeriod]}
                  </p>
                </div>
                <Dialog open={showSendReportDialog} onOpenChange={(open) => {
                  setShowSendReportDialog(open);
                  if (!open) {
                    setReportPassword("");
                    setReportError("");
                  }
                }}>
                  <DialogTrigger asChild>
                    <Button
                      variant="default"
                      className="gap-2"
                      data-testid="button-send-report"
                    >
                      <Send className="w-4 h-4" />
                      Send {periodLabels[reportPeriod]} Report
                    </Button>
                  </DialogTrigger>
                  <DialogContent aria-describedby={undefined} className="max-w-md max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Mail className="w-5 h-5 text-primary" />
                        Send {periodLabels[reportPeriod]} Sales Report
                      </DialogTitle>
                      <DialogDescription>
                        This will send the {periodLabels[reportPeriod].toLowerCase()} sales report ({periodDescriptions[reportPeriod].toLowerCase()}) to {adminAccount?.email || "admin email"}. Enter the admin password to confirm.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="report-password">Admin Password</Label>
                        <Input
                          id="report-password"
                          type="password"
                          placeholder="Enter admin password..."
                          value={reportPassword}
                          onChange={(e) => {
                            setReportPassword(e.target.value);
                            setReportError("");
                          }}
                          data-testid="input-report-password"
                        />
                        {reportError && (
                          <p className="text-sm text-destructive">{reportError}</p>
                        )}
                      </div>
                    </div>
                    <DialogFooter className="gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowSendReportDialog(false);
                          setReportPassword("");
                          setReportError("");
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => sendReportMutation.mutate({ password: reportPassword, period: reportPeriod })}
                        disabled={!reportPassword || sendReportMutation.isPending}
                        data-testid="button-confirm-send-report"
                      >
                        {sendReportMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4 mr-2" />
                        )}
                        Send Report
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
