import { pgTable, text, boolean, timestamp, jsonb, integer, doublePrecision, date, check, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── projects ──────────────────────────────────────────────────────────────
// A project as Moni sells it, which is not the same thing as a VLES project: Zetira is one
// area inside VLES project 5. A unit belongs to the project whose vles_area_ids holds its area.

export const projects = pgTable('projects', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  personaTeamName: text('persona_team_name').notNull(),
  locationLabel: text('location_label'),
  mapsUrl: text('maps_url'),
  accessNotes: text('access_notes'),
  galleryHours: jsonb('gallery_hours'),
  visitMinutes: integer('visit_minutes').notNull().default(60),
  sameDayMinNoticeMinutes: integer('same_day_min_notice_minutes').notNull().default(120),
  vlesProjectId: integer('vles_project_id').notNull(),
  vlesAreaIds: integer('vles_area_ids').array().notNull().default(sql`'{}'`),
  subsidiNotes: text('subsidi_notes'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── type_profiles ─────────────────────────────────────────────────────────
// What VLES does not know about a house type: bedrooms, the marketing name, selling points.

export const typeProfiles = pgTable('type_profiles', {
  houseTypeId: integer('house_type_id').primaryKey(),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id),
  marketingName: text('marketing_name'),
  bedrooms: integer('bedrooms'),
  bathrooms: integer('bathrooms'),
  floors: integer('floors'),
  highlights: text('highlights'),
  active: boolean('active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── materials ─────────────────────────────────────────────────────────────

export const MATERIAL_KINDS = ['flyer', 'video', 'promo', 'floor_plan', 'brochure', 'photo'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const materials = pgTable(
  'materials',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    houseTypeId: integer('house_type_id'),
    kind: text('kind').notNull().$type<MaterialKind>(),
    url: text('url').notNull(),
    mime: text('mime').notNull(),
    filename: text('filename').notNull(),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    sort: integer('sort').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'materials_kind_check',
      sql`${t.kind} in ('flyer', 'video', 'promo', 'floor_plan', 'brochure', 'photo')`
    ),
  ]
);

// ─── promo_copy ────────────────────────────────────────────────────────────
// The sentence Moni may say about a VLES promo; VLES has only its name and amount.

export const promoCopy = pgTable('promo_copy', {
  vlesPromoId: integer('vles_promo_id').primaryKey(),
  customerText: text('customer_text').notNull(),
  termsText: text('terms_text'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── kpr_settings ──────────────────────────────────────────────────────────
// KPR assumptions for simulations: one project default (bank_id null) plus optional per-bank rows.

export const kprSettings = pgTable(
  'kpr_settings',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    bankId: integer('bank_id'),
    fixedRatePct: doublePrecision('fixed_rate_pct').notNull(),
    fixedYears: integer('fixed_years').notNull(),
    floatingRatePct: doublePrecision('floating_rate_pct').notNull(),
    tenorOptions: integer('tenor_options').array().notNull(),
    dpOptionsPct: doublePrecision('dp_options_pct').array().notNull(),
    notes: text('notes'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('kpr_settings_project_bank_unique').on(t.projectId, t.bankId).nullsNotDistinct()]
);

// ─── scheme_dp_overrides ───────────────────────────────────────────────────
// DP for a VLES payment scheme whose name does not say it ("KPR 95%" -> 5% is parsed instead).

export const schemeDpOverrides = pgTable('scheme_dp_overrides', {
  schemeName: text('scheme_name').primaryKey(),
  dpPct: doublePrecision('dp_pct').notNull(),
});

// ─── channel_tags ──────────────────────────────────────────────────────────
// "[ZTR-REELS]" in an ad's prefilled message tells Moni the project and the channel.

export const channelTags = pgTable(
  'channel_tags',
  {
    tag: text('tag').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    channel: text('channel').notNull(),
    contentKind: text('content_kind').notNull(),
  },
  (t) => [
    check('channel_tags_channel_check', sql`${t.channel} in ('instagram', 'facebook', 'tiktok', 'other')`),
    check('channel_tags_content_kind_check', sql`${t.contentKind} in ('promo', 'reels', 'general')`),
  ]
);
