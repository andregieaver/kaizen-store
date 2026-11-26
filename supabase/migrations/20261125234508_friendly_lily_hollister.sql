CREATE TABLE "commerce"."platform_rival_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"plan" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"interval" text NOT NULL,
	"fee_bps" integer,
	"plan_id" uuid,
	"source" text NOT NULL,
	"checked_on" date DEFAULT now() NOT NULL,
	"on_page" boolean,
	"gone_at" timestamp with time zone,
	"watched_at" timestamp with time zone,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_rival_prices_key" UNIQUE("platform","plan","currency","interval"),
	CONSTRAINT "platform_rival_prices_names" CHECK (length("commerce"."platform_rival_prices"."platform") between 1 and 80 and length("commerce"."platform_rival_prices"."plan") between 1 and 80),
	CONSTRAINT "platform_rival_prices_currency" CHECK ("commerce"."platform_rival_prices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "platform_rival_prices_interval" CHECK ("commerce"."platform_rival_prices"."interval" in ('month', 'year')),
	CONSTRAINT "platform_rival_prices_amount" CHECK ("commerce"."platform_rival_prices"."price_minor" >= 0),
	CONSTRAINT "platform_rival_prices_fee" CHECK ("commerce"."platform_rival_prices"."fee_bps" is null or "commerce"."platform_rival_prices"."fee_bps" between 0 and 10000),
	CONSTRAINT "platform_rival_prices_source" CHECK ("commerce"."platform_rival_prices"."source" ~ '^https://' and length("commerce"."platform_rival_prices"."source") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_rival_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."platform_rival_prices" ADD CONSTRAINT "platform_rival_prices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "commerce"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_rival_prices" ADD CONSTRAINT "platform_rival_prices_added_by_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_rival_prices_plan_idx" ON "commerce"."platform_rival_prices" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "platform_rival_prices_added_by_idx" ON "commerce"."platform_rival_prices" USING btree ("added_by");