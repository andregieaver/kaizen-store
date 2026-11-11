-- D445 step 8: a Shopify gift card with money left becomes a card here on move day, with the same balance, currency and expiry, tied to the
-- same customer; one card here for each card there (`moved_from`). Its code is made by the caller (`gift_card_set_code()`) and emailed to
-- the holder. `moved_balance_minor` is the Shopify card's balance when last read: a drop after the move (the old code spent on Shopify) is
-- taken off the card here by the daily look, through `gift_card_adjust()` as any change of balance is.

CREATE FUNCTION commerce.gift_card_issue_moved(
  p_store uuid, p_moved_from text, p_currency text, p_amount bigint, p_account uuid, p_test boolean, p_customer uuid,
  p_recipient_email text, p_expires_at timestamptz, p_note text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_card uuid;
BEGIN
  IF p_moved_from IS NULL OR btrim(p_moved_from) = '' THEN
    RAISE EXCEPTION 'gift_cards.moved: a moved card names the card it replaces' USING ERRCODE = 'check_violation';
  END IF;
  SELECT g.id INTO v_card FROM commerce.gift_cards g WHERE g.store_id = p_store AND g.moved_from = p_moved_from;
  IF v_card IS NOT NULL THEN
    RETURN v_card;
  END IF;
  PERFORM set_config('kaizen.gift_card_ledger', 'on', true);
  INSERT INTO commerce.gift_cards (store_id, currency, initial_minor, source, issued_by, note, test_mode, customer_id, recipient_email,
                                   expires_at, moved_from, moved_balance_minor)
  VALUES (p_store, upper(p_currency), p_amount, 'staff', p_account, left(coalesce(p_note, ''), 500), coalesce(p_test, false), p_customer,
          nullif(left(coalesce(p_recipient_email, ''), 254), ''), p_expires_at, p_moved_from, p_amount)
  RETURNING id INTO v_card;
  PERFORM commerce.gift_card_entry(p_store, v_card, 'issue', p_amount, NULL, p_account, '', 'issue');
  RETURN v_card;
END;
$$;
--> statement-breakpoint

-- The Shopify card's balance as read now: kept, never raised (money put back on Shopify after the move does not come here by itself).
CREATE FUNCTION commerce.gift_card_moved_seen(p_store uuid, p_card uuid, p_balance bigint)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  UPDATE commerce.gift_cards SET moved_balance_minor = least(moved_balance_minor, greatest(p_balance, 0))
   WHERE store_id = p_store AND id = p_card AND moved_from IS NOT NULL;
$$;
