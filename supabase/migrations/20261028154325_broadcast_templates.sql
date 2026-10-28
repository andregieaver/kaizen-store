CREATE TABLE "commerce"."broadcast_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcast_templates_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "broadcast_templates_title" CHECK (length("commerce"."broadcast_templates"."title") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "commerce"."broadcast_templates" ADD CONSTRAINT "broadcast_templates_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."broadcast_templates" ADD CONSTRAINT "broadcast_templates_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_templates_list_idx" ON "commerce"."broadcast_templates" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "broadcast_templates_created_by_idx" ON "commerce"."broadcast_templates" USING btree ("created_by");
--> statement-breakpoint
ALTER TABLE "commerce"."broadcast_templates" ENABLE ROW LEVEL SECURITY;