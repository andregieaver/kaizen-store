-- The event log and the missing events (ecosystem plan E3.1/E3.2, D718).
--
-- E3.1: every event the database queues is written into commerce.events by commerce.log_event(), in the same transaction, whether or not
-- anyone subscribes: queue_integration_event() (the store's services, endpoints and workflows), queue_store_event() (order rules, staff
-- alerts and push) and queue_platform_event() (Kaizena Flow's own) each call it first and then do exactly what they did. Once per
-- transaction, store, event and subject (events_once_key), as a workflow's run is: an order paid queued by both queues is one event. Ids only.
-- The log is append-only: no update, and no delete of an event younger than 90 days (EVENT_KEEP_DAYS) unless its store is gone.
--
-- E3.2: the events that were missing, each queued where its row changes: a deal made, moved, won or lost (a Pipedrive import sends none,
-- `commerce.deal_importing`); an address joining or leaving the email list (moved in from Shopify or WooCommerce: none); a support
-- conversation ended or rated (the platform's desk into the log only, through queue_platform_event()); a buyer's review published.
-- checkout.abandoned is queued by the cart reminders job, once a cart (`abandoned_checkouts.abandoned_at`); work_client.created and
-- work_invoice.* were queued already.

CREATE FUNCTION commerce.log_event(p_store uuid, p_event text, p_subject uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  INSERT INTO commerce.events (store_id, event, subject_id) VALUES (p_store, p_event, p_subject)
  ON CONFLICT ON CONSTRAINT events_once_key DO NOTHING;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.queue_integration_event(p_store uuid, p_event text, p_subject uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  SELECT commerce.log_event(p_store, p_event, p_subject);
  INSERT INTO commerce.integration_deliveries (store_id, provider, event, subject_id)
  SELECT i.store_id, i.provider, p_event, p_subject
  FROM commerce.store_integrations i
  WHERE i.store_id = p_store AND i.enabled AND p_event = ANY (i.events);
  -- A delivery not yet built carries the subject as it is when it is sent, so a second change of the same subject before then (a product
  -- saved twice, a product made and then saved in one transaction, a variant's stock moved twice within its minute) needs no delivery of
  -- its own.
  INSERT INTO commerce.integration_deliveries (store_id, provider, event, subject_id, endpoint_id, next_attempt_at)
  SELECT e.store_id, 'webhook', p_event, p_subject, e.id,
    CASE WHEN p_event = 'inventory.updated' THEN date_trunc('minute', now()) + interval '1 minute' ELSE now() END
  FROM commerce.webhook_endpoints e
  WHERE e.store_id = p_store AND e.enabled AND p_event = ANY (e.topics)
    AND NOT (p_subject IS NOT NULL AND EXISTS (
      SELECT 1 FROM commerce.integration_deliveries d
      WHERE d.endpoint_id = e.id AND d.subject_id = p_subject AND d.status = 'pending' AND d.payload IS NULL
        AND (d.event = p_event OR (p_event = 'product.updated' AND d.event = 'product.created'))
    ));
  INSERT INTO commerce.workflow_runs (store_id, workflow_id, event, subject_id, event_key, status)
  SELECT w.store_id, w.id, p_event, p_subject, p_event || ':' || coalesce(p_subject::text, '-') || ':' || txid_current()::text,
    CASE WHEN (SELECT count(*) FROM commerce.workflow_runs r WHERE r.workflow_id = w.id AND r.created_at > now() - interval '1 hour') >= 100
      THEN 'capped' ELSE 'pending' END
  FROM commerce.workflows w
  WHERE w.store_id = p_store AND w.enabled AND w.trigger = p_event
  ON CONFLICT ON CONSTRAINT workflow_runs_once_key DO NOTHING;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.queue_platform_event(p_event text, p_subject uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  SELECT commerce.log_event(NULL, p_event, p_subject);
  INSERT INTO commerce.platform_integration_deliveries (provider, event, subject_id)
  SELECT i.provider, p_event, p_subject
  FROM commerce.platform_integrations i
  WHERE i.enabled AND p_event = ANY (i.events);
  INSERT INTO commerce.platform_integration_deliveries (provider, event, subject_id, endpoint_id)
  SELECT 'webhook', p_event, p_subject, e.id
  FROM commerce.platform_webhook_endpoints e
  WHERE e.enabled AND p_event = ANY (e.topics);
  INSERT INTO commerce.platform_workflow_runs (workflow_id, event, subject_id, event_key, status)
  SELECT w.id, p_event, p_subject, p_event || ':' || coalesce(p_subject::text, '-') || ':' || txid_current()::text,
    CASE WHEN (SELECT count(*) FROM commerce.platform_workflow_runs r WHERE r.workflow_id = w.id AND r.created_at > now() - interval '1 hour') >= 100
      THEN 'capped' ELSE 'pending' END
  FROM commerce.platform_workflows w
  WHERE w.enabled AND w.trigger = p_event
  ON CONFLICT ON CONSTRAINT platform_workflow_runs_once_key DO NOTHING;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.queue_store_event(p_store uuid, p_event text, p_subject uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  SELECT commerce.log_event(p_store, p_event, p_subject);
  INSERT INTO commerce.store_events (store_id, event, subject_id)
  VALUES (p_store, p_event, p_subject)
  ON CONFLICT ON CONSTRAINT store_events_once_key DO NOTHING
$$;
--> statement-breakpoint

-- Append-only: an event is never changed, and goes only when it is older than the log keeps (EVENT_KEEP_DAYS in src/lib/event-log.ts, a
-- test holds them equal) or with its store.
CREATE FUNCTION commerce.guard_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'commerce.events is append-only; UPDATE is not allowed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.at < now() - interval '90 days' THEN
    RETURN OLD;
  END IF;
  IF OLD.store_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = OLD.store_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'commerce.events is append-only for 90 days; DELETE is not allowed' USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON commerce.events FOR EACH ROW EXECUTE FUNCTION commerce.guard_events();
--> statement-breakpoint

-- A deal (D464): made, moved to another stage, won or lost. A reopen is no event. Deals moved in from Pipedrive (D477) send none: their
-- import sets commerce.deal_importing for its transaction, as Work's import sets commerce.work_importing.
CREATE FUNCTION commerce.integration_deal_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF current_setting('commerce.deal_importing', true) IS NOT DISTINCT FROM 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'deal.created', NEW.id);
    RETURN NULL;
  END IF;
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'deal.stage_changed', NEW.id);
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'won' THEN
      PERFORM commerce.queue_integration_event(NEW.store_id, 'deal.won', NEW.id);
    ELSIF NEW.status = 'lost' THEN
      PERFORM commerce.queue_integration_event(NEW.store_id, 'deal.lost', NEW.id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER deals_integration_events AFTER INSERT OR UPDATE OF stage_id, status ON commerce.deals
  FOR EACH ROW EXECUTE FUNCTION commerce.integration_deal_events();
--> statement-breakpoint

-- The email list (D295): an address becomes subscribed (confirmed, or signed in), or a subscribed one leaves. Addresses moved in from
-- another shop (source shopify or woocommerce) are no one joining now: none.
CREATE FUNCTION commerce.integration_subscriber_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.status = 'subscribed' AND (TG_OP = 'INSERT' OR OLD.status <> 'subscribed') THEN
    IF NEW.source NOT IN ('shopify', 'woocommerce') THEN
      PERFORM commerce.queue_integration_event(NEW.store_id, 'subscriber.subscribed', NEW.id);
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'unsubscribed' AND OLD.status = 'subscribed' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'subscriber.unsubscribed', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER marketing_subscribers_integration_events AFTER INSERT OR UPDATE OF status ON commerce.marketing_subscribers
  FOR EACH ROW EXECUTE FUNCTION commerce.integration_subscriber_events();
--> statement-breakpoint

-- Support (D216): a conversation ended, or rated by its customer (again when the rating changes). A store's desk queues them for its
-- services, endpoints and workflows; Kaizena Flow's own desk (no store) for the platform's, which offer none of them yet: the log keeps them.
CREATE FUNCTION commerce.integration_conversation_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.status = 'ended' AND OLD.status IS DISTINCT FROM 'ended' THEN
    IF NEW.store_id IS NULL THEN
      PERFORM commerce.queue_platform_event('conversation.ended', NEW.id);
    ELSE
      PERFORM commerce.queue_integration_event(NEW.store_id, 'conversation.ended', NEW.id);
    END IF;
  END IF;
  IF NEW.rating IS NOT NULL AND NEW.rating IS DISTINCT FROM OLD.rating THEN
    IF NEW.store_id IS NULL THEN
      PERFORM commerce.queue_platform_event('conversation.rated', NEW.id);
    ELSE
      PERFORM commerce.queue_integration_event(NEW.store_id, 'conversation.rated', NEW.id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER support_conversations_integration_events AFTER UPDATE OF status, rating ON commerce.support_conversations
  FOR EACH ROW EXECUTE FUNCTION commerce.integration_conversation_events();
--> statement-breakpoint

-- A buyer's review (D301) published: at once when the store publishes without checking, or when staff publish it. Imported reviews send
-- none, as they send no review.created.
CREATE FUNCTION commerce.integration_review_published() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.imported_from IS NOT NULL OR NEW.status <> 'published' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RETURN NULL;
  END IF;
  PERFORM commerce.queue_integration_event(NEW.store_id, 'review.published', NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_review_published AFTER INSERT OR UPDATE OF status ON commerce.product_reviews
  FOR EACH ROW EXECUTE FUNCTION commerce.integration_review_published();
--> statement-breakpoint

-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection.
ALTER TABLE commerce.events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.event_cursors ENABLE ROW LEVEL SECURITY;
