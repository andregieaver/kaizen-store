ALTER TABLE "commerce"."ai_usage" ADD COLUMN "cached_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."ai_usage" ADD COLUMN "turn_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."ai_usage" ADD COLUMN "round" integer;--> statement-breakpoint
ALTER TABLE "commerce"."ai_usage" ADD COLUMN "loaded_tools" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_usage_turn_idx" ON "commerce"."ai_usage" USING btree ("turn_id") WHERE "commerce"."ai_usage"."turn_id" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."ai_usage" ADD CONSTRAINT "ai_usage_round" CHECK ("commerce"."ai_usage"."round" is null or "commerce"."ai_usage"."round" between 0 and 100);--> statement-breakpoint
ALTER TABLE "commerce"."ai_usage" ADD CONSTRAINT "ai_usage_cached" CHECK ("commerce"."ai_usage"."cached_input_tokens" >= 0 and "commerce"."ai_usage"."cached_input_tokens" <= "commerce"."ai_usage"."input_tokens");