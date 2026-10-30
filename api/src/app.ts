import Fastify, { type FastifyInstance } from 'fastify';
import { staffRoutes } from './routes/staff.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  void app.register(staffRoutes);

  return app;
}
