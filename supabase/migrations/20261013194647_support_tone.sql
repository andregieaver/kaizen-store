-- Support step 6 (D216, docs/support.md 2.6): a customer message's tone is recorded once, by commerce.support_record_tone() only.
-- Messages stay otherwise unchangeable: an update is refused unless that function's flag is on, the message is a customer's, its
-- tone was not set yet, and nothing but tone and tone_label changes.
CREATE OR REPLACE FUNCTION commerce.support_messages_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF coalesce(current_setting('kaizen.support_tone', true), '') = 'on'
       AND OLD.author = 'customer' AND OLD.tone IS NULL AND NEW.tone IS NOT NULL
       AND (to_jsonb(NEW) - 'tone' - 'tone_label') = (to_jsonb(OLD) - 'tone' - 'tone_label') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation', DETAIL = 'A support message is never changed (only its tone, once).';
  END IF;
  IF coalesce(current_setting('kaizen.support_writer', true), '') <> 'on' THEN
    RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation',
      DETAIL = 'Support messages are written only by commerce.support_add_message().';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Records a customer message's tone (once): true when it was recorded, false when the message is not a customer's, already has a
-- tone, or its conversation is anonymised. The conversation's rolling tone and alert are the application's (rollingTone(), toneFell()).
CREATE FUNCTION commerce.support_record_tone(p_conversation uuid, p_seq integer, p_score integer, p_label text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_done boolean;
BEGIN
  PERFORM set_config('kaizen.support_tone', 'on', true);
  UPDATE commerce.support_messages m SET tone = p_score, tone_label = p_label
  WHERE m.conversation_id = p_conversation AND m.seq = p_seq AND m.author = 'customer' AND m.tone IS NULL
    AND EXISTS (SELECT 1 FROM commerce.support_conversations c WHERE c.id = p_conversation AND c.anonymised_at IS NULL);
  v_done := FOUND;
  PERFORM set_config('kaizen.support_tone', '', true);
  RETURN v_done;
END;
$$;
