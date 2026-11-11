-- Themes as one thing (theme store phase 1, D241, docs/theme-store.md 5 and docs/theme-phase-1.md): the rules the database holds for a theme's
-- versions and a store's installed themes. The tables are in the migration before this one.
--
-- * Row-level security on the two new tables (no policy: the `commerce` schema is private to the server).
-- * A version is never changed, and goes only with its theme (a theme is deleted only while unused, D177): `design_preset_versions_rules()`.
-- * An install keeps what it came from; the live one is never removed (`store_theme_installs_rules()`); one live per store is the unique index.
-- * Every store has an install from its first moment: *Custom*, live, its own look (`stores_first_install()`), and every store there is gets one
--   now. A store wearing a design profile (its newest use not put back) has that profile's name and version on it, so its library says what
--   it wears.
-- * A theme published before has its version 1, from the snapshot stores were given.
-- * A use of a design profile (`design_preset_uses_rules()`) may lose its install's id when the install is removed (the foreign key's
--   `set null`), never gain or change one.
--
-- No function here contains DELETE, TRUNCATE or DROP. The live look stays in `stores`' columns, so nothing a page draws changes, and the code
-- still running during the deploy keeps working: it writes the live look where it always did.

ALTER TABLE commerce.design_preset_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.store_theme_installs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.design_preset_versions_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only with its theme (the foreign key's cascade runs after the theme's row is gone).
    IF EXISTS (SELECT 1 FROM commerce.design_presets d WHERE d.id = OLD.preset_id) THEN
      RAISE EXCEPTION 'design_preset_versions.kept: a published version of a theme is never deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.preset_id IS DISTINCT FROM OLD.preset_id OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR (NEW.published_by IS DISTINCT FROM OLD.published_by AND NEW.published_by IS NOT NULL) THEN
    RAISE EXCEPTION 'design_preset_versions.fixed: a published version of a theme is not changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER design_preset_versions_rules BEFORE UPDATE OR DELETE ON commerce.design_preset_versions
  FOR EACH ROW EXECUTE FUNCTION commerce.design_preset_versions_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.store_theme_installs_rules()
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
     OR NEW.version_id IS DISTINCT FROM OLD.version_id OR NEW.installed_at IS DISTINCT FROM OLD.installed_at
     OR (NEW.installed_by IS DISTINCT FROM OLD.installed_by AND NEW.installed_by IS NOT NULL) THEN
    RAISE EXCEPTION 'store_theme_installs.fixed: an install keeps the theme and version it came from' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER store_theme_installs_rules BEFORE UPDATE OR DELETE ON commerce.store_theme_installs
  FOR EACH ROW EXECUTE FUNCTION commerce.store_theme_installs_rules();
--> statement-breakpoint

-- Every new store (made by `clone_store()`, `duplicate_store()` or anything else) starts with its own look as its live *Custom* install.
CREATE FUNCTION commerce.stores_first_install()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO commerce.store_theme_installs (store_id, title, live, switched_at) VALUES (NEW.id, 'Custom', true, now());
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stores_first_install AFTER INSERT ON commerce.stores
  FOR EACH ROW EXECUTE FUNCTION commerce.stores_first_install();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.design_preset_uses_rules()
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
     OR (NEW.saved_theme_id IS DISTINCT FROM OLD.saved_theme_id AND NEW.saved_theme_id IS NOT NULL)
     OR (NEW.install_id IS DISTINCT FROM OLD.install_id AND NEW.install_id IS NOT NULL)
     OR (NEW.previous_install_id IS DISTINCT FROM OLD.previous_install_id AND NEW.previous_install_id IS NOT NULL) THEN
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

-- Version 1 of every theme published before: the snapshot stores were given.
INSERT INTO commerce.design_preset_versions (preset_id, number, snapshot, published_at, published_by)
SELECT d.id, 1, d.snapshot, coalesce(d.published_at, d.snapshot_at), d.updated_by
FROM commerce.design_presets d
WHERE d.published_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM commerce.design_preset_versions v WHERE v.preset_id = d.id);
--> statement-breakpoint

-- Every store's live install: its own look, named after the design profile it wears (its newest use not put back; putting back goes newest
-- first, so that is the profile the look came from).
INSERT INTO commerce.store_theme_installs (store_id, preset_id, version_id, title, live, installed_by, installed_at, switched_at)
SELECT s.id, u.preset_id,
  (SELECT v.id FROM commerce.design_preset_versions v WHERE v.preset_id = u.preset_id ORDER BY v.number DESC LIMIT 1),
  coalesce(left(btrim(d.title), 80), 'Custom'), true, u.applied_by, coalesce(u.applied_at, now()), coalesce(u.applied_at, now())
FROM commerce.stores s
LEFT JOIN LATERAL (
  SELECT x.preset_id, x.applied_by, x.applied_at FROM commerce.design_preset_uses x
  WHERE x.store_id = s.id AND x.restored_at IS NULL ORDER BY x.applied_at DESC, x.id DESC LIMIT 1
) u ON true
LEFT JOIN commerce.design_presets d ON d.id = u.preset_id
WHERE NOT EXISTS (SELECT 1 FROM commerce.store_theme_installs i WHERE i.store_id = s.id AND i.live);
