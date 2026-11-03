import { it, expect, beforeEach, vi } from 'vitest';
import { truncate } from './helpers/db.js';
import { seedProjects, seedUnits, unit } from './helpers/vles.js';
import { reply, tool, text, fakeAnthropic } from './helpers/agent.js';
import { listProjects, type Project } from '../src/repositories/projects.js';
import { createMaterial } from '../src/repositories/materials.js';
import { upsertContact, ensureLead, type Lead } from '../src/leads/repository.js';
import { newTurnContext } from '../src/agent/executor.js';
import { buildSystemBlocks } from '../src/agent/prompt.js';
import { runAgentTurn } from '../src/agent/loop.js';

let zetira: Project;
let lead: Lead;
let contactId: string;

beforeEach(async () => {
  await truncate('projects', 'vles_units', 'materials', 'contacts');
  await seedProjects();
  zetira = (await listProjects()).find((p) => p.slug === 'zetira')!;
  const c = await upsertContact('6281234567890', 'Sari');
  contactId = c.id;
  lead = await ensureLead(c.id);
  await seedUnits([unit({ id: 1, project_id: 5, area_id: 37, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', is_available_for_sale: true, deleted: false, selling_price: 400_000_000 })]);
});

const settings = { model: 'claude-opus-5-5', effort: 'medium' as const };
const system = buildSystemBlocks({ flowText: 'FLOW', persona: 'tim Zetira', projectFacts: 'PROYEK: Zetira', leadState: 'STATUS LEAD: new', nowWib: 'Jumat, 30 Oktober 2026 10.00 WIB' });
const turn = (client: ReturnType<typeof fakeAnthropic> | null) =>
  runAgentTurn(
    { system, history: [], latest: 'Halo, harganya berapa?', ctx: newTurnContext({ leadId: lead.id, contactId, projectId: zetira.id, vles: null, today: '2026-10-30', subsidiNotes: null }), settings },
    client
  );
const respond = (message: string, extra: Record<string, unknown> = {}) => tool('respond_to_customer', { message, no_reply: false, ...extra });

it('runs tools then returns the respond_to_customer reply with queued materials', async () => {
  await createMaterial({ projectId: zetira.id, kind: 'flyer', url: 'https://x/flyer.jpg', mime: 'image/jpeg', filename: 'flyer.jpg' });
  const client = fakeAnthropic([
    reply([tool('search_units', { project: 'zetira' })]),
    reply([tool('send_materials', { kind: 'flyer', project: 'zetira' })]),
    reply([respond('Mulai **Rp400 jt** Kak', { materials_position: 'before' })]),
  ]);
  const r = await turn(client);
  expect(r).toMatchObject({ kind: 'reply', message: 'Mulai *Rp400 jt* Kak', materialsPosition: 'before' });
  if (r.kind === 'reply') expect(r.materials).toHaveLength(1);
  expect(r.trace.map((t) => t.tool)).toEqual(['search_units', 'send_materials', 'respond_to_customer']);
  // the third request carries both tool results back
  const msgs = client.params[2]!['messages'] as { role: string; content: unknown }[];
  expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
});

it('runs other tools in the same response before the reply', async () => {
  await createMaterial({ projectId: zetira.id, kind: 'flyer', url: 'https://x/flyer.jpg', mime: 'image/jpeg', filename: 'flyer.jpg' });
  const r = await turn(fakeAnthropic([reply([tool('send_materials', { kind: 'flyer', project: 'zetira' }), respond('Ini flyernya Kak')])]));
  expect(r.kind).toBe('reply');
  if (r.kind === 'reply') expect(r.materials).toHaveLength(1);
});

it('sends model, effort, fallbacks and the cached system block', async () => {
  const client = fakeAnthropic([reply([respond('Halo Kak')])]);
  await turn(client);
  const p = client.params[0]!;
  expect(p).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 16000, output_config: { effort: 'medium' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  expect((p['system'] as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  expect((p['system'] as unknown[]).length).toBe(3);
  for (const k of ['thinking', 'temperature', 'top_p', 'top_k', 'tool_choice']) expect(p).not.toHaveProperty(k);
  expect((p['tools'] as { name: string }[]).at(-1)!.name).toBe('respond_to_customer');
});

it('asks once more when the model answers in plain text, then fails', async () => {
  expect(await turn(fakeAnthropic([reply([text('Halo Kak')]), reply([text('Halo lagi')])]))).toMatchObject({ kind: 'failed', reason: 'NO_RESPOND_TOOL' });
  const ok = fakeAnthropic([reply([text('Halo Kak')]), reply([respond('Halo Kak')])]);
  expect(await turn(ok)).toMatchObject({ kind: 'reply', message: 'Halo Kak' });
  const last = (ok.params[1]!['messages'] as { role: string; content: unknown }[]).at(-1)!;
  expect(last).toMatchObject({ role: 'user' });
  expect(String(last.content)).toContain('respond_to_customer');
});

it('rewrites once on a failed reply check, then fails', async () => {
  expect(await turn(fakeAnthropic([reply([respond('Harganya Rp450 jt')]), reply([respond('Harganya Rp450 jt')])]))).toMatchObject({ kind: 'failed', reason: 'REPLY_CHECK' });
  const fixed = fakeAnthropic([reply([respond('Harganya Rp450 jt')]), reply([tool('search_units', { project: 'zetira' })]), reply([respond('Mulai Rp400 jt Kak')])]);
  expect(await turn(fixed)).toMatchObject({ kind: 'reply', message: 'Mulai Rp400 jt Kak' });
  const rejection = (fixed.params[1]!['messages'] as { role: string; content: { type: string; is_error?: boolean; content?: string }[] }[]).at(-1)!;
  expect(rejection.content[0]).toMatchObject({ type: 'tool_result', is_error: true });
  expect(rejection.content[0]!.content).toContain('Rp450 jt');
});

it('a max_tokens stop is marked in the trace', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const r = await turn(fakeAnthropic([reply([text('Halo Kak, harga')], 'max_tokens'), reply([respond('Halo Kak')])]));
  expect(r).toMatchObject({ kind: 'reply', message: 'Halo Kak' });
  expect(r.trace).toContainEqual({ tool: '(model)', input: null, isError: true, output: 'max_tokens' });
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

it('returns no_reply when the model chooses not to answer', async () => {
  expect(await turn(fakeAnthropic([reply([tool('respond_to_customer', { message: '', no_reply: true })])]))).toMatchObject({ kind: 'no_reply' });
});

it('maps a refusal to failed REFUSAL', async () => {
  expect(await turn(fakeAnthropic([reply([], 'refusal')]))).toMatchObject({ kind: 'failed', reason: 'REFUSAL' });
});

it('maps an API error to failed API_ERROR and stops after eight calls', async () => {
  expect(await turn(fakeAnthropic([new Error('overloaded')]))).toMatchObject({ kind: 'failed', reason: 'API_ERROR' });
  const looping = fakeAnthropic(Array.from({ length: 9 }, () => reply([tool('search_units', { project: 'zetira' })])));
  expect(await turn(looping)).toMatchObject({ kind: 'failed', reason: 'TOO_MANY_STEPS' });
  expect(looping.params).toHaveLength(8);
});

it('fails AI_NOT_CONFIGURED without a client', async () => {
  expect(await turn(null)).toMatchObject({ kind: 'failed', reason: 'AI_NOT_CONFIGURED' });
});
