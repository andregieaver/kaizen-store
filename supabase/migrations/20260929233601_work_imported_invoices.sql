ALTER TABLE "commerce"."work_invoices" DROP CONSTRAINT "work_invoices_document_number_key";--> statement-breakpoint
ALTER TABLE "commerce"."work_invoices" DROP CONSTRAINT "work_invoices_number";--> statement-breakpoint
ALTER TABLE "commerce"."work_invoices" ADD COLUMN "imported" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoices" ADD COLUMN "legacy_number" text;--> statement-breakpoint
CREATE UNIQUE INDEX "work_invoices_document_number_key" ON "commerce"."work_invoices" USING btree ("store_id","document_number") WHERE not "commerce"."work_invoices"."imported" or "commerce"."work_invoices"."legacy_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_invoices_legacy_number_key" ON "commerce"."work_invoices" USING btree ("store_id","legacy_number") WHERE "commerce"."work_invoices"."legacy_number" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoices" ADD CONSTRAINT "work_invoices_imported" CHECK (not "commerce"."work_invoices"."imported" or ("commerce"."work_invoices"."status" <> 'draft' and "commerce"."work_invoices"."number" is null and "commerce"."work_invoices"."document_number" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."work_invoices" ADD CONSTRAINT "work_invoices_legacy_number" CHECK ("commerce"."work_invoices"."legacy_number" is null or ("commerce"."work_invoices"."imported" and length(trim("commerce"."work_invoices"."legacy_number")) between 1 and 60));--> statement-breakpoint
ALTER TABLE "commerce"."work_invoices" ADD CONSTRAINT "work_invoices_number" CHECK ("commerce"."work_invoices"."imported" or (("commerce"."work_invoices"."status" = 'draft') = ("commerce"."work_invoices"."number" is null) and ("commerce"."work_invoices"."number" is null) = ("commerce"."work_invoices"."document_number" is null)));--> statement-breakpoint

-- Imported invoices (docs/work.md 4.4, WP15) -------------------------------------------------
--
-- History moved in from Kaizen Life (`scripts/import-life-work.mjs`). An imported invoice is issued
-- (`sent`, then `paid` by its payment row) and keeps its own number (`legacy_number`, shown as its
-- `document_number`, or the label `Imported` when Life gave it none) and its own frozen amounts. It has no
-- series `number`, so it never takes one from the store's `work_invoice` series and never disturbs the
-- gap-free numbering. Every rule that made an issued invoice unmakeable outside `issue_work_invoice` is
-- relaxed for `imported = true` rows only, and only inside a transaction that says it is importing:
--
--   select set_config('commerce.work_importing', 'on', true);
--
-- Outside such a transaction an imported row cannot be inserted (`work_invoice.imported_only`), so the app
-- can never make one by accident. After the import an imported invoice behaves as any issued invoice: it is
-- immutable, takes payments, and can be credited (`credit_work_invoice` works from its lines and snapshots;
-- the credit note is a new document numbered from the `work_credit_note` series). While the import runs, its
-- own bookkeeping stays quiet: no D41 event is queued and the payment and paid history entries are not
-- written (the import writes one `invoice.imported` entry per invoice).

-- The invoice guard: as before, plus the imported insert.
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
    -- `imported` and `legacy_number` are not free: an issued invoice never becomes or stops being imported.
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
--> statement-breakpoint

-- The line guard: as before, plus lines inserted with an imported invoice.
CREATE OR REPLACE FUNCTION commerce.work_line_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_imported boolean;
BEGIN
  SELECT i.status, i.imported INTO v_status, v_imported FROM commerce.work_invoices i
   WHERE i.store_id = coalesce(NEW.store_id, OLD.store_id) AND i.id = coalesce(NEW.invoice_id, OLD.invoice_id);
  IF v_status IS NULL OR v_status = 'draft' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' AND v_imported AND current_setting('commerce.work_importing', true) IS NOT DISTINCT FROM 'on' THEN
    RETURN NEW;
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

-- The time guard: as before, plus time put on an imported invoice's line by the import.
CREATE OR REPLACE FUNCTION commerce.work_entry_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_imported boolean;
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
      SELECT i.status, i.imported, l.assignment_id INTO v_status, v_imported, v_line_assignment
        FROM commerce.work_invoice_lines l
        JOIN commerce.work_invoices i ON i.store_id = l.store_id AND i.id = l.invoice_id
       WHERE l.store_id = NEW.store_id AND l.id = NEW.invoice_line_id;
      IF v_status IS DISTINCT FROM 'draft'
         AND NOT (TG_OP = 'INSERT' AND v_imported AND current_setting('commerce.work_importing', true) IS NOT DISTINCT FROM 'on') THEN
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

-- Paid, sent again and void: the history entry for `paid` is left out while importing.
CREATE OR REPLACE FUNCTION commerce.work_refresh_invoice(p_store uuid, p_invoice uuid, p_account uuid, p_paid_on date)
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
    IF current_setting('commerce.work_importing', true) IS DISTINCT FROM 'on' THEN
      PERFORM commerce.work_event(p_store, 'invoice', p_invoice, 'invoice.paid', '{}'::jsonb, p_account);
    END IF;
  ELSIF v_inv.status = 'paid' AND v_amounts.paid_minor < v_due THEN
    UPDATE commerce.work_invoices SET status = 'sent', paid_at = NULL, updated_at = now()
     WHERE store_id = p_store AND id = p_invoice;
    PERFORM commerce.work_event(p_store, 'invoice', p_invoice, 'invoice.reopened', '{}'::jsonb, p_account);
  END IF;
END;
$$;
--> statement-breakpoint

-- A payment's history entry is left out while importing (the import writes its own).
CREATE OR REPLACE FUNCTION commerce.work_payment_applied()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_setting('commerce.work_importing', true) IS DISTINCT FROM 'on' THEN
    PERFORM commerce.work_event(
      NEW.store_id, 'invoice', NEW.invoice_id,
      CASE WHEN NEW.reverses IS NOT NULL THEN 'payment.reversed'
           WHEN NEW.amount_minor < 0 THEN 'payment.refunded'
           ELSE 'payment.recorded' END,
      jsonb_build_object('payment_id', NEW.id, 'amount_minor', NEW.amount_minor, 'currency', NEW.currency,
                         'method', NEW.method, 'received_on', NEW.received_on),
      NEW.recorded_by);
  END IF;
  PERFORM commerce.work_refresh_invoice(NEW.store_id, NEW.invoice_id, NEW.recorded_by, NEW.received_on);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- D41 events are not queued for what the import does (a later payment on an imported invoice is news again).
CREATE OR REPLACE FUNCTION commerce.integration_work_invoice_events()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_setting('commerce.work_importing', true) IS NOT DISTINCT FROM 'on' THEN
    RETURN NULL;
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'sent' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'work_invoice.sent', NEW.id);
  ELSIF NEW.status = 'paid' AND OLD.status <> 'paid' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'work_invoice.paid', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.integration_work_client_events()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_setting('commerce.work_importing', true) IS NOT DISTINCT FROM 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM commerce.queue_integration_event(NEW.store_id, 'work_client.created', NEW.id);
  RETURN NULL;
END;
$$;
