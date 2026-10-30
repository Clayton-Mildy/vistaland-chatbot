import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { fixture, fakeClient, seedProjects, seedUnits, unit } from './helpers/vles.js';
import { getDb } from '../src/db/client.js';
import { kprSettings, promoCopy } from '../src/db/schema/index.js';
import { listProjects, updateProject, type Project } from '../src/repositories/projects.js';
import { upsertTypeProfile } from '../src/repositories/typeProfiles.js';
import { upsertPage, replaceUnitSchemes } from '../src/vles/repository.js';
import type { VlesClient } from '../src/vles/client.js';
import { formatRupiahShort, todayWib } from '../src/knowledge/format.js';
import { findProjectBySlug, searchUnits, getTypeDetails } from '../src/knowledge/units.js';
import { checkAvailability } from '../src/knowledge/availability.js';
import { simulateForType } from '../src/knowledge/simulation.js';
import { buildProjectFacts } from '../src/knowledge/facts.js';

let zetira: Project;
let granHarmoni: Project;

beforeEach(async () => {
  await truncate('projects', 'vles_units', 'vles_unit_schemes', 'vles_promos', 'type_profiles', 'kpr_settings', 'promo_copy', 'materials');
  await seedProjects();
  const ps = await listProjects();
  zetira = ps.find((p) => p.slug === 'zetira')!;
  granHarmoni = ps.find((p) => p.slug === 'gran-harmoni-cibitung')!;
});

const kprDefault = (projectId: number) =>
  getDb().insert(kprSettings).values({ projectId, bankId: null, fixedRatePct: 5, fixedYears: 3, floatingRatePct: 11, tenorOptions: [10, 15, 20], dpOptionsPct: [5] });
const scheme = (id: number, name: string, price: number) => ({ id, name, selling_price: price, booking_fee: 1_000_000, deposit: null, ppn: 0 });
const zUnit = (o: Parameters<typeof unit>[0]) => unit({ project_id: 5, area_id: 37, sales_category: 'komersil', is_available_for_sale: true, deleted: false, ...o });
const promo = (o: Record<string, unknown>) => ({ ...fixture('promos.json').data[0], project_id: 5, deleted: false, ...o });

