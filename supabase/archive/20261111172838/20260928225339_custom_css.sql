ALTER TABLE "commerce"."platform_settings" ADD COLUMN "custom_css" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "custom_css" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_custom_css" CHECK (length("commerce"."platform_settings"."custom_css") <= 50000);--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_custom_css" CHECK (length("commerce"."stores"."custom_css") <= 50000);