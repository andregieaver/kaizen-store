-- Kaizena Flow's own integrations (D465, docs/platform-parity.md): the rules the database keeps.
--   Row-level security on both tables, as every commerce table.
--   `queue_platform_event()` queues one delivery for each connected service that chose the event, as `queue_integration_event()` does a store's.
--   Where each event happens:
--     request.received        a request for a store waiting for a platform admin (a self-serve one is news when its store is made);
--     store.created           a store of an owner, at the commit that made it (a demo store, a store template or a sandbox is flagged in
--                             that same transaction, so the row is read again then), or a sandbox kept as a store (D457);
--     store.opened            the owner opened it (`setup_completed_at` set, D339);
--     plan.started            a subscription became active or trialing that was not on a plan before;
--     plan.changed            a store on a plan moved to another plan;
--     plan.cancelled          set to end at the period's end, or ended at once without that;
--     plan.payment_failed     Stripe could not charge it (past_due or unpaid);
--     report.received         a notice of illegal content, or what screening found (D411).
--   A request's name and email are the only person's data a payload holds: when the request is blanked (retention or the account's
--   erasure), every delivery about it loses its payload and a waiting one is not sent.

ALTER TABLE "commerce"."platform_integrations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."platform_integration_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.queue_platform_event(p_event text, p_subject uuid)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO commerce.platform_integration_deliveries (provider, event, subject_id)
  SELECT i.provider, p_event, p_subject
  FROM commerce.platform_integrations i
  WHERE i.enabled AND p_event = ANY (i.events);
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.platform_request_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT NEW.self_serve THEN
    PERFORM commerce.queue_platform_event('request.received', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER platform_request_events
AFTER INSERT ON commerce.access_requests
FOR EACH ROW EXECUTE FUNCTION commerce.platform_request_events();
--> statement-breakpoint

CREATE FUNCTION commerce.platform_request_erased() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE commerce.platform_integration_deliveries
  SET payload = NULL,
      status = CASE WHEN status = 'pending' THEN 'failed' ELSE status END,
      last_error = 'Erased'
  WHERE subject_id = NEW.id AND event = 'request.received';
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER platform_request_erased
AFTER UPDATE OF email ON commerce.access_requests
FOR EACH ROW
WHEN (NEW.email LIKE 'erased-%@erased.invalid' AND OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION commerce.platform_request_erased();
--> statement-breakpoint

-- At commit: a store is made and then flagged as a demo store, a template's or a sandbox in one transaction, so NEW is not enough.
CREATE FUNCTION commerce.platform_store_created() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (OLD.sandbox AND NOT NEW.sandbox) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM commerce.stores s
    WHERE s.id = NEW.id AND NOT s.starter AND NOT s.sandbox AND NOT s.is_template
  ) THEN
    PERFORM commerce.queue_platform_event('store.created', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER platform_store_created
AFTER INSERT ON commerce.stores
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION commerce.platform_store_created();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER platform_store_kept
AFTER UPDATE OF sandbox ON commerce.stores
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD.sandbox AND NOT NEW.sandbox)
EXECUTE FUNCTION commerce.platform_store_created();
--> statement-breakpoint

CREATE FUNCTION commerce.platform_store_opened() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT NEW.starter AND NOT NEW.sandbox AND NOT NEW.is_template THEN
    PERFORM commerce.queue_platform_event('store.opened', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER platform_store_opened
AFTER UPDATE OF setup_completed_at ON commerce.stores
FOR EACH ROW
WHEN (OLD.setup_completed_at IS NULL AND NEW.setup_completed_at IS NOT NULL)
EXECUTE FUNCTION commerce.platform_store_opened();
--> statement-breakpoint

CREATE FUNCTION commerce.platform_plan_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  was_status text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END;
  was_plan uuid := CASE WHEN TG_OP = 'UPDATE' THEN OLD.plan_id END;
  was_subscription text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.subscription_id END;
  was_cancelling boolean := CASE WHEN TG_OP = 'UPDATE' THEN OLD.cancel_at_period_end ELSE false END;
  was_on boolean := coalesce(was_status IN ('active', 'trialing', 'past_due'), false);
BEGIN
  IF NEW.status IN ('active', 'trialing')
     AND (NOT was_on OR was_subscription IS DISTINCT FROM NEW.subscription_id) THEN
    PERFORM commerce.queue_platform_event('plan.started', NEW.store_id);
  ELSIF NEW.status IN ('active', 'trialing', 'past_due') AND was_on
     AND was_subscription IS NOT DISTINCT FROM NEW.subscription_id
     AND was_plan IS DISTINCT FROM NEW.plan_id THEN
    PERFORM commerce.queue_platform_event('plan.changed', NEW.store_id);
  END IF;
  IF (NEW.cancel_at_period_end AND NOT was_cancelling AND NEW.status IN ('active', 'trialing', 'past_due'))
     OR (NEW.status = 'canceled' AND was_status IS DISTINCT FROM 'canceled' AND was_on AND NOT was_cancelling) THEN
    PERFORM commerce.queue_platform_event('plan.cancelled', NEW.store_id);
  END IF;
  IF NEW.status IN ('past_due', 'unpaid') AND coalesce(was_status NOT IN ('past_due', 'unpaid'), true) THEN
    PERFORM commerce.queue_platform_event('plan.payment_failed', NEW.store_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER platform_plan_events
AFTER INSERT OR UPDATE OF status, plan_id, subscription_id, cancel_at_period_end ON commerce.store_billing
FOR EACH ROW EXECUTE FUNCTION commerce.platform_plan_events();
--> statement-breakpoint

CREATE FUNCTION commerce.platform_report_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.queue_platform_event('report.received', NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER platform_report_events
AFTER INSERT ON commerce.content_reports
FOR EACH ROW EXECUTE FUNCTION commerce.platform_report_events();
