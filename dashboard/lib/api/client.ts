/**
 * Server-only client for the API. API_SECRET_KEY must never reach the browser, so never import
 * this from a Client Component.
 */

const API_URL = process.env.API_INTERNAL_URL ?? "http://localhost:50060";
const API_KEY = process.env.API_SECRET_KEY ?? "";

export interface ApiEnvelope<T> {
  data: T | null;
  error: string | null;
  meta?: { page: number; total: number; limit: number; totalPages: number };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    // meta.count of errors such as HAS_UPCOMING_VISITS.
    public count?: number
  ) {
    super(`API ${status}: ${code}`);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const hasBody = init?.body != null;
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${API_KEY}`,
      ...init?.headers,
    },
    cache: init?.cache ?? "no-store",
  });
  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    // empty or non-JSON body
  }
  if (!res.ok) {
    const count = (body?.meta as { count?: number } | undefined)?.count;
    throw new ApiError(res.status, body?.error ?? "UNKNOWN", count);
  }
  return body ?? { data: null, error: null };
}
