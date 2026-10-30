ALTER TABLE "commerce"."assistant_approvals" DROP CONSTRAINT "assistant_approvals_status";--> statement-breakpoint
ALTER TABLE "commerce"."assistant_approvals" ADD COLUMN "expires_at" timestamp with time zone DEFAULT (now() + interval '7 days') NOT NULL;--> statement-breakpoint
CREATE INDEX "assistant_approvals_pending_expiry_idx" ON "commerce"."assistant_approvals" USING btree ("expires_at") WHERE "commerce"."assistant_approvals"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "commerce"."assistant_approvals" ADD CONSTRAINT "assistant_approvals_status" CHECK ("commerce"."assistant_approvals"."status" in ('pending', 'done', 'declined', 'failed', 'expired'));--> statement-breakpoint
-- Approvals already waiting end seven days after they were asked, never sooner than a day from now (PSI AGT-03).
UPDATE "commerce"."assistant_approvals" SET "expires_at" = greatest("created_at" + interval '7 days', now() + interval '1 day') WHERE "status" = 'pending';
