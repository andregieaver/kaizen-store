ALTER TABLE "commerce"."payments" ADD COLUMN "test_mode" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- A venue payment's Stripe mode is frozen with the payment (D159): invoice_eligibility() reads it, so an order confirmed for the venue while
-- the store's Stripe was in test mode never gets a legal invoice number, whatever mode the store is in when the invoice job looks at it later.
CREATE OR REPLACE FUNCTION commerce.payments_venue_mode() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.provider = 'venue' THEN
    NEW.test_mode := EXISTS (
      SELECT 1 FROM commerce.payment_providers pp WHERE pp.store_id = NEW.store_id AND pp.provider = 'stripe' AND pp.active_mode = 'test');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payments_venue_mode BEFORE INSERT ON commerce.payments
  FOR EACH ROW EXECUTE FUNCTION commerce.payments_venue_mode();
--> statement-breakpoint
-- The venue payments that exist now take the mode their store is in now (the best that is known; no store has an invoice for them yet).
UPDATE commerce.payments p SET test_mode = true
 WHERE p.provider = 'venue'
   AND EXISTS (SELECT 1 FROM commerce.payment_providers pp WHERE pp.store_id = p.store_id AND pp.provider = 'stripe' AND pp.active_mode = 'test');
