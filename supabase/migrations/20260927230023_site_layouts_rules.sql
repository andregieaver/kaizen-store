-- A site's header and footer (D80): a store's chosen ones are its own pages
-- of type header and footer, Kaizen's its own (store_id null). Deleting the
-- page sets only the column back to null (a store's id stays), so the site
-- falls back to the standard header or footer.
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_header_fk"
  FOREIGN KEY ("id", "header_id") REFERENCES "commerce"."pages" ("store_id", "id")
  ON DELETE SET NULL ("header_id");
--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_footer_fk"
  FOREIGN KEY ("id", "footer_id") REFERENCES "commerce"."pages" ("store_id", "id")
  ON DELETE SET NULL ("footer_id");
--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_header_fk"
  FOREIGN KEY ("header_id") REFERENCES "commerce"."pages" ("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_footer_fk"
  FOREIGN KEY ("footer_id") REFERENCES "commerce"."pages" ("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "stores_header_idx" ON "commerce"."stores" ("id", "header_id");
--> statement-breakpoint
CREATE INDEX "stores_footer_idx" ON "commerce"."stores" ("id", "footer_id");
--> statement-breakpoint
CREATE INDEX "platform_settings_header_idx" ON "commerce"."platform_settings" ("header_id");
--> statement-breakpoint
CREATE INDEX "platform_settings_footer_idx" ON "commerce"."platform_settings" ("footer_id");
--> statement-breakpoint
-- What is chosen as a header is a header, and as a footer a footer; Kaizen's are its own.
CREATE OR REPLACE FUNCTION commerce.site_layout_is_type() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.header_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.pages p
     WHERE p.id = NEW.header_id AND p.type = 'header'
       AND (TG_TABLE_NAME <> 'platform_settings' OR p.store_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'a site''s header must be one of its headers';
  END IF;
  IF NEW.footer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.pages p
     WHERE p.id = NEW.footer_id AND p.type = 'footer'
       AND (TG_TABLE_NAME <> 'platform_settings' OR p.store_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'a site''s footer must be one of its footers';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stores_site_layout_is_type
BEFORE INSERT OR UPDATE OF header_id, footer_id ON commerce.stores
FOR EACH ROW EXECUTE FUNCTION commerce.site_layout_is_type();
--> statement-breakpoint
CREATE TRIGGER platform_settings_site_layout_is_type
BEFORE INSERT OR UPDATE OF header_id, footer_id ON commerce.platform_settings
FOR EACH ROW EXECUTE FUNCTION commerce.site_layout_is_type();
--> statement-breakpoint
-- New stores copy the template's published header and footer (as its pages)
-- and use them where the template does.
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
    tax_code, withdrawal_exclusion, attributes, delivery, download_limit, download_days, subscription_only,
    kind, vat_category, audience
  )
  SELECT commerce.clone_id(v_store, id), v_store, handle, 'draft',
         commerce.clone_id(v_store, manufacturer_id),
         commerce.clone_id(v_store, responsible_person_id),
         tax_code, withdrawal_exclusion, attributes, delivery, download_limit, download_days, subscription_only,
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
    hs_code, origin_country, active, delivery, rental_period
  )
  SELECT commerce.clone_id(v_store, v.id), v_store, commerce.clone_id(v_store, v.product_id),
         v.sku, v.gtin, v.tax_code, v.options, v.weight_grams, v.hs_code, v.origin_country, v.active, v.delivery,
         v.rental_period
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

  RETURN v_store;
END;
$$;
