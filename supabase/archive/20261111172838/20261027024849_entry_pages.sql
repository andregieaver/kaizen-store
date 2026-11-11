ALTER TABLE "commerce"."pages" DROP CONSTRAINT "pages_type";--> statement-breakpoint
ALTER TABLE "commerce"."redirects" DROP CONSTRAINT "redirects_kind";--> statement-breakpoint
ALTER TABLE "commerce"."redirects" DROP CONSTRAINT "redirects_kind_columns";--> statement-breakpoint
ALTER TABLE "commerce"."redirects" ADD COLUMN "entry_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."redirects" ADD CONSTRAINT "redirects_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "commerce"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_entries_created_by_idx" ON "commerce"."content_entries" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "content_entries_updated_by_idx" ON "commerce"."content_entries" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "content_types_layout_idx" ON "commerce"."content_types" USING btree ("layout_id");--> statement-breakpoint
CREATE INDEX "content_types_updated_by_idx" ON "commerce"."content_types" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "redirects_entry_idx" ON "commerce"."redirects" USING btree ("entry_id");--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_type" CHECK ("commerce"."pages"."type" in ('page', 'article', 'product_layout', 'header', 'footer', 'variant', 'entry_layout'));--> statement-breakpoint
ALTER TABLE "commerce"."redirects" ADD CONSTRAINT "redirects_kind" CHECK ("commerce"."redirects"."kind" in ('manual', 'product', 'category', 'tag', 'entry'));--> statement-breakpoint
ALTER TABLE "commerce"."redirects" ADD CONSTRAINT "redirects_kind_columns" CHECK (("commerce"."redirects"."kind" = 'manual' and "commerce"."redirects"."target" is not null and "commerce"."redirects"."product_id" is null and "commerce"."redirects"."term_id" is null and "commerce"."redirects"."entry_id" is null)
        or ("commerce"."redirects"."kind" = 'product' and "commerce"."redirects"."target" is null and "commerce"."redirects"."product_id" is not null and "commerce"."redirects"."term_id" is null and "commerce"."redirects"."entry_id" is null)
        or ("commerce"."redirects"."kind" in ('category', 'tag') and "commerce"."redirects"."target" is null and "commerce"."redirects"."product_id" is null and "commerce"."redirects"."term_id" is not null and "commerce"."redirects"."entry_id" is null)
        or ("commerce"."redirects"."kind" = 'entry' and "commerce"."redirects"."target" is null and "commerce"."redirects"."product_id" is null and "commerce"."redirects"."term_id" is null and "commerce"."redirects"."entry_id" is not null));