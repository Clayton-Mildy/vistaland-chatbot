import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { seedProjects } from './helpers/vles.js';
import { buildApp } from '../src/app.js';
import { listProjects, type Project } from '../src/repositories/projects.js';
import { createStaff } from '../src/repositories/staff.js';
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
const sentTo: { to: string; body: string; pnid: string }[] = [];
const chakra: ChakraClient = {
  sendText: async (pnid, to, body) => (sentTo.push({ to, body, pnid }), { waMessageId: `wamid.staff${sentTo.length}` }),
  sendMedia: async () => ({ waMessageId: null }),
  findChatId: async () => null,
  listChatMessages: async () => [],
};

beforeEach(async () => {
  await truncate('projects', 'contacts', 'staff_users', 'app_settings');
  sentTo.length = 0;
  await seedProjects();
  zetira = (await listProjects()).find((p) => p.slug === 'zetira')!;
  staffId = (await createStaff({ email: 'rina@vista.id', password: 'correct-horse-1', displayName: 'Rina', role: 'admin' })).id;
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
  const all = (await app.inject({ method: 'GET', url: '/api/v1/leads', headers: auth })).json();
  expect(all.data.map((r: { waPhone: string }) => r.waPhone)).toEqual(['6281111111102', '6281111111101']);
  expect(all.meta).toEqual({ page: 1, limit: 25, total: 2, totalPages: 1 });
  expect(all.data[0]).toMatchObject({ id: b.leadId, stage: 'qualified', project: { id: zetira.id, displayName: 'Zetira' }, sourceChannel: 'instagram', underTakeover: false, needsAttention: false });
  const qualified = (await app.inject({ method: 'GET', url: '/api/v1/leads?stage=qualified', headers: auth })).json();
  expect(qualified.data).toHaveLength(1);
  const byProject = (await app.inject({ method: 'GET', url: `/api/v1/leads?projectId=${zetira.id}&q=02`, headers: auth })).json();
  expect(byProject.data.map((r: { id: string }) => r.id)).toEqual([b.leadId]);
});

it('detail returns messages oldest first with events and the conversation state', async () => {
  const a = await lead('6281111111103');
  await insertOutbound(a.convId, { sender: 'moni', kind: 'text', body: 'Halo Kak', waMessageId: 'w-out', status: 'sent' });
  const res = (await buildApp().inject({ method: 'GET', url: `/api/v1/leads/${a.leadId}`, headers: auth })).json().data;
  expect(res.messages.map((m: { body: string }) => m.body)).toEqual(['halo', 'Halo Kak']);
  expect(res.contact.waPhone).toBe('6281111111103');
  expect(res.conversation).toMatchObject({ aiEnabled: true, humanTakeoverUntil: null });
  expect(Array.isArray(res.events)).toBe(true);
  expect((await buildApp().inject({ method: 'GET', url: '/api/v1/leads/00000000-0000-0000-0000-000000000000', headers: auth })).statusCode).toBe(404);
});

it('staff edit facts and force a stage, recorded as the staff member', async () => {
  const a = await lead('6281111111104');
  const res = await buildApp().inject({
    method: 'PATCH',
    url: `/api/v1/leads/${a.leadId}`,
    headers: { ...auth, 'x-staff-id': staffId },
    payload: { name: 'Sari', budgetMonthly: 3_000_000, stage: 'visit_scheduled' },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().data).toMatchObject({ name: 'Sari', budgetMonthly: 3_000_000, stage: 'visit_scheduled' });
  const detail = (await buildApp().inject({ method: 'GET', url: `/api/v1/leads/${a.leadId}`, headers: auth })).json().data;
  expect(detail.events.map((e: { actor: string }) => e.actor)).toContain(`staff:${staffId}`);
});

it('toggles takeover and the per-conversation AI switch', async () => {
  const a = await lead('6281111111105');
  const app = buildApp();
  await app.inject({ method: 'POST', url: `/api/v1/leads/${a.leadId}/takeover`, headers: { ...auth, 'x-staff-id': staffId }, payload: { on: true } });
  expect((await getConversation(a.convId))!.humanTakeoverUntil!.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
  await app.inject({ method: 'POST', url: `/api/v1/leads/${a.leadId}/takeover`, headers: auth, payload: { on: false } });
  expect((await getConversation(a.convId))!.humanTakeoverUntil).toBeNull();
  await app.inject({ method: 'POST', url: `/api/v1/leads/${a.leadId}/ai`, headers: auth, payload: { enabled: false } });
  expect((await getConversation(a.convId))!.aiEnabled).toBe(false);
});

it('send-as-staff sends through ChakraHQ, stores a staff message and starts a takeover', async () => {
  const a = await lead('6281111111106');
  const res = await buildApp({ chakra }).inject({ method: 'POST', url: `/api/v1/leads/${a.leadId}/messages`, headers: { ...auth, 'x-staff-id': staffId }, payload: { body: 'Halo Kak, saya Rina' } });
  expect(res.statusCode).toBe(201);
  expect(sentTo).toEqual([{ to: '6281111111106', body: 'Halo Kak, saya Rina', pnid: 'PNID-1' }]);
  const detail = (await buildApp().inject({ method: 'GET', url: `/api/v1/leads/${a.leadId}`, headers: auth })).json().data;
  expect(detail.messages.at(-1)).toMatchObject({ sender: 'staff', staffUserId: staffId, staffName: 'Rina', waMessageId: 'wamid.staff1' });
  expect(detail.conversation.humanTakeoverUntil).not.toBeNull();
});

it('send-as-staff refuses a test contact', async () => {
  const a = await lead('test-x', { test: true });
  const res = await buildApp({ chakra }).inject({ method: 'POST', url: `/api/v1/leads/${a.leadId}/messages`, headers: auth, payload: { body: 'x' } });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('TEST_CONTACT');
  expect(sentTo).toEqual([]);
});

it('needsAttention is true after a handoff and false once staff reply', async () => {
  const a = await lead('6281111111107');
  await setTakeover(a.convId, new Date(Date.now() + 3_600_000), 'system', 'Moni gagal menjawab (REPLY_CHECK)');
  const app = buildApp({ chakra });
  const row = async () => (await app.inject({ method: 'GET', url: '/api/v1/leads', headers: auth })).json().data[0];
  expect(await row()).toMatchObject({ underTakeover: true, needsAttention: true });
  // a takeover a staff member starts by hand needs no attention
  const b = await lead('6281111111108', { lastAt: new Date(Date.now() - 60_000) });
  await app.inject({ method: 'POST', url: `/api/v1/leads/${b.leadId}/takeover`, headers: { ...auth, 'x-staff-id': staffId }, payload: { on: true } });
  const rows = (await app.inject({ method: 'GET', url: '/api/v1/leads', headers: auth })).json().data;
  expect(rows.find((r: { id: string }) => r.id === b.leadId)).toMatchObject({ underTakeover: true, needsAttention: false });
  await app.inject({ method: 'POST', url: `/api/v1/leads/${a.leadId}/messages`, headers: { ...auth, 'x-staff-id': staffId }, payload: { body: 'Saya bantu ya Kak' } });
  expect(await row()).toMatchObject({ underTakeover: true, needsAttention: false });
});
