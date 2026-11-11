-- Tax profile and VAT engine (D157, docs/wave-1a-tax.md): the rules that live in the database.
--
-- * categories are data (`vat_categories`), never deleted, the built-in three never renamed or switched off;
-- * rates have history: `vat_rates` is written only by `commerce.set_vat_rate()` (the old period ends, a new one begins,
--   no overlaps, no back-dating, never edited in place), verified by `commerce.verify_vat_rate()`, and read only by
--   `commerce.vat_rate(country, category, at)` (a missing row is the standard rate);
-- * shipping VAT: a verified per-country rule or the standard rate (`commerce.shipping_vat_rule()`);
-- * a store's tax profile: the seller's number carries its country's prefix, IOSS markets are EU countries, a stored
--   check is the seller's check of that very number;
-- * the check log is immutable;
-- * an order's VAT treatment, relief, shipping rate and check are frozen once it leaves `pending_payment`;
-- * copying: `duplicate_store()` keeps the profile's choices and blanks its numbers, `copy_orders()` carries the kind,
--   relief and shipping rate (never the treatment, a check or a number); `clone_store()` copies nothing (the template
--   has no registration; the row is made on first save).
-- No function here contains DELETE, TRUNCATE or DROP. Seeded rates are all unverified (`verified_at` null).
-- Like every commerce table, row-level security on and no policies: the Data API reaches none of it.

ALTER TABLE commerce.vat_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.shipping_vat_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.store_tax_profile ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.vat_checks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

