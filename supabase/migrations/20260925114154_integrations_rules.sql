-- Integrations (decision D41). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.store_integrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.integration_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- An event for every integration of the store that is on and asks for it,
-- queued in the same transaction as what happened, so none is missed.
CREATE FUNCTION commerce.queue_integration_event(p_store uuid, p_event text, p_subject uuid)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO commerce.integration_deliveries (store_id, provider, event, subject_id)
  SELECT i.store_id, i.provider, p_event, p_subject
  FROM commerce.store_integrations i
  WHERE i.store_id = p_store AND i.enabled AND p_event = ANY (i.events);
$$;
--> statement-breakpoint
CREATE FUNCTION commerce.integration_order_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Paid: at checkout (from waiting for payment), or a subscription's renewal made paid.
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status = 'pending_payment') THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'order.paid', NEW.id);
  -- Cancelled after it was paid (an unpaid checkout that lapses is no news).
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IN ('paid', 'fulfilled') THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'order.cancelled', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_order_events
AFTER INSERT OR UPDATE OF status ON commerce.orders
FOR EACH ROW EXECUTE FUNCTION commerce.integration_order_events();
--> statement-breakpoint
CREATE FUNCTION commerce.integration_shipment_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.queue_integration_event(NEW.store_id, 'order.sent', NEW.order_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_shipment_events
AFTER INSERT ON commerce.shipments
FOR EACH ROW EXECUTE FUNCTION commerce.integration_shipment_events();
--> statement-breakpoint
CREATE FUNCTION commerce.integration_refund_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'succeeded' AND (TG_OP = 'INSERT' OR OLD.status <> 'succeeded') THEN
    PERFORM commerce.queue_integration_event(
      NEW.store_id, 'order.refunded',
      (SELECT p.order_id FROM commerce.payments p WHERE p.id = NEW.payment_id)
    );
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_refund_events
AFTER INSERT OR UPDATE OF status ON commerce.refunds
FOR EACH ROW EXECUTE FUNCTION commerce.integration_refund_events();
--> statement-breakpoint
CREATE FUNCTION commerce.integration_customer_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.queue_integration_event(NEW.store_id, 'customer.created', NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_customer_events
AFTER INSERT ON commerce.customers
FOR EACH ROW EXECUTE FUNCTION commerce.integration_customer_events();
--> statement-breakpoint
CREATE FUNCTION commerce.integration_subscription_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status = 'pending' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'subscription.started', NEW.id);
  ELSIF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'subscription.cancelled', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_subscription_events
AFTER UPDATE OF status ON commerce.subscriptions
FOR EACH ROW EXECUTE FUNCTION commerce.integration_subscription_events();
--> statement-breakpoint
-- Every minute Supabase's scheduler asks Kaizen to send what is due (with
-- the same Vault bearer token as the other jobs). Not where the extensions
-- are missing, such as in tests.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    PERFORM cron.schedule(
      'kaizen-integrations',
      '* * * * *',
      $job$
        SELECT net.http_post(
          url := 'https://kaizenstore.cloud/api/cron/integrations',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'kaizen_cron_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 30000
        );
      $job$
    );
  END IF;
END
$do$;
