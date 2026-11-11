-- Orders and products from another shop (wave 11 unit E, D384): the rules Drizzle cannot express.
--
-- * the job pipeline learns the order history file (`order_history_import`), as 20261028183325_customer_admin_rules.sql taught it the customer
--   file: it is an import (an uploaded file, no files made) and never counts as an export.

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.data_jobs_rules()'::regprocedure);
  IF position('order_history_import' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'v_import boolean := NEW.kind IN (''product_import'', ''redirect_import'', ''inventory_import'', ''customer_import'');',
    E'v_import boolean := NEW.kind IN (''product_import'', ''redirect_import'', ''inventory_import'', ''customer_import'', ''order_history_import'');');
  IF v_new = v_def THEN RAISE EXCEPTION 'data_jobs_rules: the import kinds were not found, so the order history import is not an import'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.start_export_job(uuid, text, uuid, jsonb, integer)'::regprocedure);
  IF position('order_history_import' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'kind NOT IN (''product_import'', ''redirect_import'', ''inventory_import'', ''customer_import'') AND status IN (''queued'', ''running'')',
    E'kind NOT IN (''product_import'', ''redirect_import'', ''inventory_import'', ''customer_import'', ''order_history_import'') AND status IN (''queued'', ''running'')');
  IF v_new = v_def THEN RAISE EXCEPTION 'start_export_job: the active-export count was not found, so an order history import would count as an export'; END IF;
  EXECUTE v_new;
END
$patch$;
