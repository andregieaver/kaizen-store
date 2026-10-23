ALTER TABLE "commerce"."assistant_approvals" DROP CONSTRAINT "assistant_approvals_category";--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "domains_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "domain_buying" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_approvals" ADD CONSTRAINT "assistant_approvals_category" CHECK ("commerce"."assistant_approvals"."category" in ('send', 'public', 'spend', 'domain'));