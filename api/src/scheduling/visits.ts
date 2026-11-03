import { and, asc, desc, eq, gt, gte, inArray, lt, notInArray, sql, type SQL } from 'drizzle-orm';
import { getDb, type Db } from '../db/client.js';
import { pgCode } from '../db/pgError.js';
import { leads, projects, salesAgentProjects, salesAgents, visits } from '../db/schema/index.js';
import { recordEvent, setLeadStage } from '../leads/repository.js';
import { cancelPending, type DbOrTx } from '../outbound/repository.js';
import { queueSalesAlerts } from '../outbound/salesAlert.js';
import { ACTIVE_VISIT_STATUSES } from './roster.js';
import { freeSlots, loadSlotData, type Slot } from './slots.js';
import { wibDate, wibLabel } from './time.js';

export { ACTIVE_VISIT_STATUSES };

export type Visit = typeof visits.$inferSelect;

export type VisitView = Visit & {
  salesName: string;
  salesPhone: string;
  projectName: string;
  mapsUrl: string | null;
  // wibLabel(startsAt), e.g. "Jumat, 30 Oktober 2026 10.00 WIB".
  label: string;
};

// `previous` is the row before the change; for a reschedule it is the old row.
export type VisitChange = {
  kind: 'booked' | 'rescheduled' | 'cancelled' | 'reassigned' | 'outcome';
  visit: Visit;
  previous: Visit | null;
};

export type VisitError = 'NOT_FOUND' | 'NOT_ACTIVE' | 'SLOT_NOT_FREE' | 'SLOT_TAKEN' | 'HAS_ACTIVE_VISIT' | 'AGENT_NOT_FREE' | 'TOO_EARLY';
export type VisitResult = { ok: true; visit: VisitView; change: VisitChange } | { ok: false; error: VisitError };

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const DAY_MS = 24 * 60 * 60 * 1000;
const FAIRNESS_WINDOW_DAYS = 7;

const fail = (error: VisitError): VisitResult => ({ ok: false, error });
const isActive = (status: Visit['status']) => (ACTIVE_VISIT_STATUSES as readonly string[]).includes(status);

// ─── reading ───────────────────────────────────────────────────────────────

function selectViews(db: DbOrTx) {
  return db
    .select({
      visit: visits,
      salesName: salesAgents.name,
      salesPhone: salesAgents.waPhone,
      projectName: projects.displayName,
      mapsUrl: projects.mapsUrl,
    })
    .from(visits)
    .innerJoin(salesAgents, eq(salesAgents.id, visits.salesAgentId))
    .innerJoin(projects, eq(projects.id, visits.projectId));
}

type ViewRow = Awaited<ReturnType<typeof selectViews>>[number];

const toView = (row: ViewRow): VisitView => ({
  ...row.visit,
  salesName: row.salesName,
  salesPhone: row.salesPhone,
  projectName: row.projectName,
  mapsUrl: row.mapsUrl,
  label: wibLabel(row.visit.startsAt),
});

async function readView(db: DbOrTx, where: SQL): Promise<VisitView | null> {
  const [row] = await selectViews(db).where(where).limit(1);
  return row ? toView(row) : null;
}

/** A visit with its sales agent and project; pass a transaction to see rows it has not committed yet. */
export function getVisitView(id: string, db: DbOrTx = getDb()): Promise<VisitView | null> {
  return readView(db, eq(visits.id, id));
}

/** The visit a lead still has coming up (scheduled, confirmed or awaiting confirmation), if any. */
export function activeVisitForLead(leadId: string, db: DbOrTx = getDb()): Promise<VisitView | null> {
  return readView(db, and(eq(visits.leadId, leadId), inArray(visits.status, [...ACTIVE_VISIT_STATUSES]))!);
}

