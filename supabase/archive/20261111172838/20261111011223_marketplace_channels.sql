CREATE TABLE "commerce"."marketplace_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"state" text DEFAULT 'connected' NOT NULL,
	"access_token_encrypted" text,
	"access_expires_at" timestamp with time zone,
	"refresh_token_encrypted" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"orders_since" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_connections_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "marketplace_connections_channel" CHECK ("commerce"."marketplace_connections"."channel" in ('ebay')),
	CONSTRAINT "marketplace_connections_state" CHECK ("commerce"."marketplace_connections"."state" in ('connected', 'refused', 'off')),
	CONSTRAINT "marketplace_connections_error" CHECK ("commerce"."marketplace_connections"."last_error" is null or length("commerce"."marketplace_connections"."last_error") <= 500)
);
--> statement-breakpoint
CREATE TABLE "commerce"."marketplace_listings" (
	"store_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"offer_id" text,
	"listing_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"price_minor" bigint,
	"currency" char(3),
	"quantity" integer,
	"error" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_listings_connection_id_variant_id_pk" PRIMARY KEY("connection_id","variant_id"),
	CONSTRAINT "marketplace_listings_state" CHECK ("commerce"."marketplace_listings"."state" in ('pending', 'listed', 'error', 'ended')),
	CONSTRAINT "marketplace_listings_error" CHECK ("commerce"."marketplace_listings"."error" is null or length("commerce"."marketplace_listings"."error") <= 500)
);
--> statement-breakpoint
CREATE TABLE "commerce"."marketplace_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"total_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"buyer_name" text DEFAULT '' NOT NULL,
	"buyer_email" text,
	"ship_to" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"stock_drawn" boolean DEFAULT false NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_orders_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "marketplace_orders_state" CHECK ("commerce"."marketplace_orders"."state" in ('open', 'sent', 'cancelled')),
	CONSTRAINT "marketplace_orders_currency" CHECK ("commerce"."marketplace_orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "marketplace_orders_texts" CHECK (length("commerce"."marketplace_orders"."external_id") between 1 and 100 and length("commerce"."marketplace_orders"."buyer_name") <= 200 and coalesce(length("commerce"."marketplace_orders"."error") <= 500, true))
);
--> statement-breakpoint
ALTER TABLE "commerce"."marketplace_connections" ADD CONSTRAINT "marketplace_connections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."marketplace_connections" ADD CONSTRAINT "marketplace_connections_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."marketplace_listings" ADD CONSTRAINT "marketplace_listings_connection_fk" FOREIGN KEY ("store_id","connection_id") REFERENCES "commerce"."marketplace_connections"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."marketplace_listings" ADD CONSTRAINT "marketplace_listings_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."marketplace_orders" ADD CONSTRAINT "marketplace_orders_connection_fk" FOREIGN KEY ("store_id","connection_id") REFERENCES "commerce"."marketplace_connections"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_connections_channel_key" ON "commerce"."marketplace_connections" USING btree ("store_id","channel");--> statement-breakpoint
CREATE INDEX "marketplace_connections_updated_by_idx" ON "commerce"."marketplace_connections" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "marketplace_listings_variant_idx" ON "commerce"."marketplace_listings" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "marketplace_listings_connection_idx" ON "commerce"."marketplace_listings" USING btree ("store_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_orders_external_key" ON "commerce"."marketplace_orders" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "marketplace_orders_store_idx" ON "commerce"."marketplace_orders" USING btree ("store_id","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "marketplace_orders_connection_idx" ON "commerce"."marketplace_orders" USING btree ("store_id","connection_id");
--> statement-breakpoint
ALTER TABLE "commerce"."marketplace_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."marketplace_listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."marketplace_orders" ENABLE ROW LEVEL SECURITY;
