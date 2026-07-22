import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ClientForm } from "./ClientForm";
import { useState } from "react";
import { useDeleteClient } from "@/hooks/use-clients";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import type { Client } from "@shared/schema";

interface ClientCardProps {
  client: Client;
}

export function ClientCard({ client }: ClientCardProps) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const { mutate: deleteClient } = useDeleteClient();
  const { toast } = useToast();

  const handleDelete = () => {
    if (confirm(`Are you sure you want to delete ${client.name}?`)) {
      deleteClient(client.id, {
        onSuccess: () => {
          toast({
            title: "Client deleted",
            description: `${client.name} has been removed.`,
          });
        },
      });
    }
  };

  const balanceColor = 
    parseFloat(client.balance || "0") > 0 ? "text-destructive" : "text-primary";

  return (
    <Card 
      className="hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-border/50 overflow-hidden"
      data-testid={`card-client-${client.id}`}
    >
      <Link href={`/clients/${client.id}`}>
        <CardContent className="p-6 cursor-pointer group">
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-foreground truncate group-hover:text-primary transition-colors">
                  {client.name}
                </h3>
                {client.billNumber && (
                  <p className="text-xs text-muted-foreground">{client.billNumber}</p>
                )}
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Amount</p>
                <p className="text-sm font-semibold text-foreground">AED {parseFloat(client.amount || "0").toFixed(2)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Deposit</p>
                <p className="text-sm font-semibold text-foreground">AED {parseFloat(client.deposit || "0").toFixed(2)}</p>
              </div>
            </div>

            {/* Balance */}
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground font-medium mb-1">Balance</p>
              <p className={`text-lg font-bold ${balanceColor}`}>
                AED {parseFloat(client.balance || "0").toFixed(2)}
              </p>
            </div>
          </div>
        </CardContent>
      </Link>

      {/* Action Buttons */}
      <div className="px-6 pb-4 pt-0 flex gap-2 border-t border-border/50">
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogTrigger asChild>
            <Button 
              variant="ghost" 
              size="sm"
              className="flex-1 rounded-md h-9"
              data-testid="button-edit"
              onClick={(e) => e.stopPropagation()}
            >
              Edit
            </Button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined} className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl font-display text-primary">Edit Client</DialogTitle>
            </DialogHeader>
            <ClientForm 
              mode="edit"
              client={client}
              onSuccess={() => setIsEditOpen(false)}
            />
          </DialogContent>
        </Dialog>
        <Button 
          variant="ghost" 
          size="icon"
          className="h-9 w-9 rounded-md text-destructive hover:bg-destructive/10"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
          data-testid="button-delete"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </Card>
  );
}
