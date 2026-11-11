-- The index and check that name the new status 'authorized' are in the next migration (capture_later_rules): Postgres does not let a
-- transaction use an enum value it added.
ALTER TYPE "commerce"."order_status" ADD VALUE 'authorized' BEFORE 'paid';--> statement-breakpoint
ALTER TABLE "commerce"."refunds" DROP CONSTRAINT "refunds_kind";--> statement-breakpoint
ALTER TABLE "commerce"."order_settings" ADD COLUMN "capture" text DEFAULT 'at_checkout' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "capture_mode" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "capture_before" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "capture_warned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."order_settings" ADD CONSTRAINT "order_settings_capture" CHECK ("commerce"."order_settings"."capture" in ('at_checkout', 'when_sent', 'by_hand'));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_capture_mode" CHECK ("commerce"."orders"."capture_mode" is null or "commerce"."orders"."capture_mode" in ('when_sent', 'by_hand'));--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_release" CHECK ("commerce"."refunds"."kind" <> 'release' or ("commerce"."refunds"."provider_reference" is null and "commerce"."refunds"."status" = 'succeeded' and "commerce"."refunds"."exchange_id" is null and "commerce"."refunds"."order_edit_id" is null));--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_kind" CHECK ("commerce"."refunds"."kind" in ('money', 'transfer', 'release'));