CREATE TABLE "commerce"."page_replications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"requested_by" uuid,
	"url" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"abort_requested" boolean DEFAULT false NOT NULL,
	"iterations_max" integer DEFAULT 3 NOT NULL,
	"iteration" integer DEFAULT 0 NOT NULL,
	"phase" text DEFAULT 'open' NOT NULL,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capture" jsonb,
	"work" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"page_id" uuid,
	"summary" jsonb,
	"locked_until" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "page_replications_status" CHECK ("commerce"."page_replications"."status" in ('queued', 'running', 'done', 'failed', 'aborted')),
	CONSTRAINT "page_replications_iterations" CHECK ("commerce"."page_replications"."iterations_max" between 1 and 10 and "commerce"."page_replications"."iteration" between 0 and 10),
	CONSTRAINT "page_replications_phase" CHECK ("commerce"."page_replications"."phase" in ('open', 'examine', 'copy', 'assets', 'build', 'refine', 'done')),
	CONSTRAINT "page_replications_json" CHECK (jsonb_typeof("commerce"."page_replications"."log") = 'array' and jsonb_typeof("commerce"."page_replications"."work") = 'object')
);
--> statement-breakpoint
ALTER TABLE "commerce"."page_replications" ADD CONSTRAINT "page_replications_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_replications" ADD CONSTRAINT "page_replications_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_replications" ADD CONSTRAINT "page_replications_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "commerce"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_replications_store_created_idx" ON "commerce"."page_replications" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "page_replications_requested_by_idx" ON "commerce"."page_replications" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "page_replications_page_idx" ON "commerce"."page_replications" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_replications_one_active_idx" ON "commerce"."page_replications" USING btree ("store_id") WHERE "commerce"."page_replications"."status" in ('queued', 'running');