import type { ApiError, ApiErrorDetail, ApiMeta, AuthResponseDto, ErrorCode } from '@mm/shared-types';
import { authSnapshot, useAuthStore } from './auth-store.ts';

const BASE = '/api/v1';

export class ApiClientError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR';
  readonly status: number;
  readonly details?: ApiErrorDetail[];

  constructor(
    code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    status: number,
    details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface Envelope<T> {
  data: T;
  meta?: ApiMeta;
}

/**
 * Single-flight refresh.
 *
 * Ten queries can 401 at the same moment. Firing ten refreshes would rotate the
 * cookie ten times against one family — and with reuse detection on, the second
 * arrival revokes the whole family and signs the user out. So concurrent
 * callers all await the same in-flight promise.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const body = (await res.json()) as Envelope<AuthResponseDto>;
      useAuthStore.getState().setSession(body.data.accessToken, body.data.user);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function toError(res: Response): Promise<ApiClientError> {
  try {
    const body = (await res.json()) as ApiError;
    return new ApiClientError(
      body.error.code,
      body.error.message,
      res.status,
      body.error.details,
    );
  } catch {
    return new ApiClientError('INTERNAL_ERROR', `Request failed (${res.status})`, res.status);
  }
}

async function send<T>(
  method: string,
  path: string,
  payload?: unknown,
  retrying = false,
): Promise<Envelope<T>> {
  const { accessToken } = authSnapshot();

  const headers: Record<string, string> = {};
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      // Sends the httpOnly refresh cookie through the Vite proxy.
      credentials: 'include',
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch {
    throw new ApiClientError('NETWORK_ERROR', 'Could not reach the server', 0);
  }

  if (res.status === 401 && !retrying) {
    const error = await toError(res.clone());
    // Retry exactly once, and only for an expired access token. Anything else
    // means the session is genuinely gone.
    if (error.code === 'TOKEN_EXPIRED' || error.code === 'UNAUTHENTICATED') {
      if (await refreshSession()) return send<T>(method, path, payload, true);
      useAuthStore.getState().clear();
    }
    throw error;
  }

  if (!res.ok) throw await toError(res);
  if (res.status === 204) return { data: undefined as T };

  return (await res.json()) as Envelope<T>;
}

export const api = {
  get: <T>(path: string) => send<T>('GET', path),
  post: <T>(path: string, payload?: unknown) => send<T>('POST', path, payload),
  patch: <T>(path: string, payload?: unknown) => send<T>('PATCH', path, payload),
  del: <T>(path: string) => send<T>('DELETE', path),
  /** Bootstrap: try to restore a session from the refresh cookie on load. */
  restoreSession: refreshSession,
};

export function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
