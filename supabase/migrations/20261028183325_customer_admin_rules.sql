-- Customers in the admin (wave 10 unit C, D366): the rules Drizzle cannot express.
--
-- * a staff note is never edited: only its address moves (an email change or a merge moves the person's notes with them);
-- * the job pipeline learns the customer file (`customer_import`), as 20261006081019_inventory_rules.sql taught it the stock file;
-- * a merge may cut a subscriber row loose from the account it removes (the address keeps its own consent, never moved to another account).

-- ---------------------------------------------------------------------------
-- A note's words, author and time are fixed
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.customer_notes_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.body <> OLD.body
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'customer_notes.fixed: a note is never edited, only moved with its person' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER customer_notes_rules BEFORE UPDATE ON commerce.customer_notes
  FOR EACH ROW EXECUTE FUNCTION commerce.customer_notes_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The job pipeline learns the customer file
-- ---------------------------------------------------------------------------

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.data_jobs_rules()'::regprocedure);
  IF position('customer_import' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'v_import boolean := NEW.kind IN (''product_import'', ''redirect_import'', ''inventory_import'');',
    E'v_import boolean := NEW.kind IN (''product_import'', ''redirect_import'', ''inventory_import'', ''customer_import'');');
  IF v_new = v_def THEN RAISE EXCEPTION 'data_jobs_rules: the import kinds were not found, so the customer import is not an import'; END IF;
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
  IF position('customer_import' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'kind NOT IN (''product_import'', ''redirect_import'', ''inventory_import'') AND status IN (''queued'', ''running'')',
    E'kind NOT IN (''product_import'', ''redirect_import'', ''inventory_import'', ''customer_import'') AND status IN (''queued'', ''running'')');
  IF v_new = v_def THEN RAISE EXCEPTION 'start_export_job: the active-export count was not found, so a customer import would count as an export'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A merge cuts the removed account's subscriber row loose
-- ---------------------------------------------------------------------------

-- A subscriber's customer stays fixed (D295), except that a merge (`kaizen.customer_merge` set to the id of the account it removes) may set it to
-- null: the address keeps its place on the list and its consent, and is never given to the account kept.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.marketing_subscribers_rules()'::regprocedure);
  IF position('kaizen.customer_merge' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'OR (OLD.customer_id IS NOT NULL AND NEW.customer_id IS DISTINCT FROM OLD.customer_id) THEN',
    E'OR (OLD.customer_id IS NOT NULL AND NEW.customer_id IS DISTINCT FROM OLD.customer_id\n           AND NOT (NEW.customer_id IS NULL AND coalesce(current_setting(''kaizen.customer_merge'', true), '''') = OLD.customer_id::text)) THEN');
  IF v_new = v_def THEN RAISE EXCEPTION 'marketing_subscribers_rules: the fixed customer was not found, so a merge cannot cut a subscriber loose'; END IF;
  EXECUTE v_new;
END
$patch$;
