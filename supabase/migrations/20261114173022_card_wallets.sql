CREATE TABLE "commerce"."agent_purchase_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"provider_ref" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"merchant_name" text,
	"merchant_category" text,
	"happened_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_purchase_charges_ref" UNIQUE("store_id","provider_ref"),
	CONSTRAINT "agent_purchase_charges_kind" CHECK ("commerce"."agent_purchase_charges"."kind" in ('authorization', 'clearing', 'reversal', 'refund', 'other')),
	CONSTRAINT "agent_purchase_charges_status" CHECK (char_length("commerce"."agent_purchase_charges"."status") between 1 and 40),
	CONSTRAINT "agent_purchase_charges_ref_length" CHECK (char_length("commerce"."agent_purchase_charges"."provider_ref") between 1 and 120),
	CONSTRAINT "agent_purchase_charges_amount" CHECK ("commerce"."agent_purchase_charges"."amount_minor" between 0 and 100000000000),
	CONSTRAINT "agent_purchase_charges_merchant" CHECK ("commerce"."agent_purchase_charges"."merchant_name" is null or char_length("commerce"."agent_purchase_charges"."merchant_name") <= 200),
	CONSTRAINT "agent_purchase_charges_category" CHECK ("commerce"."agent_purchase_charges"."merchant_category" is null or "commerce"."agent_purchase_charges"."merchant_category" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."agent_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"wallet_id" uuid,
	"what" text NOT NULL,
	"merchant" text NOT NULL,
	"merchant_url" text,
	"why" text DEFAULT '' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"spent_minor" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'issuing' NOT NULL,
	"card_id" text,
	"card_last4" text,
	"active_to" timestamp with time zone NOT NULL,
	"failure" text,
	"approved_by" uuid NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_purchases_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "agent_purchases_status" CHECK ("commerce"."agent_purchases"."status" in ('issuing', 'card_ready', 'spent', 'closed', 'cancelled', 'failed')),
	CONSTRAINT "agent_purchases_what" CHECK (char_length("commerce"."agent_purchases"."what") between 1 and 200),
	CONSTRAINT "agent_purchases_merchant" CHECK (char_length("commerce"."agent_purchases"."merchant") between 1 and 120),
	CONSTRAINT "agent_purchases_url" CHECK ("commerce"."agent_purchases"."merchant_url" is null or (char_length("commerce"."agent_purchases"."merchant_url") <= 500 and "commerce"."agent_purchases"."merchant_url" like 'https://%')),
	CONSTRAINT "agent_purchases_why" CHECK (char_length("commerce"."agent_purchases"."why") <= 500),
	CONSTRAINT "agent_purchases_amount" CHECK ("commerce"."agent_purchases"."amount_minor" between 1 and 100000000000),
	CONSTRAINT "agent_purchases_spent" CHECK ("commerce"."agent_purchases"."spent_minor" between 0 and 100000000000),
	CONSTRAINT "agent_purchases_card" CHECK ("commerce"."agent_purchases"."card_last4" is null or "commerce"."agent_purchases"."card_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "agent_purchases_failure" CHECK ("commerce"."agent_purchases"."failure" is null or char_length("commerce"."agent_purchases"."failure") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "commerce"."card_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"provider" text DEFAULT 'airwallex' NOT NULL,
	"mode" text NOT NULL,
	"account_id" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"access_expires_at" timestamp with time zone,
	"refresh_token_encrypted" text,
	"refresh_expires_at" timestamp with time zone,
	"cardholder_id" text,
	"cardholder_name" text,
	"currency" char(3) NOT NULL,
	"monthly_limit_minor" bigint,
	"paused" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'choose' NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_wallets_store" UNIQUE("store_id"),
	CONSTRAINT "card_wallets_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "card_wallets_provider" CHECK ("commerce"."card_wallets"."provider" in ('airwallex')),
	CONSTRAINT "card_wallets_mode" CHECK ("commerce"."card_wallets"."mode" in ('sandbox', 'live')),
	CONSTRAINT "card_wallets_state" CHECK ("commerce"."card_wallets"."state" in ('choose', 'on', 'auth_failed')),
	CONSTRAINT "card_wallets_account" CHECK (char_length("commerce"."card_wallets"."account_id") between 1 and 80),
	CONSTRAINT "card_wallets_cardholder" CHECK ("commerce"."card_wallets"."cardholder_id" is null or char_length("commerce"."card_wallets"."cardholder_id") between 1 and 80),
	CONSTRAINT "card_wallets_cardholder_name" CHECK ("commerce"."card_wallets"."cardholder_name" is null or char_length("commerce"."card_wallets"."cardholder_name") between 1 and 200),
	CONSTRAINT "card_wallets_limit" CHECK ("commerce"."card_wallets"."monthly_limit_minor" is null or "commerce"."card_wallets"."monthly_limit_minor" between 0 and 100000000000),
	CONSTRAINT "card_wallets_on" CHECK ("commerce"."card_wallets"."state" <> 'on' or "commerce"."card_wallets"."cardholder_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "commerce"."agent_purchase_charges" ADD CONSTRAINT "agent_purchase_charges_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."agent_purchase_charges" ADD CONSTRAINT "agent_purchase_charges_purchase_id_agent_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "commerce"."agent_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."agent_purchases" ADD CONSTRAINT "agent_purchases_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."agent_purchases" ADD CONSTRAINT "agent_purchases_wallet_id_card_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "commerce"."card_wallets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."agent_purchases" ADD CONSTRAINT "agent_purchases_approved_by_accounts_id_fk" FOREIGN KEY ("approved_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."card_wallets" ADD CONSTRAINT "card_wallets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."card_wallets" ADD CONSTRAINT "card_wallets_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_purchase_charges_purchase_idx" ON "commerce"."agent_purchase_charges" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "agent_purchases_store_idx" ON "commerce"."agent_purchases" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_purchases_open_idx" ON "commerce"."agent_purchases" USING btree ("status") WHERE "commerce"."agent_purchases"."status" in ('issuing', 'card_ready', 'spent');--> statement-breakpoint
CREATE INDEX "agent_purchases_wallet_idx" ON "commerce"."agent_purchases" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "agent_purchases_approved_by_idx" ON "commerce"."agent_purchases" USING btree ("approved_by");--> statement-breakpoint
CREATE INDEX "card_wallets_updated_by_idx" ON "commerce"."card_wallets" USING btree ("updated_by");