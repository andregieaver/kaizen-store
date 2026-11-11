-- The orders' webhook topics (wave 14 unit C2, D440), each queued where it happens, for an owner's own endpoints only. Copied history (D129)
-- is never news.
--
-- order.created: an order made (paid or waiting for payment); order.paid and order.cancelled as before.
CREATE OR REPLACE FUNCTION commerce.integration_order_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.copied_from IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'order.created', NEW.id);
  END IF;
  -- Paid: at checkout (from waiting for payment), or a subscription's renewal made paid.
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IN ('pending_payment', 'authorized')) THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'order.paid', NEW.id);
  -- Cancelled after it was paid (an unpaid checkout that lapses is no news).
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IN ('paid', 'fulfilled') THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'order.cancelled', NEW.id);
  END IF;
  RETURN NULL;
END;
$function$;
--> statement-breakpoint
-- order.updated: a change of the order's lines or prices applied (D174), which sets its `edited_at`.
CREATE FUNCTION commerce.integration_order_edit_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.copied_from IS NULL AND NEW.edited_at IS DISTINCT FROM OLD.edited_at THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'order.updated', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_order_edit_events
AFTER UPDATE OF edited_at ON commerce.orders
FOR EACH ROW EXECUTE FUNCTION commerce.integration_order_edit_events();
--> statement-breakpoint
-- A parcel recorded: order.sent (about the order, as before) and fulfilment.created (about the parcel).
CREATE OR REPLACE FUNCTION commerce.integration_shipment_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'order.sent', NEW.order_id);
    PERFORM commerce.queue_integration_event(NEW.store_id, 'fulfilment.created', NEW.id);
  ELSIF NEW.tracking_number IS DISTINCT FROM OLD.tracking_number OR NEW.tracking_url IS DISTINCT FROM OLD.tracking_url
     OR NEW.carrier IS DISTINCT FROM OLD.carrier OR NEW.undone_at IS DISTINCT FROM OLD.undone_at THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'fulfilment.updated', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_shipment_changes
AFTER UPDATE OF tracking_number, tracking_url, carrier, undone_at ON commerce.shipments
FOR EACH ROW EXECUTE FUNCTION commerce.integration_shipment_events();
--> statement-breakpoint
-- fulfilment.updated: the carrier's tracking of a parcel moved on (D238), or it was delivered.
CREATE FUNCTION commerce.integration_tracking_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.phase IS DISTINCT FROM OLD.phase OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'fulfilment.updated', NEW.shipment_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_tracking_events
AFTER INSERT OR UPDATE OF phase, delivered_at ON commerce.shipment_tracking
FOR EACH ROW EXECUTE FUNCTION commerce.integration_tracking_events();
--> statement-breakpoint
-- A refund that went through: order.refunded (about the order, as before) and refund.created (about the refund), money back to the payment
-- or store credit (D364); the bookkeeping kinds (an authorisation released, terms voided, an exchange's transfer) are no refund to a customer.
CREATE OR REPLACE FUNCTION commerce.integration_refund_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'succeeded' AND (TG_OP = 'INSERT' OR OLD.status <> 'succeeded') THEN
    PERFORM commerce.queue_integration_event(
      NEW.store_id, 'order.refunded',
      (SELECT p.order_id FROM commerce.payments p WHERE p.id = NEW.payment_id)
    );
    IF NEW.kind IN ('money', 'store_credit') THEN
      PERFORM commerce.queue_integration_event(NEW.store_id, 'refund.created', NEW.id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- return.updated: a return moved to another state (return.requested stays its first).
CREATE OR REPLACE FUNCTION commerce.integration_return_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'return.requested', NEW.id);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'return.updated', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_return_changes
AFTER UPDATE OF status ON commerce.returns
FOR EACH ROW EXECUTE FUNCTION commerce.integration_return_events();
--> statement-breakpoint
-- quote.requested: a shopper's request for a quote (D431); draft.sent: a draft or quote sent with its pay link (D173).
CREATE FUNCTION commerce.integration_draft_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.source = 'quote' THEN
      PERFORM commerce.queue_integration_event(NEW.store_id, 'quote.requested', NEW.id);
    END IF;
  ELSIF NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'draft.sent', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_draft_events
AFTER INSERT OR UPDATE OF status ON commerce.draft_orders
FOR EACH ROW EXECUTE FUNCTION commerce.integration_draft_events();
