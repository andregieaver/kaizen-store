-- The first price sheet's founding prices (D748 step E6, docs/extensions.md 12): per month in euro; NOK is ×10 and yearly is 10× monthly,
-- as for the list prices E2 seeded. A price is given its founding price only while its amount is still the sheet's list price, so an
-- amount the platform admin has changed is left as they set it. Founding prices are offered only once the platform admin sets
-- platform_settings.extension_founding_until (none now), for extension_founding_months (12).
WITH sheet(extension_id, position, list_minor, founding_minor) AS (
  VALUES ('ab_testing', 0, 2900, 1900),
         ('support_desk', 0, 3900, 2900),
         ('email_automation', 0, 2500, 1900),
         ('email_automation', 1, 5900, 4900),
         ('email_automation', 2, 11900, 9900),
         ('email_automation', 3, 19900, 17900),
         ('work', 0, 3500, 2500),
         ('deals', 0, 3500, 2900)
), factor AS (
  SELECT ep.id,
         (CASE ep.currency WHEN 'NOK' THEN 10 ELSE 1 END) * (CASE ep.interval WHEN 'year' THEN 10 ELSE 1 END) AS times
    FROM commerce.extension_prices ep WHERE ep.currency IN ('EUR', 'NOK')
)
UPDATE commerce.extension_prices ep
   SET founding_minor = sheet.founding_minor * factor.times
  FROM commerce.extension_sizes es, sheet, factor
 WHERE es.id = ep.size_id AND es.extension_id = sheet.extension_id AND es.position = sheet.position AND factor.id = ep.id
   AND ep.active AND ep.founding_minor IS NULL AND ep.amount_minor = sheet.list_minor * factor.times;
--> statement-breakpoint
WITH sheet(name, list_minor, founding_minor) AS (VALUES ('Customers', 8500, 5900), ('Everything', 11900, 8900)),
factor AS (
  SELECT bp.id, (CASE bp.currency WHEN 'NOK' THEN 10 ELSE 1 END) * (CASE bp.interval WHEN 'year' THEN 10 ELSE 1 END) AS times
    FROM commerce.extension_bundle_prices bp WHERE bp.currency IN ('EUR', 'NOK')
)
UPDATE commerce.extension_bundle_prices bp
   SET founding_minor = sheet.founding_minor * factor.times
  FROM commerce.extension_bundles b, sheet, factor
 WHERE b.id = bp.bundle_id AND b.name = sheet.name AND factor.id = bp.id
   AND bp.active AND bp.founding_minor IS NULL AND bp.amount_minor = sheet.list_minor * factor.times;
