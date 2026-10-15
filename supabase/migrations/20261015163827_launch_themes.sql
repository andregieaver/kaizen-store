ALTER TABLE "commerce"."design_presets" ADD COLUMN "launch_key" text;--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD COLUMN "launch_version" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "design_presets_launch_key_idx" ON "commerce"."design_presets" USING btree ("launch_key");--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD CONSTRAINT "design_presets_launch" CHECK ("commerce"."design_presets"."launch_version" is null or ("commerce"."design_presets"."launch_key" is not null and "commerce"."design_presets"."launch_version" > 0));