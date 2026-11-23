-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection (D880).
ALTER TABLE commerce.extension_extra_prices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE commerce.organisation_extra_charges ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The first price sheet's "beyond" (docs/extensions.md 12), excluding VAT, NOK at ten times the euros: an AI-handled conversation beyond the
-- support desk's allowance, a person beyond Work's and Deals' three. Every number is the platform admin's to change.
INSERT INTO commerce.extension_extra_prices (extension_id, unit, currency, amount_minor)
SELECT x.extension_id, x.unit, x.currency, x.amount_minor
  FROM (VALUES
    ('support_desk', 'ai_conversation', 'EUR', 40), ('support_desk', 'ai_conversation', 'NOK', 400),
    ('work', 'person', 'EUR', 500), ('work', 'person', 'NOK', 5000),
    ('deals', 'person', 'EUR', 800), ('deals', 'person', 'NOK', 8000)
  ) AS x(extension_id, unit, currency, amount_minor)
 WHERE EXISTS (SELECT 1 FROM commerce.extensions e WHERE e.id = x.extension_id)
ON CONFLICT DO NOTHING;