-- The date a rate takes effect is the country's own date: each country's time zone (a country with several uses its
-- capital's).
UPDATE commerce.countries AS c SET time_zone = v.zone
FROM (VALUES
  ('AT', 'Europe/Vienna'), ('BE', 'Europe/Brussels'), ('BG', 'Europe/Sofia'), ('HR', 'Europe/Zagreb'),
  ('CY', 'Asia/Nicosia'), ('CZ', 'Europe/Prague'), ('DK', 'Europe/Copenhagen'), ('EE', 'Europe/Tallinn'),
  ('FI', 'Europe/Helsinki'), ('FR', 'Europe/Paris'), ('DE', 'Europe/Berlin'), ('GR', 'Europe/Athens'),
  ('HU', 'Europe/Budapest'), ('IE', 'Europe/Dublin'), ('IT', 'Europe/Rome'), ('LV', 'Europe/Riga'),
  ('LT', 'Europe/Vilnius'), ('LU', 'Europe/Luxembourg'), ('MT', 'Europe/Malta'), ('NL', 'Europe/Amsterdam'),
  ('PL', 'Europe/Warsaw'), ('PT', 'Europe/Lisbon'), ('RO', 'Europe/Bucharest'), ('SK', 'Europe/Bratislava'),
  ('SI', 'Europe/Ljubljana'), ('ES', 'Europe/Madrid'), ('SE', 'Europe/Stockholm'), ('NO', 'Europe/Oslo')
) AS v(code, zone)
WHERE c.code = v.code;
--> statement-breakpoint

-- The reduced-rate categories (the built-in three came with the tables).
INSERT INTO commerce.vat_categories (code, name_en, description, sort, active, built_in) VALUES
  ('food', 'Food and drink', 'Food and drink for people, where the country has a reduced rate.', 20, true, false),
  ('books', 'Books', 'Printed books, and e-books where the country applies the reduced rate.', 30, true, false),
  ('periodicals', 'Newspapers and periodicals', 'Newspapers, magazines and periodicals, where the country has a reduced rate.', 40, true, false),
  ('medicines', 'Medicines and medical aids', 'Medicines and medical aids, where the country has a reduced rate.', 50, true, false),
  ('culture_events', 'Culture and events', 'Admission to cultural events, cinemas and attractions, where the country has a reduced rate.', 60, true, false),
  ('children_goods', 'Children''s goods', 'Children''s clothing, footwear and car seats, where the country has a reduced rate.', 70, true, false)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- The standard rate of every country, with history from 1 January 2026. They are the figures Kaizen has had since
-- September 2026 (`countries.standard_vat_rate`); the Commission's database (TEDB) is a script-driven application that
-- was not read, so every row is unverified and says so.
INSERT INTO commerce.vat_rates (country_code, category, rate, valid_from, source, checked_on, note)
SELECT c.code, 'standard', c.standard_vat_rate, DATE '2026-01-01',
       'Kaizen''s table of September 2026 (migration 20260924072554); to check against the Commission''s TEDB, https://ec.europa.eu/taxation_customs/tedb/',
       DATE '2026-09-24',
       'Carried over from countries.standard_vat_rate; not read against TEDB.'
  FROM commerce.countries c
 WHERE c.standard_vat_rate IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Accommodation: the three rows that already existed gain their source and the date it was checked.
UPDATE commerce.vat_rates SET
  source = 'Skatteetaten, https://www.skatteetaten.no/en/rates/value-added-tax/ (letting of rooms, 12 %)',
  checked_on = DATE '2026-10-03',
  note = 'Page read on 2026-10-03.'
WHERE country_code = 'NO' AND category = 'accommodation';
--> statement-breakpoint
UPDATE commerce.vat_rates SET
  source = 'Skatteverket, https://www.skatteverket.se/foretag/moms/saljavarorochtjanster/momssatsermedmera.4.58d555751259e4d66168000409.html (hotel rooms and camping, 12 %)',
  checked_on = DATE '2026-10-03',
  note = 'Page read on 2026-10-03.'
WHERE country_code = 'SE' AND category = 'accommodation';
--> statement-breakpoint
UPDATE commerce.vat_rates SET
  source = 'Umsatzsteuergesetz section 12(2), https://www.gesetze-im-internet.de/ustg_1980/__12.html (accommodation, 7 %)',
  checked_on = DATE '2026-09-26',
  note = 'The act could not be read on 2026-10-03 (HTTP 503 twice); the rate is from Kaizen''s September 2026 table. Verify.'
WHERE country_code = 'DE' AND category = 'accommodation';
--> statement-breakpoint

-- The reduced rates a source could be read for on 2026-10-03, or (Germany) that Kaizen's earlier table had; everything
-- else is left out: no row means the standard rate, which the coverage page at /admin/platform/vat shows as such. A
-- guessed row is not seeded. Denmark has no reduced rate in these categories, so it has no row. Medicines and
-- children's goods have no row anywhere yet.
INSERT INTO commerce.vat_rates (country_code, category, rate, valid_from, valid_to, source, checked_on, note) VALUES
  ('NO', 'food', 0.1500, DATE '2026-01-01', NULL,
   'Skatteetaten, https://www.skatteetaten.no/en/rates/value-added-tax/ (foodstuffs, 15 %)', DATE '2026-10-03', 'Page read on 2026-10-03.'),
  ('NO', 'culture_events', 0.1200, DATE '2026-01-01', NULL,
   'Skatteetaten, https://www.skatteetaten.no/en/rates/value-added-tax/ (entry to cinemas, sporting events, amusement parks and activity centres, 12 %)', DATE '2026-10-03',
   'Page read on 2026-10-03. Other admissions (theatre, museums) differ: check with an accountant.'),
  ('NO', 'books', 0.0000, DATE '2026-01-01', NULL,
   'Skatteetaten, https://www.skatteetaten.no/en/rates/value-added-tax/ and the VAT Act''s exemption for books', DATE '2026-10-03',
   'Books are exempt from VAT in Norway (no VAT in the price), read here as 0 %. The rates page did not state it when read on 2026-10-03: verify.'),
  ('NO', 'periodicals', 0.0000, DATE '2026-01-01', NULL,
   'Skatteetaten, https://www.skatteetaten.no/en/rates/value-added-tax/ and the VAT Act''s exemption for newspapers and periodicals', DATE '2026-10-03',
   'Exempt from VAT in Norway (no VAT in the price), read here as 0 %. The rates page did not state it when read on 2026-10-03: verify.'),
  ('SE', 'food', 0.1200, DATE '2026-01-01', DATE '2026-04-01',
   'Skatteverket, https://www.skatteverket.se/foretag/moms/saljavarorochtjanster/momssatsermedmera.4.58d555751259e4d66168000409.html', DATE '2026-10-03',
   'The rate before the cut to 6 % on 1 April 2026, which that page names; the 12 % itself is from Kaizen''s earlier table: verify.'),
  ('SE', 'food', 0.0600, DATE '2026-04-01', NULL,
   'Skatteverket, https://www.skatteverket.se/foretag/moms/saljavarorochtjanster/momssatsermedmera.4.58d555751259e4d66168000409.html (food for people, from 1 April 2026)', DATE '2026-10-03',
   'Page read on 2026-10-03. Restaurant meals are a different rate: check with an accountant.'),
  ('SE', 'books', 0.0600, DATE '2026-01-01', NULL,
   'Skatteverket, https://www.skatteverket.se/foretag/moms/saljavarorochtjanster/momssatsermedmera.4.58d555751259e4d66168000409.html (books)', DATE '2026-10-03', 'Page read on 2026-10-03.'),
  ('SE', 'periodicals', 0.0600, DATE '2026-01-01', NULL,
   'Skatteverket, https://www.skatteverket.se/foretag/moms/saljavarorochtjanster/momssatsermedmera.4.58d555751259e4d66168000409.html (newspapers and periodicals)', DATE '2026-10-03',
   'Page read on 2026-10-03. Publications mostly made of advertising are excluded.'),
  ('FI', 'food', 0.1350, DATE '2026-01-01', NULL,
   'Vero.fi, https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/vat/rates-of-vat/ (groceries, from 1 January 2026)', DATE '2026-10-03',
   'Page read on 2026-10-03 (a summary of it, not the page itself): verify the 13.5 %.'),
  ('FI', 'periodicals', 0.1000, DATE '2026-01-01', NULL,
   'Vero.fi, https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/vat/rates-of-vat/ (newspapers and magazines, 10 %)', DATE '2026-10-03',
   'Page read on 2026-10-03 (a summary of it, not the page itself): verify.'),
  ('DE', 'food', 0.0700, DATE '2026-01-01', NULL,
   'Umsatzsteuergesetz section 12(2) and Anlage 2, https://www.gesetze-im-internet.de/ustg_1980/__12.html', DATE '2026-09-26',
   'The act could not be read on 2026-10-03 (HTTP 503 twice); the rate is from Kaizen''s September 2026 table. Restaurant meals differ. Verify.'),
  ('DE', 'books', 0.0700, DATE '2026-01-01', NULL,
   'Umsatzsteuergesetz section 12(2) and Anlage 2, https://www.gesetze-im-internet.de/ustg_1980/__12.html', DATE '2026-09-26',
   'The act could not be read on 2026-10-03 (HTTP 503 twice); the rate is from Kaizen''s September 2026 table. Verify.'),
  ('DE', 'periodicals', 0.0700, DATE '2026-01-01', NULL,
   'Umsatzsteuergesetz section 12(2) and Anlage 2, https://www.gesetze-im-internet.de/ustg_1980/__12.html', DATE '2026-09-26',
   'The act could not be read on 2026-10-03 (HTTP 503 twice); the rate is from Kaizen''s September 2026 table. Verify.')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Shipping takes the standard rate everywhere until a person verifies another rule for a country.
INSERT INTO commerce.shipping_vat_rules (country_code)
SELECT c.code FROM commerce.countries c
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- The plan comparison (D132): the feature is listed, in no plan yet; the platform's admin ticks the plans that include it.
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT 'Selling', 'EU VAT: reduced rates, VAT number check, reverse charge and IOSS marking',
       'Reduced-rate categories per country, the shopper''s EU VAT number checked against VIES for reverse charge, and the store''s OSS and IOSS registration.', 215
WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features WHERE name = 'EU VAT: reduced rates, VAT number check, reverse charge and IOSS marking');
--> statement-breakpoint

