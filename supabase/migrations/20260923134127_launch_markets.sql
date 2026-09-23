-- Launch markets and producer-registration tracking.

-- Norway is in the EEA but not the EU: EU VAT (OSS) does not cover it. Sales
-- of goods under NOK 3,000 go through Norway's VOEC scheme; above that, import
-- VAT and customs apply at the border.
INSERT INTO commerce.markets (code, name, currency, default_locale, locales)
VALUES ('NO', 'Norway', 'NOK', 'nb-NO', ARRAY['nb-NO']);
--> statement-breakpoint

UPDATE commerce.markets SET active = true WHERE code IN ('NO', 'SE', 'DE', 'DK');
--> statement-breakpoint

ALTER TABLE commerce.product_schemes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE commerce.producer_registrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- For every active product and every active market, the producer schemes the
-- product falls under that have no registration valid today. Anything listed
-- here must not be sold in that market until it is registered.
CREATE VIEW commerce.missing_registrations
WITH (security_invoker = true)
AS
SELECT p.id AS product_id, p.handle, m.code AS market_code, ps.scheme
FROM commerce.products p
JOIN commerce.product_schemes ps ON ps.product_id = p.id
CROSS JOIN commerce.markets m
WHERE p.status = 'active'
  AND m.active
  AND NOT EXISTS (
    SELECT 1 FROM commerce.producer_registrations r
     WHERE r.market_code = m.code
       AND r.scheme = ps.scheme
       AND r.valid_from <= current_date
       AND (r.valid_to IS NULL OR r.valid_to >= current_date)
  );
