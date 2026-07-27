import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  CircleOff,
  ClipboardPaste,
  Eye,
  EyeOff,
  ImageIcon,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import { apiRequest, extractApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  pin: string | null;
  password: string | null;
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
  telephone: string | null;
  mobilePhone: string | null;
  website: string | null;
  address: string | null;
  logoUrl: string | null;
  createdAt: string;
  accountCount: number;
  administrator: PlatformAccount | null;
};

type PlatformOverview = {
  businesses: ManagedBusiness[];
  accounts: PlatformAccount[];
};

type ConsoleSection = "overview" | "workspaces" | "accounts";
type WorkspaceStatusFilter = "all" | "active" | "suspended";
type ManageTab = "profile" | "accounts" | "administrator";

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
  telephone: "",
  mobilePhone: "",
  website: "",
  address: "",
  logoUrl: "",
  adminName: "",
  adminUsername: "",
  adminPassword: "",
};

const EMPTY_EDIT_FORM = {
  name: "",
  slug: "",
  businessType: "laundry",
  timezone: "Asia/Dubai",
  currency: "AED",
  contactEmail: "",
  phone: "",
  telephone: "",
  mobilePhone: "",
  website: "",
  address: "",
  logoUrl: "",
  adminName: "",
  adminUsername: "",
  adminPassword: "",
};

