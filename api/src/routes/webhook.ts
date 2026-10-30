import type { FastifyInstance } from 'fastify';
import { getConfig } from '../config.js';
import { verifyChakraSignature } from '../chakra/signature.js';
import { parseWebhook, type InboundMessage } from '../chakra/parse.js';

export type WebhookDeps = { onInbound: (m: InboundMessage) => Promise<unknown> };

/**
 * ChakraHQ's webhook. Always answers 200 at once, so ChakraHQ never retries: a bad signature is
 * dropped, and good messages are handled in the background.
 */
export function webhookRoutes(deps: WebhookDeps) {
  return async (app: FastifyInstance): Promise<void> => {
    // Scoped to this plugin: the signature is over the exact bytes received.
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
      try {
        done(null, JSON.parse((body as Buffer).toString('utf8') || '{}'));
      } catch {
        done(null, {});
      }
    });

    app.get('/webhook', async (_req, reply) => reply.type('text/plain').send('OK'));

    app.post('/webhook', async (req, reply) => {
      const cfg = getConfig();
      const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
      const header = req.headers['x-chakra-signature-256'];
      const skip = cfg.NODE_ENV === 'development' && cfg.SKIP_HMAC_IN_DEV;
      if (!skip && !verifyChakraSignature(raw, typeof header === 'string' ? header : undefined, cfg.CHAKRA_WEBHOOK_SECRET)) {
        req.log.warn('webhook signature mismatch; dropped');
        return reply.code(200).send();
      }
      const messages = parseWebhook(req.body);
      void reply.code(200).send();
      for (const m of messages) {
        deps.onInbound(m).catch((err) => req.log.error({ err, waMessageId: m.waMessageId }, 'inbound handling failed'));
      }
      return reply;
    });
  };
}
