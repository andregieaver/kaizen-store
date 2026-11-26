ALTER TABLE "commerce"."checklist_items" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_items" ADD COLUMN "return_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_items" ADD COLUMN "review_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_items" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
CREATE INDEX "checklist_items_order_link_idx" ON "commerce"."checklist_items" USING btree ("store_id","order_id") WHERE "commerce"."checklist_items"."order_id" is not null;--> statement-breakpoint
CREATE INDEX "checklist_items_return_link_idx" ON "commerce"."checklist_items" USING btree ("store_id","return_id") WHERE "commerce"."checklist_items"."return_id" is not null;--> statement-breakpoint
CREATE INDEX "checklist_items_review_link_idx" ON "commerce"."checklist_items" USING btree ("store_id","review_id") WHERE "commerce"."checklist_items"."review_id" is not null;--> statement-breakpoint
CREATE INDEX "checklist_items_conversation_link_idx" ON "commerce"."checklist_items" USING btree ("conversation_id") WHERE "commerce"."checklist_items"."conversation_id" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_items" ADD CONSTRAINT "checklist_items_one_source" CHECK (num_nonnulls("commerce"."checklist_items"."order_id", "commerce"."checklist_items"."return_id", "commerce"."checklist_items"."review_id", "commerce"."checklist_items"."conversation_id") <= 1);