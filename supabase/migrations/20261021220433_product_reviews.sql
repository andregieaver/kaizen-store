CREATE TABLE "commerce"."product_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"source" text NOT NULL,
	"order_id" uuid,
	"order_line_id" uuid,
	"buyer_key" text,
	"customer_id" uuid,
	"imported_from" text,
	"written_on" date,
	"author_name" text NOT NULL,
	"rating" smallint NOT NULL,
	"title" text,
	"body" text,
	"locale" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"hidden_reason" text,
	"moderated_at" timestamp with time zone,
	"moderated_by" uuid,
	"answer" text,
	"answered_at" timestamp with time zone,
	"answered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	CONSTRAINT "product_reviews_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "product_reviews_source" CHECK ("commerce"."product_reviews"."source" in ('buyer', 'import')),
	CONSTRAINT "product_reviews_origin" CHECK (("commerce"."product_reviews"."source" = 'buyer' and "commerce"."product_reviews"."order_id" is not null and "commerce"."product_reviews"."order_line_id" is not null and "commerce"."product_reviews"."variant_id" is not null and "commerce"."product_reviews"."buyer_key" ~ '^(c:[0-9a-f-]{36}|e:[0-9a-f]{64})$' and "commerce"."product_reviews"."imported_from" is null and "commerce"."product_reviews"."written_on" is null)
        or ("commerce"."product_reviews"."source" = 'import' and "commerce"."product_reviews"."order_id" is null and "commerce"."product_reviews"."order_line_id" is null and "commerce"."product_reviews"."buyer_key" is null and "commerce"."product_reviews"."customer_id" is null and length(trim("commerce"."product_reviews"."imported_from")) between 1 and 80 and "commerce"."product_reviews"."written_on" is not null)),
	CONSTRAINT "product_reviews_rating" CHECK ("commerce"."product_reviews"."rating" between 1 and 5),
	CONSTRAINT "product_reviews_words" CHECK (length(trim("commerce"."product_reviews"."author_name")) between 1 and 60 and ("commerce"."product_reviews"."title" is null or length(trim("commerce"."product_reviews"."title")) between 1 and 120) and ("commerce"."product_reviews"."body" is null or length(trim("commerce"."product_reviews"."body")) between 1 and 5000)),
	CONSTRAINT "product_reviews_status" CHECK ("commerce"."product_reviews"."status" in ('pending', 'published', 'hidden')),
	CONSTRAINT "product_reviews_hidden" CHECK (("commerce"."product_reviews"."status" = 'hidden') = ("commerce"."product_reviews"."hidden_reason" is not null) and ("commerce"."product_reviews"."hidden_reason" is null or "commerce"."product_reviews"."hidden_reason" in ('not_about_product', 'offensive', 'personal_data', 'spam', 'other'))),
	CONSTRAINT "product_reviews_answer" CHECK (("commerce"."product_reviews"."answer" is null) = ("commerce"."product_reviews"."answered_at" is null) and ("commerce"."product_reviews"."answer" is null or length(trim("commerce"."product_reviews"."answer")) between 1 and 2000))
);
--> statement-breakpoint
CREATE TABLE "commerce"."review_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"publish" text DEFAULT 'after_check' NOT NULL,
	"requests_on" boolean DEFAULT false NOT NULL,
	"requests_enabled_at" timestamp with time zone,
	"request_days" integer DEFAULT 14 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_settings_publish" CHECK ("commerce"."review_settings"."publish" in ('after_check', 'at_once')),
	CONSTRAINT "review_settings_days" CHECK (request_days between 3 and 60),
	CONSTRAINT "review_settings_requests" CHECK (not "commerce"."review_settings"."requests_on" or "commerce"."review_settings"."requests_enabled_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "commerce"."stores" DROP CONSTRAINT "stores_features";--> statement-breakpoint
ALTER TABLE "commerce"."product_reviews" ADD CONSTRAINT "product_reviews_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_reviews" ADD CONSTRAINT "product_reviews_moderated_by_accounts_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_reviews" ADD CONSTRAINT "product_reviews_answered_by_accounts_id_fk" FOREIGN KEY ("answered_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_reviews" ADD CONSTRAINT "product_reviews_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_reviews" ADD CONSTRAINT "product_reviews_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_reviews" ADD CONSTRAINT "product_reviews_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_reviews" ADD CONSTRAINT "product_reviews_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."review_settings" ADD CONSTRAINT "review_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_reviews_line_key" ON "commerce"."product_reviews" USING btree ("store_id","order_line_id") WHERE "commerce"."product_reviews"."order_line_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_reviews_buyer_key" ON "commerce"."product_reviews" USING btree ("store_id","product_id","buyer_key") WHERE "commerce"."product_reviews"."source" = 'buyer';--> statement-breakpoint
CREATE INDEX "product_reviews_shown_idx" ON "commerce"."product_reviews" USING btree ("store_id","product_id","created_at") WHERE "commerce"."product_reviews"."status" = 'published';--> statement-breakpoint
CREATE INDEX "product_reviews_queue_idx" ON "commerce"."product_reviews" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "product_reviews_order_idx" ON "commerce"."product_reviews" USING btree ("store_id","order_id") WHERE "commerce"."product_reviews"."order_id" is not null;--> statement-breakpoint
CREATE INDEX "product_reviews_customer_idx" ON "commerce"."product_reviews" USING btree ("store_id","customer_id") WHERE "commerce"."product_reviews"."customer_id" is not null;--> statement-breakpoint
CREATE INDEX "product_reviews_variant_idx" ON "commerce"."product_reviews" USING btree ("store_id","variant_id") WHERE "commerce"."product_reviews"."variant_id" is not null;--> statement-breakpoint
CREATE INDEX "product_reviews_moderated_by_idx" ON "commerce"."product_reviews" USING btree ("moderated_by");--> statement-breakpoint
CREATE INDEX "product_reviews_answered_by_idx" ON "commerce"."product_reviews" USING btree ("answered_by");--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_features" CHECK ("commerce"."stores"."features" <@ array['shop', 'subscriptions', 'boxes', 'appointments', 'bookings', 'countries', 'languages', 'currencies', 'business', 'bonus', 'referrals', 'gift_cards', 'reviews']::text[]);