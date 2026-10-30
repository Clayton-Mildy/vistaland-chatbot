import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { unit, seedUnits, seedProjects } from './helpers/vles.js';
import { upsertPage, markSyncOk } from '../src/vles/repository.js';
import { getStockSummary } from '../src/stock/summary.js';

beforeEach(async () => {
  await truncate('projects', 'vles_units', 'vles_sync_state');
  await seedProjects();
});

const zetira = async () => (await getStockSummary()).projects.find((p) => p.slug === 'zetira')!;

it('groups available units by project and type with price range', async () => {
  await seedUnits([
    unit({ id: 1, project_id: 5, area_id: 37, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', is_available_for_sale: true, selling_price: 400000000 }),
    unit({ id: 2, project_id: 5, area_id: 37, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', is_available_for_sale: true, selling_price: 433425660 }),
    unit({ id: 3, project_id: 5, area_id: 37, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', is_available_for_sale: false, selling_price: null }),
  ]);
  const z = await zetira();
  expect(z.availableUnits).toBe(2);
  expect(z.types[0]).toMatchObject({ houseTypeName: 'ZETIRA BELVIA', availableUnits: 2, totalUnits: 3, minPrice: 400000000, maxPrice: 433425660 });
});

it('null price is counted but not used for min/max', async () => {
  await seedUnits([
    unit({ id: 1, project_id: 5, area_id: 37, house_type_id: 500, is_available_for_sale: true, selling_price: null }),
    unit({ id: 2, project_id: 5, area_id: 37, house_type_id: 500, is_available_for_sale: true, selling_price: 465520000 }),
  ]);
  expect((await zetira()).types[0]).toMatchObject({ availableUnits: 2, unpricedAvailable: 1, minPrice: 465520000, maxPrice: 465520000 });
});

it('deleted units are ignored', async () => {
  await seedUnits([unit({ id: 1, project_id: 5, area_id: 37, is_available_for_sale: true, selling_price: 1 })]);
  await upsertPage('units', [{ id: 1, deleted: true }], new Date());
  expect((await zetira()).totalUnits).toBe(0);
});

it('units in an unmapped area are reported as unassigned', async () => {
  await seedUnits([unit({ id: 9, project_id: 5, area_id: 77, area_name: 'CLUSTER BARU', is_available_for_sale: true, selling_price: 1 })]);
  const s = await getStockSummary();
  expect(s.unassignedAreas).toEqual([{ vlesProjectId: 5, areaId: 77, areaName: 'CLUSTER BARU', units: 1, availableUnits: 1 }]);
  expect(s.projects.length).toBe(3);
  expect(s.projects.every((p) => p.totalUnits === 0)).toBe(true);
});

it('stale is true with no successful units sync or one older than 2 hours', async () => {
  const now = new Date('2026-10-30T12:00:00Z');
  expect((await getStockSummary(now)).stale).toBe(true);
  await markSyncOk('units', null, new Date('2026-10-30T09:00:00Z'));
  expect((await getStockSummary(now)).stale).toBe(true);
  await markSyncOk('units', null, new Date('2026-10-30T11:00:00Z'));
  expect((await getStockSummary(now)).stale).toBe(false);
});
