CREATE TABLE "commerce"."return_exchange_lines" (
	"store_id" uuid NOT NULL,
	"exchange_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"quantity" integer NOT NULL,
	"list_price_minor" bigint NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_exchange_lines_exchange_id_n_pk" PRIMARY KEY("exchange_id","n"),
	CONSTRAINT "return_exchange_lines_n" CHECK ("commerce"."return_exchange_lines"."n" between 1 and 20),
	CONSTRAINT "return_exchange_lines_quantity" CHECK ("commerce"."return_exchange_lines"."quantity" between 1 and 99),
	CONSTRAINT "return_exchange_lines_prices" CHECK ("commerce"."return_exchange_lines"."unit_price_minor" >= 0 and "commerce"."return_exchange_lines"."list_price_minor" >= 0 and "commerce"."return_exchange_lines"."unit_price_minor" <= "commerce"."return_exchange_lines"."list_price_minor")
);
--> statement-breakpoint
CREATE TABLE "commerce"."return_exchanges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"status" text NOT NULL,
	"currency" char(3) NOT NULL,
	"market_slug" text NOT NULL,
	"shipping_kind" text DEFAULT 'free' NOT NULL,
	"shipping_minor" bigint DEFAULT 0 NOT NULL,
	"delivery_address" jsonb NOT NULL,
	"credit_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"difference_minor" bigint NOT NULL,
	"credit_at_processing" bigint,
	"difference_at_processing" bigint,
	"token_hash" text,
	"expires_at" timestamp with time zone,
	"terms" jsonb,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"confirmed_channel" text,
	"exchange_order_id" uuid,
	"refund_id" uuid,
	"transfer_refund_id" uuid,
	"made_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "return_exchanges_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "return_exchanges_return_seq_key" UNIQUE("store_id","return_id","seq"),
	CONSTRAINT "return_exchanges_seq" CHECK ("commerce"."return_exchanges"."seq" between 1 and 5),
	CONSTRAINT "return_exchanges_status" CHECK ("commerce"."return_exchanges"."status" in ('draft', 'proposed', 'confirmed', 'processed', 'settled', 'declined_by_customer', 'cancelled', 'expired', 'superseded')),
	CONSTRAINT "return_exchanges_shipping" CHECK ("commerce"."return_exchanges"."shipping_kind" in ('free', 'standard', 'set') and "commerce"."return_exchanges"."shipping_minor" >= 0 and ("commerce"."return_exchanges"."shipping_kind" <> 'free' or "commerce"."return_exchanges"."shipping_minor" = 0)),
	CONSTRAINT "return_exchanges_amounts" CHECK ("commerce"."return_exchanges"."credit_minor" >= 0 and "commerce"."return_exchanges"."total_minor" >= 0 and "commerce"."return_exchanges"."difference_minor" = "commerce"."return_exchanges"."total_minor" - "commerce"."return_exchanges"."credit_minor"
        and ("commerce"."return_exchanges"."credit_at_processing" is null or "commerce"."return_exchanges"."credit_at_processing" >= 0) and ("commerce"."return_exchanges"."credit_at_processing" is null) = ("commerce"."return_exchanges"."difference_at_processing" is null)),
	CONSTRAINT "return_exchanges_address" CHECK (jsonb_typeof("commerce"."return_exchanges"."delivery_address") = 'object'),
	CONSTRAINT "return_exchanges_terms" CHECK ("commerce"."return_exchanges"."terms" is null or jsonb_typeof("commerce"."return_exchanges"."terms") = 'array'),
	CONSTRAINT "return_exchanges_token" CHECK ("commerce"."return_exchanges"."token_hash" is null or "commerce"."return_exchanges"."token_hash" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "return_exchanges_market_slug" CHECK ("commerce"."return_exchanges"."market_slug" ~ '^[a-z]{2}(-[a-z0-9]{2,8}){0,3}$'),
	CONSTRAINT "return_exchanges_confirmation" CHECK (("commerce"."return_exchanges"."confirmed_at" is null) = ("commerce"."return_exchanges"."confirmed_by" is null) and ("commerce"."return_exchanges"."confirmed_at" is null) = ("commerce"."return_exchanges"."confirmed_channel" is null)
        and ("commerce"."return_exchanges"."confirmed_by" is null or "commerce"."return_exchanges"."confirmed_by" in ('customer', 'staff'))
        and ("commerce"."return_exchanges"."confirmed_channel" is null or "commerce"."return_exchanges"."confirmed_channel" in ('web', 'email', 'letter', 'phone', 'in_person', 'other'))
        and (("commerce"."return_exchanges"."confirmed_by" = 'customer') = ("commerce"."return_exchanges"."confirmed_channel" = 'web') or "commerce"."return_exchanges"."confirmed_by" is null)),
	CONSTRAINT "return_exchanges_lifecycle" CHECK (("commerce"."return_exchanges"."status" = 'draft' and "commerce"."return_exchanges"."confirmed_at" is null and "commerce"."return_exchanges"."exchange_order_id" is null and "commerce"."return_exchanges"."processed_at" is null and "commerce"."return_exchanges"."settled_at" is null and "commerce"."return_exchanges"."ended_at" is null)
        or ("commerce"."return_exchanges"."status" = 'proposed' and "commerce"."return_exchanges"."token_hash" is not null and "commerce"."return_exchanges"."expires_at" is not null and "commerce"."return_exchanges"."confirmed_at" is null and "commerce"."return_exchanges"."exchange_order_id" is null
            and "commerce"."return_exchanges"."processed_at" is null and "commerce"."return_exchanges"."settled_at" is null and "commerce"."return_exchanges"."ended_at" is null)
        or ("commerce"."return_exchanges"."status" = 'confirmed' and "commerce"."return_exchanges"."token_hash" is not null and "commerce"."return_exchanges"."expires_at" is not null and "commerce"."return_exchanges"."confirmed_at" is not null and "commerce"."return_exchanges"."exchange_order_id" is null
            and "commerce"."return_exchanges"."processed_at" is null and "commerce"."return_exchanges"."settled_at" is null and "commerce"."return_exchanges"."ended_at" is null)
        or ("commerce"."return_exchanges"."status" = 'processed' and "commerce"."return_exchanges"."confirmed_at" is not null and "commerce"."return_exchanges"."exchange_order_id" is not null and "commerce"."return_exchanges"."processed_at" is not null
            and "commerce"."return_exchanges"."credit_at_processing" is not null and "commerce"."return_exchanges"."settled_at" is null and "commerce"."return_exchanges"."ended_at" is null)
        or ("commerce"."return_exchanges"."status" = 'settled' and "commerce"."return_exchanges"."confirmed_at" is not null and "commerce"."return_exchanges"."exchange_order_id" is not null and "commerce"."return_exchanges"."processed_at" is not null
            and "commerce"."return_exchanges"."credit_at_processing" is not null and "commerce"."return_exchanges"."settled_at" is not null and "commerce"."return_exchanges"."ended_at" is null)
        or ("commerce"."return_exchanges"."status" in ('declined_by_customer', 'cancelled', 'expired', 'superseded') and "commerce"."return_exchanges"."ended_at" is not null and "commerce"."return_exchanges"."settled_at" is null))
);
--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" DROP CONSTRAINT "credit_notes_source";--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" DROP CONSTRAINT "credit_notes_source_ref";--> statement-breakpoint
ALTER TABLE "commerce"."email_templates" DROP CONSTRAINT "email_templates_notification";--> statement-breakpoint
ALTER TABLE "commerce"."inventory_movements" DROP CONSTRAINT "inventory_movements_source";--> statement-breakpoint
ALTER TABLE "commerce"."notification_settings" DROP CONSTRAINT "notification_settings_notification";--> statement-breakpoint
ALTER TABLE "commerce"."notification_settings" DROP CONSTRAINT "notification_settings_required";--> statement-breakpoint
ALTER TABLE "commerce"."orders" DROP CONSTRAINT "orders_source";--> statement-breakpoint
ALTER TABLE "commerce"."orders" DROP CONSTRAINT "orders_source_draft";--> statement-breakpoint
ALTER TABLE "commerce"."returns" DROP CONSTRAINT "returns_outcome";--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "exchange_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "exchange_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "transfer_refund_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD COLUMN "exchange_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD COLUMN "kind" text DEFAULT 'money' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."return_settings" ADD COLUMN "exchanges" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."return_settings" ADD COLUMN "label_carrier" text;--> statement-breakpoint
ALTER TABLE "commerce"."return_settings" ADD COLUMN "label_service" text;--> statement-breakpoint
ALTER TABLE "commerce"."return_settings" ADD COLUMN "label_auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "exchange_wish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "exchange_wish_note" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "label_source" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "label_carrier_id" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "label_service" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "label_consignment_number" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "label_tracking_number" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "label_tracking_url" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "label_carrier_url" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "label_cost_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "label_cost_carrier" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "label_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "label_booked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "label_tries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."return_exchange_lines" ADD CONSTRAINT "return_exchange_lines_exchange_fk" FOREIGN KEY ("store_id","exchange_id") REFERENCES "commerce"."return_exchanges"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."return_exchange_lines" ADD CONSTRAINT "return_exchange_lines_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."return_exchanges" ADD CONSTRAINT "return_exchanges_made_by_accounts_id_fk" FOREIGN KEY ("made_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."return_exchanges" ADD CONSTRAINT "return_exchanges_return_fk" FOREIGN KEY ("store_id","return_id") REFERENCES "commerce"."returns"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."return_exchanges" ADD CONSTRAINT "return_exchanges_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."return_exchanges" ADD CONSTRAINT "return_exchanges_exchange_order_fk" FOREIGN KEY ("store_id","exchange_order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."return_exchanges" ADD CONSTRAINT "return_exchanges_refund_fk" FOREIGN KEY ("store_id","refund_id") REFERENCES "commerce"."refunds"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."return_exchanges" ADD CONSTRAINT "return_exchanges_transfer_refund_fk" FOREIGN KEY ("store_id","transfer_refund_id") REFERENCES "commerce"."refunds"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "return_exchange_lines_exchange_idx" ON "commerce"."return_exchange_lines" USING btree ("store_id","exchange_id");--> statement-breakpoint
CREATE INDEX "return_exchange_lines_variant_idx" ON "commerce"."return_exchange_lines" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "return_exchanges_open_key" ON "commerce"."return_exchanges" USING btree ("store_id","return_id") WHERE "commerce"."return_exchanges"."status" in ('draft', 'proposed', 'confirmed', 'processed');--> statement-breakpoint
CREATE INDEX "return_exchanges_expiry_idx" ON "commerce"."return_exchanges" USING btree ("store_id","status","expires_at") WHERE "commerce"."return_exchanges"."status" in ('proposed', 'confirmed', 'processed');--> statement-breakpoint
CREATE INDEX "return_exchanges_return_idx" ON "commerce"."return_exchanges" USING btree ("store_id","return_id");--> statement-breakpoint
CREATE INDEX "return_exchanges_order_idx" ON "commerce"."return_exchanges" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "return_exchanges_exchange_order_idx" ON "commerce"."return_exchanges" USING btree ("store_id","exchange_order_id");--> statement-breakpoint
CREATE INDEX "return_exchanges_refund_idx" ON "commerce"."return_exchanges" USING btree ("store_id","refund_id");--> statement-breakpoint
CREATE INDEX "return_exchanges_transfer_refund_idx" ON "commerce"."return_exchanges" USING btree ("store_id","transfer_refund_id");--> statement-breakpoint
CREATE INDEX "return_exchanges_made_by_idx" ON "commerce"."return_exchanges" USING btree ("made_by");--> statement-breakpoint
CREATE UNIQUE INDEX "return_exchanges_token_key" ON "commerce"."return_exchanges" USING btree ("token_hash") WHERE "commerce"."return_exchanges"."token_hash" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_exchange_fk" FOREIGN KEY ("store_id","exchange_id") REFERENCES "commerce"."return_exchanges"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_exchange_fk" FOREIGN KEY ("store_id","exchange_id") REFERENCES "commerce"."return_exchanges"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_transfer_refund_fk" FOREIGN KEY ("store_id","transfer_refund_id") REFERENCES "commerce"."refunds"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_exchange_fk" FOREIGN KEY ("store_id","exchange_id") REFERENCES "commerce"."return_exchanges"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_return_exchange_key" ON "commerce"."credit_notes" USING btree ("store_id","return_id") WHERE "commerce"."credit_notes"."source" = 'return_exchange';--> statement-breakpoint
CREATE INDEX "orders_exchange_idx" ON "commerce"."orders" USING btree ("store_id","exchange_id") WHERE "commerce"."orders"."exchange_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_exchange_live_key" ON "commerce"."orders" USING btree ("store_id","exchange_id") WHERE "commerce"."orders"."exchange_id" is not null and "commerce"."orders"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "payments_exchange_idx" ON "commerce"."payments" USING btree ("store_id","exchange_id") WHERE "commerce"."payments"."exchange_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_transfer_refund_key" ON "commerce"."payments" USING btree ("store_id","transfer_refund_id") WHERE "commerce"."payments"."transfer_refund_id" is not null;--> statement-breakpoint
CREATE INDEX "refunds_exchange_idx" ON "commerce"."refunds" USING btree ("store_id","exchange_id") WHERE "commerce"."refunds"."exchange_id" is not null;--> statement-breakpoint
CREATE INDEX "returns_label_pending_idx" ON "commerce"."returns" USING btree ("store_id","created_at") WHERE "commerce"."returns"."kind" = 'withdrawal' and "commerce"."returns"."label_source" is null;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_source" CHECK ("commerce"."credit_notes"."source" in ('refund', 'return_outside', 'order_edit', 'return_exchange'));--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_source_ref" CHECK (("commerce"."credit_notes"."source" = 'refund' and "commerce"."credit_notes"."refund_id" is not null and "commerce"."credit_notes"."return_id" is null and "commerce"."credit_notes"."order_edit_id" is null)
        or ("commerce"."credit_notes"."source" in ('return_outside', 'return_exchange') and "commerce"."credit_notes"."return_id" is not null and "commerce"."credit_notes"."refund_id" is null and "commerce"."credit_notes"."order_edit_id" is null)
        or ("commerce"."credit_notes"."source" = 'order_edit' and "commerce"."credit_notes"."order_edit_id" is not null and "commerce"."credit_notes"."refund_id" is null and "commerce"."credit_notes"."return_id" is null));--> statement-breakpoint
