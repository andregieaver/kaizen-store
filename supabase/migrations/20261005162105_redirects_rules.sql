-- Redirects and the 404 report (wave 2, second run, D168, docs/wave-2-redirects.md 3): the rules that live in the database. The tables, their checks, foreign
-- keys and plain indexes are in the migration before this one.
--
-- * a changed address leaves a redirect: a product whose handle changes and was ever live (`products_leave_redirect()`), a category or tag whose slug
--   changes (`terms_leave_redirect()`), automatic rows (`kind` product, category, tag) that point at the THING, never at an address, so they never chain;
-- * an address taken replaces the automatic redirect from it (`products_taken_address()`, `terms_taken_address()`, as `pages_keep_addresses()` does for
--   pages); a MANUAL redirect from it is left, and is simply not used while the address is live;
-- * `products.first_active_at`, set when a product first becomes active and never cleared (no backfill: a product that is active or archived today counts as
--   ever live by the rule `status <> 'draft'`);
-- * a redirect row is kept honest: an automatic one is immutable but for its counters (`redirects_guard()`), belongs to a thing of its own store, and no
--   manual redirect closes a loop (`redirects_no_loop()`, under the store's advisory lock `redirects:{store}` that the service takes too);
-- * the 404 report is written by one function (`record_not_found()`), with a cap on the addresses of a day;
-- * a job's lifecycle learns the two new kinds (`data_jobs_rules()`, `start_export_job()`), D165's own rules otherwise unchanged;
-- * trigram indexes for the manager's search (pg_trgm lives in `extensions`).
--
-- Statements with DELETE inside functions: `products_leave_redirect()`, `products_taken_address()`, `terms_leave_redirect()`, `terms_taken_address()`
-- (each deletes AUTOMATIC redirect rows from `commerce.redirects`, as `pages_keep_addresses()` deletes `page_redirects`). CI applies migrations over a
-- direct connection, so they run as written. Like every commerce table: row-level security on, no policies, the Data API reaches none of it.
ALTER TABLE commerce.redirects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.not_found_hits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.not_found_ignored ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- When a product first became active
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.products_first_active()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.first_active_at IS NOT NULL THEN
    NEW.first_active_at := OLD.first_active_at;
  ELSIF NEW.status = 'active' AND NEW.first_active_at IS NULL THEN
    NEW.first_active_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER products_first_active BEFORE INSERT OR UPDATE ON commerce.products
  FOR EACH ROW EXECUTE FUNCTION commerce.products_first_active();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- What a redirect row may be
-- ---------------------------------------------------------------------------

-- The path of a target as the loop check reads it: the part before `?` and `#`, in lower case, without a trailing slash (`/` stays `/`).
CREATE FUNCTION commerce.redirect_path_of(p_target text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p ~ '^/+$' THEN '/'
    ELSE regexp_replace(p, '/+$', '')
  END
  FROM (SELECT lower(split_part(split_part(p_target, '#', 1), '?', 1)) AS p) q
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.redirects_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- An automatic redirect is the address of a thing of this store, in the shape its kind has.
    IF NEW.kind = 'product' AND left(NEW.source, 3) <> '/p/' THEN
      RAISE EXCEPTION 'redirect.source: a product redirect is from /p/{handle}' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'category' AND left(NEW.source, 10) <> '/category/' THEN
      RAISE EXCEPTION 'redirect.source: a category redirect is from /category/{slug}' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'tag' AND left(NEW.source, 5) <> '/tag/' THEN
      RAISE EXCEPTION 'redirect.source: a tag redirect is from /tag/{slug}' USING ERRCODE = 'check_violation';
    END IF;
    -- A term's key is (store, content type, id) and a redirect's store and kind must be the term's own.
    IF NEW.term_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM commerce.terms t
       WHERE t.id = NEW.term_id AND t.store_id = NEW.store_id AND t.content_type = 'product' AND t.kind = NEW.kind
    ) THEN
      RAISE EXCEPTION 'redirect.entity: the category or tag is not one of this store''s product terms of this kind' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.kind <> OLD.kind
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'redirect.fixed: a redirect keeps its store, kind and maker' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.kind <> 'manual' AND (
       NEW.source <> OLD.source OR NEW.target IS DISTINCT FROM OLD.target OR NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.term_id IS DISTINCT FROM OLD.term_id OR NEW.origin <> OLD.origin) THEN
    RAISE EXCEPTION 'redirect.automatic: an automatic redirect follows its product, category or tag and is only deleted' USING ERRCODE = 'check_violation';
  END IF;
  -- Counting a request is not a change of the redirect.
  IF NEW.source <> OLD.source OR NEW.target IS DISTINCT FROM OLD.target OR NEW.origin <> OLD.origin THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER redirects_guard BEFORE INSERT OR UPDATE ON commerce.redirects
  FOR EACH ROW EXECUTE FUNCTION commerce.redirects_guard();
--> statement-breakpoint

-- No manual redirect closes a loop: from the new target, follow manual rows' source to target for at most 20 hops; reaching the new source is a loop
-- (a target equal to the source is a loop of one). Two writers at once are serialised on the store, so A to B and B to A cannot both pass.
CREATE FUNCTION commerce.redirects_no_loop()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_cur text;
  v_next text;
  v_hops integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('redirects:' || NEW.store_id::text, 0));
  v_cur := commerce.redirect_path_of(NEW.target);
  WHILE v_hops <= 20 LOOP
    IF v_cur = NEW.source THEN
      RAISE EXCEPTION 'redirect.loop: this redirect would lead back to its own address' USING ERRCODE = 'check_violation';
    END IF;
    v_next := NULL;
    SELECT commerce.redirect_path_of(r.target) INTO v_next
      FROM commerce.redirects r
     WHERE r.store_id = NEW.store_id AND r.kind = 'manual' AND r.source = v_cur AND r.id <> NEW.id;
    EXIT WHEN v_next IS NULL;
    v_cur := v_next;
    v_hops := v_hops + 1;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER redirects_no_loop BEFORE INSERT OR UPDATE OF source, target ON commerce.redirects
  FOR EACH ROW WHEN (NEW.kind = 'manual') EXECUTE FUNCTION commerce.redirects_no_loop();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A changed address leaves a redirect, an address taken replaces it
