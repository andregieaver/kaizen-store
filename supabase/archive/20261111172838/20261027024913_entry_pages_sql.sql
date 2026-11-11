-- Entries on the site (wave 6 unit H2, D326, docs/wave-6-catalogue.md H.3).
-- * `entry_address()`: a published entry's page address, market-relative (`/{type}/{entry}`), while its type has pages; else null. The
--   one place SQL makes it (the redirect resolver, the redirects list and the live-address check read it).
-- * A published entry whose address changes leaves a permanent redirect (`commerce.redirects` kind `entry`, pointing at the entry, so it
--   never chains), as a product's handle does; an address an entry takes deletes an automatic redirect from it. A store's only (Kaizena
--   Flow's own site keeps no redirects table rows).
-- * `content_types_layout()`: a type's layout is a page of type `entry_layout` of the type's own owner.
-- Statements with DELETE inside functions: `content_entries_leave_redirect()`, `content_entries_taken_address()`.

CREATE FUNCTION commerce.entry_address(p_entry uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT '/' || t.slug || '/' || e.slug
    FROM commerce.content_entries e
    JOIN commerce.content_types t ON t.id = e.type_id
   WHERE e.id = p_entry AND e.published IS NOT NULL AND t.has_pages;
$$;
--> statement-breakpoint
CREATE FUNCTION commerce.content_entries_leave_redirect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_source text;
BEGIN
  IF NEW.store_id IS NOT NULL AND NEW.slug IS DISTINCT FROM OLD.slug AND OLD.first_published_at IS NOT NULL THEN
    SELECT '/' || t.slug || '/' || OLD.slug INTO v_source FROM commerce.content_types t WHERE t.id = NEW.type_id AND t.has_pages;
    IF v_source IS NOT NULL THEN
      DELETE FROM commerce.redirects r WHERE r.store_id = NEW.store_id AND r.source = v_source AND r.kind <> 'manual';
      INSERT INTO commerce.redirects (store_id, kind, source, entry_id, origin)
      VALUES (NEW.store_id, 'entry', v_source, NEW.id, 'system')
      ON CONFLICT ON CONSTRAINT redirects_store_source_key DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER content_entries_leave_redirect AFTER UPDATE OF slug ON commerce.content_entries
  FOR EACH ROW EXECUTE FUNCTION commerce.content_entries_leave_redirect();
--> statement-breakpoint
CREATE FUNCTION commerce.content_entries_taken_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.store_id IS NOT NULL THEN
    DELETE FROM commerce.redirects r
     USING commerce.content_types t
     WHERE t.id = NEW.type_id AND r.store_id = NEW.store_id AND r.source = '/' || t.slug || '/' || NEW.slug AND r.kind <> 'manual';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER content_entries_taken_address AFTER INSERT OR UPDATE OF slug ON commerce.content_entries
  FOR EACH ROW EXECUTE FUNCTION commerce.content_entries_taken_address();
--> statement-breakpoint
CREATE FUNCTION commerce.content_types_layout()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.layout_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.pages p WHERE p.id = NEW.layout_id AND p.type = 'entry_layout' AND p.store_id IS NOT DISTINCT FROM NEW.store_id
  ) THEN
    RAISE EXCEPTION 'A content type''s layout is an entry layout of its own owner.' USING ERRCODE = 'check_violation', CONSTRAINT = 'content_types_layout';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER content_types_layout BEFORE INSERT OR UPDATE OF layout_id ON commerce.content_types
  FOR EACH ROW EXECUTE FUNCTION commerce.content_types_layout();
