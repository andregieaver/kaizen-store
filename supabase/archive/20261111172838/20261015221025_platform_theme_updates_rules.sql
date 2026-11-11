-- Updates of Kaizena Flow's own installed themes (phase 4 step 3, D253, docs/theme-phase-4.md): the rules the database holds, as for a store's
-- (D245, `theme_install_updates_rules()` and `store_theme_installs_rules()`). The column and the table are in the migration before this one.
--
-- * `platform_theme_install_updates`: row-level security on (no policy: the `commerce` schema is private to the server); a row keeps what it
--   recorded, only `undone_at` changes, once, from empty; the versions and the account it names may go null with them.
-- * `platform_theme_installs`: an install keeps the theme it came from, and its version changes only to another version of that same theme (an
--   update, or an update undone). Step 1's rule fixed the version altogether; the code still running during the deploy never moves it.
--
-- No function here contains DELETE, TRUNCATE or DROP.

ALTER TABLE commerce.platform_theme_install_updates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.platform_theme_install_updates_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.install_id IS DISTINCT FROM OLD.install_id
     OR NEW.before IS DISTINCT FROM OLD.before OR NEW.after IS DISTINCT FROM OLD.after OR NEW.kept IS DISTINCT FROM OLD.kept
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.from_version_id IS DISTINCT FROM OLD.from_version_id AND NEW.from_version_id IS NOT NULL)
     OR (NEW.to_version_id IS DISTINCT FROM OLD.to_version_id AND NEW.to_version_id IS NOT NULL)
     OR (NEW.updated_by IS DISTINCT FROM OLD.updated_by AND NEW.updated_by IS NOT NULL) THEN
    RAISE EXCEPTION 'platform_theme_install_updates.fixed: an update of a theme keeps what it recorded' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.undone_at IS NOT NULL AND NEW.undone_at IS DISTINCT FROM OLD.undone_at THEN
    RAISE EXCEPTION 'platform_theme_install_updates.undone: this update was undone already' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER platform_theme_install_updates_rules BEFORE UPDATE ON commerce.platform_theme_install_updates
  FOR EACH ROW EXECUTE FUNCTION commerce.platform_theme_install_updates_rules();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.platform_theme_installs_rules()
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
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.preset_id IS DISTINCT FROM OLD.preset_id
     OR NEW.installed_at IS DISTINCT FROM OLD.installed_at
     OR (NEW.installed_by IS DISTINCT FROM OLD.installed_by AND NEW.installed_by IS NOT NULL) THEN
    RAISE EXCEPTION 'platform_theme_installs.fixed: an install keeps the theme it came from' USING ERRCODE = 'check_violation';
  END IF;
  -- An update (D253) moves the version, only ever to another version of the install's own theme.
  IF NEW.version_id IS DISTINCT FROM OLD.version_id AND (
       NEW.version_id IS NULL OR NEW.preset_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM commerce.design_preset_versions v WHERE v.id = NEW.version_id AND v.preset_id = NEW.preset_id)
     ) THEN
    RAISE EXCEPTION 'platform_theme_installs.version: an install moves only to another version of its own theme' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
