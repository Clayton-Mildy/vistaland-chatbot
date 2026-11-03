import { it, expect, beforeEach, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { truncate } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { getDb } from '../src/db/client.js';
import { scheduledMessages } from '../src/db/schema/index.js';
import { ensureConversation, ensureLead, optOut, upsertContact } from '../src/leads/repository.js';
import { updateAppSettings } from '../src/settings/appSettings.js';
import { cancelPending, dueRows, enqueue, markAttemptFailed, markSent, outboundSummary, type NewOutbound } from '../src/outbound/repository.js';
import { templateParam } from '../src/outbound/templateParams.js';
import { createOutboundPoller } from '../src/outbound/poller.js';
import type { ChakraClient } from '../src/chakra/client.js';

const auth = { authorization: 'Bearer test-secret-test-secret-test-secret-00' };
const MIN = 60_000;
const T0 = new Date('2026-11-02T03:00:00Z');
let contactId: string;
let leadId: string;

beforeEach(async () => {
  await truncate('contacts', 'scheduled_messages', 'app_settings');
  const c = await upsertContact('6281234567890', 'Sari');
  contactId = c.id;
  await ensureConversation(c.id, 'PNID-CONV');
  leadId = (await ensureLead(c.id)).id;
});

const row = (o: Partial<NewOutbound> = {}): NewOutbound => ({
  kind: 'sales_alert',
  dedupeKey: 'k1',
  toPhone: '6281999000111',
  leadId,
  visitId: null,
  params: ['Rina', 'Zetira'],
  dueAt: T0,
  ...o,
});

const all = () => getDb().select().from(scheduledMessages).orderBy(scheduledMessages.id);

function fakeChakra(fail = false) {
  const sent: { pnid: string; to: string; t: { name: string; language: string; params: string[] } }[] = [];
  const chakra: ChakraClient = {
    sendText: async () => ({ waMessageId: null }),
    sendMedia: async () => ({ waMessageId: null }),
    findChatId: async () => null,
    listChatMessages: async () => [],
    sendTemplate: async (pnid, to, t) => {
      sent.push({ pnid, to, t });
      if (fail) throw new Error('chakra down');
      return { waMessageId: 'wamid.OUT1' };
    },
  };
  return { chakra, sent };
}

it('templateParam flattens whitespace and clips to 500', () => {
  expect(templateParam('a\n\nb\t c     d')).toBe('a b c d');
  expect(templateParam('x'.repeat(600))).toHaveLength(500);
  expect(templateParam('x'.repeat(600)).endsWith('…')).toBe(true);
});

it('enqueue ignores a duplicate dedupe key and cleans the params', async () => {
  expect(await enqueue(getDb(), [row({ params: ['a\nb', 'c'] })])).toBe(1);
  expect(await enqueue(getDb(), [row(), row({ dedupeKey: 'k2' })])).toBe(1);
  const rows = await all();
  expect(rows.map((r) => r.dedupeKey)).toEqual(['k1', 'k2']);
  expect(rows[0]!.params).toEqual(['a b', 'c']);
  expect(await enqueue(getDb(), [])).toBe(0);
});

it('cancelPending cancels only pending rows of the given kinds for the visit or lead', async () => {
  await enqueue(getDb(), [
    row({ kind: 'h1_reminder', dedupeKey: 'a' }),
    row({ kind: 'followup', dedupeKey: 'b' }),
    row({ kind: 'sales_alert', dedupeKey: 'c' }),
  ]);
  expect(await cancelPending(getDb(), { leadId, kinds: ['h1_reminder', 'sales_alert'] })).toBe(2);
  expect((await all()).map((r) => r.status)).toEqual(['cancelled', 'pending', 'cancelled']);
});

it('dueRows returns pending rows due by now, oldest first', async () => {
  await enqueue(getDb(), [
    row({ dedupeKey: 'late', dueAt: new Date(T0.getTime() + 10 * MIN) }),
    row({ dedupeKey: 'b', dueAt: new Date(T0.getTime() - MIN) }),
    row({ dedupeKey: 'a', dueAt: new Date(T0.getTime() - 2 * MIN) }),
  ]);
  expect((await dueRows(T0, 10)).map((r) => r.dedupeKey)).toEqual(['a', 'b']);
  expect(await dueRows(T0, 1)).toHaveLength(1);
});

it('outboundSummary counts rows held over 5 minutes and recent failures', async () => {
  await enqueue(getDb(), [
    row({ dedupeKey: 'fresh', dueAt: new Date(T0.getTime() - 2 * MIN) }),
    row({ dedupeKey: 'held', dueAt: new Date(T0.getTime() - 6 * MIN) }),
    row({ dedupeKey: 'bad' }),
    row({ dedupeKey: 'old-bad' }),
  ]);
  await getDb().update(scheduledMessages).set({ status: 'failed' }).where(eq(scheduledMessages.dedupeKey, 'bad'));
  await getDb()
    .update(scheduledMessages)
    .set({ status: 'failed', createdAt: new Date(T0.getTime() - 8 * 24 * 60 * MIN) })
    .where(eq(scheduledMessages.dedupeKey, 'old-bad'));
  expect(await outboundSummary(T0)).toEqual({ held: 1, failed: 1 });
});

it('GET /api/v1/outbound/summary needs the secret and returns the counts', async () => {
  const app = buildApp();
  expect((await app.inject({ method: 'GET', url: '/api/v1/outbound/summary' })).statusCode).toBe(401);
  await enqueue(getDb(), [row({ dueAt: new Date(Date.now() - 10 * MIN) })]);
  const res = await app.inject({ method: 'GET', url: '/api/v1/outbound/summary', headers: auth });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ data: { held: 1, failed: 0 }, error: null });
});

