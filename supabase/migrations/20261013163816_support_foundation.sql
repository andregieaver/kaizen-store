-- Support (D216, docs/support.md 3.2): the rules that live in the database. The tables are in the migration before this one.
--
-- * `support_add_message()` is the only writer of `support_messages` (numbered gap-free per conversation; a message from the AI
--   after a person took over is dropped, never stored; never one from the AI on a desk whose mode is `people`);
-- * `support_transition()` is the only writer of a conversation's `status`, `handler` and `assignee_id`, row for row the table of
--   `nextState()` (src/lib/support-state.ts), by the desk's mode;
-- * `support_take_partner_turn()` lets the silent partner run once per customer message;
-- * `support_ping()` tells Realtime that something changed (`{at}` only), and does nothing where there is no Realtime;
-- * the customer's foreign key empties only `customer_id` when a customer goes (Drizzle cannot say so).
--
-- No existing function is patched. Messages are deleted only by retention, in application code: no DELETE here.

ALTER TABLE commerce.support_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.support_conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.support_actions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.support_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.support_agents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.support_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.support_replies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE commerce.support_conversations DROP CONSTRAINT support_conversations_customer_fk;
--> statement-breakpoint
ALTER TABLE commerce.support_conversations ADD CONSTRAINT support_conversations_customer_fk
  FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers (store_id, id)
  ON DELETE SET NULL (customer_id);
--> statement-breakpoint

