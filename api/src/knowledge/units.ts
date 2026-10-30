import { and, eq, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { projects, typeProfiles, vlesPromos, promoCopy } from '../db/schema/index.js';
import type { Project } from '../repositories/projects.js';
import { getProject } from '../repositories/projects.js';
import { activeMaterials, type MaterialKind } from '../repositories/materials.js';
import { MATERIAL_KINDS } from '../db/schema/index.js';
import { getKprAssumptions, getSchemeDpOverride } from '../kpr/assumptions.js';
import { parseDpFromSchemeName, simulateKpr } from '../kpr/calculator.js';
import { todayWib } from './format.js';

export type TypeOption = {
  houseTypeId: number;
  name: string;
  marketingName: string | null;
  bedrooms: number | null;
  landSizeMin: number | null;
  landSizeMax: number | null;
  buildingSize: number | null;
  salesCategory: string | null;
  availableUnits: number;
  fromPrice: number;
  fromKprSchemePrice: number | null;
  estMonthlyFrom: number | null;
};

export type TypeDetails = TypeOption & {
  bathrooms: number | null;
  floors: number | null;
  highlights: string | null;
  maxPrice: number;
  schemes: { name: string; fromPrice: number; dpPct: number | null }[];
  promos: {
    id: number;
    name: string;
    benefitType: string | null;
    benefitAmount: number | null;
    customerText: string | null;
    termsText: string | null;
  }[];
  materialKinds: MaterialKind[];
};

/** `'{37,40}'::int[]` for `= any(...)`; drizzle would expand a JS array into a parameter list. */
export function intArray(ids: number[]): SQL {
  return sql.raw(`'{${ids.map((n) => Math.trunc(Number(n))).join(',')}}'::int[]`);
}

/** Units of the project that are for sale and priced, as SQL conditions on alias `u`. */
export function sellableUnits(project: Project): SQL {
  return sql`u.project_id = ${project.vlesProjectId} and u.area_id = any(${intArray(project.vlesAreaIds)})
    and not u.deleted and u.is_available_for_sale and u.selling_price is not null`;
}

export async function findProjectBySlug(slug: string): Promise<Project | null> {
  const [row] = await getDb().select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return row ?? null;
}

type TypeRow = {
  house_type_id: number;
  name: string;
  sales_category: string | null;
  land_min: number | null;
  land_max: number | null;
  building: number | null;
  available: number;
  from_price: string;
  max_price: string;
};

/** Every type with at least one sellable unit, cheapest first, with profile, KPR scheme and estimate. */
export async function projectTypeOptions(project: Project): Promise<(TypeOption & { maxPrice: number })[]> {
  const db = getDb();
  const rows = (
    await db.execute<TypeRow>(sql`
      select u.house_type_id, max(u.house_type_name) as name, max(u.sales_category) as sales_category,
        min(u.land_size) as land_min, max(u.land_size) as land_max, max(u.building_size) as building,
        count(*)::int as available, min(u.selling_price) as from_price, max(u.selling_price) as max_price
      from vles_units u
      where ${sellableUnits(project)}
      group by u.house_type_id
    `)
  ).rows;
  if (rows.length === 0) return [];

  const kprSchemes = new Map(
    (
      await db.execute<{ house_type_id: number; name: string; price: string }>(sql`
        select distinct on (u.house_type_id) u.house_type_id, s.name, s.selling_price as price
        from vles_unit_schemes s join vles_units u on u.id = s.unit_id
        where ${sellableUnits(project)} and s.name ~* 'KPR' and s.selling_price is not null
        order by u.house_type_id, s.selling_price asc, s.name
      `)
    ).rows.map((r) => [r.house_type_id, { name: r.name, price: Number(r.price) }])
  );
  const profiles = new Map(
    (await db.select().from(typeProfiles).where(eq(typeProfiles.projectId, project.id))).map((p) => [p.houseTypeId, p])
  );
  const assumptions = await getKprAssumptions(project.id);

  const out: (TypeOption & { maxPrice: number })[] = [];
  for (const r of rows) {
    const profile = profiles.get(r.house_type_id);
    if (profile && !profile.active) continue;
    const kpr = kprSchemes.get(r.house_type_id) ?? null;
    const fromPrice = Number(r.from_price);
    let estMonthlyFrom: number | null = null;
    if (assumptions) {
      const dpPct =
        (kpr && (parseDpFromSchemeName(kpr.name) ?? (await getSchemeDpOverride(kpr.name)))) ?? assumptions.dpOptionsPct[0];
      estMonthlyFrom = simulateKpr({
        price: kpr?.price ?? fromPrice,
        dpPct,
        tenorYears: Math.max(...assumptions.tenorOptions),
        assumptions,
      }).monthlyFixed;
    }
    out.push({
      houseTypeId: r.house_type_id,
      name: r.name,
      marketingName: profile?.marketingName ?? null,
      bedrooms: profile?.bedrooms ?? null,
      landSizeMin: r.land_min === null ? null : Number(r.land_min),
      landSizeMax: r.land_max === null ? null : Number(r.land_max),
      buildingSize: r.building === null ? null : Number(r.building),
      salesCategory: r.sales_category,
      availableUnits: r.available,
      fromPrice,
      fromKprSchemePrice: kpr?.price ?? null,
      estMonthlyFrom,
      maxPrice: Number(r.max_price),
    });
  }
  return out.sort((a, b) => a.fromPrice - b.fromPrice || a.name.localeCompare(b.name));
}

const strip = ({ maxPrice: _maxPrice, ...t }: TypeOption & { maxPrice: number }): TypeOption => t;

export async function searchUnits(input: {
  projectId: number;
  bedrooms?: number;
  maxPrice?: number;
  maxMonthly?: number;
  salesCategory?: 'subsidi' | 'komersil';
}): Promise<{ types: TypeOption[]; nearest: boolean }> {
  const project = await getProject(input.projectId);
  if (!project) return { types: [], nearest: false };
  let types = await projectTypeOptions(project);
  if (input.bedrooms !== undefined) types = types.filter((t) => t.bedrooms === input.bedrooms);
  if (input.salesCategory) types = types.filter((t) => t.salesCategory?.toLowerCase() === input.salesCategory);
  const withinBudget = types.filter(
    (t) =>
      (input.maxPrice === undefined || t.fromPrice <= input.maxPrice) &&
      (input.maxMonthly === undefined || (t.estMonthlyFrom !== null && t.estMonthlyFrom <= input.maxMonthly))
  );
  if (withinBudget.length === 0 && types.length > 0) return { types: types.slice(0, 2).map(strip), nearest: true };
  return { types: withinBudget.slice(0, 5).map(strip), nearest: false };
}

export async function getTypeDetails(projectId: number, houseTypeId: number): Promise<TypeDetails | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  const option = (await projectTypeOptions(project)).find((t) => t.houseTypeId === houseTypeId);
  if (!option) return null;
  const db = getDb();

  const schemeRows = (
    await db.execute<{ name: string; price: string }>(sql`
      select s.name, min(s.selling_price) as price
      from vles_unit_schemes s join vles_units u on u.id = s.unit_id
      where ${sellableUnits(project)} and u.house_type_id = ${houseTypeId} and s.selling_price is not null
      group by s.name order by min(s.selling_price), s.name
    `)
  ).rows;
  const schemes = [];
  for (const s of schemeRows) {
    schemes.push({ name: s.name, fromPrice: Number(s.price), dpPct: parseDpFromSchemeName(s.name) ?? (await getSchemeDpOverride(s.name)) });
  }

  const promoRows = await db
    .select({ promo: vlesPromos, copy: promoCopy })
    .from(vlesPromos)
    .leftJoin(promoCopy, eq(promoCopy.vlesPromoId, vlesPromos.id))
    .where(and(eq(vlesPromos.projectId, project.vlesProjectId), eq(vlesPromos.deleted, false), eq(vlesPromos.isUsable, true)));
  const promos = promoRows
    .filter(({ promo }) => !promo.salesCategory || !option.salesCategory || promo.salesCategory.toLowerCase() === option.salesCategory.toLowerCase())
    .map(({ promo, copy }) => ({
      id: promo.id,
      name: promo.name,
      benefitType: promo.benefitType,
      benefitAmount: promo.benefitAmount,
      customerText: copy?.customerText ?? null,
      termsText: copy?.termsText ?? null,
    }));

  const [profile] = await db.select().from(typeProfiles).where(eq(typeProfiles.houseTypeId, houseTypeId)).limit(1);
  const today = todayWib();
  const materialKinds: MaterialKind[] = [];
  for (const kind of MATERIAL_KINDS) {
    if ((await activeMaterials(project.id, kind, houseTypeId, today)).length > 0) materialKinds.push(kind);
  }

  return {
    ...option,
    bathrooms: profile?.bathrooms ?? null,
    floors: profile?.floors ?? null,
    highlights: profile?.highlights ?? null,
    schemes,
    promos,
    materialKinds,
  };
}
