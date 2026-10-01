-- Prices for what is not tokens (D146): a picture, a minute of audio (speech to text, live voice calls) and a million characters
-- spoken. Null means the model has no such price, and usage in that unit then shows as unpriced.
ALTER TABLE "commerce"."ai_model_prices" DROP CONSTRAINT "ai_model_prices_amounts";--> statement-breakpoint
ALTER TABLE "commerce"."ai_model_prices" ADD COLUMN "per_image" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "commerce"."ai_model_prices" ADD COLUMN "per_audio_minute" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "commerce"."ai_model_prices" ADD COLUMN "per_million_characters" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "commerce"."ai_model_prices" ADD CONSTRAINT "ai_model_prices_amounts" CHECK ("commerce"."ai_model_prices"."input_per_million" >= 0 and "commerce"."ai_model_prices"."output_per_million" >= 0 and "commerce"."ai_model_prices"."per_image" >= 0 and "commerce"."ai_model_prices"."per_audio_minute" >= 0 and "commerce"."ai_model_prices"."per_million_characters" >= 0);