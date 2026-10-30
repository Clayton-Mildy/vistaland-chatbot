import { findChannelTag, listChannelTags } from '../repositories/channelTags.js';
import { listProjects } from '../repositories/projects.js';
import type { InboundMessage } from './parse.js';

export type DetectedProject = { projectId: number; channel: string | null; contentKind: string | null; ref: string };

const TAG = /\[([A-Za-z0-9-]{2,24})\]/g;

/**
 * Which project an inbound message is about: a "[TAG]" an ad put in the prefilled text, then the
 * Click-to-WhatsApp referral (a tag or a project name in the ad), else unknown.
 */
export async function detectProject(msg: Pick<InboundMessage, 'text' | 'referral'>): Promise<DetectedProject | null> {
  for (const m of msg.text.matchAll(TAG)) {
    const tag = await findChannelTag(m[1]!);
    if (tag) return { projectId: tag.projectId, channel: tag.channel, contentKind: tag.contentKind, ref: tag.tag };
  }

  const r = msg.referral;
  if (!r) return null;
  const adText = [r.headline, r.body, r.sourceUrl].filter(Boolean).join(' ').toLowerCase();
  if (!adText) return null;
  for (const tag of await listChannelTags()) {
    if (adText.includes(tag.tag.toLowerCase())) {
      return { projectId: tag.projectId, channel: tag.channel, contentKind: tag.contentKind, ref: tag.tag };
    }
  }
  // Longest name first, so "Gran Harmoni Cibitung" wins over a shorter name inside it.
  const projects = (await listProjects()).filter((p) => p.active).sort((a, b) => b.displayName.length - a.displayName.length);
  const hit = projects.find((p) => adText.includes(p.displayName.toLowerCase()));
  if (!hit) return null;
  return { projectId: hit.id, channel: 'other', contentKind: 'general', ref: r.sourceUrl ?? r.headline ?? hit.slug };
}
