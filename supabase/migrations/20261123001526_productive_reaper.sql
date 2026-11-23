ALTER TABLE "commerce"."broadcast_recipients" DROP CONSTRAINT "broadcast_recipients_status";--> statement-breakpoint
ALTER TABLE "commerce"."broadcast_recipients" ADD COLUMN "version" text;--> statement-breakpoint
ALTER TABLE "commerce"."broadcasts" ADD COLUMN "test" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."broadcasts" ADD COLUMN "test_called_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."broadcasts" ADD COLUMN "test_result" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_version" CHECK ("commerce"."broadcast_recipients"."version" is null or "commerce"."broadcast_recipients"."version" in ('a', 'b'));--> statement-breakpoint
ALTER TABLE "commerce"."broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_status" CHECK ("commerce"."broadcast_recipients"."status" in ('queued', 'sent', 'failed', 'skipped', 'held'));--> statement-breakpoint
ALTER TABLE "commerce"."broadcasts" ADD CONSTRAINT "broadcasts_test" CHECK ("commerce"."broadcasts"."test" is null or jsonb_typeof("commerce"."broadcasts"."test") = 'object');