CREATE TABLE "commerce"."campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"percent" integer DEFAULT 0 NOT NULL,
	"buy_quantity" integer DEFAULT 0 NOT NULL,
	"pay_quantity" integer DEFAULT 0 NOT NULL,
	"gift_variant_id" uuid,
	"gift_quantity" integer DEFAULT 1 NOT NULL,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"term_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "campaigns_kind" CHECK ("commerce"."campaigns"."kind" in ('percent', 'multi_buy', 'gift')),
	CONSTRAINT "campaigns_percent" CHECK (("commerce"."campaigns"."kind" = 'percent' and "commerce"."campaigns"."percent" between 1 and 100) or ("commerce"."campaigns"."kind" <> 'percent' and "commerce"."campaigns"."percent" = 0)),
	CONSTRAINT "campaigns_multi_buy" CHECK (("commerce"."campaigns"."kind" = 'multi_buy' and "commerce"."campaigns"."buy_quantity" between 2 and 20 and "commerce"."campaigns"."pay_quantity" between 1 and "commerce"."campaigns"."buy_quantity" - 1) or ("commerce"."campaigns"."kind" <> 'multi_buy' and "commerce"."campaigns"."buy_quantity" = 0 and "commerce"."campaigns"."pay_quantity" = 0)),
	CONSTRAINT "campaigns_gift" CHECK (("commerce"."campaigns"."kind" = 'gift' and "commerce"."campaigns"."gift_variant_id" is not null and "commerce"."campaigns"."gift_quantity" between 1 and 5) or ("commerce"."campaigns"."kind" <> 'gift' and "commerce"."campaigns"."gift_variant_id" is null)),
	CONSTRAINT "campaigns_dates" CHECK ("commerce"."campaigns"."starts_at" is null or "commerce"."campaigns"."ends_at" is null or "commerce"."campaigns"."starts_at" < "commerce"."campaigns"."ends_at")
);
--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "campaign_discount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "gift" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "campaign_discount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "campaign_label" text;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD CONSTRAINT "campaigns_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD CONSTRAINT "campaigns_gift_variant_fk" FOREIGN KEY ("store_id","gift_variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_store_idx" ON "commerce"."campaigns" USING btree ("store_id","active");--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_campaign_discount" CHECK ("commerce"."order_lines"."campaign_discount_minor" between 0 and "commerce"."order_lines"."discount_minor");--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_campaign_discount" CHECK ("commerce"."orders"."campaign_discount_minor" between 0 and "commerce"."orders"."discount_minor");
--> statement-breakpoint
-- Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.campaigns ENABLE ROW LEVEL SECURITY;
