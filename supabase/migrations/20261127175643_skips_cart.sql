-- Whether buying a product skips the cart page (D915), most specific first: the product's own; else its tags' (one that says the cart wins over one
-- that skips it); else its categories' (each category's nearest setting, its own or a parent's, the cart winning again); else the store's (Settings >
-- Checkout); else the cart. A basket skips the cart only when every product in it does (`cartSkips()`): one that needs the cart keeps it for all.
CREATE FUNCTION commerce.skips_cart(p_store uuid, p_product uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH RECURSIVE up (id, parent_id, setting, depth) AS (
    SELECT t.id, t.parent_id, t.skip_cart, 0
      FROM commerce.product_terms pt
      JOIN commerce.terms t ON t.store_id = pt.store_id AND t.id = pt.term_id
     WHERE pt.store_id = p_store AND pt.product_id = p_product AND t.kind = 'category'
    UNION ALL
    SELECT parent.id, parent.parent_id, parent.skip_cart, up.depth + 1
      FROM up JOIN commerce.terms parent ON parent.store_id = p_store AND parent.id = up.parent_id
     WHERE up.setting IS NULL AND up.depth < 10
  )
  SELECT coalesce(
    (SELECT p.skip_cart FROM commerce.products p WHERE p.store_id = p_store AND p.id = p_product),
    (SELECT bool_and(t.skip_cart)
       FROM commerce.product_terms pt
       JOIN commerce.terms t ON t.store_id = pt.store_id AND t.id = pt.term_id
      WHERE pt.store_id = p_store AND pt.product_id = p_product AND t.kind = 'tag' AND t.skip_cart IS NOT NULL),
    (SELECT bool_and(up.setting) FROM up WHERE up.setting IS NOT NULL),
    (SELECT s.skip_cart FROM commerce.stores s WHERE s.id = p_store),
    false
  )
$$;