it('the poller holds rows while the template name is empty', async () => {
  const { chakra, sent } = fakeChakra();
  await enqueue(getDb(), [row()]);
  const poller = createOutboundPoller({ chakra, now: () => T0 });
  expect(await poller.runOnce()).toEqual({ sent: 0, held: 1, failed: 0 });
  expect(sent).toHaveLength(0);
  expect((await all())[0]).toMatchObject({ status: 'pending', attempts: 0 });
});

it('the poller holds rows when Chakra is not configured', async () => {
  await updateAppSettings({ salesAlertTemplate: { name: 'sales_alert_v1', language: 'id' } });
  await enqueue(getDb(), [row()]);
  expect(await createOutboundPoller({ chakra: null, now: () => T0 }).runOnce()).toEqual({ sent: 0, held: 1, failed: 0 });
  expect((await all())[0]!.status).toBe('pending');
});

it("the poller sends with the configured template and the lead's number", async () => {
  const { chakra, sent } = fakeChakra();
  await updateAppSettings({ salesAlertTemplate: { name: 'sales_alert_v1', language: 'id' } });
  await enqueue(getDb(), [row()]);
  expect(await createOutboundPoller({ chakra, now: () => T0 }).runOnce()).toEqual({ sent: 1, held: 0, failed: 0 });
  expect(sent).toEqual([{ pnid: 'PNID-CONV', to: '6281999000111', t: { name: 'sales_alert_v1', language: 'id', params: ['Rina', 'Zetira'] } }]);
  expect((await all())[0]).toMatchObject({ status: 'sent', waMessageId: 'wamid.OUT1', sentAt: T0 });
});

it('the configured business number wins over the lead conversation number', async () => {
  const { chakra, sent } = fakeChakra();
  await updateAppSettings({ salesAlertTemplate: { name: 'sales_alert_v1', language: 'id' }, chakraPhoneNumberId: 'PNID-BIZ' });
  await enqueue(getDb(), [row({ leadId: null })]);
  expect(await createOutboundPoller({ chakra, now: () => T0 }).runOnce()).toMatchObject({ sent: 1 });
  expect(sent[0]!.pnid).toBe('PNID-BIZ');
});

it('a row with no phone number id is held', async () => {
  const { chakra, sent } = fakeChakra();
  await updateAppSettings({ salesAlertTemplate: { name: 'sales_alert_v1', language: 'id' } });
  await enqueue(getDb(), [row({ leadId: null })]);
  expect(await createOutboundPoller({ chakra, now: () => T0 }).runOnce()).toEqual({ sent: 0, held: 1, failed: 0 });
  expect(sent).toHaveLength(0);
});

it('a failing send retries after 1 then 5 minutes, then fails and calls onFailed', async () => {
  const { chakra, sent } = fakeChakra(true);
  await updateAppSettings({ salesAlertTemplate: { name: 'sales_alert_v1', language: 'id' } });
  await enqueue(getDb(), [row()]);
  let now = T0;
  const onFailed = vi.fn(async () => {});
  const poller = createOutboundPoller({ chakra, now: () => now, onFailed });

  expect(await poller.runOnce()).toEqual({ sent: 0, held: 0, failed: 0 });
  expect((await all())[0]).toMatchObject({ attempts: 1, status: 'pending', lastError: 'chakra down', dueAt: new Date(T0.getTime() + MIN) });

  now = new Date(T0.getTime() + 30_000);
  await poller.runOnce();
  expect(sent).toHaveLength(1);

  now = new Date(T0.getTime() + MIN);
  await poller.runOnce();
  expect((await all())[0]).toMatchObject({ attempts: 2, status: 'pending', dueAt: new Date(T0.getTime() + 6 * MIN) });
  expect(onFailed).not.toHaveBeenCalled();

  now = new Date(T0.getTime() + 6 * MIN);
  expect(await poller.runOnce()).toEqual({ sent: 0, held: 0, failed: 1 });
  expect((await all())[0]).toMatchObject({ attempts: 3, status: 'failed' });
  expect(onFailed).toHaveBeenCalledTimes(1);
  expect(onFailed.mock.calls[0]![0]).toMatchObject({ dedupeKey: 'k1', status: 'failed' });

  now = new Date(T0.getTime() + 60 * MIN);
  await poller.runOnce();
  expect(sent).toHaveLength(3);
});

it('markAttemptFailed returns the updated row', async () => {
  await enqueue(getDb(), [row()]);
  const [r] = await all();
  expect(await markAttemptFailed(r!.id, 'boom', T0)).toMatchObject({ attempts: 1, status: 'pending' });
});

