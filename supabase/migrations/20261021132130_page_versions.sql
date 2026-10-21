CREATE TABLE "commerce"."page_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"page_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "page_versions_kind" CHECK ("commerce"."page_versions"."kind" in ('saved', 'published', 'site_text', 'site_css'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."page_versions" ADD CONSTRAINT "page_versions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_versions" ADD CONSTRAINT "page_versions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "commerce"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_versions" ADD CONSTRAINT "page_versions_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_versions_page_idx" ON "commerce"."page_versions" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "page_versions_store_idx" ON "commerce"."page_versions" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "page_versions_created_by_idx" ON "commerce"."page_versions" USING btree ("created_by");