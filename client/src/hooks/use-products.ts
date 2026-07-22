import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  buildUrl,
  type ProductInput,
  type ProductUpdateInput,
} from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useProducts(search?: string, category?: string) {
  const queryParams = new URLSearchParams();
  if (search) queryParams.set("search", search);
  if (category) queryParams.set("category", category);

  const queryString = queryParams.toString();
  const path = queryString
    ? `${api.products.list.path}?${queryString}`
    : api.products.list.path;

  return useQuery({
    queryKey: [api.products.list.path, search, category],
    queryFn: async ({ signal }) => {
      const res = await fetch(path, { credentials: "include", signal });
      if (!res.ok) throw new Error("Failed to fetch products");
      return api.products.list.responses[200]
        .parse(await res.json())
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

export function useProduct(id: number) {
  return useQuery({
    queryKey: [api.products.get.path, id],
    queryFn: async ({ signal }) => {
      const url = buildUrl(api.products.get.path, { id });
      const res = await fetch(url, { credentials: "include", signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch product");
      return api.products.get.responses[200].parse(await res.json());
    },
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: ProductInput) => {
      // Ensure numeric fields are correctly parsed if coming from form strings
      const coerceNumeric = (val: any) => {
        if (val === undefined) return undefined;
        if (val === null || val === "") return null;
        return String(val);
      };

      const payload = {
        ...data,
        stockQuantity: Number(data.stockQuantity),
        price: coerceNumeric(data.price),
        urgentPrice: coerceNumeric((data as any).urgentPrice),
        dryCleanPrice: coerceNumeric((data as any).dryCleanPrice),
        ironOnlyPrice: coerceNumeric((data as any).ironOnlyPrice),
        hasSizes: (data as any).hasSizes !== undefined ? Boolean((data as any).hasSizes) : undefined,
        smallPrice: coerceNumeric((data as any).smallPrice),
        mediumPrice: coerceNumeric((data as any).mediumPrice),
        largePrice: coerceNumeric((data as any).largePrice),
        smallUrgentPrice: coerceNumeric((data as any).smallUrgentPrice),
        mediumUrgentPrice: coerceNumeric((data as any).mediumUrgentPrice),
        largeUrgentPrice: coerceNumeric((data as any).largeUrgentPrice),
        smallDryCleanPrice: coerceNumeric((data as any).smallDryCleanPrice),
        mediumDryCleanPrice: coerceNumeric((data as any).mediumDryCleanPrice),
        largeDryCleanPrice: coerceNumeric((data as any).largeDryCleanPrice),
        smallIronOnlyPrice: coerceNumeric((data as any).smallIronOnlyPrice),
        mediumIronOnlyPrice: coerceNumeric((data as any).mediumIronOnlyPrice),
        largeIronOnlyPrice: coerceNumeric((data as any).largeIronOnlyPrice),
      };

      const res = await fetch(api.products.create.path, {
        method: api.products.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 400) {
          const error = api.products.create.responses[400].parse(
            await res.json(),
          );
          throw new Error(error.message);
        }
        throw new Error("Failed to create product");
      }
      return api.products.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.products.list.path] });
      toast({
        title: "Product Created",
        description: "The new product has been added to inventory.",
        variant: "default",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: { id: number } & ProductUpdateInput) => {
      // Coerce types if needed. Send null as actual null (not the string "null").
      const coerceNumeric = (val: any) => {
        if (val === undefined) return undefined;
        if (val === null || val === "") return null;
        return String(val);
      };

      const payload = {
        ...updates,
        stockQuantity:
          updates.stockQuantity !== undefined
            ? Number(updates.stockQuantity)
            : undefined,
        price: coerceNumeric(updates.price),
        urgentPrice: coerceNumeric((updates as any).urgentPrice),
        dryCleanPrice: coerceNumeric(updates.dryCleanPrice),
        ironOnlyPrice: coerceNumeric(updates.ironOnlyPrice),
        hasSizes: (updates as any).hasSizes !== undefined ? Boolean((updates as any).hasSizes) : undefined,
        // Always send size prices (even empty) so they can be cleared server-side
        smallPrice: coerceNumeric(updates.smallPrice),
        mediumPrice: coerceNumeric(updates.mediumPrice),
        largePrice: coerceNumeric(updates.largePrice),
        smallUrgentPrice: coerceNumeric((updates as any).smallUrgentPrice),
        mediumUrgentPrice: coerceNumeric((updates as any).mediumUrgentPrice),
        largeUrgentPrice: coerceNumeric((updates as any).largeUrgentPrice),
        smallDryCleanPrice: coerceNumeric((updates as any).smallDryCleanPrice),
        mediumDryCleanPrice: coerceNumeric((updates as any).mediumDryCleanPrice),
        largeDryCleanPrice: coerceNumeric((updates as any).largeDryCleanPrice),
        smallIronOnlyPrice: coerceNumeric((updates as any).smallIronOnlyPrice),
        mediumIronOnlyPrice: coerceNumeric((updates as any).mediumIronOnlyPrice),
        largeIronOnlyPrice: coerceNumeric((updates as any).largeIronOnlyPrice),
        description: updates.description !== undefined ? (updates.description || null) : undefined,
      };

      const url = buildUrl(api.products.update.path, { id });
      const res = await fetch(url, {
        method: api.products.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 400) {
          const error = api.products.update.responses[400].parse(
            await res.json(),
          );
          throw new Error(error.message);
        }
        if (res.status === 404) throw new Error("Product not found");
        throw new Error("Failed to update product");
      }
      return api.products.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.products.list.path] });
      toast({
        title: "Product Updated",
        description: "Your changes have been saved.",
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.products.delete.path, { id });
      const res = await fetch(url, {
        method: api.products.delete.method,
        credentials: "include",
      });
      if (res.status === 404) throw new Error("Product not found");
      if (!res.ok) throw new Error("Failed to delete product");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.products.list.path] });
      toast({
        title: "Product Deleted",
        description: "Item removed from inventory.",
      });
    },
    onError: (error) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
