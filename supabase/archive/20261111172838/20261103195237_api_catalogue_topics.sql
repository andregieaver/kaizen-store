-- The catalogue's webhook topics (wave 14 unit C1, D440): `inventory.updated` (a variant's stock moved, coalesced per variant and minute)
-- and `product.archived`. Both go to an owner's own endpoints only.
--
-- `inventory.updated` waits until the next whole minute before it is built and sent: a delivery not yet built already carries the subject as
-- it is when it is sent, so every later change of the variant's stock within that minute needs no delivery of its own (one per endpoint,
-- variant and minute). Everything else is queued as before.
CREATE OR REPLACE FUNCTION commerce.queue_integration_event(p_store uuid, p_event text, p_subject uuid)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
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
-- A product made, saved, and now also put away (archived): `product.archived` as its status becomes archived.
CREATE OR REPLACE FUNCTION commerce.integration_product_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'product.created', NEW.id);
  ELSIF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'product.updated', NEW.id);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'product.archived', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- A variant's stock at a location made or moved (on hand): `inventory.updated`, about the variant.
CREATE FUNCTION commerce.integration_inventory_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.on_hand IS DISTINCT FROM OLD.on_hand THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'inventory.updated', NEW.variant_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_inventory_events
AFTER INSERT OR UPDATE OF on_hand ON commerce.inventory_levels
FOR EACH ROW EXECUTE FUNCTION commerce.integration_inventory_events();
