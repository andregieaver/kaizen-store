-- Payment terms for company accounts (wave 4 unit F, D293, docs/wave-4-payments.md 8).
--
-- An order bought on terms is placed as a venue booking is (D66): its whole total is its balance, a pending `terms` payment is its order page's key,
-- and `complete_order_payment()` makes it `paid` as a shop status at once, with its invoice. Its row in `order_payment_terms` says for whom, on which
-- terms and by when; read only by server code over the database connection, never by the Data API.
ALTER TABLE commerce.order_payment_terms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- An order's terms are written once, by `placeOrder()` in the order's own transaction while it waits to be confirmed, never for a copied order or a
-- host's: its company, terms and due day are fixed from then on. The reminder's and the overdue notice's claims and the paid time are set once each;
-- the company is nulled only when the company is deleted (refused while it owes anything). Never deleted: the bookkeeping keeps it.
CREATE FUNCTION commerce.order_payment_terms_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'order_payment_terms.delete: an order''s payment terms are kept' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.company_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM commerce.orders o
       WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id AND o.status = 'pending_payment' AND o.copied_from IS NULL AND o.host_id IS NULL
    ) THEN
      RAISE EXCEPTION 'order_payment_terms.order: terms are given to an order of a company while it is placed' USING ERRCODE = 'check_violation';
    END IF;
    NEW.reminder_sent_at := NULL;
    NEW.overdue_sent_at := NULL;
    NEW.paid_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.order_id <> OLD.order_id OR NEW.store_id <> OLD.store_id OR NEW.terms <> OLD.terms OR NEW.due_on <> OLD.due_on
     OR NEW.created_at <> OLD.created_at OR (NEW.company_id IS DISTINCT FROM OLD.company_id AND NEW.company_id IS NOT NULL) THEN
    RAISE EXCEPTION 'order_payment_terms.fixed: an order''s terms, due day and company are fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.reminder_sent_at IS NOT NULL AND NEW.reminder_sent_at IS DISTINCT FROM OLD.reminder_sent_at)
     OR (OLD.overdue_sent_at IS NOT NULL AND NEW.overdue_sent_at IS DISTINCT FROM OLD.overdue_sent_at)
     OR (OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
    RAISE EXCEPTION 'order_payment_terms.once: a reminder, an overdue notice and the payment are recorded once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_payment_terms_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.order_payment_terms
  FOR EACH ROW EXECUTE FUNCTION commerce.order_payment_terms_rules();
--> statement-breakpoint

-- The `terms` payment is never money: a placeholder whose reference opens the order page, and the payment a `void` refund (an unpaid order on terms
-- cancelled) is written on. It takes the store's mode as a venue payment does, so an order on terms placed in test mode never gets an invoice number.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.payments_venue_mode()'::regprocedure);
  IF position($m$NEW.provider IN ('venue', 'terms')$m$ in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, $a$IF NEW.provider = 'venue' THEN$a$, $b$IF NEW.provider IN ('venue', 'terms') THEN$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'payments_venue_mode: the venue test was not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.invoice_eligibility(uuid)'::regprocedure);
  IF position($m$p.provider IN ('venue', 'exchange', 'mollie', 'terms')$m$ in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, $a$OR (p.provider IN ('venue', 'exchange', 'mollie') AND p.test_mode))$a$, $b$OR (p.provider IN ('venue', 'exchange', 'mollie', 'terms') AND p.test_mode))$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'invoice_eligibility: the test-mode providers were not found'; END IF;
  v_new := replace(v_new, $a$AND ((p.provider NOT IN ('venue', 'exchange', 'mollie') AND p.provider_account$a$, $b$AND ((p.provider NOT IN ('venue', 'exchange', 'mollie', 'terms') AND p.provider_account$b$);
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- The invoice of an order on terms says what is due and by when (`due`, with `dueOn` and `terms`) where a venue booking's says what is left for the
-- venue; the `terms` placeholder is never the provider of what was paid.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_step text;
BEGIN
  v_def := pg_get_functiondef('commerce.build_invoice_snapshot(uuid, date, date)'::regprocedure);
  IF position($m$'kind', 'due'$m$ in v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_step := replace(v_new, E'  v_payments jsonb;\n', E'  v_payments jsonb;\n  v_terms jsonb := NULL;\n');
  IF v_step = v_new THEN RAISE EXCEPTION 'build_invoice_snapshot: the declarations were not found'; END IF;
  v_new := v_step;
  v_step := replace(v_new,
    $a$p.provider NOT IN ('venue', 'exchange') AND p.status NOT IN ('failed', 'cancelled')
   ORDER BY p.created_at, p.id LIMIT 1;
  v_provider := coalesce(v_provider, 'stripe');$a$,
    $b$p.provider NOT IN ('venue', 'exchange', 'terms') AND p.status NOT IN ('failed', 'cancelled')
   ORDER BY p.created_at, p.id LIMIT 1;
  v_provider := coalesce(v_provider, 'stripe');
  -- Payment terms (D293): the balance of an order bought on terms is due by its day, not left for a venue.
  SELECT jsonb_build_object('dueOn', to_char(t.due_on, 'YYYY-MM-DD'), 'terms', t.terms) INTO v_terms
    FROM commerce.order_payment_terms t WHERE t.store_id = o.store_id AND t.order_id = o.id;$b$);
  IF v_step = v_new THEN RAISE EXCEPTION 'build_invoice_snapshot: the provider of what was paid was not found'; END IF;
  v_new := v_step;
  v_step := replace(v_new,
    $a$    SELECT 2, jsonb_build_object('kind', 'pay_at_venue', 'amountMinor', o.balance_minor, 'provider', 'venue') WHERE o.balance_minor > 0$a$,
    $b$    SELECT 2, CASE WHEN v_terms IS NOT NULL
                   THEN jsonb_build_object('kind', 'due', 'amountMinor', o.balance_minor, 'provider', 'terms', 'dueOn', v_terms ->> 'dueOn', 'terms', v_terms ->> 'terms')
                   ELSE jsonb_build_object('kind', 'pay_at_venue', 'amountMinor', o.balance_minor, 'provider', 'venue') END
     WHERE o.balance_minor > 0$b$);
  IF v_step = v_new THEN RAISE EXCEPTION 'build_invoice_snapshot: the venue payment line was not found'; END IF;
  EXECUTE v_step;
END;
$patch$;
--> statement-breakpoint

-- The money of an order on terms arrives after its invoice was issued (the pay link, or money recorded outside): it is the invoice's money, so a later
-- refund of it gets its credit note as a refund of a payment made at checkout does.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.payment_on_invoice(uuid, uuid, timestamp with time zone)'::regprocedure);
  IF position('order_payment_terms' in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    $a$             ELSE p.created_at <= p_issued_at$a$,
    $b$             ELSE (p.created_at <= p_issued_at
                   OR EXISTS (SELECT 1 FROM commerce.order_payment_terms t WHERE t.store_id = p.store_id AND t.order_id = p.order_id))$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'payment_on_invoice: the date test was not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- A `void` (an unpaid order on terms cancelled) moved no money: it is capped by its `terms` payment like a payment taken outside Kaizen, and it tells
-- the store's integrations of no refund (the cancellation is their event).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.refunds_manual_cap()'::regprocedure);
  IF position($m$v_provider IS DISTINCT FROM 'terms'$m$ in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, $a$IF v_provider IS DISTINCT FROM 'manual' AND v_provider IS DISTINCT FROM 'exchange'$a$,
                          $b$IF v_provider IS DISTINCT FROM 'manual' AND v_provider IS DISTINCT FROM 'exchange' AND v_provider IS DISTINCT FROM 'terms'$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'refunds_manual_cap: the providers were not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.integration_refund_events()'::regprocedure);
  IF position($m$NEW.kind <> 'void'$m$ in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, $a$IF NEW.status = 'succeeded' AND (TG_OP = 'INSERT' OR OLD.status <> 'succeeded') THEN$a$,
                          $b$IF NEW.status = 'succeeded' AND NEW.kind <> 'void' AND (TG_OP = 'INSERT' OR OLD.status <> 'succeeded') THEN$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'integration_refund_events: the condition was not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- A balance on terms earns nothing, as a venue's balance does not (D66): no bonus credits for the buyer and no referral reward (`zero`).
DO $patch$
DECLARE
  v_fn text;
  v_def text;
  v_new text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['commerce.bonus_order_paid(uuid, text)', 'commerce.affiliate_order_paid(uuid)'] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF position('order_payment_terms' in v_def) > 0 THEN CONTINUE; END IF;
    v_new := replace(v_def,
      $a$FROM commerce.order_lines ol WHERE ol.store_id = v_o.store_id AND ol.order_id = p_order;$a$,
      $b$FROM commerce.order_lines ol WHERE ol.store_id = v_o.store_id AND ol.order_id = p_order
       AND NOT EXISTS (SELECT 1 FROM commerce.order_payment_terms t WHERE t.store_id = v_o.store_id AND t.order_id = p_order);$b$);
    IF v_new = v_def THEN RAISE EXCEPTION '%: the base was not found', v_fn; END IF;
    EXECUTE v_new;
  END LOOP;
END;
$patch$;
