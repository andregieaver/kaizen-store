-- Work (D122, docs/work.md): the rules of clients, time and invoices.
--
-- What the generated migration cannot say: row-level security, foreign keys
-- that null only their own column, the series for numbering, the functions
-- that issue and credit invoices and start and stop timers, and the triggers
-- that keep issued documents and records with legal weight from changing.
--
-- Call contracts (also in docs/work.md 4.2 to 4.6):
--   commerce.issue_work_invoice(store, invoice, account, issued_on, expected_total, fx_rate, allow_earlier_date)
--   commerce.credit_work_invoice(store, invoice, account, reason, lines, issued_on, allow_earlier_date)
--   commerce.work_start_timer(store, account, assignment, task)
--   commerce.work_stop_timer(store, account, note)
--   commerce.work_invoice_problems(store, invoice)  -- the readiness checklist, as codes
--   commerce.work_invoice_amounts(store, invoice)   -- total, paid, credited, outstanding
--   commerce.work_set_series(store, series, prefix, next_number)
--   commerce.work_event(store, entity_type, entity_id, type, data, account)

-- Row-level security: on, with no policy, like every commerce table --------------
ALTER TABLE commerce.work_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.work_clients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.work_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.work_tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.work_recurring_invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.work_invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.work_invoice_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.work_time_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.work_timers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.work_invoice_payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.work_credit_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.work_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Foreign keys that null only their own column when the parent is deleted --------
-- (the store id stays), so a store's rows can never lose their store.
ALTER TABLE commerce.work_clients ADD CONSTRAINT work_clients_company_fk
  FOREIGN KEY (store_id, customer_company_id) REFERENCES commerce.customer_companies (store_id, id)
  ON DELETE SET NULL (customer_company_id);
--> statement-breakpoint
ALTER TABLE commerce.work_clients ADD CONSTRAINT work_clients_customer_fk
  FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers (store_id, id)
  ON DELETE SET NULL (customer_id);
--> statement-breakpoint
-- A time entry's task is one of its own assignment's; deleting the task keeps the time.
ALTER TABLE commerce.work_time_entries ADD CONSTRAINT work_time_entries_task_fk
  FOREIGN KEY (store_id, assignment_id, task_id) REFERENCES commerce.work_tasks (store_id, assignment_id, id)
  ON DELETE SET NULL (task_id);
--> statement-breakpoint
-- Deleting a draft line releases its time.
ALTER TABLE commerce.work_time_entries ADD CONSTRAINT work_time_entries_line_fk
  FOREIGN KEY (store_id, invoice_line_id) REFERENCES commerce.work_invoice_lines (store_id, id)
  ON DELETE SET NULL (invoice_line_id);
--> statement-breakpoint
ALTER TABLE commerce.work_invoice_lines ADD CONSTRAINT work_invoice_lines_assignment_fk
  FOREIGN KEY (store_id, assignment_id) REFERENCES commerce.work_assignments (store_id, id)
  ON DELETE SET NULL (assignment_id);
--> statement-breakpoint
ALTER TABLE commerce.work_invoice_lines ADD CONSTRAINT work_invoice_lines_task_fk
  FOREIGN KEY (store_id, task_id) REFERENCES commerce.work_tasks (store_id, id)
  ON DELETE SET NULL (task_id);
--> statement-breakpoint

-- Document series ---------------------------------------------------------------
-- Work invoices and credit notes have series of their own, apart from the order
-- invoices' (docs/work.md 4.4). Every store has them, from the start.
CREATE OR REPLACE FUNCTION commerce.initialise_store()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO commerce.document_series (store_id, series, prefix, next_number) VALUES
    (NEW.id, 'invoice', 'INV-', 1),
    (NEW.id, 'credit_note', 'CN-', 1),
    (NEW.id, 'order', '', 1001),
    (NEW.id, 'work_invoice', 'W-', 1),
    (NEW.id, 'work_credit_note', 'WCN-', 1);
  INSERT INTO commerce.payment_providers (store_id, provider) VALUES (NEW.id, 'stripe');
  RETURN NEW;
END;
$$;
--> statement-breakpoint

INSERT INTO commerce.document_series (store_id, series, prefix, next_number)
SELECT id, 'work_invoice', 'W-', 1 FROM commerce.stores
ON CONFLICT (store_id, series) DO NOTHING;
--> statement-breakpoint
INSERT INTO commerce.document_series (store_id, series, prefix, next_number)
SELECT id, 'work_credit_note', 'WCN-', 1 FROM commerce.stores
ON CONFLICT (store_id, series) DO NOTHING;
--> statement-breakpoint

-- The owner may set the prefix and raise the next number before the first
-- issue (to continue numbers issued elsewhere). Once a document has been
-- issued in a series, its numbers can only go up: a number is never reused.
CREATE FUNCTION commerce.work_series_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.series NOT IN ('work_invoice', 'work_credit_note') THEN
    RETURN NEW;
  END IF;
  IF NEW.series <> OLD.series OR NEW.store_id <> OLD.store_id THEN
    RAISE EXCEPTION 'a work document series cannot be renamed or moved' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.prefix IS DISTINCT FROM OLD.prefix AND NEW.prefix !~ '^[A-Za-z0-9._/-]{0,10}$' THEN
    RAISE EXCEPTION 'work_series.prefix: a prefix is up to 10 letters, digits or . _ / -' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.next_number < OLD.next_number AND (
    (OLD.series = 'work_invoice' AND EXISTS (
      SELECT 1 FROM commerce.work_invoices i WHERE i.store_id = OLD.store_id AND i.number IS NOT NULL))
    OR (OLD.series = 'work_credit_note' AND EXISTS (
      SELECT 1 FROM commerce.work_credit_notes c WHERE c.store_id = OLD.store_id))
  ) THEN
    RAISE EXCEPTION 'work_series.lower: numbers already issued in % are not reused; the next number can only be raised', OLD.series
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER document_series_work_guard
  BEFORE UPDATE ON commerce.document_series
  FOR EACH ROW EXECUTE FUNCTION commerce.work_series_guard();
