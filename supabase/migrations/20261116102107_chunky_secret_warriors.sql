CREATE TABLE "commerce"."page_map_shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"page" text NOT NULL,
	"device" text NOT NULL,
	"tag" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_until" timestamp with time zone,
	"shot_at" timestamp with time zone,
	"width" integer,
	"height" integer,
	"layout" jsonb,
	"problem" text,
	CONSTRAINT "page_map_shots_key" UNIQUE("store_id","page","device","tag"),
	CONSTRAINT "page_map_shots_page" CHECK (char_length("commerce"."page_map_shots"."page") between 1 and 300),
	CONSTRAINT "page_map_shots_device" CHECK ("commerce"."page_map_shots"."device" in ('mobile', 'tablet', 'desktop')),
	CONSTRAINT "page_map_shots_tag" CHECK ("commerce"."page_map_shots"."tag" = '' or "commerce"."page_map_shots"."tag" ~ '^[0-9a-f-]{36}:[a-d]$'),
	CONSTRAINT "page_map_shots_status" CHECK ("commerce"."page_map_shots"."status" in ('waiting', 'taking', 'done', 'failed')),
	CONSTRAINT "page_map_shots_problem" CHECK (char_length("commerce"."page_map_shots"."problem") <= 200)
);
--> statement-breakpoint
ALTER TABLE "commerce"."page_map_shots" ADD CONSTRAINT "page_map_shots_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_map_shots_queue_idx" ON "commerce"."page_map_shots" USING btree ("requested_at") WHERE "commerce"."page_map_shots"."status" in ('waiting', 'taking');--> statement-breakpoint
-- Row-level security, no policy: the commerce schema is private to the server.
ALTER TABLE "commerce"."page_map_shots" ENABLE ROW LEVEL SECURITY;