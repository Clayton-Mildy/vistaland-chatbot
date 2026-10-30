import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { seedProjects } from './helpers/vles.js';
import { getDb } from '../src/db/client.js';
import { contacts, conversations, kprSettings, leads, materials, messages } from '../src/db/schema/index.js';
import { listProjects } from '../src/repositories/projects.js';

beforeEach(() => truncate('projects', 'kpr_settings', 'materials', 'contacts'));

it('allows one default and one per-bank KPR row per project, not two defaults', async () => {
  await seedProjects();
  const p = (await listProjects())[0]!;
  const base = { projectId: p.id, fixedYears: 3, floatingRatePct: 11, dpOptionsPct: [5] };
  await getDb().insert(kprSettings).values({ ...base, bankId: null, fixedRatePct: 5, tenorOptions: [10, 15, 20] });
  await getDb().insert(kprSettings).values({ ...base, bankId: 2, fixedRatePct: 4.5, tenorOptions: [15], dpOptionsPct: [1] });
  await expect(
    getDb().insert(kprSettings).values({ ...base, bankId: null, fixedRatePct: 6, tenorOptions: [15] })
  ).rejects.toThrow();
});

it('rejects an unknown lead stage and an unknown material kind', async () => {
  await seedProjects();
  const p = (await listProjects())[0]!;
  const [c] = await getDb().insert(contacts).values({ waPhone: '6281111' }).returning();
  await expect(getDb().insert(leads).values({ contactId: c!.id, stage: 'won' as never })).rejects.toThrow();
  await expect(
    getDb().insert(materials).values({ projectId: p.id, kind: 'gif' as never, url: 'u', mime: 'image/gif', filename: 'a.gif' })
  ).rejects.toThrow();
});

it('keeps wa_message_id unique but allows many nulls', async () => {
  const [c] = await getDb().insert(contacts).values({ waPhone: '6282222' }).returning();
  const [conv] = await getDb().insert(conversations).values({ contactId: c!.id }).returning();
  const row = (waMessageId: string | null) => ({
    conversationId: conv!.id,
    waMessageId,
    direction: 'in' as const,
    sender: 'customer' as const,
    body: 'x',
    status: 'received' as const,
  });
  await getDb().insert(messages).values([row(null), row(null), row('wamid.X')]);
  await expect(getDb().insert(messages).values(row('wamid.X'))).rejects.toThrow();
});
