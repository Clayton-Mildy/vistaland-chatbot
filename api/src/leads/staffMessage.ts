import type { ChakraClient } from '../chakra/client.js';
import type { Contact, Conversation } from './repository.js';
import { insertOutbound } from './repository.js';

/**
 * Sends free text to a customer through ChakraHQ as a staff member and stores it in the chat as a
 * `staff` message: `sent` with the WhatsApp id, or `failed` when ChakraHQ refuses. Leaves Moni's
 * takeover state to the caller.
 */
export async function sendStaffText(
  chakra: ChakraClient,
  conv: Pick<Conversation, 'id' | 'waPhoneNumberId'>,
  contact: Pick<Contact, 'waPhone'>,
  staffUserId: string,
  body: string
): Promise<{ ok: true; id: string } | { ok: false; error: unknown }> {
  try {
    const sent = await chakra.sendText(conv.waPhoneNumberId ?? '', contact.waPhone, body);
    const row = await insertOutbound(conv.id, { sender: 'staff', staffUserId, kind: 'text', body, waMessageId: sent.waMessageId, status: 'sent' });
    return { ok: true, id: row.id };
  } catch (error) {
    await insertOutbound(conv.id, { sender: 'staff', staffUserId, kind: 'text', body, waMessageId: null, status: 'failed' });
    return { ok: false, error };
  }
}
