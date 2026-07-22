import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  CircleOff,
  Loader2,
  Mail,
  Pencil,
  Plus,
  ShieldCheck,
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

const EMPTY_FORM = {
  name: "",
  slug: "",
  contactEmail: "",
  phone: "",
  adminName: "",
  adminUsername: "",
  adminPassword: "",
};

const EMPTY_EDIT_FORM = {
  name: "",
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

function toSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export default function SuperAdmin() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [businessToEdit, setBusinessToEdit] = useState<ManagedBusiness | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [editError, setEditError] = useState("");

  const { data, isLoading, error } = useQuery<PlatformOverview>({
    queryKey: ["/api/super-admin/businesses"],
  });

  const businesses = data?.businesses || [];
  const accounts = data?.accounts || [];
  const businessNames = useMemo(
    () => new Map(businesses.map((business) => [business.id, business.name])),
    [businesses],
  );

  const createBusiness = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/super-admin/businesses", form);
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/businesses"] });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      setSlugTouched(false);
      setFormError("");
      toast({
        title: "Business created",
        description: result.message,
      });
    },
    onError: (mutationError) => {
      setFormError(extractApiErrorMessage(mutationError, "Failed to create the business"));
    },
  });

  const changeStatus = useMutation({
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
      toast({ title: "Business status updated", description: result.message });
    },
    onError: (mutationError) => {
      toast({
        title: "Status update failed",
        description: extractApiErrorMessage(mutationError),
        variant: "destructive",
      });
    },
  });

  const updateBusiness = useMutation({
    mutationFn: async () => {
      if (!businessToEdit) throw new Error("Choose a business to update");
      const response = await apiRequest(
        "PUT",
        `/api/super-admin/businesses/${businessToEdit.id}`,
        {
          ...editForm,
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
      toast({ title: "Business updated", description: result.message });
    },
    onError: (mutationError) => {
      setEditError(extractApiErrorMessage(mutationError, "Failed to update the business"));
    },
  });

  const updateForm = (field: keyof typeof EMPTY_FORM, value: string) => {
    setFormError("");
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "name" && !slugTouched) {
        next.slug = toSlug(value);
      }
      return next;
    });
  };

  const canCreate =
    form.name.trim().length >= 2 &&
    form.slug.trim().length >= 2 &&
    form.adminName.trim().length >= 2 &&
    form.adminUsername.trim().length >= 3 &&
    form.adminPassword.length >= 8;

  const openBusinessEditor = (business: ManagedBusiness) => {
    setBusinessToEdit(business);
    setEditError("");
    setEditForm({
      name: business.name,
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

  const updateEditForm = (field: keyof typeof EMPTY_EDIT_FORM, value: string | boolean) => {
    setEditError("");
    setEditForm((current) => ({ ...current, [field]: value }));
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" aria-label="Loading platform accounts" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
            <ShieldCheck className="h-4 w-4" />
            Platform owner
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground lg:text-3xl">
            Multi-business administration
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Create laundry businesses and review every account from one protected workspace.
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="h-11 gap-2" data-testid="button-create-business">
              <Plus className="h-4 w-4" />
              Add business
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>Create a laundry business</DialogTitle>
              <DialogDescription>
                This creates the tenant and its first administrator account together.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-5 py-2 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="business-name">Business name</Label>
                <Input
                  id="business-name"
                  value={form.name}
                  onChange={(event) => updateForm("name", event.target.value)}
                  placeholder="Downtown Laundry"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="business-slug">Business ID</Label>
                <Input
                  id="business-slug"
                  value={form.slug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    updateForm("slug", toSlug(event.target.value));
                  }}
                  placeholder="downtown-laundry"
                />
                <p className="text-xs text-muted-foreground">Permanent lowercase identifier.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="business-phone">Phone</Label>
                <Input
                  id="business-phone"
                  value={form.phone}
                  onChange={(event) => updateForm("phone", event.target.value)}
                  placeholder="+971 ..."
                  type="tel"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="business-email">Business email</Label>
                <Input
                  id="business-email"
                  value={form.contactEmail}
                  onChange={(event) => updateForm("contactEmail", event.target.value)}
                  placeholder="office@example.com"
                  type="email"
                />
              </div>

              <div className="border-t pt-5 sm:col-span-2">
                <h2 className="font-semibold text-foreground">Initial administrator</h2>
                <p className="text-xs text-muted-foreground">This person manages only the new business.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-name">Administrator name</Label>
                <Input
                  id="admin-name"
                  value={form.adminName}
                  onChange={(event) => updateForm("adminName", event.target.value)}
                  placeholder="Manager name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-username">Login username</Label>
                <Input
                  id="admin-username"
                  value={form.adminUsername}
                  onChange={(event) => updateForm("adminUsername", event.target.value)}
                  placeholder="downtown.admin"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="admin-password">Temporary password</Label>
                <Input
                  id="admin-password"
                  value={form.adminPassword}
                  onChange={(event) => updateForm("adminPassword", event.target.value)}
                  placeholder="At least 8 characters"
                  type="password"
                  autoComplete="new-password"
                />
              </div>
            </div>

            {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={() => createBusiness.mutate()}
                disabled={!canCreate || createBusiness.isPending}
              >
                {createBusiness.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create business
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog
        open={Boolean(businessToEdit)}
        onOpenChange={(open) => {
          if (!open) {
            setBusinessToEdit(null);
            setEditError("");
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Manage {businessToEdit?.name || "business"}</DialogTitle>
            <DialogDescription>
              Only the super admin can change business credentials and SMTP configuration.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-business-name">Business name</Label>
              <Input id="edit-business-name" value={editForm.name} onChange={(event) => updateEditForm("name", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-business-email">Business email</Label>
              <Input id="edit-business-email" type="email" value={editForm.contactEmail} onChange={(event) => updateEditForm("contactEmail", event.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="edit-business-phone">Phone</Label>
              <Input id="edit-business-phone" type="tel" value={editForm.phone} onChange={(event) => updateEditForm("phone", event.target.value)} />
            </div>

            <div className="border-t pt-5 sm:col-span-2">
              <h2 className="font-semibold">Business administrator credentials</h2>
              <p className="text-xs text-muted-foreground">The business administrator cannot edit these values.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-admin-name">Administrator name</Label>
              <Input id="edit-admin-name" value={editForm.adminName} onChange={(event) => updateEditForm("adminName", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-admin-username">Login username</Label>
              <Input id="edit-admin-username" value={editForm.adminUsername} onChange={(event) => updateEditForm("adminUsername", event.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="edit-admin-password">New password</Label>
              <Input id="edit-admin-password" type="password" value={editForm.adminPassword} onChange={(event) => updateEditForm("adminPassword", event.target.value)} placeholder="Leave blank to keep the current password" autoComplete="new-password" />
              <p className="text-xs text-muted-foreground">Use at least 8 characters when resetting the password.</p>
            </div>

            <div className="border-t pt-5 sm:col-span-2">
              <h2 className="font-semibold">SMTP configuration</h2>
              <p className="text-xs text-muted-foreground">Encrypted and available only to the super-admin service.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-host">SMTP host</Label>
              <Input id="smtp-host" value={editForm.smtpHost} onChange={(event) => updateEditForm("smtpHost", event.target.value)} placeholder="smtp.example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-port">Port</Label>
              <Input id="smtp-port" type="number" min={1} max={65535} value={editForm.smtpPort} onChange={(event) => updateEditForm("smtpPort", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-user">SMTP username</Label>
              <Input id="smtp-user" value={editForm.smtpUser} onChange={(event) => updateEditForm("smtpUser", event.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-from">From address</Label>
              <Input id="smtp-from" type="email" value={editForm.smtpFrom} onChange={(event) => updateEditForm("smtpFrom", event.target.value)} placeholder="reports@example.com" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="smtp-password">SMTP password</Label>
              <Input id="smtp-password" type="password" value={editForm.smtpPassword} onChange={(event) => updateEditForm("smtpPassword", event.target.value)} placeholder={businessToEdit?.smtpPasswordSet ? "Password saved — leave blank to keep it" : "Enter SMTP password"} autoComplete="new-password" />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3 sm:col-span-2">
              <div><Label htmlFor="smtp-secure">Secure SMTP</Label><p className="text-xs text-muted-foreground">Enable for TLS-on-connect servers, commonly port 465.</p></div>
              <Switch id="smtp-secure" checked={editForm.smtpSecure} onCheckedChange={(checked) => updateEditForm("smtpSecure", checked)} />
            </div>
          </div>

          {editError && <p className="text-sm text-destructive" role="alert">{editError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBusinessToEdit(null)}>Cancel</Button>
            <Button
              onClick={() => updateBusiness.mutate()}
              disabled={
                updateBusiness.isPending ||
                editForm.name.trim().length < 2 ||
                editForm.adminName.trim().length < 2 ||
                editForm.adminUsername.trim().length < 3 ||
                (editForm.adminPassword.length > 0 && editForm.adminPassword.length < 8)
              }
            >
              {updateBusiness.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
          {extractApiErrorMessage(error, "Unable to load platform accounts")}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-xl bg-primary/10 p-3"><Building2 className="h-5 w-5 text-primary" /></div>
            <div><p className="text-2xl font-bold">{businesses.length}</p><p className="text-xs text-muted-foreground">Businesses</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-xl bg-emerald-500/10 p-3"><CheckCircle2 className="h-5 w-5 text-emerald-600" /></div>
            <div><p className="text-2xl font-bold">{businesses.filter((item) => item.active).length}</p><p className="text-xs text-muted-foreground">Active businesses</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-xl bg-sky-500/10 p-3"><Users className="h-5 w-5 text-sky-600" /></div>
            <div><p className="text-2xl font-bold">{accounts.length}</p><p className="text-xs text-muted-foreground">All accounts</p></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Businesses</CardTitle>
          <CardDescription>Tenant status, primary administrator, SMTP readiness, and account totals.</CardDescription>
        </CardHeader>
        <CardContent>
          {businesses.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-medium">No businesses yet</p>
              <p className="text-sm text-muted-foreground">Add the first laundry business to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Business</TableHead><TableHead>Administrator</TableHead><TableHead>Accounts</TableHead><TableHead>Email</TableHead><TableHead>Manage</TableHead><TableHead className="text-right">Active</TableHead></TableRow></TableHeader>
                <TableBody>
                  {businesses.map((business) => (
                    <TableRow key={business.id}>
                      <TableCell><p className="font-semibold">{business.name}</p><p className="text-xs text-muted-foreground">{business.slug}</p></TableCell>
                      <TableCell><p>{business.administrator?.name || "Not assigned"}</p><p className="text-xs text-muted-foreground">{business.administrator?.username || "—"}</p></TableCell>
                      <TableCell>{business.accountCount}</TableCell>
                      <TableCell><Badge variant={business.smtpConfigured ? "default" : "outline"}>{business.smtpConfigured ? "SMTP ready" : "Not configured"}</Badge></TableCell>
                      <TableCell><Button variant="outline" size="sm" className="gap-2" onClick={() => openBusinessEditor(business)}><Pencil className="h-3.5 w-3.5" />Edit</Button></TableCell>
                      <TableCell className="text-right">
                        <Switch
                          checked={business.active}
                          onCheckedChange={(active) => changeStatus.mutate({ id: business.id, active })}
                          disabled={changeStatus.isPending}
                          aria-label={`${business.active ? "Suspend" : "Activate"} ${business.name}`}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All created accounts</CardTitle>
          <CardDescription>Platform and business users. Passwords and PINs are never displayed.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Business</TableHead><TableHead>Role</TableHead><TableHead>Contact</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell><p className="font-medium">{account.name || account.username}</p><p className="text-xs text-muted-foreground">{account.username}</p></TableCell>
                    <TableCell>{account.businessId ? businessNames.get(account.businessId) || "Unknown business" : "Platform"}</TableCell>
                    <TableCell><Badge variant="secondary" className="capitalize">{account.role.replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell>{account.email ? <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{account.email}</span> : "—"}</TableCell>
                    <TableCell>{account.active ? <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-4 w-4" />Active</span> : <span className="inline-flex items-center gap-1.5 text-muted-foreground"><CircleOff className="h-4 w-4" />Inactive</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
