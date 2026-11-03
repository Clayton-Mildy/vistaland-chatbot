import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(50060),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().url(),
  // The dashboard's server sends this as a bearer token; nothing else calls the API's /api/v1.
  API_SECRET_KEY: z.string().min(32),
  // VLES integration (read-only). An empty key turns the sync off.
  VLES_BASE_URL: z.string().url().default('https://vles.vistalandapp.com/api/v1/integration'),
  VLES_API_KEY: z.string().default(''),
  // 0 disables the background sync; the dashboard's "Sinkronkan sekarang" still works.
  VLES_SYNC_INTERVAL_MS: z.coerce.number().int().min(0).default(900_000),
  // VLES allows 120 requests/minute per key; stay under it.
  VLES_MAX_REQ_PER_MIN: z.coerce.number().int().min(1).max(120).default(100),
  // Public origin WhatsApp fetches materials from (Caddy routes /media/* to the API).
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:50060'),
  MEDIA_DIR: z.string().default('./media'),
  // ChakraHQ (WhatsApp Business provider). Empty token: Moni cannot send.
  CHAKRA_BASE_URL: z.string().url().default('https://api.chakrahq.com'),
  CHAKRA_PLUGIN_ID: z.string().default(''),
  CHAKRA_API_VERSION: z.string().default('v22.0'),
  CHAKRA_ACCESS_TOKEN: z.string().default(''),
  // Webhooks with a wrong or missing signature are acknowledged and dropped.
  CHAKRA_WEBHOOK_SECRET: z.string().default(''),
  // Honoured only with NODE_ENV=development, for local webhook testing.
  SKIP_HMAC_IN_DEV: z.stringbool().default(false),
  // Claude. An empty key makes every turn fail over to staff.
  ANTHROPIC_API_KEY: z.string().default(''),
  MONI_MODEL: z.string().default('claude-opus-5-5'),
  MONI_EFFORT: z.enum(['low', 'medium', 'high']).default('medium'),
  // Proxies in front of the API (Caddy is one). >0 makes req.ip the real client; 0 trusts none.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  // Per client IP, for the public /media files. 0 turns the limit off.
  MEDIA_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(0).default(600),
  // Wait for the customer to pause: this long after the last message, at most TYPING_MAX_WAIT_MS
  // after the first.
  TYPING_DEBOUNCE_MS: z.coerce.number().int().min(0).default(8000),
  TYPING_MAX_WAIT_MS: z.coerce.number().int().min(0).default(30000),
});

export type Config = z.infer<typeof envSchema>;

export function parseConfig(env: Record<string, string | undefined>): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) _config = parseConfig(process.env);
  return _config;
}
