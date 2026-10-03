-- Withdrawals and returns (D153, docs/returns.md): the rules that live in the database. The three statuses the return
-- lifecycle needs (approved, declined, cancelled) were added by the migration before this one, as a new enum value cannot
-- be used in the migration that adds it.
--
-- * a line's quantity: only what is left of the order line, counted under a row lock on the line, over the returns not
--   declined or cancelled (a declined line frees its units);
-- * the lifecycle: forward only, a withdrawal return needs a confirmed request, timestamps in order and filled in by the
--   step, a declined voluntary return has its reason, nothing changes once a return has ended;
-- * a withdrawal request: pending, then confirmed once and before it lapses; a confirmed request is a legal record;
-- * return numbers, `{order number}-R{n}` per order, assigned here;
-- * a refund recorded on a return is never above what was paid, and is a Stripe refund of the same order;
-- * unconfirmed requests are deleted after 24 hours by `commerce.expire_withdrawal_requests()`;
-- * a copied order (D129) takes no request or return (the triggers of the store-copy migration), and the new settings
--   table is copied with a store.
-- Like every commerce table, row-level security on and no policies: the Data API reaches none of it.
ALTER TABLE commerce.return_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.withdrawal_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- One refund pays one return.
CREATE UNIQUE INDEX returns_refund_key ON commerce.returns (store_id, refund_id) WHERE refund_id IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Quantities
-- ---------------------------------------------------------------------------

