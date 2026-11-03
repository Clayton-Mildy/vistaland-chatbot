import { it, expect, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { truncate } from './helpers/db.js';
import { seedProjects } from './helpers/vles.js';
import { getDb } from '../src/db/client.js';
import { contacts, leads, projects, salesAgents, scheduledMessages, visits } from '../src/db/schema/index.js';
import { getLead, listEvents } from '../src/leads/repository.js';
import { listProjects } from '../src/repositories/projects.js';
import { createAgent, setAvailability, updateAgent, type SalesAgent } from '../src/scheduling/roster.js';
import { atWib } from '../src/scheduling/time.js';
import {
  bookVisit,
  cancelVisit,
  getVisitView,
  listVisitViews,
  markOutcome,
  reassignVisit,
  rescheduleVisit,
  type VisitResult,
} from '../src/scheduling/visits.js';

// Monday 2026-11-02, 10.00 WIB.
const now = new Date('2026-11-02T03:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const SAT = '2026-11-07';
const sat = (time: string) => atWib(SAT, time);

let zetira: number;
let a: SalesAgent;
let b: SalesAgent;

beforeEach(async () => {
  await truncate('projects', 'contacts', 'sales_agents', 'staff_users', 'scheduled_messages');
  await seedProjects();
  zetira = (await listProjects()).find((p) => p.slug === 'zetira')!.id;
  await getDb()
    .update(projects)
    .set({ galleryHours: { '6': ['09:00', '17:00'] }, visitMinutes: 60, sameDayMinNoticeMinutes: 120 })
    .where(eq(projects.id, zetira));
  a = await createAgent({ name: 'Andi', waPhone: '6281000001', staffUserId: null, projectIds: [zetira] });
  b = await createAgent({ name: 'Budi', waPhone: '6281000002', staffUserId: null, projectIds: [zetira] });
  for (const agent of [a, b]) await setAvailability(agent.id, [{ projectId: zetira, weekday: 6, start: '09:00', end: '17:00' }]);
});

let phone = 6284000000;
async function newLead(): Promise<string> {
  const [c] = await getDb().insert(contacts).values({ waPhone: String(phone++) }).returning();
  const [lead] = await getDb().insert(leads).values({ contactId: c!.id, name: 'Sari' }).returning();
  return lead!.id;
}

/** A visit written straight to the table: another day's booking, for fairness history or to make an agent busy. */
async function existingVisit(agentId: string, startsAt: Date, createdAt = now) {
  const [v] = await getDb()
    .insert(visits)
    .values({ leadId: await newLead(), projectId: zetira, salesAgentId: agentId, startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60_000), createdBy: 'moni', createdAt })
    .returning();
  return v!;
}

const input = (leadId: string, time = '10:00') => ({
  leadId,
  projectId: zetira,
  startsAt: sat(time),
  typeInterest: [],
  topics: null,
  actor: 'moni',
  isTest: false,
});

async function book(time = '10:00', leadId?: string) {
  const r = await bookVisit(input(leadId ?? (await newLead()), time), now);
  if (!r.ok) throw new Error(`booking failed: ${r.error}`);
  return r;
}

const alertsFor = (visitId: string) => getDb().select().from(scheduledMessages).where(eq(scheduledMessages.visitId, visitId));
const statusOf = async (visitId: string) => (await getVisitView(visitId))!.status;
const agentOf = (r: VisitResult) => (r.ok ? r.visit.salesAgentId : null);

// ─── booking ───────────────────────────────────────────────────────────────

it('booking assigns the agent with fewer visits this week', async () => {
  await existingVisit(a.id, atWib('2026-11-05', '09:00'), new Date(now.getTime() - 1 * DAY));
  await existingVisit(a.id, atWib('2026-11-05', '11:00'), new Date(now.getTime() - 2 * DAY));
  await existingVisit(b.id, atWib('2026-11-05', '09:00'), new Date(now.getTime() - 1 * DAY));
  // Old and cancelled visits do not count.
  await existingVisit(b.id, atWib('2026-11-05', '13:00'), new Date(now.getTime() - 9 * DAY));
  const cancelled = await existingVisit(b.id, atWib('2026-11-05', '15:00'), new Date(now.getTime() - 1 * DAY));
  await getDb().update(visits).set({ status: 'cancelled' }).where(eq(visits.id, cancelled.id));

  expect(agentOf(await book())).toBe(b.id);
});

it('a fairness tie goes to the agent assigned longest ago', async () => {
  await existingVisit(a.id, atWib('2026-11-05', '09:00'), new Date(now.getTime() - 1 * DAY));
  await existingVisit(b.id, atWib('2026-11-05', '09:00'), new Date(now.getTime() - 3 * DAY));
  expect(agentOf(await book())).toBe(b.id);
});

it('concurrent bookings for the last free agent: one wins, one SLOT_TAKEN', async () => {
  const [lead1, lead2] = [await newLead(), await newLead()];
  await updateAgent(b.id, { active: false });
  const [r1, r2] = await allPastTheSlotCheck(2, () =>
    Promise.all([bookVisit({ ...input(lead1) }, now), bookVisit({ ...input(lead2) }, now)])
  );
  expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
  expect([r1, r2].find((r) => !r.ok)).toEqual({ ok: false, error: 'SLOT_TAKEN' });
  const booked = await getDb().select().from(visits);
  expect(booked).toHaveLength(1);
  expect(booked[0]!.salesAgentId).toBe(a.id);
});

it('a booking that waits on a deactivation does not land on the deactivated agent', async () => {
  await updateAgent(b.id, { active: false });
  const lead = await newLead();
  let pending: Promise<VisitResult> | undefined;
  // As updateAgent does: lock Andi's row, then deactivate. The booking already saw Andi as free.
  await getDb().transaction(async (tx) => {
    await tx.select().from(salesAgents).where(eq(salesAgents.id, a.id)).for('update');
    pending = bookVisit(input(lead), now);
    await waitForLockWait();
    await tx.update(salesAgents).set({ active: false }).where(eq(salesAgents.id, a.id));
  });
  expect(await pending).toEqual({ ok: false, error: 'SLOT_TAKEN' });
  expect(await getDb().select().from(visits)).toHaveLength(0);
});

it('a conflict moves on to the next agent', async () => {
  const ids = [await newLead(), await newLead(), await newLead()];
  const results = await allPastTheSlotCheck(3, () => Promise.all(ids.map((id) => bookVisit(input(id), now))));
  const ok = results.filter((r) => r.ok);
  expect(ok).toHaveLength(2);
  expect(new Set(ok.map(agentOf))).toEqual(new Set([a.id, b.id]));
  expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: 'SLOT_TAKEN' }]);
});

