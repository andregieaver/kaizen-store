-- Custom fields on variants and on categories and tags (D118, phase 2): their
-- values go with them when they are deleted or a store is copied, and so does
-- the words of a product's searchable fields.
CREATE TRIGGER variants_forget_field_values AFTER DELETE ON commerce.product_variants
  FOR EACH ROW EXECUTE FUNCTION commerce.forget_field_values('variant');
--> statement-breakpoint
CREATE TRIGGER terms_forget_field_values AFTER DELETE ON commerce.terms
  FOR EACH ROW EXECUTE FUNCTION commerce.forget_field_values('term');
--> statement-breakpoint
CREATE FUNCTION commerce.forget_field_search() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  DELETE FROM commerce.field_search WHERE store_id = OLD.store_id AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER products_forget_field_search AFTER DELETE ON commerce.products
  FOR EACH ROW EXECUTE FUNCTION commerce.forget_field_search();
--> statement-breakpoint
ALTER TABLE commerce.field_search ENABLE ROW LEVEL SECURITY;
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

  INSERT INTO commerce.stores (slug, name, created_by, navigation, fonts, theme, modules, time_zone, booking_reminder_hours)
  SELECT p_slug, p_name, p_owner_id, navigation, fonts, theme - 'savedId', modules, time_zone, booking_reminder_hours
    FROM commerce.stores WHERE id = p_template_id
  RETURNING id INTO v_store;

  INSERT INTO commerce.store_members (store_id, account_id, role)
  VALUES (v_store, p_owner_id, 'owner');

  -- The template's menus (D85), used where the template's were; their links
  -- name pages, products, categories and tags by address, which the copies keep.
  INSERT INTO commerce.menus (id, store_id, name, items, created_by, updated_by)
  SELECT commerce.clone_id(v_store, id), v_store, name, items, p_owner_id, p_owner_id
    FROM commerce.menus WHERE store_id = p_template_id;

  UPDATE commerce.stores s
     SET header_menu_id = commerce.clone_id(v_store, t.header_menu_id),
         footer_menu_id = commerce.clone_id(v_store, t.footer_menu_id)
    FROM commerce.stores t
   WHERE s.id = v_store AND t.id = p_template_id;

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
    tax_code, withdrawal_exclusion, delivery, download_limit, download_days, subscription_only,
    kind, vat_category, audience
  )
  SELECT commerce.clone_id(v_store, id), v_store, handle, 'draft',
         commerce.clone_id(v_store, manufacturer_id),
         commerce.clone_id(v_store, responsible_person_id),
         tax_code, withdrawal_exclusion, delivery, download_limit, download_days, subscription_only,
         kind, vat_category, audience
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
    hs_code, origin_country, active, delivery, rental_period, image_url, image_thumbnail_url
  )
  SELECT commerce.clone_id(v_store, v.id), v_store, commerce.clone_id(v_store, v.product_id),
         v.sku, v.gtin, v.tax_code, v.options, v.weight_grams, v.hs_code, v.origin_country, v.active, v.delivery,
         v.rental_period, v.image_url, v.image_thumbnail_url
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

  -- Bookings (D65, D67): the template's staff, rooms and rental items, and how
  -- its appointments, stays and rentals are booked. Places are the store's own
  -- addresses and stay behind.
  INSERT INTO commerce.booking_resources (id, store_id, kind, name, email, hours, capacity, active, position)
  SELECT commerce.clone_id(v_store, id), v_store, kind, name, '', hours, capacity, active, position
    FROM commerce.booking_resources WHERE store_id = p_template_id;

  INSERT INTO commerce.appointment_settings (
    product_id, store_id, duration_minutes, buffer_before_minutes, buffer_after_minutes, step_minutes,
    min_notice_minutes, max_days_ahead, payment, deposit_percent, cancel_hours, no_show_percent,
    check_in_time, check_out_time, min_nights, max_nights, booking_fee
  )
  SELECT commerce.clone_id(v_store, a.product_id), v_store, a.duration_minutes, a.buffer_before_minutes,
         a.buffer_after_minutes, a.step_minutes, a.min_notice_minutes, a.max_days_ahead,
         a.payment, a.deposit_percent, a.cancel_hours, a.no_show_percent,
         a.check_in_time, a.check_out_time, a.min_nights, a.max_nights, a.booking_fee
    FROM commerce.appointment_settings a
    JOIN commerce.products p ON p.id = a.product_id
   WHERE a.store_id = p_template_id AND p.status <> 'archived';

  -- Seasons of stays' and rentals' prices (D70).
  INSERT INTO commerce.booking_seasons (store_id, product_id, name, names, from_day, to_day, weekdays, percent, position)
  SELECT v_store, commerce.clone_id(v_store, s.product_id), s.name, s.names, s.from_day, s.to_day, s.weekdays, s.percent, s.position
    FROM commerce.booking_seasons s
    JOIN commerce.products p ON p.id = s.product_id
   WHERE s.store_id = p_template_id AND p.status <> 'archived';

  INSERT INTO commerce.product_resources (store_id, product_id, resource_id)
  SELECT v_store, commerce.clone_id(v_store, pr.product_id), commerce.clone_id(v_store, pr.resource_id)
    FROM commerce.product_resources pr
    JOIN commerce.products p ON p.id = pr.product_id
   WHERE pr.store_id = p_template_id AND p.status <> 'archived';

  -- The template's published pages and articles (D53-D57), published in the copy, with
  -- the category and tag ids in them (the page's own and its grids') made the
  -- copies'; and its front page (D54).
  INSERT INTO commerce.pages (id, store_id, type, slug, draft, published, published_at, first_published_at, created_by, updated_by)
  SELECT commerce.clone_id(v_store, p.id), v_store, p.type, p.slug,
         commerce.clone_page_content(v_store, p_template_id, p.published),
         commerce.clone_page_content(v_store, p_template_id, p.published),
         now(), now(), p_owner_id, p_owner_id
    FROM commerce.pages p
   WHERE p.store_id = p_template_id AND p.published_at IS NOT NULL;

  UPDATE commerce.stores s
     SET front_page_id = commerce.clone_id(v_store, t.front_page_id)
    FROM commerce.stores t
   WHERE s.id = v_store AND t.id = p_template_id
     AND EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = commerce.clone_id(v_store, t.front_page_id));

  -- The All products page (D83), as the front page.
  UPDATE commerce.stores s
     SET products_page_id = commerce.clone_id(v_store, t.products_page_id)
    FROM commerce.stores t
   WHERE s.id = v_store AND t.id = p_template_id
     AND EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = commerce.clone_id(v_store, t.products_page_id));

  -- Product layouts (D79): the copies are used where the template's published
  -- ones were, for the store, its product categories and tags, and products.
  UPDATE commerce.stores s
     SET product_layout_id = commerce.clone_id(v_store, t.product_layout_id)
    FROM commerce.stores t
   WHERE s.id = v_store AND t.id = p_template_id
     AND EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = commerce.clone_id(v_store, t.product_layout_id));

  UPDATE commerce.terms c
     SET product_layout_id = commerce.clone_id(v_store, t.product_layout_id)
    FROM commerce.terms t
   WHERE t.store_id = p_template_id AND t.product_layout_id IS NOT NULL
     AND c.store_id = v_store AND c.id = commerce.clone_id(v_store, t.id)
     AND EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = commerce.clone_id(v_store, t.product_layout_id));

  UPDATE commerce.products c
     SET product_layout_id = commerce.clone_id(v_store, t.product_layout_id)
    FROM commerce.products t
   WHERE t.store_id = p_template_id AND t.product_layout_id IS NOT NULL
     AND c.store_id = v_store AND c.id = commerce.clone_id(v_store, t.id)
     AND EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = commerce.clone_id(v_store, t.product_layout_id));

  -- The header and footer (D80): the copies are used where the template's published ones were.
  UPDATE commerce.stores s
     SET header_id = commerce.clone_id(v_store, t.header_id)
    FROM commerce.stores t
   WHERE s.id = v_store AND t.id = p_template_id
     AND EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = commerce.clone_id(v_store, t.header_id));

  UPDATE commerce.stores s
     SET footer_id = commerce.clone_id(v_store, t.footer_id)
    FROM commerce.stores t
   WHERE s.id = v_store AND t.id = p_template_id
     AND EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = commerce.clone_id(v_store, t.footer_id));

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

  -- The blog, search and 404 pages (D112): the copies of the template's chosen pages.
  INSERT INTO commerce.page_roles (store_id, role, page_id)
  SELECT v_store, r.role, commerce.clone_id(v_store, r.page_id)
    FROM commerce.page_roles r
   WHERE r.store_id = p_template_id
     AND EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = commerce.clone_id(v_store, r.page_id));

  -- The template's custom field groups (D118), with the categories and tags in
  -- their rules made the copies'; and what was entered in the fields of the
  -- products, pages and articles copied above (values are keyed by field ids,
  -- which the copies keep).
  INSERT INTO commerce.field_groups (id, store_id, name, slug, entities, location, fields, position, active, sort)
  SELECT commerce.clone_id(v_store, g.id), v_store, g.name, g.slug, g.entities,
         commerce.clone_field_location(v_store, g.location), g.fields, g.position, g.active, g.sort
    FROM commerce.field_groups g WHERE g.store_id = p_template_id;

  INSERT INTO commerce.field_values (store_id, entity, entity_id, locale, values)
  SELECT v_store, fv.entity, commerce.clone_id(v_store, fv.entity_id), fv.locale, fv.values
    FROM commerce.field_values fv
   WHERE fv.store_id = p_template_id
     AND (
       (fv.entity = 'product'
         AND EXISTS (SELECT 1 FROM commerce.products p WHERE p.id = commerce.clone_id(v_store, fv.entity_id)))
       OR (fv.entity IN ('page', 'article')
         AND EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = commerce.clone_id(v_store, fv.entity_id)))
       OR (fv.entity = 'variant'
         AND EXISTS (SELECT 1 FROM commerce.product_variants v WHERE v.id = commerce.clone_id(v_store, fv.entity_id)))
       OR (fv.entity = 'term'
         AND EXISTS (SELECT 1 FROM commerce.terms t WHERE t.id = commerce.clone_id(v_store, fv.entity_id)))
     );

  -- What keyword search reads of the products' fields (D118).
  INSERT INTO commerce.field_search (store_id, entity, entity_id, locale, body)
  SELECT v_store, fs.entity, commerce.clone_id(v_store, fs.entity_id), fs.locale, fs.body
    FROM commerce.field_search fs
   WHERE fs.store_id = p_template_id
     AND EXISTS (SELECT 1 FROM commerce.products p WHERE p.id = commerce.clone_id(v_store, fs.entity_id));

  RETURN v_store;
END;
$$;
