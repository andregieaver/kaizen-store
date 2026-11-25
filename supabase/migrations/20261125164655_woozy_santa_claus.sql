CREATE TABLE "commerce"."market_rivals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_rivals_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "market_rivals_key" UNIQUE("store_id","market_code","host"),
	CONSTRAINT "market_rivals_market" CHECK ("commerce"."market_rivals"."market_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "market_rivals_name" CHECK (length("commerce"."market_rivals"."name") between 1 and 120),
	CONSTRAINT "market_rivals_host" CHECK (length("commerce"."market_rivals"."host") between 3 and 253 and "commerce"."market_rivals"."host" ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."market_rivals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."rival_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"rival_id" uuid NOT NULL,
	"product_id" uuid,
	"address" text NOT NULL,
	"name" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"high_price_minor" bigint,
	"availability" text NOT NULL,
	"shipping_minor" bigint,
	"shipping_currency" char(3),
	"delivery_days_min" integer,
	"delivery_days_max" integer,
	"return_days" integer,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rival_offers_key" UNIQUE("rival_id","address"),
	CONSTRAINT "rival_offers_address" CHECK ("commerce"."rival_offers"."address" ~ '^https://' and length("commerce"."rival_offers"."address") <= 2000),
	CONSTRAINT "rival_offers_name" CHECK (length("commerce"."rival_offers"."name") <= 300),
	CONSTRAINT "rival_offers_price" CHECK ("commerce"."rival_offers"."price_minor" >= 0 and ("commerce"."rival_offers"."high_price_minor" is null or "commerce"."rival_offers"."high_price_minor" >= "commerce"."rival_offers"."price_minor")),
	CONSTRAINT "rival_offers_currency" CHECK ("commerce"."rival_offers"."currency" ~ '^[A-Z]{3}$' and ("commerce"."rival_offers"."shipping_currency" is null or "commerce"."rival_offers"."shipping_currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "rival_offers_availability" CHECK ("commerce"."rival_offers"."availability" in ('in_stock', 'out_of_stock', 'preorder', 'backorder', 'limited', 'discontinued', 'unknown')),
	CONSTRAINT "rival_offers_shipping" CHECK (("commerce"."rival_offers"."shipping_minor" is null) = ("commerce"."rival_offers"."shipping_currency" is null) and coalesce("commerce"."rival_offers"."shipping_minor", 0) >= 0),
	CONSTRAINT "rival_offers_days" CHECK (coalesce("commerce"."rival_offers"."delivery_days_min", 0) between 0 and 365 and coalesce("commerce"."rival_offers"."delivery_days_max", 0) between 0 and 365 and coalesce("commerce"."rival_offers"."return_days", 0) between 0 and 3650)
);
--> statement-breakpoint
ALTER TABLE "commerce"."rival_offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."market_rivals" ADD CONSTRAINT "market_rivals_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."market_rivals" ADD CONSTRAINT "market_rivals_added_by_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."rival_offers" ADD CONSTRAINT "rival_offers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."rival_offers" ADD CONSTRAINT "rival_offers_rival_fk" FOREIGN KEY ("store_id","rival_id") REFERENCES "commerce"."market_rivals"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."rival_offers" ADD CONSTRAINT "rival_offers_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_rivals_added_by_idx" ON "commerce"."market_rivals" USING btree ("added_by");--> statement-breakpoint
CREATE INDEX "rival_offers_store_rival_idx" ON "commerce"."rival_offers" USING btree ("store_id","rival_id");--> statement-breakpoint
CREATE INDEX "rival_offers_store_product_idx" ON "commerce"."rival_offers" USING btree ("store_id","product_id");