-- What shipping was charged at on orders already placed: the country's standard rate (a host's order without VAT, none).
UPDATE commerce.orders AS o SET shipping_tax_rate = CASE WHEN o.host_id IS NOT NULL AND o.tax_minor = 0 THEN 0 ELSE c.standard_vat_rate END
FROM commerce.countries c
WHERE c.code = o.market_code AND o.copied_from IS NULL AND o.shipping_tax_rate IS NULL AND c.standard_vat_rate IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.vat_categories_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'vat_category_kept: a VAT category is never deleted; switch it off' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.code <> OLD.code OR NEW.built_in <> OLD.built_in THEN
    RAISE EXCEPTION 'vat_category_fixed: a category keeps its code' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.built_in AND (NEW.name_en <> OLD.name_en OR NOT NEW.active) THEN
    RAISE EXCEPTION 'vat_category_built_in: a built-in category is not renamed or switched off' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER vat_categories_rules BEFORE UPDATE OR DELETE ON commerce.vat_categories
  FOR EACH ROW EXECUTE FUNCTION commerce.vat_categories_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Rates with history
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.vat_rates_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'vat_rate_history: a rate is never deleted; end its period and add a new one' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM commerce.vat_rates o
       WHERE o.country_code = NEW.country_code AND o.category = NEW.category
         AND NEW.valid_from < coalesce(o.valid_to, 'infinity'::date)
         AND coalesce(NEW.valid_to, 'infinity'::date) > o.valid_from
    ) THEN
      RAISE EXCEPTION 'vat_rate_overlap: the period overlaps another rate of the same country and category'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: a period may be ended once, a rate verified or its note changed; nothing else.
  IF NEW.country_code <> OLD.country_code OR NEW.category <> OLD.category OR NEW.rate <> OLD.rate
     OR NEW.valid_from <> OLD.valid_from OR NEW.source <> OLD.source OR NEW.checked_on <> OLD.checked_on
     OR NEW.created_at <> OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'vat_rate_history: a rate is never edited in place; end its period and add a new one'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.valid_to IS NOT NULL AND NEW.valid_to IS DISTINCT FROM OLD.valid_to THEN
    RAISE EXCEPTION 'vat_rate_history: an ended period is not changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.verified_at IS NOT NULL AND (NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.verified_by IS DISTINCT FROM OLD.verified_by) THEN
    RAISE EXCEPTION 'vat_rate_verified: a verification is not taken back; add a new rate with a note' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER vat_rates_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.vat_rates
  FOR EACH ROW EXECUTE FUNCTION commerce.vat_rates_rules();