/** The active visit of each lead that has one, keyed by lead id. */
export async function activeVisitsForLeads(leadIds: string[]): Promise<Map<string, VisitView>> {
  if (leadIds.length === 0) return new Map();
  const rows = await selectViews(getDb())
    .where(and(inArray(visits.leadId, leadIds), inArray(visits.status, [...ACTIVE_VISIT_STATUSES])))
    .orderBy(asc(visits.startsAt));
  const byLead = new Map<string, VisitView>();
  for (const row of rows) if (!byLead.has(row.visit.leadId)) byLead.set(row.visit.leadId, toView(row));
  return byLead;
}

/** Every visit of a lead, newest first. */
export async function listVisitViewsForLead(leadId: string): Promise<VisitView[]> {
  const rows = await selectViews(getDb()).where(eq(visits.leadId, leadId)).orderBy(desc(visits.startsAt), desc(visits.createdAt));
  return rows.map(toView);
}

/** Visits of any status starting in [from, to), chronological; test visits only with `includeTest`. */
export async function listVisitViews(f: { from: Date; to: Date; projectId?: number; salesAgentId?: string; includeTest?: boolean }): Promise<VisitView[]> {
  const rows = await selectViews(getDb())
    .where(
      and(
        gte(visits.startsAt, f.from),
        lt(visits.startsAt, f.to),
        f.projectId !== undefined ? eq(visits.projectId, f.projectId) : undefined,
        f.salesAgentId !== undefined ? eq(visits.salesAgentId, f.salesAgentId) : undefined,
        f.includeTest ? undefined : eq(visits.isTest, false)
      )
    )
    .orderBy(asc(visits.startsAt), asc(visits.createdAt));
  return rows.map(toView);
}

// ─── slots and assignment ──────────────────────────────────────────────────

/** The free slot that starts exactly at `startsAt`, if there is one. */
async function slotAt(
  projectId: number,
  startsAt: Date,
  now: Date,
  opts: { excludeVisitId?: string; ignoreNotice?: boolean } = {}
): Promise<Slot | undefined> {
  const date = wibDate(startsAt);
  const data = await loadSlotData(projectId, date, date, { excludeVisitId: opts.excludeVisitId });
  if (!data) return undefined;
  // The notice period protects the customer's booking, not a change of sales agent.
  const d = opts.ignoreNotice ? { ...data, project: { ...data.project, sameDayMinNoticeMinutes: 0 } } : data;
  return freeSlots(d, { from: date, to: date }, now).find((s) => s.startsAt.getTime() === startsAt.getTime());
}

/**
 * Fairest first: fewest non-test visits created in the last 7 days (not cancelled or replaced by a move), then the one
 * whose latest non-test visit was created longest ago (never assigned comes first), then by name.
 */
async function byFairness(agentIds: string[], now: Date): Promise<string[]> {
  if (agentIds.length === 0) return [];
  const since = new Date(now.getTime() - FAIRNESS_WINDOW_DAYS * DAY_MS);
  const rows = await getDb()
    .select({ id: salesAgents.id })
    .from(salesAgents)
    .leftJoin(visits, and(eq(visits.salesAgentId, salesAgents.id), eq(visits.isTest, false)))
    .where(inArray(salesAgents.id, agentIds))
    .groupBy(salesAgents.id)
    .orderBy(
      // A moved visit leaves a 'rescheduled' row behind its new row; count the visit once.
      sql`count(${visits.id}) filter (where ${notInArray(visits.status, ['cancelled', 'rescheduled'])} and ${gt(visits.createdAt, since)})`,
      sql`max(${visits.createdAt}) asc nulls first`,
      asc(salesAgents.name),
      asc(salesAgents.id)
    );
  return rows.map((r) => r.id);
}

/**
 * Locks the agent row, so a deactivation or coverage change (which takes FOR UPDATE) either
 * finishes before us or waits for our commit, then confirms the agent still takes visits for the
 * project. NO KEY UPDATE rather than SHARE also queues two writes for the same agent: with SHARE
 * both reach visits_no_overlap together and can deadlock, which Postgres takes a second to break.
 * It leaves foreign-key checks (KEY SHARE) unblocked.
 */
