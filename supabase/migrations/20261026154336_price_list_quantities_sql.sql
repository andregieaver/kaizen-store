-- A price list's own breaks and quantity rules (wave 6 unit E3, D323, docs/wave-6-catalogue.md E.3).
-- * `price_list_breaks`: a unit price per currency (three letters, `break_amounts_ok(…, 3)`) or a percentage, at most 10 a variant in a list.
-- * `commerce.line_price()` also takes the breaks of the buyer's lists that the quantity reaches (a fixed one in the market's currency, a
--   percentage off the market price), as list offers: the lowest of them wins where it is lower than the shop's own price at that quantity.
-- * `line_price()`, `quantity_rule()` and `buyer_price()` are declared to return one row (ROWS 1), so the planner does not JIT-compile the reads.
-- * `commerce.quantity_rule(store, customer, variant)`: the rule a buyer's lists give a variant (the lowest minimum, then the highest maximum, no
--   maximum the highest, then the smallest step, then the list), else the variant's own; with the list that gives it, null for the variant's.

ALTER TABLE commerce.price_list_breaks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.price_list_quantity_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.price_list_breaks
  ADD CONSTRAINT price_list_breaks_amounts CHECK (amounts IS NULL OR commerce.break_amounts_ok(amounts, 3));
--> statement-breakpoint
CREATE FUNCTION commerce.price_list_breaks_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (SELECT count(*) FROM commerce.price_list_breaks b
       WHERE b.store_id = NEW.store_id AND b.list_id = NEW.list_id AND b.variant_id = NEW.variant_id AND b.id <> NEW.id) >= 10 THEN
    RAISE EXCEPTION 'price_list_breaks.max: a variant has at most 10 price breaks in a list' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER price_list_breaks_rules
  BEFORE INSERT OR UPDATE ON commerce.price_list_breaks
  FOR EACH ROW EXECUTE FUNCTION commerce.price_list_breaks_rules();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.line_price(p_store uuid, p_customer uuid, p_variant uuid, p_market char(2), p_base bigint, p_quantity integer)
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
    SELECT bp.amount_minor, bp.list_id, NULL::integer AS from_quantity
      FROM commerce.buyer_price(p_store, p_customer, p_variant, p_market, p_base) AS bp
    UNION ALL
    SELECT CASE WHEN lb.percent IS NOT NULL THEN (p_base * (100 - lb.percent) + 50) / 100 ELSE (lb.amounts ->> m.currency)::bigint END,
           lb.list_id, lb.from_quantity
      FROM commerce.buyer_lists(p_store, p_customer) AS mine(id)
      JOIN commerce.price_list_breaks lb ON lb.store_id = p_store AND lb.list_id = mine.id AND lb.variant_id = p_variant
      JOIN commerce.markets m ON m.store_id = p_store AND m.code = p_market
     WHERE p_customer IS NOT NULL AND p_base IS NOT NULL AND lb.from_quantity <= p_quantity
  ),
  best_list AS (
    SELECT l.amount_minor, l.list_id, l.from_quantity
      FROM listed l
     WHERE l.amount_minor IS NOT NULL AND l.amount_minor < p_base
     ORDER BY l.amount_minor, l.from_quantity NULLS FIRST, l.list_id
     LIMIT 1
  )
  SELECT x.amount_minor, x.list_id, x.break_from
  FROM (
    -- A list's price wins only where it is lower than the shop's own price at this quantity.
    SELECT l.amount_minor, l.list_id, l.from_quantity AS break_from
      FROM best_list l
     WHERE l.amount_minor < coalesce((SELECT s.amount FROM shop s), p_base)
    UNION ALL
    SELECT s.amount, NULL::uuid, s.from_quantity FROM shop s
  ) x
  ORDER BY x.amount_minor, x.list_id NULLS LAST
  LIMIT 1
$$;
--> statement-breakpoint
CREATE FUNCTION commerce.quantity_rule(p_store uuid, p_customer uuid, p_variant uuid)
RETURNS TABLE (min_quantity integer, max_quantity integer, quantity_step integer, list_id uuid)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT r.min_quantity, r.max_quantity, r.quantity_step, r.list_id
  FROM (
    SELECT q.min_quantity, q.max_quantity, q.quantity_step, q.list_id, 0 AS rank
      FROM commerce.buyer_lists(p_store, p_customer) AS mine(id)
      JOIN commerce.price_list_quantity_rules q ON q.store_id = p_store AND q.list_id = mine.id AND q.variant_id = p_variant
     WHERE p_customer IS NOT NULL
    UNION ALL
    SELECT v.min_quantity, v.max_quantity, v.quantity_step, NULL::uuid, 1
      FROM commerce.product_variants v
     WHERE v.store_id = p_store AND v.id = p_variant
  ) r
  ORDER BY r.rank, r.min_quantity, r.max_quantity DESC NULLS FIRST, r.quantity_step, r.list_id
  LIMIT 1
$$;
--> statement-breakpoint
-- Each returns one row at most: said so to the planner, which otherwise takes 1,000 rows for each lateral call, so the cart's and checkout's
-- reads look costly enough to be JIT-compiled (seconds a read) for a cart of one line.
ALTER FUNCTION commerce.line_price(uuid, uuid, uuid, char, bigint, integer) ROWS 1;
--> statement-breakpoint
ALTER FUNCTION commerce.quantity_rule(uuid, uuid, uuid) ROWS 1;
--> statement-breakpoint
ALTER FUNCTION commerce.buyer_price(uuid, uuid, uuid, char, bigint) ROWS 1;