const EMPTY_ACCOUNT_FORM = {
  businessId: "",
  name: "",
  username: "",
  email: "",
  pin: "",
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
  if (location.endsWith("/workspaces")) return "workspaces";
  if (location.endsWith("/accounts")) return "accounts";
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

function WorkspaceLogoUpload({
  id,
  value,
  businessName,
  onChange,
}: {
  id: string;
  value: string;
  businessName: string;
  onChange: (value: string) => void;
}) {
  const [error, setError] = useState("");

  const handleFile = (file?: File) => {
    setError("");
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > 1_000_000) {
      setError("Logo must be smaller than 1 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result || ""));
    reader.onerror = () => setError("The logo could not be read. Please choose another image.");
    reader.readAsDataURL(file);
  };

  const handlePaste = (items: DataTransferItemList) => {
    const imageItem = Array.from(items).find((item) => item.type.startsWith("image/"));
    if (!imageItem) {
      setError("Copy an image first, then paste it here.");
      return;
    }
    handleFile(imageItem.getAsFile() || undefined);
  };

  const pasteFromClipboard = async () => {
    setError("");
    if (!navigator.clipboard?.read) {
      setError("Use Ctrl+V or Command+V inside this logo box to paste an image.");
      return;
    }
    try {
      const clipboardItems = await navigator.clipboard.read();
      const imageType = clipboardItems
        .flatMap((item) => item.types)
        .find((type) => type.startsWith("image/"));
      const source = clipboardItems.find((item) =>
        imageType ? item.types.includes(imageType) : false,
      );
      if (!source || !imageType) {
        setError("Copy an image first, then choose Paste image.");
        return;
      }
      handleFile(new File([await source.getType(imageType)], "pasted-logo", { type: imageType }));
    } catch {
      setError("Clipboard access was blocked. Click this box and press Ctrl+V or Command+V.");
    }
  };

  return (
    <div className="space-y-2 sm:col-span-2">
      <Label htmlFor={id}>Workspace logo</Label>
      <div
        className="flex flex-col gap-4 rounded-xl border bg-muted/20 p-4 focus-within:ring-2 focus-within:ring-ring sm:flex-row sm:items-center"
        onPaste={(event) => handlePaste(event.clipboardData.items)}
      >
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-background">
          {value ? (
            <img src={value} alt={`${businessName || "Workspace"} logo preview`} className="h-full w-full object-contain p-2" />
          ) : (
            <ImageIcon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-sm text-muted-foreground">Upload or paste a PNG, JPEG, or WebP image up to 1 MB. It will appear only in this workspace.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-11 gap-2" asChild>
              <label htmlFor={id} className="cursor-pointer"><Upload className="h-4 w-4" />Choose image</label>
            </Button>
            <Button type="button" variant="outline" className="h-11 gap-2" onClick={pasteFromClipboard}>
              <ClipboardPaste className="h-4 w-4" />
              Paste image
            </Button>
            {value && <Button type="button" variant="ghost" className="h-11" onClick={() => onChange("")}>Remove logo</Button>}
          </div>
          <Input id={id} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { handleFile(event.target.files?.[0]); event.target.value = ""; }} />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
      </div>
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
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [workspaceForm, setWorkspaceForm] = useState(EMPTY_TENANT_FORM);
  const [workspaceFormError, setWorkspaceFormError] = useState("");
  const [businessToEdit, setBusinessToEdit] = useState<ManagedBusiness | null>(null);
  const [manageTab, setManageTab] = useState<ManageTab>("profile");
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [editError, setEditError] = useState("");
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatusFilter>("all");
  const [accountSearch, setAccountSearch] = useState("");
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [accountBusinessLocked, setAccountBusinessLocked] = useState(false);
  const [accountReturnBusinessId, setAccountReturnBusinessId] = useState<number | null>(null);
  const [accountToEdit, setAccountToEdit] = useState<PlatformAccount | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<PlatformAccount | null>(null);
  const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT_FORM);
  const [accountError, setAccountError] = useState("");
  const [businessToDelete, setBusinessToDelete] = useState<ManagedBusiness | null>(null);
  const [businessDeleteConfirmation, setBusinessDeleteConfirmation] = useState("");

  const { data, isLoading, error, refetch, isFetching } = useQuery<PlatformOverview>({
    queryKey: ["/api/super-admin/businesses"],
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const businesses = data?.businesses || [];
  const accounts = data?.accounts || [];
  const workspaceAccounts = accounts.filter((account) => account.businessId !== null);

  const filteredBusinesses = useMemo(() => {
    const query = workspaceSearch.trim().toLowerCase();
    return businesses.filter((business) => {
      const statusMatches =
        workspaceStatus === "all" ||
        (workspaceStatus === "active" ? business.active : !business.active);
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
  }, [businesses, workspaceSearch, workspaceStatus]);

  const groupedAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    return businesses
      .map((business) => {
        const businessAccounts = workspaceAccounts.filter(
          (account) => account.businessId === business.id,
        );
        const businessMatches =
          !query ||
          [business.name, business.slug, business.administrator?.username || ""].some(
            (value) => value.toLowerCase().includes(query),
          );
        const matchingAccounts = businessMatches
          ? businessAccounts
          : businessAccounts.filter((account) =>
              [account.name || "", account.username, account.email || "", account.role].some(
                (value) => value.toLowerCase().includes(query),
              ),
            );

        return {
          business,
          accounts: matchingAccounts,
          businessMatches,
          totalAccountCount: businessAccounts.length,
        };
      })
      .filter(({ accounts: matchingAccounts, businessMatches }) =>
        !query || businessMatches || matchingAccounts.length > 0,
      );
  }, [accountSearch, businesses, workspaceAccounts]);

  const managedBusinessAccounts = useMemo(
    () =>
      businessToEdit
        ? workspaceAccounts.filter((account) => account.businessId === businessToEdit.id)
        : [],
    [businessToEdit, workspaceAccounts],
  );

  const createWorkspace = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/super-admin/businesses", workspaceForm);
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/businesses"] });
      setWorkspaceDialogOpen(false);
      setWorkspaceForm(EMPTY_TENANT_FORM);
      setSlugTouched(false);
      setWorkspaceFormError("");
      toast({
        title: "Workspace created",
        description: result.administratorPin
          ? `${result.message}. Administrator PIN: ${result.administratorPin}`
          : result.message,
      });
    },
    onError: (mutationError) => {
      setWorkspaceFormError(extractApiErrorMessage(mutationError, "Failed to create the workspace"));
    },
  });

  const changeWorkspaceStatus = useMutation({
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
      toast({ title: "Workspace status updated", description: result.message });
    },
    onError: (mutationError) => {
      toast({
        title: "Status update failed",
        description: extractApiErrorMessage(mutationError),
        variant: "destructive",
      });
    },
  });

  const updateWorkspace = useMutation({
    mutationFn: async () => {
      if (!businessToEdit) throw new Error("Choose a workspace to update");
      const response = await apiRequest(
        "PUT",
        `/api/super-admin/businesses/${businessToEdit.id}`,
        {
          ...editForm,
          administratorId: businessToEdit.administrator?.id,
          updateAdministrator: manageTab === "administrator",
        },
      );
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/businesses"] });
      setBusinessToEdit(null);
      setEditForm(EMPTY_EDIT_FORM);
      setEditError("");
      toast({ title: "Workspace updated", description: result.message });
    },
    onError: (mutationError) => {
      setEditError(extractApiErrorMessage(mutationError, "Failed to update the workspace"));
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
            pin: accountForm.pin,
            role: accountForm.role,
            password: accountForm.password,
            active: accountForm.active,
          },
        );
        return response.json();
      }

      if (!accountForm.businessId) throw new Error("Choose a workspace");
      const response = await apiRequest(
        "POST",
        `/api/super-admin/businesses/${accountForm.businessId}/accounts`,
        {
          name: accountForm.name,
          username: accountForm.username,
          email: accountForm.email,
          pin: accountForm.pin,
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
      toast({
        title: accountToEdit ? "Account updated" : "Account created",
        description: result.administratorPin
          ? `${result.message}. Administrator PIN: ${result.administratorPin}`
          : result.message,
      });
    },
    onError: (mutationError) => {
      setAccountError(extractApiErrorMessage(mutationError, "Failed to save the account"));
    },
  });

  const deleteAccount = useMutation({
    mutationFn: async (account: PlatformAccount) => {
      const response = await apiRequest(
        "DELETE",
        `/api/super-admin/accounts/${account.id}`,
      );
      return response.status === 204
        ? { message: `${account.name || account.username} was deleted.` }
        : response.json();
    },
    onSuccess: (result, deletedAccount) => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/businesses"] });
      setAccountToDelete(null);
      closeAccountDialog();
      toast({
        title: "Account deleted",
        description: result.message || `${deletedAccount.name || deletedAccount.username} was deleted.`,
      });
    },
    onError: (mutationError) => {
      toast({
        title: "Account deletion failed",
        description: extractApiErrorMessage(mutationError),
        variant: "destructive",
      });
    },
  });

  const deleteBusiness = useMutation({
    mutationFn: async (business: ManagedBusiness) => {
      const response = await apiRequest(
        "DELETE",
        `/api/super-admin/businesses/${business.id}`,
      );
      return response.status === 204
        ? { message: `${business.name} was deleted.` }
        : response.json();
    },
    onSuccess: (result, deletedBusiness) => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/businesses"] });
      setBusinessToDelete(null);
      setBusinessDeleteConfirmation("");
      toast({
        title: "Business deleted",
        description: result.message || `${deletedBusiness.name} was deleted.`,
      });
    },
    onError: (mutationError) => {
      toast({
        title: "Business deletion failed",
        description: extractApiErrorMessage(mutationError),
        variant: "destructive",
      });
    },
  });

  const updateWorkspaceForm = (field: keyof typeof EMPTY_TENANT_FORM, value: string) => {
    setWorkspaceFormError("");
    setWorkspaceForm((current) => {
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

  const openWorkspaceEditor = (business: ManagedBusiness, tab: ManageTab = "profile") => {
    setBusinessToEdit(business);
    setManageTab(tab);
    setEditError("");
    setEditForm({
      name: business.name,
      slug: business.slug,
      businessType: business.businessType || "laundry",
      timezone: business.timezone || "Asia/Dubai",
      currency: business.currency || "AED",
      contactEmail: business.contactEmail || "",
      phone: business.phone || "",
      telephone: business.telephone || "",
      mobilePhone: business.mobilePhone || business.phone || "",
      website: business.website || "",
      address: business.address || "",
      logoUrl: business.logoUrl || "",
      adminName: business.administrator?.name || "",
      adminUsername: business.administrator?.username || "",
      adminPassword: business.administrator?.password || "",
    });
  };

  const openNewAccountDialog = (businessId = "", returnToBusiness = false) => {
    setAccountReturnBusinessId(
      returnToBusiness && businessId ? Number(businessId) : null,
    );
    if (returnToBusiness) setBusinessToEdit(null);
    setAccountToEdit(null);
    setAccountBusinessLocked(Boolean(businessId));
    setAccountForm({ ...EMPTY_ACCOUNT_FORM, businessId });
    setAccountError("");
    setAccountDialogOpen(true);
  };

  const openAccountEditor = (account: PlatformAccount, returnToBusiness = false) => {
    setAccountReturnBusinessId(
      returnToBusiness && account.businessId !== null ? account.businessId : null,
    );
    if (returnToBusiness) setBusinessToEdit(null);
    setAccountToEdit(account);
    setAccountBusinessLocked(true);
    setAccountForm({
      businessId: String(account.businessId || ""),
      name: account.name || "",
      username: account.username,
      email: account.email || "",
      pin: account.pin || "",
      role: account.role,
      password: account.password || "",
      active: Boolean(account.active),
    });
    setAccountError("");
    setAccountDialogOpen(true);
  };

  const closeAccountDialog = () => {
    const businessToRestore = accountReturnBusinessId === null
      ? null
      : businesses.find((business) => business.id === accountReturnBusinessId) || null;

    setAccountDialogOpen(false);
    setAccountBusinessLocked(false);
    setAccountReturnBusinessId(null);
    setAccountToEdit(null);
    setAccountForm(EMPTY_ACCOUNT_FORM);
    setAccountError("");

    if (businessToRestore) {
      setManageTab("accounts");
      setBusinessToEdit(businessToRestore);
    }
  };

  const requestDeleteAccount = () => {
    if (!accountToEdit) return;
    setAccountToDelete(accountToEdit);
    setAccountDialogOpen(false);
  };

  const cancelDeleteAccount = () => {
    if (deleteAccount.isPending) return;
    setAccountToDelete(null);
    setAccountDialogOpen(true);
  };

  const requestDeleteBusiness = () => {
    if (!businessToEdit) return;
    setBusinessToDelete(businessToEdit);
    setBusinessDeleteConfirmation("");
    setBusinessToEdit(null);
  };

  const cancelDeleteBusiness = () => {
    if (deleteBusiness.isPending || !businessToDelete) return;
    const businessToRestore = businessToDelete;
    setBusinessToDelete(null);
    setBusinessDeleteConfirmation("");
    setManageTab("profile");
    setBusinessToEdit(businessToRestore);
  };

  const canCreateWorkspace =
    workspaceForm.name.trim().length >= 2 &&
    workspaceForm.slug.trim().length >= 2 &&
    workspaceForm.adminName.trim().length >= 2 &&
    workspaceForm.adminUsername.trim().length >= 3 &&
    workspaceForm.adminPassword.length >= 8;

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
            <CardDescription>{extractApiErrorMessage(error, "Unable to load the workspace control plane")}</CardDescription>
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

  const activeWorkspaces = businesses.filter((business) => business.active).length;
  const inactiveAccounts = workspaceAccounts.filter((account) => !account.active).length;

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
              <h2 className="text-2xl font-semibold tracking-tight lg:text-3xl">Multi-workspace operations</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Monitor workspace health and account access from one control plane. SMTP remains platform-owner infrastructure.
              </p>
            </div>
            <Button className="h-11 gap-2" onClick={() => setWorkspaceDialogOpen(true)}>
              <Plus className="h-4 w-4" />New workspace
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <SummaryCard label="Total workspaces" value={businesses.length} detail="All registered organizations" icon={Building2} />
            <SummaryCard label="Active workspaces" value={activeWorkspaces} detail={`${businesses.length - activeWorkspaces} suspended`} icon={CheckCircle2} />
            <SummaryCard label="Workspace accounts" value={workspaceAccounts.length} detail={`${inactiveAccounts} inactive`} icon={Users} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.75fr)]">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Workspace directory</CardTitle>
                  <CardDescription>Recently created organizations and current status.</CardDescription>
                </div>
                <Button variant="outline" className="h-10" onClick={() => navigate("/super-admin/workspaces")}>View all</Button>
              </CardHeader>
              <CardContent>
                {businesses.length === 0 ? (
                  <EmptyWorkspaces onCreate={() => setWorkspaceDialogOpen(true)} />
                ) : (
                  <div className="space-y-2">
                    {businesses.slice(0, 6).map((business) => (
                      <button
                        key={business.id}
                        type="button"
                        className="flex min-h-16 w-full items-center justify-between gap-4 rounded-xl border p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openWorkspaceEditor(business)}
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
                <AttentionRow label="Suspended workspaces" value={businesses.length - activeWorkspaces} onClick={() => navigate("/super-admin/workspaces")} />
                <AttentionRow label="Inactive accounts" value={inactiveAccounts} onClick={() => navigate("/super-admin/accounts")} />
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {section === "workspaces" && (
        <>
          <SectionHeading
            title="Workspace organizations"
            description="Create organizations, control access, and manage each workspace's operating profile."
            action={<Button className="h-11 gap-2" onClick={() => setWorkspaceDialogOpen(true)}><Plus className="h-4 w-4" />New workspace</Button>}
          />
          <Card>
            <CardHeader>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
                <SearchField value={workspaceSearch} onChange={setWorkspaceSearch} placeholder="Search workspace, ID, email, or administrator" />
                <Select value={workspaceStatus} onValueChange={(value) => setWorkspaceStatus(value as WorkspaceStatusFilter)}>
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
                <EmptySearch message={businesses.length ? "No workspaces match these filters." : "No workspaces have been created."} />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Workspace</TableHead><TableHead>Type</TableHead><TableHead>Administrator</TableHead><TableHead>Accounts</TableHead><TableHead>Region</TableHead><TableHead className="text-right">Access</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {filteredBusinesses.map((business) => (
                        <TableRow key={business.id}>
                          <TableCell><p className="font-semibold">{business.name}</p><p className="text-xs text-muted-foreground">{business.slug}</p></TableCell>
                          <TableCell>{formatLabel(business.businessType)}</TableCell>
                          <TableCell><p>{business.administrator?.name || "Not assigned"}</p><p className="text-xs text-muted-foreground">{business.administrator?.username || "—"}</p></TableCell>
                          <TableCell className="tabular-nums">{business.accountCount}</TableCell>
                          <TableCell><p>{business.currency}</p><p className="text-xs text-muted-foreground">{business.timezone}</p></TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-2">
                              <Button variant="outline" size="sm" className="h-10 gap-2" onClick={() => openWorkspaceEditor(business)}><Pencil className="h-3.5 w-3.5" />Manage</Button>
                              <Switch checked={business.active} onCheckedChange={(active) => changeWorkspaceStatus.mutate({ id: business.id, active })} disabled={changeWorkspaceStatus.isPending} aria-label={`${business.active ? "Suspend" : "Activate"} ${business.name}`} />
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
            title="Accounts by business"
            description="Each business keeps its own users, roles, credentials, and access controls."
          />
          <Card>
            <CardHeader>
              <SearchField value={accountSearch} onChange={setAccountSearch} placeholder="Search a business, user, username, email, or role" />
            </CardHeader>
            <CardContent>
              {groupedAccounts.length === 0 ? (
                <EmptySearch message={businesses.length ? "No businesses or accounts match this search." : "Create a business before adding accounts."} />
              ) : (
                <div className="space-y-4">
                  {groupedAccounts.map(({ business, accounts: businessAccounts, totalAccountCount }) => (
                    <BusinessAccountsCard
                      key={business.id}
                      business={business}
                      accounts={businessAccounts}
                      totalAccountCount={totalAccountCount}
                      onAddAccount={() => openNewAccountDialog(String(business.id))}
                      onEditAccount={openAccountEditor}
                      onManageBusiness={() => openWorkspaceEditor(business, "accounts")}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <CreateWorkspaceDialog
        open={workspaceDialogOpen}
        onOpenChange={setWorkspaceDialogOpen}
        form={workspaceForm}
        updateForm={updateWorkspaceForm}
        setSlugTouched={setSlugTouched}
        error={workspaceFormError}
        canCreate={canCreateWorkspace}
        pending={createWorkspace.isPending}
        onCreate={() => createWorkspace.mutate()}
      />

      <ManageWorkspaceDialog
        business={businessToEdit}
        accounts={managedBusinessAccounts}
        tab={manageTab}
        setTab={setManageTab}
        form={editForm}
        updateForm={updateEditForm}
        error={editError}
        pending={updateWorkspace.isPending}
        onAddAccount={() => businessToEdit && openNewAccountDialog(String(businessToEdit.id), true)}
        onEditAccount={(account) => openAccountEditor(account, true)}
        onRequestDelete={requestDeleteBusiness}
        onClose={() => setBusinessToEdit(null)}
        onSave={() => updateWorkspace.mutate()}
      />

      <AccountDialog
        open={accountDialogOpen}
        account={accountToEdit}
        businessLocked={accountBusinessLocked}
        businesses={businesses}
        form={accountForm}
        setForm={setAccountForm}
        error={accountError}
        pending={saveAccount.isPending}
        canSave={canSaveAccount}
        onOpenChange={(open) => open ? setAccountDialogOpen(true) : closeAccountDialog()}
        onRequestDelete={requestDeleteAccount}
        onSave={() => saveAccount.mutate()}
      />

      <AlertDialog
        open={Boolean(accountToDelete)}
        onOpenChange={(open) => { if (!open) cancelDeleteAccount(); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {accountToDelete?.name || accountToDelete?.username || "this account"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The login {accountToDelete?.username || "for this user"} will be permanently removed from {businesses.find((business) => business.id === accountToDelete?.businessId)?.name || "this business"}, immediately revoking its access. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={deleteAccount.isPending}>Keep account</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className="h-11 gap-2"
              disabled={!accountToDelete || deleteAccount.isPending}
              onClick={() => accountToDelete && deleteAccount.mutate(accountToDelete)}
            >
              {deleteAccount.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              Delete account
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(businessToDelete)}
        onOpenChange={(open) => { if (!open) cancelDeleteBusiness(); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {businessToDelete?.name || "this business"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the business, its accounts, and its workspace data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-business-confirmation">
              Type <span className="font-semibold text-foreground">{businessToDelete?.name}</span> to confirm
            </Label>
            <Input
              id="delete-business-confirmation"
              className="h-11"
              value={businessDeleteConfirmation}
              onChange={(event) => setBusinessDeleteConfirmation(event.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={deleteBusiness.isPending}>Keep business</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className="h-11 gap-2"
              disabled={
                !businessToDelete ||
                businessDeleteConfirmation !== businessToDelete.name ||
                deleteBusiness.isPending
              }
              onClick={() => businessToDelete && deleteBusiness.mutate(businessToDelete)}
            >
              {deleteBusiness.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              Permanently delete business
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

function EmptyWorkspaces({ onCreate }: { onCreate: () => void }) {
  return <div className="rounded-xl border border-dashed p-10 text-center"><Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">No workspaces yet</p><p className="mt-1 text-sm text-muted-foreground">Create the first organization and administrator account.</p><Button className="mt-4 h-11 gap-2" onClick={onCreate}><Plus className="h-4 w-4" />Create workspace</Button></div>;
}

function WorkspaceAccountList({
  accounts,
  onEditAccount,
  emptyMessage = "No accounts have been created for this business.",
}: {
  accounts: PlatformAccount[];
  onEditAccount: (account: PlatformAccount) => void;
  emptyMessage?: string;
}) {
  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <Users className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {accounts.map((account) => (
        <div
          key={account.id}
          className="grid gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40 sm:grid-cols-[minmax(0,1.25fr)_minmax(8rem,0.75fr)_auto] sm:items-center"
        >
          <div className="min-w-0">
            <p className="truncate font-medium">{account.name || account.username}</p>
            <p className="truncate text-xs text-muted-foreground">{account.username}</p>
            {account.email && <p className="mt-1 break-all text-xs text-muted-foreground">{account.email}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{formatLabel(account.role)}</Badge>
            {account.active ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <CircleOff className="h-4 w-4" aria-hidden="true" />Inactive
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-11 gap-2 sm:min-w-24"
            onClick={() => onEditAccount(account)}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit
          </Button>
        </div>
      ))}
    </div>
  );
}

function BusinessAccountsCard({
  business,
  accounts,
  totalAccountCount,
  onAddAccount,
  onEditAccount,
  onManageBusiness,
}: {
  business: ManagedBusiness;
  accounts: PlatformAccount[];
  totalAccountCount: number;
  onAddAccount: () => void;
  onEditAccount: (account: PlatformAccount) => void;
  onManageBusiness: () => void;
}) {
  return (
    <Card className="shadow-none">
      <CardHeader className="gap-4 border-b sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="truncate text-lg">{business.name}</CardTitle>
            <Badge variant={business.active ? "default" : "secondary"}>
              {business.active ? "Active" : "Suspended"}
            </Badge>
          </div>
          <CardDescription className="mt-1">
            {business.slug} · {accounts.length === totalAccountCount
              ? `${totalAccountCount} ${totalAccountCount === 1 ? "account" : "accounts"}`
              : `${accounts.length} of ${totalAccountCount} accounts shown`}
          </CardDescription>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="h-11 gap-2" onClick={onManageBusiness}>
            <Building2 className="h-4 w-4" aria-hidden="true" />Business controls
          </Button>
          <Button className="h-11 gap-2" onClick={onAddAccount}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />Add account
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <WorkspaceAccountList accounts={accounts} onEditAccount={onEditAccount} />
      </CardContent>
    </Card>
  );
}

type WorkspaceForm = typeof EMPTY_TENANT_FORM;

function CreateWorkspaceDialog({ open, onOpenChange, form, updateForm, setSlugTouched, error, canCreate, pending, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; form: WorkspaceForm; updateForm: (field: keyof WorkspaceForm, value: string) => void; setSlugTouched: (value: boolean) => void; error: string; canCreate: boolean; pending: boolean; onCreate: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Create workspace organization</DialogTitle><DialogDescription>Provision an isolated organization identity and its first business administrator.</DialogDescription></DialogHeader>
        <div className="grid gap-5 py-2 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="workspace-name">Organization name</Label><Input id="workspace-name" className="h-11" value={form.name} onChange={(event) => updateForm("name", event.target.value)} placeholder="Downtown Services" autoFocus /></div>
          <div className="space-y-2"><Label htmlFor="workspace-slug">Workspace ID</Label><Input id="workspace-slug" className="h-11" value={form.slug} onChange={(event) => { setSlugTouched(true); updateForm("slug", toSlug(event.target.value)); }} placeholder="downtown-services" /><p className="text-xs text-muted-foreground">Permanent lowercase platform identifier.</p></div>
          <div className="space-y-2"><Label>Business type</Label><Select value={form.businessType} onValueChange={(value) => updateForm("businessType", value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{BUSINESS_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Timezone</Label><Select value={form.timezone} onValueChange={(value) => updateForm("timezone", value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{TIMEZONES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Currency</Label><Select value={form.currency} onValueChange={(value) => updateForm("currency", value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label htmlFor="workspace-email">Contact email</Label><Input id="workspace-email" className="h-11" type="email" value={form.contactEmail} onChange={(event) => updateForm("contactEmail", event.target.value)} placeholder="office@example.com" /></div>
          <div className="space-y-2"><Label htmlFor="workspace-telephone">Telephone</Label><Input id="workspace-telephone" className="h-11" type="tel" value={form.telephone} onChange={(event) => updateForm("telephone", event.target.value)} placeholder="02 123 4567" /></div>
          <div className="space-y-2"><Label htmlFor="workspace-mobile">Mobile</Label><Input id="workspace-mobile" className="h-11" type="tel" value={form.mobilePhone} onChange={(event) => updateForm("mobilePhone", event.target.value)} placeholder="+971 50 123 4567" /></div>
          <div className="space-y-2"><Label htmlFor="workspace-website">Website</Label><Input id="workspace-website" className="h-11" type="url" value={form.website} onChange={(event) => updateForm("website", event.target.value)} placeholder="https://example.com" /></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="workspace-address">Address</Label><Input id="workspace-address" className="h-11" value={form.address} onChange={(event) => updateForm("address", event.target.value)} placeholder="Street, area, city, country" /></div>
          <WorkspaceLogoUpload id="workspace-logo" value={form.logoUrl} businessName={form.name} onChange={(value) => updateForm("logoUrl", value)} />
          <div className="border-t pt-5 sm:col-span-2"><h3 className="font-semibold">Initial business administrator</h3><p className="text-xs text-muted-foreground">The account is restricted to this workspace.</p></div>
          <div className="space-y-2"><Label htmlFor="workspace-admin-name">Administrator name</Label><Input id="workspace-admin-name" className="h-11" value={form.adminName} onChange={(event) => updateForm("adminName", event.target.value)} placeholder="Manager name" /></div>
          <div className="space-y-2"><Label htmlFor="workspace-admin-username">Login username</Label><Input id="workspace-admin-username" className="h-11" value={form.adminUsername} onChange={(event) => updateForm("adminUsername", event.target.value)} placeholder="workspace.admin" autoComplete="off" /></div>
          <div className="sm:col-span-2"><PasswordField id="workspace-admin-password" label="Temporary password" value={form.adminPassword} onChange={(value) => updateForm("adminPassword", value)} placeholder="At least 8 characters" helper="Only the platform owner can reset this credential." /></div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter><Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button><Button className="h-11" onClick={onCreate} disabled={!canCreate || pending}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create workspace</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type EditForm = typeof EMPTY_EDIT_FORM;

function ManageWorkspaceDialog({
  business,
  accounts,
  tab,
  setTab,
  form,
  updateForm,
  error,
  pending,
  onAddAccount,
  onEditAccount,
  onRequestDelete,
  onClose,
  onSave,
}: {
  business: ManagedBusiness | null;
  accounts: PlatformAccount[];
  tab: ManageTab;
  setTab: (tab: ManageTab) => void;
  form: EditForm;
  updateForm: (field: keyof EditForm, value: string | boolean) => void;
  error: string;
  pending: boolean;
  onAddAccount: () => void;
  onEditAccount: (account: PlatformAccount) => void;
  onRequestDelete: () => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const canSave =
    form.name.trim().length >= 2 &&
    form.slug.trim().length >= 2 &&
    (tab !== "administrator" ||
      (Boolean(business?.administrator?.id) &&
        form.adminName.trim().length >= 2 &&
        form.adminUsername.trim().length >= 3 &&
        (form.adminPassword.length === 0 || form.adminPassword.length >= 8)));
  return (
    <Dialog open={Boolean(business)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader><DialogTitle>Manage {business?.name || "workspace"}</DialogTitle><DialogDescription>Manage the business profile, workspace accounts, and administrator access.</DialogDescription></DialogHeader>
        <Tabs value={tab} onValueChange={(value) => setTab(value as ManageTab)}>
          <TabsList className="grid h-auto w-full grid-cols-3"><TabsTrigger className="min-h-11" value="profile">Profile</TabsTrigger><TabsTrigger className="min-h-11" value="accounts">Accounts</TabsTrigger><TabsTrigger className="min-h-11" value="administrator">Administrator</TabsTrigger></TabsList>
          <TabsContent value="profile" className="grid gap-5 py-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="edit-workspace-name">Organization name</Label><Input id="edit-workspace-name" className="h-11" value={form.name} onChange={(event) => updateForm("name", event.target.value)} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="edit-workspace-slug">Workspace ID</Label><Input id="edit-workspace-slug" className="h-11" value={form.slug} onChange={(event) => updateForm("slug", toSlug(event.target.value))} /><p className="text-xs text-muted-foreground">Unique lowercase platform identifier.</p></div>
            <div className="space-y-2"><Label>Business type</Label><Select value={form.businessType} onValueChange={(value) => updateForm("businessType", value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{BUSINESS_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Currency</Label><Select value={form.currency} onValueChange={(value) => updateForm("currency", value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Timezone</Label><Select value={form.timezone} onValueChange={(value) => updateForm("timezone", value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{TIMEZONES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="edit-workspace-telephone">Telephone</Label><Input id="edit-workspace-telephone" className="h-11" type="tel" value={form.telephone} onChange={(event) => updateForm("telephone", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="edit-workspace-mobile">Mobile</Label><Input id="edit-workspace-mobile" className="h-11" type="tel" value={form.mobilePhone} onChange={(event) => updateForm("mobilePhone", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="edit-workspace-email">Contact email</Label><Input id="edit-workspace-email" className="h-11" type="email" value={form.contactEmail} onChange={(event) => updateForm("contactEmail", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="edit-workspace-website">Website</Label><Input id="edit-workspace-website" className="h-11" type="url" value={form.website} onChange={(event) => updateForm("website", event.target.value)} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="edit-workspace-address">Address</Label><Input id="edit-workspace-address" className="h-11" value={form.address} onChange={(event) => updateForm("address", event.target.value)} /></div>
            <WorkspaceLogoUpload id="edit-workspace-logo" value={form.logoUrl} businessName={form.name} onChange={(value) => updateForm("logoUrl", value)} />
            <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-destructive">Delete business</p>
                <p className="text-sm text-muted-foreground">Permanently remove this business and all workspace-scoped accounts and data.</p>
              </div>
              <Button type="button" variant="destructive" className="h-11 shrink-0 gap-2" onClick={onRequestDelete}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />Delete business
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="accounts" className="space-y-4 py-4">
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">Business accounts</p>
                <p className="text-sm text-muted-foreground">Only users assigned to {business?.name || "this business"} are shown here.</p>
              </div>
              <Button className="h-11 gap-2" onClick={onAddAccount}>
                <UserPlus className="h-4 w-4" aria-hidden="true" />Add account
              </Button>
            </div>
            <WorkspaceAccountList accounts={accounts} onEditAccount={onEditAccount} />
          </TabsContent>
          <TabsContent value="administrator" className="grid gap-5 py-4 sm:grid-cols-2">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm sm:col-span-2">Workspace administrators can update their own name, email, PIN, and password. Changes made here update the same account record.</div>
            <div className="space-y-2"><Label htmlFor="edit-admin-name">Administrator name</Label><Input id="edit-admin-name" className="h-11" value={form.adminName} onChange={(event) => updateForm("adminName", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="edit-admin-username">Login username</Label><Input id="edit-admin-username" className="h-11" value={form.adminUsername} onChange={(event) => updateForm("adminUsername", event.target.value)} autoComplete="off" /></div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="edit-admin-pin">Administrator PIN</Label>
              <Input id="edit-admin-pin" className="h-11 font-mono tracking-widest" value={business?.administrator?.pin || "Not assigned"} readOnly />
            </div>
            <div className="sm:col-span-2"><PasswordField id="edit-admin-password" label="Administrator password" value={form.adminPassword} onChange={(value) => updateForm("adminPassword", value)} placeholder="At least 8 characters" helper="Use the eye button to view the saved password or enter a replacement." /></div>
          </TabsContent>
        </Tabs>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={onClose}>{tab === "accounts" ? "Close" : "Cancel"}</Button>
          {tab !== "accounts" && <Button className="h-11" onClick={onSave} disabled={!canSave || pending}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save changes</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type AccountForm = typeof EMPTY_ACCOUNT_FORM;

function AccountDialog({ open, account, businessLocked, businesses, form, setForm, error, pending, canSave, onOpenChange, onRequestDelete, onSave }: { open: boolean; account: PlatformAccount | null; businessLocked: boolean; businesses: ManagedBusiness[]; form: AccountForm; setForm: React.Dispatch<React.SetStateAction<AccountForm>>; error: string; pending: boolean; canSave: boolean; onOpenChange: (open: boolean) => void; onRequestDelete: () => void; onSave: () => void }) {
  const update = (field: keyof AccountForm, value: string | boolean) => setForm((current) => ({ ...current, [field]: value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{account ? "Manage workspace account" : "Create workspace account"}</DialogTitle><DialogDescription>{account ? "Update role, credentials, or account access. Saving signs this user out." : "Provision a user inside one workspace organization."}</DialogDescription></DialogHeader>
        <div className="grid gap-5 py-2 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><Label>Workspace organization</Label><Select value={form.businessId} onValueChange={(value) => update("businessId", value)} disabled={Boolean(account) || businessLocked}><SelectTrigger className="h-11"><SelectValue placeholder="Choose a workspace" /></SelectTrigger><SelectContent>{businesses.map((business) => <SelectItem key={business.id} value={String(business.id)}>{business.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label htmlFor="account-name">Display name</Label><Input id="account-name" className="h-11" value={form.name} onChange={(event) => update("name", event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="account-username">Login username</Label><Input id="account-username" className="h-11" value={form.username} onChange={(event) => update("username", event.target.value)} autoComplete="off" /></div>
          <div className="space-y-2"><Label htmlFor="account-email">Email</Label><Input id="account-email" className="h-11" type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></div>
          <div className="space-y-2"><Label>Workspace role</Label><Select value={form.role} onValueChange={(value) => update("role", value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{ACCOUNT_ROLES.map((role) => <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>)}</SelectContent></Select></div>
          {account && (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="account-pin">Account PIN</Label>
              <Input id="account-pin" className="h-11 font-mono tracking-widest" value={form.pin} onChange={(event) => update("pin", event.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="5-digit PIN" inputMode="numeric" />
              <p className="text-xs text-muted-foreground">Enter a unique five-digit PIN for authorized operations.</p>
            </div>
          )}
          <div className="sm:col-span-2"><PasswordField id="account-password" label={account ? "Account password" : "Temporary password"} value={form.password} onChange={(value) => update("password", value)} placeholder="At least 8 characters" helper={account ? "Use the eye button to view the saved password or enter a replacement." : undefined} /></div>
          <div className="flex min-h-14 items-center justify-between rounded-lg border p-3 sm:col-span-2"><div><Label htmlFor="account-active">Account access</Label><p className="text-xs text-muted-foreground">Inactive users cannot sign in.</p></div><Switch id="account-active" checked={form.active} onCheckedChange={(checked) => update("active", checked)} /></div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {account ? (
            <Button type="button" variant="destructive" className="h-11 gap-2" onClick={onRequestDelete} disabled={pending}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />Delete account
            </Button>
          ) : <span />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="h-11" onClick={onSave} disabled={!canSave || pending}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{account ? "Save account" : "Create account"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
