CREATE TABLE "commerce"."rival_service_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"rival_id" uuid NOT NULL,
	"service" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"per" text NOT NULL,
	"own_minor" bigint,
	"product_id" uuid,
	"source" text NOT NULL,
	"checked_on" date NOT NULL,
	"on_page" boolean,
	"gone_at" timestamp with time zone,
	"watched_at" timestamp with time zone,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rival_service_prices_key" UNIQUE("rival_id","service","currency","per"),
	CONSTRAINT "rival_service_prices_service" CHECK (length("commerce"."rival_service_prices"."service") between 1 and 120),
	CONSTRAINT "rival_service_prices_amounts" CHECK ("commerce"."rival_service_prices"."price_minor" >= 0 and ("commerce"."rival_service_prices"."own_minor" is null or "commerce"."rival_service_prices"."own_minor" >= 0)),
	CONSTRAINT "rival_service_prices_currency" CHECK ("commerce"."rival_service_prices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "rival_service_prices_per" CHECK ("commerce"."rival_service_prices"."per" in ('once', 'hour', 'night', 'month')),
	CONSTRAINT "rival_service_prices_source" CHECK ("commerce"."rival_service_prices"."source" ~ '^https://' and length("commerce"."rival_service_prices"."source") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."rival_service_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."rival_service_prices" ADD CONSTRAINT "rival_service_prices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."rival_service_prices" ADD CONSTRAINT "rival_service_prices_added_by_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."rival_service_prices" ADD CONSTRAINT "rival_service_prices_rival_fk" FOREIGN KEY ("store_id","rival_id") REFERENCES "commerce"."market_rivals"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."rival_service_prices" ADD CONSTRAINT "rival_service_prices_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rival_service_prices_store_rival_idx" ON "commerce"."rival_service_prices" USING btree ("store_id","rival_id");--> statement-breakpoint
CREATE INDEX "rival_service_prices_store_product_idx" ON "commerce"."rival_service_prices" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "rival_service_prices_added_by_idx" ON "commerce"."rival_service_prices" USING btree ("added_by");--> statement-breakpoint
CREATE INDEX "rival_service_prices_checked_idx" ON "commerce"."rival_service_prices" USING btree ("checked_on");