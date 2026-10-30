import type { FastifyInstance } from 'fastify';
import { requireApiSecret } from '../middleware/apiSecret.js';
import { listSyncStates } from '../vles/repository.js';
import { getVlesClient, isVlesSyncRunning, runVlesSync } from '../vles/sync.js';

export async function vlesRoutes(app: FastifyInstance): Promise<void> {
  // Starts a pass and answers at once; the dashboard reads progress from sync-state.
  app.post('/api/v1/vles/sync', { preHandler: [requireApiSecret] }, async (request, reply) => {
    const client = getVlesClient();
    if (!client) return reply.code(409).send({ data: null, error: 'VLES_NOT_CONFIGURED' });
    if (isVlesSyncRunning()) return reply.code(202).send({ data: { started: false }, error: null });
    runVlesSync(client).catch((err) => request.log.error({ err }, 'manual VLES sync crashed'));
    return reply.code(202).send({ data: { started: true }, error: null });
  });

  app.get('/api/v1/vles/sync-state', { preHandler: [requireApiSecret] }, async (_request, reply) => {
    return reply.send({ data: await listSyncStates(), error: null });
  });
}
