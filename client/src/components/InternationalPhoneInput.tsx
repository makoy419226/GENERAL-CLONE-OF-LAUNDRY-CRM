import { useEffect, useMemo, useState, type KeyboardEventHandler, type Ref } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  buildInternationalPhoneValue,
  getPhoneCountry,
  getPhoneLocalMaxLength,
  parsePhoneValue,
  stripPhoneToDigits,
} from "@shared/phone";
import { PhoneFlagImage } from "@/components/PhoneFlag";

type InternationalPhoneInputProps = {
  value: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  inputTestId?: string;
  selectTestId?: string;
  placeholder?: string;
  disabled?: boolean;
  countryCode?: string;
  onCountryCodeChange?: (countryCode: string) => void;
  onInputKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  wrapperClassName?: string;
  selectClassName?: string;
  inputClassName?: string;
  dialCodeClassName?: string;
};

export function InternationalPhoneInput({
  value,
  onChange,
  inputRef,
  inputTestId,
  selectTestId,
  placeholder = "Phone number",
  disabled = false,
  countryCode,
  onCountryCodeChange,
  onInputKeyDown,
  wrapperClassName,
  selectClassName,
  inputClassName,
  dialCodeClassName,
}: InternationalPhoneInputProps) {
  const parsedPhone = useMemo(
    () => parsePhoneValue(value, countryCode || DEFAULT_PHONE_COUNTRY),
    [countryCode, value],
  );

  const [selectedCountryCode, setSelectedCountryCode] = useState(
    countryCode || parsedPhone.countryCode || DEFAULT_PHONE_COUNTRY,
  );

  useEffect(() => {
    if (countryCode) {
      setSelectedCountryCode(countryCode);
      return;
    }

    if (value) {
      setSelectedCountryCode(parsedPhone.countryCode || DEFAULT_PHONE_COUNTRY);
    }
  }, [countryCode, parsedPhone.countryCode, value]);

  const activeCountryCode = countryCode || selectedCountryCode || DEFAULT_PHONE_COUNTRY;
  const activeCountry = getPhoneCountry(activeCountryCode) || getPhoneCountry(DEFAULT_PHONE_COUNTRY)!;
  const maxLocalLength = getPhoneLocalMaxLength(activeCountry.code);
  const nationalDigits = stripPhoneToDigits(parsedPhone.localNumber);

  return (
    <div className={cn("flex min-w-0 gap-2", wrapperClassName)}>
      <Select
        value={activeCountryCode}
        onValueChange={(nextCountryCode) => {
          if (!countryCode) {
            setSelectedCountryCode(nextCountryCode);
          }
          onCountryCodeChange?.(nextCountryCode);
          onChange(
            buildInternationalPhoneValue(
              nationalDigits.slice(0, getPhoneLocalMaxLength(nextCountryCode)),
              nextCountryCode,
            ),
          );
        }}
        disabled={disabled}
      >
        <SelectTrigger
          className={cn("w-[9.5rem] shrink-0", selectClassName)}
          data-testid={selectTestId}
        >
          <div className="flex items-center gap-1 whitespace-nowrap">
            <PhoneFlagImage
              countryCode={activeCountry.code}
              className="h-3 w-4.5 sm:h-3.5 sm:w-5"
            />
            <span
              className={cn(
                "text-[10px] leading-none text-muted-foreground sm:text-xs",
                dialCodeClassName,
              )}
            >
              +{activeCountry.dialCode}
            </span>
          </div>
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {PHONE_COUNTRIES.map((country) => (
            <SelectItem key={country.code} value={country.code}>
              <div className="flex items-center gap-2">
                <PhoneFlagImage countryCode={country.code} />
                <span>{country.name}</span>
                <span className="text-muted-foreground">+{country.dialCode}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        ref={inputRef}
        className={cn("min-w-0 flex-1", inputClassName)}
        placeholder={placeholder}
        value={nationalDigits}
        onChange={(event) => {
          const nextDigits = stripPhoneToDigits(event.target.value).slice(0, maxLocalLength);
          onChange(buildInternationalPhoneValue(nextDigits, activeCountryCode));
        }}
        onKeyDown={onInputKeyDown}
        inputMode="tel"
        maxLength={maxLocalLength}
        data-testid={inputTestId}
        disabled={disabled}
      />
    </div>
  );
}
