-- The bonus program (D130): a copy of a store keeps its program's settings, never its customers' credits.
-- `duplicate_store()` is replaced as it was (20260930150511_store_copy_rules.sql) with the one statement added.
CREATE OR REPLACE FUNCTION commerce.duplicate_store(
  p_source uuid,
  p_slug text,
  p_name text,
  p_owner uuid,
  p_page_ids uuid[] DEFAULT NULL,
  p_product_ids uuid[] DEFAULT NULL,
  p_post_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_store uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.stores WHERE id = p_source) THEN
    RAISE EXCEPTION 'unknown store %', p_source;
  END IF;

  -- Tracking ids (analytics, pixels) and the store's own code belong to the original's site: the copy starts with
  -- none, so its visits are never sent to the original's tools.
  INSERT INTO commerce.stores (
    slug, name, created_by, legal_name, organisation_number, contact_email, postal_address, country, seo, navigation,
    cart_reminders, tracking, fonts, theme, custom_code, audience, business_popup, open_cart_on_add, modules,
    time_zone, booking_reminder_hours, custom_css, locales, rates_auto, rates_updated_at
  )
  SELECT p_slug, p_name, p_owner, s.legal_name, s.organisation_number, s.contact_email, s.postal_address, s.country,
         s.seo, s.navigation, s.cart_reminders, '{}'::jsonb, s.fonts, s.theme, '{}'::jsonb, s.audience,
         s.business_popup, s.open_cart_on_add, array_remove(s.modules, 'work'), s.time_zone,
         s.booking_reminder_hours, s.custom_css, s.locales, s.rates_auto, s.rates_updated_at
    FROM commerce.stores s WHERE s.id = p_source
  RETURNING id INTO v_store;

  -- Only the person copying owns the new store; the other members stay with the original.
  INSERT INTO commerce.store_members (store_id, account_id, role) VALUES (v_store, p_owner, 'owner');

  -- Which things are copied, and their new ids (null: left behind).
  CREATE TEMP TABLE IF NOT EXISTS _copy_ids (old_id uuid PRIMARY KEY, new_id uuid) ON COMMIT DROP;
  TRUNCATE pg_temp._copy_ids;
  INSERT INTO pg_temp._copy_ids (old_id, new_id)
  SELECT p.id, CASE WHEN p.status <> 'archived' AND (p_product_ids IS NULL OR p.id = ANY (p_product_ids))
                    THEN commerce.clone_id(v_store, p.id) END
    FROM commerce.products p WHERE p.store_id = p_source;
  INSERT INTO pg_temp._copy_ids (old_id, new_id)
  SELECT v.id, CASE WHEN m.new_id IS NOT NULL THEN commerce.clone_id(v_store, v.id) END
    FROM commerce.product_variants v
    JOIN pg_temp._copy_ids m ON m.old_id = v.product_id
   WHERE v.store_id = p_source;
  INSERT INTO pg_temp._copy_ids (old_id, new_id)
  SELECT p.id, CASE WHEN CASE p.type
                          WHEN 'page' THEN p_page_ids IS NULL OR p.id = ANY (p_page_ids)
                          WHEN 'article' THEN p_post_ids IS NULL OR p.id = ANY (p_post_ids)
                          ELSE true
                        END
                    THEN commerce.clone_id(v_store, p.id) END
    FROM commerce.pages p WHERE p.store_id = p_source;
  INSERT INTO pg_temp._copy_ids (old_id, new_id)
  SELECT id, commerce.clone_id(v_store, id) FROM commerce.terms WHERE store_id = p_source
  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.menus WHERE store_id = p_source
  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.field_groups WHERE store_id = p_source
  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.saved_parts WHERE store_id = p_source
  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.store_themes WHERE store_id = p_source
  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.customer_tiers WHERE store_id = p_source
  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.customer_companies WHERE store_id = p_source
  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.discount_codes WHERE store_id = p_source;

  -- Settings ------------------------------------------------------------------------------------------------

  -- What the store accepts: the switches, never the keys (a new Stripe account is the new owner's to connect).
  UPDATE commerce.payment_providers n
     SET enabled = s.enabled, order_invoices = s.order_invoices
    FROM commerce.payment_providers s
   WHERE s.store_id = p_source AND n.store_id = v_store AND n.provider = s.provider;

  INSERT INTO commerce.markets (store_id, code, currency, default_locale, locales, active, created_at)
  SELECT v_store, code, currency, default_locale, locales, active, created_at
    FROM commerce.markets WHERE store_id = p_source;

  INSERT INTO commerce.store_currencies (store_id, currency, rate, round_to, position)
  SELECT v_store, currency, rate, round_to, position
    FROM commerce.store_currencies WHERE store_id = p_source;

  INSERT INTO commerce.shipping_rates (store_id, market_code, currency, amount_minor, free_over_minor)
  SELECT v_store, market_code, currency, amount_minor, free_over_minor
    FROM commerce.shipping_rates WHERE store_id = p_source;

  INSERT INTO commerce.payment_methods (store_id, market_code, method, enabled)
  SELECT v_store, market_code, method, enabled
    FROM commerce.payment_methods WHERE store_id = p_source;

  INSERT INTO commerce.producer_registrations (
    id, store_id, market_code, scheme, registration_number, authority, valid_from, valid_to, created_at
  )
  SELECT commerce.clone_id(v_store, id), v_store, market_code, scheme, registration_number, authority, valid_from,
         valid_to, created_at
    FROM commerce.producer_registrations WHERE store_id = p_source;

  INSERT INTO commerce.economic_operators (id, store_id, name, postal_address, electronic_address, country, created_at)
  SELECT commerce.clone_id(v_store, id), v_store, name, postal_address, electronic_address, country, created_at
    FROM commerce.economic_operators WHERE store_id = p_source;

  INSERT INTO commerce.inventory_locations (id, store_id, name, country, active, created_at)
  SELECT commerce.clone_id(v_store, id), v_store, name, country, active, created_at
    FROM commerce.inventory_locations WHERE store_id = p_source;

  INSERT INTO commerce.store_locations (
    id, store_id, kind, name, street, postal_code, city, country, phone, notes, hours, position
  )
  SELECT commerce.clone_id(v_store, id), v_store, kind, name, street, postal_code, city, country, phone, notes, hours,
         position
    FROM commerce.store_locations WHERE store_id = p_source;

  -- Staff, rooms and rental items. A host's are the host's (hosts stay with the original), and a calendar's
  -- secret address is the original's; the copy gets its own when it is published.
  INSERT INTO commerce.booking_resources (
    id, store_id, kind, name, email, hours, capacity, active, position, host_id, property_address, land_registry_number
  )
  SELECT commerce.clone_id(v_store, id), v_store, kind, name, email, hours, capacity, active, position, NULL,
         property_address, land_registry_number
    FROM commerce.booking_resources WHERE store_id = p_source AND host_id IS NULL;

  INSERT INTO commerce.customer_tiers (id, store_id, name, percent, note, active, created_at)
  SELECT commerce.clone_id(v_store, id), v_store, name, percent, note, active, created_at
    FROM commerce.customer_tiers WHERE store_id = p_source;

  INSERT INTO commerce.customer_companies (
    id, store_id, name, organisation_number, tier_id, employee_share_percent, max_members, active, created_at
  )
  SELECT commerce.clone_id(v_store, id), v_store, name, organisation_number, commerce.clone_id(v_store, tier_id),
         employee_share_percent, max_members, active, created_at
    FROM commerce.customer_companies WHERE store_id = p_source;

  INSERT INTO commerce.store_themes (id, store_id, name, base, settings, created_by, created_at)
  SELECT commerce.clone_id(v_store, id), v_store, name, base, settings, p_owner, created_at
    FROM commerce.store_themes WHERE store_id = p_source;

  INSERT INTO commerce.cookie_notes (store_id, kind, name, domain, category, provider, purpose, updated_by)
  SELECT v_store, kind, name, domain, category, provider, purpose, p_owner
    FROM commerce.cookie_notes WHERE store_id = p_source;

  INSERT INTO commerce.chat_agents (
    store_id, enabled, name, occupation, avatar, greeting, instructions, voice, daily_limit, updated_by
  )
  SELECT v_store, enabled, name, occupation, avatar, greeting, instructions, voice, daily_limit, p_owner
    FROM commerce.chat_agents WHERE store_id = p_source;

  INSERT INTO commerce.knowledge_documents (id, store_id, title, file_name, content, created_at, updated_at, created_by)
  SELECT commerce.clone_id(v_store, id), v_store, title, file_name, content, created_at, updated_at, p_owner
    FROM commerce.knowledge_documents WHERE store_id = p_source;

  INSERT INTO commerce.discount_codes (
    id, store_id, code, kind, percent, amounts, min_subtotals, product_ids, recurring, starts_at, ends_at,
    usage_limit, once_per_customer, active, created_at, updated_at
  )
  SELECT commerce.clone_id(v_store, id), v_store, code, kind, percent, amounts, min_subtotals, product_ids, recurring,
         starts_at, ends_at, usage_limit, once_per_customer, active, created_at, updated_at
    FROM commerce.discount_codes WHERE store_id = p_source;

  INSERT INTO commerce.cart_reminder_steps (
    id, store_id, delay_minutes, active, discount_code_id, content, created_at, updated_at
  )
  SELECT commerce.clone_id(v_store, id), v_store, delay_minutes, active, commerce.clone_id(v_store, discount_code_id),
         content, created_at, updated_at
    FROM commerce.cart_reminder_steps WHERE store_id = p_source;

  -- The bonus program's settings (D130); the ledger never: customers' credits belong to the original's customers.
  INSERT INTO commerce.bonus_settings (
    store_id, enabled, earn_bps, pending_days, max_redeem_percent, min_redeem_minor, expires_months, currency, updated_by
  )
  SELECT v_store, enabled, earn_bps, pending_days, max_redeem_percent, min_redeem_minor, expires_months, currency, p_owner
    FROM commerce.bonus_settings WHERE store_id = p_source;

  INSERT INTO commerce.delivery_schedules (
    id, store_id, market_code, currency, name, delivery_weekday, cutoff_days, cutoff_time, active, created_at
  )
  SELECT commerce.clone_id(v_store, id), v_store, market_code, currency, name, delivery_weekday, cutoff_days,
         cutoff_time, active, created_at
    FROM commerce.delivery_schedules WHERE store_id = p_source;

  -- Categories and tags (D50) belong to the store's structure, so all come, whichever products do. Parents are
  -- set once every category exists, so the parent check finds them.
  INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position, created_at, updated_at)
  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, created_at, updated_at
    FROM commerce.terms WHERE store_id = p_source;

  UPDATE commerce.terms n
     SET parent_id = commerce.clone_id(v_store, t.parent_id)
    FROM commerce.terms t
   WHERE t.store_id = p_source AND t.parent_id IS NOT NULL AND n.id = commerce.clone_id(v_store, t.id);

  INSERT INTO commerce.field_groups (
    id, store_id, name, slug, entities, location, fields, position, active, sort, created_at, updated_at
  )
  SELECT commerce.clone_id(v_store, g.id), v_store, g.name, g.slug, g.entities,
         commerce.clone_field_location(v_store, g.location), g.fields, g.position, g.active, g.sort, g.created_at,
         g.updated_at
    FROM commerce.field_groups g WHERE g.store_id = p_source;

  -- The store's saved rows, columns and components (D46) as private ones: what the owner shared with other
  -- stores or the marketplace stays the original's to share. Global ones (D98) keep their ids' meaning, as the
  -- pages using them are remapped below.
  INSERT INTO commerce.saved_parts (
    id, store_id, kind, name, content, created_at, created_by, updated_at, updated_by, global, translations, sharing
  )
  SELECT commerce.clone_id(v_store, id), v_store, kind, name, commerce.copy_remap(content, p_source, v_store),
         created_at, p_owner, updated_at, p_owner, global, translations, 'private'
    FROM commerce.saved_parts WHERE store_id = p_source;

  INSERT INTO commerce.template_activations (store_id, part_id, active, changed_at, changed_by)
  SELECT v_store, a.part_id, a.active, a.changed_at, p_owner
    FROM commerce.template_activations a WHERE a.store_id = p_source;

  -- Products ------------------------------------------------------------------------------------------------

  -- They arrive as drafts and are published below, once their pictures, titles and variants exist (the
  -- publishing check needs them).
  INSERT INTO commerce.products (
    id, store_id, handle, status, manufacturer_id, responsible_person_id, tax_code, withdrawal_exclusion, delivery,
    download_limit, download_days, subscription_only, kind, vat_category, audience, created_at, updated_at
  )
  SELECT m.new_id, v_store, p.handle, 'draft', commerce.clone_id(v_store, p.manufacturer_id),
         commerce.clone_id(v_store, p.responsible_person_id), p.tax_code, p.withdrawal_exclusion, p.delivery,
         p.download_limit, p.download_days, p.subscription_only, p.kind, p.vat_category, p.audience, p.created_at,
         p.updated_at
    FROM commerce.products p JOIN pg_temp._copy_ids m ON m.old_id = p.id
   WHERE p.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.product_translations (
    store_id, product_id, locale, title, description, safety_information, seo_title, seo_description
  )
  SELECT v_store, m.new_id, t.locale, t.title, t.description, t.safety_information, t.seo_title, t.seo_description
    FROM commerce.product_translations t JOIN pg_temp._copy_ids m ON m.old_id = t.product_id
   WHERE t.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt, thumbnail_url)
  SELECT v_store, m.new_id, pm.url, pm.position, pm.alt, pm.thumbnail_url
    FROM commerce.product_media pm JOIN pg_temp._copy_ids m ON m.old_id = pm.product_id
   WHERE pm.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.product_schemes (store_id, product_id, scheme)
  SELECT v_store, m.new_id, s.scheme
    FROM commerce.product_schemes s JOIN pg_temp._copy_ids m ON m.old_id = s.product_id
   WHERE s.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.product_terms (store_id, product_id, term_id, content_type)
  SELECT v_store, m.new_id, commerce.clone_id(v_store, pt.term_id), pt.content_type
    FROM commerce.product_terms pt JOIN pg_temp._copy_ids m ON m.old_id = pt.product_id
   WHERE pt.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.product_variants (
    id, store_id, product_id, sku, gtin, tax_code, options, weight_grams, hs_code, origin_country, active, delivery,
    rental_period, image_url, image_thumbnail_url, created_at
  )
  SELECT m.new_id, v_store, commerce.clone_id(v_store, v.product_id), v.sku, v.gtin, v.tax_code, v.options,
         v.weight_grams, v.hs_code, v.origin_country, v.active, v.delivery, v.rental_period, v.image_url,
         v.image_thumbnail_url, v.created_at
    FROM commerce.product_variants v JOIN pg_temp._copy_ids m ON m.old_id = v.id
   WHERE v.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.selling_plans (
    id, store_id, product_id, interval, interval_count, discount_percent, trial_days, signup_fee, min_cycles,
    position, active, created_at
  )
  SELECT commerce.clone_id(v_store, sp.id), v_store, commerce.clone_id(v_store, sp.product_id), sp.interval,
         sp.interval_count, sp.discount_percent, sp.trial_days, sp.signup_fee, sp.min_cycles, sp.position, sp.active,
         sp.created_at
    FROM commerce.selling_plans sp JOIN pg_temp._copy_ids m ON m.old_id = sp.product_id
   WHERE sp.store_id = p_source AND m.new_id IS NOT NULL;

  -- The current price of each variant, as a new price: the copy shows no reduction it never made.
  INSERT INTO commerce.prices (store_id, variant_id, market_code, currency, amount_minor, valid_from)
  SELECT v_store, m.new_id, pr.market_code, pr.currency, pr.amount_minor, now()
    FROM commerce.prices pr JOIN pg_temp._copy_ids m ON m.old_id = pr.variant_id
   WHERE pr.store_id = p_source AND pr.valid_to IS NULL AND m.new_id IS NOT NULL;

  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
  SELECT v_store, m.new_id, commerce.clone_id(v_store, l.location_id), l.on_hand
    FROM commerce.inventory_levels l JOIN pg_temp._copy_ids m ON m.old_id = l.variant_id
   WHERE l.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.appointment_settings (
    product_id, store_id, duration_minutes, buffer_before_minutes, buffer_after_minutes, step_minutes,
    min_notice_minutes, max_days_ahead, location_id, payment, deposit_percent, cancel_hours, no_show_percent,
    check_in_time, check_out_time, min_nights, max_nights, booking_fee
  )
  SELECT m.new_id, v_store, a.duration_minutes, a.buffer_before_minutes, a.buffer_after_minutes, a.step_minutes,
         a.min_notice_minutes, a.max_days_ahead, commerce.clone_id(v_store, a.location_id), a.payment,
         a.deposit_percent, a.cancel_hours, a.no_show_percent, a.check_in_time, a.check_out_time, a.min_nights,
         a.max_nights, a.booking_fee
    FROM commerce.appointment_settings a JOIN pg_temp._copy_ids m ON m.old_id = a.product_id
   WHERE a.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.booking_seasons (store_id, product_id, name, names, from_day, to_day, weekdays, percent, position)
  SELECT v_store, m.new_id, s.name, s.names, s.from_day, s.to_day, s.weekdays, s.percent, s.position
    FROM commerce.booking_seasons s JOIN pg_temp._copy_ids m ON m.old_id = s.product_id
   WHERE s.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.product_resources (store_id, product_id, resource_id)
  SELECT v_store, m.new_id, commerce.clone_id(v_store, pr.resource_id)
    FROM commerce.product_resources pr JOIN pg_temp._copy_ids m ON m.old_id = pr.product_id
   WHERE pr.store_id = p_source AND m.new_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM commerce.booking_resources r
                  WHERE r.store_id = v_store AND r.id = commerce.clone_id(v_store, pr.resource_id));

  -- Menus (D85): their links name pages, categories and tags by address, which the copies keep; a link to a
  -- product that was not copied goes.
  INSERT INTO commerce.menus (id, store_id, name, items, created_at, created_by, updated_at, updated_by)
  SELECT commerce.clone_id(v_store, id), v_store, name,
         commerce.copy_remap(commerce.copy_menu_items(v_store, items), p_source, v_store), created_at, p_owner,
         updated_at, p_owner
    FROM commerce.menus WHERE store_id = p_source;

  -- Pages, posts, headers, footers and product layouts ----------------------------------------------------------

  -- The chosen pages and posts, and every header, footer and product layout (they are settings), with their
  -- draft and published content: category, tag, menu, field group and saved part ids made the copies'. Posts
  -- keep the dates they were first published on.
  INSERT INTO commerce.pages (
    id, store_id, type, slug, draft, published, published_at, first_published_at, created_at, created_by, updated_at,
    updated_by
  )
  SELECT m.new_id, v_store, p.type, p.slug, commerce.copy_remap(p.draft, p_source, v_store),
         commerce.copy_remap(p.published, p_source, v_store), p.published_at, p.first_published_at, p.created_at,
         p_owner, p.updated_at, p_owner
    FROM commerce.pages p JOIN pg_temp._copy_ids m ON m.old_id = p.id
   WHERE p.store_id = p_source AND m.new_id IS NOT NULL;

  UPDATE commerce.stores s
     SET front_page_id = (SELECT m.new_id FROM pg_temp._copy_ids m WHERE m.old_id = t.front_page_id),
         products_page_id = (SELECT m.new_id FROM pg_temp._copy_ids m WHERE m.old_id = t.products_page_id),
         product_layout_id = (SELECT m.new_id FROM pg_temp._copy_ids m WHERE m.old_id = t.product_layout_id),
         header_id = (SELECT m.new_id FROM pg_temp._copy_ids m WHERE m.old_id = t.header_id),
         footer_id = (SELECT m.new_id FROM pg_temp._copy_ids m WHERE m.old_id = t.footer_id),
         header_menu_id = (SELECT m.new_id FROM pg_temp._copy_ids m WHERE m.old_id = t.header_menu_id),
         footer_menu_id = (SELECT m.new_id FROM pg_temp._copy_ids m WHERE m.old_id = t.footer_menu_id),
         theme = commerce.copy_remap(t.theme, p_source, v_store)
    FROM commerce.stores t
   WHERE s.id = v_store AND t.id = p_source;

  UPDATE commerce.terms c
     SET product_layout_id = m.new_id
    FROM commerce.terms t JOIN pg_temp._copy_ids m ON m.old_id = t.product_layout_id
   WHERE t.store_id = p_source AND c.store_id = v_store AND c.id = commerce.clone_id(v_store, t.id)
     AND m.new_id IS NOT NULL;

  UPDATE commerce.products c
     SET product_layout_id = m.new_id
    FROM commerce.products t JOIN pg_temp._copy_ids m ON m.old_id = t.product_layout_id
   WHERE t.store_id = p_source AND c.store_id = v_store AND c.id = commerce.clone_id(v_store, t.id)
     AND m.new_id IS NOT NULL;

  -- The blog, search, 404 and working pages (D112, D113): the copies of the original's chosen pages.
  INSERT INTO commerce.page_roles (store_id, role, page_id)
  SELECT v_store, r.role, m.new_id
    FROM commerce.page_roles r JOIN pg_temp._copy_ids m ON m.old_id = r.page_id
   WHERE r.store_id = p_source AND m.new_id IS NOT NULL;

  -- Products' status: what it was, but a download waits as a draft for its files (they stay with the original).
  UPDATE commerce.products p
     SET status = 'active'
    FROM commerce.products t
   WHERE t.store_id = p_source AND t.status = 'active' AND p.store_id = v_store
     AND p.id = commerce.clone_id(v_store, t.id)
     AND NOT EXISTS (
       SELECT 1 FROM commerce.product_variants v
        WHERE v.product_id = p.id AND v.active AND v.delivery = 'digital'
     );

  -- Campaigns (D114) and what they name ----------------------------------------------------------------------------

  -- A campaign for products that were not copied is switched off rather than left to reach the whole store,
  -- and one giving a product that was not copied is left out (a gift needs its product).
  INSERT INTO commerce.campaigns (
    id, store_id, name, kind, percent, buy_quantity, pay_quantity, gift_variant_id, gift_quantity, thresholds,
    product_ids, term_ids, starts_at, ends_at, active, created_at, updated_at, tier_ids, usage_limit, stacks,
    per_customer_limit, markets
  )
  SELECT commerce.clone_id(v_store, c.id), v_store, c.name, c.kind, c.percent, c.buy_quantity, c.pay_quantity,
         g.new_id, c.gift_quantity, c.thresholds, scoped.product_ids, commerce.copy_remap(c.term_ids, p_source, v_store),
         c.starts_at, c.ends_at,
         c.active AND NOT (
           jsonb_array_length(c.product_ids) + jsonb_array_length(c.term_ids) > 0
           AND jsonb_array_length(scoped.product_ids) + jsonb_array_length(c.term_ids) = 0
         ),
         c.created_at, c.updated_at, commerce.copy_remap(c.tier_ids, p_source, v_store), c.usage_limit, c.stacks,
         c.per_customer_limit, c.markets
    FROM commerce.campaigns c
    LEFT JOIN pg_temp._copy_ids g ON g.old_id = c.gift_variant_id
    CROSS JOIN LATERAL (SELECT commerce.copy_remap(c.product_ids, p_source, v_store) AS product_ids) scoped
   WHERE c.store_id = p_source AND (c.gift_variant_id IS NULL OR g.new_id IS NOT NULL);

  UPDATE commerce.discount_codes d
     SET product_ids = commerce.copy_remap(t.product_ids, p_source, v_store),
         active = t.active AND NOT (
           jsonb_array_length(t.product_ids) > 0
           AND jsonb_array_length(commerce.copy_remap(t.product_ids, p_source, v_store)) = 0
         )
    FROM commerce.discount_codes t
   WHERE t.store_id = p_source AND t.product_ids IS NOT NULL AND d.store_id = v_store
     AND d.id = commerce.clone_id(v_store, t.id);

  -- Custom fields (D118): what was entered for the things copied (a link or relation to something that was
  -- not copied is left out), the store's own values, and what keyword search reads of them.
  INSERT INTO commerce.field_values (store_id, entity, entity_id, locale, values, updated_at)
  SELECT v_store, fv.entity, m.new_id, fv.locale, commerce.copy_remap(fv.values, p_source, v_store), fv.updated_at
    FROM commerce.field_values fv JOIN pg_temp._copy_ids m ON m.old_id = fv.entity_id
   WHERE fv.store_id = p_source AND fv.entity IN ('product', 'page', 'article', 'variant', 'term')
     AND m.new_id IS NOT NULL;

  INSERT INTO commerce.field_values (store_id, entity, entity_id, locale, values, updated_at)
  SELECT v_store, 'store', v_store, fv.locale, commerce.copy_remap(fv.values, p_source, v_store), fv.updated_at
    FROM commerce.field_values fv
   WHERE fv.store_id = p_source AND fv.entity = 'store' AND fv.entity_id = p_source;

  INSERT INTO commerce.field_search (store_id, entity, entity_id, locale, body)
  SELECT v_store, fs.entity, m.new_id, fs.locale, fs.body
    FROM commerce.field_search fs JOIN pg_temp._copy_ids m ON m.old_id = fs.entity_id
   WHERE fs.store_id = p_source AND m.new_id IS NOT NULL;

  RETURN v_store;
END;
$$;
