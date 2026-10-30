import { readFileSync } from 'fs';
import { VlesError, type VlesClient } from '../../src/vles/client.js';
import type { VlesListEndpoint, VlesPage, VlesUnitDetail } from '../../src/vles/types.js';

/** Parsed JSON of a recorded VLES response in tests/fixtures/vles/. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fixture(name: string): any {
  return JSON.parse(readFileSync(new URL(`../fixtures/vles/${name}`, import.meta.url), 'utf8'));
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** A fetch that answers with the scripted responses in order and records what it was asked. */
export function fakeFetch(responses: Response[]): {
  fetch: typeof fetch;
  calls: { url: string; headers: Record<string, string> }[];
} {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const queue = [...responses];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    calls.push({ url: String(input), headers });
    const next = queue.shift();
    if (!next) throw new Error('fakeFetch: no scripted response left');
    return next;
  }) as typeof fetch;
  return { fetch: fake, calls };
}

type ListScript = { [E in VlesListEndpoint]?: (VlesPage | VlesError)[] };

/**
 * A VlesClient that replays a script: each listPage call for an endpoint returns (or throws)
 * that endpoint's next entry; getUnit answers from units_detail, null when absent.
 */
export function fakeClient(
  script: ListScript & { units_detail?: Record<number, VlesUnitDetail>; delayMs?: number }
): VlesClient & { calls: { endpoint: string; updatedSince: string; cursor?: string }[] } {
  const calls: { endpoint: string; updatedSince: string; cursor?: string }[] = [];
  const queues: ListScript = {};
  for (const e of ['units', 'unit-types', 'promos', 'mortgage-banks'] as const) queues[e] = [...(script[e] ?? [])];
  const pause = () => (script.delayMs ? new Promise((r) => setTimeout(r, script.delayMs)) : Promise.resolve());
  return {
    calls,
    async listPage(endpoint, params) {
      calls.push({ endpoint, updatedSince: params.updatedSince, cursor: params.cursor });
      await pause();
      const next = queues[endpoint]?.shift();
      if (!next) throw new Error(`fakeClient: no scripted page left for ${endpoint}`);
      if (next instanceof VlesError) throw next;
      return next;
    },
    async getUnit(id) {
      await pause();
      return script.units_detail?.[id] ?? null;
    },
  };
}
