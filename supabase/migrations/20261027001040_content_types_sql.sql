-- Content types (wave 6 unit H1, D326, docs/wave-6-catalogue.md H.1).
-- * Row security on, no policy, as every table of the private schema.
-- * `content_types_rules()`: an owner (a store, or Kaizena Flow's own site with no store) keeps at most 50 types; a type's owner and key
--   never change, and its web name is fixed once an entry of it has been published (its entries' addresses depend on it).
-- * `content_entries_rules()`: an entry's owner is its type's; an owner keeps at most 10,000 entries; an entry never moves to another type
--   or owner, and the day it was first published is kept.
-- * `clone_entry_refs()`: a copied entry's id in place of the template's wherever copied values name one (a uuid is unique, so replacing
--   its text touches nothing else).
-- * `clone_store()` and `duplicate_store()` copy a store's types and entries with it, references to entries made the copy's.

ALTER TABLE commerce.content_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.content_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION commerce.content_types_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('content_types:' || coalesce(NEW.store_id::text, 'kaizena'), 0));
    IF (SELECT count(*) FROM commerce.content_types t WHERE t.store_id IS NOT DISTINCT FROM NEW.store_id) >= 50 THEN
      RAISE EXCEPTION 'An owner keeps at most 50 content types.' USING ERRCODE = 'check_violation', CONSTRAINT = 'content_types_max';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.key <> OLD.key THEN
    RAISE EXCEPTION 'A content type keeps its owner and key.' USING ERRCODE = 'check_violation', CONSTRAINT = 'content_types_fixed';
  END IF;
  IF NEW.slug <> OLD.slug AND EXISTS (
    SELECT 1 FROM commerce.content_entries e WHERE e.type_id = OLD.id AND e.first_published_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A content type keeps its web name once an entry of it has been published.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'content_types_slug_fixed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER content_types_rules BEFORE INSERT OR UPDATE ON commerce.content_types
  FOR EACH ROW EXECUTE FUNCTION commerce.content_types_rules();
--> statement-breakpoint
CREATE FUNCTION commerce.content_entries_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM commerce.content_types t WHERE t.id = NEW.type_id AND t.store_id IS NOT DISTINCT FROM NEW.store_id
    ) THEN
      RAISE EXCEPTION 'An entry belongs to its type''s owner.' USING ERRCODE = 'check_violation', CONSTRAINT = 'content_entries_owner';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('content_entries:' || coalesce(NEW.store_id::text, 'kaizena'), 0));
    IF (SELECT count(*) FROM commerce.content_entries e WHERE e.store_id IS NOT DISTINCT FROM NEW.store_id) >= 10000 THEN
      RAISE EXCEPTION 'An owner keeps at most 10,000 entries.' USING ERRCODE = 'check_violation', CONSTRAINT = 'content_entries_max';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.type_id <> OLD.type_id OR NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    RAISE EXCEPTION 'An entry keeps its type and owner.' USING ERRCODE = 'check_violation', CONSTRAINT = 'content_entries_fixed';
  END IF;
  IF OLD.first_published_at IS NOT NULL AND NEW.first_published_at IS DISTINCT FROM OLD.first_published_at THEN
    RAISE EXCEPTION 'An entry keeps the day it was first published.' USING ERRCODE = 'check_violation', CONSTRAINT = 'content_entries_first_published';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER content_entries_rules BEFORE INSERT OR UPDATE ON commerce.content_entries
  FOR EACH ROW EXECUTE FUNCTION commerce.content_entries_rules();
