CREATE TABLE "commerce"."research_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"kind" text DEFAULT 'note' NOT NULL,
	"topic" text NOT NULL,
	"finding" text NOT NULL,
	"sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"data" jsonb,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_notes_kind" CHECK ("commerce"."research_notes"."kind" in ('note', 'comparison')),
	CONSTRAINT "research_notes_topic" CHECK (length("commerce"."research_notes"."topic") between 1 and 200),
	CONSTRAINT "research_notes_finding" CHECK (length("commerce"."research_notes"."finding") between 1 and 2000),
	CONSTRAINT "research_notes_sources" CHECK (cardinality("commerce"."research_notes"."sources") <= 20)
);
--> statement-breakpoint
CREATE TABLE "commerce"."research_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"text_hash" text,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_sources_kind" CHECK ("commerce"."research_sources"."kind" in ('search', 'page')),
	CONSTRAINT "research_sources_url" CHECK (length("commerce"."research_sources"."url") between 1 and 2000),
	CONSTRAINT "research_sources_title" CHECK (length("commerce"."research_sources"."title") <= 300)
);
--> statement-breakpoint
CREATE TABLE "commerce"."search_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"provider" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"api_key_hint" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_settings_store_key" UNIQUE NULLS NOT DISTINCT("store_id"),
	CONSTRAINT "search_settings_provider" CHECK ("commerce"."search_settings"."provider" in ('brave'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."ai_model_prices" DROP CONSTRAINT "ai_model_prices_amounts";--> statement-breakpoint
ALTER TABLE "commerce"."ai_usage" DROP CONSTRAINT "ai_usage_kind";--> statement-breakpoint
ALTER TABLE "commerce"."ai_usage" DROP CONSTRAINT "ai_usage_amounts";--> statement-breakpoint
ALTER TABLE "commerce"."ai_model_prices" ADD COLUMN "per_thousand_searches" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "commerce"."ai_usage" ADD COLUMN "searches" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."research_notes" ADD CONSTRAINT "research_notes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."research_notes" ADD CONSTRAINT "research_notes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."research_sources" ADD CONSTRAINT "research_sources_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."research_sources" ADD CONSTRAINT "research_sources_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."search_settings" ADD CONSTRAINT "search_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."search_settings" ADD CONSTRAINT "search_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_notes_store_idx" ON "commerce"."research_notes" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "research_notes_account_idx" ON "commerce"."research_notes" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "research_sources_store_idx" ON "commerce"."research_sources" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "research_sources_url_idx" ON "commerce"."research_sources" USING btree ("store_id","url");--> statement-breakpoint
CREATE INDEX "research_sources_account_idx" ON "commerce"."research_sources" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "search_settings_updated_by_idx" ON "commerce"."search_settings" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."ai_model_prices" ADD CONSTRAINT "ai_model_prices_amounts" CHECK ("commerce"."ai_model_prices"."input_per_million" >= 0 and "commerce"."ai_model_prices"."output_per_million" >= 0 and "commerce"."ai_model_prices"."per_image" >= 0 and "commerce"."ai_model_prices"."per_audio_minute" >= 0 and "commerce"."ai_model_prices"."per_million_characters" >= 0 and "commerce"."ai_model_prices"."per_thousand_searches" >= 0);--> statement-breakpoint
ALTER TABLE "commerce"."ai_usage" ADD CONSTRAINT "ai_usage_kind" CHECK ("commerce"."ai_usage"."kind" in ('text', 'embedding', 'transcription', 'speech', 'image', 'live', 'search'));--> statement-breakpoint
ALTER TABLE "commerce"."ai_usage" ADD CONSTRAINT "ai_usage_amounts" CHECK ("commerce"."ai_usage"."requests" >= 0 and "commerce"."ai_usage"."failed" >= 0 and "commerce"."ai_usage"."input_tokens" >= 0 and "commerce"."ai_usage"."output_tokens" >= 0 and "commerce"."ai_usage"."characters" >= 0 and "commerce"."ai_usage"."audio_bytes" >= 0 and "commerce"."ai_usage"."audio_seconds" >= 0 and "commerce"."ai_usage"."images" >= 0 and "commerce"."ai_usage"."searches" >= 0);