--> statement-breakpoint

-- The VAT rate for a kind of sale in a country on a day: none when exempt, the category's own rate where there is one,
-- else the standard rate on that day, else the country's cached standard rate, else 0. The day is the country's own
-- date (its time zone), so a rate that starts on 1 July starts at midnight there. The only reader of a product's rate.
CREATE FUNCTION commerce.vat_rate(p_country char(2), p_category text, p_at timestamptz)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_category = 'exempt' THEN 0::numeric
    ELSE coalesce(
      (SELECT r.rate FROM commerce.countries c
         JOIN commerce.vat_rates r ON r.country_code = c.code AND r.category = p_category
          AND r.valid_from <= (p_at AT TIME ZONE coalesce(c.time_zone, 'UTC'))::date
          AND (r.valid_to IS NULL OR r.valid_to > (p_at AT TIME ZONE coalesce(c.time_zone, 'UTC'))::date)
        WHERE c.code = p_country),
      (SELECT r.rate FROM commerce.countries c
         JOIN commerce.vat_rates r ON r.country_code = c.code AND r.category = 'standard'
          AND r.valid_from <= (p_at AT TIME ZONE coalesce(c.time_zone, 'UTC'))::date
          AND (r.valid_to IS NULL OR r.valid_to > (p_at AT TIME ZONE coalesce(c.time_zone, 'UTC'))::date)
        WHERE c.code = p_country),
      (SELECT c.standard_vat_rate FROM commerce.countries c WHERE c.code = p_country),
      0::numeric
    )
  END
