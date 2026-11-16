-- Contracts for deals, signed on our own page (D695, `docs/contracts.md`): the rules the database holds.
--
-- A contract starts as a draft and is sent once, with its filled-in snapshot, its PDF and that file's SHA-256 together; from then on the
-- document never changes (a change is a new contract that replaces it, and sending that one cancels the old). Signers are named while it is
-- a draft (the store's signer a member of the store, the others without an account) and each signs or declines once, in their order, against
-- the SHA-256 of the PDF that was sent. The last signature signs the contract and wins its deal; one decline declines it. Sending moves the
-- deal forward to its pipeline's contract stage. Its events are kept, never changed.

-- Who the contract is with goes with the person or the company; the contract stays (as a deal's).
ALTER TABLE "commerce"."contracts" DROP CONSTRAINT "contracts_customer_fk";
--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ADD CONSTRAINT "contracts_customer_fk" FOREIGN KEY ("store_id", "customer_id")
  REFERENCES "commerce"."customers"("store_id", "id") ON DELETE SET NULL ("customer_id");
--> statement-breakpoint
ALTER TABLE "commerce"."contracts" DROP CONSTRAINT "contracts_company_fk";
--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ADD CONSTRAINT "contracts_company_fk" FOREIGN KEY ("store_id", "company_id")
  REFERENCES "commerce"."customer_companies"("store_id", "id") ON DELETE SET NULL ("company_id");
--> statement-breakpoint

-- A template's version rises when its blocks change; nothing else moves it.
CREATE FUNCTION commerce.contract_templates_version() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
  ELSIF NEW.blocks IS DISTINCT FROM OLD.blocks THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER contract_templates_version BEFORE INSERT OR UPDATE ON commerce.contract_templates
  FOR EACH ROW EXECUTE FUNCTION commerce.contract_templates_version();
--> statement-breakpoint

-- A new contract: a draft, with the deal's person and company unless given, its template's version, and a replaced contract that was sent
-- on the same deal.
CREATE FUNCTION commerce.contracts_made() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_customer uuid;
  v_company uuid;
  v_version integer;
BEGIN
  IF NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'contracts.draft: a contract starts as a draft' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.customer_id IS NULL AND NEW.company_id IS NULL THEN
    SELECT d.customer_id, d.company_id INTO v_customer, v_company FROM commerce.deals d WHERE d.store_id = NEW.store_id AND d.id = NEW.deal_id;
    NEW.customer_id := v_customer;
    NEW.company_id := v_company;
  END IF;
  IF NEW.template_id IS NOT NULL THEN
    SELECT t.version INTO v_version FROM commerce.contract_templates t WHERE t.store_id = NEW.store_id AND t.id = NEW.template_id;
    NEW.template_version := v_version;
  ELSE
    NEW.template_version := NULL;
  END IF;
  IF NEW.replaces_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.contracts r
     WHERE r.store_id = NEW.store_id AND r.id = NEW.replaces_id AND r.deal_id = NEW.deal_id AND r.status IN ('sent', 'declined', 'expired')
  ) THEN
    RAISE EXCEPTION 'contracts.replaces: a new version replaces a sent, declined or expired contract of the same deal' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER contracts_made BEFORE INSERT ON commerce.contracts FOR EACH ROW EXECUTE FUNCTION commerce.contracts_made();
--> statement-breakpoint

-- A draft changes freely and is sent once, with its snapshot and PDF and both signers; a sent contract keeps its document and only its
-- status moves on: signed and declined by its signers only (the trigger on contract_signers), expired once its time has passed,
-- cancelled by staff or by the version that replaces it. The signed PDF is set once, on a signed contract.
CREATE FUNCTION commerce.contracts_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_moving text[] := ARRAY['updated_at', 'updated_by', 'customer_id', 'company_id', 'status', 'completed_at', 'closed_at', 'signed_pdf_path', 'signed_pdf_sha256'];
BEGIN
  IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.deal_id <> OLD.deal_id THEN
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
CREATE TRIGGER contracts_guard BEFORE UPDATE ON commerce.contracts FOR EACH ROW EXECUTE FUNCTION commerce.contracts_guard();
--> statement-breakpoint

-- A draft is deleted freely; a sent contract only with its deal, or by the erasure of the person it is with (which says so).
CREATE FUNCTION commerce.contracts_kept() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF OLD.status = 'draft'
     OR current_setting('commerce.contract_erasure', true) = 'on'
     OR NOT EXISTS (SELECT 1 FROM commerce.deals d WHERE d.store_id = OLD.store_id AND d.id = OLD.deal_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'contracts.kept: a sent contract is kept: cancel it instead' USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER contracts_kept BEFORE DELETE ON commerce.contracts FOR EACH ROW EXECUTE FUNCTION commerce.contracts_kept();
--> statement-breakpoint

-- What a contract's status does: sending writes its event, cancels the version it replaces and moves its deal forward to the pipeline's
-- contract stage (never back, never a closed deal); signing wins the deal; an expiry or a cancel is an event.
CREATE FUNCTION commerce.contracts_moved() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_deal uuid;
  v_stage uuid;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'sent' THEN
    INSERT INTO commerce.contract_events (store_id, contract_id, kind, document_sha256, by_account)
    VALUES (NEW.store_id, NEW.id, 'sent', NEW.pdf_sha256, NEW.sent_by);
    IF NEW.replaces_id IS NOT NULL THEN
      UPDATE commerce.contracts SET status = 'cancelled', closed_at = now(), updated_by = NEW.sent_by, updated_at = now()
       WHERE store_id = NEW.store_id AND id = NEW.replaces_id AND status = 'sent';
    END IF;
    SELECT dd.id, q.id INTO v_deal, v_stage
      FROM commerce.deals dd
      JOIN commerce.deal_stages q ON q.store_id = dd.store_id AND q.pipeline_id = dd.pipeline_id AND q.contract_stage
      JOIN commerce.deal_stages cur ON cur.store_id = dd.store_id AND cur.id = dd.stage_id
     WHERE dd.store_id = NEW.store_id AND dd.id = NEW.deal_id AND dd.status = 'open' AND cur.position < q.position;
    IF v_deal IS NOT NULL THEN
      PERFORM set_config('commerce.deal_move_via', 'contract', true);
      UPDATE commerce.deals SET stage_id = v_stage, updated_by = NULL, updated_at = now() WHERE store_id = NEW.store_id AND id = v_deal;
      PERFORM set_config('commerce.deal_move_via', '', true);
    END IF;
  ELSIF NEW.status = 'signed' THEN
    PERFORM commerce.deal_win(NEW.store_id, ARRAY[NEW.deal_id], 'contract');
  ELSIF NEW.status IN ('expired', 'cancelled') THEN
    INSERT INTO commerce.contract_events (store_id, contract_id, kind, document_sha256, by_account)
    VALUES (NEW.store_id, NEW.id, NEW.status, NEW.pdf_sha256, CASE WHEN NEW.status = 'cancelled' THEN NEW.updated_by END);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER contracts_moved AFTER UPDATE OF status ON commerce.contracts FOR EACH ROW EXECUTE FUNCTION commerce.contracts_moved();
--> statement-breakpoint

-- Signers are named on a draft (the store's a member of the store, the others with no account); once it is sent, each only views, signs or
-- declines, once, while it is open and its time lasts, in their order, against the SHA-256 of the PDF that was sent.
CREATE FUNCTION commerce.contract_signers_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_status text;
  v_sha text;
  v_expires timestamptz;
  v_steps text[] := ARRAY['account_id', 'viewed_at', 'signed_at', 'signed_name', 'document_sha256', 'evidence', 'ip', 'user_agent', 'declined_at', 'decline_reason'];
  v_after text[] := ARRAY['account_id', 'viewed_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT c.status INTO v_status FROM commerce.contracts c WHERE c.store_id = OLD.store_id AND c.id = OLD.contract_id;
    IF v_status IS NULL OR v_status = 'draft' OR current_setting('commerce.contract_erasure', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'contract_signers.frozen: the signers of a sent contract stay' USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT c.status, c.pdf_sha256, c.expires_at INTO v_status, v_sha, v_expires
    FROM commerce.contracts c WHERE c.store_id = NEW.store_id AND c.id = NEW.contract_id;

  IF TG_OP = 'UPDATE' AND (NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.contract_id <> OLD.contract_id OR NEW.token <> OLD.token) THEN
    RAISE EXCEPTION 'contract_signers.moved: a signer keeps their contract and link' USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_status = 'draft' THEN
    IF NEW.viewed_at IS NOT NULL OR NEW.signed_at IS NOT NULL OR NEW.declined_at IS NOT NULL OR NEW.ip IS NOT NULL OR NEW.user_agent IS NOT NULL THEN
      RAISE EXCEPTION 'contract_signers.not_sent: a draft is not signed' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.role = 'store' THEN
      IF NEW.account_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM commerce.store_members m WHERE m.store_id = NEW.store_id AND m.account_id = NEW.account_id AND m.disabled_at IS NULL
      ) THEN
        RAISE EXCEPTION 'contract_signers.store: the store''s signer is a member of the store' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.account_id IS NOT NULL THEN
      RAISE EXCEPTION 'contract_signers.account: only the store''s signer has an account here' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'contract_signers.frozen: signers are named while the contract is a draft' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - v_steps) IS DISTINCT FROM (to_jsonb(OLD) - v_steps) THEN
    RAISE EXCEPTION 'contract_signers.frozen: a sent contract''s signer is not changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.account_id IS DISTINCT FROM OLD.account_id AND NEW.account_id IS NOT NULL THEN
    RAISE EXCEPTION 'contract_signers.frozen: a sent contract''s signer keeps their account' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.viewed_at IS NOT NULL AND NEW.viewed_at IS DISTINCT FROM OLD.viewed_at THEN
    RAISE EXCEPTION 'contract_signers.once: a signer''s first view is kept' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.signed_at IS NOT NULL OR OLD.declined_at IS NOT NULL THEN
    IF (to_jsonb(NEW) - v_after) IS DISTINCT FROM (to_jsonb(OLD) - v_after) THEN
      RAISE EXCEPTION 'contract_signers.once: a signer signs or declines once' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.signed_at IS NOT NULL OR NEW.declined_at IS NOT NULL THEN
    IF v_status <> 'sent' THEN
      RAISE EXCEPTION 'contract_signers.closed: a % contract is not signed', v_status USING ERRCODE = 'check_violation';
    END IF;
    IF v_expires <= now() THEN
      RAISE EXCEPTION 'contract_signers.expired: the time to sign has passed' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.signed_at IS NOT NULL THEN
    IF NEW.document_sha256 IS DISTINCT FROM v_sha THEN
      RAISE EXCEPTION 'contract_signers.document: a signer signs the PDF that was sent' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM commerce.contract_signers s
                WHERE s.store_id = NEW.store_id AND s.contract_id = NEW.contract_id AND s.position < NEW.position AND s.signed_at IS NULL) THEN
      RAISE EXCEPTION 'contract_signers.order: an earlier signer signs first' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER contract_signers_guard BEFORE INSERT OR UPDATE OR DELETE ON commerce.contract_signers
  FOR EACH ROW EXECUTE FUNCTION commerce.contract_signers_guard();
--> statement-breakpoint

-- A signature or a decline is an event with its evidence; the last signature signs the contract, a decline declines it.
CREATE FUNCTION commerce.contract_signers_done() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.declined_at IS NOT NULL AND OLD.declined_at IS NULL THEN
    INSERT INTO commerce.contract_events (store_id, contract_id, signer_id, kind, ip, user_agent, by_account)
    VALUES (NEW.store_id, NEW.contract_id, NEW.id, 'declined', NEW.ip, NEW.user_agent, NEW.account_id);
    PERFORM set_config('commerce.contract_signing', 'on', true);
    UPDATE commerce.contracts SET status = 'declined', closed_at = now(), updated_by = NULL, updated_at = now()
     WHERE store_id = NEW.store_id AND id = NEW.contract_id AND status = 'sent';
    PERFORM set_config('commerce.contract_signing', '', true);
  ELSIF NEW.signed_at IS NOT NULL AND OLD.signed_at IS NULL THEN
    INSERT INTO commerce.contract_events (store_id, contract_id, signer_id, kind, document_sha256, ip, user_agent, by_account)
    VALUES (NEW.store_id, NEW.contract_id, NEW.id, 'signed', NEW.document_sha256, NEW.ip, NEW.user_agent, NEW.account_id);
    IF NOT EXISTS (SELECT 1 FROM commerce.contract_signers s WHERE s.store_id = NEW.store_id AND s.contract_id = NEW.contract_id AND s.signed_at IS NULL) THEN
      PERFORM set_config('commerce.contract_signing', 'on', true);
      UPDATE commerce.contracts SET status = 'signed', completed_at = now(), updated_by = NULL, updated_at = now()
       WHERE store_id = NEW.store_id AND id = NEW.contract_id AND status = 'sent';
      PERFORM set_config('commerce.contract_signing', '', true);
      INSERT INTO commerce.contract_events (store_id, contract_id, kind, document_sha256)
      VALUES (NEW.store_id, NEW.contract_id, 'completed', NEW.document_sha256);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER contract_signers_done AFTER UPDATE OF signed_at, declined_at ON commerce.contract_signers
  FOR EACH ROW EXECUTE FUNCTION commerce.contract_signers_done();
--> statement-breakpoint

-- The events are the audit trail: never changed, gone only with their contract.
CREATE FUNCTION commerce.contract_events_kept() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (
    current_setting('commerce.contract_erasure', true) = 'on'
    OR NOT EXISTS (SELECT 1 FROM commerce.contracts c WHERE c.store_id = OLD.store_id AND c.id = OLD.contract_id)
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'commerce.contract_events is append-only; % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER contract_events_kept BEFORE UPDATE OR DELETE ON commerce.contract_events
  FOR EACH ROW EXECUTE FUNCTION commerce.contract_events_kept();
--> statement-breakpoint

-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection.
ALTER TABLE commerce.contract_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.contracts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.contract_signers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.contract_events ENABLE ROW LEVEL SECURITY;
