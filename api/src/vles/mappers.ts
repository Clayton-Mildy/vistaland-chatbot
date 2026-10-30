import type { vlesUnits, vlesUnitTypes, vlesPromos, vlesMortgageBanks, vlesUnitSchemes } from '../db/schema/index.js';
import type { VlesUnitRaw, VlesUnitTypeRaw, VlesPromoRaw, VlesMortgageBankRaw, VlesSchemeRaw } from './types.js';

// VLES row -> insert values. Nested {code,label} / {id,name} objects flatten to the part we
// query on; the full row is always kept in `raw`.

const codeOf = (v: { code: number | string } | null): string | null => (v ? String(v.code) : null);
const changedAt = (raw: { changed_at?: string; updated_at: string }) => new Date(raw.changed_at ?? raw.updated_at);

export function mapUnit(raw: VlesUnitRaw, syncedAt: Date): typeof vlesUnits.$inferInsert {
  const stage = raw.marketing_stock_stage?.code;
  return {
    id: raw.id,
    projectId: raw.project_id,
    areaId: raw.area_id,
    areaName: raw.area_name,
    unitNumber: raw.unit_number,
    block: raw.block,
    houseTypeId: raw.house_type_id,
    houseTypeName: raw.house_type_name,
    landSize: raw.land_size,
    buildingSize: raw.building_size,
    stage: raw.stage,
    stageLabel: raw.stage_label,
    marketingStockStage: stage === undefined ? null : Number(stage),
    isAvailableForSale: raw.is_available_for_sale,
    sellingPrice: raw.selling_price,
    priceListInPeriod: raw.price_list_in_period,
    facing: raw.facing?.name ?? null,
    strategicPosition: raw.strategic_position?.name ?? null,
    strategicFixedCost: raw.strategic_position?.fixed_cost ?? null,
    salesCategory: raw.sales_category,
    businessGroupLabel: raw.business_group_label,
    ready: raw.ready === 1,
    deleted: false,
    vlesUpdatedAt: changedAt(raw),
    raw,
    syncedAt,
  };
}

export function mapUnitType(raw: VlesUnitTypeRaw, syncedAt: Date): typeof vlesUnitTypes.$inferInsert {
  return {
    id: raw.id,
    projectId: raw.project_id,
    name: raw.name,
    landSize: raw.land_size,
    buildingSize: raw.building_size,
    electricPower: raw.electric_power,
    salesCategory: raw.sales_category,
    deleted: false,
    vlesUpdatedAt: changedAt(raw),
    raw,
    syncedAt,
  };
}

export function mapPromo(raw: VlesPromoRaw, syncedAt: Date): typeof vlesPromos.$inferInsert {
  return {
    id: raw.id,
    projectId: raw.project_id,
    name: raw.name,
    salesCategory: raw.sales_category,
    benefitType: codeOf(raw.benefit_type),
    benefitAmount: raw.benefit_amount,
    benefitPercent: raw.benefit_percent,
    validFrom: raw.valid_from,
    validTo: raw.valid_to,
    status: codeOf(raw.status),
    isUsable: raw.is_usable,
    deleted: false,
    vlesUpdatedAt: changedAt(raw),
    raw,
    syncedAt,
  };
}

export function mapMortgageBank(raw: VlesMortgageBankRaw, syncedAt: Date): typeof vlesMortgageBanks.$inferInsert {
  return {
    id: raw.id,
    projectId: raw.project_id,
    bankId: raw.bank?.id ?? null,
    bankName: raw.bank?.name ?? null,
    branchName: raw.branch_name,
    deleted: false,
    vlesUpdatedAt: changedAt(raw),
    raw,
    syncedAt,
  };
}

export function mapSchemes(
  unitId: number,
  schemes: VlesSchemeRaw[],
  syncedAt: Date
): (typeof vlesUnitSchemes.$inferInsert)[] {
  return schemes.map((s) => ({
    unitId,
    schemeId: s.id,
    name: s.name,
    sellingPrice: s.selling_price,
    bookingFee: s.booking_fee,
    deposit: s.deposit,
    ppn: s.ppn,
    raw: s,
    syncedAt,
  }));
}
