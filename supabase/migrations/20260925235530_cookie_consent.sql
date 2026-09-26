CREATE TABLE "commerce"."consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"visitor" uuid NOT NULL,
	"choices" jsonb NOT NULL,
	"version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_version_length" CHECK (length("commerce"."consents"."version") <= 100)
);
--> statement-breakpoint
ALTER TABLE "commerce"."pages" DROP CONSTRAINT "pages_slug_not_reserved";--> statement-breakpoint
ALTER TABLE "commerce"."pages" DROP CONSTRAINT "pages_store_slug_not_reserved";--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "tracking" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "tracking" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."consents" ADD CONSTRAINT "consents_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_store_created_idx" ON "commerce"."consents" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "consents_visitor_idx" ON "commerce"."consents" USING btree ("visitor");--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_slug_not_reserved" CHECK ("commerce"."pages"."store_id" is not null or "commerce"."pages"."type" <> 'page' or "commerce"."pages"."slug" not in ('account', 'admin', 'api', 'app', 'auth', 'blog', 'category', 'cookies', 'forgot-password', 'help', 'mail', 'platform', 'robots', 's', 'setup', 'sign-in', 'sign-up', 'sitemap', 'status', 'stores', 'support', 'tag', 'unsubscribe', 'www'));--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_store_slug_not_reserved" CHECK ("commerce"."pages"."store_id" is null or "commerce"."pages"."type" <> 'page' or "commerce"."pages"."slug" not in ('account', 'blog', 'cart', 'category', 'checkout', 'cookies', 'download', 'order', 'p', 'subscription', 'tag', 'unsubscribe', 'wishlist'));