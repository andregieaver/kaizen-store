-- An import takes back its own copy (D495) ----------------------------------------------------------------
--
-- Invoices brought in from Tripletex (D494) could arrive beside the same invoice brought in from Life earlier, when Life dated it more
-- than a week from Tripletex. The import now keeps one: Life's copy (with its time and payments) takes Tripletex's number, and the
-- copy the import made is taken back. The guard allows deleting an issued invoice only for that: imported, no payment, no credit note,
-- no time on its lines, inside a transaction that says it is importing. Every other issued invoice stays undeletable.

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
      -- An import may take back a copy an import made (D495: the same invoice brought in twice, from Life and from Tripletex): an
      -- imported invoice with no payment, no credit note and no time on its lines, only while importing. Its lines go with it.
      IF OLD.imported
         AND current_setting('commerce.work_importing', true) IS NOT DISTINCT FROM 'on'
         AND NOT EXISTS (SELECT 1 FROM commerce.work_invoice_payments p WHERE p.store_id = OLD.store_id AND p.invoice_id = OLD.id)
         AND NOT EXISTS (SELECT 1 FROM commerce.work_credit_notes c WHERE c.store_id = OLD.store_id AND c.invoice_id = OLD.id)
         AND NOT EXISTS (
           SELECT 1 FROM commerce.work_time_entries e
             JOIN commerce.work_invoice_lines l ON l.store_id = e.store_id AND l.id = e.invoice_line_id
            WHERE l.store_id = OLD.store_id AND l.invoice_id = OLD.id) THEN
        RETURN OLD;
      END IF;
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
