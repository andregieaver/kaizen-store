CREATE TABLE "commerce"."look_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"theme" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "look_versions_kind" CHECK ("commerce"."look_versions"."kind" in ('design', 'theme_tab', 'colours')),
	CONSTRAINT "look_versions_theme" CHECK (jsonb_typeof("commerce"."look_versions"."theme") = 'object')
);
--> statement-breakpoint
CREATE TABLE "commerce"."preview_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"page_id" uuid,
	"install_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "preview_links_target" CHECK (num_nonnulls("commerce"."preview_links"."page_id", "commerce"."preview_links"."install_id") = 1),
	CONSTRAINT "preview_links_token" CHECK ("commerce"."preview_links"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "preview_links_expiry" CHECK ("commerce"."preview_links"."expires_at" > "commerce"."preview_links"."created_at" and "commerce"."preview_links"."expires_at" <= "commerce"."preview_links"."created_at" + interval '30 days')
);
--> statement-breakpoint
CREATE TABLE "commerce"."theme_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"install_id" uuid,
	"live_at" timestamp with time zone NOT NULL,
	"revert_at" timestamp with time zone,
	"scheduled_by" uuid,
	"status" text DEFAULT 'waiting' NOT NULL,
	"problem" text,
	"done_at" timestamp with time zone,
	"revert_status" text,
	"revert_problem" text,
	"reverted_at" timestamp with time zone,
	"before_install_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_schedules_status" CHECK ("commerce"."theme_schedules"."status" in ('waiting', 'done', 'failed', 'cancelled')),
	CONSTRAINT "theme_schedules_revert_status" CHECK ("commerce"."theme_schedules"."revert_status" is null or "commerce"."theme_schedules"."revert_status" in ('waiting', 'done', 'failed', 'cancelled')),
	CONSTRAINT "theme_schedules_revert" CHECK (("commerce"."theme_schedules"."revert_at" is null) = ("commerce"."theme_schedules"."revert_status" is null) and ("commerce"."theme_schedules"."revert_at" is null or "commerce"."theme_schedules"."revert_at" > "commerce"."theme_schedules"."live_at"))
);
--> statement-breakpoint
ALTER TABLE "commerce"."page_schedules" ADD COLUMN "revert_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."page_schedules" ADD COLUMN "revert_status" text;--> statement-breakpoint
ALTER TABLE "commerce"."page_schedules" ADD COLUMN "revert_problem" text;--> statement-breakpoint
ALTER TABLE "commerce"."page_schedules" ADD COLUMN "reverted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."page_schedules" ADD COLUMN "before_content" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."page_schedules" ADD COLUMN "published_hash" text;--> statement-breakpoint
ALTER TABLE "commerce"."look_versions" ADD CONSTRAINT "look_versions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."look_versions" ADD CONSTRAINT "look_versions_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."preview_links" ADD CONSTRAINT "preview_links_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."preview_links" ADD CONSTRAINT "preview_links_install_id_store_theme_installs_id_fk" FOREIGN KEY ("install_id") REFERENCES "commerce"."store_theme_installs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."preview_links" ADD CONSTRAINT "preview_links_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."preview_links" ADD CONSTRAINT "preview_links_revoked_by_accounts_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."preview_links" ADD CONSTRAINT "preview_links_page_fk" FOREIGN KEY ("store_id","page_id") REFERENCES "commerce"."pages"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_schedules" ADD CONSTRAINT "theme_schedules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_schedules" ADD CONSTRAINT "theme_schedules_install_id_store_theme_installs_id_fk" FOREIGN KEY ("install_id") REFERENCES "commerce"."store_theme_installs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_schedules" ADD CONSTRAINT "theme_schedules_scheduled_by_accounts_id_fk" FOREIGN KEY ("scheduled_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_schedules" ADD CONSTRAINT "theme_schedules_before_install_id_store_theme_installs_id_fk" FOREIGN KEY ("before_install_id") REFERENCES "commerce"."store_theme_installs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "look_versions_store_idx" ON "commerce"."look_versions" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "look_versions_created_by_idx" ON "commerce"."look_versions" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "preview_links_token_idx" ON "commerce"."preview_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "preview_links_page_idx" ON "commerce"."preview_links" USING btree ("store_id","page_id");--> statement-breakpoint
CREATE INDEX "preview_links_install_idx" ON "commerce"."preview_links" USING btree ("install_id");--> statement-breakpoint
CREATE INDEX "preview_links_created_by_idx" ON "commerce"."preview_links" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "preview_links_revoked_by_idx" ON "commerce"."preview_links" USING btree ("revoked_by");--> statement-breakpoint
CREATE UNIQUE INDEX "theme_schedules_one_waiting_idx" ON "commerce"."theme_schedules" USING btree ("store_id") WHERE "commerce"."theme_schedules"."status" = 'waiting';--> statement-breakpoint
CREATE UNIQUE INDEX "theme_schedules_one_revert_idx" ON "commerce"."theme_schedules" USING btree ("store_id") WHERE "commerce"."theme_schedules"."revert_status" = 'waiting';--> statement-breakpoint
CREATE INDEX "theme_schedules_due_idx" ON "commerce"."theme_schedules" USING btree ("live_at") WHERE "commerce"."theme_schedules"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "theme_schedules_revert_due_idx" ON "commerce"."theme_schedules" USING btree ("revert_at") WHERE "commerce"."theme_schedules"."revert_status" = 'waiting';--> statement-breakpoint
CREATE INDEX "theme_schedules_store_idx" ON "commerce"."theme_schedules" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "theme_schedules_install_idx" ON "commerce"."theme_schedules" USING btree ("install_id");--> statement-breakpoint
CREATE INDEX "theme_schedules_before_install_idx" ON "commerce"."theme_schedules" USING btree ("before_install_id");--> statement-breakpoint
CREATE INDEX "theme_schedules_scheduled_by_idx" ON "commerce"."theme_schedules" USING btree ("scheduled_by");--> statement-breakpoint
CREATE UNIQUE INDEX "page_schedules_one_revert_idx" ON "commerce"."page_schedules" USING btree ("page_id") WHERE "commerce"."page_schedules"."revert_status" = 'waiting';--> statement-breakpoint
CREATE INDEX "page_schedules_revert_due_idx" ON "commerce"."page_schedules" USING btree ("revert_at") WHERE "commerce"."page_schedules"."revert_status" = 'waiting';--> statement-breakpoint
ALTER TABLE "commerce"."page_schedules" ADD CONSTRAINT "page_schedules_revert_status" CHECK ("commerce"."page_schedules"."revert_status" is null or "commerce"."page_schedules"."revert_status" in ('waiting', 'done', 'failed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "commerce"."page_schedules" ADD CONSTRAINT "page_schedules_revert" CHECK (("commerce"."page_schedules"."revert_at" is null) = ("commerce"."page_schedules"."revert_status" is null) and ("commerce"."page_schedules"."revert_at" is null or "commerce"."page_schedules"."revert_at" > "commerce"."page_schedules"."publish_at"));