-- Changes by the clock and links to share (wave 7 unit F, D340, docs/wave-7-storefront.md F), the rules the database holds:
-- * A page's schedule grows a way back (`revert_at`, `revert_status`): each leg is settled once, the way back only after its publish ran,
--   a publish that did not happen leaves no way back waiting, and what the publish replaced is fixed once it ran (`page_schedules_rules()`).
-- * A theme's schedule names one of its own store's installs and is settled the same way (`theme_schedules_rules()`).
-- * A preview link names one of its own store's pages or articles or installed themes, keeps its token's hash and expiry as made, and is
--   revoked once, never brought back (`preview_links_rules()`).
-- * A look version stays as it was kept (`look_versions_fixed()`); only an account deleted since is let go of.
--
-- No function here contains DELETE, TRUNCATE or DROP: old look versions go in application code (`keepLookVersion()`).

ALTER TABLE commerce.theme_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.preview_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.look_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.page_schedules_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.store_id <> OLD.store_id OR NEW.page_id <> OLD.page_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'page_schedules.fixed: a schedule stays its page''s' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'waiting' AND (NEW.status <> OLD.status OR NEW.publish_at <> OLD.publish_at) THEN
    RAISE EXCEPTION 'page_schedules.settled: a schedule that ran or was cancelled is kept as it ended' USING ERRCODE = 'check_violation';
  END IF;
  -- The way back (D340).
  IF OLD.status <> 'waiting' AND (
    NEW.revert_at IS DISTINCT FROM OLD.revert_at
    OR NEW.before_content IS DISTINCT FROM OLD.before_content
    OR NEW.published_hash IS DISTINCT FROM OLD.published_hash
  ) THEN
    RAISE EXCEPTION 'page_schedules.revert_fixed: the way back is fixed once the publish ran' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revert_status IN ('done', 'failed', 'cancelled') AND NEW.revert_status IS DISTINCT FROM OLD.revert_status THEN
    RAISE EXCEPTION 'page_schedules.revert_settled: a way back that ran or was cancelled is kept as it ended' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revert_status IN ('done', 'failed') AND OLD.revert_status = 'waiting' AND NEW.status <> 'done' THEN
    RAISE EXCEPTION 'page_schedules.revert_order: a way back runs only after its publish' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('failed', 'cancelled') AND NEW.revert_status = 'waiting' THEN
    RAISE EXCEPTION 'page_schedules.revert_orphan: a publish that did not happen has no way back waiting' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.theme_schedules_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.install_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM commerce.store_theme_installs i WHERE i.id = NEW.install_id AND i.store_id = NEW.store_id
    ) THEN
      RAISE EXCEPTION 'theme_schedules.install: a store schedules one of its own installed themes' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'waiting' OR NEW.before_install_id IS NOT NULL OR NEW.revert_status IS DISTINCT FROM (CASE WHEN NEW.revert_at IS NULL THEN NULL ELSE 'waiting' END) THEN
      RAISE EXCEPTION 'theme_schedules.new: a plan starts waiting' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.store_id <> OLD.store_id OR NEW.created_at <> OLD.created_at
     OR (NEW.install_id IS DISTINCT FROM OLD.install_id AND NEW.install_id IS NOT NULL) THEN
    RAISE EXCEPTION 'theme_schedules.fixed: a plan stays its store''s and its theme''s' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'waiting' AND (NEW.status <> OLD.status OR NEW.live_at <> OLD.live_at OR NEW.revert_at IS DISTINCT FROM OLD.revert_at) THEN
    RAISE EXCEPTION 'theme_schedules.settled: a plan that ran or was cancelled is kept as it ended' USING ERRCODE = 'check_violation';
  END IF;
  -- The theme that was live is written once, when the plan runs, and only one of the store's; afterwards it can only be let go of.
  IF NEW.before_install_id IS DISTINCT FROM OLD.before_install_id AND NEW.before_install_id IS NOT NULL AND (
    OLD.status <> 'waiting' OR NOT EXISTS (
      SELECT 1 FROM commerce.store_theme_installs i WHERE i.id = NEW.before_install_id AND i.store_id = NEW.store_id
    )
  ) THEN
    RAISE EXCEPTION 'theme_schedules.before: the theme that was live is the store''s own, written when the plan runs' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revert_status IN ('done', 'failed', 'cancelled') AND NEW.revert_status IS DISTINCT FROM OLD.revert_status THEN
    RAISE EXCEPTION 'theme_schedules.revert_settled: a way back that ran or was cancelled is kept as it ended' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revert_status IN ('done', 'failed') AND OLD.revert_status = 'waiting' AND NEW.status <> 'done' THEN
    RAISE EXCEPTION 'theme_schedules.revert_order: a way back runs only after its plan' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('failed', 'cancelled') AND NEW.revert_status = 'waiting' THEN
    RAISE EXCEPTION 'theme_schedules.revert_orphan: a plan that did not happen has no way back waiting' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER theme_schedules_rules BEFORE INSERT OR UPDATE ON commerce.theme_schedules
  FOR EACH ROW EXECUTE FUNCTION commerce.theme_schedules_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.preview_links_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.page_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM commerce.pages p WHERE p.id = NEW.page_id AND p.store_id = NEW.store_id AND p.type IN ('page', 'article')
    ) THEN
      RAISE EXCEPTION 'preview_links.page: a link opens one of the store''s own pages or articles' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.install_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM commerce.store_theme_installs i WHERE i.id = NEW.install_id AND i.store_id = NEW.store_id
    ) THEN
      RAISE EXCEPTION 'preview_links.install: a link opens one of the store''s own installed themes' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL THEN
      RAISE EXCEPTION 'preview_links.new: a link starts open' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.store_id <> OLD.store_id OR NEW.page_id IS DISTINCT FROM OLD.page_id OR NEW.install_id IS DISTINCT FROM OLD.install_id
     OR NEW.token_hash <> OLD.token_hash OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL) THEN
    RAISE EXCEPTION 'preview_links.fixed: a link stays as it was made' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'preview_links.revoked: a revoked link stays revoked' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revoked_by IS DISTINCT FROM OLD.revoked_by AND NEW.revoked_by IS NOT NULL AND OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'preview_links.revoked: who revoked a link is written when it is revoked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER preview_links_rules BEFORE INSERT OR UPDATE ON commerce.preview_links
  FOR EACH ROW EXECUTE FUNCTION commerce.preview_links_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.look_versions_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Only an account deleted since is let go of (its foreign key sets it to null); the look as kept never changes.
  IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.kind <> OLD.kind OR NEW.theme <> OLD.theme OR NEW.created_at <> OLD.created_at
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL) THEN
    RAISE EXCEPTION 'look_versions.fixed: a version of the look stays as it was kept' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER look_versions_fixed BEFORE UPDATE ON commerce.look_versions
  FOR EACH ROW EXECUTE FUNCTION commerce.look_versions_fixed();
