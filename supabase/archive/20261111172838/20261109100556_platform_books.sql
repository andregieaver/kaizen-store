CREATE TABLE "commerce"."platform_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"stripe_payout_id" text NOT NULL,
	"arrival_on" date NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"fee_minor" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_payouts_mode" CHECK ("commerce"."platform_payouts"."mode" in ('live', 'test')),
	CONSTRAINT "platform_payouts_fee" CHECK ("commerce"."platform_payouts"."fee_minor" >= 0),
	CONSTRAINT "platform_payouts_status" CHECK (char_length("commerce"."platform_payouts"."status") between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_sales" ADD COLUMN "settled_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."platform_sales" ADD COLUMN "settled_currency" char(3);--> statement-breakpoint
ALTER TABLE "commerce"."platform_sales" ADD COLUMN "fee_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "books_store_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_payouts_key" ON "commerce"."platform_payouts" USING btree ("mode","stripe_payout_id");--> statement-breakpoint
CREATE INDEX "platform_payouts_arrival_idx" ON "commerce"."platform_payouts" USING btree ("mode","arrival_on");--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_books_store_id_stores_id_fk" FOREIGN KEY ("books_store_id") REFERENCES "commerce"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_sales" ADD CONSTRAINT "platform_sales_settled" CHECK (("commerce"."platform_sales"."settled_minor" is null) = ("commerce"."platform_sales"."settled_currency" is null) and ("commerce"."platform_sales"."fee_minor" is null or "commerce"."platform_sales"."fee_minor" >= 0));