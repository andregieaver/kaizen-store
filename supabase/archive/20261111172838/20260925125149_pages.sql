CREATE TABLE "commerce"."page_redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"slug" text NOT NULL,
	"page_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_redirects_store_slug_key" UNIQUE NULLS NOT DISTINCT("store_id","slug")
);
--> statement-breakpoint
CREATE TABLE "commerce"."pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"slug" text NOT NULL,
	"draft" jsonb NOT NULL,
	"published" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "pages_store_slug_key" UNIQUE NULLS NOT DISTINCT("store_id","slug"),
	CONSTRAINT "pages_slug_format" CHECK ("commerce"."pages"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length("commerce"."pages"."slug") <= 80),
	CONSTRAINT "pages_slug_not_reserved" CHECK ("commerce"."pages"."store_id" is not null or "commerce"."pages"."slug" not in ('account', 'admin', 'api', 'app', 'auth', 'forgot-password', 'help', 'mail', 'platform', 'robots', 's', 'setup', 'sign-in', 'sign-up', 'sitemap', 'status', 'stores', 'support', 'unsubscribe', 'www')),
	CONSTRAINT "pages_published_together" CHECK (("commerce"."pages"."published" is null) = ("commerce"."pages"."published_at" is null))
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "navigation" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "business" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."page_redirects" ADD CONSTRAINT "page_redirects_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_redirects" ADD CONSTRAINT "page_redirects_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "commerce"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_redirects_page_idx" ON "commerce"."page_redirects" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "pages_created_by_idx" ON "commerce"."pages" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "pages_updated_by_idx" ON "commerce"."pages" USING btree ("updated_by");