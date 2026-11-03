import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { pgCode } from '../db/pgError.js';
import { salesAgentProjects, salesAgents, salesAvailability, salesTimeOff, staffUsers, visits } from '../db/schema/index.js';

export type SalesAgent = typeof salesAgents.$inferSelect;
export type AvailabilityRow = { projectId: number; weekday: number; start: string; end: string };
export type TimeOffRow = { id: number; startsAt: Date; endsAt: Date; reason: string | null };
export type RosterAgent = SalesAgent & {
  projectIds: number[];
  availability: AvailabilityRow[];
  // Only rows that end after now.
  timeOff: TimeOffRow[];
  staffEmail: string | null;
};

export type RosterErrorCode = 'INVALID_PHONE' | 'PHONE_TAKEN' | 'STAFF_LINKED' | 'PROJECT_NOT_COVERED' | 'HAS_UPCOMING_VISITS';

export class RosterError extends Error {
  constructor(
    public code: RosterErrorCode,
    public count?: number
  ) {
    super(code);
    this.name = 'RosterError';
  }
}

export const ACTIVE_VISIT_STATUSES = ['scheduled', 'confirmed', 'awaiting_confirmation'] as const;

/** "0812-3456-7890" and "+62 812 3456 7890" both become "6281234567890"; null when it is not a WhatsApp number. */
export function normalizeWaPhone(input: string): string | null {
  let digits = input.replace(/[\s\-.()[\]]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  return /^62\d{8,13}$/.test(digits) ? digits : null;
}

function phoneOrThrow(input: string): string {
  const phone = normalizeWaPhone(input);
  if (!phone) throw new RosterError('INVALID_PHONE');
  return phone;
}

/** Turns a unique violation on wa_phone or staff_user_id into the matching RosterError. */
function translateUnique(err: unknown): never {
  if (pgCode(err) === '23505') {
    const e = err as { constraint?: string; cause?: { constraint?: string } };
    const constraint = e.cause?.constraint ?? e.constraint ?? '';
    if (constraint.includes('wa_phone')) throw new RosterError('PHONE_TAKEN');
    if (constraint.includes('staff_user_id')) throw new RosterError('STAFF_LINKED');
  }
  throw err;
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

async function upcomingVisitCount(tx: Tx, agentId: string, projectIds?: number[]): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(visits)
    .where(
      and(
        eq(visits.salesAgentId, agentId),
        inArray(visits.status, [...ACTIVE_VISIT_STATUSES]),
        eq(visits.isTest, false),
        gt(visits.startsAt, new Date()),
        projectIds ? inArray(visits.projectId, projectIds) : undefined
      )
    );
  return rows[0]?.n ?? 0;
}

export async function getAgent(id: string): Promise<SalesAgent | null> {
  const [row] = await getDb().select().from(salesAgents).where(eq(salesAgents.id, id)).limit(1);
  return row ?? null;
}

export async function agentForStaff(staffUserId: string): Promise<SalesAgent | null> {
  const [row] = await getDb().select().from(salesAgents).where(eq(salesAgents.staffUserId, staffUserId)).limit(1);
  return row ?? null;
}

export async function listRoster(): Promise<RosterAgent[]> {
  const db = getDb();
  const agents = await db
    .select({ agent: salesAgents, staffEmail: staffUsers.email })
    .from(salesAgents)
    .leftJoin(staffUsers, eq(staffUsers.id, salesAgents.staffUserId))
    .orderBy(asc(salesAgents.name), asc(salesAgents.createdAt));
  const [coverage, hours, timeOff] = await Promise.all([
    db.select().from(salesAgentProjects).orderBy(asc(salesAgentProjects.projectId)),
    db
      .select()
      .from(salesAvailability)
      .orderBy(asc(salesAvailability.projectId), asc(salesAvailability.weekday), asc(salesAvailability.startTime)),
    db.select().from(salesTimeOff).where(gt(salesTimeOff.endsAt, new Date())).orderBy(asc(salesTimeOff.startsAt)),
  ]);
  return agents.map(({ agent, staffEmail }) => ({
    ...agent,
    staffEmail: staffEmail ?? null,
    projectIds: coverage.filter((c) => c.salesAgentId === agent.id).map((c) => c.projectId),
    availability: hours
      .filter((h) => h.salesAgentId === agent.id)
      .map((h) => ({ projectId: h.projectId, weekday: h.weekday, start: h.startTime, end: h.endTime })),
    timeOff: timeOff
      .filter((t) => t.salesAgentId === agent.id)
      .map((t) => ({ id: t.id, startsAt: t.startsAt, endsAt: t.endsAt, reason: t.reason })),
  }));
}

export async function createAgent(input: {
  name: string;
  waPhone: string;
  staffUserId: string | null;
  projectIds: number[];
}): Promise<SalesAgent> {
  const waPhone = phoneOrThrow(input.waPhone);
  const projectIds = [...new Set(input.projectIds)];
  try {
    return await getDb().transaction(async (tx) => {
      const [agent] = await tx.insert(salesAgents).values({ name: input.name, waPhone, staffUserId: input.staffUserId }).returning();
      if (!agent) throw new Error('Failed to create sales agent');
      if (projectIds.length > 0) {
        await tx.insert(salesAgentProjects).values(projectIds.map((projectId) => ({ salesAgentId: agent.id, projectId })));
      }
      return agent;
    });
  } catch (err) {
    return translateUnique(err);
  }
}

export async function updateAgent(
  id: string,
  patch: { name?: string; waPhone?: string; staffUserId?: string | null; active?: boolean; projectIds?: number[] }
): Promise<SalesAgent | null> {
  const set: Partial<typeof salesAgents.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.waPhone !== undefined) set.waPhone = phoneOrThrow(patch.waPhone);
  if (patch.staffUserId !== undefined) set.staffUserId = patch.staffUserId;
  if (patch.active !== undefined) set.active = patch.active;

  try {
    return await getDb().transaction(async (tx) => {
      // Lock the agent row before checking, so a booking (which takes FOR SHARE on it) cannot slip
      // in between the visit count and our write.
      const [current] = await tx.select().from(salesAgents).where(eq(salesAgents.id, id)).limit(1).for('update');
      if (!current) return null;

      if (patch.active === false) {
        const count = await upcomingVisitCount(tx, id);
        if (count > 0) throw new RosterError('HAS_UPCOMING_VISITS', count);
      }

      if (patch.projectIds) {
        const wanted = [...new Set(patch.projectIds)];
        const covered = (await tx.select().from(salesAgentProjects).where(eq(salesAgentProjects.salesAgentId, id))).map((r) => r.projectId);
        const removed = covered.filter((p) => !wanted.includes(p));
        if (removed.length > 0) {
          const count = await upcomingVisitCount(tx, id, removed);
          if (count > 0) throw new RosterError('HAS_UPCOMING_VISITS', count);
          await tx.delete(salesAgentProjects).where(and(eq(salesAgentProjects.salesAgentId, id), inArray(salesAgentProjects.projectId, removed)));
          // Hours for a project the agent no longer covers would be orphaned.
          await tx.delete(salesAvailability).where(and(eq(salesAvailability.salesAgentId, id), inArray(salesAvailability.projectId, removed)));
        }
        const added = wanted.filter((p) => !covered.includes(p));
        if (added.length > 0) await tx.insert(salesAgentProjects).values(added.map((projectId) => ({ salesAgentId: id, projectId })));
      }

      if (Object.keys(set).length === 0) return current;
      const [row] = await tx.update(salesAgents).set(set).where(eq(salesAgents.id, id)).returning();
      return row ?? null;
    });
  } catch (err) {
    return translateUnique(err);
  }
}

