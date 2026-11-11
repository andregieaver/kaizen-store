CREATE TABLE "commerce"."platform_payout_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"stripe_balance_transaction_id" text NOT NULL,
	"kind" text NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"fee_minor" bigint DEFAULT 0 NOT NULL,
	"net_minor" bigint NOT NULL,
	"sale_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_payout_lines_kind" CHECK ("commerce"."platform_payout_lines"."kind" in ('charge', 'refund', 'dispute', 'fee', 'adjustment', 'payout', 'other')),
	CONSTRAINT "platform_payout_lines_net" CHECK ("commerce"."platform_payout_lines"."net_minor" = "commerce"."platform_payout_lines"."amount_minor" - "commerce"."platform_payout_lines"."fee_minor")
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_payouts" ADD COLUMN "automatic" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_payouts" ADD COLUMN "lines_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."platform_payouts" ADD COLUMN "lines_complete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_payout_lines" ADD CONSTRAINT "platform_payout_lines_payout_id_platform_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "commerce"."platform_payouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_payout_lines" ADD CONSTRAINT "platform_payout_lines_sale_id_platform_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "commerce"."platform_sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_payout_lines_key" ON "commerce"."platform_payout_lines" USING btree ("payout_id","stripe_balance_transaction_id");--> statement-breakpoint
CREATE INDEX "platform_payout_lines_sale_idx" ON "commerce"."platform_payout_lines" USING btree ("sale_id");