async function seedTwoTypes() {
  await seedUnits([
    zUnit({ id: 1, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', unit_number: 'D1/01', selling_price: 400_000_000 }),
    zUnit({ id: 2, house_type_id: 501, house_type_name: 'ZETIRA ARIA', unit_number: 'D1/02', selling_price: 465_500_000 }),
  ]);
  await replaceUnitSchemes(1, [scheme(1, 'BCA KPR 99% BF 1JT PPN 0%', 381_000_000)], new Date());
  await upsertTypeProfile(500, { projectId: zetira.id, bedrooms: 2 });
  await upsertTypeProfile(501, { projectId: zetira.id, bedrooms: 3 });
  await kprDefault(zetira.id);
}

it('formats rupiah like the dashboard and dates in WIB', () => {
  expect(formatRupiahShort(465_520_000)).toBe('Rp465,5 jt');
  expect(formatRupiahShort(1_250_000_000)).toBe('Rp1,25 M');
  expect(formatRupiahShort(950_000)).toBe('Rp950 rb');
  expect(todayWib(new Date('2026-10-30T18:00:00Z'))).toBe('2026-10-31');
});

it('finds a project by slug', async () => {
  expect((await findProjectBySlug('zetira'))?.id).toBe(zetira.id);
  expect(await findProjectBySlug('nope')).toBeNull();
});

it('searchUnits filters by bedrooms and budget and estimates the monthly instalment', async () => {
  await seedTwoTypes();
  const r = await searchUnits({ projectId: zetira.id, bedrooms: 2 });
  expect(r.types.map((t) => t.houseTypeId)).toEqual([500]);
  // DP 1% from the scheme name, 20 years (the longest tenor), 5% fixed
  expect(r.types[0]).toMatchObject({ fromPrice: 400_000_000, fromKprSchemePrice: 381_000_000, estMonthlyFrom: 2_489_287, bedrooms: 2 });
  expect((await searchUnits({ projectId: zetira.id, maxPrice: 420_000_000 })).types.map((t) => t.houseTypeId)).toEqual([500]);
  expect((await searchUnits({ projectId: zetira.id, maxMonthly: 2_500_000 })).types.map((t) => t.houseTypeId)).toEqual([500]);
});

it('searchUnits returns the two cheapest as nearest when nothing fits the budget', async () => {
  await seedTwoTypes();
  const r = await searchUnits({ projectId: zetira.id, maxPrice: 300_000_000 });
  expect(r.nearest).toBe(true);
  expect(r.types.map((t) => t.houseTypeId)).toEqual([500, 501]);
});

it('getTypeDetails lists distinct schemes with parsed DP and only usable promos', async () => {
  await seedUnits([
    zUnit({ id: 10, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', selling_price: 400_000_000 }),
    zUnit({ id: 11, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', selling_price: 410_000_000 }),
  ]);
  await replaceUnitSchemes(10, [scheme(1, 'KPR 95% BF 1JT', 400_000_000), scheme(2, 'CASH KERAS', 400_000_000)], new Date());
  await replaceUnitSchemes(11, [scheme(1, 'KPR 95% BF 1JT', 410_000_000), scheme(2, 'CASH KERAS', 410_000_000)], new Date());
  await upsertPage('promos', [
    promo({ id: 71, name: 'PROMO USABLE', is_usable: true, sales_category: 'komersil' }),
    promo({ id: 72, name: 'PROMO OFF', is_usable: false, sales_category: 'komersil' }),
    promo({ id: 73, name: 'PROMO SUBSIDI', is_usable: true, sales_category: 'subsidi' }),
  ], new Date());
  const d = (await getTypeDetails(zetira.id, 500))!;
  expect(d.maxPrice).toBe(410_000_000);
  expect(d.schemes).toEqual(expect.arrayContaining([
    { name: 'KPR 95% BF 1JT', fromPrice: 400_000_000, dpPct: 5 },
    { name: 'CASH KERAS', fromPrice: 400_000_000, dpPct: null },
  ]));
  expect(d.schemes).toHaveLength(2);
  expect(d.promos.map((p) => p.name)).toEqual(['PROMO USABLE']);
  expect(await getTypeDetails(zetira.id, 999)).toBeNull();
});

it('availability keeps only units VLES still sells', async () => {
  await seedUnits([
    zUnit({ id: 21, house_type_id: 500, unit_number: 'D1/21', selling_price: 400_000_000 }),
    zUnit({ id: 22, house_type_id: 500, unit_number: 'D1/22', selling_price: 401_000_000 }),
    zUnit({ id: 23, house_type_id: 500, unit_number: 'D1/23', selling_price: 402_000_000 }),
  ]);
  const detail = (id: number, number: string, forSale: boolean) => {
    const d = fixture('unit-detail-for-sale.json');
    return { ...d, data: { ...d.data, id, unit_number: number, is_available_for_sale: forSale, deleted: false } };
  };
  const client = fakeClient({ units_detail: { 21: detail(21, 'D1/21', false), 22: detail(22, 'D1/22', true), 23: detail(23, 'D1/23', true) } });
  const r = await checkAvailability(client, { projectId: zetira.id, houseTypeId: 500 });
  expect(r).toMatchObject({ verified: true });
  if (r.verified) expect(r.units.map((u) => u.unitNumber)).toEqual(['D1/22', 'D1/23']);
});

it('availability filters by facing and reports none left', async () => {
  await seedUnits([zUnit({ id: 31, house_type_id: 500, unit_number: 'D1/31', selling_price: 1, facing: { id: 1, name: 'Timur' } })]);
  const r = await checkAvailability(fakeClient({}), { projectId: zetira.id, houseTypeId: 500, facing: 'barat' });
  expect(r).toEqual({ verified: false, reason: 'NONE_AVAILABLE' });
});

it('availability is unverified when VLES fails', async () => {
  await seedUnits([zUnit({ id: 41, house_type_id: 500, selling_price: 1 })]);
  const down: VlesClient = {
    listPage: async () => { throw new Error('down'); },
    getUnit: async () => { throw new Error('down'); },
  };
  expect(await checkAvailability(down, { projectId: zetira.id, houseTypeId: 500 })).toEqual({ verified: false, reason: 'VLES_UNAVAILABLE' });
  expect(await checkAvailability(null, { projectId: zetira.id, houseTypeId: 500 })).toEqual({ verified: false, reason: 'NOT_CONFIGURED' });
});

it('simulateForType uses the cheapest KPR scheme and its DP for every tenor', async () => {
  await seedTwoTypes();
  const r = await simulateForType({ projectId: zetira.id, houseTypeId: 500 });
  expect(r).toMatchObject({ schemeName: 'BCA KPR 99% BF 1JT PPN 0%', price: 381_000_000 });
  if ('simulations' in r) {
    expect(r.simulations.map((s) => [s.tenorYears, s.dpPct])).toEqual([[10, 1], [15, 1], [20, 1]]);
    expect(r.simulations[1]).toMatchObject({ monthlyFixed: 2_982_794, monthlyAfterFixed: 4_042_747 });
  }
});

it('simulateForType reports NO_KPR_SETTINGS without assumptions', async () => {
  expect(await simulateForType({ projectId: granHarmoni.id, houseTypeId: 32 })).toEqual({ error: 'NO_KPR_SETTINGS' });
});

it('buildProjectFacts renders the project block', async () => {
  await updateProject(zetira.id, {
    mapsUrl: 'https://maps.app.goo.gl/zt',
    accessNotes: '10 menit dari exit tol Cibitung',
    galleryHours: { '1': ['09:00', '17:00'], '2': ['09:00', '17:00'], '3': ['09:00', '17:00'], '4': ['09:00', '17:00'], '5': ['09:00', '17:00'], '6': ['09:00', '17:00'], '7': null },
  });
  await seedUnits([
    zUnit({ id: 51, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', land_size: 62, building_size: 33, selling_price: 400_000_000 }),
    zUnit({ id: 52, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', land_size: 103, building_size: 33, selling_price: 433_425_660 }),
  ]);
  await replaceUnitSchemes(51, [scheme(1, 'BCA KPR 99% BF 1JT PPN 0%', 381_000_000)], new Date());
  await upsertTypeProfile(500, { projectId: zetira.id, bedrooms: 2 });
  await upsertPage('promos', [
    promo({ id: 81, name: 'PROMO X', is_usable: true, sales_category: 'komersil', benefit_type: { code: 'potongan_bf', label: 'Potongan booking fee' }, benefit_amount: 500_000, benefit_percent: null }),
  ], new Date());
  await getDb().insert(promoCopy).values({ vlesPromoId: 81, customerText: 'Booking fee jadi Rp500 rb saja.' });
  await kprDefault(zetira.id);
  expect(await buildProjectFacts(zetira.id, '2026-10-30')).toBe(
    [
      'PROYEK: Zetira (tim Zetira) — Cibitung',
      'Peta: https://maps.app.goo.gl/zt',
      'Akses: 10 menit dari exit tol Cibitung',
      'Jam galeri: Sen–Sab 09.00–17.00, Min tutup',
      'Tipe tersedia:',
      '- ZETIRA BELVIA (id 500, 2 KT) LT 62–103 / LB 33 m² — 2 unit — mulai Rp400 jt (skema KPR mulai Rp381 jt)',
      'Promo berlaku:',
      '- PROMO X: Potongan booking fee Rp500 rb. Booking fee jadi Rp500 rb saja.',
      'Asumsi KPR: bunga tetap 5% 3 tahun, lalu 11%; tenor 10/15/20 tahun; DP 5%',
    ].join('\n')
  );
});

it('buildProjectFacts without a project lists every active project', async () => {
  await seedUnits([zUnit({ id: 61, house_type_id: 500, selling_price: 400_000_000 })]);
  const facts = await buildProjectFacts(null, '2026-10-30');
  expect(facts.split('\n')).toEqual([
    'PROYEK: belum diketahui. Proyek yang tersedia:',
    '- Zetira (tim Zetira) — Cibitung: 1 unit tersedia, mulai Rp400 jt',
    '- Gran Harmoni Cibitung (tim Gran Harmoni Cibitung) — Cibitung: belum ada unit tersedia',
    '- Grand Harmoni Park (tim Grand Harmoni Park): belum ada unit tersedia',
  ]);
});