-- ---------------------------------------------------------------------------

-- A product whose handle changed and that was ever live (not a draft, or once active) leaves `/p/{old}` pointing at the product. An older automatic row for
-- the same address moves to the newest owner (deleted and made again: automatic rows are immutable). A MANUAL redirect from that address is left as it is.
CREATE FUNCTION commerce.products_leave_redirect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.handle IS DISTINCT FROM OLD.handle AND (OLD.status <> 'draft' OR OLD.first_active_at IS NOT NULL) THEN
    DELETE FROM commerce.redirects r WHERE r.store_id = NEW.store_id AND r.source = '/p/' || OLD.handle AND r.kind <> 'manual';
    INSERT INTO commerce.redirects (store_id, kind, source, product_id, origin)
    VALUES (NEW.store_id, 'product', '/p/' || OLD.handle, NEW.id, 'system')
    ON CONFLICT ON CONSTRAINT redirects_store_source_key DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER products_leave_redirect AFTER UPDATE OF handle ON commerce.products
  FOR EACH ROW EXECUTE FUNCTION commerce.products_leave_redirect();
--> statement-breakpoint

CREATE FUNCTION commerce.products_taken_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  DELETE FROM commerce.redirects r WHERE r.store_id = NEW.store_id AND r.source = '/p/' || NEW.handle AND r.kind <> 'manual';
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER products_taken_address AFTER INSERT OR UPDATE OF handle ON commerce.products
  FOR EACH ROW EXECUTE FUNCTION commerce.products_taken_address();
--> statement-breakpoint

