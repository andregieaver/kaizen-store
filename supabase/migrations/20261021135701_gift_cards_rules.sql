-- Gift cards (wave 5 unit F, D300, docs/wave-5-marketing.md 8.1). A card's balance is only `commerce.gift_card_balance()`, the sum of
-- its ledger; the ledger is append-only and written only by the `gift_card_*` functions below (each sets `kaizen.gift_card_ledger` for
-- its own transaction, which the insert triggers ask for), each once per key, under the card's row lock; no balance ever goes below zero.
ALTER TABLE commerce.gift_cards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.gift_card_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.gift_card_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.gift_card_balance(p_card uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(sum(e.amount_minor), 0)::bigint FROM commerce.gift_card_entries e WHERE e.card_id = p_card
$$;
--> statement-breakpoint

-- Only the functions write cards and entries.
CREATE FUNCTION commerce.gift_card_writer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF coalesce(current_setting('kaizen.gift_card_ledger', true), '') <> 'on' THEN
    RAISE EXCEPTION 'gift_cards.writer: gift cards and their ledger are written only by the gift_card functions' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER gift_cards_writer BEFORE INSERT ON commerce.gift_cards FOR EACH ROW EXECUTE FUNCTION commerce.gift_card_writer();
--> statement-breakpoint
CREATE TRIGGER gift_card_entries_writer BEFORE INSERT ON commerce.gift_card_entries FOR EACH ROW EXECUTE FUNCTION commerce.gift_card_writer();
--> statement-breakpoint

-- The ledger is never changed or deleted, and no entry takes a card below zero.
CREATE FUNCTION commerce.gift_card_entries_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'gift_card_entries.fixed: a gift card''s ledger is never changed' USING ERRCODE = 'check_violation';
  END IF;
  IF commerce.gift_card_balance(NEW.card_id) + NEW.amount_minor < 0 THEN
    RAISE EXCEPTION 'gift_card_entries.balance: a gift card''s balance cannot go below zero' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER gift_card_entries_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.gift_card_entries
  FOR EACH ROW EXECUTE FUNCTION commerce.gift_card_entries_rules();
--> statement-breakpoint

-- A card's identity is fixed; its code is set once; it is deactivated once; it is sent once; the person's fields only go (erasure).
CREATE FUNCTION commerce.gift_cards_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'gift_cards.kept: a gift card is never deleted (deactivate it)' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.store_id, NEW.currency, NEW.initial_minor, NEW.source, NEW.order_id, NEW.order_line_id, NEW.unit_index, NEW.issued_by,
      NEW.issued_at, NEW.expires_at, NEW.test_mode, NEW.note, NEW.created_at)
     IS DISTINCT FROM
     (OLD.store_id, OLD.currency, OLD.initial_minor, OLD.source, OLD.order_id, OLD.order_line_id, OLD.unit_index, OLD.issued_by,
      OLD.issued_at, OLD.expires_at, OLD.test_mode, OLD.note, OLD.created_at) THEN
    RAISE EXCEPTION 'gift_cards.fixed: a gift card''s amount, currency, source and dates stay as issued' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.code_hash IS NOT NULL AND (NEW.code_hash, NEW.last4) IS DISTINCT FROM (OLD.code_hash, OLD.last4) THEN
    RAISE EXCEPTION 'gift_cards.code: a gift card''s code is set once' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'deactivated' AND (NEW.status, NEW.deactivated_at, NEW.deactivated_by) IS DISTINCT FROM (OLD.status, OLD.deactivated_at, OLD.deactivated_by) THEN
    RAISE EXCEPTION 'gift_cards.deactivated: a deactivated gift card stays so' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
    RAISE EXCEPTION 'gift_cards.sent: a gift card is sent once' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NEW.customer_id IS NOT NULL)
     OR (NEW.recipient_email IS DISTINCT FROM OLD.recipient_email AND NEW.recipient_email IS NOT NULL)
     OR (NEW.recipient_name IS DISTINCT FROM OLD.recipient_name AND NEW.recipient_name IS NOT NULL)
     OR (NEW.message IS DISTINCT FROM OLD.message AND NEW.message IS NOT NULL) THEN
    RAISE EXCEPTION 'gift_cards.person: who a gift card is for is kept as given, or cleared' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER gift_cards_rules BEFORE UPDATE OR DELETE ON commerce.gift_cards
  FOR EACH ROW EXECUTE FUNCTION commerce.gift_cards_rules();
--> statement-breakpoint

