CREATE TABLE "commerce"."bonus_allocations" (
	"store_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	CONSTRAINT "bonus_allocations_store_id_lot_id_entry_id_pk" PRIMARY KEY("store_id","lot_id","entry_id"),
	CONSTRAINT "bonus_allocations_amount" CHECK ("commerce"."bonus_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."bonus_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"order_id" uuid,
	"refund_id" uuid,
	"available_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bonus_entries_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "bonus_entries_idempotency_key" UNIQUE("store_id","idempotency_key"),
	CONSTRAINT "bonus_entries_kind" CHECK ("commerce"."bonus_entries"."kind" in ('earn', 'redeem', 'restore', 'reverse', 'expire', 'adjust')),
	CONSTRAINT "bonus_entries_amount" CHECK ("commerce"."bonus_entries"."amount_minor" <> 0),
	CONSTRAINT "bonus_entries_sign" CHECK (("commerce"."bonus_entries"."kind" in ('earn', 'restore') and "commerce"."bonus_entries"."amount_minor" > 0) or ("commerce"."bonus_entries"."kind" in ('redeem', 'reverse', 'expire') and "commerce"."bonus_entries"."amount_minor" < 0) or "commerce"."bonus_entries"."kind" = 'adjust'),
	CONSTRAINT "bonus_entries_lot" CHECK ("commerce"."bonus_entries"."amount_minor" < 0 or "commerce"."bonus_entries"."available_at" is not null),
	CONSTRAINT "bonus_entries_note" CHECK (length("commerce"."bonus_entries"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "commerce"."bonus_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"earn_bps" integer DEFAULT 500 NOT NULL,
	"pending_days" integer DEFAULT 14 NOT NULL,
	"max_redeem_percent" integer DEFAULT 50 NOT NULL,
	"min_redeem_minor" bigint DEFAULT 0 NOT NULL,
	"expires_months" integer,
	"currency" char(3) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "bonus_settings_earn" CHECK ("commerce"."bonus_settings"."earn_bps" between 0 and 5000),
	CONSTRAINT "bonus_settings_pending" CHECK ("commerce"."bonus_settings"."pending_days" between 0 and 90),
	CONSTRAINT "bonus_settings_max_redeem" CHECK ("commerce"."bonus_settings"."max_redeem_percent" between 1 and 90),
	CONSTRAINT "bonus_settings_min_redeem" CHECK ("commerce"."bonus_settings"."min_redeem_minor" between 0 and 1000000),
	CONSTRAINT "bonus_settings_expiry" CHECK ("commerce"."bonus_settings"."expires_months" is null or "commerce"."bonus_settings"."expires_months" between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "bonus_request_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "bonus_request_currency" char(3);--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "bonus_discount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "credit_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "bonus_earned_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "bonus_available_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."bonus_allocations" ADD CONSTRAINT "bonus_allocations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bonus_allocations" ADD CONSTRAINT "bonus_allocations_lot_fk" FOREIGN KEY ("store_id","lot_id") REFERENCES "commerce"."bonus_entries"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bonus_allocations" ADD CONSTRAINT "bonus_allocations_entry_fk" FOREIGN KEY ("store_id","entry_id") REFERENCES "commerce"."bonus_entries"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bonus_entries" ADD CONSTRAINT "bonus_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bonus_entries" ADD CONSTRAINT "bonus_entries_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bonus_entries" ADD CONSTRAINT "bonus_entries_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bonus_entries" ADD CONSTRAINT "bonus_entries_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bonus_entries" ADD CONSTRAINT "bonus_entries_refund_fk" FOREIGN KEY ("store_id","refund_id") REFERENCES "commerce"."refunds"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bonus_settings" ADD CONSTRAINT "bonus_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bonus_settings" ADD CONSTRAINT "bonus_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bonus_allocations_entry_idx" ON "commerce"."bonus_allocations" USING btree ("store_id","entry_id");--> statement-breakpoint
CREATE INDEX "bonus_entries_customer_idx" ON "commerce"."bonus_entries" USING btree ("store_id","customer_id","created_at");--> statement-breakpoint
CREATE INDEX "bonus_entries_order_idx" ON "commerce"."bonus_entries" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "bonus_entries_refund_idx" ON "commerce"."bonus_entries" USING btree ("store_id","refund_id");--> statement-breakpoint
CREATE INDEX "bonus_entries_created_by_idx" ON "commerce"."bonus_entries" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "bonus_entries_expiry_idx" ON "commerce"."bonus_entries" USING btree ("expires_at") WHERE "commerce"."bonus_entries"."amount_minor" > 0 and "commerce"."bonus_entries"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "bonus_settings_updated_by_idx" ON "commerce"."bonus_settings" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_bonus_request" CHECK ("commerce"."carts"."bonus_request_minor" >= 0);--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_bonus_discount" CHECK ("commerce"."order_lines"."bonus_discount_minor" between 0 and "commerce"."order_lines"."discount_minor");--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_credit" CHECK ("commerce"."orders"."credit_minor" between 0 and "commerce"."orders"."discount_minor");