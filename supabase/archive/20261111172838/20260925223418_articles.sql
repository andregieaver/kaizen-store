ALTER TABLE "commerce"."page_redirects" DROP CONSTRAINT "page_redirects_store_slug_key";--> statement-breakpoint
ALTER TABLE "commerce"."pages" DROP CONSTRAINT "pages_store_slug_key";--> statement-breakpoint
ALTER TABLE "commerce"."pages" DROP CONSTRAINT "pages_slug_not_reserved";--> statement-breakpoint
ALTER TABLE "commerce"."pages" DROP CONSTRAINT "pages_store_slug_not_reserved";--> statement-breakpoint
ALTER TABLE "commerce"."page_redirects" ADD COLUMN "type" text DEFAULT 'page' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD COLUMN "type" text DEFAULT 'page' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD COLUMN "first_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."page_redirects" ADD CONSTRAINT "page_redirects_store_slug_key" UNIQUE NULLS NOT DISTINCT("store_id","type","slug");--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_store_slug_key" UNIQUE NULLS NOT DISTINCT("store_id","type","slug");--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_type" CHECK ("commerce"."pages"."type" in ('page', 'article'));--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_article_slug_not_reserved" CHECK ("commerce"."pages"."type" <> 'article' or "commerce"."pages"."slug" not in ('category', 'page', 'tag'));--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_slug_not_reserved" CHECK ("commerce"."pages"."store_id" is not null or "commerce"."pages"."type" <> 'page' or "commerce"."pages"."slug" not in ('account', 'admin', 'api', 'app', 'auth', 'blog', 'category', 'forgot-password', 'help', 'mail', 'platform', 'robots', 's', 'setup', 'sign-in', 'sign-up', 'sitemap', 'status', 'stores', 'support', 'tag', 'unsubscribe', 'www'));--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_store_slug_not_reserved" CHECK ("commerce"."pages"."store_id" is null or "commerce"."pages"."type" <> 'page' or "commerce"."pages"."slug" not in ('account', 'blog', 'cart', 'category', 'checkout', 'download', 'order', 'p', 'subscription', 'tag', 'unsubscribe', 'wishlist'));