import { readFileSync } from 'fs';

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
