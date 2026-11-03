import { it, expect, beforeEach, vi, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { truncate } from './helpers/db.js';
import { fakeAnthropic, reply, text } from './helpers/agent.js';
import { getDb } from '../src/db/client.js';
import { contacts, conversations, leads, messages } from '../src/db/schema/index.js';
import { refreshSummaries } from '../src/leads/refresh.js';
import { getLead } from '../src/leads/repository.js';

const NOW = new Date('2026-11-02T03:00:00Z');
const ago = (min: number, from = NOW) => new Date(from.getTime() - min * 60_000);

const FACTS = {
  name: null,
  budget_price: null,
  budget_monthly: null,
  dp_budget: null,
  bedrooms_wanted: null,
  purpose: null,
  timeline: null,
  domicile_area: null,
  concerns: [] as string[],
};
const answer = (notes: string, facts: Partial<typeof FACTS> = {}) => reply([text(JSON.stringify({ notes, facts: { ...FACTS, ...facts } }))]);

async function seed(opts: { phone?: string; isTest?: boolean; lastMsg?: Date | null; refreshedAt?: Date | null; lead?: Partial<typeof leads.$inferInsert> } = {}) {
  const db = getDb();
  const [c] = await db
    .insert(contacts)
    .values({ waPhone: opts.phone ?? '6281200000001', isTest: opts.isTest ?? false })
    .returning();
  const [conv] = await db
    .insert(conversations)
    .values({ contactId: c!.id, lastCustomerMsgAt: opts.lastMsg === undefined ? ago(30) : opts.lastMsg, summaryRefreshedAt: opts.refreshedAt ?? null })
    .returning();
  const [lead] = await db
    .insert(leads)
    .values({ contactId: c!.id, ...opts.lead })
    .returning();
  await db.insert(messages).values([
    { conversationId: conv!.id, direction: 'in', sender: 'customer', body: 'Halo, cari rumah 2 kamar di Bekasi', status: 'received', createdAt: ago(40) },
    { conversationId: conv!.id, direction: 'out', sender: 'moni', body: 'Boleh, budgetnya berapa?', status: 'sent', createdAt: ago(39) },
    { conversationId: conv!.id, direction: 'out', sender: 'staff', body: 'Saya bantu ya', status: 'sent', createdAt: ago(38) },
  ]);
  return { conv: conv!, lead: lead!, contact: c! };
}

const deps = (anthropic: ReturnType<typeof fakeAnthropic>, now = NOW) => ({ anthropic, model: 'claude-test', now: () => now });

beforeEach(async () => {
  await truncate('messages', 'conversations', 'lead_events', 'leads', 'contacts');
});
afterEach(() => vi.restoreAllMocks());

it('fills blank facts and writes the notes', async () => {
  const { lead, conv } = await seed();
  const fake = fakeAnthropic([
    answer('Cari 2 kamar di Bekasi, belum sebut budget.', { name: 'Rina', bedrooms_wanted: 2, domicile_area: 'Bekasi', purpose: 'own_use', budget_price: 500_000_000, concerns: ['takut ditolak KPR'] }),
  ]);
  expect(await refreshSummaries(deps(fake))).toEqual({ refreshed: 1, failed: 0 });

  const after = (await getLead(lead.id))!;
  expect(after).toMatchObject({ name: 'Rina', bedroomsWanted: 2, domicileArea: 'Bekasi', purpose: 'own_use', budgetPrice: 500_000_000, concerns: ['takut ditolak KPR'] });
  expect(after.stage).toBe('new');
  expect(after.summary).toEqual({ notes: 'Cari 2 kamar di Bekasi, belum sebut budget.', refreshedAt: NOW.toISOString() });
  const [c] = await getDb().select().from(conversations).where(eq(conversations.id, conv.id));
  expect(c!.summaryRefreshedAt).toEqual(NOW);

  const content = (fake.params[0]!.messages as { content: string }[])[0]!.content;
  expect(content).toContain('Konsumen: Halo, cari rumah 2 kamar di Bekasi');
  expect(content).toContain('Moni: Boleh, budgetnya berapa?');
  expect(content).toContain('Staf: Saya bantu ya');
});

it('never overwrites a fact the lead already has', async () => {
  const { lead } = await seed({ lead: { name: 'Rina', concerns: ['cicilan'] } });
  const fake = fakeAnthropic([answer('Catatan.', { name: 'Rini', timeline: 'tahun depan', concerns: ['cicilan', 'banjir'] })]);
  await refreshSummaries(deps(fake));
  const after = (await getLead(lead.id))!;
  expect(after.name).toBe('Rina');
  expect(after.timeline).toBe('tahun depan');
  expect(after.concerns).toEqual(['cicilan', 'banjir']);
});

it('skips test contacts and conversations active in the last 5 minutes', async () => {
  await seed({ phone: '6281200000001', isTest: true });
  await seed({ phone: '6281200000002', lastMsg: ago(4) });
  await seed({ phone: '6281200000003', lastMsg: null });
  const fake = fakeAnthropic([]);
  expect(await refreshSummaries(deps(fake))).toEqual({ refreshed: 0, failed: 0 });
  expect(fake.params).toHaveLength(0);
});

it('takes the oldest first and no more than the limit', async () => {
  const a = await seed({ phone: '6281200000001', lastMsg: ago(10) });
  const b = await seed({ phone: '6281200000002', lastMsg: ago(60) });
  const fake = fakeAnthropic([answer('Pertama.')]);
  expect(await refreshSummaries({ ...deps(fake), limit: 1 })).toEqual({ refreshed: 1, failed: 0 });
  expect((await getLead(b.lead.id))!.summary).toMatchObject({ notes: 'Pertama.' });
  expect((await getLead(a.lead.id))!.summary).toBeNull();
});

it('does not run again until the customer writes again', async () => {
  const { conv } = await seed();
  const fake = fakeAnthropic([answer('Satu.'), answer('Dua.')]);
  await refreshSummaries(deps(fake));
  const later = new Date(NOW.getTime() + 10 * 60_000);
  expect(await refreshSummaries(deps(fake, later))).toEqual({ refreshed: 0, failed: 0 });
  expect(fake.params).toHaveLength(1);

  await getDb().update(conversations).set({ lastCustomerMsgAt: new Date(NOW.getTime() + 60_000) }).where(eq(conversations.id, conv.id));
  expect(await refreshSummaries(deps(fake, later))).toEqual({ refreshed: 1, failed: 0 });
  expect(fake.params).toHaveLength(2);
});

it('malformed JSON leaves the lead unchanged and marks the conversation refreshed', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { lead, conv } = await seed({ lead: { name: 'Rina' } });
  const fake = fakeAnthropic([reply([text('bukan json')])]);
  expect(await refreshSummaries(deps(fake))).toEqual({ refreshed: 0, failed: 1 });
  const after = (await getLead(lead.id))!;
  expect(after).toMatchObject({ name: 'Rina', summary: null, concerns: [] });
  const [c] = await getDb().select().from(conversations).where(eq(conversations.id, conv.id));
  expect(c!.summaryRefreshedAt).toEqual(NOW);
  expect(err).toHaveBeenCalled();
  expect(await refreshSummaries(deps(fake))).toEqual({ refreshed: 0, failed: 0 });
});

