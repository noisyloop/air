/**
 * Typed fetch client. Keeps the access token in memory only; on 401 it runs a
 * single refresh (cookie-based) and retries the request once.
 */

export const API_URL: string = import.meta.env.VITE_API_URL ?? '/api';
export const WS_URL: string =
  import.meta.env.VITE_WS_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}
export function setSessionExpiredHandler(fn: () => void): void {
  onSessionExpired = fn;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-air-client': 'web' },
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken: string };
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshPromise = null), 0);
    }
  })();
  return refreshPromise;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; retry?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, retry = true } = options;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      'x-air-client': 'web',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    if (await tryRefresh()) return api<T>(path, { method, body, retry: false });
    onSessionExpired?.();
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new ApiError(res.status, err.code ?? 'UNKNOWN', err.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Restore a session on page load using the refresh cookie. */
export async function bootstrapSession(): Promise<{ accessToken: string } | null> {
  const ok = await tryRefresh();
  return ok && accessToken ? { accessToken } : null;
}

export function streamUrl(trackId: string, token: string, quality = 'auto'): string {
  return `${API_URL}/stream/${trackId}?token=${encodeURIComponent(token)}&quality=${quality}`;
}
