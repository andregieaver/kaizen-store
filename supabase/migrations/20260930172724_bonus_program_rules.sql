-- The bonus program (D130, docs/bonus.md): a store's signed-in customers earn credits (money, in the store's main
-- currency) on what they pay, and use them as a price reduction on a later order.
--
-- The ledger is append-only. A positive entry is a *lot* (credits usable from `available_at` until `expires_at`); a
-- negative entry is paid out of lots through `bonus_allocations`, oldest expiry first, so what is left of a lot, and a
-- customer's balance, is always worked out from the ledger: balance = available + pending = the sum of the entries.
-- Every writer is a `commerce.bonus_*` function holding the customer's row lock, and each grant, use, return and
-- expiry carries an idempotency key, so it happens once. Orders call in through triggers on their status and on
-- refunds, so every path that pays, cancels or refunds an order is covered without each having to remember.

ALTER TABLE commerce.bonus_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.bonus_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.bonus_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Append-only, and always within what a lot holds
-- ---------------------------------------------------------------------------

-- No change to an entry, and no delete but the customer's own deletion (their ledger goes with their account).
CREATE FUNCTION commerce.bonus_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'bonus_entries' THEN
      IF NOT EXISTS (SELECT 1 FROM commerce.customers c WHERE c.store_id = OLD.store_id AND c.id = OLD.customer_id) THEN
        RETURN OLD;
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM commerce.bonus_entries e WHERE e.store_id = OLD.store_id AND e.id = OLD.entry_id) THEN
      -- An allocation goes with the entry that took the credits.
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'commerce.% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bonus_entries_immutable BEFORE UPDATE OR DELETE ON commerce.bonus_entries
  FOR EACH ROW EXECUTE FUNCTION commerce.bonus_ledger_immutable();
--> statement-breakpoint
CREATE TRIGGER bonus_allocations_immutable BEFORE UPDATE OR DELETE ON commerce.bonus_allocations
  FOR EACH ROW EXECUTE FUNCTION commerce.bonus_ledger_immutable();
--> statement-breakpoint

-- An allocation takes from a positive entry (a lot) of the same customer, for a negative one, and never more than the
-- lot holds: a balance cannot go negative, whatever writes to the ledger.
CREATE FUNCTION commerce.bonus_allocation_within_lot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_lot commerce.bonus_entries%ROWTYPE;
  v_entry commerce.bonus_entries%ROWTYPE;
  v_taken bigint;
BEGIN
  SELECT * INTO v_lot FROM commerce.bonus_entries WHERE store_id = NEW.store_id AND id = NEW.lot_id;
  SELECT * INTO v_entry FROM commerce.bonus_entries WHERE store_id = NEW.store_id AND id = NEW.entry_id;
  IF v_lot.amount_minor IS NULL OR v_entry.amount_minor IS NULL OR v_lot.amount_minor <= 0 OR v_entry.amount_minor >= 0
     OR v_lot.customer_id <> v_entry.customer_id THEN
    RAISE EXCEPTION 'bonus.bad_allocation' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(a.amount_minor), 0) INTO v_taken
    FROM commerce.bonus_allocations a WHERE a.store_id = NEW.store_id AND a.lot_id = NEW.lot_id;
  IF v_taken > v_lot.amount_minor THEN
    RAISE EXCEPTION 'bonus.below_zero' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bonus_allocations_within_lot AFTER INSERT ON commerce.bonus_allocations
  FOR EACH ROW EXECUTE FUNCTION commerce.bonus_allocation_within_lot();
--> statement-breakpoint

