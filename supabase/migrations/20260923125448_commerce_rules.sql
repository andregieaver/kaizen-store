-- Rules the database enforces on the commerce schema: price history, the
-- 30-day prior price, gap-free document numbers, append-only records, the
-- product-safety publishing check, row-level security, and reference data.

-- EU member states ------------------------------------------------------------

CREATE FUNCTION commerce.is_eu_country(p_code char(2))
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_code = ANY (ARRAY[
    'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
    'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'
  ]::char(2)[]);
$$;
--> statement-breakpoint

-- Append-only records ---------------------------------------------------------

CREATE FUNCTION commerce.forbid_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'commerce.% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER order_events_append_only
  BEFORE UPDATE OR DELETE ON commerce.order_events
  FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();
--> statement-breakpoint

CREATE TRIGGER invoices_append_only
  BEFORE UPDATE OR DELETE ON commerce.invoices
  FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();
--> statement-breakpoint

CREATE TRIGGER credit_notes_append_only
  BEFORE UPDATE OR DELETE ON commerce.credit_notes
  FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();
--> statement-breakpoint

-- Price history ----------------------------------------------------------------

-- A price row may only ever be closed (valid_to set once). Anything else would
-- rewrite the history the 30-day prior price is computed from.
CREATE FUNCTION commerce.guard_price_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commerce.prices is append-only; DELETE is not allowed'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.valid_to IS NOT NULL
     OR NEW.valid_to IS NULL
     OR NEW.variant_id IS DISTINCT FROM OLD.variant_id
     OR NEW.market_code IS DISTINCT FROM OLD.market_code
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from THEN
    RAISE EXCEPTION 'commerce.prices rows can only be closed, not changed'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER prices_guard_history
  BEFORE UPDATE OR DELETE ON commerce.prices
  FOR EACH ROW EXECUTE FUNCTION commerce.guard_price_history();
--> statement-breakpoint

-- Sets a variant's price in a market from p_at onwards, closing the current
-- price. Returns the id of the price row now in force.
CREATE FUNCTION commerce.set_price(
  p_variant_id uuid,
  p_market_code char(2),
  p_amount_minor bigint,
  p_at timestamptz DEFAULT now()
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_current commerce.prices%ROWTYPE;
  v_currency char(3);
  v_id bigint;
BEGIN
  SELECT currency INTO v_currency
    FROM commerce.markets
   WHERE code = p_market_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown market %', p_market_code;
  END IF;

  SELECT * INTO v_current
    FROM commerce.prices
   WHERE variant_id = p_variant_id
     AND market_code = p_market_code
     AND valid_to IS NULL
     FOR UPDATE;

  IF FOUND THEN
    IF v_current.amount_minor = p_amount_minor THEN
      RETURN v_current.id;
    END IF;
    IF p_at <= v_current.valid_from THEN
      RAISE EXCEPTION 'a new price must start after the current one (%)',
        v_current.valid_from;
    END IF;
    UPDATE commerce.prices SET valid_to = p_at WHERE id = v_current.id;
  END IF;

  INSERT INTO commerce.prices (variant_id, market_code, currency, amount_minor, valid_from)
  VALUES (p_variant_id, p_market_code, v_currency, p_amount_minor, p_at)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- The lowest price in force at any point in the 30 days before p_at. This is
-- the reference any advertised reduction starting at p_at must be measured
-- against (Price Indication Directive Art. 6a; CJEU C-330/23 Aldi Süd).
CREATE FUNCTION commerce.prior_price(
  p_variant_id uuid,
  p_market_code char(2),
  p_at timestamptz
)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT min(amount_minor)
    FROM commerce.prices
   WHERE variant_id = p_variant_id
     AND market_code = p_market_code
     AND valid_from < p_at
     AND coalesce(valid_to, 'infinity'::timestamptz) > p_at - interval '30 days';
$$;
--> statement-breakpoint

-- Current prices with their 30-day reference. A reduction may be advertised
-- only when amount_minor < prior_30d_minor, and only against prior_30d_minor.
CREATE VIEW commerce.current_prices
WITH (security_invoker = true)
AS
SELECT
  p.variant_id,
  p.market_code,
  p.currency,
  p.amount_minor,
  p.valid_from,
  commerce.prior_price(p.variant_id, p.market_code, p.valid_from) AS prior_30d_minor
FROM commerce.prices p
WHERE p.valid_to IS NULL;
--> statement-breakpoint

-- Stock --------------------------------------------------------------------------

CREATE VIEW commerce.available_stock
WITH (security_invoker = true)
AS
SELECT
  l.variant_id,
  l.location_id,
  l.on_hand,
  l.on_hand - coalesce(r.reserved, 0) AS available
FROM commerce.inventory_levels l
LEFT JOIN (
  SELECT variant_id, location_id, sum(quantity) AS reserved
    FROM commerce.inventory_reservations
   WHERE released_at IS NULL
     AND expires_at > now()
   GROUP BY variant_id, location_id
) r USING (variant_id, location_id);
--> statement-breakpoint

-- Document numbers ---------------------------------------------------------------

-- Takes the next number in a series. The row lock taken by UPDATE serialises
-- concurrent callers, and a rolled-back transaction gives its number back, so
-- issued documents have no gaps. Call it in the transaction that inserts the
-- invoice or credit note.
CREATE FUNCTION commerce.next_document_number(p_series text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_number bigint;
BEGIN
  UPDATE commerce.document_series
     SET next_number = next_number + 1
   WHERE series = p_series
  RETURNING next_number - 1 INTO v_number;

  IF v_number IS NULL THEN
    RAISE EXCEPTION 'unknown document series %', p_series;
  END IF;

  RETURN v_number;
END;
$$;
--> statement-breakpoint

-- Product safety (GPSR Art. 19) -----------------------------------------------------

-- A product can only be active when its listing can carry what GPSR requires:
-- a manufacturer, an EU responsible person when the manufacturer is outside
-- the EU, a picture, a titled translation, and an active variant (whose SKU
-- identifies it). Per-locale safety text is checked by the publishing flow,
-- which knows the markets the product is sold in.
CREATE FUNCTION commerce.assert_product_publishable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_manufacturer_country char(2);
  v_responsible_country char(2);
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  IF NEW.manufacturer_id IS NULL THEN
    RAISE EXCEPTION 'product % cannot be active without a manufacturer', NEW.handle
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT country INTO v_manufacturer_country
    FROM commerce.economic_operators WHERE id = NEW.manufacturer_id;

  IF NOT commerce.is_eu_country(v_manufacturer_country) THEN
    SELECT country INTO v_responsible_country
      FROM commerce.economic_operators WHERE id = NEW.responsible_person_id;
    IF v_responsible_country IS NULL
       OR NOT commerce.is_eu_country(v_responsible_country) THEN
      RAISE EXCEPTION 'product % has a non-EU manufacturer and needs an EU responsible person', NEW.handle
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM commerce.product_media WHERE product_id = NEW.id) THEN
    RAISE EXCEPTION 'product % cannot be active without a picture', NEW.handle
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM commerce.product_translations
     WHERE product_id = NEW.id AND btrim(title) <> ''
  ) THEN
    RAISE EXCEPTION 'product % cannot be active without a title', NEW.handle
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM commerce.product_variants
     WHERE product_id = NEW.id AND active
  ) THEN
    RAISE EXCEPTION 'product % cannot be active without an active variant', NEW.handle
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER products_publishable
  BEFORE INSERT OR UPDATE ON commerce.products
  FOR EACH ROW EXECUTE FUNCTION commerce.assert_product_publishable();
