CREATE TABLE "commerce"."payout_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"payout_id" uuid NOT NULL,
	"provider_reference" text NOT NULL,
	"kind" text NOT NULL,
	"provider_type" text NOT NULL,
	"source_reference" text,
	"amount_minor" bigint NOT NULL,
	"fee_minor" bigint DEFAULT 0 NOT NULL,
	"net_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"payment_id" uuid,
	"refund_id" uuid,
	"dispute_id" uuid,
	"order_id" uuid,
	"provider_created_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_lines_reference_key" UNIQUE("store_id","payout_id","provider_reference"),
	CONSTRAINT "payout_lines_kind" CHECK ("commerce"."payout_lines"."kind" in ('charge', 'refund', 'dispute', 'fee', 'adjustment', 'payout', 'other')),
	CONSTRAINT "payout_lines_net" CHECK ("commerce"."payout_lines"."net_minor" = "commerce"."payout_lines"."amount_minor" - "commerce"."payout_lines"."fee_minor")
);
--> statement-breakpoint
CREATE TABLE "commerce"."payout_reads" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"problem" text
);
--> statement-breakpoint
CREATE TABLE "commerce"."payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL,
	"provider_account" text NOT NULL,
	"test_mode" boolean DEFAULT false NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" text NOT NULL,
	"automatic" boolean NOT NULL,
	"arrival_on" date,
	"provider_created_at" timestamp with time zone NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"lines_read_at" timestamp with time zone,
	"lines_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "payouts_reference_key" UNIQUE("store_id","provider","provider_reference"),
	CONSTRAINT "payouts_provider" CHECK ("commerce"."payouts"."provider" in ('stripe')),
	CONSTRAINT "payouts_status" CHECK ("commerce"."payouts"."status" in ('pending', 'in_transit', 'paid', 'failed', 'canceled')),
	CONSTRAINT "payouts_failure" CHECK (("commerce"."payouts"."failure_code" is null or char_length("commerce"."payouts"."failure_code") <= 80) and ("commerce"."payouts"."failure_message" is null or char_length("commerce"."payouts"."failure_message") <= 300))
);
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "provider_fee_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "application_fee_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "fee_currency" char(3);--> statement-breakpoint
ALTER TABLE "commerce"."payout_lines" ADD CONSTRAINT "payout_lines_payout_fk" FOREIGN KEY ("store_id","payout_id") REFERENCES "commerce"."payouts"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payout_lines" ADD CONSTRAINT "payout_lines_payment_fk" FOREIGN KEY ("store_id","payment_id") REFERENCES "commerce"."payments"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payout_lines" ADD CONSTRAINT "payout_lines_refund_fk" FOREIGN KEY ("store_id","refund_id") REFERENCES "commerce"."refunds"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payout_lines" ADD CONSTRAINT "payout_lines_dispute_fk" FOREIGN KEY ("store_id","dispute_id") REFERENCES "commerce"."payment_disputes"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payout_lines" ADD CONSTRAINT "payout_lines_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payout_reads" ADD CONSTRAINT "payout_reads_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_lines_payout_idx" ON "commerce"."payout_lines" USING btree ("store_id","payout_id");--> statement-breakpoint
CREATE INDEX "payout_lines_payment_idx" ON "commerce"."payout_lines" USING btree ("store_id","payment_id") WHERE "commerce"."payout_lines"."payment_id" is not null;--> statement-breakpoint
CREATE INDEX "payout_lines_refund_idx" ON "commerce"."payout_lines" USING btree ("store_id","refund_id") WHERE "commerce"."payout_lines"."refund_id" is not null;--> statement-breakpoint
CREATE INDEX "payout_lines_dispute_idx" ON "commerce"."payout_lines" USING btree ("store_id","dispute_id") WHERE "commerce"."payout_lines"."dispute_id" is not null;--> statement-breakpoint
CREATE INDEX "payout_lines_order_idx" ON "commerce"."payout_lines" USING btree ("store_id","order_id") WHERE "commerce"."payout_lines"."order_id" is not null;--> statement-breakpoint
CREATE INDEX "payouts_arrival_idx" ON "commerce"."payouts" USING btree ("store_id","arrival_on");--> statement-breakpoint
CREATE INDEX "payouts_lines_due_idx" ON "commerce"."payouts" USING btree ("provider_created_at") WHERE "commerce"."payouts"."lines_read_at" is null and "commerce"."payouts"."status" = 'paid' and "commerce"."payouts"."automatic";--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_provider_fee" CHECK (("commerce"."payments"."provider_fee_minor" is null) = ("commerce"."payments"."fee_currency" is null) and ("commerce"."payments"."application_fee_minor" is null or "commerce"."payments"."provider_fee_minor" is not null)
        and ("commerce"."payments"."provider_fee_minor" is null or ("commerce"."payments"."provider" = 'stripe' and "commerce"."payments"."provider_fee_minor" >= 0 and coalesce("commerce"."payments"."application_fee_minor", 0) >= 0)));