it('treats refusals, truncation, invalid shapes and API errors as failures that leave facts alone', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const s1 = await seed({ phone: '6281200000001', lastMsg: ago(50) });
  await seed({ phone: '6281200000002', lastMsg: ago(40) });
  await seed({ phone: '6281200000003', lastMsg: ago(30) });
  await seed({ phone: '6281200000004', lastMsg: ago(20) });
  const fake = fakeAnthropic([
    reply([text(JSON.stringify({ notes: 'x', facts: { ...FACTS, name: 'Rina' } }))], 'refusal'),
    reply([text('{"notes": "terpotong')], 'max_tokens'),
    reply([text(JSON.stringify({ notes: 'x', facts: { ...FACTS, purpose: 'beli' } }))]),
    new Error('503'),
  ]);
  expect(await refreshSummaries(deps(fake))).toEqual({ refreshed: 0, failed: 4 });
  expect((await getLead(s1.lead.id))!.name).toBeNull();
});

it('clips over-long notes to 400 characters and still fills blank facts', async () => {
  const { lead } = await seed();
  const fake = fakeAnthropic([answer(`  ${'x'.repeat(450)}  `, { name: 'Rina', bedrooms_wanted: 2 })]);
  expect(await refreshSummaries(deps(fake))).toEqual({ refreshed: 1, failed: 0 });
  const after = (await getLead(lead.id))!;
  expect(after.summary).toEqual({ notes: 'x'.repeat(400), refreshedAt: NOW.toISOString() });
  expect(after.name).toBe('Rina');
  expect(after.bedroomsWanted).toBe(2);
});

it('the request uses low effort, a JSON schema format and the fallback beta, and no tool_choice or thinking', async () => {
  await seed();
  const fake = fakeAnthropic([answer('Catatan.')]);
  await refreshSummaries(deps(fake));
  const p = fake.params[0]!;
  expect(p).toMatchObject({
    model: 'claude-test',
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['notes', 'facts'] } } },
  });
  for (const k of ['tool_choice', 'thinking', 'temperature', 'top_p', 'top_k', 'tools']) expect(p).not.toHaveProperty(k);
  const msgs = p.messages as { role: string }[];
  expect(msgs).toHaveLength(1);
  expect(msgs[0]!.role).toBe('user');
  expect(p.system).toContain('data');
  const facts = (p.output_config as { format: { schema: { properties: { facts: { required: string[]; properties: object } } } } }).format.schema.properties.facts;
  expect([...facts.required].sort()).toEqual(Object.keys(facts.properties).sort());
});
