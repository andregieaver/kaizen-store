-- Data in and out (wave 2, D165, docs/wave-2-data.md 3.8): the rules that live in the database. The tables, checks, foreign keys,
-- the one-active-import index and the one-undo index are in the migration before this one.
--
-- * a job's lifecycle: forward only (`data_job_move_allowed()`; the one move back is a `checked` import checked again after its
--   options changed), an import starts `uploaded` and an export `queued`, nothing about a job's identity (store, kind, requester)
--   or, once registered, the file it was checked against can change, an import's options are fixed once it is applied and an
--   export's from the start, an ended job's figures are final;
-- * the active export limit, counted under a lock by `commerce.start_export_job()`;
-- * the bulk editor's record: append-only. A batch changes only by `undone_at`, set once, and only when its undo exists; an undo is
--   made once, within seven days, of a batch that is not itself an undo; an item changes only from `changed` to `undone`.
--
-- No function here contains DELETE or DROP: files and old rows are removed by application code (`pruneDataJobs()`).
-- Like every commerce table, row-level security on and no policies: the Data API reaches none of it.
ALTER TABLE commerce.data_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.data_job_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.data_job_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.bulk_edit_batches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.bulk_edit_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The lifecycle of a job (mirrored by `canMove()` in src/lib/data-job.ts)
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.data_job_move_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_from = p_to OR CASE p_from
    WHEN 'uploaded'  THEN p_to IN ('checking', 'cancelled', 'failed', 'expired')
    WHEN 'checking'  THEN p_to IN ('checked', 'cancelled', 'failed')
    WHEN 'checked'   THEN p_to IN ('checking', 'queued', 'cancelled', 'failed', 'expired')
    WHEN 'queued'    THEN p_to IN ('running', 'cancelled', 'failed')
    WHEN 'running'   THEN p_to IN ('done', 'failed', 'cancelled')
    WHEN 'done'      THEN p_to = 'expired'
    WHEN 'failed'    THEN p_to = 'expired'
    WHEN 'cancelled' THEN p_to = 'expired'
    ELSE false
  END
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.data_jobs_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_import boolean := NEW.kind = 'product_import';
  v_ended boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.kind <> OLD.kind OR NEW.requested_by <> OLD.requested_by) THEN
    RAISE EXCEPTION 'data_job.fixed: a job stays with its store, kind and requester' USING ERRCODE = 'check_violation';
  END IF;

  -- What states a kind of job can be in: an export never uploads, checks or waits to be applied.
  IF NOT v_import AND NEW.status IN ('uploaded', 'checking', 'checked') THEN
    RAISE EXCEPTION 'data_job.status_kind: an export has no upload or check step' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF (v_import AND NEW.status <> 'uploaded') OR (NOT v_import AND NEW.status <> 'queued') THEN
      RAISE EXCEPTION 'data_job.start: an import starts as uploaded and an export as queued' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NOT commerce.data_job_move_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'data_job.status: a job cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;

  -- The file an import was registered with is the one it is checked and applied against; it can only be cleared when purged.
  IF OLD.input_sha256 IS NOT NULL THEN
    IF (NEW.input_sha256 IS DISTINCT FROM OLD.input_sha256 AND NOT (NEW.input_sha256 IS NULL AND NEW.purged_at IS NOT NULL))
       OR (NEW.input_path IS DISTINCT FROM OLD.input_path AND NOT (NEW.input_path IS NULL AND NEW.purged_at IS NOT NULL))
       OR (NEW.input_bytes IS DISTINCT FROM OLD.input_bytes AND NOT (NEW.input_bytes IS NULL AND NEW.purged_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'data_job.file_fixed: a job cannot be pointed at another file; upload it again as a new job' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.input_sha256 IS NOT NULL AND OLD.status NOT IN ('uploaded', 'checking') THEN
    RAISE EXCEPTION 'data_job.file_fixed: the file is registered while the job is uploaded' USING ERRCODE = 'check_violation';
  END IF;

  -- The choices: an export's are fixed from the start; an import's until it is applied (a checked import whose options change
  -- is checked again, which is the one move back).
  IF NEW.options IS DISTINCT FROM OLD.options THEN
    IF NOT v_import OR NOT (OLD.status IN ('uploaded', 'checking') OR (OLD.status = 'checked' AND NEW.status = 'checking')) THEN
      RAISE EXCEPTION 'data_job.options_fixed: the options of a job are fixed once it is checked; check it again to change them' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD.status = 'checked' AND NEW.status = 'queued' AND NEW.options IS DISTINCT FROM OLD.options THEN
    RAISE EXCEPTION 'data_job.options_fixed: the options changed since the check' USING ERRCODE = 'check_violation';
  END IF;

  -- An ended job's figures are final (its files may still be purged, and its status become expired).
  v_ended := OLD.status IN ('done', 'failed', 'cancelled', 'expired');
  IF v_ended AND (NEW.counts IS DISTINCT FROM OLD.counts OR NEW.cursor IS DISTINCT FROM OLD.cursor
                  OR NEW.rows_total IS DISTINCT FROM OLD.rows_total OR NEW.rows_done IS DISTINCT FROM OLD.rows_done
                  OR NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.finished_at IS DISTINCT FROM OLD.finished_at
                  OR NEW.attempts IS DISTINCT FROM OLD.attempts OR NEW.format IS DISTINCT FROM OLD.format) THEN
    RAISE EXCEPTION 'data_job.ended: a job that has ended keeps its figures' USING ERRCODE = 'check_violation';
  END IF;
  IF v_ended AND NEW.files IS DISTINCT FROM OLD.files AND NEW.purged_at IS NULL THEN
    RAISE EXCEPTION 'data_job.ended: the files of an ended job are only removed, by marking it purged' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.purged_at IS NOT NULL AND NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
    RAISE EXCEPTION 'data_job.ended: a purge is not taken back' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IN ('done', 'failed', 'cancelled', 'expired') AND NEW.finished_at IS NULL THEN
    NEW.finished_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER data_jobs_rules BEFORE INSERT OR UPDATE ON commerce.data_jobs
  FOR EACH ROW EXECUTE FUNCTION commerce.data_jobs_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Starting an export: the limit of active ones, counted under a lock (an index cannot count)
-- ---------------------------------------------------------------------------

-- Starts a product, order or customer export unless the store already has `p_max` running or queued ones. Returns the job's id.
-- `data_job.too_many_exports` when the limit is reached. Two requests at once are serialised on the store.
CREATE FUNCTION commerce.start_export_job(p_store uuid, p_kind text, p_requested_by uuid, p_options jsonb, p_max integer)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_active integer;
  v_id uuid;
BEGIN
  IF p_kind NOT IN ('product_export', 'order_export', 'customer_export') THEN
    RAISE EXCEPTION 'data_job.kind: % is not an export', p_kind USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('data_jobs:' || p_store::text, 0));
  SELECT count(*)::integer INTO v_active
    FROM commerce.data_jobs
   WHERE store_id = p_store AND kind <> 'product_import' AND status IN ('queued', 'running');
  IF v_active >= p_max THEN
    RAISE EXCEPTION 'data_job.too_many_exports: % exports are already being made for this store', v_active USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO commerce.data_jobs (store_id, kind, status, phase, format, options, requested_by)
  VALUES (p_store, p_kind, 'queued', 'write', 'kaizen', coalesce(p_options, '{}'::jsonb), p_requested_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The bulk editor's record: append-only, an undo once, within seven days (BULK_UNDO_DAYS)
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.bulk_edit_batches_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_target commerce.bulk_edit_batches%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.undone_at IS NOT NULL THEN
      RAISE EXCEPTION 'bulk_edit.undone: a batch is made before it is undone' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.action = 'undo' THEN
      SELECT * INTO v_target FROM commerce.bulk_edit_batches WHERE store_id = NEW.store_id AND id = NEW.undo_of;
      IF v_target.action = 'undo' THEN
        RAISE EXCEPTION 'bulk_edit.undo_of_undo: an undo is not undone; make the change again' USING ERRCODE = 'check_violation';
      END IF;
      IF v_target.created_at < now() - interval '7 days' THEN
        RAISE EXCEPTION 'bulk_edit.undo_expired: a change can be undone for seven days' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: only `undone_at`, once, and only when its undo is there.
  IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.requested_by <> OLD.requested_by OR NEW.action <> OLD.action
     OR NEW.params IS DISTINCT FROM OLD.params OR NEW.undo_of IS DISTINCT FROM OLD.undo_of
     OR NEW.counts IS DISTINCT FROM OLD.counts OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'bulk_edit.append_only: a bulk edit is a record and is not changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.undone_at IS DISTINCT FROM OLD.undone_at THEN
    IF OLD.undone_at IS NOT NULL OR NEW.undone_at IS NULL THEN
      RAISE EXCEPTION 'bulk_edit.append_only: a batch is marked undone once and not taken back' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM commerce.bulk_edit_batches u WHERE u.store_id = OLD.store_id AND u.undo_of = OLD.id) THEN
      RAISE EXCEPTION 'bulk_edit.undone: a batch is marked undone when its undo was made' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bulk_edit_batches_rules BEFORE INSERT OR UPDATE ON commerce.bulk_edit_batches
  FOR EACH ROW EXECUTE FUNCTION commerce.bulk_edit_batches_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.bulk_edit_items_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- UPDATE only (a removal is the retention job's). A changed cell can be marked undone; nothing else about an item changes.
  IF NEW.store_id <> OLD.store_id OR NEW.batch_id <> OLD.batch_id OR NEW.seq <> OLD.seq OR NEW.product_id <> OLD.product_id
     OR NEW.variant_id IS DISTINCT FROM OLD.variant_id OR NEW.field <> OLD.field
     OR NEW.before IS DISTINCT FROM OLD.before OR NEW.after IS DISTINCT FROM OLD.after OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'bulk_edit.append_only: a bulk edit is a record and is not changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.outcome <> OLD.outcome AND NOT (OLD.outcome = 'changed' AND NEW.outcome = 'undone') THEN
    RAISE EXCEPTION 'bulk_edit.append_only: only a changed cell can be marked undone' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bulk_edit_items_rules BEFORE UPDATE ON commerce.bulk_edit_items
  FOR EACH ROW EXECUTE FUNCTION commerce.bulk_edit_items_rules();
