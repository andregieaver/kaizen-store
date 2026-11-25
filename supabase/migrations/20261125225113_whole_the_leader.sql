ALTER TABLE "commerce"."autopilot_events" DROP CONSTRAINT "autopilot_events_kind";--> statement-breakpoint
ALTER TABLE "commerce"."rival_offers" ADD COLUMN "previous" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."rival_offers" ADD COLUMN "changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."rival_offers" ADD COLUMN "watched_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "rival_offers_read_idx" ON "commerce"."rival_offers" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "rival_offers_changed_idx" ON "commerce"."rival_offers" USING btree ("changed_at");--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_events" ADD CONSTRAINT "autopilot_events_kind" CHECK ("commerce"."autopilot_events"."kind" in ('support_waiting', 'test_ended', 'alert', 'order_unsent', 'delivery_problem', 'supplier_problem', 'order_held', 'dispute_opened', 'payments_failing', 'stockout_risk', 'staff_request', 'test_answered', 'exchange_confirmed', 'rival_changed'));--> statement-breakpoint
ALTER TABLE "commerce"."rival_offers" ADD CONSTRAINT "rival_offers_previous" CHECK ("commerce"."rival_offers"."previous" is null or jsonb_typeof("commerce"."rival_offers"."previous") = 'object');