-- Wave 3 run 2 (orders), the review's fixes (D173). Additive: one trigger, and two anchored patches of live functions (each idempotent by a marker, each raising when
-- its anchor is gone). No DELETE and no DROP.

-- ---------------------------------------------------------------------------
-- Refunds of a payment taken outside Kaizen never exceed it
-- ---------------------------------------------------------------------------

-- Stripe stops a refund above what was charged; money taken outside Kaizen (provider manual) has no Stripe, so the database holds the sum: the refunds of a manual
-- payment that are not failed never add up to more than the payment, however many staff refund at the same moment (the payment's row is locked first, so two refunds
-- are serialised and the second sees the first). Another provider's refunds are Stripe's to cap.
CREATE FUNCTION commerce.refunds_manual_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_amount bigint;
  v_provider text;
  v_other bigint;
BEGIN
  IF NEW.status = 'failed' THEN RETURN NEW; END IF;
  SELECT p.amount_minor, p.provider INTO v_amount, v_provider
    FROM commerce.payments p WHERE p.store_id = NEW.store_id AND p.id = NEW.payment_id FOR UPDATE;
  IF v_provider IS DISTINCT FROM 'manual' THEN RETURN NEW; END IF;
  SELECT coalesce(sum(r.amount_minor), 0) INTO v_other
    FROM commerce.refunds r
   WHERE r.store_id = NEW.store_id AND r.payment_id = NEW.payment_id AND r.status <> 'failed' AND r.id <> NEW.id;
  IF v_other + NEW.amount_minor > v_amount THEN
    RAISE EXCEPTION 'refund.over_payment: the refunds of a payment taken outside Kaizen cannot exceed the payment (% of %)', v_other + NEW.amount_minor, v_amount
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refunds_manual_cap BEFORE INSERT OR UPDATE OF amount_minor, status, payment_id ON commerce.refunds
  FOR EACH ROW EXECUTE FUNCTION commerce.refunds_manual_cap();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The invoice names a staff discount as one (it was printed as an unnamed discount code)
-- ---------------------------------------------------------------------------

-- `discount_minor` holds the staff discount (D173), so what was left for "the code" was the whole of it. The code's share is now what is left after the staff discount too,
-- and the staff discount is its own kind with the name staff gave it (src/lib/invoice-snapshot.ts `buildInvoiceSnapshot()` is the oracle, held by invoice-parity.test.ts).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.build_invoice_snapshot(uuid, date, date)'::regprocedure);
  IF position('staff_discount_minor' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'v_code := o.discount_minor - o.member_discount_minor - o.campaign_discount_minor - o.credit_minor - o.referral_discount_minor - o.vat_relief_minor;',
    E'v_code := o.discount_minor - o.member_discount_minor - o.campaign_discount_minor - o.credit_minor - o.referral_discount_minor - o.vat_relief_minor - o.staff_discount_minor;'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'build_invoice_snapshot: the code discount was not found, so a staff discount cannot be named'; END IF;
  v_def := v_new;
  v_new := replace(
    v_def,
    E'      (4, ''code'', commerce.nz(o.discount_code), v_code),\n      (5, ''credit'', NULL::text, o.credit_minor)',
    E'      (4, ''code'', commerce.nz(o.discount_code), v_code),\n      (5, ''staff'', commerce.nz(o.staff_discount_label), o.staff_discount_minor),\n      (6, ''credit'', NULL::text, o.credit_minor)'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'build_invoice_snapshot: the discount kinds were not found, so a staff discount cannot be listed'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The supply date of money taken outside Kaizen is the day it was received
-- ---------------------------------------------------------------------------

-- A transfer received on the 30th and recorded on the 2nd is a supply of the 30th: the invoice's supply date (which D161 dates VAT and OSS by) is the received day staff gave
-- (`payments.received_on`), never later than the day the invoice is issued; without one, the day the payment was recorded, as before.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.make_order_invoice(uuid, uuid)'::regprocedure);
  IF position('received_on' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'v_supply := commerce.store_day(p_store, v_paid);',
    E'v_supply := coalesce(\n'
    || E'    (SELECT least(p.received_on, v_issued) FROM commerce.payments p\n'
    || E'      WHERE p.store_id = p_store AND p.order_id = p_order AND p.provider = ''manual'' AND p.status NOT IN (''failed'', ''cancelled'') AND p.received_on IS NOT NULL\n'
    || E'      ORDER BY p.created_at, p.id LIMIT 1),\n'
    || E'    commerce.store_day(p_store, v_paid));'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'make_order_invoice: the supply date was not found, so a received day cannot be used'; END IF;
  EXECUTE v_new;
END
$patch$;
