-- Kaizen's referral program (D131, docs/referrals.md): store owners refer other store owners and earn credit, per
-- currency, against their own Kaizen plan invoices, worth a share of the fees the referred store pays Kaizen: its plan
-- invoices (set by the server from Stripe's invoices) and Kaizen's sale fee on its orders (set here, by a trigger on
-- payments).
--
-- The ledger is the bonus ledger's (D130, `bonus_program_rules`) for an account and a currency instead of a customer: a
-- positive entry is a *lot* (credit usable from `available_at`), a negative entry is paid out of lots through
-- `referral_allocations`, usable lots first and the oldest first, so what is left of a lot and an account's balance are
-- always worked out from the ledger and never below zero. Every writer is a `commerce.referral_*` function holding the
-- account's advisory lock, and each entry carries an idempotency key, so it happens once.

ALTER TABLE commerce.referral_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.referrers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.referrals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.referral_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.referral_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.referral_visits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Append-only, and always within what a lot holds
-- ---------------------------------------------------------------------------

-- No change to an entry, and no delete but the account's own deletion (its ledger goes with it).
CREATE FUNCTION commerce.referral_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'referral_entries' THEN
      IF NOT EXISTS (SELECT 1 FROM commerce.accounts a WHERE a.id = OLD.account_id) THEN
        RETURN OLD;
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM commerce.referral_entries e WHERE e.id = OLD.entry_id) THEN
      -- An allocation goes with the entry that took the credit.
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'commerce.% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER referral_entries_immutable BEFORE UPDATE OR DELETE ON commerce.referral_entries
  FOR EACH ROW EXECUTE FUNCTION commerce.referral_ledger_immutable();
--> statement-breakpoint
CREATE TRIGGER referral_allocations_immutable BEFORE UPDATE OR DELETE ON commerce.referral_allocations
  FOR EACH ROW EXECUTE FUNCTION commerce.referral_ledger_immutable();
--> statement-breakpoint

-- An allocation takes from a positive entry (a lot) of the same account and currency, for a negative one, and never more
-- than the lot holds: a balance cannot go negative, whatever writes to the ledger.
CREATE FUNCTION commerce.referral_allocation_within_lot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_lot commerce.referral_entries%ROWTYPE;
  v_entry commerce.referral_entries%ROWTYPE;
  v_taken bigint;
BEGIN
  SELECT * INTO v_lot FROM commerce.referral_entries WHERE id = NEW.lot_id;
  SELECT * INTO v_entry FROM commerce.referral_entries WHERE id = NEW.entry_id;
  IF v_lot.amount_minor IS NULL OR v_entry.amount_minor IS NULL OR v_lot.amount_minor <= 0 OR v_entry.amount_minor >= 0
     OR v_lot.account_id <> v_entry.account_id OR v_lot.currency <> v_entry.currency THEN
    RAISE EXCEPTION 'referral.bad_allocation' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(a.amount_minor), 0) INTO v_taken FROM commerce.referral_allocations a WHERE a.lot_id = NEW.lot_id;
  IF v_taken > v_lot.amount_minor THEN
    RAISE EXCEPTION 'referral.below_zero' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER referral_allocations_within_lot AFTER INSERT ON commerce.referral_allocations
  FOR EACH ROW EXECUTE FUNCTION commerce.referral_allocation_within_lot();
--> statement-breakpoint

-- Every negative entry is paid in full out of lots by the time the transaction ends.
CREATE FUNCTION commerce.referral_entry_fully_allocated()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_taken bigint;
BEGIN
  IF NEW.amount_minor < 0 THEN
    SELECT coalesce(sum(a.amount_minor), 0) INTO v_taken FROM commerce.referral_allocations a WHERE a.entry_id = NEW.id;
    IF v_taken <> -NEW.amount_minor THEN
      RAISE EXCEPTION 'referral.below_zero' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER referral_entries_fully_allocated AFTER INSERT ON commerce.referral_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.referral_entry_fully_allocated();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The program and reading the ledger
-- ---------------------------------------------------------------------------

