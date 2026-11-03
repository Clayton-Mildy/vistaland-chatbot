import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { truncate } from './helpers/db.js';
import { recordingNotifier } from './helpers/notify.js';
import { buildApp } from '../src/app.js';
import { getDb } from '../src/db/client.js';
import { leads, pushSubscriptions } from '../src/db/schema/index.js';
import { createStaff, updateStaff } from '../src/repositories/staff.js';
import { createAgent } from '../src/scheduling/roster.js';
import { ensureLead, upsertContact } from '../src/leads/repository.js';
import { createWebPushNotifier, deleteSubscription, saveSubscription, type Notifier } from '../src/notify/push.js';
import { createAlerts } from '../src/notify/alerts.js';
import { SALES_ALERT_LABEL } from '../src/outbound/salesAlert.js';
import type { Visit } from '../src/scheduling/visits.js';
import { seedProjects } from './helpers/vles.js';
import { listProjects } from '../src/repositories/projects.js';

const auth = { authorization: 'Bearer test-secret-test-secret-test-secret-00' };
const URL_BASE = 'https://dash.example.id';
const keys = { p256dh: 'p256dh-key', auth: 'auth-key' };

beforeEach(async () => {
  // Failures are logged on purpose; keep them out of the test output.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await truncate('projects', 'contacts', 'sales_agents', 'staff_users', 'push_subscriptions');
});

afterEach(() => vi.restoreAllMocks());

const staff = (email: string, role: 'admin' | 'sales' = 'sales') => createStaff({ email, password: 'correct-horse-1', displayName: email.split('@')[0]!, role });
const subs = () => getDb().select().from(pushSubscriptions);

it('a subscription is upserted by endpoint', async () => {
  const a = await staff('a@vista.id');
  const b = await staff('b@vista.id');
  await saveSubscription(a.id, { endpoint: 'https://push.example/1', keys });
  await saveSubscription(b.id, { endpoint: 'https://push.example/1', keys: { p256dh: 'new', auth: 'new-auth' } });
  const rows = await subs();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ staffUserId: b.id, p256dh: 'new', auth: 'new-auth' });
  await deleteSubscription('https://push.example/1');
  expect(await subs()).toHaveLength(0);
});

