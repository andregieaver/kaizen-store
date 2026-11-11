CREATE TABLE "commerce"."legal_ai_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"publish" text DEFAULT 'auto' NOT NULL,
	"agreed" text,
	"turned_on_by" uuid,
	"turned_on_at" timestamp with time zone,
	"stopped_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"checked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_ai_settings_publish" CHECK ("commerce"."legal_ai_settings"."publish" in ('auto', 'ask'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."legal_ai_writes" DROP CONSTRAINT "legal_ai_writes_status";--> statement-breakpoint
ALTER TABLE "commerce"."legal_ai_writes" ADD COLUMN "sources" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."legal_ai_writes" ADD COLUMN "facts_hash" text;--> statement-breakpoint
ALTER TABLE "commerce"."legal_ai_writes" ADD COLUMN "saved_hash" text;--> statement-breakpoint
ALTER TABLE "commerce"."legal_ai_writes" ADD COLUMN "overwrite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."legal_ai_settings" ADD CONSTRAINT "legal_ai_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."legal_ai_settings" ADD CONSTRAINT "legal_ai_settings_turned_on_by_accounts_id_fk" FOREIGN KEY ("turned_on_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_ai_settings_account_idx" ON "commerce"."legal_ai_settings" USING btree ("turned_on_by");--> statement-breakpoint
ALTER TABLE "commerce"."legal_ai_writes" ADD CONSTRAINT "legal_ai_writes_status" CHECK ("commerce"."legal_ai_writes"."status" in ('queued', 'running', 'written', 'published', 'kept', 'failed'));