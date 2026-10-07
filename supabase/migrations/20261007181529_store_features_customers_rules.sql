-- Store features, step 2 (D178, docs/store-features.md): the Customers group, `business`, `bonus` and `referrals`. Each feature's switch is the
-- gate; what it switches off is hidden and refused, nothing is deleted, and past orders keep what they had.
--
-- * Selling to businesses: who a store sells to as shoppers see it is `commerce.store_audience(audience, features)`: the owner's choice while
--   the feature is on, else consumers. A product for the others' kind is not offered at all (`audience_offered()`, `product_offered()`): a
--   business-only product in a store selling to consumers is hidden and cannot be bought (the same rule closes the gap where an owner had
--   simply chosen consumers). Switching the feature off clears the company and VAT number of the store's open carts, so reverse charge
--   cannot outlive it (`stores_features_after()`).
-- * The bonus program: on is the feature with its own switch (`bonus_program_on()`). Off, credits are neither used nor earned, and nothing
--   expires: `bonus_settings.paused_at` (kept by `bonus_pause_sync()` and the settings' trigger) holds the expiry job and the reminders back;
--   when the program comes back on, credits whose expiry passed meanwhile are expired and granted again as a returned lot that expires as
--   long after as the program was off (`bonus_resume()`), so the ledger stays append-only.
-- * The referral program: on is the feature (which needs the bonus feature) with both programs' switches (`affiliate_program_on()`).
--   An order attributed while it was on still rewards the referrer when it is paid, even if the program is off by then
--   (`affiliate_order_paid()` no longer rejects it as `off`).
--
-- Functions replaced whole from their only definitions (20260930172724_bonus_program_rules.sql, 20260930184741_affiliate_rules.sql),
-- each changed in the lines named above it.
--> statement-breakpoint

-- Who a store sells to, as its shoppers see it: its chosen audience while the feature `business` is on (with what it needs), else consumers.
CREATE FUNCTION commerce.store_audience(p_audience text, p_features text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN 'business' = ANY (p_features) AND commerce.feature_needs('business') <@ p_features THEN p_audience ELSE 'consumers' END
$$;
--> statement-breakpoint

-- Whether a product with this audience is offered at all in a store selling to `p_store_audience`: a product for everyone always; in a store
-- selling to both, any (each shopper sees their kind's); in a store selling to one kind, only that kind's.
CREATE FUNCTION commerce.audience_offered(p_store_audience text, p_product_audience text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_product_audience = 'all' OR p_store_audience = 'both'
      OR (p_product_audience = 'businesses') = (p_store_audience = 'businesses')
$$;
--> statement-breakpoint

-- The same for a product of a store, read from the store's row (shopper-facing queries call it only for a product that is not for everyone).
CREATE FUNCTION commerce.product_offered(p_store uuid, p_product_audience text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p_product_audience = 'all'
      OR coalesce((SELECT commerce.audience_offered(commerce.store_audience(s.audience, s.features), p_product_audience)
                     FROM commerce.stores s WHERE s.id = p_store), false)
$$;
--> statement-breakpoint

-- The bonus program works while the store feature `bonus` is on (with the shop) and its own switch is on.
CREATE FUNCTION commerce.bonus_program_on(p_store uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT commerce.feature_on(p_store, 'bonus')
     AND coalesce((SELECT b.enabled FROM commerce.bonus_settings b WHERE b.store_id = p_store), false)
$$;
--> statement-breakpoint

-- Changed: refused with `bonus.off` while the program is not on (`bonus_program_on()`, the feature included), not only its own switch.
CREATE OR REPLACE FUNCTION commerce.bonus_redeem(p_store uuid, p_customer uuid, p_order uuid, p_amount bigint, p_key text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.bonus_entries e WHERE e.store_id = p_store AND e.idempotency_key = p_key)
     AND NOT commerce.bonus_program_on(p_store) THEN
    RAISE EXCEPTION 'bonus.off';
  END IF;
  RETURN commerce.bonus_take(p_store, p_customer, 'redeem', p_amount, 'available', NULL, p_order, NULL, '', NULL, p_key, true);
END;
$$;
--> statement-breakpoint

-- Changed: earns only while the store feature `bonus` is on as well as the program's own switch.
CREATE OR REPLACE FUNCTION commerce.bonus_order_paid(p_order uuid, p_was text)
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
  IF NOT FOUND OR NOT v_s.enabled OR NOT commerce.feature_on(v_o.store_id, 'bonus') THEN
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

-- Changed: nothing of a store whose program is off (`bonus_settings.paused_at`) is written off; `bonus_resume()` moves it on.
CREATE OR REPLACE FUNCTION commerce.bonus_expire_due(p_limit integer DEFAULT 1000)
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
       AND NOT EXISTS (SELECT 1 FROM commerce.bonus_settings b WHERE b.store_id = e.store_id AND b.paused_at IS NOT NULL)
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

-- Changed: no reminder for a store whose program is off (`bonus_settings.paused_at`): nothing of it expires while it is.
CREATE OR REPLACE FUNCTION commerce.bonus_expiring(p_days integer)
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
         AND NOT EXISTS (SELECT 1 FROM commerce.bonus_settings b WHERE b.store_id = e.store_id AND b.paused_at IS NOT NULL)
    ) x
   WHERE x.remaining > 0
   GROUP BY x.store_id, x.customer_id
$$;
--> statement-breakpoint

-- The program came back on after being off since `p_since`: every lot whose expiry passed meanwhile with credits left is expired (its own
-- key, so the job never takes it again) and granted again as a `restore` lot of the same amount, usable as it was, expiring as long after
-- its old date as the program was off. The ledger stays append-only and the balance whole. Returns the number of lots moved.
CREATE FUNCTION commerce.bonus_resume(p_store uuid, p_since timestamptz)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_lot record;
  v_taken bigint;
  v_count integer := 0;
  v_shift interval := now() - p_since;
BEGIN
  IF p_since IS NULL OR v_shift <= interval '0' THEN
    RETURN 0;
  END IF;
  FOR v_lot IN
    SELECT e.id, e.customer_id, e.available_at, e.expires_at,
           (e.amount_minor - coalesce((SELECT sum(a.amount_minor) FROM commerce.bonus_allocations a
                                        WHERE a.store_id = e.store_id AND a.lot_id = e.id), 0))::bigint AS remaining
      FROM commerce.bonus_entries e
     WHERE e.store_id = p_store AND e.amount_minor > 0 AND e.expires_at IS NOT NULL
       AND e.expires_at >= p_since AND e.expires_at <= now()
     ORDER BY e.expires_at, e.id
  LOOP
    CONTINUE WHEN v_lot.remaining <= 0;
    v_taken := commerce.bonus_take(p_store, v_lot.customer_id, 'expire', v_lot.remaining, 'lot', v_lot.id, NULL::uuid, NULL::uuid,
                                   'the bonus program was off when these credits expired: moved', NULL::uuid, 'expire-paused:' || v_lot.id);
    IF v_taken > 0 THEN
      PERFORM commerce.bonus_grant(p_store, v_lot.customer_id, 'restore', v_taken, NULL::uuid, NULL::uuid,
                                   coalesce(v_lot.available_at, now()), v_lot.expires_at + v_shift,
                                   'the bonus program was off when these credits expired', NULL::uuid, 'resume:' || v_lot.id);
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
--> statement-breakpoint

-- Keeps `bonus_settings.paused_at` in step with whether the program is on, for a change of the store's features: set when it goes off, and
-- when it comes back on the credits that expired meanwhile are moved (`bonus_resume()`) and the pause ends.
CREATE FUNCTION commerce.bonus_pause_sync(p_store uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_s commerce.bonus_settings%ROWTYPE;
  v_on boolean;
BEGIN
  SELECT * INTO v_s FROM commerce.bonus_settings b WHERE b.store_id = p_store FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_on := v_s.enabled AND commerce.feature_on(p_store, 'bonus');
  IF v_on AND v_s.paused_at IS NOT NULL THEN
    PERFORM commerce.bonus_resume(p_store, v_s.paused_at);
    UPDATE commerce.bonus_settings SET paused_at = NULL WHERE store_id = p_store;
  ELSIF NOT v_on AND v_s.paused_at IS NULL THEN
    UPDATE commerce.bonus_settings SET paused_at = now() WHERE store_id = p_store;
  END IF;
END;
$$;
--> statement-breakpoint

-- The same for the program's own switch (and a new row): before the row is written, so the pause is part of the same change.
CREATE FUNCTION commerce.bonus_settings_pause()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_on boolean := NEW.enabled AND commerce.feature_on(NEW.store_id, 'bonus');
  v_since timestamptz := CASE WHEN TG_OP = 'UPDATE' THEN OLD.paused_at END;
BEGIN
  IF v_on THEN
    IF v_since IS NOT NULL THEN
      PERFORM commerce.bonus_resume(NEW.store_id, v_since);
    END IF;
    NEW.paused_at := NULL;
  ELSE
    NEW.paused_at := coalesce(v_since, NEW.paused_at, now());
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER bonus_settings_pause
BEFORE INSERT OR UPDATE OF enabled ON commerce.bonus_settings
FOR EACH ROW EXECUTE FUNCTION commerce.bonus_settings_pause();
--> statement-breakpoint

-- What a change of a store's features does beyond the row: selling to businesses switched off clears the company and VAT number of its open
-- carts (reverse charge cannot outlive the feature; past orders keep theirs), and the bonus program's pause follows its feature.
CREATE FUNCTION commerce.stores_features_after()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.features IS NOT DISTINCT FROM OLD.features THEN
    RETURN NULL;
  END IF;
  IF commerce.store_audience(OLD.audience, OLD.features) <> 'consumers'
     AND commerce.store_audience(NEW.audience, NEW.features) = 'consumers' THEN
    UPDATE commerce.carts
       SET company_name = NULL, organisation_number = NULL, vat_number = NULL, vat_check_id = NULL
     WHERE store_id = NEW.id AND status = 'open'
       AND (company_name IS NOT NULL OR organisation_number IS NOT NULL OR vat_number IS NOT NULL OR vat_check_id IS NOT NULL);
  END IF;
  IF ('bonus' = ANY (commerce.features_effective(OLD.features))) IS DISTINCT FROM ('bonus' = ANY (commerce.features_effective(NEW.features))) THEN
    PERFORM commerce.bonus_pause_sync(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER stores_features_after
AFTER UPDATE OF features ON commerce.stores
FOR EACH ROW EXECUTE FUNCTION commerce.stores_features_after();
--> statement-breakpoint

-- Programs that are off now start their pause now (before this change their credits kept expiring).
UPDATE commerce.bonus_settings b
   SET paused_at = now()
 WHERE b.paused_at IS NULL AND NOT (b.enabled AND commerce.feature_on(b.store_id, 'bonus'));
--> statement-breakpoint

-- Changed: the store feature `referrals` (which needs `bonus`) must be on too, and the bonus program is asked through `bonus_program_on()`.
CREATE OR REPLACE FUNCTION commerce.affiliate_program_on(p_store uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT commerce.feature_on(p_store, 'referrals')
     AND coalesce((SELECT s.enabled FROM commerce.affiliate_settings s WHERE s.store_id = p_store), false)
     AND commerce.bonus_program_on(p_store)
$$;
--> statement-breakpoint

-- Changed: an attribution is no longer rejected as `off` when the order is paid; the guards that follow are as they were.
CREATE OR REPLACE FUNCTION commerce.affiliate_order_paid(p_order uuid)
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

  -- No 'off' here (D178): the order was attributed while the program was on, so its reward is granted when it is due even if the
  -- program, or the bonus program, has been switched off since. Orders placed while it is off are never attributed.
  IF v_friend.id IS NULL THEN
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
