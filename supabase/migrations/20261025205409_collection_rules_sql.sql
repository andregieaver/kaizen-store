-- Collections filled by rules (wave 6 unit A2, D319, docs/wave-6-catalogue.md 3.3). A store's product category or tag whose `terms.rules` is set
-- holds the products that meet its conditions, worked out each time it is read by the one evaluator below, so membership follows every change to a
-- product (price, stock, terms, status, fields) with nothing re-run. The conditions are data checked by `termRulesSchema` (src/lib/term-rules.ts)
-- and every id resolved against the store before it is saved; the evaluator still reads only the store's own rows, treats anything it does not know
-- as no match and never raises on a value of the wrong shape.

-- One condition for one product of the store. A `term` condition reads the named term's own products (and its subcategories'), never another
-- collection's rules, so a collection that names one cannot loop.
CREATE OR REPLACE FUNCTION commerce.product_matches_condition(p_store uuid, p_product uuid, c jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_kind text := c ->> 'kind';
  v_hit boolean;
  v_low numeric := CASE WHEN jsonb_typeof(c -> 'min') = 'number' THEN (c ->> 'min')::numeric END;
  v_high numeric := CASE WHEN jsonb_typeof(c -> 'max') = 'number' THEN (c ->> 'max')::numeric END;
BEGIN
  IF v_kind = 'term' THEN
    IF coalesce(c ->> 'termId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
    SELECT EXISTS (
      WITH RECURSIVE tree AS (
        SELECT t.id FROM commerce.terms t
        WHERE t.store_id = p_store AND t.content_type = 'product' AND t.id = (c ->> 'termId')::uuid
        UNION
        SELECT ch.id FROM commerce.terms ch JOIN tree ON ch.parent_id = tree.id WHERE ch.store_id = p_store
      )
      SELECT 1 FROM commerce.product_terms pt
      WHERE pt.store_id = p_store AND pt.product_id = p_product AND pt.term_id IN (SELECT id FROM tree)
    ) INTO v_hit;
    RETURN v_hit <> coalesce(c -> 'not' = 'true'::jsonb, false);
  ELSIF v_kind = 'price' THEN
    -- Any active variant priced in the store's own country, as shown with VAT.
    RETURN EXISTS (
      SELECT 1 FROM commerce.product_variants v
      JOIN commerce.current_prices cp ON cp.variant_id = v.id AND cp.store_id = p_store
      WHERE v.product_id = p_product AND v.active AND cp.market_code = commerce.home_market(p_store)
        AND (v_low IS NULL OR cp.amount_minor >= v_low)
        AND (v_high IS NULL OR cp.amount_minor <= v_high)
    );
  ELSIF v_kind = 'inStock' THEN
    -- As `inStockNow()` (src/server/product-conditions.ts): goods in stock now at an active place, or digital; bookings count as available.
    RETURN EXISTS (
      SELECT 1 FROM commerce.products p
      WHERE p.id = p_product AND p.store_id = p_store AND (p.kind <> 'goods' OR EXISTS (
        SELECT 1 FROM commerce.product_variants v
        WHERE v.product_id = p.id AND v.active AND (v.delivery = 'digital' OR EXISTS (
          SELECT 1 FROM commerce.variant_availability va
          WHERE va.store_id = p.store_id AND va.variant_id = v.id AND va.in_stock > 0
        ))
      ))
    );
  ELSIF v_kind = 'manufacturer' THEN
    IF jsonb_typeof(c -> 'ids') <> 'array' THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM commerce.products p
      WHERE p.id = p_product AND p.store_id = p_store AND p.manufacturer_id IS NOT NULL
        AND p.manufacturer_id::text IN (SELECT jsonb_array_elements_text(c -> 'ids'))
    );
  ELSIF v_kind = 'option' THEN
    -- The option's name and value as the store writes them, without regard to case.
    RETURN EXISTS (
      SELECT 1 FROM commerce.product_variants v
      CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(v.options) = 'object' THEN v.options ELSE '{}'::jsonb END) o
      WHERE v.product_id = p_product AND v.active
        AND lower(o.key) = lower(c ->> 'name') AND lower(o.value) = lower(c ->> 'value')
    );
  ELSIF v_kind = 'field' THEN
    -- What was entered in the language-neutral row: a value equal (or held in a list), else a number, or a measurement in the condition's unit, in
    -- the range. The field is one of the store's public filter fields when the rule is saved.
    RETURN EXISTS (
      SELECT 1 FROM commerce.field_values fv
      CROSS JOIN LATERAL (SELECT fv.values -> (c ->> 'fieldId') AS held) h
      WHERE fv.store_id = p_store AND fv.entity = 'product' AND fv.entity_id = p_product AND fv.locale = '' AND h.held IS NOT NULL
        AND CASE
          WHEN jsonb_typeof(c -> 'value') = 'string' THEN
            (jsonb_typeof(h.held) IN ('string', 'number', 'boolean') AND h.held #>> '{}' = c ->> 'value')
            OR (jsonb_typeof(h.held) = 'array' AND h.held ? (c ->> 'value'))
          WHEN v_low IS NULL AND v_high IS NULL THEN false
          ELSE coalesce((
            SELECT (v_low IS NULL OR n >= v_low) AND (v_high IS NULL OR n <= v_high)
            FROM (SELECT CASE
              WHEN jsonb_typeof(h.held) = 'number' THEN (h.held #>> '{}')::numeric
              WHEN jsonb_typeof(h.held) = 'object' AND jsonb_typeof(h.held -> 'value') = 'number'
                AND (jsonb_typeof(c -> 'unit') <> 'string' OR coalesce(h.held ->> 'unit', '') = c ->> 'unit') THEN (h.held ->> 'value')::numeric
            END AS n) x
          ), false)
        END
    );
  ELSIF v_kind = 'kind' THEN
    IF jsonb_typeof(c -> 'values') <> 'array' THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM commerce.products p
      WHERE p.id = p_product AND p.store_id = p_store AND p.kind IN (SELECT jsonb_array_elements_text(c -> 'values'))
    );
  ELSIF v_kind = 'newWithin' THEN
    IF jsonb_typeof(c -> 'days') <> 'number' THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM commerce.products p
      WHERE p.id = p_product AND p.store_id = p_store
        AND p.created_at >= now() - make_interval(days => least(greatest((c ->> 'days')::numeric, 1), 365)::int)
    );
  END IF;
  RETURN false;
