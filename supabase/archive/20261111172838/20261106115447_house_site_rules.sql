-- Kaizena Flow's site copied into its own store (D469, docs/platform-parity-plan.md step 3).
--
-- * `house_site_copies` has row-level security on, as every commerce table, and lives in Kaizena Flow's own store alone.
-- * `commerce.copy_platform_site(p_by)` copies the platform's own site (rows with no store) into Kaizena Flow's own store, in one transaction:
--   pages, headers and footers, menus, saved parts, text styles, categories and tags, content types and entries, and the old addresses of
--   pages; and the site's look, fonts, CSS, logos, SEO, header, footer, menus and front page onto the store. Each source row lands on the
--   same copy every run (`house_site_copies`), so it can run again just before the switch (step 5) and bring the latest; the copy of a row
--   that is gone is removed. Ids inside content are the copies' (`copy_remap()`, as a store's copy does, D129). Pictures are not copied:
--   pages keep their addresses, and the media library's rows move with the switch. Nothing of the platform's own site is changed.
--
-- Whole functions are replaced (CREATE OR REPLACE); none is patched in place.

ALTER TABLE "commerce"."house_site_copies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.house_site_copies_house()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.house) THEN
    RAISE EXCEPTION 'house_site_copies.house: only Kaizena Flow''s own store holds the copy of its site' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER house_site_copies_house BEFORE INSERT OR UPDATE OF store_id ON commerce.house_site_copies
  FOR EACH ROW EXECUTE FUNCTION commerce.house_site_copies_house();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.copy_platform_site(p_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_house uuid := commerce.house_store();
  v_settings record;
  v_front uuid;
  v_counts jsonb;
BEGIN
  IF v_house IS NULL THEN
    RAISE EXCEPTION 'house_site.no_store: Kaizena Flow''s own store does not exist' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('house_site_copy'));

  -- Every source row with its copy's id: the one it was copied onto before, else a new one.
  DROP TABLE IF EXISTS pg_temp._site_src;
  CREATE TEMP TABLE _site_src (old_id uuid PRIMARY KEY, new_id uuid NOT NULL, kind text NOT NULL) ON COMMIT DROP;
  INSERT INTO pg_temp._site_src (old_id, new_id, kind)
  SELECT src.id, COALESCE(c.copy_id, gen_random_uuid()), src.kind
    FROM (
      SELECT id, 'page' AS kind FROM commerce.pages WHERE store_id IS NULL AND type IN ('page', 'article', 'header', 'footer', 'entry_layout')
      UNION ALL SELECT id, 'menu' FROM commerce.menus WHERE store_id IS NULL
      UNION ALL SELECT id, 'saved_part' FROM commerce.saved_parts WHERE store_id IS NULL
      UNION ALL SELECT id, 'text_style' FROM commerce.text_styles WHERE store_id IS NULL
      UNION ALL SELECT id, 'term' FROM commerce.terms WHERE store_id IS NULL
      UNION ALL SELECT id, 'content_type' FROM commerce.content_types WHERE store_id IS NULL
      UNION ALL SELECT id, 'content_entry' FROM commerce.content_entries WHERE store_id IS NULL
    ) src
    LEFT JOIN commerce.house_site_copies c ON c.store_id = v_house AND c.source_id = src.id;

  -- `copy_remap()` reads its map from `_copy_ids`.
  DROP TABLE IF EXISTS pg_temp._copy_ids;
  CREATE TEMP TABLE _copy_ids (old_id uuid PRIMARY KEY, new_id uuid) ON COMMIT DROP;
  INSERT INTO pg_temp._copy_ids (old_id, new_id) SELECT old_id, new_id FROM pg_temp._site_src;

  -- The copies of rows that are gone: removed, the pages last (menus and content may point at them).
  DELETE FROM commerce.content_entries e USING commerce.house_site_copies c
   WHERE c.store_id = v_house AND c.kind = 'content_entry' AND e.id = c.copy_id AND e.store_id = v_house
     AND NOT EXISTS (SELECT 1 FROM pg_temp._site_src s WHERE s.old_id = c.source_id);
  DELETE FROM commerce.content_types t USING commerce.house_site_copies c
   WHERE c.store_id = v_house AND c.kind = 'content_type' AND t.id = c.copy_id AND t.store_id = v_house
     AND NOT EXISTS (SELECT 1 FROM pg_temp._site_src s WHERE s.old_id = c.source_id);
  DELETE FROM commerce.menus m USING commerce.house_site_copies c
   WHERE c.store_id = v_house AND c.kind = 'menu' AND m.id = c.copy_id AND m.store_id = v_house
     AND NOT EXISTS (SELECT 1 FROM pg_temp._site_src s WHERE s.old_id = c.source_id);
  DELETE FROM commerce.saved_parts p USING commerce.house_site_copies c
   WHERE c.store_id = v_house AND c.kind = 'saved_part' AND p.id = c.copy_id AND p.store_id = v_house
     AND NOT EXISTS (SELECT 1 FROM pg_temp._site_src s WHERE s.old_id = c.source_id);
  DELETE FROM commerce.text_styles t USING commerce.house_site_copies c
   WHERE c.store_id = v_house AND c.kind = 'text_style' AND t.id = c.copy_id AND t.store_id = v_house
     AND NOT EXISTS (SELECT 1 FROM pg_temp._site_src s WHERE s.old_id = c.source_id);
  DELETE FROM commerce.terms t USING commerce.house_site_copies c
   WHERE c.store_id = v_house AND c.kind = 'term' AND t.id = c.copy_id AND t.store_id = v_house
     AND NOT EXISTS (SELECT 1 FROM pg_temp._site_src s WHERE s.old_id = c.source_id);
  UPDATE commerce.stores SET front_page_id = NULL
   WHERE id = v_house AND front_page_id IN (
     SELECT c.copy_id FROM commerce.house_site_copies c
      WHERE c.store_id = v_house AND c.kind = 'page' AND NOT EXISTS (SELECT 1 FROM pg_temp._site_src s WHERE s.old_id = c.source_id));
  DELETE FROM commerce.pages p USING commerce.house_site_copies c
   WHERE c.store_id = v_house AND c.kind = 'page' AND p.id = c.copy_id AND p.store_id = v_house
     AND NOT EXISTS (SELECT 1 FROM pg_temp._site_src s WHERE s.old_id = c.source_id);
  DELETE FROM commerce.house_site_copies c
   WHERE c.store_id = v_house AND NOT EXISTS (SELECT 1 FROM pg_temp._site_src s WHERE s.old_id = c.source_id);

  -- Text styles, then categories and tags (their parents set once all are there).
  INSERT INTO commerce.text_styles (id, store_id, slug, name, kind, settings, css, position, created_by, updated_by)
  SELECT s.new_id, v_house, t.slug, t.name, t.kind, commerce.copy_remap(t.settings, v_house, v_house), t.css, t.position, p_by, p_by
    FROM commerce.text_styles t JOIN pg_temp._site_src s ON s.old_id = t.id
  ON CONFLICT (id) DO UPDATE SET slug = excluded.slug, name = excluded.name, kind = excluded.kind, settings = excluded.settings,
    css = excluded.css, position = excluded.position, updated_by = excluded.updated_by, updated_at = now();

  INSERT INTO commerce.terms (id, store_id, content_type, kind, parent_id, name, slug, position, seo)
  SELECT s.new_id, v_house, t.content_type, t.kind, NULL, t.name, t.slug, t.position, commerce.copy_remap(t.seo, v_house, v_house)
    FROM commerce.terms t JOIN pg_temp._site_src s ON s.old_id = t.id
  ON CONFLICT (id) DO UPDATE SET content_type = excluded.content_type, kind = excluded.kind, name = excluded.name, slug = excluded.slug,
    position = excluded.position, seo = excluded.seo, updated_at = now();
  UPDATE commerce.terms t SET parent_id = p.new_id
    FROM pg_temp._site_src s, commerce.terms src LEFT JOIN pg_temp._site_src p ON p.old_id = src.parent_id
   WHERE s.old_id = src.id AND t.id = s.new_id AND t.parent_id IS DISTINCT FROM p.new_id;

  -- Pages, headers and footers: their content's ids are the copies'.
  INSERT INTO commerce.pages (id, store_id, type, slug, draft, published, published_at, first_published_at, created_by, updated_by)
  SELECT s.new_id, v_house, p.type, p.slug, commerce.copy_remap(p.draft, v_house, v_house), commerce.copy_remap(p.published, v_house, v_house),
         p.published_at, p.first_published_at, p_by, p_by
    FROM commerce.pages p JOIN pg_temp._site_src s ON s.old_id = p.id
  ON CONFLICT (id) DO UPDATE SET slug = excluded.slug, draft = excluded.draft, published = excluded.published,
    published_at = excluded.published_at, first_published_at = excluded.first_published_at, updated_by = excluded.updated_by, updated_at = now();

  -- The old addresses of pages lead to the copies.
  INSERT INTO commerce.page_redirects (store_id, type, slug, page_id)
  SELECT v_house, r.type, r.slug, s.new_id
    FROM commerce.page_redirects r JOIN pg_temp._site_src s ON s.old_id = r.page_id
   WHERE r.store_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM commerce.pages q WHERE q.store_id = v_house AND q.type = r.type AND q.slug = r.slug)
  ON CONFLICT (store_id, type, slug) DO UPDATE SET page_id = excluded.page_id;

  INSERT INTO commerce.menus (id, store_id, name, items, created_by, updated_by)
  SELECT s.new_id, v_house, m.name, commerce.copy_remap(m.items, v_house, v_house), p_by, p_by
    FROM commerce.menus m JOIN pg_temp._site_src s ON s.old_id = m.id
  ON CONFLICT (id) DO UPDATE SET name = excluded.name, items = excluded.items, updated_by = excluded.updated_by, updated_at = now();

  -- Saved parts: the store's own (private), as Kaizena Flow's are the marketplace's.
  INSERT INTO commerce.saved_parts (id, store_id, kind, name, content, global, translations, sharing, created_by, updated_by)
  SELECT s.new_id, v_house, p.kind, p.name, commerce.copy_remap(p.content, v_house, v_house), p.global,
         commerce.copy_remap(p.translations, v_house, v_house), 'private', p_by, p_by
    FROM commerce.saved_parts p JOIN pg_temp._site_src s ON s.old_id = p.id
  ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, name = excluded.name, content = excluded.content, global = excluded.global,
    translations = excluded.translations, updated_by = excluded.updated_by, updated_at = now();

  INSERT INTO commerce.content_types (id, store_id, key, name, slug, fields, title_field, summary_field, picture_field, has_pages, layout_id,
    position, updated_by)
  SELECT s.new_id, v_house, t.key, t.name, t.slug, commerce.copy_remap(t.fields, v_house, v_house), t.title_field, t.summary_field,
         t.picture_field, t.has_pages, (SELECT l.new_id FROM pg_temp._site_src l WHERE l.old_id = t.layout_id), t.position, p_by
    FROM commerce.content_types t JOIN pg_temp._site_src s ON s.old_id = t.id
  ON CONFLICT (id) DO UPDATE SET key = excluded.key, name = excluded.name, slug = excluded.slug, fields = excluded.fields,
    title_field = excluded.title_field, summary_field = excluded.summary_field, picture_field = excluded.picture_field,
    has_pages = excluded.has_pages, layout_id = excluded.layout_id, position = excluded.position, updated_by = excluded.updated_by,
    updated_at = now();

  INSERT INTO commerce.content_entries (id, store_id, type_id, slug, draft, published, published_at, first_published_at, position, created_by,
    updated_by)
  SELECT s.new_id, v_house, ty.new_id, e.slug, commerce.copy_remap(e.draft, v_house, v_house), commerce.copy_remap(e.published, v_house, v_house),
         e.published_at, e.first_published_at, e.position, p_by, p_by
    FROM commerce.content_entries e JOIN pg_temp._site_src s ON s.old_id = e.id JOIN pg_temp._site_src ty ON ty.old_id = e.type_id
  ON CONFLICT (id) DO UPDATE SET type_id = excluded.type_id, slug = excluded.slug, draft = excluded.draft, published = excluded.published,
    published_at = excluded.published_at, first_published_at = excluded.first_published_at, position = excluded.position,
    updated_by = excluded.updated_by, updated_at = now();

  -- The site's look, logos, SEO, header, footer, menus and front page, onto the store.
  SELECT * INTO v_settings FROM commerce.platform_settings LIMIT 1;
  SELECT s.new_id INTO v_front FROM commerce.platform_page_roles r JOIN pg_temp._site_src s ON s.old_id = r.page_id WHERE r.role = 'front';
  IF v_settings.id IS NOT NULL THEN
    UPDATE commerce.stores SET
      theme = COALESCE(commerce.copy_remap(v_settings.theme, v_house, v_house), theme),
      fonts = COALESCE(v_settings.fonts, fonts),
      custom_css = COALESCE(v_settings.custom_css, custom_css),
      navigation = COALESCE(commerce.copy_remap(v_settings.navigation, v_house, v_house), navigation),
      seo = COALESCE(commerce.copy_remap(v_settings.seo, v_house, v_house), seo),
      tracking = COALESCE(v_settings.tracking, tracking),
      header_id = (SELECT s.new_id FROM pg_temp._site_src s WHERE s.old_id = v_settings.header_id),
      footer_id = (SELECT s.new_id FROM pg_temp._site_src s WHERE s.old_id = v_settings.footer_id),
      header_menu_id = (SELECT s.new_id FROM pg_temp._site_src s WHERE s.old_id = v_settings.header_menu_id),
      footer_menu_id = (SELECT s.new_id FROM pg_temp._site_src s WHERE s.old_id = v_settings.footer_menu_id),
      front_page_id = v_front
    WHERE id = v_house;
  END IF;

  INSERT INTO commerce.house_site_copies (store_id, source_id, copy_id, kind, copied_at)
  SELECT v_house, s.old_id, s.new_id, s.kind, now() FROM pg_temp._site_src s
  ON CONFLICT (store_id, source_id) DO UPDATE SET copied_at = excluded.copied_at;

  SELECT COALESCE(jsonb_object_agg(kind, n), '{}'::jsonb) INTO v_counts FROM (SELECT kind, count(*) AS n FROM pg_temp._site_src GROUP BY kind) k;
  RETURN v_counts;
END;
$$;
