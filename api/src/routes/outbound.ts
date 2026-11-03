import type { FastifyInstance } from 'fastify';
import { requireApiSecret } from '../middleware/apiSecret.js';
import { outboundSummary } from '../outbound/repository.js';

export async function outboundRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/outbound/summary', { preHandler: [requireApiSecret] }, async (_req, reply) =>
    reply.send({ data: await outboundSummary(new Date()), error: null })
  );
}
