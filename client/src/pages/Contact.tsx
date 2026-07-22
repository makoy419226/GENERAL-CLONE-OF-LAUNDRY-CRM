import { useContext, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Globe, Mail, MapPin, Pencil, Phone, Shield } from "lucide-react";
import { UserContext } from "@/App";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import {
  type CompanyContactInfo,
  getCompanyAddressLines,
  toMailHref,
  toPhoneHref,
  toWebsiteHref,
  toWhatsappHref,
  useCompanyContactInfo,
} from "@/lib/companyContact";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ContactFormState = {
  companyName: string;
  tagline: string;
  telephone: string;
  mobilePhone: string;
  whatsappPhone: string;
  email: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  adminPassword: string;
};

const buildFormState = (companyContact: CompanyContactInfo): ContactFormState => ({
  companyName: companyContact.companyName || "",
  tagline: companyContact.tagline || "",
  telephone: companyContact.telephone || "",
  mobilePhone: companyContact.mobilePhone || "",
  whatsappPhone: companyContact.whatsappPhone || "",
  email: companyContact.email || "",
  website: companyContact.website || "",
  addressLine1: companyContact.addressLine1 || "",
  addressLine2: companyContact.addressLine2 || "",
  addressLine3: companyContact.addressLine3 || "",
  adminPassword: "",
});

