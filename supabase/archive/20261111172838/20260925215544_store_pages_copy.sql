-- A template page's content for a store copied from it (D53): the ids of the
-- template's categories and tags, and of the template itself, become the
-- copy's. Ids are written as quoted strings in the content, so each is
-- replaced whole.
CREATE OR REPLACE FUNCTION commerce.clone_page_content(p_store uuid, p_template uuid, p_content jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_text text := p_content::text;
  v_id uuid;
BEGIN
  IF p_content IS NULL THEN
    RETURN NULL;
  END IF;
  FOR v_id IN SELECT id FROM commerce.terms WHERE store_id = p_template LOOP
    v_text := replace(v_text, '"' || v_id::text || '"', '"' || commerce.clone_id(p_store, v_id)::text || '"');
  END LOOP;
  v_text := replace(v_text, '"' || p_template::text || '"', '"' || p_store::text || '"');
  RETURN v_text::jsonb;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.clone_store(
  p_template_id uuid,
  p_slug text,
  p_name text,
  p_owner_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_store uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.stores WHERE id = p_template_id) THEN
    RAISE EXCEPTION 'unknown template store %', p_template_id;
  END IF;

  INSERT INTO commerce.stores (slug, name, created_by, navigation)
  SELECT p_slug, p_name, p_owner_id, navigation FROM commerce.stores WHERE id = p_template_id
  RETURNING id INTO v_store;

  INSERT INTO commerce.store_members (store_id, account_id, role)
  VALUES (v_store, p_owner_id, 'owner');

  INSERT INTO commerce.markets (store_id, code, currency, default_locale, locales, active)
  SELECT v_store, code, currency, default_locale, locales, active
    FROM commerce.markets WHERE store_id = p_template_id;

  INSERT INTO commerce.shipping_rates (store_id, market_code, currency, amount_minor, free_over_minor)
  SELECT v_store, market_code, currency, amount_minor, free_over_minor
    FROM commerce.shipping_rates WHERE store_id = p_template_id;

  INSERT INTO commerce.payment_methods (store_id, market_code, method, enabled)
  SELECT v_store, market_code, method, enabled
    FROM commerce.payment_methods WHERE store_id = p_template_id;

  INSERT INTO commerce.economic_operators (id, store_id, name, postal_address, electronic_address, country)
  SELECT commerce.clone_id(v_store, id), v_store, name, postal_address, electronic_address, country
    FROM commerce.economic_operators WHERE store_id = p_template_id;

  INSERT INTO commerce.inventory_locations (id, store_id, name, country, active)
  SELECT commerce.clone_id(v_store, id), v_store, name, country, active
    FROM commerce.inventory_locations WHERE store_id = p_template_id;

  -- Products arrive as drafts and are published below, once their pictures,
  -- titles and variants exist (the publishing check needs them).
  INSERT INTO commerce.products (
    id, store_id, handle, status, manufacturer_id, responsible_person_id,
    tax_code, withdrawal_exclusion, attributes, delivery, download_limit, download_days, subscription_only
  )
  SELECT commerce.clone_id(v_store, id), v_store, handle, 'draft',
         commerce.clone_id(v_store, manufacturer_id),
         commerce.clone_id(v_store, responsible_person_id),
         tax_code, withdrawal_exclusion, attributes, delivery, download_limit, download_days, subscription_only
    FROM commerce.products
   WHERE store_id = p_template_id AND status <> 'archived';

  INSERT INTO commerce.product_translations (
    store_id, product_id, locale, title, description, safety_information, seo_title, seo_description
  )
  SELECT v_store, commerce.clone_id(v_store, t.product_id), t.locale, t.title, t.description, t.safety_information,
         t.seo_title, t.seo_description
    FROM commerce.product_translations t
    JOIN commerce.products p ON p.id = t.product_id
   WHERE t.store_id = p_template_id AND p.status <> 'archived';

  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt)
  SELECT v_store, commerce.clone_id(v_store, m.product_id), m.url, m.position, m.alt
    FROM commerce.product_media m
    JOIN commerce.products p ON p.id = m.product_id
   WHERE m.store_id = p_template_id AND p.status <> 'archived';

  INSERT INTO commerce.product_schemes (store_id, product_id, scheme)
  SELECT v_store, commerce.clone_id(v_store, s.product_id), s.scheme
    FROM commerce.product_schemes s
    JOIN commerce.products p ON p.id = s.product_id
   WHERE s.store_id = p_template_id AND p.status <> 'archived';

  -- Categories and tags (D50) come along with the products in them. Parents
  -- are set once every category exists, so the parent check finds them.
  INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position)
  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position
    FROM commerce.terms WHERE store_id = p_template_id;

  UPDATE commerce.terms n
     SET parent_id = commerce.clone_id(v_store, t.parent_id)
    FROM commerce.terms t
   WHERE t.store_id = p_template_id
     AND t.parent_id IS NOT NULL
     AND n.id = commerce.clone_id(v_store, t.id);

  INSERT INTO commerce.product_terms (store_id, product_id, term_id)
  SELECT v_store, commerce.clone_id(v_store, pt.product_id), commerce.clone_id(v_store, pt.term_id)
    FROM commerce.product_terms pt
    JOIN commerce.products p ON p.id = pt.product_id
   WHERE pt.store_id = p_template_id AND p.status <> 'archived';

  INSERT INTO commerce.product_variants (
    id, store_id, product_id, sku, gtin, tax_code, options, weight_grams,
    hs_code, origin_country, active, delivery
  )
  SELECT commerce.clone_id(v_store, v.id), v_store, commerce.clone_id(v_store, v.product_id),
         v.sku, v.gtin, v.tax_code, v.options, v.weight_grams, v.hs_code, v.origin_country, v.active, v.delivery
    FROM commerce.product_variants v
    JOIN commerce.products p ON p.id = v.product_id
   WHERE v.store_id = p_template_id AND p.status <> 'archived';

  INSERT INTO commerce.selling_plans (
    id, store_id, product_id, interval, interval_count, discount_percent, trial_days, signup_fee, min_cycles,
    position, active
  )
  SELECT commerce.clone_id(v_store, sp.id), v_store, commerce.clone_id(v_store, sp.product_id),
         sp.interval, sp.interval_count, sp.discount_percent, sp.trial_days, sp.signup_fee, sp.min_cycles,
         sp.position, sp.active
    FROM commerce.selling_plans sp
    JOIN commerce.products p ON p.id = sp.product_id
   WHERE sp.store_id = p_template_id AND p.status <> 'archived';

  INSERT INTO commerce.prices (store_id, variant_id, market_code, currency, amount_minor, valid_from)
  SELECT v_store, commerce.clone_id(v_store, pr.variant_id), pr.market_code, pr.currency, pr.amount_minor, now()
    FROM commerce.prices pr
   WHERE pr.store_id = p_template_id
     AND pr.valid_to IS NULL
     AND EXISTS (
       SELECT 1 FROM commerce.product_variants v
        WHERE v.store_id = v_store AND v.id = commerce.clone_id(v_store, pr.variant_id)
     );

  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
  SELECT v_store, commerce.clone_id(v_store, l.variant_id), commerce.clone_id(v_store, l.location_id), l.on_hand
    FROM commerce.inventory_levels l
   WHERE l.store_id = p_template_id
     AND EXISTS (
       SELECT 1 FROM commerce.product_variants v
        WHERE v.store_id = v_store AND v.id = commerce.clone_id(v_store, l.variant_id)
     );

  -- The template's published pages (D53-D55), published in the copy, with
  -- the category and tag ids in them (the page's own and its grids') made the
  -- copies'; and its front page (D54).
  INSERT INTO commerce.pages (id, store_id, slug, draft, published, published_at, created_by, updated_by)
  SELECT commerce.clone_id(v_store, p.id), v_store, p.slug,
         commerce.clone_page_content(v_store, p_template_id, p.published),
         commerce.clone_page_content(v_store, p_template_id, p.published),
         now(), p_owner_id, p_owner_id
    FROM commerce.pages p
   WHERE p.store_id = p_template_id AND p.published_at IS NOT NULL;

  UPDATE commerce.stores s
     SET front_page_id = commerce.clone_id(v_store, t.front_page_id)
    FROM commerce.stores t
   WHERE s.id = v_store AND t.id = p_template_id
     AND EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = commerce.clone_id(v_store, t.front_page_id));

  -- Download files stay with the template (they are its own), so a product
  -- sold as a download waits as a draft for the new owner's files (D24).
  UPDATE commerce.products p
     SET status = 'active'
    FROM commerce.products t
   WHERE t.store_id = p_template_id
     AND t.status = 'active'
     AND p.store_id = v_store
     AND p.id = commerce.clone_id(v_store, t.id)
     AND NOT EXISTS (
       SELECT 1 FROM commerce.product_variants v
        WHERE v.product_id = p.id AND v.active AND v.delivery = 'digital'
     );

  RETURN v_store;
