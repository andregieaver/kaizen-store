ALTER TABLE "commerce"."platform_settings" ADD COLUMN "site_from_store" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "site_from_store_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "site_from_store_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_site_from_store_by_accounts_id_fk" FOREIGN KEY ("site_from_store_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_settings_site_from_store_by_idx" ON "commerce"."platform_settings" USING btree ("site_from_store_by");