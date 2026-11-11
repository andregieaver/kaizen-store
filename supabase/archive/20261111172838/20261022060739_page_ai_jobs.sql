CREATE TABLE "commerce"."page_ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"kind" text NOT NULL,
	"page_id" uuid,
	"asked_by" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL,
	"problem" text,
	"result" jsonb,
	"claimed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_ai_jobs_kind" CHECK ("commerce"."page_ai_jobs"."kind" in ('build', 'picture')),
	CONSTRAINT "page_ai_jobs_status" CHECK ("commerce"."page_ai_jobs"."status" in ('waiting', 'done', 'gone', 'failed')),
	CONSTRAINT "page_ai_jobs_tries" CHECK (tries between 0 and 3),
	CONSTRAINT "page_ai_jobs_picture_page" CHECK ("commerce"."page_ai_jobs"."kind" <> 'picture' or "commerce"."page_ai_jobs"."page_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "commerce"."page_ai_jobs" ADD CONSTRAINT "page_ai_jobs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_ai_jobs" ADD CONSTRAINT "page_ai_jobs_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "commerce"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_ai_jobs" ADD CONSTRAINT "page_ai_jobs_asked_by_accounts_id_fk" FOREIGN KEY ("asked_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_ai_jobs_waiting_idx" ON "commerce"."page_ai_jobs" USING btree ("created_at") WHERE "commerce"."page_ai_jobs"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "page_ai_jobs_page_idx" ON "commerce"."page_ai_jobs" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "page_ai_jobs_store_idx" ON "commerce"."page_ai_jobs" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "page_ai_jobs_asked_by_idx" ON "commerce"."page_ai_jobs" USING btree ("asked_by");--> statement-breakpoint
-- The AI manager's page work (D308): read and written only by the server (src/server/site-tools.ts), never through the Data API.
ALTER TABLE "commerce"."page_ai_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Every minute Supabase's scheduler asks Kaizena Flow to build the pages and make the pictures the AI manager was asked for (D308), as it
-- asks for the content packs' pictures. Not where the extensions are missing, such as in tests.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    PERFORM cron.schedule(
      'kaizen-page-jobs',
      '* * * * *',
      $job$
        SELECT net.http_post(
          url := 'https://kaizenaflow.com/api/cron/page-jobs',
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
