import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { fixture } from './helpers/vles.js';
import { getDb } from '../src/db/client.js';
import { vlesUnits, vlesUnitSchemes, vlesUnitTypes, vlesPromos, vlesMortgageBanks } from '../src/db/schema/index.js';
import {
  upsertPage,
  replaceUnitSchemes,
  deleteSchemesExceptUnits,
  markSyncOk,
  getSyncState,
} from '../src/vles/repository.js';

beforeEach(() =>
  truncate('vles_units', 'vles_unit_schemes', 'vles_promos', 'vles_unit_types', 'vles_mortgage_banks', 'vles_sync_state')
);

it('maps and upserts a units page; a second upsert of the same page changes nothing', async () => {
  const page = fixture('units-page-1.json');
  expect(await upsertPage('units', page.data, new Date())).toEqual({ upserted: page.data.length, tombstoned: 0 });
  await upsertPage('units', page.data, new Date());
  const rows = await getDb().select().from(vlesUnits);
  expect(rows.length).toBe(page.data.length);
  const r = rows.find((x) => x.id === page.data[0].id)!;
  expect(r.unitNumber).toBe(page.data[0].unit_number);
  expect(r.houseTypeName).toBe(page.data[0].house_type_name);
  expect(r.areaId).toBe(page.data[0].area_id);
});

it('stores +07:00 timestamps as the right instant', async () => {
  const raw = { ...fixture('units-page-1.json').data[0], changed_at: '2026-10-29T23:00:04+07:00' };
  await upsertPage('units', [raw], new Date());
  const [r] = await getDb().select().from(vlesUnits);
  expect(r!.vlesUpdatedAt!.toISOString()).toBe('2026-10-29T16:00:04.000Z');
});

it('a tombstone marks the unit deleted and keeps its other columns; an unknown id is ignored', async () => {
  const page = fixture('units-page-1.json');
  await upsertPage('units', page.data, new Date());
  const res = await upsertPage('units', [...fixture('units-tombstone.json').data, { id: 999999999, deleted: true }], new Date());
  expect(res.tombstoned).toBe(2);
  const rows = await getDb().select().from(vlesUnits);
  const r = rows.find((x) => x.id === page.data[0].id)!;
  expect(r.deleted).toBe(true);
  expect(r.unitNumber).toBe(page.data[0].unit_number);
  expect(rows.some((x) => x.id === 999999999)).toBe(false);
});

it('replaceUnitSchemes swaps the scheme set and deleteSchemesExceptUnits prunes others', async () => {
  const d = fixture('unit-detail-for-sale.json');
  await replaceUnitSchemes(d.data.id, d.schemes, new Date());
  await replaceUnitSchemes(d.data.id, d.schemes.slice(0, 1), new Date());
  expect((await getDb().select().from(vlesUnitSchemes)).length).toBe(1);
  await replaceUnitSchemes(123, d.schemes, new Date());
  expect(await deleteSchemesExceptUnits([d.data.id])).toBe(d.schemes.length);
});

it('markSyncOk with a null server time keeps the previous one', async () => {
  await markSyncOk('units', '2026-10-30T10:00:00+07:00', new Date());
  await markSyncOk('units', null, new Date());
  expect((await getSyncState('units'))!.lastServerTime!.toISOString()).toBe('2026-10-30T03:00:00.000Z');
});

it('upserts unit types, promos and banks with flattened fields', async () => {
  const t = fixture('unit-types.json').data, p = fixture('promos.json').data, b = fixture('mortgage-banks.json').data;
  await upsertPage('unit-types', t, new Date());
  await upsertPage('promos', p, new Date());
  await upsertPage('mortgage-banks', b, new Date());
  expect((await getDb().select().from(vlesUnitTypes)).find((x) => x.id === t[0].id)!.name).toBe(t[0].name);
  const promo = (await getDb().select().from(vlesPromos)).find((x) => x.id === p[0].id)!;
  expect(promo.isUsable).toBe(p[0].is_usable);
  expect(promo.benefitType).toBe(p[0].benefit_type.code);
  expect((await getDb().select().from(vlesMortgageBanks)).find((x) => x.id === b[0].id)!.bankName).toBe(b[0].bank.name);
});
