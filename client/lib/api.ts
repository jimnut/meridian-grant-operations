import type { ApiErrorBody } from '../../shared/types';

/**
 * Thin fetch wrapper.
 *
 * - always sends cookies (session is HttpOnly);
 * - attaches the double-submit CSRF token to every mutation;
 * - converts API error bodies into a typed error the UI can render inline.
 */

let csrfToken = '';

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.fields = fields ?? {};
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isPermissionError(): boolean {
    return this.status === 403;
  }
}

type Body = Record<string, unknown> | FormData | undefined;

async function request<T>(method: string, path: string, body?: Body): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;

  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  if (method !== 'GET' && csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: payload,
    credentials: 'same-origin',
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok) {
    let message = 'Something went wrong. Please try again.';
    let code = 'INTERNAL';
    let fields: Record<string, string> | undefined;

    if (contentType.includes('application/json')) {
      try {
        const parsed = (await response.json()) as ApiErrorBody;
        message = parsed.error?.message ?? message;
        code = parsed.error?.code ?? code;
        fields = parsed.error?.fields;
      } catch {
        // Fall through to the generic message.
      }
    }
    throw new ApiRequestError(response.status, code, message, fields);
  }

  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: Body) => request<T>('POST', path, body),
  put: <T>(path: string, body?: Body) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: Body) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

/**
 * Trigger a browser download for an export endpoint. Fetches with credentials so
 * the tenant check runs, then hands the blob to a temporary anchor.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!response.ok) {
    let message = 'That download is not available.';
    try {
      const parsed = (await response.json()) as ApiErrorBody;
      message = parsed.error?.message ?? message;
    } catch {
      // keep the fallback message
    }
    throw new ApiRequestError(response.status, 'DOWNLOAD', message);
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? fallbackName;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}
