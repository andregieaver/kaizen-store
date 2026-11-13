CREATE TABLE "commerce"."support_widget_site_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"path" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content_hash" text,
	"fetched_at" timestamp with time zone,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"problem" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_widget_site_pages_path_key" UNIQUE("site_id","path"),
	CONSTRAINT "support_widget_site_pages_path" CHECK ("commerce"."support_widget_site_pages"."path" ~ '^/' and length("commerce"."support_widget_site_pages"."path") <= 500),
	CONSTRAINT "support_widget_site_pages_title" CHECK (length("commerce"."support_widget_site_pages"."title") <= 300),
	CONSTRAINT "support_widget_site_pages_problem" CHECK ("commerce"."support_widget_site_pages"."problem" is null or "commerce"."support_widget_site_pages"."problem" in ('unreachable', 'unreadable', 'moved', 'empty'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."support_widget_sites" ADD COLUMN "crawl_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."support_widget_sites" ADD COLUMN "discovered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."support_widget_sites" ADD COLUMN "crawl_problem" text;--> statement-breakpoint
ALTER TABLE "commerce"."support_widget_site_pages" ADD CONSTRAINT "support_widget_site_pages_site_id_support_widget_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "commerce"."support_widget_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_widget_site_pages_fetched_idx" ON "commerce"."support_widget_site_pages" USING btree ("fetched_at");--> statement-breakpoint
ALTER TABLE "commerce"."support_widget_sites" ADD CONSTRAINT "support_widget_sites_crawl_problem" CHECK ("commerce"."support_widget_sites"."crawl_problem" is null or "commerce"."support_widget_sites"."crawl_problem" in ('robots', 'no_pages', 'unreachable'));