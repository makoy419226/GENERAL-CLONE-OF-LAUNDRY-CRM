import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function extractApiErrorMessage(error: unknown, fallback = "Request failed.") {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (!rawMessage.trim()) {
    return fallback;
  }

  const jsonStart = rawMessage.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart));
      const message = typeof parsed?.message === "string" ? parsed.message.trim() : "";
      const errorText = typeof parsed?.error === "string" ? parsed.error.trim() : "";
      return message || errorText || fallback;
    } catch {
      // Fall through to status-prefix cleanup below.
    }
  }

  const statusMatch = rawMessage.match(/^\d{3}:\s*([\s\S]+)$/);
  return statusMatch?.[1]?.trim() || rawMessage;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<Response> {
  const requestHeaders = {
    ...(data ? { "Content-Type": "application/json" } : {}),
    ...getAuthHeaders(),
    ...(init?.headers ?? {}),
  };
  const res = await fetch(url, {
    method,
    headers: requestHeaders,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    signal: init?.signal,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers: getAuthHeaders(),
      signal,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
