-- Projects and checklists (D903, docs/projects.md): the rules the database keeps.
--   The foreign keys that null only their own column: a list's home project, an item's and a subtask's status, a blocking item, a stage.
--   Which statuses a list has: its own when it has any, else the store's default statuses; the same for a project's stages
--   (`checklist_effective_statuses()`, `project_effective_stages()`). The default status of a new item: the first done one when it is
--   created ticked, else the first active one (Life's `default_checklist_item_status()`).
--   Done and status agree (Life's `toggleChecklistItem()` and `updateChecklistItemStatus()`): choosing a done or archived status ticks,
--   any other unticks; ticking moves to the first done status, unticking an item in a finished status to the first active one; clearing
--   the status leaves the tick. An item moved to another list keeps its status by name, or takes the new list's default.
--   A status belongs where it is used: the store's default or its own list's; a stage the store's default or its own project's, and only
--   for an item of a list in that project.
--   The home project is a member: linking makes it the home when there is none, unlinking moves the home to another member or clears it and
--   deletes the stages of the list's items in that project; setting a home links it.
--   The feature `projects` needs nothing (a website or a workspace plans its work too).

ALTER TABLE commerce.checklists ADD CONSTRAINT checklists_primary_project_fk
  FOREIGN KEY (store_id, primary_project_id) REFERENCES commerce.projects (store_id, id)
  ON DELETE SET NULL (primary_project_id);
--> statement-breakpoint
ALTER TABLE commerce.checklist_items ADD CONSTRAINT checklist_items_status_fk
  FOREIGN KEY (store_id, status_id) REFERENCES commerce.checklist_statuses (store_id, id)
  ON DELETE SET NULL (status_id);
--> statement-breakpoint
ALTER TABLE commerce.checklist_items ADD CONSTRAINT checklist_items_blocked_by_fk
  FOREIGN KEY (store_id, blocked_by_item_id) REFERENCES commerce.checklist_items (store_id, id)
  ON DELETE SET NULL (blocked_by_item_id);
--> statement-breakpoint
ALTER TABLE commerce.checklist_subtasks ADD CONSTRAINT checklist_subtasks_status_fk
  FOREIGN KEY (store_id, status_id) REFERENCES commerce.checklist_statuses (store_id, id)
  ON DELETE SET NULL (status_id);
--> statement-breakpoint
ALTER TABLE commerce.project_item_stages ADD CONSTRAINT project_item_stages_status_fk
  FOREIGN KEY (store_id, status_id) REFERENCES commerce.project_statuses (store_id, id)
  ON DELETE SET NULL (status_id);
--> statement-breakpoint

CREATE FUNCTION commerce.checklist_effective_statuses(p_store uuid, p_checklist uuid)
RETURNS TABLE (status_id uuid, slug text, bucket text, sort_order integer)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH own AS (
    SELECT EXISTS (SELECT 1 FROM commerce.checklist_statuses o WHERE o.store_id = p_store AND o.checklist_id = p_checklist) AS has
  )
  SELECT s.id, s.slug, s.bucket, s.sort_order
    FROM commerce.checklist_statuses s, own
   WHERE s.store_id = p_store
     AND ((own.has AND s.checklist_id = p_checklist) OR (NOT own.has AND s.checklist_id IS NULL))
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.project_effective_stages(p_store uuid, p_project uuid)
RETURNS TABLE (status_id uuid, slug text, bucket text, sort_order integer)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH own AS (
    SELECT EXISTS (SELECT 1 FROM commerce.project_statuses o WHERE o.store_id = p_store AND o.project_id = p_project) AS has
  )
  SELECT s.id, s.slug, s.bucket, s.sort_order
    FROM commerce.project_statuses s, own
   WHERE s.store_id = p_store
     AND ((own.has AND s.project_id = p_project) OR (NOT own.has AND s.project_id IS NULL))
$$;
--> statement-breakpoint

-- The first status of a bucket in a list, or null when it has none.
CREATE FUNCTION commerce.checklist_bucket_status(p_store uuid, p_checklist uuid, p_bucket text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT e.status_id FROM commerce.checklist_effective_statuses(p_store, p_checklist) e
   WHERE e.bucket = p_bucket ORDER BY e.sort_order, e.slug LIMIT 1
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.checklist_default_status(p_store uuid, p_checklist uuid, p_done boolean)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    CASE WHEN p_done THEN commerce.checklist_bucket_status(p_store, p_checklist, 'done') END,
    commerce.checklist_bucket_status(p_store, p_checklist, 'active'),
    (SELECT e.status_id FROM commerce.checklist_effective_statuses(p_store, p_checklist) e ORDER BY e.sort_order, e.slug LIMIT 1)
  )
$$;
--> statement-breakpoint

-- Keeps a row's tick and status in step, for an item (p_checklist its list) or a subtask (its item's list). `p_old_*` are null on insert.
CREATE FUNCTION commerce.checklist_tick_and_status(
  p_store uuid,
  p_checklist uuid,
  p_insert boolean,
  p_status uuid,
  p_old_status uuid,
  p_done timestamptz,
  p_old_done timestamptz,
  OUT status_id uuid,
  OUT done_at timestamptz
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_bucket text;
BEGIN
  status_id := p_status;
  done_at := p_done;
  IF p_insert AND p_status IS NULL THEN
    status_id := commerce.checklist_default_status(p_store, p_checklist, p_done IS NOT NULL);
    RETURN;
  END IF;
  IF p_status IS NOT NULL AND (p_insert OR p_status IS DISTINCT FROM p_old_status) THEN
    -- A status chosen: the tick follows it.
    SELECT s.bucket INTO v_bucket FROM commerce.checklist_statuses s WHERE s.store_id = p_store AND s.id = p_status;
    IF v_bucket IN ('done', 'archived') AND p_done IS NULL THEN
      done_at := now();
    ELSIF v_bucket = 'active' AND p_done IS NOT NULL THEN
      done_at := NULL;
    END IF;
  ELSIF NOT p_insert AND (p_done IS NULL) <> (p_old_done IS NULL) THEN
    -- Ticked or unticked: the status follows, and nothing here can refuse the tick.
    IF p_done IS NOT NULL THEN
      -- A status already finished (a bucket changed under it) stays; any other moves to the first done one.
      SELECT s.bucket INTO v_bucket FROM commerce.checklist_statuses s WHERE s.store_id = p_store AND s.id = p_status;
      IF v_bucket IS NULL OR v_bucket NOT IN ('done', 'archived') THEN
        status_id := coalesce(commerce.checklist_bucket_status(p_store, p_checklist, 'done'), p_status);
      END IF;
    ELSIF p_status IS NOT NULL THEN
      SELECT s.bucket INTO v_bucket FROM commerce.checklist_statuses s WHERE s.store_id = p_store AND s.id = p_status;
      IF v_bucket IN ('done', 'archived') THEN
        status_id := commerce.checklist_bucket_status(p_store, p_checklist, 'active');
      END IF;
    END IF;
  END IF;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.checklist_items_status_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_scope uuid;
  v_slug text;
  v_old_status uuid;
  v_old_done timestamptz;
  v_moved boolean := TG_OP = 'UPDATE' AND NEW.checklist_id IS DISTINCT FROM OLD.checklist_id;
  r record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_status := OLD.status_id;
    v_old_done := OLD.done_at;
  END IF;
  IF NEW.status_id IS NOT NULL THEN
    SELECT s.checklist_id, s.slug INTO v_scope, v_slug FROM commerce.checklist_statuses s WHERE s.store_id = NEW.store_id AND s.id = NEW.status_id;
    IF v_moved AND NEW.status_id IS NOT DISTINCT FROM OLD.status_id
       AND NOT EXISTS (SELECT 1 FROM commerce.checklist_effective_statuses(NEW.store_id, NEW.checklist_id) e WHERE e.status_id = NEW.status_id) THEN
      -- Moved to another list: the status of the same name there, else the new list's default.
      NEW.status_id := coalesce(
        (SELECT e.status_id FROM commerce.checklist_effective_statuses(NEW.store_id, NEW.checklist_id) e WHERE e.slug = v_slug LIMIT 1),
        commerce.checklist_default_status(NEW.store_id, NEW.checklist_id, NEW.done_at IS NOT NULL)
      );
      v_old_status := NEW.status_id;
      v_old_done := NEW.done_at;
    ELSIF v_scope IS NOT NULL AND v_scope <> NEW.checklist_id THEN
      RAISE EXCEPTION 'checklist_item.status_scope: the status belongs to another checklist' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT * INTO r FROM commerce.checklist_tick_and_status(NEW.store_id, NEW.checklist_id, TG_OP = 'INSERT', NEW.status_id, v_old_status, NEW.done_at, v_old_done);
  NEW.status_id := r.status_id;
  NEW.done_at := r.done_at;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER checklist_items_status_rules BEFORE INSERT OR UPDATE OF status_id, done_at, checklist_id ON commerce.checklist_items
  FOR EACH ROW EXECUTE FUNCTION commerce.checklist_items_status_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.checklist_subtasks_status_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_checklist uuid;
  v_scope uuid;
  v_old_status uuid;
  v_old_done timestamptz;
  r record;
BEGIN
  -- A subtask is a plain step until someone gives it a status (Life's subtasks start without one): then its tick and status agree.
  IF NEW.status_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT i.checklist_id INTO v_checklist FROM commerce.checklist_items i WHERE i.store_id = NEW.store_id AND i.id = NEW.item_id;
  SELECT s.checklist_id INTO v_scope FROM commerce.checklist_statuses s WHERE s.store_id = NEW.store_id AND s.id = NEW.status_id;
  IF v_scope IS NOT NULL AND v_scope IS DISTINCT FROM v_checklist THEN
    RAISE EXCEPTION 'checklist_subtask.status_scope: the status belongs to another checklist' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_old_status := OLD.status_id;
    v_old_done := OLD.done_at;
  END IF;
  SELECT * INTO r FROM commerce.checklist_tick_and_status(NEW.store_id, v_checklist, TG_OP = 'INSERT', NEW.status_id, v_old_status, NEW.done_at, v_old_done);
  NEW.status_id := r.status_id;
  NEW.done_at := r.done_at;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER checklist_subtasks_status_rules BEFORE INSERT OR UPDATE OF status_id, done_at ON commerce.checklist_subtasks
  FOR EACH ROW EXECUTE FUNCTION commerce.checklist_subtasks_status_rules();
--> statement-breakpoint

-- An item moved to a list that is not in a project loses its stage there.
CREATE FUNCTION commerce.checklist_items_moved()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  DELETE FROM commerce.project_item_stages st
   WHERE st.store_id = NEW.store_id AND st.item_id = NEW.id
     AND NOT EXISTS (
       SELECT 1 FROM commerce.project_checklists pc
        WHERE pc.store_id = NEW.store_id AND pc.project_id = st.project_id AND pc.checklist_id = NEW.checklist_id
     );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER checklist_items_moved AFTER UPDATE OF checklist_id ON commerce.checklist_items
  FOR EACH ROW WHEN (OLD.checklist_id IS DISTINCT FROM NEW.checklist_id)
  EXECUTE FUNCTION commerce.checklist_items_moved();
--> statement-breakpoint

CREATE FUNCTION commerce.project_item_stages_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_scope uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM commerce.checklist_items i
      JOIN commerce.project_checklists pc ON pc.store_id = i.store_id AND pc.checklist_id = i.checklist_id
     WHERE i.store_id = NEW.store_id AND i.id = NEW.item_id AND pc.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'project_item_stage.not_member: the item is not in a checklist of this project' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status_id IS NOT NULL THEN
    SELECT s.project_id INTO v_scope FROM commerce.project_statuses s WHERE s.store_id = NEW.store_id AND s.id = NEW.status_id;
    IF v_scope IS NOT NULL AND v_scope <> NEW.project_id THEN
      RAISE EXCEPTION 'project_item_stage.status_scope: the stage belongs to another project' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER project_item_stages_rules BEFORE INSERT OR UPDATE ON commerce.project_item_stages
  FOR EACH ROW EXECUTE FUNCTION commerce.project_item_stages_rules();
--> statement-breakpoint

-- Linking a list to a project makes it the list's home when it has none.
CREATE FUNCTION commerce.project_checklists_linked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE commerce.checklists c SET primary_project_id = NEW.project_id
   WHERE c.store_id = NEW.store_id AND c.id = NEW.checklist_id AND c.primary_project_id IS NULL;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER project_checklists_linked AFTER INSERT ON commerce.project_checklists
  FOR EACH ROW EXECUTE FUNCTION commerce.project_checklists_linked();
--> statement-breakpoint

-- Unlinking moves the home to the list's earliest other project, or clears it, and forgets its items' stages in that project.
CREATE FUNCTION commerce.project_checklists_unlinked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE commerce.checklists c
     SET primary_project_id = (
       SELECT pc.project_id FROM commerce.project_checklists pc
        WHERE pc.store_id = OLD.store_id AND pc.checklist_id = OLD.checklist_id
        ORDER BY pc.created_at, pc.project_id LIMIT 1
     )
   WHERE c.store_id = OLD.store_id AND c.id = OLD.checklist_id AND c.primary_project_id = OLD.project_id;
  DELETE FROM commerce.project_item_stages st
   USING commerce.checklist_items i
   WHERE st.store_id = OLD.store_id AND st.project_id = OLD.project_id
     AND i.store_id = st.store_id AND i.id = st.item_id AND i.checklist_id = OLD.checklist_id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER project_checklists_unlinked AFTER DELETE ON commerce.project_checklists
  FOR EACH ROW EXECUTE FUNCTION commerce.project_checklists_unlinked();
--> statement-breakpoint

-- Setting a list's home links it to that project.
CREATE FUNCTION commerce.checklists_home_linked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO commerce.project_checklists (store_id, project_id, checklist_id)
  VALUES (NEW.store_id, NEW.primary_project_id, NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER checklists_home_linked AFTER INSERT OR UPDATE OF primary_project_id ON commerce.checklists
  FOR EACH ROW WHEN (NEW.primary_project_id IS NOT NULL)
  EXECUTE FUNCTION commerce.checklists_home_linked();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.feature_needs(p_feature text) RETURNS text[]
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE p_feature
    WHEN 'shop' THEN '{}'::text[]
    WHEN 'countries' THEN '{}'::text[]
    WHEN 'languages' THEN '{}'::text[]
    WHEN 'sales' THEN '{}'::text[]
    WHEN 'projects' THEN '{}'::text[]
    WHEN 'referrals' THEN array['shop', 'bonus']
    ELSE array['shop']
  END
$$;
