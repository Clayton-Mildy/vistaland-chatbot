import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { kprSettings, schemeDpOverrides } from '../db/schema/index.js';
import type { KprAssumptions } from './calculator.js';

export type KprSettingsRow = typeof kprSettings.$inferSelect;
export type KprSettingsInput = Omit<typeof kprSettings.$inferInsert, 'id' | 'updatedAt'>;

const toAssumptions = (r: KprSettingsRow): KprAssumptions => ({
  fixedRatePct: r.fixedRatePct,
  fixedYears: r.fixedYears,
  floatingRatePct: r.floatingRatePct,
  tenorOptions: r.tenorOptions,
  dpOptionsPct: r.dpOptionsPct,
});

/** The bank's row when one exists, else the project default; null when the project has neither. */
export async function getKprAssumptions(projectId: number, bankId?: number | null): Promise<KprAssumptions | null> {
  const db = getDb();
  if (bankId != null) {
    const [bank] = await db
      .select()
      .from(kprSettings)
      .where(and(eq(kprSettings.projectId, projectId), eq(kprSettings.bankId, bankId)))
      .limit(1);
    if (bank) return toAssumptions(bank);
  }
  const [def] = await db
    .select()
    .from(kprSettings)
    .where(and(eq(kprSettings.projectId, projectId), isNull(kprSettings.bankId)))
    .limit(1);
  return def ? toAssumptions(def) : null;
}

export async function listKprSettings(projectId: number): Promise<KprSettingsRow[]> {
  return getDb()
    .select()
    .from(kprSettings)
    .where(eq(kprSettings.projectId, projectId))
    .orderBy(asc(kprSettings.bankId));
}

export async function upsertKprSettings(row: KprSettingsInput): Promise<KprSettingsRow> {
  const { projectId, bankId, ...rest } = row;
  const [saved] = await getDb()
    .insert(kprSettings)
    .values(row)
    .onConflictDoUpdate({
      target: [kprSettings.projectId, kprSettings.bankId],
      set: { ...rest, updatedAt: new Date() },
    })
    .returning();
  if (!saved) throw new Error(`Failed to save KPR settings for project ${projectId}, bank ${bankId}`);
  return saved;
}

export async function getSchemeDpOverride(name: string): Promise<number | null> {
  const [row] = await getDb().select().from(schemeDpOverrides).where(eq(schemeDpOverrides.schemeName, name)).limit(1);
  return row?.dpPct ?? null;
}

export async function listSchemeDpOverrides(): Promise<{ schemeName: string; dpPct: number }[]> {
  return getDb().select().from(schemeDpOverrides).orderBy(asc(schemeDpOverrides.schemeName));
}

export async function setSchemeDpOverride(name: string, dpPct: number): Promise<void> {
  await getDb()
    .insert(schemeDpOverrides)
    .values({ schemeName: name, dpPct })
    .onConflictDoUpdate({ target: schemeDpOverrides.schemeName, set: { dpPct } });
}
