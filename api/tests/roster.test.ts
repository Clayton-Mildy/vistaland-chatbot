import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { seedProjects } from './helpers/vles.js';
import { buildApp } from '../src/app.js';
import { getDb } from '../src/db/client.js';
import { contacts, leads, visits } from '../src/db/schema/index.js';
import { listProjects } from '../src/repositories/projects.js';
import { createStaff } from '../src/repositories/staff.js';
import { addTimeOff, agentForStaff, createAgent, listRoster, normalizeWaPhone, setAvailability } from '../src/scheduling/roster.js';

const auth = { authorization: 'Bearer test-secret-test-secret-test-secret-00' };
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await truncate('projects', 'contacts', 'sales_agents', 'staff_users');
  await seedProjects();
});

const projectIds = async () => (await listProjects()).map((p) => p.id);

it('normalizeWaPhone strips punctuation and the leading zero or plus', () => {
  expect(normalizeWaPhone('0812-3456-7890')).toBe('6281234567890');
  expect(normalizeWaPhone('+62 812 3456 7890')).toBe('6281234567890');
  expect(normalizeWaPhone('(0812) 3456.7890')).toBe('6281234567890');
  expect(normalizeWaPhone('62812')).toBeNull();
  expect(normalizeWaPhone('abc')).toBeNull();
  expect(normalizeWaPhone('1234567890123')).toBeNull();
});

it('creating an agent with a taken number returns PHONE_TAKEN', async () => {
  const app = buildApp();
  const [p] = await projectIds();
  const body = { name: 'Rina', waPhone: '0812-3456-7890', projectIds: [p] };
  const first = await app.inject({ method: 'POST', url: '/api/v1/roster/agents', headers: auth, payload: body });
  expect(first.statusCode).toBe(201);
  expect(first.json().data.waPhone).toBe('6281234567890');
  const dup = await app.inject({ method: 'POST', url: '/api/v1/roster/agents', headers: auth, payload: { ...body, name: 'Budi', waPhone: '+6281234567890' } });
  expect(dup.statusCode).toBe(409);
  expect(dup.json()).toMatchObject({ data: null, error: 'PHONE_TAKEN' });
  const invalid = await app.inject({ method: 'POST', url: '/api/v1/roster/agents', headers: auth, payload: { ...body, waPhone: '62812' } });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json().error).toBe('INVALID_PHONE');
});

it('refuses a staff account that is already linked to another agent', async () => {
  const app = buildApp();
  const staff = await createStaff({ email: 's@vista.id', password: 'correct-horse-1', displayName: 'S', role: 'sales' });
  await createAgent({ name: 'Rina', waPhone: '6281000001', staffUserId: staff.id, projectIds: [] });
  const res = await app.inject({ method: 'POST', url: '/api/v1/roster/agents', headers: auth, payload: { name: 'Budi', waPhone: '6281000002', staffUserId: staff.id, projectIds: [] } });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('STAFF_LINKED');
  expect((await agentForStaff(staff.id))?.name).toBe('Rina');
});

it('availability for an uncovered project is rejected', async () => {
  const app = buildApp();
  const [a, b] = await projectIds();
  const agent = await createAgent({ name: 'Rina', waPhone: '6281000001', staffUserId: null, projectIds: [a!] });
  const url = `/api/v1/roster/agents/${agent.id}/availability`;
  const bad = await app.inject({ method: 'PUT', url, headers: auth, payload: { rows: [{ projectId: b, weekday: 1, start: '09:00', end: '17:00' }] } });
  expect(bad.statusCode).toBe(409);
  expect(bad.json().error).toBe('PROJECT_NOT_COVERED');
  const ok = await app.inject({ method: 'PUT', url, headers: auth, payload: { rows: [{ projectId: a, weekday: 1, start: '09:00', end: '17:00' }] } });
  expect(ok.statusCode).toBe(200);
});

it('availability with start after end is rejected', async () => {
  const [a] = await projectIds();
  const agent = await createAgent({ name: 'Rina', waPhone: '6281000001', staffUserId: null, projectIds: [a!] });
  const url = `/api/v1/roster/agents/${agent.id}/availability`;
  for (const row of [
    { start: '17:00', end: '09:00' },
    { start: '09:00', end: '09:00' },
    { start: '9:00', end: '17:00' },
  ]) {
    const res = await buildApp().inject({ method: 'PUT', url, headers: auth, payload: { rows: [{ projectId: a, weekday: 1, ...row }] } });
    expect(res.statusCode).toBe(400);
  }
});

async function agentWithVisit(visitStatus: string, startsAt: Date, isTest = false) {
  const [a] = await projectIds();
  const agent = await createAgent({ name: 'Rina', waPhone: '6281000001', staffUserId: null, projectIds: [a!] });
  const [c] = await getDb().insert(contacts).values({ waPhone: '6282001' }).returning();
  const [lead] = await getDb().insert(leads).values({ contactId: c!.id }).returning();
  await getDb()
    .insert(visits)
    .values({
      leadId: lead!.id,
      projectId: a!,
      salesAgentId: agent.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      status: visitStatus as 'scheduled',
      isTest,
      createdBy: 'moni',
    });
  return { agent, projectId: a! };
}

