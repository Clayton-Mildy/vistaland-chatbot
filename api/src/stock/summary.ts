import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { listProjects } from '../repositories/projects.js';
import { listSyncStates } from '../vles/repository.js';
import type { SyncStateRow } from '../db/schema/index.js';

/** Spec 8: VLES data older than this is flagged in the dashboard. */
export const STALE_AFTER_MS = 7_200_000;

export type TypeStock = {
  houseTypeId: number;
  houseTypeName: string;
  salesCategory: string | null;
  // Smallest and largest land size of the type: corner (HOOK) and oversized lots vary.
  landSizeMin: number | null;
  landSizeMax: number | null;
  buildingSize: number | null;
  availableUnits: number;
  totalUnits: number;
  minPrice: number | null;
  maxPrice: number | null;
  unpricedAvailable: number;
  outOfPeriodAvailable: number;
};

export type ProjectStock = {
  projectId: number;
  slug: string;
  displayName: string;
  availableUnits: number;
  totalUnits: number;
  types: TypeStock[];
};

export type StockSummary = {
  projects: ProjectStock[];
  unassignedAreas: { vlesProjectId: number; areaId: number; areaName: string; units: number; availableUnits: number }[];
  syncStates: SyncStateRow[];
  stale: boolean;
};

type TypeRow = {
  project_id: number;
  house_type_id: number;
  house_type_name: string;
  sales_category: string | null;
  land_size: number | null;
  land_size_max: number | null;
  building_size: number | null;
  total: number;
  available: number;
  min_price: string | null;
  max_price: string | null;
  unpriced: number;
  out_of_period: number;
};

type AreaRow = { project_id: number; area_id: number; area_name: string; units: number; available: number };

const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

export async function getStockSummary(now: Date = new Date()): Promise<StockSummary> {
  const db = getDb();

  // A unit belongs to the project whose VLES project and area list contain it.
  const typeRows = (
    await db.execute<TypeRow>(sql`
      select p.id as project_id, u.house_type_id, u.house_type_name,
        max(u.sales_category) as sales_category,
        min(u.land_size) as land_size,
        max(u.land_size) as land_size_max,
        max(u.building_size) as building_size,
        count(*)::int as total,
        (count(*) filter (where u.is_available_for_sale))::int as available,
        min(u.selling_price) filter (where u.is_available_for_sale and u.selling_price is not null) as min_price,
        max(u.selling_price) filter (where u.is_available_for_sale and u.selling_price is not null) as max_price,
        (count(*) filter (where u.is_available_for_sale and u.selling_price is null))::int as unpriced,
        (count(*) filter (where u.is_available_for_sale and u.price_list_in_period = false))::int as out_of_period
      from projects p
      join vles_units u
        on u.project_id = p.vles_project_id and u.area_id = any(p.vles_area_ids) and not u.deleted
      where p.active
      group by p.id, u.house_type_id, u.house_type_name
    `)
  ).rows;

  // Areas no project lists (active or not): VLES grew a cluster nobody has mapped yet.
  const areaRows = (
    await db.execute<AreaRow>(sql`
      select u.project_id, u.area_id, max(u.area_name) as area_name,
        count(*)::int as units,
        (count(*) filter (where u.is_available_for_sale))::int as available
      from vles_units u
      where not u.deleted
        and not exists (
          select 1 from projects p where p.vles_project_id = u.project_id and u.area_id = any(p.vles_area_ids)
        )
      group by u.project_id, u.area_id
      order by u.project_id, u.area_id
    `)
  ).rows;

  const projects: ProjectStock[] = (await listProjects())
    .filter((p) => p.active)
    .map((p) => {
      const types: TypeStock[] = typeRows
        .filter((r) => r.project_id === p.id)
        .map((r) => ({
          houseTypeId: r.house_type_id,
          houseTypeName: r.house_type_name,
          salesCategory: r.sales_category,
          landSizeMin: num(r.land_size),
          landSizeMax: num(r.land_size_max),
          buildingSize: num(r.building_size),
          availableUnits: r.available,
          totalUnits: r.total,
          minPrice: num(r.min_price),
          maxPrice: num(r.max_price),
          unpricedAvailable: r.unpriced,
          outOfPeriodAvailable: r.out_of_period,
        }))
        .sort((a, b) => (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity) || a.houseTypeName.localeCompare(b.houseTypeName));
      return {
        projectId: p.id,
        slug: p.slug,
        displayName: p.displayName,
        availableUnits: types.reduce((n, t) => n + t.availableUnits, 0),
        totalUnits: types.reduce((n, t) => n + t.totalUnits, 0),
        types,
      };
    });

  const syncStates = await listSyncStates();
  const unitsOk = syncStates.find((s) => s.endpoint === 'units')?.lastOkAt;
  const stale = !unitsOk || now.getTime() - unitsOk.getTime() > STALE_AFTER_MS;

  return {
    projects,
    unassignedAreas: areaRows.map((r) => ({
      vlesProjectId: r.project_id,
      areaId: r.area_id,
      areaName: r.area_name,
      units: r.units,
      availableUnits: r.available,
    })),
    syncStates,
    stale,
  };
}
