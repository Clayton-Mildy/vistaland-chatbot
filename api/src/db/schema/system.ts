import { pgTable, text, boolean, timestamp, jsonb, uuid, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── app_settings ──────────────────────────────────────────────────────────

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── staff_users ───────────────────────────────────────────────────────────

export const staffUsers = pgTable(
  'staff_users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // Stored lower-case; lookups lower-case their input.
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('staff_users_role_check', sql`${t.role} in ('admin', 'sales')`)]
);