it('booking a slot that is not free returns SLOT_NOT_FREE', async () => {
  expect(await bookVisit(input(await newLead(), '08:00'), now)).toEqual({ ok: false, error: 'SLOT_NOT_FREE' });
  // Not on the half-hour grid.
  expect(await bookVisit(input(await newLead(), '10:15'), now)).toEqual({ ok: false, error: 'SLOT_NOT_FREE' });
});

it('a lead with an active visit cannot book a second', async () => {
  const lead = await newLead();
  await book('10:00', lead);
  expect(await bookVisit(input(lead, '14:00'), now)).toEqual({ ok: false, error: 'HAS_ACTIVE_VISIT' });
});

it('booking sets the stage, the assignment, the event and one pending sales alert', async () => {
  const lead = await newLead();
  const r = await book('10:00', lead);
  expect(r.visit).toMatchObject({
    leadId: lead,
    salesAgentId: a.id,
    salesName: 'Andi',
    projectName: 'Zetira',
    status: 'scheduled',
    startsAt: sat('10:00'),
    endsAt: sat('11:00'),
    createdBy: 'moni',
    label: 'Sabtu, 7 November 2026 10.00 WIB',
  });
  expect(r.change).toMatchObject({ kind: 'booked', previous: null, visit: { id: r.visit.id } });

  const after = (await getLead(lead))!;
  expect(after.stage).toBe('visit_scheduled');
  expect(after.assignedSalesId).toBe(a.id);
  const [event] = await listEvents(lead, ['visit_booked']);
  expect(event!.payload).toEqual({ visitId: r.visit.id, startsAt: sat('10:00').toISOString(), salesAgentId: a.id, salesName: 'Andi' });

  const alerts = await alertsFor(r.visit.id);
  expect(alerts).toHaveLength(1);
  expect(alerts[0]).toMatchObject({ kind: 'sales_alert', status: 'pending', toPhone: a.waPhone, leadId: lead });
  expect(alerts[0]!.params[1]).toBe('Kunjungan baru');
});

