-- Rules the database enforces, per store: price history, the 30-day prior
-- price, gap-free document numbers, append-only records, the product-safety
-- publishing check, a store always keeping an owner, row-level security, and
-- the country reference data.

-- Countries ---------------------------------------------------------------------

-- Every EU member state, plus Norway. Locales are the official languages; a
-- store can add others (such as English) to its own markets.
INSERT INTO commerce.countries (code, name, currency, default_locale, locales, in_eu) VALUES
  ('AT', 'Austria',     'EUR', 'de-AT', ARRAY['de-AT'], true),
  ('BE', 'Belgium',     'EUR', 'nl-BE', ARRAY['nl-BE','fr-BE','de-BE'], true),
  ('BG', 'Bulgaria',    'EUR', 'bg-BG', ARRAY['bg-BG'], true),
  ('HR', 'Croatia',     'EUR', 'hr-HR', ARRAY['hr-HR'], true),
  ('CY', 'Cyprus',      'EUR', 'el-CY', ARRAY['el-CY'], true),
  ('CZ', 'Czechia',     'CZK', 'cs-CZ', ARRAY['cs-CZ'], true),
  ('DK', 'Denmark',     'DKK', 'da-DK', ARRAY['da-DK'], true),
  ('EE', 'Estonia',     'EUR', 'et-EE', ARRAY['et-EE'], true),
  ('FI', 'Finland',     'EUR', 'fi-FI', ARRAY['fi-FI','sv-FI'], true),
  ('FR', 'France',      'EUR', 'fr-FR', ARRAY['fr-FR'], true),
  ('DE', 'Germany',     'EUR', 'de-DE', ARRAY['de-DE'], true),
  ('GR', 'Greece',      'EUR', 'el-GR', ARRAY['el-GR'], true),
  ('HU', 'Hungary',     'HUF', 'hu-HU', ARRAY['hu-HU'], true),
  ('IE', 'Ireland',     'EUR', 'en-IE', ARRAY['en-IE','ga-IE'], true),
  ('IT', 'Italy',       'EUR', 'it-IT', ARRAY['it-IT'], true),
  ('LV', 'Latvia',      'EUR', 'lv-LV', ARRAY['lv-LV'], true),
  ('LT', 'Lithuania',   'EUR', 'lt-LT', ARRAY['lt-LT'], true),
  ('LU', 'Luxembourg',  'EUR', 'fr-LU', ARRAY['fr-LU','de-LU','lb-LU'], true),
  ('MT', 'Malta',       'EUR', 'mt-MT', ARRAY['mt-MT','en-MT'], true),
  ('NL', 'Netherlands', 'EUR', 'nl-NL', ARRAY['nl-NL'], true),
  ('PL', 'Poland',      'PLN', 'pl-PL', ARRAY['pl-PL'], true),
  ('PT', 'Portugal',    'EUR', 'pt-PT', ARRAY['pt-PT'], true),
  ('RO', 'Romania',     'RON', 'ro-RO', ARRAY['ro-RO'], true),
  ('SK', 'Slovakia',    'EUR', 'sk-SK', ARRAY['sk-SK'], true),
  ('SI', 'Slovenia',    'EUR', 'sl-SI', ARRAY['sl-SI'], true),
  ('ES', 'Spain',       'EUR', 'es-ES', ARRAY['es-ES'], true),
  ('SE', 'Sweden',      'SEK', 'sv-SE', ARRAY['sv-SE'], true),
  -- In the EEA but outside the EU's VAT and customs union.
  ('NO', 'Norway',      'NOK', 'nb-NO', ARRAY['nb-NO'], false);
--> statement-breakpoint

CREATE FUNCTION commerce.is_eu_country(p_code char(2))
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce((SELECT in_eu FROM commerce.countries WHERE code = p_code), false);
$$;
--> statement-breakpoint

-- New stores ------------------------------------------------------------------------

