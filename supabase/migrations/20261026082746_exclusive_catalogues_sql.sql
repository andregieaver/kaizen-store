-- Catalogues (wave 6 unit C3, D321, docs/wave-6-catalogue.md C.3): a price list marked exclusive offers the products in its scope only to its buyers.
--
-- commerce.product_exclusive(store, product): whether an active exclusive list with a scope reaches the product (a list with no scope hides nothing);
-- OFFERED leaves such a product out of every shopper-facing read made for everyone (listings, search, the product page, feeds, the sitemap).
-- commerce.buyer_sees(store, customer, product): whether the customer may be offered the product: it is exclusive to no one, or one of the customer's
-- own lists (commerce.buyer_lists()) is an exclusive list that reaches it. The reads made per request for a known buyer (the cart, checkout, the
-- buyer's catalogue) ask this in OFFERED's place (offeredTo()).

CREATE FUNCTION commerce.product_exclusive(p_store uuid, p_product uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM commerce.price_lists l
    WHERE l.store_id = p_store AND l.exclusive AND l.active
      AND EXISTS (SELECT 1 FROM commerce.price_list_products s WHERE s.store_id = l.store_id AND s.list_id = l.id)
      AND commerce.price_list_covers(p_store, l.id, p_product)
  )
$$;
--> statement-breakpoint
CREATE FUNCTION commerce.buyer_sees(p_store uuid, p_customer uuid, p_product uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NOT commerce.product_exclusive(p_store, p_product)
      OR (p_customer IS NOT NULL AND EXISTS (
            SELECT 1 FROM commerce.buyer_lists(p_store, p_customer) AS mine(id)
            JOIN commerce.price_lists l ON l.store_id = p_store AND l.id = mine.id AND l.exclusive
            WHERE EXISTS (SELECT 1 FROM commerce.price_list_products s WHERE s.store_id = l.store_id AND s.list_id = l.id)
              AND commerce.price_list_covers(p_store, l.id, p_product)
          ))
$$;
--> statement-breakpoint
CREATE INDEX price_lists_exclusive_idx ON commerce.price_lists (store_id) WHERE exclusive AND active;
