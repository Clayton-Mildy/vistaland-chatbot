import { pgTable, text, boolean, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';
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
