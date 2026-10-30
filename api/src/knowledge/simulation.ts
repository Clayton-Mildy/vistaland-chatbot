import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { getProject } from '../repositories/projects.js';
import { getKprAssumptions, getSchemeDpOverride } from '../kpr/assumptions.js';
import { parseDpFromSchemeName, simulateKpr, type KprSimulation } from '../kpr/calculator.js';
import { sellableUnits } from './units.js';

/**
 * KPR simulations for a type: the cheapest KPR scheme price (falling back to the cheapest list
 * price) for each tenor. DP: what the customer said, else the scheme's, else the project default.
 */
export async function simulateForType(input: {
  projectId: number;
  houseTypeId: number;
  dpPct?: number;
  dpAmount?: number;
  tenorYears?: number[];
}): Promise<{ schemeName: string | null; price: number; simulations: KprSimulation[] } | { error: 'NO_KPR_SETTINGS' | 'NO_PRICE' }> {
  const assumptions = await getKprAssumptions(input.projectId);
  if (!assumptions) return { error: 'NO_KPR_SETTINGS' };
  const project = await getProject(input.projectId);
  if (!project) return { error: 'NO_PRICE' };

  const [best] = (
    await getDb().execute<{ name: string | null; price: string }>(sql`
      (select s.name, s.selling_price as price
         from vles_unit_schemes s join vles_units u on u.id = s.unit_id
        where ${sellableUnits(project)} and u.house_type_id = ${input.houseTypeId}
          and s.name ~* 'KPR' and s.selling_price is not null
        order by s.selling_price, s.name limit 1)
      union all
      (select null, u.selling_price from vles_units u
        where ${sellableUnits(project)} and u.house_type_id = ${input.houseTypeId}
        order by u.selling_price limit 1)
    `)
  ).rows;
  if (!best) return { error: 'NO_PRICE' };

  const price = Number(best.price);
  const schemeDp = best.name ? (parseDpFromSchemeName(best.name) ?? (await getSchemeDpOverride(best.name))) : null;
  const dpPct = input.dpPct ?? schemeDp ?? assumptions.dpOptionsPct[0];
  const tenors = input.tenorYears?.length ? input.tenorYears : assumptions.tenorOptions;
  return {
    schemeName: best.name,
    price,
    simulations: tenors.map((tenorYears) =>
      simulateKpr({ price, tenorYears, assumptions, ...(input.dpAmount !== undefined ? { dpAmount: input.dpAmount } : { dpPct }) })
    ),
  };
}
