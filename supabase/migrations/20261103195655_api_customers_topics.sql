-- The customers' and marketing's webhook topics (wave 14 unit C3, D440), each queued where it happens, for an owner's own endpoints only.
-- customer.erased is queued by the erasure itself (`eraseSubject()`, in its transaction, with the account's id alone).
--
-- customer.updated: a customer's own details changed (name, email, phone, address, company), by them or by staff; copied history never.
CREATE FUNCTION commerce.integration_customer_change_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.copied_from IS NULL AND (NEW.email IS DISTINCT FROM OLD.email OR NEW.name IS DISTINCT FROM OLD.name OR NEW.phone IS DISTINCT FROM OLD.phone
     OR NEW.address IS DISTINCT FROM OLD.address OR NEW.company_name IS DISTINCT FROM OLD.company_name
     OR NEW.organisation_number IS DISTINCT FROM OLD.organisation_number) THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'customer.updated', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_customer_change_events
AFTER UPDATE OF email, name, phone, address, company_name, organisation_number ON commerce.customers
FOR EACH ROW EXECUTE FUNCTION commerce.integration_customer_change_events();
--> statement-breakpoint
-- subscription.renewed: a subscription's renewal order paid (not its first order); order.created, order.paid and order.cancelled as before.
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
    IF NEW.subscription_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM commerce.subscriptions s WHERE s.id = NEW.subscription_id AND s.first_order_id = NEW.id
    ) THEN
      PERFORM commerce.queue_integration_event(NEW.store_id, 'subscription.renewed', NEW.subscription_id);
    END IF;
  -- Cancelled after it was paid (an unpaid checkout that lapses is no news).
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IN ('paid', 'fulfilled') THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'order.cancelled', NEW.id);
  END IF;
  RETURN NULL;
END;
$function$;
--> statement-breakpoint
-- subscription.payment_failed: a renewal could not be charged (the subscription falls past due); started and cancelled as before.
CREATE OR REPLACE FUNCTION commerce.integration_subscription_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status = 'pending' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'subscription.started', NEW.id);
  ELSIF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'subscription.cancelled', NEW.id);
  ELSIF NEW.status = 'past_due' AND OLD.status <> 'past_due' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'subscription.payment_failed', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- gift_card.issued: a gift card or store credit made (its code is set in the same transaction; it is never sent).
CREATE FUNCTION commerce.integration_gift_card_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.queue_integration_event(NEW.store_id, 'gift_card.issued', NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_gift_card_events
AFTER INSERT ON commerce.gift_cards
FOR EACH ROW EXECUTE FUNCTION commerce.integration_gift_card_events();
--> statement-breakpoint
-- review.created: a buyer wrote a product review (D301); reviews brought in from another shop are no news.
CREATE FUNCTION commerce.integration_review_events() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.imported_from IS NULL THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'review.created', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_review_events
AFTER INSERT ON commerce.product_reviews
FOR EACH ROW EXECUTE FUNCTION commerce.integration_review_events();
