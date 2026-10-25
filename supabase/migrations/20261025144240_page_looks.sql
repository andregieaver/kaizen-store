CREATE TABLE "commerce"."page_looks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"account_id" uuid,
	"kind" text NOT NULL,
	"page_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"claimed_until" timestamp with time zone,
	"tries" integer DEFAULT 0 NOT NULL,
	"findings" jsonb,
	"problem" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "page_looks_kind" CHECK ("commerce"."page_looks"."kind" in ('page', 'store')),
	CONSTRAINT "page_looks_status" CHECK ("commerce"."page_looks"."status" in ('queued', 'running', 'done', 'failed')),
	CONSTRAINT "page_looks_page" CHECK (("commerce"."page_looks"."kind" = 'page') = ("commerce"."page_looks"."page_id" is not null)),
	CONSTRAINT "page_looks_problem" CHECK ("commerce"."page_looks"."problem" is null or length("commerce"."page_looks"."problem") <= 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."page_looks" ADD CONSTRAINT "page_looks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_looks" ADD CONSTRAINT "page_looks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_looks" ADD CONSTRAINT "page_looks_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "commerce"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_looks_queue_idx" ON "commerce"."page_looks" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "page_looks_page_idx" ON "commerce"."page_looks" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "page_looks_store_idx" ON "commerce"."page_looks" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "page_looks_account_idx" ON "commerce"."page_looks" USING btree ("account_id");