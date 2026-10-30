import { and, asc, eq, isNull, or, gte, lte, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { materials, type MaterialKind } from '../db/schema/index.js';

export type { MaterialKind };
export type Material = typeof materials.$inferSelect;
export type MaterialInput = Omit<typeof materials.$inferInsert, 'id' | 'createdAt'>;
export type MaterialPatch = Partial<Omit<MaterialInput, 'projectId'>>;

export async function listMaterials(projectId: number): Promise<Material[]> {
  return getDb()
    .select()
    .from(materials)
    .where(eq(materials.projectId, projectId))
    .orderBy(asc(materials.kind), asc(materials.sort), asc(materials.id));
}

export async function createMaterial(input: MaterialInput): Promise<Material> {
  const [row] = await getDb().insert(materials).values(input).returning();
  if (!row) throw new Error('Failed to create material');
  return row;
}

export async function updateMaterial(id: number, patch: MaterialPatch): Promise<Material | null> {
  if (Object.keys(patch).length === 0) {
    const [row] = await getDb().select().from(materials).where(eq(materials.id, id)).limit(1);
    return row ?? null;
  }
  const [row] = await getDb().update(materials).set(patch).where(eq(materials.id, id)).returning();
  return row ?? null;
}

/**
 * Materials Moni may send today. With a type: that type's rows first, then project-wide ones.
 * Without a type: project-wide rows, or every row of the kind when the project has only typed ones.
 */
export async function activeMaterials(
  projectId: number,
  kind: MaterialKind,
  houseTypeId: number | null,
  today: string
): Promise<Material[]> {
  const live = and(
    eq(materials.projectId, projectId),
    eq(materials.kind, kind),
    eq(materials.active, true),
    or(isNull(materials.validFrom), lte(materials.validFrom, today)),
    or(isNull(materials.validTo), gte(materials.validTo, today))
  );
  const db = getDb();
  if (houseTypeId !== null) {
    return db
      .select()
      .from(materials)
      .where(and(live, or(eq(materials.houseTypeId, houseTypeId), isNull(materials.houseTypeId))))
      .orderBy(sql`${materials.houseTypeId} is null`, asc(materials.sort), asc(materials.id));
  }
  const wide = await db
    .select()
    .from(materials)
    .where(and(live, isNull(materials.houseTypeId)))
    .orderBy(asc(materials.sort), asc(materials.id));
  if (wide.length > 0) return wide;
  return db.select().from(materials).where(live).orderBy(asc(materials.sort), asc(materials.id));
}
