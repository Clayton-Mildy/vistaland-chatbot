import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { seedProjects } from './helpers/vles.js';
import { reply, tool, fakeAnthropic } from './helpers/agent.js';
import { buildApp } from '../src/app.js';
import type { AnthropicLike } from '../src/agent/claude.js';
import { createStaff } from '../src/repositories/staff.js';
import { upsertContact } from '../src/leads/repository.js';
import type { ChakraClient } from '../src/chakra/client.js';

const auth = { authorization: 'Bearer test-secret-test-secret-test-secret-00' };
let staffId: string;
const chakraCalls: string[] = [];
const chakra: ChakraClient = {
  sendText: async (_p, _to, body) => (chakraCalls.push(body), { waMessageId: 'x' }),
  sendMedia: async () => (chakraCalls.push('media'), { waMessageId: 'x' }),
  sendTemplate: async () => ({ waMessageId: null }),
  findChatId: async () => null,
  listChatMessages: async () => [],
};

beforeEach(async () => {
  await truncate('projects', 'contacts', 'staff_users', 'app_settings', 'prompt_versions');
  chakraCalls.length = 0;
  await seedProjects();
  staffId = (await createStaff({ email: 'a@vista.id', password: 'correct-horse-1', displayName: 'A', role: 'admin' })).id;
});

const app = (anthropic: AnthropicLike | null) =>
  buildApp({ chakra, agent: { anthropic, vles: null, settings: { model: 'claude-opus-5-5', effort: 'medium' } } });

it('a test-chat message runs a turn and returns the recorded outbound without calling ChakraHQ', async () => {
  const a = app(fakeAnthropic([reply([tool('update_lead', { name: 'Sari' }), tool('respond_to_customer', { message: 'Halo Kak Sari', no_reply: false })])]));
  const res = await a.inject({ method: 'POST', url: `/api/v1/test-chat/${staffId}/messages`, headers: auth, payload: { text: 'Halo, saya Sari' } });
  expect(res.statusCode).toBe(200);
  const d = res.json().data;
  expect(d.outbound).toEqual([{ kind: 'text', body: 'Halo Kak Sari' }]);
  expect(d.outcome).toBe('replied');
  expect(d.trace.map((t: { tool: string }) => t.tool)).toEqual(['update_lead', 'respond_to_customer']);
  expect(d.lead).toMatchObject({ name: 'Sari', stage: 'engaged' });
  expect(chakraCalls).toEqual([]);
});

it('test leads never appear in the Leads list, and reset removes them', async () => {
  const a = app(fakeAnthropic([reply([tool('respond_to_customer', { message: 'Halo', no_reply: false })])]));
  await a.inject({ method: 'POST', url: `/api/v1/test-chat/${staffId}/messages`, headers: auth, payload: { text: 'Halo' } });
  await upsertContact('6281999', 'Real');
  expect((await a.inject({ method: 'GET', url: '/api/v1/leads', headers: { ...auth, 'x-staff-id': staffId } })).json().data).toEqual([]);
  const reset = await a.inject({ method: 'DELETE', url: `/api/v1/test-chat/${staffId}`, headers: auth });
  expect(reset.statusCode).toBe(200);
  const { getDb } = await import('../src/db/client.js');
  const { contacts } = await import('../src/db/schema/index.js');
  const { eq } = await import('drizzle-orm');
  expect(await getDb().select().from(contacts).where(eq(contacts.waPhone, `test-${staffId}`))).toEqual([]);
});

it('reports a skipped turn when the test chat is under takeover', async () => {
  const a = app(fakeAnthropic([reply([tool('handoff_to_human', { reason: 'nego' }), tool('respond_to_customer', { message: 'Moni teruskan ke tim', no_reply: false })])]));
  await a.inject({ method: 'POST', url: `/api/v1/test-chat/${staffId}/messages`, headers: auth, payload: { text: 'bisa nego?' } });
  const second = await a.inject({ method: 'POST', url: `/api/v1/test-chat/${staffId}/messages`, headers: auth, payload: { text: 'halo?' } });
  expect(second.json().data).toMatchObject({ outcome: 'skipped', outbound: [] });
});

it('validates the staff id and the text', async () => {
  const a = app(null);
  expect((await a.inject({ method: 'POST', url: '/api/v1/test-chat/not-a-uuid/messages', headers: auth, payload: { text: 'x' } })).statusCode).toBe(400);
  expect((await a.inject({ method: 'POST', url: `/api/v1/test-chat/${staffId}/messages`, headers: auth, payload: { text: '' } })).statusCode).toBe(400);
});