/** Replaces all of the agent's weekly hours. Every row's project must be one the agent covers. */
export async function setAvailability(agentId: string, rows: AvailabilityRow[]): Promise<void> {
  await getDb().transaction(async (tx) => {
    // Serialises with other hours and coverage changes for this agent: no duplicate rows, no orphans.
    await tx.select({ id: salesAgents.id }).from(salesAgents).where(eq(salesAgents.id, agentId)).for('update');
    const covered = (await tx.select().from(salesAgentProjects).where(eq(salesAgentProjects.salesAgentId, agentId))).map((r) => r.projectId);
    if (rows.some((r) => !covered.includes(r.projectId))) throw new RosterError('PROJECT_NOT_COVERED');
    await tx.delete(salesAvailability).where(eq(salesAvailability.salesAgentId, agentId));
    if (rows.length > 0) {
      await tx.insert(salesAvailability).values(
        rows.map((r) => ({ salesAgentId: agentId, projectId: r.projectId, weekday: r.weekday, startTime: r.start, endTime: r.end }))
      );
    }
  });
}

export async function addTimeOff(agentId: string, t: { startsAt: Date; endsAt: Date; reason: string | null }): Promise<TimeOffRow> {
  const [row] = await getDb()
    .insert(salesTimeOff)
    .values({ salesAgentId: agentId, startsAt: t.startsAt, endsAt: t.endsAt, reason: t.reason })
    .returning();
  if (!row) throw new Error('Failed to add time off');
  return { id: row.id, startsAt: row.startsAt, endsAt: row.endsAt, reason: row.reason };
}

export async function deleteTimeOff(id: number): Promise<boolean> {
  const rows = await getDb().delete(salesTimeOff).where(eq(salesTimeOff.id, id)).returning({ id: salesTimeOff.id });
  return rows.length > 0;
}
