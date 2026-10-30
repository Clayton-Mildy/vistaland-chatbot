import { asc, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { channelTags } from '../db/schema/index.js';

export type ChannelTag = typeof channelTags.$inferSelect;
export const TAG_PATTERN = /^[A-Z0-9-]{2,24}$/;

export async function listChannelTags(): Promise<ChannelTag[]> {
  return getDb().select().from(channelTags).orderBy(asc(channelTags.tag));
}

export async function findChannelTag(tag: string): Promise<ChannelTag | null> {
  const [row] = await getDb().select().from(channelTags).where(eq(channelTags.tag, tag.toUpperCase())).limit(1);
  return row ?? null;
}

export async function upsertChannelTag(row: ChannelTag): Promise<ChannelTag> {
  const value = { ...row, tag: row.tag.toUpperCase() };
  const [saved] = await getDb()
    .insert(channelTags)
    .values(value)
    .onConflictDoUpdate({ target: channelTags.tag, set: { projectId: value.projectId, channel: value.channel, contentKind: value.contentKind } })
    .returning();
  if (!saved) throw new Error(`Failed to save channel tag ${value.tag}`);
  return saved;
}

export async function deleteChannelTag(tag: string): Promise<void> {
  await getDb().delete(channelTags).where(eq(channelTags.tag, tag.toUpperCase()));
}