async function claimAgent(tx: Tx, agentId: string, projectId: number): Promise<boolean> {
  const [agent] = await tx.select({ active: salesAgents.active }).from(salesAgents).where(eq(salesAgents.id, agentId)).for('no key update');
  if (!agent?.active) return false;
  const [covers] = await tx
    .select({ id: salesAgentProjects.salesAgentId })
    .from(salesAgentProjects)
    .where(and(eq(salesAgentProjects.salesAgentId, agentId), eq(salesAgentProjects.projectId, projectId)))
    .limit(1);
  return !!covers;
}

type Written = { visit: Visit; change: VisitChange };
const SKIP = Symbol('skip');
const OVERLAP = '23P01';
// visits_no_overlap checks after inserting, so two overlapping inserts can each wait for the
// other and Postgres aborts one. claimAgent's lock keeps our own writes from doing that; this is
// the safety net for any other writer.
const DEADLOCK = '40P01';
const ATTEMPTS_PER_AGENT = 3;

/**
 * Tries the candidates in order, one transaction each, until a write commits. A candidate who is no
 * longer active or no longer covers the project is skipped, and so is one whose calendar the write
 * would overlap (23P01). After a deadlock the same candidate is tried again, since the surviving
 * transaction settles whether they are still free. `SLOT_TAKEN` when nobody is left.
 */
async function writeWithFirstFree(
  agentIds: string[],
  projectId: number,
  write: (tx: Tx, agentId: string) => Promise<Written | VisitError>
): Promise<Written | VisitError> {
  for (const agentId of agentIds) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_AGENT; attempt++) {
      try {
        const result = await getDb().transaction(async (tx) => ((await claimAgent(tx, agentId, projectId)) ? write(tx, agentId) : SKIP));
        if (result !== SKIP) return result;
      } catch (err) {
        const code = pgCode(err);
        if (code === DEADLOCK) continue;
        // visits_one_active_per_lead: the lead booked another visit meanwhile.
        if (code === '23505') return 'HAS_ACTIVE_VISIT';
        if (code !== OVERLAP) throw err;
      }
      break;
    }
  }
  return 'SLOT_TAKEN';
}

/** Locks the visit row; the visit must still be active. */
async function lockActiveVisit(tx: Tx, visitId: string): Promise<Visit | VisitError> {
  const [visit] = await tx.select().from(visits).where(eq(visits.id, visitId)).for('update');
  if (!visit) return 'NOT_FOUND';
  return isActive(visit.status) ? visit : 'NOT_ACTIVE';
}

async function getVisit(visitId: string): Promise<Visit | null> {
  const [visit] = await getDb().select().from(visits).where(eq(visits.id, visitId)).limit(1);
  return visit ?? null;
}

/**
 * Withdraws the visit's alerts still waiting to go out (held for template approval, say), so a
 * moved or cancelled visit is never announced later with a stale time or agent. Call before
 * queueSalesAlerts: on a reassignment the visit id stays and the new alerts must not dedupe away.
 */
async function withdrawSalesAlerts(tx: Tx, visitId: string): Promise<void> {
  await cancelPending(tx, { visitId, kinds: ['sales_alert'] });
}

async function assignLead(leadId: string, salesAgentId: string): Promise<void> {
  await getDb().update(leads).set({ assignedSalesId: salesAgentId, updatedAt: new Date() }).where(eq(leads.id, leadId));
}

async function success(written: Written): Promise<Extract<VisitResult, { ok: true }>> {
  const view = await getVisitView(written.visit.id);
  if (!view) throw new Error(`Visit ${written.visit.id} disappeared after commit`);
  return { ok: true, visit: view, change: written.change };
}

// ─── lifecycle ─────────────────────────────────────────────────────────────

