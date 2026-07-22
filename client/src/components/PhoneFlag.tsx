import { useMemo, useState } from "react";
import { MapPin, Phone } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DEFAULT_PHONE_COUNTRY,
  getPhoneCountryFlag,
  parsePhoneValue,
} from "@shared/phone";

type PhoneFlagImageProps = {
  countryCode: string;
  className?: string;
};

type PhoneNumberWithFlagProps = {
  phone?: string | null;
  className?: string;
  iconClassName?: string;
  flagClassName?: string;
  textClassName?: string;
  fallbackCountryCode?: string;
};

type AddressTextWithIconProps = {
  address?: string | null;
  className?: string;
  iconClassName?: string;
  textClassName?: string;
};

function getPhoneCountryFlagImageSrc(countryCode: string): string {
  return `https://flagcdn.com/${countryCode.toLowerCase()}.svg`;
}

export function PhoneFlagImage({ countryCode, className }: PhoneFlagImageProps) {
  const [imageFailed, setImageFailed] = useState(false);

  if (imageFailed) {
    return (
      <span className={cn("inline-flex shrink-0 items-center justify-center text-sm leading-none", className)}>
        {getPhoneCountryFlag(countryCode)}
      </span>
    );
  }

  return (
    <img
      src={getPhoneCountryFlagImageSrc(countryCode)}
      alt={`${countryCode} flag`}
      className={cn("block h-3.5 w-5 shrink-0 rounded-[2px] border object-cover", className)}
      loading="lazy"
      onError={() => setImageFailed(true)}
    />
  );
}

export function PhoneNumberWithFlag({
  phone,
  className,
  iconClassName,
  flagClassName,
  textClassName,
  fallbackCountryCode = DEFAULT_PHONE_COUNTRY,
}: PhoneNumberWithFlagProps) {
  const normalizedPhone = String(phone || "").trim();
  const digits = normalizedPhone.replace(/\D/g, "");
  const parsedPhone = useMemo(
    () => parsePhoneValue(normalizedPhone, fallbackCountryCode),
    [fallbackCountryCode, normalizedPhone],
  );

  if (!normalizedPhone || normalizedPhone === "-" || (digits && /^0+$/.test(digits))) {
    return null;
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Phone className={cn("h-3 w-3 shrink-0 text-muted-foreground", iconClassName)} />
      <PhoneFlagImage countryCode={parsedPhone.countryCode} className={flagClassName} />
      <span className={cn("leading-none", textClassName)}>{normalizedPhone}</span>
    </span>
  );
}

export function AddressTextWithIcon({
  address,
  className,
  iconClassName,
  textClassName,
}: AddressTextWithIconProps) {
  const normalizedAddress = String(address || "").trim();

  if (!normalizedAddress || normalizedAddress === "-" || normalizedAddress === "0") {
    return null;
  }

  return (
    <span className={cn("inline-flex items-start gap-1.5", className)}>
      <MapPin className={cn("mt-0.5 h-3 w-3 shrink-0 text-muted-foreground", iconClassName)} />
      <span className={cn("leading-tight", textClassName)}>{normalizedAddress}</span>
    </span>
  );
}
