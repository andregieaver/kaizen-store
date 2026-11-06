-- Kaizena Flow's own customers (D467, docs/platform-parity-plan.md step 2): the rules the database holds.
--
-- * `house_customer_links` has row-level security on, as every commerce table.
-- * A link lives in Kaizena Flow's own store alone (`house_customer_links_house()`): no other store's customer is ever an account's or a
--   request's.
-- * A deal deleted by a person leaves the link without it, never the link deleted (the composite key would otherwise null the store id).
-- * An account deleted outright takes its membership of Kaizena Flow's own store with it (`accounts_house_members_gone()`, D466).

ALTER TABLE "commerce"."house_customer_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE commerce.house_customer_links DROP CONSTRAINT house_customer_links_deal_fk;
--> statement-breakpoint
ALTER TABLE commerce.house_customer_links ADD CONSTRAINT house_customer_links_deal_fk
  FOREIGN KEY (store_id, deal_id) REFERENCES commerce.deals (store_id, id)
  ON DELETE SET NULL (deal_id);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.house_customer_links_house()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.house) THEN
    RAISE EXCEPTION 'house_customer_links.house: only Kaizena Flow''s own store links its customers to accounts and requests'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER house_customer_links_house BEFORE INSERT OR UPDATE OF store_id ON commerce.house_customer_links
  FOR EACH ROW EXECUTE FUNCTION commerce.house_customer_links_house();
--> statement-breakpoint

-- An account deleted outright (a test's own account, never a person's: people are erased, D377) takes its place in Kaizena Flow's own store
-- with it: that membership was the database's doing (`house_members_sync()`), and the store may be left with no owner (`keep_an_owner()`).
CREATE OR REPLACE FUNCTION commerce.accounts_house_members_gone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  DELETE FROM commerce.store_members m USING commerce.stores s
   WHERE m.account_id = OLD.id AND s.id = m.store_id AND s.house;
  RETURN OLD;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER accounts_house_members_gone BEFORE DELETE ON commerce.accounts
  FOR EACH ROW EXECUTE FUNCTION commerce.accounts_house_members_gone();
