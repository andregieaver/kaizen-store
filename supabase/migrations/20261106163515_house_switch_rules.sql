-- Kaizena Flow's site served from its own store (D474, docs/platform-parity-plan.md step 5): the rules of the switch.
--
-- * `platform_settings.site_from_store` turns on only while Kaizena Flow's own store exists, is open and is not private: on, its pages are
--   kaizenaflow.com's, and a private store would show every visitor its landing page (`platform_site_from_store()`).
-- * While it is on, Kaizena Flow's own store cannot be made private (`stores_house_public()`).
-- * `site_from_store_at` is kept by the database whenever the switch changes.
-- * `commerce.set_site_from_store()` is the switch: on, the store is made public and the site served from it; off, the platform's own pages
--   come back and the store is private again, so its copy is not public at its own address. One transaction either way.
--
-- Whole functions are replaced (CREATE OR REPLACE); none is patched in place. No DELETE anywhere.

CREATE OR REPLACE FUNCTION commerce.platform_site_from_store()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.site_from_store IS DISTINCT FROM OLD.site_from_store THEN
    NEW.site_from_store_at := now();
  END IF;
  IF NEW.site_from_store AND NOT EXISTS (
    SELECT 1 FROM commerce.stores s WHERE s.house AND s.status = 'active' AND NOT s.private_mode
  ) THEN
    RAISE EXCEPTION 'platform_settings.site_from_store: Kaizena Flow''s own store must be open and public to serve the site'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER platform_site_from_store BEFORE INSERT OR UPDATE OF site_from_store ON commerce.platform_settings
  FOR EACH ROW EXECUTE FUNCTION commerce.platform_site_from_store();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.stores_house_public()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.house AND NEW.private_mode AND NOT OLD.private_mode
     AND EXISTS (SELECT 1 FROM commerce.platform_settings p WHERE p.site_from_store) THEN
    RAISE EXCEPTION 'stores.house_public: Kaizena Flow''s own store serves the site and cannot be made private; switch the site back first'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER stores_house_public BEFORE UPDATE OF private_mode ON commerce.stores
  FOR EACH ROW EXECUTE FUNCTION commerce.stores_house_public();
--> statement-breakpoint

-- The switch (D474). Returns whether anything changed. `p_account` is the platform admin who switched, kept on the row.
CREATE OR REPLACE FUNCTION commerce.set_site_from_store(p_on boolean, p_account uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_store uuid := commerce.house_store();
  v_now boolean;
BEGIN
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'set_site_from_store: Kaizena Flow''s own store does not exist' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT site_from_store INTO v_now FROM commerce.platform_settings FOR UPDATE;
  IF v_now IS NOT DISTINCT FROM p_on THEN
    RETURN false;
  END IF;
  IF p_on THEN
    UPDATE commerce.stores SET private_mode = false WHERE id = v_store AND private_mode;
    UPDATE commerce.platform_settings SET site_from_store = true, site_from_store_by = p_account;
  ELSE
    UPDATE commerce.platform_settings SET site_from_store = false, site_from_store_by = p_account;
    UPDATE commerce.stores SET private_mode = true WHERE id = v_store AND NOT private_mode;
  END IF;
  RETURN true;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION commerce.set_site_from_store(boolean, uuid) FROM PUBLIC;
