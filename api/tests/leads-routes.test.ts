import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { seedProjects } from './helpers/vles.js';
import { buildApp } from '../src/app.js';
import { listProjects, type Project } from '../src/repositories/projects.js';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { leads, staffUsers, visits } from '../src/db/schema/index.js';
import { createStaff } from '../src/repositories/staff.js';
import { createAgent } from '../src/scheduling/roster.js';
import {
  ensureConversation,
  ensureLead,
  getConversation,
  insertInbound,
  insertOutbound,
  setLeadProject,
  setLeadStage,
  setTakeover,
  upsertContact,
} from '../src/leads/repository.js';
import type { ChakraClient } from '../src/chakra/client.js';

const auth = { authorization: 'Bearer test-secret-test-secret-test-secret-00' };
let zetira: Project;
let staffId: string;
let admin: Record<string, string>;
const sentTo: { to: string; body: string; pnid: string }[] = [];
const chakra: ChakraClient = {
  sendText: async (pnid, to, body) => (sentTo.push({ to, body, pnid }), { waMessageId: `wamid.staff${sentTo.length}` }),
  sendMedia: async () => ({ waMessageId: null }),
  sendTemplate: async () => ({ waMessageId: null }),
  findChatId: async () => null,
  listChatMessages: async () => [],
};

beforeEach(async () => {
  await truncate('projects', 'contacts', 'staff_users', 'app_settings', 'sales_agents');
  sentTo.length = 0;
  await seedProjects();
  zetira = (await listProjects()).find((p) => p.slug === 'zetira')!;
  staffId = (await createStaff({ email: 'rina@vista.id', password: 'correct-horse-1', displayName: 'Rina', role: 'admin' })).id;
  admin = { ...auth, 'x-staff-id': staffId };
});

async function lead(phone: string, o: { test?: boolean; stage?: 'qualified'; project?: boolean; lastAt?: Date } = {}) {
  const c = await upsertContact(phone, `Nama ${phone.slice(-2)}`, o.test ?? false);
  const conv = await ensureConversation(c.id, 'PNID-1');
  const l = await ensureLead(c.id);
  await insertInbound(conv.id, { waMessageId: `w-${phone}`, kind: 'text', body: 'halo', createdAt: o.lastAt ?? new Date() });
  if (o.stage) await setLeadStage(l.id, o.stage, 'moni', { force: true });
  if (o.project) await setLeadProject(l.id, zetira.id, 'system', { channel: 'instagram', contentKind: 'reels', ref: 'ZTR-REELS' });
  return { contactId: c.id, convId: conv.id, leadId: l.id };
}

it('lists leads newest chat first, without test contacts, filtered by stage and project', async () => {
  await lead('6281111111101', { lastAt: new Date(Date.now() - 60_000) });
  const b = await lead('6281111111102', { stage: 'qualified', project: true });
  await lead('test-staff-1', { test: true });
  const app = buildApp();
  const all = (await app.inject({ method: 'GET', url: '/api/v1/leads', headers: admin })).json();
  expect(all.data.map((r: { waPhone: string }) => r.waPhone)).toEqual(['6281111111102', '6281111111101']);
  expect(all.meta).toEqual({ page: 1, limit: 25, total: 2, totalPages: 1 });
  expect(all.data[0]).toMatchObject({ id: b.leadId, stage: 'qualified', project: { id: zetira.id, displayName: 'Zetira' }, sourceChannel: 'instagram', underTakeover: false, needsAttention: false });
  const qualified = (await app.inject({ method: 'GET', url: '/api/v1/leads?stage=qualified', headers: admin })).json();
  expect(qualified.data).toHaveLength(1);
  const byProject = (await app.inject({ method: 'GET', url: `/api/v1/leads?projectId=${zetira.id}&q=02`, headers: admin })).json();
  expect(byProject.data.map((r: { id: string }) => r.id)).toEqual([b.leadId]);
});

