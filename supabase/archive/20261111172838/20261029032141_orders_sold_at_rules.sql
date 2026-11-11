-- When an order on payment terms counts as a sale (wave 11 unit H, D387): never before its balance is paid in full, then at that moment. Every other
-- order is dated by `placed_at` (`sold_at` stays null). Kept by the database alone, from `order_payment_terms`: an order on terms is `infinity` from the
-- moment its terms are recorded, and `paid_at` when it is set (once, by `order_payment_terms_rules()`).
CREATE OR REPLACE FUNCTION commerce.order_payment_terms_sold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    UPDATE commerce.orders SET sold_at = coalesce(NEW.paid_at, 'infinity'::timestamptz)
     WHERE store_id = NEW.store_id AND id = NEW.order_id AND sold_at IS DISTINCT FROM coalesce(NEW.paid_at, 'infinity'::timestamptz);
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER order_payment_terms_sold AFTER INSERT OR UPDATE OF paid_at ON commerce.order_payment_terms
  FOR EACH ROW EXECUTE FUNCTION commerce.order_payment_terms_sold();--> statement-breakpoint

-- The orders bought on terms before this: dated by when their balance was paid, or not yet a sale.
UPDATE commerce.orders o SET sold_at = coalesce(t.paid_at, 'infinity'::timestamptz)
  FROM commerce.order_payment_terms t
 WHERE t.store_id = o.store_id AND t.order_id = o.id AND o.sold_at IS NULL;
