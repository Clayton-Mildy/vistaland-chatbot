import 'dotenv/config';
import { getConfig } from './config.js';
import { buildApp } from './app.js';
import { getVlesClient, startVlesSync } from './vles/sync.js';

const config = getConfig();
const app = buildApp();

await app.listen({ port: config.PORT, host: '0.0.0.0' });

const vles = getVlesClient();
if (vles) startVlesSync(vles, config.VLES_SYNC_INTERVAL_MS);
else console.log('[vles] VLES_API_KEY is empty - sync is off');