it('detail returns messages oldest first with events and the conversation state', async () => {
  const a = await lead('6281111111103');
  await insertOutbound(a.convId, { sender: 'moni', kind: 'text', body: 'Halo Kak', waMessageId: 'w-out', status: 'sent' });
  const res = (await buildApp().inject({ method: 'GET', url: `/api/v1/leads/${a.leadId}`, headers: admin })).json().data;
  expect(res.messages.map((m: { body: string }) => m.body)).toEqual(['halo', 'Halo Kak']);
  expect(res.contact.waPhone).toBe('6281111111103');
  expect(res.conversation).toMatchObject({ aiEnabled: true, humanTakeoverUntil: null });
  expect(Array.isArray(res.events)).toBe(true);
  expect((await buildApp().inject({ method: 'GET', url: '/api/v1/leads/00000000-0000-0000-0000-000000000000', headers: admin })).statusCode).toBe(404);
});

it('staff edit facts and force a stage, recorded as the staff member', async () => {
  const a = await lead('6281111111104');
  const res = await buildApp().inject({
    method: 'PATCH',
    url: `/api/v1/leads/${a.leadId}`,
    headers: admin,
    payload: { name: 'Sari', budgetMonthly: 3_000_000, stage: 'visit_scheduled' },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().data).toMatchObject({ name: 'Sari', budgetMonthly: 3_000_000, stage: 'visit_scheduled' });
  const detail = (await buildApp().inject({ method: 'GET', url: `/api/v1/leads/${a.leadId}`, headers: admin })).json().data;
  expect(detail.events.map((e: { actor: string }) => e.actor)).toContain(`staff:${staffId}`);
});

it('toggles takeover and the per-conversation AI switch', async () => {
  const a = await lead('6281111111105');
  const app = buildApp();
  await app.inject({ method: 'POST', url: `/api/v1/leads/${a.leadId}/takeover`, headers: admin, payload: { on: true } });
  expect((await getConversation(a.convId))!.humanTakeoverUntil!.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
  await app.inject({ method: 'POST', url: `/api/v1/leads/${a.leadId}/takeover`, headers: admin, payload: { on: false } });
  expect((await getConversation(a.convId))!.humanTakeoverUntil).toBeNull();
  await app.inject({ method: 'POST', url: `/api/v1/leads/${a.leadId}/ai`, headers: admin, payload: { enabled: false } });
  expect((await getConversation(a.convId))!.aiEnabled).toBe(false);
});

it('send-as-staff sends through ChakraHQ, stores a staff message and starts a takeover', async () => {
  const a = await lead('6281111111106');
  const res = await buildApp({ chakra }).inject({ method: 'POST', url: `/api/v1/leads/${a.leadId}/messages`, headers: admin, payload: { body: 'Halo Kak, saya Rina' } });
  expect(res.statusCode).toBe(201);
  expect(sentTo).toEqual([{ to: '6281111111106', body: 'Halo Kak, saya Rina', pnid: 'PNID-1' }]);
  const detail = (await buildApp().inject({ method: 'GET', url: `/api/v1/leads/${a.leadId}`, headers: admin })).json().data;
  expect(detail.messages.at(-1)).toMatchObject({ sender: 'staff', staffUserId: staffId, staffName: 'Rina', waMessageId: 'wamid.staff1' });
  expect(detail.conversation.humanTakeoverUntil).not.toBeNull();
});

it('send-as-staff refuses a test contact', async () => {
  const a = await lead('test-x', { test: true });
  const res = await buildApp({ chakra }).inject({ method: 'POST', url: `/api/v1/leads/${a.leadId}/messages`, headers: admin, payload: { body: 'x' } });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('TEST_CONTACT');
  expect(sentTo).toEqual([]);
});

it('needsAttention is true after a handoff and false once staff reply', async () => {
  const a = await lead('6281111111107');
  await setTakeover(a.convId, new Date(Date.now() + 3_600_000), 'system', 'Moni gagal menjawab (REPLY_CHECK)');
  const app = buildApp({ chakra });
  const row = async () => (await app.inject({ method: 'GET', url: '/api/v1/leads', headers: admin })).json().data[0];
  expect(await row()).toMatchObject({ underTakeover: true, needsAttention: true });
  // a takeover a staff member starts by hand needs no attention
  const b = await lead('6281111111108', { lastAt: new Date(Date.now() - 60_000) });
  await app.inject({ method: 'POST', url: `/api/v1/leads/${b.leadId}/takeover`, headers: admin, payload: { on: true } });
  const rows = (await app.inject({ method: 'GET', url: '/api/v1/leads', headers: admin })).json().data;
  expect(rows.find((r: { id: string }) => r.id === b.leadId)).toMatchObject({ underTakeover: true, needsAttention: false });
  await app.inject({ method: 'POST', url: `/api/v1/leads/${a.leadId}/messages`, headers: admin, payload: { body: 'Saya bantu ya Kak' } });
  expect(await row()).toMatchObject({ underTakeover: true, needsAttention: false });
});

// ─── scope: sales users see their own leads ────────────────────────────────

async function salesUser(name: string, phone: string, o: { linked?: boolean } = {}) {
  const staff = await createStaff({ email: `${name.toLowerCase()}@vista.id`, password: 'correct-horse-1', displayName: name, role: 'sales' });
  const agent = await createAgent({ name, waPhone: phone, staffUserId: o.linked === false ? null : staff.id, projectIds: [zetira.id] });
  return { staffId: staff.id, agentId: agent.id, headers: { ...auth, 'x-staff-id': staff.id } };
}

const assign = (leadId: string, agentId: string) => getDb().update(leads).set({ assignedSalesId: agentId }).where(eq(leads.id, leadId));

async function visitFor(leadId: string, agentId: string, startsAt: Date, status: 'scheduled' | 'cancelled' = 'scheduled') {
  const [v] = await getDb()
    .insert(visits)
    .values({ leadId, projectId: zetira.id, salesAgentId: agentId, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), status, createdBy: 'moni' })
    .returning();
  return v!;
}

it('lead routes without a staff id are 401', async () => {
  const a = await lead('6281111111110');
  const app = buildApp({ chakra });
  const calls = [
    { method: 'GET', url: '/api/v1/leads' },
    { method: 'GET', url: `/api/v1/leads/${a.leadId}` },
    { method: 'PATCH', url: `/api/v1/leads/${a.leadId}`, payload: { name: 'X' } },
    { method: 'POST', url: `/api/v1/leads/${a.leadId}/takeover`, payload: { on: true } },
    { method: 'POST', url: `/api/v1/leads/${a.leadId}/ai`, payload: { enabled: false } },
    { method: 'POST', url: `/api/v1/leads/${a.leadId}/messages`, payload: { body: 'x' } },
  ] as const;
  for (const c of calls) {
    const res = await app.inject({ ...c, headers: auth });
    expect(res.statusCode, `${c.method} ${c.url}`).toBe(401);
    expect(res.json()).toEqual({ data: null, error: 'STAFF_REQUIRED' });
  }
  // unknown, malformed and inactive staff ids are refused too
  const bogus = [{ 'x-staff-id': '00000000-0000-4000-8000-000000000000' }, { 'x-staff-id': 'nope' }];
  for (const h of bogus) expect((await app.inject({ method: 'GET', url: '/api/v1/leads', headers: { ...auth, ...h } })).statusCode).toBe(401);
  await getDb().update(staffUsers).set({ isActive: false }).where(eq(staffUsers.id, staffId));
  expect((await app.inject({ method: 'GET', url: '/api/v1/leads', headers: admin })).statusCode).toBe(401);
});

it('a sales user lists only leads assigned to them', async () => {
  const andi = await salesUser('Andi', '6281000001');
  const budi = await salesUser('Budi', '6281000002');
  const mine = await lead('6281111111111');
  const theirs = await lead('6281111111112');
  await lead('6281111111113');
  await assign(mine.leadId, andi.agentId);
  await assign(theirs.leadId, budi.agentId);
  const app = buildApp();
  const rows = (await app.inject({ method: 'GET', url: '/api/v1/leads', headers: andi.headers })).json();
  expect(rows.data.map((r: { id: string }) => r.id)).toEqual([mine.leadId]);
  expect(rows.meta.total).toBe(1);
  // the salesAgentId filter is admin only: sales cannot widen their view with it
  const widened = (await app.inject({ method: 'GET', url: `/api/v1/leads?salesAgentId=${budi.agentId}`, headers: andi.headers })).json();
  expect(widened.data.map((r: { id: string }) => r.id)).toEqual([mine.leadId]);
  const all = (await app.inject({ method: 'GET', url: '/api/v1/leads', headers: admin })).json();
  expect(all.data).toHaveLength(3);
});

it('a sales user without a linked agent sees no leads', async () => {
  const loner = await salesUser('Lona', '6281000003', { linked: false });
  const a = await lead('6281111111114');
  const app = buildApp();
  const rows = (await app.inject({ method: 'GET', url: '/api/v1/leads', headers: loner.headers })).json();
  expect(rows.data).toEqual([]);
  expect(rows.meta.total).toBe(0);
  expect((await app.inject({ method: 'GET', url: `/api/v1/leads/${a.leadId}`, headers: loner.headers })).statusCode).toBe(404);
});

it('a sales user gets 404 for a lead assigned to someone else', async () => {
  const andi = await salesUser('Andi', '6281000001');
  const budi = await salesUser('Budi', '6281000002');
  const theirs = await lead('6281111111115');
  const unassigned = await lead('6281111111116');
  await assign(theirs.leadId, budi.agentId);
  const app = buildApp({ chakra });
  for (const id of [theirs.leadId, unassigned.leadId]) {
    expect((await app.inject({ method: 'GET', url: `/api/v1/leads/${id}`, headers: andi.headers })).statusCode).toBe(404);
    const msg = await app.inject({ method: 'POST', url: `/api/v1/leads/${id}/messages`, headers: andi.headers, payload: { body: 'Halo' } });
    expect(msg.statusCode).toBe(404);
    expect(msg.json().error).toBe('NOT_FOUND');
    expect((await app.inject({ method: 'POST', url: `/api/v1/leads/${id}/takeover`, headers: andi.headers, payload: { on: true } })).statusCode).toBe(404);
  }
  expect(sentTo).toEqual([]);
  expect((await getConversation(theirs.convId))!.humanTakeoverUntil).toBeNull();
});

it('a sales user can reply to and take over their own lead', async () => {
  const andi = await salesUser('Andi', '6281000001');
  const mine = await lead('6281111111117');
  await assign(mine.leadId, andi.agentId);
  const app = buildApp({ chakra });
  expect((await app.inject({ method: 'GET', url: `/api/v1/leads/${mine.leadId}`, headers: andi.headers })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: `/api/v1/leads/${mine.leadId}/messages`, headers: andi.headers, payload: { body: 'Halo Kak' } })).statusCode).toBe(201);
  expect(sentTo).toHaveLength(1);
  expect((await app.inject({ method: 'POST', url: `/api/v1/leads/${mine.leadId}/takeover`, headers: andi.headers, payload: { on: false } })).statusCode).toBe(200);
  expect((await getConversation(mine.convId))!.humanTakeoverUntil).toBeNull();
});

