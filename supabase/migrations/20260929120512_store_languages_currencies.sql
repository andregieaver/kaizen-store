CREATE TABLE "commerce"."store_currencies" (
	"store_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"rate" numeric(20, 8),
	"round_to" integer DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_currencies_store_id_currency_pk" PRIMARY KEY("store_id","currency"),
	CONSTRAINT "store_currencies_rate" CHECK ("commerce"."store_currencies"."rate" is null or "commerce"."store_currencies"."rate" > 0),
	CONSTRAINT "store_currencies_round_to" CHECK ("commerce"."store_currencies"."round_to" between 1 and 100000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."carts" DROP CONSTRAINT "carts_market_fk";
--> statement-breakpoint
ALTER TABLE "commerce"."orders" DROP CONSTRAINT "orders_market_fk";
--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "locales" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "rates_auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "rates_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."store_currencies" ADD CONSTRAINT "store_currencies_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_market_fk" FOREIGN KEY ("store_id","market_code") REFERENCES "commerce"."markets"("store_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_market_fk" FOREIGN KEY ("store_id","market_code") REFERENCES "commerce"."markets"("store_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.store_currencies ENABLE ROW LEVEL SECURITY;
