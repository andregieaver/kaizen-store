-- Premium themes (D286, docs/theme-prices.md): the rules the database holds for a theme's prices and a store's purchases of one. The tables
-- are in the migration before this one.
--
-- * Row-level security on the two new tables (no policy: the `commerce` schema is private to the server).
-- * `theme_price_for(store, theme)` is the one price a store pays for a theme: in the currency of its plan, else of its own country, else the
--   first the theme is priced in. None: the theme is free.
-- * A purchase is made by the database whenever a priced theme goes live on a store that does not have it (`theme_installs_charge()`, after an
--   install is made live), so no way of making a theme live can skip it: `owed` while the store is not open (its setup not completed), `due`
--   once it is. A store template (`starter`, `is_template`) and a store that is not open are never charged. On an open store the theme goes
--   live only when the transaction carries the price the person agreed to (`kaizen.theme_charge`, `'{currency}:{amount}'`), or `'grant'`
--   for a theme Kaizena Flow gives; otherwise it is refused, so nobody is charged for a theme they were not shown the price of.
-- * Before the store opens only the theme live when it opens is owed: another going live cancels the owed one.
-- * Opening (`setup_completed_at` set) turns what is owed into what is due, at the price agreed or the theme's price now if that is lower.
-- * A purchase only goes forward (owed, due, invoiced, paid; or granted, cancelled, void) and is never deleted (`theme_purchases_rules()`).
--
-- No function here contains DELETE, TRUNCATE or DROP. Nothing that exists changes: no theme has a price yet.

ALTER TABLE commerce.theme_prices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.theme_purchases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.theme_price_for(p_store uuid, p_preset uuid)
RETURNS TABLE (currency text, amount_minor bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT tp.currency::text, tp.amount_minor
    FROM commerce.theme_prices tp
   WHERE tp.preset_id = p_preset
   ORDER BY
     tp.currency = (SELECT pp.currency FROM commerce.store_billing b JOIN commerce.plan_prices pp ON pp.id = b.price_id WHERE b.store_id = p_store) DESC NULLS LAST,
     tp.currency = (SELECT m.currency FROM commerce.markets m WHERE m.store_id = p_store AND m.code = commerce.home_market(p_store) LIMIT 1) DESC NULLS LAST,
     tp.currency
   LIMIT 1
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.theme_installs_charge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_store record;
  v_price record;
  v_charge text := nullif(current_setting('kaizen.theme_charge', true), '');
  v_actor uuid := nullif(current_setting('kaizen.theme_actor', true), '')::uuid;
BEGIN
  IF NOT NEW.live OR (TG_OP = 'UPDATE' AND OLD.live) THEN
    RETURN NULL;
  END IF;
  -- Before the store opens only the theme live when it opens is owed.
  UPDATE commerce.theme_purchases p SET status = 'cancelled', ended_at = now(), updated_at = now()
   WHERE p.store_id = NEW.store_id AND p.status = 'owed' AND p.preset_id IS DISTINCT FROM NEW.preset_id;
  IF NEW.preset_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT s.status, s.starter, s.is_template, s.setup_completed_at INTO v_store FROM commerce.stores s WHERE s.id = NEW.store_id;
  IF v_store.starter OR v_store.is_template OR v_store.status <> 'active' THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM commerce.theme_purchases p
     WHERE p.store_id = NEW.store_id AND p.preset_id = NEW.preset_id AND p.status IN ('owed', 'due', 'invoiced', 'paid', 'granted')
  ) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_price FROM commerce.theme_price_for(NEW.store_id, NEW.preset_id);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_charge = 'grant' THEN
    INSERT INTO commerce.theme_purchases (store_id, preset_id, status, currency, amount_minor, chosen_by)
    VALUES (NEW.store_id, NEW.preset_id, 'granted', v_price.currency, 0, coalesce(v_actor, NEW.installed_by));
    RETURN NULL;
  END IF;
  IF v_store.setup_completed_at IS NULL THEN
    INSERT INTO commerce.theme_purchases (store_id, preset_id, status, currency, amount_minor, chosen_by)
    VALUES (NEW.store_id, NEW.preset_id, 'owed', v_price.currency, v_price.amount_minor, coalesce(v_actor, NEW.installed_by));
    RETURN NULL;
  END IF;
  IF v_charge IS DISTINCT FROM v_price.currency || ':' || v_price.amount_minor THEN
    RAISE EXCEPTION 'theme_purchases.confirm: this theme costs % % and the price was not agreed to', v_price.currency, v_price.amount_minor
      USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO commerce.theme_purchases (store_id, preset_id, status, currency, amount_minor, chosen_by, due_at)
  VALUES (NEW.store_id, NEW.preset_id, 'due', v_price.currency, v_price.amount_minor, coalesce(v_actor, NEW.installed_by), now());
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER theme_installs_charge AFTER INSERT OR UPDATE OF live ON commerce.store_theme_installs
  FOR EACH ROW EXECUTE FUNCTION commerce.theme_installs_charge();
--> statement-breakpoint

CREATE FUNCTION commerce.stores_open_theme_purchases()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE commerce.theme_purchases p
     SET status = 'due', due_at = now(), updated_at = now(),
         amount_minor = least(p.amount_minor, coalesce(
           (SELECT tp.amount_minor FROM commerce.theme_prices tp WHERE tp.preset_id = p.preset_id AND tp.currency = p.currency), p.amount_minor))
   WHERE p.store_id = NEW.id AND p.status = 'owed';
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stores_open_theme_purchases AFTER UPDATE OF setup_completed_at ON commerce.stores
  FOR EACH ROW WHEN (OLD.setup_completed_at IS NULL AND NEW.setup_completed_at IS NOT NULL)
  EXECUTE FUNCTION commerce.stores_open_theme_purchases();
--> statement-breakpoint

CREATE FUNCTION commerce.theme_purchases_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'theme_purchases.kept: a theme purchase is never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.preset_id IS DISTINCT FROM OLD.preset_id
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.chosen_by IS DISTINCT FROM OLD.chosen_by AND NEW.chosen_by IS NOT NULL) THEN
    RAISE EXCEPTION 'theme_purchases.fixed: a theme purchase keeps its store, theme and currency' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'owed' AND NEW.status IN ('due', 'cancelled'))
    OR (OLD.status = 'due' AND NEW.status IN ('invoiced', 'cancelled'))
    OR (OLD.status = 'invoiced' AND NEW.status IN ('paid', 'void'))
  ) THEN
    RAISE EXCEPTION 'theme_purchases.forward: a theme purchase cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount_minor > OLD.amount_minor OR (NEW.amount_minor <> OLD.amount_minor AND NOT (OLD.status = 'owed' AND NEW.status = 'due')) THEN
    RAISE EXCEPTION 'theme_purchases.amount: what a theme costs a store is lowered only when the store opens' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.stripe_invoice_id IS NOT NULL AND NEW.stripe_invoice_id IS DISTINCT FROM OLD.stripe_invoice_id THEN
    RAISE EXCEPTION 'theme_purchases.invoice: a theme purchase keeps its invoice' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER theme_purchases_rules BEFORE UPDATE OR DELETE ON commerce.theme_purchases
  FOR EACH ROW EXECUTE FUNCTION commerce.theme_purchases_rules();
