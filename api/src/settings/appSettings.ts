import { inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { appSettings } from '../db/schema/index.js';

export type AppSettings = {
  // Global switch: off means Moni stores messages but answers nobody.
  aiEnabled: boolean;
  // How Moni introduces itself before the customer's project is known.
  personaGroupName: string;
  // How long a human takeover pauses Moni.
  takeoverHours: number;
};

const DEFAULTS: AppSettings = { aiEnabled: true, personaGroupName: 'tim Vista Land', takeoverHours: 24 };

// Stored under snake_case keys in app_settings, one row each.
const KEYS: Record<keyof AppSettings, string> = {
  aiEnabled: 'ai_enabled',
  personaGroupName: 'persona_group_name',
  takeoverHours: 'takeover_hours',
};

export async function getAppSettings(): Promise<AppSettings> {
  const rows = await getDb()
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, Object.values(KEYS)));
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...DEFAULTS };
  for (const [field, key] of Object.entries(KEYS) as [keyof AppSettings, string][]) {
    if (stored.has(key)) (out as Record<string, unknown>)[field] = stored.get(key);
  }
  return out;
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const db = getDb();
  for (const [field, value] of Object.entries(patch) as [keyof AppSettings, unknown][]) {
    if (value === undefined) continue;
    await db
      .insert(appSettings)
      .values({ key: KEYS[field], value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }
  return getAppSettings();
}
