CREATE TABLE "commerce"."theme_shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preset_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"variation" text,
	"starter_id" uuid,
	"showcase_store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"tries" smallint DEFAULT 0 NOT NULL,
	"claimed_until" timestamp with time zone,
	"problem" text,
	"pictures" jsonb,
	"parts" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "theme_shots_unit" UNIQUE NULLS NOT DISTINCT("preset_id","version","variation","showcase_store_id","kind"),
	CONSTRAINT "theme_shots_version" CHECK ("commerce"."theme_shots"."version" >= 1),
	CONSTRAINT "theme_shots_variation" CHECK ("commerce"."theme_shots"."variation" is null or "commerce"."theme_shots"."variation" ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
	CONSTRAINT "theme_shots_kind" CHECK ("commerce"."theme_shots"."kind" in ('computer', 'phone', 'highlights')),
	CONSTRAINT "theme_shots_status" CHECK ("commerce"."theme_shots"."status" in ('waiting', 'running', 'done', 'failed', 'superseded')),
	CONSTRAINT "theme_shots_tries" CHECK ("commerce"."theme_shots"."tries" between 0 and 20),
	CONSTRAINT "theme_shots_problem" CHECK ("commerce"."theme_shots"."problem" is null or length("commerce"."theme_shots"."problem") <= 500),
	CONSTRAINT "theme_shots_pictures" CHECK ("commerce"."theme_shots"."pictures" is null or (jsonb_typeof("commerce"."theme_shots"."pictures") = 'object' and octet_length("commerce"."theme_shots"."pictures"::text) <= 20000)),
	CONSTRAINT "theme_shots_parts" CHECK ("commerce"."theme_shots"."parts" is null or (jsonb_typeof("commerce"."theme_shots"."parts") = 'object' and octet_length("commerce"."theme_shots"."parts"::text) <= 200000)),
	CONSTRAINT "theme_shots_done" CHECK ("commerce"."theme_shots"."status" <> 'done' or ("commerce"."theme_shots"."pictures" is not null and "commerce"."theme_shots"."finished_at" is not null)),
	CONSTRAINT "theme_shots_superseded" CHECK (("commerce"."theme_shots"."status" = 'superseded') = ("commerce"."theme_shots"."superseded_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "commerce"."theme_shots" ADD CONSTRAINT "theme_shots_preset_id_design_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "commerce"."design_presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "theme_shots_queue_idx" ON "commerce"."theme_shots" USING btree ("created_at") WHERE "commerce"."theme_shots"."status" in ('waiting', 'running');--> statement-breakpoint
-- Row-level security, no policy: the commerce schema is private to the server (docs/theme-showcase-phase-2.md step 1).
ALTER TABLE "commerce"."theme_shots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Every minute Supabase's scheduler asks Kaizena Flow to photograph the next looks of published themes (docs/theme-showcase-phase-2.md
-- step 1), as it asks for the cookie scan. Not where the extensions are missing, such as in tests.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    PERFORM cron.schedule(
      'kaizen-theme-shots',
      '* * * * *',
      $job$
        SELECT net.http_post(
          url := 'https://kaizenaflow.com/api/cron/theme-shots',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'kaizen_cron_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 30000
        );
      $job$
    );
  END IF;
END
$do$;
