ALTER TABLE "commerce"."payments" ADD COLUMN "client_secret" text;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "checkout_ui" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stripe_accounts" ADD COLUMN "payment_domains" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_checkout_ui" CHECK ("commerce"."platform_settings"."checkout_ui" in ('custom', 'hosted'));