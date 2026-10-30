import { getConfig } from '../config.js';
import { createVlesClient, type VlesClient } from './client.js';
import type { VlesListEndpoint } from './types.js';
import {
  getSyncState,
  markSyncStarted,
  markSyncOk,
  markSyncError,
  upsertPage,
  listAvailableUnitIds,
  replaceUnitSchemes,
  deleteSchemesExceptUnits,
} from './repository.js';

// Every list call sends updated_since: only those responses carry sync.server_time (the
// watermark for the next run) and tombstones for deleted rows. The first run uses an epoch.
export const EPOCH_SINCE = '2000-01-01T00:00:00+07:00';

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** The same instant written as WIB wall-clock time, e.g. 2026-10-30T19:57:26+07:00. */
export function toWibIso(d: Date): string {
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 19) + '+07:00';
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function syncEndpoint(
  client: VlesClient,
  endpoint: VlesListEndpoint,
  clock: () => Date = () => new Date()
): Promise<{ pages: number; upserted: number; tombstoned: number; serverTime: string | null }> {
  const state = await getSyncState(endpoint);
  const since = state?.lastServerTime ? toWibIso(state.lastServerTime) : EPOCH_SINCE;
  await markSyncStarted(endpoint, clock());
  let cursor: string | undefined;
  let serverTime: string | null = null;
  let pages = 0;
  let upserted = 0;
  let tombstoned = 0;
  try {
    for (;;) {
      const page = await client.listPage(endpoint, { updatedSince: since, cursor });
      if (pages === 0) serverTime = page.sync?.server_time ?? null;
      const r = await upsertPage(endpoint, page.data, clock());
      pages++;
      upserted += r.upserted;
      tombstoned += r.tombstoned;
      if (!page.page.next_cursor) break;
      cursor = page.page.next_cursor;
    }
    // Only now: a run that dies between pages must start again from the old watermark.
    await markSyncOk(endpoint, serverTime, clock());
  } catch (err) {
    await markSyncError(endpoint, message(err), clock());
    throw err;
  }
  return { pages, upserted, tombstoned, serverTime };
}

/** Payment schemes live on /units/{id}; refresh them for every unit that is for sale. */
export async function refreshSchemes(
  client: VlesClient,
  clock: () => Date = () => new Date()
): Promise<{ units: number; schemes: number; pruned: number }> {
  await markSyncStarted('unit-schemes', clock());
  try {
    const ids = await listAvailableUnitIds();
    let schemes = 0;
    for (const id of ids) {
      const detail = await client.getUnit(id);
      await replaceUnitSchemes(id, detail?.schemes ?? [], clock());
      schemes += detail?.schemes.length ?? 0;
    }
    const pruned = await deleteSchemesExceptUnits(ids);
    await markSyncOk('unit-schemes', null, clock());
    return { units: ids.length, schemes, pruned };
  } catch (err) {
    await markSyncError('unit-schemes', message(err), clock());
    throw err;
  }
}

let running = false;

export function isVlesSyncRunning(): boolean {
  return running;
}

const LIST_ORDER: VlesListEndpoint[] = ['unit-types', 'units', 'promos', 'mortgage-banks'];

/** One full pass. Each step is isolated: a failing endpoint keeps its rows and the rest still run. */
export async function runVlesSync(
  client: VlesClient
): Promise<{ skipped: true } | { skipped: false; results: Record<string, { ok: boolean; error?: string }> }> {
  if (running) return { skipped: true };
  running = true;
  try {
    const results: Record<string, { ok: boolean; error?: string }> = {};
    for (const endpoint of LIST_ORDER) {
      try {
        await syncEndpoint(client, endpoint);
        results[endpoint] = { ok: true };
      } catch (err) {
        results[endpoint] = { ok: false, error: message(err) };
      }
    }
    try {
      await refreshSchemes(client);
      results['unit-schemes'] = { ok: true };
    } catch (err) {
      results['unit-schemes'] = { ok: false, error: message(err) };
    }
    return { skipped: false, results };
  } finally {
    running = false;
  }
}

function logRun(r: Awaited<ReturnType<typeof runVlesSync>>): void {
  if (r.skipped) return;
  const parts = Object.entries(r.results).map(([k, v]) => (v.ok ? `${k} ok` : `${k} FAILED (${v.error})`));
  console.log(`[vles] sync: ${parts.join(', ')}`);
}

/** Runs once now, then every intervalMs. 0 disables the timer. Returns a stop function. */
export function startVlesSync(client: VlesClient, intervalMs: number): () => void {
  if (intervalMs === 0) return () => {};
  const tick = () => {
    runVlesSync(client).then(logRun, (err) => console.error('[vles] sync crashed:', message(err)));
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}

let _client: VlesClient | null | undefined;

/** The process-wide client built from config; null when VLES_API_KEY is empty. */
export function getVlesClient(): VlesClient | null {
  if (_client !== undefined) return _client;
  const c = getConfig();
  _client = c.VLES_API_KEY
    ? createVlesClient({ baseUrl: c.VLES_BASE_URL, apiKey: c.VLES_API_KEY, maxRequestsPerMinute: c.VLES_MAX_REQ_PER_MIN })
    : null;
  return _client;
}
