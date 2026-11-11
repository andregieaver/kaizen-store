-- A theme's presets (docs/theme-showcase-phase-1.md step 1; variations in code): the rules the database holds. The table and the
-- installs' `variation` columns are the migration before.
--
-- * Row-level security on `design_variations` (no policy: the `commerce` schema is private to the server).
-- * A preset keeps its theme and its key (installs remember a preset by its key), and a theme has at most five besides its own look
--   (`design_variations_rules()`; the theme's row is locked while counting, so two admins adding at once cannot pass six).
-- * An install keeps the preset it was added with (`store_theme_installs_rules()`, `platform_theme_installs_rules()`, otherwise as before):
--   when a later version no longer has that preset, the install takes the theme's own look at its update and keeps the key, so a version
--   that brings the preset back brings the install back to it.
--
-- No function here contains DELETE, TRUNCATE or DROP.

ALTER TABLE commerce.design_variations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.design_variations_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.preset_id IS DISTINCT FROM OLD.preset_id OR NEW.key IS DISTINCT FROM OLD.key
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'design_variations.fixed: a preset keeps its theme and its key' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM 1 FROM commerce.design_presets WHERE id = NEW.preset_id FOR UPDATE;
  IF (SELECT count(*) FROM commerce.design_variations WHERE preset_id = NEW.preset_id) >= 5 THEN
    RAISE EXCEPTION 'design_variations.limit: a theme has at most six presets, its own look and five more' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER design_variations_rules BEFORE INSERT OR UPDATE ON commerce.design_variations
  FOR EACH ROW EXECUTE FUNCTION commerce.design_variations_rules();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.store_theme_installs_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.live THEN
      RAISE EXCEPTION 'store_theme_installs.live: the live theme is not removed; switch to another first' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.preset_id IS DISTINCT FROM OLD.preset_id
     OR NEW.installed_at IS DISTINCT FROM OLD.installed_at
     OR (NEW.installed_by IS DISTINCT FROM OLD.installed_by AND NEW.installed_by IS NOT NULL) THEN
    RAISE EXCEPTION 'store_theme_installs.fixed: an install keeps the theme it came from' USING ERRCODE = 'check_violation';
  END IF;
  -- The preset it was added with stays (its key, kept even while a version has no such preset).
  IF NEW.variation IS DISTINCT FROM OLD.variation THEN
    RAISE EXCEPTION 'store_theme_installs.variation: an install keeps the preset it was added with' USING ERRCODE = 'check_violation';
  END IF;
  -- An update (D245) moves the version, only ever to another version of the install's own theme.
  IF NEW.version_id IS DISTINCT FROM OLD.version_id AND (
       NEW.version_id IS NULL OR NEW.preset_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM commerce.design_preset_versions v WHERE v.id = NEW.version_id AND v.preset_id = NEW.preset_id)
     ) THEN
    RAISE EXCEPTION 'store_theme_installs.version: an install moves only to another version of its own theme' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
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
  -- The preset it was added with stays (its key, kept even while a version has no such preset).
  IF NEW.variation IS DISTINCT FROM OLD.variation THEN
    RAISE EXCEPTION 'platform_theme_installs.variation: an install keeps the preset it was added with' USING ERRCODE = 'check_violation';
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
