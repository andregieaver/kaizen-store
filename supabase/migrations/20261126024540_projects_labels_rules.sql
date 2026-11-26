-- Labels and comments of checklist tasks (D903 P4.6, P4.4): the rules the database keeps.
--   A task's category is one of the store's labels of the kind `category`, cleared when the label is deleted; a task's tags are labels of
--   the kind `tag`. The kind is held here, so the AI manager and the API get the rule as the screens do.

ALTER TABLE commerce.checklist_items ADD CONSTRAINT checklist_items_category_fk
  FOREIGN KEY (store_id, category_id) REFERENCES commerce.project_labels (store_id, id)
  ON DELETE SET NULL (category_id);
--> statement-breakpoint

CREATE FUNCTION commerce.checklist_label_kind(p_store uuid, p_label uuid, p_kind text, p_rule text)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF p_label IS NOT NULL AND NOT EXISTS (SELECT 1 FROM commerce.project_labels l WHERE l.store_id = p_store AND l.id = p_label AND l.kind = p_kind) THEN
    RAISE EXCEPTION '%: the label is not a %', p_rule, p_kind USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.checklist_items_category_kind()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.checklist_label_kind(NEW.store_id, NEW.category_id, 'category', 'checklist_item.category_kind');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER checklist_items_category_kind BEFORE INSERT OR UPDATE OF category_id ON commerce.checklist_items
  FOR EACH ROW WHEN (NEW.category_id IS NOT NULL) EXECUTE FUNCTION commerce.checklist_items_category_kind();
--> statement-breakpoint

CREATE FUNCTION commerce.checklist_item_tags_kind()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.checklist_label_kind(NEW.store_id, NEW.label_id, 'tag', 'checklist_item.tag_kind');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER checklist_item_tags_kind BEFORE INSERT OR UPDATE OF label_id ON commerce.checklist_item_tags
  FOR EACH ROW EXECUTE FUNCTION commerce.checklist_item_tags_kind();
--> statement-breakpoint

-- A label's kind never changes under the tasks that use it.
CREATE FUNCTION commerce.project_labels_kind_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'checklist_item.label_kind_fixed: a label stays a %', OLD.kind USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER project_labels_kind_fixed BEFORE UPDATE OF kind ON commerce.project_labels
  FOR EACH ROW WHEN (NEW.kind IS DISTINCT FROM OLD.kind) EXECUTE FUNCTION commerce.project_labels_kind_fixed();