export async function bookVisit(
  input: { leadId: string; projectId: number; startsAt: Date; typeInterest: number[]; topics: string | null; actor: string; isTest: boolean },
  now: Date
): Promise<VisitResult> {
  if (await activeVisitForLead(input.leadId)) return fail('HAS_ACTIVE_VISIT');
  const slot = await slotAt(input.projectId, input.startsAt, now);
  if (!slot) return fail('SLOT_NOT_FREE');

  const written = await writeWithFirstFree(await byFairness(slot.freeAgentIds, now), input.projectId, async (tx, agentId) => {
    const [visit] = await tx
      .insert(visits)
      .values({
        leadId: input.leadId,
        projectId: input.projectId,
        salesAgentId: agentId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: 'scheduled',
        typeInterest: input.typeInterest,
        topics: input.topics,
        isTest: input.isTest,
        createdBy: input.actor,
      })
      .returning();
    const change: VisitChange = { kind: 'booked', visit: visit!, previous: null };
    await queueSalesAlerts(tx, change, now);
    return { visit: visit!, change };
  });
  if (typeof written === 'string') return fail(written);

  const result = await success(written);
  const { visit } = result;
  await assignLead(visit.leadId, visit.salesAgentId);
  await setLeadStage(visit.leadId, 'visit_scheduled', input.actor, { force: true });
  await recordEvent(
    visit.leadId,
    'visit_booked',
    { visitId: visit.id, startsAt: visit.startsAt.toISOString(), salesAgentId: visit.salesAgentId, salesName: visit.salesName },
    input.actor
  );
  return result;
}

export async function rescheduleVisit(input: { visitId: string; startsAt: Date; actor: string }, now: Date): Promise<VisitResult> {
  const current = await getVisit(input.visitId);
  if (!current) return fail('NOT_FOUND');
  if (!isActive(current.status)) return fail('NOT_ACTIVE');
  const slot = await slotAt(current.projectId, input.startsAt, now, { excludeVisitId: current.id });
  if (!slot) return fail('SLOT_NOT_FREE');

  // Keep the agent the customer already has when they are free; the others stay as fallbacks.
  const fair = await byFairness(slot.freeAgentIds, now);
  const candidates = fair.includes(current.salesAgentId) ? [current.salesAgentId, ...fair.filter((id) => id !== current.salesAgentId)] : fair;

  const written = await writeWithFirstFree(candidates, current.projectId, async (tx, agentId) => {
    const previous = await lockActiveVisit(tx, current.id);
    if (typeof previous === 'string') return previous;
    // Mark the old row first: a move within the same agent's calendar must not overlap itself.
    await tx.update(visits).set({ status: 'rescheduled', updatedAt: new Date() }).where(eq(visits.id, previous.id));
    const [visit] = await tx
      .insert(visits)
      .values({
        leadId: previous.leadId,
        projectId: previous.projectId,
        salesAgentId: agentId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: 'scheduled',
        typeInterest: previous.typeInterest,
        topics: previous.topics,
        isTest: previous.isTest,
        createdBy: input.actor,
        rescheduledFrom: previous.id,
      })
      .returning();
    const change: VisitChange = { kind: 'rescheduled', visit: visit!, previous };
    await withdrawSalesAlerts(tx, previous.id);
    await queueSalesAlerts(tx, change, now);
    return { visit: visit!, change };
  });
  if (typeof written === 'string') return fail(written);

  const result = await success(written);
  const { visit } = result;
  await assignLead(visit.leadId, visit.salesAgentId);
  await setLeadStage(visit.leadId, 'visit_scheduled', input.actor, { force: true });
  await recordEvent(
    visit.leadId,
    'visit_rescheduled',
    { visitId: visit.id, from: written.change.previous!.startsAt.toISOString(), to: visit.startsAt.toISOString() },
    input.actor
  );
  return result;
}

