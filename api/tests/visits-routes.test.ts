import { it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { truncate } from './helpers/db.js';
import { seedProjects } from './helpers/vles.js';
import { buildApp } from '../src/app.js';
import { getDb } from '../src/db/client.js';
import { contacts, conversations, projects, scheduledMessages, visits } from '../src/db/schema/index.js';
import { listProjects } from '../src/repositories/projects.js';
import { createStaff } from '../src/repositories/staff.js';
import { createAgent, setAvailability, type SalesAgent } from '../src/scheduling/roster.js';
import { atWib } from '../src/scheduling/time.js';
import { getVisitView, type VisitChange } from '../src/scheduling/visits.js';
import { ensureConversation, ensureLead, getLead, getConversationByContact, insertInbound, listEvents, upsertContact } from '../src/leads/repository.js';
import { messages } from '../src/db/schema/index.js';
import type { ChakraClient } from '../src/chakra/client.js';
import type { Alerts } from '../src/notify/alerts.js';

const auth = { authorization: 'Bearer test-secret-test-secret-test-secret-00' };
// Monday 2026-11-02, 10.00 WIB; the visits below are on Saturday 2026-11-07.
const now = new Date('2026-11-02T03:00:00Z');
const SAT = '2026-11-07';
const HOUR = 3_600_000;

let zetira: number;
let a: SalesAgent;
let b: SalesAgent;
let admin: Record<string, string>;
let salesA: Record<string, string>;
let adminId: string;
const sentTo: { to: string; body: string; pnid: string }[] = [];
const chakra: ChakraClient = {
  sendText: async (pnid, to, body) => (sentTo.push({ to, body, pnid }), { waMessageId: `wamid.staff${sentTo.length}` }),
  sendMedia: async () => ({ waMessageId: null }),
  sendTemplate: async () => ({ waMessageId: null }),
  findChatId: async () => null,
  listChatMessages: async () => [],
};
const changes: VisitChange[] = [];
const alerts: Alerts = {
  leadNeedsStaff: async () => undefined,
  availabilityUnverified: async () => undefined,
  visitNeedsScheduling: async () => undefined,
  visitChanged: async (c) => void changes.push(c),
  outboundFailed: async () => undefined,
};

const app = (at = now) => buildApp({ chakra, alerts, now: () => at });

beforeEach(async () => {
  await truncate('projects', 'contacts', 'sales_agents', 'staff_users', 'scheduled_messages', 'app_settings');
  sentTo.length = 0;
  changes.length = 0;
  await seedProjects();
  zetira = (await listProjects()).find((p) => p.slug === 'zetira')!.id;
  await getDb()
    .update(projects)
    .set({ galleryHours: { '6': ['09:00', '17:00'] }, visitMinutes: 60, sameDayMinNoticeMinutes: 120 })
    .where(eq(projects.id, zetira));
  adminId = (await createStaff({ email: 'rina@vista.id', password: 'correct-horse-1', displayName: 'Rina', role: 'admin' })).id;
  const salesId = (await createStaff({ email: 'andi@vista.id', password: 'correct-horse-1', displayName: 'Andi', role: 'sales' })).id;
  a = await createAgent({ name: 'Andi', waPhone: '6281000001', staffUserId: salesId, projectIds: [zetira] });
  b = await createAgent({ name: 'Budi', waPhone: '6281000002', staffUserId: null, projectIds: [zetira] });
  for (const agent of [a, b]) await setAvailability(agent.id, [{ projectId: zetira, weekday: 6, start: '09:00', end: '17:00' }]);
  admin = { ...auth, 'x-staff-id': adminId };
  salesA = { ...auth, 'x-staff-id': salesId };
});

let phone = 6285000000;
/** A lead with a conversation and a visit written straight to the table. */
async function makeVisit(
  agentId: string,
  o: { time?: string; test?: boolean; optedOut?: boolean; lastMsgAt?: Date | null; date?: string } = {}
) {
  const p = String(phone++);
  const contact = await upsertContact(p, 'Sari', o.test ?? false);
  const conv = await ensureConversation(contact.id, 'PNID-1');
  const lead = await ensureLead(contact.id);
  if (o.lastMsgAt !== null) await insertInbound(conv.id, { waMessageId: `w-${p}`, kind: 'text', body: 'halo', createdAt: o.lastMsgAt ?? new Date(now.getTime() - HOUR) });
  if (o.optedOut) await getDb().update(contacts).set({ optedOutAt: now }).where(eq(contacts.id, contact.id));
  const startsAt = atWib(o.date ?? SAT, o.time ?? '10:00');
  const [v] = await getDb()
    .insert(visits)
    .values({ leadId: lead.id, projectId: zetira, salesAgentId: agentId, startsAt, endsAt: new Date(startsAt.getTime() + HOUR), createdBy: 'moni', isTest: o.test ?? false })
    .returning();
  return { visitId: v!.id, leadId: lead.id, convId: conv.id, contactId: contact.id, phone: p };
}

const post = (url: string, headers: Record<string, string>, payload: unknown, at = now) => app(at).inject({ method: 'POST', url, headers, payload });

it('a sales user lists only their own visits', async () => {
  const mine = await makeVisit(a.id, { time: '10:00' });
  await makeVisit(b.id, { time: '11:00' });
  const url = `/api/v1/visits?from=${SAT}&to=${SAT}`;
  const asSales = (await app().inject({ method: 'GET', url: `${url}&salesAgentId=${b.id}`, headers: salesA })).json();
  expect(asSales.data.map((v: { id: string }) => v.id)).toEqual([mine.visitId]);
  expect(asSales.data[0]).toMatchObject({ salesName: 'Andi', projectName: 'Zetira', customerName: 'Sari' });
  expect(asSales.meta).toBeUndefined();
  const asAdmin = (await app().inject({ method: 'GET', url, headers: admin })).json();
  expect(asAdmin.data).toHaveLength(2);
  const onlyB = (await app().inject({ method: 'GET', url: `${url}&salesAgentId=${b.id}`, headers: admin })).json();
  expect(onlyB.data).toHaveLength(1);
});

it('lists a range of at most 31 WIB days and hides test visits', async () => {
  await makeVisit(a.id, { time: '10:00' });
  await makeVisit(a.id, { time: '12:00', test: true });
  const ok = (await app().inject({ method: 'GET', url: `/api/v1/visits?from=2026-11-01&to=2026-12-01`, headers: admin })).json();
  expect(ok.data).toHaveLength(1);
  expect((await app().inject({ method: 'GET', url: `/api/v1/visits?from=2026-11-01&to=2026-12-02`, headers: admin })).statusCode).toBe(400);
  expect((await app().inject({ method: 'GET', url: `/api/v1/visits?from=2026-11-05&to=2026-11-01`, headers: admin })).statusCode).toBe(400);
  expect((await app().inject({ method: 'GET', url: `/api/v1/visits`, headers: admin })).statusCode).toBe(400);
});

it('requires a staff account', async () => {
  expect((await app().inject({ method: 'GET', url: `/api/v1/visits?from=${SAT}&to=${SAT}`, headers: auth })).statusCode).toBe(401);
});

it('a sales user cannot move a visit', async () => {
  const v = await makeVisit(a.id);
  const res = await post(`/api/v1/visits/${v.visitId}/move`, salesA, { date: SAT, time: '11:00' });
  expect(res.statusCode).toBe(403);
  expect((await getVisitView(v.visitId))!.status).toBe('scheduled');
  for (const path of ['reassign', 'cancel']) {
    expect((await post(`/api/v1/visits/${v.visitId}/${path}`, salesA, { salesAgentId: b.id, reason: 'x' })).statusCode).toBe(403);
  }
  expect((await app().inject({ method: 'GET', url: `/api/v1/visits/${v.visitId}/slots?date=${SAT}`, headers: salesA })).statusCode).toBe(403);
});

it('shows a visit with its lead and summary, and hides it from another sales agent', async () => {
  const mine = await makeVisit(a.id);
  const theirs = await makeVisit(b.id, { time: '11:00' });
  const res = (await app().inject({ method: 'GET', url: `/api/v1/visits/${mine.visitId}`, headers: salesA })).json().data;
  expect(res.visit).toMatchObject({ id: mine.visitId, salesName: 'Andi', projectName: 'Zetira', status: 'scheduled' });
  expect(res.lead).toEqual({ id: mine.leadId, name: 'Sari', phone: mine.phone });
  expect(res.summary).toMatchObject({ name: 'Sari', visit: { salesName: 'Andi', status: 'scheduled' } });
  expect((await app().inject({ method: 'GET', url: `/api/v1/visits/${theirs.visitId}`, headers: salesA })).statusCode).toBe(404);
  expect((await app().inject({ method: 'GET', url: `/api/v1/visits/${theirs.visitId}`, headers: admin })).statusCode).toBe(200);
  expect((await app().inject({ method: 'GET', url: `/api/v1/visits/not-a-uuid`, headers: admin })).statusCode).toBe(404);
});

it('lists every free slot of a day for the move dialog, counting the visit itself as free', async () => {
  const v = await makeVisit(a.id, { time: '10:00' });
  const res = (await app().inject({ method: 'GET', url: `/api/v1/visits/${v.visitId}/slots?date=${SAT}`, headers: admin })).json().data;
  const times = res.map((s: { time: string }) => s.time);
  expect(times).toContain('10:00');
  expect(times).toContain('16:00');
  expect(times.length).toBeGreaterThan(5);
  expect(res[0]).toMatchObject({ date: SAT, time: '09:00' });
});

it('an admin moves a visit to a new slot and sends the customer nothing', async () => {
  const v = await makeVisit(a.id, { time: '10:00' });
  const res = await post(`/api/v1/visits/${v.visitId}/move`, admin, { date: SAT, time: '14:00' });
  expect(res.statusCode).toBe(200);
  const moved = res.json().data.visit;
  expect(moved).toMatchObject({ startsAt: atWib(SAT, '14:00').toISOString(), status: 'scheduled' });
  expect(moved.id).not.toBe(v.visitId);
  expect((await getVisitView(v.visitId))!.status).toBe('rescheduled');
  expect(changes.map((c) => c.kind)).toEqual(['rescheduled']);
  expect(sentTo).toEqual([]);
  expect(await getDb().select().from(scheduledMessages).where(eq(scheduledMessages.kind, 'reassign_notice'))).toEqual([]);
  const bad = await post(`/api/v1/visits/${v.visitId}/move`, admin, { date: SAT, time: '11:00' });
  expect(bad.statusCode).toBe(409);
  expect(bad.json().error).toBe('NOT_ACTIVE');
  expect((await post(`/api/v1/visits/${moved.id}/move`, admin, { date: SAT, time: '03:00' })).json().error).toBe('SLOT_NOT_FREE');
  expect((await post(`/api/v1/visits/${moved.id}/move`, admin, { date: 'besok', time: '11:00' })).statusCode).toBe(400);
});

it('an admin cancels a visit with a reason', async () => {
  const v = await makeVisit(a.id);
  expect((await post(`/api/v1/visits/${v.visitId}/cancel`, admin, { reason: '  ' })).statusCode).toBe(400);
  const res = await post(`/api/v1/visits/${v.visitId}/cancel`, admin, { reason: 'Konsumen berhalangan' });
  expect(res.statusCode).toBe(200);
  expect(await getVisitView(v.visitId)).toMatchObject({ status: 'cancelled', cancelReason: 'Konsumen berhalangan' });
  expect(changes.map((c) => c.kind)).toEqual(['cancelled']);
  expect(sentTo).toEqual([]);
  expect((await post(`/api/v1/visits/${v.visitId}/cancel`, admin, { reason: 'lagi' })).json().error).toBe('NOT_ACTIVE');
});

it('a sales user marks the outcome of their own visit after it starts', async () => {
  const mine = await makeVisit(a.id, { time: '10:00' });
  const theirs = await makeVisit(b.id, { time: '11:00' });
  const during = new Date(atWib(SAT, '10:30'));
  const early = await post(`/api/v1/visits/${mine.visitId}/outcome`, salesA, { outcome: 'visited' });
  expect(early.statusCode).toBe(409);
  expect(early.json().error).toBe('TOO_EARLY');
  expect((await post(`/api/v1/visits/${theirs.visitId}/outcome`, salesA, { outcome: 'visited' }, during)).statusCode).toBe(404);
  expect((await post(`/api/v1/visits/${mine.visitId}/outcome`, salesA, { outcome: 'maybe' }, during)).statusCode).toBe(400);
  const ok = await post(`/api/v1/visits/${mine.visitId}/outcome`, salesA, { outcome: 'visited' }, during);
  expect(ok.statusCode).toBe(200);
  expect((await getVisitView(mine.visitId))!.status).toBe('visited');
  expect((await getLead(mine.leadId))!.stage).toBe('visited');
  expect((await listEvents(mine.leadId)).map((e) => e.actor)).toContain(`staff:${salesA['x-staff-id']}`);
  // An admin can close any visit.
  expect((await post(`/api/v1/visits/${theirs.visitId}/outcome`, admin, { outcome: 'no_show' }, atWib(SAT, '11:30'))).statusCode).toBe(200);
  expect((await getVisitView(theirs.visitId))!.status).toBe('no_show');
});

it('reassigning inside the 24-hour window sends the customer a free-text notice', async () => {
  const v = await makeVisit(a.id, { lastMsgAt: new Date(now.getTime() - 2 * HOUR) });
  const res = await post(`/api/v1/visits/${v.visitId}/reassign`, admin, { salesAgentId: b.id });
  expect(res.statusCode).toBe(200);
  expect(res.json().data.notice).toBe('sent');
  expect((await getVisitView(v.visitId))!.salesAgentId).toBe(b.id);
  expect(sentTo).toEqual([{ to: v.phone, body: 'Kak Sari, nanti Kakak dibantu Kak Budi dari tim sales kami ya 😊', pnid: 'PNID-1' }]);
  const [out] = await getDb().select().from(messages).where(and(eq(messages.conversationId, v.convId), eq(messages.direction, 'out')));
  expect(out).toMatchObject({ sender: 'staff', staffUserId: adminId, status: 'sent', waMessageId: 'wamid.staff1' });
  expect(await getDb().select().from(scheduledMessages).where(eq(scheduledMessages.kind, 'reassign_notice'))).toEqual([]);
  expect((await getConversationByContact(v.contactId))!.humanTakeoverUntil).toBeNull();
  expect(changes.map((c) => c.kind)).toEqual(['reassigned']);
});

it('reassigning outside the window queues a reassign_notice', async () => {
  const v = await makeVisit(a.id, { lastMsgAt: new Date(now.getTime() - 30 * HOUR) });
  const res = await post(`/api/v1/visits/${v.visitId}/reassign`, admin, { salesAgentId: b.id });
  expect(res.statusCode).toBe(200);
  expect(res.json().data.notice).toBe('queued');
  expect(sentTo).toEqual([]);
  const rows = await getDb().select().from(scheduledMessages).where(eq(scheduledMessages.kind, 'reassign_notice'));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ toPhone: v.phone, leadId: v.leadId, visitId: v.visitId, params: ['Sari', 'Budi'], dedupeKey: `reassign_notice:${v.visitId}:${b.id}` });
});

