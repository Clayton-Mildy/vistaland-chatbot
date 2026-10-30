import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { fixture, fakeClient } from './helpers/vles.js';
import { getDb } from '../src/db/client.js';
import { vlesUnits, vlesUnitSchemes } from '../src/db/schema/index.js';
import { VlesError } from '../src/vles/client.js';
import { upsertPage, markSyncOk, getSyncState } from '../src/vles/repository.js';
import { EPOCH_SINCE, syncEndpoint, refreshSchemes, runVlesSync, toWibIso } from '../src/vles/sync.js';

beforeEach(() =>
  truncate('vles_units', 'vles_unit_schemes', 'vles_promos', 'vles_unit_types', 'vles_mortgage_banks', 'vles_sync_state')
);

const others = () => ({
  'unit-types': [fixture('unit-types.json')],
  promos: [fixture('promos.json')],
  'mortgage-banks': [fixture('mortgage-banks.json')],
});

it('first run uses EPOCH_SINCE, follows the cursor, and stores server_time from page 1', async () => {
  const p1 = fixture('units-page-1.json');
  const p2 = { ...fixture('units-page-2.json'), page: { limit: 3, next_cursor: null } };
  const c = fakeClient({ units: [p1, p2] });
  const r = await syncEndpoint(c, 'units');
  expect(c.calls[0]).toMatchObject({ endpoint: 'units', updatedSince: EPOCH_SINCE, cursor: undefined });
  expect(c.calls[1]!.cursor).toBe(p1.page.next_cursor);
  expect(r.pages).toBe(2);
  expect((await getSyncState('units'))!.lastServerTime!.toISOString()).toBe(new Date(p1.sync.server_time).toISOString());
});

it('next run sends the stored server_time as +07:00', async () => {
  await markSyncOk('units', '2026-10-30T19:57:26+07:00', new Date());
  const c = fakeClient({ units: [fixture('units-tombstone.json')] });
  await syncEndpoint(c, 'units');
  expect(c.calls[0]!.updatedSince).toBe('2026-10-30T19:57:26+07:00');
});

it('failure on page 2 keeps the previous server_time and records the error', async () => {
  await markSyncOk('units', '2026-10-30T10:00:00+07:00', new Date());
  const c = fakeClient({ units: [fixture('units-page-1.json'), new VlesError('units', 500)] });
  await expect(syncEndpoint(c, 'units')).rejects.toThrow();
  const s = (await getSyncState('units'))!;
  expect(s.lastServerTime!.toISOString()).toBe('2026-10-30T03:00:00.000Z');
  expect(s.lastError).toMatch(/500/);
});

it('one endpoint failing does not stop the others or delete rows', async () => {
  await upsertPage('units', fixture('units-page-1.json').data, new Date());
  const r = await runVlesSync(fakeClient({ units: [new VlesError('units', 401)], ...others() }));
  expect(r.skipped).toBe(false);
  if (!r.skipped) {
    expect(r.results['units']!.ok).toBe(false);
    expect(r.results['promos']!.ok).toBe(true);
  }
  expect((await getDb().select().from(vlesUnits)).length).toBe(fixture('units-page-1.json').data.length);
});

it('refreshSchemes removes schemes of units no longer for sale', async () => {
  const d = fixture('unit-detail-for-sale.json');
  await upsertPage('units', [d.data], new Date());
  const c = fakeClient({ units_detail: { [d.data.id]: d } });
  await refreshSchemes(c);
  expect((await getDb().select().from(vlesUnitSchemes)).length).toBe(d.schemes.length);
  await upsertPage('units', [{ ...d.data, is_available_for_sale: false }], new Date());
  const r = await refreshSchemes(c);
  expect(r.pruned).toBe(d.schemes.length);
  expect((await getDb().select().from(vlesUnitSchemes)).length).toBe(0);
});

it('a second runVlesSync while one is running is skipped', async () => {
  const c = fakeClient({ units: [fixture('units-tombstone.json')], ...others(), delayMs: 50 });
  const [a, b] = await Promise.all([runVlesSync(c), runVlesSync(c)]);
  expect([a.skipped, b.skipped].sort()).toEqual([false, true]);
});

it('toWibIso renders the instant in +07:00', () => {
  expect(toWibIso(new Date('2026-10-30T12:57:26Z'))).toBe('2026-10-30T19:57:26+07:00');
});
