CREATE TABLE "commerce"."event_cursors" (
	"consumer" text PRIMARY KEY NOT NULL,
	"last_tx" bigint DEFAULT 0 NOT NULL,
	"last_id" bigint DEFAULT 0 NOT NULL,
	"claim" uuid,
	"claimed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_cursors_consumer" CHECK ("commerce"."event_cursors"."consumer" ~ '^[a-z][a-z0-9_.:-]{0,99}$'),
	CONSTRAINT "event_cursors_claim" CHECK (("commerce"."event_cursors"."claim" is null) = ("commerce"."event_cursors"."claimed_until" is null)),
	CONSTRAINT "event_cursors_position" CHECK ("commerce"."event_cursors"."last_tx" >= 0 and "commerce"."event_cursors"."last_id" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid,
	"event" text NOT NULL,
	"subject_id" uuid,
	"tx" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_once_key" UNIQUE NULLS NOT DISTINCT("tx","store_id","event","subject_id"),
	CONSTRAINT "events_event" CHECK ("commerce"."events"."event" ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$' and char_length("commerce"."events"."event") <= 80)
);
--> statement-breakpoint
ALTER TABLE "commerce"."workflows" DROP CONSTRAINT "workflows_trigger";--> statement-breakpoint
ALTER TABLE "commerce"."abandoned_checkouts" ADD COLUMN "abandoned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."events" ADD CONSTRAINT "events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_order_idx" ON "commerce"."events" USING btree ("tx","id");--> statement-breakpoint
CREATE INDEX "events_store_order_idx" ON "commerce"."events" USING btree ("store_id","tx","id");--> statement-breakpoint
ALTER TABLE "commerce"."workflows" ADD CONSTRAINT "workflows_trigger" CHECK ("commerce"."workflows"."trigger" in ('order.paid', 'order.sent', 'order.cancelled', 'order.refunded', 'customer.created', 'subscription.started', 'subscription.cancelled', 'return.requested', 'withdrawal.received', 'product.created', 'product.updated', 'stock.low', 'discount.created', 'inventory.updated', 'product.archived', 'order.created', 'order.updated', 'fulfilment.created', 'fulfilment.updated', 'refund.created', 'return.updated', 'quote.requested', 'draft.sent', 'customer.updated', 'customer.erased', 'subscription.renewed', 'subscription.payment_failed', 'gift_card.issued', 'review.created', 'experiment.answered', 'contract.sent', 'contract.signed', 'contract.declined', 'form.response', 'support.waiting', 'deal.created', 'deal.stage_changed', 'deal.won', 'deal.lost', 'subscriber.subscribed', 'subscriber.unsubscribed', 'conversation.ended', 'conversation.rated', 'review.published', 'checkout.abandoned', 'work_client.created', 'work_invoice.sent', 'work_invoice.paid', 'work_invoice.credited', 'schedule'));