import { it, expect, beforeEach, vi } from 'vitest';
import { truncate } from './helpers/db.js';
import { seedProjects, seedUnits, unit } from './helpers/vles.js';
import { reply, tool, fakeAnthropic } from './helpers/agent.js';
import { listProjects, type Project } from '../src/repositories/projects.js';
import { upsertChannelTag } from '../src/repositories/channelTags.js';
import { createMaterial } from '../src/repositories/materials.js';
import { updateAppSettings } from '../src/settings/appSettings.js';
import {
  getConversation,
  getConversationByContact,
  getLeadByContact,
  insertInbound,
  listEvents,
  recentMessages,
  setTakeover,
  updateConversation,
  upsertContact,
} from '../src/leads/repository.js';
import type { InboundMessage } from '../src/chakra/parse.js';
import { createDebouncer } from '../src/router/debounce.js';
import { recordingTransport, type Transport } from '../src/router/transport.js';
import { handleInbound } from '../src/router/inbound.js';
import { runTurn, type TurnDeps } from '../src/router/turn.js';
import type { Alerts } from '../src/notify/alerts.js';
import { conversationsAwaitingReply, insertOutbound } from '../src/leads/repository.js';

let zetira: Project;
let seq = 0;
const PHONE = '6281234567890';

beforeEach(async () => {
  await truncate('projects', 'vles_units', 'materials', 'contacts', 'channel_tags', 'app_settings');
  await seedProjects();
  zetira = (await listProjects()).find((p) => p.slug === 'zetira')!;
  await seedUnits([unit({ id: 1, project_id: 5, area_id: 37, house_type_id: 500, is_available_for_sale: true, deleted: false, selling_price: 400_000_000 })]);
});

/** A clock whose timers run only when advanced. */
function manualClock() {
  let t = 0;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: ((fn: () => void, ms: number) => {
      timers.set(++id, { at: t + ms, fn });
      return id;
    }) as unknown as typeof setTimeout,
    clearTimer: ((h: number) => void timers.delete(h)) as unknown as typeof clearTimeout,
    async advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
        await new Promise((r) => setImmediate(r));
      }
      t = end;
    },
  };
}

const msg = (text: string, o: Partial<InboundMessage> = {}): InboundMessage => ({
  waMessageId: `wamid.${++seq}`,
  from: PHONE,
  profileName: 'Sari',
  phoneNumberId: 'PNID-1',
  sentAt: new Date(Date.now() - 60_000 + seq),
  kind: 'text',
  text,
  mediaId: null,
  referral: null,
  ...o,
});

const stubDebouncer = () => ({ push: vi.fn(), pending: () => false });
const deps = (o: Partial<TurnDeps> = {}): TurnDeps => ({
  transport: recordingTransport(),
  anthropic: null,
  vles: null,
  now: () => new Date(),
  settings: { model: 'claude-opus-5-5', effort: 'medium' },
  ...o,
});
const respond = (message: string, extra: Record<string, unknown> = {}) => reply([tool('respond_to_customer', { message, no_reply: false, ...extra })]);

async function conversationOf(): Promise<string> {
  const c = await upsertContact(PHONE, null);
  return (await getConversationByContact(c.id))!.id;
}

it('a burst of messages produces one turn', async () => {
  const clock = manualClock();
  const onFire = vi.fn(async () => {});
  const d = createDebouncer({ quietMs: 8000, maxWaitMs: 30000, maxBatch: 20, onFire, setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: clock.now });
  d.push('c1');
  await clock.advance(2000);
  d.push('c1');
  await clock.advance(2000);
  d.push('c1');
  await clock.advance(7999);
  expect(onFire).not.toHaveBeenCalled();
  await clock.advance(1);
  expect(onFire).toHaveBeenCalledTimes(1);

  // and the turn sees the three texts as one message
  const debouncer = stubDebouncer();
  for (const t of ['a', 'b', 'c']) await handleInbound(msg(t), { debouncer, transport: () => recordingTransport(), now: () => new Date() });
  const client = fakeAnthropic([respond('Halo Kak')]);
  await runTurn(await conversationOf(), deps({ anthropic: client }));
  const sent = client.params[0]!['messages'] as { role: string; content: string }[];
  expect(sent.at(-1)).toEqual({ role: 'user', content: 'a\nb\nc' });
});

