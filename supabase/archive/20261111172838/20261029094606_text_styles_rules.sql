-- Text styles (D393, docs/text-styles.md): the server's alone, as every commerce table is; a store's are copied with it (a duplicate,
-- through copy_text_styles() in the copy's transaction) and from a store template (clone_starter_setup(), redefined here with that line).
ALTER TABLE commerce.text_styles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.copy_text_styles(p_source uuid, p_store uuid)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO commerce.text_styles (store_id, slug, name, kind, settings, css, position)
  SELECT p_store, slug, name, kind, settings, css, position
    FROM commerce.text_styles WHERE store_id = p_source
  ON CONFLICT ON CONSTRAINT text_styles_owner_slug DO NOTHING;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.clone_starter_setup(p_source uuid, p_store uuid, p_owner uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.stores WHERE id = p_source AND starter) THEN
    RAISE EXCEPTION 'store_starters.not_starter: % is not a store template', p_source USING ERRCODE = 'check_violation';
  END IF;

  -- Its features (D178), who it sells to, how the cart and checkout behave, its languages and the CSS its pages rely on; and where it came from.
  UPDATE commerce.stores n
     SET features = t.features,
         audience = t.audience,
         business_popup = t.business_popup,
         open_cart_on_add = t.open_cart_on_add,
         terms_at_checkout = t.terms_at_checkout,
         locales = t.locales,
         rates_auto = t.rates_auto,
         rates_updated_at = t.rates_updated_at,
         custom_css = t.custom_css,
         made_from_starter = COALESCE(
           (SELECT st.id FROM commerce.store_starters st WHERE st.store_id = p_source),
           t.starter_copy_of
         )
    FROM commerce.stores t
   WHERE n.id = p_store AND t.id = p_source;

  INSERT INTO commerce.store_currencies (store_id, currency, rate, round_to, position)
  SELECT p_store, currency, rate, round_to, position
    FROM commerce.store_currencies WHERE store_id = p_source
  ON CONFLICT DO NOTHING;

  -- Pages and articles not published yet (the legal page drafts among them), as drafts: never published for the new owner.
  INSERT INTO commerce.pages (id, store_id, type, slug, draft, published, published_at, first_published_at, created_by, updated_by)
  SELECT commerce.clone_id(p_store, p.id), p_store, p.type, p.slug,
         commerce.clone_page_content(p_store, p_source, p.draft), NULL, NULL, NULL, p_owner, p_owner
    FROM commerce.pages p
   WHERE p.store_id = p_source AND p.published_at IS NULL AND p.type <> 'variant'
  ON CONFLICT DO NOTHING;

  INSERT INTO commerce.field_values (store_id, entity, entity_id, locale, values)
  SELECT p_store, fv.entity, commerce.clone_id(p_store, fv.entity_id), fv.locale, fv.values
    FROM commerce.field_values fv
    JOIN commerce.pages p ON p.store_id = fv.store_id AND p.id = fv.entity_id
   WHERE fv.store_id = p_source AND fv.entity IN ('page', 'article') AND p.published_at IS NULL
     AND EXISTS (SELECT 1 FROM commerce.pages c WHERE c.id = commerce.clone_id(p_store, fv.entity_id))
  ON CONFLICT DO NOTHING;

  -- The places (D112, D113, D158) given to those drafts: a legal page keeps its place, still a draft.
  INSERT INTO commerce.page_roles (store_id, role, page_id)
  SELECT p_store, r.role, commerce.clone_id(p_store, r.page_id)
    FROM commerce.page_roles r
   WHERE r.store_id = p_source
     AND EXISTS (SELECT 1 FROM commerce.pages p WHERE p.store_id = p_store AND p.id = commerce.clone_id(p_store, r.page_id))
  ON CONFLICT DO NOTHING;

  -- Order handling (D173): gift messages, archiving and how long a draft's pay link lasts; never the power to record payments.
  INSERT INTO commerce.order_settings (store_id, gift_messages, auto_archive_days, draft_valid_days)
  SELECT p_store, gift_messages, auto_archive_days, draft_valid_days
    FROM commerce.order_settings WHERE store_id = p_source
  ON CONFLICT (store_id) DO UPDATE
    SET gift_messages = excluded.gift_messages, auto_archive_days = excluded.auto_archive_days, draft_valid_days = excluded.draft_valid_days;

  -- Invoices (D159): the note and the confirmation switch, as duplicate_store() copies them; the series start in the new store.
  INSERT INTO commerce.invoice_settings (store_id, enabled, footer_note, email_with_confirmation, updated_by)
  SELECT p_store, true, footer_note, email_with_confirmation, p_owner
    FROM commerce.invoice_settings WHERE store_id = p_source
  ON CONFLICT (store_id) DO NOTHING;

  -- Subscription boxes' delivery days (D102); never a shopper's list.
  INSERT INTO commerce.delivery_schedules (id, store_id, market_code, currency, name, delivery_weekday, cutoff_days, cutoff_time, active)
  SELECT commerce.clone_id(p_store, id), p_store, market_code, currency, name, delivery_weekday, cutoff_days, cutoff_time, active
    FROM commerce.delivery_schedules WHERE store_id = p_source;

  -- Customer groups (D108); never a company, which is a customer.
  INSERT INTO commerce.customer_tiers (id, store_id, name, percent, note, active)
  SELECT commerce.clone_id(p_store, id), p_store, name, percent, note, active
    FROM commerce.customer_tiers WHERE store_id = p_source;

  -- The bonus and referral programs' rules (D130, D131); never a balance, a code or an earning.
  INSERT INTO commerce.bonus_settings (
    store_id, enabled, earn_bps, pending_days, max_redeem_percent, min_redeem_minor, expires_months, currency, updated_by
  )
  SELECT p_store, enabled, earn_bps, pending_days, max_redeem_percent, min_redeem_minor, expires_months, currency, p_owner
    FROM commerce.bonus_settings WHERE store_id = p_source
  ON CONFLICT (store_id) DO NOTHING;

  INSERT INTO commerce.affiliate_settings (
    store_id, enabled, reward_bps, reward_orders, friend_percent, friend_max_minor, monthly_cap_minor, cookie_days, updated_by
  )
  SELECT p_store, enabled, reward_bps, reward_orders, friend_percent, friend_max_minor, monthly_cap_minor, cookie_days, p_owner
    FROM commerce.affiliate_settings WHERE store_id = p_source
  ON CONFLICT (store_id) DO NOTHING;

  -- Its text styles (D393), so the words of its pages that wear one look as they did.
  PERFORM commerce.copy_text_styles(p_source, p_store);
END;
$$;
