import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { fixture, fakeClient, seedProjects, seedUnits, unit } from './helpers/vles.js';
import { listProjects, type Project } from '../src/repositories/projects.js';
import { createMaterial } from '../src/repositories/materials.js';
import { upsertContact, ensureLead, recordEvent, getLead, type Lead } from '../src/leads/repository.js';
import { runTool, newTurnContext, type TurnContext } from '../src/agent/executor.js';
import { MONI_TOOLS } from '../src/agent/tools.js';

let zetira: Project;
let lead: Lead;
let contactId: string;

beforeEach(async () => {
  await truncate('projects', 'vles_units', 'vles_unit_schemes', 'materials', 'contacts', 'kpr_settings', 'type_profiles');
  await seedProjects();
  zetira = (await listProjects()).find((p) => p.slug === 'zetira')!;
  const c = await upsertContact('6281234567890', 'Sari');
  contactId = c.id;
  lead = await ensureLead(c.id);
  await seedUnits([unit({ id: 1, project_id: 5, area_id: 37, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', unit_number: 'D3/15', is_available_for_sale: true, deleted: false, selling_price: 400_000_000 })]);
});

const ctx = (o: Partial<TurnContext> = {}): TurnContext =>
  newTurnContext({ leadId: lead.id, contactId, projectId: zetira.id, vles: null, today: '2026-10-30', subsidiNotes: null, ...o });

it('declares the nine tools in a fixed order with respond_to_customer last', () => {
  expect(MONI_TOOLS.map((t) => t.name)).toEqual([
    'search_units', 'get_type_details', 'check_availability', 'simulate_kpr', 'send_materials', 'update_lead', 'handoff_to_human', 'opt_out', 'respond_to_customer',
  ]);
});

it('rejects invalid tool input without throwing', async () => {
  const r = await runTool('search_units', { project: 'zetira', bedrooms: 'two' }, ctx());
  expect(r.isError).toBe(true);
  expect((await runTool('no_such_tool', {}, ctx())).isError).toBe(true);
});

it('names valid slugs when the project is unknown', async () => {
  const r = await runTool('search_units', { project: 'xyz' }, ctx());
  expect(r.isError).toBe(true);
  expect(r.content).toContain('zetira');
});

it('search_units returns types and records amounts and the tool as evidence', async () => {
  const c = ctx();
  const r = await runTool('search_units', { project: 'zetira' }, c);
  expect(r.isError).toBe(false);
  expect(JSON.parse(r.content).types[0]).toMatchObject({ houseTypeId: 500, fromPrice: 400_000_000 });
  expect(c.evidence.knownAmounts).toContain(400_000_000);
  expect(c.evidence.toolsCalled.has('search_units')).toBe(true);
});

it('send_materials queues active materials once and skips ones already sent', async () => {
  const flyer = await createMaterial({ projectId: zetira.id, kind: 'flyer', url: 'https://x/flyer.jpg', mime: 'image/jpeg', filename: 'flyer.jpg' });
  const c1 = ctx();
  const r1 = JSON.parse((await runTool('send_materials', { kind: 'flyer', project: 'zetira' }, c1)).content);
  expect(r1).toMatchObject({ queued: [{ kind: 'flyer', filename: 'flyer.jpg' }], already_sent: [], missing: false });
  expect(c1.queuedMaterials).toEqual([{ materialId: flyer.id, kind: 'flyer', url: 'https://x/flyer.jpg', mime: 'image/jpeg', filename: 'flyer.jpg' }]);
  await recordEvent(lead.id, 'material_sent', { materialId: flyer.id, kind: 'flyer', filename: 'flyer.jpg' }, 'moni');
  const c2 = ctx();
  expect(JSON.parse((await runTool('send_materials', { kind: 'flyer', project: 'zetira' }, c2)).content)).toMatchObject({ queued: [], already_sent: ['flyer.jpg'] });
  expect(c2.queuedMaterials).toEqual([]);
  await runTool('send_materials', { kind: 'flyer', project: 'zetira', resend: true }, c2);
  expect(c2.queuedMaterials).toHaveLength(1);
  expect(JSON.parse((await runTool('send_materials', { kind: 'video', project: 'zetira' }, ctx())).content)).toMatchObject({ queued: [], missing: true });
});

it('check_availability records verified units as evidence', async () => {
  const d = fixture('unit-detail-for-sale.json');
  const vles = fakeClient({ units_detail: { 1: { ...d, data: { ...d.data, id: 1, unit_number: 'D3/15', is_available_for_sale: true, deleted: false } } } });
  const c = ctx({ vles });
  const r = JSON.parse((await runTool('check_availability', { project: 'zetira', house_type_id: 500 }, c)).content);
  expect(r.verified).toBe(true);
  expect(c.evidence.verifiedUnitNumbers).toEqual(['D3/15']);
  expect(c.evidence.toolsCalled.has('check_availability')).toBe(true);
});

it('update_lead saves facts, moves the stage and switches the project', async () => {
  const c = ctx({ projectId: null });
  const r = await runTool('update_lead', { name: 'Sari', budget_monthly: 3_000_000, add_concerns: ['jauh'], project: 'zetira', stage: 'qualified' }, c);
  expect(r.isError).toBe(false);
  expect(await getLead(lead.id)).toMatchObject({ name: 'Sari', budgetMonthly: 3_000_000, concerns: ['jauh'], stage: 'qualified', currentProjectId: zetira.id });
  expect(c.projectId).toBe(zetira.id);
  const back = await runTool('update_lead', { stage: 'engaged' }, c);
  expect(back.isError).toBe(true);
});

it('handoff_to_human and opt_out act on the lead', async () => {
  const c = ctx();
  await runTool('handoff_to_human', { reason: 'minta nego harga' }, c);
  expect(c.handoffReason).toBe('minta nego harga');
  await runTool('opt_out', {}, c);
  expect((await getLead(lead.id))!.stage).toBe('opted_out');
});

it('an unverified availability check or an empty search is not stock evidence', async () => {
  const c = ctx();
  await runTool('check_availability', { project: 'zetira', house_type_id: 500 }, c); // vles null -> NOT_CONFIGURED
  await runTool('search_units', { project: 'zetira', bedrooms: 9 }, c); // no type has 9 bedrooms
  expect(c.evidence.toolsCalled.has('check_availability')).toBe(false);
  expect(c.evidence.toolsCalled.has('search_units')).toBe(false);
});

it('update_lead makes the customer\'s own budget quotable this turn', async () => {
  const c = ctx();
  await runTool('update_lead', { budget_price: 450_000_000, budget_monthly: 3_500_000 }, c);
  expect(c.evidence.knownAmounts).toEqual(expect.arrayContaining([450_000_000, 3_500_000]));
});
