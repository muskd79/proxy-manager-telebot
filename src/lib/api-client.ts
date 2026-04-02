import { toast } from "sonner";

interface FetchOptions extends RequestInit {
  showError?: boolean;
}

interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function apiClient<T = unknown>(
  path: string,
  options: FetchOptions = {}
): Promise<ApiResult<T>> {
  const { showError = true, ...fetchOptions } = options;

  try {
    const res = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
        ...fetchOptions.headers,
      },
      ...fetchOptions,
    });

    const json = await res.json();

    if (!res.ok || json.success === false) {
      const errorMsg = json.error || `Request failed (${res.status})`;
      if (showError) toast.error(errorMsg);
      return { success: false, error: errorMsg };
    }

    return { success: true, data: json.data ?? json };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Network error";
    console.error(`API ${path}:`, err);
    if (showError) toast.error(errorMsg);
    return { success: false, error: errorMsg };
  }
}

// Convenience methods
export const api = {
  get: <T>(path: string, opts?: FetchOptions) => apiClient<T>(path, { method: "GET", ...opts }),
  post: <T>(path: string, body: unknown, opts?: FetchOptions) => apiClient<T>(path, { method: "POST", body: JSON.stringify(body), ...opts }),
  put: <T>(path: string, body: unknown, opts?: FetchOptions) => apiClient<T>(path, { method: "PUT", body: JSON.stringify(body), ...opts }),
  del: <T>(path: string, opts?: FetchOptions) => apiClient<T>(path, { method: "DELETE", ...opts }),
};
