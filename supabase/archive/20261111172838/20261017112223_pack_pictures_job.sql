ALTER TABLE "commerce"."store_starters" ADD COLUMN "pictures_wanted_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD COLUMN "pictures_wanted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD COLUMN "picture_claimed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD COLUMN "picture_failures" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD COLUMN "picture_problem" text;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD CONSTRAINT "store_starters_pictures_wanted_by_accounts_id_fk" FOREIGN KEY ("pictures_wanted_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_starters_pictures_wanted_by_idx" ON "commerce"."store_starters" USING btree ("pictures_wanted_by");--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD CONSTRAINT "store_starters_pictures_wanted" CHECK (("commerce"."store_starters"."pictures_wanted_by" is null) = ("commerce"."store_starters"."pictures_wanted_at" is null) and ("commerce"."store_starters"."pictures_wanted_at" is null or "commerce"."store_starters"."pack_key" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD CONSTRAINT "store_starters_picture_failures" CHECK ("commerce"."store_starters"."picture_failures" between 0 and 20);--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD CONSTRAINT "store_starters_picture_problem" CHECK ("commerce"."store_starters"."picture_problem" is null or length("commerce"."store_starters"."picture_problem") <= 500);--> statement-breakpoint
-- Every minute Supabase's scheduler asks Kaizena Flow to make the next pictures content packs were asked for (D271), as it asks for the
-- theme photographs: the page no longer waits a minute or two for each. Not where the extensions are missing, such as in tests.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    PERFORM cron.schedule(
      'kaizen-pack-pictures',
      '* * * * *',
      $job$
        SELECT net.http_post(
          url := 'https://kaizenaflow.com/api/cron/pack-pictures',
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
