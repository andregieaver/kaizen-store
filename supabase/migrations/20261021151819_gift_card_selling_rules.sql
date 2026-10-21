-- Gift cards, step F2 (wave 5 unit F, D300, docs/wave-5-marketing.md 8.2): selling one.
--
-- * A product of kind `gift_card` is offered only while the feature `gift_cards` is on (`kind_offered()`); its variants are its amounts, each
--   delivered as `digital`, and it takes the VAT category `voucher`, whose rate is 0 in every country: a multi-purpose voucher is not a supply
--   when sold (Directive 2016/1065), so the cart, `decideTax()` and `placeOrder()` need no case of their own. `voucher` is for gift cards only.
--   The rates are unverified until an accountant has read them, as every rate a person has not.
-- * A card is issued for each unit of a gift card line once the order has a captured payment and is paid (deferred triggers on payments and
--   on the order, whichever comes last, so every way of paying issues it: Stripe, Mollie, money recorded outside Kaizena Flow, terms settled), never for a copied order or a host's
--   order; a payment in test mode issues a test card, which is never spent in live mode. The code is made by the application right after.
-- * A card's code may be made again while the card was never delivered (an email that failed must not leave a card no one can use).
-- * A card is voided by its order's withdrawal, with the order and no person (`gift_card_withdraw()`).
-- * Who a card is for is personal data: an order anonymised clears it from its lines and its cards (never the amounts or the ledger).
-- * The template store gets `Demo: Gift card`, as every kind of product has a demo.
--> statement-breakpoint

INSERT INTO commerce.vat_categories (code, name_en, description, sort, active, built_in) VALUES
  ('voucher', 'Gift card (multi-purpose voucher)',
   'A gift card that can be spent on anything in the store: no VAT when it is sold, the goods it pays for carry theirs. Gift card products only.',
   80, true, false)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

SELECT commerce.set_vat_rate(
  c.code, 'voucher', 0, DATE '2026-01-01',
  'Council Directive (EU) 2016/1065 (vouchers), Art. 30b(1): the transfer of a multi-purpose voucher is not a supply; VAT is charged when it is spent',
  DATE '2026-10-21',
  'Unverified: no VAT on the sale of a multi-purpose voucher. Norway follows the same rule in practice; an accountant reads this before real use.',
  NULL)
FROM commerce.countries c
WHERE NOT EXISTS (SELECT 1 FROM commerce.vat_rates r WHERE r.country_code = c.code AND r.category = 'voucher');
--> statement-breakpoint

-- Whether a product of this kind is offered: as before, and a gift card while gift cards are on.
CREATE OR REPLACE FUNCTION commerce.kind_offered(p_store uuid, p_kind text, p_subscription_only boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE p_kind
           WHEN 'appointment' THEN commerce.feature_on(p_store, 'appointments')
           WHEN 'stay' THEN commerce.feature_on(p_store, 'bookings')
           WHEN 'rental' THEN commerce.feature_on(p_store, 'bookings')
           WHEN 'gift_card' THEN commerce.feature_on(p_store, 'gift_cards')
           ELSE true
         END
     AND (NOT p_subscription_only OR commerce.feature_on(p_store, 'subscriptions'))
$$;
--> statement-breakpoint

-- A gift card product as it must be, checked at commit (the product and its variants are saved in one transaction, in any order): the
-- category `voucher`, never sold only as a subscription, never a host's, no unit price, every variant `digital` with no measure; and
-- `voucher` on nothing else.
CREATE FUNCTION commerce.check_gift_card_product()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_store uuid;
  v_product uuid;
  p commerce.products%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    v_store := NEW.store_id;
    v_product := NEW.id;
  ELSE
    v_store := NEW.store_id;
    v_product := NEW.product_id;
  END IF;
  SELECT * INTO p FROM commerce.products WHERE store_id = v_store AND id = v_product;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF p.kind = 'gift_card' THEN
    IF p.vat_category <> 'voucher' OR p.subscription_only OR p.host_id IS NOT NULL OR p.sold_by_measure THEN
      RAISE EXCEPTION 'gift_card.product: a gift card takes the category voucher, is sold once, by the store itself, with no unit price'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM commerce.product_variants v
                WHERE v.store_id = v_store AND v.product_id = v_product AND (v.delivery <> 'digital' OR v.measure_amount IS NOT NULL)) THEN
      RAISE EXCEPTION 'gift_card.variants: a gift card''s amounts are delivered by email, with no measure' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF p.vat_category = 'voucher' THEN
    RAISE EXCEPTION 'gift_card.voucher: the category voucher is for gift cards only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER products_gift_card AFTER INSERT OR UPDATE ON commerce.products
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.check_gift_card_product();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER product_variants_gift_card AFTER INSERT OR UPDATE ON commerce.product_variants
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.check_gift_card_product();
--> statement-breakpoint

