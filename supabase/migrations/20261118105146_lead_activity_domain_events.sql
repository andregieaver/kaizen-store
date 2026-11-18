-- The lead, activity and domain-problem events ecosystem plan E3.2 left (E5.1, D757): each queued through
-- commerce.queue_integration_event() where its row changes, so each is on the event log (E3.1), an endpoint topic, an app topic in its area and
-- a workflow trigger. Ids only on the log; the payloads are built when they are sent (src/server/integrations.ts).

-- An activity (D468): added (activity.created), and done (activity.done: marked done, or added already done). Marked not done again is no
-- event, as a deal opened again is none. Activities moved in from Pipedrive (D477) send none: the import sets commerce.deal_importing for its
-- transaction, as it does for deals.
CREATE FUNCTION commerce.integration_activity_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF current_setting('commerce.deal_importing', true) IS NOT DISTINCT FROM 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'activity.created', NEW.id);
    IF NEW.done_at IS NOT NULL THEN
      PERFORM commerce.queue_integration_event(NEW.store_id, 'activity.done', NEW.id);
    END IF;
    RETURN NULL;
  END IF;
  IF NEW.done_at IS NOT NULL AND OLD.done_at IS NULL THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'activity.done', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER activities_integration_events AFTER INSERT OR UPDATE OF done_at ON commerce.activities
  FOR EACH ROW EXECUTE FUNCTION commerce.integration_activity_events();
--> statement-breakpoint

-- A lead (D475) has no row of its own: its requests are read where they are, and their own events mark its arrival. What staff decide about
-- it is kept, one row per person and store, the latest decision: dismissed (lead.dismissed) or made a deal of (lead.deal_made), each time a
-- decision is made (a new decided_at). An erasure deletes the row: no event.
CREATE FUNCTION commerce.integration_lead_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at AND NEW.decision IS NOT DISTINCT FROM OLD.decision THEN
      RETURN NULL;
    END IF;
  END IF;
  PERFORM commerce.queue_integration_event(NEW.store_id, CASE WHEN NEW.decision = 'deal' THEN 'lead.deal_made' ELSE 'lead.dismissed' END, NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER lead_decisions_integration_events AFTER INSERT OR UPDATE OF decision, deal_id, decided_at ON commerce.lead_decisions
  FOR EACH ROW EXECUTE FUNCTION commerce.integration_lead_events();
--> statement-breakpoint

-- A connected domain (E4.2, D729): the daily domain watch keeps its answer in store_domains.checks.watch (`serving`: ok, certificate,
-- elsewhere, or null when it could not tell: a time-out, a redirect, a server's error). Beside it the database keeps the last answer that
-- was known (`known`), through the answers that were not, so a domain that turns failing, or works again, is one event whatever comes
-- between.
CREATE FUNCTION commerce.store_domain_watch_known() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  answer text := NEW.checks -> 'watch' ->> 'serving';
  prior text := coalesce(OLD.checks -> 'watch' ->> 'known', OLD.checks -> 'watch' ->> 'serving');
BEGIN
  IF jsonb_typeof(NEW.checks -> 'watch') IS DISTINCT FROM 'object' THEN
    RETURN NEW;
  END IF;
  IF answer IS NOT NULL AND answer NOT IN ('ok', 'certificate', 'elsewhere') THEN
    answer := NULL;
  END IF;
  IF prior IS NOT NULL AND prior NOT IN ('ok', 'certificate', 'elsewhere') THEN
    prior := NULL;
  END IF;
  NEW.checks := jsonb_set(NEW.checks, '{watch,known}', coalesce(to_jsonb(coalesce(answer, prior)), 'null'::jsonb));
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER store_domains_watch_known BEFORE UPDATE OF checks ON commerce.store_domains
  FOR EACH ROW EXECUTE FUNCTION commerce.store_domain_watch_known();
--> statement-breakpoint

-- An active domain whose last known answer turns failing (a certificate that fails, or pointing elsewhere or at nothing) queues
-- domain.failing; one that was failing and reaches the store again queues domain.recovered. A failure of another kind is the same failure.
CREATE FUNCTION commerce.integration_domain_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  was text := coalesce(OLD.checks -> 'watch' ->> 'known', OLD.checks -> 'watch' ->> 'serving');
  now_known text := NEW.checks -> 'watch' ->> 'known';
BEGIN
  IF NEW.status <> 'active' OR now_known IS NULL THEN
    RETURN NULL;
  END IF;
  IF now_known IN ('certificate', 'elsewhere') AND (was IS NULL OR was NOT IN ('certificate', 'elsewhere')) THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'domain.failing', NEW.id);
  ELSIF now_known = 'ok' AND was IN ('certificate', 'elsewhere') THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'domain.recovered', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER store_domains_integration_events AFTER UPDATE OF checks ON commerce.store_domains
  FOR EACH ROW EXECUTE FUNCTION commerce.integration_domain_events();
