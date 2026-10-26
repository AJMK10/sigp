ALTER TABLE "inventory_counts" ADD COLUMN "client_id" varchar(40);--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD COLUMN "source" varchar(8) DEFAULT 'WEB' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD COLUMN "lat" text;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD COLUMN "lng" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inv_counts_client_uq" ON "inventory_counts" USING btree ("client_id");