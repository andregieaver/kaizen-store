CREATE TABLE "commerce"."chat_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"occupation" text DEFAULT '' NOT NULL,
	"avatar" jsonb,
	"greeting" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"voice" boolean DEFAULT false NOT NULL,
	"daily_limit" integer DEFAULT 500 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "chat_agents_store_key" UNIQUE NULLS NOT DISTINCT("store_id"),
	CONSTRAINT "chat_agents_name" CHECK (length("commerce"."chat_agents"."name") <= 60),
	CONSTRAINT "chat_agents_occupation" CHECK (length("commerce"."chat_agents"."occupation") <= 80),
	CONSTRAINT "chat_agents_instructions" CHECK (length("commerce"."chat_agents"."instructions") <= 2000),
	CONSTRAINT "chat_agents_daily_limit" CHECK ("commerce"."chat_agents"."daily_limit" between 1 and 100000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."chat_usage" (
	"store_id" uuid,
	"bucket" text NOT NULL,
	"window" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "chat_usage_key" UNIQUE NULLS NOT DISTINCT("store_id","bucket","window"),
	CONSTRAINT "chat_usage_count" CHECK ("commerce"."chat_usage"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"title" text NOT NULL,
	"file_name" text,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "knowledge_documents_title" CHECK (length("commerce"."knowledge_documents"."title") between 1 and 200),
	CONSTRAINT "knowledge_documents_content" CHECK (length("commerce"."knowledge_documents"."content") between 1 and 200000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD COLUMN "transcription_model" text;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD COLUMN "speech_model" text;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD COLUMN "speech_voice" text;--> statement-breakpoint
ALTER TABLE "commerce"."chat_agents" ADD CONSTRAINT "chat_agents_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."chat_agents" ADD CONSTRAINT "chat_agents_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."chat_usage" ADD CONSTRAINT "chat_usage_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."knowledge_documents" ADD CONSTRAINT "knowledge_documents_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."knowledge_documents" ADD CONSTRAINT "knowledge_documents_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_agents_updated_by_idx" ON "commerce"."chat_agents" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "knowledge_documents_store_idx" ON "commerce"."knowledge_documents" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "knowledge_documents_created_by_idx" ON "commerce"."knowledge_documents" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD CONSTRAINT "ai_providers_voice_models" CHECK (coalesce(length("commerce"."ai_providers"."transcription_model") between 1 and 200, true) and coalesce(length("commerce"."ai_providers"."speech_model") between 1 and 200, true) and coalesce(length("commerce"."ai_providers"."speech_voice") between 1 and 100, true));