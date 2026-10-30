import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { typeProfiles } from '../db/schema/index.js';
import type { Project } from './projects.js';

export type TypeProfile = typeof typeProfiles.$inferSelect;
export type TypeProfileInput = Omit<typeof typeProfiles.$inferInsert, 'houseTypeId' | 'updatedAt'>;

export async function getTypeProfile(houseTypeId: number): Promise<TypeProfile | null> {
  const [row] = await getDb().select().from(typeProfiles).where(eq(typeProfiles.houseTypeId, houseTypeId)).limit(1);
  return row ?? null;
}

export async function upsertTypeProfile(houseTypeId: number, input: TypeProfileInput): Promise<TypeProfile> {
  const [row] = await getDb()
    .insert(typeProfiles)
    .values({ ...input, houseTypeId })
    .onConflictDoUpdate({ target: typeProfiles.houseTypeId, set: { ...input, updatedAt: new Date() } })
    .returning();
  if (!row) throw new Error(`Failed to save type profile ${houseTypeId}`);
  return row;
}

export type ProjectType = {
  houseTypeId: number;
  houseTypeName: string;
  salesCategory: string | null;
  totalUnits: number;
  availableUnits: number;
  profile: TypeProfile | null;
};

/** The VLES house types found in the project's areas, each with its profile when staff wrote one. */
export async function listProjectTypes(project: Project): Promise<ProjectType[]> {
  const rows = (
    await getDb().execute<{
      house_type_id: number;
      house_type_name: string;
      sales_category: string | null;
      total: number;
      available: number;
    }>(sql`
      select house_type_id, max(house_type_name) as house_type_name, max(sales_category) as sales_category,
        count(*)::int as total, (count(*) filter (where is_available_for_sale))::int as available
      from vles_units
      where project_id = ${project.vlesProjectId}
        and area_id = any(${sql.raw(`'{${project.vlesAreaIds.join(',')}}'::int[]`)})
        and not deleted
      group by house_type_id
      order by max(house_type_name)
    `)
  ).rows;
  const profiles = new Map(
    (await getDb().select().from(typeProfiles).where(eq(typeProfiles.projectId, project.id))).map((p) => [p.houseTypeId, p])
  );
  return rows.map((r) => ({
    houseTypeId: r.house_type_id,
    houseTypeName: r.house_type_name,
    salesCategory: r.sales_category,
    totalUnits: r.total,
    availableUnits: r.available,
    profile: profiles.get(r.house_type_id) ?? null,
  }));
}
