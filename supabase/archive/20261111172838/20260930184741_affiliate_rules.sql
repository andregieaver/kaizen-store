-- The affiliate program, store level (D131, docs/affiliates.md): a store's signed-in customers refer friends. The referrer
-- earns bonus credits (D130, kind `referral`, a lot like any other: pending, then usable, expiring as the store's
-- settings say) on the friend's paid orders, and the friend gets a welcome discount on their first order.
--
-- The rules are here, not in code: who counts as a friend (`affiliate_resolve`), the guards (never oneself, never
-- someone who has ordered before, never a blocked referrer, never a copied or a host's order, a monthly limit per
-- referrer), the reward when an order is paid and its reversal by refunded share or on cancellation. They call the
-- bonus ledger's own writers (`bonus_grant`, `bonus_take`) so the ledger's invariants hold for referral lots too; the
-- bonus functions themselves are not changed. One attribution row per order, changed only through these functions.

ALTER TABLE commerce.affiliate_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.affiliates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.affiliate_attributions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.referral_visits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Who refers whom
-- ---------------------------------------------------------------------------

-- A composite foreign key with ON DELETE SET NULL would null the store id too, which cannot be null: only the column that
-- names the person is nulled (PostgreSQL 15). A customer leaving lets their friends and their orders' attributions go free.
ALTER TABLE commerce.customers DROP CONSTRAINT customers_referred_by_fk;
--> statement-breakpoint
ALTER TABLE commerce.customers ADD CONSTRAINT customers_referred_by_fk
  FOREIGN KEY (store_id, referred_by_customer_id) REFERENCES commerce.customers (store_id, id)
  ON DELETE SET NULL (referred_by_customer_id);
--> statement-breakpoint
ALTER TABLE commerce.affiliate_attributions DROP CONSTRAINT affiliate_attributions_friend_fk;
--> statement-breakpoint
ALTER TABLE commerce.affiliate_attributions ADD CONSTRAINT affiliate_attributions_friend_fk
  FOREIGN KEY (store_id, friend_customer_id) REFERENCES commerce.customers (store_id, id)
  ON DELETE SET NULL (friend_customer_id);
--> statement-breakpoint

