import { deviceMode } from "../lib/DeviceMode.ts";
import { t } from "../i18n/I18n.ts";

/**
 * Thin wrapper around `fetch` for the Cinemion API. Holds the login token.
 */
export namespace BaseApi {
  const TOKEN_KEY = "cn-token";
  let _token: string | null = readToken();

  let _onUnauthorized: (() => void) | null = null;

  /**
   * Set what happens when the server rejects the token, like returning to the profile picker.
   */
  export function setOnUnauthorized(handler: () => void) {
    _onUnauthorized = handler;
  }

  function readToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  export function getToken() {
    return _token;
  }

  export function setToken(token: string | null) {
    _token = token;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage blocked: the session lasts until the tab closes
    }
  }

  export function getHeaders(json = true): HeadersInit {
    const headers: Record<string, string> = {};
    if (json) headers["Content-Type"] = "application/json";
    if (_token) headers["Authorization"] = `Bearer ${_token}`;
    // Lets the server name this device ("TV · Chrome") on the dashboard and in the activity feed
    headers["X-Cinemion-Device-Mode"] = deviceMode.mode;
    return headers;
  }

  async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers: getHeaders(!isForm && body !== undefined),
        body: isForm ? body as FormData : body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error(t("api.unreachable"));
    }

    // Sign-in calls answer 401 for a wrong PIN or password; only other calls mean the session ended
    if (res.status === 401 && _token && !path.startsWith("/auth/")) _onUnauthorized?.();
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.message || res.statusText);
    }
    if (res.status === 204) return undefined as T;
    return await res.json() as T;
  }

  export const GET = <T>(path: string) => request<T>("GET", path);
  export const POST = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
  export const PUT = <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {});
  export const PATCH = <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {});
  export const DELETE = <T>(path: string) => request<T>("DELETE", path);
  export const PUTFormData = <T>(path: string, form: FormData) => request<T>("PUT", path, form, true);
}

export default BaseApi;
