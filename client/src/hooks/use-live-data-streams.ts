import { useEffect } from "react";
import { PRODUCT_CATEGORY_SETTINGS_QUERY_KEY } from "@/lib/productCategories";
import { queryClient } from "@/lib/queryClient";

type LiveStreamEvent = {
  type?: string;
};

const parseLiveStreamEvent = (data: string): LiveStreamEvent | null => {
  try {
    return JSON.parse(data) as LiveStreamEvent;
  } catch {
    return null;
  }
};

const isBillRelatedQuery = (queryKey: readonly unknown[]) => {
  const [first, , third] = queryKey;

  if (typeof first !== "string") {
    return false;
  }

  if (
    first === "/api/bills" ||
    first.startsWith("/api/bills/") ||
    first === "/api/bill-payments" ||
    first === "/api/orders" ||
    first.startsWith("/api/orders/")
  ) {
    return true;
  }

  if (first === "/api/clients") {
    return (
      queryKey.length <= 2 ||
      third === "bills" ||
      third === "unpaid-bills" ||
      third === "orders" ||
      third === "unpaid-balance"
    );
  }

  return false;
};

const isClientTransactionRelatedQuery = (queryKey: readonly unknown[]) => {
  const [first, , third] = queryKey;

  if (typeof first !== "string") {
    return false;
  }

  if (
    first === "/api/company-payment-transactions" ||
    first === "/api/reports/credit-transactions"
  ) {
    return true;
  }

  if (first === "/api/clients") {
    return queryKey.length === 1 || third === "transactions";
  }

  return false;
};

export function useLiveBillsStream(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const eventSource = new EventSource("/api/streams/bills");

    eventSource.onmessage = (event) => {
      const payload = parseLiveStreamEvent(event.data);
      if (payload?.type !== "updated") return;

      void queryClient.invalidateQueries({
        predicate: (query) => isBillRelatedQuery(query.queryKey),
      });
    };

    return () => {
      eventSource.close();
    };
  }, [enabled]);
}

export function useLiveClientTransactionsStream(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const eventSource = new EventSource("/api/streams/client-transactions");
    let invalidateTimeout: ReturnType<typeof setTimeout> | null = null;

    eventSource.onmessage = (event) => {
      const payload = parseLiveStreamEvent(event.data);
      if (payload?.type !== "updated") return;

      if (invalidateTimeout) {
        clearTimeout(invalidateTimeout);
      }

      invalidateTimeout = setTimeout(() => {
        void queryClient.invalidateQueries({
          predicate: (query) => isClientTransactionRelatedQuery(query.queryKey),
        });
      }, 150);
    };

    return () => {
      if (invalidateTimeout) {
        clearTimeout(invalidateTimeout);
      }
      eventSource.close();
    };
  }, [enabled]);
}

export function useLiveProductCategorySettingsStream(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const eventSource = new EventSource(
      "/api/streams/product-category-settings",
    );

    eventSource.onmessage = (event) => {
      const payload = parseLiveStreamEvent(event.data);
      if (payload?.type !== "updated") return;

      void queryClient.invalidateQueries({
        queryKey: [PRODUCT_CATEGORY_SETTINGS_QUERY_KEY],
      });
    };

    return () => {
      eventSource.close();
    };
  }, [enabled]);
}
