-- Saved addresses (wave 5 unit J1, D304, docs/wave-5-marketing.md 11.1). Read and written only by server code over the database connection,
-- never by the Data API.
ALTER TABLE commerce.customer_addresses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- At most 20 addresses a customer (ADDRESSES_MAX in src/lib/customer-addresses.ts), counted under the customer's row lock.
CREATE OR REPLACE FUNCTION commerce.customer_addresses_max() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM commerce.customers WHERE store_id = NEW.store_id AND id = NEW.customer_id FOR UPDATE;
  IF (SELECT count(*) FROM commerce.customer_addresses WHERE store_id = NEW.store_id AND customer_id = NEW.customer_id) >= 20 THEN
    RAISE EXCEPTION 'customer_addresses.too_many' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_addresses_max BEFORE INSERT ON commerce.customer_addresses
  FOR EACH ROW EXECUTE FUNCTION commerce.customer_addresses_max();
--> statement-breakpoint

-- Every saved address today (one on the customer) becomes the customer's first, default for shipping and billing. customers.address stays.
INSERT INTO commerce.customer_addresses (store_id, customer_id, address, country, is_default_shipping, is_default_billing, created_at, updated_at)
SELECT c.store_id, c.id, c.address, upper(c.address->>'country'), true, true, c.updated_at, c.updated_at
FROM commerce.customers c
WHERE jsonb_typeof(c.address) = 'object' AND coalesce(btrim(c.address->>'line1'), '') <> ''
  AND coalesce(c.address->>'country', '') ~* '^[a-z]{2}$';
