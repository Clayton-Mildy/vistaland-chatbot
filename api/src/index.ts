import 'dotenv/config';
import { getConfig } from './config.js';
import { buildApp } from './app.js';
import { getVlesClient, startVlesSync } from './vles/sync.js';
import { createChakraClient } from './chakra/client.js';
import { createAnthropic } from './agent/claude.js';
import { createDebouncer } from './router/debounce.js';
import { chakraTransport } from './router/transport.js';
import { runTurn } from './router/turn.js';
import { handleInbound } from './router/inbound.js';
import { getConversation } from './leads/repository.js';
import { syncStaffReplies } from './chakra/staffSync.js';

const config = getConfig();
const vles = getVlesClient();
const chakra = createChakraClient({
  baseUrl: config.CHAKRA_BASE_URL,
  pluginId: config.CHAKRA_PLUGIN_ID,
  apiVersion: config.CHAKRA_API_VERSION,
  accessToken: config.CHAKRA_ACCESS_TOKEN,
});
const anthropic = createAnthropic();
if (!anthropic) console.log('[moni] ANTHROPIC_API_KEY is empty - every turn will be handed to staff');

const debouncer = createDebouncer({
  quietMs: config.TYPING_DEBOUNCE_MS,
  maxWaitMs: config.TYPING_MAX_WAIT_MS,
  maxBatch: 20,
  onFire: async (conversationId) => {
    const conv = await getConversation(conversationId);
    if (!conv) return;
    const out = await runTurn(conversationId, {
      transport: chakraTransport(chakra, conv.waPhoneNumberId ?? ''),
      anthropic,
      vles,
      now: () => new Date(),
      settings: { model: config.MONI_MODEL, effort: config.MONI_EFFORT },
      staffSync: config.CHAKRA_ACCESS_TOKEN ? (id) => syncStaffReplies(id, { client: chakra, now: () => new Date() }) : undefined,
    });
    const detail = out.result?.kind === 'failed' ? ` (${out.result.reason}: ${out.result.detail})` : '';
    console.log(`[moni] ${conversationId}: ${out.kind}, ${out.sent} sent${detail}`);
  },
});

const app = buildApp({
  chakra,
  onInbound: (m) =>
    handleInbound(m, { debouncer, transport: (phoneNumberId) => chakraTransport(chakra, phoneNumberId), now: () => new Date() }),
});

await app.listen({ port: config.PORT, host: '0.0.0.0' });

if (vles) startVlesSync(vles, config.VLES_SYNC_INTERVAL_MS);
else console.log('[vles] VLES_API_KEY is empty - sync is off');