it('a customer with no chat yet gets the template', async () => {
  const v = await makeVisit(a.id, { lastMsgAt: null });
  expect((await post(`/api/v1/visits/${v.visitId}/reassign`, admin, { salesAgentId: b.id })).json().data.notice).toBe('queued');
  expect(sentTo).toEqual([]);
});

it('a test contact or an opted-out customer is told nothing about a reassignment', async () => {
  const test = await makeVisit(a.id, { test: true, time: '10:00' });
  const out = await makeVisit(a.id, { optedOut: true, time: '12:00' });
  for (const v of [test, out]) {
    const res = await post(`/api/v1/visits/${v.visitId}/reassign`, admin, { salesAgentId: b.id });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.notice).toBe('none');
  }
  expect(sentTo).toEqual([]);
  expect(await getDb().select().from(scheduledMessages).where(eq(scheduledMessages.kind, 'reassign_notice'))).toEqual([]);
});

it('a failed free-text notice falls back to the template', async () => {
  const v = await makeVisit(a.id);
  const failing: ChakraClient = { ...chakra, sendText: async () => { throw new Error('boom'); } };
  const res = await buildApp({ chakra: failing, alerts, now: () => now }).inject({ method: 'POST', url: `/api/v1/visits/${v.visitId}/reassign`, headers: admin, payload: { salesAgentId: b.id } });
  expect(res.statusCode).toBe(200);
  expect(res.json().data.notice).toBe('queued');
  const failed = await getDb().select().from(messages).where(eq(messages.status, 'failed'));
  expect(failed).toHaveLength(1);
  expect(await getDb().select().from(scheduledMessages).where(eq(scheduledMessages.kind, 'reassign_notice'))).toHaveLength(1);
});

