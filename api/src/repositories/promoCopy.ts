import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { promoCopy, vlesPromos } from '../db/schema/index.js';
import type { Project } from './projects.js';

export type PromoCopy = typeof promoCopy.$inferSelect;

export async function getPromoCopy(vlesPromoId: number): Promise<PromoCopy | null> {
  const [row] = await getDb().select().from(promoCopy).where(eq(promoCopy.vlesPromoId, vlesPromoId)).limit(1);
  return row ?? null;
}

export async function upsertPromoCopy(vlesPromoId: number, customerText: string, termsText: string | null): Promise<PromoCopy> {
  const [row] = await getDb()
    .insert(promoCopy)
    .values({ vlesPromoId, customerText, termsText })
    .onConflictDoUpdate({ target: promoCopy.vlesPromoId, set: { customerText, termsText, updatedAt: new Date() } })
    .returning();
  if (!row) throw new Error(`Failed to save promo copy ${vlesPromoId}`);
  return row;
}

export type ProjectPromo = {
  id: number;
  name: string;
  salesCategory: string | null;
  benefitType: string | null;
  benefitAmount: number | null;
  benefitPercent: number | null;
  validFrom: string | null;
  validTo: string | null;
  isUsable: boolean;
  customerText: string | null;
  termsText: string | null;
};

/** The VLES promos of the project's VLES project, with the copy staff wrote for customers. */
export async function listProjectPromos(project: Project): Promise<ProjectPromo[]> {
  const rows = await getDb()
    .select({ promo: vlesPromos, copy: promoCopy })
    .from(vlesPromos)
    .leftJoin(promoCopy, eq(promoCopy.vlesPromoId, vlesPromos.id))
    .where(and(eq(vlesPromos.projectId, project.vlesProjectId), eq(vlesPromos.deleted, false)))
    .orderBy(asc(vlesPromos.name));
  return rows.map(({ promo, copy }) => ({
    id: promo.id,
    name: promo.name,
    salesCategory: promo.salesCategory,
    benefitType: promo.benefitType,
    benefitAmount: promo.benefitAmount,
    benefitPercent: promo.benefitPercent,
    validFrom: promo.validFrom,
    validTo: promo.validTo,
    isUsable: promo.isUsable,
    customerText: copy?.customerText ?? null,
    termsText: copy?.termsText ?? null,
  }));
}
