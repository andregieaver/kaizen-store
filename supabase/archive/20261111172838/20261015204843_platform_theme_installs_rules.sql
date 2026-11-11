-- Kaizena Flow's own installed themes (phase 4 step 1, docs/theme-phase-4.md): the rules the database holds, as for a store's
-- (`store_theme_installs_rules()`), and the site's look as it is now kept as its live *Custom* install. The table is the migration before.
--
-- * Row-level security (no policy: the `commerce` schema is private to the server).
-- * An install keeps the theme and version it came from and when and by whom it was added; the live one is never removed:
--   `platform_theme_installs_rules()`; one live is the unique index.
-- * The live look stays in `platform_settings`' columns, so nothing the site draws changes and the code still running during the deploy keeps
--   working.
--
-- No function here contains DELETE, TRUNCATE or DROP.

ALTER TABLE commerce.platform_theme_installs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.platform_theme_installs_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.live THEN
      RAISE EXCEPTION 'platform_theme_installs.live: the live theme is not removed; switch to another first' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.preset_id IS DISTINCT FROM OLD.preset_id OR NEW.version_id IS DISTINCT FROM OLD.version_id
     OR NEW.installed_at IS DISTINCT FROM OLD.installed_at
     OR (NEW.installed_by IS DISTINCT FROM OLD.installed_by AND NEW.installed_by IS NOT NULL) THEN
    RAISE EXCEPTION 'platform_theme_installs.fixed: an install keeps the theme and version it came from' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER platform_theme_installs_rules BEFORE UPDATE OR DELETE ON commerce.platform_theme_installs
  FOR EACH ROW EXECUTE FUNCTION commerce.platform_theme_installs_rules();
--> statement-breakpoint

-- The look Kaizena Flow's site has now is its live *Custom* install.
INSERT INTO commerce.platform_theme_installs (title, live, switched_at)
SELECT 'Custom', true, now()
WHERE NOT EXISTS (SELECT 1 FROM commerce.platform_theme_installs WHERE live);
