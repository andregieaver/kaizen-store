ALTER TABLE "commerce"."ad_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."ad_conversions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- An order takes its cart's ad consent and ids when it is made (D303 I2), and keeps that consent as it was: the ids may only be cleared.
CREATE OR REPLACE FUNCTION commerce.orders_ad_consent() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cart_id IS NOT NULL THEN
      SELECT c.ad_consent_at, c.ad_signals INTO NEW.ad_consent_at, NEW.ad_signals
      FROM commerce.carts c WHERE c.id = NEW.cart_id AND c.store_id = NEW.store_id;
    ELSE
      NEW.ad_consent_at := NULL;
      NEW.ad_signals := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.ad_consent_at IS DISTINCT FROM OLD.ad_consent_at THEN
    RAISE EXCEPTION 'orders.ad_consent_fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.ad_signals IS DISTINCT FROM OLD.ad_signals AND NEW.ad_signals IS NOT NULL THEN
    RAISE EXCEPTION 'orders.ad_signals_fixed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_ad_consent BEFORE INSERT OR UPDATE OF ad_consent_at, ad_signals ON commerce.orders
FOR EACH ROW EXECUTE FUNCTION commerce.orders_ad_consent();
