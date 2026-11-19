ALTER TABLE "commerce"."flows" ADD COLUMN "replaces" text;--> statement-breakpoint
ALTER TABLE "commerce"."flows" ADD CONSTRAINT "flows_replaces" CHECK ("commerce"."flows"."replaces" is null or "commerce"."flows"."replaces" in ('welcome', 'after_purchase', 'win_back', 'cross_sell', 'replenish', 'browse', 'back_in_stock'));--> statement-breakpoint
-- A flow that starts when someone joins the list sends its first email at once, as the welcome automation does: mark the ones saved
-- before this column existed (the welcome series, D767 slice 2) as doing its work, so both are never on together.
UPDATE "commerce"."flows" SET "replaces" = 'welcome' WHERE "trigger" = 'subscriber.subscribed' AND "replaces" IS NULL;
