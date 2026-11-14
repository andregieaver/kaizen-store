ALTER TABLE "commerce"."stores" ADD COLUMN "checkout_phone" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "checkout_name" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_checkout_phone" CHECK ("commerce"."stores"."checkout_phone" in ('off', 'optional', 'required'));--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_checkout_name" CHECK ("commerce"."stores"."checkout_name" in ('off', 'optional', 'required'));