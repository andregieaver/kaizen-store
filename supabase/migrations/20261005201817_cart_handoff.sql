ALTER TABLE "commerce"."carts" ADD COLUMN "handoff_hash" text;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "handoff_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "handoff_to" text;--> statement-breakpoint
CREATE UNIQUE INDEX "carts_handoff_idx" ON "commerce"."carts" USING btree ("handoff_hash");--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_handoff_to" CHECK ("commerce"."carts"."handoff_to" is null or "commerce"."carts"."handoff_to" in ('cart', 'checkout'));