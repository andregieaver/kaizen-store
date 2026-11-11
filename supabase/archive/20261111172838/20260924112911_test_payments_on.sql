ALTER TABLE "commerce"."payment_providers" ALTER COLUMN "enabled" SET DEFAULT true;--> statement-breakpoint
-- Stores still in test mode could not switch payments on without finishing
-- Stripe's identity checks; test payments now need no setup (D20).
UPDATE "commerce"."payment_providers" SET "enabled" = true, "updated_at" = now()
WHERE "active_mode" = 'test' AND NOT "enabled";
