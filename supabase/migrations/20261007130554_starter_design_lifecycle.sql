ALTER TABLE "commerce"."design_presets" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD COLUMN "workspace_store_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD COLUMN "workspace_key" text;--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD COLUMN "published_store_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "starter_copy_of" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD CONSTRAINT "design_presets_workspace_store_id_stores_id_fk" FOREIGN KEY ("workspace_store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD CONSTRAINT "design_presets_archived_by_accounts_id_fk" FOREIGN KEY ("archived_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD CONSTRAINT "store_starters_published_store_id_stores_id_fk" FOREIGN KEY ("published_store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD CONSTRAINT "store_starters_archived_by_accounts_id_fk" FOREIGN KEY ("archived_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_starter_copy_of_store_starters_id_fk" FOREIGN KEY ("starter_copy_of") REFERENCES "commerce"."store_starters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "design_presets_workspace_idx" ON "commerce"."design_presets" USING btree ("workspace_store_id");--> statement-breakpoint
CREATE INDEX "design_presets_archived_by_idx" ON "commerce"."design_presets" USING btree ("archived_by");--> statement-breakpoint
CREATE INDEX "store_starters_published_store_idx" ON "commerce"."store_starters" USING btree ("published_store_id");--> statement-breakpoint
CREATE INDEX "store_starters_archived_by_idx" ON "commerce"."store_starters" USING btree ("archived_by");--> statement-breakpoint
CREATE INDEX "stores_starter_copy_of_idx" ON "commerce"."stores" USING btree ("starter_copy_of");--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD CONSTRAINT "design_presets_archived_unpublished" CHECK (not ("commerce"."design_presets"."published" and "commerce"."design_presets"."archived_at" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD CONSTRAINT "design_presets_draft" CHECK ("commerce"."design_presets"."draft" is null or jsonb_typeof("commerce"."design_presets"."draft") = 'object');--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD CONSTRAINT "store_starters_archived_unpublished" CHECK (not ("commerce"."store_starters"."published" and "commerce"."store_starters"."archived_at" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD CONSTRAINT "store_starters_draft" CHECK ("commerce"."store_starters"."draft" is null or jsonb_typeof("commerce"."store_starters"."draft") = 'object');--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_starter_copy_is_starter" CHECK ("commerce"."stores"."starter_copy_of" is null or "commerce"."stores"."starter");