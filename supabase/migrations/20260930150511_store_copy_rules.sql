-- Duplicating a store (D129, docs/store-copy.md): an owner makes a new store from one of theirs.
-- The settings, pages, products and posts are copied in one transaction by `duplicate_store()`;
-- customers and order history follow in batches by `copy_customers()` and `copy_orders()`.
--
-- A copied order is read-only history: numbered C-{original number}, marked by `copied_from`, with no
-- payment, refund, invoice, shipment, download, booking, reservation or email, and no integration event.
-- The rules below make that structural: every table that acts on an order refuses a copied one, and the
-- copied order and its lines refuse changes, so no reader or actor has to remember it (the readers that
-- add up money or send mail also skip them, see docs/store-copy.md).
ALTER TABLE commerce.store_copies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.store_copy_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Copied orders are read-only
-- ---------------------------------------------------------------------------

-- What may be true of a copied order when it is made: it is history, so never waiting for payment, and it
-- has no cart, subscription or host behind it and nothing left to collect.
CREATE OR REPLACE FUNCTION commerce.copied_order_is_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.copied_from IS NOT NULL THEN
    IF NEW.status = 'pending_payment' THEN
      RAISE EXCEPTION 'copied_order: an order waiting for payment is not history and is not copied'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.cart_id IS NOT NULL OR NEW.subscription_id IS NOT NULL OR NEW.host_id IS NOT NULL
       OR NEW.commission_minor <> 0 OR NEW.balance_minor <> 0 THEN
      RAISE EXCEPTION 'copied_order: a copied order has no cart, subscription, host or balance'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_copied_is_history BEFORE INSERT ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.copied_order_is_history();
--> statement-breakpoint

-- A copied order never changes, but for its customer link, which goes when that customer deletes their account.
CREATE OR REPLACE FUNCTION commerce.copied_orders_read_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.copied_from IS NULL THEN
    IF NEW.copied_from IS NOT NULL THEN
      RAISE EXCEPTION 'copied_order: an order cannot be made a copy' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.copied_from IS DISTINCT FROM OLD.copied_from
     OR (NEW.customer_id IS NOT NULL AND NEW.customer_id IS DISTINCT FROM OLD.customer_id)
     OR (to_jsonb(NEW) - 'customer_id') IS DISTINCT FROM (to_jsonb(OLD) - 'customer_id') THEN
    RAISE EXCEPTION 'copied_order: an order copied from another store is history and cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_copied_read_only BEFORE UPDATE ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.copied_orders_read_only();
--> statement-breakpoint

-- The lines of a copied order are written once, by `copy_orders()` (which says so with a setting local to
-- its transaction), and never again.
CREATE OR REPLACE FUNCTION commerce.copied_order_lines_read_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_order uuid;
BEGIN
  IF current_setting('commerce.copying', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_order := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  IF EXISTS (SELECT 1 FROM commerce.orders o WHERE o.id = v_order AND o.copied_from IS NOT NULL) THEN
    RAISE EXCEPTION 'copied_order: the lines of a copied order cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_lines_copied_read_only BEFORE INSERT OR UPDATE OR DELETE ON commerce.order_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.copied_order_lines_read_only();
--> statement-breakpoint

-- Everything that acts on an order (a payment, a parcel, an invoice, a download link, a booking, a stock
-- reservation, a return or withdrawal, a host's commission, an email about it, a delivery made for it)
-- refuses a copied one.
CREATE OR REPLACE FUNCTION commerce.refuse_copied_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.order_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM commerce.orders o WHERE o.id = NEW.order_id AND o.copied_from IS NOT NULL) THEN
    RAISE EXCEPTION 'copied_order: an order copied from another store is history and cannot get a row in %', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Its history takes one event, `copied`, and no other.
CREATE OR REPLACE FUNCTION commerce.refuse_copied_order_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.type <> 'copied'
     AND EXISTS (SELECT 1 FROM commerce.orders o WHERE o.id = NEW.order_id AND o.copied_from IS NOT NULL) THEN
    RAISE EXCEPTION 'copied_order: an order copied from another store is history and cannot get the event %', NEW.type
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payments_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.payments
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();
--> statement-breakpoint
CREATE TRIGGER shipments_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.shipments
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();
--> statement-breakpoint
CREATE TRIGGER invoices_refuse_copied_order BEFORE INSERT ON commerce.invoices
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();
--> statement-breakpoint
CREATE TRIGGER order_downloads_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.order_downloads
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();
--> statement-breakpoint
CREATE TRIGGER bookings_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.bookings
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();
--> statement-breakpoint
CREATE TRIGGER inventory_reservations_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();
--> statement-breakpoint
CREATE TRIGGER returns_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.returns
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();
--> statement-breakpoint
CREATE TRIGGER withdrawal_requests_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();
--> statement-breakpoint
CREATE TRIGGER host_commissions_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.host_commissions
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();
--> statement-breakpoint
CREATE TRIGGER email_messages_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.email_messages
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();
--> statement-breakpoint
CREATE TRIGGER standing_deliveries_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.standing_deliveries
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();
--> statement-breakpoint
CREATE TRIGGER order_events_refuse_copied_order BEFORE INSERT ON commerce.order_events
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order_event();
--> statement-breakpoint

-- No integration event (D41) for a copied order or customer: a copy must not tell a shop's webhooks that
-- something happened.
CREATE OR REPLACE FUNCTION commerce.integration_order_events()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.copied_from IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- Paid: at checkout (from waiting for payment), or a subscription's renewal made paid.
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status = 'pending_payment') THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'order.paid', NEW.id);
  -- Cancelled after it was paid (an unpaid checkout that lapses is no news).
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IN ('paid', 'fulfilled') THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'order.cancelled', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.integration_customer_events()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.copied_from IS NULL THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'customer.created', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- References between things, for a copy
-- ---------------------------------------------------------------------------

