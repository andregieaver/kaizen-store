ALTER TABLE "commerce"."form_submissions" DROP CONSTRAINT "form_submissions_kind";--> statement-breakpoint
ALTER TABLE "commerce"."draft_order_lines" ADD COLUMN "price_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."draft_orders" ADD COLUMN "source" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."draft_orders" ADD COLUMN "request_note" text;--> statement-breakpoint
ALTER TABLE "commerce"."draft_orders" ADD COLUMN "quote_declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."draft_orders" ADD COLUMN "quote_reply" text;--> statement-breakpoint
ALTER TABLE "commerce"."order_settings" ADD COLUMN "quote_requests" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "price_on_request" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "draft_orders_quote_idx" ON "commerce"."draft_orders" USING btree ("store_id","created_at" DESC NULLS LAST) WHERE "commerce"."draft_orders"."source" = 'quote';--> statement-breakpoint
ALTER TABLE "commerce"."draft_order_lines" ADD CONSTRAINT "draft_order_lines_price_requested" CHECK (not "commerce"."draft_order_lines"."price_requested" or ("commerce"."draft_order_lines"."variant_id" is not null and "commerce"."draft_order_lines"."unit_price_minor" = 0));--> statement-breakpoint
ALTER TABLE "commerce"."draft_orders" ADD CONSTRAINT "draft_orders_source" CHECK ("commerce"."draft_orders"."source" in ('staff', 'quote'));--> statement-breakpoint
ALTER TABLE "commerce"."draft_orders" ADD CONSTRAINT "draft_orders_quote" CHECK (("commerce"."draft_orders"."source" = 'quote' or ("commerce"."draft_orders"."request_note" is null and "commerce"."draft_orders"."quote_declined_at" is null))
        and ("commerce"."draft_orders"."quote_reply" is null or "commerce"."draft_orders"."quote_declined_at" is not null)
        and ("commerce"."draft_orders"."quote_declined_at" is null or "commerce"."draft_orders"."status" = 'open')
        and char_length("commerce"."draft_orders"."request_note") <= 2000 and char_length("commerce"."draft_orders"."quote_reply") <= 1000);--> statement-breakpoint
ALTER TABLE "commerce"."form_submissions" ADD CONSTRAINT "form_submissions_kind" CHECK ("commerce"."form_submissions"."kind" in ('message', 'subscription', 'quote'));--> statement-breakpoint
ALTER TABLE "commerce"."order_settings" ADD CONSTRAINT "order_settings_quote_requests" CHECK ("commerce"."order_settings"."quote_requests" in ('off', 'everyone', 'business'));--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_price_on_request_goods" CHECK (not "commerce"."products"."price_on_request" or "commerce"."products"."kind" = 'goods');