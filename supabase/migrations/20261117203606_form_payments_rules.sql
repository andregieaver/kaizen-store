-- Payments in a form (D738 F6c, docs/forms.md 15.3): a store's form names a product variant its visitors pay for through the store's own
-- checkout, and a response that went on to pay remembers its cart.

-- A form pays only for a variant of its own store (no foreign key: product_variants is a hot table). A variant deleted later leaves the
-- id behind, which the code reads as no payment.
CREATE FUNCTION commerce.forms_payment_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.payment_variant_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.payment_variant_id IS DISTINCT FROM OLD.payment_variant_id)
     AND NOT EXISTS (SELECT 1 FROM commerce.product_variants v WHERE v.id = NEW.payment_variant_id AND v.store_id = NEW.store_id) THEN
    RAISE EXCEPTION 'forms.payment: a form pays only for a product of its own store' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER forms_payment_rules BEFORE INSERT OR UPDATE OF payment_variant_id ON commerce.forms FOR EACH ROW EXECUTE FUNCTION commerce.forms_payment_rules();
--> statement-breakpoint

-- A payment's row is its response's store's, and never changes: it says which cart the visitor went on to pay with.
CREATE FUNCTION commerce.form_payments_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'form_payments.fixed: a payment says which cart it went with, once' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.form_responses r WHERE r.id = NEW.response_id AND r.store_id = NEW.store_id) THEN
    RAISE EXCEPTION 'form_payments.store: a payment is its response''s store''s' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER form_payments_rules BEFORE INSERT OR UPDATE ON commerce.form_payments FOR EACH ROW EXECUTE FUNCTION commerce.form_payments_rules();
--> statement-breakpoint

-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection.
ALTER TABLE commerce.form_payments ENABLE ROW LEVEL SECURITY;
