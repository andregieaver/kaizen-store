-- Loyalty levels and the credit for opening an account (wave 11 unit M, D392, docs/bonus.md "Levels").
--
-- * `bonus_settings.levels`: up to four levels above the program's own rate, each `{name, fromMinor, earnBps}`; a customer's level is
--   the highest whose `fromMinor` what they paid for goods in the last 365 days, less refunds, reaches (`commerce.bonus_level_spend()`,
--   in the credits' currency, the order being paid left out), and `commerce.bonus_order_paid()` earns at the level's rate.
-- * `bonus_settings.signup_minor`: credits given once to a customer whose account is opened (their email proven for the first time) while
--   the program is on: a ledger entry of kind `signup`, usable at once, keyed `signup:{customer}` so it is never given twice.

ALTER TABLE commerce.bonus_entries DROP CONSTRAINT bonus_entries_kind;
--> statement-breakpoint
ALTER TABLE commerce.bonus_entries ADD CONSTRAINT bonus_entries_kind
  CHECK (kind IN ('earn', 'redeem', 'restore', 'reverse', 'expire', 'adjust', 'referral', 'signup'));
--> statement-breakpoint
ALTER TABLE commerce.bonus_entries DROP CONSTRAINT bonus_entries_sign;
--> statement-breakpoint
ALTER TABLE commerce.bonus_entries ADD CONSTRAINT bonus_entries_sign CHECK (
  (kind IN ('earn', 'restore', 'referral', 'signup') AND amount_minor > 0)
  OR (kind IN ('redeem', 'reverse', 'expire') AND amount_minor < 0)
  OR kind = 'adjust'
);
--> statement-breakpoint
ALTER TABLE commerce.bonus_settings ADD CONSTRAINT bonus_settings_levels
  CHECK (jsonb_typeof(levels) = 'array' AND jsonb_array_length(levels) <= 4);
--> statement-breakpoint
ALTER TABLE commerce.bonus_settings ADD CONSTRAINT bonus_settings_signup CHECK (signup_minor >= 0 AND signup_minor <= 1000000);
--> statement-breakpoint

-- What a customer paid for goods in the last 365 days, less what was refunded, in the credits' currency: the measure of their level.
-- Paid orders only (a captured payment), never copied or a host's, the order being paid left out; an order in a currency with no rate
-- counts nothing (never a guess).
CREATE FUNCTION commerce.bonus_level_spend(p_store uuid, p_customer uuid, p_except uuid)
RETURNS bigint
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT coalesce(sum(greatest(0, coalesce(commerce.bonus_convert(o.store_id, goods.minor - coalesce(back.minor, 0), o.currency, commerce.bonus_currency(o.store_id)), 0))), 0)::bigint
    FROM commerce.orders o
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(ol.total_minor - ol.venue_minor), 0)::bigint AS minor
        FROM commerce.order_lines ol WHERE ol.store_id = o.store_id AND ol.order_id = o.id
    ) goods
    LEFT JOIN LATERAL (
      SELECT sum(r.amount_minor)::bigint AS minor
        FROM commerce.refunds r JOIN commerce.payments p ON p.store_id = r.store_id AND p.id = r.payment_id
       WHERE r.store_id = o.store_id AND p.order_id = o.id AND r.status::text = 'succeeded'
    ) back ON true
   WHERE o.store_id = p_store AND o.customer_id = p_customer
     AND (p_except IS NULL OR o.id <> p_except)
     AND o.copied_from IS NULL AND o.host_id IS NULL
     AND o.placed_at > now() - interval '365 days'
     AND EXISTS (SELECT 1 FROM commerce.payments p WHERE p.store_id = o.store_id AND p.order_id = o.id AND p.status::text = 'captured');
$$;
--> statement-breakpoint

-- The rate a customer earns at on an order: the highest level their spending reaches, else the program's own.
CREATE FUNCTION commerce.bonus_earn_bps(p_store uuid, p_customer uuid, p_order uuid)
RETURNS integer
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
  v_s commerce.bonus_settings%ROWTYPE;
  v_spent bigint;
  v_bps integer;
BEGIN
  SELECT * INTO v_s FROM commerce.bonus_settings WHERE store_id = p_store;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF jsonb_array_length(v_s.levels) = 0 THEN RETURN v_s.earn_bps; END IF;
  v_spent := commerce.bonus_level_spend(p_store, p_customer, p_order);
  SELECT (l ->> 'earnBps')::integer INTO v_bps
    FROM jsonb_array_elements(v_s.levels) l
   WHERE (l ->> 'fromMinor')::bigint <= v_spent
   ORDER BY (l ->> 'fromMinor')::bigint DESC
   LIMIT 1;
  RETURN coalesce(v_bps, v_s.earn_bps);
END;
$$;
--> statement-breakpoint

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.bonus_order_paid(uuid, text)'::regprocedure);
  IF position('bonus_earn_bps' in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    $a$v_earn := floor(v_base::numeric * v_s.earn_bps / 10000)::bigint;$a$,
    $b$v_earn := floor(v_base::numeric * commerce.bonus_earn_bps(v_o.store_id, v_o.customer_id, p_order) / 10000)::bigint;$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'bonus_order_paid: the earning line was not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- A store's copy and a store made from a template carry the levels and the account credit with the rest of the program's settings.
DO $patch$
DECLARE
  v_fn text;
  v_def text;
  v_new text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['commerce.duplicate_store', 'commerce.clone_starter_setup'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.oid = v_fn::regproc;
    IF position('expires_months, levels, signup_minor' in v_def) > 0 THEN CONTINUE; END IF;
    v_new := replace(replace(v_def,
      'min_redeem_minor, expires_months, currency, updated_by', 'min_redeem_minor, expires_months, levels, signup_minor, currency, updated_by'),
      'min_redeem_minor, expires_months, currency, p_owner', 'min_redeem_minor, expires_months, levels, signup_minor, currency, p_owner');
    IF v_new = v_def THEN RAISE EXCEPTION '%: the bonus settings copy was not found', v_fn; END IF;
    EXECUTE v_new;
  END LOOP;
END;
$patch$;
--> statement-breakpoint

-- The credit for opening an account: once per customer, while the program works, in a real store (never a template's or demo store's).
CREATE FUNCTION commerce.bonus_signup_grant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_s commerce.bonus_settings%ROWTYPE;
BEGIN
  IF NEW.email_verified_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.email_verified_at IS NOT NULL) THEN RETURN NEW; END IF;
  SELECT * INTO v_s FROM commerce.bonus_settings WHERE store_id = NEW.store_id;
  IF NOT FOUND OR v_s.signup_minor <= 0 OR NOT commerce.bonus_program_on(NEW.store_id) THEN RETURN NEW; END IF;
  IF NOT commerce.store_is_active(NEW.store_id) OR EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.is_template) THEN RETURN NEW; END IF;
  PERFORM commerce.bonus_grant(NEW.store_id, NEW.id, 'signup', v_s.signup_minor, NULL, NULL, now(),
                               commerce.bonus_expiry_from(NEW.store_id, now()), '', NULL, 'signup:' || NEW.id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER customers_bonus_signup AFTER INSERT OR UPDATE OF email_verified_at ON commerce.customers
  FOR EACH ROW EXECUTE FUNCTION commerce.bonus_signup_grant();
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.bonus_level_spend(uuid, uuid, uuid), commerce.bonus_earn_bps(uuid, uuid, uuid) FROM PUBLIC;
