import { it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { truncate } from './helpers/db.js';
import { recordingNotifier } from './helpers/notify.js';
import { fixture, fakeClient, seedProjects, seedUnits, unit } from './helpers/vles.js';
import { listProjects, type Project } from '../src/repositories/projects.js';
import { createMaterial } from '../src/repositories/materials.js';
import { upsertContact, ensureLead, recordEvent, getLead, type Lead } from '../src/leads/repository.js';
import { runTool, newTurnContext, type TurnContext } from '../src/agent/executor.js';
import { MONI_TOOLS } from '../src/agent/tools.js';
import { getDb } from '../src/db/client.js';
import { leads, projects, scheduledMessages, visits } from '../src/db/schema/index.js';
import { createStaff } from '../src/repositories/staff.js';
import { createAgent, setAvailability, type SalesAgent } from '../src/scheduling/roster.js';
import { activeVisitForLead } from '../src/scheduling/visits.js';
import { createAlerts } from '../src/notify/alerts.js';

let zetira: Project;
let lead: Lead;
let contactId: string;

beforeEach(async () => {
  await truncate('projects', 'vles_units', 'vles_unit_schemes', 'materials', 'contacts', 'kpr_settings', 'type_profiles', 'sales_agents', 'staff_users', 'scheduled_messages');
  await seedProjects();
  zetira = (await listProjects()).find((p) => p.slug === 'zetira')!;
  const c = await upsertContact('6281234567890', 'Sari');
  contactId = c.id;
  lead = await ensureLead(c.id);
  await seedUnits([unit({ id: 1, project_id: 5, area_id: 37, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', unit_number: 'D3/15', is_available_for_sale: true, deleted: false, selling_price: 400_000_000 })]);
});

// Monday 2026-11-02, 10.00 WIB.
const NOW = new Date('2026-11-02T03:00:00Z');

type CtxInput = Parameters<typeof newTurnContext>[0];
const ctx = (o: Partial<CtxInput> = {}): TurnContext =>
  newTurnContext({ leadId: lead.id, contactId, projectId: zetira.id, vles: null, today: '2026-10-30', subsidiNotes: null, now: NOW, isTest: false, alerts: null, activeVisit: null, ...o });

it('declares the thirteen tools in a fixed order with respond_to_customer last', () => {
  expect(MONI_TOOLS.map((t) => t.name)).toEqual([
    'search_units', 'get_type_details', 'check_availability', 'simulate_kpr', 'send_materials', 'update_lead',
    'find_visit_slots', 'book_visit', 'reschedule_visit', 'cancel_visit',
    'handoff_to_human', 'opt_out', 'respond_to_customer',
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

it("the customer's names are evidence, including one learned this turn", async () => {
  const c = ctx({ customerNames: [null, 'Sari W', ''] });
  expect(c.evidence.customerNames).toEqual(['Sari W']);
  await runTool('update_lead', { name: 'Rina' }, c);
  expect(c.evidence.customerNames).toEqual(['Sari W', 'Rina']);
});

// ─── visits ────────────────────────────────────────────────────────────────

/** Saturday gallery hours at Zetira and one agent (with a dashboard account) working them. */
async function rosterZetira(): Promise<{ agent: SalesAgent; staffId: string }> {
  await getDb()
    .update(projects)
    .set({ galleryHours: { '6': ['09:00', '17:00'] }, visitMinutes: 60, sameDayMinNoticeMinutes: 120 })
    .where(eq(projects.id, zetira.id));
  const staff = await createStaff({ email: 'budi@vista.id', password: 'correct-horse-1', displayName: 'Budi', role: 'sales' });
  const agent = await createAgent({ name: 'Budi Santoso', waPhone: '6281000002', staffUserId: staff.id, projectIds: [zetira.id] });
  await setAvailability(agent.id, [{ projectId: zetira.id, weekday: 6, start: '09:00', end: '17:00' }]);
  return { agent, staffId: staff.id };
}

const json = async (p: Promise<{ content: string }>) => JSON.parse((await p).content);

it('find_visit_slots returns labelled slots for Saturday', async () => {
  await rosterZetira();
  const r = await json(runTool('find_visit_slots', { project: 'zetira', date_from: '2026-11-07', part_of_day: 'pagi' }, ctx()));
  expect(r.slots.length).toBeGreaterThan(0);
  expect(r.slots[0]).toEqual({ date: '2026-11-07', time: '09:00', label: 'Sabtu, 7 November 2026 09.00 WIB' });
  expect(r.reason).toBeUndefined();
  // Malformed dates and times never reach the slot code.
  expect((await runTool('find_visit_slots', { project: 'zetira', date_from: '7 Nov' }, ctx())).isError).toBe(true);
  expect((await runTool('find_visit_slots', { project: 'zetira', date_from: '2026-11-07', time: '9:00' }, ctx())).isError).toBe(true);
});

it('find_visit_slots without gallery hours returns NO_GALLERY_HOURS', async () => {
  const r = await json(runTool('find_visit_slots', { project: 'zetira', date_from: '2026-11-07' }, ctx()));
  expect(r).toMatchObject({ slots: [], reason: 'NO_GALLERY_HOURS' });
  expect(r.message).toContain('update_lead');
  expect(r.message).toContain('jadwal kunjungan');
});

it('find_visit_slots tells no roster from no free agent', async () => {
  await getDb().update(projects).set({ galleryHours: { '6': ['09:00', '17:00'] } }).where(eq(projects.id, zetira.id));
  expect(await json(runTool('find_visit_slots', { project: 'zetira', date_from: '2026-11-07' }, ctx()))).toMatchObject({ slots: [], reason: 'NO_ROSTER' });
  // An agent covers Zetira but works no Saturday hours.
  await createAgent({ name: 'Andi', waPhone: '6281000001', staffUserId: null, projectIds: [zetira.id] });
  expect(await json(runTool('find_visit_slots', { project: 'zetira', date_from: '2026-11-07', date_to: '2026-11-08' }, ctx()))).toMatchObject({ slots: [], reason: 'NONE_FREE' });
});

it('book_visit books, records evidence and alerts the agent', async () => {
  const { agent, staffId } = await rosterZetira();
  await getDb().update(leads).set({ typeInterest: [500] }).where(eq(leads.id, lead.id));
  const notifier = recordingNotifier();
  const c = ctx({ alerts: createAlerts({ notifier, dashboardUrl: 'https://dash' }) });
  const r = await json(runTool('book_visit', { project: 'zetira', date: '2026-11-07', time: '10:00', topics: 'cicilan' }, c));
  expect(r).toMatchObject({ ok: true, label: 'Sabtu, 7 November 2026 10.00 WIB', sales_name: 'Budi Santoso' });
  const [visit] = await getDb().select().from(visits).where(eq(visits.id, r.visit_id));
  expect(visit).toMatchObject({ leadId: lead.id, salesAgentId: agent.id, typeInterest: [500], topics: 'cicilan', isTest: false, createdBy: 'moni' });
  expect(c.evidence.visitBooked).toBe(true);
  expect(c.evidence.salesNames).toEqual(['Budi Santoso']);
  expect(notifier.sent).toEqual([{ staffUserIds: [staffId], note: expect.objectContaining({ title: 'Kunjungan baru' }) }]);
});

it('book_visit for a taken slot returns SLOT_TAKEN', async () => {
  await rosterZetira();
  // Another lead takes the only agent's 10.00 slot first.
  const other = await ensureLead((await upsertContact('6289999999', 'Rina')).id);
  expect(await json(runTool('book_visit', { project: 'zetira', date: '2026-11-07', time: '10:00' }, ctx({ leadId: other.id })))).toMatchObject({ ok: true });
  const c = ctx();
  const r = await json(runTool('book_visit', { project: 'zetira', date: '2026-11-07', time: '10:00' }, c));
  expect(['SLOT_TAKEN', 'SLOT_NOT_FREE']).toContain(r.error);
  expect(r.message).toBe('Jam ini baru saja terisi; tawarkan jam lain dari find_visit_slots.');
  expect(c.evidence.visitBooked).toBe(false);
});

it('reschedule_visit without an active visit returns NO_ACTIVE_VISIT', async () => {
  await rosterZetira();
  expect(await json(runTool('reschedule_visit', { date: '2026-11-07', time: '11:00' }, ctx()))).toMatchObject({ error: 'NO_ACTIVE_VISIT' });
  expect(await json(runTool('cancel_visit', { reason: 'berhalangan' }, ctx()))).toMatchObject({ error: 'NO_ACTIVE_VISIT' });
});

it('reschedule_visit and cancel_visit act on the active visit and alert the agent', async () => {
  await rosterZetira();
  await json(runTool('book_visit', { project: 'zetira', date: '2026-11-07', time: '10:00' }, ctx()));
  const notifier = recordingNotifier();
  const c = ctx({ alerts: createAlerts({ notifier, dashboardUrl: 'https://dash' }) });
  expect(await json(runTool('reschedule_visit', { date: '2026-11-07', time: '13:00' }, c))).toMatchObject({ ok: true, label: 'Sabtu, 7 November 2026 13.00 WIB', sales_name: 'Budi Santoso' });
  expect(c.evidence.visitBooked).toBe(true);
  expect(await json(runTool('cancel_visit', { reason: 'berhalangan' }, c))).toEqual({ ok: true });
  expect(c.evidence.visitBooked).toBe(false);
  expect((await getLead(lead.id))!.stage).toBe('cancelled');
  expect(notifier.sent.map((s) => s.note.title)).toEqual(['Jadwal kunjungan berubah', 'Kunjungan dibatalkan']);
});

it('a test contact books a test visit that queues no WhatsApp alert', async () => {
  await rosterZetira();
  const r = await json(runTool('book_visit', { project: 'zetira', date: '2026-11-07', time: '10:00' }, ctx({ isTest: true })));
  expect((await getDb().select().from(visits).where(eq(visits.id, r.visit_id)))[0]!.isTest).toBe(true);
  expect(await getDb().select().from(scheduledMessages)).toEqual([]);
});

it('an active visit is booking evidence from the start of the turn', async () => {
  await rosterZetira();
  await json(runTool('book_visit', { project: 'zetira', date: '2026-11-07', time: '10:00' }, ctx()));
  const c = ctx({ activeVisit: await activeVisitForLead(lead.id) });
  expect(c.evidence).toMatchObject({ visitBooked: true, salesNames: ['Budi Santoso'] });
});

it('an unverified availability check alerts the assigned sales person', async () => {
  const { agent, staffId } = await rosterZetira();
  await getDb().update(leads).set({ assignedSalesId: agent.id }).where(eq(leads.id, lead.id));
  const notifier = recordingNotifier();
  const r = await json(runTool('check_availability', { project: 'zetira', house_type_id: 500 }, ctx({ alerts: createAlerts({ notifier, dashboardUrl: 'https://dash' }) })));
  expect(r.verified).toBe(false);
  expect(notifier.sent).toEqual([{ staffUserIds: [staffId], note: expect.objectContaining({ body: expect.stringContaining('ZETIRA BELVIA') }) }]);
});

it('availability VLES could not check alerts staff, but a VLES answer of no unit does not', async () => {
  const { agent, staffId } = await rosterZetira();
  await getDb().update(leads).set({ assignedSalesId: agent.id }).where(eq(leads.id, lead.id));
  const notifier = recordingNotifier();
  const alerts = createAlerts({ notifier, dashboardUrl: 'https://dash' });
  // VLES answers, and the unit is no longer for sale.
  const none = await json(runTool('check_availability', { project: 'zetira', house_type_id: 500 }, ctx({ alerts, vles: fakeClient({}) })));
  expect(none).toEqual({ verified: false, reason: 'NONE_AVAILABLE' });
  expect(notifier.sent).toEqual([]);
  // VLES is down.
  const down = { ...fakeClient({}), getUnit: async () => { throw new Error('down'); } };
  const failed = await json(runTool('check_availability', { project: 'zetira', house_type_id: 500 }, ctx({ alerts, vles: down })));
  expect(failed).toEqual({ verified: false, reason: 'VLES_UNAVAILABLE' });
  expect(notifier.sent).toEqual([{ staffUserIds: [staffId], note: expect.objectContaining({ title: 'Cek ketersediaan unit' }) }]);
});