-- A product category or tag whose slug changed leaves `/category/{old}` or `/tag/{old}` pointing at it. Only a store's product terms have pages of
-- their own with these addresses (Kaizen's own and the page and article terms are not covered).
CREATE FUNCTION commerce.terms_leave_redirect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_source text;
BEGIN
  IF NEW.content_type = 'product' AND NEW.store_id IS NOT NULL AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    v_source := '/' || NEW.kind || '/' || OLD.slug;
    DELETE FROM commerce.redirects r WHERE r.store_id = NEW.store_id AND r.source = v_source AND r.kind <> 'manual';
    INSERT INTO commerce.redirects (store_id, kind, source, term_id, origin)
    VALUES (NEW.store_id, NEW.kind, v_source, NEW.id, 'system')
    ON CONFLICT ON CONSTRAINT redirects_store_source_key DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER terms_leave_redirect AFTER UPDATE OF slug ON commerce.terms
  FOR EACH ROW EXECUTE FUNCTION commerce.terms_leave_redirect();
--> statement-breakpoint

CREATE FUNCTION commerce.terms_taken_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.content_type = 'product' AND NEW.store_id IS NOT NULL THEN
    DELETE FROM commerce.redirects r WHERE r.store_id = NEW.store_id AND r.source = '/' || NEW.kind || '/' || NEW.slug AND r.kind <> 'manual';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER terms_taken_address AFTER INSERT OR UPDATE OF slug ON commerce.terms
  FOR EACH ROW EXECUTE FUNCTION commerce.terms_taken_address();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The 404 report: one writer
-- ---------------------------------------------------------------------------

-- Counts one request for a missing address (already put in its normal form and accepted by `recordablePath()` in code) on today's UTC day: increments
-- the row of (store, today, address); makes it while the day has fewer than `p_cap` different addresses; else counts it in the day's one row with no address.
-- Two requests at once may overshoot the cap by a few; the unique key keeps the rows distinct. No DELETE: old rows are pruned by application code.
CREATE FUNCTION commerce.record_not_found(p_store uuid, p_path text, p_crawler boolean, p_cap integer)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_crawler integer := CASE WHEN p_crawler THEN 1 ELSE 0 END;
  v_distinct integer;
BEGIN
  IF p_path IS NULL THEN
    RAISE EXCEPTION 'not_found.path: an address is needed' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE commerce.not_found_hits h
     SET hits = h.hits + 1, crawler_hits = h.crawler_hits + v_crawler, last_seen_at = now()
   WHERE h.store_id = p_store AND h.day = v_day AND h.path = p_path;
  IF FOUND THEN RETURN; END IF;

  SELECT count(*)::integer INTO v_distinct
    FROM commerce.not_found_hits h
   WHERE h.store_id = p_store AND h.day = v_day AND h.path IS NOT NULL;

  INSERT INTO commerce.not_found_hits (store_id, day, path, hits, crawler_hits)
  VALUES (p_store, v_day, CASE WHEN v_distinct < p_cap THEN p_path ELSE NULL END, 1, v_crawler)
  ON CONFLICT ON CONSTRAINT not_found_hits_key
  DO UPDATE SET hits = commerce.not_found_hits.hits + 1,
                crawler_hits = commerce.not_found_hits.crawler_hits + v_crawler,
                last_seen_at = now();
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The manager's search: substrings of the source and the target (queries use lower(source) and lower(target))
-- ---------------------------------------------------------------------------

CREATE INDEX redirects_source_trgm_idx ON commerce.redirects USING gin (lower(source) extensions.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX redirects_target_trgm_idx ON commerce.redirects USING gin (lower(target) extensions.gin_trgm_ops);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The job pipeline learns the redirect file kinds (D165's rules, widened)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION commerce.data_jobs_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_import boolean := NEW.kind IN ('product_import', 'redirect_import');
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

-- Starts a product, order, customer or redirect export unless the store already has `p_max` running or queued ones. Returns the job's id.
-- `data_job.too_many_exports` when the limit is reached. Two requests at once are serialised on the store.
CREATE OR REPLACE FUNCTION commerce.start_export_job(p_store uuid, p_kind text, p_requested_by uuid, p_options jsonb, p_max integer)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_active integer;
  v_id uuid;
BEGIN
  IF p_kind NOT IN ('product_export', 'order_export', 'customer_export', 'redirect_export') THEN
    RAISE EXCEPTION 'data_job.kind: % is not an export', p_kind USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('data_jobs:' || p_store::text, 0));
  SELECT count(*)::integer INTO v_active
    FROM commerce.data_jobs
   WHERE store_id = p_store AND kind NOT IN ('product_import', 'redirect_import') AND status IN ('queued', 'running');
  IF v_active >= p_max THEN
    RAISE EXCEPTION 'data_job.too_many_exports: % exports are already being made for this store', v_active USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO commerce.data_jobs (store_id, kind, status, phase, format, options, requested_by)
  VALUES (p_store, p_kind, 'queued', 'write', 'kaizen', coalesce(p_options, '{}'::jsonb), p_requested_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
