ALTER TABLE "commerce"."supplier_orders" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD COLUMN "api_key_hash" text;--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD COLUMN "api_key_hint" text;--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD COLUMN "always_available" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_api_key_key" ON "commerce"."suppliers" USING btree ("api_key_hash") WHERE "commerce"."suppliers"."api_key_hash" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD CONSTRAINT "suppliers_api_key" CHECK (("commerce"."suppliers"."api_key_hash" is null) = ("commerce"."suppliers"."api_key_hint" is null) and ("commerce"."suppliers"."api_key_hash" is null or "commerce"."suppliers"."api_key_hash" ~ '^[0-9a-f]{64}$'));