it('fires at once on the 20th message and caps waiting at maxWaitMs', async () => {
  const clock = manualClock();
  const onFire = vi.fn(async () => {});
  const d = createDebouncer({ quietMs: 8000, maxWaitMs: 30000, maxBatch: 20, onFire, setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: clock.now });
  for (let i = 0; i < 20; i++) d.push('c1');
  await clock.advance(0);
  expect(onFire).toHaveBeenCalledTimes(1);

  const clock2 = manualClock();
  const fired: number[] = [];
  const d2 = createDebouncer({ quietMs: 8000, maxWaitMs: 30000, maxBatch: 20, onFire: async () => void fired.push(clock2.now()), setTimer: clock2.setTimer, clearTimer: clock2.clearTimer, now: clock2.now });
  for (let i = 0; i < 8; i++) {
    d2.push('c2');
    await clock2.advance(5000);
  }
  expect(fired).toEqual([30000]);
});

it('re-arms after a running turn when messages arrived during it', async () => {
  const clock = manualClock();
  let release!: () => void;
  const onFire = vi.fn(() => new Promise<void>((r) => (release = r)));
  const d = createDebouncer({ quietMs: 8000, maxWaitMs: 30000, maxBatch: 20, onFire, setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: clock.now });
  d.push('c1');
  await clock.advance(8000);
  d.push('c1');
  expect(onFire).toHaveBeenCalledTimes(1);
  release();
  await new Promise((r) => setImmediate(r));
  await clock.advance(8000);
  expect(onFire).toHaveBeenCalledTimes(2);
});

it('a duplicate inbound does not schedule a turn', async () => {
  const debouncer = stubDebouncer();
  const m = msg('halo');
  expect(await handleInbound(m, { debouncer, transport: () => recordingTransport(), now: () => new Date() })).toBe('queued');
  expect(await handleInbound(m, { debouncer, transport: () => recordingTransport(), now: () => new Date() })).toBe('duplicate');
  expect(debouncer.push).toHaveBeenCalledTimes(1);
});

it('takeover or a paused conversation stores the message without replying', async () => {
  const debouncer = stubDebouncer();
  const d = { debouncer, transport: () => recordingTransport(), now: () => new Date() };
  await handleInbound(msg('halo'), d);
  const conv = await conversationOf();
  await setTakeover(conv, new Date(Date.now() + 3_600_000), 'staff:x');
  expect(await handleInbound(msg('halo lagi'), d)).toBe('stored');
  await setTakeover(conv, null, 'staff:x');
  await updateConversation(conv, { aiEnabled: false });
  expect(await handleInbound(msg('halo lagi'), d)).toBe('stored');
  await updateConversation(conv, { aiEnabled: true });
  await updateAppSettings({ aiEnabled: false });
  expect(await handleInbound(msg('halo lagi'), d)).toBe('stored');
  expect(debouncer.push).toHaveBeenCalledTimes(1);
});

it('audio gets the canned reply once per five minutes', async () => {
  const t = recordingTransport();
  let now = new Date('2026-10-30T03:00:00Z');
  const d = { debouncer: stubDebouncer(), transport: () => t, now: () => now };
  expect(await handleInbound(msg('', { kind: 'audio' }), d)).toBe('canned');
  now = new Date('2026-10-30T03:01:00Z');
  expect(await handleInbound(msg('', { kind: 'audio' }), d)).toBe('stored');
  now = new Date('2026-10-30T03:06:00Z');
  expect(await handleInbound(msg('', { kind: 'video' }), d)).toBe('canned');
  expect(t.sent.map((s) => s.kind)).toEqual(['text', 'text']);
  expect(t.sent[0]!.body).toContain('pesan suara atau video');
});

