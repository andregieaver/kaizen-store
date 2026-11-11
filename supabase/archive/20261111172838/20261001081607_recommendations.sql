CREATE TABLE "commerce"."recommendation_adds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"session" text NOT NULL,
	"arm" text NOT NULL,
	"placement" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_adds_cart_product_key" UNIQUE("store_id","cart_id","product_id"),
	CONSTRAINT "recommendation_adds_arm" CHECK ("commerce"."recommendation_adds"."arm" in ('ai', 'baseline')),
	CONSTRAINT "recommendation_adds_placement" CHECK ("commerce"."recommendation_adds"."placement" in ('product', 'listing', 'article', 'page', 'other'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."recommendation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"session" text NOT NULL,
	"arm" text NOT NULL,
	"placement" text NOT NULL,
	"product_id" uuid NOT NULL,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_events_arm" CHECK ("commerce"."recommendation_events"."arm" in ('ai', 'baseline')),
	CONSTRAINT "recommendation_events_placement" CHECK ("commerce"."recommendation_events"."placement" in ('product', 'listing', 'article', 'page', 'other')),
	CONSTRAINT "recommendation_events_event" CHECK ("commerce"."recommendation_events"."event" in ('impression', 'click'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."recommendation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"product_id" uuid NOT NULL,
	"other_product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_rules_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "recommendation_rules_kind" CHECK ("commerce"."recommendation_rules"."kind" in ('goes_with', 'never_with', 'hide')),
	CONSTRAINT "recommendation_rules_other" CHECK (("commerce"."recommendation_rules"."kind" = 'hide') = ("commerce"."recommendation_rules"."other_product_id" is null)),
	CONSTRAINT "recommendation_rules_not_self" CHECK ("commerce"."recommendation_rules"."other_product_id" is null or "commerce"."recommendation_rules"."other_product_id" <> "commerce"."recommendation_rules"."product_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."recommendation_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"ai" boolean DEFAULT true NOT NULL,
	"holdout_percent" integer DEFAULT 10 NOT NULL,
	"upsell_ceiling_percent" integer DEFAULT 50 NOT NULL,
	"monthly_token_cap" bigint DEFAULT 1000000,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "recommendation_settings_holdout" CHECK ("commerce"."recommendation_settings"."holdout_percent" between 0 and 50),
	CONSTRAINT "recommendation_settings_ceiling" CHECK ("commerce"."recommendation_settings"."upsell_ceiling_percent" between 0 and 500),
	CONSTRAINT "recommendation_settings_cap" CHECK ("commerce"."recommendation_settings"."monthly_token_cap" is null or "commerce"."recommendation_settings"."monthly_token_cap" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."search_cache" DROP CONSTRAINT "search_cache_kind";--> statement-breakpoint
ALTER TABLE "commerce"."recommendation_adds" ADD CONSTRAINT "recommendation_adds_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."recommendation_events" ADD CONSTRAINT "recommendation_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."recommendation_rules" ADD CONSTRAINT "recommendation_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."recommendation_rules" ADD CONSTRAINT "recommendation_rules_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."recommendation_rules" ADD CONSTRAINT "recommendation_rules_other_fk" FOREIGN KEY ("store_id","other_product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."recommendation_settings" ADD CONSTRAINT "recommendation_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."recommendation_settings" ADD CONSTRAINT "recommendation_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recommendation_adds_store_idx" ON "commerce"."recommendation_adds" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "recommendation_adds_created_idx" ON "commerce"."recommendation_adds" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "recommendation_events_store_idx" ON "commerce"."recommendation_events" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "recommendation_events_created_idx" ON "commerce"."recommendation_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_rules_pair_key" ON "commerce"."recommendation_rules" USING btree ("store_id","kind","product_id","other_product_id") WHERE "commerce"."recommendation_rules"."other_product_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_rules_hide_key" ON "commerce"."recommendation_rules" USING btree ("store_id","product_id") WHERE "commerce"."recommendation_rules"."kind" = 'hide';--> statement-breakpoint
CREATE INDEX "recommendation_rules_product_idx" ON "commerce"."recommendation_rules" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "recommendation_settings_updated_by_idx" ON "commerce"."recommendation_settings" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."search_cache" ADD CONSTRAINT "search_cache_kind" CHECK ("commerce"."search_cache"."kind" in ('vector', 'filters', 'rerank'));