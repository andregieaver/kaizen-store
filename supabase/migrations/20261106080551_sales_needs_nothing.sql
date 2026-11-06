-- Deals and pipelines (S2 of docs/own-books-and-sales.md, D464): the feature `sales` needs nothing else. A deal exists before any quote, and a
-- store that sells its work (Work) without an online shop keeps deals too, so `sales` is on whenever it is kept on, as `countries` and
-- `languages` are. `commerce.feature_needs()` is the registry's needs (src/lib/store-features.ts); the whole function is replaced.

CREATE OR REPLACE FUNCTION commerce.feature_needs(p_feature text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_feature
    WHEN 'shop' THEN '{}'::text[]
    WHEN 'countries' THEN '{}'::text[]
    WHEN 'languages' THEN '{}'::text[]
    WHEN 'sales' THEN '{}'::text[]
    WHEN 'referrals' THEN array['shop', 'bonus']
    ELSE array['shop']
  END
$$;
