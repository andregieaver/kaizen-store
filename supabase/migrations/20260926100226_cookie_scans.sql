CREATE TABLE "commerce"."cookie_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"category" text NOT NULL,
	"provider" text NOT NULL,
	"purpose" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "cookie_notes_kind" CHECK ("commerce"."cookie_notes"."kind" in ('cookie', 'localStorage', 'sessionStorage')),
	CONSTRAINT "cookie_notes_category" CHECK ("commerce"."cookie_notes"."category" in ('necessary', 'preferences', 'statistics', 'marketing')),
	CONSTRAINT "cookie_notes_lengths" CHECK (length("commerce"."cookie_notes"."name") between 1 and 200 and length("commerce"."cookie_notes"."domain") between 1 and 253 and length("commerce"."cookie_notes"."provider") between 1 and 100 and length("commerce"."cookie_notes"."purpose") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "commerce"."cookie_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by" uuid,
	"pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "cookie_scans_status" CHECK ("commerce"."cookie_scans"."status" in ('queued', 'running', 'done', 'failed')),
	CONSTRAINT "cookie_scans_items_array" CHECK (jsonb_typeof("commerce"."cookie_scans"."items") = 'array' and jsonb_typeof("commerce"."cookie_scans"."pages") = 'array')
);
--> statement-breakpoint
ALTER TABLE "commerce"."cookie_notes" ADD CONSTRAINT "cookie_notes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."cookie_notes" ADD CONSTRAINT "cookie_notes_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."cookie_scans" ADD CONSTRAINT "cookie_scans_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."cookie_scans" ADD CONSTRAINT "cookie_scans_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cookie_notes_item_idx" ON "commerce"."cookie_notes" USING btree (coalesce("store_id", '00000000-0000-0000-0000-000000000000'::uuid),"kind","name","domain");--> statement-breakpoint
CREATE INDEX "cookie_notes_store_idx" ON "commerce"."cookie_notes" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "cookie_notes_updated_by_idx" ON "commerce"."cookie_notes" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "cookie_scans_store_created_idx" ON "commerce"."cookie_scans" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "cookie_scans_requested_by_idx" ON "commerce"."cookie_scans" USING btree ("requested_by");--> statement-breakpoint
CREATE UNIQUE INDEX "cookie_scans_one_active_idx" ON "commerce"."cookie_scans" USING btree (coalesce("store_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "commerce"."cookie_scans"."status" in ('queued', 'running');