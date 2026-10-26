CREATE TYPE "public"."title_type" AS ENUM('TITRE_FONCIER', 'ACD', 'LETTRE_ATTRIBUTION', 'AUCUN');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"label" text NOT NULL,
	"value" bigint NOT NULL,
	"duration_years" integer NOT NULL,
	"in_service_date" date NOT NULL,
	"replaced_at" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_assets" (
	"contract_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	CONSTRAINT "contract_assets_contract_id_asset_id_pk" PRIMARY KEY("contract_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"number" varchar(40) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"title" text NOT NULL,
	"provider" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"annual_amount" bigint DEFAULT 0 NOT NULL,
	"insured_value" bigint DEFAULT 0 NOT NULL,
	"sla_hours" integer,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deadlines" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"kind" varchar(30) NOT NULL,
	"due_date" date NOT NULL,
	"done_at" date,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"object_type" varchar(20) NOT NULL,
	"object_id" integer NOT NULL,
	"category" varchar(30) NOT NULL,
	"filename" text NOT NULL,
	"mime" varchar(120) NOT NULL,
	"size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" integer NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_years" (
	"entity_id" integer NOT NULL,
	"year" integer NOT NULL,
	"status" varchar(10) DEFAULT 'OUVERT' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" integer,
	"summary" jsonb,
	CONSTRAINT "fiscal_years_entity_id_year_pk" PRIMARY KEY("entity_id","year")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fuel_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"date" date NOT NULL,
	"liters" integer NOT NULL,
	"amount" bigint NOT NULL,
	"mileage" integer NOT NULL,
	"station" text,
	"card_ref" text,
	"created_by" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"date" date NOT NULL,
	"account" varchar(12) NOT NULL,
	"label" text,
	"balance" bigint NOT NULL,
	"imported_by" integer NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maintenance_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"label" text NOT NULL,
	"asset_id" integer,
	"category_id" integer,
	"frequency_months" integer NOT NULL,
	"next_date" date NOT NULL,
	"contract_id" integer,
	"assignee" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "missions" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"number" varchar(40) NOT NULL,
	"asset_id" integer NOT NULL,
	"driver_id" integer,
	"requester_id" integer NOT NULL,
	"destination" text NOT NULL,
	"purpose" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" varchar(12) DEFAULT 'DEMANDE' NOT NULL,
	"start_mileage" integer,
	"end_mileage" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "missions_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "occupancies" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"kind" varchar(16) NOT NULL,
	"occupant" text NOT NULL,
	"org_unit_id" integer,
	"area" integer NOT NULL,
	"floors" text,
	"monthly_rent" bigint DEFAULT 0 NOT NULL,
	"start_date" date,
	"end_date" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "properties" (
	"asset_id" integer PRIMARY KEY NOT NULL,
	"kind" varchar(12) NOT NULL,
	"address" text,
	"lat" text,
	"lng" text,
	"land_area" integer,
	"built_area" integer,
	"floors" integer,
	"title_type" "title_type" DEFAULT 'AUCUN' NOT NULL,
	"title_ref" text,
	"owner" text,
	"assignment_act" text,
	"easements" text,
	"title_procedure" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "property_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"kind" varchar(16) NOT NULL,
	"title" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"date" date,
	"next_date" date,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reconciliation_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"date" date NOT NULL,
	"account" varchar(12) NOT NULL,
	"amount" bigint NOT NULL,
	"label" text NOT NULL,
	"status" varchar(12) DEFAULT 'A_CORRIGER' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "revaluation_items" (
	"revaluation_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"annual_before" bigint DEFAULT 0 NOT NULL,
	"annual_after" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "revaluation_items_revaluation_id_asset_id_pk" PRIMARY KEY("revaluation_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "revaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"number" varchar(40) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"effective_date" date NOT NULL,
	"new_years" integer,
	"status" varchar(12) DEFAULT 'BROUILLON' NOT NULL,
	"created_by" integer NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revaluations_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"kind" varchar(12) NOT NULL,
	"date" date NOT NULL,
	"driver_id" integer,
	"description" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"insurance_claim" text,
	"status" varchar(12) DEFAULT 'OUVERT' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicles" (
	"asset_id" integer PRIMARY KEY NOT NULL,
	"plate" varchar(20) NOT NULL,
	"vin" varchar(40),
	"energy" varchar(12) DEFAULT 'GASOIL' NOT NULL,
	"fiscal_power" integer,
	"seats" integer,
	"mileage" integer DEFAULT 0 NOT NULL,
	"driver_id" integer,
	"first_registration" date,
	"service_interval_km" integer DEFAULT 10000 NOT NULL,
	"last_service_km" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"number" varchar(40) NOT NULL,
	"asset_id" integer NOT NULL,
	"kind" varchar(12) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" varchar(8) DEFAULT 'NORMALE' NOT NULL,
	"status" varchar(16) DEFAULT 'A_PLANIFIER' NOT NULL,
	"assignee" text,
	"contract_id" integer,
	"request_id" integer,
	"plan_id" integer,
	"planned_date" date,
	"started_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"labor_cost" bigint DEFAULT 0 NOT NULL,
	"parts_cost" bigint DEFAULT 0 NOT NULL,
	"report" text,
	"previous_status" "asset_status",
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "revised_at" date;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "revised_cumulative" bigint;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "previous_years" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "impairment" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_components" ADD CONSTRAINT "asset_components_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_assets" ADD CONSTRAINT "contract_assets_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_assets" ADD CONSTRAINT "contract_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger_balances" ADD CONSTRAINT "ledger_balances_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "missions" ADD CONSTRAINT "missions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "missions" ADD CONSTRAINT "missions_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "missions" ADD CONSTRAINT "missions_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "occupancies" ADD CONSTRAINT "occupancies_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "occupancies" ADD CONSTRAINT "occupancies_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "properties" ADD CONSTRAINT "properties_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "property_events" ADD CONSTRAINT "property_events_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reconciliation_notes" ADD CONSTRAINT "reconciliation_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "revaluation_items" ADD CONSTRAINT "revaluation_items_revaluation_id_revaluations_id_fk" FOREIGN KEY ("revaluation_id") REFERENCES "public"."revaluations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "revaluation_items" ADD CONSTRAINT "revaluation_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "revaluations" ADD CONSTRAINT "revaluations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_incidents" ADD CONSTRAINT "vehicle_incidents_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_incidents" ADD CONSTRAINT "vehicle_incidents_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_obj_idx" ON "documents" USING btree ("object_type","object_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fuel_logs_asset_idx" ON "fuel_logs" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_balances_uq" ON "ledger_balances" USING btree ("entity_id","date","account");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_plate_uq" ON "vehicles" USING btree ("plate");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_orders_asset_idx" ON "work_orders" USING btree ("asset_id");