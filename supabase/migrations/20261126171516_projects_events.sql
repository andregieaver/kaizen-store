-- Projects' events (D903, docs/projects.md P5.2): each queued through commerce.queue_integration_event() where its row changes, so each is
-- on the event log (E3.1), an endpoint topic, a Zapier and Make topic and a workflow trigger, offered while the account has Projects
-- (TOPIC_EXTENSIONS). Ids only on the log; the payloads are built when they are sent (src/server/integrations.ts).

-- A project: made (project.created), and its status changed (project.status_changed).
CREATE FUNCTION commerce.integration_project_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'project.created', NEW.id);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'project.status_changed', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.integration_project_events() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER projects_integration_events AFTER INSERT OR UPDATE OF status ON commerce.projects
  FOR EACH ROW EXECUTE FUNCTION commerce.integration_project_events();
--> statement-breakpoint

-- A checklist made or copied (checklist.created). A template is no work to do, so it sends none.
CREATE FUNCTION commerce.integration_checklist_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT NEW.as_template THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'checklist.created', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.integration_checklist_events() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER checklists_integration_events AFTER INSERT ON commerce.checklists
  FOR EACH ROW EXECUTE FUNCTION commerce.integration_checklist_events();
--> statement-breakpoint

-- A task: added (task.created), given a person or another person (task.assigned: taken away from everyone is none), and ticked
-- (task.done: unticked is none, and a repeating task coming back is none). A template list's tasks send none.
CREATE FUNCTION commerce.integration_task_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.checklists c WHERE c.store_id = NEW.store_id AND c.id = NEW.checklist_id AND c.as_template) THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'task.created', NEW.id);
    IF NEW.assigned_to IS NOT NULL THEN
      PERFORM commerce.queue_integration_event(NEW.store_id, 'task.assigned', NEW.id);
    END IF;
    IF NEW.done_at IS NOT NULL THEN
      PERFORM commerce.queue_integration_event(NEW.store_id, 'task.done', NEW.id);
    END IF;
    RETURN NULL;
  END IF;
  IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'task.assigned', NEW.id);
  END IF;
  IF NEW.done_at IS NOT NULL AND OLD.done_at IS NULL THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'task.done', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.integration_task_events() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER checklist_items_integration_events AFTER INSERT OR UPDATE OF assigned_to, done_at ON commerce.checklist_items
  FOR EACH ROW EXECUTE FUNCTION commerce.integration_task_events();