-- Every negative entry is paid in full out of lots by the time the transaction ends.
CREATE FUNCTION commerce.bonus_entry_fully_allocated()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_taken bigint;
BEGIN
  IF NEW.amount_minor < 0 THEN
    SELECT coalesce(sum(a.amount_minor), 0) INTO v_taken
      FROM commerce.bonus_allocations a WHERE a.store_id = NEW.store_id AND a.entry_id = NEW.id;
    IF v_taken <> -NEW.amount_minor THEN
      RAISE EXCEPTION 'bonus.below_zero' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER bonus_entries_fully_allocated AFTER INSERT ON commerce.bonus_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.bonus_entry_fully_allocated();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- The credits' currency: pinned in the settings, else the store's main currency (its own country's, first market).
CREATE FUNCTION commerce.bonus_currency(p_store uuid)
RETURNS char(3)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT b.currency FROM commerce.bonus_settings b WHERE b.store_id = p_store),
    (SELECT m.currency FROM commerce.markets m JOIN commerce.stores s ON s.id = m.store_id
      WHERE m.store_id = p_store AND m.active
      ORDER BY (m.code = s.country) DESC NULLS LAST, m.created_at, m.code LIMIT 1),
    'EUR')::char(3)
$$;
--> statement-breakpoint

-- An amount in one currency's minor units as another's, at the store's rates (units per 1 EUR), rounded down; null when
-- there is no rate. Every currency a store can offer has two minor-unit digits (src/lib/money.ts), so the rates alone
-- convert; src/lib/bonus.ts converts the same way for what the screens show.
CREATE FUNCTION commerce.bonus_convert(p_store uuid, p_amount bigint, p_from char(3), p_to char(3))
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_from numeric;
  v_to numeric;
BEGIN
  IF p_from = p_to THEN
    RETURN p_amount;
  END IF;
  v_from := CASE WHEN p_from = 'EUR' THEN 1 ELSE
    (SELECT c.rate FROM commerce.store_currencies c WHERE c.store_id = p_store AND c.currency = p_from) END;
  v_to := CASE WHEN p_to = 'EUR' THEN 1 ELSE
    (SELECT c.rate FROM commerce.store_currencies c WHERE c.store_id = p_store AND c.currency = p_to) END;
  IF v_from IS NULL OR v_to IS NULL OR v_from <= 0 OR v_to <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN floor(p_amount::numeric * v_to / v_from)::bigint;
END;
$$;
--> statement-breakpoint

