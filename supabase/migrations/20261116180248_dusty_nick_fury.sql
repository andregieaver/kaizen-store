CREATE TABLE "commerce"."customer_product_views" (
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_product_views_store_id_customer_id_product_id_pk" PRIMARY KEY("store_id","customer_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."automation_sends" DROP CONSTRAINT "automation_sends_kind";--> statement-breakpoint
ALTER TABLE "commerce"."automation_steps" DROP CONSTRAINT "automation_steps_kind";--> statement-breakpoint
ALTER TABLE "commerce"."automations" DROP CONSTRAINT "automations_kind";--> statement-breakpoint
ALTER TABLE "commerce"."automations" DROP CONSTRAINT "automations_delay";--> statement-breakpoint
ALTER TABLE "commerce"."customer_product_views" ADD CONSTRAINT "customer_product_views_customer_fk" FOREIGN KEY ("customer_id") REFERENCES "commerce"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."customer_product_views" ADD CONSTRAINT "customer_product_views_product_fk" FOREIGN KEY ("product_id") REFERENCES "commerce"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_product_views_viewed_idx" ON "commerce"."customer_product_views" USING btree ("store_id","viewed_at");--> statement-breakpoint
CREATE INDEX "customer_product_views_product_idx" ON "commerce"."customer_product_views" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "commerce"."automation_sends" ADD CONSTRAINT "automation_sends_kind" CHECK ("commerce"."automation_sends"."kind" in ('welcome', 'after_purchase', 'win_back', 'cross_sell', 'replenish', 'browse'));--> statement-breakpoint
ALTER TABLE "commerce"."automation_steps" ADD CONSTRAINT "automation_steps_kind" CHECK ("commerce"."automation_steps"."kind" in ('welcome', 'after_purchase', 'win_back', 'cross_sell', 'replenish', 'browse'));--> statement-breakpoint
ALTER TABLE "commerce"."automations" ADD CONSTRAINT "automations_kind" CHECK ("commerce"."automations"."kind" in ('welcome', 'after_purchase', 'win_back', 'cross_sell', 'replenish', 'browse', 'back_in_stock'));--> statement-breakpoint
ALTER TABLE "commerce"."automations" ADD CONSTRAINT "automations_delay" CHECK (case "commerce"."automations"."kind" when 'welcome' then "commerce"."automations"."delay_days" between 0 and 30 when 'after_purchase' then "commerce"."automations"."delay_days" between 1 and 90 when 'win_back' then "commerce"."automations"."delay_days" between 30 and 730 when 'cross_sell' then "commerce"."automations"."delay_days" between 1 and 90 when 'replenish' then "commerce"."automations"."delay_days" between 7 and 365 when 'browse' then "commerce"."automations"."delay_days" between 1 and 5 else "commerce"."automations"."delay_days" is null end);--> statement-breakpoint
ALTER TABLE "commerce"."customer_product_views" ENABLE ROW LEVEL SECURITY;