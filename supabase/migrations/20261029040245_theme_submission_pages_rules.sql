-- Theme submissions with their own pages (wave 11 unit I, D388, docs/wave-11-core-and-psi.md I): a submission may carry the author
-- store's published pages (`pages`, copied as a template is when sent); they are fixed with the rest of what was sent, and the store template
-- its review places them in (`content_starter_id`) is set once, only for a submission with pages. No function here contains DELETE,
-- TRUNCATE or DROP.

CREATE OR REPLACE FUNCTION commerce.theme_submissions_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.content_starter_id IS NOT NULL THEN
      RAISE EXCEPTION 'theme_submissions.content: its pages are placed by its review' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'waiting' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.reason IS NOT NULL THEN
      RAISE EXCEPTION 'theme_submissions.new: a submission starts waiting' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'theme' AND NEW.preset_id IS NOT NULL THEN
      RAISE EXCEPTION 'theme_submissions.new_theme: a new theme is made by its review' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'update' AND NOT EXISTS (
      SELECT 1 FROM commerce.design_presets p WHERE p.id = NEW.preset_id AND p.author_id = NEW.account_id
    ) THEN
      RAISE EXCEPTION 'theme_submissions.author: only a theme''s author submits an update of it' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.account_id <> OLD.account_id OR NEW.store_id <> OLD.store_id OR NEW.kind <> OLD.kind OR NEW.snapshot <> OLD.snapshot
     OR NEW.title <> OLD.title OR NEW.summary <> OLD.summary OR NEW.description <> OLD.description
     OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.author_name <> OLD.author_name OR NEW.created_at <> OLD.created_at
     OR NEW.pages IS DISTINCT FROM OLD.pages THEN
    RAISE EXCEPTION 'theme_submissions.fixed: a submission is kept as it was submitted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.preset_id IS DISTINCT FROM OLD.preset_id AND OLD.preset_id IS NOT NULL THEN
    RAISE EXCEPTION 'theme_submissions.preset: a submission''s theme is set once' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.content_starter_id IS DISTINCT FROM OLD.content_starter_id AND (OLD.content_starter_id IS NOT NULL OR NEW.pages IS NULL) THEN
    RAISE EXCEPTION 'theme_submissions.content: a submission''s content is placed once, and only for its pages' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'waiting' AND NEW.status IN ('reviewing', 'rejected', 'withdrawn'))
    OR (OLD.status = 'reviewing' AND NEW.status IN ('approved', 'rejected', 'withdrawn'))
  ) THEN
    RAISE EXCEPTION 'theme_submissions.status: a submission moves only forward' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('approved', 'rejected', 'withdrawn') AND (
    NEW.reason IS DISTINCT FROM OLD.reason OR NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
  ) THEN
    RAISE EXCEPTION 'theme_submissions.decided: a decision is kept as it was made' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'approved' AND NEW.preset_id IS NULL THEN
    RAISE EXCEPTION 'theme_submissions.approved: an approved submission names its theme' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
