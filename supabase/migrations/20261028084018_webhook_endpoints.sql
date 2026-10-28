CREATE TABLE "commerce"."webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url_encrypted" text NOT NULL,
	"hint" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"topics" text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"failing_since" timestamp with time zone,
	"disabled_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoints_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "webhook_endpoints_name" CHECK (char_length("commerce"."webhook_endpoints"."name") between 1 and 80),
	CONSTRAINT "webhook_endpoints_topics" CHECK (cardinality("commerce"."webhook_endpoints"."topics") between 1 and 40),
	CONSTRAINT "webhook_endpoints_reason" CHECK ("commerce"."webhook_endpoints"."disabled_reason" is null or "commerce"."webhook_endpoints"."disabled_reason" in ('failing', 'owner'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."integration_deliveries" ADD COLUMN "endpoint_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_endpoints_store_idx" ON "commerce"."webhook_endpoints" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_created_by_idx" ON "commerce"."webhook_endpoints" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "commerce"."integration_deliveries" ADD CONSTRAINT "integration_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "commerce"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_deliveries_endpoint_idx" ON "commerce"."integration_deliveries" USING btree ("endpoint_id","created_at");--> statement-breakpoint
ALTER TABLE "commerce"."integration_deliveries" ADD CONSTRAINT "integration_deliveries_endpoint" CHECK (("commerce"."integration_deliveries"."provider" = 'webhook') = ("commerce"."integration_deliveries"."endpoint_id" is not null));--> statement-breakpoint
-- Reached only through server code (D354).
ALTER TABLE "commerce"."webhook_endpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Every event also goes to each of the store's own endpoints that is on and asks for it (D354), queued in the same transaction.
CREATE OR REPLACE FUNCTION commerce.queue_integration_event(p_store uuid, p_event text, p_subject uuid)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO commerce.integration_deliveries (store_id, provider, event, subject_id)
  SELECT i.store_id, i.provider, p_event, p_subject
  FROM commerce.store_integrations i
  WHERE i.store_id = p_store AND i.enabled AND p_event = ANY (i.events);
  -- A delivery not yet built carries the subject as it is when it is sent, so a second change before then (a product saved twice, a
  -- product made and then saved in one transaction) needs no delivery of its own.
  INSERT INTO commerce.integration_deliveries (store_id, provider, event, subject_id, endpoint_id)
  SELECT e.store_id, 'webhook', p_event, p_subject, e.id
  FROM commerce.webhook_endpoints e
  WHERE e.store_id = p_store AND e.enabled AND p_event = ANY (e.topics)
    AND NOT (p_subject IS NOT NULL AND EXISTS (
      SELECT 1 FROM commerce.integration_deliveries d
      WHERE d.endpoint_id = e.id AND d.subject_id = p_subject AND d.status = 'pending' AND d.payload IS NULL
        AND (d.event = p_event OR (p_event = 'product.updated' AND d.event = 'product.created'))
    ));
$$;
--> statement-breakpoint
-- The topics of D354, each queued where it happens.
CREATE FUNCTION commerce.integration_return_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.queue_integration_event(NEW.store_id, 'return.requested', NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_return_events
AFTER INSERT ON commerce.returns
FOR EACH ROW EXECUTE FUNCTION commerce.integration_return_events();
--> statement-breakpoint
CREATE FUNCTION commerce.integration_withdrawal_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.confirmed_at IS NOT NULL AND OLD.confirmed_at IS NULL THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'withdrawal.received', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_withdrawal_events
AFTER UPDATE OF confirmed_at ON commerce.withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION commerce.integration_withdrawal_events();
--> statement-breakpoint
CREATE FUNCTION commerce.integration_product_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'product.created', NEW.id);
  ELSIF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'product.updated', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_product_events
AFTER INSERT OR UPDATE ON commerce.products
FOR EACH ROW EXECUTE FUNCTION commerce.integration_product_events();
--> statement-breakpoint
CREATE FUNCTION commerce.integration_stock_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.state = 'low' AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM 'low') THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'stock.low', NEW.variant_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_stock_events
AFTER INSERT OR UPDATE OF state ON commerce.stock_alerts
FOR EACH ROW EXECUTE FUNCTION commerce.integration_stock_events();
--> statement-breakpoint
CREATE FUNCTION commerce.integration_discount_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.queue_integration_event(NEW.store_id, 'discount.created', NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_discount_events
AFTER INSERT ON commerce.discount_codes
FOR EACH ROW EXECUTE FUNCTION commerce.integration_discount_events();
