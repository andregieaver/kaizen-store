CREATE TABLE "commerce"."theme_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"preset_id" uuid,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"notes" text,
	"author_name" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_submissions_kind" CHECK ("commerce"."theme_submissions"."kind" in ('theme', 'update')),
	CONSTRAINT "theme_submissions_status" CHECK ("commerce"."theme_submissions"."status" in ('waiting', 'reviewing', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "theme_submissions_update_preset" CHECK ("commerce"."theme_submissions"."kind" = 'theme' or "commerce"."theme_submissions"."preset_id" is not null),
	CONSTRAINT "theme_submissions_title" CHECK (length(btrim("commerce"."theme_submissions"."title")) between 1 and 80),
	CONSTRAINT "theme_submissions_summary" CHECK (length("commerce"."theme_submissions"."summary") <= 200),
	CONSTRAINT "theme_submissions_description" CHECK (length("commerce"."theme_submissions"."description") <= 2000),
	CONSTRAINT "theme_submissions_notes" CHECK ("commerce"."theme_submissions"."notes" is null or length("commerce"."theme_submissions"."notes") <= 2000),
	CONSTRAINT "theme_submissions_author_name" CHECK (length(btrim("commerce"."theme_submissions"."author_name")) between 1 and 80),
	CONSTRAINT "theme_submissions_reason" CHECK ("commerce"."theme_submissions"."reason" is null or length(btrim("commerce"."theme_submissions"."reason")) between 1 and 1000),
	CONSTRAINT "theme_submissions_rejected_reason" CHECK ("commerce"."theme_submissions"."status" <> 'rejected' or "commerce"."theme_submissions"."reason" is not null),
	CONSTRAINT "theme_submissions_snapshot" CHECK (jsonb_typeof("commerce"."theme_submissions"."snapshot") = 'object' and "commerce"."theme_submissions"."snapshot" ->> 'v' in ('1', '2') and octet_length("commerce"."theme_submissions"."snapshot"::text) <= 2000000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."store_theme_installs" ALTER COLUMN "follows_updates" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD COLUMN "author_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD COLUMN "author_name" text;--> statement-breakpoint
ALTER TABLE "commerce"."theme_submissions" ADD CONSTRAINT "theme_submissions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_submissions" ADD CONSTRAINT "theme_submissions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_submissions" ADD CONSTRAINT "theme_submissions_preset_id_design_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "commerce"."design_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_submissions" ADD CONSTRAINT "theme_submissions_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "theme_submissions_account_idx" ON "commerce"."theme_submissions" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "theme_submissions_status_idx" ON "commerce"."theme_submissions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "theme_submissions_store_idx" ON "commerce"."theme_submissions" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "theme_submissions_preset_idx" ON "commerce"."theme_submissions" USING btree ("preset_id");--> statement-breakpoint
CREATE INDEX "theme_submissions_decided_by_idx" ON "commerce"."theme_submissions" USING btree ("decided_by");--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD CONSTRAINT "design_presets_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_presets_author_idx" ON "commerce"."design_presets" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "product_market_texts_product_idx" ON "commerce"."product_market_texts" USING btree ("store_id","product_id");--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD CONSTRAINT "design_presets_author" CHECK (("commerce"."design_presets"."author_id" is null and "commerce"."design_presets"."author_name" is null) or ("commerce"."design_presets"."author_id" is not null and "commerce"."design_presets"."author_name" is not null and length(btrim("commerce"."design_presets"."author_name")) between 1 and 80));