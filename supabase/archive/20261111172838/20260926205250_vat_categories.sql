CREATE TABLE "commerce"."vat_rates" (
	"country_code" char(2) NOT NULL,
	"category" text NOT NULL,
	"rate" numeric(5, 4) NOT NULL,
	CONSTRAINT "vat_rates_country_code_category_pk" PRIMARY KEY("country_code","category"),
	CONSTRAINT "vat_rates_category" CHECK ("commerce"."vat_rates"."category" in ('accommodation')),
	CONSTRAINT "vat_rates_rate" CHECK ("commerce"."vat_rates"."rate" >= 0 and "commerce"."vat_rates"."rate" < 1)
);
--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "vat_category" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD CONSTRAINT "vat_rates_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "commerce"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_vat_category" CHECK ("commerce"."products"."vat_category" in ('standard', 'accommodation', 'exempt'));