-- A reminder before a task's due time (D903, docs/projects.md P4.3) comes so many minutes before it: armed when it is made or its offset
-- changes, armed again whenever the task's due time moves (sent before or not), and cleared when the task has no due time. Reminders at a
-- moment or by a rule are armed by the code that writes them, and moved on by the five-minute job.
CREATE FUNCTION commerce.checklist_reminders_next()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.offset_minutes IS NOT NULL THEN
    SELECT i.due_at - make_interval(mins => NEW.offset_minutes) INTO NEW.next_at
      FROM commerce.checklist_items i
     WHERE i.store_id = NEW.store_id AND i.id = NEW.item_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.checklist_reminders_next() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER checklist_reminders_next BEFORE INSERT OR UPDATE OF offset_minutes ON commerce.checklist_reminders
  FOR EACH ROW EXECUTE FUNCTION commerce.checklist_reminders_next();
--> statement-breakpoint

CREATE FUNCTION commerce.checklist_items_rearm_reminders()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE commerce.checklist_reminders r
     SET next_at = NEW.due_at - make_interval(mins => r.offset_minutes), fired_at = NULL
   WHERE r.store_id = NEW.store_id AND r.item_id = NEW.id AND r.offset_minutes IS NOT NULL;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.checklist_items_rearm_reminders() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER checklist_items_rearm_reminders AFTER UPDATE OF due_at ON commerce.checklist_items
  FOR EACH ROW WHEN (NEW.due_at IS DISTINCT FROM OLD.due_at) EXECUTE FUNCTION commerce.checklist_items_rearm_reminders();
