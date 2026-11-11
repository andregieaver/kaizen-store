-- Themes from outside (wave 7 unit J, D344, docs/wave-7-storefront.md J), the rules the database holds:
-- * A submission keeps who made it, from which store, its kind and the look as submitted; its status moves only forward (waiting →
--   reviewing → approved, or rejected or withdrawn while open), a decision is recorded once, and a new theme's link to the theme it became
--   is set once (`theme_submissions_rules()`).
-- * A theme with an outside author has no price until a revenue share is decided (`theme_prices_author_free()`).
--
-- No function here contains DELETE, TRUNCATE or DROP.

ALTER TABLE commerce.theme_submissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.theme_submissions_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
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
     OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.author_name <> OLD.author_name OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'theme_submissions.fixed: a submission is kept as it was submitted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.preset_id IS DISTINCT FROM OLD.preset_id AND OLD.preset_id IS NOT NULL THEN
    RAISE EXCEPTION 'theme_submissions.preset: a submission''s theme is set once' USING ERRCODE = 'check_violation';
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
--> statement-breakpoint

CREATE TRIGGER theme_submissions_rules
BEFORE INSERT OR UPDATE ON commerce.theme_submissions
FOR EACH ROW EXECUTE FUNCTION commerce.theme_submissions_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.theme_prices_author_free()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.design_presets p WHERE p.id = NEW.preset_id AND p.author_id IS NOT NULL) THEN
    RAISE EXCEPTION 'theme_prices.author_free: a theme from outside is free' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER theme_prices_author_free
BEFORE INSERT OR UPDATE ON commerce.theme_prices
FOR EACH ROW EXECUTE FUNCTION commerce.theme_prices_author_free();
