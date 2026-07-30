import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

export interface CompanyContactInfo {
  id?: number;
  companyName: string;
  tagline: string | null;
  telephone: string | null;
  mobilePhone: string | null;
  whatsappPhone: string | null;
  email: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressLine3: string | null;
  dashboardClockHour12: boolean;
  updatedAt?: string | Date | null;
}

export const DEFAULT_COMPANY_CONTACT: CompanyContactInfo = {
  companyName: "Laundry Business",
  tagline: null,
  telephone: null,
  mobilePhone: null,
  whatsappPhone: null,
  email: null,
  website: null,
  addressLine1: null,
  addressLine2: null,
  addressLine3: null,
  dashboardClockHour12: true,
  updatedAt: null,
};

const normalizeText = (value: unknown, fallback: string | null = null) => {
  const trimmed = String(value ?? "").trim();
  return trimmed || fallback;
};

const getStoredWorkspaceIdentity = () => {
  try {
    return JSON.parse(localStorage.getItem("user") || "null") as {
      businessId?: number | null;
      businessName?: string | null;
      businessLogoUrl?: string | null;
    } | null;
  } catch {
    return null;
  }
};

export const getWorkspaceLogoUrl = (fallback: string) =>
  normalizeText(getStoredWorkspaceIdentity()?.businessLogoUrl, fallback) || fallback;

const withStoredWorkspaceName = (contact: CompanyContactInfo) => ({
  ...contact,
  companyName:
    normalizeText(getStoredWorkspaceIdentity()?.businessName, contact.companyName) ||
    contact.companyName,
});

export const normalizeCompanyContactInfo = (
  data?: Partial<CompanyContactInfo> | null,
): CompanyContactInfo => ({
  ...DEFAULT_COMPANY_CONTACT,
  ...data,
  companyName: normalizeText(data?.companyName, DEFAULT_COMPANY_CONTACT.companyName)!,
  tagline: normalizeText(data?.tagline, DEFAULT_COMPANY_CONTACT.tagline),
  telephone: normalizeText(data?.telephone, DEFAULT_COMPANY_CONTACT.telephone),
  mobilePhone: normalizeText(data?.mobilePhone, DEFAULT_COMPANY_CONTACT.mobilePhone),
  whatsappPhone: normalizeText(
    data?.whatsappPhone,
    normalizeText(data?.mobilePhone, DEFAULT_COMPANY_CONTACT.whatsappPhone),
  ),
  email: normalizeText(data?.email, DEFAULT_COMPANY_CONTACT.email),
  website: normalizeText(data?.website, DEFAULT_COMPANY_CONTACT.website),
  addressLine1: normalizeText(data?.addressLine1, DEFAULT_COMPANY_CONTACT.addressLine1),
  addressLine2: normalizeText(data?.addressLine2, DEFAULT_COMPANY_CONTACT.addressLine2),
  addressLine3: normalizeText(data?.addressLine3, DEFAULT_COMPANY_CONTACT.addressLine3),
  dashboardClockHour12:
    typeof data?.dashboardClockHour12 === "boolean"
      ? data.dashboardClockHour12
      : DEFAULT_COMPANY_CONTACT.dashboardClockHour12,
});

export const useCompanyContactInfo = () => {
  const query = useQuery<CompanyContactInfo>({
    queryKey: ["/api/company-contact"],
  });
  const companyContact = useMemo(
    () => withStoredWorkspaceName(normalizeCompanyContactInfo(query.data)),
    [query.data],
  );

  return {
    ...query,
    companyContact,
  };
};

export const fetchCompanyContactInfo = async (): Promise<CompanyContactInfo> => {
  try {
    const response = await fetch("/api/company-contact", {
      credentials: "include",
    });
    if (!response.ok) return DEFAULT_COMPANY_CONTACT;
    const data = await response.json();
    return withStoredWorkspaceName(normalizeCompanyContactInfo(data));
  } catch {
    return DEFAULT_COMPANY_CONTACT;
  }
};

export const getCompanyAddressLines = (contact: CompanyContactInfo) =>
  [contact.addressLine1, contact.addressLine2, contact.addressLine3].filter(
    (line): line is string => !!normalizeText(line),
  );

export const formatCompanyAddressSingleLine = (contact: CompanyContactInfo) =>
  getCompanyAddressLines(contact).join(", ");

export const formatCompanyPhoneLine = (contact: CompanyContactInfo) => {
  const parts = [
    contact.telephone ? `Tel: ${contact.telephone}` : "",
    contact.mobilePhone ? `Mobile: ${contact.mobilePhone}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
};

export const toPhoneHref = (value: string | null | undefined) => {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "#";
};

export const toWebsiteHref = (value: string | null | undefined) => {
  const website = String(value || "").trim();
  if (!website) return "#";
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
};

export const toMailHref = (value: string | null | undefined) => {
  const email = String(value || "").trim();
  return email ? `mailto:${email}` : "#";
};

export const toWhatsappHref = (contact: CompanyContactInfo) => {
  let phone = String(contact.whatsappPhone || contact.mobilePhone || "").trim();
  phone = phone.replace(/[^\d]/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  return phone ? `https://wa.me/${phone}` : "#";
};

export const getPublicTrackingUrl = () => {
  let businessSlug = "";
  try {
    const user = JSON.parse(localStorage.getItem("user") || "null") as {
      businessSlug?: string | null;
    } | null;
    businessSlug = String(user?.businessSlug || "").trim();
  } catch {
    businessSlug = "";
  }
  const path = businessSlug
    ? `/track/${encodeURIComponent(businessSlug)}`
    : "/track";
  return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
};

export const escapeHtml = (value: string | null | undefined) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const formatCompanyAddressHtml = (
  contact: CompanyContactInfo,
  separator = "<br />",
) => getCompanyAddressLines(contact).map(escapeHtml).join(separator);