-- The ids `duplicate_store()` maps: the original's id, and the copy's, or null for a thing that is not copied.
-- A temporary table of the transaction, so the content of pages, menus and field values is remapped with one
-- lookup per id.

-- Content (a page, a saved part, a field value, a theme) with every id in it that names a copied thing made the
-- copy's, every id that names a thing left behind taken out (an array loses the element, an object the
-- member, a link `{ ref }` the whole link), and the original store's own id made the new store's. Ids that name
-- nothing of the store (blocks', rows', pictures') stay as they are.
CREATE OR REPLACE FUNCTION commerce.copy_prune(p_json jsonb, p_gone text[])
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF jsonb_typeof(p_json) = 'array' THEN
    RETURN coalesce((
      SELECT jsonb_agg(commerce.copy_prune(e.value, p_gone) ORDER BY e.ord)
        FROM jsonb_array_elements(p_json) WITH ORDINALITY AS e(value, ord)
       WHERE NOT (jsonb_typeof(e.value) = 'string' AND (e.value #>> '{}') = ANY (p_gone))
         AND NOT (jsonb_typeof(e.value) = 'object' AND (e.value ->> 'ref') = ANY (p_gone))
    ), '[]'::jsonb);
  ELSIF jsonb_typeof(p_json) = 'object' THEN
    RETURN coalesce((
      SELECT jsonb_object_agg(m.key, commerce.copy_prune(m.value, p_gone))
        FROM jsonb_each(p_json) AS m(key, value)
       WHERE NOT (jsonb_typeof(m.value) = 'string' AND (m.value #>> '{}') = ANY (p_gone))
         AND NOT (jsonb_typeof(m.value) = 'object' AND (m.value ->> 'ref') = ANY (p_gone))
    ), '{}'::jsonb);
  END IF;
  RETURN p_json;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.copy_remap(p_json jsonb, p_source uuid, p_new uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_text text;
  v_old uuid;
  v_new uuid;
  v_found boolean;
  v_gone text[] := '{}';
BEGIN
  IF p_json IS NULL THEN
    RETURN NULL;
  END IF;
  v_text := p_json::text;
  FOR v_old IN
    SELECT DISTINCT lower(r.m[1])::uuid
      FROM regexp_matches(v_text, '"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"', 'g') AS r(m)
  LOOP
    SELECT true, c.new_id INTO v_found, v_new FROM pg_temp._copy_ids c WHERE c.old_id = v_old;
    IF v_found IS NOT TRUE THEN
      CONTINUE;
    END IF;
    IF v_new IS NULL THEN
      v_gone := v_gone || v_old::text;
    ELSE
      v_text := replace(v_text, '"' || v_old::text || '"', '"' || v_new::text || '"');
    END IF;
    v_found := NULL;
    v_new := NULL;
  END LOOP;
  v_text := replace(v_text, '"' || p_source::text || '"', '"' || p_new::text || '"');
  IF cardinality(v_gone) > 0 THEN
    RETURN commerce.copy_prune(v_text::jsonb, v_gone);
  END IF;
  RETURN v_text::jsonb;
END;
$$;
--> statement-breakpoint

-- A menu's items for the copy: a link to a product the copy does not have goes, with the items under it (the
-- other links to things that are gone are left out when the menu is drawn, as they are for a page unpublished).
CREATE OR REPLACE FUNCTION commerce.copy_menu_items(p_new uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_depth integer;
  v_skip integer := NULL;
  v_out jsonb := '[]'::jsonb;
BEGIN
  FOR v_item IN
    SELECT e.value FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(value, ord) ORDER BY e.ord
  LOOP
    v_depth := coalesce((v_item ->> 'depth')::integer, 0);
    IF v_skip IS NOT NULL AND v_depth > v_skip THEN
      CONTINUE;
    END IF;
    v_skip := NULL;
    IF v_item #>> '{link,kind}' = 'product'
       AND NOT EXISTS (
         SELECT 1 FROM commerce.products p WHERE p.store_id = p_new AND p.handle = v_item #>> '{link,handle}'
       ) THEN
      v_skip := v_depth;
      CONTINUE;
    END IF;
    v_out := v_out || jsonb_build_array(v_item);
  END LOOP;
  RETURN v_out;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The store: settings, pages, products and posts
-- ---------------------------------------------------------------------------

-- Makes a new store from an existing one, in one transaction (D129). Always copied: the store's settings
-- (business details, languages and currencies, markets, shipping, payment method switches, theme, custom
-- CSS and code, menus, header, footer and product layouts, page roles, custom field groups, campaigns and
-- discount codes, customer groups and companies, stock locations, staff and rooms, delivery days, the chat
-- agent's setup, cart reminders, cookie notes, saved themes and parts). Chosen: pages, products and posts
-- (a null array is all, an empty one none), with what they use: categories and tags, variants, current prices,
-- stock levels, subscription plans, pictures (which the media phase copies), custom field values.
-- Never: payment credentials and Stripe accounts, domains, integrations, AI keys, billing, invoice series,
-- Work, the team, hosts, logs, carts, customers, orders (`copy_customers()` and `copy_orders()`).
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
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Customers and orders, in batches
-- ---------------------------------------------------------------------------

-- Only into a store made by a copy of that source that is still running.
CREATE OR REPLACE FUNCTION commerce.assert_copy_running(p_source uuid, p_new uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM commerce.store_copies c
     WHERE c.source_store_id = p_source AND c.new_store_id = p_new AND c.status = 'running'
  ) THEN
    RAISE EXCEPTION 'no store copy is running from % into %', p_source, p_new;
  END IF;
END;
$$;
--> statement-breakpoint

-- Copies one batch of a store's shoppers (after `p_after`, in id order), as they are: name, contact details,
-- address, group and company (the copies of them), created date. Never a password, sign-in, session, verified
-- email, picture, wish list, cart or consent: the shopper signs in again and proves the email is theirs. No
-- integration event is queued. A customer already copied, or whose email the new store already has, is left as
-- it is. Their staff-only custom field values (D120) come along. Returns the last id handled (pass it as
-- `p_after` for the next batch; null when there was nothing), how many were looked at and how many were made.
CREATE OR REPLACE FUNCTION commerce.copy_customers(p_source uuid, p_new uuid, p_after uuid, p_limit integer)
RETURNS TABLE (last_id uuid, handled integer, copied integer)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
  v_copied integer := 0;
BEGIN
  PERFORM commerce.assert_copy_running(p_source, p_new);
  SELECT array_agg(x.id ORDER BY x.id) INTO v_ids
    FROM (
      SELECT c.id FROM commerce.customers c
       WHERE c.store_id = p_source AND (p_after IS NULL OR c.id > p_after)
       ORDER BY c.id LIMIT greatest(p_limit, 1)
    ) x;
  IF v_ids IS NULL THEN
    RETURN QUERY SELECT p_after, 0, 0;
    RETURN;
  END IF;

  WITH inserted AS (
    INSERT INTO commerce.customers (
      id, store_id, email, locale, created_at, name, phone, address, company_name, organisation_number, tier_id,
      company_id, company_role, copied_from
    )
    SELECT commerce.clone_id(p_new, c.id), p_new, c.email, c.locale, c.created_at, c.name, c.phone, c.address,
           c.company_name, c.organisation_number,
           CASE WHEN EXISTS (SELECT 1 FROM commerce.customer_tiers t
                              WHERE t.store_id = p_new AND t.id = commerce.clone_id(p_new, c.tier_id))
                THEN commerce.clone_id(p_new, c.tier_id) END,
           k.company_id, CASE WHEN k.company_id IS NOT NULL THEN c.company_role END, c.id
      FROM commerce.customers c
      CROSS JOIN LATERAL (
        SELECT CASE WHEN EXISTS (SELECT 1 FROM commerce.customer_companies k
                                  WHERE k.store_id = p_new AND k.id = commerce.clone_id(p_new, c.company_id))
                    THEN commerce.clone_id(p_new, c.company_id) END AS company_id
      ) k
     WHERE c.id = ANY (v_ids)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_copied FROM inserted;

  INSERT INTO commerce.field_values (store_id, entity, entity_id, locale, values, updated_at)
  SELECT p_new, fv.entity, commerce.clone_id(p_new, fv.entity_id), fv.locale, fv.values, fv.updated_at
    FROM commerce.field_values fv
   WHERE fv.store_id = p_source AND fv.entity = 'customer' AND fv.entity_id = ANY (v_ids)
     AND EXISTS (SELECT 1 FROM commerce.customers c
                  WHERE c.store_id = p_new AND c.id = commerce.clone_id(p_new, fv.entity_id))
  ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT v_ids[cardinality(v_ids)], cardinality(v_ids), v_copied;
END;
$$;
--> statement-breakpoint

-- People who unsubscribed stay unsubscribed: the store's opt-outs, as they were.
CREATE OR REPLACE FUNCTION commerce.copy_opt_outs(p_source uuid, p_new uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_copied integer;
BEGIN
  PERFORM commerce.assert_copy_running(p_source, p_new);
  WITH inserted AS (
    INSERT INTO commerce.email_opt_outs (store_id, email, source, created_at)
    SELECT p_new, o.email, o.source, o.created_at FROM commerce.email_opt_outs o WHERE o.store_id = p_source
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_copied FROM inserted;
  RETURN v_copied;
END;
$$;
--> statement-breakpoint

-- Copies one batch of a store's orders (after `p_after`, in id order) as read-only history: numbered
-- C-{original number}, marked with `copied_from`, with their lines, addresses, totals, dates, discount, campaign
-- and group snapshots as they were, and the customer link where that customer was copied (else the contact
-- details on the order are all there is). A line keeps its product and plan where those were copied. Not
-- copied: an order still waiting for payment, and everything that acts on an order (payments, refunds, invoices,
-- shipments, downloads, bookings, events, emails, subscriptions), which the rules above refuse anyway; nothing
-- is reserved or taken from stock. Their history is one event, `copied`. Returns as `copy_customers()` does.
CREATE OR REPLACE FUNCTION commerce.copy_orders(p_source uuid, p_new uuid, p_after uuid, p_limit integer)
RETURNS TABLE (last_id uuid, handled integer, copied integer)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
  v_made uuid[];
BEGIN
  PERFORM commerce.assert_copy_running(p_source, p_new);
  SELECT array_agg(x.id ORDER BY x.id) INTO v_ids
    FROM (
      SELECT o.id FROM commerce.orders o
       WHERE o.store_id = p_source AND o.status <> 'pending_payment' AND (p_after IS NULL OR o.id > p_after)
       ORDER BY o.id LIMIT greatest(p_limit, 1)
    ) x;
  IF v_ids IS NULL THEN
    RETURN QUERY SELECT p_after, 0, 0;
    RETURN;
  END IF;

  PERFORM set_config('commerce.copying', 'on', true);

  WITH inserted AS (
    INSERT INTO commerce.orders (
      id, store_id, number, market_code, currency, locale, customer_id, email, status, subtotal_minor,
      shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at,
      delivered_at, created_at, digital_consent_at, discount_code_id, discount_code, balance_minor, host_id,
      commission_minor, member_discount_minor, member_label, member_percent, campaign_discount_minor,
      campaign_label, company_name, organisation_number, copied_from
    )
    SELECT commerce.clone_id(p_new, o.id), p_new, 'C-' || o.number, o.market_code, o.currency, o.locale,
           CASE WHEN EXISTS (SELECT 1 FROM commerce.customers c
                              WHERE c.store_id = p_new AND c.id = commerce.clone_id(p_new, o.customer_id))
                THEN commerce.clone_id(p_new, o.customer_id) END,
           o.email, o.status, o.subtotal_minor, o.shipping_minor, o.discount_minor, o.tax_minor, o.total_minor,
           o.billing_address, o.shipping_address, o.placed_at, o.delivered_at, o.created_at, o.digital_consent_at,
           CASE WHEN EXISTS (SELECT 1 FROM commerce.discount_codes d
                              WHERE d.store_id = p_new AND d.id = commerce.clone_id(p_new, o.discount_code_id))
                THEN commerce.clone_id(p_new, o.discount_code_id) END,
           o.discount_code, 0, NULL, 0, o.member_discount_minor, o.member_label, o.member_percent,
           o.campaign_discount_minor, o.campaign_label, o.company_name, o.organisation_number, o.id
      FROM commerce.orders o
     WHERE o.id = ANY (v_ids)
    ON CONFLICT DO NOTHING
    RETURNING copied_from
  )
  SELECT array_agg(copied_from) INTO v_made FROM inserted;

  IF v_made IS NOT NULL THEN
    INSERT INTO commerce.order_lines (
      id, store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor,
      tax_minor, tax_rate, tax_code, withdrawal_exclusion, delivery, selling_plan_id, plan_interval,
      plan_interval_count, venue_minor, booked_count, member_discount_minor, campaign_discount_minor, campaign_id,
      gift, campaign_parts
    )
    SELECT commerce.clone_id(p_new, l.id), p_new, commerce.clone_id(p_new, l.order_id),
           CASE WHEN EXISTS (SELECT 1 FROM commerce.product_variants v
                              WHERE v.store_id = p_new AND v.id = commerce.clone_id(p_new, l.variant_id))
                THEN commerce.clone_id(p_new, l.variant_id) END,
           l.sku, l.title, l.quantity, l.unit_price_minor, l.discount_minor, l.total_minor, l.tax_minor, l.tax_rate,
           l.tax_code, l.withdrawal_exclusion, l.delivery,
           CASE WHEN EXISTS (SELECT 1 FROM commerce.selling_plans sp
                              WHERE sp.store_id = p_new AND sp.id = commerce.clone_id(p_new, l.selling_plan_id))
                THEN commerce.clone_id(p_new, l.selling_plan_id) END,
           l.plan_interval, l.plan_interval_count, l.venue_minor, l.booked_count, l.member_discount_minor,
           l.campaign_discount_minor,
           CASE WHEN EXISTS (SELECT 1 FROM commerce.campaigns c
                              WHERE c.store_id = p_new AND c.id = commerce.clone_id(p_new, l.campaign_id))
                THEN commerce.clone_id(p_new, l.campaign_id) END,
           l.gift, l.campaign_parts
      FROM commerce.order_lines l
     WHERE l.store_id = p_source AND l.order_id = ANY (v_made);

    INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
    SELECT p_new, commerce.clone_id(p_new, o.id), 'copied',
           jsonb_build_object('from_store', p_source, 'from_order', o.id, 'original_number', o.number,
                              'original_status', o.status, 'original_placed_at', o.placed_at),
           'system'
      FROM commerce.orders o WHERE o.id = ANY (v_made);

    INSERT INTO commerce.field_values (store_id, entity, entity_id, locale, values, updated_at)
    SELECT p_new, fv.entity, commerce.clone_id(p_new, fv.entity_id), fv.locale, fv.values, fv.updated_at
      FROM commerce.field_values fv
     WHERE fv.store_id = p_source AND fv.entity = 'order' AND fv.entity_id = ANY (v_made)
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM set_config('commerce.copying', 'off', true);
  RETURN QUERY SELECT v_ids[cardinality(v_ids)], cardinality(v_ids), coalesce(cardinality(v_made), 0);
END;
$$;