$$;
--> statement-breakpoint

-- The two-argument form stays, as now: the rate today. It carries its own copy of the body (a SQL function with a
-- fixed search_path is not inlined, and one calling another is some twenty times slower per call, which the catalogue
-- pays per product); a test holds the two to the same answer for every country and category.
CREATE OR REPLACE FUNCTION commerce.vat_rate(p_country char(2), p_category text)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_category = 'exempt' THEN 0::numeric
    ELSE coalesce(
      (SELECT r.rate FROM commerce.countries c
         JOIN commerce.vat_rates r ON r.country_code = c.code AND r.category = p_category
          AND r.valid_from <= (now() AT TIME ZONE coalesce(c.time_zone, 'UTC'))::date
          AND (r.valid_to IS NULL OR r.valid_to > (now() AT TIME ZONE coalesce(c.time_zone, 'UTC'))::date)
        WHERE c.code = p_country),
      (SELECT r.rate FROM commerce.countries c
         JOIN commerce.vat_rates r ON r.country_code = c.code AND r.category = 'standard'
          AND r.valid_from <= (now() AT TIME ZONE coalesce(c.time_zone, 'UTC'))::date
          AND (r.valid_to IS NULL OR r.valid_to > (now() AT TIME ZONE coalesce(c.time_zone, 'UTC'))::date)
        WHERE c.code = p_country),
      (SELECT c.standard_vat_rate FROM commerce.countries c WHERE c.code = p_country),
      0::numeric
    )
  END
$$;
--> statement-breakpoint

-- The only writer of a rate (like prices through commerce.set_price): the open period of the category in the country
-- ends on `p_valid_from`, a new one begins, and `vat.rate_set` is written to the audit log in the same transaction.
-- A date in the future is a scheduled change. Refuses `exempt`, an unknown country or category, a date that is not
-- after the start of the latest period, and (by the trigger) an overlap.
CREATE FUNCTION commerce.set_vat_rate(
  p_country char(2), p_category text, p_rate numeric, p_valid_from date, p_source text, p_checked_on date,
  p_note text, p_account uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_latest date;
  v_previous numeric;
BEGIN
  IF p_category = 'exempt' THEN
    RAISE EXCEPTION 'vat_rate_exempt: exempt goods always carry no VAT and have no rate' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.countries c WHERE c.code = p_country) THEN
    RAISE EXCEPTION 'vat_rate_country: unknown country %', p_country USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.vat_categories k WHERE k.code = p_category) THEN
    RAISE EXCEPTION 'vat_rate_category: unknown category %', p_category USING ERRCODE = 'check_violation';
  END IF;
  IF p_rate IS NULL OR p_rate < 0 OR p_rate >= 1 THEN
    RAISE EXCEPTION 'vat_rate_value: a rate is a fraction from 0 up to, not including, 1' USING ERRCODE = 'check_violation';
  END IF;
  IF p_valid_from IS NULL OR p_checked_on IS NULL THEN
    RAISE EXCEPTION 'vat_rate_dates: a rate needs the date it starts and the date it was checked' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('vat_rate:' || p_country || ':' || p_category, 0));

  SELECT max(r.valid_from) INTO v_latest
    FROM commerce.vat_rates r WHERE r.country_code = p_country AND r.category = p_category;
  IF v_latest IS NOT NULL AND p_valid_from <= v_latest THEN
    RAISE EXCEPTION 'vat_rate_backdated: the new rate must start after the latest one (%); correct a mistake by adding a rate with a note', v_latest
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT r.rate INTO v_previous
    FROM commerce.vat_rates r
   WHERE r.country_code = p_country AND r.category = p_category AND r.valid_to IS NULL;

  UPDATE commerce.vat_rates SET valid_to = p_valid_from
   WHERE country_code = p_country AND category = p_category AND valid_to IS NULL;

  INSERT INTO commerce.vat_rates (country_code, category, rate, valid_from, source, checked_on, note, created_by)
  VALUES (p_country, p_category, p_rate, p_valid_from, p_source, p_checked_on, coalesce(p_note, ''), p_account);

  -- The country's cached standard rate follows the standard category (a date in the future by sync_standard_vat_rates()).
  IF p_category = 'standard' THEN
    UPDATE commerce.countries SET standard_vat_rate = commerce.vat_rate(p_country, 'standard', now()) WHERE code = p_country;
  END IF;

  INSERT INTO commerce.audit_log (store_id, account_id, action, details)
  VALUES (NULL, p_account, 'vat.rate_set', jsonb_build_object(
    'country', p_country, 'category', p_category, 'rate', p_rate, 'previous_rate', v_previous,
    'valid_from', p_valid_from, 'source', p_source, 'checked_on', p_checked_on));
