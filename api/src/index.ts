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
import { conversationsAwaitingReply, getConversation } from './leads/repository.js';
import { syncStaffReplies } from './chakra/staffSync.js';
import { createOutboundPoller } from './outbound/poller.js';
import { createWebPushNotifier } from './notify/push.js';
import { createAlerts } from './notify/alerts.js';

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

// Push stays off until both VAPID keys are set.
const alerts = createAlerts({
  notifier:
    config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY
      ? createWebPushNotifier({ publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY, subject: config.VAPID_SUBJECT })
      : null,
  dashboardUrl: config.DASHBOARD_PUBLIC_URL.replace(/\/+$/, ''),
});

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
      alerts,
      staffSync: config.CHAKRA_ACCESS_TOKEN ? (id) => syncStaffReplies(id, { client: chakra, now: () => new Date() }) : undefined,
    });
    const detail = out.result?.kind === 'failed' ? ` (${out.result.reason}: ${out.result.detail})` : '';
    console.log(`[moni] ${conversationId}: ${out.kind}, ${out.sent} sent${detail}`);
  },
});

const app = buildApp({
  chakra,
  alerts,
  agent: { anthropic, vles, settings: { model: config.MONI_MODEL, effort: config.MONI_EFFORT } },
  onInbound: (m) =>
    handleInbound(m, { debouncer, transport: (phoneNumberId) => chakraTransport(chakra, phoneNumberId), now: () => new Date() }),
});

await app.listen({ port: config.PORT, host: '0.0.0.0' });

// Turns waiting in the debouncer are lost on restart; queue whatever is still unanswered.
const waiting = await conversationsAwaitingReply(3_600_000);
for (const id of waiting) debouncer.push(id);
if (waiting.length) console.log(`[moni] re-queued ${waiting.length} unanswered conversation(s) after restart`);

if (vles) startVlesSync(vles, config.VLES_SYNC_INTERVAL_MS);
else console.log('[vles] VLES_API_KEY is empty - sync is off');

if (config.OUTBOUND_POLL_MS > 0) {
  // Without a configured token every row is held rather than sent into a failing client.
  const poller = createOutboundPoller({ chakra: config.CHAKRA_ACCESS_TOKEN ? chakra : null, now: () => new Date(), onFailed: (row) => alerts.outboundFailed(row) });
  poller.start(config.OUTBOUND_POLL_MS);
} else console.log('[outbound] OUTBOUND_POLL_MS is 0 - queued WhatsApp templates are not sent');
