import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  bigint,
  doublePrecision,
  date,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Local copy of VLES, written only by the sync (src/vles). Ids are VLES ids. `raw` keeps the
// whole row so a field we do not map yet is still there when a later milestone needs it.

const money = (name: string) => bigint(name, { mode: 'number' });
const syncedAt = () => timestamp('synced_at', { withTimezone: true }).notNull();
const vlesUpdatedAt = () => timestamp('vles_updated_at', { withTimezone: true });

export const vlesUnits = pgTable(
  'vles_units',
  {
    id: integer('id').primaryKey(),
    projectId: integer('project_id').notNull(),
    areaId: integer('area_id').notNull(),
    areaName: text('area_name').notNull(),
    unitNumber: text('unit_number').notNull(),
    block: text('block'),
    houseTypeId: integer('house_type_id').notNull(),
    houseTypeName: text('house_type_name').notNull(),
    landSize: doublePrecision('land_size'),
    buildingSize: doublePrecision('building_size'),
    stage: integer('stage').notNull(),
    stageLabel: text('stage_label'),
    marketingStockStage: integer('marketing_stock_stage'),
    isAvailableForSale: boolean('is_available_for_sale').notNull(),
    sellingPrice: money('selling_price'),
    priceListInPeriod: boolean('price_list_in_period'),
    facing: text('facing'),
    strategicPosition: text('strategic_position'),
    strategicFixedCost: money('strategic_fixed_cost'),
    salesCategory: text('sales_category'),
    businessGroupLabel: text('business_group_label'),
    ready: boolean('ready').notNull(),
    deleted: boolean('deleted').notNull().default(false),
    vlesUpdatedAt: vlesUpdatedAt(),
    raw: jsonb('raw').notNull(),
    syncedAt: syncedAt(),
  },
  (t) => [
    index('vles_units_project_area_idx').on(t.projectId, t.areaId),
    index('vles_units_available_idx').on(t.id).where(sql`${t.isAvailableForSale} and not ${t.deleted}`),
  ]
);

export const vlesUnitTypes = pgTable('vles_unit_types', {
  id: integer('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  name: text('name').notNull(),
  landSize: doublePrecision('land_size'),
  buildingSize: doublePrecision('building_size'),
  electricPower: integer('electric_power'),
  salesCategory: text('sales_category'),
  deleted: boolean('deleted').notNull().default(false),
  vlesUpdatedAt: vlesUpdatedAt(),
  raw: jsonb('raw').notNull(),
  syncedAt: syncedAt(),
});

export const vlesUnitSchemes = pgTable(
  'vles_unit_schemes',
  {
    unitId: integer('unit_id').notNull(),
    schemeId: integer('scheme_id').notNull(),
    name: text('name').notNull(),
    sellingPrice: money('selling_price'),
    bookingFee: money('booking_fee'),
    deposit: money('deposit'),
    ppn: money('ppn'),
    raw: jsonb('raw').notNull(),
    syncedAt: syncedAt(),
  },
  (t) => [primaryKey({ columns: [t.unitId, t.schemeId] })]
);

export const vlesPromos = pgTable('vles_promos', {
  id: integer('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  name: text('name').notNull(),
  salesCategory: text('sales_category'),
  benefitType: text('benefit_type'),
  benefitAmount: money('benefit_amount'),
  benefitPercent: doublePrecision('benefit_percent'),
  validFrom: date('valid_from'),
  validTo: date('valid_to'),
  status: text('status'),
  isUsable: boolean('is_usable').notNull(),
  deleted: boolean('deleted').notNull().default(false),
  vlesUpdatedAt: vlesUpdatedAt(),
  raw: jsonb('raw').notNull(),
  syncedAt: syncedAt(),
});

export const vlesMortgageBanks = pgTable('vles_mortgage_banks', {
  id: integer('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  bankId: integer('bank_id'),
  bankName: text('bank_name'),
  branchName: text('branch_name'),
  deleted: boolean('deleted').notNull().default(false),
  vlesUpdatedAt: vlesUpdatedAt(),
  raw: jsonb('raw').notNull(),
  syncedAt: syncedAt(),
});

export const vlesSyncState = pgTable('vles_sync_state', {
  endpoint: text('endpoint').primaryKey(),
  lastServerTime: timestamp('last_server_time', { withTimezone: true }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
  lastError: text('last_error'),
});

export type SyncStateRow = typeof vlesSyncState.$inferSelect;
