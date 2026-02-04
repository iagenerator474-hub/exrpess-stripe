import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

export function getApiBaseUrl(): string {
  return baseURL;
}

/** Set Bearer token for protected routes. Call after login/refresh; clear on logout. */
export function setAuthToken(token: string | null): void {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common["Authorization"];
  }
}

/** Extract a user-friendly message from API error (body.message or body.error or statusText) */
function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    if (data && typeof data === "object") {
      if (typeof (data as { message?: string }).message === "string")
        return (data as { message: string }).message;
      if (typeof (data as { error?: string }).error === "string")
        return (data as { error: string }).error;
    }
    return err.response?.statusText ?? err.message ?? "Erreur réseau";
  }
  return err instanceof Error ? err.message : "Erreur inconnue";
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    console.error("[API]", err.response?.status, err.response?.data ?? err.message);
    const message = getErrorMessage(err);
    return Promise.reject(new Error(message));
  }
);
