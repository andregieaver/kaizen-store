CREATE TABLE "commerce"."bonus_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"names" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_minor" bigint NOT NULL,
	"kind" text NOT NULL,
	"product_id" uuid,
	"discount_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "bonus_rewards_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "bonus_rewards_kind" CHECK ("commerce"."bonus_rewards"."kind" in ('free_shipping', 'product', 'amount')),
	CONSTRAINT "bonus_rewards_product" CHECK (("commerce"."bonus_rewards"."kind" = 'product') = ("commerce"."bonus_rewards"."product_id" is not null)),
	CONSTRAINT "bonus_rewards_cost" CHECK ("commerce"."bonus_rewards"."cost_minor" between 1 and 100000000),
	CONSTRAINT "bonus_rewards_name" CHECK (length("commerce"."bonus_rewards"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "commerce"."bonus_settings" ADD COLUMN "birthday_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD COLUMN "birthday" text;--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD COLUMN "birthday_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."discount_code_items" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."discount_code_items" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD COLUMN "reward" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD COLUMN "max_units" integer;--> statement-breakpoint
ALTER TABLE "commerce"."bonus_rewards" ADD CONSTRAINT "bonus_rewards_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bonus_rewards" ADD CONSTRAINT "bonus_rewards_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bonus_rewards" ADD CONSTRAINT "bonus_rewards_discount_fk" FOREIGN KEY ("store_id","discount_id") REFERENCES "commerce"."discount_codes"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bonus_rewards" ADD CONSTRAINT "bonus_rewards_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_rewards_discount_key" ON "commerce"."bonus_rewards" USING btree ("discount_id");--> statement-breakpoint
CREATE INDEX "bonus_rewards_product_idx" ON "commerce"."bonus_rewards" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "bonus_rewards_updated_by_idx" ON "commerce"."bonus_rewards" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."discount_code_items" ADD CONSTRAINT "discount_code_items_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "commerce"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discount_code_items_customer_idx" ON "commerce"."discount_code_items" USING btree ("customer_id");--> statement-breakpoint
ALTER TABLE "commerce"."bonus_settings" ADD CONSTRAINT "bonus_settings_birthday" CHECK ("commerce"."bonus_settings"."birthday_minor" between 0 and 1000000);--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD CONSTRAINT "customers_birthday" CHECK ("commerce"."customers"."birthday" is null or "commerce"."customers"."birthday" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD CONSTRAINT "discount_codes_max_units" CHECK ("commerce"."discount_codes"."max_units" is null or ("commerce"."discount_codes"."max_units" between 1 and 100 and "commerce"."discount_codes"."reward"));