ALTER TABLE "commerce"."ai_providers" ADD COLUMN "image_model" text;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD COLUMN "image_provider" text;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD COLUMN "image_base_url" text;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD COLUMN "image_api_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD COLUMN "image_api_key_hint" text;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD COLUMN "image_quality" text;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD CONSTRAINT "ai_providers_image_model" CHECK (coalesce(length("commerce"."ai_providers"."image_model") between 1 and 200, true));--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD CONSTRAINT "ai_providers_image_provider" CHECK (coalesce("commerce"."ai_providers"."image_provider" in ('gateway', 'mistral', 'openai', 'openai_eu', 'google', 'custom'), true));--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD CONSTRAINT "ai_providers_image_base_url" CHECK (("commerce"."ai_providers"."image_provider" is not distinct from 'custom') = ("commerce"."ai_providers"."image_base_url" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD CONSTRAINT "ai_providers_image_key" CHECK (("commerce"."ai_providers"."image_provider" is null) = ("commerce"."ai_providers"."image_api_key_encrypted" is null) and ("commerce"."ai_providers"."image_api_key_encrypted" is null) = ("commerce"."ai_providers"."image_api_key_hint" is null));--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD CONSTRAINT "ai_providers_image_quality" CHECK (coalesce("commerce"."ai_providers"."image_quality" in ('low', 'medium', 'high', 'auto'), true));