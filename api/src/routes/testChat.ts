import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireApiSecret } from '../middleware/apiSecret.js';
import { getDb } from '../db/client.js';
import { contacts } from '../db/schema/index.js';
import type { AnthropicLike } from '../agent/claude.js';
import type { VlesClient } from '../vles/client.js';
import { handleInbound } from '../router/inbound.js';
import { runTurn } from '../router/turn.js';
import { recordingTransport } from '../router/transport.js';
import { getConversationByContact, getLeadByContact, upsertContact } from '../leads/repository.js';

export type AgentDeps = {
  anthropic: AnthropicLike | null;
  vles: VlesClient | null;
  settings: { model: string; effort: 'low' | 'medium' | 'high' };
};

const StaffParams = z.object({ staffId: z.uuid() });

/**
 * The dashboard's test chat: the real router and agent against a test contact, with a recording
 * transport instead of ChakraHQ, and no debounce. Test contacts stay out of Leads and reports.
 */
export function testChatRoutes(deps: AgentDeps) {
  return async (app: FastifyInstance): Promise<void> => {
    const opts = { preHandler: [requireApiSecret] };

    app.post('/api/v1/test-chat/:staffId/messages', opts, async (req, reply) => {
      const p = StaffParams.safeParse(req.params);
      const body = z.object({ text: z.string().trim().min(1).max(4000) }).safeParse(req.body);
      if (!p.success || !body.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      const waPhone = `test-${p.data.staffId}`;
      const transport = recordingTransport();
      const now = () => new Date();
      const inbound = await handleInbound(
        {
          waMessageId: `test-${randomUUID()}`,
          from: waPhone,
          profileName: null,
          phoneNumberId: 'test',
          sentAt: now(),
          kind: 'text',
          text: body.data.text,
          mediaId: null,
          referral: null,
        },
        { debouncer: { push: () => undefined, pending: () => false }, transport: () => transport, isTest: true, now }
      );
      const contact = await upsertContact(waPhone, null, true);
      let outcome = inbound === 'canned' ? 'canned' : 'skipped';
      let trace: unknown[] = [];
      let failure: string | null = null;
      if (inbound === 'queued') {
        const conv = await getConversationByContact(contact.id);
        const out = await runTurn(conv!.id, { transport, anthropic: deps.anthropic, vles: deps.vles, now, settings: deps.settings });
        outcome = out.kind;
        trace = out.result?.trace ?? [];
        if (out.result?.kind === 'failed') failure = `${out.result.reason}: ${out.result.detail}`;
      }
      return reply.send({
        data: { outbound: transport.sent, outcome, trace, failure, lead: await getLeadByContact(contact.id) },
        error: null,
      });
    });

    app.delete('/api/v1/test-chat/:staffId', opts, async (req, reply) => {
      const p = StaffParams.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      // Cascades to the conversation, messages, lead and its events.
      await getDb().delete(contacts).where(eq(contacts.waPhone, `test-${p.data.staffId}`));
      return reply.send({ data: { reset: true }, error: null });
    });
  };
}