it('sends text then queued materials and records them as sent', async () => {
  const flyer = await createMaterial({ projectId: zetira.id, kind: 'flyer', url: 'https://x/flyer.jpg', mime: 'image/jpeg', filename: 'flyer.jpg' });
  await handleInbound(msg('[ZTR] halo'), { debouncer: stubDebouncer(), transport: () => recordingTransport(), now: () => new Date() });
  const conv = await conversationOf();
  const lead = (await getLeadByContact((await getConversation(conv))!.contactId))!;
  const transport = recordingTransport();
  const client = fakeAnthropic([reply([tool('send_materials', { kind: 'flyer', project: 'zetira' }), tool('respond_to_customer', { message: 'Ini flyernya Kak', no_reply: false })])]);
  const out = await runTurn(conv, deps({ anthropic: client, transport }));
  expect(out).toMatchObject({ kind: 'replied', sent: 2 });
  expect(transport.sent).toEqual([
    { kind: 'text', body: 'Ini flyernya Kak' },
    { kind: 'image', link: 'https://x/flyer.jpg' },
  ]);
  expect((await listEvents(lead.id, ['material_sent'])).map((e) => e.payload)).toEqual([{ materialId: flyer.id, kind: 'flyer', filename: 'flyer.jpg' }]);
  expect((await recentMessages(conv, 10)).filter((m) => m.sender === 'moni').map((m) => [m.kind, m.status])).toEqual([['text', 'sent'], ['image', 'sent']]);
});

it('a failed media send is not recorded as sent', async () => {
  await createMaterial({ projectId: zetira.id, kind: 'flyer', url: 'https://x/flyer.jpg', mime: 'image/jpeg', filename: 'flyer.jpg' });
  await handleInbound(msg('halo'), { debouncer: stubDebouncer(), transport: () => recordingTransport(), now: () => new Date() });
  const conv = await conversationOf();
  const lead = (await getLeadByContact((await getConversation(conv))!.contactId))!;
  const sentTexts: string[] = [];
  const transport: Transport = {
    sendText: async (_to, body) => (sentTexts.push(body), { waMessageId: 'wamid.out1' }),
    sendMedia: async () => { throw new Error('Chakra 400'); },
  };
  const client = fakeAnthropic([reply([tool('send_materials', { kind: 'flyer', project: 'zetira' }), tool('respond_to_customer', { message: 'Ini flyernya Kak', no_reply: false })])]);
  await runTurn(conv, deps({ anthropic: client, transport }));
  expect(sentTexts).toEqual(['Ini flyernya Kak']);
  expect(await listEvents(lead.id, ['material_sent'])).toEqual([]);
  expect((await listEvents(lead.id, ['material_failed']))[0]!.payload).toMatchObject({ error: 'Chakra 400' });
});

it('a message arriving mid-turn supersedes the draft once', async () => {
  await handleInbound(msg('harganya berapa?'), { debouncer: stubDebouncer(), transport: () => recordingTransport(), now: () => new Date() });
  const conv = await conversationOf();
  const transport = recordingTransport();
  const client = fakeAnthropic([
    async () => {
      await insertInbound(conv, { waMessageId: 'wamid.mid', kind: 'text', body: 'yang 2 kamar ya', createdAt: new Date() });
      return respond('Draft lama');
    },
    respond('Jawaban gabungan'),
  ]);
  await runTurn(conv, deps({ anthropic: client, transport }));
  expect(transport.sent).toEqual([{ kind: 'text', body: 'Jawaban gabungan' }]);
  expect((client.params[1]!['messages'] as { content: string }[]).at(-1)!.content).toBe('harganya berapa?\nyang 2 kamar ya');
});

it('a failed turn sends nothing and starts a takeover', async () => {
  await handleInbound(msg('halo'), { debouncer: stubDebouncer(), transport: () => recordingTransport(), now: () => new Date() });
  const conv = await conversationOf();
  const lead = (await getLeadByContact((await getConversation(conv))!.contactId))!;
  const transport = recordingTransport();
  const out = await runTurn(conv, deps({ anthropic: fakeAnthropic([respond('Rp450 jt'), respond('Rp450 jt')]), transport }));
  expect(out.kind).toBe('failed');
  expect(transport.sent).toEqual([]);
  expect((await getConversation(conv))!.humanTakeoverUntil).not.toBeNull();
  expect((await listEvents(lead.id, ['handoff']))[0]!.payload).toMatchObject({ reason: expect.stringContaining('REPLY_CHECK') });
});

