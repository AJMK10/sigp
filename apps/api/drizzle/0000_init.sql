CREATE TYPE "public"."asset_condition" AS ENUM('NEUF', 'BON', 'MOYEN', 'MAUVAIS', 'HORS_USAGE');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('EN_STOCK', 'EN_SERVICE', 'EN_MAINTENANCE', 'EN_PRET', 'EN_TRANSIT', 'MANQUANT', 'PROPOSE_REFORME', 'SORTI');--> statement-breakpoint
CREATE TYPE "public"."depr_method" AS ENUM('LINEAIRE', 'DEGRESSIF', 'NON_AMORTISSABLE');--> statement-breakpoint
CREATE TYPE "public"."entry_mode" AS ENUM('ACHAT', 'DON', 'TRANSFERT_ENTRANT', 'PRODUCTION', 'REGULARISATION', 'REPRISE');--> statement-breakpoint
CREATE TYPE "public"."label_status" AS ENUM('GENEREE', 'IMPRIMEE', 'POSEE', 'CONTROLEE');--> statement-breakpoint
CREATE TYPE "public"."location_kind" AS ENUM('SITE', 'BATIMENT', 'NIVEAU', 'LOCAL');--> statement-breakpoint
CREATE TYPE "public"."role_code" AS ENUM('ADMIN', 'DIRECTEUR', 'GESTIONNAIRE', 'COMPTABLE_MATIERES', 'FINANCES', 'CONTROLEUR', 'CHEF_EQUIPE', 'DETENTEUR');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"object_type" varchar(30) NOT NULL,
	"object_id" integer NOT NULL,
	"step" integer NOT NULL,
	"label" text NOT NULL,
	"role" "role_code",
	"user_id" integer,
	"status" varchar(12) DEFAULT 'ATTENTE' NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"comment" text,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"type" varchar(40) NOT NULL,
	"document_no" varchar(40),
	"summary" text NOT NULL,
	"actor_id" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"code" varchar(40) NOT NULL,
	"designation" text NOT NULL,
	"category_id" integer NOT NULL,
	"status" "asset_status" DEFAULT 'EN_STOCK' NOT NULL,
	"condition" "asset_condition" DEFAULT 'BON' NOT NULL,
	"serial_number" varchar(80),
	"brand" text,
	"model" text,
	"entry_mode" "entry_mode" DEFAULT 'ACHAT' NOT NULL,
	"acquisition_date" date NOT NULL,
	"in_service_date" date,
	"acquisition_value" bigint NOT NULL,
	"residual_value" bigint DEFAULT 0 NOT NULL,
	"opening_depreciation" bigint DEFAULT 0 NOT NULL,
	"depr_method" "depr_method" NOT NULL,
	"depr_years" integer NOT NULL,
	"location_id" integer,
	"org_unit_id" integer,
	"holder_id" integer,
	"label_status" "label_status" DEFAULT 'GENEREE' NOT NULL,
	"supplier" text,
	"invoice_ref" text,
	"reception_id" integer,
	"entry_order_no" varchar(40),
	"warranty_end" date,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"exit_date" date,
	"exit_reason" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attestations" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"holder_id" integer NOT NULL,
	"asset_count" integer NOT NULL,
	"disputed" boolean DEFAULT false NOT NULL,
	"comment" text,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" integer,
	"user_name" text,
	"action" varchar(40) NOT NULL,
	"object_type" varchar(30),
	"object_ref" varchar(60),
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" varchar(64),
	"prev_hash" varchar(64) NOT NULL,
	"hash" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"parent_id" integer,
	"code" varchar(20) NOT NULL,
	"label" text NOT NULL,
	"prefix" varchar(6),
	"asset_account" varchar(12),
	"depr_account" varchar(12),
	"expense_account" varchar(12),
	"method" "depr_method" DEFAULT 'LINEAIRE' NOT NULL,
	"duration_years" integer DEFAULT 5 NOT NULL,
	"threshold" bigint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "depreciation_lines" (
	"run_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"cumulative_after" bigint NOT NULL,
	"depr_account" varchar(12),
	"expense_account" varchar(12),
	CONSTRAINT "depreciation_lines_run_id_asset_id_pk" PRIMARY KEY("run_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "depreciation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"number" varchar(40) NOT NULL,
	"period" varchar(7) NOT NULL,
	"mode" varchar(12) NOT NULL,
	"asset_count" integer DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"anomalies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "disposal_items" (
	"disposal_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"motive" text NOT NULL,
	"nbv_at_proposal" bigint NOT NULL,
	"previous_status" "asset_status" NOT NULL,
	CONSTRAINT "disposal_items_disposal_id_asset_id_pk" PRIMARY KEY("disposal_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "disposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"number" varchar(40) NOT NULL,
	"title" text NOT NULL,
	"status" varchar(16) DEFAULT 'BROUILLON' NOT NULL,
	"exit_mode" varchar(20) DEFAULT 'VENTE' NOT NULL,
	"reason" text,
	"commission_date" date,
	"proceeds" bigint DEFAULT 0 NOT NULL,
	"exit_order_no" varchar(40),
	"created_by" integer NOT NULL,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disposals_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(12) NOT NULL,
	"short_code" varchar(12) NOT NULL,
	"name" text NOT NULL,
	"currency" varchar(3) DEFAULT 'XOF' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_periods" (
	"entity_id" integer NOT NULL,
	"period" varchar(7) NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" integer,
	CONSTRAINT "fiscal_periods_entity_id_period_pk" PRIMARY KEY("entity_id","period")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "holder_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"number" varchar(40) NOT NULL,
	"type" varchar(16) NOT NULL,
	"asset_id" integer,
	"description" text NOT NULL,
	"status" varchar(12) DEFAULT 'OUVERTE' NOT NULL,
	"response" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holder_requests_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"number" varchar(40) NOT NULL,
	"label" text NOT NULL,
	"type" varchar(20) DEFAULT 'GENERAL' NOT NULL,
	"status" varchar(16) DEFAULT 'PREPARATION' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"blind" boolean DEFAULT true NOT NULL,
	"freeze_movements" boolean DEFAULT true NOT NULL,
	"expected_count" integer DEFAULT 0 NOT NULL,
	"created_by" integer NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_campaigns_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_counts" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"zone_id" integer NOT NULL,
	"asset_id" integer,
	"scanned_code" varchar(60) NOT NULL,
	"location_id" integer,
	"condition" "asset_condition" NOT NULL,
	"comment" text,
	"counted_by" integer NOT NULL,
	"counted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_expected" (
	"campaign_id" integer NOT NULL,
	"zone_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"expected_location_id" integer,
	"expected_condition" "asset_condition",
	CONSTRAINT "inventory_expected_campaign_id_asset_id_pk" PRIMARY KEY("campaign_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_gaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"type" varchar(16) NOT NULL,
	"asset_id" integer,
	"scanned_code" varchar(60),
	"detail" text NOT NULL,
	"decision" varchar(30),
	"decision_comment" text,
	"status" varchar(12) DEFAULT 'A_TRAITER' NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_zones" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"leader_id" integer,
	"status" varchar(12) DEFAULT 'A_FAIRE' NOT NULL,
	"expected_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"number" varchar(40) NOT NULL,
	"origin_type" varchar(20) NOT NULL,
	"origin_ref" varchar(40) NOT NULL,
	"label" text NOT NULL,
	"date" date NOT NULL,
	"status" varchar(12) DEFAULT 'A_ENVOYER' NOT NULL,
	"total" bigint NOT NULL,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_batches_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"account" varchar(12) NOT NULL,
	"label" text NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"parent_id" integer,
	"kind" "location_kind" NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "movement_items" (
	"movement_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"from_location_id" integer,
	"from_org_unit_id" integer,
	"from_holder_id" integer,
	"from_status" "asset_status",
	CONSTRAINT "movement_items_movement_id_asset_id_pk" PRIMARY KEY("movement_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"number" varchar(40) NOT NULL,
	"type" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'A_VALIDER' NOT NULL,
	"to_location_id" integer,
	"to_org_unit_id" integer,
	"to_holder_id" integer,
	"due_date" date,
	"reason" text,
	"requested_by" integer NOT NULL,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movements_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" varchar(12) DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_units" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"parent_id" integer,
	"code" varchar(30) NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reception_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"reception_id" integer NOT NULL,
	"designation" text NOT NULL,
	"category_id" integer NOT NULL,
	"brand" text,
	"model" text,
	"qty_ordered" integer NOT NULL,
	"qty_delivered" integer NOT NULL,
	"qty_accepted" integer NOT NULL,
	"unit_value" bigint NOT NULL,
	"reserve" text,
	"serials" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"number" varchar(40) NOT NULL,
	"status" varchar(16) DEFAULT 'BROUILLON' NOT NULL,
	"entry_mode" "entry_mode" DEFAULT 'ACHAT' NOT NULL,
	"supplier" text NOT NULL,
	"order_ref" text,
	"delivery_note" text,
	"invoice_ref" text,
	"delivery_date" date NOT NULL,
	"location_id" integer,
	"notes" text,
	"created_by" integer NOT NULL,
	"validated_at" timestamp with time zone,
	"entry_order_no" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receptions_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequences" (
	"entity_id" integer NOT NULL,
	"key" varchar(40) NOT NULL,
	"year" integer NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sequences_entity_id_key_year_pk" PRIMARY KEY("entity_id","key","year")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"email" varchar(160) NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"title" text,
	"role" "role_code" NOT NULL,
	"org_unit_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approvals" ADD CONSTRAINT "approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_holder_id_users_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attestations" ADD CONSTRAINT "attestations_campaign_id_inventory_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."inventory_campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attestations" ADD CONSTRAINT "attestations_holder_id_users_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "categories" ADD CONSTRAINT "categories_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "depreciation_lines" ADD CONSTRAINT "depreciation_lines_run_id_depreciation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."depreciation_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "depreciation_lines" ADD CONSTRAINT "depreciation_lines_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disposal_items" ADD CONSTRAINT "disposal_items_disposal_id_disposals_id_fk" FOREIGN KEY ("disposal_id") REFERENCES "public"."disposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disposal_items" ADD CONSTRAINT "disposal_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disposals" ADD CONSTRAINT "disposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "holder_requests" ADD CONSTRAINT "holder_requests_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "holder_requests" ADD CONSTRAINT "holder_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_campaigns" ADD CONSTRAINT "inventory_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_campaign_id_inventory_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."inventory_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_zone_id_inventory_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."inventory_zones"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_expected" ADD CONSTRAINT "inventory_expected_campaign_id_inventory_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."inventory_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_expected" ADD CONSTRAINT "inventory_expected_zone_id_inventory_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."inventory_zones"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_expected" ADD CONSTRAINT "inventory_expected_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_gaps" ADD CONSTRAINT "inventory_gaps_campaign_id_inventory_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."inventory_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_gaps" ADD CONSTRAINT "inventory_gaps_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_gaps" ADD CONSTRAINT "inventory_gaps_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_zones" ADD CONSTRAINT "inventory_zones_campaign_id_inventory_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."inventory_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_zones" ADD CONSTRAINT "inventory_zones_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_zones" ADD CONSTRAINT "inventory_zones_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_batch_id_journal_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."journal_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "locations" ADD CONSTRAINT "locations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "movement_items" ADD CONSTRAINT "movement_items_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "movement_items" ADD CONSTRAINT "movement_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "movements" ADD CONSTRAINT "movements_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "movements" ADD CONSTRAINT "movements_to_org_unit_id_org_units_id_fk" FOREIGN KEY ("to_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "movements" ADD CONSTRAINT "movements_to_holder_id_users_id_fk" FOREIGN KEY ("to_holder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "movements" ADD CONSTRAINT "movements_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_units" ADD CONSTRAINT "org_units_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reception_lines" ADD CONSTRAINT "reception_lines_reception_id_receptions_id_fk" FOREIGN KEY ("reception_id") REFERENCES "public"."receptions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reception_lines" ADD CONSTRAINT "reception_lines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receptions" ADD CONSTRAINT "receptions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receptions" ADD CONSTRAINT "receptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_obj_idx" ON "approvals" USING btree ("object_type","object_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_events_asset_idx" ON "asset_events" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_code_uq" ON "assets" USING btree ("entity_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_status_idx" ON "assets" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_cat_idx" ON "assets" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_loc_idx" ON "assets" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_holder_idx" ON "assets" USING btree ("holder_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attestations_uq" ON "attestations" USING btree ("campaign_id","holder_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "categories_code_uq" ON "categories" USING btree ("entity_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "depr_runs_period_idx" ON "depreciation_runs" USING btree ("entity_id","period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_counts_campaign_idx" ON "inventory_counts" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "locations_code_uq" ON "locations" USING btree ("entity_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_units_code_uq" ON "org_units" USING btree ("entity_id","code");