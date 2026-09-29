ALTER TABLE "commerce"."campaigns" ADD COLUMN "tier_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD COLUMN "usage_limit" integer;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD COLUMN "stacks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "campaign_parts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD CONSTRAINT "campaigns_usage_limit" CHECK ("commerce"."campaigns"."usage_limit" is null or "commerce"."campaigns"."usage_limit" > 0);--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD CONSTRAINT "campaigns_stacks" CHECK (not "commerce"."campaigns"."stacks" or "commerce"."campaigns"."kind" = 'percent');
--> statement-breakpoint
-- Lines that got a campaign before the parts were kept: one part each.
UPDATE commerce.order_lines ol SET campaign_parts = jsonb_build_array(jsonb_build_object('id', ol.campaign_id, 'name', coalesce((SELECT o.campaign_label FROM commerce.orders o WHERE o.store_id = ol.store_id AND o.id = ol.order_id), ''), 'minor', ol.campaign_discount_minor)) WHERE ol.campaign_id IS NOT NULL;
