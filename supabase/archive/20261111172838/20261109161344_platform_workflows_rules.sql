-- Workflows on Kaizena Flow's own events (C4 step 3, D516): the rules the database keeps.
--   Row-level security on both tables, as every commerce table (server code only, through `db()`; no policies).
--   `queue_platform_event()` queues, as before, one delivery for each connected service (D465) and each of the platform's endpoints (D515)
--   that asks for the event and, now, one run for each platform workflow that is on and starts with it, once per event and transaction, and
--   `capped` past 100 runs of that workflow in the hour, as `queue_integration_event()` does a store's (D356).

ALTER TABLE "commerce"."platform_workflows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."platform_workflow_runs" ENABLE ROW LEVEL SECURITY;
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
  INSERT INTO commerce.platform_workflow_runs (workflow_id, event, subject_id, event_key, status)
  SELECT w.id, p_event, p_subject, p_event || ':' || coalesce(p_subject::text, '-') || ':' || txid_current()::text,
    CASE WHEN (SELECT count(*) FROM commerce.platform_workflow_runs r WHERE r.workflow_id = w.id AND r.created_at > now() - interval '1 hour') >= 100
      THEN 'capped' ELSE 'pending' END
  FROM commerce.platform_workflows w
  WHERE w.enabled AND w.trigger = p_event
  ON CONFLICT ON CONSTRAINT platform_workflow_runs_once_key DO NOTHING;
$$;