-- What was returned of an order line: accepted units on returns that are still alive or done (declined and cancelled
-- ones give their units back), leaving out one return (the one being written).
CREATE FUNCTION commerce.returned_quantity(p_order_line uuid, p_except_return uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(sum(rl.quantity), 0)::integer
    FROM commerce.return_lines rl
    JOIN commerce.returns r ON r.store_id = rl.store_id AND r.id = rl.return_id
   WHERE rl.order_line_id = p_order_line
     AND rl.decision = 'accept'
     AND r.status NOT IN ('declined', 'cancelled')
     AND (p_except_return IS NULL OR r.id <> p_except_return)
$$;
--> statement-breakpoint

-- The most a deduction for diminished value may be for some units of a line: their share of what was paid for it,
-- rounded up (the exact rounding of the share is the app's, `refundFor()`; the database holds the line).
CREATE FUNCTION commerce.return_line_value_cap(p_order_line uuid, p_quantity integer)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN ol.quantity = 0 THEN 0
              ELSE ceil(ol.total_minor::numeric * p_quantity / ol.quantity)::bigint END
    FROM commerce.order_lines ol WHERE ol.id = p_order_line
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Withdrawal requests
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.withdrawal_requests_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_status commerce.order_status;
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'confirmed' THEN
      RAISE EXCEPTION 'withdrawal_confirmed: a confirmed withdrawal is a legal record and is kept'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT o.status INTO v_status FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id;
    IF v_status IS NULL OR v_status NOT IN ('paid', 'fulfilled', 'closed') THEN
      RAISE EXCEPTION 'withdrawal_order_not_paid: an order that was not paid cannot be withdrawn from'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'pending' OR NEW.confirmed_at IS NOT NULL OR NEW.acknowledged_at IS NOT NULL THEN
      RAISE EXCEPTION 'withdrawal_starts_pending: a withdrawal starts as a pending request and is confirmed in a second step'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.order_id <> OLD.order_id THEN
    RAISE EXCEPTION 'withdrawal_fixed: a withdrawal stays with its order' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name OR NEW.email IS DISTINCT FROM OLD.email OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.locale IS DISTINCT FROM OLD.locale OR NEW.market_code IS DISTINCT FROM OLD.market_code
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'withdrawal_fixed: what the shopper declared is not changed afterwards' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'confirmed' THEN
    -- A legal record: only its acknowledgement may be recorded (or sent again), never taken back.
    IF NEW.status <> 'confirmed' OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
      RAISE EXCEPTION 'withdrawal_confirmed: a confirmed withdrawal cannot be changed' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS NULL THEN
      RAISE EXCEPTION 'withdrawal_acknowledged: an acknowledgement that was sent is not taken back' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'expired' AND NEW.status <> 'expired' THEN
    RAISE EXCEPTION 'withdrawal_lapsed: a request that lapsed cannot be confirmed; the shopper starts again'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'confirmed' THEN
    IF now() > OLD.expires_at THEN
      RAISE EXCEPTION 'withdrawal_lapsed: the request was not confirmed within its time; the shopper starts again'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM commerce.withdrawal_request_lines l WHERE l.store_id = OLD.store_id AND l.withdrawal_request_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'withdrawal_no_lines: a withdrawal names at least one line' USING ERRCODE = 'check_violation';
    END IF;
    -- Taken again under the lines' locks: what is declared must still be left when it is confirmed.
    FOR r IN
      SELECT l.order_line_id, l.quantity, ol.quantity AS ordered
        FROM commerce.withdrawal_request_lines l
        JOIN commerce.order_lines ol ON ol.store_id = l.store_id AND ol.id = l.order_line_id
       WHERE l.store_id = OLD.store_id AND l.withdrawal_request_id = OLD.id
       ORDER BY l.order_line_id
       FOR NO KEY UPDATE OF ol
    LOOP
      IF r.quantity > r.ordered - commerce.returned_quantity(r.order_line_id) THEN
        RAISE EXCEPTION 'withdrawal_quantity: more is declared than is left to withdraw from' USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    NEW.confirmed_at := coalesce(NEW.confirmed_at, now());
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'pending' AND NEW.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'withdrawal_confirmed: confirm a request by its status' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER withdrawal_requests_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION commerce.withdrawal_requests_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.withdrawal_request_lines_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_req commerce.withdrawal_requests%ROWTYPE;
  v_line commerce.order_lines%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Cascading from a deleted (unconfirmed) request finds no parent; deleting one by hand is only for a pending request.
    SELECT * INTO v_req FROM commerce.withdrawal_requests w WHERE w.store_id = OLD.store_id AND w.id = OLD.withdrawal_request_id;
    IF FOUND AND v_req.status <> 'pending' THEN
      RAISE EXCEPTION 'withdrawal_confirmed: the lines of a withdrawal that was confirmed are kept' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.withdrawal_request_id <> OLD.withdrawal_request_id OR NEW.order_line_id <> OLD.order_line_id THEN
      RAISE EXCEPTION 'withdrawal_fixed: a line stays with its request' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT * INTO v_req FROM commerce.withdrawal_requests w WHERE w.store_id = NEW.store_id AND w.id = NEW.withdrawal_request_id;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'withdrawal_confirmed: a withdrawal that was confirmed (or lapsed) takes no more lines' USING ERRCODE = 'check_violation';
  END IF;

  -- The line must be one of the request's own order, and what is declared still left (a pending request holds nothing:
  -- the return's lines are the claim, and they are checked again when the request is confirmed).
  SELECT * INTO v_line FROM commerce.order_lines ol WHERE ol.store_id = NEW.store_id AND ol.id = NEW.order_line_id FOR NO KEY UPDATE;
  IF v_line.order_id <> v_req.order_id THEN
    RAISE EXCEPTION 'withdrawal_line_order: the line belongs to another order' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.quantity > v_line.quantity - commerce.returned_quantity(v_line.id) THEN
    RAISE EXCEPTION 'withdrawal_quantity: more is declared than is left to withdraw from' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER withdrawal_request_lines_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.withdrawal_request_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.withdrawal_request_lines_rules();
--> statement-breakpoint

-- The daily job: requests nobody confirmed within their time are deleted, and nothing else is (a confirmed withdrawal is
-- a legal record). Returns how many were deleted.
CREATE FUNCTION commerce.expire_withdrawal_requests()
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH gone AS (
    DELETE FROM commerce.withdrawal_requests w
     WHERE w.confirmed_at IS NULL AND w.status IN ('pending', 'expired') AND w.expires_at < now()
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM gone;
  -- Hashed keys of guesses at the function are kept a day, only to limit them.
  DELETE FROM commerce.withdrawal_attempts WHERE at < now() - interval '1 day';
  RETURN v_count;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Returns
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.returns_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_order commerce.orders%ROWTYPE;
  v_req commerce.withdrawal_requests%ROWTYPE;
  v_n integer;
  v_old text;
  v_new text;
  v_paid bigint;
  v_total_refund bigint;
  v_refund commerce.refunds%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'return_kept: a return is history and is never deleted (cancel it)' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- The order's row is locked, so two returns at once get two numbers, and the order is read as it is now.
    SELECT * INTO v_order FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id FOR NO KEY UPDATE;
    IF v_order.status NOT IN ('paid', 'fulfilled', 'closed') THEN
      RAISE EXCEPTION 'return_order_not_paid: an order that was not paid has nothing to return' USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.kind = 'withdrawal' THEN
      SELECT * INTO v_req FROM commerce.withdrawal_requests w WHERE w.store_id = NEW.store_id AND w.id = NEW.withdrawal_request_id;
      IF NOT FOUND OR v_req.status <> 'confirmed' OR v_req.confirmed_at IS NULL OR v_req.order_id <> NEW.order_id THEN
        RAISE EXCEPTION 'return_needs_confirmed_withdrawal: a withdrawal return needs a confirmed withdrawal of the same order'
          USING ERRCODE = 'check_violation';
      END IF;
      IF nullif(btrim(coalesce(v_order.company_name, '')), '') IS NOT NULL THEN
        RAISE EXCEPTION 'return_business_order: a company has no statutory right of withdrawal, so the return is a voluntary one'
          USING ERRCODE = 'check_violation';
      END IF;
      -- The right is not the store's to refuse: a withdrawal return starts approved.
      IF NEW.status <> 'approved' THEN
        RAISE EXCEPTION 'return_lifecycle: a withdrawal return starts as approved' USING ERRCODE = 'check_violation';
      END IF;
      NEW.refund_deadline := coalesce(NEW.refund_deadline, v_req.confirmed_at + interval '14 days');
    ELSIF NEW.status NOT IN ('requested', 'approved') THEN
      RAISE EXCEPTION 'return_lifecycle: a return starts as requested (or approved, when the store makes it)' USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.received_at IS NOT NULL OR NEW.inspected_at IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.outcome IS NOT NULL
       OR NEW.refund_id IS NOT NULL OR NEW.refund_minor IS NOT NULL OR NEW.refunded_at IS NOT NULL OR NEW.refund_outside
       OR NEW.shipped_at IS NOT NULL THEN
      RAISE EXCEPTION 'return_lifecycle: a new return has not been sent, received, inspected, refunded or closed' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'approved' THEN NEW.approved_at := coalesce(NEW.approved_at, now()); END IF;

    -- {order number}-R{n}, the next one for this order.
    SELECT coalesce(max(substring(r.number FROM '-R([0-9]+)$')::integer), 0) + 1 INTO v_n
      FROM commerce.returns r WHERE r.store_id = NEW.store_id AND r.order_id = NEW.order_id;
    NEW.number := v_order.number || '-R' || v_n::text;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE ------------------------------------------------------------------------------------------------------
  IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.order_id <> OLD.order_id OR NEW.kind <> OLD.kind
     OR NEW.withdrawal_request_id IS DISTINCT FROM OLD.withdrawal_request_id OR NEW.number <> OLD.number
     OR NEW.public_token <> OLD.public_token OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'return_fixed: a return keeps its order, kind, request, number and address' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  v_old := OLD.status::text;
  v_new := NEW.status::text;

  -- An ended return is only annotated.
  IF v_old IN ('closed', 'declined', 'cancelled') THEN
    IF to_jsonb(NEW) - 'staff_note' - 'updated_at' IS DISTINCT FROM to_jsonb(OLD) - 'staff_note' - 'updated_at' THEN
      RAISE EXCEPTION 'return_ended: a return that has ended cannot be changed' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF v_new <> v_old THEN
    -- The right of withdrawal is not the store's to refuse; a voluntary return is declined with a reason.
    IF v_new = 'declined' THEN
      IF OLD.kind = 'withdrawal' THEN
        RAISE EXCEPTION 'return_withdrawal_not_declinable: the right of withdrawal is not the store''s to refuse (a line the law excludes is declined as a line)'
          USING ERRCODE = 'check_violation';
      END IF;
      IF length(btrim(coalesce(NEW.decision_note, ''))) = 0 THEN
        RAISE EXCEPTION 'return_decline_reason: say why a return is declined' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    -- A withdrawal is effective on the statement and is not the store's to cancel either: when the goods never come back
    -- it is closed without a refund (a decision the store confirms), so the withdrawal and its deadline stay on record.
    IF v_new = 'cancelled' AND OLD.kind = 'withdrawal' THEN
      RAISE EXCEPTION 'return_withdrawal_not_cancellable: a withdrawal is closed, not cancelled (close it without a refund if the goods never come back)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (
      (v_old = 'requested' AND v_new IN ('approved', 'declined', 'cancelled'))
      OR (v_old = 'approved' AND v_new IN ('in_transit', 'received', 'closed', 'cancelled'))
      OR (v_old = 'in_transit' AND v_new IN ('received', 'closed', 'cancelled'))
      OR (v_old = 'received' AND v_new IN ('inspected', 'closed', 'cancelled'))
      OR (v_old = 'inspected' AND v_new = 'closed')
    ) THEN
      RAISE EXCEPTION 'return_lifecycle: a return cannot go from % to %', v_old, v_new USING ERRCODE = 'check_violation';
    END IF;
    IF v_new = 'declined' THEN NEW.outcome := 'declined'; END IF;
    IF v_new = 'cancelled' THEN NEW.outcome := 'cancelled'; END IF;
    IF v_new = 'approved' THEN NEW.approved_at := coalesce(NEW.approved_at, now()); END IF;
    IF v_new = 'in_transit' THEN NEW.shipped_at := coalesce(NEW.shipped_at, now()); END IF;
    IF v_new = 'received' THEN NEW.received_at := coalesce(NEW.received_at, now()); END IF;
    IF v_new = 'inspected' THEN NEW.inspected_at := coalesce(NEW.inspected_at, now()); END IF;
    IF v_new = 'closed' THEN
      NEW.closed_at := coalesce(NEW.closed_at, now());
      IF NEW.outcome IS NULL THEN
        NEW.outcome := CASE WHEN coalesce(NEW.refund_minor, 0) > 0 THEN 'refunded' ELSE 'no_refund' END;
      END IF;
      IF NEW.outcome NOT IN ('refunded', 'no_refund') OR (NEW.outcome = 'refunded') <> (coalesce(NEW.refund_minor, 0) > 0) THEN
        RAISE EXCEPTION 'return_outcome: a closed return is refunded (with its refund) or closed with no refund' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF NEW.outcome IS DISTINCT FROM OLD.outcome THEN
    RAISE EXCEPTION 'return_outcome: the outcome is set when the return ends' USING ERRCODE = 'check_violation';
  END IF;

  -- The steps' timestamps are set by the step, once, and never before it was reached.
  IF (OLD.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at)
     OR (OLD.received_at IS NOT NULL AND NEW.received_at IS DISTINCT FROM OLD.received_at)
     OR (OLD.inspected_at IS NOT NULL AND NEW.inspected_at IS DISTINCT FROM OLD.inspected_at)
     OR (OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at) THEN
    RAISE EXCEPTION 'return_times: a step''s time is kept once it is set' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.received_at IS NOT NULL AND v_new NOT IN ('received', 'inspected', 'closed', 'cancelled'))
     OR (NEW.inspected_at IS NOT NULL AND v_new NOT IN ('inspected', 'closed', 'cancelled'))
     OR (NEW.closed_at IS NOT NULL AND v_new <> 'closed')
     OR (NEW.approved_at IS NOT NULL AND v_new IN ('requested', 'declined') ) THEN
    RAISE EXCEPTION 'return_times: a step is set when the return reaches it' USING ERRCODE = 'check_violation';
  END IF;

  -- A refund: recorded once, while the return is alive and approved, never above what was paid, and for a Stripe refund
  -- of the same order. One refund pays one return (the unique index).
  IF NEW.refund_minor IS DISTINCT FROM OLD.refund_minor OR NEW.refund_id IS DISTINCT FROM OLD.refund_id
     OR NEW.refund_outside <> OLD.refund_outside OR NEW.refunded_at IS DISTINCT FROM OLD.refunded_at
     OR NEW.shipping_refund_minor <> OLD.shipping_refund_minor THEN
    IF OLD.refund_minor IS NOT NULL THEN
      RAISE EXCEPTION 'return_refund_recorded: the refund of a return is recorded once' USING ERRCODE = 'check_violation';
    END IF;
    IF v_old NOT IN ('approved', 'in_transit', 'received', 'inspected') THEN
      RAISE EXCEPTION 'return_refund_state: a return is refunded after it is approved and before it is closed' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_order FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id FOR NO KEY UPDATE;
    SELECT coalesce(sum(p.amount_minor) FILTER (WHERE p.status = 'captured'), 0) INTO v_paid
      FROM commerce.payments p WHERE p.store_id = NEW.store_id AND p.order_id = NEW.order_id;
    IF v_paid = 0 THEN v_paid := v_order.total_minor; END IF;
    SELECT coalesce(sum(r.refund_minor), 0) INTO v_total_refund
      FROM commerce.returns r WHERE r.store_id = NEW.store_id AND r.order_id = NEW.order_id AND r.id <> NEW.id;
    IF NEW.refund_minor IS NOT NULL AND v_total_refund + NEW.refund_minor > v_paid THEN
      RAISE EXCEPTION 'return_refund_over_paid: the returns of an order cannot be refunded more than was paid' USING ERRCODE = 'check_violation';
    END IF;
    -- The delivery a return gave back is part of its refund, and an order's delivery is given back once in all.
    IF NEW.shipping_refund_minor > coalesce(NEW.refund_minor, 0) THEN
      RAISE EXCEPTION 'return_refund_shipping: the delivery refunded is part of the refund' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.shipping_refund_minor > 0 AND (
      SELECT coalesce(sum(r.shipping_refund_minor), 0) FROM commerce.returns r
       WHERE r.store_id = NEW.store_id AND r.order_id = NEW.order_id AND r.id <> NEW.id
    ) + NEW.shipping_refund_minor > v_order.shipping_minor THEN
      RAISE EXCEPTION 'return_refund_shipping: the delivery of an order is refunded once, and never more than was paid for it'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.refund_id IS NOT NULL THEN
      SELECT rf.* INTO v_refund
        FROM commerce.refunds rf JOIN commerce.payments p ON p.store_id = rf.store_id AND p.id = rf.payment_id
       WHERE rf.store_id = NEW.store_id AND rf.id = NEW.refund_id AND p.order_id = NEW.order_id;
      IF NOT FOUND OR v_refund.amount_minor <> NEW.refund_minor THEN
        RAISE EXCEPTION 'return_refund_match: the refund must be one of this order''s, for the amount recorded' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.refunded_at := coalesce(NEW.refunded_at, now());
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER returns_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.returns
  FOR EACH ROW EXECUTE FUNCTION commerce.returns_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.return_lines_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_ret commerce.returns%ROWTYPE;
  v_line commerce.order_lines%ROWTYPE;
  v_req_qty integer;
  v_taken integer;
  v_counts boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'return_kept: the lines of a return are history and are never deleted (decline the line)' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.return_id <> OLD.return_id OR NEW.order_line_id <> OLD.order_line_id OR NEW.quantity <> OLD.quantity THEN
      RAISE EXCEPTION 'return_fixed: what was returned of a line is not changed (decline it and return the rest)' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT * INTO v_ret FROM commerce.returns r WHERE r.store_id = NEW.store_id AND r.id = NEW.return_id;
  IF v_ret.status IN ('closed', 'declined', 'cancelled') THEN
    RAISE EXCEPTION 'return_ended: a return that has ended cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND v_ret.status NOT IN ('requested', 'approved') THEN
    RAISE EXCEPTION 'return_locked: lines are added only before the goods are on their way' USING ERRCODE = 'check_violation';
  END IF;

  -- Inspection results are written once the goods are there.
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.condition IS DISTINCT FROM OLD.condition OR NEW.deduction_minor <> OLD.deduction_minor
        OR NEW.deduction_note IS DISTINCT FROM OLD.deduction_note)
       AND v_ret.status NOT IN ('received', 'inspected') THEN
      RAISE EXCEPTION 'return_not_received: the condition and any deduction are set when the goods have arrived' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- The line is locked while its quantity is counted, so two returns at once cannot both take the last unit.
  SELECT * INTO v_line FROM commerce.order_lines ol WHERE ol.store_id = NEW.store_id AND ol.id = NEW.order_line_id FOR NO KEY UPDATE;
  IF v_line.order_id <> v_ret.order_id THEN
    RAISE EXCEPTION 'return_line_order: the line belongs to another order' USING ERRCODE = 'check_violation';
  END IF;

  v_counts := NEW.decision = 'accept';
  IF v_counts AND TG_OP = 'UPDATE' THEN v_counts := OLD.decision = 'decline'; END IF;
  IF v_counts THEN
    v_taken := commerce.returned_quantity(v_line.id, NEW.return_id);
    IF NEW.quantity > v_line.quantity - v_taken THEN
      RAISE EXCEPTION 'return_quantity: only % of % is left to return', v_line.quantity - v_taken, v_line.quantity
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF v_ret.kind = 'withdrawal' THEN
    -- Only what the shopper declared, and only a line the law leaves with the right; one the law excludes is declined.
    SELECT l.quantity INTO v_req_qty FROM commerce.withdrawal_request_lines l
     WHERE l.store_id = NEW.store_id AND l.withdrawal_request_id = v_ret.withdrawal_request_id AND l.order_line_id = NEW.order_line_id;
    IF v_req_qty IS NULL OR NEW.quantity > v_req_qty THEN
      RAISE EXCEPTION 'return_not_declared: a withdrawal return holds only what the withdrawal declared' USING ERRCODE = 'check_violation';
    END IF;
    -- Sealed goods (hygiene, audio, video, software) lose the right only once unsealed after delivery (CRD Art. 16(e), (i)):
    -- a withdrawal of them is accepted, and whether the seal was broken is for the inspection (a deduction, or declining the line).
    IF NEW.decision = 'accept' AND v_line.withdrawal_exclusion NOT IN ('none', 'sealed_hygiene', 'sealed_media') THEN
      RAISE EXCEPTION 'return_excluded: the law excludes this line from the right of withdrawal, so it is declined' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decision = 'decline' AND v_line.withdrawal_exclusion = 'none' THEN
      RAISE EXCEPTION 'return_decline_withdrawal: a line with the right of withdrawal is not declined' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.deduction_minor > commerce.return_line_value_cap(NEW.order_line_id, NEW.quantity) THEN
    RAISE EXCEPTION 'return_deduction: a deduction is never more than the value of the goods' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER return_lines_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.return_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.return_lines_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Copying a store: the return settings go with it (docs/returns.md). Returns, their lines and withdrawals are never
