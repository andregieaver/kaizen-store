ALTER TABLE "commerce"."marketing_subscribers" DROP CONSTRAINT "marketing_subscribers_source";--> statement-breakpoint
ALTER TABLE "commerce"."gift_cards" ADD COLUMN "moved_from" text;--> statement-breakpoint
ALTER TABLE "commerce"."gift_cards" ADD COLUMN "moved_balance_minor" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_moved_key" ON "commerce"."gift_cards" USING btree ("store_id","moved_from") WHERE "commerce"."gift_cards"."moved_from" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."marketing_subscribers" ADD CONSTRAINT "marketing_subscribers_source" CHECK ("commerce"."marketing_subscribers"."source" in ('form', 'checkout', 'account', 'shopify'));