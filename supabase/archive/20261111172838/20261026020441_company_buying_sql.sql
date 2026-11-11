-- Company locations, buyer roles, approvals and PO numbers (wave 6 unit C2, D321, docs/wave-6-catalogue.md C.2): row security and the rules.
--
-- commerce.company_locations_max(): at most 50 locations a company.
-- commerce.company_location_buyers_member(): only an employee of the location's own company buys there (the main account approves at every
-- location without a row), and commerce.customers_leave_locations() takes a customer's rows away when they leave the company or become its main account.
-- commerce.orders_company_purchase(): an order's location and PO number are kept as placed, and its approval only moves from waiting to approved
-- or declined.
-- commerce.documents_po_number(): an order's PO number goes into its invoice's snapshot (the order's own, kind 'order') (`poNumber`, as buildInvoiceSnapshot() writes it) and from
-- the invoice into its credit notes'.

ALTER TABLE commerce.company_locations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.company_location_buyers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION commerce.company_locations_max()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (SELECT count(*) FROM commerce.company_locations l WHERE l.store_id = NEW.store_id AND l.company_id = NEW.company_id) > 50 THEN
    RAISE EXCEPTION 'company_locations.max: a company has at most 50 locations' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER company_locations_max AFTER INSERT ON commerce.company_locations
  FOR EACH ROW EXECUTE FUNCTION commerce.company_locations_max();
--> statement-breakpoint
CREATE FUNCTION commerce.company_location_buyers_member()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM commerce.customers c
    JOIN commerce.company_locations l ON l.store_id = c.store_id AND l.company_id = c.company_id
    WHERE c.store_id = NEW.store_id AND c.id = NEW.customer_id AND l.id = NEW.location_id AND c.company_role = 'employee'
  ) THEN
    RAISE EXCEPTION 'company_location_buyers.member: only an employee of the location''s company buys there' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER company_location_buyers_member BEFORE INSERT OR UPDATE ON commerce.company_location_buyers
  FOR EACH ROW EXECUTE FUNCTION commerce.company_location_buyers_member();
--> statement-breakpoint
CREATE FUNCTION commerce.customers_leave_locations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  DELETE FROM commerce.company_location_buyers b
  USING commerce.company_locations l
  WHERE b.store_id = NEW.store_id AND b.customer_id = NEW.id AND l.store_id = b.store_id AND l.id = b.location_id
    AND (l.company_id IS DISTINCT FROM NEW.company_id OR NEW.company_role IS DISTINCT FROM 'employee');
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER customers_leave_locations AFTER UPDATE OF company_id, company_role ON commerce.customers
  FOR EACH ROW WHEN (OLD.company_id IS DISTINCT FROM NEW.company_id OR OLD.company_role IS DISTINCT FROM NEW.company_role)
  EXECUTE FUNCTION commerce.customers_leave_locations();
--> statement-breakpoint
CREATE FUNCTION commerce.orders_company_purchase()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.po_number IS DISTINCT FROM OLD.po_number OR NEW.company_location_id IS DISTINCT FROM OLD.company_location_id THEN
    RAISE EXCEPTION 'orders.company_purchase: an order keeps the location and PO number it was placed with' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.approval IS DISTINCT FROM OLD.approval AND NOT coalesce(OLD.approval = 'waiting' AND NEW.approval IN ('approved', 'declined'), false) THEN
    RAISE EXCEPTION 'orders.approval: an approval only moves from waiting to approved or declined' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_company_purchase BEFORE UPDATE OF po_number, company_location_id, approval ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.orders_company_purchase();
--> statement-breakpoint
CREATE FUNCTION commerce.documents_po_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_po text;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    IF NEW.kind <> 'order' THEN
      RETURN NEW;
    END IF;
    SELECT o.po_number INTO v_po FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id;
  ELSE
    SELECT i.snapshot ->> 'poNumber' INTO v_po FROM commerce.invoices i WHERE i.store_id = NEW.store_id AND i.id = NEW.invoice_id;
  END IF;
  IF v_po IS NOT NULL THEN
    NEW.snapshot := NEW.snapshot || jsonb_build_object('poNumber', v_po);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_po_number BEFORE INSERT ON commerce.invoices
  FOR EACH ROW EXECUTE FUNCTION commerce.documents_po_number();
--> statement-breakpoint
CREATE TRIGGER credit_notes_po_number BEFORE INSERT ON commerce.credit_notes
  FOR EACH ROW EXECUTE FUNCTION commerce.documents_po_number();
