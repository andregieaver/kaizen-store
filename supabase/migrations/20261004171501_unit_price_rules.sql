-- Unit price indication (D160, docs/wave-1d-unit-price.md): the rules that live in the database.
--
-- * `commerce.unit_price_required()` is the one definition of "this product needs a measure": the product says so
--   (`sold_by_measure`), or one of its product categories, or an ancestor of one, is marked `requires_unit_price`;
-- * a deferred constraint trigger refuses, at commit, an ACTIVE product that is required while an active physical goods
--   variant has no measure (`unit_price.measure_required`), and a measure on anything that is not physical goods
--   (`unit_price.not_applicable`). A category marked afterwards does not fire it: existing products are grandfathered
--   and reported, never silently refused or hidden;
-- * an order line's snapshot of the measure cannot change after it is inserted (`unit_price.frozen`);
-- * copying: `clone_store()`, `duplicate_store()` and `copy_orders()` keep the new columns (the live definitions are
--   patched, one change each, and say so loudly if the text they patch is not where it was). A copy of a store is
--   made inside one transaction with the check switched off (`commerce.unit_price_copying`, transaction-local): a
--   product the source had grandfathered stays as it was in the copy.
-- * the plan comparison (D132) gets its row; it describes, it enables nothing.
-- No function written here contains DELETE, TRUNCATE or DROP; the three patched copy functions' own bodies do (as
-- they did for the earlier waves): see the owner statements of the wave's report.

-- ---------------------------------------------------------------------------
-- What is required
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.unit_price_required(p_store uuid, p_product uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
           (SELECT p.sold_by_measure FROM commerce.products p WHERE p.store_id = p_store AND p.id = p_product),
           false)
      OR EXISTS (
        WITH RECURSIVE up(id) AS (
          SELECT pt.term_id
            FROM commerce.product_terms pt
            JOIN commerce.terms t ON t.id = pt.term_id AND t.store_id = p_store AND t.kind = 'category'
           WHERE pt.store_id = p_store AND pt.product_id = p_product
          UNION
          SELECT t.parent_id
            FROM up
            JOIN commerce.terms t ON t.id = up.id AND t.store_id = p_store
           WHERE t.parent_id IS NOT NULL
        )
        SELECT 1
          FROM up
          JOIN commerce.terms t ON t.id = up.id AND t.store_id = p_store AND t.requires_unit_price
      );
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The deferred check
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.check_unit_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_store uuid := NEW.store_id;
  v_product uuid;
  v_kind text;
  v_status commerce.product_status;
  v_skus text;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    v_product := NEW.id;
  ELSE
    v_product := NEW.product_id;
  END IF;

  SELECT p.kind, p.status INTO v_kind, v_status
    FROM commerce.products p
   WHERE p.store_id = v_store AND p.id = v_product;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- A measure is for physical goods only: not an appointment, stay or rental, and not a download.
  SELECT string_agg(v.sku, ', ' ORDER BY v.sku) INTO v_skus
    FROM commerce.product_variants v
   WHERE v.store_id = v_store AND v.product_id = v_product
     AND v.measure_amount IS NOT NULL
     AND (v_kind <> 'goods' OR v.delivery <> 'physical');
  IF v_skus IS NOT NULL THEN
    RAISE EXCEPTION 'unit_price.not_applicable' USING ERRCODE = 'check_violation', DETAIL = v_skus;
  END IF;

  IF v_status = 'active'
     AND v_kind = 'goods'
     AND COALESCE(current_setting('commerce.unit_price_copying', true), '') <> 'on'
     AND commerce.unit_price_required(v_store, v_product) THEN
    SELECT string_agg(v.sku, ', ' ORDER BY v.sku) INTO v_skus
      FROM commerce.product_variants v
     WHERE v.store_id = v_store AND v.product_id = v_product
       AND v.active AND v.delivery = 'physical' AND v.measure_amount IS NULL;
    IF v_skus IS NOT NULL THEN
      RAISE EXCEPTION 'unit_price.measure_required' USING ERRCODE = 'check_violation', DETAIL = v_skus;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER products_unit_price
  AFTER INSERT OR UPDATE OF status, sold_by_measure, kind ON commerce.products
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION commerce.check_unit_price();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER product_variants_unit_price
  AFTER INSERT OR UPDATE OF measure_amount, measure_unit, active, delivery ON commerce.product_variants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION commerce.check_unit_price();
