ALTER TABLE "commerce"."carts" DROP CONSTRAINT "carts_source";--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "api_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "carts_api_idx" ON "commerce"."carts" USING btree ("api_hash");--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_source" CHECK ("commerce"."carts"."source" is null or "commerce"."carts"."source" in ('agent', 'api'));