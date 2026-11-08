-- Lost invoices (D500): what of an issued invoice the owner has found cannot be collected (konstatert tap), written off on a day.
--   A loss is append-only, in the invoice's currency, never more than is outstanding; a mistake is a negative row taking back one loss in
--   full, once. What is outstanding is the total less payments, credit notes and losses. The invoice is `lost` when payments, credit
--   notes and losses cover its total and something is lost, and `sent` again when a reversal drops it below; each a history entry.

ALTER TABLE "commerce"."work_invoice_losses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE TRIGGER work_invoice_losses_append_only
  BEFORE UPDATE OR DELETE ON commerce.work_invoice_losses
  FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();
--> statement-breakpoint

CREATE FUNCTION commerce.work_invoice_lost(p_store uuid, p_invoice uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(sum(l.amount_minor), 0)::bigint FROM commerce.work_invoice_losses l
   WHERE l.store_id = p_store AND l.invoice_id = p_invoice
$$;
--> statement-breakpoint

-- What is outstanding counts what is lost too (the other columns stay as they were).
CREATE OR REPLACE FUNCTION commerce.work_invoice_amounts(
  p_store uuid, p_invoice uuid,
  OUT total_minor bigint, OUT paid_minor bigint, OUT credited_minor bigint, OUT outstanding_minor bigint
)
RETURNS record
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT i.total_minor,
         (SELECT coalesce(sum(p.amount_minor), 0)::bigint FROM commerce.work_invoice_payments p
           WHERE p.store_id = i.store_id AND p.invoice_id = i.id),
         (SELECT coalesce(sum(c.total_minor), 0)::bigint FROM commerce.work_credit_notes c
           WHERE c.store_id = i.store_id AND c.invoice_id = i.id),
         greatest(0, i.total_minor
           - (SELECT coalesce(sum(p.amount_minor), 0) FROM commerce.work_invoice_payments p
               WHERE p.store_id = i.store_id AND p.invoice_id = i.id)
           - (SELECT coalesce(sum(c.total_minor), 0) FROM commerce.work_credit_notes c
               WHERE c.store_id = i.store_id AND c.invoice_id = i.id)
           - commerce.work_invoice_lost(i.store_id, i.id))::bigint
  FROM commerce.work_invoices i
  WHERE i.store_id = p_store AND i.id = p_invoice
$$;
--> statement-breakpoint

-- Paid, lost, sent again and void follow the money; the history entry for `paid` is left out while importing.
CREATE OR REPLACE FUNCTION commerce.work_refresh_invoice(p_store uuid, p_invoice uuid, p_account uuid, p_paid_on date)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_inv record;
  v_amounts record;
  v_due bigint;
  v_lost bigint;
BEGIN
  SELECT i.status, i.total_minor, s.time_zone INTO v_inv
    FROM commerce.work_invoices i JOIN commerce.stores s ON s.id = i.store_id
   WHERE i.store_id = p_store AND i.id = p_invoice
   FOR UPDATE OF i;
  IF NOT FOUND OR v_inv.status NOT IN ('sent', 'paid', 'lost') THEN
    RETURN;
  END IF;
  SELECT * INTO v_amounts FROM commerce.work_invoice_amounts(p_store, p_invoice);
  v_lost := commerce.work_invoice_lost(p_store, p_invoice);
  v_due := v_amounts.total_minor - v_amounts.credited_minor;
  IF v_amounts.credited_minor >= v_amounts.total_minor THEN
    UPDATE commerce.work_invoices SET status = 'void', updated_at = now()
     WHERE store_id = p_store AND id = p_invoice;
  ELSIF v_inv.status <> 'paid' AND v_amounts.paid_minor >= v_due THEN
    UPDATE commerce.work_invoices
       SET status = 'paid', updated_at = now(),
           paid_at = CASE WHEN p_paid_on IS NULL THEN now()
                          ELSE (p_paid_on::timestamp + interval '12 hours') AT TIME ZONE v_inv.time_zone END
     WHERE store_id = p_store AND id = p_invoice;
    IF current_setting('commerce.work_importing', true) IS DISTINCT FROM 'on' THEN
      PERFORM commerce.work_event(p_store, 'invoice', p_invoice, 'invoice.paid', '{}'::jsonb, p_account);
    END IF;
  ELSIF v_inv.status <> 'lost' AND v_lost > 0 AND v_amounts.paid_minor < v_due AND v_amounts.paid_minor + v_lost >= v_due THEN
    UPDATE commerce.work_invoices SET status = 'lost', paid_at = NULL, updated_at = now()
     WHERE store_id = p_store AND id = p_invoice;
    PERFORM commerce.work_event(p_store, 'invoice', p_invoice, 'invoice.lost', '{}'::jsonb, p_account);
  ELSIF v_inv.status <> 'sent' AND v_amounts.paid_minor + v_lost < v_due THEN
    UPDATE commerce.work_invoices SET status = 'sent', paid_at = NULL, updated_at = now()
     WHERE store_id = p_store AND id = p_invoice;
    PERFORM commerce.work_event(p_store, 'invoice', p_invoice, 'invoice.reopened', '{}'::jsonb, p_account);
  END IF;
END;
$$;
--> statement-breakpoint

-- The invoice guard (D495's) with `lost` among the statuses money may set.
CREATE OR REPLACE FUNCTION commerce.work_invoice_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_free text[] := ARRAY['status', 'paid_at', 'sent_to', 'public_token', 'updated_at'];
  v_amounts record;
  v_lost bigint;
  v_due bigint;
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
      -- imported invoice with no payment, no credit note, no loss and no time on its lines, only while importing. Its lines go with it.
      IF OLD.imported
         AND current_setting('commerce.work_importing', true) IS NOT DISTINCT FROM 'on'
         AND NOT EXISTS (SELECT 1 FROM commerce.work_invoice_payments p WHERE p.store_id = OLD.store_id AND p.invoice_id = OLD.id)
         AND NOT EXISTS (SELECT 1 FROM commerce.work_credit_notes c WHERE c.store_id = OLD.store_id AND c.invoice_id = OLD.id)
         AND NOT EXISTS (SELECT 1 FROM commerce.work_invoice_losses l WHERE l.store_id = OLD.store_id AND l.invoice_id = OLD.id)
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
      v_lost := commerce.work_invoice_lost(OLD.store_id, OLD.id);
      v_due := v_amounts.total_minor - v_amounts.credited_minor;
      IF NOT (
        (OLD.status IN ('sent', 'lost') AND NEW.status = 'paid' AND v_amounts.paid_minor >= v_due)
        OR (OLD.status IN ('paid', 'lost') AND NEW.status = 'sent' AND v_amounts.paid_minor + v_lost < v_due)
        OR (OLD.status IN ('sent', 'paid') AND NEW.status = 'lost' AND v_lost > 0 AND v_amounts.paid_minor < v_due
            AND v_amounts.paid_minor + v_lost >= v_due)
        OR (OLD.status IN ('sent', 'paid', 'lost') AND NEW.status = 'void' AND v_amounts.credited_minor >= v_amounts.total_minor)
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
--> statement-breakpoint

-- A loss is of an issued invoice, in its currency, never more than is outstanding; a reversal takes back exactly one earlier loss of the
-- same invoice, in full, once. The invoice row is locked so money and losses arriving together are counted together.
CREATE FUNCTION commerce.work_loss_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_inv record;
  v_amounts record;
  v_original record;
BEGIN
  SELECT i.status, i.currency INTO v_inv FROM commerce.work_invoices i
   WHERE i.store_id = NEW.store_id AND i.id = NEW.invoice_id FOR UPDATE;
  IF NOT FOUND OR v_inv.status NOT IN ('sent', 'lost') THEN
    RAISE EXCEPTION 'work_loss.status: only an issued invoice that is not paid or credited can be written off' USING ERRCODE = 'check_violation';
  END IF;
  IF v_inv.currency <> NEW.currency THEN
    RAISE EXCEPTION 'work_loss.currency: the loss is in % but the invoice is in %', NEW.currency, v_inv.currency USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reverses IS NULL THEN
    SELECT * INTO v_amounts FROM commerce.work_invoice_amounts(NEW.store_id, NEW.invoice_id);
    IF NEW.amount_minor > v_amounts.outstanding_minor THEN
      RAISE EXCEPTION 'work_loss.too_much: only what is outstanding can be written off' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT l.invoice_id, l.amount_minor, l.currency, l.reverses INTO v_original
      FROM commerce.work_invoice_losses l WHERE l.store_id = NEW.store_id AND l.id = NEW.reverses;
    IF v_original.invoice_id IS DISTINCT FROM NEW.invoice_id
       OR v_original.amount_minor IS DISTINCT FROM -NEW.amount_minor
       OR v_original.currency IS DISTINCT FROM NEW.currency
       OR v_original.reverses IS NOT NULL THEN
      RAISE EXCEPTION 'work_loss.reversal: a reversal takes back one loss of the same invoice, in full' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER work_invoice_losses_guard
  BEFORE INSERT ON commerce.work_invoice_losses
  FOR EACH ROW EXECUTE FUNCTION commerce.work_loss_guard();
--> statement-breakpoint

CREATE FUNCTION commerce.work_loss_applied()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.work_event(
    NEW.store_id, 'invoice', NEW.invoice_id,
    CASE WHEN NEW.reverses IS NOT NULL THEN 'loss.reversed' ELSE 'loss.written_off' END,
    jsonb_build_object('loss_id', NEW.id, 'amount_minor', NEW.amount_minor, 'currency', NEW.currency, 'written_off_on', NEW.written_off_on),
    NEW.recorded_by);
  PERFORM commerce.work_refresh_invoice(NEW.store_id, NEW.invoice_id, NEW.recorded_by, NULL);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER work_invoice_losses_applied
  AFTER INSERT ON commerce.work_invoice_losses
  FOR EACH ROW EXECUTE FUNCTION commerce.work_loss_applied();