it('deactivating an agent with upcoming visits is refused', async () => {
  const app = buildApp();
  const { agent } = await agentWithVisit('scheduled', new Date(Date.now() + DAY));
  const res = await app.inject({ method: 'PATCH', url: `/api/v1/roster/agents/${agent.id}`, headers: auth, payload: { active: false } });
  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({ data: null, error: 'HAS_UPCOMING_VISITS', meta: { count: 1 } });
  const still = await app.inject({ method: 'PATCH', url: `/api/v1/roster/agents/${agent.id}`, headers: auth, payload: { name: 'Rina S' } });
  expect(still.json().data).toMatchObject({ name: 'Rina S', active: true });
});

it('a past, cancelled or test visit does not block deactivation', async () => {
  for (const [status, offset, isTest] of [
    ['scheduled', -DAY, false],
    ['cancelled', DAY, false],
    ['scheduled', DAY, true],
  ] as const) {
    await truncate('contacts', 'sales_agents');
    const { agent } = await agentWithVisit(status, new Date(Date.now() + offset), isTest);
    const res = await buildApp().inject({ method: 'PATCH', url: `/api/v1/roster/agents/${agent.id}`, headers: auth, payload: { active: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.active).toBe(false);
  }
});

it('removing a project with upcoming visits from coverage is refused, another project is not', async () => {
  const app = buildApp();
  const { agent, projectId } = await agentWithVisit('confirmed', new Date(Date.now() + DAY));
  const [other] = (await projectIds()).filter((id) => id !== projectId);
  await app.inject({ method: 'PATCH', url: `/api/v1/roster/agents/${agent.id}`, headers: auth, payload: { projectIds: [projectId, other] } });
  const refused = await app.inject({ method: 'PATCH', url: `/api/v1/roster/agents/${agent.id}`, headers: auth, payload: { projectIds: [other] } });
  expect(refused.statusCode).toBe(409);
  expect(refused.json()).toMatchObject({ error: 'HAS_UPCOMING_VISITS', meta: { count: 1 } });
  const ok = await app.inject({ method: 'PATCH', url: `/api/v1/roster/agents/${agent.id}`, headers: auth, payload: { projectIds: [projectId] } });
  expect(ok.statusCode).toBe(200);
});

it('listRoster returns coverage, hours and only future time off', async () => {
  const [a, b] = await projectIds();
  const staff = await createStaff({ email: 's@vista.id', password: 'correct-horse-1', displayName: 'S', role: 'sales' });
  const zed = await createAgent({ name: 'Zed', waPhone: '6281000009', staffUserId: null, projectIds: [] });
  const rina = await createAgent({ name: 'Rina', waPhone: '6281000001', staffUserId: staff.id, projectIds: [a!, b!] });
  await setAvailability(rina.id, [
    { projectId: a!, weekday: 2, start: '10:00', end: '12:00' },
    { projectId: a!, weekday: 1, start: '09:00', end: '17:00' },
  ]);
  await setAvailability(rina.id, [
    { projectId: a!, weekday: 1, start: '09:00', end: '17:00' },
    { projectId: b!, weekday: 3, start: '08:00', end: '12:00' },
  ]);
  const now = Date.now();
  await addTimeOff(rina.id, { startsAt: new Date(now - 3 * DAY), endsAt: new Date(now - DAY), reason: 'lalu' });
  const future = await addTimeOff(rina.id, { startsAt: new Date(now + DAY), endsAt: new Date(now + 2 * DAY), reason: 'cuti' });

  const roster = await listRoster();
  expect(roster.map((r) => r.name)).toEqual(['Rina', 'Zed']);
  expect(roster[0]).toMatchObject({ staffEmail: 's@vista.id', projectIds: [a, b].sort((x, y) => x! - y!) });
  expect(roster[0]!.availability).toEqual([
    { projectId: a, weekday: 1, start: '09:00', end: '17:00' },
    { projectId: b, weekday: 3, start: '08:00', end: '12:00' },
  ]);
  expect(roster[0]!.timeOff).toEqual([expect.objectContaining({ id: future.id, reason: 'cuti' })]);
  expect(roster[1]).toMatchObject({ id: zed.id, projectIds: [], availability: [], timeOff: [], staffEmail: null });

  const res = await buildApp().inject({ method: 'GET', url: '/api/v1/roster', headers: auth });
  expect(res.statusCode).toBe(200);
  expect(res.json().data).toHaveLength(2);
});

it('adds and deletes time off through the API', async () => {
  const app = buildApp();
  const agent = await createAgent({ name: 'Rina', waPhone: '6281000001', staffUserId: null, projectIds: [] });
  const startsAt = new Date(Date.now() + DAY).toISOString();
  const endsAt = new Date(Date.now() + 2 * DAY).toISOString();
  const bad = await app.inject({ method: 'POST', url: `/api/v1/roster/agents/${agent.id}/time-off`, headers: auth, payload: { startsAt: endsAt, endsAt: startsAt } });
  expect(bad.statusCode).toBe(400);
  const res = await app.inject({ method: 'POST', url: `/api/v1/roster/agents/${agent.id}/time-off`, headers: auth, payload: { startsAt, endsAt, reason: 'cuti' } });
  expect(res.statusCode).toBe(201);
  const id = res.json().data.id;
  expect((await app.inject({ method: 'DELETE', url: `/api/v1/roster/time-off/${id}`, headers: auth })).statusCode).toBe(200);
  expect((await app.inject({ method: 'DELETE', url: `/api/v1/roster/time-off/${id}`, headers: auth })).statusCode).toBe(404);
});

it('rejects requests without the API secret', async () => {
  expect((await buildApp().inject({ method: 'GET', url: '/api/v1/roster' })).statusCode).toBe(401);
});
