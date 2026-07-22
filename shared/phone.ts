export type PhoneCountry = {
  code: string;
  name: string;
  dialCode: string;
  nationalPrefix?: string;
  minLocalLength: number;
  maxLocalLength: number;
};

export const DEFAULT_PHONE_COUNTRY = "AE";

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: "AE", name: "United Arab Emirates", dialCode: "971", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 10 },
  { code: "SA", name: "Saudi Arabia", dialCode: "966", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 10 },
  { code: "QA", name: "Qatar", dialCode: "974", minLocalLength: 8, maxLocalLength: 8 },
  { code: "KW", name: "Kuwait", dialCode: "965", minLocalLength: 8, maxLocalLength: 8 },
  { code: "BH", name: "Bahrain", dialCode: "973", minLocalLength: 8, maxLocalLength: 8 },
  { code: "OM", name: "Oman", dialCode: "968", minLocalLength: 8, maxLocalLength: 8 },
  { code: "JO", name: "Jordan", dialCode: "962", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 10 },
  { code: "LB", name: "Lebanon", dialCode: "961", nationalPrefix: "0", minLocalLength: 8, maxLocalLength: 8 },
  { code: "EG", name: "Egypt", dialCode: "20", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 11 },
  { code: "TR", name: "Turkey", dialCode: "90", nationalPrefix: "0", minLocalLength: 10, maxLocalLength: 11 },
  { code: "IN", name: "India", dialCode: "91", nationalPrefix: "0", minLocalLength: 10, maxLocalLength: 10 },
  { code: "PK", name: "Pakistan", dialCode: "92", nationalPrefix: "0", minLocalLength: 10, maxLocalLength: 11 },
  { code: "BD", name: "Bangladesh", dialCode: "880", nationalPrefix: "0", minLocalLength: 10, maxLocalLength: 11 },
  { code: "LK", name: "Sri Lanka", dialCode: "94", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 10 },
  { code: "NP", name: "Nepal", dialCode: "977", nationalPrefix: "0", minLocalLength: 10, maxLocalLength: 10 },
  { code: "PH", name: "Philippines", dialCode: "63", nationalPrefix: "0", minLocalLength: 10, maxLocalLength: 11 },
  { code: "MY", name: "Malaysia", dialCode: "60", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 10 },
  { code: "SG", name: "Singapore", dialCode: "65", minLocalLength: 8, maxLocalLength: 8 },
  { code: "TH", name: "Thailand", dialCode: "66", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 10 },
  { code: "ID", name: "Indonesia", dialCode: "62", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 12 },
  { code: "CN", name: "China", dialCode: "86", nationalPrefix: "0", minLocalLength: 11, maxLocalLength: 11 },
  { code: "JP", name: "Japan", dialCode: "81", nationalPrefix: "0", minLocalLength: 10, maxLocalLength: 11 },
  { code: "KR", name: "South Korea", dialCode: "82", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 11 },
  { code: "US", name: "United States", dialCode: "1", minLocalLength: 10, maxLocalLength: 10 },
  { code: "CA", name: "Canada", dialCode: "1", minLocalLength: 10, maxLocalLength: 10 },
  { code: "MX", name: "Mexico", dialCode: "52", minLocalLength: 10, maxLocalLength: 10 },
  { code: "BR", name: "Brazil", dialCode: "55", nationalPrefix: "0", minLocalLength: 10, maxLocalLength: 11 },
  { code: "GB", name: "United Kingdom", dialCode: "44", nationalPrefix: "0", minLocalLength: 10, maxLocalLength: 11 },
  { code: "IE", name: "Ireland", dialCode: "353", nationalPrefix: "0", minLocalLength: 8, maxLocalLength: 10 },
  { code: "FR", name: "France", dialCode: "33", nationalPrefix: "0", minLocalLength: 10, maxLocalLength: 10 },
  { code: "DE", name: "Germany", dialCode: "49", nationalPrefix: "0", minLocalLength: 10, maxLocalLength: 12 },
  { code: "IT", name: "Italy", dialCode: "39", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 11 },
  { code: "ES", name: "Spain", dialCode: "34", minLocalLength: 9, maxLocalLength: 9 },
  { code: "NL", name: "Netherlands", dialCode: "31", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 10 },
  { code: "BE", name: "Belgium", dialCode: "32", nationalPrefix: "0", minLocalLength: 8, maxLocalLength: 10 },
  { code: "CH", name: "Switzerland", dialCode: "41", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 10 },
  { code: "AT", name: "Austria", dialCode: "43", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 13 },
  { code: "SE", name: "Sweden", dialCode: "46", nationalPrefix: "0", minLocalLength: 8, maxLocalLength: 10 },
  { code: "NO", name: "Norway", dialCode: "47", minLocalLength: 8, maxLocalLength: 8 },
  { code: "DK", name: "Denmark", dialCode: "45", minLocalLength: 8, maxLocalLength: 8 },
  { code: "AU", name: "Australia", dialCode: "61", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 10 },
  { code: "NZ", name: "New Zealand", dialCode: "64", nationalPrefix: "0", minLocalLength: 8, maxLocalLength: 10 },
  { code: "ZA", name: "South Africa", dialCode: "27", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 10 },
  { code: "NG", name: "Nigeria", dialCode: "234", nationalPrefix: "0", minLocalLength: 10, maxLocalLength: 11 },
  { code: "KE", name: "Kenya", dialCode: "254", nationalPrefix: "0", minLocalLength: 9, maxLocalLength: 10 },
];

