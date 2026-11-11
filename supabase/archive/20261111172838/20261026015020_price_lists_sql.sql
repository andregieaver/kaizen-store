-- Price lists (wave 6 unit C, D321, docs/wave-6-catalogue.md C.1): row security, and the one function that says what a buyer pays.
--
-- commerce.buyer_lists(store, customer): the active lists assigned to the customer's own active group, to their company (active, Sell to
-- businesses on, the customer its owner or employee) and to their company's active group.
-- commerce.price_list_covers(store, list, product): whether a list's percentage reaches a product: every product while the list has no scope,
-- else a product named in it or one in a category it names or one below it (a category filled by rules by its rules, D319).
-- commerce.buyer_price(store, customer, variant, market, market_amount): the lowest price the customer's lists give the variant, below the
-- market price, with the list that gives it; no row for none. A fixed price is the list's in the market's own currency; a percentage is
-- taken off the market price, half up to the minor unit. The cart, checkout and the product page all read it, so they agree.

ALTER TABLE commerce.price_lists ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.price_list_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.price_list_prices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.price_list_products ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION commerce.buyer_lists(p_store uuid, p_customer uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT DISTINCT a.list_id
  FROM commerce.customers c
  LEFT JOIN commerce.customer_tiers t ON t.store_id = c.store_id AND t.id = c.tier_id AND t.active
  LEFT JOIN commerce.customer_companies co
    ON co.store_id = c.store_id AND co.id = c.company_id AND co.active
   AND c.company_role IN ('owner', 'employee') AND commerce.feature_on(c.store_id, 'business')
  LEFT JOIN commerce.customer_tiers ct ON ct.store_id = co.store_id AND ct.id = co.tier_id AND ct.active
  JOIN commerce.price_list_assignments a
    ON a.store_id = c.store_id AND (a.tier_id = t.id OR a.company_id = co.id OR a.tier_id = ct.id)
  JOIN commerce.price_lists l ON l.store_id = a.store_id AND l.id = a.list_id AND l.active
  WHERE c.store_id = p_store AND c.id = p_customer
$$;
--> statement-breakpoint
CREATE FUNCTION commerce.price_list_covers(p_store uuid, p_list uuid, p_product uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM commerce.price_list_products s WHERE s.store_id = p_store AND s.list_id = p_list)
      OR EXISTS (SELECT 1 FROM commerce.price_list_products s WHERE s.store_id = p_store AND s.list_id = p_list AND s.product_id = p_product)
      OR EXISTS (
        WITH RECURSIVE picked AS (
          SELECT t.id, t.rules FROM commerce.terms t
          JOIN commerce.price_list_products s ON s.term_id = t.id AND s.store_id = p_store AND s.list_id = p_list
          WHERE t.store_id = p_store
          UNION
          SELECT ch.id, ch.rules FROM commerce.terms ch JOIN picked ON ch.parent_id = picked.id WHERE ch.store_id = p_store
        )
        SELECT 1 FROM picked
        WHERE EXISTS (SELECT 1 FROM commerce.product_terms pt WHERE pt.store_id = p_store AND pt.product_id = p_product AND pt.term_id = picked.id)
           OR (picked.rules IS NOT NULL AND commerce.product_matches_rules(p_store, p_product, picked.rules))
      )
$$;
--> statement-breakpoint
CREATE FUNCTION commerce.buyer_price(p_store uuid, p_customer uuid, p_variant uuid, p_market char(2), p_base bigint)
RETURNS TABLE (amount_minor bigint, list_id uuid)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH lists AS (
    SELECT id FROM commerce.buyer_lists(p_store, p_customer) AS id WHERE p_customer IS NOT NULL
  ),
  variant AS (
    SELECT v.product_id FROM commerce.product_variants v WHERE v.store_id = p_store AND v.id = p_variant
  ),
  market AS (
    SELECT m.currency FROM commerce.markets m WHERE m.store_id = p_store AND m.code = p_market
  ),
  offers AS (
    SELECT pp.amount_minor, pp.list_id
    FROM commerce.price_list_prices pp
    JOIN market ON pp.currency = market.currency
    WHERE pp.store_id = p_store AND pp.variant_id = p_variant AND pp.list_id IN (SELECT id FROM lists)
    UNION ALL
    SELECT (p_base * (100 - l.percent) + 50) / 100, l.id
    FROM commerce.price_lists l
    CROSS JOIN variant
    WHERE l.store_id = p_store AND l.id IN (SELECT id FROM lists) AND l.percent IS NOT NULL
      AND commerce.price_list_covers(p_store, l.id, variant.product_id)
  )
  SELECT o.amount_minor, o.list_id
  FROM offers o
  WHERE p_base IS NOT NULL AND o.amount_minor < p_base
  ORDER BY o.amount_minor, o.list_id
  LIMIT 1
$$;
