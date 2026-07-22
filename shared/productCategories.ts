export const DEFAULT_PRODUCT_BASE_CATEGORIES: string[] = [];

export const DEFAULT_PRODUCT_CATEGORY_NAME = "All Items";

export const UNCATEGORIZED_PRODUCT_CATEGORY_NAME = "Uncategorized";

export const FAVORITES_PRODUCT_CATEGORY_NAME = "Favorites";

export const DEFAULT_NEW_PRODUCT_CATEGORY = UNCATEGORIZED_PRODUCT_CATEGORY_NAME;

export const SPECIAL_PRODUCT_CATEGORY_NAMES = [
  DEFAULT_PRODUCT_CATEGORY_NAME,
  UNCATEGORIZED_PRODUCT_CATEGORY_NAME,
  FAVORITES_PRODUCT_CATEGORY_NAME,
  "Other",
  "Uncategorized Items",
] as const;

const normalizeProductCategoryKey = (value: string) => value.trim().toLowerCase();

const LEGACY_PRODUCT_CATEGORY_ALIASES: Record<
  string,
  {
    fallback: string;
    candidateKeys: string[];
  }
> = {
  "arabic clothes": {
    fallback: "Traditional Clothes",
    candidateKeys: ["traditional clothes", "arabic traditional"],
  },
  "general items": {
    fallback: DEFAULT_PRODUCT_CATEGORY_NAME,
    candidateKeys: ["all items"],
  },
  "shop items": {
    fallback: DEFAULT_PRODUCT_CATEGORY_NAME,
    candidateKeys: ["all items"],
  },
};

export const PRODUCT_CATEGORY_DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  "Arabic Clothes": "Arabic Traditional",
  "Ladies' Clothes": "Ladies Clothes",
  "Baby Clothes": "Babies Clothes",
  "General Items": DEFAULT_PRODUCT_CATEGORY_NAME,
  "Shop Items": DEFAULT_PRODUCT_CATEGORY_NAME,
  "Uncategorized Items": UNCATEGORIZED_PRODUCT_CATEGORY_NAME,
};

export const isSpecialProductCategoryName = (
  category: string | null | undefined,
): boolean => {
  const name = String(category || "").trim();
  if (!name) return false;

  const key = normalizeProductCategoryKey(name);
  return SPECIAL_PRODUCT_CATEGORY_NAMES.some(
    (specialCategory) => normalizeProductCategoryKey(specialCategory) === key,
  );
};

export const resolveProductCategoryAlias = (
  category: string | null | undefined,
  availableCategories: Iterable<string> = [],
): string => {
  const name = String(category || "").trim();
  if (!name) return "";

  const aliasDefinition =
    LEGACY_PRODUCT_CATEGORY_ALIASES[normalizeProductCategoryKey(name)];
  if (!aliasDefinition) return name;

  for (const availableCategory of Array.from(availableCategories)) {
    const normalizedAvailableCategory = String(availableCategory || "").trim();
    if (!normalizedAvailableCategory) continue;

    const availableKey = normalizeProductCategoryKey(
      normalizedAvailableCategory,
    );
    if (aliasDefinition.candidateKeys.includes(availableKey)) {
      return normalizedAvailableCategory;
    }
  }

  return aliasDefinition.fallback;
};

export const normalizeStoredProductCategoryName = (
  category: string | null | undefined,
  availableCategories: Iterable<string> = [],
): string | null => {
  const resolvedCategory = resolveProductCategoryAlias(
    category,
    availableCategories,
  ).trim();

  if (!resolvedCategory || isSpecialProductCategoryName(resolvedCategory)) {
    return null;
  }

  return resolvedCategory;
};

export const getProductCategoryDisplayName = (
  category: string | null | undefined,
): string => {
  const name = String(category || "").trim();
  if (!name) return "";

  return PRODUCT_CATEGORY_DISPLAY_NAME_OVERRIDES[name] || name;
};

