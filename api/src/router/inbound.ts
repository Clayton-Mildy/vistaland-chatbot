import type { InboundMessage } from '../chakra/parse.js';
import { detectProject } from '../chakra/detectProject.js';
import { getAppSettings } from '../settings/appSettings.js';
import {
  ensureConversation,
  ensureLead,
  insertInbound,
  insertOutbound,
  isUnderTakeover,
  setLeadProject,
  setLeadStage,
  updateConversation,
  upsertContact,
} from '../leads/repository.js';
import type { Debouncer } from './debounce.js';
import type { Transport } from './transport.js';

export const CANNED_MEDIA_REPLY = 'Maaf Kak, Moni belum bisa membuka pesan suara atau video 🙏 Boleh dituliskan saja, Kak?';
const CANNED_EVERY_MS = 5 * 60_000;

/** Stores one inbound WhatsApp message and decides whether Moni should answer it. */
export async function handleInbound(
  msg: InboundMessage,
  deps: { debouncer: Debouncer; transport: (phoneNumberId: string) => Transport; isTest?: boolean; now: () => Date }
): Promise<'duplicate' | 'stored' | 'queued' | 'canned'> {
  const contact = await upsertContact(msg.from, msg.profileName, deps.isTest ?? false);
  const conv = await ensureConversation(contact.id, msg.phoneNumberId || null);
  let lead = await ensureLead(contact.id);

  const stored = await insertInbound(conv.id, { waMessageId: msg.waMessageId, kind: msg.kind, body: msg.text, createdAt: msg.sentAt });
  if (stored === 'duplicate') return 'duplicate';

  if (lead.stage === 'new') lead = await setLeadStage(lead.id, 'engaged', 'system');
  if (lead.currentProjectId === null) {
    const detected = await detectProject(msg);
    if (detected) {
      lead = await setLeadProject(lead.id, detected.projectId, 'system', {
        channel: detected.channel,
        contentKind: detected.contentKind,
        ref: detected.ref,
      });
    }
  }

  const now = deps.now();
  if (!(await getAppSettings()).aiEnabled || !conv.aiEnabled || isUnderTakeover(conv, now)) return 'stored';

  if (msg.kind === 'audio' || msg.kind === 'video' || msg.kind === 'other') {
    if (conv.lastCannedReplyAt && now.getTime() - conv.lastCannedReplyAt.getTime() < CANNED_EVERY_MS) return 'stored';
    try {
      const r = await deps.transport(msg.phoneNumberId).sendText(contact.waPhone, CANNED_MEDIA_REPLY);
      await insertOutbound(conv.id, { sender: 'moni', kind: 'text', body: CANNED_MEDIA_REPLY, waMessageId: r.waMessageId, status: 'sent' });
    } catch (err) {
      await insertOutbound(conv.id, { sender: 'moni', kind: 'text', body: CANNED_MEDIA_REPLY, waMessageId: null, status: 'failed' });
      console.error('[router] canned reply failed:', err instanceof Error ? err.message : err);
    }
    await updateConversation(conv.id, { lastCannedReplyAt: now });
    return 'canned';
  }

  deps.debouncer.push(conv.id);
  return 'queued';
}
