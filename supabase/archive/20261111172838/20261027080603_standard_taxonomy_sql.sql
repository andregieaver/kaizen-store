-- A standard product taxonomy (wave 6 unit I, D327, docs/wave-6-catalogue.md Unit I): a product's standard category and its attributes'
-- values are catalogue, so a store made from a template and a copy of a store carry them.

-- `clone_store()` carries the two columns.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('standard_category' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'    kind, vat_category, audience, sold_by_measure, bundle_pricing, bundle_percent_off\n  )\n  SELECT commerce.clone_id(v_store, id), v_store, handle, ''draft'',\n',
    E'    kind, vat_category, audience, sold_by_measure, bundle_pricing, bundle_percent_off, standard_category, standard_attributes\n  )\n  SELECT commerce.clone_id(v_store, id), v_store, handle, ''draft'',\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the product insert was not found'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'         kind, vat_category, audience, sold_by_measure, bundle_pricing, bundle_percent_off\n    FROM commerce.products\n   WHERE store_id = p_template_id AND status <> ''archived'';\n',
    E'         kind, vat_category, audience, sold_by_measure, bundle_pricing, bundle_percent_off, standard_category, standard_attributes\n    FROM commerce.products\n   WHERE store_id = p_template_id AND status <> ''archived'';\n');
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
  IF position('standard_category' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'download_limit, download_days, subscription_only, kind, vat_category, audience, created_at, updated_at, sold_by_measure, bundle_pricing, bundle_percent_off\n  )',
    E'download_limit, download_days, subscription_only, kind, vat_category, audience, created_at, updated_at, sold_by_measure, bundle_pricing, bundle_percent_off, standard_category, standard_attributes\n  )');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the product insert was not found'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'         p.updated_at, p.sold_by_measure, p.bundle_pricing, p.bundle_percent_off\n    FROM commerce.products p JOIN pg_temp._copy_ids m ON m.old_id = p.id\n',
    E'         p.updated_at, p.sold_by_measure, p.bundle_pricing, p.bundle_percent_off, p.standard_category, p.standard_attributes\n    FROM commerce.products p JOIN pg_temp._copy_ids m ON m.old_id = p.id\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the product select was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
