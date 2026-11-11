CREATE SCHEMA "commerce";
--> statement-breakpoint
CREATE TYPE "commerce"."access_request_status" AS ENUM('pending', 'approved', 'declined');--> statement-breakpoint
CREATE TYPE "commerce"."cart_status" AS ENUM('open', 'converted', 'abandoned');--> statement-breakpoint
CREATE TYPE "commerce"."idempotency_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "commerce"."member_role" AS ENUM('owner', 'admin');--> statement-breakpoint
CREATE TYPE "commerce"."order_status" AS ENUM('pending_payment', 'paid', 'fulfilled', 'cancelled', 'closed');--> statement-breakpoint
CREATE TYPE "commerce"."payment_mode" AS ENUM('test', 'live');--> statement-breakpoint
CREATE TYPE "commerce"."payment_status" AS ENUM('pending', 'authorized', 'captured', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "commerce"."producer_scheme" AS ENUM('packaging', 'electrical_equipment', 'batteries', 'textiles', 'furniture', 'tyres');--> statement-breakpoint
CREATE TYPE "commerce"."product_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "commerce"."refund_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "commerce"."return_status" AS ENUM('requested', 'in_transit', 'received', 'inspected', 'closed');--> statement-breakpoint
CREATE TYPE "commerce"."store_status" AS ENUM('active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "commerce"."withdrawal_exclusion" AS ENUM('none', 'custom_made', 'perishable', 'sealed_hygiene', 'sealed_media', 'mixed_inseparably', 'price_fluctuation', 'alcohol_future_delivery', 'periodicals', 'digital_content');--> statement-breakpoint
CREATE TABLE "commerce"."access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"store_name" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" "commerce"."access_request_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"auth_user_id" uuid,
	"name" text,
	"platform_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "accounts_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid,
	"account_id" uuid,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."cart_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "cart_lines_cart_variant_key" UNIQUE("cart_id","variant_id"),
	CONSTRAINT "cart_lines_quantity_positive" CHECK ("commerce"."cart_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"locale" text NOT NULL,
	"customer_id" uuid,
	"status" "commerce"."cart_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "carts_store_id_key" UNIQUE("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."countries" (
	"code" char(2) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"default_locale" text NOT NULL,
	"locales" text[] NOT NULL,
	"in_eu" boolean NOT NULL,
	CONSTRAINT "countries_code_upper" CHECK ("commerce"."countries"."code" = upper("commerce"."countries"."code")),
	CONSTRAINT "countries_default_locale_listed" CHECK ("commerce"."countries"."default_locale" = any("commerce"."countries"."locales"))
);
--> statement-breakpoint
CREATE TABLE "commerce"."credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"refund_id" uuid,
	"series" text NOT NULL,
	"number" bigint NOT NULL,
	"document_number" text NOT NULL,
	"currency" char(3) NOT NULL,
	"total_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_series_number_key" UNIQUE("store_id","series","number"),
	CONSTRAINT "credit_notes_document_number_key" UNIQUE("store_id","document_number")
);
--> statement-breakpoint
CREATE TABLE "commerce"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"auth_user_id" uuid,
	"email" text NOT NULL,
	"locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "customers_store_auth_user_key" UNIQUE("store_id","auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."document_series" (
	"store_id" uuid NOT NULL,
	"series" text NOT NULL,
	"prefix" text NOT NULL,
	"next_number" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "document_series_store_id_series_pk" PRIMARY KEY("store_id","series"),
	CONSTRAINT "document_series_next_positive" CHECK ("commerce"."document_series"."next_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."economic_operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"postal_address" text NOT NULL,
	"electronic_address" text NOT NULL,
	"country" char(2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economic_operators_store_id_key" UNIQUE("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."idempotency_keys" (
	"store_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" "commerce"."idempotency_status" DEFAULT 'in_progress' NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_store_id_scope_key_pk" PRIMARY KEY("store_id","scope","key")
);
--> statement-breakpoint
CREATE TABLE "commerce"."inventory_levels" (
	"store_id" uuid NOT NULL,
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
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country" char(2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_locations_store_id_key" UNIQUE("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
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
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"series" text NOT NULL,
	"number" bigint NOT NULL,
	"document_number" text NOT NULL,
	"currency" char(3) NOT NULL,
	"total_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "invoices_series_number_key" UNIQUE("store_id","series","number"),
	CONSTRAINT "invoices_document_number_key" UNIQUE("store_id","document_number")
);
--> statement-breakpoint
CREATE TABLE "commerce"."markets" (
	"store_id" uuid NOT NULL,
	"code" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"default_locale" text NOT NULL,
	"locales" text[] NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_store_id_code_pk" PRIMARY KEY("store_id","code"),
	CONSTRAINT "markets_store_code_currency_key" UNIQUE("store_id","code","currency"),
	CONSTRAINT "markets_default_locale_listed" CHECK ("commerce"."markets"."default_locale" = any("commerce"."markets"."locales"))
);
--> statement-breakpoint
CREATE TABLE "commerce"."order_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."order_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
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
	CONSTRAINT "order_lines_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "order_lines_quantity_positive" CHECK ("commerce"."order_lines"."quantity" > 0),
	CONSTRAINT "order_lines_total_adds_up" CHECK ("commerce"."order_lines"."total_minor" = "commerce"."order_lines"."unit_price_minor" * "commerce"."order_lines"."quantity" - "commerce"."order_lines"."discount_minor"),
	CONSTRAINT "order_lines_amounts_non_negative" CHECK ("commerce"."order_lines"."unit_price_minor" >= 0 and "commerce"."order_lines"."discount_minor" >= 0 and "commerce"."order_lines"."total_minor" >= 0 and "commerce"."order_lines"."tax_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
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
	CONSTRAINT "orders_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "orders_store_number_key" UNIQUE("store_id","number"),
	CONSTRAINT "orders_amounts_non_negative" CHECK ("commerce"."orders"."subtotal_minor" >= 0 and "commerce"."orders"."shipping_minor" >= 0 and "commerce"."orders"."discount_minor" >= 0 and "commerce"."orders"."tax_minor" >= 0),
	CONSTRAINT "orders_total_adds_up" CHECK ("commerce"."orders"."total_minor" = "commerce"."orders"."subtotal_minor" + "commerce"."orders"."shipping_minor" - "commerce"."orders"."discount_minor"),
	CONSTRAINT "orders_tax_within_total" CHECK ("commerce"."orders"."tax_minor" <= "commerce"."orders"."total_minor")
);
--> statement-breakpoint
CREATE TABLE "commerce"."payment_credentials" (
	"store_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"mode" "commerce"."payment_mode" NOT NULL,
	"publishable_key" text,
	"secret_key_ciphertext" text,
	"secret_key_hint" text,
	"webhook_secret_ciphertext" text,
	"webhook_secret_hint" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "payment_credentials_store_id_provider_mode_pk" PRIMARY KEY("store_id","provider","mode")
);
--> statement-breakpoint
CREATE TABLE "commerce"."payment_methods" (
	"store_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"method" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "payment_methods_store_id_market_code_method_pk" PRIMARY KEY("store_id","market_code","method")
);
--> statement-breakpoint
CREATE TABLE "commerce"."payment_providers" (
	"store_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"active_mode" "commerce"."payment_mode" DEFAULT 'test' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "payment_providers_store_id_provider_pk" PRIMARY KEY("store_id","provider")
);
--> statement-breakpoint
CREATE TABLE "commerce"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "commerce"."payment_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "payments_provider_reference_key" UNIQUE("store_id","provider","provider_reference"),
	CONSTRAINT "payments_amount_positive" CHECK ("commerce"."payments"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."prices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."prices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid NOT NULL,
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
CREATE TABLE "commerce"."producer_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"scheme" "commerce"."producer_scheme" NOT NULL,
	"registration_number" text NOT NULL,
	"authority" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "producer_registrations_valid_range" CHECK ("commerce"."producer_registrations"."valid_to" is null or "commerce"."producer_registrations"."valid_to" >= "commerce"."producer_registrations"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "commerce"."product_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"alt" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."product_schemes" (
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"scheme" "commerce"."producer_scheme" NOT NULL,
	CONSTRAINT "product_schemes_product_id_scheme_pk" PRIMARY KEY("product_id","scheme")
);
--> statement-breakpoint
CREATE TABLE "commerce"."product_translations" (
	"store_id" uuid NOT NULL,
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
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"gtin" text,
	"tax_code" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"weight_grams" integer,
	"hs_code" text,
	"origin_country" char(2),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "product_variants_store_sku_key" UNIQUE("store_id","sku"),
	CONSTRAINT "product_variants_gtin_digits" CHECK ("commerce"."product_variants"."gtin" ~ '^[0-9]{8,14}$'),
	CONSTRAINT "product_variants_weight_positive" CHECK ("commerce"."product_variants"."weight_grams" > 0),
	CONSTRAINT "product_variants_hs_code_digits" CHECK ("commerce"."product_variants"."hs_code" ~ '^[0-9]{6,10}$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"status" "commerce"."product_status" DEFAULT 'draft' NOT NULL,
	"manufacturer_id" uuid,
	"responsible_person_id" uuid,
	"tax_code" text NOT NULL,
	"withdrawal_exclusion" "commerce"."withdrawal_exclusion" DEFAULT 'none' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "products_store_handle_key" UNIQUE("store_id","handle"),
	CONSTRAINT "products_handle_format" CHECK ("commerce"."products"."handle" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reason" text NOT NULL,
	"provider_reference" text,
	"status" "commerce"."refund_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "refunds_provider_reference_key" UNIQUE("store_id","provider_reference"),
	CONSTRAINT "refunds_amount_positive" CHECK ("commerce"."refunds"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."return_lines" (
	"store_id" uuid NOT NULL,
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
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"withdrawal_request_id" uuid,
	"status" "commerce"."return_status" DEFAULT 'requested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "returns_store_id_key" UNIQUE("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."store_members" (
	"store_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" "commerce"."member_role" DEFAULT 'admin' NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "store_members_store_id_account_id_pk" PRIMARY KEY("store_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "commerce"."store_status" DEFAULT 'active' NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"setup_completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_slug_unique" UNIQUE("slug"),
	CONSTRAINT "stores_slug_format" CHECK ("commerce"."stores"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
	CONSTRAINT "stores_slug_not_reserved" CHECK ("commerce"."stores"."slug" not in ('admin', 'api', 'app', 'auth', 'help', 'mail', 'sign-in', 'sign-up', 'status', 'support', 'www'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."webhook_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."webhook_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "webhook_events_provider_event_key" UNIQUE("store_id","provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."withdrawal_request_lines" (
	"store_id" uuid NOT NULL,
	"withdrawal_request_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "withdrawal_request_lines_withdrawal_request_id_order_line_id_pk" PRIMARY KEY("withdrawal_request_id","order_line_id"),
	CONSTRAINT "withdrawal_request_lines_quantity_positive" CHECK ("commerce"."withdrawal_request_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."withdrawal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"channel" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledgement_reference" text,
	CONSTRAINT "withdrawal_requests_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "withdrawal_requests_ack_after_confirm" CHECK ("commerce"."withdrawal_requests"."acknowledged_at" is null or "commerce"."withdrawal_requests"."confirmed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD CONSTRAINT "access_requests_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."audit_log" ADD CONSTRAINT "audit_log_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."audit_log" ADD CONSTRAINT "audit_log_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD CONSTRAINT "cart_lines_cart_fk" FOREIGN KEY ("store_id","cart_id") REFERENCES "commerce"."carts"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD CONSTRAINT "cart_lines_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_market_fk" FOREIGN KEY ("store_id","market_code","currency") REFERENCES "commerce"."markets"("store_id","code","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_invoice_fk" FOREIGN KEY ("store_id","invoice_id") REFERENCES "commerce"."invoices"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_refund_fk" FOREIGN KEY ("store_id","refund_id") REFERENCES "commerce"."refunds"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_series_fk" FOREIGN KEY ("store_id","series") REFERENCES "commerce"."document_series"("store_id","series") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD CONSTRAINT "customers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."document_series" ADD CONSTRAINT "document_series_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."economic_operators" ADD CONSTRAINT "economic_operators_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_levels" ADD CONSTRAINT "inventory_levels_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_levels" ADD CONSTRAINT "inventory_levels_location_fk" FOREIGN KEY ("store_id","location_id") REFERENCES "commerce"."inventory_locations"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_locations" ADD CONSTRAINT "inventory_locations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_reservations" ADD CONSTRAINT "inventory_reservations_location_fk" FOREIGN KEY ("store_id","location_id") REFERENCES "commerce"."inventory_locations"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_reservations" ADD CONSTRAINT "inventory_reservations_cart_fk" FOREIGN KEY ("store_id","cart_id") REFERENCES "commerce"."carts"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_series_fk" FOREIGN KEY ("store_id","series") REFERENCES "commerce"."document_series"("store_id","series") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."markets" ADD CONSTRAINT "markets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."markets" ADD CONSTRAINT "markets_code_countries_code_fk" FOREIGN KEY ("code") REFERENCES "commerce"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_events" ADD CONSTRAINT "order_events_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_market_fk" FOREIGN KEY ("store_id","market_code","currency") REFERENCES "commerce"."markets"("store_id","code","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_cart_fk" FOREIGN KEY ("store_id","cart_id") REFERENCES "commerce"."carts"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payment_credentials" ADD CONSTRAINT "payment_credentials_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payment_credentials" ADD CONSTRAINT "payment_credentials_provider_fk" FOREIGN KEY ("store_id","provider") REFERENCES "commerce"."payment_providers"("store_id","provider") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payment_methods" ADD CONSTRAINT "payment_methods_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payment_methods" ADD CONSTRAINT "payment_methods_market_fk" FOREIGN KEY ("store_id","market_code") REFERENCES "commerce"."markets"("store_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payment_providers" ADD CONSTRAINT "payment_providers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payment_providers" ADD CONSTRAINT "payment_providers_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."prices" ADD CONSTRAINT "prices_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."prices" ADD CONSTRAINT "prices_market_fk" FOREIGN KEY ("store_id","market_code","currency") REFERENCES "commerce"."markets"("store_id","code","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."producer_registrations" ADD CONSTRAINT "producer_registrations_market_fk" FOREIGN KEY ("store_id","market_code") REFERENCES "commerce"."markets"("store_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_media" ADD CONSTRAINT "product_media_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_schemes" ADD CONSTRAINT "product_schemes_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_translations" ADD CONSTRAINT "product_translations_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_manufacturer_fk" FOREIGN KEY ("store_id","manufacturer_id") REFERENCES "commerce"."economic_operators"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_responsible_person_fk" FOREIGN KEY ("store_id","responsible_person_id") REFERENCES "commerce"."economic_operators"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_payment_fk" FOREIGN KEY ("store_id","payment_id") REFERENCES "commerce"."payments"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD CONSTRAINT "return_lines_return_fk" FOREIGN KEY ("store_id","return_id") REFERENCES "commerce"."returns"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD CONSTRAINT "return_lines_order_line_fk" FOREIGN KEY ("store_id","order_line_id") REFERENCES "commerce"."order_lines"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_withdrawal_request_fk" FOREIGN KEY ("store_id","withdrawal_request_id") REFERENCES "commerce"."withdrawal_requests"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_members" ADD CONSTRAINT "store_members_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_members" ADD CONSTRAINT "store_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_members" ADD CONSTRAINT "store_members_invited_by_accounts_id_fk" FOREIGN KEY ("invited_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."webhook_events" ADD CONSTRAINT "webhook_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_request_lines" ADD CONSTRAINT "withdrawal_request_lines_request_fk" FOREIGN KEY ("store_id","withdrawal_request_id") REFERENCES "commerce"."withdrawal_requests"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_request_lines" ADD CONSTRAINT "withdrawal_request_lines_order_line_fk" FOREIGN KEY ("store_id","order_line_id") REFERENCES "commerce"."order_lines"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_pending_email_idx" ON "commerce"."access_requests" USING btree (lower("email")) WHERE "commerce"."access_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "access_requests_decided_by_idx" ON "commerce"."access_requests" USING btree ("decided_by");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_idx" ON "commerce"."accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "audit_log_store_idx" ON "commerce"."audit_log" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_account_idx" ON "commerce"."audit_log" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "cart_lines_store_cart_idx" ON "commerce"."cart_lines" USING btree ("store_id","cart_id");--> statement-breakpoint
CREATE INDEX "cart_lines_variant_idx" ON "commerce"."cart_lines" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "carts_market_idx" ON "commerce"."carts" USING btree ("store_id","market_code","currency");--> statement-breakpoint
CREATE INDEX "carts_customer_idx" ON "commerce"."carts" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "credit_notes_invoice_idx" ON "commerce"."credit_notes" USING btree ("store_id","invoice_id");--> statement-breakpoint
CREATE INDEX "credit_notes_refund_idx" ON "commerce"."credit_notes" USING btree ("store_id","refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_store_email_idx" ON "commerce"."customers" USING btree ("store_id",lower("email"));--> statement-breakpoint
CREATE INDEX "inventory_levels_store_variant_idx" ON "commerce"."inventory_levels" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "inventory_levels_location_idx" ON "commerce"."inventory_levels" USING btree ("store_id","location_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_active_idx" ON "commerce"."inventory_reservations" USING btree ("variant_id","location_id") WHERE "commerce"."inventory_reservations"."released_at" is null;--> statement-breakpoint
CREATE INDEX "inventory_reservations_variant_idx" ON "commerce"."inventory_reservations" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_location_idx" ON "commerce"."inventory_reservations" USING btree ("store_id","location_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_cart_idx" ON "commerce"."inventory_reservations" USING btree ("store_id","cart_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_order_idx" ON "commerce"."inventory_reservations" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "invoices_order_idx" ON "commerce"."invoices" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "markets_code_idx" ON "commerce"."markets" USING btree ("code");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "commerce"."order_events" USING btree ("store_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "commerce"."order_lines" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "order_lines_variant_idx" ON "commerce"."order_lines" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "orders_market_idx" ON "commerce"."orders" USING btree ("store_id","market_code","currency");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "commerce"."orders" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "orders_cart_idx" ON "commerce"."orders" USING btree ("store_id","cart_id");--> statement-breakpoint
CREATE INDEX "orders_store_placed_idx" ON "commerce"."orders" USING btree ("store_id","placed_at");--> statement-breakpoint
CREATE INDEX "payment_credentials_updated_by_idx" ON "commerce"."payment_credentials" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "payment_methods_updated_by_idx" ON "commerce"."payment_methods" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "payment_providers_updated_by_idx" ON "commerce"."payment_providers" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "commerce"."payments" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "prices_market_idx" ON "commerce"."prices" USING btree ("store_id","market_code","currency");--> statement-breakpoint
CREATE INDEX "prices_variant_idx" ON "commerce"."prices" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prices_one_current_idx" ON "commerce"."prices" USING btree ("variant_id","market_code") WHERE "commerce"."prices"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "prices_history_idx" ON "commerce"."prices" USING btree ("variant_id","market_code","valid_from");--> statement-breakpoint
CREATE INDEX "producer_registrations_market_scheme_idx" ON "commerce"."producer_registrations" USING btree ("store_id","market_code","scheme");--> statement-breakpoint
CREATE INDEX "product_media_product_idx" ON "commerce"."product_media" USING btree ("store_id","product_id","position");--> statement-breakpoint
CREATE INDEX "product_schemes_store_product_idx" ON "commerce"."product_schemes" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "product_translations_store_product_idx" ON "commerce"."product_translations" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "commerce"."product_variants" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "products_manufacturer_idx" ON "commerce"."products" USING btree ("store_id","manufacturer_id");--> statement-breakpoint
CREATE INDEX "products_responsible_person_idx" ON "commerce"."products" USING btree ("store_id","responsible_person_id");--> statement-breakpoint
CREATE INDEX "products_store_status_idx" ON "commerce"."products" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "commerce"."refunds" USING btree ("store_id","payment_id");--> statement-breakpoint
CREATE INDEX "return_lines_return_idx" ON "commerce"."return_lines" USING btree ("store_id","return_id");--> statement-breakpoint
CREATE INDEX "return_lines_order_line_idx" ON "commerce"."return_lines" USING btree ("store_id","order_line_id");--> statement-breakpoint
CREATE INDEX "returns_order_idx" ON "commerce"."returns" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "returns_withdrawal_request_idx" ON "commerce"."returns" USING btree ("store_id","withdrawal_request_id");--> statement-breakpoint
CREATE INDEX "store_members_account_idx" ON "commerce"."store_members" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "store_members_invited_by_idx" ON "commerce"."store_members" USING btree ("invited_by");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_one_template_idx" ON "commerce"."stores" USING btree ("is_template") WHERE "commerce"."stores"."is_template";--> statement-breakpoint
CREATE INDEX "stores_created_by_idx" ON "commerce"."stores" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "webhook_events_unprocessed_idx" ON "commerce"."webhook_events" USING btree ("received_at") WHERE "commerce"."webhook_events"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "withdrawal_request_lines_request_idx" ON "commerce"."withdrawal_request_lines" USING btree ("store_id","withdrawal_request_id");--> statement-breakpoint
CREATE INDEX "withdrawal_request_lines_order_line_idx" ON "commerce"."withdrawal_request_lines" USING btree ("store_id","order_line_id");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_order_idx" ON "commerce"."withdrawal_requests" USING btree ("store_id","order_id");