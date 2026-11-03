import { it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { truncate } from './helpers/db.js';
import { seedProjects } from './helpers/vles.js';
import { getDb } from '../src/db/client.js';
import { contacts, leads, salesAgents, scheduledMessages, staffUsers, visits } from '../src/db/schema/index.js';
import { listProjects } from '../src/repositories/projects.js';
import { pgCode } from '../src/db/pgError.js';

beforeEach(() => truncate('projects', 'contacts', 'sales_agents', 'staff_users', 'scheduled_messages'));

const at = (hhmm: string) => new Date(`2030-01-07T${hhmm}:00+07:00`);

async function setup() {
  await seedProjects();
  const project = (await listProjects())[0]!;
  const [agent] = await getDb().insert(salesAgents).values({ name: 'Rina', waPhone: '6281000001' }).returning();
  const [other] = await getDb().insert(salesAgents).values({ name: 'Budi', waPhone: '6281000002' }).returning();
  const mkLead = async (phone: string) => {
    const [c] = await getDb().insert(contacts).values({ waPhone: phone }).returning();
    const [l] = await getDb().insert(leads).values({ contactId: c!.id }).returning();
    return l!;
  };
  const visit = (leadId: string, from: string, to: string, extra: Partial<typeof visits.$inferInsert> = {}) => ({
    leadId,
    projectId: project.id,
    salesAgentId: agent!.id,
    startsAt: at(from),
    endsAt: at(to),
    status: 'scheduled' as const,
    createdBy: 'moni',
    ...extra,
  });
  return { project, agent: agent!, other: other!, mkLead, visit };
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    return pgCode(err);
  }
  return undefined;
}

it('overlapping active visits for one agent are rejected', async () => {
  const { mkLead, visit } = await setup();
  const [a, b] = [await mkLead('6282001'), await mkLead('6282002')];
  await getDb().insert(visits).values(visit(a.id, '10:00', '11:00'));
  expect(await codeOf(getDb().insert(visits).values(visit(b.id, '10:30', '11:30')))).toBe('23P01');
});

it('allows overlapping visits for different agents', async () => {
  const { mkLead, visit, other } = await setup();
  const [a, b] = [await mkLead('6282001'), await mkLead('6282002')];
  await getDb().insert(visits).values(visit(a.id, '10:00', '11:00'));
  await getDb().insert(visits).values(visit(b.id, '10:30', '11:30', { salesAgentId: other.id }));
});

it('back-to-back visits are allowed', async () => {
  const { mkLead, visit } = await setup();
  const [a, b] = [await mkLead('6282001'), await mkLead('6282002')];
  await getDb().insert(visits).values(visit(a.id, '10:00', '11:00'));
  await getDb().insert(visits).values(visit(b.id, '11:00', '12:00'));
});

it('inactive and test visits do not block', async () => {
  const { mkLead, visit } = await setup();
  const [a, b, c, d] = [await mkLead('6282001'), await mkLead('6282002'), await mkLead('6282003'), await mkLead('6282004')];
  await getDb().insert(visits).values(visit(a.id, '10:00', '11:00', { status: 'cancelled' }));
  await getDb().insert(visits).values(visit(b.id, '10:30', '11:30'));
  // The first row is a test visit: it does not block a real one.
  await getDb().insert(visits).values(visit(c.id, '13:00', '14:00', { isTest: true }));
  await getDb().insert(visits).values(visit(d.id, '13:30', '14:30'));
  // The second row is a test visit: it is not blocked by a real one.
  const e = await mkLead('6282005');
  await getDb().insert(visits).values(visit(e.id, '13:45', '14:15', { isTest: true }));
});

it('a lead has one active visit', async () => {
  const { mkLead, visit } = await setup();
  const lead = await mkLead('6282001');
  const [first] = await getDb().insert(visits).values(visit(lead.id, '10:00', '11:00')).returning();
  expect(await codeOf(getDb().insert(visits).values(visit(lead.id, '14:00', '15:00')))).toBe('23505');
  await getDb().update(visits).set({ status: 'cancelled' }).where(eq(visits.id, first!.id));
  await getDb().insert(visits).values(visit(lead.id, '14:00', '15:00'));
});

it('rejects an unknown visit status', async () => {
  const { mkLead, visit } = await setup();
  const lead = await mkLead('6282001');
  await expect(getDb().insert(visits).values(visit(lead.id, '10:00', '11:00', { status: 'done' as never }))).rejects.toThrow();
});

it('dedupe_key may repeat only after cancellation', async () => {
  const row = { kind: 'sales_alert' as const, dedupeKey: 'sales_alert:v1', toPhone: '6281000001', dueAt: new Date() };
  const [first] = await getDb().insert(scheduledMessages).values(row).returning();
  expect(first).toMatchObject({ status: 'pending', attempts: 0, params: [] });
  expect(await codeOf(getDb().insert(scheduledMessages).values(row))).toBe('23505');
  await getDb().update(scheduledMessages).set({ status: 'cancelled' }).where(eq(scheduledMessages.id, first!.id));
  await getDb().insert(scheduledMessages).values(row);
});

it('deleting a staff user unlinks their sales agent', async () => {
  const [staff] = await getDb()
    .insert(staffUsers)
    .values({ email: 's@vista.id', passwordHash: 'x', displayName: 'S', role: 'sales' })
    .returning();
  const [agent] = await getDb().insert(salesAgents).values({ name: 'S', waPhone: '6281000009', staffUserId: staff!.id }).returning();
  await getDb().delete(staffUsers).where(eq(staffUsers.id, staff!.id));
  const [after] = await getDb().select().from(salesAgents).where(eq(salesAgents.id, agent!.id));
  expect(after).toMatchObject({ staffUserId: null, name: 'S' });
});

it('pgCode reads the code from the error or its cause', () => {
  expect(pgCode({ code: '23505' })).toBe('23505');
  expect(pgCode({ cause: { code: '23P01' } })).toBe('23P01');
  expect(pgCode(new Error('plain'))).toBeUndefined();
  expect(pgCode(null)).toBeUndefined();
});