-- A customer's lots with what is left of each.
CREATE FUNCTION commerce.bonus_lots(p_store uuid, p_customer uuid)
RETURNS TABLE (id uuid, amount_minor bigint, remaining bigint, available_at timestamptz, expires_at timestamptz, created_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT e.id, e.amount_minor,
         (e.amount_minor - coalesce((SELECT sum(a.amount_minor) FROM commerce.bonus_allocations a
                                      WHERE a.store_id = e.store_id AND a.lot_id = e.id), 0))::bigint,
         e.available_at, e.expires_at, e.created_at
    FROM commerce.bonus_entries e
   WHERE e.store_id = p_store AND e.customer_id = p_customer AND e.amount_minor > 0
$$;
--> statement-breakpoint

-- The lots a scope can take from, in the order they are used: 'available' (usable now), 'any' (usable now, then
-- pending ones), or 'lot' (one lot, whatever its dates: a grant taken back, or an expired one).
CREATE FUNCTION commerce.bonus_usable_lots(p_store uuid, p_customer uuid, p_scope text, p_lot uuid)
RETURNS TABLE (id uuid, remaining bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT l.id, l.remaining
    FROM commerce.bonus_lots(p_store, p_customer) l
   WHERE l.remaining > 0
     AND CASE p_scope
           WHEN 'available' THEN l.available_at <= now() AND (l.expires_at IS NULL OR l.expires_at > now())
           WHEN 'any' THEN l.expires_at IS NULL OR l.expires_at > now()
           ELSE l.id = p_lot
         END
   ORDER BY (l.available_at <= now()) DESC, coalesce(l.expires_at, 'infinity'::timestamptz), l.available_at, l.created_at, l.id
$$;
--> statement-breakpoint

-- A customer's balance now: usable, pending (and when the next of it becomes usable), and the credits that expire next. Expired credits no longer count, before
-- the job that writes their entries has run.
CREATE FUNCTION commerce.bonus_balance(p_store uuid, p_customer uuid)
RETURNS TABLE (available_minor bigint, pending_minor bigint, expiring_minor bigint, expiring_at timestamptz, pending_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH l AS (
    SELECT * FROM commerce.bonus_lots(p_store, p_customer) x
     WHERE x.remaining > 0 AND (x.expires_at IS NULL OR x.expires_at > now())
  ), soon AS (SELECT min(expires_at) AS at FROM l WHERE expires_at IS NOT NULL)
  SELECT coalesce(sum(l.remaining) FILTER (WHERE l.available_at <= now()), 0)::bigint,
         coalesce(sum(l.remaining) FILTER (WHERE l.available_at > now()), 0)::bigint,
         coalesce((SELECT sum(l2.remaining) FROM l l2, soon WHERE l2.expires_at = soon.at), 0)::bigint,
         (SELECT at FROM soon),
         min(l.available_at) FILTER (WHERE l.available_at > now())
    FROM l
$$;
--> statement-breakpoint

-- The invariant: the ledger's sum equals what the lots hold (and so, with the expired not yet written off, the balance).
CREATE FUNCTION commerce.bonus_verify(p_store uuid, p_customer uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce((SELECT sum(e.amount_minor) FROM commerce.bonus_entries e
                    WHERE e.store_id = p_store AND e.customer_id = p_customer), 0)
       = coalesce((SELECT sum(l.remaining) FROM commerce.bonus_lots(p_store, p_customer) l), 0)
     AND NOT EXISTS (SELECT 1 FROM commerce.bonus_lots(p_store, p_customer) l WHERE l.remaining < 0)
$$;
--> statement-breakpoint

-- When credits granted at `p_from` expire, by the store's setting now; null for never.
CREATE FUNCTION commerce.bonus_expiry_from(p_store uuid, p_from timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN b.expires_months IS NULL THEN NULL ELSE p_from + make_interval(months => b.expires_months) END
    FROM commerce.bonus_settings b WHERE b.store_id = p_store
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Writing: each holds the customer's row lock and happens once per key
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.bonus_lock(p_store uuid, p_customer uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM commerce.customers c WHERE c.store_id = p_store AND c.id = p_customer FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bonus.no_customer';
  END IF;
END;
$$;
--> statement-breakpoint

-- A grant: a new lot. Returns its id (the earlier one, when the key was used).
CREATE FUNCTION commerce.bonus_grant(
  p_store uuid, p_customer uuid, p_kind text, p_amount bigint, p_order uuid, p_refund uuid,
  p_available_at timestamptz, p_expires_at timestamptz, p_note text, p_by uuid, p_key text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM commerce.bonus_lock(p_store, p_customer);
  SELECT e.id INTO v_id FROM commerce.bonus_entries e WHERE e.store_id = p_store AND e.idempotency_key = p_key;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  IF p_amount <= 0 THEN
    RETURN NULL;
  END IF;
  INSERT INTO commerce.bonus_entries (
    store_id, customer_id, kind, amount_minor, order_id, refund_id, available_at, expires_at, note, created_by, idempotency_key
  ) VALUES (
    p_store, p_customer, p_kind, p_amount, p_order, p_refund, p_available_at, p_expires_at, coalesce(p_note, ''), p_by, p_key
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- A use, a take-back or an expiry: a negative entry paid out of lots, never more than they hold (`p_exact` refuses
-- instead of taking less). Returns what was taken, positive; nothing is written for 0.
CREATE FUNCTION commerce.bonus_take(
  p_store uuid, p_customer uuid, p_kind text, p_amount bigint, p_scope text, p_lot uuid,
  p_order uuid, p_refund uuid, p_note text, p_by uuid, p_key text, p_exact boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_done bigint;
  v_room bigint;
  v_amount bigint;
  v_id uuid;
  v_lot record;
  v_left bigint;
  v_take bigint;
BEGIN
  PERFORM commerce.bonus_lock(p_store, p_customer);
  SELECT -e.amount_minor INTO v_done FROM commerce.bonus_entries e WHERE e.store_id = p_store AND e.idempotency_key = p_key;
  IF FOUND THEN
    RETURN v_done;
  END IF;
  IF p_amount <= 0 THEN
    RETURN 0;
  END IF;
  SELECT coalesce(sum(u.remaining), 0) INTO v_room FROM commerce.bonus_usable_lots(p_store, p_customer, p_scope, p_lot) u;
  v_amount := least(p_amount, v_room);
  IF p_exact AND v_amount < p_amount THEN
    RAISE EXCEPTION 'bonus.insufficient';
  END IF;
  IF v_amount <= 0 THEN
    RETURN 0;
  END IF;
  INSERT INTO commerce.bonus_entries (store_id, customer_id, kind, amount_minor, order_id, refund_id, note, created_by, idempotency_key)
  VALUES (p_store, p_customer, p_kind, -v_amount, p_order, p_refund, coalesce(p_note, ''), p_by, p_key)
  RETURNING id INTO v_id;
  v_left := v_amount;
  FOR v_lot IN SELECT u.id, u.remaining FROM commerce.bonus_usable_lots(p_store, p_customer, p_scope, p_lot) u LOOP
    EXIT WHEN v_left = 0;
    v_take := least(v_lot.remaining, v_left);
    INSERT INTO commerce.bonus_allocations (store_id, lot_id, entry_id, amount_minor) VALUES (p_store, v_lot.id, v_id, v_take);
    v_left := v_left - v_take;
  END LOOP;
  RETURN v_amount;
END;
$$;
--> statement-breakpoint

-- Credits used on an order: held against it while it waits for payment. Refused when the program is off or the
-- customer has less usable than asked.
CREATE FUNCTION commerce.bonus_redeem(p_store uuid, p_customer uuid, p_order uuid, p_amount bigint, p_key text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.bonus_entries e WHERE e.store_id = p_store AND e.idempotency_key = p_key)
     AND NOT coalesce((SELECT b.enabled FROM commerce.bonus_settings b WHERE b.store_id = p_store), false) THEN
    RAISE EXCEPTION 'bonus.off';
  END IF;
  RETURN commerce.bonus_take(p_store, p_customer, 'redeem', p_amount, 'available', NULL, p_order, NULL, '', NULL, p_key, true);
END;
$$;
--> statement-breakpoint

-- Staff add or remove credits, with a reason. Adding follows the store's expiry; removing never goes below zero.
CREATE FUNCTION commerce.bonus_adjust(p_store uuid, p_customer uuid, p_amount bigint, p_note text, p_by uuid, p_key text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'bonus.zero';
  END IF;
  IF p_amount > 0 THEN
    PERFORM commerce.bonus_grant(p_store, p_customer, 'adjust', p_amount, NULL, NULL, now(),
                                 commerce.bonus_expiry_from(p_store, now()), p_note, p_by, p_key);
    RETURN p_amount;
  END IF;
  RETURN -commerce.bonus_take(p_store, p_customer, 'adjust', -p_amount, 'any', NULL, NULL, NULL, p_note, p_by, p_key, true);
END;
$$;
--> statement-breakpoint

-- Credits that passed their expiry unused are written off, oldest first. Run by the five-minute cron.
CREATE FUNCTION commerce.bonus_expire_due(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_lot record;
  v_left bigint;
  v_count integer := 0;
BEGIN
  FOR v_lot IN
    SELECT e.store_id, e.customer_id, e.id
      FROM commerce.bonus_entries e
     WHERE e.amount_minor > 0 AND e.expires_at IS NOT NULL AND e.expires_at <= now()
       AND e.amount_minor > coalesce((SELECT sum(a.amount_minor) FROM commerce.bonus_allocations a
                                       WHERE a.store_id = e.store_id AND a.lot_id = e.id), 0)
     ORDER BY e.expires_at, e.id
     LIMIT p_limit
  LOOP
    SELECT l.remaining INTO v_left FROM commerce.bonus_lots(v_lot.store_id, v_lot.customer_id) l WHERE l.id = v_lot.id;
    IF commerce.bonus_take(v_lot.store_id, v_lot.customer_id, 'expire', coalesce(v_left, 0), 'lot', v_lot.id,
                           NULL, NULL, '', NULL, 'expire:' || v_lot.id) > 0 THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
--> statement-breakpoint

-- Customers with credits that expire within `p_days`: when the first of them do, and how much expires up to and
-- including the window's end. One row per customer; the caller sends one reminder per customer and date.
CREATE FUNCTION commerce.bonus_expiring(p_days integer)
RETURNS TABLE (store_id uuid, customer_id uuid, first_at timestamptz, amount_minor bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT x.store_id, x.customer_id, min(x.expires_at), sum(x.remaining)::bigint
    FROM (
      SELECT e.store_id, e.customer_id, e.expires_at,
             e.amount_minor - coalesce((SELECT sum(a.amount_minor) FROM commerce.bonus_allocations a
                                         WHERE a.store_id = e.store_id AND a.lot_id = e.id), 0) AS remaining
        FROM commerce.bonus_entries e
       WHERE e.amount_minor > 0 AND e.expires_at > now() AND e.expires_at <= now() + make_interval(days => p_days)
    ) x
   WHERE x.remaining > 0
   GROUP BY x.store_id, x.customer_id
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- What orders do to the ledger
-- ---------------------------------------------------------------------------

-- What an order has used, net of what has come back: the credits it holds, in the credits' currency.
CREATE FUNCTION commerce.bonus_order_held(p_order uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(-sum(e.amount_minor) FILTER (WHERE e.kind IN ('redeem', 'restore')), 0)::bigint
    FROM commerce.bonus_entries e WHERE e.order_id = p_order
$$;
--> statement-breakpoint

-- An order was paid (or paid after it had been cancelled): the credits it used are taken again if they had come back,
-- and, when the customer is signed in and the program is on, it earns credits on what was paid online for goods, VAT
-- included, without shipping, what is left for the venue and the credits used. They are usable after the return period.
CREATE FUNCTION commerce.bonus_order_paid(p_order uuid, p_was text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_o commerce.orders%ROWTYPE;
  v_s commerce.bonus_settings%ROWTYPE;
  v_used bigint;
  v_need bigint;
  v_taken bigint;
  v_base bigint;
  v_earn bigint;
  v_credits bigint;
  v_at timestamptz;
BEGIN
  SELECT * INTO v_o FROM commerce.orders WHERE id = p_order;
  IF NOT FOUND OR v_o.customer_id IS NULL OR v_o.copied_from IS NOT NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.customers c WHERE c.store_id = v_o.store_id AND c.id = v_o.customer_id) THEN
    RETURN;
  END IF;
  -- Paid after it was cancelled: the credits that came back are taken again, as far as the customer still has them.
  IF p_was = 'cancelled' THEN
    SELECT coalesce(-e.amount_minor, 0) INTO v_used FROM commerce.bonus_entries e
     WHERE e.store_id = v_o.store_id AND e.idempotency_key = 'redeem:' || p_order;
    v_need := coalesce(v_used, 0) - commerce.bonus_order_held(p_order);
    IF v_need > 0 THEN
      v_taken := commerce.bonus_take(v_o.store_id, v_o.customer_id, 'redeem', v_need, 'available', NULL, p_order, NULL,
                                     'paid after the order was cancelled', NULL,
                                     'redeem-late:' || p_order || ':' || (SELECT count(*) FROM commerce.bonus_entries e
                                                                            WHERE e.order_id = p_order AND e.kind = 'redeem'));
      IF v_taken < v_need THEN
        INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
        VALUES (v_o.store_id, p_order, 'bonus.short', jsonb_build_object('missing', v_need - v_taken), 'system');
      END IF;
    END IF;
  END IF;
  -- A host is the seller of their own bookings (D71): the store's credits are not theirs to give or take.
  IF v_o.host_id IS NOT NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_s FROM commerce.bonus_settings WHERE store_id = v_o.store_id;
  IF NOT FOUND OR NOT v_s.enabled THEN
    RETURN;
  END IF;
  SELECT coalesce(sum(ol.total_minor - ol.venue_minor), 0) INTO v_base
    FROM commerce.order_lines ol WHERE ol.store_id = v_o.store_id AND ol.order_id = p_order;
  v_earn := floor(v_base::numeric * v_s.earn_bps / 10000)::bigint;
  IF v_earn <= 0 THEN
    RETURN;
  END IF;
  v_credits := commerce.bonus_convert(v_o.store_id, v_earn, v_o.currency, v_s.currency);
  IF v_credits IS NULL OR v_credits <= 0 THEN
    RETURN;
  END IF;
  v_at := now() + make_interval(days => v_s.pending_days);
  PERFORM commerce.bonus_grant(v_o.store_id, v_o.customer_id, 'earn', v_credits, p_order, NULL, v_at,
                               commerce.bonus_expiry_from(v_o.store_id, v_at), '', NULL, 'earn:' || p_order);
  UPDATE commerce.orders SET bonus_earned_minor = v_earn, bonus_available_at = v_at WHERE id = p_order;
END;
$$;
--> statement-breakpoint

-- Credits come back to the customer as a new lot that is usable at once, expiring as the store's setting says now.
CREATE FUNCTION commerce.bonus_restore(p_order uuid, p_amount bigint, p_refund uuid, p_key text, p_note text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_o commerce.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_o FROM commerce.orders WHERE id = p_order;
  IF NOT FOUND OR v_o.customer_id IS NULL OR p_amount <= 0 THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.customers c WHERE c.store_id = v_o.store_id AND c.id = v_o.customer_id) THEN
    RETURN 0;
  END IF;
  PERFORM commerce.bonus_grant(v_o.store_id, v_o.customer_id, 'restore', p_amount, p_order, p_refund, now(),
                               commerce.bonus_expiry_from(v_o.store_id, now()), p_note, NULL, p_key);
  RETURN p_amount;
END;
$$;
--> statement-breakpoint

-- An unpaid order was cancelled: the credits held against it come back.
CREATE FUNCTION commerce.bonus_order_unpaid_cancelled(p_order uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.bonus_restore(p_order, commerce.bonus_order_held(p_order), NULL, 'restore-unpaid:' || p_order,
                                 'the order was not paid');
END;
$$;
--> statement-breakpoint

-- A paid order was cancelled: what is left of the credits it earned is taken back (never below zero: what was used
-- stays used), and what is left of the credits it used comes back.
CREATE FUNCTION commerce.bonus_order_paid_cancelled(p_order uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_o commerce.orders%ROWTYPE;
  v_lot uuid;
  v_left bigint;
BEGIN
  SELECT * INTO v_o FROM commerce.orders WHERE id = p_order;
  IF NOT FOUND OR v_o.customer_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.customers c WHERE c.store_id = v_o.store_id AND c.id = v_o.customer_id) THEN
    RETURN;
  END IF;
  SELECT e.id INTO v_lot FROM commerce.bonus_entries e WHERE e.store_id = v_o.store_id AND e.idempotency_key = 'earn:' || p_order;
  IF v_lot IS NOT NULL THEN
    SELECT l.remaining INTO v_left FROM commerce.bonus_lots(v_o.store_id, v_o.customer_id) l WHERE l.id = v_lot;
    PERFORM commerce.bonus_take(v_o.store_id, v_o.customer_id, 'reverse', coalesce(v_left, 0), 'lot', v_lot, p_order, NULL,
                                'the order was cancelled', NULL, 'reverse-cancel:' || p_order);
  END IF;
  PERFORM commerce.bonus_restore(p_order, commerce.bonus_order_held(p_order), NULL, 'restore-cancel:' || p_order,
                                 'the order was cancelled');
END;
$$;
--> statement-breakpoint

-- Money went back for an order: the refunded share of the credits it earned is taken back (what is left of them, never
-- below zero) and the refunded share of the credits it used comes back. The share is what has been refunded in all of
-- what was paid online; the whole of each when it is all refunded. Counted against what each has had so far, so refunds
-- add up to exactly the whole however they are cut.
CREATE FUNCTION commerce.bonus_refund_applied(p_refund uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_r commerce.refunds%ROWTYPE;
  v_o commerce.orders%ROWTYPE;
  v_paid bigint;
  v_refunded bigint;
  v_lot uuid;
  v_granted bigint;
  v_target bigint;
  v_done bigint;
  v_used bigint;
BEGIN
  SELECT * INTO v_r FROM commerce.refunds WHERE id = p_refund;
  IF NOT FOUND OR v_r.status = 'failed' THEN
    RETURN;
  END IF;
  SELECT o.* INTO v_o FROM commerce.orders o
    JOIN commerce.payments p ON p.store_id = o.store_id AND p.order_id = o.id
   WHERE p.store_id = v_r.store_id AND p.id = v_r.payment_id;
  IF NOT FOUND OR v_o.customer_id IS NULL OR v_o.copied_from IS NOT NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.customers c WHERE c.store_id = v_o.store_id AND c.id = v_o.customer_id) THEN
    RETURN;
  END IF;
  SELECT coalesce(sum(p.amount_minor), 0) INTO v_paid FROM commerce.payments p
   WHERE p.store_id = v_o.store_id AND p.order_id = v_o.id AND p.status = 'captured' AND p.provider = 'stripe';
  SELECT coalesce(sum(r.amount_minor), 0) INTO v_refunded FROM commerce.refunds r
    JOIN commerce.payments p ON p.store_id = r.store_id AND p.id = r.payment_id
   WHERE p.store_id = v_o.store_id AND p.order_id = v_o.id AND r.status <> 'failed';
  IF v_paid <= 0 THEN
    RETURN;
  END IF;

  SELECT e.id, e.amount_minor INTO v_lot, v_granted FROM commerce.bonus_entries e
   WHERE e.store_id = v_o.store_id AND e.idempotency_key = 'earn:' || v_o.id;
  IF v_lot IS NOT NULL THEN
    v_target := CASE WHEN v_refunded >= v_paid THEN v_granted ELSE floor(v_granted::numeric * v_refunded / v_paid)::bigint END;
    SELECT coalesce(-sum(e.amount_minor), 0) INTO v_done FROM commerce.bonus_entries e
     WHERE e.store_id = v_o.store_id AND e.order_id = v_o.id AND e.kind = 'reverse';
    PERFORM commerce.bonus_take(v_o.store_id, v_o.customer_id, 'reverse', v_target - v_done, 'lot', v_lot, v_o.id, p_refund,
                                'refunded', NULL, 'reverse:' || p_refund);
  END IF;

  SELECT coalesce(-e.amount_minor, 0) INTO v_used FROM commerce.bonus_entries e
   WHERE e.store_id = v_o.store_id AND e.idempotency_key = 'redeem:' || v_o.id;
  IF coalesce(v_used, 0) > 0 THEN
    v_target := CASE WHEN v_refunded >= v_paid THEN v_used ELSE floor(v_used::numeric * v_refunded / v_paid)::bigint END;
    SELECT coalesce(sum(e.amount_minor), 0) INTO v_done FROM commerce.bonus_entries e
     WHERE e.store_id = v_o.store_id AND e.order_id = v_o.id AND e.kind = 'restore';
    PERFORM commerce.bonus_restore(v_o.id, v_target - v_done, p_refund, 'restore:' || p_refund, 'refunded');
  END IF;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.orders_bonus()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.copied_from IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'paid' AND OLD.status IN ('pending_payment', 'cancelled') THEN
    PERFORM commerce.bonus_order_paid(NEW.id, OLD.status::text);
  ELSIF NEW.status = 'cancelled' AND OLD.status = 'pending_payment' THEN
    PERFORM commerce.bonus_order_unpaid_cancelled(NEW.id);
  ELSIF NEW.status = 'cancelled' AND OLD.status IN ('paid', 'fulfilled') THEN
    PERFORM commerce.bonus_order_paid_cancelled(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_bonus AFTER UPDATE OF status ON commerce.orders
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION commerce.orders_bonus();
--> statement-breakpoint

CREATE FUNCTION commerce.refunds_bonus()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.bonus_refund_applied(NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refunds_bonus AFTER INSERT ON commerce.refunds
  FOR EACH ROW EXECUTE FUNCTION commerce.refunds_bonus();
