-- Imported invoices take Tripletex's number (D494) ----------------------------------------------------------
--
-- Invoices brought in from Tripletex (`src/server/tripletex-invoices.ts`) are imported invoices, made as Life's were (WP15),
-- inside a transaction that says it is importing. When one of Life's imported invoices had no number of its own and Tripletex
-- holds the same invoice, the import gives it Tripletex's number: `legacy_number`, shown as its `document_number`. The guard
-- allows exactly that, once, while importing; every other change to an issued invoice is refused as before.

CREATE OR REPLACE FUNCTION commerce.work_invoice_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_free text[] := ARRAY['status', 'paid_at', 'sent_to', 'public_token', 'updated_at'];
  v_amounts record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.imported THEN
      IF current_setting('commerce.work_importing', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'work_invoice.imported_only: imported invoices are made by the Kaizen Life import only'
          USING ERRCODE = 'restrict_violation';
      END IF;
      -- Issued already, with its own number and amounts: goes on to the reference checks below.
    ELSIF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'work_invoice.draft_only: an invoice starts as a draft and is issued by issue_work_invoice'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'work_invoice.immutable: an issued invoice cannot be deleted; credit it' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  ELSIF OLD.status = 'draft' THEN
    IF NEW.status <> 'draft' THEN
      IF NEW.status <> 'sent' OR current_setting('commerce.work_issuing', true) IS DISTINCT FROM OLD.id::text THEN
        RAISE EXCEPTION 'work_invoice.draft_only: an invoice is issued by issue_work_invoice' USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NEW;
    END IF;
  ELSE
    -- An imported invoice that came without a number of its own (Life's) takes its number once, from an import (D494: the
    -- number Tripletex gave the same invoice), as its `document_number` too; nothing else of it changes, and a number once
    -- kept is never changed.
    IF OLD.imported AND OLD.legacy_number IS NULL AND NEW.legacy_number IS NOT NULL
       AND NEW.document_number IS NOT DISTINCT FROM NEW.legacy_number
       AND current_setting('commerce.work_importing', true) IS NOT DISTINCT FROM 'on'
       AND (to_jsonb(NEW) - v_free - ARRAY['legacy_number', 'document_number']) = (to_jsonb(OLD) - v_free - ARRAY['legacy_number', 'document_number']) THEN
      RETURN NEW;
    END IF;
    -- `imported` and `legacy_number` are not free otherwise: an issued invoice never becomes or stops being imported.
    IF (to_jsonb(NEW) - v_free) IS DISTINCT FROM (to_jsonb(OLD) - v_free) THEN
      RAISE EXCEPTION 'work_invoice.immutable: an issued invoice cannot be changed; credit it' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status THEN
      SELECT * INTO v_amounts FROM commerce.work_invoice_amounts(OLD.store_id, OLD.id);
      IF NOT (
        (OLD.status = 'sent' AND NEW.status = 'paid' AND v_amounts.paid_minor >= v_amounts.total_minor - v_amounts.credited_minor)
        OR (OLD.status = 'paid' AND NEW.status = 'sent' AND v_amounts.paid_minor < v_amounts.total_minor - v_amounts.credited_minor)
        OR (OLD.status IN ('sent', 'paid') AND NEW.status = 'void' AND v_amounts.credited_minor >= v_amounts.total_minor)
      ) THEN
        RAISE EXCEPTION 'work_invoice.status: % to % is not allowed for this invoice', OLD.status, NEW.status
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- A draft (new or edited), or an imported invoice, points only at its own client's assignment and templates.
  IF NEW.assignment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.work_assignments a
    WHERE a.store_id = NEW.store_id AND a.id = NEW.assignment_id AND a.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'work_invoice.assignment: the assignment belongs to another client' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.recurring_invoice_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.work_recurring_invoices r
    WHERE r.store_id = NEW.store_id AND r.id = NEW.recurring_invoice_id AND r.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'work_invoice.recurring: the repeating invoice belongs to another client' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