it('a customer notice to an opted-out contact is cancelled, not sent', async () => {
  const { chakra, sent } = fakeChakra();
  await updateAppSettings({ reassignNoticeTemplate: { name: 'reassign_v1', language: 'id' } });
  await getDb().execute(sql`update contacts set opted_out_at = ${T0.toISOString()} where id = ${contactId}`);
  await enqueue(getDb(), [row({ kind: 'reassign_notice', toPhone: '6281234567890' })]);
  expect(await createOutboundPoller({ chakra, now: () => T0 }).runOnce()).toEqual({ sent: 0, held: 0, failed: 0 });
  expect(sent).toHaveLength(0);
  expect((await all())[0]!.status).toBe('cancelled');
});

it('a sales alert goes out even when the lead contact has opted out', async () => {
  const { chakra, sent } = fakeChakra();
  await updateAppSettings({ salesAlertTemplate: { name: 'sales_alert_v1', language: 'id' } });
  await optOut(contactId, leadId, 'test');
  await enqueue(getDb(), [row()]);
  expect(await createOutboundPoller({ chakra, now: () => T0 }).runOnce()).toMatchObject({ sent: 1 });
  expect(sent).toHaveLength(1);
});

it('optOut cancels pending customer notices but not sales alerts', async () => {
  await enqueue(getDb(), [
    row({ kind: 'sales_alert', dedupeKey: 'a' }),
    row({ kind: 'h1_reminder', dedupeKey: 'b' }),
    row({ kind: 'followup', dedupeKey: 'c' }),
  ]);
  await optOut(contactId, leadId, 'test');
  expect((await all()).map((r) => [r.kind, r.status])).toEqual([
    ['sales_alert', 'pending'],
    ['h1_reminder', 'cancelled'],
    ['followup', 'cancelled'],
  ]);
});

it('a send that succeeds but is not recorded is never resent and costs no attempt', async () => {
  const { chakra, sent } = fakeChakra();
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await updateAppSettings({ salesAlertTemplate: { name: 'sales_alert_v1', language: 'id' } });
    await enqueue(getDb(), [row()]);
    let failMark = true;
    const poller = createOutboundPoller({
      chakra,
      now: () => T0,
      markSent: async (id, wamid, now) => {
        if (failMark) throw new Error('db down');
        await markSent(id, wamid, now);
      },
    });
    expect(await poller.runOnce()).toEqual({ sent: 1, held: 0, failed: 0 });
    expect((await all())[0]).toMatchObject({ status: 'pending', attempts: 0, lastError: null });
    expect(errors.mock.calls[0]!.join(' ')).toContain('wamid.OUT1');

    failMark = false;
    expect(await poller.runOnce()).toEqual({ sent: 0, held: 0, failed: 0 });
    expect(sent).toHaveLength(1);
    expect((await all())[0]).toMatchObject({ status: 'sent', attempts: 0, waMessageId: 'wamid.OUT1' });
  } finally {
    errors.mockRestore();
  }
});

it('a row whose processing throws is logged and the next row in the pass is still sent', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await updateAppSettings({ salesAlertTemplate: { name: 'sales_alert_v1', language: 'id' } });
    await enqueue(getDb(), [row({ dedupeKey: 'first', dueAt: new Date(T0.getTime() - MIN) }), row({ dedupeKey: 'second' })]);
    const sent: string[] = [];
    const chakra: ChakraClient = {
      ...fakeChakra().chakra,
      // The first send fails and its row disappears, so recording the failure throws too.
      sendTemplate: async (_p, to, t) => {
        if (sent.length === 0 && t.params[0] === 'Rina') {
          sent.push('first');
          await getDb().delete(scheduledMessages).where(eq(scheduledMessages.dedupeKey, 'first'));
          throw new Error('chakra down');
        }
        sent.push(to);
        return { waMessageId: 'wamid.2' };
      },
    };
    expect(await createOutboundPoller({ chakra, now: () => T0 }).runOnce()).toEqual({ sent: 1, held: 0, failed: 0 });
    expect(sent).toEqual(['first', '6281999000111']);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]!.join(' ')).toContain('crashed');
    expect((await all()).map((r) => [r.dedupeKey, r.status])).toEqual([['second', 'sent']]);
  } finally {
    errors.mockRestore();
  }
});

it('start runs passes without overlapping and stops', async () => {
  vi.useFakeTimers();
  try {
    let running = 0;
    let maxRunning = 0;
    let passes = 0;
    const slow = createOutboundPoller({ chakra: null, now: () => T0 });
    const runOnce = vi.spyOn(slow, 'runOnce').mockImplementation(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      passes++;
      await new Promise((r) => setTimeout(r, 250));
      running--;
      return { sent: 0, held: 0, failed: 0 };
    });
    const stop = slow.start(100);
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    const after = passes;
    await vi.advanceTimersByTimeAsync(1000);
    expect(maxRunning).toBe(1);
    expect(after).toBeGreaterThan(1);
    expect(passes).toBe(after);
    runOnce.mockRestore();
  } finally {
    vi.useRealTimers();
  }
});
