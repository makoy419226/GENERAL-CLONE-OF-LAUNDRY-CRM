import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { api } from "@shared/routes";
import type {
  BillFilterSummaryInput,
  BillFilterSummaryResponse,
} from "@shared/billFilters";
import type { Bill, CreateBillRequest } from "@shared/schema";

export type BillWithPaymentRecorder = Bill & {
  paymentProcessedBy?: string | null;
  paymentProcessedAt?: string | null;
};

type BillsQueryOptions = Omit<
  UseQueryOptions<BillWithPaymentRecorder[], Error>,
  "queryKey"
>;

export function useBills(options?: BillsQueryOptions) {
  return useQuery<BillWithPaymentRecorder[]>({
    queryKey: [api.bills.list.path],
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: "always",
    ...options,
  });
}

export function useBill(id: number) {
  const url = api.bills.get.path.replace(":id", String(id));
  return useQuery<BillWithPaymentRecorder>({
    queryKey: [url],
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: "always",
  });
}

export function useBillFilterSummary(filters: BillFilterSummaryInput) {
  return useQuery<BillFilterSummaryResponse>({
    queryKey: [api.bills.list.path, "filter-summary", filters],
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: "always",
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();

      if (filters.search) params.set("search", filters.search);
      if (filters.timePeriod) params.set("timePeriod", filters.timePeriod);
      if (filters.paymentFilter) params.set("paymentFilter", filters.paymentFilter);
      if (filters.exactDate) params.set("exactDate", filters.exactDate);
      if (filters.customDateFrom) params.set("customDateFrom", filters.customDateFrom);
      if (filters.customDateTo) params.set("customDateTo", filters.customDateTo);
      if (filters.rangeApplied !== undefined) {
        params.set("rangeApplied", String(filters.rangeApplied));
      }

      const query = params.toString();
      const response = await fetch(
        query
          ? `${api.bills.filterSummary.path}?${query}`
          : api.bills.filterSummary.path,
        {
          credentials: "include",
          signal,
        },
      );

      if (!response.ok) {
        throw new Error("Failed to load bill filter summary");
      }

      return response.json() as Promise<BillFilterSummaryResponse>;
    },
  });
}

export function useCreateBill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateBillRequest) => {
      const response = await apiRequest("POST", api.bills.create.path, data);
      return response.json() as Promise<Bill>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.bills.list.path] });
    },
  });
}

export function useDeleteBill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, adminPin }: { id: number; adminPin: string }) => {
      await apiRequest("POST", `/api/bills/${id}/delete`, { adminPin }, {
        headers: {
          "X-Admin-Pin": adminPin,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.bills.list.path] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    },
  });
}
