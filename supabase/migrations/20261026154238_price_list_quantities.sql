CREATE TABLE "commerce"."price_list_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"from_quantity" integer NOT NULL,
	"percent" integer,
	"amounts" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_breaks_step_key" UNIQUE("list_id","variant_id","from_quantity"),
	CONSTRAINT "price_list_breaks_from" CHECK ("commerce"."price_list_breaks"."from_quantity" between 2 and 9999),
	CONSTRAINT "price_list_breaks_percent" CHECK ("commerce"."price_list_breaks"."percent" between 1 and 99),
	CONSTRAINT "price_list_breaks_one" CHECK (("commerce"."price_list_breaks"."percent" is null) <> ("commerce"."price_list_breaks"."amounts" is null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."price_list_quantity_rules" (
	"store_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"min_quantity" integer DEFAULT 1 NOT NULL,
	"max_quantity" integer,
	"quantity_step" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_quantity_rules_pkey" PRIMARY KEY("list_id","variant_id"),
	CONSTRAINT "price_list_quantity_rules_rule" CHECK ("commerce"."price_list_quantity_rules"."min_quantity" between 1 and 9999 and "commerce"."price_list_quantity_rules"."quantity_step" between 1 and 9999 and "commerce"."price_list_quantity_rules"."min_quantity" % "commerce"."price_list_quantity_rules"."quantity_step" = 0),
	CONSTRAINT "price_list_quantity_rules_max" CHECK ("commerce"."price_list_quantity_rules"."max_quantity" is null or ("commerce"."price_list_quantity_rules"."max_quantity" between "commerce"."price_list_quantity_rules"."min_quantity" and 9999 and "commerce"."price_list_quantity_rules"."max_quantity" % "commerce"."price_list_quantity_rules"."quantity_step" = 0))
);
--> statement-breakpoint
ALTER TABLE "commerce"."price_list_breaks" ADD CONSTRAINT "price_list_breaks_list_fk" FOREIGN KEY ("store_id","list_id") REFERENCES "commerce"."price_lists"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."price_list_breaks" ADD CONSTRAINT "price_list_breaks_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."price_list_quantity_rules" ADD CONSTRAINT "price_list_quantity_rules_list_fk" FOREIGN KEY ("store_id","list_id") REFERENCES "commerce"."price_lists"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."price_list_quantity_rules" ADD CONSTRAINT "price_list_quantity_rules_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_list_breaks_variant_idx" ON "commerce"."price_list_breaks" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "price_list_breaks_list_fk_idx" ON "commerce"."price_list_breaks" USING btree ("store_id","list_id");--> statement-breakpoint
CREATE INDEX "price_list_quantity_rules_variant_idx" ON "commerce"."price_list_quantity_rules" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "price_list_quantity_rules_list_fk_idx" ON "commerce"."price_list_quantity_rules" USING btree ("store_id","list_id");