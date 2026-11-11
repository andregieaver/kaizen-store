CREATE TABLE "commerce"."platform_theme_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preset_id" uuid,
	"version_id" uuid,
	"title" text NOT NULL,
	"look" jsonb,
	"live" boolean DEFAULT false NOT NULL,
	"installed_by" uuid,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"switched_at" timestamp with time zone,
	"placed" jsonb,
	CONSTRAINT "platform_theme_installs_title" CHECK (length(btrim("commerce"."platform_theme_installs"."title")) between 1 and 80),
	CONSTRAINT "platform_theme_installs_look" CHECK (("commerce"."platform_theme_installs"."live" and "commerce"."platform_theme_installs"."look" is null) or (not "commerce"."platform_theme_installs"."live" and coalesce(jsonb_typeof("commerce"."platform_theme_installs"."look") = 'object', false))),
	CONSTRAINT "platform_theme_installs_placed" CHECK ("commerce"."platform_theme_installs"."placed" is null or jsonb_typeof("commerce"."platform_theme_installs"."placed") = 'object')
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_theme_installs" ADD CONSTRAINT "platform_theme_installs_preset_id_design_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "commerce"."design_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_theme_installs" ADD CONSTRAINT "platform_theme_installs_version_id_design_preset_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "commerce"."design_preset_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_theme_installs" ADD CONSTRAINT "platform_theme_installs_installed_by_accounts_id_fk" FOREIGN KEY ("installed_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_theme_installs_live_idx" ON "commerce"."platform_theme_installs" USING btree ("live") WHERE "commerce"."platform_theme_installs"."live";--> statement-breakpoint
CREATE INDEX "platform_theme_installs_preset_idx" ON "commerce"."platform_theme_installs" USING btree ("preset_id");--> statement-breakpoint
CREATE INDEX "platform_theme_installs_version_idx" ON "commerce"."platform_theme_installs" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "platform_theme_installs_installed_by_idx" ON "commerce"."platform_theme_installs" USING btree ("installed_by");