it('a handoff from Moni sends the reply and starts a takeover', async () => {
  await handleInbound(msg('mau nego harga'), { debouncer: stubDebouncer(), transport: () => recordingTransport(), now: () => new Date() });
  const conv = await conversationOf();
  const transport = recordingTransport();
  await runTurn(conv, deps({ anthropic: fakeAnthropic([reply([tool('handoff_to_human', { reason: 'nego harga' }), tool('respond_to_customer', { message: 'Moni teruskan ke tim ya Kak', no_reply: false })])]), transport }));
  expect(transport.sent).toHaveLength(1);
  expect((await getConversation(conv))!.humanTakeoverUntil).not.toBeNull();
  // a second turn is skipped while the takeover lasts
  expect((await runTurn(conv, deps({ anthropic: fakeAnthropic([]), transport }))).kind).toBe('skipped');
});

const fakeAlerts = () => ({ leadNeedsStaff: vi.fn(async () => {}), availabilityUnverified: vi.fn(async () => {}), visitChanged: vi.fn(async () => {}), outboundFailed: vi.fn(async () => {}) }) satisfies Alerts;

it('a failed turn alerts staff with kind failure', async () => {
  await handleInbound(msg('halo'), { debouncer: stubDebouncer(), transport: () => recordingTransport(), now: () => new Date() });
  const conv = await conversationOf();
  const lead = (await getLeadByContact((await getConversation(conv))!.contactId))!;
  const alerts = fakeAlerts();
  await runTurn(conv, deps({ anthropic: fakeAnthropic([respond('Rp450 jt'), respond('Rp450 jt')]), alerts }));
  expect(alerts.leadNeedsStaff).toHaveBeenCalledTimes(1);
  expect(alerts.leadNeedsStaff).toHaveBeenCalledWith(lead.id, expect.stringContaining('REPLY_CHECK'), 'failure');
});

it('a reply that could not be sent alerts staff with kind failure', async () => {
  await handleInbound(msg('halo'), { debouncer: stubDebouncer(), transport: () => recordingTransport(), now: () => new Date() });
  const conv = await conversationOf();
  const lead = (await getLeadByContact((await getConversation(conv))!.contactId))!;
  const transport: Transport = { sendText: async () => { throw new Error('down'); }, sendMedia: async () => { throw new Error('down'); } };
  const alerts = fakeAlerts();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await runTurn(conv, deps({ anthropic: fakeAnthropic([respond('Halo Kak')]), transport, alerts }));
  log.mockRestore();
  expect(alerts.leadNeedsStaff).toHaveBeenCalledWith(lead.id, 'Balasan Moni gagal terkirim', 'failure');
});

it('a Moni hand-off alerts staff with kind handoff', async () => {
  await handleInbound(msg('mau nego harga'), { debouncer: stubDebouncer(), transport: () => recordingTransport(), now: () => new Date() });
  const conv = await conversationOf();
  const lead = (await getLeadByContact((await getConversation(conv))!.contactId))!;
  const alerts = fakeAlerts();
  await runTurn(conv, deps({ anthropic: fakeAnthropic([reply([tool('handoff_to_human', { reason: 'nego harga' }), tool('respond_to_customer', { message: 'Moni teruskan ke tim ya Kak', no_reply: false })])]), alerts }));
  expect(alerts.leadNeedsStaff).toHaveBeenCalledTimes(1);
  expect(alerts.leadNeedsStaff).toHaveBeenCalledWith(lead.id, 'nego harga', 'handoff');
});

