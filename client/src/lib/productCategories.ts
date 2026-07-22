import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  EMPTY_PRODUCT_CATEGORY_SETTINGS,
  normalizeProductCategorySettings,
  type ProductCategorySettingsState,
} from "@shared/productCategories";

export const PRODUCT_CATEGORY_SETTINGS_QUERY_KEY = "/api/product-category-settings";

const LEGACY_CATEGORY_STORAGE_KEYS = [
  "baseProductCategories",
  "customProductCategories",
  "productCategoryDisplayOrder",
  "categoryOrder",
] as const;

const clearLegacyCategoryStorage = () => {
  try {
    for (const key of LEGACY_CATEGORY_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access failures in embedded or restricted browsers.
  }
};

export const useProductCategorySettings = () => {
  const queryClient = useQueryClient();

  const query = useQuery<ProductCategorySettingsState>({
    queryKey: [PRODUCT_CATEGORY_SETTINGS_QUERY_KEY],
    queryFn: async ({ signal }) => {
      const response = await fetch(PRODUCT_CATEGORY_SETTINGS_QUERY_KEY, {
        credentials: "include",
        signal,
      });
      if (!response.ok) {
        throw new Error("Failed to fetch product category settings");
      }
      return normalizeProductCategorySettings(await response.json());
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const settings = useMemo(
    () =>
      normalizeProductCategorySettings(
        query.data ?? EMPTY_PRODUCT_CATEGORY_SETTINGS,
      ),
    [query.data],
  );

  const updateSettings = async (
    updates: Partial<ProductCategorySettingsState>,
  ): Promise<ProductCategorySettingsState> => {
    const currentSettings = normalizeProductCategorySettings(
      (queryClient.getQueryData([
        PRODUCT_CATEGORY_SETTINGS_QUERY_KEY,
      ]) as Partial<ProductCategorySettingsState> | null | undefined) ?? settings,
    );
    const optimisticSettings = normalizeProductCategorySettings({
      ...currentSettings,
      ...updates,
    });

    queryClient.setQueryData(
      [PRODUCT_CATEGORY_SETTINGS_QUERY_KEY],
      optimisticSettings,
    );

    try {
      const response = await apiRequest(
        "PUT",
        PRODUCT_CATEGORY_SETTINGS_QUERY_KEY,
        updates,
      );
      const nextSettings = normalizeProductCategorySettings(
        await response.json(),
      );
      queryClient.setQueryData(
        [PRODUCT_CATEGORY_SETTINGS_QUERY_KEY],
        nextSettings,
      );
      return nextSettings;
    } catch (error) {
      queryClient.setQueryData(
        [PRODUCT_CATEGORY_SETTINGS_QUERY_KEY],
        currentSettings,
      );
      throw error;
    }
  };

  useEffect(() => {
    if (!query.isSuccess) return;
    clearLegacyCategoryStorage();
  }, [query.isSuccess]);

  return {
    ...query,
    settings,
    updateSettings,
  };
};
