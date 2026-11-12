import { useAuthStore } from '../store/authStore.ts';
import type { BackendPrefabSummary } from '../store/prefabStore.ts';

export type PrefabApiErrorCode = 'UNAUTHORIZED' | 'NETWORK' | 'VALIDATION' | 'SERVER';

export class PrefabApiError extends Error {
  readonly status: number;
  readonly code: PrefabApiErrorCode;

  constructor(status: number, code: PrefabApiErrorCode, message: string) {
    super(message);
    this.name = 'PrefabApiError';
    this.status = status;
    this.code = code;
  }
}

export interface PrefabClientOptions {
  baseUrl?: string;
  accessToken?: string | null;
  token?: string | null;
  fetchFn?: typeof fetch;
}

const DEFAULT_API_BASE_URL = 'http://localhost:8080/api';

function getDefaultBaseUrl(): string {
  const metaEnv = (import.meta as { env?: { VITE_API_URL?: string } }).env;
  const configured = metaEnv?.VITE_API_URL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_API_BASE_URL;
}

/**
 * Normalizes base URL inputs such as:
 * - http://localhost:8080
 * - http://localhost:8080/api
 * - http://localhost:8080/api/v1
 * so requests always target `<origin>/api/v1/prefabs`.
 */
export function normalizePrefabsBaseUrl(rawBaseUrl?: string): string {
  const base = (rawBaseUrl?.trim() || getDefaultBaseUrl()).replace(/\/+$/, '');
  if (base.endsWith('/api/v1/prefabs')) {
    return base;
  }
  if (base.endsWith('/api/v1')) {
    return `${base}/prefabs`;
  }
  if (base.endsWith('/api')) {
    return `${base}/v1/prefabs`;
  }
  return `${base}/api/v1/prefabs`;
}

function resolveAccessToken(options?: PrefabClientOptions): string | null {
  if (options && 'accessToken' in options && options.accessToken !== undefined) {
    return options.accessToken;
  }
  if (options && 'token' in options && options.token !== undefined) {
    return options.token;
  }
  return useAuthStore.getState().accessToken;
}

function buildAuthHeaders(
  options?: PrefabClientOptions,
  extraHeaders?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = { ...extraHeaders };
  const token = resolveAccessToken(options);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function mapStatusToErrorCode(status: number): PrefabApiErrorCode {
  if (status === 401 || status === 403) {
    return 'UNAUTHORIZED';
  }
  if (status >= 400 && status < 500) {
    return 'VALIDATION';
  }
  return 'SERVER';
}

async function parseErrorMessage(response: Response): Promise<string> {
  const fallback = response.statusText || `Request failed with status ${response.status}`;
  try {
    const text = await response.text();
    if (!text) {
      return fallback;
    }
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      if (typeof parsed.error === 'string' && parsed.error.length > 0) {
        return parsed.error;
      }
      if (typeof parsed.message === 'string' && parsed.message.length > 0) {
        return parsed.message;
      }
    } catch {
      // Plain text error body
    }
    return text;
  } catch {
    return fallback;
  }
}

async function executeFetch(
  url: string,
  init: RequestInit,
  options?: PrefabClientOptions
): Promise<Response> {
  const fetchImpl = options?.fetchFn ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new PrefabApiError(0, 'NETWORK', 'Fetch API is unavailable in this environment');
  }

  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new PrefabApiError(0, 'NETWORK', message);
  }

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    throw new PrefabApiError(response.status, mapStatusToErrorCode(response.status), message);
  }

  return response;
}

function toArrayBuffer(payload: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (payload instanceof ArrayBuffer) {
    return payload;
  }
  return payload.slice().buffer;
}

export async function savePrefabToBackend(
  name: string,
  payload: ArrayBuffer | Uint8Array,
  options?: PrefabClientOptions
): Promise<BackendPrefabSummary> {
  const url = normalizePrefabsBaseUrl(options?.baseUrl);
  const body = toArrayBuffer(payload);
  const headers = buildAuthHeaders(options, {
    'Content-Type': 'application/octet-stream',
    'X-Prefab-Name': name,
  });

  const response = await executeFetch(
    url,
    {
      method: 'POST',
      headers,
      body,
    },
    options
  );

  return (await response.json()) as BackendPrefabSummary;
}

export async function listBackendPrefabs(
  options?: PrefabClientOptions
): Promise<BackendPrefabSummary[]> {
  const url = normalizePrefabsBaseUrl(options?.baseUrl);
  const headers = buildAuthHeaders(options);

  const response = await executeFetch(
    url,
    {
      method: 'GET',
      headers,
    },
    options
  );

  return (await response.json()) as BackendPrefabSummary[];
}

export async function fetchBackendPrefabPayload(
  id: number,
  options?: PrefabClientOptions
): Promise<ArrayBuffer> {
  const baseUrl = normalizePrefabsBaseUrl(options?.baseUrl);
  const url = `${baseUrl}/${encodeURIComponent(String(id))}`;
  const headers = buildAuthHeaders(options);

  const response = await executeFetch(
    url,
    {
      method: 'GET',
      headers,
    },
    options
  );

  return await response.arrayBuffer();
}

export async function deleteBackendPrefab(
  id: number,
  options?: PrefabClientOptions
): Promise<void> {
  const baseUrl = normalizePrefabsBaseUrl(options?.baseUrl);
  const url = `${baseUrl}/${encodeURIComponent(String(id))}`;
  const headers = buildAuthHeaders(options);

  await executeFetch(
    url,
    {
      method: 'DELETE',
      headers,
    },
    options
  );
}