--> statement-breakpoint
-- Putting a product in a category can make it required. (Taking it out can only make it less so, so no check there.)
CREATE CONSTRAINT TRIGGER product_terms_unit_price
  AFTER INSERT ON commerce.product_terms
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION commerce.check_unit_price();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The snapshot on a sold line never changes
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.order_lines_measure_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.measure_amount IS DISTINCT FROM OLD.measure_amount
     OR NEW.measure_unit IS DISTINCT FROM OLD.measure_unit
     OR NEW.measure_base IS DISTINCT FROM OLD.measure_base THEN
    RAISE EXCEPTION 'unit_price.frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_lines_measure_frozen
  BEFORE UPDATE OF measure_amount, measure_unit, measure_base ON commerce.order_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.order_lines_measure_frozen();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The plan comparison (D132)
-- ---------------------------------------------------------------------------

INSERT INTO commerce.plan_features (category, name, description, position)
SELECT 'Checkout and selling', 'Unit price (price per kg, litre, metre)',
       'The price per kilogram, litre, metre, square metre or piece beside each price on product pages, listings, cart, checkout, orders and emails, kept on the order, with a check that products which need a content are not sold without one.',
       219
 WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features f WHERE f.name = 'Unit price (price per kg, litre, metre)');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Copying (the live definitions are patched, one change each)
-- ---------------------------------------------------------------------------

