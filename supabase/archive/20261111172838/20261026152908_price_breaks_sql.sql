-- Price breaks (wave 6 unit E2, D323, docs/wave-6-catalogue.md E.2).
-- * `commerce.break_amounts_ok(amounts, key_length)`: a break's unit prices are an object of whole non-negative minor units keyed by market code
--   (two letters) or, for a price list's (E3), currency (three).
-- * `price_breaks_rules()`: a break's variant is of its product, and a product has at most 10 breaks.
-- * `commerce.line_price(store, customer, variant, market, market_amount, quantity)`: what a line of `quantity` units is priced at, the lowest of
--   the market price, the product's breaks the quantity reaches (a fixed one only in a market it names) and the buyer's list offers
--   (`buyer_price()`); returns the price, the list that gives it and the quantity of the break that gives it, no row for the market price. The
--   cart, checkout, the product page's table and the WordPress quote read it, so they agree.
-- * `clone_store()` and `duplicate_store()` copy a product's breaks with it.

ALTER TABLE commerce.price_breaks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION commerce.break_amounts_ok(p_amounts jsonb, p_key_length integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(p_amounts) = 'object' AND p_amounts <> '{}'::jsonb
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(p_amounts) AS e(key, value)
        WHERE e.key !~ ('^[A-Z]{' || p_key_length || '}$')
           OR jsonb_typeof(e.value) <> 'number'
           OR (e.value #>> '{}')::numeric < 0
           OR (e.value #>> '{}')::numeric <> trunc((e.value #>> '{}')::numeric)
     )
$$;
--> statement-breakpoint
ALTER TABLE commerce.price_breaks
  ADD CONSTRAINT price_breaks_amounts CHECK (amounts IS NULL OR commerce.break_amounts_ok(amounts, 2));
--> statement-breakpoint
CREATE FUNCTION commerce.price_breaks_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.product_variants v WHERE v.store_id = NEW.store_id AND v.id = NEW.variant_id AND v.product_id = NEW.product_id
  ) THEN
    RAISE EXCEPTION 'price_breaks.variant: a break''s variant is one of its product''s' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM commerce.price_breaks b WHERE b.store_id = NEW.store_id AND b.product_id = NEW.product_id AND b.id <> NEW.id) >= 10 THEN
    RAISE EXCEPTION 'price_breaks.max: a product has at most 10 price breaks' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER price_breaks_rules
  BEFORE INSERT OR UPDATE ON commerce.price_breaks
  FOR EACH ROW EXECUTE FUNCTION commerce.price_breaks_rules();
--> statement-breakpoint
CREATE FUNCTION commerce.line_price(p_store uuid, p_customer uuid, p_variant uuid, p_market char(2), p_base bigint, p_quantity integer)
RETURNS TABLE (amount_minor bigint, list_id uuid, break_from integer)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH shop AS (
    SELECT o.amount, o.from_quantity
    FROM (
      SELECT CASE WHEN b.percent IS NOT NULL THEN (p_base * (100 - b.percent) + 50) / 100 ELSE (b.amounts ->> p_market)::bigint END AS amount,
             b.from_quantity
      FROM commerce.product_variants v
      JOIN commerce.price_breaks b
        ON b.store_id = v.store_id AND b.product_id = v.product_id AND (b.variant_id IS NULL OR b.variant_id = v.id)
      WHERE v.store_id = p_store AND v.id = p_variant AND b.from_quantity <= p_quantity
    ) o
    WHERE p_base IS NOT NULL AND o.amount IS NOT NULL AND o.amount < p_base
    ORDER BY o.amount, o.from_quantity
    LIMIT 1
  ),
  listed AS (
    SELECT bp.amount_minor, bp.list_id FROM commerce.buyer_price(p_store, p_customer, p_variant, p_market, p_base) AS bp
  )
  SELECT x.amount_minor, x.list_id, x.break_from
  FROM (
    -- A list's price wins only where it is lower than the shop's own price at this quantity.
    SELECT l.amount_minor, l.list_id, NULL::integer AS break_from
      FROM listed l
     WHERE l.amount_minor < coalesce((SELECT s.amount FROM shop s), p_base)
    UNION ALL
    SELECT s.amount, NULL::uuid, s.from_quantity FROM shop s
  ) x
  ORDER BY x.amount_minor, x.list_id NULLS LAST
  LIMIT 1
$$;
--> statement-breakpoint
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('price_breaks' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  INSERT INTO commerce.prices (store_id, variant_id, market_code, currency, amount_minor, valid_from)\n  SELECT v_store, commerce.clone_id(v_store, pr.variant_id),',
    E'  INSERT INTO commerce.price_breaks (store_id, product_id, variant_id, from_quantity, percent, amounts)\n  SELECT v_store, commerce.clone_id(v_store, b.product_id), CASE WHEN b.variant_id IS NOT NULL THEN commerce.clone_id(v_store, b.variant_id) END,\n         b.from_quantity, b.percent, b.amounts\n    FROM commerce.price_breaks b\n   WHERE b.store_id = p_template_id\n     AND EXISTS (SELECT 1 FROM commerce.products p WHERE p.store_id = v_store AND p.id = commerce.clone_id(v_store, b.product_id))\n     AND (b.variant_id IS NULL OR EXISTS (SELECT 1 FROM commerce.product_variants v WHERE v.store_id = v_store AND v.id = commerce.clone_id(v_store, b.variant_id)));\n\n  INSERT INTO commerce.prices (store_id, variant_id, market_code, currency, amount_minor, valid_from)\n  SELECT v_store, commerce.clone_id(v_store, pr.variant_id),');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the price insert was not found'; END IF;
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
  IF position('price_breaks' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  -- The current price of each variant, as a new price: the copy shows no reduction it never made.\n',
    E'  INSERT INTO commerce.price_breaks (store_id, product_id, variant_id, from_quantity, percent, amounts)\n  SELECT v_store, mp.new_id, mv.new_id, b.from_quantity, b.percent, b.amounts\n    FROM commerce.price_breaks b\n    JOIN pg_temp._copy_ids mp ON mp.old_id = b.product_id\n    LEFT JOIN pg_temp._copy_ids mv ON mv.old_id = b.variant_id\n   WHERE b.store_id = p_source AND mp.new_id IS NOT NULL AND (b.variant_id IS NULL OR mv.new_id IS NOT NULL);\n\n  -- The current price of each variant, as a new price: the copy shows no reduction it never made.\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the price insert was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
