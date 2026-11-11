CREATE TABLE "commerce"."menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"name" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "menus_store_name_key" UNIQUE NULLS NOT DISTINCT("store_id","name"),
	CONSTRAINT "menus_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "menus_name" CHECK (length(trim("commerce"."menus"."name")) between 1 and 80),
	CONSTRAINT "menus_items" CHECK (jsonb_typeof("commerce"."menus"."items") = 'array')
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "header_menu_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "footer_menu_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "header_menu_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "footer_menu_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."menus" ADD CONSTRAINT "menus_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."menus" ADD CONSTRAINT "menus_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."menus" ADD CONSTRAINT "menus_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menus_created_by_idx" ON "commerce"."menus" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "menus_updated_by_idx" ON "commerce"."menus" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "platform_settings_header_menu_idx" ON "commerce"."platform_settings" USING btree ("header_menu_id");--> statement-breakpoint
CREATE INDEX "platform_settings_footer_menu_idx" ON "commerce"."platform_settings" USING btree ("footer_menu_id");--> statement-breakpoint
CREATE INDEX "stores_header_menu_idx" ON "commerce"."stores" USING btree ("id","header_menu_id");--> statement-breakpoint
CREATE INDEX "stores_footer_menu_idx" ON "commerce"."stores" USING btree ("id","footer_menu_id");