it('a sales user cannot edit lead facts', async () => {
  const andi = await salesUser('Andi', '6281000001');
  const mine = await lead('6281111111118');
  await assign(mine.leadId, andi.agentId);
  const app = buildApp();
  const patch = await app.inject({ method: 'PATCH', url: `/api/v1/leads/${mine.leadId}`, headers: andi.headers, payload: { name: 'Sari' } });
  expect(patch.statusCode).toBe(403);
  expect(patch.json()).toEqual({ data: null, error: 'FORBIDDEN' });
  const ai = await app.inject({ method: 'POST', url: `/api/v1/leads/${mine.leadId}/ai`, headers: andi.headers, payload: { enabled: false } });
  expect(ai.statusCode).toBe(403);
  expect((await getConversation(mine.convId))!.aiEnabled).toBe(true);
});

it('the list shows the assigned sales and the next visit, and the salesAgentId filter narrows it', async () => {
  const andi = await salesUser('Andi', '6281000001');
  const budi = await salesUser('Budi', '6281000002');
  const a = await lead('6281111111119', { lastAt: new Date(Date.now() + 60_000) });
  const b = await lead('6281111111120');
  const c = await lead('6281111111121', { lastAt: new Date(Date.now() - 60_000) });
  await assign(a.leadId, andi.agentId);
  await assign(b.leadId, budi.agentId);
  const next = await visitFor(a.leadId, andi.agentId, new Date(Date.now() + 2 * 86_400_000));
  // a cancelled visit is not the next visit
  await visitFor(b.leadId, budi.agentId, new Date(Date.now() + 86_400_000), 'cancelled');
  const app = buildApp();
  const rows = (await app.inject({ method: 'GET', url: '/api/v1/leads', headers: admin })).json().data as { id: string; assignedSales: unknown; nextVisit: unknown }[];
  const byId = (id: string) => rows.find((r) => r.id === id)!;
  expect(byId(a.leadId).assignedSales).toEqual({ id: andi.agentId, name: 'Andi' });
  expect(byId(a.leadId).nextVisit).toMatchObject({ id: next.id, status: 'scheduled', label: expect.stringContaining('WIB') });
  expect((byId(a.leadId).nextVisit as { startsAt: string }).startsAt).toBe(next.startsAt.toISOString());
  expect(byId(b.leadId)).toMatchObject({ assignedSales: { id: budi.agentId, name: 'Budi' }, nextVisit: null });
  expect(byId(c.leadId)).toMatchObject({ assignedSales: null, nextVisit: null });
  const narrowed = (await app.inject({ method: 'GET', url: `/api/v1/leads?salesAgentId=${andi.agentId}`, headers: admin })).json();
  expect(narrowed.data.map((r: { id: string }) => r.id)).toEqual([a.leadId]);
  expect(narrowed.meta.total).toBe(1);
  expect((await app.inject({ method: 'GET', url: '/api/v1/leads?salesAgentId=nope', headers: admin })).statusCode).toBe(400);
});

it('lead detail carries the visits and the handover summary', async () => {
  const andi = await salesUser('Andi', '6281000001');
  const a = await lead('6281111111122');
  await assign(a.leadId, andi.agentId);
  const older = await visitFor(a.leadId, andi.agentId, new Date(Date.now() - 7 * 86_400_000), 'cancelled');
  const newer = await visitFor(a.leadId, andi.agentId, new Date(Date.now() + 2 * 86_400_000));
  const app = buildApp();
  const asSales = (await app.inject({ method: 'GET', url: `/api/v1/leads/${a.leadId}`, headers: andi.headers })).json().data;
  expect(asSales.role).toBe('sales');
  expect(asSales.visits.map((v: { id: string }) => v.id)).toEqual([newer.id, older.id]);
  expect(asSales.visits[0]).toMatchObject({ salesName: 'Andi', projectName: 'Zetira', label: expect.stringContaining('WIB') });
  expect(asSales.summary).toMatchObject({ name: 'Nama 22', phone: '6281111111122', visit: { salesName: 'Andi', status: 'scheduled' } });
  const asAdmin = (await app.inject({ method: 'GET', url: `/api/v1/leads/${a.leadId}`, headers: admin })).json().data;
  expect(asAdmin.role).toBe('admin');
});