it('a staff reply in ChakraHQ alerts nobody', async () => {
  await handleInbound(msg('halo'), { debouncer: stubDebouncer(), transport: () => recordingTransport(), now: () => new Date() });
  const conv = await conversationOf();
  const alerts = fakeAlerts();
  const out = await runTurn(conv, deps({ anthropic: fakeAnthropic([]), alerts, staffSync: async () => true }));
  expect(out.kind).toBe('skipped');
  expect((await getConversation(conv))!.humanTakeoverUntil).not.toBeNull();
  expect(alerts.leadNeedsStaff).not.toHaveBeenCalled();
});

it('first message with a tag sets the project and source', async () => {
  await upsertChannelTag({ tag: 'ZTR-REELS', projectId: zetira.id, channel: 'instagram', contentKind: 'reels' });
  await handleInbound(msg('[ZTR-REELS] Halo'), { debouncer: stubDebouncer(), transport: () => recordingTransport(), now: () => new Date() });
  const c = await upsertContact(PHONE, null);
  expect(await getLeadByContact(c.id)).toMatchObject({ currentProjectId: zetira.id, sourceChannel: 'instagram', sourceContentKind: 'reels', sourceRef: 'ZTR-REELS', stage: 'engaged' });
});

it('does not send when staff take over while Moni is thinking', async () => {
  await handleInbound(msg('halo'), { debouncer: stubDebouncer(), transport: () => recordingTransport(), now: () => new Date() });
  const conv = await conversationOf();
  const transport = recordingTransport();
  const client = fakeAnthropic([
    async () => {
      await setTakeover(conv, new Date(Date.now() + 3_600_000), 'staff:x', 'diambil alih staf');
      return respond('Halo Kak');
    },
  ]);
  const out = await runTurn(conv, deps({ anthropic: client, transport }));
  expect(out.kind).toBe('skipped');
  expect(transport.sent).toEqual([]);
  expect((await recentMessages(conv, 10)).filter((m) => m.sender === 'moni').map((m) => m.status)).toEqual(['recorded']);
});

it('answers a message whose webhook arrived after Moni replied, even with an earlier WhatsApp time', async () => {
  await handleInbound(msg('halo'), { debouncer: stubDebouncer(), transport: () => recordingTransport(), now: () => new Date() });
  const conv = await conversationOf();
  const transport = recordingTransport();
  await runTurn(conv, deps({ anthropic: fakeAnthropic([respond('Halo Kak')]), transport }));
  // sent by the customer two seconds before Moni's reply was stored, delivered after it
  await insertInbound(conv, { waMessageId: 'wamid.late', kind: 'text', body: 'mau tanya harga', createdAt: new Date(Date.now() - 2000) });
  const out = await runTurn(conv, deps({ anthropic: fakeAnthropic([respond('Siap Kak')]), transport }));
  expect(out.kind).toBe('replied');
  expect(transport.sent.map((s) => s.body)).toEqual(['Halo Kak', 'Siap Kak']);
});

it('lists conversations still waiting for an answer, for the startup sweep', async () => {
  await handleInbound(msg('halo'), { debouncer: stubDebouncer(), transport: () => recordingTransport(), now: () => new Date() });
  const conv = await conversationOf();
  expect(await conversationsAwaitingReply(3_600_000)).toEqual([conv]);
  await runTurn(conv, deps({ anthropic: fakeAnthropic([respond('Halo Kak')]) }));
  expect(await conversationsAwaitingReply(3_600_000)).toEqual([]);
});

it('a failed Moni send is not replayed as something Moni said', async () => {
  await handleInbound(msg('q1'), { debouncer: stubDebouncer(), transport: () => recordingTransport(), now: () => new Date() });
  const conv = await conversationOf();
  await insertOutbound(conv, { sender: 'moni', kind: 'text', body: 'jawaban gagal', waMessageId: null, status: 'failed' });
  await insertInbound(conv, { waMessageId: 'wamid.q2', kind: 'text', body: 'q2', createdAt: new Date() });
  const client = fakeAnthropic([respond('Halo Kak')]);
  await runTurn(conv, deps({ anthropic: client }));
  const sent = client.params[0]!['messages'] as { role: string; content: string }[];
  expect(sent).toEqual([{ role: 'user', content: 'q1\nq2' }]);
});