END;
$$;
--> statement-breakpoint
-- The template's front page (D54): its products in a content grid, which
-- new stores copy and then change as they like. Only where a template
-- exists and has no front page yet (a new database gets it from the seed).
DO $$
DECLARE
  v_template uuid;
  v_page uuid;
BEGIN
  SELECT id INTO v_template FROM commerce.stores WHERE is_template AND front_page_id IS NULL;
  IF v_template IS NULL OR EXISTS (SELECT 1 FROM commerce.pages WHERE store_id = v_template AND slug = 'forside') THEN
    RETURN;
  END IF;
  INSERT INTO commerce.pages (store_id, slug, draft, published, published_at)
  VALUES (v_template, 'forside', '{"title": "Forside", "slug": "forside", "thumbnail": null, "seo": {"title": "", "description": ""}, "searchEngines": true, "aiAssistants": true, "categories": [], "tags": [], "translations": {"sv-SE": {"title": "Startsida"}}, "rows": [{"id": "front-row", "type": "row", "layout": "1", "columns": [{"id": "front-column", "blocks": [{"id": "front-heading", "type": "heading", "text": "Produkter", "level": 1}, {"id": "front-products", "type": "contentGrid", "source": {"type": "products"}, "categories": [], "tags": [], "sort": "oldest", "limit": 48, "columns": {"mobile": 2, "tablet": 3, "desktop": 4}, "show": {"image": true, "heading": true, "excerpt": false, "price": true, "button": false}, "buttonLabel": "", "emptyText": "", "imageShape": "square", "headingLevel": 2, "excerptLines": 3, "gap": 24}]}]}]}'::jsonb, '{"title": "Forside", "slug": "forside", "thumbnail": null, "seo": {"title": "", "description": ""}, "searchEngines": true, "aiAssistants": true, "categories": [], "tags": [], "translations": {"sv-SE": {"title": "Startsida"}}, "rows": [{"id": "front-row", "type": "row", "layout": "1", "columns": [{"id": "front-column", "blocks": [{"id": "front-heading", "type": "heading", "text": "Produkter", "level": 1}, {"id": "front-products", "type": "contentGrid", "source": {"type": "products"}, "categories": [], "tags": [], "sort": "oldest", "limit": 48, "columns": {"mobile": 2, "tablet": 3, "desktop": 4}, "show": {"image": true, "heading": true, "excerpt": false, "price": true, "button": false}, "buttonLabel": "", "emptyText": "", "imageShape": "square", "headingLevel": 2, "excerptLines": 3, "gap": 24}]}]}]}'::jsonb, now())
  RETURNING id INTO v_page;
  UPDATE commerce.stores SET front_page_id = v_page WHERE id = v_template;
END;
$$;
