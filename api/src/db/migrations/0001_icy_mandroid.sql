CREATE TABLE "vles_mortgage_banks" (
	"id" integer PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"bank_id" integer,
	"bank_name" text,
	"branch_name" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"vles_updated_at" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vles_promos" (
	"id" integer PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"sales_category" text,
	"benefit_type" text,
	"benefit_amount" bigint,
	"benefit_percent" double precision,
	"valid_from" date,
	"valid_to" date,
	"status" text,
	"is_usable" boolean NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"vles_updated_at" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vles_sync_state" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"last_server_time" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "vles_unit_schemes" (
	"unit_id" integer NOT NULL,
	"scheme_id" integer NOT NULL,
	"name" text NOT NULL,
	"selling_price" bigint,
	"booking_fee" bigint,
	"deposit" bigint,
	"ppn" bigint,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vles_unit_schemes_unit_id_scheme_id_pk" PRIMARY KEY("unit_id","scheme_id")
);
--> statement-breakpoint
CREATE TABLE "vles_unit_types" (
	"id" integer PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"land_size" double precision,
	"building_size" double precision,
	"electric_power" integer,
	"sales_category" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"vles_updated_at" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vles_units" (
	"id" integer PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"area_id" integer NOT NULL,
	"area_name" text NOT NULL,
	"unit_number" text NOT NULL,
	"block" text,
	"house_type_id" integer NOT NULL,
	"house_type_name" text NOT NULL,
	"land_size" double precision,
	"building_size" double precision,
	"stage" integer NOT NULL,
	"stage_label" text,
	"marketing_stock_stage" integer,
	"is_available_for_sale" boolean NOT NULL,
	"selling_price" bigint,
	"price_list_in_period" boolean,
	"facing" text,
	"strategic_position" text,
	"strategic_fixed_cost" bigint,
	"sales_category" text,
	"business_group_label" text,
	"ready" boolean NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"vles_updated_at" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "vles_units_project_area_idx" ON "vles_units" USING btree ("project_id","area_id");--> statement-breakpoint
CREATE INDEX "vles_units_available_idx" ON "vles_units" USING btree ("id") WHERE "vles_units"."is_available_for_sale" and not "vles_units"."deleted";