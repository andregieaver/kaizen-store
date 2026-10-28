CREATE TABLE "commerce"."site_staging_pages" (
	"staging_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	CONSTRAINT "site_staging_pages_staging_id_page_id_pk" PRIMARY KEY("staging_id","page_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."site_stagings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"install_id" uuid,
	"menus" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcome" jsonb,
	"created_by" uuid,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "site_stagings_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "site_stagings_name" CHECK (char_length("commerce"."site_stagings"."name") between 1 and 80),
	CONSTRAINT "site_stagings_status" CHECK ("commerce"."site_stagings"."status" in ('open', 'published', 'discarded'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."site_staging_pages" ADD CONSTRAINT "site_staging_pages_staging_id_site_stagings_id_fk" FOREIGN KEY ("staging_id") REFERENCES "commerce"."site_stagings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."site_staging_pages" ADD CONSTRAINT "site_staging_pages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."site_staging_pages" ADD CONSTRAINT "site_staging_pages_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "commerce"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."site_stagings" ADD CONSTRAINT "site_stagings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."site_stagings" ADD CONSTRAINT "site_stagings_install_id_store_theme_installs_id_fk" FOREIGN KEY ("install_id") REFERENCES "commerce"."store_theme_installs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."site_stagings" ADD CONSTRAINT "site_stagings_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."site_stagings" ADD CONSTRAINT "site_stagings_published_by_accounts_id_fk" FOREIGN KEY ("published_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_staging_pages_page_idx" ON "commerce"."site_staging_pages" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "site_staging_pages_store_idx" ON "commerce"."site_staging_pages" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_stagings_one_open" ON "commerce"."site_stagings" USING btree ("store_id") WHERE "commerce"."site_stagings"."status" = 'open';--> statement-breakpoint
CREATE INDEX "site_stagings_install_idx" ON "commerce"."site_stagings" USING btree ("install_id");--> statement-breakpoint
CREATE INDEX "site_stagings_created_by_idx" ON "commerce"."site_stagings" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "site_stagings_published_by_idx" ON "commerce"."site_stagings" USING btree ("published_by");--> statement-breakpoint

-- Staging sets of a store's site (wave 9 unit E, D358): read and written by the server only, never through the Data API.
ALTER TABLE "commerce"."site_stagings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."site_staging_pages" ENABLE ROW LEVEL SECURITY;
