import { inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { appSettings } from '../db/schema/index.js';

export type TemplateRef = { name: string; language: string };

export type AppSettings = {
  // Global switch: off means Moni stores messages but answers nobody.
  aiEnabled: boolean;
  // How Moni introduces itself before the customer's project is known.
  personaGroupName: string;
  // How long a human takeover pauses Moni.
  takeoverHours: number;
  // The business number messages we start go out from. Empty: the lead's conversation number.
  chakraPhoneNumberId: string;
  // WhatsApp templates approved in ChakraHQ; empty name: not set up yet, nothing is sent.
  salesAlertTemplate: TemplateRef;
  reassignNoticeTemplate: TemplateRef;
};

const DEFAULTS: AppSettings = {
  aiEnabled: true,
  personaGroupName: 'tim Vista Land',
  takeoverHours: 24,
  chakraPhoneNumberId: '',
  salesAlertTemplate: { name: '', language: 'id' },
  reassignNoticeTemplate: { name: '', language: 'id' },
};

// Stored under snake_case keys in app_settings, one row each.
const KEYS: Record<keyof AppSettings, string> = {
  aiEnabled: 'ai_enabled',
  personaGroupName: 'persona_group_name',
  takeoverHours: 'takeover_hours',
  chakraPhoneNumberId: 'chakra_phone_number_id',
  salesAlertTemplate: 'sales_alert_template',
  reassignNoticeTemplate: 'reassign_notice_template',
};

export async function getAppSettings(): Promise<AppSettings> {
  // Read the JSON as text: drizzle re-parses a jsonb string that looks like a number, which would
  // turn a stored phone number ID into a (possibly rounded) number.
  const rows = await getDb()
    .select({ key: appSettings.key, raw: sql<string>`${appSettings.value}::text` })
    .from(appSettings)
    .where(inArray(appSettings.key, Object.values(KEYS)));
  const stored = new Map(rows.map((r) => [r.key, JSON.parse(r.raw) as unknown]));
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