END
$$;
--> statement-breakpoint

-- Whether a product of the store meets a collection's rules: all or any of its conditions. Only an active product is ever a member (readers also ask
-- `OFFERED`, as every listing does); rules of no known shape hold nothing.
CREATE OR REPLACE FUNCTION commerce.product_matches_rules(p_store uuid, p_product uuid, p_rules jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_any boolean := coalesce(p_rules ->> 'match' = 'any', false);
  v_condition jsonb;
  v_hit boolean;
BEGIN
  IF p_rules IS NULL OR jsonb_typeof(p_rules -> 'conditions') <> 'array' OR jsonb_array_length(p_rules -> 'conditions') = 0 THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.products p WHERE p.id = p_product AND p.store_id = p_store AND p.status = 'active') THEN RETURN false; END IF;
  FOR v_condition IN SELECT value FROM jsonb_array_elements(p_rules -> 'conditions') LOOP
    v_hit := commerce.product_matches_condition(p_store, p_product, v_condition);
    IF v_any AND v_hit THEN RETURN true; END IF;
    IF NOT v_any AND NOT v_hit THEN RETURN false; END IF;
  END LOOP;
  RETURN NOT v_any;
END
$$;
--> statement-breakpoint

-- A collection filled by rules has no products of its own: a row for one is refused, and rules are refused on a term that still has rows (the
-- server takes them out in the same transaction when the owner turns rules on).
CREATE OR REPLACE FUNCTION commerce.product_terms_not_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.terms t WHERE t.id = NEW.term_id AND t.rules IS NOT NULL) THEN
    RAISE EXCEPTION 'A collection filled by rules has no products of its own' USING ERRCODE = 'check_violation', HINT = 'product_terms.rules_term';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER product_terms_not_rules BEFORE INSERT OR UPDATE OF term_id ON commerce.product_terms
  FOR EACH ROW EXECUTE FUNCTION commerce.product_terms_not_rules();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.terms_rules_without_members()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.rules IS NOT NULL AND EXISTS (SELECT 1 FROM commerce.product_terms pt WHERE pt.term_id = NEW.id) THEN
    RAISE EXCEPTION 'Take the products out of this category before it is filled by rules' USING ERRCODE = 'check_violation', HINT = 'terms.rules_members';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER terms_rules_without_members BEFORE INSERT OR UPDATE OF rules ON commerce.terms
  FOR EACH ROW WHEN (NEW.rules IS NOT NULL) EXECUTE FUNCTION commerce.terms_rules_without_members();
