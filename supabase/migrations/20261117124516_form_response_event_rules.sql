-- A form's response as an event (D705 F5, `docs/forms.md` 7): a store's response, kept when a message is sent or a sign-up confirmed, is
-- queued for the store's own endpoints, apps and workflows that chose `form.response`, as a review's is. Kaizena Flow's own forms (no
-- store) have no events. The payload is built when it is sent (`formResponseData()`); a response deleted by then sends nothing.

CREATE OR REPLACE FUNCTION commerce.integration_form_response_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.store_id IS NOT NULL THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'form.response', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS form_responses_integration_events ON commerce.form_responses;
--> statement-breakpoint
CREATE TRIGGER form_responses_integration_events AFTER INSERT ON commerce.form_responses
  FOR EACH ROW EXECUTE FUNCTION commerce.integration_form_response_events();
