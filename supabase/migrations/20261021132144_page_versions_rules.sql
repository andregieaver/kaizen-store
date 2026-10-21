-- A page's versions (D305): kept as they were saved, never changed. Pruning past a page's newest fifty and a deleted page's versions
-- going with it are deletes, which are allowed.
ALTER TABLE commerce.page_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION commerce.page_versions_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'page_versions.fixed: a page''s version stays as it was kept' USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER page_versions_fixed BEFORE UPDATE ON commerce.page_versions
  FOR EACH ROW EXECUTE FUNCTION commerce.page_versions_fixed();
