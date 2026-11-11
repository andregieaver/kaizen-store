-- Kaizena Flow's own endpoints (C4, D515): the rules the database keeps.
--   Row-level security on the endpoints, as every commerce table (server code only, through `db()`; no policies).
--   `queue_platform_event()` queues one delivery for each connected service that chose the event (D465) and, now, one for each of the
--   platform's own endpoints that is on and asks for it, as `queue_integration_event()` does a store's (D354).

ALTER TABLE "commerce"."platform_webhook_endpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.queue_platform_event(p_event text, p_subject uuid)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO commerce.platform_integration_deliveries (provider, event, subject_id)
  SELECT i.provider, p_event, p_subject
  FROM commerce.platform_integrations i
  WHERE i.enabled AND p_event = ANY (i.events);
  INSERT INTO commerce.platform_integration_deliveries (provider, event, subject_id, endpoint_id)
  SELECT 'webhook', p_event, p_subject, e.id
  FROM commerce.platform_webhook_endpoints e
  WHERE e.enabled AND p_event = ANY (e.topics);
$$;
