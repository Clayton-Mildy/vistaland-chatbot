CREATE TABLE "prompt_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "prompt_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"text" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_tags" (
	"tag" text PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"channel" text NOT NULL,
	"content_kind" text NOT NULL,
	CONSTRAINT "channel_tags_channel_check" CHECK ("channel_tags"."channel" in ('instagram', 'facebook', 'tiktok', 'other')),
	CONSTRAINT "channel_tags_content_kind_check" CHECK ("channel_tags"."content_kind" in ('promo', 'reels', 'general'))
);
--> statement-breakpoint
CREATE TABLE "kpr_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "kpr_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"bank_id" integer,
	"fixed_rate_pct" double precision NOT NULL,
	"fixed_years" integer NOT NULL,
	"floating_rate_pct" double precision NOT NULL,
	"tenor_options" integer[] NOT NULL,
	"dp_options_pct" double precision[] NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpr_settings_project_bank_unique" UNIQUE NULLS NOT DISTINCT("project_id","bank_id")
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "materials_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"house_type_id" integer,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"mime" text NOT NULL,
	"filename" text NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_kind_check" CHECK ("materials"."kind" in ('flyer', 'video', 'promo', 'floor_plan', 'brochure', 'photo'))
);
--> statement-breakpoint
CREATE TABLE "promo_copy" (
	"vles_promo_id" integer PRIMARY KEY NOT NULL,
	"customer_text" text NOT NULL,
	"terms_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheme_dp_overrides" (
	"scheme_name" text PRIMARY KEY NOT NULL,
	"dp_pct" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "type_profiles" (
	"house_type_id" integer PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"marketing_name" text,
	"bedrooms" integer,
	"bathrooms" integer,
	"floors" integer,
	"highlights" text,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wa_phone" text NOT NULL,
	"display_name" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"opted_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_wa_phone_unique" UNIQUE("wa_phone")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"wa_phone_number_id" text,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"human_takeover_until" timestamp with time zone,
	"last_customer_msg_at" timestamp with time zone,
	"last_moni_msg_at" timestamp with time zone,
	"last_canned_reply_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_contact_id_unique" UNIQUE("contact_id")
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"lead_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_events_kind_check" CHECK ("lead_events"."kind" in ('stage_changed', 'fact_updated', 'material_sent', 'material_failed', 'simulation_sent', 'handoff', 'opt_out', 'project_set', 'note'))
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"current_project_id" integer,
	"projects_of_interest" integer[] DEFAULT '{}' NOT NULL,
	"source_channel" text,
	"source_content_kind" text,
	"source_ref" text,
	"stage" text DEFAULT 'new' NOT NULL,
	"name" text,
	"budget_price" bigint,
	"budget_monthly" bigint,
	"dp_budget" bigint,
	"bedrooms_wanted" integer,
	"purpose" text,
	"timeline" text,
	"domicile_area" text,
	"concerns" text[] DEFAULT '{}' NOT NULL,
	"type_interest" integer[] DEFAULT '{}' NOT NULL,
	"hot_cold" text,
	"lost_reason" text,
	"assigned_sales_id" uuid,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_contact_id_unique" UNIQUE("contact_id"),
	CONSTRAINT "leads_stage_check" CHECK ("leads"."stage" in ('new', 'engaged', 'qualified', 'recommended', 'visit_proposed', 'visit_scheduled', 'visit_confirmed', 'visited', 'no_show', 'cancelled', 'lost', 'opted_out')),
	CONSTRAINT "leads_purpose_check" CHECK ("leads"."purpose" in ('own_use', 'investment')),
	CONSTRAINT "leads_hot_cold_check" CHECK ("leads"."hot_cold" in ('hot', 'warm', 'cold'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"wa_message_id" text,
	"direction" text NOT NULL,
	"sender" text NOT NULL,
	"staff_user_id" uuid,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text NOT NULL,
	"media_url" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_wa_message_id_unique" UNIQUE("wa_message_id"),
	CONSTRAINT "messages_direction_check" CHECK ("messages"."direction" in ('in', 'out')),
	CONSTRAINT "messages_sender_check" CHECK ("messages"."sender" in ('customer', 'moni', 'staff', 'system')),
	CONSTRAINT "messages_status_check" CHECK ("messages"."status" in ('received', 'sent', 'failed', 'recorded'))
);
--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_tags" ADD CONSTRAINT "channel_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpr_settings" ADD CONSTRAINT "kpr_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "type_profiles" ADD CONSTRAINT "type_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_current_project_id_projects_id_fk" FOREIGN KEY ("current_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_sales_id_staff_users_id_fk" FOREIGN KEY ("assigned_sales_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_events_lead_created_idx" ON "lead_events" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");