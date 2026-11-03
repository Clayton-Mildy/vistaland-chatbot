import { pgTable, text, boolean, timestamp, jsonb, integer, bigint, uuid, check, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projects } from './catalog.js';
import { staffUsers } from './system.js';
import { salesAgents } from './scheduling.js';

// ─── contacts ──────────────────────────────────────────────────────────────

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  // International form without "+", e.g. 6281234567890. Test-chat contacts use "test-<staffId>".
  waPhone: text('wa_phone').notNull().unique(),
  displayName: text('display_name'),
  // Test-chat contacts never reach ChakraHQ and stay out of the Leads list and reports.
  isTest: boolean('is_test').notNull().default(false),
  optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── conversations ─────────────────────────────────────────────────────────

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  contactId: uuid('contact_id')
    .notNull()
    .unique()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  // The business number the customer wrote to; replies must go out from it.
  waPhoneNumberId: text('wa_phone_number_id'),
  aiEnabled: boolean('ai_enabled').notNull().default(true),
  humanTakeoverUntil: timestamp('human_takeover_until', { withTimezone: true }),
  lastCustomerMsgAt: timestamp('last_customer_msg_at', { withTimezone: true }),
  lastMoniMsgAt: timestamp('last_moni_msg_at', { withTimezone: true }),
  lastCannedReplyAt: timestamp('last_canned_reply_at', { withTimezone: true }),
  // When leads.summary was last regenerated from this conversation.
  summaryRefreshedAt: timestamp('summary_refreshed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── messages ──────────────────────────────────────────────────────────────

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    waMessageId: text('wa_message_id').unique(),
    direction: text('direction').notNull().$type<'in' | 'out'>(),
    sender: text('sender').notNull().$type<'customer' | 'moni' | 'staff' | 'system'>(),
    staffUserId: uuid('staff_user_id').references(() => staffUsers.id, { onDelete: 'set null' }),
    kind: text('kind').notNull().default('text'),
    body: text('body').notNull(),
    mediaUrl: text('media_url'),
    status: text('status').notNull().$type<'received' | 'sent' | 'failed' | 'recorded'>(),
    // When the customer (or WhatsApp) sent it; shown to staff. Inbound uses WhatsApp's time.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // When it reached us. "Has Moni answered this?" is decided on arrival order: a webhook can
    // land after Moni's reply although the customer sent it before.
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_conversation_created_idx').on(t.conversationId, t.createdAt),
    index('messages_conversation_received_idx').on(t.conversationId, t.receivedAt),
    check('messages_direction_check', sql`${t.direction} in ('in', 'out')`),
    check('messages_sender_check', sql`${t.sender} in ('customer', 'moni', 'staff', 'system')`),
    check('messages_status_check', sql`${t.status} in ('received', 'sent', 'failed', 'recorded')`),
  ]
);

// ─── leads ─────────────────────────────────────────────────────────────────

export const LEAD_STAGES = [
  'new',
  'engaged',
  'qualified',
  'recommended',
  'visit_proposed',
  'visit_scheduled',
  'visit_confirmed',
  'visited',
  'no_show',
  'cancelled',
  'lost',
  'opted_out',
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

const stageList = sql.raw(LEAD_STAGES.map((s) => `'${s}'`).join(', '));

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    contactId: uuid('contact_id')
      .notNull()
      .unique()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    currentProjectId: integer('current_project_id').references(() => projects.id),
    projectsOfInterest: integer('projects_of_interest').array().notNull().default(sql`'{}'`),
    sourceChannel: text('source_channel'),
    sourceContentKind: text('source_content_kind'),
    sourceRef: text('source_ref'),
    stage: text('stage').notNull().default('new').$type<LeadStage>(),
    name: text('name'),
    budgetPrice: bigint('budget_price', { mode: 'number' }),
    budgetMonthly: bigint('budget_monthly', { mode: 'number' }),
    dpBudget: bigint('dp_budget', { mode: 'number' }),
    bedroomsWanted: integer('bedrooms_wanted'),
    purpose: text('purpose').$type<'own_use' | 'investment'>(),
    timeline: text('timeline'),
    domicileArea: text('domicile_area'),
    concerns: text('concerns').array().notNull().default(sql`'{}'`),
    typeInterest: integer('type_interest').array().notNull().default(sql`'{}'`),
    hotCold: text('hot_cold').$type<'hot' | 'warm' | 'cold'>(),
    lostReason: text('lost_reason'),
    assignedSalesId: uuid('assigned_sales_id').references(() => salesAgents.id, { onDelete: 'set null' }),
    summary: jsonb('summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('leads_stage_check', sql`${t.stage} in (${stageList})`),
    check('leads_purpose_check', sql`${t.purpose} in ('own_use', 'investment')`),
    check('leads_hot_cold_check', sql`${t.hotCold} in ('hot', 'warm', 'cold')`),
  ]
);

// ─── lead_events ───────────────────────────────────────────────────────────

export const LEAD_EVENT_KINDS = [
  'stage_changed',
  'fact_updated',
  'material_sent',
  'material_failed',
  'simulation_sent',
  'handoff',
  'opt_out',
  'project_set',
  'note',
  'visit_booked',
  'visit_rescheduled',
  'visit_cancelled',
  'visit_reassigned',
  'visit_outcome',
] as const;
export type LeadEventKind = (typeof LEAD_EVENT_KINDS)[number];

const eventKindList = sql.raw(LEAD_EVENT_KINDS.map((k) => `'${k}'`).join(', '));

export const leadEvents = pgTable(
  'lead_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<LeadEventKind>(),
    payload: jsonb('payload').notNull().default({}),
    // "moni", "staff:<uuid>" or "system".
    actor: text('actor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('lead_events_lead_created_idx').on(t.leadId, t.createdAt),
    check('lead_events_kind_check', sql`${t.kind} in (${eventKindList})`),
  ]
);
