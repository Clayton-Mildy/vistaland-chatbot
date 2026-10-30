CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_email_unique" UNIQUE("email"),
	CONSTRAINT "staff_users_role_check" CHECK ("staff_users"."role" in ('admin', 'sales'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"persona_team_name" text NOT NULL,
	"location_label" text,
	"maps_url" text,
	"access_notes" text,
	"gallery_hours" jsonb,
	"visit_minutes" integer DEFAULT 60 NOT NULL,
	"same_day_min_notice_minutes" integer DEFAULT 120 NOT NULL,
	"vles_project_id" integer NOT NULL,
	"vles_area_ids" integer[] DEFAULT '{}' NOT NULL,
	"subsidi_notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
