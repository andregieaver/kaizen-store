ALTER TABLE "commerce"."design_presets" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD COLUMN "listing" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "design_presets_slug_idx" ON "commerce"."design_presets" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD CONSTRAINT "design_presets_slug" CHECK ("commerce"."design_presets"."slug" is null or "commerce"."design_presets"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$');--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD CONSTRAINT "design_presets_listing" CHECK (jsonb_typeof("commerce"."design_presets"."listing") = 'object');