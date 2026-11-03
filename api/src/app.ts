import Fastify, { type FastifyInstance } from 'fastify';
import { getConfig } from './config.js';
import { staffRoutes } from './routes/staff.js';
import { vlesRoutes } from './routes/vles.js';
import { stockRoutes } from './routes/stock.js';
import { kprRoutes } from './routes/kpr.js';
import { mediaRoutes } from './routes/media.js';
import { catalogRoutes } from './routes/catalog.js';
import { webhookRoutes } from './routes/webhook.js';
import type { InboundMessage } from './chakra/parse.js';
import type { ChakraClient } from './chakra/client.js';
import { leadRoutes } from './routes/leads.js';
import { testChatRoutes, type AgentDeps } from './routes/testChat.js';
import { settingsRoutes } from './routes/settings.js';
import { rosterRoutes } from './routes/roster.js';
import { outboundRoutes } from './routes/outbound.js';

export type AppDeps = {
  // Handles each WhatsApp message the webhook accepts; index.ts wires the router in.
  onInbound?: (m: InboundMessage) => Promise<unknown>;
  // Sends staff replies from the dashboard.
  chakra?: ChakraClient;
  // The model and VLES client the test chat runs Moni with.
  agent?: AgentDeps;
};

export function buildApp(deps: AppDeps = {}): FastifyInstance {
  const proxyHops = getConfig().TRUST_PROXY_HOPS;
  const app = Fastify({
    logger: { level: getConfig().LOG_LEVEL },
    // Trust that many proxies in front of us, so req.ip is the real client.
    trustProxy: proxyHops > 0 ? (_address: string, hop: number) => hop < proxyHops : false,
  });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  void app.register(staffRoutes);
  void app.register(vlesRoutes);
  void app.register(stockRoutes);
  void app.register(kprRoutes);
  void app.register(mediaRoutes);
  void app.register(catalogRoutes);
  void app.register(leadRoutes({ chakra: deps.chakra }));
  void app.register(settingsRoutes);
  void app.register(rosterRoutes);
  void app.register(outboundRoutes);
  void app.register(
    testChatRoutes(deps.agent ?? { anthropic: null, vles: null, settings: { model: getConfig().MONI_MODEL, effort: getConfig().MONI_EFFORT } })
  );
  void app.register(webhookRoutes({ onInbound: deps.onInbound ?? (async () => undefined) }));

  return app;
}
