-- Design profiles (D176, docs/design-profiles.md): the rules that live in the database. The tables and columns are in the migration before
-- this one.
--
-- * a design profile is unpublished, never deleted (`design_presets_rules()`), and keeps `updated_at` current;
-- * a use of one (`design_preset_uses`) is history: never deleted, and only `restored_at`/`restored_by` change, once, from empty, besides the
--   saved theme's id going empty when the owner deletes that theme (`design_preset_uses_rules()`).
--
-- Applying a profile is application code (`applyDesignPreset()` in src/server/design-presets.ts): it installs fonts and copies pictures, which
-- SQL cannot. No existing function is patched. No DELETE anywhere.

ALTER TABLE commerce.design_presets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.design_preset_uses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.design_presets_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'design_presets.kept: a design profile is unpublished, never deleted' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER design_presets_rules
BEFORE UPDATE OR DELETE ON commerce.design_presets
FOR EACH ROW EXECUTE FUNCTION commerce.design_presets_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.design_preset_uses_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'design_preset_uses.kept: a use of a design profile is history, never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.preset_id IS DISTINCT FROM OLD.preset_id
     OR NEW.previous IS DISTINCT FROM OLD.previous OR NEW.applied_by IS DISTINCT FROM OLD.applied_by
     OR NEW.applied_at IS DISTINCT FROM OLD.applied_at
     OR (NEW.saved_theme_id IS DISTINCT FROM OLD.saved_theme_id AND NEW.saved_theme_id IS NOT NULL) THEN
    RAISE EXCEPTION 'design_preset_uses.fixed: a use of a design profile is not changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.restored_at IS NOT NULL
     AND (NEW.restored_at IS DISTINCT FROM OLD.restored_at OR NEW.restored_by IS DISTINCT FROM OLD.restored_by) THEN
    RAISE EXCEPTION 'design_preset_uses.restored: the look from before was put back already' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.restored_at IS NULL AND NEW.restored_at IS NULL AND NEW.restored_by IS DISTINCT FROM OLD.restored_by THEN
    RAISE EXCEPTION 'design_preset_uses.fixed: a use of a design profile is not changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER design_preset_uses_rules
BEFORE UPDATE OR DELETE ON commerce.design_preset_uses
FOR EACH ROW EXECUTE FUNCTION commerce.design_preset_uses_rules();