-- copied (`COPY_RULES`: never), and a copied order takes none (the triggers of the store-copy migration). The two
-- copy functions are patched as they are live, one statement added before their last line, so a later change to either
-- is not lost; the migration says so loudly if the line it patches is not where it was.
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('commerce.return_settings' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'  RETURN v_store;\nEND;',
    $r$  -- How the template store handles returns (D153); returns themselves are never copied.
  INSERT INTO commerce.return_settings (
    store_id, window_days, transit_days, who_pays_return, refund_when, accept_excluded, instructions, return_address,
    b2b_returns, updated_by
  )
  SELECT v_store, window_days, transit_days, who_pays_return, refund_when, accept_excluded, instructions, return_address,
         b2b_returns, p_owner_id
    FROM commerce.return_settings WHERE store_id = p_template_id;

  RETURN v_store;
END;$r$
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: its last statement was not found, so the return settings are not copied'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('commerce.return_settings' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'  RETURN v_store;\nEND;',
    $r$  -- How the store handles returns (D153); never its returns, withdrawals or their lines.
  INSERT INTO commerce.return_settings (
    store_id, window_days, transit_days, who_pays_return, refund_when, accept_excluded, instructions, return_address,
    b2b_returns, updated_by
  )
  SELECT v_store, window_days, transit_days, who_pays_return, refund_when, accept_excluded, instructions, return_address,
         b2b_returns, p_owner
    FROM commerce.return_settings WHERE store_id = p_source;

  RETURN v_store;
END;$r$
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: its last statement was not found, so the return settings are not copied'; END IF;
  EXECUTE v_new;
END
$patch$;