it('sends one notification per subscription of each active staff user', async () => {
  const a = await staff('a@vista.id');
  const b = await staff('b@vista.id');
  const off = await staff('off@vista.id');
  await saveSubscription(a.id, { endpoint: 'https://push.example/a1', keys });
  await saveSubscription(a.id, { endpoint: 'https://push.example/a2', keys });
  await saveSubscription(b.id, { endpoint: 'https://push.example/b1', keys });
  await saveSubscription(off.id, { endpoint: 'https://push.example/off', keys });
  await updateStaff(off.id, { isActive: false });
  const sendNotification = vi.fn(async () => ({ statusCode: 201, body: '', headers: {} }));
  const notifier = createWebPushNotifier({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:x@y.id', sendNotification: sendNotification as never });
  const note = { title: 'Halo', body: 'Isi', url: `${URL_BASE}/leads/1` };
  await notifier.send([a.id, b.id, off.id], note);
  expect(sendNotification).toHaveBeenCalledTimes(3);
  const calls = sendNotification.mock.calls as unknown as [{ endpoint: string; keys: unknown }, string, { TTL: number }][];
  expect(calls.map((c) => c[0].endpoint).sort()).toEqual(['https://push.example/a1', 'https://push.example/a2', 'https://push.example/b1']);
  const [sub, payload, options] = calls.find((c) => c[0].endpoint.endsWith('a1'))!;
  expect(sub).toEqual({ endpoint: 'https://push.example/a1', keys });
  expect(payload).toBe(JSON.stringify(note));
  expect(options.TTL).toBe(3600);
});

it('bounds every push request with a timeout', async () => {
  const a = await staff('a@vista.id');
  await saveSubscription(a.id, { endpoint: 'https://push.example/a1', keys });
  const sendNotification = vi.fn(async () => ({ statusCode: 201, body: '', headers: {} }));
  const notifier = createWebPushNotifier({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:x@y.id', sendNotification: sendNotification as never });
  await notifier.send([a.id], { title: 't', body: 'b', url: URL_BASE });
  const options = (sendNotification.mock.calls as unknown as [unknown, string, { timeout?: number; vapidDetails?: unknown }][])[0]![2];
  expect(options.timeout).toBe(10_000);
  expect(options.vapidDetails).toEqual({ subject: 'mailto:x@y.id', publicKey: 'pub', privateKey: 'priv' });
});

it('a 410 deletes the subscription', async () => {
  const a = await staff('a@vista.id');
  await saveSubscription(a.id, { endpoint: 'https://push.example/gone', keys });
  await saveSubscription(a.id, { endpoint: 'https://push.example/ok', keys });
  const sendNotification = vi.fn(async (sub: { endpoint: string }) => {
    if (sub.endpoint.endsWith('gone')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    return { statusCode: 201, body: '', headers: {} };
  });
  const notifier = createWebPushNotifier({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:x@y.id', sendNotification: sendNotification as never });
  await notifier.send([a.id], { title: 't', body: 'b', url: URL_BASE });
  expect((await subs()).map((r) => r.endpoint)).toEqual(['https://push.example/ok']);
});

it('a 404 deletes the subscription and any other error keeps it', async () => {
  const a = await staff('a@vista.id');
  await saveSubscription(a.id, { endpoint: 'https://push.example/404', keys });
  await saveSubscription(a.id, { endpoint: 'https://push.example/500', keys });
  const sendNotification = vi.fn(async (sub: { endpoint: string }) => {
    throw Object.assign(new Error('x'), { statusCode: sub.endpoint.endsWith('404') ? 404 : 500 });
  });
  const notifier = createWebPushNotifier({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:x@y.id', sendNotification: sendNotification as never });
  await expect(notifier.send([a.id], { title: 't', body: 'b', url: URL_BASE })).resolves.toBeUndefined();
  expect((await subs()).map((r) => r.endpoint)).toEqual(['https://push.example/500']);
});

async function leadWithAgent(opts: { agentStaff?: string | null; name?: string | null } = {}) {
  await seedProjects();
  const project = (await listProjects())[0]!;
  const contact = await upsertContact('6281234567890', opts.name === undefined ? 'Sari' : opts.name);
  const lead = await ensureLead(contact.id);
  const agent = await createAgent({ name: 'Rina', waPhone: '6281000001', staffUserId: opts.agentStaff ?? null, projectIds: [project.id] });
  await getDb().update(leads).set({ assignedSalesId: agent.id, ...(opts.name === undefined ? {} : { name: opts.name }) }).where(eq(leads.id, lead.id));
  return { lead, agent, project, contact };
}

it("leadNeedsStaff pushes active admins and the assigned agent's account", async () => {
  const admin = await staff('admin@vista.id', 'admin');
  const inactive = await staff('old@vista.id', 'admin');
  await updateStaff(inactive.id, { isActive: false });
  const rep = await staff('rep@vista.id');
  const { lead } = await leadWithAgent({ agentStaff: rep.id });
  const notifier = recordingNotifier();
  const alerts = createAlerts({ notifier, dashboardUrl: URL_BASE });
  await alerts.leadNeedsStaff(lead.id, 'nego harga', 'handoff');
  expect(notifier.sent).toHaveLength(1);
  expect([...notifier.sent[0]!.staffUserIds].sort()).toEqual([admin.id, rep.id].sort());
  expect(notifier.sent[0]!.note).toEqual({ title: 'Perlu ditangani', body: 'Sari: nego harga', url: `${URL_BASE}/leads/${lead.id}` });
  await alerts.leadNeedsStaff(lead.id, 'gagal', 'failure');
  expect(notifier.sent[1]!.note.title).toBe('Moni gagal menjawab');
});

it('leadNeedsStaff skips an agent without an account and falls back to the phone', async () => {
  const admin = await staff('admin@vista.id', 'admin');
  const { lead } = await leadWithAgent({ agentStaff: null, name: null });
  const notifier = recordingNotifier();
  await createAlerts({ notifier, dashboardUrl: URL_BASE }).leadNeedsStaff(lead.id, 'minta telepon', 'handoff');
  expect(notifier.sent[0]!.staffUserIds).toEqual([admin.id]);
  expect(notifier.sent[0]!.note.body).toBe('6281234567890: minta telepon');
});

it('availabilityUnverified goes to the assigned agent, else the covering agents, else admins', async () => {
  const admin = await staff('admin@vista.id', 'admin');
  const rep = await staff('rep@vista.id');
  const { lead, project } = await leadWithAgent({ agentStaff: rep.id });
  const notifier = recordingNotifier();
  const alerts = createAlerts({ notifier, dashboardUrl: URL_BASE });
  await alerts.availabilityUnverified(lead.id, project.id, 'Tipe 36');
  expect(notifier.sent[0]!.staffUserIds).toEqual([rep.id]);
  expect(notifier.sent[0]!.note.title).toBe('Cek ketersediaan unit');
  expect(notifier.sent[0]!.note.body).toContain('Tipe 36');

  // no assigned agent: the agents covering the project
  await getDb().update(leads).set({ assignedSalesId: null }).where(eq(leads.id, lead.id));
  await alerts.availabilityUnverified(lead.id, project.id, 'Tipe 36');
  expect(notifier.sent[1]!.staffUserIds).toEqual([rep.id]);

  // nobody covers it: admins
  await alerts.availabilityUnverified(lead.id, project.id + 999, 'Tipe 36');
  expect(notifier.sent[2]!.staffUserIds).toEqual([admin.id]);
});

it('alerts never throw', async () => {
  const { lead, project } = await leadWithAgent();
  await staff('admin@vista.id', 'admin');
  const boom: Notifier = { send: async () => { throw new Error('push down'); } };
  const alerts = createAlerts({ notifier: boom, dashboardUrl: URL_BASE });
  await expect(alerts.leadNeedsStaff(lead.id, 'x', 'handoff')).resolves.toBeUndefined();
  await expect(alerts.availabilityUnverified(lead.id, project.id, 'T')).resolves.toBeUndefined();
  await expect(alerts.leadNeedsStaff('00000000-0000-0000-0000-000000000000', 'x', 'handoff')).resolves.toBeUndefined();
  await expect(alerts.outboundFailed({ id: 1 } as never)).resolves.toBeUndefined();
  await expect(alerts.visitChanged({ kind: 'booked', visit: { salesAgentId: 'nope' } as never, previous: null })).resolves.toBeUndefined();
});

it('a null notifier makes every alert a no-op', async () => {
  const alerts = createAlerts({ notifier: null, dashboardUrl: URL_BASE });
  await expect(alerts.leadNeedsStaff('x', 'y', 'handoff')).resolves.toBeUndefined();
});

it('outboundFailed pushes admins', async () => {
  const admin = await staff('admin@vista.id', 'admin');
  await staff('rep@vista.id');
  const { lead } = await leadWithAgent();
  const notifier = recordingNotifier();
  await createAlerts({ notifier, dashboardUrl: URL_BASE }).outboundFailed({ id: 7, kind: 'sales_alert', toPhone: '6281000001', leadId: lead.id, visitId: null, lastError: 'template ditolak' } as never);
  expect(notifier.sent).toHaveLength(1);
  expect(notifier.sent[0]!.staffUserIds).toEqual([admin.id]);
  expect(notifier.sent[0]!.note).toMatchObject({ title: 'Pesan WhatsApp gagal terkirim', url: `${URL_BASE}/leads/${lead.id}` });
});

async function setup() {
  const repA = await staff('a@vista.id');
  const repB = await staff('b@vista.id');
  const { lead, agent: agentA, project } = await leadWithAgent({ agentStaff: repA.id });
  const agentB = await createAgent({ name: 'Budi', waPhone: '6281000002', staffUserId: repB.id, projectIds: [project.id] });
  const agentC = await createAgent({ name: 'Cici', waPhone: '6281000003', staffUserId: null, projectIds: [project.id] });
  const mk = (agentId: string, extra: Partial<Visit> = {}): Visit =>
    ({
      id: '11111111-1111-4111-8111-111111111111',
      leadId: lead.id,
      projectId: project.id,
      salesAgentId: agentId,
      startsAt: new Date('2026-11-05T03:00:00Z'),
      endsAt: new Date('2026-11-05T04:00:00Z'),
      status: 'scheduled',
      isTest: false,
      ...extra,
    }) as Visit;
  const notifier = recordingNotifier();
  const alerts = createAlerts({ notifier, dashboardUrl: URL_BASE });
  const titles = () => notifier.sent.map((s) => ({ to: s.staffUserIds, title: s.note.title }));
  return { repA, repB, agentA, agentB, agentC, mk, alerts, notifier, titles };
}

it('visitChanged tells each agent what happened to them', async () => {
  const s = await setup();
  await s.alerts.visitChanged({ kind: 'booked', visit: s.mk(s.agentA.id), previous: null });
  expect(s.titles()).toEqual([{ to: [s.repA.id], title: SALES_ALERT_LABEL.booked }]);
  expect(s.notifier.sent[0]!.note.url).toBe(`${URL_BASE}/visits/11111111-1111-4111-8111-111111111111`);
  expect(s.notifier.sent[0]!.note.body).toContain('Sari');
  expect(s.notifier.sent[0]!.note.body).toContain('Kamis, 5 November 2026 10.00 WIB');

  s.notifier.sent.length = 0;
  await s.alerts.visitChanged({ kind: 'rescheduled', visit: s.mk(s.agentA.id), previous: s.mk(s.agentA.id, { startsAt: new Date('2026-11-04T03:00:00Z') }) });
  expect(s.titles()).toEqual([{ to: [s.repA.id], title: SALES_ALERT_LABEL.rescheduled }]);

  s.notifier.sent.length = 0;
  await s.alerts.visitChanged({ kind: 'cancelled', visit: s.mk(s.agentA.id, { status: 'cancelled' }), previous: s.mk(s.agentA.id) });
  expect(s.titles()).toEqual([{ to: [s.repA.id], title: SALES_ALERT_LABEL.cancelled }]);
});

it('a visit that moves to another agent tells both; an agent without an account gets nothing', async () => {
  const s = await setup();
  await s.alerts.visitChanged({ kind: 'reassigned', visit: s.mk(s.agentB.id), previous: s.mk(s.agentA.id) });
  expect(s.titles()).toEqual([
    { to: [s.repA.id], title: SALES_ALERT_LABEL.movedAway },
    { to: [s.repB.id], title: SALES_ALERT_LABEL.booked },
  ]);
  // The visit page is the new agent's now: the old one is sent to their schedule.
  expect(s.notifier.sent.map((x) => x.note.url)).toEqual([`${URL_BASE}/schedule`, `${URL_BASE}/visits/11111111-1111-4111-8111-111111111111`]);
  s.notifier.sent.length = 0;
  await s.alerts.visitChanged({ kind: 'rescheduled', visit: s.mk(s.agentC.id), previous: s.mk(s.agentA.id) });
  expect(s.titles()).toEqual([{ to: [s.repA.id], title: SALES_ALERT_LABEL.movedAway }]);
});

it('an outcome or a test visit pushes nobody', async () => {
  const s = await setup();
  await s.alerts.visitChanged({ kind: 'outcome', visit: s.mk(s.agentA.id, { status: 'visited' }), previous: s.mk(s.agentA.id) });
  await s.alerts.visitChanged({ kind: 'booked', visit: s.mk(s.agentA.id, { isTest: true }), previous: null });
  expect(s.notifier.sent).toEqual([]);
});

it('GET /push/config returns the public key, or null while push is off', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/api/v1/push/config', headers: auth });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ data: { publicKey: null }, error: null });
  expect((await app.inject({ method: 'GET', url: '/api/v1/push/config' })).statusCode).toBe(401);
});

it('POST /push/subscriptions saves for the staff member and DELETE removes', async () => {
  const app = buildApp();
  const a = await staff('a@vista.id');
  const payload = { endpoint: 'https://push.example/x', keys };
  const ok = await app.inject({ method: 'POST', url: '/api/v1/push/subscriptions', headers: { ...auth, 'x-staff-id': a.id }, payload });
  expect(ok.statusCode).toBe(200);
  expect((await subs())[0]).toMatchObject({ staffUserId: a.id, endpoint: payload.endpoint });
  const bad = await app.inject({ method: 'POST', url: '/api/v1/push/subscriptions', headers: { ...auth, 'x-staff-id': a.id }, payload: { endpoint: 'x' } });
  expect(bad.statusCode).toBe(400);
  const del = await app.inject({ method: 'DELETE', url: '/api/v1/push/subscriptions', headers: auth, payload: { endpoint: payload.endpoint } });
  expect(del.statusCode).toBe(200);
  expect(await subs()).toHaveLength(0);
});

it('POST /push/subscriptions refuses a non-https, IP-literal or localhost endpoint', async () => {
  const app = buildApp();
  const a = await staff('a@vista.id');
  const url = '/api/v1/push/subscriptions';
  const headers = { ...auth, 'x-staff-id': a.id };
  for (const endpoint of [
    'http://push.example/x',
    'ftp://push.example/x',
    'https://127.0.0.1/x',
    'https://10.0.0.5:8443/x',
    'https://169.254.169.254/latest',
    'https://[::1]/x',
    'https://localhost/x',
    'https://push.localhost/x',
    'https://2130706433/x',
  ]) {
    const res = await app.inject({ method: 'POST', url, headers, payload: { endpoint, keys } });
    expect(res.statusCode, endpoint).toBe(400);
    expect(res.json()).toEqual({ data: null, error: 'VALIDATION_ERROR' });
  }
  expect(await subs()).toHaveLength(0);
  const ok = await app.inject({ method: 'POST', url, headers, payload: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys } });
  expect(ok.statusCode).toBe(200);
});

it('POST /push/subscriptions without a staff id is 401', async () => {
  const app = buildApp();
  const a = await staff('a@vista.id');
  const payload = { endpoint: 'https://push.example/x', keys };
  const url = '/api/v1/push/subscriptions';
  expect((await app.inject({ method: 'POST', url, headers: auth, payload })).statusCode).toBe(401);
  expect((await app.inject({ method: 'POST', url, headers: { ...auth, 'x-staff-id': 'not-a-uuid' }, payload })).statusCode).toBe(401);
  expect((await app.inject({ method: 'POST', url, headers: { ...auth, 'x-staff-id': '00000000-0000-4000-8000-000000000000' }, payload })).statusCode).toBe(401);
  await updateStaff(a.id, { isActive: false });
  expect((await app.inject({ method: 'POST', url, headers: { ...auth, 'x-staff-id': a.id }, payload })).statusCode).toBe(401);
  expect(await subs()).toHaveLength(0);
});