--> statement-breakpoint

-- Sets a Work series' prefix and next number (settings, before the first issue).
CREATE FUNCTION commerce.work_set_series(p_store uuid, p_series text, p_prefix text, p_next_number bigint)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_series NOT IN ('work_invoice', 'work_credit_note') THEN
    RAISE EXCEPTION 'work_series.unknown: % is not a work series', p_series USING ERRCODE = 'check_violation';
  END IF;
  IF p_next_number IS NULL OR p_next_number < 1 THEN
    RAISE EXCEPTION 'work_series.number: the next number must be 1 or more' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE commerce.document_series
     SET prefix = coalesce(p_prefix, ''), next_number = p_next_number
   WHERE store_id = p_store AND series = p_series;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work_series.unknown: the store has no series %', p_series USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;
--> statement-breakpoint

-- Small helpers ------------------------------------------------------------------

-- Today in the store's own time zone.
CREATE FUNCTION commerce.work_today(p_store uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (now() AT TIME ZONE s.time_zone)::date FROM commerce.stores s WHERE s.id = p_store
$$;
--> statement-breakpoint

-- A line's amount before VAT, exactly as docs/work.md 4.3: quantity in hundredths
-- times the net unit price less the discount in basis points, rounded half up.
CREATE FUNCTION commerce.work_line_excl(p_quantity_hundredths integer, p_unit_price_minor bigint, p_discount_bp integer)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT floor(p_quantity_hundredths::numeric * p_unit_price_minor * (10000 - p_discount_bp) / 1000000 + 0.5)::bigint
$$;
--> statement-breakpoint

-- The VAT on an amount at a rate written as a fraction (0.2500), rounded half up.
CREATE FUNCTION commerce.work_line_vat(p_excl_minor bigint, p_rate numeric)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT floor(p_excl_minor::numeric * round(p_rate * 10000) / 10000 + 0.5)::bigint
$$;
--> statement-breakpoint

-- Appends to the store's Work history (the invoice's history panel).
CREATE FUNCTION commerce.work_event(
  p_store uuid, p_entity_type text, p_entity_id uuid, p_type text, p_data jsonb DEFAULT '{}', p_account uuid DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO commerce.work_events (store_id, entity_type, entity_id, type, data, account_id)
  VALUES (p_store, p_entity_type, p_entity_id, p_type, coalesce(p_data, '{}'::jsonb), p_account)
$$;
--> statement-breakpoint

-- What an invoice is owed and has had: its total, the payments (reversals and
-- refunds count negative), the credit notes, and what is still outstanding.
CREATE FUNCTION commerce.work_invoice_amounts(
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
               WHERE c.store_id = i.store_id AND c.invoice_id = i.id))::bigint
  FROM commerce.work_invoices i
  WHERE i.store_id = p_store AND i.id = p_invoice
$$;
--> statement-breakpoint

-- Invoices: rules that hold at every write ------------------------------------------

-- A draft is free to change and to delete. Issuing it is only possible through
-- issue_work_invoice (which takes the number). After that only the status
-- (through payments and credit notes), paid_at, sent_to and public_token can
-- change, and the invoice can never be deleted.
CREATE FUNCTION commerce.work_invoice_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_free text[] := ARRAY['status', 'paid_at', 'sent_to', 'public_token', 'updated_at'];
  v_amounts record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
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

  -- A draft (new or edited) points only at its own client's assignment and templates.
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

CREATE TRIGGER work_invoices_guard
  BEFORE INSERT OR UPDATE OR DELETE ON commerce.work_invoices
  FOR EACH ROW EXECUTE FUNCTION commerce.work_invoice_guard();
--> statement-breakpoint

