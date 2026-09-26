-- VAT per product (D65). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.vat_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Accommodation's reduced rates (September 2026), to verify with an accountant
-- before launch like the standard rates. Countries without a row here charge
-- the standard rate for accommodation (Denmark has no reduced rate).
INSERT INTO commerce.vat_rates (country_code, category, rate)
SELECT v.code, 'accommodation', v.rate
FROM (VALUES ('NO', 0.12), ('SE', 0.12), ('DE', 0.07)) AS v(code, rate)
JOIN commerce.countries c ON c.code = v.code
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- The VAT rate for a kind of sale in a country: none when exempt, the
-- category's own rate where there is one, else the standard rate.
CREATE OR REPLACE FUNCTION commerce.vat_rate(p_country char(2), p_category text)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_category = 'exempt' THEN 0::numeric
    ELSE coalesce(
      (SELECT r.rate FROM commerce.vat_rates r WHERE r.country_code = p_country AND r.category = p_category),
      (SELECT c.standard_vat_rate FROM commerce.countries c WHERE c.code = p_country),
      0::numeric
    )
  END
$$;
