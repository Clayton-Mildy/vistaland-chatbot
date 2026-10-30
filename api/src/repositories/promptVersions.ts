import { desc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { promptVersions } from '../db/schema/index.js';
import { FLOW_MONI } from '../agent/prompts/flowMoni.js';

export type PromptVersion = typeof promptVersions.$inferSelect;

/** The newest saved version, or the built-in playbook (id 0) before any is saved. */
export async function currentPrompt(): Promise<{ id: number; text: string }> {
  const [row] = await getDb().select().from(promptVersions).orderBy(desc(promptVersions.id)).limit(1);
  return row ? { id: row.id, text: row.text } : { id: 0, text: FLOW_MONI };
}

export async function listPromptVersions(limit = 10): Promise<PromptVersion[]> {
  return getDb().select().from(promptVersions).orderBy(desc(promptVersions.id)).limit(limit);
}

export async function savePromptVersion(text: string, staffUserId: string | null): Promise<PromptVersion> {
  const [row] = await getDb().insert(promptVersions).values({ text, createdBy: staffUserId }).returning();
  if (!row) throw new Error('Failed to save prompt version');
  return row;
}
