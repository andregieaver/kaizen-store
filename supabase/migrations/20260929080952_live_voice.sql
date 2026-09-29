ALTER TABLE "commerce"."ai_providers" ADD COLUMN "live_model" text;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD COLUMN "live_voice" text;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD COLUMN "live_provider" text;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD COLUMN "live_base_url" text;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD COLUMN "live_api_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD COLUMN "live_api_key_hint" text;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD CONSTRAINT "ai_providers_live_model" CHECK (coalesce(length("commerce"."ai_providers"."live_model") between 1 and 200, true) and coalesce(length("commerce"."ai_providers"."live_voice") between 1 and 100, true));--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD CONSTRAINT "ai_providers_live_provider" CHECK (coalesce("commerce"."ai_providers"."live_provider" in ('gateway', 'mistral', 'openai', 'openai_eu', 'google', 'custom'), true));--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD CONSTRAINT "ai_providers_live_base_url" CHECK (("commerce"."ai_providers"."live_provider" is not distinct from 'custom') = ("commerce"."ai_providers"."live_base_url" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD CONSTRAINT "ai_providers_live_key" CHECK (("commerce"."ai_providers"."live_provider" is null) = ("commerce"."ai_providers"."live_api_key_encrypted" is null) and ("commerce"."ai_providers"."live_api_key_encrypted" is null) = ("commerce"."ai_providers"."live_api_key_hint" is null));