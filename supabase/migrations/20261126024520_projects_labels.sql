CREATE TABLE "commerce"."checklist_item_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"written_by" uuid,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_item_comments_body" CHECK ("commerce"."checklist_item_comments"."body" = btrim("commerce"."checklist_item_comments"."body") and char_length("commerce"."checklist_item_comments"."body") between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."checklist_item_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."checklist_item_tags" (
	"store_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_item_tags_store_id_item_id_label_id_pk" PRIMARY KEY("store_id","item_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."checklist_item_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."project_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"colour" text DEFAULT 'neutral' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_labels_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "project_labels_slug_key" UNIQUE("store_id","kind","slug"),
	CONSTRAINT "project_labels_kind" CHECK ("commerce"."project_labels"."kind" in ('category', 'tag')),
	CONSTRAINT "project_labels_name" CHECK ("commerce"."project_labels"."name" = btrim("commerce"."project_labels"."name") and char_length("commerce"."project_labels"."name") between 1 and 40),
	CONSTRAINT "project_labels_slug" CHECK ("commerce"."project_labels"."slug" ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
	CONSTRAINT "project_labels_colour" CHECK ("commerce"."project_labels"."colour" in ('neutral', 'insight', 'positive', 'warning', 'danger', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."project_labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_items" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_item_comments" ADD CONSTRAINT "checklist_item_comments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_item_comments" ADD CONSTRAINT "checklist_item_comments_written_by_accounts_id_fk" FOREIGN KEY ("written_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_item_comments" ADD CONSTRAINT "checklist_item_comments_item_fk" FOREIGN KEY ("store_id","item_id") REFERENCES "commerce"."checklist_items"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_item_tags" ADD CONSTRAINT "checklist_item_tags_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_item_tags" ADD CONSTRAINT "checklist_item_tags_item_fk" FOREIGN KEY ("store_id","item_id") REFERENCES "commerce"."checklist_items"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_item_tags" ADD CONSTRAINT "checklist_item_tags_label_fk" FOREIGN KEY ("store_id","label_id") REFERENCES "commerce"."project_labels"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."project_labels" ADD CONSTRAINT "project_labels_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_item_comments_item_idx" ON "commerce"."checklist_item_comments" USING btree ("store_id","item_id","created_at");--> statement-breakpoint
CREATE INDEX "checklist_item_comments_written_by_idx" ON "commerce"."checklist_item_comments" USING btree ("written_by");--> statement-breakpoint
CREATE INDEX "checklist_item_tags_label_idx" ON "commerce"."checklist_item_tags" USING btree ("store_id","label_id");--> statement-breakpoint
CREATE INDEX "project_labels_order_idx" ON "commerce"."project_labels" USING btree ("store_id","kind","sort_order");--> statement-breakpoint
CREATE INDEX "checklist_items_category_idx" ON "commerce"."checklist_items" USING btree ("store_id","category_id") WHERE "commerce"."checklist_items"."category_id" is not null;