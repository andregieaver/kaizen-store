CREATE TABLE "commerce"."delivery_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"carrier" text NOT NULL,
	"service_id" text NOT NULL,
	"label" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"free_over_minor" bigint,
	"currency" char(3) NOT NULL,
	"country" char(2) NOT NULL,
	"postal_code" text NOT NULL,
	"estimate" jsonb,
	"needs_pickup_point" boolean DEFAULT false NOT NULL,
	"pickup_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pickup_point_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "delivery_quotes_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "delivery_quotes_amount" CHECK ("commerce"."delivery_quotes"."amount_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "delivery_quote_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "delivery" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD COLUMN "checkout_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD COLUMN "checkout_services" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD COLUMN "markup_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD COLUMN "markup_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD COLUMN "free_over_minor" integer;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD COLUMN "default_weight_grams" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."delivery_quotes" ADD CONSTRAINT "delivery_quotes_cart_fk" FOREIGN KEY ("store_id","cart_id") REFERENCES "commerce"."carts"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_quotes_cart_idx" ON "commerce"."delivery_quotes" USING btree ("store_id","cart_id");--> statement-breakpoint
CREATE INDEX "delivery_quotes_expires_idx" ON "commerce"."delivery_quotes" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD CONSTRAINT "shipping_carriers_markup" CHECK ("commerce"."shipping_carriers"."markup_percent" between 0 and 100 and "commerce"."shipping_carriers"."markup_minor" >= 0);--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD CONSTRAINT "shipping_carriers_free_over" CHECK ("commerce"."shipping_carriers"."free_over_minor" is null or "commerce"."shipping_carriers"."free_over_minor" > 0);--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD CONSTRAINT "shipping_carriers_default_weight" CHECK ("commerce"."shipping_carriers"."default_weight_grams" between 1 and 35000);