import { it, expect } from 'vitest';
import { createVlesClient, VlesError } from '../src/vles/client.js';
import { VlesUnitRaw, VlesUnitDetail, isTombstone } from '../src/vles/types.js';
import { fixture, json, fakeFetch } from './helpers/vles.js';

const opts = (o: Partial<Parameters<typeof createVlesClient>[0]>) =>
  createVlesClient({ baseUrl: 'https://v/api', apiKey: 'k', maxRequestsPerMinute: 120, sleep: async () => {}, ...o });

it('sends the bearer key and the updated_since/cursor/limit query', async () => {
  const { fetch, calls } = fakeFetch([json(200, fixture('units-page-1.json'))]);
  await opts({ apiKey: 'k1', fetch }).listPage('units', { updatedSince: '2000-01-01T00:00:00+07:00', cursor: 'abc' });
  expect(calls[0]!.headers['authorization']).toBe('Bearer k1');
  const u = new URL(calls[0]!.url);
  expect(u.pathname).toBe('/api/units');
  expect(u.searchParams.get('updated_since')).toBe('2000-01-01T00:00:00+07:00');
  expect(u.searchParams.get('cursor')).toBe('abc');
  expect(u.searchParams.get('limit')).toBe('500');
});

it('waits Retry-After on 429 then succeeds', async () => {
  const slept: number[] = [];
  const { fetch } = fakeFetch([json(429, {}, { 'retry-after': '2' }), json(200, fixture('promos.json'))]);
  await opts({ fetch, sleep: async (ms) => { slept.push(ms); } }).listPage('promos', { updatedSince: 'x' });
  expect(slept).toContain(2000);
});

it('throws VlesError on 401 without retrying and without the key in the message', async () => {
  const { fetch, calls } = fakeFetch([json(401, { message: 'API key tidak valid.' })]);
  const err = await opts({ apiKey: 'secret-key-123', fetch }).listPage('units', { updatedSince: 'x' }).catch((e) => e);
  expect(err).toBeInstanceOf(VlesError);
  expect(err.status).toBe(401);
  expect(err.message).not.toContain('secret-key-123');
  expect(calls.length).toBe(1);
});

it('retries a 503 twice then throws', async () => {
  const slept: number[] = [];
  const { fetch, calls } = fakeFetch([json(503, {}), json(503, {}), json(503, {})]);
  const err = await opts({ fetch, sleep: async (ms) => { slept.push(ms); } }).listPage('units', { updatedSince: 'x' }).catch((e) => e);
  expect(err.status).toBe(503);
  expect(calls.length).toBe(3);
  expect(slept).toEqual([2000, 4000]);
});

it('getUnit returns null on 404', async () => {
  const { fetch } = fakeFetch([json(404, { message: 'Unit tidak ditemukan' })]);
  expect(await opts({ fetch }).getUnit(1)).toBeNull();
});

it('spaces requests to the configured rate', async () => {
  let t = 0;
  const slept: number[] = [];
  const { fetch } = fakeFetch([json(200, fixture('promos.json')), json(200, fixture('promos.json'))]);
  const c = opts({ maxRequestsPerMinute: 60, fetch, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
  await c.listPage('promos', { updatedSince: 'x' });
  await c.listPage('promos', { updatedSince: 'x' });
  expect(slept).toEqual([1000]);
});

it('every recorded fixture parses with its schema', () => {
  for (const r of fixture('units-page-1.json').data) expect(VlesUnitRaw.safeParse(r).success).toBe(true);
  expect(VlesUnitDetail.safeParse(fixture('unit-detail-for-sale.json')).success).toBe(true);
  expect(fixture('unit-detail-for-sale.json').schemes.length).toBeGreaterThan(0);
  for (const r of fixture('units-tombstone.json').data) expect(isTombstone(r)).toBe(true);
});

it('aborts a request that stalls past the timeout and retries it', async () => {
  let calls = 0;
  const stalled = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    });
  }) as typeof fetch;
  const slept: number[] = [];
  const err = await opts({ fetch: stalled, timeoutMs: 20, sleep: async (ms) => { slept.push(ms); } })
    .listPage('units', { updatedSince: 'x' })
    .catch((e) => e);
  expect(err).toBeInstanceOf(VlesError);
  expect(err.status).toBe(0);
  expect(calls).toBe(3);
  expect(slept).toEqual([2000, 4000]);
});

it('serializes concurrent callers so spacing holds', async () => {
  let t = 0;
  const starts: number[] = [];
  const fetch = (async (url: string | URL | Request) => {
    starts.push(t);
    return json(200, fixture(String(url).includes('/units/') ? 'unit-detail-for-sale.json' : 'promos.json'));
  }) as typeof globalThis.fetch;
  const c = opts({ maxRequestsPerMinute: 60, fetch, now: () => t, sleep: async (ms) => { t += ms; } });
  await Promise.all([c.listPage('promos', { updatedSince: 'x' }), c.listPage('promos', { updatedSince: 'x' }), c.getUnit(1)]);
  expect(starts).toEqual([0, 1000, 2000]);
});
