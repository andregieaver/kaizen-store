CREATE TABLE "commerce"."checklist_item_time" (
	"store_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_item_time_store_id_time_entry_id_pk" PRIMARY KEY("store_id","time_entry_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."checklist_item_time" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_items" ADD COLUMN "assigned_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_items" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_items" ADD COLUMN "assignee_told_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."checklists" ADD COLUMN "assignment_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_item_time" ADD CONSTRAINT "checklist_item_time_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_item_time" ADD CONSTRAINT "checklist_item_time_item_fk" FOREIGN KEY ("store_id","item_id") REFERENCES "commerce"."checklist_items"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_item_time" ADD CONSTRAINT "checklist_item_time_entry_fk" FOREIGN KEY ("store_id","time_entry_id") REFERENCES "commerce"."work_time_entries"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_item_time_item_idx" ON "commerce"."checklist_item_time" USING btree ("store_id","item_id");--> statement-breakpoint
ALTER TABLE "commerce"."checklist_items" ADD CONSTRAINT "checklist_items_assigned_by_accounts_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_items_assigned_by_idx" ON "commerce"."checklist_items" USING btree ("assigned_by");--> statement-breakpoint
CREATE INDEX "checklist_items_to_tell_idx" ON "commerce"."checklist_items" USING btree ("assigned_at") WHERE "commerce"."checklist_items"."assigned_at" is not null and "commerce"."checklist_items"."assignee_told_at" is null;--> statement-breakpoint
CREATE INDEX "checklists_assignment_idx" ON "commerce"."checklists" USING btree ("store_id","assignment_id") WHERE "commerce"."checklists"."assignment_id" is not null;