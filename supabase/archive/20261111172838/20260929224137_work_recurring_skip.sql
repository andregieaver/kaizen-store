-- Deleting a draft that a repeating invoice made skips that period for good
-- (docs/work.md 4.2 `skipped_periods`): without this, the next run of the
-- five-minute job would make the draft again while its period is still within 40
-- days. An issued invoice cannot be deleted (work_invoice_guard), so only
-- drafts get here. The template's list stays sorted and without repeats.
CREATE FUNCTION commerce.work_invoice_skip_deleted_period()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.recurring_invoice_id IS NOT NULL AND OLD.recurring_period IS NOT NULL AND OLD.status = 'draft' THEN
    UPDATE commerce.work_recurring_invoices r
       SET skipped_periods = (SELECT array_agg(DISTINCT d ORDER BY d) FROM unnest(r.skipped_periods || OLD.recurring_period) AS d),
           updated_at = now()
     WHERE r.store_id = OLD.store_id AND r.id = OLD.recurring_invoice_id
       AND NOT (OLD.recurring_period = ANY (r.skipped_periods));
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER work_invoices_skip_deleted_period
  AFTER DELETE ON commerce.work_invoices
  FOR EACH ROW EXECUTE FUNCTION commerce.work_invoice_skip_deleted_period();
