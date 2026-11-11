CREATE TABLE "commerce"."draft_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"variant_id" uuid,
	"title" text NOT NULL,
	"sku" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"list_price_minor" bigint,
	"vat_category" text,
	"delivery" text DEFAULT 'physical' NOT NULL,
	CONSTRAINT "draft_order_lines_position" CHECK ("commerce"."draft_order_lines"."position" >= 0),
	CONSTRAINT "draft_order_lines_title" CHECK (char_length("commerce"."draft_order_lines"."title") between 1 and 200),
	CONSTRAINT "draft_order_lines_quantity" CHECK ("commerce"."draft_order_lines"."quantity" between 1 and 9999),
	CONSTRAINT "draft_order_lines_prices" CHECK ("commerce"."draft_order_lines"."unit_price_minor" >= 0 and ("commerce"."draft_order_lines"."list_price_minor" is null or "commerce"."draft_order_lines"."list_price_minor" >= 0)),
	CONSTRAINT "draft_order_lines_delivery" CHECK ("commerce"."draft_order_lines"."delivery" in ('physical', 'service')),
	CONSTRAINT "draft_order_lines_kind" CHECK (("commerce"."draft_order_lines"."variant_id" is null and "commerce"."draft_order_lines"."vat_category" is not null and "commerce"."draft_order_lines"."delivery" = 'service' and "commerce"."draft_order_lines"."list_price_minor" is null)
        or ("commerce"."draft_order_lines"."variant_id" is not null and "commerce"."draft_order_lines"."vat_category" is null and "commerce"."draft_order_lines"."delivery" = 'physical' and "commerce"."draft_order_lines"."list_price_minor" is not null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."draft_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"market_code" char(2) NOT NULL,
	"market_slug" text NOT NULL,
	"currency" char(3) NOT NULL,
	"locale" text NOT NULL,
	"customer_id" uuid,
	"email" text,
	"phone" text,
	"shipping_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"billing_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"company_name" text,
	"organisation_number" text,
	"note_to_buyer" text,
	"internal_note" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"discount_kind" text,
	"discount_value" bigint,
	"discount_label" text,
	"shipping_kind" text DEFAULT 'rate' NOT NULL,
	"shipping_minor" bigint,
	"valid_days" integer,
	"order_id" uuid,
	"sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"pay_token_hash" text,
	"pay_sends_today" integer DEFAULT 0 NOT NULL,
	"pay_sent_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_orders_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "draft_orders_store_number_key" UNIQUE("store_id","number"),
	CONSTRAINT "draft_orders_status" CHECK ("commerce"."draft_orders"."status" in ('open', 'sent', 'paid', 'expired', 'cancelled')),
	CONSTRAINT "draft_orders_number" CHECK ("commerce"."draft_orders"."number" ~ '^D-[0-9]+$'),
	CONSTRAINT "draft_orders_version" CHECK ("commerce"."draft_orders"."version" >= 1),
	CONSTRAINT "draft_orders_email" CHECK ("commerce"."draft_orders"."email" is null or char_length("commerce"."draft_orders"."email") <= 254),
	CONSTRAINT "draft_orders_notes" CHECK (char_length("commerce"."draft_orders"."note_to_buyer") <= 500 and char_length("commerce"."draft_orders"."internal_note") <= 1000),
	CONSTRAINT "draft_orders_tags" CHECK (jsonb_typeof("commerce"."draft_orders"."tags") = 'array' and jsonb_array_length("commerce"."draft_orders"."tags") <= 250),
	CONSTRAINT "draft_orders_addresses" CHECK (jsonb_typeof("commerce"."draft_orders"."shipping_address") = 'object' and jsonb_typeof("commerce"."draft_orders"."billing_address") = 'object'),
	CONSTRAINT "draft_orders_discount" CHECK (("commerce"."draft_orders"."discount_kind" is null) = ("commerce"."draft_orders"."discount_value" is null) and ("commerce"."draft_orders"."discount_kind" is null) = ("commerce"."draft_orders"."discount_label" is null)
        and ("commerce"."draft_orders"."discount_kind" is null or "commerce"."draft_orders"."discount_kind" in ('percent', 'amount'))
        and ("commerce"."draft_orders"."discount_kind" is distinct from 'percent' or "commerce"."draft_orders"."discount_value" between 1 and 10000)
        and ("commerce"."draft_orders"."discount_kind" is distinct from 'amount' or "commerce"."draft_orders"."discount_value" > 0)
        and ("commerce"."draft_orders"."discount_label" is null or char_length("commerce"."draft_orders"."discount_label") between 1 and 60)),
	CONSTRAINT "draft_orders_shipping" CHECK ("commerce"."draft_orders"."shipping_kind" in ('rate', 'free', 'custom') and ("commerce"."draft_orders"."shipping_kind" = 'custom') = ("commerce"."draft_orders"."shipping_minor" is not null) and ("commerce"."draft_orders"."shipping_minor" is null or "commerce"."draft_orders"."shipping_minor" >= 0)),
	CONSTRAINT "draft_orders_valid_days" CHECK ("commerce"."draft_orders"."valid_days" is null or "commerce"."draft_orders"."valid_days" between 1 and 30),
	CONSTRAINT "draft_orders_pay_sends" CHECK ("commerce"."draft_orders"."pay_sends_today" >= 0),
	CONSTRAINT "draft_orders_lifecycle" CHECK (("commerce"."draft_orders"."status" = 'open' and "commerce"."draft_orders"."order_id" is null and "commerce"."draft_orders"."sent_at" is null and "commerce"."draft_orders"."expires_at" is null and "commerce"."draft_orders"."paid_at" is null and "commerce"."draft_orders"."pay_token_hash" is null)
        or ("commerce"."draft_orders"."status" in ('sent', 'expired', 'cancelled') and "commerce"."draft_orders"."order_id" is not null and "commerce"."draft_orders"."sent_at" is not null and "commerce"."draft_orders"."expires_at" is not null and "commerce"."draft_orders"."expires_at" > "commerce"."draft_orders"."sent_at" and "commerce"."draft_orders"."paid_at" is null)
        or ("commerce"."draft_orders"."status" = 'paid' and "commerce"."draft_orders"."order_id" is not null and "commerce"."draft_orders"."sent_at" is not null and "commerce"."draft_orders"."expires_at" is not null and "commerce"."draft_orders"."paid_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."order_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"gift_messages" boolean DEFAULT false NOT NULL,
	"auto_archive_days" integer,
	"draft_valid_days" integer DEFAULT 7 NOT NULL,
	"staff_mark_paid" boolean DEFAULT false NOT NULL,
	"next_draft_number" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_settings_auto_archive" CHECK ("commerce"."order_settings"."auto_archive_days" is null or "commerce"."order_settings"."auto_archive_days" between 14 and 365),
	CONSTRAINT "order_settings_draft_valid" CHECK ("commerce"."order_settings"."draft_valid_days" between 1 and 30),
	CONSTRAINT "order_settings_next_draft" CHECK ("commerce"."order_settings"."next_draft_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "commerce"."order_tags" (
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_tags_order_id_key_pk" PRIMARY KEY("order_id","key"),
	CONSTRAINT "order_tags_key" CHECK (char_length("commerce"."order_tags"."key") between 1 and 40 and "commerce"."order_tags"."key" = btrim("commerce"."order_tags"."key")),
	CONSTRAINT "order_tags_label" CHECK (char_length("commerce"."order_tags"."label") between 1 and 40 and "commerce"."order_tags"."label" = btrim("commerce"."order_tags"."label")),
	CONSTRAINT "order_tags_label_chars" CHECK ("commerce"."order_tags"."label" !~ '[,\x01-\x1f\x7f\u202a-\u202e\u2066-\u2069]')
);
--> statement-breakpoint
CREATE TABLE "commerce"."order_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"columns" text[],
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_views_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "order_views_title" CHECK (char_length("commerce"."order_views"."title") between 1 and 40 and "commerce"."order_views"."title" = btrim("commerce"."order_views"."title")),
	CONSTRAINT "order_views_params" CHECK (jsonb_typeof("commerce"."order_views"."params") = 'object' and octet_length("commerce"."order_views"."params"::text) < 4096),
	CONSTRAINT "order_views_columns" CHECK ("commerce"."order_views"."columns" is null or cardinality("commerce"."order_views"."columns") <= 12),
	CONSTRAINT "order_views_position" CHECK ("commerce"."order_views"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."orders" DROP CONSTRAINT "orders_anonymised";--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "is_gift" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "gift_to" text;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "gift_from" text;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "gift_message" text;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "list_price_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "custom" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "staff_discount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "source" text DEFAULT 'checkout' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "draft_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "made_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "staff_discount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "staff_discount_label" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "is_gift" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "gift_to" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "gift_from" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "gift_message" text;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."draft_order_lines" ADD CONSTRAINT "draft_order_lines_vat_category_vat_categories_code_fk" FOREIGN KEY ("vat_category") REFERENCES "commerce"."vat_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."draft_order_lines" ADD CONSTRAINT "draft_order_lines_draft_fk" FOREIGN KEY ("store_id","draft_id") REFERENCES "commerce"."draft_orders"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."draft_order_lines" ADD CONSTRAINT "draft_order_lines_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."draft_orders" ADD CONSTRAINT "draft_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."draft_orders" ADD CONSTRAINT "draft_orders_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."draft_orders" ADD CONSTRAINT "draft_orders_market_fk" FOREIGN KEY ("store_id","market_code") REFERENCES "commerce"."markets"("store_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."draft_orders" ADD CONSTRAINT "draft_orders_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."draft_orders" ADD CONSTRAINT "draft_orders_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_settings" ADD CONSTRAINT "order_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_tags" ADD CONSTRAINT "order_tags_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_tags" ADD CONSTRAINT "order_tags_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_views" ADD CONSTRAINT "order_views_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_views" ADD CONSTRAINT "order_views_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_order_lines_draft_idx" ON "commerce"."draft_order_lines" USING btree ("store_id","draft_id","position");--> statement-breakpoint
CREATE INDEX "draft_order_lines_variant_idx" ON "commerce"."draft_order_lines" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "draft_order_lines_vat_category_idx" ON "commerce"."draft_order_lines" USING btree ("vat_category");--> statement-breakpoint
CREATE INDEX "draft_orders_store_idx" ON "commerce"."draft_orders" USING btree ("store_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "draft_orders_expiry_idx" ON "commerce"."draft_orders" USING btree ("expires_at") WHERE "commerce"."draft_orders"."status" = 'sent';--> statement-breakpoint
CREATE UNIQUE INDEX "draft_orders_token_idx" ON "commerce"."draft_orders" USING btree ("pay_token_hash") WHERE "commerce"."draft_orders"."pay_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "draft_orders_market_idx" ON "commerce"."draft_orders" USING btree ("store_id","market_code");--> statement-breakpoint
CREATE INDEX "draft_orders_customer_idx" ON "commerce"."draft_orders" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "draft_orders_order_idx" ON "commerce"."draft_orders" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "draft_orders_created_by_idx" ON "commerce"."draft_orders" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "order_tags_key_idx" ON "commerce"."order_tags" USING btree ("store_id","key","order_id");--> statement-breakpoint
CREATE INDEX "order_tags_order_idx" ON "commerce"."order_tags" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "order_tags_created_by_idx" ON "commerce"."order_tags" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "order_views_title_key" ON "commerce"."order_views" USING btree ("store_id",lower("title"));--> statement-breakpoint
CREATE INDEX "order_views_position_idx" ON "commerce"."order_views" USING btree ("store_id","position");--> statement-breakpoint
CREATE INDEX "order_views_created_by_idx" ON "commerce"."order_views" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_made_by_accounts_id_fk" FOREIGN KEY ("made_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_recorded_by_accounts_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_made_by_idx" ON "commerce"."orders" USING btree ("made_by");--> statement-breakpoint
CREATE INDEX "orders_draft_idx" ON "commerce"."orders" USING btree ("store_id","draft_id") WHERE "commerce"."orders"."draft_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_recorded_by_idx" ON "commerce"."payments" USING btree ("recorded_by");--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_gift_fields" CHECK (("commerce"."carts"."is_gift" or ("commerce"."carts"."gift_to" is null and "commerce"."carts"."gift_from" is null and "commerce"."carts"."gift_message" is null))
    and char_length("commerce"."carts"."gift_to") <= 60 and char_length("commerce"."carts"."gift_from") <= 60
    and char_length("commerce"."carts"."gift_message") <= 300
    and ("commerce"."carts"."gift_message" is null or cardinality(string_to_array("commerce"."carts"."gift_message", chr(10))) <= 6));--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_list_price" CHECK ("commerce"."order_lines"."list_price_minor" is null or "commerce"."order_lines"."list_price_minor" >= 0);--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_custom" CHECK (not "commerce"."order_lines"."custom" or ("commerce"."order_lines"."variant_id" is null and "commerce"."order_lines"."sku" = 'CUSTOM' and "commerce"."order_lines"."delivery" = 'service'));--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_staff_discount" CHECK ("commerce"."order_lines"."staff_discount_minor" between 0 and "commerce"."order_lines"."discount_minor");--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_discount_parts" CHECK ("commerce"."order_lines"."staff_discount_minor" = 0 or "commerce"."order_lines"."member_discount_minor" + "commerce"."order_lines"."campaign_discount_minor" + "commerce"."order_lines"."bonus_discount_minor" + "commerce"."order_lines"."referral_discount_minor" + "commerce"."order_lines"."vat_relief_minor" + "commerce"."order_lines"."staff_discount_minor" <= "commerce"."order_lines"."discount_minor");--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_archived_not_pending" CHECK ("commerce"."orders"."archived_at" is null or "commerce"."orders"."status" <> 'pending_payment');--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_source" CHECK ("commerce"."orders"."source" in ('checkout', 'draft'));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_source_draft" CHECK (("commerce"."orders"."source" = 'draft') = ("commerce"."orders"."draft_id" is not null) and ("commerce"."orders"."source" = 'draft') = ("commerce"."orders"."made_by" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_staff_discount" CHECK ("commerce"."orders"."staff_discount_minor" between 0 and "commerce"."orders"."discount_minor");--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_staff_discount_label" CHECK ("commerce"."orders"."staff_discount_label" is null or ("commerce"."orders"."staff_discount_minor" > 0 and char_length("commerce"."orders"."staff_discount_label") between 1 and 60));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_gift_fields" CHECK (("commerce"."orders"."is_gift" or ("commerce"."orders"."gift_to" is null and "commerce"."orders"."gift_from" is null and "commerce"."orders"."gift_message" is null))
    and char_length("commerce"."orders"."gift_to") <= 60 and char_length("commerce"."orders"."gift_from") <= 60
    and char_length("commerce"."orders"."gift_message") <= 300
    and ("commerce"."orders"."gift_message" is null or cardinality(string_to_array("commerce"."orders"."gift_message", chr(10))) <= 6));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_anonymised" CHECK ("commerce"."orders"."anonymised_at" is null or ("commerce"."orders"."email" = '[removed]' and "commerce"."orders"."billing_address" = '{}'::jsonb and "commerce"."orders"."shipping_address" = '{}'::jsonb and "commerce"."orders"."company_name" is null and "commerce"."orders"."organisation_number" is null and not "commerce"."orders"."is_gift" and "commerce"."orders"."gift_to" is null and "commerce"."orders"."gift_from" is null and "commerce"."orders"."gift_message" is null));--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_manual_method" CHECK (("commerce"."payments"."provider" = 'manual') = ("commerce"."payments"."method" is not null) and ("commerce"."payments"."method" is null or "commerce"."payments"."method" in ('cash', 'bank_transfer', 'other')));--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_manual_recorded" CHECK ("commerce"."payments"."provider" <> 'manual' or "commerce"."payments"."recorded_by" is not null);--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_manual_real" CHECK ("commerce"."payments"."provider" <> 'manual' or not "commerce"."payments"."test_mode");