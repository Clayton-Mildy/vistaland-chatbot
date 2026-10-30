import { and, asc, eq, getTableColumns, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { getDb } from '../db/client.js';
import {
  vlesUnits,
  vlesUnitTypes,
  vlesPromos,
  vlesMortgageBanks,
  vlesUnitSchemes,
  vlesSyncState,
  type SyncStateRow,
} from '../db/schema/index.js';
import {
  isTombstone,
  VlesUnitRaw,
  VlesUnitTypeRaw,
  VlesPromoRaw,
  VlesMortgageBankRaw,
  type VlesListEndpoint,
  type VlesSchemeRaw,
} from './types.js';
import { mapUnit, mapUnitType, mapPromo, mapMortgageBank, mapSchemes } from './mappers.js';

type VlesRowTable = typeof vlesUnits | typeof vlesUnitTypes | typeof vlesPromos | typeof vlesMortgageBanks;

const TABLES: Record<VlesListEndpoint, { table: VlesRowTable; map: (raw: unknown, at: Date) => Record<string, unknown> }> = {
  units: { table: vlesUnits, map: (r, at) => mapUnit(VlesUnitRaw.parse(r), at) },
  'unit-types': { table: vlesUnitTypes, map: (r, at) => mapUnitType(VlesUnitTypeRaw.parse(r), at) },
  promos: { table: vlesPromos, map: (r, at) => mapPromo(VlesPromoRaw.parse(r), at) },
  'mortgage-banks': { table: vlesMortgageBanks, map: (r, at) => mapMortgageBank(VlesMortgageBankRaw.parse(r), at) },
};

/** `set` for ON CONFLICT DO UPDATE that takes every non-key column from the incoming row. */
function excludedSet(table: PgTable, keys: string[]): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const [prop, col] of Object.entries(getTableColumns(table))) {
    if (!keys.includes(prop)) set[prop] = sql.raw(`excluded."${col.name}"`);
  }
  return set;
}

/**
 * Upserts one page of a VLES list endpoint. Live rows replace the stored row; tombstones
 * ({id, deleted: true}) only flag an existing row deleted, keeping what we knew about it.
 * VLES repeats rows within its 7-hour lookback, so this must be idempotent.
 */
export async function upsertPage(
  endpoint: VlesListEndpoint,
  rows: unknown[],
  syncedAt: Date
): Promise<{ upserted: number; tombstoned: number }> {
  const { table, map } = TABLES[endpoint];
  const tombstoneIds = rows.filter(isTombstone).map((r) => r.id);
  const live = rows.filter((r) => !isTombstone(r)).map((r) => map(r, syncedAt));

  const db = getDb();
  if (live.length > 0) {
    await db
      .insert(table)
      .values(live as never)
      .onConflictDoUpdate({ target: table.id, set: excludedSet(table, ['id']) });
  }
  if (tombstoneIds.length > 0) {
    await db.update(table).set({ deleted: true, syncedAt }).where(inArray(table.id, tombstoneIds));
  }
  return { upserted: live.length, tombstoned: tombstoneIds.length };
}

export async function replaceUnitSchemes(unitId: number, schemes: VlesSchemeRaw[], syncedAt: Date): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.delete(vlesUnitSchemes).where(eq(vlesUnitSchemes.unitId, unitId));
    if (schemes.length > 0) await tx.insert(vlesUnitSchemes).values(mapSchemes(unitId, schemes, syncedAt));
  });
}

/** Deletes the schemes of every unit not in `unitIds`; returns how many rows went. */
export async function deleteSchemesExceptUnits(unitIds: number[]): Promise<number> {
  const db = getDb();
  const deleted =
    unitIds.length > 0
      ? await db.delete(vlesUnitSchemes).where(notInArray(vlesUnitSchemes.unitId, unitIds)).returning({ id: vlesUnitSchemes.unitId })
      : await db.delete(vlesUnitSchemes).returning({ id: vlesUnitSchemes.unitId });
  return deleted.length;
}

export async function listAvailableUnitIds(): Promise<number[]> {
  const rows = await getDb()
    .select({ id: vlesUnits.id })
    .from(vlesUnits)
    .where(and(eq(vlesUnits.isAvailableForSale, true), eq(vlesUnits.deleted, false)))
    .orderBy(asc(vlesUnits.id));
  return rows.map((r) => r.id);
}

// ─── sync state ─────────────────────────────────────────────────────────────

export async function getSyncState(endpoint: string): Promise<SyncStateRow | null> {
  const [row] = await getDb().select().from(vlesSyncState).where(eq(vlesSyncState.endpoint, endpoint)).limit(1);
  return row ?? null;
}

export async function listSyncStates(): Promise<SyncStateRow[]> {
  return getDb().select().from(vlesSyncState).orderBy(asc(vlesSyncState.endpoint));
}

export async function markSyncStarted(endpoint: string, at: Date): Promise<void> {
  await getDb()
    .insert(vlesSyncState)
    .values({ endpoint, lastRunAt: at })
    .onConflictDoUpdate({ target: vlesSyncState.endpoint, set: { lastRunAt: at } });
}

/** Records a completed pass. A null serverTime keeps the stored one (scheme refreshes have none). */
export async function markSyncOk(endpoint: string, serverTime: string | null, at: Date): Promise<void> {
  const lastServerTime = serverTime ? new Date(serverTime) : null;
  await getDb()
    .insert(vlesSyncState)
    .values({ endpoint, lastServerTime, lastOkAt: at, lastError: null })
    .onConflictDoUpdate({
      target: vlesSyncState.endpoint,
      set: {
        lastServerTime: sql`coalesce(excluded.last_server_time, ${vlesSyncState.lastServerTime})`,
        lastOkAt: at,
        lastError: null,
      },
    });
}

export async function markSyncError(endpoint: string, message: string, at: Date): Promise<void> {
  await getDb()
    .insert(vlesSyncState)
    .values({ endpoint, lastRunAt: at, lastError: message })
    .onConflictDoUpdate({ target: vlesSyncState.endpoint, set: { lastError: message } });
}
