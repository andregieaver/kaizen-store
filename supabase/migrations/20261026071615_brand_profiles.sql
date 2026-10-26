CREATE TABLE "commerce"."brand_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"tagline" text DEFAULT '' NOT NULL,
	"voice" text DEFAULT '' NOT NULL,
	"audience" text DEFAULT '' NOT NULL,
	"values" text[] DEFAULT '{}'::text[] NOT NULL,
	"avoid" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_profiles_store_key" UNIQUE NULLS NOT DISTINCT("store_id"),
	CONSTRAINT "brand_profiles_tagline" CHECK (length("commerce"."brand_profiles"."tagline") <= 120),
	CONSTRAINT "brand_profiles_voice" CHECK (length("commerce"."brand_profiles"."voice") <= 600),
	CONSTRAINT "brand_profiles_audience" CHECK (length("commerce"."brand_profiles"."audience") <= 400),
	CONSTRAINT "brand_profiles_values" CHECK (cardinality("commerce"."brand_profiles"."values") <= 5),
	CONSTRAINT "brand_profiles_avoid" CHECK (cardinality("commerce"."brand_profiles"."avoid") <= 10)
);
--> statement-breakpoint
ALTER TABLE "commerce"."brand_profiles" ADD CONSTRAINT "brand_profiles_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."brand_profiles" ADD CONSTRAINT "brand_profiles_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_profiles_updated_by_idx" ON "commerce"."brand_profiles" USING btree ("updated_by");