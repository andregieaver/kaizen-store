CREATE TABLE "commerce"."price_list_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"tier_id" uuid,
	"company_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_assignments_one" CHECK (("commerce"."price_list_assignments"."tier_id" is null) <> ("commerce"."price_list_assignments"."company_id" is null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."price_list_prices" (
	"store_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_prices_pkey" PRIMARY KEY("list_id","variant_id","currency"),
	CONSTRAINT "price_list_prices_amount" CHECK ("commerce"."price_list_prices"."amount_minor" >= 0),
	CONSTRAINT "price_list_prices_currency" CHECK ("commerce"."price_list_prices"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."price_list_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"product_id" uuid,
	"term_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_products_one" CHECK (("commerce"."price_list_products"."product_id" is null) <> ("commerce"."price_list_products"."term_id" is null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"percent" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "price_lists_name" CHECK (char_length("commerce"."price_lists"."name") between 1 and 80 and "commerce"."price_lists"."name" = btrim("commerce"."price_lists"."name")),
	CONSTRAINT "price_lists_percent" CHECK ("commerce"."price_lists"."percent" is null or "commerce"."price_lists"."percent" between 1 and 99)
);
--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "price_list_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."price_list_assignments" ADD CONSTRAINT "price_list_assignments_list_fk" FOREIGN KEY ("store_id","list_id") REFERENCES "commerce"."price_lists"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."price_list_assignments" ADD CONSTRAINT "price_list_assignments_tier_fk" FOREIGN KEY ("store_id","tier_id") REFERENCES "commerce"."customer_tiers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."price_list_assignments" ADD CONSTRAINT "price_list_assignments_company_fk" FOREIGN KEY ("store_id","company_id") REFERENCES "commerce"."customer_companies"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."price_list_prices" ADD CONSTRAINT "price_list_prices_list_fk" FOREIGN KEY ("store_id","list_id") REFERENCES "commerce"."price_lists"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."price_list_prices" ADD CONSTRAINT "price_list_prices_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."price_list_products" ADD CONSTRAINT "price_list_products_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "commerce"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."price_list_products" ADD CONSTRAINT "price_list_products_list_fk" FOREIGN KEY ("store_id","list_id") REFERENCES "commerce"."price_lists"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."price_list_products" ADD CONSTRAINT "price_list_products_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."price_lists" ADD CONSTRAINT "price_lists_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_assignments_tier_idx" ON "commerce"."price_list_assignments" USING btree ("list_id","tier_id") WHERE "commerce"."price_list_assignments"."tier_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_assignments_company_idx" ON "commerce"."price_list_assignments" USING btree ("list_id","company_id") WHERE "commerce"."price_list_assignments"."company_id" is not null;--> statement-breakpoint
CREATE INDEX "price_list_assignments_store_tier_idx" ON "commerce"."price_list_assignments" USING btree ("store_id","tier_id");--> statement-breakpoint
CREATE INDEX "price_list_assignments_store_company_idx" ON "commerce"."price_list_assignments" USING btree ("store_id","company_id");--> statement-breakpoint
CREATE INDEX "price_list_prices_variant_idx" ON "commerce"."price_list_prices" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_products_product_idx" ON "commerce"."price_list_products" USING btree ("list_id","product_id") WHERE "commerce"."price_list_products"."product_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_products_term_idx" ON "commerce"."price_list_products" USING btree ("list_id","term_id") WHERE "commerce"."price_list_products"."term_id" is not null;--> statement-breakpoint
CREATE INDEX "price_list_products_store_product_idx" ON "commerce"."price_list_products" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "price_list_products_term_fk_idx" ON "commerce"."price_list_products" USING btree ("term_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_name_idx" ON "commerce"."price_lists" USING btree ("store_id",lower("name"));