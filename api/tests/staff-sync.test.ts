import { it, expect, beforeEach, vi } from 'vitest';
import { truncate } from './helpers/db.js';
import { seedProjects, json, fakeFetch } from './helpers/vles.js';
import { reply, tool, fakeAnthropic } from './helpers/agent.js';
import {
  ensureConversation,
  ensureLead,
  getConversation,
  insertInbound,
  insertOutbound,
  listEvents,
  recentMessages,
  upsertContact,
} from '../src/leads/repository.js';
import { createChakraClient, type ChakraChatMessage, type ChakraClient } from '../src/chakra/client.js';
import { syncStaffReplies } from '../src/chakra/staffSync.js';
import { recordingTransport } from '../src/router/transport.js';
import { runTurn } from '../src/router/turn.js';

const PHONE = '6281234567890';
let convId: string;
let leadId: string;

beforeEach(async () => {
  await truncate('projects', 'contacts');
  await seedProjects();
  const c = await upsertContact(PHONE, 'Sari');
  convId = (await ensureConversation(c.id, 'PNID-1')).id;
  leadId = (await ensureLead(c.id)).id;
  await insertInbound(convId, { waMessageId: 'wamid.in1', kind: 'text', body: 'halo', createdAt: new Date(Date.now() - 120_000) });
});

const chakraWith = (messages: ChakraChatMessage[] | (() => Promise<ChakraChatMessage[]>)): ChakraClient => ({
  sendText: async () => ({ waMessageId: null }),
  sendMedia: async () => ({ waMessageId: null }),
  sendTemplate: async () => ({ waMessageId: null }),
  findChatId: async (wa) => (wa === PHONE ? 'chat-1' : null),
  listChatMessages: async () => (typeof messages === 'function' ? messages() : messages),
});
const out = (externalId: string, text: string, agoMs: number): ChakraChatMessage => ({ id: `m-${externalId}`, externalId, direction: 'OUTBOUND', text, dataType: 'text', timestamp: Date.now() - agoMs });

it('stores an unknown outbound reply as staff and reports it', async () => {
  const client = chakraWith([{ id: 'm0', externalId: 'wamid.in1', direction: 'INBOUND', text: 'halo', dataType: 'text', timestamp: Date.now() - 120_000 }, out('wamid.staff1', 'Halo Kak, saya Rina dari tim sales', 30_000)]);
  expect(await syncStaffReplies(convId, { client, now: () => new Date() })).toBe(true);
  const staff = (await recentMessages(convId, 10)).filter((m) => m.sender === 'staff');
  expect(staff.map((m) => [m.body, m.waMessageId])).toEqual([['Halo Kak, saya Rina dari tim sales', 'wamid.staff1']]);
  // a second sync finds nothing new
  expect(await syncStaffReplies(convId, { client, now: () => new Date() })).toBe(false);
});

it('ignores outbound messages Moni sent', async () => {
  await insertOutbound(convId, { sender: 'moni', kind: 'text', body: 'Halo Kak', waMessageId: 'wamid.moni1', status: 'sent' });
  expect(await syncStaffReplies(convId, { client: chakraWith([out('wamid.moni1', 'Halo Kak', 5_000)]), now: () => new Date() })).toBe(false);
});

it('ignores a Moni message whose send we recorded as failed but WhatsApp delivered', async () => {
  await insertOutbound(convId, { sender: 'moni', kind: 'text', body: 'Halo Kak dari Moni', waMessageId: null, status: 'failed' });
  expect(await syncStaffReplies(convId, { client: chakraWith([out('wamid.late', 'Halo Kak dari Moni', 5_000)]), now: () => new Date() })).toBe(false);
});

it('a slow history check logs a line', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const never = chakraWith(() => new Promise(() => undefined));
  expect(await syncStaffReplies(convId, { client: never, now: () => new Date(), timeoutMs: 5 })).toBe(false);
  expect(log).toHaveBeenCalledWith(`[staffSync] history check timed out after 5 ms for ${convId}`);
  log.mockRestore();
});

it('gives up quietly when ChakraHQ is slow or failing', async () => {
  const slow = chakraWith(() => new Promise((r) => setTimeout(() => r([out('wamid.s', 'x', 1000)]), 200)));
  expect(await syncStaffReplies(convId, { client: slow, now: () => new Date(), timeoutMs: 20 })).toBe(false);
  const broken = chakraWith(async () => { throw new Error('500'); });
  expect(await syncStaffReplies(convId, { client: broken, now: () => new Date() })).toBe(false);
});

it('runTurn skips and starts a takeover when staff replied in ChakraHQ', async () => {
  const client = chakraWith([out('wamid.staff2', 'Saya bantu ya Kak', 10_000)]);
  const transport = recordingTransport();
  const r = await runTurn(convId, {
    transport,
    anthropic: fakeAnthropic([reply([tool('respond_to_customer', { message: 'Halo', no_reply: false })])]),
    vles: null,
    now: () => new Date(),
    settings: { model: 'claude-opus-5-5', effort: 'medium' },
    staffSync: (id) => syncStaffReplies(id, { client, now: () => new Date() }),
  });
  expect(r.kind).toBe('skipped');
  expect(transport.sent).toEqual([]);
  expect((await getConversation(convId))!.humanTakeoverUntil).not.toBeNull();
  expect((await listEvents(leadId, ['handoff']))[0]!.payload).toMatchObject({ reason: 'balasan staf di ChakraHQ' });
  // staff are already handling it, so the Leads list must not flag it for attention
  expect((await listEvents(leadId, ['handoff']))[0]!.actor).toBe('staff:chakra');
});

it('the client finds the chat by phone and lists its messages', async () => {
  const { fetch, calls } = fakeFetch([
    json(200, { _data: [{ id: 'chat-9', provider: 'WHATSAPP', primaryContactHandle: { value: '+62 812-3456-7890' } }] }),
    json(200, { _data: [out('wamid.x', 'hi', 1000)] }),
  ]);
  const c = createChakraClient({ baseUrl: 'https://api.chakra.test', pluginId: 'P', apiVersion: 'v22.0', accessToken: 'tok', fetch });
  expect(await c.findChatId(PHONE)).toBe('chat-9');
  expect(await c.listChatMessages('chat-9', 20)).toHaveLength(1);
  expect(calls[0]!.url).toBe('https://api.chakra.test/v1/ext/chat');
  expect(JSON.parse(calls[0]!.body!)).toEqual({ orderField: 'updatedAt', limit: 100, page: 1 });
  expect(calls[1]!.url).toBe('https://api.chakra.test/v1/ext/chat/chat-9/message');
  expect(JSON.parse(calls[1]!.body!)).toEqual({ limit: 20, page: 1 });
});