-- The program's settings now: the one row, or the defaults (program off) while there is none.
CREATE FUNCTION commerce.referral_program()
RETURNS TABLE (enabled boolean, commission_bps integer, months integer, pending_days integer, cookie_days integer)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(s.enabled, false), coalesce(s.commission_bps, 1000), coalesce(s.months, 12),
         coalesce(s.pending_days, 30), coalesce(s.cookie_days, 30)
    FROM (SELECT 1) one LEFT JOIN commerce.referral_settings s ON true
$$;
--> statement-breakpoint

-- An account's lots in a currency, with what is left of each.
CREATE FUNCTION commerce.referral_lots(p_account uuid, p_currency char(3))
RETURNS TABLE (id uuid, amount_minor bigint, remaining bigint, available_at timestamptz, created_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT e.id, e.amount_minor,
         (e.amount_minor - coalesce((SELECT sum(a.amount_minor) FROM commerce.referral_allocations a WHERE a.lot_id = e.id), 0))::bigint,
         e.available_at, e.created_at
    FROM commerce.referral_entries e
   WHERE e.account_id = p_account AND e.currency = p_currency AND e.amount_minor > 0
$$;
--> statement-breakpoint

-- The lots a scope can take from, in the order they are used: 'available' (usable now), 'any' (usable now, then the
-- pending ones) or 'lot' (one lot, whatever its date: a fee taken back).
CREATE FUNCTION commerce.referral_usable_lots(p_account uuid, p_currency char(3), p_scope text, p_lot uuid)
RETURNS TABLE (id uuid, remaining bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT l.id, l.remaining
    FROM commerce.referral_lots(p_account, p_currency) l
   WHERE l.remaining > 0
     AND CASE p_scope
           WHEN 'available' THEN l.available_at <= now()
           WHEN 'any' THEN true
           ELSE l.id = p_lot
         END
   ORDER BY (l.available_at <= now()) DESC, l.available_at, l.created_at, l.id
$$;
--> statement-breakpoint

-- An account's balance per currency now: usable, pending, and when the next of the pending becomes usable.
CREATE FUNCTION commerce.referral_balance(p_account uuid)
RETURNS TABLE (currency char(3), available_minor bigint, pending_minor bigint, pending_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT c.currency,
         coalesce(sum(l.remaining) FILTER (WHERE l.available_at <= now()), 0)::bigint,
         coalesce(sum(l.remaining) FILTER (WHERE l.available_at > now()), 0)::bigint,
         min(l.available_at) FILTER (WHERE l.available_at > now() AND l.remaining > 0)
    FROM (SELECT DISTINCT e.currency FROM commerce.referral_entries e WHERE e.account_id = p_account) c
    CROSS JOIN LATERAL commerce.referral_lots(p_account, c.currency) l
   WHERE l.remaining > 0
   GROUP BY c.currency
$$;
--> statement-breakpoint

-- The invariant: per currency the ledger's sum equals what the lots hold, and no lot is over-allocated.
CREATE FUNCTION commerce.referral_verify(p_account uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM (SELECT DISTINCT e.currency FROM commerce.referral_entries e WHERE e.account_id = p_account) c
     WHERE coalesce((SELECT sum(e.amount_minor) FROM commerce.referral_entries e
                      WHERE e.account_id = p_account AND e.currency = c.currency), 0)
        <> coalesce((SELECT sum(l.remaining) FROM commerce.referral_lots(p_account, c.currency) l), 0)
        OR EXISTS (SELECT 1 FROM commerce.referral_lots(p_account, c.currency) l WHERE l.remaining < 0)
  )
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Writing: each holds the account's lock and happens once per key
-- ---------------------------------------------------------------------------

-- One writer at a time per account, until the transaction ends.
CREATE FUNCTION commerce.referral_lock(p_account uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('kaizen:referral:' || p_account::text, 0));
END;
$$;
--> statement-breakpoint

-- A grant: a new lot. Returns its id (the earlier one, when the key was used); null when there is nothing to grant.
CREATE FUNCTION commerce.referral_grant(
  p_account uuid, p_currency char(3), p_kind text, p_amount bigint, p_source_kind text, p_source_ref text,
  p_referral uuid, p_invoice_ref text, p_available_at timestamptz, p_note text, p_by uuid, p_key text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM commerce.referral_lock(p_account);
  SELECT e.id INTO v_id FROM commerce.referral_entries e WHERE e.idempotency_key = p_key;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  IF p_amount <= 0 THEN
    RETURN NULL;
  END IF;
  INSERT INTO commerce.referral_entries (
    account_id, currency, kind, amount_minor, source_kind, source_ref, referral_id, invoice_ref, available_at, note,
    created_by, idempotency_key
  ) VALUES (
    p_account, p_currency, p_kind, p_amount, p_source_kind, p_source_ref, p_referral, p_invoice_ref, p_available_at,
    left(coalesce(p_note, ''), 500), p_by, p_key
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- A use, a take-back or a removal: a negative entry paid out of lots, never more than they hold (`p_exact` refuses
-- instead of taking less). Returns what was taken, positive (the earlier amount, when the key was used); nothing is
-- written for 0.
CREATE FUNCTION commerce.referral_take(
  p_account uuid, p_currency char(3), p_kind text, p_amount bigint, p_scope text, p_lot uuid,
  p_source_kind text, p_source_ref text, p_referral uuid, p_invoice_ref text, p_note text, p_by uuid, p_key text,
  p_exact boolean DEFAULT false
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
  PERFORM commerce.referral_lock(p_account);
  SELECT -e.amount_minor INTO v_done FROM commerce.referral_entries e WHERE e.idempotency_key = p_key;
  IF FOUND THEN
    RETURN v_done;
  END IF;
  IF p_amount <= 0 THEN
    RETURN 0;
  END IF;
  SELECT coalesce(sum(u.remaining), 0) INTO v_room FROM commerce.referral_usable_lots(p_account, p_currency, p_scope, p_lot) u;
  v_amount := least(p_amount, v_room);
  IF p_exact AND v_amount < p_amount THEN
    RAISE EXCEPTION 'referral.insufficient';
  END IF;
  IF v_amount <= 0 THEN
    RETURN 0;
  END IF;
  INSERT INTO commerce.referral_entries (
    account_id, currency, kind, amount_minor, source_kind, source_ref, referral_id, invoice_ref, note, created_by, idempotency_key
  ) VALUES (
    p_account, p_currency, p_kind, -v_amount, p_source_kind, p_source_ref, p_referral, p_invoice_ref,
    left(coalesce(p_note, ''), 500), p_by, p_key
  ) RETURNING id INTO v_id;
  v_left := v_amount;
  FOR v_lot IN SELECT u.id, u.remaining FROM commerce.referral_usable_lots(p_account, p_currency, p_scope, p_lot) u LOOP
    EXIT WHEN v_left = 0;
    v_take := least(v_lot.remaining, v_left);
    INSERT INTO commerce.referral_allocations (lot_id, entry_id, amount_minor) VALUES (v_lot.id, v_id, v_take);
    v_left := v_left - v_take;
  END LOOP;
  RETURN v_amount;
END;
$$;
--> statement-breakpoint

-- A fee the referred store paid earns its referrer commission, once per source: when the program is on, the referral is
-- active, its referrer is not blocked and the fee was paid inside the referral's months. Returns the commission
-- granted (0 for none; the earlier amount when the source had earned already). Never converted: the commission is in
-- the fee's own currency, usable after the pending days.
CREATE FUNCTION commerce.referral_earn(
  p_store uuid, p_fee_minor bigint, p_currency char(3), p_source_kind text, p_source_ref text, p_note text,
  p_at timestamptz DEFAULT now()
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_ref commerce.referrals%ROWTYPE;
  v_program record;
  v_earn bigint;
  v_id uuid;
BEGIN
  SELECT * INTO v_ref FROM commerce.referrals r WHERE r.store_id = p_store;
  IF NOT FOUND OR v_ref.status <> 'active' OR p_fee_minor IS NULL OR p_fee_minor <= 0 THEN
    RETURN 0;
  END IF;
  SELECT e.amount_minor INTO v_earn FROM commerce.referral_entries e WHERE e.idempotency_key = p_source_kind || ':' || p_source_ref;
  IF FOUND THEN
    RETURN v_earn;
  END IF;
  SELECT * INTO v_program FROM commerce.referral_program();
  IF NOT v_program.enabled THEN
    RETURN 0;
  END IF;
  IF p_at < v_ref.created_at OR p_at >= v_ref.created_at + make_interval(months => v_ref.months) THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM commerce.referrers r WHERE r.account_id = v_ref.referrer_account_id AND r.blocked_at IS NOT NULL) THEN
    RETURN 0;
  END IF;
  v_earn := floor(p_fee_minor::numeric * v_ref.commission_bps / 10000)::bigint;
  IF v_earn <= 0 THEN
    RETURN 0;
  END IF;
  v_id := commerce.referral_grant(v_ref.referrer_account_id, p_currency, 'earn', v_earn, p_source_kind, p_source_ref, v_ref.id,
                                  NULL, p_at + make_interval(days => v_program.pending_days), p_note, NULL,
                                  p_source_kind || ':' || p_source_ref);
  RETURN CASE WHEN v_id IS NULL THEN 0 ELSE v_earn END;
END;
$$;
--> statement-breakpoint

-- A fee was refunded (or credited back): the referrer gives back the share of what it earned, as far as they still have
-- it (never below zero: what was used stays used). `p_num`/`p_den` is the share of the fee refunded; with
-- `p_cumulative` it is what has been refunded in all so far (the entry takes the difference from what was taken
-- already), else this refund's alone. A whole fee refunded takes the rest of the commission, however it was cut.
CREATE FUNCTION commerce.referral_reverse(
  p_source_kind text, p_source_ref text, p_num bigint, p_den bigint, p_cumulative boolean, p_key text, p_note text
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_lot commerce.referral_entries%ROWTYPE;
  v_done bigint;
  v_target bigint;
  v_amount bigint;
BEGIN
  SELECT * INTO v_lot FROM commerce.referral_entries e
   WHERE e.idempotency_key = p_source_kind || ':' || p_source_ref AND e.amount_minor > 0;
  IF NOT FOUND OR p_den <= 0 OR p_num <= 0 THEN
    RETURN 0;
  END IF;
  PERFORM commerce.referral_lock(v_lot.account_id);
  SELECT coalesce(-sum(e.amount_minor), 0) INTO v_done FROM commerce.referral_entries e
   WHERE e.account_id = v_lot.account_id AND e.kind = 'reverse' AND e.source_kind = p_source_kind AND e.source_ref = p_source_ref;
  v_target := CASE WHEN p_num >= p_den THEN v_lot.amount_minor ELSE floor(v_lot.amount_minor::numeric * p_num / p_den)::bigint END;
  v_amount := CASE WHEN p_cumulative THEN v_target - v_done ELSE least(v_target, v_lot.amount_minor - v_done) END;
  IF v_amount <= 0 THEN
    RETURN 0;
  END IF;
  RETURN commerce.referral_take(v_lot.account_id, v_lot.currency, 'reverse', v_amount, 'lot', v_lot.id, p_source_kind, p_source_ref,
                                v_lot.referral_id, NULL, p_note, NULL, p_key);
END;
$$;
--> statement-breakpoint

-- What has been put on an invoice and not given back: the credit it holds, in `p_currency`.
CREATE FUNCTION commerce.referral_invoice_held(p_account uuid, p_currency char(3), p_invoice_ref text)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(-sum(e.amount_minor), 0)::bigint FROM commerce.referral_entries e
   WHERE e.account_id = p_account AND e.currency = p_currency AND e.invoice_ref = p_invoice_ref AND e.kind IN ('apply', 'restore')
$$;
--> statement-breakpoint

-- Credit put on one of the account's own Kaizen plan invoices, at most `p_max` (the invoice's amount without VAT, which
-- the server works out) and what is usable now. Once per invoice: an invoice that already holds credit answers with it
-- and changes nothing, so a retry never applies twice. A blocked account's credit is not used. Returns what the invoice
-- holds (0 for none).
CREATE FUNCTION commerce.referral_apply_invoice(p_account uuid, p_currency char(3), p_invoice_ref text, p_max bigint)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_held bigint;
  v_n integer;
BEGIN
  PERFORM commerce.referral_lock(p_account);
  v_held := commerce.referral_invoice_held(p_account, p_currency, p_invoice_ref);
  IF v_held > 0 THEN
    RETURN v_held;
  END IF;
  IF p_max <= 0 OR EXISTS (SELECT 1 FROM commerce.referrers r WHERE r.account_id = p_account AND r.blocked_at IS NOT NULL) THEN
    RETURN 0;
  END IF;
  SELECT count(*) INTO v_n FROM commerce.referral_entries e
   WHERE e.account_id = p_account AND e.currency = p_currency AND e.invoice_ref = p_invoice_ref AND e.kind = 'apply';
  RETURN commerce.referral_take(p_account, p_currency, 'apply', p_max, 'available', NULL, 'invoice', p_invoice_ref, NULL, p_invoice_ref,
                                'Put on invoice ' || p_invoice_ref, NULL, 'apply:' || p_invoice_ref || ':' || v_n);
END;
$$;
--> statement-breakpoint

-- An invoice will not be paid with the credit (it was voided or deleted, or the credit never reached Stripe): what it
-- holds comes back as a new lot, usable at once. Returns what came back.
CREATE FUNCTION commerce.referral_restore_invoice(p_invoice_ref text, p_note text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_row record;
  v_held bigint;
  v_n integer;
  v_total bigint := 0;
BEGIN
  FOR v_row IN
    SELECT e.account_id, e.currency FROM commerce.referral_entries e
     WHERE e.invoice_ref = p_invoice_ref AND e.kind IN ('apply', 'restore') GROUP BY e.account_id, e.currency
  LOOP
    PERFORM commerce.referral_lock(v_row.account_id);
    v_held := commerce.referral_invoice_held(v_row.account_id, v_row.currency, p_invoice_ref);
    IF v_held > 0 THEN
      SELECT count(*) INTO v_n FROM commerce.referral_entries e
       WHERE e.account_id = v_row.account_id AND e.currency = v_row.currency AND e.invoice_ref = p_invoice_ref AND e.kind = 'restore';
      PERFORM commerce.referral_grant(v_row.account_id, v_row.currency, 'restore', v_held, 'invoice', p_invoice_ref, NULL,
                                      p_invoice_ref, now(), p_note, NULL, 'restore:' || p_invoice_ref || ':' || v_n);
      v_total := v_total + v_held;
    END IF;
  END LOOP;
  RETURN v_total;
END;
$$;
--> statement-breakpoint

-- Kaizen adds or removes credit with a reason. Adding is usable at once; removing takes usable credit first and is
-- refused rather than going below zero. The account must have a referral code.
CREATE FUNCTION commerce.referral_adjust(p_account uuid, p_currency char(3), p_amount bigint, p_note text, p_by uuid, p_key text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'referral.zero';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.referrers r WHERE r.account_id = p_account) THEN
    RAISE EXCEPTION 'referral.no_referrer';
  END IF;
  IF p_amount > 0 THEN
    PERFORM commerce.referral_grant(p_account, p_currency, 'adjust', p_amount, 'adjust', p_key, NULL, NULL, now(), p_note, p_by, p_key);
    RETURN p_amount;
  END IF;
  RETURN -commerce.referral_take(p_account, p_currency, 'adjust', -p_amount, 'any', NULL, 'adjust', p_key, NULL, NULL, p_note, p_by, p_key, true);
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- What the world does to the ledger
-- ---------------------------------------------------------------------------

-- A visit to a referral link, counted by day and code, with nothing about the visitor. Only for a code that exists and is
-- not blocked; returns whether it counted.
CREATE FUNCTION commerce.referral_visit(p_code text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.referrers r WHERE r.code = p_code AND r.blocked_at IS NULL) THEN
    RETURN false;
  END IF;
  INSERT INTO commerce.referral_visits (store_id, code, day, visits)
  VALUES (NULL, p_code, (now() AT TIME ZONE 'utc')::date, 1)
  ON CONFLICT (coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), code, day)
  DO UPDATE SET visits = commerce.referral_visits.visits + 1;
  RETURN true;
END;
$$;
--> statement-breakpoint

-- An access request was approved (its store made): with a code of a referrer, and the program on, the new store becomes
-- a referral, which freezes the rate and months as they are now. Nothing for a code nobody has, and none for the
-- referrer's own store: the requester's email is the referrer's, or the referrer is a member of the new store. A referral
-- is made once per store.
CREATE FUNCTION commerce.access_requests_referral()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_program record;
  v_referrer commerce.referrers%ROWTYPE;
BEGIN
  SELECT * INTO v_program FROM commerce.referral_program();
  IF NOT v_program.enabled THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_referrer FROM commerce.referrers r WHERE r.code = lower(trim(NEW.referral_code));
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM commerce.accounts a WHERE a.id = v_referrer.account_id AND lower(a.email) = lower(NEW.email))
     OR EXISTS (SELECT 1 FROM commerce.store_members m WHERE m.store_id = NEW.store_id AND m.account_id = v_referrer.account_id) THEN
    RETURN NULL;
  END IF;
  INSERT INTO commerce.referrals (referrer_account_id, store_id, access_request_id, commission_bps, months)
  VALUES (v_referrer.account_id, NEW.store_id, NEW.id, v_program.commission_bps, v_program.months)
  ON CONFLICT (store_id) DO NOTHING;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER access_requests_referral AFTER UPDATE OF store_id ON commerce.access_requests
  FOR EACH ROW WHEN (OLD.store_id IS NULL AND NEW.store_id IS NOT NULL AND NEW.referral_code IS NOT NULL)
  EXECUTE FUNCTION commerce.access_requests_referral();
--> statement-breakpoint

-- A payment was taken (inserted captured, or turned captured): Kaizen's sale fee in it earns the referrer of the store,
-- once per payment, never for an order copied by a store duplication (D129). A fault here must not stop a payment, so it
-- is reported as a warning and the commission can be earned again by running `referral_earn` for the payment.
CREATE FUNCTION commerce.payments_referral()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'captured' AND coalesce(NEW.kaizen_fee_minor, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id AND o.copied_from IS NOT NULL) THEN
    PERFORM commerce.referral_earn(NEW.store_id, NEW.kaizen_fee_minor, NEW.currency, 'sale_fee', NEW.id::text,
                                   'Kaizen''s fee on an order', now());
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'referral commission for payment % failed: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payments_referral_insert AFTER INSERT ON commerce.payments
  FOR EACH ROW WHEN (NEW.status = 'captured') EXECUTE FUNCTION commerce.payments_referral();
--> statement-breakpoint
CREATE TRIGGER payments_referral_status AFTER UPDATE OF status ON commerce.payments
  FOR EACH ROW WHEN (NEW.status = 'captured' AND OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION commerce.payments_referral();
--> statement-breakpoint

-- Money went back for a payment: the referrer gives back the refunded share of the sale-fee commission it earned (what is
-- left of it, never below zero). Cumulative over the payment's refunds, so refunds add up to the whole however they are cut.
CREATE FUNCTION commerce.refunds_referral()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_paid bigint;
  v_refunded bigint;
BEGIN
  IF NEW.status = 'failed' THEN
    RETURN NULL;
  END IF;
  SELECT p.amount_minor INTO v_paid FROM commerce.payments p WHERE p.store_id = NEW.store_id AND p.id = NEW.payment_id;
  SELECT coalesce(sum(r.amount_minor), 0) INTO v_refunded FROM commerce.refunds r
   WHERE r.store_id = NEW.store_id AND r.payment_id = NEW.payment_id AND r.status <> 'failed';
  PERFORM commerce.referral_reverse('sale_fee', NEW.payment_id::text, v_refunded, v_paid, true, 'reverse:' || NEW.id, 'Kaizen''s fee was refunded');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'referral commission reversal for refund % failed: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refunds_referral AFTER INSERT ON commerce.refunds
  FOR EACH ROW EXECUTE FUNCTION commerce.refunds_referral();