it('a test booking does not block a real one and queues no alert', async () => {
  await updateAgent(b.id, { active: false });
  const test = await bookVisit({ ...input(await newLead()), isTest: true }, now);
  expect(test).toMatchObject({ ok: true, visit: { salesAgentId: a.id, isTest: true } });
  const real = await book();
  expect(real.visit.salesAgentId).toBe(a.id);
  expect(await alertsFor(test.ok ? test.visit.id : '')).toHaveLength(0);
  expect(await alertsFor(real.visit.id)).toHaveLength(1);
});

// ─── reschedule ────────────────────────────────────────────────────────────

it('reschedule keeps the agent when free', async () => {
  const first = await book('10:00');
  expect(first.visit.salesAgentId).toBe(a.id);
  // Fairness alone would now pick Budi, who has no visits.
  const r = await rescheduleVisit({ visitId: first.visit.id, startsAt: sat('14:00'), actor: 'staff:x' }, now);
  expect(r).toMatchObject({ ok: true, visit: { salesAgentId: a.id, startsAt: sat('14:00'), rescheduledFrom: first.visit.id, createdBy: 'staff:x' } });
});

it('reschedule moves to another agent when the agent is busy', async () => {
  const lead = await newLead();
  const first = await book('10:00', lead);
  await existingVisit(a.id, sat('14:00'));
  const r = await rescheduleVisit({ visitId: first.visit.id, startsAt: sat('14:00'), actor: 'moni' }, now);
  if (!r.ok) throw new Error(r.error);
  expect(r.visit).toMatchObject({ salesAgentId: b.id, status: 'scheduled', rescheduledFrom: first.visit.id, leadId: lead });
  expect(r.change).toMatchObject({ kind: 'rescheduled', visit: { id: r.visit.id }, previous: { id: first.visit.id, salesAgentId: a.id } });
  expect(await statusOf(first.visit.id)).toBe('rescheduled');

  const alerts = await alertsFor(r.visit.id);
  expect(alerts).toHaveLength(2);
  expect(alerts.map((x) => x.toPhone).sort()).toEqual([a.waPhone, b.waPhone].sort());

  const after = (await getLead(lead))!;
  expect(after.assignedSalesId).toBe(b.id);
  expect(after.stage).toBe('visit_scheduled');
  const [event] = await listEvents(lead, ['visit_rescheduled']);
  expect(event!.payload).toEqual({ visitId: r.visit.id, from: sat('10:00').toISOString(), to: sat('14:00').toISOString() });
});

it('a failed reschedule leaves the old visit active', async () => {
  await updateAgent(b.id, { active: false });
  const first = await book('10:00');
  expect(await rescheduleVisit({ visitId: first.visit.id, startsAt: sat('08:00'), actor: 'moni' }, now)).toEqual({ ok: false, error: 'SLOT_NOT_FREE' });

  // Andi looks free at 14:00, but another booking for that hour is in flight: the reschedule has
  // already marked the old row when its insert hits the overlap, so everything must roll back.
  const otherLead = await newLead();
  let pending: Promise<VisitResult> | undefined;
  await getDb().transaction(async (tx) => {
    await tx.insert(visits).values({ leadId: otherLead, projectId: zetira, salesAgentId: a.id, startsAt: sat('14:00'), endsAt: sat('15:00'), createdBy: 'moni' });
    pending = rescheduleVisit({ visitId: first.visit.id, startsAt: sat('14:00'), actor: 'moni' }, now);
    await waitForLockWait();
  });
  expect(await pending).toEqual({ ok: false, error: 'SLOT_TAKEN' });
  expect(await statusOf(first.visit.id)).toBe('scheduled');
  expect(await getDb().select().from(visits).where(eq(visits.rescheduledFrom, first.visit.id))).toHaveLength(0);
});

