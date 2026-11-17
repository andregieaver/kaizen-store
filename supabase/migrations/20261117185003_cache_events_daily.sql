CREATE TABLE "commerce"."cache_events_daily" (
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"family" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"statements" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cache_events_daily_day_kind_family_subject_source_pk" PRIMARY KEY("day","kind","family","subject","source"),
	CONSTRAINT "cache_events_daily_kind" CHECK ("commerce"."cache_events_daily"."kind" in ('refresh', 'draw')),
	CONSTRAINT "cache_events_daily_source" CHECK ("commerce"."cache_events_daily"."source" in ('action', 'job', 'route', 'render')),
	CONSTRAINT "cache_events_daily_count" CHECK ("commerce"."cache_events_daily"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."cache_events_daily" ENABLE ROW LEVEL SECURITY;
