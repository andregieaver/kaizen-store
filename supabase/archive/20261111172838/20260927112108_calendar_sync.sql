CREATE TABLE "commerce"."calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"synced_at" timestamp with time zone,
	"error" text DEFAULT '' NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feeds_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "calendar_feeds_name" CHECK (length("commerce"."calendar_feeds"."name") between 1 and 80),
	CONSTRAINT "calendar_feeds_url" CHECK ("commerce"."calendar_feeds"."url" ~ '^https://' and length("commerce"."calendar_feeds"."url") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."resource_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"feed_id" uuid,
	"uid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_blocks_times" CHECK ("commerce"."resource_blocks"."starts_at" < "commerce"."resource_blocks"."ends_at"),
	CONSTRAINT "resource_blocks_note" CHECK (length("commerce"."resource_blocks"."note") <= 200),
	CONSTRAINT "resource_blocks_feed_uid" CHECK (("commerce"."resource_blocks"."feed_id" is null) = ("commerce"."resource_blocks"."uid" is null))
);
--> statement-breakpoint
ALTER TABLE "commerce"."booking_resources" ADD COLUMN "calendar_token" text;--> statement-breakpoint
ALTER TABLE "commerce"."calendar_feeds" ADD CONSTRAINT "calendar_feeds_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."calendar_feeds" ADD CONSTRAINT "calendar_feeds_resource_fk" FOREIGN KEY ("store_id","resource_id") REFERENCES "commerce"."booking_resources"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."resource_blocks" ADD CONSTRAINT "resource_blocks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."resource_blocks" ADD CONSTRAINT "resource_blocks_resource_fk" FOREIGN KEY ("store_id","resource_id") REFERENCES "commerce"."booking_resources"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."resource_blocks" ADD CONSTRAINT "resource_blocks_feed_fk" FOREIGN KEY ("store_id","feed_id") REFERENCES "commerce"."calendar_feeds"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_feeds_resource_idx" ON "commerce"."calendar_feeds" USING btree ("store_id","resource_id");--> statement-breakpoint
CREATE INDEX "calendar_feeds_due_idx" ON "commerce"."calendar_feeds" USING btree ("synced_at");--> statement-breakpoint
CREATE INDEX "resource_blocks_resource_time_idx" ON "commerce"."resource_blocks" USING btree ("store_id","resource_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_blocks_feed_uid_key" ON "commerce"."resource_blocks" USING btree ("feed_id","uid");--> statement-breakpoint
CREATE INDEX "resource_blocks_feed_idx" ON "commerce"."resource_blocks" USING btree ("store_id","feed_id");--> statement-breakpoint
ALTER TABLE "commerce"."booking_resources" ADD CONSTRAINT "booking_resources_calendar_token_key" UNIQUE("calendar_token");