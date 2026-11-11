CREATE TABLE "commerce"."ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"provider" text NOT NULL,
	"base_url" text,
	"api_key_encrypted" text NOT NULL,
	"api_key_hint" text NOT NULL,
	"embedding_model" text,
	"text_model" text,
	"min_similarity" real DEFAULT 0.8 NOT NULL,
	"embedding_eu_only" boolean DEFAULT true NOT NULL,
	"text_eu_only" boolean DEFAULT true NOT NULL,
	"zero_data_retention" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "ai_providers_store_key" UNIQUE NULLS NOT DISTINCT("store_id"),
	CONSTRAINT "ai_providers_provider" CHECK ("commerce"."ai_providers"."provider" in ('gateway', 'mistral', 'openai', 'google', 'custom')),
	CONSTRAINT "ai_providers_base_url" CHECK (("commerce"."ai_providers"."provider" = 'custom') = ("commerce"."ai_providers"."base_url" is not null)),
	CONSTRAINT "ai_providers_min_similarity" CHECK ("commerce"."ai_providers"."min_similarity" between 0 and 1),
	CONSTRAINT "ai_providers_models" CHECK (coalesce(length("commerce"."ai_providers"."embedding_model") between 1 and 200, true) and coalesce(length("commerce"."ai_providers"."text_model") between 1 and 200, true))
);
--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD CONSTRAINT "ai_providers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD CONSTRAINT "ai_providers_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_providers_updated_by_idx" ON "commerce"."ai_providers" USING btree ("updated_by");