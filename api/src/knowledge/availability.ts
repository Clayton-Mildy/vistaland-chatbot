import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { getProject } from '../repositories/projects.js';
import type { VlesClient } from '../vles/client.js';
import { sellableUnits } from './units.js';

export type AvailabilityResult =
  | { verified: true; units: { unitNumber: string; facing: string | null; price: number | null }[]; checkedAt: string }
  | { verified: false; reason: 'NOT_CONFIGURED' | 'VLES_UNAVAILABLE' | 'NONE_AVAILABLE' };

/**
 * Asks VLES live about a few locally-available units before Moni names one. The local copy can be
 * up to 15 minutes old, and a unit sold in that time must not be offered.
 */
export async function checkAvailability(
  client: VlesClient | null,
  input: { projectId: number; houseTypeId: number; facing?: string; max?: number }
): Promise<AvailabilityResult> {
  if (!client) return { verified: false, reason: 'NOT_CONFIGURED' };
  const project = await getProject(input.projectId);
  if (!project) return { verified: false, reason: 'NONE_AVAILABLE' };

  const facing = input.facing ? sql`and lower(u.facing) = lower(${input.facing})` : sql``;
  const candidates = (
    await getDb().execute<{ id: number }>(sql`
      select u.id from vles_units u
      where ${sellableUnits(project)} and u.house_type_id = ${input.houseTypeId} ${facing}
      order by u.selling_price, u.unit_number
      limit ${input.max ?? 3}
    `)
  ).rows;
  if (candidates.length === 0) return { verified: false, reason: 'NONE_AVAILABLE' };

  const units: { unitNumber: string; facing: string | null; price: number | null }[] = [];
  let failures = 0;
  for (const { id } of candidates) {
    try {
      const live = await client.getUnit(id);
      if (live && live.data.is_available_for_sale && !live.data.deleted) {
        units.push({ unitNumber: live.data.unit_number, facing: live.data.facing?.name ?? null, price: live.data.selling_price });
      }
    } catch {
      failures++;
    }
  }
  if (failures === candidates.length) return { verified: false, reason: 'VLES_UNAVAILABLE' };
  if (units.length === 0) return { verified: false, reason: 'NONE_AVAILABLE' };
  return { verified: true, units, checkedAt: new Date().toISOString() };
}
