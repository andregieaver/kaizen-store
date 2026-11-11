-- Changing the business behind a store (B8 of docs/own-books-and-sales.md section 4.5, D473): the rules the database keeps.
--   Row-level security, as every commerce table.
--   commerce.apply_business_change(store): a planned change whose day has come in the store's time zone, and which knows the new business's
--     organisation number (and VAT number when registered), takes effect in one transaction: the store's legal name, number and address,
--     its tax profile's and Work's VAT registration, and each series' prefix the change gives. What the store was is kept (`before`), and
--     where each series stood (`series_start`). The numbers go on from where they are: no gap and no number used twice.
--   Every issuer calls it before it numbers anything (an invoice, a credit note, an order change's documents, a Work invoice or credit
--     note), so the first document of the day is the new business's, whenever the dispatcher's job runs.
--   The sales series' guard lets a prefix change once numbers are issued only inside that function.
--   An order placed before the change and invoiced after it states the new business's VAT number, not the one the order froze.

ALTER TABLE "commerce"."store_business_changes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.apply_business_change(p_store uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  c commerce.store_business_changes%ROWTYPE;
  v_before jsonb;
  v_start jsonb;
  v_series text;
BEGIN
  SELECT * INTO c FROM commerce.store_business_changes
    WHERE store_id = p_store AND status = 'planned' AND starts_on <= commerce.store_day(p_store, now())
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Not ready: it stays planned, documents go on under the business as it is, and the owner is shown what is missing.
  IF c.organisation_number IS NULL OR (c.vat_registered AND c.vat_number IS NULL) THEN RETURN false; END IF;

  SELECT jsonb_build_object(
      'legalName', s.legal_name,
      'organisationNumber', s.organisation_number,
      'postalAddress', s.postal_address,
      'vatRegistered', coalesce(tp.vat_registered, false),
      'vatNumber', tp.vat_number,
      'workVatRegistered', ws.vat_registered,
      'workVatNumber', ws.vat_number,
      'prefixes', coalesce((SELECT jsonb_object_agg(ds.series, ds.prefix) FROM commerce.document_series ds WHERE ds.store_id = p_store), '{}'::jsonb))
    INTO v_before
    FROM commerce.stores s
    LEFT JOIN commerce.store_tax_profile tp ON tp.store_id = s.id
    LEFT JOIN commerce.work_settings ws ON ws.store_id = s.id
    WHERE s.id = p_store;

  UPDATE commerce.stores
    SET legal_name = c.legal_name, organisation_number = c.organisation_number, postal_address = coalesce(c.postal_address, postal_address)
    WHERE id = p_store;

  INSERT INTO commerce.store_tax_profile (store_id, vat_registered, vat_number)
    VALUES (p_store, c.vat_registered, c.vat_number)
    ON CONFLICT (store_id) DO UPDATE
      SET vat_registered = excluded.vat_registered, vat_number = excluded.vat_number,
          vat_number_check_id = NULL, vat_number_checked_at = NULL, vat_number_valid = NULL, updated_at = now();

  UPDATE commerce.work_settings SET vat_registered = c.vat_registered, vat_number = c.vat_number WHERE store_id = p_store;

  -- The new business's own prefixes: the one way a sales series' prefix changes once it has issued numbers (sales_series_guard).
  PERFORM set_config('commerce.business_change', 'on', true);
  FOR v_series IN SELECT jsonb_object_keys(c.prefixes) LOOP
    IF v_series IN ('invoice', 'credit_note', 'work_invoice', 'work_credit_note') THEN
      UPDATE commerce.document_series SET prefix = c.prefixes ->> v_series WHERE store_id = p_store AND series = v_series;
    END IF;
  END LOOP;
  PERFORM set_config('commerce.business_change', '', true);

  SELECT coalesce(jsonb_object_agg(ds.series, coalesce(ds.prefix, '') || ds.next_number), '{}'::jsonb) INTO v_start
    FROM commerce.document_series ds
    WHERE ds.store_id = p_store AND ds.series IN ('invoice', 'credit_note', 'work_invoice', 'work_credit_note');

  UPDATE commerce.store_business_changes
    SET status = 'applied', applied_at = now(), before = v_before, series_start = v_start, updated_at = now()
    WHERE id = c.id;
  RETURN true;
END;
$$;
--> statement-breakpoint

-- Every issuer applies a change whose day has come before it numbers anything (patched in place, as 20261006185225 does).
DO $patch$
DECLARE
  v_fn regprocedure;
  v_def text;
  v_new text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'commerce.make_order_invoice(uuid, uuid)'::regprocedure,
    'commerce.make_credit_note(uuid, uuid, uuid)'::regprocedure,
    'commerce.make_edit_documents(uuid, uuid)'::regprocedure,
    'commerce.issue_work_invoice(uuid, uuid, uuid, date, bigint, numeric, boolean)'::regprocedure,
    'commerce.credit_work_invoice(uuid, uuid, uuid, text, jsonb, date, boolean)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_fn);
    IF position('apply_business_change' IN v_def) > 0 THEN CONTINUE; END IF;
    v_new := regexp_replace(
      v_def,
      E'\nBEGIN\n',
      E'\nBEGIN\n  -- A change of the business behind the store whose day has come takes effect before anything is numbered (D473).\n  PERFORM commerce.apply_business_change(p_store);\n'
    );
    IF v_new = v_def THEN RAISE EXCEPTION '%: its body was not found, so a change of business cannot be applied before it', v_fn; END IF;
    EXECUTE v_new;
  END LOOP;
END
$patch$;
--> statement-breakpoint

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.sales_series_guard()'::regprocedure);
  IF position('commerce.business_change' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    'IF v_issued AND NEW.prefix IS DISTINCT FROM OLD.prefix THEN',
    E'IF v_issued AND NEW.prefix IS DISTINCT FROM OLD.prefix\n'
    || E'     AND coalesce(current_setting(''commerce.business_change'', true), '''') <> ''on'' THEN'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'sales_series_guard: the prefix rule was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- The seller's VAT number on an order's invoice: the one the order froze, unless the business behind the store changed after the order
-- was placed; then the business that issues the invoice states its own.
CREATE OR REPLACE FUNCTION commerce.invoice_seller_vat(p_order uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $$
DECLARE
  v_result text;
BEGIN
  SELECT CASE
      WHEN EXISTS (
        SELECT 1 FROM commerce.store_business_changes b
        WHERE b.store_id = o.store_id AND b.status = 'applied' AND b.applied_at > coalesce(o.placed_at, o.created_at))
      THEN (SELECT CASE WHEN tp.vat_registered THEN tp.vat_number END FROM commerce.store_tax_profile tp WHERE tp.store_id = o.store_id)
      ELSE coalesce(
        commerce.nz(o.vat_treatment ->> 'sellerVatNumber'),
        (SELECT CASE WHEN tp.vat_registered THEN tp.vat_number END FROM commerce.store_tax_profile tp WHERE tp.store_id = o.store_id))
    END
    INTO v_result FROM commerce.orders o WHERE o.id = p_order;
  RETURN v_result;
END;
$$;
