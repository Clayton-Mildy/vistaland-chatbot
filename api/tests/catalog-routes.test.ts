import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { seedProjects, seedUnits, unit } from './helpers/vles.js';
import { buildApp } from '../src/app.js';
import { listProjects } from '../src/repositories/projects.js';
import { createMaterial, activeMaterials } from '../src/repositories/materials.js';
import { upsertPage } from '../src/vles/repository.js';
import { fixture } from './helpers/vles.js';

const auth = { authorization: 'Bearer test-secret-test-secret-test-secret-00' };

beforeEach(async () => {
  await truncate('projects', 'vles_units', 'vles_promos', 'type_profiles', 'materials', 'promo_copy', 'channel_tags');
  await seedProjects();
});

const zetira = async () => (await listProjects()).find((p) => p.slug === 'zetira')!;

it('patches a project profile including its VLES areas', async () => {
  const p = await zetira();
  const res = await buildApp().inject({
    method: 'PATCH',
    url: `/api/v1/projects/${p.id}`,
    headers: auth,
    payload: { mapsUrl: 'https://maps.app.goo.gl/abc', vlesAreaIds: [37, 40], galleryHours: { '1': ['09:00', '17:00'], '7': null } },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().data).toMatchObject({ mapsUrl: 'https://maps.app.goo.gl/abc', vlesAreaIds: [37, 40], galleryHours: { '1': ['09:00', '17:00'], '7': null } });
  const bad = await buildApp().inject({ method: 'PATCH', url: `/api/v1/projects/${p.id}`, headers: auth, payload: { galleryHours: { '8': null } } });
  expect(bad.statusCode).toBe(400);
});

it('lists house types from the project areas with their profile merged', async () => {
  const app = buildApp();
  const p = await zetira();
  await seedUnits([
    unit({ id: 1, project_id: 5, area_id: 37, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', is_available_for_sale: true, selling_price: 1 }),
    unit({ id: 2, project_id: 5, area_id: 5, house_type_id: 900, house_type_name: 'OTHER AREA', is_available_for_sale: true, selling_price: 1 }),
  ]);
  const put = await app.inject({ method: 'PUT', url: '/api/v1/type-profiles/500', headers: auth, payload: { projectId: p.id, marketingName: 'Belvia', bedrooms: 2, bathrooms: 1, floors: 1, highlights: null, active: true } });
  expect(put.statusCode).toBe(200);
  const res = await app.inject({ method: 'GET', url: `/api/v1/projects/${p.id}/types`, headers: auth });
  expect(res.json().data).toEqual([
    expect.objectContaining({ houseTypeId: 500, houseTypeName: 'ZETIRA BELVIA', availableUnits: 1, totalUnits: 1, profile: expect.objectContaining({ bedrooms: 2, marketingName: 'Belvia' }) }),
  ]);
});

it('activeMaterials honours validity and prefers type-specific rows', async () => {
  const p = await zetira();
  const m = { projectId: p.id, kind: 'flyer' as const, mime: 'image/jpeg', filename: 'f.jpg' };
  const wide = await createMaterial({ ...m, url: 'https://x/wide.jpg', sort: 0 });
  const typed = await createMaterial({ ...m, url: 'https://x/typed.jpg', houseTypeId: 500, sort: 5 });
  await createMaterial({ ...m, url: 'https://x/expired.jpg', validTo: '2026-10-29' });
  await createMaterial({ ...m, url: 'https://x/other-type.jpg', houseTypeId: 501 });
  await createMaterial({ ...m, url: 'https://x/future.jpg', validFrom: '2026-11-01' });
  const rows = await activeMaterials(p.id, 'flyer', 500, '2026-10-30');
  expect(rows.map((r) => r.id)).toEqual([typed.id, wide.id]);
  expect((await activeMaterials(p.id, 'flyer', null, '2026-10-30')).map((r) => r.id)).toEqual([wide.id]);
});

it('creates, updates and deactivates materials through the API', async () => {
  const app = buildApp();
  const p = await zetira();
  const created = await app.inject({ method: 'POST', url: '/api/v1/materials', headers: auth, payload: { projectId: p.id, kind: 'video', url: 'https://x/v.mp4', mime: 'video/mp4', filename: 'v.mp4' } });
  expect(created.statusCode).toBe(201);
  const id = created.json().data.id;
  await app.inject({ method: 'PATCH', url: `/api/v1/materials/${id}`, headers: auth, payload: { sort: 3 } });
  await app.inject({ method: 'DELETE', url: `/api/v1/materials/${id}`, headers: auth });
  const list = await app.inject({ method: 'GET', url: `/api/v1/materials?projectId=${p.id}`, headers: auth });
  expect(list.json().data).toEqual([expect.objectContaining({ id, sort: 3, active: false })]);
  const bad = await app.inject({ method: 'POST', url: '/api/v1/materials', headers: auth, payload: { projectId: p.id, kind: 'gif', url: 'u', mime: 'image/gif', filename: 'a.gif' } });
  expect(bad.statusCode).toBe(400);
});

it('lists the project promos with their customer copy', async () => {
  const app = buildApp();
  const p = await zetira();
  const promo = fixture('promos.json').data[0];
  await upsertPage('promos', [{ ...promo, project_id: 5 }], new Date());
  await app.inject({ method: 'PUT', url: `/api/v1/promo-copy/${promo.id}`, headers: auth, payload: { customerText: 'Gratis biaya KPR', termsText: 'S&K berlaku' } });
  const res = await app.inject({ method: 'GET', url: `/api/v1/promos?projectId=${p.id}`, headers: auth });
  expect(res.json().data).toEqual([expect.objectContaining({ id: promo.id, isUsable: promo.is_usable, customerText: 'Gratis biaya KPR', termsText: 'S&K berlaku' })]);
});

it('normalises and validates channel tags', async () => {
  const app = buildApp();
  const p = await zetira();
  const ok = await app.inject({ method: 'PUT', url: '/api/v1/channel-tags/ztr-reels', headers: auth, payload: { projectId: p.id, channel: 'instagram', contentKind: 'reels' } });
  expect(ok.statusCode).toBe(200);
  expect(ok.json().data.tag).toBe('ZTR-REELS');
  const bad = await app.inject({ method: 'PUT', url: `/api/v1/channel-tags/${encodeURIComponent('bad tag!')}`, headers: auth, payload: { projectId: p.id, channel: 'instagram', contentKind: 'reels' } });
  expect(bad.statusCode).toBe(400);
  await app.inject({ method: 'DELETE', url: '/api/v1/channel-tags/ZTR-REELS', headers: auth });
  expect((await app.inject({ method: 'GET', url: '/api/v1/channel-tags', headers: auth })).json().data).toEqual([]);
});
