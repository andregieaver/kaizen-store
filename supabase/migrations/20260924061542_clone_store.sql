-- New stores are copies of the template store (docs/platform.md, P4), made in
-- one transaction when an access request is approved.

-- The id a copied row gets in the new store: derived from the store and the
-- original id, so references between copied rows line up without a lookup
-- table. The hash is shaped into a well-formed version 4 UUID (version and
-- variant bits set), as strict UUID validators expect. Null stays null.
CREATE FUNCTION commerce.clone_id(p_store_id uuid, p_id uuid)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT (substr(h, 1, 12) || '4' || substr(h, 14, 3) || '8' || substr(h, 18, 15))::uuid
    FROM (SELECT md5(p_store_id::text || p_id::text) AS h) AS hashed;
$$;
--> statement-breakpoint

-- Creates a store owned by p_owner_id with a copy of the template's markets,
-- payment-method switches, product-safety contacts, stock locations and
-- catalogue (everything not archived), and returns its id. Prices start now:
-- the new store has no price history, so it shows no reductions. Orders,
-- customers, carts and producer registrations are never copied.
CREATE FUNCTION commerce.clone_store(
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

  INSERT INTO commerce.stores (slug, name, created_by)
  VALUES (p_slug, p_name, p_owner_id)
  RETURNING id INTO v_store;

  INSERT INTO commerce.store_members (store_id, account_id, role)
  VALUES (v_store, p_owner_id, 'owner');

  INSERT INTO commerce.markets (store_id, code, currency, default_locale, locales, active)
  SELECT v_store, code, currency, default_locale, locales, active
    FROM commerce.markets WHERE store_id = p_template_id;

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
    tax_code, withdrawal_exclusion, attributes
  )
  SELECT commerce.clone_id(v_store, id), v_store, handle, 'draft',
         commerce.clone_id(v_store, manufacturer_id),
         commerce.clone_id(v_store, responsible_person_id),
         tax_code, withdrawal_exclusion, attributes
    FROM commerce.products
   WHERE store_id = p_template_id AND status <> 'archived';

  INSERT INTO commerce.product_translations (store_id, product_id, locale, title, description, safety_information)
  SELECT v_store, commerce.clone_id(v_store, t.product_id), t.locale, t.title, t.description, t.safety_information
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

  INSERT INTO commerce.product_variants (
    id, store_id, product_id, sku, gtin, tax_code, options, weight_grams,
    hs_code, origin_country, active
  )
  SELECT commerce.clone_id(v_store, v.id), v_store, commerce.clone_id(v_store, v.product_id),
         v.sku, v.gtin, v.tax_code, v.options, v.weight_grams, v.hs_code, v.origin_country, v.active
    FROM commerce.product_variants v
    JOIN commerce.products p ON p.id = v.product_id
   WHERE v.store_id = p_template_id AND p.status <> 'archived';

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

  UPDATE commerce.products p
     SET status = 'active'
    FROM commerce.products t
   WHERE t.store_id = p_template_id
     AND t.status = 'active'
     AND p.store_id = v_store
     AND p.id = commerce.clone_id(v_store, t.id);

  RETURN v_store;
END;
$$;
--> statement-breakpoint

-- Approves a pending access request: creates (or reuses) the person's
-- account, copies the template into their new store, and records the
-- decision, all or nothing. Returns the new store's id.
CREATE FUNCTION commerce.approve_access_request(
  p_request_id uuid,
  p_slug text,
  p_store_name text,
  p_decided_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_request commerce.access_requests%ROWTYPE;
  v_template uuid;
  v_account uuid;
  v_disabled timestamptz;
  v_store uuid;
BEGIN
  SELECT * INTO v_request FROM commerce.access_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown access request %', p_request_id;
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'the access request is already %', v_request.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_template FROM commerce.stores WHERE is_template;
  IF v_template IS NULL THEN
    RAISE EXCEPTION 'there is no template store';
  END IF;

  INSERT INTO commerce.accounts (email, name)
  VALUES (v_request.email, v_request.name)
  ON CONFLICT ((lower(email))) DO UPDATE
    SET name = coalesce(commerce.accounts.name, excluded.name)
  RETURNING id, disabled_at INTO v_account, v_disabled;
  IF v_disabled IS NOT NULL THEN
    RAISE EXCEPTION 'the account for % is disabled', v_request.email
      USING ERRCODE = 'check_violation';
  END IF;

  v_store := commerce.clone_store(v_template, p_slug, p_store_name, v_account);

  UPDATE commerce.access_requests
     SET status = 'approved', decided_by = p_decided_by, decided_at = now(), store_id = v_store
   WHERE id = p_request_id;

  INSERT INTO commerce.audit_log (store_id, account_id, action, details)
  VALUES (v_store, p_decided_by, 'platform.access_approved',
          jsonb_build_object('email', v_request.email, 'slug', p_slug));

  RETURN v_store;
END;
$$;
