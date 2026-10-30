import { z } from 'zod';

// Response shapes of the VLES integration API (contract 0.9.1). Loose objects: VLES adds fields
// in minor versions, and a new field must never make a sync fail.

export type VlesListEndpoint = 'units' | 'unit-types' | 'promos' | 'mortgage-banks';

const CodeLabel = z.looseObject({ code: z.union([z.number(), z.string()]), label: z.string().nullable() });
const IdName = z.looseObject({ id: z.number(), name: z.string().nullable() });

export const VlesPage = z.looseObject({
  data: z.array(z.unknown()),
  page: z.looseObject({ limit: z.number(), next_cursor: z.string().nullable() }),
  sync: z
    .looseObject({
      server_time: z.string(),
      updated_since: z.string(),
      effective_since: z.string(),
      lookback_hours: z.number(),
    })
    .optional(),
});
export type VlesPage = z.infer<typeof VlesPage>;

export const VlesUnitRaw = z.looseObject({
  id: z.number(),
  project_id: z.number(),
  area_id: z.number(),
  area_name: z.string(),
  unit_number: z.string(),
  block: z.string().nullable(),
  unit: z.string().nullable(),
  house_type_id: z.number(),
  house_type_name: z.string(),
  land_size: z.number().nullable(),
  building_size: z.number().nullable(),
  stage: z.number(),
  stage_label: z.string().nullable(),
  marketing_stock_stage: CodeLabel.nullable(),
  is_available_for_sale: z.boolean(),
  selling_price: z.number().nullable(),
  price_list_in_period: z.boolean().nullable(),
  facing: IdName.nullable(),
  strategic_position: z.looseObject({ id: z.number(), name: z.string().nullable(), fixed_cost: z.number().nullable() }).nullable(),
  sales_category: z.string().nullable(),
  business_group_label: z.string().nullable(),
  ready: z.number(),
  deleted: z.boolean(),
  updated_at: z.string(),
  changed_at: z.string().optional(),
});
export type VlesUnitRaw = z.infer<typeof VlesUnitRaw>;

export const VlesTombstone = z.looseObject({
  id: z.number(),
  deleted: z.literal(true),
  changed_at: z.string().optional(),
  project_id: z.number().optional(),
});
export type VlesTombstone = z.infer<typeof VlesTombstone>;

export function isTombstone(row: unknown): row is VlesTombstone {
  return typeof row === 'object' && row !== null && (row as { deleted?: unknown }).deleted === true;
}

export const VlesUnitTypeRaw = z.looseObject({
  id: z.number(),
  project_id: z.number(),
  name: z.string(),
  land_size: z.number().nullable(),
  building_size: z.number().nullable(),
  electric_power: z.number().nullable(),
  sales_category: z.string().nullable(),
  deleted: z.boolean(),
  updated_at: z.string(),
});
export type VlesUnitTypeRaw = z.infer<typeof VlesUnitTypeRaw>;

export const VlesPromoRaw = z.looseObject({
  id: z.number(),
  project_id: z.number(),
  name: z.string(),
  sales_category: z.string().nullable(),
  benefit_type: CodeLabel.nullable(),
  benefit_amount: z.number().nullable(),
  benefit_percent: z.number().nullable(),
  valid_from: z.string().nullable(),
  valid_to: z.string().nullable(),
  status: CodeLabel.nullable(),
  is_usable: z.boolean(),
  deleted: z.boolean(),
  updated_at: z.string(),
});
export type VlesPromoRaw = z.infer<typeof VlesPromoRaw>;

export const VlesMortgageBankRaw = z.looseObject({
  id: z.number(),
  project_id: z.number(),
  bank: IdName.nullable(),
  branch_name: z.string().nullable(),
  deleted: z.boolean(),
  updated_at: z.string(),
});
export type VlesMortgageBankRaw = z.infer<typeof VlesMortgageBankRaw>;

export const VlesSchemeRaw = z.looseObject({
  id: z.number(),
  name: z.string(),
  selling_price: z.number().nullable(),
  booking_fee: z.number().nullable(),
  deposit: z.number().nullable(),
  ppn: z.number().nullable(),
});
export type VlesSchemeRaw = z.infer<typeof VlesSchemeRaw>;

export const VlesUnitDetail = z.looseObject({
  data: VlesUnitRaw,
  schemes: z.array(VlesSchemeRaw),
});
export type VlesUnitDetail = z.infer<typeof VlesUnitDetail>;
