CREATE TABLE "commerce"."form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"block_id" text NOT NULL,
	"kind" text NOT NULL,
	"visitor" text NOT NULL,
	"status" text NOT NULL,
	"email" text,
	"token_hash" text,
	"payload" jsonb,
	"path" text NOT NULL,
	"locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "form_submissions_kind" CHECK ("commerce"."form_submissions"."kind" in ('message', 'subscription')),
	CONSTRAINT "form_submissions_status" CHECK ("commerce"."form_submissions"."status" in ('pending', 'sent', 'logged', 'failed', 'expired')),
	CONSTRAINT "form_submissions_token" CHECK ("commerce"."form_submissions"."token_hash" is null or "commerce"."form_submissions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "form_submissions_path" CHECK (left("commerce"."form_submissions"."path", 1) = '/' and length("commerce"."form_submissions"."path") <= 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."form_submissions" ADD CONSTRAINT "form_submissions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_submissions_token_idx" ON "commerce"."form_submissions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "form_submissions_block_idx" ON "commerce"."form_submissions" USING btree ("store_id","block_id","created_at");--> statement-breakpoint
CREATE INDEX "form_submissions_visitor_idx" ON "commerce"."form_submissions" USING btree ("visitor","created_at");--> statement-breakpoint
CREATE INDEX "form_submissions_created_idx" ON "commerce"."form_submissions" USING btree ("created_at");