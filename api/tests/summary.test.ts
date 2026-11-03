import { it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { truncate } from './helpers/db.js';
import { seedProjects } from './helpers/vles.js';
import { getDb } from '../src/db/client.js';
import { contacts, leads, scheduledMessages, visits } from '../src/db/schema/index.js';
import type { Contact, Lead, LeadEvent } from '../src/leads/repository.js';
import { buildHandoverSummary, loadHandoverSummary, summaryLine } from '../src/leads/summary.js';
import { buildLeadState } from '../src/leads/state.js';
import { listProjects } from '../src/repositories/projects.js';
import { createAgent } from '../src/scheduling/roster.js';
import { activeVisitForLead, getVisitView, type Visit, type VisitChange, type VisitView } from '../src/scheduling/visits.js';
import { SALES_ALERT_LABEL, queueSalesAlerts, salesAlertRows } from '../src/outbound/salesAlert.js';

const NOW = new Date('2026-11-02T03:00:00Z');
const STARTS = new Date('2026-11-04T03:00:00Z');

const contact = (o: Partial<Contact> = {}): Contact => ({
  id: 'c1',
  waPhone: '6281234567890',
  displayName: null,
  isTest: false,
  optedOutAt: null,
  createdAt: NOW,
  ...o,
});

const lead = (o: Partial<Lead> = {}): Lead => ({
  id: 'l1',
  contactId: 'c1',
  currentProjectId: null,
  projectsOfInterest: [],
  sourceChannel: null,
  sourceContentKind: null,
  sourceRef: null,
  stage: 'new',
  name: null,
  budgetPrice: null,
  budgetMonthly: null,
  dpBudget: null,
  bedroomsWanted: null,
  purpose: null,
  timeline: null,
  domicileArea: null,
  concerns: [],
  typeInterest: [],
  hotCold: null,
  lostReason: null,
  assignedSalesId: null,
  summary: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
});

const event = (id: number, kind: LeadEvent['kind'], payload: object): LeadEvent => ({ id, leadId: 'l1', kind, payload, actor: 'moni', createdAt: NOW });

const visit = (o: Partial<Visit> = {}): Visit => ({
  id: 'v1',
  leadId: 'l1',
  projectId: 1,
  salesAgentId: 'a1',
  startsAt: STARTS,
  endsAt: new Date(STARTS.getTime() + 3600_000),
  status: 'scheduled',
  typeInterest: [],
  topics: null,
  isTest: false,
  createdBy: 'moni',
  rescheduledFrom: null,
  cancelReason: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
});

const view = (o: Partial<VisitView> = {}): VisitView => ({
  ...visit(),
  salesName: 'Rina',
  salesPhone: '6281000001',
  projectName: 'Zetira',
  mapsUrl: null,
  label: 'Rabu, 4 November 2026 10.00 WIB',
  ...o,
});

const SIM = { typeName: 'Tipe 36', price: 465_520_000, dpPct: 10, tenorYears: 15, fixedYears: 3, monthlyFixed: 2_500_000, monthlyAfterFixed: 3_100_000 };
const fullLead = () =>
  lead({
    name: 'Sari',
    sourceChannel: 'instagram',
    sourceContentKind: 'reels',
    domicileArea: 'Bekasi',
    purpose: 'own_use',
    bedroomsWanted: 2,
    typeInterest: [7],
    budgetPrice: 500_000_000,
    dpBudget: 50_000_000,
    budgetMonthly: 3_000_000,
    concerns: ['lokasi jauh', 'cicilan'],
    summary: { notes: 'Suka sudut\nminta diskon' },
  });
const fullEvents = () => [event(2, 'simulation_sent', SIM), event(1, 'material_sent', { kind: 'brochure', filename: 'brosur-zetira.pdf' })];
const agents = new Map([
  ['a1', { name: 'Rina', waPhone: '6281000001' }],
  ['a2', { name: 'Budi', waPhone: '6281000002' }],
]);
const ctx = (summary = buildHandoverSummary({ lead: fullLead(), contact: contact(), events: fullEvents(), typeNames: new Map([[7, 'Tipe 36']]), visit: view() })) => ({
  summary,
  agents,
  projectName: 'Zetira',
  dashboardUrl: 'https://dash.vista.id',
  now: NOW,
});

it('the summary carries every step-9 field', () => {
  const s = buildHandoverSummary({ lead: fullLead(), contact: contact(), events: fullEvents(), typeNames: new Map([[7, 'Tipe 36']]), visit: view() });
  expect(s.name).toBe('Sari');
  expect(s.phone).toBe('6281234567890');
  expect(s.source).toBe('instagram · reels');
  expect(s.location).toBe('Bekasi');
  expect(s.purpose).toBe('ditempati');
  expect(s.need).toBe('2 kamar, Tipe 36');
  expect(s.budget).toBe('Rp500 jt, DP Rp50 jt, cicilan Rp3 jt/bulan');
  expect(s.concerns).toEqual(['lokasi jauh', 'cicilan']);
  expect(s.materials).toEqual(['brosur-zetira.pdf']);
  expect(s.simulations).toHaveLength(1);
  expect(buildLeadState(fullLead(), fullEvents())).toContain(s.simulations[0]!);
  expect(s.visit).toEqual({ label: 'Rabu, 4 November 2026 10.00 WIB', salesName: 'Rina', status: 'scheduled' });
  expect(s.notes).toBe('Suka sudut\nminta diskon');
  const line = summaryLine(s);
  expect(line).toContain('Keraguan: lokasi jauh; cicilan');
  expect(line).toContain('Materi: brosur-zetira.pdf');
  expect(line.startsWith('instagram · reels · Bekasi · ditempati · 2 kamar, Tipe 36 · Rp500 jt')).toBe(true);
  expect(line.endsWith('Suka sudut\nminta diskon')).toBe(true);
});

it('an empty lead gives a summary of name and phone only', () => {
  const s = buildHandoverSummary({ lead: lead(), contact: contact({ displayName: 'Sari WA' }), events: [], typeNames: new Map(), visit: null });
  expect(s).toEqual({
    name: 'Sari WA',
    phone: '6281234567890',
    source: null,
    location: null,
    purpose: null,
    need: null,
    budget: null,
    concerns: [],
    materials: [],
    simulations: [],
    visit: null,
    notes: null,
  });
  expect(summaryLine(s)).toBe('');
  expect(buildHandoverSummary({ lead: lead(), contact: contact(), events: [], typeNames: new Map(), visit: null }).name).toBe('6281234567890');
});

it('sales alert params are single-line', () => {
  const rows = salesAlertRows({ kind: 'booked', visit: visit(), previous: null }, ctx());
  expect(rows).toHaveLength(1);
  for (const p of rows[0]!.params) expect(p).not.toMatch(/[\n\t]| {4,}/);
  expect(rows[0]!.params[5]).toContain('Suka sudut minta diskon');
});

it('the alert carries the template parameters, key and recipient', () => {
  const [row] = salesAlertRows({ kind: 'booked', visit: visit(), previous: null }, ctx());
  expect(row).toMatchObject({ kind: 'sales_alert', dedupeKey: 'sales_alert:v1:booked:a1', toPhone: '6281000001', leadId: 'l1', visitId: 'v1', dueAt: NOW });
  expect(row!.params.slice(0, 5)).toEqual(['Rina', 'Kunjungan baru', 'Sari (6281234567890)', 'Rabu, 4 November 2026 10.00 WIB', 'Zetira']);
  expect(row!.params[6]).toBe('https://dash.vista.id/visits/v1');
});

it('a reschedule to another agent alerts both', () => {
  const rows = salesAlertRows({ kind: 'rescheduled', visit: visit({ id: 'v2', salesAgentId: 'a2' }), previous: visit() }, ctx());
  expect(rows.map((r) => r.params[1])).toEqual([SALES_ALERT_LABEL.movedAway, SALES_ALERT_LABEL.booked]);
  expect(rows[0]!.toPhone).not.toBe(rows[1]!.toPhone);
  expect(rows.map((r) => r.dedupeKey)).toEqual(['sales_alert:v2:movedAway:a1', 'sales_alert:v2:booked:a2']);
});

it('a reschedule to another agent shows the old agent the slot they lost', () => {
  const later = new Date(STARTS.getTime() + 86_400_000);
  const rows = salesAlertRows({ kind: 'rescheduled', visit: visit({ id: 'v2', salesAgentId: 'a2', startsAt: later }), previous: visit() }, ctx());
  expect(rows[0]!.params[3]).toBe('Rabu, 4 November 2026 10.00 WIB');
  expect(rows[1]!.params[3]).toBe('Kamis, 5 November 2026 10.00 WIB');
  // A reassignment keeps the slot, and without a previous row the new time is used.
  expect(salesAlertRows({ kind: 'reassigned', visit: visit({ salesAgentId: 'a2' }), previous: visit() }, ctx()).map((r) => r.params[3])).toEqual(['Rabu, 4 November 2026 10.00 WIB', 'Rabu, 4 November 2026 10.00 WIB']);
  expect(salesAlertRows({ kind: 'reassigned', visit: visit({ salesAgentId: 'a2' }), previous: null }, ctx()).map((r) => r.params[3])).toEqual(['Rabu, 4 November 2026 10.00 WIB']);
});

it('an empty summary is sent as a dash, never as an empty variable', () => {
  const bare = buildHandoverSummary({ lead: lead(), contact: contact(), events: [], typeNames: new Map(), visit: null });
  const [row] = salesAlertRows({ kind: 'booked', visit: visit(), previous: null }, ctx(bare));
  expect(row!.params[5]).toBe('-');
  expect(row!.params.every((p) => p !== '')).toBe(true);
});

it('each change alerts the agents it concerns', () => {
  const labels = (c: VisitChange) => salesAlertRows(c, ctx()).map((r) => [r.params[0], r.params[1]]);
  expect(labels({ kind: 'rescheduled', visit: visit({ id: 'v2' }), previous: visit() })).toEqual([['Rina', SALES_ALERT_LABEL.rescheduled]]);
  expect(labels({ kind: 'cancelled', visit: visit({ status: 'cancelled' }), previous: visit() })).toEqual([['Rina', SALES_ALERT_LABEL.cancelled]]);
  expect(labels({ kind: 'reassigned', visit: visit({ salesAgentId: 'a2' }), previous: visit() })).toEqual([
    ['Rina', SALES_ALERT_LABEL.movedAway],
    ['Budi', SALES_ALERT_LABEL.booked],
  ]);
});

it('a test visit queues nothing', () => {
  expect(salesAlertRows({ kind: 'booked', visit: visit({ isTest: true }), previous: null }, ctx())).toEqual([]);
  expect(salesAlertRows({ kind: 'outcome', visit: visit({ status: 'visited' }), previous: visit() }, ctx())).toEqual([]);
});

// ─── database ───────────────────────────────────────────────────────────────

let projectId: number;
let agentId: string;
let leadId: string;

beforeEach(async () => {
  await truncate('projects', 'contacts', 'sales_agents', 'scheduled_messages');
  await seedProjects();
  [projectId] = (await listProjects()).map((p) => p.id) as [number];
  agentId = (await createAgent({ name: 'Rina', waPhone: '6281000001', staffUserId: null, projectIds: [projectId] })).id;
  const [c] = await getDb().insert(contacts).values({ waPhone: '6282001', displayName: 'Sari' }).returning();
  const [l] = await getDb().insert(leads).values({ contactId: c!.id, domicileArea: 'Bekasi' }).returning();
  leadId = l!.id;
});

const insertVisit = async (o: Partial<typeof visits.$inferInsert> = {}) => {
  const [v] = await getDb()
    .insert(visits)
    .values({ leadId, projectId, salesAgentId: agentId, startsAt: STARTS, endsAt: new Date(STARTS.getTime() + 3600_000), createdBy: 'moni', ...o })
    .returning();
  return v!;
};

it('a visit is read with its agent, project and label; the lead gets only its active one', async () => {
  expect(await activeVisitForLead(leadId)).toBeNull();
  expect(await getVisitView('00000000-0000-0000-0000-000000000000')).toBeNull();
  await insertVisit({ status: 'cancelled' });
  expect(await activeVisitForLead(leadId)).toBeNull();
  const active = await insertVisit({ startsAt: new Date(STARTS.getTime() + 86_400_000), endsAt: new Date(STARTS.getTime() + 86_400_000 + 3600_000) });
  const v = await activeVisitForLead(leadId);
  expect(v).toMatchObject({ id: active.id, salesName: 'Rina', salesPhone: '6281000001', projectName: 'Zetira', mapsUrl: null, label: 'Kamis, 5 November 2026 10.00 WIB' });
  expect((await getVisitView(active.id))?.id).toBe(active.id);
});

it('loadHandoverSummary reads the lead, its events and its active visit', async () => {
  expect(await loadHandoverSummary('00000000-0000-0000-0000-000000000000')).toBeNull();
  await getDb().update(leads).set({ typeInterest: [7] }).where(eq(leads.id, leadId));
  await insertVisit();
  const s = await loadHandoverSummary(leadId);
  expect(s).toMatchObject({ name: 'Sari', phone: '6282001', location: 'Bekasi', need: 'tipe 7' });
  expect(s?.visit).toMatchObject({ salesName: 'Rina', status: 'scheduled' });
});

it('queueSalesAlerts queues the alert once and skips a test visit', async () => {
  const v = await insertVisit();
  await queueSalesAlerts(getDb(), { kind: 'booked', visit: v, previous: null }, NOW);
  await queueSalesAlerts(getDb(), { kind: 'booked', visit: v, previous: null }, NOW);
  const rows = await getDb().select().from(scheduledMessages);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ kind: 'sales_alert', toPhone: '6281000001', visitId: v.id, leadId });
  expect(rows[0]!.params[1]).toBe('Kunjungan baru');
  expect(rows[0]!.params[2]).toBe('Sari (6282001)');
  expect(rows[0]!.params[4]).toBe('Zetira');
  expect(rows[0]!.params[6]).toMatch(new RegExp(`/visits/${v.id}$`));

  await getDb().update(visits).set({ status: 'cancelled' }).where(eq(visits.id, v.id));
  const t = await insertVisit({ isTest: true });
  await queueSalesAlerts(getDb(), { kind: 'booked', visit: t, previous: null }, NOW);
  expect(await getDb().select().from(scheduledMessages)).toHaveLength(1);
});