ALTER TABLE "commerce"."email_templates" ADD CONSTRAINT "email_templates_notification" CHECK ("commerce"."email_templates"."notification" in ('order.confirmation', 'subscription.renewed', 'order.changed', 'order.sent', 'order.parcel_out_for_delivery', 'order.parcel_delivered', 'order.refunded', 'order.cancelled', 'order.ready_for_pickup', 'order.out_for_delivery', 'return.approved', 'return.declined', 'return.received', 'return.refunded', 'return.exchange_proposed', 'return.exchange_to_pay', 'return.exchanged', 'return.exchange_lapsed', 'return.label_ready'));--> statement-breakpoint
ALTER TABLE "commerce"."inventory_movements" ADD CONSTRAINT "inventory_movements_source" CHECK ("commerce"."inventory_movements"."source" in ('inventory_page', 'editor', 'bulk', 'file', 'order', 'return', 'checkout', 'ai_manager', 'copy', 'system', 'order_edit', 'exchange'));--> statement-breakpoint
ALTER TABLE "commerce"."notification_settings" ADD CONSTRAINT "notification_settings_notification" CHECK ("commerce"."notification_settings"."notification" in ('order.confirmation', 'subscription.renewed', 'order.changed', 'order.sent', 'order.parcel_out_for_delivery', 'order.parcel_delivered', 'order.refunded', 'order.cancelled', 'order.ready_for_pickup', 'order.out_for_delivery', 'return.acknowledgement', 'return.approved', 'return.declined', 'return.received', 'return.refunded', 'return.exchange_proposed', 'return.exchange_to_pay', 'return.exchanged', 'return.exchange_lapsed', 'return.label_ready'));--> statement-breakpoint
ALTER TABLE "commerce"."notification_settings" ADD CONSTRAINT "notification_settings_required" CHECK ("commerce"."notification_settings"."enabled" or "commerce"."notification_settings"."notification" not in ('order.confirmation', 'subscription.renewed', 'order.changed', 'return.acknowledgement', 'return.approved', 'return.declined', 'return.exchange_to_pay', 'return.exchanged'));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_source_exchange" CHECK (("commerce"."orders"."source" = 'exchange') = ("commerce"."orders"."exchange_id" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_source" CHECK ("commerce"."orders"."source" in ('checkout', 'draft', 'exchange'));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_source_draft" CHECK (("commerce"."orders"."source" = 'draft') = ("commerce"."orders"."draft_id" is not null) and ("commerce"."orders"."source" in ('draft', 'exchange')) = ("commerce"."orders"."made_by" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_exchange_transfer" CHECK (("commerce"."payments"."provider" = 'exchange') = ("commerce"."payments"."transfer_refund_id" is not null) and ("commerce"."payments"."provider" <> 'exchange' or "commerce"."payments"."exchange_id" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_kind" CHECK ("commerce"."refunds"."kind" in ('money', 'transfer'));--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_transfer" CHECK ("commerce"."refunds"."kind" <> 'transfer' or ("commerce"."refunds"."exchange_id" is not null and "commerce"."refunds"."provider_reference" is null and "commerce"."refunds"."status" = 'succeeded'));--> statement-breakpoint
ALTER TABLE "commerce"."return_settings" ADD CONSTRAINT "return_settings_label_carrier" CHECK ("commerce"."return_settings"."label_carrier" is null or "commerce"."return_settings"."label_carrier" in ('bring', 'postnord', 'porterbuddy', 'helthjem'));--> statement-breakpoint
ALTER TABLE "commerce"."return_settings" ADD CONSTRAINT "return_settings_label_service" CHECK ("commerce"."return_settings"."label_service" is null or ("commerce"."return_settings"."label_carrier" is not null and char_length("commerce"."return_settings"."label_service") between 1 and 20));--> statement-breakpoint
ALTER TABLE "commerce"."return_settings" ADD CONSTRAINT "return_settings_label_auto" CHECK (not "commerce"."return_settings"."label_auto" or "commerce"."return_settings"."label_carrier" is not null);--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_exchange_wish" CHECK ("commerce"."returns"."exchange_wish_note" is null or ("commerce"."returns"."exchange_wish_at" is not null and char_length("commerce"."returns"."exchange_wish_note") <= 500));--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_label_source" CHECK ("commerce"."returns"."label_source" is null or "commerce"."returns"."label_source" in ('pasted', 'carrier'));--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_label_carrier" CHECK (("commerce"."returns"."label_source" is not distinct from 'carrier') = ("commerce"."returns"."label_carrier_id" is not null and "commerce"."returns"."label_booked_at" is not null)
        and ("commerce"."returns"."label_carrier_id" is null or "commerce"."returns"."label_carrier_id" in ('bring', 'postnord', 'porterbuddy', 'helthjem'))
        and ("commerce"."returns"."label_source" is not distinct from 'carrier' or ("commerce"."returns"."label_service" is null and "commerce"."returns"."label_consignment_number" is null and "commerce"."returns"."label_tracking_number" is null
             and "commerce"."returns"."label_tracking_url" is null and "commerce"."returns"."label_carrier_url" is null and "commerce"."returns"."label_cost_minor" is null and "commerce"."returns"."label_cost_carrier" is null and not "commerce"."returns"."label_test")));--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_label_urls" CHECK (("commerce"."returns"."label_tracking_url" is null or "commerce"."returns"."label_tracking_url" ~ '^https://') and ("commerce"."returns"."label_carrier_url" is null or "commerce"."returns"."label_carrier_url" ~ '^https://'));--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_label_cost" CHECK (("commerce"."returns"."label_cost_minor" is null or "commerce"."returns"."label_cost_minor" >= 0) and ("commerce"."returns"."label_cost_carrier" is null or jsonb_typeof("commerce"."returns"."label_cost_carrier") = 'object'));--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_label_tries" CHECK ("commerce"."returns"."label_tries" >= 0);--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_outcome" CHECK ("commerce"."returns"."outcome" is null or "commerce"."returns"."outcome" in ('refunded', 'declined', 'no_refund', 'cancelled', 'exchanged'));