CREATE TABLE "commerce"."cron_jobs" (
	"job" text PRIMARY KEY NOT NULL,
	"every_seconds" integer NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"last_duration_ms" integer,
	"runs" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cron_jobs_job" CHECK ("commerce"."cron_jobs"."job" ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$'),
	CONSTRAINT "cron_jobs_every" CHECK ("commerce"."cron_jobs"."every_seconds" between 60 and 604800),
	CONSTRAINT "cron_jobs_error" CHECK ("commerce"."cron_jobs"."last_error" is null or length("commerce"."cron_jobs"."last_error") <= 1000),
	CONSTRAINT "cron_jobs_counts" CHECK ("commerce"."cron_jobs"."runs" >= 0 and "commerce"."cron_jobs"."failures" >= 0)
);