END;
$$;
--> statement-breakpoint

-- A person has checked a rate (with an accountant): who and when. Once; a later change is a new rate.
CREATE FUNCTION commerce.verify_vat_rate(p_country char(2), p_category text, p_valid_from date, p_account uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_account IS NULL THEN
    RAISE EXCEPTION 'vat_rate_verified: a verification names the person who made it' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE commerce.vat_rates SET verified_by = p_account, verified_at = now()
   WHERE country_code = p_country AND category = p_category AND valid_from = p_valid_from AND verified_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vat_rate_verified: no such rate, or it is already verified' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO commerce.audit_log (store_id, account_id, action, details)
  VALUES (NULL, p_account, 'vat.rate_verified', jsonb_build_object(
    'country', p_country, 'category', p_category, 'valid_from', p_valid_from));
END;
$$;
--> statement-breakpoint

-- The countries' cached standard rate follows the standard category's rate in force today, so a change dated in the
-- future takes effect on its day (the daily job calls this). How many countries changed.
CREATE FUNCTION commerce.sync_standard_vat_rates()
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_changed integer;
BEGIN
  WITH today AS (
    SELECT c.code,
           (SELECT r.rate FROM commerce.vat_rates r
             WHERE r.country_code = c.code AND r.category = 'standard'
               AND r.valid_from <= (now() AT TIME ZONE coalesce(c.time_zone, 'UTC'))::date
               AND (r.valid_to IS NULL OR r.valid_to > (now() AT TIME ZONE coalesce(c.time_zone, 'UTC'))::date)) AS rate
      FROM commerce.countries c
  )
  UPDATE commerce.countries c SET standard_vat_rate = t.rate
    FROM today t
   WHERE t.code = c.code AND t.rate IS NOT NULL AND c.standard_vat_rate IS DISTINCT FROM t.rate;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Shipping VAT
-- ---------------------------------------------------------------------------

-- The rule for a country, only when a person has verified it; an unverified row never changes what is charged.
CREATE FUNCTION commerce.shipping_vat_rule(p_country char(2))
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT s.rule FROM commerce.shipping_vat_rules s WHERE s.country_code = p_country AND s.verified_at IS NOT NULL),
    'standard'
  )
$$;
--> statement-breakpoint