it('moving a visit by 30 minutes for the same agent succeeds', async () => {
  await updateAgent(b.id, { active: false });
  const first = await book('10:00');
  // 10:30-11:30 overlaps the old 10:00-11:00, so this only works if the old row is marked first.
  const r = await rescheduleVisit({ visitId: first.visit.id, startsAt: sat('10:30'), actor: 'moni' }, now);
  expect(r).toMatchObject({ ok: true, visit: { salesAgentId: a.id, startsAt: sat('10:30'), endsAt: sat('11:30') } });
  expect(await statusOf(first.visit.id)).toBe('rescheduled');
});

it('only an active visit can be rescheduled', async () => {
  const first = await book('10:00');
  await rescheduleVisit({ visitId: first.visit.id, startsAt: sat('14:00'), actor: 'moni' }, now);
  expect(await rescheduleVisit({ visitId: first.visit.id, startsAt: sat('15:00'), actor: 'moni' }, now)).toEqual({ ok: false, error: 'NOT_ACTIVE' });
  expect(await rescheduleVisit({ visitId: '00000000-0000-0000-0000-000000000000', startsAt: sat('15:00'), actor: 'moni' }, now)).toEqual({
    ok: false,
    error: 'NOT_FOUND',
  });
});

// ─── cancel, reassign, outcome ─────────────────────────────────────────────

it('cancel sets the stage to cancelled and queues a cancel alert', async () => {
  const lead = await newLead();
  const first = await book('10:00', lead);
  const r = await cancelVisit({ visitId: first.visit.id, reason: 'Ada acara keluarga', actor: 'moni' }, now);
  expect(r).toMatchObject({ ok: true, visit: { status: 'cancelled', cancelReason: 'Ada acara keluarga' }, change: { kind: 'cancelled' } });
  expect((await getLead(lead))!.stage).toBe('cancelled');
  const [event] = await listEvents(lead, ['visit_cancelled']);
  expect(event!.payload).toEqual({ visitId: first.visit.id, reason: 'Ada acara keluarga' });
  const alerts = await alertsFor(first.visit.id);
  expect(alerts.map((x) => x.params[1]).sort()).toEqual(['Kunjungan baru', 'Kunjungan dibatalkan']);
  expect(await cancelVisit({ visitId: first.visit.id, reason: 'lagi', actor: 'moni' }, now)).toEqual({ ok: false, error: 'NOT_ACTIVE' });
});

it('reassign to a busy agent returns AGENT_NOT_FREE', async () => {
  const first = await book('10:00');
  const second = await book('10:00');
  expect(second.visit.salesAgentId).toBe(b.id);
  expect(await reassignVisit({ visitId: first.visit.id, salesAgentId: b.id, actor: 'staff:x' }, now)).toEqual({ ok: false, error: 'AGENT_NOT_FREE' });
  const inactive = await createAgent({ name: 'Citra', waPhone: '6281000003', staffUserId: null, projectIds: [zetira] });
  await updateAgent(inactive.id, { active: false });
  expect(await reassignVisit({ visitId: first.visit.id, salesAgentId: inactive.id, actor: 'staff:x' }, now)).toEqual({ ok: false, error: 'AGENT_NOT_FREE' });
  expect((await getVisitView(first.visit.id))!.salesAgentId).toBe(a.id);
});

it('reassign to a free agent moves the visit and the lead and alerts both agents', async () => {
  const lead = await newLead();
  const first = await book('10:00', lead);
  const r = await reassignVisit({ visitId: first.visit.id, salesAgentId: b.id, actor: 'staff:x' }, now);
  expect(r).toMatchObject({ ok: true, visit: { id: first.visit.id, salesAgentId: b.id, salesName: 'Budi' }, change: { kind: 'reassigned', previous: { salesAgentId: a.id } } });
  expect((await getLead(lead))!.assignedSalesId).toBe(b.id);
  const [event] = await listEvents(lead, ['visit_reassigned']);
  expect(event!.payload).toEqual({ visitId: first.visit.id, from: a.id, to: b.id, salesName: 'Budi' });
  const labels = (await alertsFor(first.visit.id)).map((x) => `${x.toPhone} ${x.params[1]}`).sort();
  expect(labels).toEqual([`${a.waPhone} Kunjungan baru`, `${a.waPhone} Kunjungan dialihkan ke sales lain`, `${b.waPhone} Kunjungan baru`].sort());
});