it('a notice that fails after the reassignment committed is still 200, with notice "failed"', async () => {
  const v = await makeVisit(a.id);
  // The chat row disappears mid-send, so recording the failed message (and the notice) throws.
  const broken: ChakraClient = {
    ...chakra,
    sendText: async () => {
      await getDb().delete(conversations).where(eq(conversations.id, v.convId));
      throw new Error('boom');
    },
  };
  const res = await buildApp({ chakra: broken, alerts, now: () => now }).inject({ method: 'POST', url: `/api/v1/visits/${v.visitId}/reassign`, headers: admin, payload: { salesAgentId: b.id } });
  expect(res.statusCode).toBe(200);
  expect(res.json().data).toMatchObject({ notice: 'failed', visit: { id: v.visitId, salesAgentId: b.id } });
  expect((await getVisitView(v.visitId))!.salesAgentId).toBe(b.id);
  expect(changes.map((c) => c.kind)).toEqual(['reassigned']);
});

it('reassigning to a busy agent is 409 AGENT_NOT_FREE', async () => {
  const v = await makeVisit(a.id, { time: '10:00' });
  await makeVisit(b.id, { time: '10:00' });
  const res = await post(`/api/v1/visits/${v.visitId}/reassign`, admin, { salesAgentId: b.id });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('AGENT_NOT_FREE');
  expect((await getVisitView(v.visitId))!.salesAgentId).toBe(a.id);
  expect(sentTo).toEqual([]);
  expect(changes).toEqual([]);
});

it('the list reports held outbound messages to admins', async () => {
  await makeVisit(a.id);
  await getDb().insert(scheduledMessages).values({
    kind: 'sales_alert',
    dedupeKey: 'held-1',
    toPhone: '6281000001',
    params: ['x'],
    dueAt: new Date(now.getTime() - 10 * 60_000),
  });
  const res = (await app().inject({ method: 'GET', url: `/api/v1/visits?from=${SAT}&to=${SAT}`, headers: admin })).json();
  expect(res.meta).toEqual({ outbound: { held: 1, failed: 0 } });
});
