CREATE TABLE "commerce"."shop_moves" (
	"store_id" uuid NOT NULL,
	"source" text NOT NULL,
	"shop_domain" text NOT NULL,
	"shop_name" text DEFAULT '' NOT NULL,
	"primary_domain" text,
	"status" text NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"access_token" text,
	"access_expires_at" timestamp with time zone,
	"refresh_token" text,
	"refresh_expires_at" timestamp with time zone,
	"connected_by" uuid,
	"connected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_moves_store_id_source_pk" PRIMARY KEY("store_id","source"),
	CONSTRAINT "shop_moves_source" CHECK ("commerce"."shop_moves"."source" in ('shopify')),
	CONSTRAINT "shop_moves_shop" CHECK ("commerce"."shop_moves"."shop_domain" ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' and length("commerce"."shop_moves"."shop_domain") <= 120),
	CONSTRAINT "shop_moves_status" CHECK ("commerce"."shop_moves"."status" in ('connected', 'disconnected')),
	CONSTRAINT "shop_moves_token" CHECK ("commerce"."shop_moves"."status" <> 'connected' or "commerce"."shop_moves"."access_token" is not null),
	CONSTRAINT "shop_moves_name" CHECK (length("commerce"."shop_moves"."shop_name") <= 200 and ("commerce"."shop_moves"."primary_domain" is null or length("commerce"."shop_moves"."primary_domain") <= 255))
);
--> statement-breakpoint
ALTER TABLE "commerce"."shop_moves" ADD CONSTRAINT "shop_moves_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shop_moves" ADD CONSTRAINT "shop_moves_connected_by_accounts_id_fk" FOREIGN KEY ("connected_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_moves_shop_idx" ON "commerce"."shop_moves" USING btree ("source","shop_domain");--> statement-breakpoint
CREATE INDEX "shop_moves_connected_by_idx" ON "commerce"."shop_moves" USING btree ("connected_by");--> statement-breakpoint
ALTER TABLE "commerce"."shop_moves" ENABLE ROW LEVEL SECURITY;