-- A new store from the template: the measures of the variants, the flag of the products and the mark of the
-- categories come along. The check is off while the copy is made (the copy is as complete as the template is).
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_next text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('measure_amount' IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;

  v_next := replace(v_new, E'  -- Products arrive as drafts and are published below',
    E'  PERFORM set_config(''commerce.unit_price_copying'', ''on'', true);\n\n  -- Products arrive as drafts and are published below');
  IF v_next = v_new THEN RAISE EXCEPTION 'clone_store: the products comment was not found, so the unit price check is not switched off'; END IF;
  v_new := v_next;

  v_next := replace(v_new, E'    kind, vat_category, audience\n  )', E'    kind, vat_category, audience, sold_by_measure\n  )');
  IF v_next = v_new THEN RAISE EXCEPTION 'clone_store: the product columns were not found, so sold_by_measure is not copied'; END IF;
  v_new := v_next;

  v_next := replace(v_new, E'         kind, vat_category, audience\n    FROM commerce.products\n   WHERE store_id = p_template_id', E'         kind, vat_category, audience, sold_by_measure\n    FROM commerce.products\n   WHERE store_id = p_template_id');
  IF v_next = v_new THEN RAISE EXCEPTION 'clone_store: the product values were not found, so sold_by_measure is not copied'; END IF;
  v_new := v_next;

  v_next := replace(v_new, E'INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position\n',
    E'INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position, requires_unit_price)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, requires_unit_price\n');
  IF v_next = v_new THEN RAISE EXCEPTION 'clone_store: the term insert was not found, so requires_unit_price is not copied'; END IF;
  v_new := v_next;

  v_next := replace(v_new, E'image_url, image_thumbnail_url, cost_minor\n  )', E'image_url, image_thumbnail_url, cost_minor,\n    measure_amount, measure_unit, measure_base\n  )');
  IF v_next = v_new THEN RAISE EXCEPTION 'clone_store: the variant columns were not found, so the measure is not copied'; END IF;
  v_new := v_next;

  v_next := replace(v_new, E'v.image_url, v.image_thumbnail_url, v.cost_minor\n    FROM commerce.product_variants v', E'v.image_url, v.image_thumbnail_url, v.cost_minor,\n         v.measure_amount, v.measure_unit, v.measure_base\n    FROM commerce.product_variants v');
  IF v_next = v_new THEN RAISE EXCEPTION 'clone_store: the variant values were not found, so the measure is not copied'; END IF;
  v_new := v_next;

  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- A copy of a store (D129) keeps its measures, its flags and its marked categories. A product the source had grandfathered
-- (active, required, no measure yet) stays so in the copy.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_next text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('measure_amount' IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;

  v_next := replace(v_new, E'  -- They arrive as drafts and are published below',
    E'  PERFORM set_config(''commerce.unit_price_copying'', ''on'', true);\n\n  -- They arrive as drafts and are published below');
  IF v_next = v_new THEN RAISE EXCEPTION 'duplicate_store: the products comment was not found, so the unit price check is not switched off'; END IF;
  v_new := v_next;

  v_next := replace(v_new, E'subscription_only, kind, vat_category, audience, created_at, updated_at\n  )', E'subscription_only, kind, vat_category, audience, created_at, updated_at, sold_by_measure\n  )');
  IF v_next = v_new THEN RAISE EXCEPTION 'duplicate_store: the product columns were not found, so sold_by_measure is not copied'; END IF;
  v_new := v_next;

  v_next := replace(v_new, E'p.audience, p.created_at,\n         p.updated_at\n    FROM commerce.products p', E'p.audience, p.created_at,\n         p.updated_at, p.sold_by_measure\n    FROM commerce.products p');
  IF v_next = v_new THEN RAISE EXCEPTION 'duplicate_store: the product values were not found, so sold_by_measure is not copied'; END IF;
  v_new := v_next;

  v_next := replace(v_new, E'INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position, created_at, updated_at)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, created_at, updated_at\n',
    E'INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position, created_at, updated_at, requires_unit_price)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, created_at, updated_at, requires_unit_price\n');
  IF v_next = v_new THEN RAISE EXCEPTION 'duplicate_store: the term insert was not found, so requires_unit_price is not copied'; END IF;
  v_new := v_next;

  v_next := replace(v_new, E'image_url, image_thumbnail_url, created_at, cost_minor\n  )', E'image_url, image_thumbnail_url, created_at, cost_minor,\n    measure_amount, measure_unit, measure_base\n  )');
  IF v_next = v_new THEN RAISE EXCEPTION 'duplicate_store: the variant columns were not found, so the measure is not copied'; END IF;
  v_new := v_next;

  v_next := replace(v_new, E'v.image_thumbnail_url, v.created_at, v.cost_minor\n    FROM commerce.product_variants v', E'v.image_thumbnail_url, v.created_at, v.cost_minor,\n         v.measure_amount, v.measure_unit, v.measure_base\n    FROM commerce.product_variants v');
  IF v_next = v_new THEN RAISE EXCEPTION 'duplicate_store: the variant values were not found, so the measure is not copied'; END IF;
  v_new := v_next;

  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- A copied order (D129) shows what the original showed: its lines keep their measure snapshot.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_next text;
BEGIN
  v_def := pg_get_functiondef('commerce.copy_orders(uuid, uuid, uuid, integer)'::regprocedure);
  IF position('measure_amount' IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;

  -- Placed right after unit_cost_minor, in both lists, so it holds whether or not the VAT patch (which adds
  -- vat_relief_minor after the same column) has run yet.
  v_next := replace(v_new, 'gift, campaign_parts, unit_cost_minor', E'gift, campaign_parts, unit_cost_minor, measure_amount, measure_unit, measure_base');
  IF v_next = v_new THEN RAISE EXCEPTION 'copy_orders: the line columns were not found, so the measure snapshot is not copied'; END IF;
  v_new := v_next;

  v_next := replace(v_new, 'l.gift, l.campaign_parts, l.unit_cost_minor', E'l.gift, l.campaign_parts, l.unit_cost_minor, l.measure_amount, l.measure_unit, l.measure_base');
  IF v_next = v_new THEN RAISE EXCEPTION 'copy_orders: the line values were not found, so the measure snapshot is not copied'; END IF;
  v_new := v_next;

  EXECUTE v_new;
END
$patch$;
