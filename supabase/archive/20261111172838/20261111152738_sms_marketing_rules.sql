-- SMS marketing (D565, docs/sms-marketing.md). Read and written only by server code over the database connection, never by the Data API.
ALTER TABLE commerce.sms_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.sms_subscribers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.sms_consent_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.sms_campaigns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.sms_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A number's consent moves as the email list's does: pending (checkout's box, its order not yet paid) -> subscribed or unsubscribed;
-- subscribed -> unsubscribed; unsubscribed -> pending or subscribed (a person who comes back gives consent again, new words, new time).
-- Every change of status writes its event in the same statement. The number, its token and its store are fixed; a subscribed number keeps
-- the consent it gave while it stays subscribed.
CREATE FUNCTION commerce.sms_subscribers_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('pending', 'subscribed') THEN
      RAISE EXCEPTION 'sms_subscribers.insert: a number starts pending or subscribed' USING ERRCODE = 'check_violation';
    END IF;
    NEW.unsubscribed_at := NULL;
    NEW.unsubscribe_source := NULL;
  ELSE
    IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.phone <> OLD.phone OR NEW.token <> OLD.token OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'sms_subscribers.fixed: the number, its token and its store are fixed' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = OLD.status AND OLD.status = 'subscribed'
       AND (NEW.consent_text <> OLD.consent_text OR NEW.consented_at <> OLD.consented_at OR NEW.source <> OLD.source
            OR NEW.source_ref IS DISTINCT FROM OLD.source_ref) THEN
      RAISE EXCEPTION 'sms_subscribers.consent: a subscribed number keeps the consent it gave' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (
      (OLD.status = 'pending' AND NEW.status IN ('pending', 'subscribed', 'unsubscribed'))
      OR (OLD.status = 'subscribed' AND NEW.status IN ('subscribed', 'unsubscribed'))
      OR (OLD.status = 'unsubscribed' AND NEW.status IN ('unsubscribed', 'pending', 'subscribed'))
    ) THEN
      RAISE EXCEPTION 'sms_subscribers.move: % cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'unsubscribed' AND OLD.status = 'unsubscribed'
       AND (NEW.unsubscribed_at IS DISTINCT FROM OLD.unsubscribed_at OR NEW.unsubscribe_source IS DISTINCT FROM OLD.unsubscribe_source) THEN
      RAISE EXCEPTION 'sms_subscribers.left: a number that left keeps when and how' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  END IF;

  IF NEW.status = 'unsubscribed' THEN
    IF NEW.unsubscribe_source IS NULL THEN
      RAISE EXCEPTION 'sms_subscribers.unsubscribed: leaving says how' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'INSERT' OR OLD.status <> 'unsubscribed' THEN
      NEW.unsubscribed_at := now();
    END IF;
  ELSE
    NEW.unsubscribed_at := NULL;
    NEW.unsubscribe_source := NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status <> OLD.status THEN
    PERFORM set_config('kaizen.sms_consent_event', 'on', true);
    INSERT INTO commerce.sms_consent_events (store_id, subscriber_id, kind, source, consent_text)
    VALUES (NEW.store_id, NEW.id, CASE NEW.status WHEN 'pending' THEN 'requested' ELSE NEW.status END,
            CASE WHEN NEW.status = 'unsubscribed' THEN NEW.unsubscribe_source ELSE NEW.source END,
            CASE WHEN NEW.status = 'unsubscribed' THEN NULL ELSE NEW.consent_text END);
    PERFORM set_config('kaizen.sms_consent_event', '', true);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sms_subscribers_rules BEFORE INSERT OR UPDATE ON commerce.sms_subscribers
  FOR EACH ROW EXECUTE FUNCTION commerce.sms_subscribers_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.sms_subscribers_first_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM set_config('kaizen.sms_consent_event', 'on', true);
  INSERT INTO commerce.sms_consent_events (store_id, subscriber_id, kind, source, consent_text)
  VALUES (NEW.store_id, NEW.id, CASE NEW.status WHEN 'pending' THEN 'requested' ELSE NEW.status END, NEW.source, NEW.consent_text);
  PERFORM set_config('kaizen.sms_consent_event', '', true);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sms_subscribers_first_event AFTER INSERT ON commerce.sms_subscribers
  FOR EACH ROW EXECUTE FUNCTION commerce.sms_subscribers_first_event();
--> statement-breakpoint

-- The history is written only by the subscribers' triggers and never changed; an event goes only with its number.
CREATE FUNCTION commerce.sms_consent_events_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting('kaizen.sms_consent_event', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'sms_consent_events.writer: the history is written by the subscribers'' rules' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'sms_consent_events.fixed: the history is never changed' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM commerce.sms_subscribers s WHERE s.store_id = OLD.store_id AND s.id = OLD.subscriber_id) THEN
    RAISE EXCEPTION 'sms_consent_events.kept: the history goes only with its number' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sms_consent_events_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.sms_consent_events
  FOR EACH ROW EXECUTE FUNCTION commerce.sms_consent_events_rules();
--> statement-breakpoint

-- Nothing is texted to a number without its consent: a message is made only for a subscribed number, and is sent (or marked sent) only while
-- the number is still subscribed. A sent message's id, cost and times are 46elks's, kept as they came.
CREATE FUNCTION commerce.sms_messages_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR (NEW.status = 'sent' AND OLD.status = 'queued'))
     AND NOT EXISTS (SELECT 1 FROM commerce.sms_subscribers s WHERE s.store_id = NEW.store_id AND s.id = NEW.subscriber_id AND s.status = 'subscribed') THEN
    RAISE EXCEPTION 'sms_messages.consent: a text goes only to a subscribed number' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.campaign_id <> OLD.campaign_id OR NEW.subscriber_id <> OLD.subscriber_id OR NEW.store_id <> OLD.store_id THEN
      RAISE EXCEPTION 'sms_messages.fixed: a message keeps its campaign and number' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('failed', 'skipped', 'delivered') AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'sms_messages.final: % is final', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sms_messages_rules BEFORE INSERT OR UPDATE ON commerce.sms_messages
  FOR EACH ROW EXECUTE FUNCTION commerce.sms_messages_rules();
