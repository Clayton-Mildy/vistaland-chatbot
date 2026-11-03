import webpush from 'web-push';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { pushSubscriptions, staffUsers } from '../db/schema/index.js';

export type PushNote = { title: string; body: string; url: string };
export type Notifier = { send(staffUserIds: string[], note: PushNote): Promise<void> };

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

const TTL_SECONDS = 3600;
// web-push sets no timeout unless given one, and alerts are awaited on Moni's hot paths.
const PUSH_TIMEOUT_MS = 10_000;

/** Saves a browser's subscription for a staff member; the same endpoint moves to whoever signed in last. */
export async function saveSubscription(staffUserId: string, s: PushSubscriptionInput): Promise<void> {
  await getDb()
    .insert(pushSubscriptions)
    .values({ staffUserId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { staffUserId, p256dh: s.keys.p256dh, auth: s.keys.auth },
    });
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  await getDb().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

const statusOf = (err: unknown): number | null => {
  const code = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === 'number' ? code : null;
};

/** Pushes to every browser each listed active staff member has subscribed. Never throws. */
export function createWebPushNotifier(cfg: {
  publicKey: string;
  privateKey: string;
  subject: string;
  sendNotification?: typeof webpush.sendNotification;
}): Notifier {
  const sendNotification = cfg.sendNotification ?? webpush.sendNotification;
  const vapidDetails = { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey };

  return {
    async send(staffUserIds, note) {
      if (staffUserIds.length === 0) return;
      const subs = await getDb()
        .select({ endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
        .from(pushSubscriptions)
        .innerJoin(staffUsers, eq(staffUsers.id, pushSubscriptions.staffUserId))
        .where(and(inArray(pushSubscriptions.staffUserId, staffUserIds), eq(staffUsers.isActive, true)));
      const payload = JSON.stringify(note);
      await Promise.all(
        subs.map(async (s) => {
          try {
            await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: TTL_SECONDS, vapidDetails, timeout: PUSH_TIMEOUT_MS });
          } catch (err) {
            const status = statusOf(err);
            // The browser dropped the subscription; it will never work again.
            if (status === 404 || status === 410) await deleteSubscription(s.endpoint).catch(() => undefined);
            else console.error(`[push] send failed (${status ?? 'no status'}):`, err instanceof Error ? err.message : err);
          }
        })
      );
    },
  };
}
