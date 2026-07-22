import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, UserCheck, Building2, MapPin, Plus, Trash2 } from "lucide-react";
import { InternationalPhoneInput } from "@/components/InternationalPhoneInput";
import { useCreateClient, useUpdateClient } from "@/hooks/use-clients";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Client, CreateClientRequest } from "@shared/schema";
import { isPlausiblePhoneNumber, normalizePhoneForStorage } from "@shared/phone";

interface ClientFormProps {
  mode: "create" | "edit";
  client?: Client;
  onSuccess?: (updatedClient?: Client) => void;
}

type ClientFormValues = {
  name: string;
  address: string;
  phone: string;
  amount: string;
  deposit: string;
  balance: string;
  notes: string;
  billNumber: string;
  preferredPaymentMethod: string;
  discountPercent: string;
  company: string;
  clientType: string;
};

export function ClientForm({ mode, client, onSuccess }: ClientFormProps) {
  const { toast } = useToast();
  const { mutate: createClient, isPending: isCreating } = useCreateClient();
  const { mutate: updateClient, isPending: isUpdating } = useUpdateClient();
  const [existingClient, setExistingClient] = useState<Client | null>(null);
  const [showAddBillMode, setShowAddBillMode] = useState(false);
  const [newBrokerAddr, setNewBrokerAddr] = useState("");
  const [brokerAddresses, setBrokerAddresses] = useState<string[]>(((client as any)?.brokerAddresses || []) as string[]);
  const { data: companiesList } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/companies"],
  });

  const form = useForm<ClientFormValues>({
    defaultValues: {
      name: client?.name || "",
      address: client?.address || "",
      phone: client?.phone || "",
      amount: client?.amount || "0",
      deposit: client?.deposit || "0",
      balance: client?.balance || "0",
      notes: client?.notes || "",
      billNumber: client?.billNumber || "",
      preferredPaymentMethod: client?.preferredPaymentMethod || "cash",
      discountPercent: client?.discountPercent || "0",
      company: client?.company || "",
      clientType: (client as any)?.clientType || "regular",
    },
  });

  const watchName = form.watch("name");
  const watchPhone = form.watch("phone");
  const watchAmount = form.watch("amount");
  const watchDeposit = form.watch("deposit");
  const watchCompany = form.watch("company");
  const watchClientType = form.watch("clientType");
  const isBrokerType = (watchClientType || '').trim().toLowerCase() === 'broker';
  const hasCompany = !!(watchCompany && watchCompany.trim() !== "");

  const checkDuplicate = useCallback(async (name: string, phone: string) => {
    if (!name || !isPlausiblePhoneNumber(phone) || mode === "edit") return;
    try {
      const response = await fetch("/api/clients/check-duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });
      const data = await response.json();
      if (data.exists && data.client) {
        setExistingClient(data.client);
      } else {
        setExistingClient(null);
        setShowAddBillMode(false);
      }
    } catch (err) {
      setExistingClient(null);
    }
  }, [mode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (watchName && isPlausiblePhoneNumber(watchPhone)) {
        checkDuplicate(watchName.trim(), watchPhone.trim());
      } else {
        setExistingClient(null);
        setShowAddBillMode(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [watchName, watchPhone, checkDuplicate]);

  useEffect(() => {
    const amt = parseFloat(watchAmount || "0");
    const dep = parseFloat(watchDeposit || "0");
    const bal = (amt - dep).toFixed(2);
    form.setValue("balance", bal);
  }, [watchAmount, watchDeposit, form]);

  useEffect(() => {
    setBrokerAddresses((((client as any)?.brokerAddresses || []) as string[]));
  }, [client]);

  const syncClientInCache = useCallback((updatedClient: Client) => {
    queryClient.setQueriesData(
      { queryKey: ["/api/clients"] },
      (oldData: unknown) => {
        if (!Array.isArray(oldData)) return oldData;
        return oldData.map((existingClient) =>
          existingClient.id === updatedClient.id ? updatedClient : existingClient,
        );
      },
    );
    setBrokerAddresses((((updatedClient as any)?.brokerAddresses || []) as string[]));
  }, []);

  const addBillMutation = useMutation({
    mutationFn: async ({ clientId, amount, description }: { clientId: number; amount: string; description: string }) => {
      return await apiRequest("POST", `/api/clients/${clientId}/bill`, { amount, description });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Bill Added",
        description: `New bill added to ${existingClient?.name}`,
      });
      onSuccess?.();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add bill",
        variant: "destructive",
      });
    },
  });

  const handleAddBillToExisting = () => {
    if (!existingClient) return;
    const amount = form.getValues("amount");
    const billNumber = form.getValues("billNumber");
    addBillMutation.mutate({
      clientId: existingClient.id,
      amount: amount || "0",
      description: billNumber ? `Bill #${billNumber}` : "New bill",
    });
  };

  const onSubmit = form.handleSubmit((data) => {
    if (existingClient && !showAddBillMode) {
      return;
    }

    const normalizedName = data.name?.trim() || "";
    const normalizedCompany = data.company?.trim() || "";

    if (mode === "create" && normalizedName === "" && normalizedCompany === "") {
      toast({
        title: "Missing Information",
        description: "Please enter the client's name or assign a company.",
        variant: "destructive",
      });
      return;
    }

    const amount = parseFloat(data.amount || "0");
    const deposit = parseFloat(data.deposit || "0");
    const balance = (amount - deposit).toFixed(2);
    // Treat dial-code-only placeholders like "+971" as blank optional phones.
    const normalizedPhone = normalizePhoneForStorage(data.phone);

    if (normalizedPhone && !isPlausiblePhoneNumber(normalizedPhone)) {
      toast({
        title: "Invalid Phone Number",
        description: "Enter a valid phone number with the correct country code, or leave it blank.",
        variant: "destructive",
      });
      return;
    }
    
    const payload: CreateClientRequest = {
      ...data,
      name: normalizedName.toUpperCase(),
      address: data.address?.trim().toUpperCase() || "",
      phone: normalizedPhone,
      company: normalizedCompany,
      notes: data.notes?.trim() || "",
      amount: amount.toFixed(2),
      deposit: deposit.toFixed(2),
      balance: balance,
    };
    
    if (mode === "create") {
      createClient(payload, {
        onSuccess: () => {
          toast({
            title: "Client added",
            description: `${data.name} has been added successfully.`,
          });
          onSuccess?.();
        },
        onError: (error) => {
          toast({
            title: "Error",
            description: error.message || "Failed to add client",
            variant: "destructive",
          });
        },
      });
    } else if (client) {
      updateClient(
        { id: client.id, data: payload },
        {
          onSuccess: (updatedClient) => {
            queryClient.setQueriesData(
              { queryKey: ["/api/clients"] },
              (oldData: unknown) => {
                if (!Array.isArray(oldData)) return oldData;
                return oldData.map((c: Client) => c.id === updatedClient.id ? updatedClient : c);
              }
            );
            queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
            queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
            queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
            toast({
              title: "Client updated",
              description: `${data.name} has been updated successfully.`,
            });
            onSuccess?.(updatedClient);
          },
          onError: (error) => {
            toast({
              title: "Error",
              description: error.message || "Failed to update client",
              variant: "destructive",
            });
          },
        }
      );
    }
  });

  const isPending = isCreating || isUpdating || addBillMutation.isPending;

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Client Name {!hasCompany && "*"}</FormLabel>
              <FormControl>
                <Input placeholder="Enter client name" {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} className="uppercase" data-testid="input-name" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Input placeholder={isBrokerType ? "Optional - brokers use per-order addresses" : "Enter address"} {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} className="uppercase" data-testid="input-address" />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                Leave this blank if the address is not available yet.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="company"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5" />
                Company Name
              </FormLabel>
              <FormControl>
                <select
                  value={field.value || ""}
                  onChange={(e) => field.onChange(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  data-testid="select-company"
                >
                  <option value="">No Company</option>
                  {companiesList?.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="clientType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Client Type</FormLabel>
              <FormControl>
                <select
                  value={field.value || "regular"}
                  onChange={(e) => field.onChange(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  data-testid="select-client-type"
                >
                  <option value="regular">Regular</option>
                  <option value="broker">Broker</option>
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {isBrokerType && mode === "edit" && client && (
          <div className="space-y-2 border rounded-lg p-3 bg-violet-50/50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800">
            <Label className="text-xs font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              Saved Delivery Addresses
            </Label>
            <>
              {brokerAddresses.length === 0 && (
                <p className="text-xs text-muted-foreground">No saved addresses yet. Addresses are saved when creating orders.</p>
              )}
              {brokerAddresses.map((addr, idx) => (
                <div key={idx} className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-background text-xs">
                  <MapPin className="w-3 h-3 flex-shrink-0 text-violet-500" />
                  <span className="flex-1 truncate">{addr}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    onClick={async () => {
                      try {
                        const response = await apiRequest("DELETE", `/api/clients/${client.id}/broker-address`, { address: addr });
                        const updatedClient = await response.json() as Client;
                        syncClientInCache(updatedClient);
                        queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
                        toast({ title: "Address removed" });
                      } catch (err) {
                        toast({ title: "Error", description: "Failed to remove address", variant: "destructive" });
                      }
                    }}
                    data-testid={`btn-remove-broker-addr-${idx}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
              <div className="flex gap-1.5 mt-1">
                <Input
                  className="h-7 text-xs flex-1"
                  placeholder="Add new address..."
                  value={newBrokerAddr}
                  onChange={(e) => setNewBrokerAddr(e.target.value.toUpperCase())}
                  data-testid="input-add-broker-addr"
                />
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="h-7 px-2 text-xs bg-violet-600 hover:bg-violet-700"
                  disabled={!newBrokerAddr.trim()}
                  onClick={async () => {
                    if (!newBrokerAddr.trim()) return;
                    try {
                      const response = await apiRequest("POST", `/api/clients/${client.id}/broker-address`, { address: newBrokerAddr.trim() });
                      const updatedClient = await response.json() as Client;
                      syncClientInCache(updatedClient);
                      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
                      setNewBrokerAddr("");
                      toast({ title: "Address added" });
                    } catch (err) {
                      toast({ title: "Error", description: "Failed to add address", variant: "destructive" });
                    }
                  }}
                  data-testid="btn-add-broker-addr"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add
                </Button>
              </div>
            </>
          </div>
        )}

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone Number</FormLabel>
              <FormControl>
                <div className="flex flex-col gap-1">
                  <InternationalPhoneInput
                    value={field.value || ""}
                    onChange={field.onChange}
                    inputTestId="input-phone"
                    selectTestId="select-phone-country"
                    placeholder="Phone number"
                  />
                  <p className="text-xs text-muted-foreground">
                    UAE +971 is the default. Choose another country flag if needed, or leave it blank if it is not available.
                  </p>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {mode === "edit" && client?.billNumber && (
          <div className="space-y-2">
            <FormLabel>Account Number</FormLabel>
            <Input 
              value={client.billNumber} 
              disabled 
              className="bg-muted cursor-not-allowed"
              data-testid="input-account-number-readonly" 
            />
          </div>
        )}

        {existingClient && mode === "create" && (
          <div className="p-4 rounded-lg border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 space-y-3" data-testid="existing-client-warning">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-semibold text-amber-800 dark:text-amber-400">Client Already Exists</p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  A client with this name and phone number already exists in the system.
                </p>
              </div>
            </div>
            <div className="bg-card rounded-md p-3 space-y-1 border">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-primary" />
                <span className="font-medium">{existingClient.name}</span>
              </div>
              <p className="text-sm text-muted-foreground">Phone: {existingClient.phone}</p>
              <p className="text-sm text-muted-foreground">Address: {existingClient.address || "N/A"}</p>
              <div className="flex gap-4 text-sm mt-2 pt-2 border-t">
                <span>Total Bill: <strong className="text-primary">{existingClient.amount} AED</strong></span>
                <span>Deposit: <strong className="text-green-600">{existingClient.deposit} AED</strong></span>
                <span>Due: <strong className="text-destructive">{existingClient.balance} AED</strong></span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={handleAddBillToExisting}
                disabled={isPending}
                className="flex-1"
                data-testid="button-add-bill-existing"
              >
                {addBillMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Add New Bill ({watchAmount || "0"} AED) to This Client
              </Button>
            </div>
          </div>
        )}

        
        <Button
          type="submit"
          className="w-full rounded-full bg-primary hover:bg-primary/90 font-semibold"
          disabled={isPending || (existingClient !== null && mode === "create")}
          data-testid="button-submit"
        >
          {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {existingClient && mode === "create" 
            ? "Client Already Exists - Use Add Bill Button Above" 
            : mode === "create" 
              ? "Add New Client" 
              : "Update Client"}
        </Button>
      </form>
    </Form>
  );
}
