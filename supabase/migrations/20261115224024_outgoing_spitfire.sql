CREATE TABLE "commerce"."knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"page_id" uuid,
	"entry_id" uuid,
	"published_at" timestamp with time zone NOT NULL,
	"slug" text NOT NULL,
	"type_version" text,
	"path" text,
	"cut_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_sources_source" CHECK (num_nonnulls("commerce"."knowledge_sources"."page_id", "commerce"."knowledge_sources"."entry_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "commerce"."knowledge_sources" ADD CONSTRAINT "knowledge_sources_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."knowledge_sources" ADD CONSTRAINT "knowledge_sources_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "commerce"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."knowledge_sources" ADD CONSTRAINT "knowledge_sources_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "commerce"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sources_page_key" ON "commerce"."knowledge_sources" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sources_entry_key" ON "commerce"."knowledge_sources" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "knowledge_sources_store_idx" ON "commerce"."knowledge_sources" USING btree ("store_id");
--> statement-breakpoint
-- Row-level security, no policy: the commerce schema is private to the server.
ALTER TABLE "commerce"."knowledge_sources" ENABLE ROW LEVEL SECURITY;
