ALTER TABLE "commerce"."support_conversations" DROP CONSTRAINT "support_conversations_source";--> statement-breakpoint
ALTER TABLE "commerce"."support_settings" ADD COLUMN "form_messages" text DEFAULT 'inbox_and_email' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD CONSTRAINT "support_conversations_source" CHECK ("commerce"."support_conversations"."source" in ('site', 'admin', 'email', 'form'));--> statement-breakpoint
ALTER TABLE "commerce"."support_settings" ADD CONSTRAINT "support_settings_form_messages" CHECK ("commerce"."support_settings"."form_messages" in ('inbox_and_email', 'inbox', 'email'));--> statement-breakpoint

-- A store's email form's message in the inbox (D382): people only. It starts in the queue whatever the desk's mode (never with the
-- AI), only on a store's desk that is on; it never goes to the AI, and its summary is never written by a model (skipped).
CREATE OR REPLACE FUNCTION commerce.support_conversations_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
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
       OR NEW.handler <> (CASE WHEN v_mode = 'people' OR NEW.source = 'form' THEN 'queue' ELSE 'ai' END)
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
  IF NEW.source = 'form' AND NEW.handler = 'ai' THEN
    RAISE EXCEPTION 'support_no_ai' USING ERRCODE = 'check_violation',
      DETAIL = 'A form''s message is answered by people only.';
  END IF;
  IF NEW.source = 'form' AND NEW.summary_status = 'pending' THEN
    NEW.summary_status := 'skipped';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
