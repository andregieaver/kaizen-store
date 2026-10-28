-- A delivered gift card can be sent a new code (wave 11 unit B2, D381): only through commerce.gift_card_new_code(), which marks its own update
-- (kaizen.gift_card_new_code = the card's id) so the rules let the code change; anything else still finds a delivered card's code fixed. Only a
-- live card (active, delivered, not expired) with money on it gets one: the old code stops working at once, the balance is unchanged.
CREATE OR REPLACE FUNCTION commerce.gift_cards_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'gift_cards.kept: a gift card is never deleted (deactivate it)' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.store_id, NEW.currency, NEW.initial_minor, NEW.source, NEW.order_id, NEW.order_line_id, NEW.unit_index, NEW.refund_id, NEW.issued_by,
      NEW.issued_at, NEW.expires_at, NEW.test_mode, NEW.note, NEW.created_at)
     IS DISTINCT FROM
     (OLD.store_id, OLD.currency, OLD.initial_minor, OLD.source, OLD.order_id, OLD.order_line_id, OLD.unit_index, OLD.refund_id, OLD.issued_by,
      OLD.issued_at, OLD.expires_at, OLD.test_mode, OLD.note, OLD.created_at) THEN
    RAISE EXCEPTION 'gift_cards.fixed: a gift card''s amount, currency, source and dates stay as issued' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.code_hash IS NOT NULL AND OLD.sent_at IS NOT NULL AND (NEW.code_hash, NEW.last4) IS DISTINCT FROM (OLD.code_hash, OLD.last4)
     AND coalesce(current_setting('kaizen.gift_card_new_code', true), '') <> OLD.id::text THEN
    RAISE EXCEPTION 'gift_cards.code: a gift card''s code stays once it was delivered' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.code_hash IS NULL AND OLD.code_hash IS NOT NULL THEN
    RAISE EXCEPTION 'gift_cards.code: a gift card''s code is replaced, never taken away' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.sent_at IS NOT NULL AND NEW.code_hash IS NULL THEN
    RAISE EXCEPTION 'gift_cards.sent: a gift card is delivered with its code' USING ERRCODE = 'check_violation';
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
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.gift_card_new_code(p_store uuid, p_card uuid, p_hash text, p_last4 text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v commerce.gift_cards;
BEGIN
  IF p_hash IS NULL OR length(p_hash) < 32 OR p_last4 IS NULL OR length(p_last4) <> 4 THEN
    RAISE EXCEPTION 'gift_cards.code: a new code needs its hash and last four characters' USING ERRCODE = 'check_violation';
  END IF;
  v := commerce.gift_card_locked(p_store, p_card);
  -- What the answer means is for the caller to say: only a live, delivered card with money on it gets a new code.
  IF v.status <> 'active' THEN RETURN 'not_active'; END IF;
  IF v.sent_at IS NULL OR v.code_hash IS NULL THEN RETURN 'not_delivered'; END IF;
  IF v.expires_at IS NOT NULL AND v.expires_at <= now() THEN RETURN 'expired'; END IF;
  IF commerce.gift_card_balance(v.id) <= 0 THEN RETURN 'empty'; END IF;
  PERFORM set_config('kaizen.gift_card_new_code', v.id::text, true);
  UPDATE commerce.gift_cards SET code_hash = p_hash, last4 = p_last4 WHERE id = v.id;
  PERFORM set_config('kaizen.gift_card_new_code', '', true);
  RETURN 'ok';
END;
$function$;
