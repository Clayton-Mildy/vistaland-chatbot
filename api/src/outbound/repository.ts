import { and, asc, count, eq, gte, inArray, lte } from 'drizzle-orm';
import { getDb, type Db } from '../db/client.js';
import { scheduledMessages } from '../db/schema/index.js';
import { templateParam } from './templateParams.js';

export type OutboundKind = 'sales_alert' | 'reassign_notice' | 'h1_reminder' | 'followup' | 'waiting_notice';

// Everything but the alert to our own sales agent goes to a customer, so opting out stops it.
export const CUSTOMER_KINDS: OutboundKind[] = ['reassign_notice', 'h1_reminder', 'followup', 'waiting_notice'];

export type NewOutbound = {
  kind: OutboundKind;
  dedupeKey: string;
  toPhone: string;
  leadId: string | null;
  visitId: string | null;
  params: string[];
  dueAt: Date;
};

export type OutboundRow = typeof scheduledMessages.$inferSelect;

/** The database handle, or a transaction handle, so producers can queue inside their own transaction. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

const MAX_ATTEMPTS = 3;
// Wait before the next try, indexed by attempts so far minus one.
const RETRY_MINUTES = [1, 5];
const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;

/** Queues rows; one whose dedupe key is already pending or sent is skipped. Returns how many were queued. */
export async function enqueue(db: DbOrTx, rows: NewOutbound[]): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(scheduledMessages)
    .values(rows.map((r) => ({ ...r, params: r.params.map((p) => templateParam(p)) })))
    .onConflictDoNothing()
    .returning({ id: scheduledMessages.id });
  return inserted.length;
}

export async function cancelPending(
  db: DbOrTx,
  where: { visitId?: string; leadId?: string; kinds: OutboundKind[] }
): Promise<number> {
  const cancelled = await db
    .update(scheduledMessages)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(scheduledMessages.status, 'pending'),
        inArray(scheduledMessages.kind, where.kinds),
        where.visitId ? eq(scheduledMessages.visitId, where.visitId) : undefined,
        where.leadId ? eq(scheduledMessages.leadId, where.leadId) : undefined
      )
    )
    .returning({ id: scheduledMessages.id });
  return cancelled.length;
}

export async function dueRows(now: Date, limit: number): Promise<OutboundRow[]> {
  return getDb()
    .select()
    .from(scheduledMessages)
    .where(and(eq(scheduledMessages.status, 'pending'), lte(scheduledMessages.dueAt, now)))
    .orderBy(asc(scheduledMessages.dueAt), asc(scheduledMessages.id))
    .limit(limit);
}

export async function markSent(id: number, waMessageId: string | null, now: Date): Promise<void> {
  await getDb().update(scheduledMessages).set({ status: 'sent', sentAt: now, waMessageId }).where(eq(scheduledMessages.id, id));
}

export async function markCancelled(id: number, reason?: string): Promise<void> {
  await getDb()
    .update(scheduledMessages)
    .set({ status: 'cancelled', ...(reason ? { lastError: reason } : {}) })
    .where(eq(scheduledMessages.id, id));
}

/** Counts a failed try. The third one fails the row for good; before that it is retried later. */
export async function markAttemptFailed(id: number, error: string, now: Date): Promise<OutboundRow> {
  const [row] = await getDb()
    .select({ attempts: scheduledMessages.attempts })
    .from(scheduledMessages)
    .where(eq(scheduledMessages.id, id));
  if (!row) throw new Error(`Outbound row ${id} not found`);
  const attempts = row.attempts + 1;
  const retryAt = new Date(now.getTime() + (RETRY_MINUTES[attempts - 1] ?? 0) * MIN_MS);
  const [updated] = await getDb()
    .update(scheduledMessages)
    .set({
      attempts,
      lastError: error,
      ...(attempts >= MAX_ATTEMPTS ? { status: 'failed' as const } : { dueAt: retryAt }),
    })
    .where(eq(scheduledMessages.id, id))
    .returning();
  return updated!;
}

/** What the dashboard warns about: rows stuck unsent for over 5 minutes, and recent failures. */
export async function outboundSummary(now: Date): Promise<{ held: number; failed: number }> {
  const [held] = await getDb()
    .select({ n: count() })
    .from(scheduledMessages)
    .where(and(eq(scheduledMessages.status, 'pending'), lte(scheduledMessages.dueAt, new Date(now.getTime() - 5 * MIN_MS))));
  const [failed] = await getDb()
    .select({ n: count() })
    .from(scheduledMessages)
    .where(and(eq(scheduledMessages.status, 'failed'), gte(scheduledMessages.createdAt, new Date(now.getTime() - 7 * DAY_MS))));
  return { held: held?.n ?? 0, failed: failed?.n ?? 0 };
}
