-- Price on request (D431): whether a product shows its price is part of the catalogue, so a store made from a template and a copy of a
-- store carry `products.price_on_request` (both functions patched in place, as 20261027080603_standard_taxonomy_sql did for its columns).
-- It runs after 20261103013420_price_display_copy, which put `price_words` after `standard_attributes` in `duplicate_store()`'s product copy.

-- `clone_store()` carries the column.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('price_on_request' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'    kind, vat_category, audience, sold_by_measure, bundle_pricing, bundle_percent_off, standard_category, standard_attributes\n  )\n',
    E'    kind, vat_category, audience, sold_by_measure, bundle_pricing, bundle_percent_off, standard_category, standard_attributes, price_on_request\n  )\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the product insert was not found'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'         kind, vat_category, audience, sold_by_measure, bundle_pricing, bundle_percent_off, standard_category, standard_attributes\n    FROM commerce.products\n',
    E'         kind, vat_category, audience, sold_by_measure, bundle_pricing, bundle_percent_off, standard_category, standard_attributes, price_on_request\n    FROM commerce.products\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the product select was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- `duplicate_store()` too, for the products it copies.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('price_on_request' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'bundle_pricing, bundle_percent_off, standard_category, standard_attributes, price_words\n  )',
    E'bundle_pricing, bundle_percent_off, standard_category, standard_attributes, price_words, price_on_request\n  )');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the product insert was not found'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'p.bundle_percent_off, p.standard_category, p.standard_attributes, p.price_words\n    FROM commerce.products p JOIN pg_temp._copy_ids m ON m.old_id = p.id\n',
    E'p.bundle_percent_off, p.standard_category, p.standard_attributes, p.price_words, p.price_on_request\n    FROM commerce.products p JOIN pg_temp._copy_ids m ON m.old_id = p.id\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the product select was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
