CREATE TABLE "commerce"."live_drills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"requested_by" uuid,
	"kinds" text[] NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "live_drills_status" CHECK ("commerce"."live_drills"."status" in ('requested', 'running', 'done')),
	CONSTRAINT "live_drills_kinds" CHECK (cardinality("commerce"."live_drills"."kinds") between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "commerce"."live_drills" ADD CONSTRAINT "live_drills_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."live_drills" ADD CONSTRAINT "live_drills_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_drills_store_idx" ON "commerce"."live_drills" USING btree ("store_id","requested_at");--> statement-breakpoint
CREATE INDEX "live_drills_requested_by_idx" ON "commerce"."live_drills" USING btree ("requested_by");--> statement-breakpoint
ALTER TABLE "commerce"."live_drills" ENABLE ROW LEVEL SECURITY;
