import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { seedProjects } from './helpers/vles.js';
import { buildApp } from '../src/app.js';
import { listProjects } from '../src/repositories/projects.js';
import { getKprAssumptions, getSchemeDpOverride } from '../src/kpr/assumptions.js';

const auth = { authorization: 'Bearer test-secret-test-secret-test-secret-00' };

beforeEach(async () => {
  await truncate('projects', 'kpr_settings', 'scheme_dp_overrides');
  await seedProjects();
});

const row = (projectId: number, bankId: number | null, fixedRatePct: number) => ({
  projectId,
  bankId,
  fixedRatePct,
  fixedYears: 3,
  floatingRatePct: 11,
  tenorOptions: [10, 15, 20],
  dpOptionsPct: [5],
});

it('a bank row overrides the project default', async () => {
  const app = buildApp();
  const p = (await listProjects())[0]!;
  expect((await app.inject({ method: 'PUT', url: '/api/v1/kpr-settings', headers: auth, payload: row(p.id, null, 5) })).statusCode).toBe(200);
  expect((await app.inject({ method: 'PUT', url: '/api/v1/kpr-settings', headers: auth, payload: row(p.id, 2, 4.5) })).statusCode).toBe(200);
  // a second PUT of the default updates it in place
  await app.inject({ method: 'PUT', url: '/api/v1/kpr-settings', headers: auth, payload: row(p.id, null, 5.5) });
  expect((await getKprAssumptions(p.id, 2))!.fixedRatePct).toBe(4.5);
  expect((await getKprAssumptions(p.id, 9))!.fixedRatePct).toBe(5.5);
  expect((await getKprAssumptions(p.id))!.fixedRatePct).toBe(5.5);
  const list = await app.inject({ method: 'GET', url: `/api/v1/kpr-settings?projectId=${p.id}`, headers: auth });
  expect(list.json().data).toHaveLength(2);
});

it('returns null when a project has no KPR assumptions', async () => {
  const p = (await listProjects())[1]!;
  expect(await getKprAssumptions(p.id)).toBeNull();
});

it('rejects an empty tenor list', async () => {
  const p = (await listProjects())[0]!;
  const res = await buildApp().inject({ method: 'PUT', url: '/api/v1/kpr-settings', headers: auth, payload: { ...row(p.id, null, 5), tenorOptions: [] } });
  expect(res.statusCode).toBe(400);
});

it('stores scheme DP overrides', async () => {
  const app = buildApp();
  await app.inject({ method: 'PUT', url: '/api/v1/scheme-dp-overrides', headers: auth, payload: { schemeName: 'PROMO SPESIAL', dpPct: 10 } });
  expect(await getSchemeDpOverride('PROMO SPESIAL')).toBe(10);
  const list = await app.inject({ method: 'GET', url: '/api/v1/scheme-dp-overrides', headers: auth });
  expect(list.json().data).toEqual([{ schemeName: 'PROMO SPESIAL', dpPct: 10 }]);
});
