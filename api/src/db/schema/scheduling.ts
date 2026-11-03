import { pgTable, text, boolean, timestamp, jsonb, integer, bigint, uuid, check, index, uniqueIndex, primaryKey, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projects } from './catalog.js';
import { staffUsers } from './system.js';
import { leads } from './conversations.js';

// ─── sales_agents ──────────────────────────────────────────────────────────
// The people who take visits. A sales agent may exist without a dashboard login.

export const salesAgents = pgTable('sales_agents', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  // International form without "+", the number alerts are sent to.
  waPhone: text('wa_phone').notNull().unique(),
  staffUserId: uuid('staff_user_id')
    .unique()
    .references(() => staffUsers.id, { onDelete: 'set null' }),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const salesAgentProjects = pgTable(
  'sales_agent_projects',
  {
    salesAgentId: uuid('sales_agent_id')
      .notNull()
      .references(() => salesAgents.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
  },
  (t) => [primaryKey({ columns: [t.salesAgentId, t.projectId] })]
);

// Weekly hours a sales agent shows a project. weekday: 1 = Monday ... 7 = Sunday; times are WIB "HH:MM".
export const salesAvailability = pgTable(
  'sales_availability',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    salesAgentId: uuid('sales_agent_id')
      .notNull()
      .references(() => salesAgents.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    weekday: integer('weekday').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
  },
  (t) => [
    check('sales_availability_weekday_check', sql`${t.weekday} between 1 and 7`),
    check('sales_availability_start_format_check', sql`${t.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check('sales_availability_end_format_check', sql`${t.endTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check('sales_availability_order_check', sql`${t.startTime} < ${t.endTime}`),
  ]
);

export const salesTimeOff = pgTable(
  'sales_time_off',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    salesAgentId: uuid('sales_agent_id')
      .notNull()
      .references(() => salesAgents.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: text('reason'),
  },
  (t) => [check('sales_time_off_order_check', sql`${t.endsAt} > ${t.startsAt}`)]
);

// ─── visits ────────────────────────────────────────────────────────────────

export const VISIT_STATUSES = [
  'scheduled',
  'confirmed',
  'awaiting_confirmation',
  'visited',
  'no_show',
  'cancelled',
  'rescheduled',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

const visitStatusList = sql.raw(VISIT_STATUSES.map((s) => `'${s}'`).join(', '));

// The migration also adds an exclusion constraint drizzle cannot express: one sales agent cannot
// hold two overlapping active, non-test visits (visits_no_overlap, see 0004_*.sql).
export const visits = pgTable(
  'visits',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    salesAgentId: uuid('sales_agent_id')
      .notNull()
      .references(() => salesAgents.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('scheduled').$type<VisitStatus>(),
    typeInterest: integer('type_interest').array().notNull().default(sql`'{}'`),
    topics: text('topics'),
    isTest: boolean('is_test').notNull().default(false),
    // "moni", "staff:<uuid>" or "system".
    createdBy: text('created_by').notNull(),
    rescheduledFrom: uuid('rescheduled_from').references((): AnyPgColumn => visits.id),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('visits_starts_at_idx').on(t.startsAt),
    uniqueIndex('visits_one_active_per_lead')
      .on(t.leadId)
      .where(sql`${t.status} in ('scheduled', 'confirmed', 'awaiting_confirmation')`),
    check('visits_status_check', sql`${t.status} in (${visitStatusList})`),
  ]
);

// ─── scheduled_messages (the outbound outbox) ──────────────────────────────

export const SCHEDULED_MESSAGE_KINDS = ['sales_alert', 'reassign_notice', 'h1_reminder', 'followup', 'waiting_notice'] as const;
export type ScheduledMessageKind = (typeof SCHEDULED_MESSAGE_KINDS)[number];

export const SCHEDULED_MESSAGE_STATUSES = ['pending', 'sent', 'failed', 'cancelled'] as const;
export type ScheduledMessageStatus = (typeof SCHEDULED_MESSAGE_STATUSES)[number];

const messageKindList = sql.raw(SCHEDULED_MESSAGE_KINDS.map((k) => `'${k}'`).join(', '));
const messageStatusList = sql.raw(SCHEDULED_MESSAGE_STATUSES.map((s) => `'${s}'`).join(', '));

export const scheduledMessages = pgTable(
  'scheduled_messages',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    kind: text('kind').notNull().$type<ScheduledMessageKind>(),
    // One live message per key (pending or sent); producers build it, e.g. "<kind>:<visit id>:<version>".
    dedupeKey: text('dedupe_key').notNull(),
    toPhone: text('to_phone').notNull(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    visitId: uuid('visit_id').references(() => visits.id, { onDelete: 'set null' }),
    // Template variables, in order, as strings. The template itself comes from Settings at send time.
    params: jsonb('params').notNull().$type<string[]>().default(sql`'[]'::jsonb`),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending').$type<ScheduledMessageStatus>(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    waMessageId: text('wa_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('scheduled_messages_dedupe')
      .on(t.dedupeKey)
      .where(sql`${t.status} in ('pending', 'sent')`),
    index('scheduled_messages_due_idx').on(t.status, t.dueAt),
    check('scheduled_messages_kind_check', sql`${t.kind} in (${messageKindList})`),
    check('scheduled_messages_status_check', sql`${t.status} in (${messageStatusList})`),
  ]
);

// ─── push_subscriptions ────────────────────────────────────────────────────

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  staffUserId: uuid('staff_user_id')
    .notNull()
    .references(() => staffUsers.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
