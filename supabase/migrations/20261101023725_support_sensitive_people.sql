-- A store that handles sensitive information (PSI AST-08): its desk works as people only, whatever mode was chosen, unless support is off.
-- New conversations start with the queue and the AI's messages are refused (`support_add_message()`), so no AI reads what a customer writes.
CREATE OR REPLACE FUNCTION commerce.support_mode(p_store uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT CASE WHEN s.sensitive AND s.mode <> 'off' THEN 'people' ELSE s.mode END
     FROM commerce.support_settings s WHERE s.store_id IS NOT DISTINCT FROM p_store),
    'off');
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.support_transition(
  p_conversation uuid,
  p_event text,
  p_actor_kind text,
  p_actor uuid DEFAULT NULL,
  p_target uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_name text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  c commerce.support_conversations%ROWTYPE;
  v_mode text;
  v_open boolean;
  v_agent uuid := CASE WHEN p_actor_kind = 'agent' THEN p_actor END;
  v_assignee_acts boolean;
  v_status text;
  v_handler text;
  v_assignee uuid;
  v_lines text[];
  v_line text;
  v_name_data jsonb := CASE WHEN p_name IS NULL THEN NULL ELSE jsonb_build_object('name', p_name) END;
BEGIN
  IF p_actor_kind NOT IN ('customer', 'ai', 'system', 'agent') OR (p_actor_kind = 'agent' AND p_actor IS NULL) THEN
    RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO c FROM commerce.support_conversations sc WHERE sc.id = p_conversation FOR UPDATE;
  IF NOT FOUND OR c.anonymised_at IS NOT NULL THEN
    RAISE EXCEPTION 'support_gone' USING ERRCODE = 'check_violation';
  END IF;
  v_mode := commerce.support_mode(c.store_id);
  v_open := c.status = 'open';
  v_assignee_acts := v_agent IS NOT NULL AND c.handler = 'human' AND c.assignee_id = v_agent;

  CASE p_event
  WHEN 'handoff' THEN
    IF NOT v_open THEN RAISE EXCEPTION 'support_ended' USING ERRCODE = 'check_violation'; END IF;
    IF v_mode = 'off' THEN RAISE EXCEPTION 'support_off' USING ERRCODE = 'check_violation'; END IF;
    -- On a desk that works as people only (people, or a store that handles sensitive information, PSI AST-08), a conversation the AI
    -- held before the desk changed is still handed to a person; only a desk with the AI first starts new ones with the AI.
    IF c.handler <> 'ai' OR p_actor_kind = 'agent' THEN RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation'; END IF;
    v_status := 'open'; v_handler := 'queue'; v_assignee := NULL; v_lines := ARRAY['queued'];
  WHEN 'claim' THEN
    IF NOT v_open THEN RAISE EXCEPTION 'support_ended' USING ERRCODE = 'check_violation'; END IF;
    IF v_mode = 'off' THEN RAISE EXCEPTION 'support_off' USING ERRCODE = 'check_violation'; END IF;
    IF v_agent IS NULL THEN RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation'; END IF;
    IF c.handler = 'human' THEN
      IF c.assignee_id = v_agent THEN RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation'; END IF;
      RAISE EXCEPTION 'support_taken' USING ERRCODE = 'check_violation';
    END IF;
    v_status := 'open'; v_handler := 'human'; v_assignee := v_agent; v_lines := ARRAY['joined'];
  WHEN 'transfer' THEN
    IF NOT v_open THEN RAISE EXCEPTION 'support_ended' USING ERRCODE = 'check_violation'; END IF;
    IF v_mode = 'off' THEN RAISE EXCEPTION 'support_off' USING ERRCODE = 'check_violation'; END IF;
    IF NOT v_assignee_acts THEN
      IF c.handler = 'human' THEN RAISE EXCEPTION 'support_not_yours' USING ERRCODE = 'check_violation'; END IF;
      RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation';
    END IF;
    IF p_target = v_agent THEN RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation'; END IF;
    IF p_target IS NULL THEN
      v_status := 'open'; v_handler := 'queue'; v_assignee := NULL; v_lines := ARRAY['queued'];
    ELSE
      v_status := 'open'; v_handler := 'human'; v_assignee := p_target; v_lines := ARRAY['joined'];
    END IF;
  WHEN 'hand_back' THEN
    IF NOT v_open THEN RAISE EXCEPTION 'support_ended' USING ERRCODE = 'check_violation'; END IF;
    IF v_mode = 'off' THEN RAISE EXCEPTION 'support_off' USING ERRCODE = 'check_violation'; END IF;
    IF v_mode <> 'ai_first' THEN RAISE EXCEPTION 'support_no_ai' USING ERRCODE = 'check_violation'; END IF;
    IF c.handler = 'queue' AND p_actor_kind = 'customer' THEN
      v_lines := ARRAY['assistant_back'];
    ELSIF c.handler = 'human' AND v_assignee_acts THEN
      v_lines := ARRAY['left', 'assistant_back'];
    ELSIF c.handler = 'human' AND v_agent IS NOT NULL THEN
      RAISE EXCEPTION 'support_not_yours' USING ERRCODE = 'check_violation';
    ELSE
      RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation';
    END IF;
    v_status := 'open'; v_handler := 'ai'; v_assignee := NULL;
  WHEN 'end' THEN
    IF NOT v_open THEN RAISE EXCEPTION 'support_ended' USING ERRCODE = 'check_violation'; END IF;
    IF NOT (p_actor_kind IN ('customer', 'system') OR v_assignee_acts) THEN
      IF v_agent IS NOT NULL AND c.handler = 'human' THEN RAISE EXCEPTION 'support_not_yours' USING ERRCODE = 'check_violation'; END IF;
      RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation';
    END IF;
    v_status := 'ended'; v_handler := c.handler; v_assignee := NULL; v_lines := ARRAY['ended'];
  WHEN 'reopen' THEN
    IF v_open THEN RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation'; END IF;
    IF p_actor_kind = 'customer' THEN
      v_status := 'open'; v_handler := CASE WHEN v_mode = 'people' THEN 'queue' ELSE 'ai' END; v_assignee := NULL;
      v_lines := ARRAY['reopened'];
    ELSIF v_agent IS NOT NULL THEN
      IF v_mode = 'off' THEN RAISE EXCEPTION 'support_off' USING ERRCODE = 'check_violation'; END IF;
      v_status := 'open'; v_handler := 'human'; v_assignee := v_agent; v_lines := ARRAY['reopened', 'joined'];
    ELSE
      RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation';
  END CASE;

  PERFORM set_config('kaizen.support_transition', 'on', true);
  UPDATE commerce.support_conversations sc SET
    status = v_status,
    handler = v_handler,
    assignee_id = v_assignee,
    handoff_reason = CASE WHEN p_event = 'handoff' THEN coalesce(p_reason, p_actor_kind) ELSE sc.handoff_reason END,
    queued_at = CASE WHEN v_handler = 'queue' AND v_status = 'open' AND sc.handler <> 'queue' THEN now() ELSE sc.queued_at END,
    claimed_at = CASE WHEN v_handler = 'human' AND v_assignee IS DISTINCT FROM sc.assignee_id THEN now() ELSE sc.claimed_at END,
    waiting_alert_at = CASE WHEN v_handler = 'queue' THEN sc.waiting_alert_at ELSE NULL END,
    ended_at = CASE WHEN v_status = 'ended' THEN now() WHEN p_event = 'reopen' THEN NULL ELSE sc.ended_at END,
    ended_by = CASE
      WHEN v_status = 'ended' THEN CASE WHEN p_actor_kind <> 'system' THEN p_actor_kind WHEN p_reason = 'timeout' THEN 'timeout' ELSE 'system' END
      WHEN p_event = 'reopen' THEN NULL
      ELSE sc.ended_by END,
    summary_status = CASE
      WHEN v_status = 'ended' THEN CASE WHEN v_mode <> 'off' AND coalesce(
        (SELECT s.summaries_on FROM commerce.support_settings s WHERE s.store_id IS NOT DISTINCT FROM sc.store_id), false)
        THEN 'pending' ELSE 'skipped' END
      WHEN p_event = 'reopen' THEN 'none'
      ELSE sc.summary_status END,
    summary_tries = CASE WHEN p_event = 'reopen' THEN 0 ELSE sc.summary_tries END
  WHERE sc.id = p_conversation;
  PERFORM set_config('kaizen.support_transition', '', true);

  FOREACH v_line IN ARRAY v_lines LOOP
    PERFORM commerce.support_add_message(p_conversation, 'system', p_actor, '', v_line,
      CASE WHEN v_line IN ('joined', 'left') THEN v_name_data END);
  END LOOP;
  RETURN v_handler;
END;
$$;
