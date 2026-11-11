-- The page migration's runs (theme store phase 2 step 2, D243, docs/theme-phase-2.md): the rules the database holds. The table is in the
-- migration before this one.
--
-- * Row-level security on (no policy: the `commerce` schema is private to the server).
-- * A run's row keeps what it recorded: only `undone_at` changes, once, from empty (`page_theme_detaches_rules()`). Rows are deleted by the
--   application's pruning (`pruneThemeDetaches()`) and with their page.
--
-- No function here contains DELETE, TRUNCATE or DROP.

ALTER TABLE commerce.page_theme_detaches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.page_theme_detaches_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.page_id IS DISTINCT FROM OLD.page_id OR NEW.draft_before IS DISTINCT FROM OLD.draft_before
     OR NEW.draft_after IS DISTINCT FROM OLD.draft_after OR NEW.published_before IS DISTINCT FROM OLD.published_before
     OR NEW.published_after IS DISTINCT FROM OLD.published_after OR NEW.followed IS DISTINCT FROM OLD.followed
     OR NEW.kept IS DISTINCT FROM OLD.kept OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL) THEN
    RAISE EXCEPTION 'page_theme_detaches.fixed: a run of the theme migration keeps what it recorded' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.undone_at IS NOT NULL AND NEW.undone_at IS DISTINCT FROM OLD.undone_at THEN
    RAISE EXCEPTION 'page_theme_detaches.undone: this run was undone already' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER page_theme_detaches_rules BEFORE UPDATE ON commerce.page_theme_detaches
  FOR EACH ROW EXECUTE FUNCTION commerce.page_theme_detaches_rules();
