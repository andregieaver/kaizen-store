CREATE TABLE "commerce"."ai_model_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_per_million" numeric(14, 6) NOT NULL,
	"output_per_million" numeric(14, 6) NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ai_model_prices_key" UNIQUE("provider","model","effective_from"),
	CONSTRAINT "ai_model_prices_amounts" CHECK ("commerce"."ai_model_prices"."input_per_million" >= 0 and "commerce"."ai_model_prices"."output_per_million" >= 0),
	CONSTRAINT "ai_model_prices_names" CHECK (length("commerce"."ai_model_prices"."provider") between 1 and 60 and length("commerce"."ai_model_prices"."model") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "commerce"."ai_model_prices" ADD CONSTRAINT "ai_model_prices_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_model_prices_created_by_idx" ON "commerce"."ai_model_prices" USING btree ("created_by");--> statement-breakpoint
-- Private, read and written only by server code with a direct connection.
ALTER TABLE commerce.ai_model_prices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The models the platform's usage already shows, priced from their providers' lists when this was added (US dollars per
-- million tokens), counting from the beginning so earlier usage is priced too. The platform's admin checks and changes them.
INSERT INTO commerce.ai_model_prices (provider, model, input_per_million, output_per_million, effective_from, note) VALUES
  ('openai', 'gpt-5-mini', 0.25, 2.00, '2000-01-01', 'From the provider''s price list when added: check it is current.'),
  ('openai', 'gpt-4.1-mini', 0.40, 1.60, '2000-01-01', 'From the provider''s price list when added: check it is current.'),
  ('openai', 'text-embedding-3-small', 0.02, 0, '2000-01-01', 'From the provider''s price list when added: check it is current.');
