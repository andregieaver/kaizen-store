CREATE TABLE "commerce"."flow_segment_members" (
	"store_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flow_segment_members_flow_id_subscriber_id_pk" PRIMARY KEY("flow_id","subscriber_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."flow_segment_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."flows" DROP CONSTRAINT "flows_trigger";--> statement-breakpoint
ALTER TABLE "commerce"."flows" ADD COLUMN "trigger_segment_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."flows" ADD COLUMN "segment_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."flow_segment_members" ADD CONSTRAINT "flow_segment_members_flow_fk" FOREIGN KEY ("store_id","flow_id") REFERENCES "commerce"."flows"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."flow_segment_members" ADD CONSTRAINT "flow_segment_members_subscriber_fk" FOREIGN KEY ("store_id","subscriber_id") REFERENCES "commerce"."marketing_subscribers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flow_segment_members_subscriber_idx" ON "commerce"."flow_segment_members" USING btree ("store_id","subscriber_id");--> statement-breakpoint
ALTER TABLE "commerce"."flows" ADD CONSTRAINT "flows_trigger_segment" CHECK (("commerce"."flows"."trigger" = 'segment.entered') = ("commerce"."flows"."trigger_segment_id" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."flows" ADD CONSTRAINT "flows_trigger" CHECK ("commerce"."flows"."trigger" in ('subscriber.subscribed', 'order.paid', 'checkout.abandoned', 'order.sent', 'subscription.started', 'subscription.cancelled', 'form.response', 'quote.requested', 'review.created', 'order.refunded', 'return.requested', 'conversation.ended', 'conversation.rated', 'deal.created', 'deal.won', 'contract.signed', 'customer.lapsed', 'customer.browsed', 'subscriber.asleep', 'customer.birthday', 'segment.entered'));