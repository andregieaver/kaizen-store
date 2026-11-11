-- Loyalty rewards and a birthday credit (wave 13 unit A, D401, docs/bonus.md "Rewards and the birthday credit").
--
-- * `bonus_rewards` is private like every commerce table and written only by `src/server/bonus-rewards.ts`.
-- * Two ledger kinds: `reward` (credits spent on a reward, negative, taken exactly or not at all) and `birthday` (the yearly credit, a lot).
-- * `commerce.bonus_redeem_reward()`: under the customer's ledger lock, takes a reward's cost and makes the customer's one generated code in the same
--   transaction, once per redemption key.
-- * `commerce.bonus_birthday_grants()`: the yearly credit on the store's own day, from the daily bonus job.
-- * A store's copy never carries a reward's code (its rewards are not copied), and carries the birthday credit with the program's settings.

ALTER TABLE commerce.bonus_rewards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.bonus_entries DROP CONSTRAINT bonus_entries_kind;
--> statement-breakpoint
ALTER TABLE commerce.bonus_entries ADD CONSTRAINT bonus_entries_kind
  CHECK (kind IN ('earn', 'redeem', 'restore', 'reverse', 'expire', 'adjust', 'referral', 'signup', 'reward', 'birthday'));
--> statement-breakpoint
ALTER TABLE commerce.bonus_entries DROP CONSTRAINT bonus_entries_sign;
--> statement-breakpoint
ALTER TABLE commerce.bonus_entries ADD CONSTRAINT bonus_entries_sign CHECK (
  (kind IN ('earn', 'restore', 'referral', 'signup', 'birthday') AND amount_minor > 0)
  OR (kind IN ('redeem', 'reverse', 'expire', 'reward') AND amount_minor < 0)
  OR kind = 'adjust'
);
--> statement-breakpoint

-- Spends a customer's credits on a reward: the cost taken exactly (`bonus.insufficient` when they have less), and the generated code
-- `p_item` (id and text the server chose) made for this customer alone, ending at `p_ends_at`. Once per `p_item`: a second call returns it again.
CREATE FUNCTION commerce.bonus_redeem_reward(
  p_store uuid, p_customer uuid, p_reward uuid, p_item uuid, p_code text, p_ends_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_reward commerce.bonus_rewards%ROWTYPE;
BEGIN
  PERFORM commerce.bonus_lock(p_store, p_customer);
  IF EXISTS (SELECT 1 FROM commerce.bonus_entries e WHERE e.store_id = p_store AND e.idempotency_key = 'reward:' || p_item) THEN
    RETURN p_item;
  END IF;
  IF NOT commerce.bonus_program_on(p_store) THEN
    RAISE EXCEPTION 'bonus.off';
  END IF;
  SELECT * INTO v_reward FROM commerce.bonus_rewards r WHERE r.store_id = p_store AND r.id = p_reward AND r.active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bonus.reward_gone';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.customers c WHERE c.store_id = p_store AND c.id = p_customer) THEN
    RAISE EXCEPTION 'bonus.customer';
  END IF;
  PERFORM commerce.bonus_take(p_store, p_customer, 'reward', v_reward.cost_minor, 'any', NULL, NULL, NULL,
                              v_reward.name, NULL, 'reward:' || p_item, true);
  INSERT INTO commerce.discount_code_items (id, store_id, discount_id, code, batch, customer_id, ends_at)
  VALUES (p_item, p_store, v_reward.discount_id, upper(p_code), 1, p_customer, p_ends_at);
  RETURN p_item;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.bonus_redeem_reward(uuid, uuid, uuid, uuid, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint

-- The birthday credit: for each real, open store whose program works and gives one, each customer with a proven email whose birthday is the
-- store's own date today (29 February on the 28th in other years), given at least 30 days ago, once a year (keyed by the year). Returns how many.
CREATE FUNCTION commerce.bonus_birthday_grants(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT c.store_id, c.id AS customer_id, b.birthday_minor, (p_now AT TIME ZONE s.time_zone)::date AS today
    FROM commerce.bonus_settings b
    JOIN commerce.stores s ON s.id = b.store_id
    JOIN commerce.customers c ON c.store_id = b.store_id
    WHERE b.birthday_minor > 0
      AND NOT s.is_template AND NOT s.starter
      AND commerce.store_is_active(b.store_id)
      AND commerce.bonus_program_on(b.store_id)
      AND c.birthday IS NOT NULL
      AND c.email_verified_at IS NOT NULL
      AND c.birthday_set_at <= p_now - interval '30 days'
      AND (
        c.birthday = to_char((p_now AT TIME ZONE s.time_zone)::date, 'MM-DD')
        OR (c.birthday = '02-29' AND to_char((p_now AT TIME ZONE s.time_zone)::date, 'MM-DD') = '02-28'
            AND NOT (extract(year FROM (p_now AT TIME ZONE s.time_zone)) :: integer % 4 = 0
                     AND (extract(year FROM (p_now AT TIME ZONE s.time_zone)) :: integer % 100 <> 0
                          OR extract(year FROM (p_now AT TIME ZONE s.time_zone)) :: integer % 400 = 0)))
      )
      AND NOT EXISTS (
        SELECT 1 FROM commerce.bonus_entries e
        WHERE e.store_id = c.store_id
          AND e.idempotency_key = 'birthday:' || c.id || ':' || extract(year FROM (p_now AT TIME ZONE s.time_zone))::integer
      )
  LOOP
    PERFORM commerce.bonus_grant(v_row.store_id, v_row.customer_id, 'birthday', v_row.birthday_minor, NULL, NULL, p_now,
                                 commerce.bonus_expiry_from(v_row.store_id, p_now), '', NULL,
                                 'birthday:' || v_row.customer_id || ':' || extract(year FROM v_row.today)::integer);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.bonus_birthday_grants(timestamptz) FROM PUBLIC;
--> statement-breakpoint

-- A store's copy: a reward's code stays with the store whose rewards it serves (rewards are not copied), and the birthday credit goes with the
-- program's settings, as the levels and the account credit do (D392).
DO $patch$
DECLARE
  v_fn text;
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.oid = 'commerce.duplicate_store'::regproc;
  IF position('AND NOT reward;' in v_def) = 0 THEN
    v_new := replace(v_def,
      'created_at, updated_at, min_quantity, unique_codes, combines_with
    FROM commerce.discount_codes WHERE store_id = p_source;',
      'created_at, updated_at, min_quantity, unique_codes, combines_with
    FROM commerce.discount_codes WHERE store_id = p_source AND NOT reward;');
    IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the discount code copy was not found'; END IF;
    EXECUTE v_new;
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['commerce.duplicate_store', 'commerce.clone_starter_setup'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.oid = v_fn::regproc;
    IF position('levels, signup_minor, birthday_minor' in v_def) > 0 THEN CONTINUE; END IF;
    v_new := replace(replace(v_def,
      'min_redeem_minor, expires_months, levels, signup_minor, currency, updated_by', 'min_redeem_minor, expires_months, levels, signup_minor, birthday_minor, currency, updated_by'),
      'min_redeem_minor, expires_months, levels, signup_minor, currency, p_owner', 'min_redeem_minor, expires_months, levels, signup_minor, birthday_minor, currency, p_owner');
    IF v_new = v_def THEN RAISE EXCEPTION '%: the bonus settings copy was not found', v_fn; END IF;
    EXECUTE v_new;
  END LOOP;
END;
$patch$;
