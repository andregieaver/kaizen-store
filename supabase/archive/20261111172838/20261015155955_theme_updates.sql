CREATE TABLE "commerce"."theme_install_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"install_id" uuid NOT NULL,
	"from_version_id" uuid,
	"to_version_id" uuid,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"kept" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "theme_install_updates_looks" CHECK (jsonb_typeof("commerce"."theme_install_updates"."before") = 'object' and jsonb_typeof("commerce"."theme_install_updates"."after") = 'object' and jsonb_typeof("commerce"."theme_install_updates"."kept") = 'object')
);
--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_versions" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "commerce"."store_theme_installs" ADD COLUMN "follows_updates" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."store_theme_installs" ADD COLUMN "placed" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."theme_install_updates" ADD CONSTRAINT "theme_install_updates_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_install_updates" ADD CONSTRAINT "theme_install_updates_install_id_store_theme_installs_id_fk" FOREIGN KEY ("install_id") REFERENCES "commerce"."store_theme_installs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_install_updates" ADD CONSTRAINT "theme_install_updates_from_version_id_design_preset_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "commerce"."design_preset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_install_updates" ADD CONSTRAINT "theme_install_updates_to_version_id_design_preset_versions_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "commerce"."design_preset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_install_updates" ADD CONSTRAINT "theme_install_updates_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "theme_install_updates_store_idx" ON "commerce"."theme_install_updates" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "theme_install_updates_install_idx" ON "commerce"."theme_install_updates" USING btree ("install_id");--> statement-breakpoint
CREATE INDEX "theme_install_updates_from_idx" ON "commerce"."theme_install_updates" USING btree ("from_version_id");--> statement-breakpoint
CREATE INDEX "theme_install_updates_to_idx" ON "commerce"."theme_install_updates" USING btree ("to_version_id");--> statement-breakpoint
CREATE INDEX "theme_install_updates_by_idx" ON "commerce"."theme_install_updates" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_versions" ADD CONSTRAINT "design_preset_versions_notes" CHECK ("commerce"."design_preset_versions"."notes" is null or length("commerce"."design_preset_versions"."notes") <= 2000);--> statement-breakpoint
ALTER TABLE "commerce"."store_theme_installs" ADD CONSTRAINT "store_theme_installs_placed" CHECK ("commerce"."store_theme_installs"."placed" is null or jsonb_typeof("commerce"."store_theme_installs"."placed") = 'object');