import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  GitBranch,
  KeyRound,
  Loader2,
  Network,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  apiRequest,
  extractApiErrorMessage,
  queryClient,
} from "@/lib/queryClient";

type UnitType = "branch" | "department" | "team";
type OperationalRole = "manager" | "counter" | "production" | "driver";

type OrganizationUnit = {
  id: number;
  publicKey: string;
  name: string;
  unitType: UnitType;
  parentId: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type StaffProfile = {
  id: number;
  publicKey: string;
  organizationUnitId: number | null;
  managerStaffId: number | null;
  displayName: string;
  jobTitle: string | null;
  operationalRole: OperationalRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type UnitFormState = {
  name: string;
  unitType: UnitType;
  parentId: string;
  active: boolean;
};

type StaffFormState = {
  displayName: string;
  jobTitle: string;
  operationalRole: OperationalRole;
  organizationUnitId: string;
  managerStaffId: string;
  activityPin: string;
  active: boolean;
};

const emptyUnitForm: UnitFormState = {
  name: "",
  unitType: "branch",
  parentId: "none",
  active: true,
};

const emptyStaffForm: StaffFormState = {
  displayName: "",
  jobTitle: "",
  operationalRole: "counter",
  organizationUnitId: "none",
  managerStaffId: "none",
  activityPin: "",
  active: true,
};

const roleLabels: Record<OperationalRole, string> = {
  manager: "Manager",
  counter: "Counter",
  production: "Production",
  driver: "Driver",
};

const unitTypeLabels: Record<UnitType, string> = {
  branch: "Branch",
  department: "Department",
  team: "Team",
};

const roleBadgeClass: Record<OperationalRole, string> = {
  manager: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  counter: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  production: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  driver: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
};

function optionalId(value: string) {
  return value === "none" ? null : Number(value);
}

function unitIcon(unitType: UnitType) {
  if (unitType === "branch") return Building2;
  if (unitType === "department") return Network;
  return UsersRound;
}

export default function StaffHierarchyPanel() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState<number | "all">("all");
  const [roleFilter, setRoleFilter] = useState<OperationalRole | "all">("all");
  const [unitEditor, setUnitEditor] = useState<OrganizationUnit | "new" | null>(null);
  const [staffEditor, setStaffEditor] = useState<StaffProfile | "new" | null>(null);
  const [unitForm, setUnitForm] = useState<UnitFormState>(emptyUnitForm);
  const [staffForm, setStaffForm] = useState<StaffFormState>(emptyStaffForm);

  const {
    data: units = [],
    isLoading: unitsLoading,
    error: unitsError,
  } = useQuery<OrganizationUnit[]>({ queryKey: ["/api/organization-units"] });
  const {
    data: staff = [],
    isLoading: staffLoading,
    error: staffError,
  } = useQuery<StaffProfile[]>({ queryKey: ["/api/staff-profiles"] });

  const unitsById = useMemo(
    () => new Map(units.map((unit) => [unit.id, unit])),
    [units],
  );
  const staffById = useMemo(
    () => new Map(staff.map((profile) => [profile.id, profile])),
    [staff],
  );

  const descendantUnitIds = useMemo(() => {
    if (selectedUnitId === "all") return null;
    const collected = new Set<number>([selectedUnitId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const unit of units) {
        if (unit.parentId && collected.has(unit.parentId) && !collected.has(unit.id)) {
          collected.add(unit.id);
          changed = true;
        }
      }
    }
    return collected;
  }, [selectedUnitId, units]);

  const visibleStaff = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return staff.filter((profile) => {
      if (
        descendantUnitIds &&
        (!profile.organizationUnitId || !descendantUnitIds.has(profile.organizationUnitId))
      ) {
        return false;
      }
      if (roleFilter !== "all" && profile.operationalRole !== roleFilter) return false;
      if (!normalizedSearch) return true;
      const unitName = profile.organizationUnitId
        ? unitsById.get(profile.organizationUnitId)?.name || ""
        : "";
      return [profile.displayName, profile.jobTitle, unitName, roleLabels[profile.operationalRole]]
        .some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
    });
  }, [descendantUnitIds, roleFilter, search, staff, unitsById]);

  const refreshHierarchy = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/organization-units"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/staff-profiles"] }),
    ]);
  };

  const saveUnit = useMutation({
    mutationFn: async () => {
      const payload = {
        name: unitForm.name.trim(),
        unitType: unitForm.unitType,
        parentId: optionalId(unitForm.parentId),
        active: unitForm.active,
      };
      const editing = unitEditor !== null && unitEditor !== "new";
      return apiRequest(
        editing ? "PUT" : "POST",
        editing ? `/api/organization-units/${unitEditor.id}` : "/api/organization-units",
        payload,
      );
    },
    onSuccess: async () => {
      await refreshHierarchy();
      setUnitEditor(null);
      toast({ title: "Organization updated", description: "The business hierarchy is now up to date." });
    },
    onError: (error) => {
      toast({
        title: "Could not save organization unit",
        description: extractApiErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const saveStaff = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        displayName: staffForm.displayName.trim(),
        jobTitle: staffForm.jobTitle.trim() || null,
        operationalRole: staffForm.operationalRole,
        organizationUnitId: optionalId(staffForm.organizationUnitId),
        managerStaffId: optionalId(staffForm.managerStaffId),
        active: staffForm.active,
      };
      if (staffForm.activityPin) payload.activityPin = staffForm.activityPin;
      const editing = staffEditor !== null && staffEditor !== "new";
      return apiRequest(
        editing ? "PUT" : "POST",
        editing ? `/api/staff-profiles/${staffEditor.id}` : "/api/staff-profiles",
        payload,
      );
    },
    onSuccess: async () => {
      await refreshHierarchy();
      setStaffEditor(null);
      toast({ title: "Staff profile saved", description: "The staff directory has been updated." });
    },
    onError: (error) => {
      toast({
        title: "Could not save staff profile",
        description: extractApiErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const deactivateUnit = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/organization-units/${id}`),
    onSuccess: async () => {
      await refreshHierarchy();
      toast({ title: "Unit removed", description: "Referenced units are retained as inactive for history." });
    },
    onError: (error) => {
      toast({ title: "Could not remove unit", description: extractApiErrorMessage(error), variant: "destructive" });
    },
  });

  const deactivateStaff = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/staff-profiles/${id}`),
    onSuccess: async () => {
      await refreshHierarchy();
      toast({ title: "Staff profile removed", description: "Historical activity remains attributed correctly." });
    },
    onError: (error) => {
      toast({ title: "Could not remove staff profile", description: extractApiErrorMessage(error), variant: "destructive" });
    },
  });

  const openNewUnit = () => {
    setUnitForm({ ...emptyUnitForm, parentId: selectedUnitId === "all" ? "none" : String(selectedUnitId) });
    setUnitEditor("new");
  };

  const openUnitEditor = (unit: OrganizationUnit) => {
    setUnitForm({
      name: unit.name,
      unitType: unit.unitType,
      parentId: unit.parentId ? String(unit.parentId) : "none",
      active: unit.active,
    });
    setUnitEditor(unit);
  };

  const openNewStaff = () => {
    setStaffForm({
      ...emptyStaffForm,
      organizationUnitId: selectedUnitId === "all" ? "none" : String(selectedUnitId),
    });
    setStaffEditor("new");
  };

  const openStaffEditor = (profile: StaffProfile) => {
    setStaffForm({
      displayName: profile.displayName,
      jobTitle: profile.jobTitle || "",
      operationalRole: profile.operationalRole,
      organizationUnitId: profile.organizationUnitId
        ? String(profile.organizationUnitId)
        : "none",
      managerStaffId: profile.managerStaffId ? String(profile.managerStaffId) : "none",
      activityPin: "",
      active: profile.active,
    });
    setStaffEditor(profile);
  };

  const renderUnitTree = (parentId: number | null, depth = 0): JSX.Element[] =>
    units
      .filter((unit) => unit.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((unit) => {
        const Icon = unitIcon(unit.unitType);
        const memberCount = staff.filter((profile) => profile.organizationUnitId === unit.id).length;
        return [
          <div key={unit.id}>
            <div
              className={`group flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors ${
                selectedUnitId === unit.id
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-transparent hover:border-border hover:bg-muted/50"
              } ${!unit.active ? "opacity-55" : ""}`}
              style={{ marginLeft: `${Math.min(depth, 4) * 12}px` }}
            >
              {depth > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setSelectedUnitId(unit.id)}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate text-sm font-medium">{unit.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{memberCount}</span>
              </button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                onClick={() => openUnitEditor(unit)}
                aria-label={`Edit ${unit.name}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
            {renderUnitTree(unit.id, depth + 1)}
          </div>,
        ];
      });

  const isLoading = unitsLoading || staffLoading;
  const loadError = unitsError || staffError;
  const selectedUnit = selectedUnitId === "all" ? null : unitsById.get(selectedUnitId);

  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-2xl border bg-card">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <span className="ml-3 text-sm text-muted-foreground">Loading staff structure…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="py-10 text-center">
          <p className="font-medium text-destructive">The staff directory could not be loaded.</p>
          <p className="mt-1 text-sm text-muted-foreground">{extractApiErrorMessage(loadError)}</p>
          <Button className="mt-4" variant="outline" onClick={refreshHierarchy}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-emerald-50/70 p-4 dark:border-blue-900 dark:from-blue-950/40 dark:to-emerald-950/20">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-300" />
          <div>
            <p className="font-semibold text-blue-950 dark:text-blue-100">Staff profiles are separate from login accounts</p>
            <p className="mt-1 text-sm leading-6 text-blue-800/80 dark:text-blue-200/80">
              Manage branches, teams, reporting lines, and activity PINs here. Usernames and passwords are controlled only by the Super Admin.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Active staff", value: staff.filter((item) => item.active).length, icon: UsersRound },
          { label: "Managers", value: staff.filter((item) => item.active && item.operationalRole === "manager").length, icon: UserRoundCog },
          { label: "Branches", value: units.filter((item) => item.active && item.unitType === "branch").length, icon: Building2 },
          { label: "Departments & teams", value: units.filter((item) => item.active && item.unitType !== "branch").length, icon: Network },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="rounded-2xl shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-xl bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div>
              <div><p className="text-2xl font-semibold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="space-y-3 pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-primary" />Business structure</CardTitle>
              <Button size="sm" variant="outline" onClick={openNewUnit}><Plus className="mr-1 h-3.5 w-3.5" />Unit</Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">Build a hierarchy of branches, departments, and teams. Nothing is created automatically.</p>
          </CardHeader>
          <CardContent className="space-y-1 pt-0">
            <button
              type="button"
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedUnitId === "all" ? "border-primary/30 bg-primary/10 text-primary" : "border-transparent hover:bg-muted/50"}`}
              onClick={() => setSelectedUnitId("all")}
            >
              <CircleUserRound className="h-4 w-4" />All staff<span className="ml-auto text-xs text-muted-foreground">{staff.length}</span>
            </button>
            {units.length > 0 ? renderUnitTree(null) : (
              <div className="rounded-xl border border-dashed p-5 text-center">
                <Network className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">No business units yet</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Start with a branch, then add departments or teams.</p>
                <Button className="mt-3" size="sm" onClick={openNewUnit}><Plus className="mr-1 h-3.5 w-3.5" />Add first unit</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 rounded-2xl shadow-sm">
          <CardHeader className="space-y-4 pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">{selectedUnit?.name || "Staff directory"}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">{selectedUnit ? `${unitTypeLabels[selectedUnit.unitType]} and all nested units` : "Every operational staff profile in this business"}</p>
              </div>
              <Button onClick={openNewStaff}><Plus className="mr-2 h-4 w-4" />Add staff member</Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, title, role, or team" aria-label="Search staff" />
              </div>
              <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as OperationalRole | "all")}>
                <SelectTrigger className="sm:w-44" aria-label="Filter by role"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All roles</SelectItem>{Object.entries(roleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {visibleStaff.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center">
                <UsersRound className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-3 font-medium">{staff.length === 0 ? "No staff profiles yet" : "No staff match these filters"}</p>
                <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{staff.length === 0 ? "Add real staff members when this business is ready. No placeholder names or shared credentials will be generated." : "Try another unit, role, or search term."}</p>
                {staff.length === 0 && <Button className="mt-4" onClick={openNewStaff}><Plus className="mr-2 h-4 w-4" />Add first staff member</Button>}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader><TableRow><TableHead>Staff member</TableHead><TableHead>Role</TableHead><TableHead>Unit</TableHead><TableHead>Reports to</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {visibleStaff.map((profile) => {
                      const unit = profile.organizationUnitId ? unitsById.get(profile.organizationUnitId) : null;
                      const manager = profile.managerStaffId ? staffById.get(profile.managerStaffId) : null;
                      return (
                        <TableRow key={profile.id} className={!profile.active ? "opacity-60" : undefined}>
                          <TableCell><div className="min-w-40"><p className="font-medium">{profile.displayName}</p><p className="text-xs text-muted-foreground">{profile.jobTitle || "No job title"}</p></div></TableCell>
                          <TableCell><Badge variant="outline" className={roleBadgeClass[profile.operationalRole]}>{roleLabels[profile.operationalRole]}</Badge></TableCell>
                          <TableCell className="text-sm">{unit?.name || <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                          <TableCell className="text-sm">{manager?.displayName || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell>{profile.active ? <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700"><CheckCircle2 className="mr-1 h-3 w-3" />Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                          <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => openStaffEditor(profile)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={unitEditor !== null} onOpenChange={(open) => !open && setUnitEditor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{unitEditor === "new" ? "Add organization unit" : "Edit organization unit"}</DialogTitle><DialogDescription>Place this branch, department, or team within the current business.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2"><Label htmlFor="unit-name">Name</Label><Input id="unit-name" value={unitForm.name} onChange={(event) => setUnitForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Downtown Branch" autoFocus /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Unit type</Label><Select value={unitForm.unitType} onValueChange={(value) => setUnitForm((current) => ({ ...current, unitType: value as UnitType }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(unitTypeLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Parent unit</Label><Select value={unitForm.parentId} onValueChange={(value) => setUnitForm((current) => ({ ...current, parentId: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Top level</SelectItem>{units.filter((unit) => unitEditor === "new" || unitEditor === null || unit.id !== unitEditor.id).map((unit) => <SelectItem key={unit.id} value={String(unit.id)}>{unit.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3"><div><Label htmlFor="unit-active">Active</Label><p className="text-xs text-muted-foreground">Inactive units stay visible in historical records.</p></div><Switch id="unit-active" checked={unitForm.active} onCheckedChange={(active) => setUnitForm((current) => ({ ...current, active }))} /></div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {unitEditor !== "new" && unitEditor && <Button type="button" variant="destructive" onClick={() => { if (window.confirm(`Remove ${unitEditor.name}? Referenced units will be made inactive.`)) { deactivateUnit.mutate(unitEditor.id); setUnitEditor(null); } }}>Remove unit</Button>}
            <div className="flex gap-2 sm:ml-auto"><Button variant="outline" onClick={() => setUnitEditor(null)}>Cancel</Button><Button onClick={() => saveUnit.mutate()} disabled={!unitForm.name.trim() || saveUnit.isPending}>{saveUnit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save unit</Button></div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={staffEditor !== null} onOpenChange={(open) => !open && setStaffEditor(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>{staffEditor === "new" ? "Add staff profile" : "Edit staff profile"}</DialogTitle><DialogDescription>This is an operational profile, not a login account. Login credentials remain in the Super Admin console.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="staff-name">Display name</Label><Input id="staff-name" value={staffForm.displayName} onChange={(event) => setStaffForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="Full name" autoFocus /></div>
              <div className="space-y-2"><Label htmlFor="staff-title">Job title</Label><Input id="staff-title" value={staffForm.jobTitle} onChange={(event) => setStaffForm((current) => ({ ...current, jobTitle: event.target.value }))} placeholder="Optional" /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Operational role</Label><Select value={staffForm.operationalRole} onValueChange={(value) => setStaffForm((current) => ({ ...current, operationalRole: value as OperationalRole }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(roleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Organization unit</Label><Select value={staffForm.organizationUnitId} onValueChange={(value) => setStaffForm((current) => ({ ...current, organizationUnitId: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{units.filter((unit) => unit.active).map((unit) => <SelectItem key={unit.id} value={String(unit.id)}>{unit.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Reports to</Label><Select value={staffForm.managerStaffId} onValueChange={(value) => setStaffForm((current) => ({ ...current, managerStaffId: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No manager</SelectItem>{staff.filter((profile) => profile.active && (staffEditor === "new" || staffEditor === null || profile.id !== staffEditor.id)).map((profile) => <SelectItem key={profile.id} value={String(profile.id)}>{profile.displayName}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor="staff-pin" className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" />Activity PIN</Label><Input id="staff-pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={5} value={staffForm.activityPin} onChange={(event) => setStaffForm((current) => ({ ...current, activityPin: event.target.value.replace(/\D/g, "").slice(0, 5) }))} placeholder={staffEditor === "new" ? "Optional 5 digits" : "Leave blank to keep"} /><p className="text-xs text-muted-foreground">PINs are hashed and never shown after saving.</p></div>
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3"><div><Label htmlFor="staff-active">Active staff member</Label><p className="text-xs text-muted-foreground">Inactive profiles cannot verify activity.</p></div><Switch id="staff-active" checked={staffForm.active} onCheckedChange={(active) => setStaffForm((current) => ({ ...current, active }))} /></div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {staffEditor !== "new" && staffEditor && <Button type="button" variant="destructive" onClick={() => { if (window.confirm(`Remove ${staffEditor.displayName}? Historical activity will be preserved.`)) { deactivateStaff.mutate(staffEditor.id); setStaffEditor(null); } }}>Remove profile</Button>}
            <div className="flex gap-2 sm:ml-auto"><Button variant="outline" onClick={() => setStaffEditor(null)}>Cancel</Button><Button onClick={() => saveStaff.mutate()} disabled={!staffForm.displayName.trim() || (staffForm.activityPin.length > 0 && staffForm.activityPin.length !== 5) || saveStaff.isPending}>{saveStaff.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save profile</Button></div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
