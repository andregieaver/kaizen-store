-- Market price rules (wave 7 unit A2, D335, docs/wave-7-storefront.md A.2).
--
-- * `market_price_rules` is private like every commerce table.
-- * A base market has no rule of its own, and a market with a rule is no other rule's base: rules never chain.
-- * A price row may still only be closed, never changed, with one exception: who wrote an open row (`derived`) may change, nothing else, so a
--   rule's prices become the owner's own when the rule is taken away, and a price the rule writes is marked as the rule's.

ALTER TABLE commerce.market_price_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.market_price_rules_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.market_price_rules r WHERE r.store_id = NEW.store_id AND r.market_code = NEW.base_market) THEN
    RAISE EXCEPTION 'market_price_rules.chain: the base market has a rule of its own'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'market_price_rules_chain';
  END IF;
  IF EXISTS (SELECT 1 FROM commerce.market_price_rules r WHERE r.store_id = NEW.store_id AND r.base_market = NEW.market_code) THEN
    RAISE EXCEPTION 'market_price_rules.chain: another market takes its prices from this one'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'market_price_rules_chain';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER market_price_rules_rules
  BEFORE INSERT OR UPDATE ON commerce.market_price_rules
  FOR EACH ROW EXECUTE FUNCTION commerce.market_price_rules_rules();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.guard_price_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commerce.prices is append-only; DELETE is not allowed'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Who wrote an open price (D335): the rule or the owner. Nothing about the price itself moves.
  IF OLD.valid_to IS NULL AND NEW.valid_to IS NULL
     AND NEW.store_id IS NOT DISTINCT FROM OLD.store_id
     AND NEW.variant_id IS NOT DISTINCT FROM OLD.variant_id
     AND NEW.market_code IS NOT DISTINCT FROM OLD.market_code
     AND NEW.currency IS NOT DISTINCT FROM OLD.currency
     AND NEW.amount_minor IS NOT DISTINCT FROM OLD.amount_minor
     AND NEW.valid_from IS NOT DISTINCT FROM OLD.valid_from THEN
    RETURN NEW;
  END IF;

  IF OLD.valid_to IS NOT NULL
     OR NEW.valid_to IS NULL
     OR NEW.store_id IS DISTINCT FROM OLD.store_id
     OR NEW.variant_id IS DISTINCT FROM OLD.variant_id
     OR NEW.market_code IS DISTINCT FROM OLD.market_code
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.derived IS DISTINCT FROM OLD.derived THEN
    RAISE EXCEPTION 'commerce.prices rows can only be closed, not changed'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- The admin's view of every current price says which are a rule's (the editor shows it).
CREATE OR REPLACE VIEW commerce.kept_prices
WITH (security_invoker = true)
AS
SELECT
  p.store_id,
  p.variant_id,
  p.market_code,
  p.currency,
  p.amount_minor,
  p.valid_from,
  commerce.prior_price(p.variant_id, p.market_code, p.valid_from) AS prior_30d_minor,
  p.derived
FROM commerce.prices p
WHERE p.valid_to IS NULL;