-- Everything a store needs before its owner touches a setting: invoice and
-- credit-note series, and Stripe (decision D3), disabled and in test mode.
CREATE FUNCTION commerce.initialise_store()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO commerce.document_series (store_id, series, prefix) VALUES
    (NEW.id, 'invoice', 'INV-'),
    (NEW.id, 'credit_note', 'CN-');
  INSERT INTO commerce.payment_providers (store_id, provider) VALUES (NEW.id, 'stripe');
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER stores_initialise
  AFTER INSERT ON commerce.stores
  FOR EACH ROW EXECUTE FUNCTION commerce.initialise_store();
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

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON commerce.audit_log
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
     OR NEW.store_id IS DISTINCT FROM OLD.store_id
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

-- Sets a variant's price in one of its store's markets from p_at onwards,
-- closing the current price. Returns the id of the price row now in force.
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
  v_store_id uuid;
  v_currency char(3);
  v_current commerce.prices%ROWTYPE;
  v_id bigint;
BEGIN
  SELECT store_id INTO v_store_id
    FROM commerce.product_variants
   WHERE id = p_variant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown variant %', p_variant_id;
  END IF;

  SELECT currency INTO v_currency
    FROM commerce.markets
   WHERE store_id = v_store_id AND code = p_market_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the store does not sell to market %', p_market_code;
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

  INSERT INTO commerce.prices (store_id, variant_id, market_code, currency, amount_minor, valid_from)
  VALUES (v_store_id, p_variant_id, p_market_code, v_currency, p_amount_minor, p_at)
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
  p.store_id,
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
  l.store_id,
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

-- Takes the next number in one of a store's series. The row lock taken by
-- UPDATE serialises concurrent callers, and a rolled-back transaction gives
-- its number back, so issued documents have no gaps. Call it in the
-- transaction that inserts the invoice or credit note.
CREATE FUNCTION commerce.next_document_number(p_store_id uuid, p_series text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_number bigint;
BEGIN
  UPDATE commerce.document_series
     SET next_number = next_number + 1
   WHERE store_id = p_store_id AND series = p_series
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
    FROM commerce.economic_operators
   WHERE store_id = NEW.store_id AND id = NEW.manufacturer_id;

  IF NOT commerce.is_eu_country(v_manufacturer_country) THEN
    SELECT country INTO v_responsible_country
      FROM commerce.economic_operators
     WHERE store_id = NEW.store_id AND id = NEW.responsible_person_id;
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

-- Producer responsibility --------------------------------------------------------

-- For every active product and every active market of its store, the producer
-- schemes the product falls under that have no registration valid today.
-- Anything listed here must not be sold in that market until it is registered.
CREATE VIEW commerce.missing_registrations
WITH (security_invoker = true)
AS
SELECT p.store_id, p.id AS product_id, p.handle, m.code AS market_code, ps.scheme
FROM commerce.products p
JOIN commerce.product_schemes ps ON ps.product_id = p.id
JOIN commerce.markets m ON m.store_id = p.store_id
WHERE p.status = 'active'
  AND m.active
  AND NOT EXISTS (
    SELECT 1 FROM commerce.producer_registrations r
     WHERE r.store_id = p.store_id
       AND r.market_code = m.code
       AND r.scheme = ps.scheme
       AND r.valid_from <= current_date
       AND (r.valid_to IS NULL OR r.valid_to >= current_date)
  );
--> statement-breakpoint

-- Members --------------------------------------------------------------------------

-- Once a store has an owner, it must always keep at least one active owner,
-- so nobody can lock everyone out of its staff and payment settings.
CREATE FUNCTION commerce.keep_an_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.disabled_at IS NOT NULL)
     AND OLD.role = 'owner' AND OLD.disabled_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM commerce.store_members
        WHERE store_id = OLD.store_id
          AND role = 'owner'
          AND disabled_at IS NULL
          AND account_id <> OLD.account_id
     ) THEN
    RAISE EXCEPTION 'the store must keep at least one active owner'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint

CREATE TRIGGER store_members_keep_an_owner
  BEFORE UPDATE OR DELETE ON commerce.store_members
  FOR EACH ROW EXECUTE FUNCTION commerce.keep_an_owner();
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
