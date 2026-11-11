ALTER TABLE "commerce"."page_roles" DROP CONSTRAINT "page_roles_role";--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "private_mode" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "private_password" text;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "private_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."page_roles" ADD CONSTRAINT "page_roles_role" CHECK ("commerce"."page_roles"."role" in ('blog', 'search', 'not_found', 'cart', 'checkout', 'order', 'account', 'sign_in', 'wishlist', 'subscription', 'deliveries', 'cookies', 'category', 'tag', 'private', 'terms', 'privacy', 'returns_policy', 'shipping_policy', 'withdrawal_info', 'imprint', 'accessibility'));