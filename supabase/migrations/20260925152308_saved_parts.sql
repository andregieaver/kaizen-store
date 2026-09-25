CREATE TABLE "commerce"."saved_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "saved_parts_kind" CHECK ("commerce"."saved_parts"."kind" in ('row', 'column', 'block')),
	CONSTRAINT "saved_parts_name" CHECK (length(trim("commerce"."saved_parts"."name")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "commerce"."saved_parts" ADD CONSTRAINT "saved_parts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."saved_parts" ADD CONSTRAINT "saved_parts_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."saved_parts" ADD CONSTRAINT "saved_parts_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_parts_store_kind_idx" ON "commerce"."saved_parts" USING btree ("store_id","kind","name");--> statement-breakpoint
CREATE INDEX "saved_parts_created_by_idx" ON "commerce"."saved_parts" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "saved_parts_updated_by_idx" ON "commerce"."saved_parts" USING btree ("updated_by");