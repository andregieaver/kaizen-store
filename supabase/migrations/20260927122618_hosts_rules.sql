-- Hosts (D71). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.hosts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A host who is not VAT registered charges no VAT: their listings are taxed
-- as exempt, whatever category they were given, and follow the host when
-- that changes. A registered host's listings keep the category they have.
CREATE OR REPLACE FUNCTION commerce.products_host_vat()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.host_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM commerce.hosts h
     WHERE h.store_id = NEW.store_id AND h.id = NEW.host_id AND NOT h.vat_registered
  ) THEN
    NEW.vat_category := 'exempt';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER products_host_vat
  BEFORE INSERT OR UPDATE OF host_id, vat_category ON commerce.products
  FOR EACH ROW EXECUTE FUNCTION commerce.products_host_vat();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.hosts_vat_follow()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT NEW.vat_registered AND OLD.vat_registered THEN
    UPDATE commerce.products SET vat_category = 'exempt', updated_at = now()
     WHERE store_id = NEW.store_id AND host_id = NEW.id AND vat_category <> 'exempt';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER hosts_vat_follow
  AFTER UPDATE OF vat_registered ON commerce.hosts
  FOR EACH ROW EXECUTE FUNCTION commerce.hosts_vat_follow();