--> statement-breakpoint

-- Row-level security -------------------------------------------------------------

-- The commerce schema is not exposed through the Data API, and server code
-- connects as the table owner, which bypasses RLS. Enabling it with no
-- policies means that if the schema is ever exposed by mistake, the answer is
-- still "no rows" rather than everything.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'commerce' LOOP
    EXECUTE format('ALTER TABLE commerce.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END;
$$;
--> statement-breakpoint

-- Reference data ------------------------------------------------------------------

-- Every EU member state, inactive until chosen as a launch market. Locales are
-- the official languages; add others (such as English) per market as needed.
INSERT INTO commerce.markets (code, name, currency, default_locale, locales) VALUES
  ('AT', 'Austria',     'EUR', 'de-AT', ARRAY['de-AT']),
  ('BE', 'Belgium',     'EUR', 'nl-BE', ARRAY['nl-BE','fr-BE','de-BE']),
  ('BG', 'Bulgaria',    'EUR', 'bg-BG', ARRAY['bg-BG']),
  ('HR', 'Croatia',     'EUR', 'hr-HR', ARRAY['hr-HR']),
  ('CY', 'Cyprus',      'EUR', 'el-CY', ARRAY['el-CY']),
  ('CZ', 'Czechia',     'CZK', 'cs-CZ', ARRAY['cs-CZ']),
  ('DK', 'Denmark',     'DKK', 'da-DK', ARRAY['da-DK']),
  ('EE', 'Estonia',     'EUR', 'et-EE', ARRAY['et-EE']),
  ('FI', 'Finland',     'EUR', 'fi-FI', ARRAY['fi-FI','sv-FI']),
  ('FR', 'France',      'EUR', 'fr-FR', ARRAY['fr-FR']),
  ('DE', 'Germany',     'EUR', 'de-DE', ARRAY['de-DE']),
  ('GR', 'Greece',      'EUR', 'el-GR', ARRAY['el-GR']),
  ('HU', 'Hungary',     'HUF', 'hu-HU', ARRAY['hu-HU']),
  ('IE', 'Ireland',     'EUR', 'en-IE', ARRAY['en-IE','ga-IE']),
  ('IT', 'Italy',       'EUR', 'it-IT', ARRAY['it-IT']),
  ('LV', 'Latvia',      'EUR', 'lv-LV', ARRAY['lv-LV']),
  ('LT', 'Lithuania',   'EUR', 'lt-LT', ARRAY['lt-LT']),
  ('LU', 'Luxembourg',  'EUR', 'fr-LU', ARRAY['fr-LU','de-LU','lb-LU']),
  ('MT', 'Malta',       'EUR', 'mt-MT', ARRAY['mt-MT','en-MT']),
  ('NL', 'Netherlands', 'EUR', 'nl-NL', ARRAY['nl-NL']),
  ('PL', 'Poland',      'PLN', 'pl-PL', ARRAY['pl-PL']),
  ('PT', 'Portugal',    'EUR', 'pt-PT', ARRAY['pt-PT']),
  ('RO', 'Romania',     'RON', 'ro-RO', ARRAY['ro-RO']),
  ('SK', 'Slovakia',    'EUR', 'sk-SK', ARRAY['sk-SK']),
  ('SI', 'Slovenia',    'EUR', 'sl-SI', ARRAY['sl-SI']),
  ('ES', 'Spain',       'EUR', 'es-ES', ARRAY['es-ES']),
  ('SE', 'Sweden',      'SEK', 'sv-SE', ARRAY['sv-SE']);
--> statement-breakpoint

INSERT INTO commerce.document_series (series, prefix) VALUES
  ('invoice', 'INV-'),
  ('credit_note', 'CN-');