-- Sets a country's rule; verified (by `p_account`, with its source and the date checked) or not. Audit-logged.
CREATE FUNCTION commerce.set_shipping_vat_rule(
  p_country char(2), p_rule text, p_source text, p_checked_on date, p_note text, p_verified boolean, p_account uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.countries c WHERE c.code = p_country) THEN
    RAISE EXCEPTION 'shipping_vat_country: unknown country %', p_country USING ERRCODE = 'check_violation';
  END IF;
  IF p_verified AND (p_account IS NULL OR p_checked_on IS NULL OR length(trim(coalesce(p_source, ''))) < 8) THEN
    RAISE EXCEPTION 'shipping_vat_verified: a verified rule names its source, the date checked and the person' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO commerce.shipping_vat_rules (country_code, rule, source, checked_on, note, verified_by, verified_at, updated_at)
  VALUES (p_country, p_rule, coalesce(p_source, ''), p_checked_on, coalesce(p_note, ''),
          CASE WHEN p_verified THEN p_account END, CASE WHEN p_verified THEN now() END, now())
  ON CONFLICT (country_code) DO UPDATE SET
    rule = EXCLUDED.rule, source = EXCLUDED.source, checked_on = EXCLUDED.checked_on, note = EXCLUDED.note,
    verified_by = EXCLUDED.verified_by, verified_at = EXCLUDED.verified_at, updated_at = now();
  INSERT INTO commerce.audit_log (store_id, account_id, action, details)
  VALUES (NULL, p_account, 'vat.shipping_rule_set', jsonb_build_object(
    'country', p_country, 'rule', p_rule, 'verified', p_verified, 'source', p_source, 'checked_on', p_checked_on));
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A store's tax profile
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.store_tax_profile_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_country char(2);
  v_prefix text;
  v_check record;
BEGIN
  -- The seller's number belongs to the country the store is in (Greece's prefix is EL).
  IF NEW.vat_number IS NOT NULL THEN
    SELECT s.country INTO v_country FROM commerce.stores s WHERE s.id = NEW.store_id;
    IF v_country IS NOT NULL THEN
      v_prefix := CASE WHEN v_country = 'GR' THEN 'EL' ELSE v_country END;
      IF left(NEW.vat_number, 2) <> v_prefix THEN
        RAISE EXCEPTION 'tax_profile_vat_prefix: the VAT number must be one of the store''s own country (%)', v_prefix
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- IOSS applies to EU markets, each once.
  IF cardinality(NEW.ioss_markets) > 0 THEN
    IF EXISTS (SELECT 1 FROM unnest(NEW.ioss_markets) AS m WHERE NOT commerce.is_eu_country(m::char(2))) THEN
      RAISE EXCEPTION 'tax_profile_ioss_markets: IOSS markets are EU countries' USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT count(DISTINCT m) FROM unnest(NEW.ioss_markets) AS m) <> cardinality(NEW.ioss_markets) THEN
      RAISE EXCEPTION 'tax_profile_ioss_markets: a market is listed once' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- The Union scheme is registered in an EU member state.
  IF NEW.oss_scheme = 'union' AND NOT commerce.is_eu_country(NEW.oss_member_state) THEN
    RAISE EXCEPTION 'tax_profile_oss_member_state: the Union scheme is registered in an EU member state' USING ERRCODE = 'check_violation';
  END IF;

  -- A stored check is the seller's check of this very number, and its result is copied faithfully.
  IF NEW.vat_number_check_id IS NOT NULL THEN
    SELECT c.number, c.purpose, c.status INTO v_check
      FROM commerce.vat_checks c WHERE c.store_id = NEW.store_id AND c.id = NEW.vat_number_check_id;
    IF v_check.number IS DISTINCT FROM NEW.vat_number OR v_check.purpose IS DISTINCT FROM 'seller' THEN
      RAISE EXCEPTION 'tax_profile_check: the stored check is not the seller''s check of this number' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.vat_number_valid IS DISTINCT FROM (CASE v_check.status WHEN 'valid' THEN true WHEN 'invalid' THEN false END) THEN
      RAISE EXCEPTION 'tax_profile_check: the stored result is not the check''s result' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.vat_number_valid IS NOT NULL OR NEW.vat_number_checked_at IS NOT NULL THEN
    RAISE EXCEPTION 'tax_profile_check: a result needs the check it comes from' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER store_tax_profile_rules BEFORE INSERT OR UPDATE ON commerce.store_tax_profile
  FOR EACH ROW EXECUTE FUNCTION commerce.store_tax_profile_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The check log
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.vat_checks_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'vat_check_immutable: a VAT number check is a record and is not changed' USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER vat_checks_immutable BEFORE UPDATE ON commerce.vat_checks
  FOR EACH ROW EXECUTE FUNCTION commerce.vat_checks_immutable();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

