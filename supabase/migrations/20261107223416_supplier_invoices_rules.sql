-- A store's suppliers and their invoices, its bills (B3, D492): row-level security, as every commerce table (the server reads and writes
-- them through its own connection; no policy lets a client reach them). A bill is posted when it comes and is never changed but by its
-- payment, once: the entry that paid it and the day, nothing else; it is never deleted.

ALTER TABLE "commerce"."suppliers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."supplier_invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.supplier_invoice_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'supplier_invoice.fixed: a bill is never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.paid_entry_id IS NOT NULL
     OR (to_jsonb(NEW) - 'paid_entry_id' - 'paid_on') IS DISTINCT FROM (to_jsonb(OLD) - 'paid_entry_id' - 'paid_on') THEN
    RAISE EXCEPTION 'supplier_invoice.fixed: a bill changes only by its payment, once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER supplier_invoices_fixed BEFORE UPDATE OR DELETE ON commerce.supplier_invoices FOR EACH ROW EXECUTE FUNCTION commerce.supplier_invoice_fixed();
