import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { projects, salesAgents, visits } from '../db/schema/index.js';
import type { DbOrTx } from '../outbound/repository.js';
import { ACTIVE_VISIT_STATUSES } from './roster.js';
import { wibLabel } from './time.js';

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

async function readView(db: DbOrTx, where: ReturnType<typeof eq>): Promise<VisitView | null> {
  const [row] = await db
    .select({
      visit: visits,
      salesName: salesAgents.name,
      salesPhone: salesAgents.waPhone,
      projectName: projects.displayName,
      mapsUrl: projects.mapsUrl,
    })
    .from(visits)
    .innerJoin(salesAgents, eq(salesAgents.id, visits.salesAgentId))
    .innerJoin(projects, eq(projects.id, visits.projectId))
    .where(where)
    .limit(1);
  if (!row) return null;
  return { ...row.visit, salesName: row.salesName, salesPhone: row.salesPhone, projectName: row.projectName, mapsUrl: row.mapsUrl, label: wibLabel(row.visit.startsAt) };
}

/** A visit with its sales agent and project; pass a transaction to see rows it has not committed yet. */
export function getVisitView(id: string, db: DbOrTx = getDb()): Promise<VisitView | null> {
  return readView(db, eq(visits.id, id));
}

/** The visit a lead still has coming up (scheduled, confirmed or awaiting confirmation), if any. */
export function activeVisitForLead(leadId: string, db: DbOrTx = getDb()): Promise<VisitView | null> {
  return readView(db, and(eq(visits.leadId, leadId), inArray(visits.status, [...ACTIVE_VISIT_STATUSES]))!);
}
