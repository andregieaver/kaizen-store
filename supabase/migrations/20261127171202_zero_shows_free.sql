-- Whether a product's price of nothing shows as Free (D913), most specific first: the product's own; else its tags' (any that says the amount wins
-- over one that says Free); else its categories' (each category's nearest setting, its own or a parent's, the amount winning again); else the
-- store's (Settings > Products); else Free. Read by the catalogue's cached reads, the pricing table and the cart.
CREATE FUNCTION commerce.zero_shows_free(p_store uuid, p_product uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH RECURSIVE up (id, parent_id, setting, depth) AS (
    SELECT t.id, t.parent_id, t.zero_free, 0
      FROM commerce.product_terms pt
      JOIN commerce.terms t ON t.store_id = pt.store_id AND t.id = pt.term_id
     WHERE pt.store_id = p_store AND pt.product_id = p_product AND t.kind = 'category'
    UNION ALL
    SELECT parent.id, parent.parent_id, parent.zero_free, up.depth + 1
      FROM up JOIN commerce.terms parent ON parent.store_id = p_store AND parent.id = up.parent_id
     WHERE up.setting IS NULL AND up.depth < 10
  )
  SELECT coalesce(
    (SELECT p.zero_free FROM commerce.products p WHERE p.store_id = p_store AND p.id = p_product),
    (SELECT bool_and(t.zero_free)
       FROM commerce.product_terms pt
       JOIN commerce.terms t ON t.store_id = pt.store_id AND t.id = pt.term_id
      WHERE pt.store_id = p_store AND pt.product_id = p_product AND t.kind = 'tag' AND t.zero_free IS NOT NULL),
    (SELECT bool_and(up.setting) FROM up WHERE up.setting IS NOT NULL),
    (SELECT ps.zero_free FROM commerce.product_settings ps WHERE ps.store_id = p_store),
    true
  )
$$;