export default function Contact() {
  const user = useContext(UserContext);
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();
  const { companyContact } = useCompanyContactInfo();
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<ContactFormState>(() => buildFormState(companyContact));
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (editOpen) return;
    setForm(buildFormState(companyContact));
  }, [companyContact, editOpen]);

  useEffect(() => {
    if (!isAdmin && editOpen) {
      setEditOpen(false);
    }
  }, [editOpen, isAdmin]);

  const updateContactMutation = useMutation({
    mutationFn: async (payload: ContactFormState) => {
      const response = await apiRequest("PUT", "/api/company-contact", payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-contact"] });
      setEditOpen(false);
      setFormError("");
      setForm((current) => ({ ...current, adminPassword: "" }));
      toast({
        title: "Contact Details Updated",
        description: "The updated company contact information will now be used in printouts and PDFs.",
      });
    },
    onError: (error: any) => {
      setFormError(error.message?.includes("Invalid") ? "Invalid admin password" : "Failed to update contact details");
    },
  });

  const handleSave = () => {
    if (!form.companyName.trim()) {
      setFormError("Company name is required");
      return;
    }
    if (!form.addressLine1.trim()) {
      setFormError("Address line 1 is required");
      return;
    }
    if (!form.adminPassword.trim()) {
      setFormError("Enter admin password to save changes");
      return;
    }

    setFormError("");
    updateContactMutation.mutate(form);
  };

  const addressLines = getCompanyAddressLines(companyContact);

  return (
    <div className="flex flex-col h-screen">
      <div className="sticky top-0 z-30 w-full bg-white/80 dark:bg-background/80 backdrop-blur-md border-b border-border shadow-sm">
        <div className="h-20 px-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-display font-bold text-foreground">
            Contact Us
          </h1>
          {isAdmin && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                setForm(buildFormState(companyContact));
                setFormError("");
                setEditOpen(true);
              }}
              data-testid="button-edit-company-contact"
            >
              <Pencil className="w-4 h-4" />
              Edit Contact Details
            </Button>
          )}
        </div>
      </div>

      <main className="flex-1 container mx-auto px-4 py-8 overflow-auto">
        <div className="max-w-2xl mx-auto">
          <Card className="overflow-hidden">
            <div className="bg-primary p-6 text-white">
              <div className="text-center">
                <h2 className="text-2xl font-display font-bold">{companyContact.companyName}</h2>
                {companyContact.tagline && (
                  <p className="text-white/80 text-sm">{companyContact.tagline}</p>
                )}
              </div>
            </div>

            <CardContent className="p-6 space-y-6">
              <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Phone className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Telephone</p>
                  <a
                    href={toPhoneHref(companyContact.telephone)}
                    className="text-lg font-semibold text-foreground hover:text-primary transition-colors"
                    data-testid="link-tel"
                  >
                    {companyContact.telephone || "-"}
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Phone className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Mobile Phone</p>
                  <a
                    href={toPhoneHref(companyContact.mobilePhone)}
                    className="text-lg font-semibold text-foreground hover:text-primary transition-colors"
                    data-testid="link-phone"
                  >
                    {companyContact.mobilePhone || "-"}
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Email</p>
                  <a
                    href={toMailHref(companyContact.email)}
                    className="text-lg font-semibold text-foreground hover:text-primary transition-colors"
                    data-testid="link-email"
                  >
                    {companyContact.email || "-"}
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Globe className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Website</p>
                  <a
                    href={toWebsiteHref(companyContact.website)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-lg font-semibold text-foreground hover:text-primary transition-colors"
                    data-testid="link-website"
                  >
                    {companyContact.website || "-"}
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Address</p>
                  {addressLines.map((line, index) => (
                    <p
                      key={`${line}-${index}`}
                      className={index === 0 ? "text-lg font-semibold text-foreground" : "text-muted-foreground"}
                      data-testid={index === 0 ? "text-address" : undefined}
                    >
                      {line}
                    </p>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t">
                <div className="mb-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Shield className="w-4 h-4" />
                  Admin password required to save changes
                </div>
                <Button
                  className="w-full rounded-full"
                  size="lg"
                  onClick={() => window.open(toWhatsappHref(companyContact), "_blank")}
                  data-testid="button-whatsapp"
                >
                  Contact via WhatsApp
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <Dialog open={isAdmin && editOpen} onOpenChange={(open) => isAdmin && setEditOpen(open)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Company Contact Details</DialogTitle>
            <DialogDescription>
              These details are used on the Contact page and in printable receipts, tags, bills, and PDF reports. Enter the admin password to save.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid gap-2">
              <Label htmlFor="company-name">Company Name</Label>
              <Input
                id="company-name"
                value={form.companyName}
                onChange={(e) => setForm((current) => ({ ...current, companyName: e.target.value }))}
                data-testid="input-company-name"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="company-tagline">Tagline</Label>
              <Input
                id="company-tagline"
                value={form.tagline}
                onChange={(e) => setForm((current) => ({ ...current, tagline: e.target.value }))}
                data-testid="input-company-tagline"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="company-telephone">Telephone</Label>
                <Input
                  id="company-telephone"
                  value={form.telephone}
                  onChange={(e) => setForm((current) => ({ ...current, telephone: e.target.value }))}
                  data-testid="input-company-telephone"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="company-mobile">Mobile Phone</Label>
                <Input
                  id="company-mobile"
                  value={form.mobilePhone}
                  onChange={(e) => setForm((current) => ({ ...current, mobilePhone: e.target.value }))}
                  data-testid="input-company-mobile"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="company-whatsapp">WhatsApp Number</Label>
              <Input
                id="company-whatsapp"
                value={form.whatsappPhone}
                onChange={(e) => setForm((current) => ({ ...current, whatsappPhone: e.target.value }))}
                data-testid="input-company-whatsapp"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="company-email">Email</Label>
                <Input
                  id="company-email"
                  value={form.email}
                  onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))}
                  data-testid="input-company-email"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="company-website">Website</Label>
                <Input
                  id="company-website"
                  value={form.website}
                  onChange={(e) => setForm((current) => ({ ...current, website: e.target.value }))}
                  data-testid="input-company-website"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="address-line-1">Address Line 1</Label>
              <Input
                id="address-line-1"
                value={form.addressLine1}
                onChange={(e) => setForm((current) => ({ ...current, addressLine1: e.target.value }))}
                data-testid="input-address-line-1"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="address-line-2">Address Line 2</Label>
              <Input
                id="address-line-2"
                value={form.addressLine2}
                onChange={(e) => setForm((current) => ({ ...current, addressLine2: e.target.value }))}
                data-testid="input-address-line-2"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="address-line-3">Address Line 3</Label>
              <Input
                id="address-line-3"
                value={form.addressLine3}
                onChange={(e) => setForm((current) => ({ ...current, addressLine3: e.target.value }))}
                data-testid="input-address-line-3"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="contact-admin-password" className="flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Admin Password
              </Label>
              <Input
                id="contact-admin-password"
                type="password"
                value={form.adminPassword}
                onChange={(e) => setForm((current) => ({ ...current, adminPassword: e.target.value }))}
                placeholder="Enter admin password"
                data-testid="input-contact-admin-password"
              />
              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateContactMutation.isPending}
              data-testid="button-save-company-contact"
            >
              {updateContactMutation.isPending ? "Saving..." : "Save Contact Details"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