--> statement-breakpoint

-- A copy's rules name the copy's own terms and manufacturers (both copied with `clone_id()`); field ids stay as they are, since a store's field groups
-- are copied with their fields' ids.
CREATE OR REPLACE FUNCTION commerce.clone_term_rules(p_store uuid, p_rules jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_rules IS NULL OR jsonb_typeof(p_rules -> 'conditions') <> 'array' THEN NULL
    ELSE jsonb_set(p_rules, '{conditions}', coalesce((
      SELECT jsonb_agg(CASE
        WHEN c ->> 'kind' = 'term' AND coalesce(c ->> 'termId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN jsonb_set(c, '{termId}', to_jsonb(commerce.clone_id(p_store, (c ->> 'termId')::uuid)))
        WHEN c ->> 'kind' = 'manufacturer' AND jsonb_typeof(c -> 'ids') = 'array'
          THEN jsonb_set(c, '{ids}', coalesce((
            SELECT jsonb_agg(to_jsonb(commerce.clone_id(p_store, id::uuid)) ORDER BY n)
            FROM jsonb_array_elements_text(c -> 'ids') WITH ORDINALITY AS i (id, n)
            WHERE id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          ), '[]'::jsonb))
        ELSE c
      END ORDER BY n)
      FROM jsonb_array_elements(p_rules -> 'conditions') WITH ORDINALITY AS x (c, n)
    ), '[]'::jsonb))
  END
$$;
--> statement-breakpoint

-- `clone_store()` and `duplicate_store()` carry the rules (patched in place, one change each, as 20261025200828_collections_copy.sql did).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('image_thumbnail_url, texts, rules' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'requires_unit_price, seo, description, image_url, image_thumbnail_url, texts)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, requires_unit_price, seo, description, image_url, image_thumbnail_url, texts\n',
    E'requires_unit_price, seo, description, image_url, image_thumbnail_url, texts, rules)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, requires_unit_price, seo, description, image_url, image_thumbnail_url, texts, commerce.clone_term_rules(v_store, rules)\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the term insert was not found, so the rules are not copied'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('image_thumbnail_url, texts, rules' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'requires_unit_price, seo, description, image_url, image_thumbnail_url, texts)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, created_at, updated_at, requires_unit_price, seo, description, image_url, image_thumbnail_url, texts\n',
    E'requires_unit_price, seo, description, image_url, image_thumbnail_url, texts, rules)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, created_at, updated_at, requires_unit_price, seo, description, image_url, image_thumbnail_url, texts, commerce.clone_term_rules(v_store, rules)\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the term insert was not found, so the rules are not copied'; END IF;
  EXECUTE v_new;
END
$patch$;
