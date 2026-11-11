-- D31: discount codes. Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.discount_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.platform_discount_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Amounts and minimums are objects of market (or currency) to minor units;
-- the product list, when set, is an array of product ids.
ALTER TABLE commerce.discount_codes ADD CONSTRAINT discount_codes_json_shapes CHECK (
  jsonb_typeof(amounts) = 'object' AND jsonb_typeof(min_subtotals) = 'object'
  AND (product_ids IS NULL OR jsonb_typeof(product_ids) = 'array')
);
--> statement-breakpoint
ALTER TABLE commerce.platform_discount_codes ADD CONSTRAINT platform_discount_codes_amounts_object
  CHECK (jsonb_typeof(amounts) = 'object');
--> statement-breakpoint

-- A store's code is written in capitals, so codes differ by more than case.
ALTER TABLE commerce.discount_codes ADD CONSTRAINT discount_codes_upper CHECK (code = upper(code));
--> statement-breakpoint
ALTER TABLE commerce.platform_discount_codes ADD CONSTRAINT platform_discount_codes_upper CHECK (code = upper(code));