it('an outcome before the visit starts is TOO_EARLY, and visited sets the stage', async () => {
  const lead = await newLead();
  const first = await book('10:00', lead);
  expect(await markOutcome({ visitId: first.visit.id, outcome: 'visited', actor: 'staff:x' }, now)).toEqual({ ok: false, error: 'TOO_EARLY' });

  const r = await markOutcome({ visitId: first.visit.id, outcome: 'visited', actor: 'staff:x' }, sat('11:00'));
  expect(r).toMatchObject({ ok: true, visit: { status: 'visited' }, change: { kind: 'outcome', previous: { status: 'scheduled' } } });
  expect((await getLead(lead))!.stage).toBe('visited');
  const [event] = await listEvents(lead, ['visit_outcome']);
  expect(event!.payload).toEqual({ visitId: first.visit.id, outcome: 'visited' });
  // Only the booking alert: an outcome tells nobody.
  expect(await alertsFor(first.visit.id)).toHaveLength(1);
  expect(await markOutcome({ visitId: first.visit.id, outcome: 'no_show', actor: 'staff:x' }, sat('11:00'))).toEqual({ ok: false, error: 'NOT_ACTIVE' });
});

it('no_show sets the stage', async () => {
  const lead = await newLead();
  const first = await book('10:00', lead);
  await markOutcome({ visitId: first.visit.id, outcome: 'no_show', actor: 'staff:x' }, sat('12:00'));
  expect((await getLead(lead))!.stage).toBe('no_show');
  expect(await statusOf(first.visit.id)).toBe('no_show');
});

// ─── listing ───────────────────────────────────────────────────────────────

it('listVisitViews returns visits in the range, chronological, without test visits unless asked', async () => {
  const late = await book('14:00');
  const early = await book('10:00');
  const test = await bookVisit({ ...input(await newLead(), '12:00'), isTest: true }, now);
  await existingVisit(a.id, atWib('2026-11-14', '10:00')); // outside the range

  const range = { from: atWib(SAT, '00:00'), to: atWib('2026-11-08', '00:00') };
  expect((await listVisitViews(range)).map((v) => v.id)).toEqual([early.visit.id, late.visit.id]);
  expect((await listVisitViews({ ...range, includeTest: true })).map((v) => v.id)).toEqual([early.visit.id, test.ok ? test.visit.id : '', late.visit.id]);
  expect(early.visit.salesAgentId).toBe(b.id);
  expect((await listVisitViews({ ...range, salesAgentId: b.id })).map((v) => v.id)).toEqual([early.visit.id]);
  expect(await listVisitViews({ ...range, projectId: zetira + 1000 })).toEqual([]);
  expect((await listVisitViews(range))[0]!.label).toBe('Sabtu, 7 November 2026 10.00 WIB');
});

/** Resolves once `waiters` backends are waiting on a lock, i.e. the calls under test are blocked on our transaction. */
async function waitForLockWait(waiters = 1): Promise<void> {
  for (let i = 0; i < 500; i++) {
    const { rows } = await getDb().execute<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
    );
    if (rows[0]!.n >= waiters) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('nothing ever waited on the lock');
}

/**
 * Runs bookings in parallel while holding Andi's row FOR UPDATE, releasing it only once all
 * `bookings` are blocked locking it. Each has then passed the slot check and ranked the
 * agents from the same state, so the race is decided by the database alone, every run.
 */
async function allPastTheSlotCheck<T>(bookings: number, run: () => Promise<T>): Promise<T> {
  let result: Promise<T> | undefined;
  await getDb().transaction(async (tx) => {
    await tx.select().from(salesAgents).where(eq(salesAgents.id, a.id)).for('update');
    result = run();
    await waitForLockWait(bookings);
  });
  return result!;
}
