import { and, eq, gt, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { messages } from '../db/schema/index.js';
import { getAppSettings } from '../settings/appSettings.js';
import { getContact, getConversation, insertOutbound, lastOutboundAt } from '../leads/repository.js';
import type { ChakraClient, ChakraChatMessage } from './client.js';

const HISTORY = 20;

/**
 * Imports replies staff typed in ChakraHQ's own inbox for one conversation, right before Moni
 * answers it. They reach us only this way: an outbound message in ChakraHQ's history whose wamid
 * we never sent. Returns true when one newer than Moni's last message (or, before Moni has spoken,
 * within the takeover window) was found. Never throws: a slow ChakraHQ must not silence Moni.
 */
export async function syncStaffReplies(
  conversationId: string,
  deps: { client: ChakraClient; now: () => Date; timeoutMs?: number }
): Promise<boolean> {
  try {
    const conv = await getConversation(conversationId);
    const contact = conv ? await getContact(conv.contactId) : null;
    if (!conv || !contact || contact.isTest) return false;

    const history = await withTimeout(
      (async () => {
        const chatId = await deps.client.findChatId(contact.waPhone);
        return chatId ? deps.client.listChatMessages(chatId, HISTORY) : [];
      })(),
      deps.timeoutMs ?? 5000
    );
    if (!history) return false;

    const outbound = history.filter((m) => m.direction !== 'INBOUND' && m.externalId);
    if (outbound.length === 0) return false;
    const db = getDb();
    const known = new Set(
      (
        await db
          .select({ id: messages.waMessageId })
          .from(messages)
          .where(inArray(messages.waMessageId, outbound.map((m) => m.externalId!)))
      ).map((r) => r.id)
    );

    const now = deps.now();
    const since =
      (await lastOutboundAt(conversationId)) ?? new Date(now.getTime() - (await getAppSettings()).takeoverHours * 3_600_000);
    // A Moni send we recorded as failed may still have reached WhatsApp; it is not staff.
    const failedMoni = new Set(
      (
        await db
          .select({ body: messages.body })
          .from(messages)
          .where(and(eq(messages.conversationId, conversationId), eq(messages.sender, 'moni'), eq(messages.status, 'failed'), gt(messages.createdAt, new Date(now.getTime() - 86_400_000))))
      ).map((r) => r.body)
    );

    let found = false;
    for (const m of outbound.sort((a, b) => ts(a) - ts(b))) {
      if (known.has(m.externalId!) || ts(m) <= since.getTime()) continue;
      const body = m.text?.trim() || `[${m.dataType ?? 'pesan'}]`;
      if (failedMoni.has(body)) continue;
      await insertOutbound(conversationId, { sender: 'staff', kind: 'text', body, waMessageId: m.externalId!, status: 'sent', createdAt: new Date(ts(m)) });
      found = true;
    }
    return found;
  } catch (err) {
    console.error(`[chakra] staff reply sync failed for ${conversationId}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

const ts = (m: ChakraChatMessage) => m.timestamp ?? m.createdAt ?? 0;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)));
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
