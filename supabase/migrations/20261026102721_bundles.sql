CREATE TABLE "commerce"."bundle_components" (
	"store_id" uuid NOT NULL,
	"bundle_variant_id" uuid NOT NULL,
	"component_variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bundle_components_pkey" PRIMARY KEY("bundle_variant_id","component_variant_id"),
	CONSTRAINT "bundle_components_quantity" CHECK ("commerce"."bundle_components"."quantity" between 1 and 99),
	CONSTRAINT "bundle_components_not_itself" CHECK ("commerce"."bundle_components"."bundle_variant_id" <> "commerce"."bundle_components"."component_variant_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."order_line_components" (
	"store_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"quantity" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "order_line_components_pkey" PRIMARY KEY("order_line_id","variant_id"),
	CONSTRAINT "order_line_components_quantity" CHECK ("commerce"."order_line_components"."quantity" between 1 and 99)
);
--> statement-breakpoint
ALTER TABLE "commerce"."products" DROP CONSTRAINT "products_kind";--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "bundle_pricing" text;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "bundle_percent_off" integer;--> statement-breakpoint
ALTER TABLE "commerce"."bundle_components" ADD CONSTRAINT "bundle_components_bundle_fk" FOREIGN KEY ("store_id","bundle_variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bundle_components" ADD CONSTRAINT "bundle_components_component_fk" FOREIGN KEY ("store_id","component_variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_line_components" ADD CONSTRAINT "order_line_components_line_fk" FOREIGN KEY ("store_id","order_line_id") REFERENCES "commerce"."order_lines"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_line_components" ADD CONSTRAINT "order_line_components_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bundle_components_bundle_idx" ON "commerce"."bundle_components" USING btree ("store_id","bundle_variant_id");--> statement-breakpoint
CREATE INDEX "bundle_components_component_idx" ON "commerce"."bundle_components" USING btree ("store_id","component_variant_id");--> statement-breakpoint
CREATE INDEX "order_line_components_line_idx" ON "commerce"."order_line_components" USING btree ("store_id","order_line_id");--> statement-breakpoint
CREATE INDEX "order_line_components_variant_idx" ON "commerce"."order_line_components" USING btree ("store_id","variant_id");--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_bundle_pricing" CHECK (("commerce"."products"."kind" = 'bundle') = ("commerce"."products"."bundle_pricing" is not null) and ("commerce"."products"."bundle_pricing" is null or "commerce"."products"."bundle_pricing" in ('fixed', 'computed'))
        and ("commerce"."products"."bundle_percent_off" is null) = ("commerce"."products"."bundle_pricing" is distinct from 'computed') and ("commerce"."products"."bundle_percent_off" is null or "commerce"."products"."bundle_percent_off" between 0 and 90));--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_kind" CHECK ("commerce"."products"."kind" in ('goods', 'appointment', 'stay', 'rental', 'gift_card', 'bundle'));