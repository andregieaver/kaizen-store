CREATE TABLE "commerce"."ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"store_id" uuid,
	"owner_account_id" uuid,
	"actor_account_id" uuid,
	"source" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"kind" text NOT NULL,
	"feature" text DEFAULT 'other' NOT NULL,
	"requests" integer DEFAULT 1 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"characters" integer DEFAULT 0 NOT NULL,
	"audio_bytes" integer DEFAULT 0 NOT NULL,
	"audio_seconds" integer DEFAULT 0 NOT NULL,
	"images" integer DEFAULT 0 NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"session_ref" text,
	CONSTRAINT "ai_usage_source" CHECK ("commerce"."ai_usage"."source" in ('platform', 'store')),
	CONSTRAINT "ai_usage_kind" CHECK ("commerce"."ai_usage"."kind" in ('text', 'embedding', 'transcription', 'speech', 'image', 'live')),
	CONSTRAINT "ai_usage_amounts" CHECK ("commerce"."ai_usage"."requests" >= 0 and "commerce"."ai_usage"."failed" >= 0 and "commerce"."ai_usage"."input_tokens" >= 0 and "commerce"."ai_usage"."output_tokens" >= 0 and "commerce"."ai_usage"."characters" >= 0 and "commerce"."ai_usage"."audio_bytes" >= 0 and "commerce"."ai_usage"."audio_seconds" >= 0 and "commerce"."ai_usage"."images" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."ai_usage" ADD CONSTRAINT "ai_usage_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ai_usage" ADD CONSTRAINT "ai_usage_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ai_usage" ADD CONSTRAINT "ai_usage_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "commerce"."ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_store_idx" ON "commerce"."ai_usage" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_owner_idx" ON "commerce"."ai_usage" USING btree ("owner_account_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_actor_idx" ON "commerce"."ai_usage" USING btree ("actor_account_id");
--> statement-breakpoint
-- Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.ai_usage ENABLE ROW LEVEL SECURITY;
