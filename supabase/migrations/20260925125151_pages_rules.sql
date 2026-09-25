-- Pages (decision D42). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.pages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.page_redirects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A page taking an address replaces any redirect from it; a published page
-- moving to a new address leaves a redirect from the old one, so links and
-- search results keep working.
CREATE FUNCTION commerce.pages_keep_addresses() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  DELETE FROM commerce.page_redirects r
  WHERE r.slug = NEW.slug AND r.store_id IS NOT DISTINCT FROM NEW.store_id;
  IF TG_OP = 'UPDATE' AND NEW.slug <> OLD.slug AND OLD.published_at IS NOT NULL THEN
    INSERT INTO commerce.page_redirects (store_id, slug, page_id)
    VALUES (NEW.store_id, OLD.slug, NEW.id)
    ON CONFLICT ON CONSTRAINT page_redirects_store_slug_key DO UPDATE SET page_id = EXCLUDED.page_id, created_at = now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pages_keep_addresses
AFTER INSERT OR UPDATE OF slug ON commerce.pages
FOR EACH ROW EXECUTE FUNCTION commerce.pages_keep_addresses();
--> statement-breakpoint
-- A redirect never shadows a page's own address.
CREATE FUNCTION commerce.page_redirects_not_taken() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM commerce.pages p
    WHERE p.slug = NEW.slug AND p.store_id IS NOT DISTINCT FROM NEW.store_id
  ) THEN
    RAISE EXCEPTION 'page address % is in use', NEW.slug USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER page_redirects_not_taken
BEFORE INSERT OR UPDATE ON commerce.page_redirects
FOR EACH ROW EXECUTE FUNCTION commerce.page_redirects_not_taken();
