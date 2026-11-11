CREATE TABLE "commerce"."market_price_rules" (
	"store_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"base_market" char(2) NOT NULL,
	"percent_bps" integer DEFAULT 0 NOT NULL,
	"basis" text DEFAULT 'net' NOT NULL,
	"round_to_minor" integer DEFAULT 1 NOT NULL,
	"ending_minor" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_price_rules_pkey" PRIMARY KEY("store_id","market_code"),
	CONSTRAINT "market_price_rules_not_itself" CHECK ("commerce"."market_price_rules"."market_code" <> "commerce"."market_price_rules"."base_market"),
	CONSTRAINT "market_price_rules_percent" CHECK ("commerce"."market_price_rules"."percent_bps" between -9000 and 100000),
	CONSTRAINT "market_price_rules_basis" CHECK ("commerce"."market_price_rules"."basis" in ('net', 'gross')),
	CONSTRAINT "market_price_rules_round" CHECK ("commerce"."market_price_rules"."round_to_minor" between 1 and 100000),
	CONSTRAINT "market_price_rules_ending" CHECK ("commerce"."market_price_rules"."ending_minor" is null or ("commerce"."market_price_rules"."ending_minor" >= 0 and "commerce"."market_price_rules"."ending_minor" < "commerce"."market_price_rules"."round_to_minor"))
);
--> statement-breakpoint
ALTER TABLE "commerce"."prices" ADD COLUMN "derived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."market_price_rules" ADD CONSTRAINT "market_price_rules_market_fk" FOREIGN KEY ("store_id","market_code") REFERENCES "commerce"."markets"("store_id","code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."market_price_rules" ADD CONSTRAINT "market_price_rules_base_fk" FOREIGN KEY ("store_id","base_market") REFERENCES "commerce"."markets"("store_id","code") ON DELETE cascade ON UPDATE no action;