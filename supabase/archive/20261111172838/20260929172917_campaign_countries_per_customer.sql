ALTER TABLE "commerce"."campaigns" DROP CONSTRAINT "campaigns_stacks";--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD COLUMN "per_customer_limit" integer;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD COLUMN "markets" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD CONSTRAINT "campaigns_per_customer_limit" CHECK ("commerce"."campaigns"."per_customer_limit" is null or "commerce"."campaigns"."per_customer_limit" > 0);--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD CONSTRAINT "campaigns_stacks" CHECK (not "commerce"."campaigns"."stacks" or "commerce"."campaigns"."kind" in ('percent', 'multi_buy'));