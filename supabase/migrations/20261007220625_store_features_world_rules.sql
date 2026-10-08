-- Store features, step 4 (D178, docs/store-features.md 4d): the Countries and languages group, `countries`, `languages` and `currencies`.
-- Each feature's switch is the gate; what it switches off is hidden and refused, nothing is deleted (markets stay active, `stores.locales`,
-- `store_currencies` and every translation stay), and an order keeps the country, language and currency it was placed in.
--
-- * `home_market()` is the store's own country, defined once: the active market of `stores.country`, else the first active one in the order
--   the store lists them (`getStore()`: `created_at`, then the code). With Several countries off it is the only country offered.
-- * `market_offered()` is what a cart and a checkout ask (`getCart()`, `sellableQuantity()`, `placeOrder()`, a draft order): the country is an
--   active market and offered (Several countries on, or the store's own), and the currency is the country's own or Several currencies is on.
-- * `clone_store()` (patched on its live definition, as 20261007161933_store_features_rules.sql): a new store's markets keep the order of the
--   store it is made from, its own country first. They were all made in the same instant, so a new store with no country of its own yet (the
--   owner sets it at setup) listed them by code and took Denmark for its own country; with Several countries off by default that would be the
--   only country it offered.
--
-- Changed: `commerce.clone_store()` (one statement, below). No other existing function is changed.
--> statement-breakpoint

-- The store's own country: the active market of `stores.country`, else its first active market (null with none).
CREATE FUNCTION commerce.home_market(p_store uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT m.code::text
    FROM commerce.markets m
    JOIN commerce.stores s ON s.id = m.store_id
   WHERE m.store_id = p_store AND m.active
   ORDER BY (m.code = s.country) DESC NULLS LAST, m.created_at, m.code
   LIMIT 1
$$;
--> statement-breakpoint

-- Whether a store sells in this country and currency now (D178): an active market, offered while Several countries is on or as the store's
-- own country, in its own currency or, while Several currencies is on, another the shopper chose.
CREATE FUNCTION commerce.market_offered(p_store uuid, p_market text, p_currency text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM commerce.markets m
     WHERE m.store_id = p_store AND m.code = p_market AND m.active
       AND (commerce.feature_on(p_store, 'countries') OR m.code = commerce.home_market(p_store))
       AND (m.currency = p_currency OR commerce.feature_on(p_store, 'currencies'))
  )
$$;
--> statement-breakpoint

-- A new store's markets in the order of the store it is made from (its own country first), a microsecond apart.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  v_new := replace(v_def,
    E'  INSERT INTO commerce.markets (store_id, code, currency, default_locale, locales, active)\n  SELECT v_store, code, currency, default_locale, locales, active\n    FROM commerce.markets WHERE store_id = p_template_id;',
    E'  INSERT INTO commerce.markets (store_id, code, currency, default_locale, locales, active, created_at)\n  SELECT v_store, m.code, m.currency, m.default_locale, m.locales, m.active,\n         now() + (row_number() OVER (ORDER BY (m.code = t.country) DESC NULLS LAST, m.created_at, m.code) - 1) * interval \'1 microsecond\'\n    FROM commerce.markets m JOIN commerce.stores t ON t.id = m.store_id WHERE m.store_id = p_template_id;');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the copy of the template''s markets was not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
