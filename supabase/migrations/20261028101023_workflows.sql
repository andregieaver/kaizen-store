CREATE TABLE "commerce"."workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"event" text NOT NULL,
	"subject_id" uuid,
	"event_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"matched" boolean,
	"outcome" jsonb,
	"claimed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "workflow_runs_once_key" UNIQUE("workflow_id","event_key"),
	CONSTRAINT "workflow_runs_status" CHECK ("commerce"."workflow_runs"."status" in ('pending', 'done', 'failed', 'capped'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"schedule" jsonb,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"tested_version" integer,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "workflows_name" CHECK (char_length("commerce"."workflows"."name") between 1 and 80),
	CONSTRAINT "workflows_trigger" CHECK ("commerce"."workflows"."trigger" in ('order.paid', 'order.sent', 'order.cancelled', 'order.refunded', 'customer.created', 'subscription.started', 'subscription.cancelled', 'return.requested', 'withdrawal.received', 'product.created', 'product.updated', 'stock.low', 'discount.created', 'support.waiting', 'schedule')),
	CONSTRAINT "workflows_on_when_tested" CHECK (not "commerce"."workflows"."enabled" or "commerce"."workflows"."tested_version" = "commerce"."workflows"."version")
);
--> statement-breakpoint
ALTER TABLE "commerce"."workflow_runs" ADD CONSTRAINT "workflow_runs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "commerce"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."workflows" ADD CONSTRAINT "workflows_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."workflows" ADD CONSTRAINT "workflows_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."workflows" ADD CONSTRAINT "workflows_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_runs_due_idx" ON "commerce"."workflow_runs" USING btree ("created_at") WHERE "commerce"."workflow_runs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "workflow_runs_workflow_idx" ON "commerce"."workflow_runs" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_store_idx" ON "commerce"."workflow_runs" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "workflows_store_trigger_idx" ON "commerce"."workflows" USING btree ("store_id","trigger") WHERE "commerce"."workflows"."enabled";--> statement-breakpoint
CREATE INDEX "workflows_created_by_idx" ON "commerce"."workflows" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "workflows_updated_by_idx" ON "commerce"."workflows" USING btree ("updated_by");--> statement-breakpoint
-- Reached only through server code (D356).
ALTER TABLE "commerce"."workflows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."workflow_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Every event also starts the store's workflows that are on and wait for it (D356): one run per workflow and event, keyed by the event, its
-- subject and the transaction it happened in (two saves of one product in one transaction are one event). A workflow that ran
-- RUNS_PER_HOUR (100) times in the last hour is recorded as capped and does nothing.
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
  -- saved twice, a product made and then saved in one transaction) needs no delivery of its own.
  INSERT INTO commerce.integration_deliveries (store_id, provider, event, subject_id, endpoint_id)
  SELECT e.store_id, 'webhook', p_event, p_subject, e.id
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
