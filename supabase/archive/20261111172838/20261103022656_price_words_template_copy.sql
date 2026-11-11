-- A product's own words around its price (D429, `products.price_words`) come along when a store is made from a template (D175), as they do
-- when a store is copied (20261103013420_price_display_copy patched `duplicate_store()`). `clone_store()` is patched in place after
-- 20261103022320_price_on_request_copy, which ended both its product lists with `price_on_request`.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('price_words' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'standard_category, standard_attributes, price_on_request\n  )\n',
    E'standard_category, standard_attributes, price_on_request, price_words\n  )\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the product insert was not found'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'standard_category, standard_attributes, price_on_request\n    FROM commerce.products\n',
    E'standard_category, standard_attributes, price_on_request, price_words\n    FROM commerce.products\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the product select was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
