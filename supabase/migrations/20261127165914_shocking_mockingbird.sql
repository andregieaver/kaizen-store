-- A payment of nothing for an order that costs nothing (D913, provider `free`) or a Stripe session with nothing due now (a free trial); a free
-- subscription has no provider behind it.
ALTER TABLE "commerce"."payments" DROP CONSTRAINT "payments_amount_positive";--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("commerce"."payments"."amount_minor" > 0 or ("commerce"."payments"."amount_minor" = 0 and "commerce"."payments"."provider" in ('free', 'stripe')));--> statement-breakpoint
ALTER TABLE "commerce"."subscriptions" ADD CONSTRAINT "subscriptions_free" CHECK ("commerce"."subscriptions"."provider" <> 'none' or ("commerce"."subscriptions"."provider_reference" is null and "commerce"."subscriptions"."total_minor" = 0));