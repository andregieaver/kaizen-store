ALTER TABLE "commerce"."support_settings" ADD COLUMN "form_ai" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- D797 (100-day B2): a form's message may start with the AI while the desk works AI first (the code decides by support_settings.form_ai,
-- or the challenge); it still never goes to the AI later, from a person or the queue. Otherwise as before (D382).
CREATE OR REPLACE FUNCTION commerce.support_conversations_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_mode text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_mode := commerce.support_mode(NEW.store_id);
    IF NEW.source = 'form' AND (NEW.store_id IS NULL OR v_mode = 'off') THEN
      RAISE EXCEPTION 'support_off' USING ERRCODE = 'check_violation',
        DETAIL = 'A form''s message reaches the inbox only of a store''s desk that is on.';
    END IF;
    IF NEW.status <> 'open' OR NEW.assignee_id IS NOT NULL
       OR NOT (
         NEW.handler = (CASE WHEN v_mode = 'people' OR NEW.source = 'form' THEN 'queue' ELSE 'ai' END)
         OR (NEW.source = 'form' AND v_mode = 'ai_first' AND NEW.handler = 'ai')
       )
       OR NEW.message_seq <> 0 THEN
      RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation',
        DETAIL = 'A conversation starts open, with nobody, at its desk''s first handler.';
    END IF;
    IF NEW.handler = 'queue' THEN
      NEW.queued_at := coalesce(NEW.queued_at, now());
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.status, NEW.handler, NEW.assignee_id) IS DISTINCT FROM (OLD.status, OLD.handler, OLD.assignee_id)
     AND coalesce(current_setting('kaizen.support_transition', true), '') <> 'on' THEN
    RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation',
      DETAIL = 'A conversation''s state changes only through commerce.support_transition().';
  END IF;
  IF NEW.message_seq <> OLD.message_seq AND coalesce(current_setting('kaizen.support_writer', true), '') <> 'on' THEN
    RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation',
      DETAIL = 'Messages are numbered only by commerce.support_add_message().';
  END IF;
  IF NEW.source = 'form' AND NEW.handler = 'ai' AND OLD.handler <> 'ai' THEN
    RAISE EXCEPTION 'support_no_ai' USING ERRCODE = 'check_violation',
      DETAIL = 'A form''s message goes to the AI only from its start.';
  END IF;
  IF NEW.source = 'form' AND NEW.summary_status = 'pending' THEN
    NEW.summary_status := 'skipped';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
