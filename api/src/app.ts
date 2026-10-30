import Fastify, { type FastifyInstance } from 'fastify';
import { getConfig } from './config.js';
import { staffRoutes } from './routes/staff.js';
import { vlesRoutes } from './routes/vles.js';
import { stockRoutes } from './routes/stock.js';
import { kprRoutes } from './routes/kpr.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: getConfig().LOG_LEVEL },
  });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  void app.register(staffRoutes);
  void app.register(vlesRoutes);
  void app.register(stockRoutes);
  void app.register(kprRoutes);

  return app;
}
