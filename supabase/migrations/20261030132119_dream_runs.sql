CREATE TABLE "commerce"."dream_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"account_id" uuid,
	"prompt" text NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"brief" jsonb,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conversation_id" uuid,
	"owner_presses" integer DEFAULT 1 NOT NULL,
	"claimed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dream_runs_status" CHECK ("commerce"."dream_runs"."status" in ('running', 'asking', 'ready', 'open', 'failed', 'stopped')),
	CONSTRAINT "dream_runs_prompt" CHECK (length("commerce"."dream_runs"."prompt") between 20 and 2000),
	CONSTRAINT "dream_runs_presses" CHECK ("commerce"."dream_runs"."owner_presses" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD COLUMN "dream" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."dream_runs" ADD CONSTRAINT "dream_runs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."dream_runs" ADD CONSTRAINT "dream_runs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."dream_runs" ADD CONSTRAINT "dream_runs_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."assistant_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dream_runs_store_idx" ON "commerce"."dream_runs" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "dream_runs_account_idx" ON "commerce"."dream_runs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "dream_runs_conversation_idx" ON "commerce"."dream_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "dream_runs_due_idx" ON "commerce"."dream_runs" USING btree ("claimed_until") WHERE "commerce"."dream_runs"."finished_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "dream_runs_one_open" ON "commerce"."dream_runs" USING btree ("store_id") WHERE "commerce"."dream_runs"."finished_at" is null and "commerce"."dream_runs"."status" <> 'stopped';--> statement-breakpoint
-- The Dream Factory's runs (D409): written only by src/server/dream-factory.ts, never through the Data API.
ALTER TABLE "commerce"."dream_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Every minute Supabase's scheduler asks Kaizena Flow to move the runs on. Not where the extensions are missing, such as in tests.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    PERFORM cron.schedule(
      'kaizen-dream-factory',
      '* * * * *',
      $job$
        SELECT net.http_post(
          url := 'https://kaizenaflow.com/api/cron/dream-factory',
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
