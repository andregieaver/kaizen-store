CREATE TABLE "commerce"."design_preset_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"preset_id" uuid NOT NULL,
	"previous" jsonb NOT NULL,
	"saved_theme_id" uuid,
	"applied_by" uuid,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restored_at" timestamp with time zone,
	"restored_by" uuid,
	CONSTRAINT "design_preset_uses_previous" CHECK (jsonb_typeof("commerce"."design_preset_uses"."previous") = 'object')
);
--> statement-breakpoint
CREATE TABLE "commerce"."design_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"picture_url" text,
	"snapshot" jsonb NOT NULL,
	"source_store_id" uuid,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_presets_title" CHECK (length(btrim("commerce"."design_presets"."title")) between 1 and 80),
	CONSTRAINT "design_presets_summary" CHECK (length("commerce"."design_presets"."summary") <= 200),
	CONSTRAINT "design_presets_description" CHECK (length("commerce"."design_presets"."description") <= 2000),
	CONSTRAINT "design_presets_picture_url" CHECK ("commerce"."design_presets"."picture_url" is null or (length("commerce"."design_presets"."picture_url") <= 2000 and "commerce"."design_presets"."picture_url" ~ '^(https://|/[^/])')),
	CONSTRAINT "design_presets_snapshot" CHECK (jsonb_typeof("commerce"."design_presets"."snapshot") = 'object' and "commerce"."design_presets"."snapshot" ->> 'v' = '1' and octet_length("commerce"."design_presets"."snapshot"::text) <= 2000000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD COLUMN "design_preset_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD COLUMN "recommended_design" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_uses" ADD CONSTRAINT "design_preset_uses_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_uses" ADD CONSTRAINT "design_preset_uses_preset_id_design_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "commerce"."design_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_uses" ADD CONSTRAINT "design_preset_uses_saved_theme_id_store_themes_id_fk" FOREIGN KEY ("saved_theme_id") REFERENCES "commerce"."store_themes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_uses" ADD CONSTRAINT "design_preset_uses_applied_by_accounts_id_fk" FOREIGN KEY ("applied_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_uses" ADD CONSTRAINT "design_preset_uses_restored_by_accounts_id_fk" FOREIGN KEY ("restored_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD CONSTRAINT "design_presets_source_store_id_stores_id_fk" FOREIGN KEY ("source_store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD CONSTRAINT "design_presets_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD CONSTRAINT "design_presets_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_preset_uses_store_idx" ON "commerce"."design_preset_uses" USING btree ("store_id","applied_at");--> statement-breakpoint
CREATE INDEX "design_preset_uses_preset_idx" ON "commerce"."design_preset_uses" USING btree ("preset_id");--> statement-breakpoint
CREATE INDEX "design_preset_uses_saved_theme_idx" ON "commerce"."design_preset_uses" USING btree ("saved_theme_id");--> statement-breakpoint
CREATE INDEX "design_preset_uses_applied_by_idx" ON "commerce"."design_preset_uses" USING btree ("applied_by");--> statement-breakpoint
CREATE INDEX "design_preset_uses_restored_by_idx" ON "commerce"."design_preset_uses" USING btree ("restored_by");--> statement-breakpoint
CREATE INDEX "design_presets_offered_idx" ON "commerce"."design_presets" USING btree ("published","position");--> statement-breakpoint
CREATE INDEX "design_presets_source_store_idx" ON "commerce"."design_presets" USING btree ("source_store_id");--> statement-breakpoint
CREATE INDEX "design_presets_created_by_idx" ON "commerce"."design_presets" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "design_presets_updated_by_idx" ON "commerce"."design_presets" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD CONSTRAINT "access_requests_design_preset_id_design_presets_id_fk" FOREIGN KEY ("design_preset_id") REFERENCES "commerce"."design_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD CONSTRAINT "store_starters_recommended_design_design_presets_id_fk" FOREIGN KEY ("recommended_design") REFERENCES "commerce"."design_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_requests_design_preset_idx" ON "commerce"."access_requests" USING btree ("design_preset_id");--> statement-breakpoint
CREATE INDEX "store_starters_recommended_design_idx" ON "commerce"."store_starters" USING btree ("recommended_design");