const phoneCountriesByCode = new Map(
  PHONE_COUNTRIES.map((country) => [country.code, country]),
);

const phoneCountriesByDialLength = [...PHONE_COUNTRIES].sort(
  (left, right) => right.dialCode.length - left.dialCode.length,
);

export function getPhoneCountry(code?: string | null): PhoneCountry | undefined {
  if (!code) return undefined;
  return phoneCountriesByCode.get(String(code).toUpperCase());
}

export function getPhoneCountryFlag(code?: string | null): string {
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalizedCode)) {
    return "GL";
  }

  return String.fromCodePoint(
    ...normalizedCode.split("").map((char) => 127397 + char.charCodeAt(0)),
  );
}

export function stripPhoneToDigits(value?: string | null): string {
  return String(value || "").replace(/\D/g, "");
}

export function getPhoneLocalLengthRange(
  code?: string | null,
): { min: number; max: number } {
  const country = getPhoneCountry(code) || getPhoneCountry(DEFAULT_PHONE_COUNTRY)!;
  return {
    min: country.minLocalLength,
    max: country.maxLocalLength,
  };
}

export function getPhoneLocalMaxLength(code?: string | null): number {
  return getPhoneLocalLengthRange(code).max;
}

function stripInternationalPrefix(value: string): string {
  if (value.startsWith("00")) {
    return value.slice(2);
  }

  return value;
}

function matchCountryByDialCode(digits: string): PhoneCountry | undefined {
  return phoneCountriesByDialLength.find((country) => digits.startsWith(country.dialCode));
}

function getNationalPrefixDigits(country: PhoneCountry): string {
  return stripPhoneToDigits(country.nationalPrefix);
}

function addNationalPrefixIfNeeded(localDigits: string, country: PhoneCountry): string {
  const prefixDigits = getNationalPrefixDigits(country);
  if (!prefixDigits || !localDigits || localDigits.startsWith(prefixDigits)) {
    return localDigits;
  }

  const minWithoutPrefix = Math.max(1, country.minLocalLength - prefixDigits.length);
  const maxWithoutPrefix = Math.max(minWithoutPrefix, country.maxLocalLength - prefixDigits.length);

  if (localDigits.length >= minWithoutPrefix && localDigits.length <= maxWithoutPrefix) {
    return `${prefixDigits}${localDigits}`;
  }

  return localDigits;
}

