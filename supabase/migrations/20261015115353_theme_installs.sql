CREATE TABLE "commerce"."design_preset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preset_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	CONSTRAINT "design_preset_versions_number" CHECK ("commerce"."design_preset_versions"."number" >= 1),
	CONSTRAINT "design_preset_versions_snapshot" CHECK (jsonb_typeof("commerce"."design_preset_versions"."snapshot") = 'object' and "commerce"."design_preset_versions"."snapshot" ->> 'v' = '1' and octet_length("commerce"."design_preset_versions"."snapshot"::text) <= 2000000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."store_theme_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"preset_id" uuid,
	"version_id" uuid,
	"title" text NOT NULL,
	"look" jsonb,
	"live" boolean DEFAULT false NOT NULL,
	"installed_by" uuid,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"switched_at" timestamp with time zone,
	CONSTRAINT "store_theme_installs_title" CHECK (length(btrim("commerce"."store_theme_installs"."title")) between 1 and 80),
	CONSTRAINT "store_theme_installs_look" CHECK (("commerce"."store_theme_installs"."live" and "commerce"."store_theme_installs"."look" is null) or (not "commerce"."store_theme_installs"."live" and coalesce(jsonb_typeof("commerce"."store_theme_installs"."look") = 'object', false)))
);
--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_uses" ADD COLUMN "install_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_uses" ADD COLUMN "previous_install_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_versions" ADD CONSTRAINT "design_preset_versions_preset_id_design_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "commerce"."design_presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_versions" ADD CONSTRAINT "design_preset_versions_published_by_accounts_id_fk" FOREIGN KEY ("published_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_theme_installs" ADD CONSTRAINT "store_theme_installs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_theme_installs" ADD CONSTRAINT "store_theme_installs_preset_id_design_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "commerce"."design_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_theme_installs" ADD CONSTRAINT "store_theme_installs_version_id_design_preset_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "commerce"."design_preset_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_theme_installs" ADD CONSTRAINT "store_theme_installs_installed_by_accounts_id_fk" FOREIGN KEY ("installed_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "design_preset_versions_number_idx" ON "commerce"."design_preset_versions" USING btree ("preset_id","number");--> statement-breakpoint
CREATE INDEX "design_preset_versions_published_by_idx" ON "commerce"."design_preset_versions" USING btree ("published_by");--> statement-breakpoint
CREATE UNIQUE INDEX "store_theme_installs_live_idx" ON "commerce"."store_theme_installs" USING btree ("store_id") WHERE "commerce"."store_theme_installs"."live";--> statement-breakpoint
CREATE INDEX "store_theme_installs_store_idx" ON "commerce"."store_theme_installs" USING btree ("store_id","installed_at");--> statement-breakpoint
CREATE INDEX "store_theme_installs_preset_idx" ON "commerce"."store_theme_installs" USING btree ("preset_id");--> statement-breakpoint
CREATE INDEX "store_theme_installs_version_idx" ON "commerce"."store_theme_installs" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "store_theme_installs_installed_by_idx" ON "commerce"."store_theme_installs" USING btree ("installed_by");--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_uses" ADD CONSTRAINT "design_preset_uses_install_id_store_theme_installs_id_fk" FOREIGN KEY ("install_id") REFERENCES "commerce"."store_theme_installs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_uses" ADD CONSTRAINT "design_preset_uses_previous_install_id_store_theme_installs_id_fk" FOREIGN KEY ("previous_install_id") REFERENCES "commerce"."store_theme_installs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_preset_uses_install_idx" ON "commerce"."design_preset_uses" USING btree ("install_id");--> statement-breakpoint
CREATE INDEX "design_preset_uses_previous_install_idx" ON "commerce"."design_preset_uses" USING btree ("previous_install_id");