export const getProductCategoryGroupName = (
  category: string | null | undefined,
  availableCategories: Iterable<string> = [],
): string => {
  return (
    normalizeStoredProductCategoryName(category, availableCategories) ||
    UNCATEGORIZED_PRODUCT_CATEGORY_NAME
  );
};

export type ProductCategorySettingsState = {
  id?: number;
  baseCategories: string[];
  customCategories: string[];
  inventoryDisplayOrder: string[];
  orderDisplayOrder: string[];
  favoritesOrder: number[];
  updatedAt?: string | Date | null;
};

export const EMPTY_PRODUCT_CATEGORY_SETTINGS: ProductCategorySettingsState = {
  id: 1,
  baseCategories: [],
  customCategories: [],
  inventoryDisplayOrder: [],
  orderDisplayOrder: [],
  favoritesOrder: [],
  updatedAt: null,
};

export const normalizeCategoryNames = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];

  const rawNames = input
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawName of rawNames) {
    const name =
      normalizeStoredProductCategoryName(rawName, rawNames) ?? "";
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push(name);
  }

  return normalized;
};

export const normalizeProductIdOrder = (input: unknown): number[] => {
  if (!Array.isArray(input)) return [];

  const seen = new Set<number>();
  const normalized: number[] = [];

  for (const raw of input) {
    const id =
      typeof raw === "number"
        ? raw
        : typeof raw === "string"
          ? Number(raw)
          : NaN;

    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;

    seen.add(id);
    normalized.push(id);
  }

  return normalized;
};

export const mergeOrderedCategories = (
  preferredOrder: string[],
  availableCategories: string[],
): string[] => {
  const normalizedAvailable = normalizeCategoryNames(availableCategories);
  const availableByKey = new Map(
    normalizedAvailable.map((categoryName) => [categoryName.toLowerCase(), categoryName]),
  );
  const merged: string[] = [];
  const includedKeys = new Set<string>();

  for (const preferredCategory of normalizeCategoryNames(preferredOrder)) {
    const key = preferredCategory.toLowerCase();
    const match = availableByKey.get(key);
    if (!match || includedKeys.has(key)) continue;

    includedKeys.add(key);
    merged.push(match);
  }

  for (const categoryName of normalizedAvailable) {
    const key = categoryName.toLowerCase();
    if (includedKeys.has(key)) continue;

    includedKeys.add(key);
    merged.push(categoryName);
  }

  return merged;
};

export const normalizeProductCategorySettings = (
  data?: Partial<ProductCategorySettingsState> | null,
): ProductCategorySettingsState => {
  const baseCategories: string[] = [];
  const customCategories =
    data && Array.isArray(data.customCategories)
      ? normalizeCategoryNames(data.customCategories)
      : [];
  const requestedInventoryDisplayOrder =
    data && Array.isArray(data.inventoryDisplayOrder)
      ? normalizeCategoryNames(data.inventoryDisplayOrder)
      : [...DEFAULT_PRODUCT_BASE_CATEGORIES];
  const requestedOrderDisplayOrder =
    data && Array.isArray(data.orderDisplayOrder)
      ? normalizeCategoryNames(data.orderDisplayOrder)
      : requestedInventoryDisplayOrder;
  const categoriesReferencedByOrder = normalizeCategoryNames([
    ...requestedInventoryDisplayOrder,
    ...requestedOrderDisplayOrder,
  ]);
  const availableCategories = normalizeCategoryNames([
    ...customCategories,
    ...categoriesReferencedByOrder,
  ]);

  const inventoryDisplayOrder = mergeOrderedCategories(
    requestedInventoryDisplayOrder,
    availableCategories,
  );
  const orderDisplayOrder = mergeOrderedCategories(
    requestedOrderDisplayOrder,
    availableCategories,
  );
  const favoritesOrder = normalizeProductIdOrder(data?.favoritesOrder);

  return {
    id: typeof data?.id === "number" ? data.id : 1,
    baseCategories,
    customCategories,
    inventoryDisplayOrder,
    orderDisplayOrder,
    favoritesOrder,
    updatedAt: data?.updatedAt ?? null,
  };
};
