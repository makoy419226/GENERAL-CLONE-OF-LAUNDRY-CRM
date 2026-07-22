import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { insertBillSchema } from "@shared/schema";
import { useCreateBill } from "@/hooks/use-bills";
import { useClients } from "@/hooks/use-clients";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BillFormProps {
  onSuccess?: () => void;
}

export function BillForm({ onSuccess }: BillFormProps) {
  const { toast } = useToast();
  const { mutate: createBill, isPending: isCreating } = useCreateBill();
  const { data: clients = [] } = useClients();

  const form = useForm({
    resolver: zodResolver(insertBillSchema),
    defaultValues: {
      clientId: undefined as number | undefined,
      amount: "",
      description: "",
      billDate: new Date().toISOString().split('T')[0],
      referenceNumber: "",
    },
  });

  const onSubmit = form.handleSubmit((data) => {
    createBill(
      {
        ...data,
        clientId: Number(data.clientId),
      },
      {
        onSuccess: () => {
          toast({
            title: "Bill added",
            description: "The bill entry has been created successfully.",
          });
          onSuccess?.();
        },
      }
    );
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField
          control={form.control}
          name="clientId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Client *</FormLabel>
              <Select value={String(field.value || "")} onValueChange={(value) => field.onChange(Number(value))}>
                <FormControl>
                  <SelectTrigger data-testid="select-client">
                    <SelectValue placeholder="Select a client" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={String(client.id)}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Amount (AED) *</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-amount" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="billDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Bill Date *</FormLabel>
              <FormControl>
                <Input type="date" {...field} data-testid="input-date" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Input placeholder="Bill description" {...field} data-testid="input-description" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="referenceNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reference Number</FormLabel>
              <FormControl>
                <Input placeholder="INV-001" {...field} data-testid="input-reference" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          className="w-full rounded-full bg-primary hover:bg-primary/90 font-semibold"
          disabled={isCreating}
          data-testid="button-submit"
        >
          {isCreating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Add Bill
        </Button>
      </form>
    </Form>
  );
}
