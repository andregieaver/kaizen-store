CREATE TABLE "commerce"."gift_card_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"order_id" uuid,
	"account_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_card_entries_key" UNIQUE("store_id","card_id","idempotency_key"),
	CONSTRAINT "gift_card_entries_kind" CHECK ("commerce"."gift_card_entries"."kind" in ('issue', 'hold', 'release', 'spend', 'refund', 'adjust', 'expire', 'void')),
	CONSTRAINT "gift_card_entries_sign" CHECK (("commerce"."gift_card_entries"."kind" in ('issue', 'release', 'refund') and "commerce"."gift_card_entries"."amount_minor" > 0) or ("commerce"."gift_card_entries"."kind" in ('hold', 'expire', 'void') and "commerce"."gift_card_entries"."amount_minor" < 0)
        or ("commerce"."gift_card_entries"."kind" = 'spend' and "commerce"."gift_card_entries"."amount_minor" = 0) or ("commerce"."gift_card_entries"."kind" = 'adjust' and "commerce"."gift_card_entries"."amount_minor" <> 0)),
	CONSTRAINT "gift_card_entries_order" CHECK ("commerce"."gift_card_entries"."kind" not in ('hold', 'release', 'spend', 'refund') or "commerce"."gift_card_entries"."order_id" is not null),
	CONSTRAINT "gift_card_entries_staff" CHECK ("commerce"."gift_card_entries"."kind" not in ('adjust', 'void') or "commerce"."gift_card_entries"."account_id" is not null),
	CONSTRAINT "gift_card_entries_note" CHECK (length("commerce"."gift_card_entries"."note") <= 500 and ("commerce"."gift_card_entries"."kind" <> 'adjust' or length(trim("commerce"."gift_card_entries"."note")) > 0))
);
--> statement-breakpoint
CREATE TABLE "commerce"."gift_card_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"expiry_months" integer DEFAULT 36,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_card_settings_expiry" CHECK ("commerce"."gift_card_settings"."expiry_months" is null or "commerce"."gift_card_settings"."expiry_months" between 12 and 120)
);
--> statement-breakpoint
CREATE TABLE "commerce"."gift_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"code_hash" text,
	"last4" text,
	"currency" char(3) NOT NULL,
	"initial_minor" bigint NOT NULL,
	"source" text NOT NULL,
	"order_id" uuid,
	"order_line_id" uuid,
	"unit_index" integer,
	"issued_by" uuid,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"test_mode" boolean DEFAULT false NOT NULL,
	"customer_id" uuid,
	"recipient_email" text,
	"recipient_name" text,
	"message" text,
	"send_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"deactivated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_cards_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "gift_cards_currency" CHECK ("commerce"."gift_cards"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "gift_cards_initial" CHECK ("commerce"."gift_cards"."initial_minor" > 0),
	CONSTRAINT "gift_cards_source" CHECK (("commerce"."gift_cards"."source" = 'order' and "commerce"."gift_cards"."order_id" is not null and "commerce"."gift_cards"."order_line_id" is not null and "commerce"."gift_cards"."unit_index" >= 1) or ("commerce"."gift_cards"."source" = 'staff' and "commerce"."gift_cards"."order_id" is null and "commerce"."gift_cards"."order_line_id" is null and "commerce"."gift_cards"."unit_index" is null and "commerce"."gift_cards"."issued_by" is not null)),
	CONSTRAINT "gift_cards_status" CHECK ("commerce"."gift_cards"."status" in ('active', 'deactivated') and (("commerce"."gift_cards"."status" = 'deactivated') = ("commerce"."gift_cards"."deactivated_at" is not null))),
	CONSTRAINT "gift_cards_code" CHECK (("commerce"."gift_cards"."code_hash" is null) = ("commerce"."gift_cards"."last4" is null) and ("commerce"."gift_cards"."last4" is null or "commerce"."gift_cards"."last4" ~ '^[A-Z0-9]{4}$')),
	CONSTRAINT "gift_cards_recipient" CHECK (("commerce"."gift_cards"."recipient_email" is null or length("commerce"."gift_cards"."recipient_email") <= 254) and ("commerce"."gift_cards"."recipient_name" is null or length("commerce"."gift_cards"."recipient_name") <= 80) and ("commerce"."gift_cards"."message" is null or length("commerce"."gift_cards"."message") <= 500)),
	CONSTRAINT "gift_cards_note" CHECK (length("commerce"."gift_cards"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."stores" DROP CONSTRAINT "stores_features";--> statement-breakpoint
ALTER TABLE "commerce"."gift_card_entries" ADD CONSTRAINT "gift_card_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."gift_card_entries" ADD CONSTRAINT "gift_card_entries_card_fk" FOREIGN KEY ("store_id","card_id") REFERENCES "commerce"."gift_cards"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."gift_card_entries" ADD CONSTRAINT "gift_card_entries_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."gift_card_settings" ADD CONSTRAINT "gift_card_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."gift_cards" ADD CONSTRAINT "gift_cards_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."gift_cards" ADD CONSTRAINT "gift_cards_issued_by_accounts_id_fk" FOREIGN KEY ("issued_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."gift_cards" ADD CONSTRAINT "gift_cards_deactivated_by_accounts_id_fk" FOREIGN KEY ("deactivated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."gift_cards" ADD CONSTRAINT "gift_cards_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gift_card_entries_card_idx" ON "commerce"."gift_card_entries" USING btree ("store_id","card_id","created_at");--> statement-breakpoint
CREATE INDEX "gift_card_entries_order_idx" ON "commerce"."gift_card_entries" USING btree ("store_id","order_id") WHERE "commerce"."gift_card_entries"."order_id" is not null;--> statement-breakpoint
CREATE INDEX "gift_card_entries_account_idx" ON "commerce"."gift_card_entries" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_code_key" ON "commerce"."gift_cards" USING btree ("store_id","code_hash") WHERE "commerce"."gift_cards"."code_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_order_line_key" ON "commerce"."gift_cards" USING btree ("store_id","order_line_id","unit_index") WHERE "commerce"."gift_cards"."order_line_id" is not null;--> statement-breakpoint
CREATE INDEX "gift_cards_order_idx" ON "commerce"."gift_cards" USING btree ("store_id","order_id") WHERE "commerce"."gift_cards"."order_id" is not null;--> statement-breakpoint
CREATE INDEX "gift_cards_customer_idx" ON "commerce"."gift_cards" USING btree ("store_id","customer_id") WHERE "commerce"."gift_cards"."customer_id" is not null;--> statement-breakpoint
CREATE INDEX "gift_cards_issued_by_idx" ON "commerce"."gift_cards" USING btree ("issued_by");--> statement-breakpoint
CREATE INDEX "gift_cards_deactivated_by_idx" ON "commerce"."gift_cards" USING btree ("deactivated_by");--> statement-breakpoint
CREATE INDEX "gift_cards_to_send_idx" ON "commerce"."gift_cards" USING btree ("send_at") WHERE "commerce"."gift_cards"."sent_at" is null and "commerce"."gift_cards"."code_hash" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_features" CHECK ("commerce"."stores"."features" <@ array['shop', 'subscriptions', 'boxes', 'appointments', 'bookings', 'countries', 'languages', 'currencies', 'business', 'bonus', 'referrals', 'gift_cards']::text[]);