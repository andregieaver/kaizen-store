CREATE SCHEMA "commerce";
--> statement-breakpoint
CREATE TYPE "commerce"."cart_status" AS ENUM('open', 'converted', 'abandoned');--> statement-breakpoint
CREATE TYPE "commerce"."idempotency_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "commerce"."order_status" AS ENUM('pending_payment', 'paid', 'fulfilled', 'cancelled', 'closed');--> statement-breakpoint
CREATE TYPE "commerce"."payment_status" AS ENUM('pending', 'authorized', 'captured', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "commerce"."product_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "commerce"."refund_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "commerce"."return_status" AS ENUM('requested', 'in_transit', 'received', 'inspected', 'closed');--> statement-breakpoint
CREATE TYPE "commerce"."withdrawal_exclusion" AS ENUM('none', 'custom_made', 'perishable', 'sealed_hygiene', 'sealed_media', 'mixed_inseparably');--> statement-breakpoint
CREATE TABLE "commerce"."cart_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "cart_lines_cart_variant_key" UNIQUE("cart_id","variant_id"),
	CONSTRAINT "cart_lines_quantity_positive" CHECK ("commerce"."cart_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_code" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"locale" text NOT NULL,
	"customer_id" uuid,
	"status" "commerce"."cart_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"refund_id" uuid,
	"series" text NOT NULL,
	"number" bigint NOT NULL,
	"document_number" text NOT NULL,
	"currency" char(3) NOT NULL,
	"total_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_document_number_unique" UNIQUE("document_number"),
	CONSTRAINT "credit_notes_series_number_key" UNIQUE("series","number")
);
--> statement-breakpoint
CREATE TABLE "commerce"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid,
	"email" text NOT NULL,
	"locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."document_series" (
	"series" text PRIMARY KEY NOT NULL,
	"prefix" text NOT NULL,
	"next_number" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "document_series_next_positive" CHECK ("commerce"."document_series"."next_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."economic_operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"postal_address" text NOT NULL,
	"electronic_address" text NOT NULL,
	"country" char(2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" "commerce"."idempotency_status" DEFAULT 'in_progress' NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "commerce"."inventory_levels" (
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_levels_variant_id_location_id_pk" PRIMARY KEY("variant_id","location_id"),
	CONSTRAINT "inventory_levels_on_hand_non_negative" CHECK ("commerce"."inventory_levels"."on_hand" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."inventory_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country" char(2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"cart_id" uuid,
	"order_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservations_quantity_positive" CHECK ("commerce"."inventory_reservations"."quantity" > 0),
	CONSTRAINT "inventory_reservations_owner" CHECK ("commerce"."inventory_reservations"."cart_id" is not null or "commerce"."inventory_reservations"."order_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "commerce"."invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"series" text NOT NULL,
	"number" bigint NOT NULL,
	"document_number" text NOT NULL,
	"currency" char(3) NOT NULL,
	"total_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_document_number_unique" UNIQUE("document_number"),
	CONSTRAINT "invoices_series_number_key" UNIQUE("series","number")
);
--> statement-breakpoint
CREATE TABLE "commerce"."markets" (
	"code" char(2) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"default_locale" text NOT NULL,
	"locales" text[] NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_code_currency_key" UNIQUE("code","currency"),
	CONSTRAINT "markets_code_upper" CHECK ("commerce"."markets"."code" = upper("commerce"."markets"."code")),
	CONSTRAINT "markets_currency_upper" CHECK ("commerce"."markets"."currency" = upper("commerce"."markets"."currency")),
	CONSTRAINT "markets_default_locale_listed" CHECK ("commerce"."markets"."default_locale" = any("commerce"."markets"."locales"))
);
--> statement-breakpoint
CREATE TABLE "commerce"."order_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."order_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"tax_rate" numeric(6, 4) NOT NULL,
	"tax_code" text NOT NULL,
	"withdrawal_exclusion" "commerce"."withdrawal_exclusion" DEFAULT 'none' NOT NULL,
	CONSTRAINT "order_lines_quantity_positive" CHECK ("commerce"."order_lines"."quantity" > 0),
	CONSTRAINT "order_lines_total_adds_up" CHECK ("commerce"."order_lines"."total_minor" = "commerce"."order_lines"."unit_price_minor" * "commerce"."order_lines"."quantity" - "commerce"."order_lines"."discount_minor"),
	CONSTRAINT "order_lines_amounts_non_negative" CHECK ("commerce"."order_lines"."unit_price_minor" >= 0 and "commerce"."order_lines"."discount_minor" >= 0 and "commerce"."order_lines"."total_minor" >= 0 and "commerce"."order_lines"."tax_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"market_code" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"locale" text NOT NULL,
	"customer_id" uuid,
	"cart_id" uuid,
	"email" text NOT NULL,
	"status" "commerce"."order_status" DEFAULT 'pending_payment' NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"shipping_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"billing_address" jsonb NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_number_unique" UNIQUE("number"),
	CONSTRAINT "orders_amounts_non_negative" CHECK ("commerce"."orders"."subtotal_minor" >= 0 and "commerce"."orders"."shipping_minor" >= 0 and "commerce"."orders"."discount_minor" >= 0 and "commerce"."orders"."tax_minor" >= 0),
	CONSTRAINT "orders_total_adds_up" CHECK ("commerce"."orders"."total_minor" = "commerce"."orders"."subtotal_minor" + "commerce"."orders"."shipping_minor" - "commerce"."orders"."discount_minor"),
	CONSTRAINT "orders_tax_within_total" CHECK ("commerce"."orders"."tax_minor" <= "commerce"."orders"."total_minor")
);
--> statement-breakpoint
CREATE TABLE "commerce"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "commerce"."payment_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_reference_key" UNIQUE("provider","provider_reference"),
	CONSTRAINT "payments_amount_positive" CHECK ("commerce"."payments"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."prices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."prices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"variant_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	CONSTRAINT "prices_amount_non_negative" CHECK ("commerce"."prices"."amount_minor" >= 0),
	CONSTRAINT "prices_valid_range" CHECK ("commerce"."prices"."valid_to" is null or "commerce"."prices"."valid_to" > "commerce"."prices"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "commerce"."product_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"alt" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."product_translations" (
	"product_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"safety_information" text DEFAULT '' NOT NULL,
	CONSTRAINT "product_translations_product_id_locale_pk" PRIMARY KEY("product_id","locale")
);
--> statement-breakpoint
CREATE TABLE "commerce"."product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"gtin" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"weight_grams" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_sku_unique" UNIQUE("sku"),
	CONSTRAINT "product_variants_gtin_digits" CHECK ("commerce"."product_variants"."gtin" ~ '^[0-9]{8,14}$'),
	CONSTRAINT "product_variants_weight_positive" CHECK ("commerce"."product_variants"."weight_grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"status" "commerce"."product_status" DEFAULT 'draft' NOT NULL,
	"manufacturer_id" uuid,
	"responsible_person_id" uuid,
	"tax_code" text NOT NULL,
	"withdrawal_exclusion" "commerce"."withdrawal_exclusion" DEFAULT 'none' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_handle_unique" UNIQUE("handle"),
	CONSTRAINT "products_handle_format" CHECK ("commerce"."products"."handle" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reason" text NOT NULL,
	"provider_reference" text,
	"status" "commerce"."refund_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_provider_reference_unique" UNIQUE("provider_reference"),
	CONSTRAINT "refunds_amount_positive" CHECK ("commerce"."refunds"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."return_lines" (
	"return_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"condition" text,
	CONSTRAINT "return_lines_return_id_order_line_id_pk" PRIMARY KEY("return_id","order_line_id"),
	CONSTRAINT "return_lines_quantity_positive" CHECK ("commerce"."return_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"withdrawal_request_id" uuid,
	"status" "commerce"."return_status" DEFAULT 'requested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."webhook_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."webhook_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "webhook_events_provider_event_key" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."withdrawal_request_lines" (
	"withdrawal_request_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "withdrawal_request_lines_withdrawal_request_id_order_line_id_pk" PRIMARY KEY("withdrawal_request_id","order_line_id"),
	CONSTRAINT "withdrawal_request_lines_quantity_positive" CHECK ("commerce"."withdrawal_request_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."withdrawal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"channel" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledgement_reference" text,
	CONSTRAINT "withdrawal_requests_ack_after_confirm" CHECK ("commerce"."withdrawal_requests"."acknowledged_at" is null or "commerce"."withdrawal_requests"."confirmed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD CONSTRAINT "cart_lines_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "commerce"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD CONSTRAINT "cart_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "commerce"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "commerce"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_market_currency_fk" FOREIGN KEY ("market_code","currency") REFERENCES "commerce"."markets"("code","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "commerce"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "commerce"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_series_document_series_series_fk" FOREIGN KEY ("series") REFERENCES "commerce"."document_series"("series") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_levels" ADD CONSTRAINT "inventory_levels_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "commerce"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_levels" ADD CONSTRAINT "inventory_levels_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "commerce"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "commerce"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_reservations" ADD CONSTRAINT "inventory_reservations_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "commerce"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_reservations" ADD CONSTRAINT "inventory_reservations_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "commerce"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_series_document_series_series_fk" FOREIGN KEY ("series") REFERENCES "commerce"."document_series"("series") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "commerce"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "commerce"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "commerce"."carts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_market_currency_fk" FOREIGN KEY ("market_code","currency") REFERENCES "commerce"."markets"("code","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."prices" ADD CONSTRAINT "prices_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "commerce"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."prices" ADD CONSTRAINT "prices_market_currency_fk" FOREIGN KEY ("market_code","currency") REFERENCES "commerce"."markets"("code","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_media" ADD CONSTRAINT "product_media_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "commerce"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_translations" ADD CONSTRAINT "product_translations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "commerce"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "commerce"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_manufacturer_id_economic_operators_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "commerce"."economic_operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_responsible_person_id_economic_operators_id_fk" FOREIGN KEY ("responsible_person_id") REFERENCES "commerce"."economic_operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "commerce"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD CONSTRAINT "return_lines_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "commerce"."returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD CONSTRAINT "return_lines_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "commerce"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_withdrawal_request_id_withdrawal_requests_id_fk" FOREIGN KEY ("withdrawal_request_id") REFERENCES "commerce"."withdrawal_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_request_lines" ADD CONSTRAINT "withdrawal_request_lines_withdrawal_request_id_withdrawal_requests_id_fk" FOREIGN KEY ("withdrawal_request_id") REFERENCES "commerce"."withdrawal_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_request_lines" ADD CONSTRAINT "withdrawal_request_lines_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "commerce"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_notes_invoice_idx" ON "commerce"."credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_idx" ON "commerce"."customers" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "inventory_reservations_active_idx" ON "commerce"."inventory_reservations" USING btree ("variant_id","location_id") WHERE "commerce"."inventory_reservations"."released_at" is null;--> statement-breakpoint
CREATE INDEX "invoices_order_idx" ON "commerce"."invoices" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "commerce"."order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "commerce"."order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "commerce"."orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "commerce"."payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prices_one_current_idx" ON "commerce"."prices" USING btree ("variant_id","market_code") WHERE "commerce"."prices"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "prices_history_idx" ON "commerce"."prices" USING btree ("variant_id","market_code","valid_from");--> statement-breakpoint
CREATE INDEX "product_media_product_idx" ON "commerce"."product_media" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "commerce"."product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "commerce"."refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "returns_order_idx" ON "commerce"."returns" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "webhook_events_unprocessed_idx" ON "commerce"."webhook_events" USING btree ("received_at") WHERE "commerce"."webhook_events"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "withdrawal_requests_order_idx" ON "commerce"."withdrawal_requests" USING btree ("order_id");