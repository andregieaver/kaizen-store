-- The subscriber list (wave 5 unit A, D295, docs/wave-5-marketing.md 3.1). Read and written only by server code over the database connection,
-- never by the Data API.
ALTER TABLE commerce.marketing_subscribers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.marketing_consent_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A subscriber's state moves only as `mayMove()` in src/lib/marketing-consent.ts says: pending -> subscribed, unsubscribed or pending again (a new
-- request), subscribed -> unsubscribed, unsubscribed -> pending or subscribed (a person who comes back gives consent again). Every change of
-- status writes its event into the history in the same statement, so no writer changes one silently. The address, its token and its store are
-- fixed; the consent of a subscribed address is fixed while it stays subscribed; a customer, once linked, stays the same customer.
CREATE FUNCTION commerce.marketing_subscribers_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_kind text;
  v_source text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('pending', 'subscribed') THEN
      RAISE EXCEPTION 'marketing_subscribers.insert: a subscriber starts pending or subscribed' USING ERRCODE = 'check_violation';
    END IF;
    NEW.unsubscribed_at := NULL;
    NEW.unsubscribe_source := NULL;
  ELSE
    IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.email <> OLD.email OR NEW.token <> OLD.token OR NEW.created_at <> OLD.created_at
       OR (OLD.customer_id IS NOT NULL AND NEW.customer_id IS DISTINCT FROM OLD.customer_id) THEN
      RAISE EXCEPTION 'marketing_subscribers.fixed: the address, its token, its store and its customer are fixed' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = OLD.status AND OLD.status = 'subscribed'
       AND (NEW.consent_text <> OLD.consent_text OR NEW.consented_at <> OLD.consented_at OR NEW.source <> OLD.source
            OR NEW.source_ref IS DISTINCT FROM OLD.source_ref OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN
      RAISE EXCEPTION 'marketing_subscribers.consent: a subscribed address keeps the consent it gave' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (
      (OLD.status = 'pending' AND NEW.status IN ('pending', 'subscribed', 'unsubscribed'))
      OR (OLD.status = 'subscribed' AND NEW.status IN ('subscribed', 'unsubscribed'))
      OR (OLD.status = 'unsubscribed' AND NEW.status IN ('unsubscribed', 'pending', 'subscribed'))
    ) THEN
      RAISE EXCEPTION 'marketing_subscribers.move: % cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'unsubscribed' AND OLD.status = 'unsubscribed'
       AND (NEW.unsubscribed_at IS DISTINCT FROM OLD.unsubscribed_at OR NEW.unsubscribe_source IS DISTINCT FROM OLD.unsubscribe_source) THEN
      RAISE EXCEPTION 'marketing_subscribers.left: an address that left keeps when and how' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status = 'pending' THEN
    IF NEW.confirm_hash IS NULL OR NEW.confirm_until IS NULL THEN
      RAISE EXCEPTION 'marketing_subscribers.pending: a waiting address has a confirmation link' USING ERRCODE = 'check_violation';
    END IF;
    NEW.unsubscribed_at := NULL;
    NEW.unsubscribe_source := NULL;
  ELSIF NEW.status = 'subscribed' THEN
    NEW.confirm_hash := NULL;
    NEW.confirm_until := NULL;
    NEW.unsubscribed_at := NULL;
    NEW.unsubscribe_source := NULL;
  ELSE
    IF NEW.unsubscribe_source IS NULL THEN
      RAISE EXCEPTION 'marketing_subscribers.unsubscribed: leaving says how' USING ERRCODE = 'check_violation';
    END IF;
    NEW.confirm_hash := NULL;
    NEW.confirm_until := NULL;
    IF TG_OP = 'INSERT' OR OLD.status <> 'unsubscribed' THEN
      NEW.unsubscribed_at := now();
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;

  -- The history: a new request (a new link), a subscription, or leaving.
  IF TG_OP = 'INSERT' OR NEW.status <> OLD.status OR (NEW.status = 'pending' AND NEW.confirm_hash IS DISTINCT FROM OLD.confirm_hash) THEN
    v_kind := CASE NEW.status WHEN 'pending' THEN 'requested' ELSE NEW.status END;
    v_source := CASE WHEN NEW.status = 'unsubscribed' THEN NEW.unsubscribe_source ELSE NEW.source END;
    PERFORM set_config('kaizen.consent_event', 'on', true);
    -- For an update the row exists, so the event is written here; a new row's first event is written after its insert.
    IF TG_OP = 'UPDATE' THEN
      INSERT INTO commerce.marketing_consent_events (store_id, subscriber_id, kind, source, consent_text)
      VALUES (NEW.store_id, NEW.id, v_kind, v_source, CASE WHEN NEW.status = 'unsubscribed' THEN NULL ELSE NEW.consent_text END);
    END IF;
    PERFORM set_config('kaizen.consent_event', '', true);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER marketing_subscribers_rules BEFORE INSERT OR UPDATE ON commerce.marketing_subscribers
  FOR EACH ROW EXECUTE FUNCTION commerce.marketing_subscribers_rules();
--> statement-breakpoint

-- A new subscriber's first event, once its row exists.
CREATE FUNCTION commerce.marketing_subscribers_first_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM set_config('kaizen.consent_event', 'on', true);
  INSERT INTO commerce.marketing_consent_events (store_id, subscriber_id, kind, source, consent_text)
  VALUES (NEW.store_id, NEW.id, CASE NEW.status WHEN 'pending' THEN 'requested' ELSE NEW.status END, NEW.source, NEW.consent_text);
  PERFORM set_config('kaizen.consent_event', '', true);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER marketing_subscribers_first_event AFTER INSERT ON commerce.marketing_subscribers
  FOR EACH ROW EXECUTE FUNCTION commerce.marketing_subscribers_first_event();
--> statement-breakpoint

-- The history is written only by the subscribers' triggers and never changed; an event goes only with its subscriber (its row deleted first, by an
-- erasure or the pruning of a sign-up whose link ran out).
CREATE FUNCTION commerce.marketing_consent_events_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting('kaizen.consent_event', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'marketing_consent_events.writer: the history is written by the subscribers'' rules' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'marketing_consent_events.fixed: the history is never changed' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM commerce.marketing_subscribers s WHERE s.store_id = OLD.store_id AND s.id = OLD.subscriber_id) THEN
    RAISE EXCEPTION 'marketing_consent_events.kept: the history goes only with its subscriber' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER marketing_consent_events_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.marketing_consent_events
  FOR EACH ROW EXECUTE FUNCTION commerce.marketing_consent_events_rules();
