CREATE TABLE "commerce"."store_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"street" text NOT NULL,
	"postal_code" text NOT NULL,
	"city" text NOT NULL,
	"country" char(2) NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"hours" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_locations_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "store_locations_kind" CHECK ("commerce"."store_locations"."kind" in ('office', 'shop', 'pickup')),
	CONSTRAINT "store_locations_named" CHECK ("commerce"."store_locations"."kind" = 'office' or length(trim("commerce"."store_locations"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."store_locations" ADD CONSTRAINT "store_locations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_locations_one_office" ON "commerce"."store_locations" USING btree ("store_id") WHERE "commerce"."store_locations"."kind" = 'office';--> statement-breakpoint
CREATE INDEX "store_locations_store_idx" ON "commerce"."store_locations" USING btree ("store_id","kind","position");