-- An entry, once per key: the id of the one already kept, or of the new one.
CREATE FUNCTION commerce.gift_card_entry(p_store uuid, p_card uuid, p_kind text, p_amount bigint, p_order uuid, p_account uuid, p_note text, p_key text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT e.id INTO v_id FROM commerce.gift_card_entries e WHERE e.store_id = p_store AND e.card_id = p_card AND e.idempotency_key = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  PERFORM set_config('kaizen.gift_card_ledger', 'on', true);
  INSERT INTO commerce.gift_card_entries (store_id, card_id, kind, amount_minor, order_id, account_id, note, idempotency_key)
  VALUES (p_store, p_card, p_kind, p_amount, p_order, p_account, coalesce(p_note, ''), p_key)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- A card issued: for a unit of an order line once (`source` order), or by a person (`staff`); its expiry from the store's settings.
CREATE FUNCTION commerce.gift_card_issue(
  p_store uuid, p_source text, p_currency text, p_amount bigint,
  p_order uuid, p_line uuid, p_unit integer, p_account uuid, p_test boolean, p_customer uuid,
  p_recipient_email text, p_recipient_name text, p_message text, p_send_at timestamptz, p_note text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_card uuid;
  v_months integer;
BEGIN
  IF p_source = 'order' THEN
    SELECT g.id INTO v_card FROM commerce.gift_cards g WHERE g.store_id = p_store AND g.order_line_id = p_line AND g.unit_index = p_unit;
    IF v_card IS NOT NULL THEN
      RETURN v_card;
    END IF;
  END IF;
  SELECT CASE WHEN s.store_id IS NULL THEN 36 ELSE s.expiry_months END INTO v_months
    FROM (SELECT 1) one LEFT JOIN commerce.gift_card_settings s ON s.store_id = p_store;
  PERFORM set_config('kaizen.gift_card_ledger', 'on', true);
  INSERT INTO commerce.gift_cards (store_id, currency, initial_minor, source, order_id, order_line_id, unit_index, issued_by, note,
                                   test_mode, customer_id, recipient_email, recipient_name, message, send_at, expires_at)
  VALUES (p_store, upper(p_currency), p_amount, p_source, p_order, p_line, p_unit, p_account, coalesce(p_note, ''),
          coalesce(p_test, false), p_customer, p_recipient_email, p_recipient_name, p_message, p_send_at,
          CASE WHEN v_months IS NULL THEN NULL ELSE now() + make_interval(months => v_months) END)
  RETURNING id INTO v_card;
  PERFORM commerce.gift_card_entry(p_store, v_card, 'issue', p_amount, p_order, p_account, '', 'issue');
  RETURN v_card;
END;
$$;
--> statement-breakpoint

-- The card, locked, refusing another store's.
CREATE FUNCTION commerce.gift_card_locked(p_store uuid, p_card uuid)
RETURNS commerce.gift_cards
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v commerce.gift_cards;
BEGIN
  SELECT * INTO v FROM commerce.gift_cards g WHERE g.store_id = p_store AND g.id = p_card FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'gift_cards.unknown: no such gift card in this store' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v;
END;
$$;
--> statement-breakpoint

-- What an order holds on a card and has not had released: the amount it may still spend, or have refunded once spent.
CREATE FUNCTION commerce.gift_card_order_held(p_card uuid, p_order uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(-sum(e.amount_minor) FILTER (WHERE e.kind IN ('hold', 'release')), 0)::bigint
    FROM commerce.gift_card_entries e WHERE e.card_id = p_card AND e.order_id = p_order
$$;
--> statement-breakpoint

-- Money held for an order being placed: an active, unexpired card of this currency and mode with the balance for it.
CREATE FUNCTION commerce.gift_card_hold(p_store uuid, p_card uuid, p_order uuid, p_currency text, p_test boolean, p_amount bigint, p_key text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v commerce.gift_cards;
  v_done uuid;
BEGIN
  v := commerce.gift_card_locked(p_store, p_card);
  SELECT e.id INTO v_done FROM commerce.gift_card_entries e WHERE e.store_id = p_store AND e.card_id = p_card AND e.idempotency_key = p_key;
  IF v_done IS NOT NULL THEN
    RETURN v_done;
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'gift_cards.amount: hold a positive amount' USING ERRCODE = 'check_violation';
  END IF;
  IF v.status <> 'active' OR v.code_hash IS NULL THEN
    RAISE EXCEPTION 'gift_cards.inactive: this gift card cannot be used' USING ERRCODE = 'check_violation';
  END IF;
  IF v.expires_at IS NOT NULL AND v.expires_at <= now() THEN
    RAISE EXCEPTION 'gift_cards.expired: this gift card has expired' USING ERRCODE = 'check_violation';
  END IF;
  IF v.currency <> upper(p_currency) THEN
    RAISE EXCEPTION 'gift_cards.currency: this gift card is in another currency' USING ERRCODE = 'check_violation';
  END IF;
  IF v.test_mode IS DISTINCT FROM coalesce(p_test, false) THEN
    RAISE EXCEPTION 'gift_cards.mode: a test gift card is spent only in test mode, and a real one only for real' USING ERRCODE = 'check_violation';
  END IF;
  IF commerce.gift_card_balance(p_card) < p_amount THEN
    RAISE EXCEPTION 'gift_cards.balance: the gift card does not hold that much' USING ERRCODE = 'check_violation';
  END IF;
  RETURN commerce.gift_card_entry(p_store, p_card, 'hold', -p_amount, p_order, NULL, '', p_key);
END;
$$;
--> statement-breakpoint

-- What an order held goes back on the card (the order cancelled unpaid, its checkout expired); allowed after expiry and deactivation.
CREATE FUNCTION commerce.gift_card_release(p_store uuid, p_card uuid, p_order uuid, p_key text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_held bigint;
BEGIN
  PERFORM commerce.gift_card_locked(p_store, p_card);
  IF EXISTS (SELECT 1 FROM commerce.gift_card_entries e WHERE e.card_id = p_card AND e.order_id = p_order AND e.kind = 'spend') THEN
    RAISE EXCEPTION 'gift_cards.spent: this order''s hold was spent; refund it instead' USING ERRCODE = 'check_violation';
  END IF;
  v_held := commerce.gift_card_order_held(p_card, p_order);
  IF v_held <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN commerce.gift_card_entry(p_store, p_card, 'release', v_held, p_order, NULL, '', p_key);
END;
$$;
--> statement-breakpoint

-- An order's hold made final when the order is paid.
CREATE FUNCTION commerce.gift_card_spend(p_store uuid, p_card uuid, p_order uuid, p_key text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.gift_card_locked(p_store, p_card);
  IF commerce.gift_card_order_held(p_card, p_order) <= 0 THEN
    RAISE EXCEPTION 'gift_cards.nothing_held: this order holds nothing on the gift card' USING ERRCODE = 'check_violation';
  END IF;
  RETURN commerce.gift_card_entry(p_store, p_card, 'spend', 0, p_order, NULL, '', p_key);
END;
$$;
--> statement-breakpoint

-- A refund of an order paid with the card goes back on it: never more than the order spent on it, less what was refunded before.
CREATE FUNCTION commerce.gift_card_refund(p_store uuid, p_card uuid, p_order uuid, p_amount bigint, p_key text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_done uuid;
  v_spent bigint;
  v_refunded bigint;
BEGIN
  PERFORM commerce.gift_card_locked(p_store, p_card);
  SELECT e.id INTO v_done FROM commerce.gift_card_entries e WHERE e.store_id = p_store AND e.card_id = p_card AND e.idempotency_key = p_key;
  IF v_done IS NOT NULL THEN
    RETURN v_done;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.gift_card_entries e WHERE e.card_id = p_card AND e.order_id = p_order AND e.kind = 'spend') THEN
    RAISE EXCEPTION 'gift_cards.not_spent: this order did not spend the gift card' USING ERRCODE = 'check_violation';
  END IF;
  v_spent := commerce.gift_card_order_held(p_card, p_order);
  SELECT coalesce(sum(e.amount_minor), 0) INTO v_refunded FROM commerce.gift_card_entries e WHERE e.card_id = p_card AND e.order_id = p_order AND e.kind = 'refund';
  IF p_amount <= 0 OR p_amount > v_spent - v_refunded THEN
    RAISE EXCEPTION 'gift_cards.refund: a refund goes back on the card up to what the order spent on it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN commerce.gift_card_entry(p_store, p_card, 'refund', p_amount, p_order, NULL, '', p_key);
END;
$$;
--> statement-breakpoint

-- A person's change, with a reason: an active card, never below zero.
CREATE FUNCTION commerce.gift_card_adjust(p_store uuid, p_card uuid, p_account uuid, p_amount bigint, p_note text, p_key text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v commerce.gift_cards;
BEGIN
  v := commerce.gift_card_locked(p_store, p_card);
  IF v.status <> 'active' THEN
    RAISE EXCEPTION 'gift_cards.inactive: a deactivated gift card is not changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN commerce.gift_card_entry(p_store, p_card, 'adjust', p_amount, NULL, p_account, p_note, p_key);
END;
$$;
--> statement-breakpoint

-- What is left on a card past its date goes, once.
CREATE FUNCTION commerce.gift_card_expire(p_store uuid, p_card uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v commerce.gift_cards;
  v_left bigint;
BEGIN
  v := commerce.gift_card_locked(p_store, p_card);
  IF v.expires_at IS NULL OR v.expires_at > now() THEN
    RETURN NULL;
  END IF;
  v_left := commerce.gift_card_balance(p_card);
  IF v_left <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN commerce.gift_card_entry(p_store, p_card, 'expire', -v_left, NULL, NULL, '', 'expire:' || (SELECT count(*) FROM commerce.gift_card_entries e WHERE e.card_id = p_card AND e.kind = 'expire'));
END;
$$;
--> statement-breakpoint

-- A card deactivated by a person: what is left on it goes, and it is never spent again.
CREATE FUNCTION commerce.gift_card_void(p_store uuid, p_card uuid, p_account uuid, p_note text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v commerce.gift_cards;
  v_left bigint;
BEGIN
  v := commerce.gift_card_locked(p_store, p_card);
  IF v.status = 'deactivated' THEN
    RETURN NULL;
  END IF;
  UPDATE commerce.gift_cards SET status = 'deactivated', deactivated_at = now(), deactivated_by = p_account WHERE id = p_card;
  v_left := commerce.gift_card_balance(p_card);
  IF v_left <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN commerce.gift_card_entry(p_store, p_card, 'void', -v_left, NULL, p_account, p_note, 'void');
END;
$$;
