-- Closing a store (D171, docs/store-closure.md): the rules that live in the database. The columns are in the migration before this one.
--
-- * a store's status moves only along the allowed steps (`stores_status_rules()`): active to suspended or closed, suspended to active or closed, closed
--   back to active (reopened). The template store never leaves `active`. The time of the change is kept, and `closed_at`, the start of the owner's
--   reopening period, is set when a store is closed and cleared when it is reopened (a suspension does not touch it);
-- * a store that is not active takes no new order (`orders_store_open()`), whoever asks: a shopper's checkout, a subscription's renewal, a weekly
--   delivery. An order copied from another store is history and is not an order of sale (`copied_from`), so a copy made into a store is not refused;
-- * `commerce.store_is_active(store)` for the jobs that must leave a store that is not open alone.
--
-- No DELETE anywhere: a store is never deleted here, only closed.

CREATE FUNCTION commerce.store_is_active(p_store uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT s.status = 'active' FROM commerce.stores s WHERE s.id = p_store), false)
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.stores_status_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'active' AND NEW.status IN ('suspended', 'closed'))
    OR (OLD.status = 'suspended' AND NEW.status IN ('active', 'closed'))
    OR (OLD.status = 'closed' AND NEW.status = 'active')
  ) THEN
    RAISE EXCEPTION 'stores.status_step: a store cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.is_template THEN
    RAISE EXCEPTION 'stores.template_status: the template store stays active' USING ERRCODE = 'check_violation';
  END IF;
  NEW.status_changed_at := now();
  IF NEW.status = 'closed' THEN
    NEW.closed_at := now();
  ELSIF NEW.status = 'active' THEN
    NEW.closed_at := NULL;
    NEW.status_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER stores_status_rules
BEFORE UPDATE OF status ON commerce.stores
FOR EACH ROW EXECUTE FUNCTION commerce.stores_status_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.orders_store_open()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.copied_from IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT commerce.store_is_active(NEW.store_id) THEN
    RAISE EXCEPTION 'orders.store_not_open: the store is not open for sale' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER orders_store_open
BEFORE INSERT ON commerce.orders
FOR EACH ROW EXECUTE FUNCTION commerce.orders_store_open();
