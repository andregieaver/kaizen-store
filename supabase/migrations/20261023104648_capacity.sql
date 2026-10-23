CREATE TABLE "commerce"."capacity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"expected" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "capacity_events_expected" CHECK ("commerce"."capacity_events"."expected" in ('busy', 'very_busy')),
	CONSTRAINT "capacity_events_span" CHECK ("commerce"."capacity_events"."ends_at" > "commerce"."capacity_events"."starts_at" and "commerce"."capacity_events"."ends_at" <= "commerce"."capacity_events"."starts_at" + interval '14 days'),
	CONSTRAINT "capacity_events_note" CHECK (length("commerce"."capacity_events"."note") <= 300)
);
--> statement-breakpoint
CREATE TABLE "commerce"."limit_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"account_id" uuid,
	"key" text NOT NULL,
	"value" bigint,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "limit_overrides_key" UNIQUE NULLS NOT DISTINCT("store_id","account_id","key"),
	CONSTRAINT "limit_overrides_target" CHECK (("commerce"."limit_overrides"."store_id" is null) <> ("commerce"."limit_overrides"."account_id" is null)),
	CONSTRAINT "limit_overrides_reason" CHECK (length(trim("commerce"."limit_overrides"."reason")) between 1 and 300),
	CONSTRAINT "limit_overrides_value" CHECK ("commerce"."limit_overrides"."value" is null or "commerce"."limit_overrides"."value" >= 0),
	CONSTRAINT "limit_overrides_known" CHECK ("commerce"."limit_overrides"."key" in ('storage_bytes', 'products', 'staff_seats', 'custom_domains', 'marketing_emails_month', 'ai_cost_month_micros', 'requests_month', 'egress_bytes_month', 'stores_owned'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."plan_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid,
	"key" text NOT NULL,
	"value" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "plan_limits_key" UNIQUE NULLS NOT DISTINCT("plan_id","key"),
	CONSTRAINT "plan_limits_value" CHECK ("commerce"."plan_limits"."value" is null or "commerce"."plan_limits"."value" >= 0),
	CONSTRAINT "plan_limits_known" CHECK ("commerce"."plan_limits"."key" in ('storage_bytes', 'products', 'staff_seats', 'custom_domains', 'marketing_emails_month', 'ai_cost_month_micros', 'requests_month', 'egress_bytes_month', 'stores_owned'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."store_usage_daily" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."store_usage_daily_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid,
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_usage_daily_key" UNIQUE NULLS NOT DISTINCT("store_id","day","metric"),
	CONSTRAINT "store_usage_daily_value" CHECK ("commerce"."store_usage_daily"."value" >= 0),
	CONSTRAINT "store_usage_daily_metric" CHECK ("commerce"."store_usage_daily"."metric" in ('storage_bytes', 'products', 'staff_seats', 'custom_domains', 'requests', 'egress_bytes', 'server_errors', 'emails', 'marketing_emails', 'ai_cost_micros'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."capacity_events" ADD CONSTRAINT "capacity_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."capacity_events" ADD CONSTRAINT "capacity_events_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."limit_overrides" ADD CONSTRAINT "limit_overrides_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."limit_overrides" ADD CONSTRAINT "limit_overrides_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."limit_overrides" ADD CONSTRAINT "limit_overrides_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."plan_limits" ADD CONSTRAINT "plan_limits_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "commerce"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."plan_limits" ADD CONSTRAINT "plan_limits_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_usage_daily" ADD CONSTRAINT "store_usage_daily_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capacity_events_store_idx" ON "commerce"."capacity_events" USING btree ("store_id","starts_at");--> statement-breakpoint
CREATE INDEX "capacity_events_starts_idx" ON "commerce"."capacity_events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "capacity_events_created_by_idx" ON "commerce"."capacity_events" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "limit_overrides_account_idx" ON "commerce"."limit_overrides" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "limit_overrides_created_by_idx" ON "commerce"."limit_overrides" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "plan_limits_updated_by_idx" ON "commerce"."plan_limits" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "store_usage_daily_day_idx" ON "commerce"."store_usage_daily" USING btree ("day");--> statement-breakpoint
-- Row-level security, no policy: the commerce schema is private to the server (docs/capacity.md, D314).
ALTER TABLE "commerce"."store_usage_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."plan_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."limit_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."capacity_events" ENABLE ROW LEVEL SECURITY;
