-- Signing contracts on our own page (D695 step 3): the rules the database holds.
--
-- A signed contract is kept under bookkeeping law (Bokføringsloven § 13(2), 3 years and 6 months after the year's end; the retention kind `contracts`, 54 months from signing): erasure
-- and staff never delete it, and it outlives its deal (the deal is set null). Only the retention job deletes it, saying so. A deal deleted
-- takes its other contracts with it. The signed PDF is set once and its making may be tried again by the job. The email codes and the
-- platform's seal are private to the server, as every commerce table.

ALTER TABLE "commerce"."contracts" DROP CONSTRAINT "contracts_deal_fk";
--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ADD CONSTRAINT "contracts_deal_fk" FOREIGN KEY ("store_id", "deal_id")
  REFERENCES "commerce"."deals"("store_id", "id") ON DELETE SET NULL ("deal_id");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.contracts_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_moving text[] := ARRAY['updated_at', 'updated_by', 'customer_id', 'company_id', 'status', 'completed_at', 'closed_at', 'signed_pdf_path', 'signed_pdf_sha256',
    'signed_pdf_attempts', 'signed_pdf_tried_at', 'deal_id'];
BEGIN
  -- A contract stays on its store and deal; a signed one outlives its deal (the foreign key sets the deal null when the deal goes).
  IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id
     OR (NEW.deal_id IS DISTINCT FROM OLD.deal_id AND NOT (NEW.deal_id IS NULL AND OLD.status = 'signed')) THEN
    RAISE EXCEPTION 'contracts.moved: a contract stays on its store and deal' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.status = 'draft' THEN
      IF NEW.template_id IS DISTINCT FROM OLD.template_id OR NEW.template_version IS DISTINCT FROM OLD.template_version
         OR NEW.replaces_id IS DISTINCT FROM OLD.replaces_id THEN
        RAISE EXCEPTION 'contracts.template: a draft keeps the template and version it was made from' USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.status <> 'sent' THEN
      RAISE EXCEPTION 'contracts.status: a draft is sent before anything else (a draft is deleted, not cancelled)' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.pdf_path IS NULL THEN
      RAISE EXCEPTION 'contracts.pdf: a contract is sent with its PDF' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at <= now() THEN
      RAISE EXCEPTION 'contracts.expires: a contract is sent with time left to sign it' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM commerce.contract_signers s WHERE s.store_id = NEW.store_id AND s.contract_id = NEW.id AND s.role = 'store')
       OR NOT EXISTS (SELECT 1 FROM commerce.contract_signers s WHERE s.store_id = NEW.store_id AND s.contract_id = NEW.id AND s.role = 'customer') THEN
      RAISE EXCEPTION 'contracts.signers: a contract is sent with the store''s signer and the customer''s' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_moving) IS DISTINCT FROM (to_jsonb(OLD) - v_moving) THEN
    RAISE EXCEPTION 'contracts.frozen: a sent contract is not changed: send a new version' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (OLD.customer_id IS NOT NULL AND NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NEW.customer_id IS NOT NULL)
     OR (OLD.company_id IS NOT NULL AND NEW.company_id IS DISTINCT FROM OLD.company_id AND NEW.company_id IS NOT NULL)
     OR (OLD.customer_id IS NULL AND NEW.customer_id IS NOT NULL) OR (OLD.company_id IS NULL AND NEW.company_id IS NOT NULL) THEN
    -- Only a merge moves who it is with: it names the merge.
    IF current_setting('commerce.customer_merge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'contracts.frozen: who a sent contract is with does not change' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF OLD.signed_pdf_path IS NOT NULL AND (NEW.signed_pdf_path, NEW.signed_pdf_sha256) IS DISTINCT FROM (OLD.signed_pdf_path, OLD.signed_pdf_sha256) THEN
    RAISE EXCEPTION 'contracts.signed_pdf: the signed PDF is kept once' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'sent' THEN
      RAISE EXCEPTION 'contracts.closed: a % contract stays so', OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status IN ('signed', 'declined') AND current_setting('commerce.contract_signing', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'contracts.signers_only: a contract is signed or declined by its signers' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'expired' AND OLD.expires_at > now() THEN
      RAISE EXCEPTION 'contracts.not_expired: a contract expires when its time has passed' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'draft' THEN
      RAISE EXCEPTION 'contracts.status: a sent contract is never a draft again' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- A draft is deleted freely; a sent, declined, expired or cancelled one with its deal or by the erasure of the person it is with; a signed
-- one only by the retention job, after its period.
CREATE OR REPLACE FUNCTION commerce.contracts_kept() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF OLD.status = 'signed' THEN
    IF current_setting('commerce.contract_retention', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'contracts.kept_signed: a signed contract is kept for its retention period' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'draft'
     OR current_setting('commerce.contract_erasure', true) = 'on'
     OR current_setting('commerce.contract_with_deal', true) = 'on'
     OR OLD.deal_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM commerce.deals d WHERE d.store_id = OLD.store_id AND d.id = OLD.deal_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'contracts.kept: a sent contract is kept: cancel it instead' USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

-- A deal deleted takes its contracts that are not signed; a signed one stays, its deal set null by the foreign key.
CREATE FUNCTION commerce.deals_contracts_gone() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM set_config('commerce.contract_with_deal', 'on', true);
  DELETE FROM commerce.contracts WHERE store_id = OLD.store_id AND deal_id = OLD.id AND status <> 'signed';
  PERFORM set_config('commerce.contract_with_deal', '', true);
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER deals_contracts_gone BEFORE DELETE ON commerce.deals FOR EACH ROW EXECUTE FUNCTION commerce.deals_contracts_gone();
--> statement-breakpoint

ALTER TABLE commerce.contract_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.contract_seals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

INSERT INTO commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on, valid_from, enforced_by, note)
SELECT 'contracts', NULL, 54, 'months', 'event',
   'Bokføringsloven § 13(2): contracts, correspondence and the like are kept 3 years and 6 months after the end of the financial year (read for D162, quoted in docs/own-books-and-sales.md 5)',
   'https://lovdata.no/lov/2004-11-19-73/§13', 'read', '2026-11-17', '2000-01-01', 'pruneContracts() (src/server/contract-signing.ts)',
   'A signed contract, its signers, its events and its two PDFs, counted from the day it was signed: 54 months covers the law''s 42 after the end of the year it was signed in (signed on 1 January, that is 53); for an accountant to review.'
 WHERE NOT EXISTS (SELECT 1 FROM commerce.retention_rules r WHERE r.kind = 'contracts' AND r.country IS NULL);
