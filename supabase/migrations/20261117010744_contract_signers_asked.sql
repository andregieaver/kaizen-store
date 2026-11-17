-- Contracts (D695 step 3): a sent contract's signer is still asked and reminded. The signers' guard froze every column but the signing
-- steps, so keeping when a signer was emailed (`notified_at`) and how many reminders they had (`reminders`) was refused, and reminders
-- could never be counted. Those two now move too, as the signing steps do; nothing else about a signer changes once the contract is sent.

CREATE OR REPLACE FUNCTION commerce.contract_signers_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_status text;
  v_sha text;
  v_expires timestamptz;
  v_steps text[] := ARRAY['account_id', 'viewed_at', 'signed_at', 'signed_name', 'document_sha256', 'evidence', 'ip', 'user_agent', 'declined_at', 'decline_reason',
    'notified_at', 'reminders'];
  v_after text[] := ARRAY['account_id', 'viewed_at', 'notified_at', 'reminders'];
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
