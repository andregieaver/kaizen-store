CREATE TABLE "commerce"."instance_starts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"register_ms" integer,
	"first_ms" integer NOT NULL,
	"rss_mb" integer NOT NULL,
	"ui_bytes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "instance_starts_kind" CHECK ("commerce"."instance_starts"."kind" in ('health', 'beacon', 'proxy', 'store', 'pay', 'site', 'admin', 'platform_admin', 'api', 'job')),
	CONSTRAINT "instance_starts_values" CHECK ("commerce"."instance_starts"."first_ms" between 0 and 600000 and "commerce"."instance_starts"."rss_mb" between 0 and 100000 and "commerce"."instance_starts"."ui_bytes" >= 0
        and ("commerce"."instance_starts"."register_ms" is null or "commerce"."instance_starts"."register_ms" between 0 and 600000))
);
--> statement-breakpoint
CREATE INDEX "instance_starts_day_idx" ON "commerce"."instance_starts" USING btree ("day","kind");