import { VlesPage, VlesUnitDetail, type VlesListEndpoint } from './types.js';

export class VlesError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly status: number,
    detail?: string
  ) {
    // Never put the API key here: these messages are logged and stored in vles_sync_state.
    super(`VLES ${endpoint} failed with ${status}${detail ? `: ${detail}` : ''}`);
    this.name = 'VlesError';
  }
}

export type VlesClient = {
  listPage(
    endpoint: VlesListEndpoint,
    params: { updatedSince: string; cursor?: string; limit?: number }
  ): Promise<VlesPage>;
  getUnit(id: number): Promise<VlesUnitDetail | null>;
};

const BACKOFF_MS = [2000, 4000];
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_S = 60;

export function createVlesClient(opts: {
  baseUrl: string;
  apiKey: string;
  maxRequestsPerMinute: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): VlesClient {
  const doFetch = opts.fetch ?? fetch;
  const rawSleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const minIntervalMs = 60_000 / opts.maxRequestsPerMinute;
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');

  let lastStart: number | null = null;
  // Time spent in our own sleeps since the last request started. A retry that already waited
  // out its backoff must not wait again for the rate spacing.
  let sleptSinceStart = 0;
  const sleep = async (ms: number) => {
    sleptSinceStart += ms;
    await rawSleep(ms);
  };

  async function throttle(): Promise<void> {
    if (lastStart !== null) {
      const elapsed = Math.max(now() - lastStart, sleptSinceStart);
      const wait = minIntervalMs - elapsed;
      if (wait > 0) await sleep(wait);
    }
    lastStart = now();
    sleptSinceStart = 0;
  }

  /** GET with throttling and retries. Returns the final Response (2xx or a non-retryable status). */
  async function get(label: string, url: string): Promise<Response> {
    let rateLimitRetries = 0;
    let serverRetries = 0;
    for (;;) {
      await throttle();
      let res: Response;
      try {
        res = await doFetch(url, { headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: 'application/json' } });
      } catch (err) {
        if (serverRetries < BACKOFF_MS.length) {
          await sleep(BACKOFF_MS[serverRetries++]!);
          continue;
        }
        throw new VlesError(label, 0, err instanceof Error ? err.message : String(err));
      }
      if (res.status === 429 && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
        rateLimitRetries++;
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER_S) * 1000);
        continue;
      }
      if (res.status >= 500 && res.status <= 599 && serverRetries < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[serverRetries++]!);
        continue;
      }
      return res;
    }
  }

  async function errorFor(label: string, res: Response): Promise<VlesError> {
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === 'string') detail = body.message;
    } catch {
      // body was not JSON; the status alone is enough
    }
    return new VlesError(label, res.status, detail);
  }

  return {
    async listPage(endpoint, params) {
      const qs = new URLSearchParams({ updated_since: params.updatedSince, limit: String(params.limit ?? 500) });
      if (params.cursor !== undefined) qs.set('cursor', params.cursor);
      const res = await get(endpoint, `${baseUrl}/${endpoint}?${qs.toString()}`);
      if (!res.ok) throw await errorFor(endpoint, res);
      return VlesPage.parse(await res.json());
    },

    async getUnit(id) {
      const label = `units/${id}`;
      const res = await get(label, `${baseUrl}/units/${id}`);
      if (res.status === 404) return null;
      if (!res.ok) throw await errorFor(label, res);
      return VlesUnitDetail.parse(await res.json());
    },
  };
}
