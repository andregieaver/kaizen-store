CREATE TABLE "commerce"."page_theme_detaches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"draft_before" jsonb,
	"draft_after" jsonb,
	"published_before" jsonb,
	"published_after" jsonb,
	"followed" integer NOT NULL,
	"kept" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "page_theme_detaches_counts" CHECK ("commerce"."page_theme_detaches"."followed" >= 0 and "commerce"."page_theme_detaches"."kept" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."page_theme_detaches" ADD CONSTRAINT "page_theme_detaches_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_theme_detaches" ADD CONSTRAINT "page_theme_detaches_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "commerce"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_theme_detaches" ADD CONSTRAINT "page_theme_detaches_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_theme_detaches_store_idx" ON "commerce"."page_theme_detaches" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "page_theme_detaches_run_idx" ON "commerce"."page_theme_detaches" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "page_theme_detaches_page_idx" ON "commerce"."page_theme_detaches" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "page_theme_detaches_created_by_idx" ON "commerce"."page_theme_detaches" USING btree ("created_by");