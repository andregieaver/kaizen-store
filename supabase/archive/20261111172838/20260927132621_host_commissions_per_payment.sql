-- One commission per payment (a booking's checkout, or a no-show fee), no
-- longer one per order. The table was empty when this was written.
ALTER TABLE "commerce"."host_commissions" DROP CONSTRAINT "host_commissions_pkey";--> statement-breakpoint
ALTER TABLE "commerce"."host_commissions" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."host_commissions" ADD COLUMN "payment_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."host_commissions" ADD COLUMN "kind" text DEFAULT 'booking' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."host_commissions" ADD CONSTRAINT "host_commissions_payment_fk" FOREIGN KEY ("store_id","payment_id") REFERENCES "commerce"."payments"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "host_commissions_order_idx" ON "commerce"."host_commissions" USING btree ("store_id","order_id");--> statement-breakpoint
ALTER TABLE "commerce"."host_commissions" ADD CONSTRAINT "host_commissions_payment_key" UNIQUE("store_id","payment_id");--> statement-breakpoint
ALTER TABLE "commerce"."host_commissions" ADD CONSTRAINT "host_commissions_kind" CHECK ("commerce"."host_commissions"."kind" in ('booking', 'no_show'));