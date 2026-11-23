CREATE TABLE "commerce"."email_saved_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"block" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_saved_blocks_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "email_saved_blocks_name" CHECK (length("commerce"."email_saved_blocks"."name") between 1 and 80),
	CONSTRAINT "email_saved_blocks_block" CHECK (jsonb_typeof("commerce"."email_saved_blocks"."block") = 'object')
);
--> statement-breakpoint
ALTER TABLE "commerce"."email_saved_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."email_saved_blocks" ADD CONSTRAINT "email_saved_blocks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."email_saved_blocks" ADD CONSTRAINT "email_saved_blocks_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_saved_blocks_list_idx" ON "commerce"."email_saved_blocks" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "email_saved_blocks_created_by_idx" ON "commerce"."email_saved_blocks" USING btree ("created_by");