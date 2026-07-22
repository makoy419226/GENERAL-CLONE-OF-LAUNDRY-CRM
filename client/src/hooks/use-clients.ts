import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { api } from "@shared/routes";
import type { Client, CreateClientRequest, UpdateClientRequest } from "@shared/schema";

export function useClients(search?: string) {
  const url = search ? `${api.clients.list.path}?search=${encodeURIComponent(search)}` : api.clients.list.path;
  return useQuery<Client[]>({
    queryKey: [api.clients.list.path, search ?? ""],
    queryFn: async ({ signal }) => {
      const response = await fetch(url, { credentials: "include", signal });
      if (!response.ok) throw new Error("Failed to fetch clients");
      return response.json();
    },
  });
}

export function useClient(id: number) {
  const url = api.clients.get.path.replace(":id", String(id));
  return useQuery<Client>({
    queryKey: [url],
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateClientRequest) => {
      const response = await apiRequest("POST", api.clients.create.path, data);
      return response.json() as Promise<Client>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.clients.list.path] });
    },
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: UpdateClientRequest }) => {
      const url = api.clients.update.path.replace(":id", String(id));
      const response = await apiRequest("PUT", url, data);
      return response.json() as Promise<Client>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.clients.list.path] });
    },
  });
}

export function useDeleteClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = api.clients.delete.path.replace(":id", String(id));
      await apiRequest("DELETE", url);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.clients.list.path] });
    },
  });
}
