CREATE TABLE "commerce"."shipping_rates" (
	"store_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"free_over_minor" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_rates_store_id_market_code_pk" PRIMARY KEY("store_id","market_code"),
	CONSTRAINT "shipping_rates_amount_non_negative" CHECK ("commerce"."shipping_rates"."amount_minor" >= 0),
	CONSTRAINT "shipping_rates_free_over_positive" CHECK ("commerce"."shipping_rates"."free_over_minor" is null or "commerce"."shipping_rates"."free_over_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."countries" ADD COLUMN "standard_vat_rate" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "commerce"."shipping_rates" ADD CONSTRAINT "shipping_rates_market_fk" FOREIGN KEY ("store_id","market_code","currency") REFERENCES "commerce"."markets"("store_id","code","currency") ON DELETE cascade ON UPDATE no action;