-- Producer responsibility made strict (wave 7 unit H, D342; the owner's decision of 27 October 2026): a new product is no longer ticked as
-- packaging by default (`emptyProduct()`), so a product under a scheme is not sold in a country where no registration or exemption covers
-- that scheme today, whether or not the store ever recorded one there. A store template or demo store never sells, so it never blocks.
--
-- What the defaults put there goes first, so nothing is taken off sale by this change: no store has a registration on record (27 October
-- 2026), so every tick is a default. The packaging tick every product got from the old default goes, and so does every scheme tick of the
-- demo catalogue (the store templates' and demo stores' products, and the demo products, `demo-…`, copied into stores): a demo product is
-- not sold for real, and a tick would take it off sale in a new store before its owner has seen it. A store with a registration on record
-- keeps its ticks.

DELETE FROM commerce.product_schemes ps
 USING commerce.stores s
 WHERE s.id = ps.store_id AND (s.is_template OR s.starter);
--> statement-breakpoint

DELETE FROM commerce.product_schemes ps
 USING commerce.products p
 WHERE p.store_id = ps.store_id AND p.id = ps.product_id
   AND (ps.scheme = 'packaging' OR p.handle LIKE 'demo-%')
   AND NOT EXISTS (SELECT 1 FROM commerce.producer_registrations r WHERE r.store_id = ps.store_id);
--> statement-breakpoint

-- What stops a sale: every gap, in a store that sells.
CREATE OR REPLACE FUNCTION commerce.registration_blocks(
  p_store uuid,
  p_market text DEFAULT NULL,
  p_product uuid DEFAULT NULL,
  p_on date DEFAULT NULL
)
RETURNS TABLE (product_id uuid, market_code text, scheme commerce.producer_scheme)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT g.product_id, g.market_code, g.scheme
    FROM commerce.registration_gaps(p_store, p_market, p_product, p_on) g
   WHERE NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = p_store AND (s.is_template OR s.starter))
$$;
--> statement-breakpoint

-- The view keeps its columns: every gap stops sales, but in a store template or demo store.
CREATE OR REPLACE VIEW commerce.missing_registrations
WITH (security_invoker = true)
AS
SELECT p.store_id, p.id AS product_id, p.handle, g.market_code::character(2) AS market_code, g.scheme, NOT (s.is_template OR s.starter) AS blocked
  FROM commerce.products p
  JOIN commerce.stores s ON s.id = p.store_id
  CROSS JOIN LATERAL commerce.registration_gaps(p.store_id, NULL, p.id) g
 WHERE p.status = 'active';