-- Lines change only while their invoice is a draft. (Deleting a draft takes its
-- lines with it; the parent is then already gone.) On an issued invoice a
-- foreign key may still null the links to a deleted assignment or task, which
-- are navigation, not part of the document.
CREATE FUNCTION commerce.work_line_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT i.status INTO v_status FROM commerce.work_invoices i
   WHERE i.store_id = coalesce(NEW.store_id, OLD.store_id) AND i.id = coalesce(NEW.invoice_id, OLD.invoice_id);
  IF v_status IS NULL OR v_status = 'draft' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.assignment_id IS NULL OR NEW.assignment_id IS NOT DISTINCT FROM OLD.assignment_id)
     AND (NEW.task_id IS NULL OR NEW.task_id IS NOT DISTINCT FROM OLD.task_id)
     AND (to_jsonb(NEW) - ARRAY['assignment_id', 'task_id']) = (to_jsonb(OLD) - ARRAY['assignment_id', 'task_id']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'work_invoice.immutable: the lines of an issued invoice cannot be % ; credit the invoice', lower(TG_OP)
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER work_invoice_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON commerce.work_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.work_line_guard();
--> statement-breakpoint

-- Time on an issued invoice cannot change or be deleted, and only billable time
-- of a draft invoice can be attached to a line. A fully credited (void) invoice
-- releases its time, so it can be billed again on a new invoice.
CREATE FUNCTION commerce.work_entry_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_line_assignment uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.invoice_line_id IS NOT NULL THEN
    SELECT i.status INTO v_status
      FROM commerce.work_invoice_lines l
      JOIN commerce.work_invoices i ON i.store_id = l.store_id AND i.id = l.invoice_id
     WHERE l.store_id = OLD.store_id AND l.id = OLD.invoice_line_id;
    IF v_status IN ('sent', 'paid') THEN
      RAISE EXCEPTION 'work_time.immutable: time on an issued invoice cannot be changed or deleted' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.invoice_line_id IS NOT NULL THEN
    IF NOT NEW.billable THEN
      RAISE EXCEPTION 'work_time.billable: only billable time can be put on an invoice' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'INSERT' OR NEW.invoice_line_id IS DISTINCT FROM OLD.invoice_line_id THEN
      SELECT i.status, l.assignment_id INTO v_status, v_line_assignment
        FROM commerce.work_invoice_lines l
        JOIN commerce.work_invoices i ON i.store_id = l.store_id AND i.id = l.invoice_id
       WHERE l.store_id = NEW.store_id AND l.id = NEW.invoice_line_id;
      IF v_status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION 'work_time.draft_only: time can only be put on the lines of a draft invoice' USING ERRCODE = 'check_violation';
      END IF;
      IF v_line_assignment IS NOT NULL AND v_line_assignment <> NEW.assignment_id THEN
        RAISE EXCEPTION 'work_time.assignment: the time belongs to another assignment than the line' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER work_time_entries_guard
  BEFORE INSERT OR UPDATE OR DELETE ON commerce.work_time_entries
  FOR EACH ROW EXECUTE FUNCTION commerce.work_entry_guard();
--> statement-breakpoint

-- Append-only records ----------------------------------------------------------------

CREATE TRIGGER work_events_append_only
  BEFORE UPDATE OR DELETE ON commerce.work_events
  FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();
--> statement-breakpoint
CREATE TRIGGER work_invoice_payments_append_only
  BEFORE UPDATE OR DELETE ON commerce.work_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();
--> statement-breakpoint
CREATE TRIGGER work_credit_notes_append_only
  BEFORE UPDATE OR DELETE ON commerce.work_credit_notes
  FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();
--> statement-breakpoint

-- Paid, sent again and void follow the money -----------------------------------------

-- Sets an issued invoice's status from what it has had: paid when payments and
-- credit notes cover the total (paid_at is the day the money came, at noon in
-- the store's time zone), sent again if a reversal drops it below, void when
-- credit notes cover all of it.
CREATE FUNCTION commerce.work_refresh_invoice(p_store uuid, p_invoice uuid, p_account uuid, p_paid_on date)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_inv record;
  v_amounts record;
  v_due bigint;
BEGIN
  SELECT i.status, i.total_minor, s.time_zone INTO v_inv
    FROM commerce.work_invoices i JOIN commerce.stores s ON s.id = i.store_id
   WHERE i.store_id = p_store AND i.id = p_invoice
   FOR UPDATE OF i;
  IF NOT FOUND OR v_inv.status NOT IN ('sent', 'paid') THEN
    RETURN;
  END IF;
  SELECT * INTO v_amounts FROM commerce.work_invoice_amounts(p_store, p_invoice);
  v_due := v_amounts.total_minor - v_amounts.credited_minor;
  IF v_amounts.credited_minor >= v_amounts.total_minor THEN
    UPDATE commerce.work_invoices SET status = 'void', updated_at = now()
     WHERE store_id = p_store AND id = p_invoice;
  ELSIF v_inv.status = 'sent' AND v_amounts.paid_minor >= v_due THEN
    UPDATE commerce.work_invoices
       SET status = 'paid', updated_at = now(),
           paid_at = CASE WHEN p_paid_on IS NULL THEN now()
                          ELSE (p_paid_on::timestamp + interval '12 hours') AT TIME ZONE v_inv.time_zone END
     WHERE store_id = p_store AND id = p_invoice;
    PERFORM commerce.work_event(p_store, 'invoice', p_invoice, 'invoice.paid', '{}'::jsonb, p_account);
  ELSIF v_inv.status = 'paid' AND v_amounts.paid_minor < v_due THEN
    UPDATE commerce.work_invoices SET status = 'sent', paid_at = NULL, updated_at = now()
     WHERE store_id = p_store AND id = p_invoice;
    PERFORM commerce.work_event(p_store, 'invoice', p_invoice, 'invoice.reopened', '{}'::jsonb, p_account);
  END IF;
END;
$$;
--> statement-breakpoint

-- A payment belongs to an issued invoice, in its currency; a reversal takes back
-- exactly one earlier payment, once. The invoice row is locked so payments and
-- credit notes arriving together are counted together.
CREATE FUNCTION commerce.work_payment_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_inv record;
  v_original record;
BEGIN
  SELECT i.status, i.currency INTO v_inv FROM commerce.work_invoices i
   WHERE i.store_id = NEW.store_id AND i.id = NEW.invoice_id FOR UPDATE;
  IF v_inv.status = 'draft' THEN
    RAISE EXCEPTION 'work_payment.draft: a draft invoice cannot be paid' USING ERRCODE = 'check_violation';
  END IF;
  IF v_inv.currency <> NEW.currency THEN
    RAISE EXCEPTION 'work_payment.currency: the payment is in % but the invoice is in %', NEW.currency, v_inv.currency
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_inv.status = 'void' AND NEW.amount_minor > 0 THEN
    RAISE EXCEPTION 'work_payment.void: a credited invoice takes no payment, only refunds' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reverses IS NOT NULL THEN
    SELECT p.invoice_id, p.amount_minor, p.currency, p.reverses INTO v_original
      FROM commerce.work_invoice_payments p WHERE p.store_id = NEW.store_id AND p.id = NEW.reverses;
    IF v_original.invoice_id IS DISTINCT FROM NEW.invoice_id
       OR v_original.amount_minor IS DISTINCT FROM -NEW.amount_minor
       OR v_original.currency IS DISTINCT FROM NEW.currency
       OR v_original.reverses IS NOT NULL THEN
      RAISE EXCEPTION 'work_payment.reversal: a reversal takes back one payment of the same invoice, in full' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER work_invoice_payments_guard
  BEFORE INSERT ON commerce.work_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION commerce.work_payment_guard();
--> statement-breakpoint

CREATE FUNCTION commerce.work_payment_applied()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.work_event(
    NEW.store_id, 'invoice', NEW.invoice_id,
    CASE WHEN NEW.reverses IS NOT NULL THEN 'payment.reversed'
         WHEN NEW.amount_minor < 0 THEN 'payment.refunded'
         ELSE 'payment.recorded' END,
    jsonb_build_object('payment_id', NEW.id, 'amount_minor', NEW.amount_minor, 'currency', NEW.currency,
                       'method', NEW.method, 'received_on', NEW.received_on),
    NEW.recorded_by);
  PERFORM commerce.work_refresh_invoice(NEW.store_id, NEW.invoice_id, NEW.recorded_by, NEW.received_on);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER work_invoice_payments_applied
  AFTER INSERT ON commerce.work_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION commerce.work_payment_applied();
--> statement-breakpoint

-- A credit note is for an issued invoice, in its currency, and all of them together
-- never credit more than the invoice.
CREATE FUNCTION commerce.work_credit_note_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_inv record;
  v_credited bigint;
BEGIN
  SELECT i.status, i.currency, i.total_minor INTO v_inv FROM commerce.work_invoices i
   WHERE i.store_id = NEW.store_id AND i.id = NEW.invoice_id FOR UPDATE;
  IF v_inv.status NOT IN ('sent', 'paid') THEN
    RAISE EXCEPTION 'work_credit_note.status: only an issued invoice that is not already credited can be credited'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_inv.currency <> NEW.currency THEN
    RAISE EXCEPTION 'work_credit_note.currency: the credit note must be in the invoice''s currency' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(c.total_minor), 0) INTO v_credited FROM commerce.work_credit_notes c
   WHERE c.store_id = NEW.store_id AND c.invoice_id = NEW.invoice_id;
  IF v_credited + NEW.total_minor > v_inv.total_minor THEN
    RAISE EXCEPTION 'work_credit_note.too_much: the credit notes would be more than the invoice' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER work_credit_notes_guard
  BEFORE INSERT ON commerce.work_credit_notes
  FOR EACH ROW EXECUTE FUNCTION commerce.work_credit_note_guard();
--> statement-breakpoint

CREATE FUNCTION commerce.work_credit_note_applied()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.work_refresh_invoice(NEW.store_id, NEW.invoice_id, NEW.created_by, NULL);
  PERFORM commerce.queue_integration_event(NEW.store_id, 'work_invoice.credited', NEW.invoice_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER work_credit_notes_applied
  AFTER INSERT ON commerce.work_credit_notes
  FOR EACH ROW EXECUTE FUNCTION commerce.work_credit_note_applied();
--> statement-breakpoint

-- Integration events (D41), queued in the transaction that made them -------------------
-- Same mechanism as orders: an outside automation gets them only if the store's
-- integration lists the event.
CREATE FUNCTION commerce.integration_work_invoice_events()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'sent' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'work_invoice.sent', NEW.id);
  ELSIF NEW.status = 'paid' AND OLD.status <> 'paid' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'work_invoice.paid', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER integration_work_invoice_events
  AFTER UPDATE OF status ON commerce.work_invoices
  FOR EACH ROW EXECUTE FUNCTION commerce.integration_work_invoice_events();
--> statement-breakpoint

CREATE FUNCTION commerce.integration_work_client_events()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.queue_integration_event(NEW.store_id, 'work_client.created', NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER integration_work_client_events
  AFTER INSERT ON commerce.work_clients
  FOR EACH ROW EXECUTE FUNCTION commerce.integration_work_client_events();
--> statement-breakpoint

-- Issuing ----------------------------------------------------------------------------

-- What a draft's lines come to: the VAT rate each takes (the store's standard rate
-- from commerce.vat_rate() for `standard` lines of a VAT-registered store, else 0),
-- and the amounts, by the formula of docs/work.md 4.3. Nothing is written.
CREATE FUNCTION commerce.work_invoice_computed(p_store uuid, p_invoice uuid)
RETURNS TABLE (line_id uuid, rate numeric, excl_minor bigint, vat_minor bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH s AS (
    SELECT st.country, coalesce(ws.vat_registered, true) AS registered
    FROM commerce.stores st LEFT JOIN commerce.work_settings ws ON ws.store_id = st.id
    WHERE st.id = p_store
  ), r AS (
    SELECT l.id, l.quantity_hundredths, l.unit_price_minor, l.discount_bp,
           CASE WHEN l.vat_category = 'standard' AND s.registered
                THEN commerce.vat_rate(s.country, 'standard') ELSE 0::numeric END AS rate
    FROM commerce.work_invoice_lines l, s
    WHERE l.store_id = p_store AND l.invoice_id = p_invoice
  ), x AS (
    SELECT r.id, r.rate, commerce.work_line_excl(r.quantity_hundredths, r.unit_price_minor, r.discount_bp) AS excl FROM r
  )
  SELECT x.id, x.rate, x.excl, commerce.work_line_vat(x.excl, x.rate) FROM x
$$;
--> statement-breakpoint

-- The readiness checklist for issuing a draft, as codes (none: ready to issue):
--   not_found, not_draft, no_lines, zero_total,
--   seller_name, seller_address, seller_country, seller_organisation_number,
--   seller_vat_number (registered and none), seller_bank_account,
--   buyer_address (line1, postalCode and city), buyer_country,
--   buyer_vat_number (reverse charge without one),
--   vat_category_mismatch (a line's VAT category does not fit the client's treatment).
CREATE FUNCTION commerce.work_invoice_problems(p_store uuid, p_invoice uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_inv record;
  v_s record;
  v_c record;
  v_p text[] := '{}';
  v_total bigint;
  v_lines integer;
BEGIN
  SELECT i.status, i.client_id INTO v_inv FROM commerce.work_invoices i WHERE i.store_id = p_store AND i.id = p_invoice;
  IF NOT FOUND THEN
    RETURN ARRAY['not_found'];
  END IF;
  IF v_inv.status <> 'draft' THEN
    RETURN ARRAY['not_draft'];
  END IF;
  SELECT st.legal_name, st.postal_address, st.country, st.organisation_number,
         coalesce(ws.vat_registered, true) AS registered, ws.vat_number, ws.bank_account
    INTO v_s
    FROM commerce.stores st LEFT JOIN commerce.work_settings ws ON ws.store_id = st.id
   WHERE st.id = p_store;
  SELECT c.name, c.country, c.billing_address, c.vat_number, c.vat_treatment INTO v_c
    FROM commerce.work_clients c WHERE c.store_id = p_store AND c.id = v_inv.client_id;

  IF coalesce(trim(v_s.legal_name), '') = '' THEN v_p := array_append(v_p, 'seller_name'); END IF;
  IF coalesce(trim(v_s.postal_address), '') = '' THEN v_p := array_append(v_p, 'seller_address'); END IF;
  IF v_s.country IS NULL THEN v_p := array_append(v_p, 'seller_country'); END IF;
  IF coalesce(trim(v_s.organisation_number), '') = '' THEN v_p := array_append(v_p, 'seller_organisation_number'); END IF;
  IF v_s.registered AND coalesce(trim(v_s.vat_number), '') = '' THEN v_p := array_append(v_p, 'seller_vat_number'); END IF;
  IF coalesce(trim(v_s.bank_account), '') = '' THEN v_p := array_append(v_p, 'seller_bank_account'); END IF;

  IF coalesce(trim(v_c.billing_address ->> 'line1'), '') = ''
     OR coalesce(trim(v_c.billing_address ->> 'postalCode'), '') = ''
     OR coalesce(trim(v_c.billing_address ->> 'city'), '') = '' THEN
    v_p := array_append(v_p, 'buyer_address');
  END IF;
  IF v_c.country IS NULL THEN v_p := array_append(v_p, 'buyer_country'); END IF;
  IF v_c.vat_treatment = 'reverse_charge' AND coalesce(trim(v_c.vat_number), '') = '' THEN
    v_p := array_append(v_p, 'buyer_vat_number');
  END IF;

  SELECT count(*) INTO v_lines FROM commerce.work_invoice_lines l WHERE l.store_id = p_store AND l.invoice_id = p_invoice;
  IF v_lines = 0 THEN
    v_p := array_append(v_p, 'no_lines');
  ELSE
    SELECT coalesce(sum(x.excl_minor + x.vat_minor), 0) INTO v_total FROM commerce.work_invoice_computed(p_store, p_invoice) x;
    IF v_total <= 0 THEN v_p := array_append(v_p, 'zero_total'); END IF;
    IF v_s.registered AND EXISTS (
      SELECT 1 FROM commerce.work_invoice_lines l
       WHERE l.store_id = p_store AND l.invoice_id = p_invoice
         AND NOT (CASE v_c.vat_treatment
                    WHEN 'domestic' THEN l.vat_category IN ('standard', 'exempt')
                    WHEN 'reverse_charge' THEN l.vat_category = 'reverse_charge'
                    WHEN 'outside_scope' THEN l.vat_category = 'outside_scope'
                    WHEN 'exempt' THEN l.vat_category = 'exempt'
                    ELSE false END)
    ) THEN
      v_p := array_append(v_p, 'vat_category_mismatch');
    END IF;
  END IF;
  RETURN v_p;
END;
$$;
--> statement-breakpoint

-- Issues a draft invoice, atomically: takes the next number of the store's
-- `work_invoice` series (gap-free: the series row is locked and a rollback gives
-- the number back), recomputes every line's rate and amounts, freezes the totals,
-- snapshots seller, buyer and VAT notes, sets the issue and due dates and the
-- status `sent`, and writes the history. Refuses (with an error whose message
-- starts `work_invoice.<reason>`) unless the readiness checklist is clear.
--
--   p_account              who issues it (history); null for the system (cron)
--   p_issued_on            the issue day; null: today in the store's time zone. Not in the
--                          future, and not before the previous invoice's unless
--   p_allow_earlier_date   the owner confirmed a date earlier than the previous invoice's
--   p_expected_total_minor what the person saw; if it differs from the recomputed total the
--                          issue is refused (`work_invoice.total_changed`)
--   p_fx_rate              units of the seller's currency per 1 of the invoice's, from the
--                          ECB reference rate for the issue date; required exactly when the
--                          invoice is not in the seller's country's currency (`vat_home_minor`)
-- The due date is issued_on + payment days (the invoice's, else the client's, else the
-- settings', else 14). Returns the issued invoice.
CREATE FUNCTION commerce.issue_work_invoice(
  p_store uuid,
  p_invoice uuid,
  p_account uuid DEFAULT NULL,
  p_issued_on date DEFAULT NULL,
  p_expected_total_minor bigint DEFAULT NULL,
  p_fx_rate numeric DEFAULT NULL,
  p_allow_earlier_date boolean DEFAULT false
)
RETURNS commerce.work_invoices
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_inv commerce.work_invoices;
  v_problems text[];
  v_s record;
  v_c record;
  v_today date;
  v_issued date;
  v_prev date;
  v_number bigint;
  v_prefix text;
  v_days integer;
  v_sub bigint;
  v_vat bigint;
  v_locale text;
  v_home char(3);
  v_notes jsonb;
  v_from date;
  v_to date;
BEGIN
  SELECT * INTO v_inv FROM commerce.work_invoices WHERE store_id = p_store AND id = p_invoice FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work_invoice.not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'work_invoice.not_draft: the invoice is already issued' USING ERRCODE = 'restrict_violation';
  END IF;
  v_problems := commerce.work_invoice_problems(p_store, p_invoice);
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'work_invoice.not_ready: %', array_to_string(v_problems, ',') USING ERRCODE = 'check_violation';
  END IF;

  v_today := commerce.work_today(p_store);
  v_issued := coalesce(p_issued_on, v_today);
  IF v_issued > v_today THEN
    RAISE EXCEPTION 'work_invoice.date_in_future: an invoice cannot be issued for a later day' USING ERRCODE = 'check_violation';
  END IF;

  SELECT st.legal_name, st.organisation_number, st.postal_address, st.country, st.contact_email, st.locales[1] AS main_locale,
         coalesce(ws.vat_registered, true) AS registered, ws.vat_number, ws.bank_account, ws.bic, ws.payment_note,
         ws.invoice_footer, ws.late_payment_note, ws.default_payment_days, co.currency AS home_currency
    INTO v_s
    FROM commerce.stores st
    LEFT JOIN commerce.work_settings ws ON ws.store_id = st.id
    LEFT JOIN commerce.countries co ON co.code = st.country
   WHERE st.id = p_store;
  SELECT * INTO v_c FROM commerce.work_clients WHERE store_id = p_store AND id = v_inv.client_id;

  -- Takes the number; from here the series row is locked until this transaction ends.
  v_number := commerce.next_document_number(p_store, 'work_invoice');
  SELECT ds.prefix INTO v_prefix FROM commerce.document_series ds WHERE ds.store_id = p_store AND ds.series = 'work_invoice';
  SELECT max(i.issued_on) INTO v_prev FROM commerce.work_invoices i
   WHERE i.store_id = p_store AND i.number IS NOT NULL;
  IF v_prev IS NOT NULL AND v_issued < v_prev AND NOT p_allow_earlier_date THEN
    RAISE EXCEPTION 'work_invoice.date_before_previous: the previous invoice is dated %', v_prev USING ERRCODE = 'check_violation';
  END IF;

  -- Freeze the lines.
  UPDATE commerce.work_invoice_lines l
     SET vat_rate = x.rate, excl_minor = x.excl_minor, vat_minor = x.vat_minor,
         incl_minor = x.excl_minor + x.vat_minor, updated_at = now()
    FROM commerce.work_invoice_computed(p_store, p_invoice) x
   WHERE l.store_id = p_store AND l.id = x.line_id;
  SELECT sum(l.excl_minor), sum(l.vat_minor) INTO v_sub, v_vat
    FROM commerce.work_invoice_lines l WHERE l.store_id = p_store AND l.invoice_id = p_invoice;
  IF p_expected_total_minor IS NOT NULL AND p_expected_total_minor <> v_sub + v_vat THEN
    RAISE EXCEPTION 'work_invoice.total_changed: the total is now % (was %)', v_sub + v_vat, p_expected_total_minor
      USING ERRCODE = 'check_violation';
  END IF;

  -- VAT in the seller's own currency, when the invoice is in another.
  IF v_s.home_currency IS NOT NULL AND v_inv.currency <> v_s.home_currency THEN
    IF p_fx_rate IS NULL OR p_fx_rate <= 0 THEN
      RAISE EXCEPTION 'work_invoice.fx_rate_required: the invoice is in % and the seller''s currency is %', v_inv.currency, v_s.home_currency
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    p_fx_rate := NULL;
  END IF;

  IF v_s.registered THEN
    SELECT coalesce(jsonb_agg(DISTINCT l.vat_category ORDER BY l.vat_category), '[]'::jsonb) INTO v_notes
      FROM commerce.work_invoice_lines l
     WHERE l.store_id = p_store AND l.invoice_id = p_invoice AND l.vat_category <> 'standard';
  ELSE
    v_notes := '["not_registered"]'::jsonb;
  END IF;

  IF v_inv.service_from IS NULL AND v_inv.service_to IS NULL THEN
    SELECT min(e.work_date), max(e.work_date) INTO v_from, v_to
      FROM commerce.work_time_entries e
      JOIN commerce.work_invoice_lines l ON l.store_id = e.store_id AND l.id = e.invoice_line_id
     WHERE l.store_id = p_store AND l.invoice_id = p_invoice;
  ELSE
    v_from := v_inv.service_from;
    v_to := v_inv.service_to;
  END IF;

  v_days := coalesce(v_inv.payment_days, v_c.payment_days, v_s.default_payment_days, 14);
  v_locale := coalesce(v_inv.locale, v_c.locale, nullif(v_s.main_locale, ''), 'en');

  PERFORM set_config('commerce.work_issuing', p_invoice::text, true);
  UPDATE commerce.work_invoices SET
    status = 'sent',
    number = v_number,
    document_number = v_prefix || v_number::text,
    issued_on = v_issued,
    due_on = v_issued + v_days,
    sent_at = now(),
    payment_days = v_days,
    locale = v_locale,
    service_from = v_from,
    service_to = v_to,
    subtotal_minor = v_sub,
    vat_minor = v_vat,
    total_minor = v_sub + v_vat,
    vat_home_minor = CASE WHEN p_fx_rate IS NULL THEN NULL ELSE floor(v_vat * p_fx_rate + 0.5)::bigint END,
    fx_rate = p_fx_rate,
    vat_notes = v_notes,
    seller = jsonb_build_object(
      'legal_name', v_s.legal_name,
      'organisation_number', v_s.organisation_number,
      'vat_registered', v_s.registered,
      'vat_number', CASE WHEN v_s.registered THEN v_s.vat_number END,
      'address', v_s.postal_address,
      'country', v_s.country,
      'email', v_s.contact_email,
      'bank_account', v_s.bank_account,
      'bic', v_s.bic,
      'payment_note', v_s.payment_note,
      'invoice_footer', v_s.invoice_footer,
      'late_payment_note', v_s.late_payment_note),
    buyer = jsonb_build_object(
      'name', coalesce(nullif(trim(v_c.legal_name), ''), v_c.name),
      'client_name', v_c.name,
      'organisation_number', v_c.organisation_number,
      'vat_number', v_c.vat_number,
      'address', v_c.billing_address,
      'country', v_c.country,
      'email', v_c.billing_email,
      'contact_name', v_c.contact_name,
      'business', v_c.business,
      'vat_treatment', v_c.vat_treatment),
    updated_at = now()
  WHERE store_id = p_store AND id = p_invoice
  RETURNING * INTO v_inv;
  PERFORM set_config('commerce.work_issuing', '', true);

  PERFORM commerce.work_event(
    p_store, 'invoice', p_invoice, 'invoice.issued',
    jsonb_build_object('document_number', v_inv.document_number, 'total_minor', v_inv.total_minor,
                       'currency', v_inv.currency, 'client_id', v_inv.client_id),
    p_account);
  RETURN v_inv;
END;
$$;
--> statement-breakpoint

-- Crediting ----------------------------------------------------------------------------

-- Issues a credit note against an issued (sent or paid) invoice, numbered from the
-- store's `work_credit_note` series, and writes the history. Without `p_lines` it
-- credits everything not yet credited; with it, a jsonb array of
--   { "line_id": uuid, "quantity_hundredths": int }   (quantity optional: all that is left)
-- it credits those lines in part or whole (amounts by the same formula as the invoice,
-- at the line's frozen rate; the last part of a line takes exactly what is left of its
-- amounts, so credit notes add up to the invoice). When the credit notes cover the
-- whole invoice it becomes `void` and its time entries are released, to be billed
-- again on a new invoice. A partial credit leaves it `sent` (or `paid`, if the money
-- already received covers what is still owed). The refund of money already received
-- is a separate negative payment. Returns the credit note. Errors: `work_credit_note.<reason>`.
CREATE FUNCTION commerce.credit_work_invoice(
  p_store uuid,
  p_invoice uuid,
  p_account uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_lines jsonb DEFAULT NULL,
  p_issued_on date DEFAULT NULL,
  p_allow_earlier_date boolean DEFAULT false
)
RETURNS commerce.work_credit_notes
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_inv commerce.work_invoices;
  v_note commerce.work_credit_notes;
  v_today date;
  v_issued date;
  v_prev date;
  v_number bigint;
  v_prefix text;
  v_lines jsonb;
  v_sub bigint;
  v_vat bigint;
  v_element jsonb;
  v_seen uuid[] := '{}';
  v_line_id uuid;
BEGIN
  SELECT * INTO v_inv FROM commerce.work_invoices WHERE store_id = p_store AND id = p_invoice FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work_credit_note.not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_inv.status NOT IN ('sent', 'paid') THEN
    RAISE EXCEPTION 'work_credit_note.status: only an issued invoice that is not already credited can be credited'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_lines IS NOT NULL THEN
    IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
      RAISE EXCEPTION 'work_credit_note.lines: lines must be a list of { line_id, quantity_hundredths }' USING ERRCODE = 'check_violation';
    END IF;
    FOR v_element IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
      v_line_id := (v_element ->> 'line_id')::uuid;
      IF v_line_id IS NULL OR v_line_id = ANY (v_seen) THEN
        RAISE EXCEPTION 'work_credit_note.lines: each line once' USING ERRCODE = 'check_violation';
      END IF;
      v_seen := v_seen || v_line_id;
    END LOOP;
  END IF;

  -- What each line has left to credit, and the part being credited now.
  WITH done AS (
    SELECT (e ->> 'line_id')::uuid AS line_id,
           sum((e ->> 'quantity_hundredths')::integer)::integer AS qty,
           sum((e ->> 'excl_minor')::bigint)::bigint AS excl,
           sum((e ->> 'vat_minor')::bigint)::bigint AS vat
      FROM commerce.work_credit_notes c, jsonb_array_elements(c.lines) e
     WHERE c.store_id = p_store AND c.invoice_id = p_invoice
     GROUP BY 1
  ), asked AS (
    SELECT l.id AS line_id, l.position, l.description, l.unit, l.quantity_hundredths, l.unit_price_minor,
           l.discount_bp, l.vat_category, l.vat_rate, l.excl_minor, l.vat_minor,
           (l.quantity_hundredths - coalesce(d.qty, 0))::integer AS remaining,
           coalesce(d.excl, 0) AS done_excl, coalesce(d.vat, 0) AS done_vat,
           CASE WHEN p_lines IS NULL THEN NULL
                ELSE (SELECT nullif(e ->> 'quantity_hundredths', '')::integer
                        FROM jsonb_array_elements(p_lines) e WHERE (e ->> 'line_id')::uuid = l.id) END AS wanted,
           CASE WHEN p_lines IS NULL THEN true
                ELSE EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) e WHERE (e ->> 'line_id')::uuid = l.id) END AS included
      FROM commerce.work_invoice_lines l LEFT JOIN done d ON d.line_id = l.id
     WHERE l.store_id = p_store AND l.invoice_id = p_invoice
  ), part AS (
    SELECT a.*, coalesce(a.wanted, a.remaining) AS qty FROM asked a WHERE a.included AND a.remaining > 0
  ), priced AS (
    SELECT p.*,
           CASE WHEN p.qty = p.remaining THEN p.excl_minor - p.done_excl
                ELSE commerce.work_line_excl(p.qty, p.unit_price_minor, p.discount_bp) END AS c_excl
      FROM part p
  ), finished AS (
    SELECT p.*, CASE WHEN p.qty = p.remaining THEN p.vat_minor - p.done_vat
                     ELSE commerce.work_line_vat(p.c_excl, p.vat_rate) END AS c_vat
      FROM priced p
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'line_id', f.line_id, 'position', f.position, 'description', f.description, 'unit', f.unit,
           'quantity_hundredths', f.qty, 'unit_price_minor', f.unit_price_minor, 'discount_bp', f.discount_bp,
           'vat_category', f.vat_category, 'vat_rate', f.vat_rate,
           'excl_minor', f.c_excl, 'vat_minor', f.c_vat, 'incl_minor', f.c_excl + f.c_vat) ORDER BY f.position, f.line_id), '[]'::jsonb),
         coalesce(sum(f.c_excl), 0), coalesce(sum(f.c_vat), 0)
    INTO v_lines, v_sub, v_vat
    FROM finished f;

  IF p_lines IS NOT NULL THEN
    -- Every line asked for must exist on the invoice, have something left, and not more than it has.
    IF jsonb_array_length(v_lines) <> jsonb_array_length(p_lines) THEN
      RAISE EXCEPTION 'work_credit_note.lines: a line is not on the invoice or has nothing left to credit' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_lines) e
       WHERE nullif(e ->> 'quantity_hundredths', '') IS NOT NULL AND (e ->> 'quantity_hundredths')::integer <= 0
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_lines) e
        JOIN commerce.work_invoice_lines l ON l.store_id = p_store AND l.invoice_id = p_invoice AND l.id = (e ->> 'line_id')::uuid
       WHERE nullif(e ->> 'quantity_hundredths', '') IS NOT NULL
         AND (e ->> 'quantity_hundredths')::integer > l.quantity_hundredths - coalesce((
               SELECT sum((x ->> 'quantity_hundredths')::integer)
                 FROM commerce.work_credit_notes c, jsonb_array_elements(c.lines) x
                WHERE c.store_id = p_store AND c.invoice_id = p_invoice AND (x ->> 'line_id')::uuid = l.id), 0)
    ) THEN
      RAISE EXCEPTION 'work_credit_note.quantity: more than is left of a line' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF v_sub + v_vat <= 0 THEN
    RAISE EXCEPTION 'work_credit_note.nothing_to_credit: there is nothing left to credit' USING ERRCODE = 'check_violation';
  END IF;

  v_today := commerce.work_today(p_store);
  v_issued := coalesce(p_issued_on, v_today);
  IF v_issued > v_today THEN
    RAISE EXCEPTION 'work_credit_note.date_in_future: a credit note cannot be issued for a later day' USING ERRCODE = 'check_violation';
  END IF;
  IF v_issued < v_inv.issued_on THEN
    RAISE EXCEPTION 'work_credit_note.date_before_invoice: the invoice is dated %', v_inv.issued_on USING ERRCODE = 'check_violation';
  END IF;

  v_number := commerce.next_document_number(p_store, 'work_credit_note');
  SELECT ds.prefix INTO v_prefix FROM commerce.document_series ds WHERE ds.store_id = p_store AND ds.series = 'work_credit_note';
  SELECT max(c.issued_on) INTO v_prev FROM commerce.work_credit_notes c WHERE c.store_id = p_store;
  IF v_prev IS NOT NULL AND v_issued < v_prev AND NOT p_allow_earlier_date THEN
    RAISE EXCEPTION 'work_credit_note.date_before_previous: the previous credit note is dated %', v_prev USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO commerce.work_credit_notes (
    store_id, invoice_id, number, document_number, issued_on, currency, reason,
    subtotal_minor, vat_minor, total_minor, vat_home_minor, fx_rate, lines, seller, buyer, vat_notes, created_by)
  VALUES (
    p_store, p_invoice, v_number, v_prefix || v_number::text, v_issued, v_inv.currency, nullif(trim(p_reason), ''),
    v_sub, v_vat, v_sub + v_vat,
    CASE WHEN v_inv.fx_rate IS NULL THEN NULL ELSE floor(v_vat * v_inv.fx_rate + 0.5)::bigint END,
    v_inv.fx_rate, v_lines, v_inv.seller, v_inv.buyer, v_inv.vat_notes, p_account)
  RETURNING * INTO v_note;

  PERFORM commerce.work_event(
    p_store, 'invoice', p_invoice, 'invoice.credited',
    jsonb_build_object('credit_note_id', v_note.id, 'document_number', v_note.document_number,
                       'total_minor', v_note.total_minor, 'currency', v_note.currency),
    p_account);

  -- Fully credited: the invoice is void (set by the credit note's trigger), and its time is free again.
  IF (SELECT i.status FROM commerce.work_invoices i WHERE i.store_id = p_store AND i.id = p_invoice) = 'void' THEN
    UPDATE commerce.work_time_entries e SET invoice_line_id = NULL, updated_at = now()
     WHERE e.store_id = p_store
       AND e.invoice_line_id IN (SELECT l.id FROM commerce.work_invoice_lines l WHERE l.store_id = p_store AND l.invoice_id = p_invoice);
  END IF;
  RETURN v_note;
END;
$$;
--> statement-breakpoint

-- Timers ------------------------------------------------------------------------------

-- Stops the person's running timer, if any, and logs it as a billable time entry:
-- minutes = ceil(elapsed / 60 s), at least 1 and at most 1440 (a timer forgotten for a
-- day logs a day), on the day the clock started in the store's time zone.
-- Returns the entry (no row when nothing was running).
CREATE FUNCTION commerce.work_stop_timer(p_store uuid, p_account uuid, p_note text DEFAULT NULL)
RETURNS SETOF commerce.work_time_entries
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_timer commerce.work_timers;
  v_entry commerce.work_time_entries;
  v_zone text;
  v_minutes integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('work_timer:' || p_store::text || p_account::text, 0));
  DELETE FROM commerce.work_timers WHERE store_id = p_store AND account_id = p_account RETURNING * INTO v_timer;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT s.time_zone INTO v_zone FROM commerce.stores s WHERE s.id = p_store;
  v_minutes := least(1440, greatest(1, ceil(extract(epoch FROM (now() - v_timer.started_at)) / 60)::integer));
  INSERT INTO commerce.work_time_entries (store_id, assignment_id, task_id, account_id, work_date, minutes, billable, note)
  VALUES (p_store, v_timer.assignment_id, v_timer.task_id, p_account,
          (v_timer.started_at AT TIME ZONE v_zone)::date, v_minutes, true, nullif(trim(p_note), ''))
  RETURNING * INTO v_entry;
  PERFORM commerce.work_event(
    p_store, 'time', v_entry.id, 'time.logged',
    jsonb_build_object('minutes', v_entry.minutes, 'assignment_id', v_entry.assignment_id,
                       'task_id', v_entry.task_id, 'source', 'timer'),
    p_account);
  RETURN NEXT v_entry;
END;
$$;
--> statement-breakpoint

-- Starts a timer for the person on an assignment (and task of it). One runs per person per
-- store: a running one is stopped and logged first, in the same transaction. Returns when
-- the new one started and the entry the earlier one became (null if none was running).
CREATE FUNCTION commerce.work_start_timer(p_store uuid, p_account uuid, p_assignment uuid, p_task uuid DEFAULT NULL)
RETURNS TABLE (timer_started_at timestamptz, stopped_entry_id uuid)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_stopped uuid;
  v_started timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('work_timer:' || p_store::text || p_account::text, 0));
  SELECT e.id INTO v_stopped FROM commerce.work_stop_timer(p_store, p_account, NULL) e;
  INSERT INTO commerce.work_timers (store_id, account_id, assignment_id, task_id)
  VALUES (p_store, p_account, p_assignment, p_task)
  RETURNING started_at INTO v_started;
  RETURN QUERY SELECT v_started, v_stopped;
END;
$$;