export function parsePhoneValue(
  value?: string | null,
  fallbackCountryCode = DEFAULT_PHONE_COUNTRY,
): { countryCode: string; dialCode: string; localNumber: string } {
  const fallbackCountry = getPhoneCountry(fallbackCountryCode) || PHONE_COUNTRIES[0];
  const rawValue = String(value || "").trim();
  const digitsOnly = stripPhoneToDigits(rawValue);

  if (!digitsOnly) {
    return {
      countryCode: fallbackCountry.code,
      dialCode: fallbackCountry.dialCode,
      localNumber: "",
    };
  }

  if (rawValue.startsWith("+") || rawValue.startsWith("00")) {
    const internationalDigits = stripInternationalPrefix(digitsOnly);
    const matchedCountry = matchCountryByDialCode(internationalDigits) || fallbackCountry;
    const localDigits = internationalDigits.startsWith(matchedCountry.dialCode)
      ? internationalDigits.slice(matchedCountry.dialCode.length)
      : internationalDigits;

    return {
      countryCode: matchedCountry.code,
      dialCode: matchedCountry.dialCode,
      localNumber: addNationalPrefixIfNeeded(localDigits, matchedCountry),
    };
  }

  const fallbackPrefix = getNationalPrefixDigits(fallbackCountry);
  if (fallbackPrefix && digitsOnly.startsWith(fallbackPrefix)) {
    return {
      countryCode: fallbackCountry.code,
      dialCode: fallbackCountry.dialCode,
      localNumber: digitsOnly,
    };
  }

  const directMatch = matchCountryByDialCode(digitsOnly);
  if (directMatch && digitsOnly.length > directMatch.dialCode.length + 4) {
    const localDigits = digitsOnly.slice(directMatch.dialCode.length);
    return {
      countryCode: directMatch.code,
      dialCode: directMatch.dialCode,
      localNumber: addNationalPrefixIfNeeded(localDigits, directMatch),
    };
  }

  return {
    countryCode: fallbackCountry.code,
    dialCode: fallbackCountry.dialCode,
    localNumber: addNationalPrefixIfNeeded(digitsOnly, fallbackCountry),
  };
}

export function buildInternationalPhoneValue(
  localNumber?: string | null,
  countryCode = DEFAULT_PHONE_COUNTRY,
): string {
  const country = getPhoneCountry(countryCode) || getPhoneCountry(DEFAULT_PHONE_COUNTRY)!;
  const digitsOnly = stripPhoneToDigits(localNumber);

  if (!digitsOnly) {
    return "";
  }

  const prefixDigits = getNationalPrefixDigits(country);
  const normalizedLocalDigits =
    prefixDigits && digitsOnly.startsWith(prefixDigits)
      ? digitsOnly.slice(prefixDigits.length)
      : digitsOnly;

  if (!normalizedLocalDigits) {
    return "";
  }

  return `+${country.dialCode}${normalizedLocalDigits}`;
}

export function normalizePhoneForStorage(
  value?: string | null,
  fallbackCountryCode = DEFAULT_PHONE_COUNTRY,
): string {
  const parsed = parsePhoneValue(value, fallbackCountryCode);
  return buildInternationalPhoneValue(parsed.localNumber, parsed.countryCode);
}

export function normalizePhoneForComparison(
  value?: string | null,
  fallbackCountryCode = DEFAULT_PHONE_COUNTRY,
): string {
  return stripPhoneToDigits(normalizePhoneForStorage(value, fallbackCountryCode));
}

export function hasPhoneDigits(value?: string | null): boolean {
  return stripPhoneToDigits(value).length > 0;
}

export function isPlausiblePhoneNumber(
  value?: string | null,
  fallbackCountryCode = DEFAULT_PHONE_COUNTRY,
): boolean {
  const parsed = parsePhoneValue(value, fallbackCountryCode);
  const localDigits = stripPhoneToDigits(parsed.localNumber);
  if (!localDigits) {
    return false;
  }

  const { min, max } = getPhoneLocalLengthRange(parsed.countryCode);
  return localDigits.length >= min && localDigits.length <= max;
}
