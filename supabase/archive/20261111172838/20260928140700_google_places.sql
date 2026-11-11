CREATE TABLE "commerce"."google_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"api_key_encrypted" text NOT NULL,
	"api_key_hint" text NOT NULL,
	"place_id" text,
	"place_name" text,
	"place_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "google_places_store_key" UNIQUE NULLS NOT DISTINCT("store_id"),
	CONSTRAINT "google_places_place_id" CHECK (coalesce("commerce"."google_places"."place_id" ~ '^[A-Za-z0-9_-]+$' and length("commerce"."google_places"."place_id") between 10 and 300, true)),
	CONSTRAINT "google_places_place_named" CHECK (("commerce"."google_places"."place_id" is null) = ("commerce"."google_places"."place_name" is null))
);
--> statement-breakpoint
ALTER TABLE "commerce"."google_places" ADD CONSTRAINT "google_places_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."google_places" ADD CONSTRAINT "google_places_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_places_updated_by_idx" ON "commerce"."google_places" USING btree ("updated_by");