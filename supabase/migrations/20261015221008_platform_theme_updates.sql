CREATE TABLE "commerce"."platform_theme_install_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"install_id" uuid NOT NULL,
	"from_version_id" uuid,
	"to_version_id" uuid,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"kept" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "platform_theme_install_updates_looks" CHECK (jsonb_typeof("commerce"."platform_theme_install_updates"."before") = 'object' and jsonb_typeof("commerce"."platform_theme_install_updates"."after") = 'object' and jsonb_typeof("commerce"."platform_theme_install_updates"."kept") = 'object')
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_theme_installs" ADD COLUMN "follows_updates" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_theme_install_updates" ADD CONSTRAINT "platform_theme_install_updates_install_id_platform_theme_installs_id_fk" FOREIGN KEY ("install_id") REFERENCES "commerce"."platform_theme_installs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_theme_install_updates" ADD CONSTRAINT "platform_theme_install_updates_from_version_id_design_preset_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "commerce"."design_preset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_theme_install_updates" ADD CONSTRAINT "platform_theme_install_updates_to_version_id_design_preset_versions_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "commerce"."design_preset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_theme_install_updates" ADD CONSTRAINT "platform_theme_install_updates_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_theme_install_updates_created_idx" ON "commerce"."platform_theme_install_updates" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "platform_theme_install_updates_install_idx" ON "commerce"."platform_theme_install_updates" USING btree ("install_id");--> statement-breakpoint
CREATE INDEX "platform_theme_install_updates_from_idx" ON "commerce"."platform_theme_install_updates" USING btree ("from_version_id");--> statement-breakpoint
CREATE INDEX "platform_theme_install_updates_to_idx" ON "commerce"."platform_theme_install_updates" USING btree ("to_version_id");--> statement-breakpoint
CREATE INDEX "platform_theme_install_updates_by_idx" ON "commerce"."platform_theme_install_updates" USING btree ("updated_by");