-- What VAT an order carries is decided when it is placed and never changes once it has left `pending_payment`: not the
-- kind, the relief, the shipping rate, the treatment or the check it rests on.
CREATE FUNCTION commerce.orders_vat_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status <> 'pending_payment' AND (
       NEW.vat_kind IS DISTINCT FROM OLD.vat_kind
    OR NEW.vat_relief_minor IS DISTINCT FROM OLD.vat_relief_minor
    OR NEW.vat_treatment IS DISTINCT FROM OLD.vat_treatment
    OR NEW.shipping_tax_rate IS DISTINCT FROM OLD.shipping_tax_rate
    OR NEW.vat_check_id IS DISTINCT FROM OLD.vat_check_id
  ) THEN
    RAISE EXCEPTION 'order_vat_frozen: the VAT treatment of an order is fixed once it has left pending payment'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_vat_frozen BEFORE UPDATE OF vat_kind, vat_relief_minor, vat_treatment, shipping_tax_rate, vat_check_id
  ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.orders_vat_frozen();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Copying (the live definitions are patched, one change each, so a later change to either is not lost; each patch says
-- so loudly if the line it patches is not where it was)
-- ---------------------------------------------------------------------------

-- A copy of a store keeps its tax choices but never its numbers: a number belongs to one legal entity, and reverse
-- charge stays off in the copy until its owner has checked a number of their own. `clone_store()` copies nothing.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('commerce.store_tax_profile' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'  RETURN v_store;\nEND;',
    $r$  -- The tax profile's choices (D157); never a VAT, OSS or IOSS number, a check or a registration date.
  INSERT INTO commerce.store_tax_profile (
    store_id, vat_registered, oss_scheme, oss_member_state, dispatch_country, ioss_markets, updated_by
  )
  SELECT v_store, vat_registered, oss_scheme, oss_member_state, dispatch_country, ioss_markets, p_owner
    FROM commerce.store_tax_profile WHERE store_id = p_source;

  RETURN v_store;
END;$r$
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: its last statement was not found, so the tax profile is not copied'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- A copied order (D129) keeps its VAT kind, relief and shipping rate so that the database's checks hold on what was
-- copied (its discount includes the relief); never the treatment, a check or a VAT number.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_next text;
BEGIN
  v_def := pg_get_functiondef('commerce.copy_orders(uuid, uuid, uuid, integer)'::regprocedure);
  IF position('vat_relief_minor' IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;

  v_next := replace(v_new, 'company_name, organisation_number, copied_from', 'company_name, organisation_number, copied_from, vat_kind, vat_relief_minor, shipping_tax_rate');
  IF v_next = v_new THEN RAISE EXCEPTION 'copy_orders: the order columns were not found, so the VAT kind is not copied'; END IF;
  v_new := v_next;

  v_next := replace(v_new, 'o.company_name, o.organisation_number, o.id', 'o.company_name, o.organisation_number, o.id, o.vat_kind, o.vat_relief_minor, o.shipping_tax_rate');
  IF v_next = v_new THEN RAISE EXCEPTION 'copy_orders: the order values were not found, so the VAT kind is not copied'; END IF;
  v_new := v_next;

  v_next := replace(v_new, 'gift, campaign_parts, unit_cost_minor', 'gift, campaign_parts, unit_cost_minor, vat_relief_minor');
  IF v_next = v_new THEN RAISE EXCEPTION 'copy_orders: the line columns were not found, so the line relief is not copied'; END IF;
  v_new := v_next;

  v_next := replace(v_new, 'l.gift, l.campaign_parts, l.unit_cost_minor', 'l.gift, l.campaign_parts, l.unit_cost_minor, l.vat_relief_minor');
  IF v_next = v_new THEN RAISE EXCEPTION 'copy_orders: the line values were not found, so the line relief is not copied'; END IF;
  v_new := v_next;

  EXECUTE v_new;
END
$patch$;
