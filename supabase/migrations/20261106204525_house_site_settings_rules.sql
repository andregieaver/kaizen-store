-- Copying the site again keeps what was changed in Kaizena Flow's store (D474, docs/platform-parity-plan.md step 5).
--
-- `commerce.copy_platform_site()` brought the site's look, logos, SEO, header, footer, menus and front page onto the store on every run,
-- over whatever the store's own Settings had made of them since. Now the copy keeps, in `house_site_copies` (kind `settings`, its source
-- and copy the store itself), the settings as the live site had them at the last copy, and on the next run brings a setting only where
-- the store still has it so: one changed in the store stays the store's. The first copy ever brings them all; a store copied before this
-- kept no such row, so every setting it has now stays. Pages, menus, parts and content are brought as before. Whole function replaced.

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
  v_first boolean;
  v_last jsonb;
  v_now jsonb;
  v_have jsonb;
  v_take text[] := '{}';
BEGIN
  IF v_house IS NULL THEN
    RAISE EXCEPTION 'house_site.no_store: Kaizena Flow''s own store does not exist' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('house_site_copy'));
  -- The first copy ever brings every setting; later ones only those the store has not changed since (D474).
  v_first := NOT EXISTS (SELECT 1 FROM commerce.house_site_copies WHERE store_id = v_house);
  SELECT c.settings INTO v_last FROM commerce.house_site_copies c WHERE c.store_id = v_house AND c.kind = 'settings';

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
   WHERE c.store_id = v_house AND c.kind <> 'settings' AND NOT EXISTS (SELECT 1 FROM pg_temp._site_src s WHERE s.old_id = c.source_id);

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

  -- The site's look, logos, SEO, header, footer, menus and front page, onto the store (D474): each as the live site has it now (`v_now`),
  -- where the store still has it as the last copy left it (`v_last`), or on the first copy ever. A setting changed in the store's own
  -- Settings stays the store's, as does one the live site has none of. Before D474 no copy kept `v_last`: then every setting stays.
  SELECT * INTO v_settings FROM commerce.platform_settings LIMIT 1;
  SELECT s.new_id INTO v_front FROM commerce.platform_page_roles r JOIN pg_temp._site_src s ON s.old_id = r.page_id WHERE r.role = 'front';
  IF v_settings.id IS NOT NULL THEN
    v_now := jsonb_build_object(
      'theme', commerce.copy_remap(v_settings.theme, v_house, v_house),
      'fonts', v_settings.fonts,
      'custom_css', to_jsonb(v_settings.custom_css),
      'navigation', commerce.copy_remap(v_settings.navigation, v_house, v_house),
      'seo', commerce.copy_remap(v_settings.seo, v_house, v_house),
      'tracking', v_settings.tracking,
      'header_id', (SELECT to_jsonb(s.new_id) FROM pg_temp._site_src s WHERE s.old_id = v_settings.header_id),
      'footer_id', (SELECT to_jsonb(s.new_id) FROM pg_temp._site_src s WHERE s.old_id = v_settings.footer_id),
      'header_menu_id', (SELECT to_jsonb(s.new_id) FROM pg_temp._site_src s WHERE s.old_id = v_settings.header_menu_id),
      'footer_menu_id', (SELECT to_jsonb(s.new_id) FROM pg_temp._site_src s WHERE s.old_id = v_settings.footer_menu_id),
      'front_page_id', to_jsonb(v_front)
    );
    SELECT jsonb_build_object(
      'theme', st.theme, 'fonts', st.fonts, 'custom_css', to_jsonb(st.custom_css), 'navigation', st.navigation, 'seo', st.seo,
      'tracking', st.tracking, 'header_id', to_jsonb(st.header_id), 'footer_id', to_jsonb(st.footer_id),
      'header_menu_id', to_jsonb(st.header_menu_id), 'footer_menu_id', to_jsonb(st.footer_menu_id), 'front_page_id', to_jsonb(st.front_page_id)
    ) INTO v_have FROM commerce.stores st WHERE st.id = v_house;
    SELECT COALESCE(array_agg(k), '{}') INTO v_take FROM jsonb_object_keys(v_now) AS k
     WHERE v_first OR (v_last IS NOT NULL AND COALESCE(v_have -> k, 'null') = COALESCE(v_last -> k, 'null'));
    UPDATE commerce.stores SET
      theme = CASE WHEN 'theme' = ANY (v_take) THEN COALESCE(NULLIF(v_now -> 'theme', 'null'), theme) ELSE theme END,
      fonts = CASE WHEN 'fonts' = ANY (v_take) THEN COALESCE(NULLIF(v_now -> 'fonts', 'null'), fonts) ELSE fonts END,
      custom_css = CASE WHEN 'custom_css' = ANY (v_take) THEN COALESCE(v_now ->> 'custom_css', custom_css) ELSE custom_css END,
      navigation = CASE WHEN 'navigation' = ANY (v_take) THEN COALESCE(NULLIF(v_now -> 'navigation', 'null'), navigation) ELSE navigation END,
      seo = CASE WHEN 'seo' = ANY (v_take) THEN COALESCE(NULLIF(v_now -> 'seo', 'null'), seo) ELSE seo END,
      tracking = CASE WHEN 'tracking' = ANY (v_take) THEN COALESCE(NULLIF(v_now -> 'tracking', 'null'), tracking) ELSE tracking END,
      header_id = CASE WHEN 'header_id' = ANY (v_take) THEN (v_now ->> 'header_id')::uuid ELSE header_id END,
      footer_id = CASE WHEN 'footer_id' = ANY (v_take) THEN (v_now ->> 'footer_id')::uuid ELSE footer_id END,
      header_menu_id = CASE WHEN 'header_menu_id' = ANY (v_take) THEN (v_now ->> 'header_menu_id')::uuid ELSE header_menu_id END,
      footer_menu_id = CASE WHEN 'footer_menu_id' = ANY (v_take) THEN (v_now ->> 'footer_menu_id')::uuid ELSE footer_menu_id END,
      front_page_id = CASE WHEN 'front_page_id' = ANY (v_take) THEN (v_now ->> 'front_page_id')::uuid ELSE front_page_id END
    WHERE id = v_house;
    INSERT INTO commerce.house_site_copies (store_id, source_id, copy_id, kind, copied_at, settings)
    VALUES (v_house, v_house, v_house, 'settings', now(), v_now)
    ON CONFLICT (store_id, source_id) DO UPDATE SET copied_at = excluded.copied_at, settings = excluded.settings;
  END IF;

  INSERT INTO commerce.house_site_copies (store_id, source_id, copy_id, kind, copied_at)
  SELECT v_house, s.old_id, s.new_id, s.kind, now() FROM pg_temp._site_src s
  ON CONFLICT (store_id, source_id) DO UPDATE SET copied_at = excluded.copied_at;

  SELECT COALESCE(jsonb_object_agg(kind, n), '{}'::jsonb) INTO v_counts FROM (SELECT kind, count(*) AS n FROM pg_temp._site_src GROUP BY kind) k;
  -- How many settings the store kept as its own where the live site's differ, for the admin to say.
  IF v_settings.id IS NOT NULL THEN
    v_counts := v_counts || jsonb_build_object('settings_kept', (
      SELECT count(*) FROM jsonb_object_keys(v_now) AS k
       WHERE NOT (k = ANY (v_take)) AND COALESCE(v_have -> k, 'null') <> COALESCE(v_now -> k, 'null')
    ));
  END IF;
  RETURN v_counts;
END;
$$;
