CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "push_subscriptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"staff_user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "sales_agent_projects" (
	"sales_agent_id" uuid NOT NULL,
	"project_id" integer NOT NULL,
	CONSTRAINT "sales_agent_projects_sales_agent_id_project_id_pk" PRIMARY KEY("sales_agent_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "sales_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"wa_phone" text NOT NULL,
	"staff_user_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_agents_wa_phone_unique" UNIQUE("wa_phone"),
	CONSTRAINT "sales_agents_staff_user_id_unique" UNIQUE("staff_user_id")
);
--> statement-breakpoint
CREATE TABLE "sales_availability" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_availability_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sales_agent_id" uuid NOT NULL,
	"project_id" integer NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	CONSTRAINT "sales_availability_weekday_check" CHECK ("sales_availability"."weekday" between 1 and 7),
	CONSTRAINT "sales_availability_start_format_check" CHECK ("sales_availability"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "sales_availability_end_format_check" CHECK ("sales_availability"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "sales_availability_order_check" CHECK ("sales_availability"."start_time" < "sales_availability"."end_time")
);
--> statement-breakpoint
CREATE TABLE "sales_time_off" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_time_off_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sales_agent_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	CONSTRAINT "sales_time_off_order_check" CHECK ("sales_time_off"."ends_at" > "sales_time_off"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scheduled_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"to_phone" text NOT NULL,
	"lead_id" uuid,
	"visit_id" uuid,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"wa_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_messages_kind_check" CHECK ("scheduled_messages"."kind" in ('sales_alert', 'reassign_notice', 'h1_reminder', 'followup', 'waiting_notice')),
	CONSTRAINT "scheduled_messages_status_check" CHECK ("scheduled_messages"."status" in ('pending', 'sent', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"project_id" integer NOT NULL,
	"sales_agent_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"type_interest" integer[] DEFAULT '{}' NOT NULL,
	"topics" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"rescheduled_from" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_status_check" CHECK ("visits"."status" in ('scheduled', 'confirmed', 'awaiting_confirmation', 'completed', 'no_show', 'cancelled', 'rescheduled'))
);
--> statement-breakpoint
ALTER TABLE "lead_events" DROP CONSTRAINT "lead_events_kind_check";--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_assigned_sales_id_staff_users_id_fk";
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "summary_refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_agent_projects" ADD CONSTRAINT "sales_agent_projects_sales_agent_id_sales_agents_id_fk" FOREIGN KEY ("sales_agent_id") REFERENCES "public"."sales_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_agent_projects" ADD CONSTRAINT "sales_agent_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_agents" ADD CONSTRAINT "sales_agents_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_availability" ADD CONSTRAINT "sales_availability_sales_agent_id_sales_agents_id_fk" FOREIGN KEY ("sales_agent_id") REFERENCES "public"."sales_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_availability" ADD CONSTRAINT "sales_availability_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_time_off" ADD CONSTRAINT "sales_time_off_sales_agent_id_sales_agents_id_fk" FOREIGN KEY ("sales_agent_id") REFERENCES "public"."sales_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_sales_agent_id_sales_agents_id_fk" FOREIGN KEY ("sales_agent_id") REFERENCES "public"."sales_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_rescheduled_from_visits_id_fk" FOREIGN KEY ("rescheduled_from") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_messages_dedupe" ON "scheduled_messages" USING btree ("dedupe_key") WHERE "scheduled_messages"."status" in ('pending', 'sent');--> statement-breakpoint
CREATE INDEX "scheduled_messages_due_idx" ON "scheduled_messages" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "visits_starts_at_idx" ON "visits" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_one_active_per_lead" ON "visits" USING btree ("lead_id") WHERE "visits"."status" in ('scheduled', 'confirmed', 'awaiting_confirmation');--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_sales_id_sales_agents_id_fk" FOREIGN KEY ("assigned_sales_id") REFERENCES "public"."sales_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_kind_check" CHECK ("lead_events"."kind" in ('stage_changed', 'fact_updated', 'material_sent', 'material_failed', 'simulation_sent', 'handoff', 'opt_out', 'project_set', 'note', 'visit_booked', 'visit_rescheduled', 'visit_cancelled', 'visit_reassigned', 'visit_outcome'));
--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_no_overlap" EXCLUDE USING gist
  ("sales_agent_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("status" in ('scheduled', 'confirmed', 'awaiting_confirmation') and not "is_test");
