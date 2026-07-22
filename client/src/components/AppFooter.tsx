import { Globe, Mail, Phone } from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import {
  toMailHref,
  toPhoneHref,
  toWebsiteHref,
  toWhatsappHref,
  useCompanyContactInfo,
} from "@/lib/companyContact";

export function AppFooter() {
  const { companyContact } = useCompanyContactInfo();
  const primaryPhone = companyContact.mobilePhone || companyContact.telephone;
  const compactCompanyName =
    companyContact.companyName.replace(/\s+Laundry$/i, "").trim() ||
    companyContact.companyName;

  return (
    <footer
      className="shrink-0 border-t border-border bg-background/95 px-2 py-1 shadow-[0_-8px_24px_-22px_rgba(15,23,42,0.45)] backdrop-blur [padding-bottom:max(0.25rem,env(safe-area-inset-bottom))] sm:px-3 sm:py-2"
      data-testid="app-footer"
    >
      <div className="mx-auto grid w-full max-w-sm grid-cols-[repeat(4,minmax(0,1fr))] items-center gap-x-1 gap-y-0.5 text-center text-[9px] leading-tight text-muted-foreground sm:hidden">
        {primaryPhone && (
          <a
            href={toPhoneHref(primaryPhone)}
            className="inline-flex min-w-0 items-center justify-center gap-1 truncate hover:text-primary"
            data-testid="footer-phone-mobile"
          >
            <Phone className="h-3 w-3 shrink-0" />
            <span className="truncate">Call</span>
          </a>
        )}

        {(companyContact.whatsappPhone || companyContact.mobilePhone) && (
          <a
            href={toWhatsappHref(companyContact)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center justify-center gap-1 truncate text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
            data-testid="footer-whatsapp-mobile"
          >
            <SiWhatsapp className="h-3 w-3 shrink-0" />
            <span className="truncate">WhatsApp</span>
          </a>
        )}

        {companyContact.email && (
          <a
            href={toMailHref(companyContact.email)}
            className="inline-flex min-w-0 items-center justify-center gap-1 truncate hover:text-primary"
            data-testid="footer-email-mobile"
          >
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">Email</span>
          </a>
        )}

        {companyContact.website && (
          <a
            href={toWebsiteHref(companyContact.website)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center justify-center gap-1 truncate hover:text-primary"
            data-testid="footer-website-mobile"
          >
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate">Web</span>
          </a>
        )}

        <span className="col-span-4 truncate text-[8.5px] text-muted-foreground/80">
          &copy; 2024 {compactCompanyName}
        </span>
      </div>

      <div className="mx-auto hidden w-full max-w-7xl items-center justify-center gap-x-6 gap-y-2 text-center text-xs text-muted-foreground sm:flex sm:flex-wrap">
        {companyContact.telephone && (
          <a
            href={toPhoneHref(companyContact.telephone)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap hover:text-primary"
            data-testid="footer-tel"
          >
            <Phone className="h-3.5 w-3.5" />
            <span>{companyContact.telephone}</span>
          </a>
        )}

        {companyContact.mobilePhone && (
          <a
            href={toPhoneHref(companyContact.mobilePhone)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap hover:text-primary"
            data-testid="footer-phone"
          >
            <Phone className="h-3.5 w-3.5" />
            <span>{companyContact.mobilePhone}</span>
          </a>
        )}

        {(companyContact.whatsappPhone || companyContact.mobilePhone) && (
          <a
            href={toWhatsappHref(companyContact)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 whitespace-nowrap text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
            data-testid="footer-whatsapp"
          >
            <SiWhatsapp className="h-3.5 w-3.5" />
            <span>WhatsApp</span>
          </a>
        )}

        {companyContact.email && (
          <a
            href={toMailHref(companyContact.email)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap hover:text-primary"
            data-testid="footer-email"
          >
            <Mail className="h-3.5 w-3.5" />
            <span>{companyContact.email}</span>
          </a>
        )}

        {companyContact.website && (
          <a
            href={toWebsiteHref(companyContact.website)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 whitespace-nowrap hover:text-primary"
            data-testid="footer-website"
          >
            <Globe className="h-3.5 w-3.5" />
            <span>{companyContact.website}</span>
          </a>
        )}

        <span className="whitespace-nowrap">
          &copy; 2024 {companyContact.companyName}. All Rights Reserved.
        </span>
      </div>
    </footer>
  );
}