--> statement-breakpoint
CREATE FUNCTION commerce.clone_entry_refs(p_json jsonb, p_template uuid, p_store uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_text text;
  v_old uuid;
BEGIN
  IF p_json IS NULL THEN
    RETURN NULL;
  END IF;
  v_text := p_json::text;
  FOR v_old IN
    SELECT DISTINCT lower(r.m[1])::uuid
      FROM regexp_matches(v_text, '"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"', 'g') AS r(m)
  LOOP
    IF EXISTS (SELECT 1 FROM commerce.content_entries e WHERE e.id = v_old AND e.store_id = p_template) THEN
      v_text := replace(v_text, '"' || v_old::text || '"', '"' || commerce.clone_id(p_store, v_old)::text || '"');
    END IF;
  END LOOP;
  RETURN v_text::jsonb;
END;
$$;
--> statement-breakpoint
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('content_types' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'   WHERE fv.store_id = p_template_id AND fv.entity = \'store\' AND fv.entity_id = p_template_id;\n',
    E'   WHERE fv.store_id = p_template_id AND fv.entity = \'store\' AND fv.entity_id = p_template_id;\n\n' ||
    E'  -- The template\'s content types and entries (D326), and every copied value naming an entry made to name the copy.\n' ||
    E'  INSERT INTO commerce.content_types (\n' ||
    E'    id, store_id, key, name, slug, fields, title_field, summary_field, picture_field, has_pages, layout_id, position, updated_by\n' ||
    E'  )\n' ||
    E'  SELECT commerce.clone_id(v_store, t.id), v_store, t.key, t.name, t.slug, t.fields, t.title_field, t.summary_field, t.picture_field,\n' ||
    E'         t.has_pages,\n' ||
    E'         CASE WHEN EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = commerce.clone_id(v_store, t.layout_id)) THEN commerce.clone_id(v_store, t.layout_id) END,\n' ||
    E'         t.position, p_owner_id\n' ||
    E'    FROM commerce.content_types t WHERE t.store_id = p_template_id;\n\n' ||
    E'  INSERT INTO commerce.content_entries (\n' ||
    E'    id, store_id, type_id, slug, draft, published, published_at, first_published_at, position, created_by, updated_by\n' ||
    E'  )\n' ||
    E'  SELECT commerce.clone_id(v_store, e.id), v_store, commerce.clone_id(v_store, e.type_id), e.slug,\n' ||
    E'         commerce.clone_entry_refs(e.draft, p_template_id, v_store), commerce.clone_entry_refs(e.published, p_template_id, v_store),\n' ||
    E'         e.published_at, e.first_published_at, e.position, p_owner_id, p_owner_id\n' ||
    E'    FROM commerce.content_entries e WHERE e.store_id = p_template_id;\n\n' ||
    E'  UPDATE commerce.field_values fv SET values = commerce.clone_entry_refs(fv.values, p_template_id, v_store)\n' ||
    E'   WHERE fv.store_id = v_store AND EXISTS (SELECT 1 FROM commerce.content_entries e WHERE e.store_id = p_template_id);\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the store fields insert was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('content_types' IN v_def) > 0 THEN RETURN; END IF;
  -- The types' and entries' new ids, so `copy_remap()` makes every copied value naming one name the copy.
  v_new := replace(v_def,
    E'  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.discount_codes WHERE store_id = p_source;\n',
    E'  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.discount_codes WHERE store_id = p_source\n' ||
    E'  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.content_types WHERE store_id = p_source\n' ||
    E'  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.content_entries WHERE store_id = p_source;\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the id map was not found'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'   WHERE fv.store_id = p_source AND fv.entity = \'store\' AND fv.entity_id = p_source;\n',
    E'   WHERE fv.store_id = p_source AND fv.entity = \'store\' AND fv.entity_id = p_source;\n\n' ||
    E'  -- Content types and entries (D326), what they name made the copy\'s (a page or product left behind is left out).\n' ||
    E'  INSERT INTO commerce.content_types (\n' ||
    E'    id, store_id, key, name, slug, fields, title_field, summary_field, picture_field, has_pages, layout_id, position, created_at, updated_by\n' ||
    E'  )\n' ||
    E'  SELECT m.new_id, v_store, t.key, t.name, t.slug, t.fields, t.title_field, t.summary_field, t.picture_field, t.has_pages,\n' ||
    E'         (SELECT ml.new_id FROM pg_temp._copy_ids ml WHERE ml.old_id = t.layout_id), t.position, t.created_at, p_owner\n' ||
    E'    FROM commerce.content_types t JOIN pg_temp._copy_ids m ON m.old_id = t.id\n' ||
    E'   WHERE t.store_id = p_source;\n\n' ||
    E'  INSERT INTO commerce.content_entries (\n' ||
    E'    id, store_id, type_id, slug, draft, published, published_at, first_published_at, position, created_at, created_by, updated_by\n' ||
    E'  )\n' ||
    E'  SELECT m.new_id, v_store, mt.new_id, e.slug, commerce.copy_remap(e.draft, p_source, v_store), commerce.copy_remap(e.published, p_source, v_store),\n' ||
    E'         e.published_at, e.first_published_at, e.position, e.created_at, p_owner, p_owner\n' ||
    E'    FROM commerce.content_entries e\n' ||
    E'    JOIN pg_temp._copy_ids m ON m.old_id = e.id\n' ||
    E'    JOIN pg_temp._copy_ids mt ON mt.old_id = e.type_id\n' ||
    E'   WHERE e.store_id = p_source;\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the store fields insert was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