export async function cancelVisit(input: { visitId: string; reason: string; actor: string }, now: Date): Promise<VisitResult> {
  const written = await getDb().transaction(async (tx): Promise<Written | VisitError> => {
    const previous = await lockActiveVisit(tx, input.visitId);
    if (typeof previous === 'string') return previous;
    const [visit] = await tx
      .update(visits)
      .set({ status: 'cancelled', cancelReason: input.reason, updatedAt: new Date() })
      .where(eq(visits.id, previous.id))
      .returning();
    const change: VisitChange = { kind: 'cancelled', visit: visit!, previous };
    await withdrawSalesAlerts(tx, previous.id);
    await queueSalesAlerts(tx, change, now);
    return { visit: visit!, change };
  });
  if (typeof written === 'string') return fail(written);

  const { leadId } = written.visit;
  await setLeadStage(leadId, 'cancelled', input.actor, { force: true });
  await recordEvent(leadId, 'visit_cancelled', { visitId: written.visit.id, reason: input.reason }, input.actor);
  return success(written);
}

export async function reassignVisit(input: { visitId: string; salesAgentId: string; actor: string }, now: Date): Promise<VisitResult> {
  const current = await getVisit(input.visitId);
  if (!current) return fail('NOT_FOUND');
  if (!isActive(current.status)) return fail('NOT_ACTIVE');
  // The visit's own agent always looks free here (the visit is excluded from busy), but it is no move.
  if (input.salesAgentId === current.salesAgentId) return fail('AGENT_NOT_FREE');
  // loadSlotData lists only active agents who cover the project, so this checks all three.
  const slot = await slotAt(current.projectId, current.startsAt, now, { excludeVisitId: current.id, ignoreNotice: true });
  if (!slot?.freeAgentIds.includes(input.salesAgentId)) return fail('AGENT_NOT_FREE');

  const written = await writeWithFirstFree([input.salesAgentId], current.projectId, async (tx, agentId) => {
    const previous = await lockActiveVisit(tx, current.id);
    if (typeof previous === 'string') return previous;
    const [visit] = await tx.update(visits).set({ salesAgentId: agentId, updatedAt: new Date() }).where(eq(visits.id, previous.id)).returning();
    const change: VisitChange = { kind: 'reassigned', visit: visit!, previous };
    await withdrawSalesAlerts(tx, previous.id);
    await queueSalesAlerts(tx, change, now);
    return { visit: visit!, change };
  });
  if (written === 'SLOT_TAKEN') return fail('AGENT_NOT_FREE');
  if (typeof written === 'string') return fail(written);

  const result = await success(written);
  const { visit } = result;
  await assignLead(visit.leadId, visit.salesAgentId);
  await recordEvent(
    visit.leadId,
    'visit_reassigned',
    { visitId: visit.id, from: written.change.previous!.salesAgentId, to: visit.salesAgentId, salesName: visit.salesName },
    input.actor
  );
  return result;
}

export async function markOutcome(input: { visitId: string; outcome: 'visited' | 'no_show'; actor: string }, now: Date): Promise<VisitResult> {
  const written = await getDb().transaction(async (tx): Promise<Written | VisitError> => {
    const previous = await lockActiveVisit(tx, input.visitId);
    if (typeof previous === 'string') return previous;
    if (now < previous.startsAt) return 'TOO_EARLY';
    const [visit] = await tx.update(visits).set({ status: input.outcome, updatedAt: new Date() }).where(eq(visits.id, previous.id)).returning();
    return { visit: visit!, change: { kind: 'outcome', visit: visit!, previous } };
  });
  if (typeof written === 'string') return fail(written);

  const { leadId } = written.visit;
  await setLeadStage(leadId, input.outcome, input.actor, { force: true });
  await recordEvent(leadId, 'visit_outcome', { visitId: written.visit.id, outcome: input.outcome }, input.actor);
  return success(written);
}
