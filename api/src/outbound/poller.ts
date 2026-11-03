import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { contacts, conversations, leads, visits } from '../db/schema/index.js';
import { getAppSettings, type AppSettings, type TemplateRef } from '../settings/appSettings.js';
import type { ChakraClient } from '../chakra/client.js';
import { CUSTOMER_KINDS, dueRows, markAttemptFailed, markCancelled, markSent, type OutboundRow } from './repository.js';
import { SALES_ALERT_LABEL } from './salesAlert.js';

const PASS_LIMIT = 50;
// A sales alert held this long (say, until the template was approved) is no longer news.
const SALES_ALERT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type OutboundPollerDeps = {
  chakra: ChakraClient | null;
  now: () => Date;
  // Called once, when a row has used its last attempt.
  onFailed?: (row: OutboundRow) => Promise<void>;
  // How a sent row is recorded; tests replace it to simulate the database failing at that moment.
  markSent?: typeof markSent;
};

export type OutboundPass = { sent: number; held: number; failed: number };

// Customer-facing kinds other than the reassignment notice have no template until Milestone 4.
function templateFor(kind: OutboundRow['kind'], s: AppSettings): TemplateRef | null {
  if (kind === 'sales_alert') return s.salesAlertTemplate;
  if (kind === 'reassign_notice') return s.reassignNoticeTemplate;
  return null;
}

async function leadContext(leadId: string | null): Promise<{ optedOut: boolean; phoneNumberId: string | null }> {
  if (!leadId) return { optedOut: false, phoneNumberId: null };
  const [r] = await getDb()
    .select({ optedOutAt: contacts.optedOutAt, phoneNumberId: conversations.waPhoneNumberId })
    .from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .leftJoin(conversations, eq(conversations.contactId, contacts.id))
    .where(eq(leads.id, leadId));
  return { optedOut: r?.optedOutAt != null, phoneNumberId: r?.phoneNumberId ?? null };
}

/**
 * A sales alert queued over a day ago must not go out, nor one for a visit that has already started.
 * A cancel alert is the exception to the second rule: a visit cancelled after its start time still
 * has to reach the sales person, who may be waiting at the gallery.
 */
async function staleSalesAlert(row: OutboundRow, now: Date): Promise<boolean> {
  if (row.kind !== 'sales_alert') return false;
  if (now.getTime() - row.createdAt.getTime() > SALES_ALERT_MAX_AGE_MS) return true;
  if (row.params[1] === SALES_ALERT_LABEL.cancelled) return false;
  if (!row.visitId) return false;
  const [v] = await getDb().select({ startsAt: visits.startsAt }).from(visits).where(eq(visits.id, row.visitId));
  return v != null && v.startsAt.getTime() <= now.getTime();
}

export function createOutboundPoller(deps: OutboundPollerDeps): {
  runOnce(): Promise<OutboundPass>;
  start(intervalMs: number): () => void;
} {
  const record = deps.markSent ?? markSent;
  // Rows WhatsApp accepted but whose "sent" mark could not be saved. They must never be sent again;
  // the next pass only retries the mark.
  const unrecorded = new Map<number, string | null>();
  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  async function handle(row: OutboundRow, settings: AppSettings, now: Date, pass: OutboundPass): Promise<void> {
    if (unrecorded.has(row.id)) {
      await record(row.id, unrecorded.get(row.id)!, now);
      unrecorded.delete(row.id);
      return;
    }
    const ctx = await leadContext(row.leadId);
    if (CUSTOMER_KINDS.includes(row.kind) && ctx.optedOut) {
      await markCancelled(row.id);
      return;
    }
    if (await staleSalesAlert(row, now)) {
      await markCancelled(row.id, 'stale');
      return;
    }
    const template = templateFor(row.kind, settings);
    const phoneNumberId = settings.chakraPhoneNumberId || ctx.phoneNumberId;
    // Held rows stay pending and go out on the first pass after the setup is complete.
    if (!template?.name || !phoneNumberId || !deps.chakra) {
      pass.held++;
      return;
    }
    let waMessageId: string | null;
    try {
      ({ waMessageId } = await deps.chakra.sendTemplate(phoneNumberId, row.toPhone, {
        name: template.name,
        language: template.language,
        params: row.params,
      }));
    } catch (err) {
      const updated = await markAttemptFailed(row.id, errText(err), now);
      if (updated.status === 'failed') {
        pass.failed++;
        await deps.onFailed?.(updated).catch((e) => console.error('[outbound] onFailed crashed:', errText(e)));
      }
      return;
    }
    // Sent. A failure to save that is not a send failure: resending would message the person twice.
    pass.sent++;
    try {
      await record(row.id, waMessageId, now);
    } catch (err) {
      unrecorded.set(row.id, waMessageId);
      console.error(`[outbound] row ${row.id} was sent (${waMessageId ?? 'no wamid'}) but not marked sent:`, errText(err));
    }
  }

  const poller = {
    async runOnce(): Promise<OutboundPass> {
      const now = deps.now();
      const settings = await getAppSettings();
      const pass: OutboundPass = { sent: 0, held: 0, failed: 0 };
      for (const row of await dueRows(now, PASS_LIMIT)) {
        // One row's error must not stop the others; it is retried on the next pass.
        try {
          await handle(row, settings, now, pass);
        } catch (err) {
          console.error(`[outbound] row ${row.id} crashed:`, errText(err));
        }
      }
      return pass;
    },

    /** Runs a pass now, then one every intervalMs; a pass still running skips the tick. Returns a stop function. */
    start(intervalMs: number): () => void {
      let running = false;
      const tick = async () => {
        if (running) return;
        running = true;
        try {
          const r = await poller.runOnce();
          if (r.sent || r.failed) console.log(`[outbound] sent ${r.sent}, failed ${r.failed}, held ${r.held}`);
        } catch (err) {
          console.error('[outbound] pass crashed:', err instanceof Error ? err.message : err);
        } finally {
          running = false;
        }
      };
      void tick();
      const timer = setInterval(() => void tick(), intervalMs);
      return () => clearInterval(timer);
    },
  };
  return poller;
}
