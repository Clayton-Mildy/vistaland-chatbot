import 'dotenv/config';
import { getConfig } from './config.js';
import { buildApp } from './app.js';

const config = getConfig();
const app = buildApp();

await app.listen({ port: config.PORT, host: '0.0.0.0' });
