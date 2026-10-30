import type { FastifyInstance } from 'fastify';
import { requireApiSecret } from '../middleware/apiSecret.js';
import { getStockSummary } from '../stock/summary.js';

export async function stockRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/stock', { preHandler: [requireApiSecret] }, async (_request, reply) => {
    return reply.send({ data: await getStockSummary(), error: null });
  });
}
