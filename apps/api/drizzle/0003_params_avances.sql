CREATE TABLE IF NOT EXISTS "report_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source" varchar(30) NOT NULL,
	"definition" jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_circuit_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"circuit_id" integer NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"assignee" varchar(12) NOT NULL,
	"role" "role_code",
	"user_id" integer,
	"days" integer DEFAULT 3 NOT NULL,
	"min_amount" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_circuits" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"type" varchar(20) NOT NULL,
	"variant" varchar(30) DEFAULT 'TOUS' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "days" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_circuit_steps" ADD CONSTRAINT "workflow_circuit_steps_circuit_id_workflow_circuits_id_fk" FOREIGN KEY ("circuit_id") REFERENCES "public"."workflow_circuits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_circuit_steps" ADD CONSTRAINT "workflow_circuit_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_circuits" ADD CONSTRAINT "workflow_circuits_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_circuits_uq" ON "workflow_circuits" USING btree ("entity_id","type","variant");