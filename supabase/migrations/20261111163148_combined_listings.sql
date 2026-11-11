CREATE TABLE "commerce"."product_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"option" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_groups_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "product_groups_option" CHECK (jsonb_typeof("commerce"."product_groups"."option") = 'object' and length("commerce"."product_groups"."option"::text) <= 2000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "group_value" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "group_swatch" text;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "group_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."product_groups" ADD CONSTRAINT "product_groups_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_group_fk" FOREIGN KEY ("store_id","group_id") REFERENCES "commerce"."product_groups"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_group_idx" ON "commerce"."products" USING btree ("store_id","group_id");--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_group_value" CHECK (jsonb_typeof("commerce"."products"."group_value") = 'object' and length("commerce"."products"."group_value"::text) <= 1000);--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_group_swatch" CHECK ("commerce"."products"."group_swatch" is null or "commerce"."products"."group_swatch" ~ '^#[0-9a-f]{6}$');--> statement-breakpoint
ALTER TABLE "commerce"."product_groups" ENABLE ROW LEVEL SECURITY;

