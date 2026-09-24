ALTER TABLE "commerce"."stripe_accounts" ADD COLUMN "payment_methods_requested" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Accounts Kaizen created so far asked for card payments only.
UPDATE "commerce"."stripe_accounts" SET "payment_methods_requested" = '{card_payments}';