-- A customer is referred by an affiliate of the same store, never by themselves, and once: what ties a friend to their
-- referrer is not moved to someone else later (it is only cleared when the referrer's account is deleted).
CREATE FUNCTION commerce.customers_referred_by_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.referred_by_customer_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.referred_by_customer_id IS NOT NULL
     AND OLD.referred_by_customer_id IS DISTINCT FROM NEW.referred_by_customer_id THEN
    RAISE EXCEPTION 'affiliate.moved' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.referred_by_customer_id = NEW.id THEN
    RAISE EXCEPTION 'affiliate.self' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.affiliates a
                  WHERE a.store_id = NEW.store_id AND a.customer_id = NEW.referred_by_customer_id) THEN
    RAISE EXCEPTION 'affiliate.unknown' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER customers_referred_by_guard BEFORE INSERT OR UPDATE OF referred_by_customer_id ON commerce.customers
  FOR EACH ROW EXECUTE FUNCTION commerce.customers_referred_by_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The attribution rows: one per order, made by `affiliate_attribute_order` and changed only as the order moves
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.affiliate_attributions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_o commerce.orders%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only with what it belongs to: the order, or the referrer's own account (cascades).
    IF NOT EXISTS (SELECT 1 FROM commerce.orders o WHERE o.store_id = OLD.store_id AND o.id = OLD.order_id)
       OR NOT EXISTS (SELECT 1 FROM commerce.affiliates a
                       WHERE a.store_id = OLD.store_id AND a.customer_id = OLD.affiliate_customer_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'commerce.affiliate_attributions is append-only; DELETE is not allowed' USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_o FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'affiliate.no_order' USING ERRCODE = 'check_violation';
    END IF;
    -- A copied order is history (D129) and a host's order is the host's (D71): neither is attributed.
    IF v_o.copied_from IS NOT NULL OR v_o.host_id IS NOT NULL THEN
      RAISE EXCEPTION 'affiliate.not_attributable' USING ERRCODE = 'check_violation';
    END IF;
    IF v_o.customer_id IS DISTINCT FROM NEW.friend_customer_id THEN
      RAISE EXCEPTION 'affiliate.wrong_friend' USING ERRCODE = 'check_violation';
    END IF;
    -- The friend is never the affiliate: such an attribution can only be a rejected one.
    IF NEW.friend_customer_id = NEW.affiliate_customer_id AND (NEW.status <> 'rejected' OR NEW.reject_reason IS DISTINCT FROM 'self') THEN
      RAISE EXCEPTION 'affiliate.self' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IN ('pending', 'rejected') AND NEW.reward_minor <> 0 THEN
      RAISE EXCEPTION 'affiliate.bad_reward' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: who, where and what the friend got never change; the status only moves forward; a reward once given is
  -- not edited (taking it back is the ledger's).
  IF NEW.store_id <> OLD.store_id OR NEW.order_id <> OLD.order_id OR NEW.affiliate_customer_id <> OLD.affiliate_customer_id
     OR NEW.code <> OLD.code OR NEW.discount_minor IS DISTINCT FROM OLD.discount_minor OR NEW.created_at <> OLD.created_at
     OR (NEW.friend_customer_id IS DISTINCT FROM OLD.friend_customer_id AND NEW.friend_customer_id IS NOT NULL) THEN
    RAISE EXCEPTION 'commerce.affiliate_attributions is append-only; its order, people and discount do not change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('rejected', 'reversed') AND (NEW.status <> OLD.status OR NEW.reward_minor <> OLD.reward_minor) THEN
    RAISE EXCEPTION 'affiliate.settled' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'rewarded' AND (NEW.status NOT IN ('rewarded', 'reversed') OR NEW.reward_minor <> OLD.reward_minor) THEN
    RAISE EXCEPTION 'affiliate.settled' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER affiliate_attributions_guard BEFORE INSERT OR UPDATE OR DELETE ON commerce.affiliate_attributions
  FOR EACH ROW EXECUTE FUNCTION commerce.affiliate_attributions_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Reading: is the program on, has the friend ordered before, and whose friend is this
-- ---------------------------------------------------------------------------

-- The program works only while its own switch and the bonus program's (whose credits are the reward) are both on.
CREATE FUNCTION commerce.affiliate_program_on(p_store uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce((SELECT s.enabled FROM commerce.affiliate_settings s WHERE s.store_id = p_store), false)
     AND coalesce((SELECT b.enabled FROM commerce.bonus_settings b WHERE b.store_id = p_store), false)
$$;
--> statement-breakpoint

-- Whether a customer has ever paid an order in the store, other than `p_except`: an order that is paid, fulfilled or
-- closed, or that was paid and cancelled since (it has its payment event), by the customer's id or their email (a guest
-- purchase before they registered counts). Copied history (D129) counts too: they are the store's customer.
CREATE FUNCTION commerce.affiliate_has_paid(p_store uuid, p_customer uuid, p_except uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM commerce.orders o
      LEFT JOIN commerce.customers c ON c.store_id = p_store AND c.id = p_customer
     WHERE o.store_id = p_store AND o.id IS DISTINCT FROM p_except
       AND (o.customer_id = p_customer OR (o.email <> '' AND lower(o.email) = lower(c.email)))
       AND (o.status IN ('paid', 'fulfilled', 'closed')
            OR EXISTS (SELECT 1 FROM commerce.order_events e WHERE e.store_id = o.store_id AND e.order_id = o.id AND e.type = 'order.paid'))
  )
$$;
--> statement-breakpoint

-- Whose friend an order is, and what follows from it. `p_code` is the code the cart carries (null for none); a customer
-- referred at registration is the referrer's friend for later orders without one. The verdict:
--   none     no affiliate of the store has this code (and the customer has no referrer)
--   off      the program is off (or the bonus program is)
--   guest    a real code but nobody signed in: no discount, no reward
--   self     the customer is the affiliate (or has their email)
--   blocked  the affiliate was stopped by staff
--   not_new  the customer has ordered before, and is not this affiliate's friend
--   limit    the friend's orders have already earned the most rewards the store gives for one friend
--   ok       the order is attributed; `welcome` says whether it is the friend's first order (the welcome discount)
-- On a first order the code counts (the last click wins), else the referrer the customer registered through.
CREATE FUNCTION commerce.affiliate_resolve(p_store uuid, p_customer uuid, p_code text, p_except uuid DEFAULT NULL)
RETURNS TABLE (affiliate_customer_id uuid, code text, verdict text, welcome boolean)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_s commerce.affiliate_settings%ROWTYPE;
  v_aff commerce.affiliates%ROWTYPE;
  v_c commerce.customers%ROWTYPE;
  v_ref uuid;
  v_first boolean := true;
  v_email text;
BEGIN
  IF NOT commerce.affiliate_program_on(p_store) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'off'::text, false;
    RETURN;
  END IF;
  SELECT * INTO v_s FROM commerce.affiliate_settings s WHERE s.store_id = p_store;
  IF p_customer IS NOT NULL THEN
    SELECT * INTO v_c FROM commerce.customers c WHERE c.store_id = p_store AND c.id = p_customer;
    v_ref := v_c.referred_by_customer_id;
    v_first := NOT commerce.affiliate_has_paid(p_store, p_customer, p_except);
  END IF;
  IF p_code IS NOT NULL AND (p_customer IS NULL OR v_first OR v_ref IS NULL) THEN
    SELECT * INTO v_aff FROM commerce.affiliates a WHERE a.store_id = p_store AND a.code = p_code;
  END IF;
  IF v_aff.customer_id IS NULL AND v_ref IS NOT NULL THEN
    SELECT * INTO v_aff FROM commerce.affiliates a WHERE a.store_id = p_store AND a.customer_id = v_ref;
  END IF;
  IF v_aff.customer_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'none'::text, false;
    RETURN;
  END IF;
  IF p_customer IS NULL THEN
    RETURN QUERY SELECT v_aff.customer_id, v_aff.code, 'guest'::text, false;
    RETURN;
  END IF;
  SELECT lower(c.email) INTO v_email FROM commerce.customers c WHERE c.store_id = p_store AND c.id = v_aff.customer_id;
  IF v_aff.customer_id = p_customer OR v_email = lower(v_c.email) THEN
    RETURN QUERY SELECT v_aff.customer_id, v_aff.code, 'self'::text, false;
    RETURN;
  END IF;
  IF v_aff.blocked_at IS NOT NULL THEN
    RETURN QUERY SELECT v_aff.customer_id, v_aff.code, 'blocked'::text, false;
    RETURN;
  END IF;
  IF NOT v_first THEN
    IF v_aff.customer_id IS DISTINCT FROM v_ref THEN
      RETURN QUERY SELECT v_aff.customer_id, v_aff.code, 'not_new'::text, false;
      RETURN;
    END IF;
    IF v_s.reward_orders IS NOT NULL AND (
         SELECT count(*) FROM commerce.affiliate_attributions x
          WHERE x.store_id = p_store AND x.friend_customer_id = p_customer AND x.affiliate_customer_id = v_aff.customer_id
            AND x.status = 'rewarded' AND x.order_id IS DISTINCT FROM p_except) >= v_s.reward_orders THEN
      RETURN QUERY SELECT v_aff.customer_id, v_aff.code, 'limit'::text, false;
      RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT v_aff.customer_id, v_aff.code, 'ok'::text, v_first;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Attributing an order when it is placed
-- ---------------------------------------------------------------------------

-- Records whose friend a just-placed order is, with the welcome discount it was given (`p_discount`, only kept when
-- the order is attributed). One row per order; nothing for a guest, a copied or a host's order, or a program that is
-- off. A guard that stops the reward (oneself, a friend who has ordered before, a blocked referrer) is recorded as a
-- rejected row, so the store sees it. Returns the verdict of `affiliate_resolve`.
CREATE FUNCTION commerce.affiliate_attribute_order(p_order uuid, p_code text, p_discount bigint)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_o commerce.orders%ROWTYPE;
  v_r record;
BEGIN
  SELECT * INTO v_o FROM commerce.orders o WHERE o.id = p_order;
  IF NOT FOUND OR v_o.customer_id IS NULL OR v_o.copied_from IS NOT NULL OR v_o.host_id IS NOT NULL THEN
    RETURN 'none';
  END IF;
  SELECT * INTO v_r FROM commerce.affiliate_resolve(v_o.store_id, v_o.customer_id, p_code, p_order);
  IF v_r.verdict NOT IN ('ok', 'self', 'blocked', 'not_new') THEN
    RETURN v_r.verdict;
  END IF;
  INSERT INTO commerce.affiliate_attributions (
    store_id, order_id, affiliate_customer_id, friend_customer_id, code, discount_minor, status, reject_reason
  ) VALUES (
    v_o.store_id, p_order, v_r.affiliate_customer_id, v_o.customer_id, v_r.code,
    CASE WHEN v_r.verdict = 'ok' THEN greatest(coalesce(p_discount, 0), 0) ELSE 0 END,
    CASE WHEN v_r.verdict = 'ok' THEN 'pending' ELSE 'rejected' END,
    CASE WHEN v_r.verdict = 'ok' THEN NULL ELSE v_r.verdict END
  )
  ON CONFLICT (store_id, order_id) DO NOTHING;
  RETURN v_r.verdict;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- What orders do to the referrer's credits
-- ---------------------------------------------------------------------------

-- The referrer's and the friend's rows are locked together, in id order, before any ledger write: a payment or refund for a
-- friend and another for the referrer's own order never wait for each other in opposite orders.
CREATE FUNCTION commerce.affiliate_lock(p_store uuid, p_a uuid, p_b uuid)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT 1 FROM commerce.customers c WHERE c.store_id = p_store AND c.id IN (p_a, p_b) ORDER BY c.id FOR UPDATE
$$;
--> statement-breakpoint

-- An order was paid: the guards are checked again as they stand now, and the referrer is granted `reward_bps` of what
-- was paid online for goods (as the bonus program counts it: lines less what is left for a venue, so without shipping and
-- after every discount), converted into the credits' currency, rounded down, cut to what is left of the referrer's
-- monthly limit. Once per order: only a pending attribution moves.
CREATE FUNCTION commerce.affiliate_order_paid(p_order uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_o commerce.orders%ROWTYPE;
  v_a commerce.affiliate_attributions%ROWTYPE;
  v_s commerce.affiliate_settings%ROWTYPE;
  v_b commerce.bonus_settings%ROWTYPE;
  v_aff_email text;
  v_friend commerce.customers%ROWTYPE;
  v_reason text;
  v_base bigint;
  v_reward bigint;
  v_credits bigint;
  v_used bigint;
  v_from timestamptz;
  v_tz text;
  v_at timestamptz;
BEGIN
  SELECT * INTO v_o FROM commerce.orders o WHERE o.id = p_order;
  IF NOT FOUND OR v_o.copied_from IS NOT NULL OR v_o.host_id IS NOT NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_a FROM commerce.affiliate_attributions a WHERE a.store_id = v_o.store_id AND a.order_id = p_order;
  IF NOT FOUND OR v_a.status <> 'pending' THEN
    RETURN;
  END IF;
  PERFORM commerce.affiliate_lock(v_o.store_id, v_a.affiliate_customer_id, v_a.friend_customer_id);
  SELECT * INTO v_a FROM commerce.affiliate_attributions a WHERE a.id = v_a.id FOR UPDATE;
  IF v_a.status <> 'pending' THEN
    RETURN;
  END IF;

  SELECT * INTO v_s FROM commerce.affiliate_settings s WHERE s.store_id = v_o.store_id;
  SELECT * INTO v_b FROM commerce.bonus_settings b WHERE b.store_id = v_o.store_id;
  SELECT lower(c.email) INTO v_aff_email FROM commerce.customers c
   WHERE c.store_id = v_o.store_id AND c.id = v_a.affiliate_customer_id;
  SELECT * INTO v_friend FROM commerce.customers c WHERE c.store_id = v_o.store_id AND c.id = v_a.friend_customer_id;

  IF NOT commerce.affiliate_program_on(v_o.store_id) THEN
    v_reason := 'off';
  ELSIF v_friend.id IS NULL THEN
    v_reason := 'not_new';
  ELSIF v_friend.id = v_a.affiliate_customer_id OR lower(v_friend.email) = v_aff_email OR lower(v_o.email) = v_aff_email THEN
    v_reason := 'self';
  ELSIF EXISTS (SELECT 1 FROM commerce.affiliates a
                 WHERE a.store_id = v_o.store_id AND a.customer_id = v_a.affiliate_customer_id AND a.blocked_at IS NOT NULL) THEN
    v_reason := 'blocked';
  ELSIF commerce.affiliate_has_paid(v_o.store_id, v_friend.id, p_order)
        AND v_friend.referred_by_customer_id IS DISTINCT FROM v_a.affiliate_customer_id THEN
    v_reason := 'not_new';
  ELSIF v_s.reward_orders IS NOT NULL AND (
          SELECT count(*) FROM commerce.affiliate_attributions x
           WHERE x.store_id = v_o.store_id AND x.friend_customer_id = v_friend.id
             AND x.affiliate_customer_id = v_a.affiliate_customer_id AND x.status = 'rewarded' AND x.order_id <> p_order
        ) >= v_s.reward_orders THEN
    v_reason := 'limit';
  END IF;

  IF v_reason IS NULL THEN
    SELECT coalesce(sum(ol.total_minor - ol.venue_minor), 0) INTO v_base
      FROM commerce.order_lines ol WHERE ol.store_id = v_o.store_id AND ol.order_id = p_order;
    v_reward := floor(v_base::numeric * v_s.reward_bps / 10000)::bigint;
    v_credits := CASE WHEN v_reward > 0 THEN commerce.bonus_convert(v_o.store_id, v_reward, v_o.currency, v_b.currency) END;
    IF v_credits IS NULL OR v_credits <= 0 THEN
      v_reason := 'zero';
    ELSIF v_s.monthly_cap_minor IS NOT NULL THEN
      -- A calendar month in the store's time zone; what the referrer has been rewarded in it (and not had taken back).
      SELECT coalesce((SELECT st.time_zone FROM commerce.stores st WHERE st.id = v_o.store_id), 'UTC') INTO v_tz;
      v_from := timezone(v_tz, date_trunc('month', timezone(v_tz, now())));
      SELECT coalesce(sum(x.reward_minor), 0) INTO v_used FROM commerce.affiliate_attributions x
       WHERE x.store_id = v_o.store_id AND x.affiliate_customer_id = v_a.affiliate_customer_id
         AND x.status = 'rewarded' AND x.rewarded_at >= v_from;
      v_credits := least(v_credits, greatest(v_s.monthly_cap_minor - v_used, 0));
      IF v_credits <= 0 THEN
        v_reason := 'cap';
      END IF;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    UPDATE commerce.affiliate_attributions SET status = 'rejected', reject_reason = v_reason WHERE id = v_a.id;
    RETURN;
  END IF;

  v_at := now() + make_interval(days => v_b.pending_days);
  PERFORM commerce.bonus_grant(v_o.store_id, v_a.affiliate_customer_id, 'referral', v_credits, NULL, NULL, v_at,
                               commerce.bonus_expiry_from(v_o.store_id, v_at), '', NULL, 'referral:' || p_order);
  UPDATE commerce.affiliate_attributions SET status = 'rewarded', reward_minor = v_credits, rewarded_at = now() WHERE id = v_a.id;
  -- From now on the friend is the referrer's: their next orders earn too, as far as the store allows.
  UPDATE commerce.customers SET referred_by_customer_id = v_a.affiliate_customer_id
   WHERE store_id = v_o.store_id AND id = v_friend.id AND referred_by_customer_id IS NULL;
END;
$$;
--> statement-breakpoint

-- A paid order was cancelled: what is left of the credits it earned the referrer is taken back (never below zero: what
-- they used stays used).
CREATE FUNCTION commerce.affiliate_order_paid_cancelled(p_order uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_o commerce.orders%ROWTYPE;
  v_a commerce.affiliate_attributions%ROWTYPE;
  v_lot uuid;
  v_left bigint;
BEGIN
  SELECT * INTO v_o FROM commerce.orders o WHERE o.id = p_order;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO v_a FROM commerce.affiliate_attributions a WHERE a.store_id = v_o.store_id AND a.order_id = p_order;
  IF NOT FOUND OR v_a.status <> 'rewarded' THEN
    RETURN;
  END IF;
  PERFORM commerce.affiliate_lock(v_o.store_id, v_a.affiliate_customer_id, v_a.friend_customer_id);
  SELECT e.id INTO v_lot FROM commerce.bonus_entries e
   WHERE e.store_id = v_o.store_id AND e.idempotency_key = 'referral:' || p_order;
  IF v_lot IS NOT NULL THEN
    SELECT l.remaining INTO v_left FROM commerce.bonus_lots(v_o.store_id, v_a.affiliate_customer_id) l WHERE l.id = v_lot;
    PERFORM commerce.bonus_take(v_o.store_id, v_a.affiliate_customer_id, 'reverse', coalesce(v_left, 0), 'lot', v_lot, NULL, NULL,
                                'the friend''s order was cancelled', NULL, 'referral-reverse-cancel:' || p_order);
  END IF;
  UPDATE commerce.affiliate_attributions SET status = 'reversed' WHERE id = v_a.id;
END;
$$;
--> statement-breakpoint

-- Money went back for an order: the refunded share of the credits it earned the referrer is taken back, what is left of
-- them and never below zero, exactly as the bonus program takes back the friend's own (`bonus_refund_applied`): the
-- share is what has been refunded in all of what was paid online, all of it when everything is, counted against what
-- has been taken so far, so refunds add up to exactly the whole however they are cut. The reward is marked reversed when
-- all was refunded.
CREATE FUNCTION commerce.affiliate_refund_applied(p_refund uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_r commerce.refunds%ROWTYPE;
  v_o commerce.orders%ROWTYPE;
  v_a commerce.affiliate_attributions%ROWTYPE;
  v_paid bigint;
  v_refunded bigint;
  v_lot uuid;
  v_granted bigint;
  v_target bigint;
  v_done bigint;
BEGIN
  SELECT * INTO v_r FROM commerce.refunds r WHERE r.id = p_refund;
  IF NOT FOUND OR v_r.status = 'failed' THEN
    RETURN;
  END IF;
  SELECT o.* INTO v_o FROM commerce.orders o
    JOIN commerce.payments p ON p.store_id = o.store_id AND p.order_id = o.id
   WHERE p.store_id = v_r.store_id AND p.id = v_r.payment_id;
  IF NOT FOUND OR v_o.copied_from IS NOT NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_a FROM commerce.affiliate_attributions a WHERE a.store_id = v_o.store_id AND a.order_id = v_o.id;
  IF NOT FOUND OR v_a.status <> 'rewarded' THEN
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
  PERFORM commerce.affiliate_lock(v_o.store_id, v_a.affiliate_customer_id, v_a.friend_customer_id);
  SELECT e.id, e.amount_minor INTO v_lot, v_granted FROM commerce.bonus_entries e
   WHERE e.store_id = v_o.store_id AND e.idempotency_key = 'referral:' || v_o.id;
  IF v_lot IS NOT NULL THEN
    v_target := CASE WHEN v_refunded >= v_paid THEN v_granted ELSE floor(v_granted::numeric * v_refunded / v_paid)::bigint END;
    -- What was taken back from this lot so far (its other allocations are uses and expiry, which stay).
    SELECT coalesce(sum(al.amount_minor), 0) INTO v_done
      FROM commerce.bonus_allocations al JOIN commerce.bonus_entries e ON e.store_id = al.store_id AND e.id = al.entry_id
     WHERE al.store_id = v_o.store_id AND al.lot_id = v_lot AND e.kind = 'reverse';
    PERFORM commerce.bonus_take(v_o.store_id, v_a.affiliate_customer_id, 'reverse', v_target - v_done, 'lot', v_lot, NULL, p_refund,
                                'the friend''s order was refunded', NULL, 'referral-reverse:' || p_refund);
  END IF;
  IF v_refunded >= v_paid THEN
    UPDATE commerce.affiliate_attributions SET status = 'reversed' WHERE id = v_a.id;
  END IF;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.orders_affiliate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.copied_from IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'paid' AND OLD.status IN ('pending_payment', 'cancelled') THEN
    PERFORM commerce.affiliate_order_paid(NEW.id);
  ELSIF NEW.status = 'cancelled' AND OLD.status IN ('paid', 'fulfilled') THEN
    PERFORM commerce.affiliate_order_paid_cancelled(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_affiliate AFTER UPDATE OF status ON commerce.orders
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION commerce.orders_affiliate();
--> statement-breakpoint

CREATE FUNCTION commerce.refunds_affiliate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.affiliate_refund_applied(NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refunds_affiliate AFTER INSERT ON commerce.refunds
  FOR EACH ROW EXECUTE FUNCTION commerce.refunds_affiliate();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Visits to a store's link: a count by day and code, nothing about the visitor
-- ---------------------------------------------------------------------------

-- Counts one visit to a referral link of the store, when the code is a live affiliate's and the program is on. False for
-- anything else, so a made-up code leaves no trace. Nothing about the visitor is kept: a number per code and day.
CREATE FUNCTION commerce.affiliate_count_visit(p_store uuid, p_code text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT commerce.affiliate_program_on(p_store)
     OR NOT EXISTS (SELECT 1 FROM commerce.affiliates a WHERE a.store_id = p_store AND a.code = p_code AND a.blocked_at IS NULL) THEN
    RETURN false;
  END IF;
  INSERT INTO commerce.referral_visits (store_id, code, day, visits)
  VALUES (p_store, p_code, (now() AT TIME ZONE 'UTC')::date, 1)
  ON CONFLICT (coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), code, day)
  DO UPDATE SET visits = commerce.referral_visits.visits + 1
    -- A ceiling for the day, so a code opened by a script cannot grow a counter without end (the row is one per day and code).
    WHERE commerce.referral_visits.visits < 100000;
  RETURN true;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Copying a store (D129): `duplicate_store()` is replaced as it was (20260930173559_bonus_program_store_copy.sql) with
-- one statement added, the affiliate program's settings. Affiliates, attributions and visits are never copied.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commerce.duplicate_store(
  p_source uuid,
  p_slug text,
  p_name text,
  p_owner uuid,
  p_page_ids uuid[] DEFAULT NULL,
  p_product_ids uuid[] DEFAULT NULL,
  p_post_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_store uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.stores WHERE id = p_source) THEN
    RAISE EXCEPTION 'unknown store %', p_source;
  END IF;

  -- Tracking ids (analytics, pixels) and the store's own code belong to the original's site: the copy starts with
  -- none, so its visits are never sent to the original's tools.
  INSERT INTO commerce.stores (
    slug, name, created_by, legal_name, organisation_number, contact_email, postal_address, country, seo, navigation,
    cart_reminders, tracking, fonts, theme, custom_code, audience, business_popup, open_cart_on_add, modules,
    time_zone, booking_reminder_hours, custom_css, locales, rates_auto, rates_updated_at
  )
  SELECT p_slug, p_name, p_owner, s.legal_name, s.organisation_number, s.contact_email, s.postal_address, s.country,
         s.seo, s.navigation, s.cart_reminders, '{}'::jsonb, s.fonts, s.theme, '{}'::jsonb, s.audience,
         s.business_popup, s.open_cart_on_add, array_remove(s.modules, 'work'), s.time_zone,
         s.booking_reminder_hours, s.custom_css, s.locales, s.rates_auto, s.rates_updated_at
    FROM commerce.stores s WHERE s.id = p_source
  RETURNING id INTO v_store;

  -- Only the person copying owns the new store; the other members stay with the original.
  INSERT INTO commerce.store_members (store_id, account_id, role) VALUES (v_store, p_owner, 'owner');

  -- Which things are copied, and their new ids (null: left behind).
  CREATE TEMP TABLE IF NOT EXISTS _copy_ids (old_id uuid PRIMARY KEY, new_id uuid) ON COMMIT DROP;
  TRUNCATE pg_temp._copy_ids;
  INSERT INTO pg_temp._copy_ids (old_id, new_id)
  SELECT p.id, CASE WHEN p.status <> 'archived' AND (p_product_ids IS NULL OR p.id = ANY (p_product_ids))
                    THEN commerce.clone_id(v_store, p.id) END
    FROM commerce.products p WHERE p.store_id = p_source;
  INSERT INTO pg_temp._copy_ids (old_id, new_id)
  SELECT v.id, CASE WHEN m.new_id IS NOT NULL THEN commerce.clone_id(v_store, v.id) END
    FROM commerce.product_variants v
    JOIN pg_temp._copy_ids m ON m.old_id = v.product_id
   WHERE v.store_id = p_source;
  INSERT INTO pg_temp._copy_ids (old_id, new_id)
  SELECT p.id, CASE WHEN CASE p.type
                          WHEN 'page' THEN p_page_ids IS NULL OR p.id = ANY (p_page_ids)
                          WHEN 'article' THEN p_post_ids IS NULL OR p.id = ANY (p_post_ids)
                          ELSE true
                        END
                    THEN commerce.clone_id(v_store, p.id) END
    FROM commerce.pages p WHERE p.store_id = p_source;
  INSERT INTO pg_temp._copy_ids (old_id, new_id)
  SELECT id, commerce.clone_id(v_store, id) FROM commerce.terms WHERE store_id = p_source
  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.menus WHERE store_id = p_source
  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.field_groups WHERE store_id = p_source
  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.saved_parts WHERE store_id = p_source
  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.store_themes WHERE store_id = p_source
  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.customer_tiers WHERE store_id = p_source
  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.customer_companies WHERE store_id = p_source
  UNION ALL SELECT id, commerce.clone_id(v_store, id) FROM commerce.discount_codes WHERE store_id = p_source;

  -- Settings ------------------------------------------------------------------------------------------------

  -- What the store accepts: the switches, never the keys (a new Stripe account is the new owner's to connect).
  UPDATE commerce.payment_providers n
     SET enabled = s.enabled, order_invoices = s.order_invoices
    FROM commerce.payment_providers s
   WHERE s.store_id = p_source AND n.store_id = v_store AND n.provider = s.provider;

  INSERT INTO commerce.markets (store_id, code, currency, default_locale, locales, active, created_at)
  SELECT v_store, code, currency, default_locale, locales, active, created_at
    FROM commerce.markets WHERE store_id = p_source;

  INSERT INTO commerce.store_currencies (store_id, currency, rate, round_to, position)
  SELECT v_store, currency, rate, round_to, position
    FROM commerce.store_currencies WHERE store_id = p_source;

  INSERT INTO commerce.shipping_rates (store_id, market_code, currency, amount_minor, free_over_minor)
  SELECT v_store, market_code, currency, amount_minor, free_over_minor
    FROM commerce.shipping_rates WHERE store_id = p_source;

  INSERT INTO commerce.payment_methods (store_id, market_code, method, enabled)
  SELECT v_store, market_code, method, enabled
    FROM commerce.payment_methods WHERE store_id = p_source;

  INSERT INTO commerce.producer_registrations (
    id, store_id, market_code, scheme, registration_number, authority, valid_from, valid_to, created_at
  )
  SELECT commerce.clone_id(v_store, id), v_store, market_code, scheme, registration_number, authority, valid_from,
         valid_to, created_at
    FROM commerce.producer_registrations WHERE store_id = p_source;

  INSERT INTO commerce.economic_operators (id, store_id, name, postal_address, electronic_address, country, created_at)
  SELECT commerce.clone_id(v_store, id), v_store, name, postal_address, electronic_address, country, created_at
    FROM commerce.economic_operators WHERE store_id = p_source;

  INSERT INTO commerce.inventory_locations (id, store_id, name, country, active, created_at)
  SELECT commerce.clone_id(v_store, id), v_store, name, country, active, created_at
    FROM commerce.inventory_locations WHERE store_id = p_source;

  INSERT INTO commerce.store_locations (
    id, store_id, kind, name, street, postal_code, city, country, phone, notes, hours, position
  )
  SELECT commerce.clone_id(v_store, id), v_store, kind, name, street, postal_code, city, country, phone, notes, hours,
         position
    FROM commerce.store_locations WHERE store_id = p_source;

  -- Staff, rooms and rental items. A host's are the host's (hosts stay with the original), and a calendar's
  -- secret address is the original's; the copy gets its own when it is published.
  INSERT INTO commerce.booking_resources (
    id, store_id, kind, name, email, hours, capacity, active, position, host_id, property_address, land_registry_number
  )
  SELECT commerce.clone_id(v_store, id), v_store, kind, name, email, hours, capacity, active, position, NULL,
         property_address, land_registry_number
    FROM commerce.booking_resources WHERE store_id = p_source AND host_id IS NULL;

  INSERT INTO commerce.customer_tiers (id, store_id, name, percent, note, active, created_at)
  SELECT commerce.clone_id(v_store, id), v_store, name, percent, note, active, created_at
    FROM commerce.customer_tiers WHERE store_id = p_source;

  INSERT INTO commerce.customer_companies (
    id, store_id, name, organisation_number, tier_id, employee_share_percent, max_members, active, created_at
  )
  SELECT commerce.clone_id(v_store, id), v_store, name, organisation_number, commerce.clone_id(v_store, tier_id),
         employee_share_percent, max_members, active, created_at
    FROM commerce.customer_companies WHERE store_id = p_source;

  INSERT INTO commerce.store_themes (id, store_id, name, base, settings, created_by, created_at)
  SELECT commerce.clone_id(v_store, id), v_store, name, base, settings, p_owner, created_at
    FROM commerce.store_themes WHERE store_id = p_source;

  INSERT INTO commerce.cookie_notes (store_id, kind, name, domain, category, provider, purpose, updated_by)
  SELECT v_store, kind, name, domain, category, provider, purpose, p_owner
    FROM commerce.cookie_notes WHERE store_id = p_source;

  INSERT INTO commerce.chat_agents (
    store_id, enabled, name, occupation, avatar, greeting, instructions, voice, daily_limit, updated_by
  )
  SELECT v_store, enabled, name, occupation, avatar, greeting, instructions, voice, daily_limit, p_owner
    FROM commerce.chat_agents WHERE store_id = p_source;

  INSERT INTO commerce.knowledge_documents (id, store_id, title, file_name, content, created_at, updated_at, created_by)
  SELECT commerce.clone_id(v_store, id), v_store, title, file_name, content, created_at, updated_at, p_owner
    FROM commerce.knowledge_documents WHERE store_id = p_source;

  INSERT INTO commerce.discount_codes (
    id, store_id, code, kind, percent, amounts, min_subtotals, product_ids, recurring, starts_at, ends_at,
    usage_limit, once_per_customer, active, created_at, updated_at
  )
  SELECT commerce.clone_id(v_store, id), v_store, code, kind, percent, amounts, min_subtotals, product_ids, recurring,
         starts_at, ends_at, usage_limit, once_per_customer, active, created_at, updated_at
    FROM commerce.discount_codes WHERE store_id = p_source;

  INSERT INTO commerce.cart_reminder_steps (
    id, store_id, delay_minutes, active, discount_code_id, content, created_at, updated_at
  )
  SELECT commerce.clone_id(v_store, id), v_store, delay_minutes, active, commerce.clone_id(v_store, discount_code_id),
         content, created_at, updated_at
    FROM commerce.cart_reminder_steps WHERE store_id = p_source;

  -- The bonus program's settings (D130); the ledger never: customers' credits belong to the original's customers.
  INSERT INTO commerce.bonus_settings (
    store_id, enabled, earn_bps, pending_days, max_redeem_percent, min_redeem_minor, expires_months, currency, updated_by
  )
  SELECT v_store, enabled, earn_bps, pending_days, max_redeem_percent, min_redeem_minor, expires_months, currency, p_owner
    FROM commerce.bonus_settings WHERE store_id = p_source;

  -- The affiliate program's settings (D131); never its affiliates, attributions or visits: customers' codes, who referred
  -- whom and what was earned belong to the original store and its customers.
  INSERT INTO commerce.affiliate_settings (
    store_id, enabled, reward_bps, reward_orders, friend_percent, friend_max_minor, monthly_cap_minor, cookie_days, updated_by
  )
  SELECT v_store, enabled, reward_bps, reward_orders, friend_percent, friend_max_minor, monthly_cap_minor, cookie_days, p_owner
    FROM commerce.affiliate_settings WHERE store_id = p_source;

  INSERT INTO commerce.delivery_schedules (
    id, store_id, market_code, currency, name, delivery_weekday, cutoff_days, cutoff_time, active, created_at
  )
  SELECT commerce.clone_id(v_store, id), v_store, market_code, currency, name, delivery_weekday, cutoff_days,
         cutoff_time, active, created_at
    FROM commerce.delivery_schedules WHERE store_id = p_source;

  -- Categories and tags (D50) belong to the store's structure, so all come, whichever products do. Parents are
  -- set once every category exists, so the parent check finds them.
  INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position, created_at, updated_at)
  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, created_at, updated_at
    FROM commerce.terms WHERE store_id = p_source;

  UPDATE commerce.terms n
     SET parent_id = commerce.clone_id(v_store, t.parent_id)
    FROM commerce.terms t
   WHERE t.store_id = p_source AND t.parent_id IS NOT NULL AND n.id = commerce.clone_id(v_store, t.id);

  INSERT INTO commerce.field_groups (
    id, store_id, name, slug, entities, location, fields, position, active, sort, created_at, updated_at
  )
  SELECT commerce.clone_id(v_store, g.id), v_store, g.name, g.slug, g.entities,
         commerce.clone_field_location(v_store, g.location), g.fields, g.position, g.active, g.sort, g.created_at,
         g.updated_at
    FROM commerce.field_groups g WHERE g.store_id = p_source;

  -- The store's saved rows, columns and components (D46) as private ones: what the owner shared with other
  -- stores or the marketplace stays the original's to share. Global ones (D98) keep their ids' meaning, as the
  -- pages using them are remapped below.
  INSERT INTO commerce.saved_parts (
    id, store_id, kind, name, content, created_at, created_by, updated_at, updated_by, global, translations, sharing
  )
  SELECT commerce.clone_id(v_store, id), v_store, kind, name, commerce.copy_remap(content, p_source, v_store),
         created_at, p_owner, updated_at, p_owner, global, translations, 'private'
    FROM commerce.saved_parts WHERE store_id = p_source;

  INSERT INTO commerce.template_activations (store_id, part_id, active, changed_at, changed_by)
  SELECT v_store, a.part_id, a.active, a.changed_at, p_owner
    FROM commerce.template_activations a WHERE a.store_id = p_source;

  -- Products ------------------------------------------------------------------------------------------------

  -- They arrive as drafts and are published below, once their pictures, titles and variants exist (the
  -- publishing check needs them).
  INSERT INTO commerce.products (
    id, store_id, handle, status, manufacturer_id, responsible_person_id, tax_code, withdrawal_exclusion, delivery,
    download_limit, download_days, subscription_only, kind, vat_category, audience, created_at, updated_at
  )
  SELECT m.new_id, v_store, p.handle, 'draft', commerce.clone_id(v_store, p.manufacturer_id),
         commerce.clone_id(v_store, p.responsible_person_id), p.tax_code, p.withdrawal_exclusion, p.delivery,
         p.download_limit, p.download_days, p.subscription_only, p.kind, p.vat_category, p.audience, p.created_at,
         p.updated_at
    FROM commerce.products p JOIN pg_temp._copy_ids m ON m.old_id = p.id
   WHERE p.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.product_translations (
    store_id, product_id, locale, title, description, safety_information, seo_title, seo_description
  )
  SELECT v_store, m.new_id, t.locale, t.title, t.description, t.safety_information, t.seo_title, t.seo_description
    FROM commerce.product_translations t JOIN pg_temp._copy_ids m ON m.old_id = t.product_id
   WHERE t.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt, thumbnail_url)
  SELECT v_store, m.new_id, pm.url, pm.position, pm.alt, pm.thumbnail_url
    FROM commerce.product_media pm JOIN pg_temp._copy_ids m ON m.old_id = pm.product_id
   WHERE pm.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.product_schemes (store_id, product_id, scheme)
  SELECT v_store, m.new_id, s.scheme
    FROM commerce.product_schemes s JOIN pg_temp._copy_ids m ON m.old_id = s.product_id
   WHERE s.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.product_terms (store_id, product_id, term_id, content_type)
  SELECT v_store, m.new_id, commerce.clone_id(v_store, pt.term_id), pt.content_type
    FROM commerce.product_terms pt JOIN pg_temp._copy_ids m ON m.old_id = pt.product_id
   WHERE pt.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.product_variants (
    id, store_id, product_id, sku, gtin, tax_code, options, weight_grams, hs_code, origin_country, active, delivery,
    rental_period, image_url, image_thumbnail_url, created_at
  )
  SELECT m.new_id, v_store, commerce.clone_id(v_store, v.product_id), v.sku, v.gtin, v.tax_code, v.options,
         v.weight_grams, v.hs_code, v.origin_country, v.active, v.delivery, v.rental_period, v.image_url,
         v.image_thumbnail_url, v.created_at
    FROM commerce.product_variants v JOIN pg_temp._copy_ids m ON m.old_id = v.id
   WHERE v.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.selling_plans (
    id, store_id, product_id, interval, interval_count, discount_percent, trial_days, signup_fee, min_cycles,
    position, active, created_at
  )
  SELECT commerce.clone_id(v_store, sp.id), v_store, commerce.clone_id(v_store, sp.product_id), sp.interval,
         sp.interval_count, sp.discount_percent, sp.trial_days, sp.signup_fee, sp.min_cycles, sp.position, sp.active,
         sp.created_at
    FROM commerce.selling_plans sp JOIN pg_temp._copy_ids m ON m.old_id = sp.product_id
   WHERE sp.store_id = p_source AND m.new_id IS NOT NULL;

  -- The current price of each variant, as a new price: the copy shows no reduction it never made.
  INSERT INTO commerce.prices (store_id, variant_id, market_code, currency, amount_minor, valid_from)
  SELECT v_store, m.new_id, pr.market_code, pr.currency, pr.amount_minor, now()
    FROM commerce.prices pr JOIN pg_temp._copy_ids m ON m.old_id = pr.variant_id
   WHERE pr.store_id = p_source AND pr.valid_to IS NULL AND m.new_id IS NOT NULL;

  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
  SELECT v_store, m.new_id, commerce.clone_id(v_store, l.location_id), l.on_hand
    FROM commerce.inventory_levels l JOIN pg_temp._copy_ids m ON m.old_id = l.variant_id
   WHERE l.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.appointment_settings (
    product_id, store_id, duration_minutes, buffer_before_minutes, buffer_after_minutes, step_minutes,
    min_notice_minutes, max_days_ahead, location_id, payment, deposit_percent, cancel_hours, no_show_percent,
    check_in_time, check_out_time, min_nights, max_nights, booking_fee
  )
  SELECT m.new_id, v_store, a.duration_minutes, a.buffer_before_minutes, a.buffer_after_minutes, a.step_minutes,
         a.min_notice_minutes, a.max_days_ahead, commerce.clone_id(v_store, a.location_id), a.payment,
         a.deposit_percent, a.cancel_hours, a.no_show_percent, a.check_in_time, a.check_out_time, a.min_nights,
         a.max_nights, a.booking_fee
    FROM commerce.appointment_settings a JOIN pg_temp._copy_ids m ON m.old_id = a.product_id
   WHERE a.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.booking_seasons (store_id, product_id, name, names, from_day, to_day, weekdays, percent, position)
  SELECT v_store, m.new_id, s.name, s.names, s.from_day, s.to_day, s.weekdays, s.percent, s.position
    FROM commerce.booking_seasons s JOIN pg_temp._copy_ids m ON m.old_id = s.product_id
   WHERE s.store_id = p_source AND m.new_id IS NOT NULL;

  INSERT INTO commerce.product_resources (store_id, product_id, resource_id)
  SELECT v_store, m.new_id, commerce.clone_id(v_store, pr.resource_id)
    FROM commerce.product_resources pr JOIN pg_temp._copy_ids m ON m.old_id = pr.product_id
   WHERE pr.store_id = p_source AND m.new_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM commerce.booking_resources r
                  WHERE r.store_id = v_store AND r.id = commerce.clone_id(v_store, pr.resource_id));

  -- Menus (D85): their links name pages, categories and tags by address, which the copies keep; a link to a
  -- product that was not copied goes.
  INSERT INTO commerce.menus (id, store_id, name, items, created_at, created_by, updated_at, updated_by)
  SELECT commerce.clone_id(v_store, id), v_store, name,
         commerce.copy_remap(commerce.copy_menu_items(v_store, items), p_source, v_store), created_at, p_owner,
         updated_at, p_owner
    FROM commerce.menus WHERE store_id = p_source;

  -- Pages, posts, headers, footers and product layouts ----------------------------------------------------------

  -- The chosen pages and posts, and every header, footer and product layout (they are settings), with their
  -- draft and published content: category, tag, menu, field group and saved part ids made the copies'. Posts
  -- keep the dates they were first published on.
  INSERT INTO commerce.pages (
    id, store_id, type, slug, draft, published, published_at, first_published_at, created_at, created_by, updated_at,
    updated_by
  )
  SELECT m.new_id, v_store, p.type, p.slug, commerce.copy_remap(p.draft, p_source, v_store),
         commerce.copy_remap(p.published, p_source, v_store), p.published_at, p.first_published_at, p.created_at,
         p_owner, p.updated_at, p_owner
    FROM commerce.pages p JOIN pg_temp._copy_ids m ON m.old_id = p.id
   WHERE p.store_id = p_source AND m.new_id IS NOT NULL;

  UPDATE commerce.stores s
     SET front_page_id = (SELECT m.new_id FROM pg_temp._copy_ids m WHERE m.old_id = t.front_page_id),
         products_page_id = (SELECT m.new_id FROM pg_temp._copy_ids m WHERE m.old_id = t.products_page_id),
         product_layout_id = (SELECT m.new_id FROM pg_temp._copy_ids m WHERE m.old_id = t.product_layout_id),
         header_id = (SELECT m.new_id FROM pg_temp._copy_ids m WHERE m.old_id = t.header_id),
         footer_id = (SELECT m.new_id FROM pg_temp._copy_ids m WHERE m.old_id = t.footer_id),
         header_menu_id = (SELECT m.new_id FROM pg_temp._copy_ids m WHERE m.old_id = t.header_menu_id),
         footer_menu_id = (SELECT m.new_id FROM pg_temp._copy_ids m WHERE m.old_id = t.footer_menu_id),
         theme = commerce.copy_remap(t.theme, p_source, v_store)
    FROM commerce.stores t
   WHERE s.id = v_store AND t.id = p_source;

  UPDATE commerce.terms c
     SET product_layout_id = m.new_id
    FROM commerce.terms t JOIN pg_temp._copy_ids m ON m.old_id = t.product_layout_id
   WHERE t.store_id = p_source AND c.store_id = v_store AND c.id = commerce.clone_id(v_store, t.id)
     AND m.new_id IS NOT NULL;

  UPDATE commerce.products c
     SET product_layout_id = m.new_id
    FROM commerce.products t JOIN pg_temp._copy_ids m ON m.old_id = t.product_layout_id
   WHERE t.store_id = p_source AND c.store_id = v_store AND c.id = commerce.clone_id(v_store, t.id)
     AND m.new_id IS NOT NULL;

  -- The blog, search, 404 and working pages (D112, D113): the copies of the original's chosen pages.
  INSERT INTO commerce.page_roles (store_id, role, page_id)
  SELECT v_store, r.role, m.new_id
    FROM commerce.page_roles r JOIN pg_temp._copy_ids m ON m.old_id = r.page_id
   WHERE r.store_id = p_source AND m.new_id IS NOT NULL;

  -- Products' status: what it was, but a download waits as a draft for its files (they stay with the original).
  UPDATE commerce.products p
     SET status = 'active'
    FROM commerce.products t
   WHERE t.store_id = p_source AND t.status = 'active' AND p.store_id = v_store
     AND p.id = commerce.clone_id(v_store, t.id)
     AND NOT EXISTS (
       SELECT 1 FROM commerce.product_variants v
        WHERE v.product_id = p.id AND v.active AND v.delivery = 'digital'
     );

  -- Campaigns (D114) and what they name ----------------------------------------------------------------------------

  -- A campaign for products that were not copied is switched off rather than left to reach the whole store,
  -- and one giving a product that was not copied is left out (a gift needs its product).
  INSERT INTO commerce.campaigns (
    id, store_id, name, kind, percent, buy_quantity, pay_quantity, gift_variant_id, gift_quantity, thresholds,
    product_ids, term_ids, starts_at, ends_at, active, created_at, updated_at, tier_ids, usage_limit, stacks,
    per_customer_limit, markets
  )
  SELECT commerce.clone_id(v_store, c.id), v_store, c.name, c.kind, c.percent, c.buy_quantity, c.pay_quantity,
         g.new_id, c.gift_quantity, c.thresholds, scoped.product_ids, commerce.copy_remap(c.term_ids, p_source, v_store),
         c.starts_at, c.ends_at,
         c.active AND NOT (
           jsonb_array_length(c.product_ids) + jsonb_array_length(c.term_ids) > 0
           AND jsonb_array_length(scoped.product_ids) + jsonb_array_length(c.term_ids) = 0
         ),
         c.created_at, c.updated_at, commerce.copy_remap(c.tier_ids, p_source, v_store), c.usage_limit, c.stacks,
         c.per_customer_limit, c.markets
    FROM commerce.campaigns c
    LEFT JOIN pg_temp._copy_ids g ON g.old_id = c.gift_variant_id
    CROSS JOIN LATERAL (SELECT commerce.copy_remap(c.product_ids, p_source, v_store) AS product_ids) scoped
   WHERE c.store_id = p_source AND (c.gift_variant_id IS NULL OR g.new_id IS NOT NULL);

  UPDATE commerce.discount_codes d
     SET product_ids = commerce.copy_remap(t.product_ids, p_source, v_store),
         active = t.active AND NOT (
           jsonb_array_length(t.product_ids) > 0
           AND jsonb_array_length(commerce.copy_remap(t.product_ids, p_source, v_store)) = 0
         )
    FROM commerce.discount_codes t
   WHERE t.store_id = p_source AND t.product_ids IS NOT NULL AND d.store_id = v_store
     AND d.id = commerce.clone_id(v_store, t.id);

  -- Custom fields (D118): what was entered for the things copied (a link or relation to something that was
  -- not copied is left out), the store's own values, and what keyword search reads of them.
  INSERT INTO commerce.field_values (store_id, entity, entity_id, locale, values, updated_at)
  SELECT v_store, fv.entity, m.new_id, fv.locale, commerce.copy_remap(fv.values, p_source, v_store), fv.updated_at
    FROM commerce.field_values fv JOIN pg_temp._copy_ids m ON m.old_id = fv.entity_id
   WHERE fv.store_id = p_source AND fv.entity IN ('product', 'page', 'article', 'variant', 'term')
     AND m.new_id IS NOT NULL;

  INSERT INTO commerce.field_values (store_id, entity, entity_id, locale, values, updated_at)
  SELECT v_store, 'store', v_store, fv.locale, commerce.copy_remap(fv.values, p_source, v_store), fv.updated_at
    FROM commerce.field_values fv
   WHERE fv.store_id = p_source AND fv.entity = 'store' AND fv.entity_id = p_source;

  INSERT INTO commerce.field_search (store_id, entity, entity_id, locale, body)
  SELECT v_store, fs.entity, m.new_id, fs.locale, fs.body
    FROM commerce.field_search fs JOIN pg_temp._copy_ids m ON m.old_id = fs.entity_id
   WHERE fs.store_id = p_source AND m.new_id IS NOT NULL;

  RETURN v_store;
END;
$$;