-- A card's identity is fixed; its code is set once it was delivered (before, a code is made again when its email failed); it is
-- deactivated once; it is sent once; the person's fields only go (erasure).
CREATE OR REPLACE FUNCTION commerce.gift_cards_rules()
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
  IF OLD.code_hash IS NOT NULL AND OLD.sent_at IS NOT NULL AND (NEW.code_hash, NEW.last4) IS DISTINCT FROM (OLD.code_hash, OLD.last4) THEN
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
$$;
--> statement-breakpoint

-- A card's code: made by the application, kept as its hash; again only while the card was never delivered.
CREATE FUNCTION commerce.gift_card_set_code(p_store uuid, p_card uuid, p_hash text, p_last4 text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v commerce.gift_cards;
BEGIN
  v := commerce.gift_card_locked(p_store, p_card);
  IF v.sent_at IS NOT NULL THEN
    RETURN false;
  END IF;
  UPDATE commerce.gift_cards SET code_hash = p_hash, last4 = p_last4 WHERE id = p_card;
  RETURN true;
END;
$$;
--> statement-breakpoint

-- A card delivered: once, with its code.
CREATE FUNCTION commerce.gift_card_mark_sent(p_store uuid, p_card uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v commerce.gift_cards;
BEGIN
  v := commerce.gift_card_locked(p_store, p_card);
  IF v.sent_at IS NOT NULL OR v.code_hash IS NULL THEN
    RETURN false;
  END IF;
  UPDATE commerce.gift_cards SET sent_at = now() WHERE id = p_card;
  RETURN true;
END;
$$;
--> statement-breakpoint

-- A card voided by its order's withdrawal (D153): the whole balance, with the order and no person; only while nothing of it was spent
-- (a withdrawal is refused otherwise, `lineEligibility()`), and once.
CREATE FUNCTION commerce.gift_card_withdraw(p_store uuid, p_card uuid, p_order uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v commerce.gift_cards;
  v_left bigint;
BEGIN
  v := commerce.gift_card_locked(p_store, p_card);
  IF v.order_id IS DISTINCT FROM p_order THEN
    RAISE EXCEPTION 'gift_card.order: this gift card was not bought with this order' USING ERRCODE = 'check_violation';
  END IF;
  IF v.status = 'deactivated' THEN
    RETURN NULL;
  END IF;
  v_left := commerce.gift_card_balance(p_card);
  IF v_left < v.initial_minor THEN
    RAISE EXCEPTION 'gift_card.spent: part of this gift card was spent' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE commerce.gift_cards SET status = 'deactivated', deactivated_at = now() WHERE id = p_card;
  RETURN commerce.gift_card_entry(p_store, p_card, 'void', -v_left, p_order, NULL, 'Withdrawn', 'void');
END;
$$;
--> statement-breakpoint

-- Issues the cards of an order's gift card lines, once per unit (`gift_card_issue()` keeps one per line and unit): only for a paid order
-- with a captured payment, never a copy or a host's, in test mode when a captured payment is a test one. Who it is for and the day it is sent
-- are the line's; the day starts at 08:00 in the store's time zone (today's is sent at once).
CREATE FUNCTION commerce.issue_order_gift_cards(p_store uuid, p_order uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  o commerce.orders%ROWTYPE;
  v_line record;
  v_test boolean;
  v_zone text;
  v_n integer := 0;
BEGIN
  SELECT * INTO o FROM commerce.orders WHERE store_id = p_store AND id = p_order;
  IF NOT FOUND OR o.copied_from IS NOT NULL OR o.host_id IS NOT NULL OR o.status NOT IN ('paid', 'fulfilled') THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.payments p WHERE p.store_id = p_store AND p.order_id = p_order AND p.status = 'captured') THEN
    RETURN 0;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM commerce.payments p
      LEFT JOIN commerce.connected_accounts a ON a.store_id = p.store_id AND a.account_id = p.provider_account
     WHERE p.store_id = p_store AND p.order_id = p_order AND p.status = 'captured' AND (p.test_mode OR a.mode::text = 'test')
  ) INTO v_test;
  SELECT coalesce(s.time_zone, 'UTC') INTO v_zone FROM commerce.stores s WHERE s.id = p_store;

  FOR v_line IN
    SELECT ol.* FROM commerce.order_lines ol
      JOIN commerce.product_variants v ON v.store_id = ol.store_id AND v.id = ol.variant_id
      JOIN commerce.products pr ON pr.store_id = v.store_id AND pr.id = v.product_id
     WHERE ol.store_id = p_store AND ol.order_id = p_order AND pr.kind = 'gift_card' AND ol.delivery = 'digital' AND ol.unit_price_minor > 0
     ORDER BY ol.id
  LOOP
    FOR v_unit IN 1..v_line.quantity LOOP
      PERFORM commerce.gift_card_issue(
        p_store, 'order', o.currency, v_line.unit_price_minor,
        p_order, v_line.id, v_unit, NULL, v_test, o.customer_id,
        v_line.gift_card_to, v_line.gift_card_to_name, v_line.gift_card_message,
        CASE WHEN v_line.gift_card_send_on IS NULL THEN NULL
             ELSE greatest(now(), (v_line.gift_card_send_on + time '08:00') AT TIME ZONE v_zone) END,
        '');
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  RETURN v_n;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.payments_issue_gift_cards()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'captured' AND NEW.order_id IS NOT NULL THEN
    PERFORM commerce.issue_order_gift_cards(NEW.store_id, NEW.order_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payments_issue_gift_cards AFTER INSERT OR UPDATE OF status ON commerce.payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.payments_issue_gift_cards();
--> statement-breakpoint

-- And when the order becomes paid after its payment was captured (in another transaction): the cards are issued either way, once.
CREATE FUNCTION commerce.orders_issue_gift_cards()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('paid', 'fulfilled') AND OLD.status NOT IN ('paid', 'fulfilled') THEN
    PERFORM commerce.issue_order_gift_cards(NEW.store_id, NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER orders_issue_gift_cards AFTER UPDATE OF status ON commerce.orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.orders_issue_gift_cards();
--> statement-breakpoint

-- An order anonymised (D162): who its gift cards were for goes from its lines and its cards; the amounts and the ledger stay (money).
CREATE FUNCTION commerce.orders_gift_card_people()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.anonymised_at IS NOT NULL AND OLD.anonymised_at IS NULL AND NEW.copied_from IS NULL THEN
    UPDATE commerce.order_lines
       SET gift_card_to = NULL, gift_card_to_name = NULL, gift_card_from = NULL, gift_card_message = NULL, gift_card_send_on = NULL
     WHERE store_id = NEW.store_id AND order_id = NEW.id AND gift_card_to IS NOT NULL;
    UPDATE commerce.gift_cards
       SET recipient_email = NULL, recipient_name = NULL, message = NULL, customer_id = NULL
     WHERE store_id = NEW.store_id AND order_id = NEW.id
       AND (recipient_email IS NOT NULL OR recipient_name IS NOT NULL OR message IS NOT NULL OR customer_id IS NOT NULL);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_gift_card_people AFTER UPDATE OF anonymised_at ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.orders_gift_card_people();
--> statement-breakpoint

-- The demo gift card (two amounts), as every kind of product has a demo; hidden until the owner switches gift cards on.
CREATE FUNCTION commerce.add_demo_gift_card(p_store uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_product uuid;
  v_variant uuid;
  v_market record;
  v_amount record;
BEGIN
  SELECT id INTO v_product FROM commerce.products WHERE store_id = p_store AND handle = 'demo-gavekort';
  IF FOUND THEN
    RETURN v_product;
  END IF;

  INSERT INTO commerce.products (store_id, handle, tax_code, kind, vat_category)
  VALUES (p_store, 'demo-gavekort', 'txcd_00000000', 'gift_card', 'voucher')
  RETURNING id INTO v_product;

  INSERT INTO commerce.product_translations (store_id, product_id, locale, title, description) VALUES
    (p_store, v_product, 'nb-NO', 'Demo: Gavekort',
     'Et gavekort som kan brukes på alt i butikken. Det sendes på e-post, til deg eller rett til den du gir det til, på dagen du velger.'),
    (p_store, v_product, 'sv-SE', 'Demo: Presentkort',
     'Ett presentkort som kan användas på allt i butiken. Det skickas med e-post, till dig eller direkt till den du ger det till, på dagen du väljer.'),
    (p_store, v_product, 'da-DK', 'Demo: Gavekort',
     'Et gavekort, der kan bruges på alt i butikken. Det sendes på e-mail, til dig eller direkte til den, du giver det til, på dagen du vælger.');

  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt) VALUES
    (p_store, v_product, '/demo/gift-card.svg', 0, '{"nb-NO": "Gavekort", "sv-SE": "Presentkort", "da-DK": "Gavekort"}');

  FOR v_amount IN
    SELECT * FROM (VALUES ('DEMO-GAVEKORT-500', 'small', 50000, 37500), ('DEMO-GAVEKORT-1000', 'large', 100000, 75000)) AS a(sku, option, amount, amount_dk)
  LOOP
    INSERT INTO commerce.product_variants (store_id, product_id, sku, options, delivery)
    VALUES (p_store, v_product, v_amount.sku, jsonb_build_object('amount', v_amount.option), 'digital')
    RETURNING id INTO v_variant;
    FOR v_market IN
      SELECT code FROM commerce.markets WHERE store_id = p_store AND code IN ('NO', 'SE', 'DK')
    LOOP
      PERFORM commerce.set_price(v_variant, v_market.code, CASE v_market.code WHEN 'DK' THEN v_amount.amount_dk ELSE v_amount.amount END);
    END LOOP;
  END LOOP;

  UPDATE commerce.products SET status = 'active' WHERE id = v_product;
  RETURN v_product;
END;
$$;
--> statement-breakpoint

SELECT commerce.add_demo_gift_card(id) FROM commerce.stores WHERE is_template;
