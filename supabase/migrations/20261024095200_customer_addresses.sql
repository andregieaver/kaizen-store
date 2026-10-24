CREATE TABLE "commerce"."customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"address" jsonb NOT NULL,
	"country" text NOT NULL,
	"is_default_shipping" boolean DEFAULT false NOT NULL,
	"is_default_billing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_addresses_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "customer_addresses_label" CHECK (char_length("commerce"."customer_addresses"."label") <= 40),
	CONSTRAINT "customer_addresses_country" CHECK ("commerce"."customer_addresses"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "customer_addresses_shape" CHECK (jsonb_typeof("commerce"."customer_addresses"."address") = 'object')
);
--> statement-breakpoint
ALTER TABLE "commerce"."customer_addresses" ADD CONSTRAINT "customer_addresses_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."customer_addresses" ADD CONSTRAINT "customer_addresses_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_idx" ON "commerce"."customer_addresses" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_default_shipping_idx" ON "commerce"."customer_addresses" USING btree ("store_id","customer_id") WHERE "commerce"."customer_addresses"."is_default_shipping";--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_default_billing_idx" ON "commerce"."customer_addresses" USING btree ("store_id","customer_id") WHERE "commerce"."customer_addresses"."is_default_billing";