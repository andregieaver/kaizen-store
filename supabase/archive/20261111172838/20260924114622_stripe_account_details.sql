ALTER TABLE "commerce"."stripe_accounts" ADD COLUMN "managed_by_kaizen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stripe_accounts" ADD COLUMN "requirements" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Test accounts Kaizen created itself before this column existed (D20).
UPDATE "commerce"."stripe_accounts" SET "managed_by_kaizen" = true
WHERE "mode" = 'test' AND "account_id" IN (
  SELECT "details"->>'accountId' FROM "commerce"."audit_log" WHERE "action" = 'payments.test_account_created'
);
