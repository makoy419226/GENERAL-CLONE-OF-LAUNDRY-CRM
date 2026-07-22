import { useRoute } from "wouter";
import { useClient } from "@/hooks/use-clients";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState } from "react";
import { ClientForm } from "@/components/ClientForm";

export default function ClientDetails() {
  const [, params] = useRoute("/clients/:id");
  const [isEditOpen, setIsEditOpen] = useState(false);
  const clientId = parseInt(params?.id || "0");
  const { data: client, isLoading, isError } = useClient(clientId);

  if (isLoading) {
    return (
      <div className="flex flex-col h-screen">
        <div className="flex items-center justify-center flex-1">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-muted-foreground">Loading client details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (isError || !client) {
    return (
      <div className="flex flex-col h-screen">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-foreground mb-2">Client Not Found</h2>
            <p className="text-muted-foreground">The client you're looking for doesn't exist.</p>
          </div>
          <Link href="/clients">
            <Button className="rounded-full bg-primary hover:bg-primary/90">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Clients
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const balanceColor = 
    parseFloat(client.balance || "0") > 0 ? "text-destructive" : "text-primary";

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-border p-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/clients">
            <Button 
              variant="ghost" 
              size="icon"
              className="rounded-lg h-10 w-10"
              data-testid="button-back"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">{client.name}</h1>
            {client.billNumber && (
              <p className="text-sm text-muted-foreground">{client.billNumber}</p>
            )}
          </div>
        </div>
        <Button 
          className="rounded-full bg-primary hover:bg-primary/90"
          onClick={() => setIsEditOpen(true)}
          data-testid="button-edit-main"
        >
          Edit Details
        </Button>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Financial Details */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">Financial Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-6">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground font-medium">Total Amount</p>
                <p className="text-2xl font-bold text-foreground">
                  AED {parseFloat(client.amount || "0").toFixed(2)}
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground font-medium">Deposit</p>
                <p className="text-2xl font-bold text-primary">
                  AED {parseFloat(client.deposit || "0").toFixed(2)}
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground font-medium">Balance</p>
                <p className={`text-2xl font-bold ${balanceColor}`}>
                  AED {parseFloat(client.balance || "0").toFixed(2)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Contact & Address */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {client.address && (
                <div>
                  <p className="text-sm text-muted-foreground font-medium mb-1">Address</p>
                  <p className="text-foreground">{client.address}</p>
                </div>
              )}
              {client.phone && (
                <div>
                  <p className="text-sm text-muted-foreground font-medium mb-1">Phone Number</p>
                  <p className="text-foreground">{client.phone}</p>
                </div>
              )}
              {client.contact && (
                <div>
                  <p className="text-sm text-muted-foreground font-medium mb-1">WhatsApp</p>
                  <a 
                    href={client.contact}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-semibold transition-colors"
                    data-testid="link-whatsapp"
                  >
                    {client.contact}
                  </a>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Account Summary */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">Account Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-border">
                <span className="text-muted-foreground">Account Status</span>
                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  parseFloat(client.balance || "0") > 0 
                    ? "bg-destructive/10 text-destructive" 
                    : "bg-primary/10 text-primary"
                }`}>
                  {parseFloat(client.balance || "0") > 0 ? "Amount Due" : "Paid"}
                </span>
              </div>
              <div className="text-sm text-muted-foreground pt-2">
                <p>Created on Client Database</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
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
    </div>
  );
}
