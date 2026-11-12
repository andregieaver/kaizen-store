-- A site's header and footer are checked when they are set, not again when the other one changes (D577).
-- Deleting a header and a footer in one statement (a sandbox's purge, the house site's sync) has the foreign keys set the two
-- columns to null one at a time; the first update fired this check on the other column, which still named a page the same
-- statement had removed, and failed: 'a site''s footer must be one of its footers'. A value that did not change was checked when
-- it was set, and a deleted page lets go through the foreign key, so only a column the statement changes is checked.
CREATE OR REPLACE FUNCTION commerce.site_layout_is_type() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.header_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.header_id IS DISTINCT FROM OLD.header_id)
     AND NOT EXISTS (
    SELECT 1 FROM commerce.pages p
     WHERE p.id = NEW.header_id AND p.type = 'header'
       AND (TG_TABLE_NAME <> 'platform_settings' OR p.store_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'a site''s header must be one of its headers';
  END IF;
  IF NEW.footer_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.footer_id IS DISTINCT FROM OLD.footer_id)
     AND NOT EXISTS (
    SELECT 1 FROM commerce.pages p
     WHERE p.id = NEW.footer_id AND p.type = 'footer'
       AND (TG_TABLE_NAME <> 'platform_settings' OR p.store_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'a site''s footer must be one of its footers';
  END IF;
  RETURN NEW;
END;
$$;
