CREATE TABLE "commerce"."legal_ai_writes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"account_id" uuid,
	"role" text NOT NULL,
	"why" text DEFAULT 'asked' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"page_id" uuid,
	"results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"languages" text[],
	"model" text,
	"problems" jsonb,
	"claimed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "legal_ai_writes_role" CHECK ("commerce"."legal_ai_writes"."role" in ('terms', 'privacy', 'returns_policy', 'shipping_policy', 'withdrawal_info', 'imprint')),
	CONSTRAINT "legal_ai_writes_why" CHECK ("commerce"."legal_ai_writes"."why" in ('asked', 'first', 'source_changed', 'facts_changed')),
	CONSTRAINT "legal_ai_writes_status" CHECK ("commerce"."legal_ai_writes"."status" in ('queued', 'running', 'written', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."legal_ai_writes" ADD CONSTRAINT "legal_ai_writes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."legal_ai_writes" ADD CONSTRAINT "legal_ai_writes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."legal_ai_writes" ADD CONSTRAINT "legal_ai_writes_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "commerce"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_ai_writes_queue_idx" ON "commerce"."legal_ai_writes" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "legal_ai_writes_store_idx" ON "commerce"."legal_ai_writes" USING btree ("store_id","role","created_at");--> statement-breakpoint
CREATE INDEX "legal_ai_writes_account_idx" ON "commerce"."legal_ai_writes" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "legal_ai_writes_page_idx" ON "commerce"."legal_ai_writes" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_ai_writes_active_idx" ON "commerce"."legal_ai_writes" USING btree ("store_id","role") WHERE "commerce"."legal_ai_writes"."status" in ('queued', 'running');