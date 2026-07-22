import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  CircleOff,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { apiRequest, extractApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type PlatformAccount = {
  id: number;
  username: string;
  name: string | null;
  email: string | null;
  role: string;
  active: boolean | null;
  businessId: number | null;
};

type ManagedBusiness = {
  id: number;
  name: string;
  slug: string;
  businessType: string;
  timezone: string;
  currency: string;
  active: boolean;
  contactEmail: string | null;
  phone: string | null;
  smtpConfigured: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUser: string | null;
  smtpFrom: string | null;
  smtpPasswordSet: boolean;
  createdAt: string;
  accountCount: number;
  administrator: PlatformAccount | null;
};

type PlatformOverview = {
  businesses: ManagedBusiness[];
  accounts: PlatformAccount[];
};

type ConsoleSection = "overview" | "tenants" | "accounts" | "email";
type TenantStatusFilter = "all" | "active" | "suspended";
type ManageTab = "profile" | "administrator" | "email";

const BUSINESS_TYPES = [
  { value: "laundry", label: "Laundry services" },
  { value: "dry-cleaning", label: "Dry cleaning" },
  { value: "textile-care", label: "Textile care" },
  { value: "other", label: "Other service business" },
];

const TIMEZONES = [
  "Asia/Dubai",
  "UTC",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Europe/London",
  "America/New_York",
];

const CURRENCIES = ["AED", "USD", "EUR", "GBP", "INR", "PKR"];

const ACCOUNT_ROLES = [
  { value: "admin", label: "Business administrator" },
  { value: "counter", label: "Counter" },
  { value: "reception", label: "Reception" },
  { value: "section", label: "Section staff" },
  { value: "driver", label: "Driver" },
];

const EMPTY_TENANT_FORM = {
  name: "",
  slug: "",
  businessType: "laundry",
  timezone: "Asia/Dubai",
  currency: "AED",
  contactEmail: "",
  phone: "",
  adminName: "",
  adminUsername: "",
  adminPassword: "",
};

const EMPTY_EDIT_FORM = {
  name: "",
  businessType: "laundry",
  timezone: "Asia/Dubai",
  currency: "AED",
  contactEmail: "",
  phone: "",
  adminName: "",
  adminUsername: "",
  adminPassword: "",
  smtpHost: "",
  smtpPort: "587",
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  smtpFrom: "",
};

const EMPTY_ACCOUNT_FORM = {
  businessId: "",
  name: "",
  username: "",
  email: "",
  role: "counter",
  password: "",
  active: true,
};

function toSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function formatLabel(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getSection(location: string): ConsoleSection {
  if (location.endsWith("/tenants")) return "tenants";
  if (location.endsWith("/accounts")) return "accounts";
  if (location.endsWith("/email")) return "email";
  return "overview";
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  helper,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  helper?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          className="h-11 pr-12"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="new-password"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-11 w-11"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof Building2;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-sm font-medium">{label}</p>
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SuperAdmin() {
  const [location, navigate] = useLocation();
  const section = getSection(location);
  const { toast } = useToast();
  const [tenantDialogOpen, setTenantDialogOpen] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [tenantForm, setTenantForm] = useState(EMPTY_TENANT_FORM);
  const [tenantFormError, setTenantFormError] = useState("");
  const [businessToEdit, setBusinessToEdit] = useState<ManagedBusiness | null>(null);
  const [manageTab, setManageTab] = useState<ManageTab>("profile");
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [editError, setEditError] = useState("");
  const [tenantSearch, setTenantSearch] = useState("");
  const [tenantStatus, setTenantStatus] = useState<TenantStatusFilter>("all");
  const [accountSearch, setAccountSearch] = useState("");
  const [accountTenantFilter, setAccountTenantFilter] = useState("all");
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [accountToEdit, setAccountToEdit] = useState<PlatformAccount | null>(null);
  const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT_FORM);
  const [accountError, setAccountError] = useState("");

  const { data, isLoading, error, refetch, isFetching } = useQuery<PlatformOverview>({
    queryKey: ["/api/super-admin/businesses"],
  });

  const businesses = data?.businesses || [];
  const accounts = data?.accounts || [];
  const tenantAccounts = accounts.filter((account) => account.businessId !== null);
  const businessNames = useMemo(
    () => new Map(businesses.map((business) => [business.id, business.name])),
    [businesses],
  );

  const filteredBusinesses = useMemo(() => {
    const query = tenantSearch.trim().toLowerCase();
    return businesses.filter((business) => {
      const statusMatches =
        tenantStatus === "all" ||
        (tenantStatus === "active" ? business.active : !business.active);
      const searchMatches =
        !query ||
        [
          business.name,
          business.slug,
          business.businessType,
          business.contactEmail || "",
          business.administrator?.username || "",
        ].some((value) => value.toLowerCase().includes(query));
      return statusMatches && searchMatches;
    });
  }, [businesses, tenantSearch, tenantStatus]);

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    return tenantAccounts.filter((account) => {
      const tenantMatches =
        accountTenantFilter === "all" ||
        account.businessId === Number(accountTenantFilter);
      const searchMatches =
        !query ||
        [account.name || "", account.username, account.email || "", account.role].some(
          (value) => value.toLowerCase().includes(query),
        );
      return tenantMatches && searchMatches;
    });
  }, [accountSearch, accountTenantFilter, tenantAccounts]);

  const createTenant = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/super-admin/businesses", tenantForm);
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/businesses"] });
      setTenantDialogOpen(false);
      setTenantForm(EMPTY_TENANT_FORM);
      setSlugTouched(false);
      setTenantFormError("");
      toast({ title: "Tenant created", description: result.message });
    },
    onError: (mutationError) => {
      setTenantFormError(extractApiErrorMessage(mutationError, "Failed to create the tenant"));
    },
  });

  const changeTenantStatus = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const response = await apiRequest(
        "PATCH",
        `/api/super-admin/businesses/${id}/status`,
        { active },
      );
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/businesses"] });
      toast({ title: "Tenant status updated", description: result.message });
    },
    onError: (mutationError) => {
      toast({
        title: "Status update failed",
        description: extractApiErrorMessage(mutationError),
        variant: "destructive",
      });
    },
  });

  const updateTenant = useMutation({
    mutationFn: async () => {
      if (!businessToEdit) throw new Error("Choose a tenant to update");
      const response = await apiRequest(
        "PUT",
        `/api/super-admin/businesses/${businessToEdit.id}`,
        {
          ...editForm,
          administratorId: businessToEdit.administrator?.id,
          smtpPort: Number(editForm.smtpPort),
        },
      );
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/businesses"] });
      setBusinessToEdit(null);
      setEditForm(EMPTY_EDIT_FORM);
      setEditError("");
      toast({ title: "Tenant updated", description: result.message });
    },
    onError: (mutationError) => {
      setEditError(extractApiErrorMessage(mutationError, "Failed to update the tenant"));
    },
  });

  const saveAccount = useMutation({
    mutationFn: async () => {
      if (accountToEdit) {
        const response = await apiRequest(
          "PUT",
          `/api/super-admin/accounts/${accountToEdit.id}`,
          {
            name: accountForm.name,
            username: accountForm.username,
            email: accountForm.email,
            role: accountForm.role,
            password: accountForm.password,
            active: accountForm.active,
          },
        );
        return response.json();
      }

      if (!accountForm.businessId) throw new Error("Choose a tenant");
      const response = await apiRequest(
        "POST",
        `/api/super-admin/businesses/${accountForm.businessId}/accounts`,
        {
          name: accountForm.name,
          username: accountForm.username,
          email: accountForm.email,
          role: accountForm.role,
          password: accountForm.password,
          active: accountForm.active,
        },
      );
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/businesses"] });
      closeAccountDialog();
      toast({ title: accountToEdit ? "Account updated" : "Account created", description: result.message });
    },
    onError: (mutationError) => {
      setAccountError(extractApiErrorMessage(mutationError, "Failed to save the account"));
    },
  });

  const updateTenantForm = (field: keyof typeof EMPTY_TENANT_FORM, value: string) => {
    setTenantFormError("");
    setTenantForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "name" && !slugTouched) next.slug = toSlug(value);
      return next;
    });
  };

  const updateEditForm = (
    field: keyof typeof EMPTY_EDIT_FORM,
    value: string | boolean,
  ) => {
    setEditError("");
    setEditForm((current) => ({ ...current, [field]: value }));
  };

  const openTenantEditor = (business: ManagedBusiness, tab: ManageTab = "profile") => {
    setBusinessToEdit(business);
    setManageTab(tab);
    setEditError("");
    setEditForm({
      name: business.name,
      businessType: business.businessType || "laundry",
      timezone: business.timezone || "Asia/Dubai",
      currency: business.currency || "AED",
      contactEmail: business.contactEmail || "",
      phone: business.phone || "",
      adminName: business.administrator?.name || "",
      adminUsername: business.administrator?.username || "",
      adminPassword: "",
      smtpHost: business.smtpHost || "",
      smtpPort: String(business.smtpPort || 587),
      smtpSecure: Boolean(business.smtpSecure),
      smtpUser: business.smtpUser || "",
      smtpPassword: "",
      smtpFrom: business.smtpFrom || "",
    });
  };

  const openNewAccountDialog = (businessId = "") => {
    setAccountToEdit(null);
    setAccountForm({ ...EMPTY_ACCOUNT_FORM, businessId });
    setAccountError("");
    setAccountDialogOpen(true);
  };

  const openAccountEditor = (account: PlatformAccount) => {
    setAccountToEdit(account);
    setAccountForm({
      businessId: String(account.businessId || ""),
      name: account.name || "",
      username: account.username,
      email: account.email || "",
      role: account.role,
      password: "",
      active: Boolean(account.active),
    });
    setAccountError("");
    setAccountDialogOpen(true);
  };

  const closeAccountDialog = () => {
    setAccountDialogOpen(false);
    setAccountToEdit(null);
    setAccountForm(EMPTY_ACCOUNT_FORM);
    setAccountError("");
  };

  const canCreateTenant =
    tenantForm.name.trim().length >= 2 &&
    tenantForm.slug.trim().length >= 2 &&
    tenantForm.adminName.trim().length >= 2 &&
    tenantForm.adminUsername.trim().length >= 3 &&
    tenantForm.adminPassword.length >= 8;

  const canSaveAccount =
    Boolean(accountForm.businessId) &&
    accountForm.name.trim().length >= 2 &&
    accountForm.username.trim().length >= 3 &&
    (accountToEdit ? accountForm.password.length === 0 || accountForm.password.length >= 8 : accountForm.password.length >= 8);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-6 lg:p-8" aria-label="Loading platform console">
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-28" />)}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center p-6">
        <Card className="w-full border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" />Platform data unavailable</CardTitle>
            <CardDescription>{extractApiErrorMessage(error, "Unable to load the tenant control plane")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="h-11 gap-2" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeTenants = businesses.filter((business) => business.active).length;
  const smtpReady = businesses.filter((business) => business.smtpConfigured).length;
  const inactiveAccounts = tenantAccounts.filter((account) => !account.active).length;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6 lg:p-8">
      {section === "overview" && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Platform owner workspace
              </div>
              <h2 className="text-2xl font-semibold tracking-tight lg:text-3xl">Multi-tenant operations</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Monitor tenant health, account access, and platform-managed email from one control plane.
              </p>
            </div>
            <Button className="h-11 gap-2" onClick={() => setTenantDialogOpen(true)}>
              <Plus className="h-4 w-4" />New tenant
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Total tenants" value={businesses.length} detail="All registered organizations" icon={Building2} />
            <SummaryCard label="Active tenants" value={activeTenants} detail={`${businesses.length - activeTenants} suspended`} icon={CheckCircle2} />
            <SummaryCard label="Tenant accounts" value={tenantAccounts.length} detail={`${inactiveAccounts} inactive`} icon={Users} />
            <SummaryCard label="Email ready" value={smtpReady} detail={`${businesses.length - smtpReady} need configuration`} icon={ServerCog} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.75fr)]">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Tenant directory</CardTitle>
                  <CardDescription>Recently created organizations and current status.</CardDescription>
                </div>
                <Button variant="outline" className="h-10" onClick={() => navigate("/super-admin/tenants")}>View all</Button>
              </CardHeader>
              <CardContent>
                {businesses.length === 0 ? (
                  <EmptyTenants onCreate={() => setTenantDialogOpen(true)} />
                ) : (
                  <div className="space-y-2">
                    {businesses.slice(0, 6).map((business) => (
                      <button
                        key={business.id}
                        type="button"
                        className="flex min-h-16 w-full items-center justify-between gap-4 rounded-xl border p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openTenantEditor(business)}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{business.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{formatLabel(business.businessType)} · {business.slug}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="outline">{business.accountCount} users</Badge>
                          <Badge variant={business.active ? "default" : "secondary"}>{business.active ? "Active" : "Suspended"}</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Needs attention</CardTitle>
                <CardDescription>Configuration and access issues to review.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <AttentionRow label="Suspended tenants" value={businesses.length - activeTenants} onClick={() => navigate("/super-admin/tenants")} />
                <AttentionRow label="Email not configured" value={businesses.length - smtpReady} onClick={() => navigate("/super-admin/email")} />
                <AttentionRow label="Inactive accounts" value={inactiveAccounts} onClick={() => navigate("/super-admin/accounts")} />
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {section === "tenants" && (
        <>
          <SectionHeading
            title="Tenant organizations"
            description="Create organizations, control access, and manage each tenant's operating profile."
            action={<Button className="h-11 gap-2" onClick={() => setTenantDialogOpen(true)}><Plus className="h-4 w-4" />New tenant</Button>}
          />
          <Card>
            <CardHeader>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
                <SearchField value={tenantSearch} onChange={setTenantSearch} placeholder="Search tenant, ID, email, or administrator" />
                <Select value={tenantStatus} onValueChange={(value) => setTenantStatus(value as TenantStatusFilter)}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {filteredBusinesses.length === 0 ? (
                <EmptySearch message={businesses.length ? "No tenants match these filters." : "No tenants have been created."} />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Tenant</TableHead><TableHead>Type</TableHead><TableHead>Administrator</TableHead><TableHead>Accounts</TableHead><TableHead>Region</TableHead><TableHead>Email</TableHead><TableHead className="text-right">Access</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {filteredBusinesses.map((business) => (
                        <TableRow key={business.id}>
                          <TableCell><p className="font-semibold">{business.name}</p><p className="text-xs text-muted-foreground">{business.slug}</p></TableCell>
                          <TableCell>{formatLabel(business.businessType)}</TableCell>
                          <TableCell><p>{business.administrator?.name || "Not assigned"}</p><p className="text-xs text-muted-foreground">{business.administrator?.username || "—"}</p></TableCell>
                          <TableCell className="tabular-nums">{business.accountCount}</TableCell>
                          <TableCell><p>{business.currency}</p><p className="text-xs text-muted-foreground">{business.timezone}</p></TableCell>
                          <TableCell><Badge variant={business.smtpConfigured ? "default" : "outline"}>{business.smtpConfigured ? "Ready" : "Setup needed"}</Badge></TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-2">
                              <Button variant="outline" size="sm" className="h-10 gap-2" onClick={() => openTenantEditor(business)}><Pencil className="h-3.5 w-3.5" />Manage</Button>
                              <Switch checked={business.active} onCheckedChange={(active) => changeTenantStatus.mutate({ id: business.id, active })} disabled={changeTenantStatus.isPending} aria-label={`${business.active ? "Suspend" : "Activate"} ${business.name}`} />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {section === "accounts" && (
        <>
          <SectionHeading
            title="Tenant accounts"
            description="Provision users, assign tenant roles, reset credentials, and revoke access."
            action={<Button className="h-11 gap-2" onClick={() => openNewAccountDialog()} disabled={!businesses.length}><UserPlus className="h-4 w-4" />Add account</Button>}
          />
          <Card>
            <CardHeader>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem]">
                <SearchField value={accountSearch} onChange={setAccountSearch} placeholder="Search name, username, email, or role" />
                <Select value={accountTenantFilter} onValueChange={setAccountTenantFilter}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="Tenant" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All tenants</SelectItem>
                    {businesses.map((business) => <SelectItem key={business.id} value={String(business.id)}>{business.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {filteredAccounts.length === 0 ? (
                <EmptySearch message={tenantAccounts.length ? "No accounts match these filters." : "No tenant accounts have been created."} />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Tenant</TableHead><TableHead>Role</TableHead><TableHead>Contact</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Manage</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {filteredAccounts.map((account) => (
                        <TableRow key={account.id}>
                          <TableCell><p className="font-medium">{account.name || account.username}</p><p className="text-xs text-muted-foreground">{account.username}</p></TableCell>
                          <TableCell>{account.businessId ? businessNames.get(account.businessId) || "Unknown tenant" : "Platform"}</TableCell>
                          <TableCell><Badge variant="secondary">{formatLabel(account.role)}</Badge></TableCell>
                          <TableCell>{account.email || "—"}</TableCell>
                          <TableCell>{account.active ? <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" />Active</span> : <span className="inline-flex items-center gap-1.5 text-muted-foreground"><CircleOff className="h-4 w-4" />Inactive</span>}</TableCell>
                          <TableCell className="text-right"><Button variant="outline" size="sm" className="h-10 gap-2" onClick={() => openAccountEditor(account)}><Pencil className="h-3.5 w-3.5" />Edit</Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {section === "email" && (
        <>
          <SectionHeading title="Tenant email configuration" description="SMTP credentials are encrypted and can only be managed from this platform-owner console." />
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
            <div className="flex gap-3">
              <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div><p className="font-semibold">Secrets stay protected</p><p className="mt-1 text-muted-foreground">Saved SMTP passwords are never returned to the browser. Leaving the password field blank preserves the existing secret.</p></div>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {businesses.map((business) => (
              <Card key={business.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div><CardTitle className="text-lg">{business.name}</CardTitle><CardDescription>{business.smtpFrom || business.contactEmail || "No sender address"}</CardDescription></div>
                    <Badge variant={business.smtpConfigured ? "default" : "outline"}>{business.smtpConfigured ? "SMTP ready" : "Setup needed"}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Host</dt><dd className="truncate font-medium">{business.smtpHost || "Not configured"}</dd>
                    <dt className="text-muted-foreground">Username</dt><dd className="truncate font-medium">{business.smtpUser || "Not configured"}</dd>
                    <dt className="text-muted-foreground">Security</dt><dd className="font-medium">{business.smtpSecure ? "TLS on connect" : "STARTTLS"} · port {business.smtpPort || 587}</dd>
                  </dl>
                  <Button variant="outline" className="h-11 w-full gap-2" onClick={() => openTenantEditor(business, "email")}><ServerCog className="h-4 w-4" />Configure email</Button>
                </CardContent>
              </Card>
            ))}
          </div>
          {!businesses.length && <EmptySearch message="Create a tenant before configuring email." />}
        </>
      )}

      <CreateTenantDialog
        open={tenantDialogOpen}
        onOpenChange={setTenantDialogOpen}
        form={tenantForm}
        updateForm={updateTenantForm}
        setSlugTouched={setSlugTouched}
        error={tenantFormError}
        canCreate={canCreateTenant}
        pending={createTenant.isPending}
        onCreate={() => createTenant.mutate()}
      />

      <ManageTenantDialog
        business={businessToEdit}
        tab={manageTab}
        setTab={setManageTab}
        form={editForm}
        updateForm={updateEditForm}
        error={editError}
        pending={updateTenant.isPending}
        onClose={() => setBusinessToEdit(null)}
        onSave={() => updateTenant.mutate()}
      />

      <AccountDialog
        open={accountDialogOpen}
        account={accountToEdit}
        businesses={businesses}
        form={accountForm}
        setForm={setAccountForm}
        error={accountError}
        pending={saveAccount.isPending}
        canSave={canSaveAccount}
        onOpenChange={(open) => open ? setAccountDialogOpen(true) : closeAccountDialog()}
        onSave={() => saveAccount.mutate()}
      />
    </div>
  );
}

function SectionHeading({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-semibold tracking-tight">{title}</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p></div>{action}</div>;
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="h-11 pl-10" type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></div>;
}

function AttentionRow({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return <button type="button" className="flex min-h-12 w-full items-center justify-between rounded-lg border px-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onClick}><span className="text-sm font-medium">{label}</span><Badge variant={value ? "secondary" : "outline"}>{value}</Badge></button>;
}

function EmptySearch({ message }: { message: string }) {
  return <div className="rounded-xl border border-dashed p-10 text-center"><Search className="mx-auto mb-3 h-7 w-7 text-muted-foreground" /><p className="text-sm font-medium">{message}</p></div>;
}

function EmptyTenants({ onCreate }: { onCreate: () => void }) {
  return <div className="rounded-xl border border-dashed p-10 text-center"><Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">No tenants yet</p><p className="mt-1 text-sm text-muted-foreground">Create the first organization and administrator account.</p><Button className="mt-4 h-11 gap-2" onClick={onCreate}><Plus className="h-4 w-4" />Create tenant</Button></div>;
}

type TenantForm = typeof EMPTY_TENANT_FORM;

function CreateTenantDialog({ open, onOpenChange, form, updateForm, setSlugTouched, error, canCreate, pending, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; form: TenantForm; updateForm: (field: keyof TenantForm, value: string) => void; setSlugTouched: (value: boolean) => void; error: string; canCreate: boolean; pending: boolean; onCreate: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Create tenant organization</DialogTitle><DialogDescription>Provision an isolated organization identity and its first business administrator.</DialogDescription></DialogHeader>
        <div className="grid gap-5 py-2 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="tenant-name">Organization name</Label><Input id="tenant-name" className="h-11" value={form.name} onChange={(event) => updateForm("name", event.target.value)} placeholder="Downtown Services" autoFocus /></div>
          <div className="space-y-2"><Label htmlFor="tenant-slug">Tenant ID</Label><Input id="tenant-slug" className="h-11" value={form.slug} onChange={(event) => { setSlugTouched(true); updateForm("slug", toSlug(event.target.value)); }} placeholder="downtown-services" /><p className="text-xs text-muted-foreground">Permanent lowercase platform identifier.</p></div>
          <div className="space-y-2"><Label>Business type</Label><Select value={form.businessType} onValueChange={(value) => updateForm("businessType", value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{BUSINESS_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Timezone</Label><Select value={form.timezone} onValueChange={(value) => updateForm("timezone", value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{TIMEZONES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Currency</Label><Select value={form.currency} onValueChange={(value) => updateForm("currency", value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label htmlFor="tenant-email">Contact email</Label><Input id="tenant-email" className="h-11" type="email" value={form.contactEmail} onChange={(event) => updateForm("contactEmail", event.target.value)} placeholder="office@example.com" /></div>
          <div className="space-y-2"><Label htmlFor="tenant-phone">Phone</Label><Input id="tenant-phone" className="h-11" type="tel" value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} placeholder="+971 ..." /></div>
          <div className="border-t pt-5 sm:col-span-2"><h3 className="font-semibold">Initial business administrator</h3><p className="text-xs text-muted-foreground">The account is restricted to this tenant.</p></div>
          <div className="space-y-2"><Label htmlFor="tenant-admin-name">Administrator name</Label><Input id="tenant-admin-name" className="h-11" value={form.adminName} onChange={(event) => updateForm("adminName", event.target.value)} placeholder="Manager name" /></div>
          <div className="space-y-2"><Label htmlFor="tenant-admin-username">Login username</Label><Input id="tenant-admin-username" className="h-11" value={form.adminUsername} onChange={(event) => updateForm("adminUsername", event.target.value)} placeholder="tenant.admin" autoComplete="off" /></div>
          <div className="sm:col-span-2"><PasswordField id="tenant-admin-password" label="Temporary password" value={form.adminPassword} onChange={(value) => updateForm("adminPassword", value)} placeholder="At least 8 characters" helper="Only the platform owner can reset this credential." /></div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter><Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button><Button className="h-11" onClick={onCreate} disabled={!canCreate || pending}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create tenant</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type EditForm = typeof EMPTY_EDIT_FORM;

function ManageTenantDialog({ business, tab, setTab, form, updateForm, error, pending, onClose, onSave }: { business: ManagedBusiness | null; tab: ManageTab; setTab: (tab: ManageTab) => void; form: EditForm; updateForm: (field: keyof EditForm, value: string | boolean) => void; error: string; pending: boolean; onClose: () => void; onSave: () => void }) {
  const canSave = form.name.trim().length >= 2 && form.adminName.trim().length >= 2 && form.adminUsername.trim().length >= 3 && (form.adminPassword.length === 0 || form.adminPassword.length >= 8);
  return (
    <Dialog open={Boolean(business)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Manage {business?.name || "tenant"}</DialogTitle><DialogDescription>Update the organization profile, primary administrator, and platform-managed email connection.</DialogDescription></DialogHeader>
        <Tabs value={tab} onValueChange={(value) => setTab(value as ManageTab)}>
          <TabsList className="grid h-auto w-full grid-cols-3"><TabsTrigger className="min-h-11" value="profile">Profile</TabsTrigger><TabsTrigger className="min-h-11" value="administrator">Administrator</TabsTrigger><TabsTrigger className="min-h-11" value="email">Email</TabsTrigger></TabsList>
          <TabsContent value="profile" className="grid gap-5 py-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="edit-tenant-name">Organization name</Label><Input id="edit-tenant-name" className="h-11" value={form.name} onChange={(event) => updateForm("name", event.target.value)} /></div>
            <div className="space-y-2"><Label>Business type</Label><Select value={form.businessType} onValueChange={(value) => updateForm("businessType", value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{BUSINESS_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Currency</Label><Select value={form.currency} onValueChange={(value) => updateForm("currency", value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Timezone</Label><Select value={form.timezone} onValueChange={(value) => updateForm("timezone", value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{TIMEZONES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="edit-tenant-phone">Phone</Label><Input id="edit-tenant-phone" className="h-11" type="tel" value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="edit-tenant-email">Contact email</Label><Input id="edit-tenant-email" className="h-11" type="email" value={form.contactEmail} onChange={(event) => updateForm("contactEmail", event.target.value)} /></div>
          </TabsContent>
          <TabsContent value="administrator" className="grid gap-5 py-4 sm:grid-cols-2">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm sm:col-span-2">Business administrators cannot change these credentials themselves. Saving changes signs the account out.</div>
            <div className="space-y-2"><Label htmlFor="edit-admin-name">Administrator name</Label><Input id="edit-admin-name" className="h-11" value={form.adminName} onChange={(event) => updateForm("adminName", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="edit-admin-username">Login username</Label><Input id="edit-admin-username" className="h-11" value={form.adminUsername} onChange={(event) => updateForm("adminUsername", event.target.value)} autoComplete="off" /></div>
            <div className="sm:col-span-2"><PasswordField id="edit-admin-password" label="New password" value={form.adminPassword} onChange={(value) => updateForm("adminPassword", value)} placeholder="Leave blank to keep the current password" helper="Use at least 8 characters when resetting the password." /></div>
          </TabsContent>
          <TabsContent value="email" className="grid gap-5 py-4 sm:grid-cols-2">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm sm:col-span-2"><div className="flex gap-2"><KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>SMTP passwords are encrypted and never returned by the API.</p></div></div>
            <div className="space-y-2"><Label htmlFor="smtp-host">SMTP host</Label><Input id="smtp-host" className="h-11" value={form.smtpHost} onChange={(event) => updateForm("smtpHost", event.target.value)} placeholder="smtp.example.com" /></div>
            <div className="space-y-2"><Label htmlFor="smtp-port">Port</Label><Input id="smtp-port" className="h-11" type="number" min={1} max={65535} value={form.smtpPort} onChange={(event) => updateForm("smtpPort", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="smtp-user">SMTP username</Label><Input id="smtp-user" className="h-11" value={form.smtpUser} onChange={(event) => updateForm("smtpUser", event.target.value)} autoComplete="off" /></div>
            <div className="space-y-2"><Label htmlFor="smtp-from">From address</Label><Input id="smtp-from" className="h-11" type="email" value={form.smtpFrom} onChange={(event) => updateForm("smtpFrom", event.target.value)} placeholder="reports@example.com" /></div>
            <div className="sm:col-span-2"><PasswordField id="smtp-password" label="SMTP password" value={form.smtpPassword} onChange={(value) => updateForm("smtpPassword", value)} placeholder={business?.smtpPasswordSet ? "Password saved — leave blank to keep it" : "Enter SMTP password"} /></div>
            <div className="flex min-h-14 items-center justify-between rounded-lg border p-3 sm:col-span-2"><div><Label htmlFor="smtp-secure">TLS on connect</Label><p className="text-xs text-muted-foreground">Usually enabled for port 465; leave off for STARTTLS on port 587.</p></div><Switch id="smtp-secure" checked={form.smtpSecure} onCheckedChange={(checked) => updateForm("smtpSecure", checked)} /></div>
          </TabsContent>
        </Tabs>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Cancel</Button><Button className="h-11" onClick={onSave} disabled={!canSave || pending}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save changes</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type AccountForm = typeof EMPTY_ACCOUNT_FORM;

function AccountDialog({ open, account, businesses, form, setForm, error, pending, canSave, onOpenChange, onSave }: { open: boolean; account: PlatformAccount | null; businesses: ManagedBusiness[]; form: AccountForm; setForm: React.Dispatch<React.SetStateAction<AccountForm>>; error: string; pending: boolean; canSave: boolean; onOpenChange: (open: boolean) => void; onSave: () => void }) {
  const update = (field: keyof AccountForm, value: string | boolean) => setForm((current) => ({ ...current, [field]: value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{account ? "Manage tenant account" : "Create tenant account"}</DialogTitle><DialogDescription>{account ? "Update role, credentials, or account access. Saving signs this user out." : "Provision a user inside one tenant organization."}</DialogDescription></DialogHeader>
        <div className="grid gap-5 py-2 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><Label>Tenant organization</Label><Select value={form.businessId} onValueChange={(value) => update("businessId", value)} disabled={Boolean(account)}><SelectTrigger className="h-11"><SelectValue placeholder="Choose a tenant" /></SelectTrigger><SelectContent>{businesses.map((business) => <SelectItem key={business.id} value={String(business.id)}>{business.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label htmlFor="account-name">Display name</Label><Input id="account-name" className="h-11" value={form.name} onChange={(event) => update("name", event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="account-username">Login username</Label><Input id="account-username" className="h-11" value={form.username} onChange={(event) => update("username", event.target.value)} autoComplete="off" /></div>
          <div className="space-y-2"><Label htmlFor="account-email">Email</Label><Input id="account-email" className="h-11" type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></div>
          <div className="space-y-2"><Label>Tenant role</Label><Select value={form.role} onValueChange={(value) => update("role", value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{ACCOUNT_ROLES.map((role) => <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="sm:col-span-2"><PasswordField id="account-password" label={account ? "New password" : "Temporary password"} value={form.password} onChange={(value) => update("password", value)} placeholder={account ? "Leave blank to keep the current password" : "At least 8 characters"} /></div>
          <div className="flex min-h-14 items-center justify-between rounded-lg border p-3 sm:col-span-2"><div><Label htmlFor="account-active">Account access</Label><p className="text-xs text-muted-foreground">Inactive users cannot sign in.</p></div><Switch id="account-active" checked={form.active} onCheckedChange={(checked) => update("active", checked)} /></div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter><Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button><Button className="h-11" onClick={onSave} disabled={!canSave || pending}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{account ? "Save account" : "Create account"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