-- A desk's mode: its settings row's, else `off` (the row is made on first use).
CREATE FUNCTION commerce.support_mode(p_store uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce((SELECT s.mode FROM commerce.support_settings s WHERE s.store_id IS NOT DISTINCT FROM p_store), 'off');
$$;
--> statement-breakpoint

-- Realtime's ping: a topic and an event, the payload only the time. Nothing at all where Realtime is not installed (PGlite, CI).
CREATE FUNCTION commerce.support_ping(p_topic text, p_event text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'SELECT realtime.send($1, $2, $3, false)' USING jsonb_build_object('at', now()), p_event, p_topic;
EXCEPTION WHEN OTHERS THEN
  -- A ping is a hint: clients poll anyway. It never undoes what it was about.
  RETURN;
END;
$$;
--> statement-breakpoint

-- New conversations start open, with nobody, at the mode's first handler; settings and agents keep `updated_at` current.
CREATE FUNCTION commerce.support_conversations_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_mode text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_mode := commerce.support_mode(NEW.store_id);
    IF NEW.status <> 'open' OR NEW.assignee_id IS NOT NULL
       OR NEW.handler <> (CASE WHEN v_mode = 'people' THEN 'queue' ELSE 'ai' END)
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
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER support_conversations_rules
BEFORE INSERT OR UPDATE ON commerce.support_conversations
FOR EACH ROW EXECUTE FUNCTION commerce.support_conversations_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.support_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER support_settings_touch
BEFORE UPDATE ON commerce.support_settings
FOR EACH ROW EXECUTE FUNCTION commerce.support_touch();
--> statement-breakpoint

CREATE TRIGGER support_agents_touch
BEFORE UPDATE ON commerce.support_agents
FOR EACH ROW EXECUTE FUNCTION commerce.support_touch();
--> statement-breakpoint

CREATE TRIGGER support_replies_touch
BEFORE UPDATE ON commerce.support_replies
FOR EACH ROW EXECUTE FUNCTION commerce.support_touch();
--> statement-breakpoint

-- Messages: written only by support_add_message(), never changed afterwards.
CREATE FUNCTION commerce.support_messages_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation', DETAIL = 'A support message is never changed.';
  END IF;
  IF coalesce(current_setting('kaizen.support_writer', true), '') <> 'on' THEN
    RAISE EXCEPTION 'support_bad_event' USING ERRCODE = 'check_violation',
      DETAIL = 'Support messages are written only by commerce.support_add_message().';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER support_messages_rules
BEFORE INSERT OR UPDATE ON commerce.support_messages
FOR EACH ROW EXECUTE FUNCTION commerce.support_messages_rules();
--> statement-breakpoint

-- An action belongs to its conversation's desk.
CREATE FUNCTION commerce.support_actions_store()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  SELECT c.store_id INTO NEW.store_id FROM commerce.support_conversations c WHERE c.id = NEW.conversation_id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER support_actions_store
BEFORE INSERT OR UPDATE OF conversation_id, store_id ON commerce.support_actions
FOR EACH ROW EXECUTE FUNCTION commerce.support_actions_store();
--> statement-breakpoint

-- The only writer of support_messages (docs/support.md 3.2). Returns the message's id and number, or no row when a message from
-- the AI comes after a person took over (or the conversation ended): it is dropped and uses no number.
CREATE FUNCTION commerce.support_add_message(
  p_conversation uuid,
  p_author text,
  p_account uuid,
  p_body text,
  p_kind text DEFAULT NULL,
  p_data jsonb DEFAULT NULL,
  p_action uuid DEFAULT NULL,
  p_tools jsonb DEFAULT NULL
)
RETURNS TABLE (id uuid, seq integer)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  c commerce.support_conversations%ROWTYPE;
  v_seq integer;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM commerce.support_conversations sc WHERE sc.id = p_conversation FOR UPDATE;
  IF NOT FOUND OR c.anonymised_at IS NOT NULL THEN
    RAISE EXCEPTION 'support_gone' USING ERRCODE = 'check_violation';
  END IF;
  IF p_author = 'ai' AND (c.handler <> 'ai' OR c.status <> 'open') THEN
    RETURN;
  END IF;
  IF c.status <> 'open' AND p_author NOT IN ('system', 'note') THEN
    RAISE EXCEPTION 'support_ended' USING ERRCODE = 'check_violation';
  END IF;
  IF p_author = 'agent' AND (c.handler <> 'human' OR c.assignee_id IS DISTINCT FROM p_account) THEN
    RAISE EXCEPTION 'support_not_yours' USING ERRCODE = 'check_violation';
  END IF;
  IF p_author = 'ai' AND commerce.support_mode(c.store_id) = 'people' THEN
    RAISE EXCEPTION 'support_no_ai' USING ERRCODE = 'check_violation';
  END IF;

  v_seq := c.message_seq + 1;
  PERFORM set_config('kaizen.support_writer', 'on', true);
  UPDATE commerce.support_conversations sc SET
    message_seq = v_seq,
    last_message_at = CASE WHEN p_author IN ('note', 'partner') THEN sc.last_message_at ELSE now() END,
    last_customer_at = CASE WHEN p_author = 'customer' THEN now() ELSE sc.last_customer_at END,
    first_agent_at = CASE WHEN p_author = 'agent' THEN coalesce(sc.first_agent_at, now()) ELSE sc.first_agent_at END
  WHERE sc.id = p_conversation;
  INSERT INTO commerce.support_messages AS m (conversation_id, store_id, seq, author, account_id, body, kind, data, action_id, tools)
  VALUES (p_conversation, c.store_id, v_seq, p_author, p_account, p_body, p_kind, p_data, p_action, p_tools)
  RETURNING m.id INTO v_id;
  PERFORM set_config('kaizen.support_writer', '', true);

  id := v_id;
  seq := v_seq;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- The only writer of a conversation's status, handler and assignee (docs/support.md 4.2): `nextState()` row for row. Writes the
-- system lines, and returns the new handler. p_actor_kind: customer, ai, system or agent (with p_actor).
CREATE FUNCTION commerce.support_transition(
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
    IF v_mode <> 'ai_first' THEN RAISE EXCEPTION 'support_no_ai' USING ERRCODE = 'check_violation'; END IF;
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
--> statement-breakpoint

-- The silent partner answers each customer message once: true for the caller that takes the turn.
CREATE FUNCTION commerce.support_take_partner_turn(p_conversation uuid, p_seq integer)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_taken boolean;
BEGIN
  UPDATE commerce.support_conversations sc SET partner_seq = p_seq
  WHERE sc.id = p_conversation AND sc.partner_seq < p_seq AND NOT sc.partner_paused
    AND sc.status = 'open' AND sc.anonymised_at IS NULL AND p_seq <= sc.message_seq
  RETURNING true INTO v_taken;
  RETURN coalesce(v_taken, false);
END;
$$;
--> statement-breakpoint

-- Pings: `m` for a new message, `s` for a change of state, to the conversation's topic and its desk's.
CREATE FUNCTION commerce.support_ping_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_conversation text;
  v_desk text;
BEGIN
  SELECT c.channel_key, s.channel_key INTO v_conversation, v_desk
  FROM commerce.support_conversations c
  LEFT JOIN commerce.support_settings s ON s.store_id IS NOT DISTINCT FROM c.store_id
  WHERE c.id = NEW.conversation_id;
  IF NEW.author NOT IN ('note', 'partner') THEN
    PERFORM commerce.support_ping('sc:' || v_conversation, 'm');
  END IF;
  IF v_desk IS NOT NULL THEN
    PERFORM commerce.support_ping('sd:' || v_desk, 'm');
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER support_messages_ping
AFTER INSERT ON commerce.support_messages
FOR EACH ROW EXECUTE FUNCTION commerce.support_ping_message();
--> statement-breakpoint

CREATE FUNCTION commerce.support_ping_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_desk text;
BEGIN
  SELECT s.channel_key INTO v_desk FROM commerce.support_settings s WHERE s.store_id IS NOT DISTINCT FROM NEW.store_id;
  PERFORM commerce.support_ping('sc:' || NEW.channel_key, 's');
  IF v_desk IS NOT NULL THEN
    PERFORM commerce.support_ping('sd:' || v_desk, 's');
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER support_conversations_ping
AFTER UPDATE OF handler, status, assignee_id, tone_alert_at ON commerce.support_conversations
FOR EACH ROW
WHEN ((OLD.handler, OLD.status, OLD.assignee_id, OLD.tone_alert_at) IS DISTINCT FROM (NEW.handler, NEW.status, NEW.assignee_id, NEW.tone_alert_at))
EXECUTE FUNCTION commerce.support_ping_state();
