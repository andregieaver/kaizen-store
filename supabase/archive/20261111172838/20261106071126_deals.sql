CREATE TABLE "commerce"."deal_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid,
	"draft_id" uuid,
	"assignment_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_links_kind" CHECK ("commerce"."deal_links"."kind" in ('order', 'draft', 'work_assignment')),
	CONSTRAINT "deal_links_one" CHECK (("commerce"."deal_links"."kind" = 'order' and "commerce"."deal_links"."order_id" is not null and "commerce"."deal_links"."draft_id" is null and "commerce"."deal_links"."assignment_id" is null)
        or ("commerce"."deal_links"."kind" = 'draft' and "commerce"."deal_links"."draft_id" is not null and "commerce"."deal_links"."order_id" is null and "commerce"."deal_links"."assignment_id" is null)
        or ("commerce"."deal_links"."kind" = 'work_assignment' and "commerce"."deal_links"."assignment_id" is not null and "commerce"."deal_links"."order_id" is null and "commerce"."deal_links"."draft_id" is null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."deal_moves" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."deal_moves_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"stage_id" uuid,
	"status" text NOT NULL,
	"via" text,
	"moved_by" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_moves_status" CHECK ("commerce"."deal_moves"."status" in ('open', 'won', 'lost'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."deal_pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_pipelines_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "deal_pipelines_name" CHECK ("commerce"."deal_pipelines"."name" = btrim("commerce"."deal_pipelines"."name") and char_length("commerce"."deal_pipelines"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "commerce"."deal_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"probability" integer,
	"quote_stage" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_stages_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "deal_stages_pipeline_key" UNIQUE("store_id","pipeline_id","id"),
	CONSTRAINT "deal_stages_name" CHECK ("commerce"."deal_stages"."name" = btrim("commerce"."deal_stages"."name") and char_length("commerce"."deal_stages"."name") between 1 and 60),
	CONSTRAINT "deal_stages_probability" CHECK ("commerce"."deal_stages"."probability" is null or "commerce"."deal_stages"."probability" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "commerce"."deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"customer_id" uuid,
	"company_id" uuid,
	"owner_id" uuid,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"estimate_minor" bigint,
	"currency" char(3) NOT NULL,
	"expected_close_on" date,
	"closed_at" timestamp with time zone,
	"closed_via" text,
	"close_reason" text,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "deals_title" CHECK ("commerce"."deals"."title" = btrim("commerce"."deals"."title") and char_length("commerce"."deals"."title") between 1 and 200),
	CONSTRAINT "deals_status" CHECK ("commerce"."deals"."status" in ('open', 'won', 'lost')),
	CONSTRAINT "deals_closed" CHECK (("commerce"."deals"."status" = 'open') = ("commerce"."deals"."closed_at" is null) and ("commerce"."deals"."closed_at" is null) = ("commerce"."deals"."closed_via" is null)),
	CONSTRAINT "deals_closed_via" CHECK ("commerce"."deals"."closed_via" is null or "commerce"."deals"."closed_via" in ('person', 'order', 'work_invoice')),
	CONSTRAINT "deals_reason" CHECK ("commerce"."deals"."close_reason" is null or ("commerce"."deals"."status" <> 'open' and char_length("commerce"."deals"."close_reason") between 1 and 200)),
	CONSTRAINT "deals_estimate" CHECK ("commerce"."deals"."estimate_minor" is null or "commerce"."deals"."estimate_minor" between 0 and 1000000000000),
	CONSTRAINT "deals_currency" CHECK ("commerce"."deals"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."field_values" DROP CONSTRAINT "field_values_entity";--> statement-breakpoint
ALTER TABLE "commerce"."stores" DROP CONSTRAINT "stores_features";--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "sales_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "sales_pilot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."deal_links" ADD CONSTRAINT "deal_links_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deal_links" ADD CONSTRAINT "deal_links_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deal_links" ADD CONSTRAINT "deal_links_deal_fk" FOREIGN KEY ("store_id","deal_id") REFERENCES "commerce"."deals"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deal_links" ADD CONSTRAINT "deal_links_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deal_links" ADD CONSTRAINT "deal_links_draft_fk" FOREIGN KEY ("store_id","draft_id") REFERENCES "commerce"."draft_orders"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deal_links" ADD CONSTRAINT "deal_links_assignment_fk" FOREIGN KEY ("store_id","assignment_id") REFERENCES "commerce"."work_assignments"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deal_moves" ADD CONSTRAINT "deal_moves_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deal_moves" ADD CONSTRAINT "deal_moves_moved_by_accounts_id_fk" FOREIGN KEY ("moved_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deal_moves" ADD CONSTRAINT "deal_moves_deal_fk" FOREIGN KEY ("store_id","deal_id") REFERENCES "commerce"."deals"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deal_pipelines" ADD CONSTRAINT "deal_pipelines_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deal_stages" ADD CONSTRAINT "deal_stages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deal_stages" ADD CONSTRAINT "deal_stages_pipeline_fk" FOREIGN KEY ("store_id","pipeline_id") REFERENCES "commerce"."deal_pipelines"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deals" ADD CONSTRAINT "deals_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deals" ADD CONSTRAINT "deals_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deals" ADD CONSTRAINT "deals_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deals" ADD CONSTRAINT "deals_stage_fk" FOREIGN KEY ("store_id","pipeline_id","stage_id") REFERENCES "commerce"."deal_stages"("store_id","pipeline_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deals" ADD CONSTRAINT "deals_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."deals" ADD CONSTRAINT "deals_company_fk" FOREIGN KEY ("store_id","company_id") REFERENCES "commerce"."customer_companies"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deal_links_order_key" ON "commerce"."deal_links" USING btree ("store_id","order_id") WHERE "commerce"."deal_links"."order_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "deal_links_draft_key" ON "commerce"."deal_links" USING btree ("store_id","draft_id") WHERE "commerce"."deal_links"."draft_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "deal_links_assignment_key" ON "commerce"."deal_links" USING btree ("store_id","assignment_id") WHERE "commerce"."deal_links"."assignment_id" is not null;--> statement-breakpoint
CREATE INDEX "deal_links_deal_idx" ON "commerce"."deal_links" USING btree ("store_id","deal_id");--> statement-breakpoint
CREATE INDEX "deal_links_created_by_idx" ON "commerce"."deal_links" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "deal_moves_deal_idx" ON "commerce"."deal_moves" USING btree ("store_id","deal_id","at");--> statement-breakpoint
CREATE INDEX "deal_moves_moved_by_idx" ON "commerce"."deal_moves" USING btree ("moved_by");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_pipelines_name_key" ON "commerce"."deal_pipelines" USING btree ("store_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "deal_stages_quote_key" ON "commerce"."deal_stages" USING btree ("store_id","pipeline_id") WHERE "commerce"."deal_stages"."quote_stage";--> statement-breakpoint
CREATE INDEX "deal_stages_order_idx" ON "commerce"."deal_stages" USING btree ("store_id","pipeline_id","position");--> statement-breakpoint
CREATE INDEX "deals_board_idx" ON "commerce"."deals" USING btree ("store_id","pipeline_id","status","stage_id");--> statement-breakpoint
CREATE INDEX "deals_stage_idx" ON "commerce"."deals" USING btree ("store_id","pipeline_id","stage_id");--> statement-breakpoint
CREATE INDEX "deals_customer_idx" ON "commerce"."deals" USING btree ("store_id","customer_id") WHERE "commerce"."deals"."customer_id" is not null;--> statement-breakpoint
CREATE INDEX "deals_company_idx" ON "commerce"."deals" USING btree ("store_id","company_id") WHERE "commerce"."deals"."company_id" is not null;--> statement-breakpoint
CREATE INDEX "deals_closing_idx" ON "commerce"."deals" USING btree ("store_id","status","expected_close_on");--> statement-breakpoint
CREATE INDEX "deals_owner_idx" ON "commerce"."deals" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "deals_created_by_idx" ON "commerce"."deals" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "commerce"."field_values" ADD CONSTRAINT "field_values_entity" CHECK ("commerce"."field_values"."entity" in ('product', 'page', 'article', 'variant', 'term', 'store', 'customer', 'order', 'deal'));--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_features" CHECK ("commerce"."stores"."features" <@ array['shop', 'subscriptions', 'boxes', 'appointments', 'bookings', 'countries', 'languages', 'currencies', 'business', 'bonus', 'referrals', 'gift_cards', 'reviews', 'sales']::text[]);