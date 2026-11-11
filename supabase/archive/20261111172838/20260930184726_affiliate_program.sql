CREATE TABLE "commerce"."affiliate_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"affiliate_customer_id" uuid NOT NULL,
	"friend_customer_id" uuid,
	"code" text NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"reward_minor" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"rewarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affiliate_attributions_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "affiliate_attributions_order_key" UNIQUE("store_id","order_id"),
	CONSTRAINT "affiliate_attributions_status" CHECK ("commerce"."affiliate_attributions"."status" in ('pending', 'rewarded', 'reversed', 'rejected')),
	CONSTRAINT "affiliate_attributions_reward" CHECK ("commerce"."affiliate_attributions"."reward_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."affiliate_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"reward_bps" integer DEFAULT 500 NOT NULL,
	"reward_orders" integer DEFAULT 1,
	"friend_percent" integer DEFAULT 10 NOT NULL,
	"friend_max_minor" bigint,
	"monthly_cap_minor" bigint,
	"cookie_days" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "affiliate_settings_reward" CHECK ("commerce"."affiliate_settings"."reward_bps" between 0 and 5000),
	CONSTRAINT "affiliate_settings_orders" CHECK ("commerce"."affiliate_settings"."reward_orders" is null or "commerce"."affiliate_settings"."reward_orders" between 1 and 100),
	CONSTRAINT "affiliate_settings_friend" CHECK ("commerce"."affiliate_settings"."friend_percent" between 0 and 50),
	CONSTRAINT "affiliate_settings_friend_max" CHECK ("commerce"."affiliate_settings"."friend_max_minor" is null or "commerce"."affiliate_settings"."friend_max_minor" between 0 and 100000000),
	CONSTRAINT "affiliate_settings_cap" CHECK ("commerce"."affiliate_settings"."monthly_cap_minor" is null or "commerce"."affiliate_settings"."monthly_cap_minor" between 0 and 1000000000),
	CONSTRAINT "affiliate_settings_cookie" CHECK ("commerce"."affiliate_settings"."cookie_days" between 1 and 90)
);
--> statement-breakpoint
CREATE TABLE "commerce"."affiliates" (
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"code" text NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affiliates_store_id_customer_id_pk" PRIMARY KEY("store_id","customer_id"),
	CONSTRAINT "affiliates_code_key" UNIQUE("store_id","code"),
	CONSTRAINT "affiliates_code" CHECK ("commerce"."affiliates"."code" ~ '^[a-z0-9]{6,16}$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."referral_allocations" (
	"lot_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	CONSTRAINT "referral_allocations_lot_id_entry_id_pk" PRIMARY KEY("lot_id","entry_id"),
	CONSTRAINT "referral_allocations_amount" CHECK ("commerce"."referral_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."referral_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"source_kind" text,
	"source_ref" text,
	"referral_id" uuid,
	"invoice_ref" text,
	"available_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "referral_entries_kind" CHECK ("commerce"."referral_entries"."kind" in ('earn', 'apply', 'restore', 'reverse', 'adjust')),
	CONSTRAINT "referral_entries_amount" CHECK ("commerce"."referral_entries"."amount_minor" <> 0),
	CONSTRAINT "referral_entries_sign" CHECK (("commerce"."referral_entries"."kind" in ('earn', 'restore') and "commerce"."referral_entries"."amount_minor" > 0) or ("commerce"."referral_entries"."kind" in ('apply', 'reverse') and "commerce"."referral_entries"."amount_minor" < 0) or "commerce"."referral_entries"."kind" = 'adjust'),
	CONSTRAINT "referral_entries_lot" CHECK ("commerce"."referral_entries"."amount_minor" < 0 or "commerce"."referral_entries"."available_at" is not null),
	CONSTRAINT "referral_entries_note" CHECK (length("commerce"."referral_entries"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "commerce"."referral_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"commission_bps" integer DEFAULT 1000 NOT NULL,
	"months" integer DEFAULT 12 NOT NULL,
	"pending_days" integer DEFAULT 30 NOT NULL,
	"cookie_days" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "referral_settings_singleton" CHECK ("commerce"."referral_settings"."id"),
	CONSTRAINT "referral_settings_commission" CHECK ("commerce"."referral_settings"."commission_bps" between 0 and 5000),
	CONSTRAINT "referral_settings_months" CHECK ("commerce"."referral_settings"."months" between 1 and 60),
	CONSTRAINT "referral_settings_pending" CHECK ("commerce"."referral_settings"."pending_days" between 0 and 90),
	CONSTRAINT "referral_settings_cookie" CHECK ("commerce"."referral_settings"."cookie_days" between 1 and 90)
);
--> statement-breakpoint
CREATE TABLE "commerce"."referral_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"code" text NOT NULL,
	"day" date NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "referral_visits_count" CHECK ("commerce"."referral_visits"."visits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_account_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"access_request_id" uuid,
	"commission_bps" integer NOT NULL,
	"months" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"void_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_store_id_unique" UNIQUE("store_id"),
	CONSTRAINT "referrals_status" CHECK ("commerce"."referrals"."status" in ('active', 'void'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."referrers" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrers_code_unique" UNIQUE("code"),
	CONSTRAINT "referrers_code" CHECK ("commerce"."referrers"."code" ~ '^[a-z0-9]{6,16}$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."bonus_entries" DROP CONSTRAINT "bonus_entries_kind";--> statement-breakpoint
ALTER TABLE "commerce"."bonus_entries" DROP CONSTRAINT "bonus_entries_sign";--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "affiliate_code" text;--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD COLUMN "referred_by_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "referral_discount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "referral_discount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_affiliate_fk" FOREIGN KEY ("store_id","affiliate_customer_id") REFERENCES "commerce"."affiliates"("store_id","customer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_friend_fk" FOREIGN KEY ("store_id","friend_customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."affiliate_settings" ADD CONSTRAINT "affiliate_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."affiliate_settings" ADD CONSTRAINT "affiliate_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."affiliates" ADD CONSTRAINT "affiliates_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."affiliates" ADD CONSTRAINT "affiliates_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."referral_allocations" ADD CONSTRAINT "referral_allocations_lot_id_referral_entries_id_fk" FOREIGN KEY ("lot_id") REFERENCES "commerce"."referral_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."referral_allocations" ADD CONSTRAINT "referral_allocations_entry_id_referral_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "commerce"."referral_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."referral_entries" ADD CONSTRAINT "referral_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."referral_entries" ADD CONSTRAINT "referral_entries_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "commerce"."referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."referral_entries" ADD CONSTRAINT "referral_entries_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."referral_settings" ADD CONSTRAINT "referral_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."referral_visits" ADD CONSTRAINT "referral_visits_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."referrals" ADD CONSTRAINT "referrals_referrer_account_id_referrers_account_id_fk" FOREIGN KEY ("referrer_account_id") REFERENCES "commerce"."referrers"("account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."referrals" ADD CONSTRAINT "referrals_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."referrals" ADD CONSTRAINT "referrals_access_request_id_access_requests_id_fk" FOREIGN KEY ("access_request_id") REFERENCES "commerce"."access_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."referrers" ADD CONSTRAINT "referrers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affiliate_attributions_affiliate_idx" ON "commerce"."affiliate_attributions" USING btree ("store_id","affiliate_customer_id","created_at");--> statement-breakpoint
CREATE INDEX "affiliate_attributions_friend_idx" ON "commerce"."affiliate_attributions" USING btree ("store_id","friend_customer_id");--> statement-breakpoint
CREATE INDEX "affiliate_settings_updated_by_idx" ON "commerce"."affiliate_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "referral_allocations_entry_idx" ON "commerce"."referral_allocations" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "referral_entries_account_idx" ON "commerce"."referral_entries" USING btree ("account_id","currency","created_at");--> statement-breakpoint
CREATE INDEX "referral_entries_referral_idx" ON "commerce"."referral_entries" USING btree ("referral_id");--> statement-breakpoint
CREATE INDEX "referral_entries_source_idx" ON "commerce"."referral_entries" USING btree ("source_kind","source_ref");--> statement-breakpoint
CREATE INDEX "referral_entries_invoice_idx" ON "commerce"."referral_entries" USING btree ("invoice_ref");--> statement-breakpoint
CREATE INDEX "referral_entries_created_by_idx" ON "commerce"."referral_entries" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "referral_settings_updated_by_idx" ON "commerce"."referral_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_visits_key" ON "commerce"."referral_visits" USING btree (coalesce("store_id", '00000000-0000-0000-0000-000000000000'::uuid),"code","day");--> statement-breakpoint
CREATE INDEX "referral_visits_store_idx" ON "commerce"."referral_visits" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "commerce"."referrals" USING btree ("referrer_account_id","created_at");--> statement-breakpoint
CREATE INDEX "referrals_access_request_idx" ON "commerce"."referrals" USING btree ("access_request_id");--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD CONSTRAINT "customers_referred_by_fk" FOREIGN KEY ("store_id","referred_by_customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_referred_by_idx" ON "commerce"."customers" USING btree ("store_id","referred_by_customer_id");--> statement-breakpoint
ALTER TABLE "commerce"."bonus_entries" ADD CONSTRAINT "bonus_entries_kind" CHECK ("commerce"."bonus_entries"."kind" in ('earn', 'redeem', 'restore', 'reverse', 'expire', 'adjust', 'referral'));--> statement-breakpoint
ALTER TABLE "commerce"."bonus_entries" ADD CONSTRAINT "bonus_entries_sign" CHECK (("commerce"."bonus_entries"."kind" in ('earn', 'restore', 'referral') and "commerce"."bonus_entries"."amount_minor" > 0) or ("commerce"."bonus_entries"."kind" in ('redeem', 'reverse', 'expire') and "commerce"."bonus_entries"."amount_minor" < 0) or "commerce"."bonus_entries"."kind" = 'adjust');--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_referral_discount" CHECK ("commerce"."order_lines"."referral_discount_minor" between 0 and "commerce"."order_lines"."discount_minor");