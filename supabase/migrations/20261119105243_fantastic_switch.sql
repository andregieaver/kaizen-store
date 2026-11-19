ALTER TABLE "commerce"."flows" DROP CONSTRAINT "flows_trigger";--> statement-breakpoint
ALTER TABLE "commerce"."flows" ADD COLUMN "trigger_days" integer;--> statement-breakpoint
ALTER TABLE "commerce"."flows" ADD COLUMN "enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."flows" ADD CONSTRAINT "flows_trigger_days" CHECK (("commerce"."flows"."trigger" = 'customer.lapsed') = ("commerce"."flows"."trigger_days" is not null) and ("commerce"."flows"."trigger_days" is null or "commerce"."flows"."trigger_days" between 30 and 730));--> statement-breakpoint
ALTER TABLE "commerce"."flows" ADD CONSTRAINT "flows_trigger" CHECK ("commerce"."flows"."trigger" in ('subscriber.subscribed', 'order.paid', 'checkout.abandoned', 'customer.lapsed'));--> statement-breakpoint
-- A flow already on counts from when it was last switched on: switchFlow() wrote updated_at then.
UPDATE "commerce"."flows" SET "enabled_at" = "updated_at" WHERE "enabled" AND "enabled_at" IS NULL;
