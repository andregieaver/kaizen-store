ALTER TABLE "commerce"."products" ADD COLUMN "standard_category" text;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "standard_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "products_standard_category_idx" ON "commerce"."products" USING btree ("store_id","standard_category");--> statement-breakpoint
CREATE INDEX "products_standard_attributes_idx" ON "commerce"."products" USING gin ("standard_attributes" jsonb_path_ops);--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_standard_category" CHECK ("commerce"."products"."standard_category" ~ '^[a-z]{2}(-[0-9]+)*$');--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_standard_attributes" CHECK (jsonb_typeof("commerce"."products"."standard_attributes") = 'object' and ("commerce"."products"."standard_category" is not null or "commerce"."products"."standard_attributes" = '{}'::jsonb));