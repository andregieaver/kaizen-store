-- Demo stores (D277, `docs/themes-content-and-demo-stores.md` section 4): a store template of kind `demo` is a live store a platform admin
-- dresses in a theme. These rules:
-- * a store template's kind is fixed once made;
-- * a demo store is published as it stands: `freeze_starter()` refuses one, so it never has a frozen copy;
-- * a demo store is never offered as a new store's content (`starter_offered_source()` leaves it out, so approving a request never copies
--   one), but `starter_source()` gives its working store while it is not archived and its store is open, published or not, so a theme's
--   content can be a copy of it (*Publish this look… → As a new theme*).
--
-- Whole functions are replaced (CREATE OR REPLACE); none is patched in place. No DELETE but the one each rule allows.

CREATE OR REPLACE FUNCTION commerce.store_starters_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM commerce.stores s WHERE s.made_from_starter = OLD.id AND s.starter_copy_of IS NULL) THEN
      RAISE EXCEPTION 'store_starters.used: stores were made from this store template; archive it instead' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM commerce.access_requests r WHERE r.starter_id = OLD.id) THEN
      RAISE EXCEPTION 'store_starters.requested: an access request chose this store template; archive it instead' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.starter AND s.starter_copy_of IS NULL)
     OR EXISTS (SELECT 1 FROM commerce.design_presets d WHERE d.workspace_store_id = NEW.store_id) THEN
    RAISE EXCEPTION 'store_starters.not_starter: only a store marked as a store template is described as one' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.published_store_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.published_store_id IS DISTINCT FROM OLD.published_store_id)
     AND NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.published_store_id AND s.starter AND s.starter_copy_of = NEW.id) THEN
    RAISE EXCEPTION 'store_starters.not_copy: a store template publishes only its own frozen copy' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.store_id IS DISTINCT FROM OLD.store_id THEN
      RAISE EXCEPTION 'store_starters.store_fixed: a store template keeps its store' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION 'store_starters.kind_fixed: a demo store stays a demo store, and starting content stays starting content' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- What a published, unarchived store template's new stores are copied from: its frozen copy, or (published before D177 and not since) its
-- working store. Null when it is not offered; a demo store (D277) is never offered.
CREATE OR REPLACE FUNCTION commerce.starter_offered_source(p_starter uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT s.id
    FROM commerce.store_starters st
    JOIN commerce.stores s ON s.id = COALESCE(st.published_store_id, st.store_id)
   WHERE st.id = p_starter AND st.kind = 'content' AND st.published AND st.archived_at IS NULL AND s.starter AND s.status = 'active'
$$;
--> statement-breakpoint

-- What a copy is made from: the template store (null), an offered store template, or a demo store as it stands (D277: its working store,
-- published or not, while it is not archived and its store is open). Anything else is refused.
CREATE OR REPLACE FUNCTION commerce.starter_source(p_starter uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_store uuid;
BEGIN
  IF p_starter IS NULL THEN
    SELECT id INTO v_store FROM commerce.stores WHERE is_template;
    IF v_store IS NULL THEN
      RAISE EXCEPTION 'there is no template store';
    END IF;
    RETURN v_store;
  END IF;
  v_store := commerce.starter_offered_source(p_starter);
  IF v_store IS NULL THEN
    SELECT s.id INTO v_store
      FROM commerce.store_starters st
      JOIN commerce.stores s ON s.id = st.store_id
     WHERE st.id = p_starter AND st.kind = 'demo' AND st.archived_at IS NULL AND s.starter AND s.status = 'active';
  END IF;
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'store_starters.not_offered: that store template is not offered' USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_store;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.freeze_starter(p_starter uuid, p_by uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_starter commerce.store_starters%ROWTYPE;
  v_work commerce.stores%ROWTYPE;
  v_n integer;
  v_slug text;
  v_copy uuid;
BEGIN
  SELECT * INTO v_starter FROM commerce.store_starters WHERE id = p_starter FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown store template %', p_starter;
  END IF;
  IF v_starter.kind = 'demo' THEN
    RAISE EXCEPTION 'store_starters.demo_live: a demo store is live as it stands and is never frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF v_starter.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'store_starters.archived: restore the store template before publishing it' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_work FROM commerce.stores WHERE id = v_starter.store_id;
  IF NOT v_work.starter OR v_work.status <> 'active' THEN
    RAISE EXCEPTION 'store_starters.not_open: the store template''s store is not open' USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) + 1 INTO v_n FROM commerce.stores WHERE starter_copy_of = p_starter;
  LOOP
    v_slug := left(v_work.slug, 30) || '-v' || v_n;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM commerce.stores WHERE slug = v_slug);
    v_n := v_n + 1;
  END LOOP;

  v_copy := commerce.clone_store(v_starter.store_id, v_slug, v_work.name, p_by);
  UPDATE commerce.stores SET starter = true, starter_copy_of = p_starter, made_from_starter = NULL WHERE id = v_copy;
  UPDATE commerce.store_starters SET published_store_id = v_copy WHERE id = p_starter;
  IF v_starter.published_store_id IS NOT NULL THEN
    UPDATE commerce.stores
       SET status = 'closed', status_reason = 'A later publish of its store template replaced this copy.', status_changed_by = p_by
     WHERE id = v_starter.published_store_id AND status <> 'closed';
  END IF;
  RETURN v_copy;
END;
$$;
