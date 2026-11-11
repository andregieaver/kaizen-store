CREATE TABLE "commerce"."automation_sends" (
	"store_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"order_id" uuid,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_sends_store_id_key_pk" PRIMARY KEY("store_id","key"),
	CONSTRAINT "automation_sends_kind" CHECK ("commerce"."automation_sends"."kind" in ('welcome', 'after_purchase', 'win_back')),
	CONSTRAINT "automation_sends_outcome" CHECK ("commerce"."automation_sends"."outcome" is null or "commerce"."automation_sends"."outcome" in ('sent', 'logged', 'failed', 'suppressed'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."automations" (
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"enabled_at" timestamp with time zone,
	"delay_days" integer,
	"content" jsonb,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automations_store_id_kind_pk" PRIMARY KEY("store_id","kind"),
	CONSTRAINT "automations_kind" CHECK ("commerce"."automations"."kind" in ('welcome', 'after_purchase', 'win_back', 'back_in_stock')),
	CONSTRAINT "automations_enabled_at" CHECK (not "commerce"."automations"."enabled" or "commerce"."automations"."enabled_at" is not null),
	CONSTRAINT "automations_content" CHECK (("commerce"."automations"."kind" = 'back_in_stock') = ("commerce"."automations"."content" is null)),
	CONSTRAINT "automations_delay" CHECK (case "commerce"."automations"."kind" when 'welcome' then "commerce"."automations"."delay_days" between 0 and 30 when 'after_purchase' then "commerce"."automations"."delay_days" between 1 and 90 when 'win_back' then "commerce"."automations"."delay_days" between 30 and 730 else "commerce"."automations"."delay_days" is null end)
);
--> statement-breakpoint
CREATE TABLE "commerce"."stock_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"email" text NOT NULL,
	"customer_id" uuid,
	"locale" text NOT NULL,
	"market_code" text,
	"status" text NOT NULL,
	"confirm_hash" text,
	"confirm_until" timestamp with time zone,
	"confirm_sent_at" timestamp with time zone,
	"visitor" text,
	"confirmed_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_requests_status" CHECK ("commerce"."stock_requests"."status" in ('pending', 'waiting', 'sent', 'cancelled')),
	CONSTRAINT "stock_requests_email" CHECK ("commerce"."stock_requests"."email" = lower("commerce"."stock_requests"."email"))
);
--> statement-breakpoint
ALTER TABLE "commerce"."automation_sends" ADD CONSTRAINT "automation_sends_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."automation_sends" ADD CONSTRAINT "automation_sends_subscriber_fk" FOREIGN KEY ("store_id","subscriber_id") REFERENCES "commerce"."marketing_subscribers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."automation_sends" ADD CONSTRAINT "automation_sends_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."automations" ADD CONSTRAINT "automations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."automations" ADD CONSTRAINT "automations_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stock_requests" ADD CONSTRAINT "stock_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stock_requests" ADD CONSTRAINT "stock_requests_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stock_requests" ADD CONSTRAINT "stock_requests_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stock_requests" ADD CONSTRAINT "stock_requests_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_sends_report_idx" ON "commerce"."automation_sends" USING btree ("store_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "automation_sends_subscriber_idx" ON "commerce"."automation_sends" USING btree ("store_id","subscriber_id");--> statement-breakpoint
CREATE INDEX "automation_sends_order_idx" ON "commerce"."automation_sends" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_requests_open_idx" ON "commerce"."stock_requests" USING btree ("store_id","variant_id","email") WHERE "commerce"."stock_requests"."status" in ('pending', 'waiting');--> statement-breakpoint
CREATE UNIQUE INDEX "stock_requests_confirm_idx" ON "commerce"."stock_requests" USING btree ("confirm_hash");--> statement-breakpoint
CREATE INDEX "stock_requests_waiting_idx" ON "commerce"."stock_requests" USING btree ("store_id","variant_id") WHERE "commerce"."stock_requests"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "stock_requests_email_idx" ON "commerce"."stock_requests" USING btree ("store_id","email");--> statement-breakpoint
CREATE INDEX "stock_requests_customer_idx" ON "commerce"."stock_requests" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "stock_requests_product_idx" ON "commerce"."stock_requests" USING btree ("store_id","product_id");