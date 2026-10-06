-- Order search, tags, archive, draft orders and gift messages (wave 3, run 2, D173, docs/wave-3-orders.md 3.3 and 3.4): the rules the database itself holds.
--
-- * Row-level security on the five new tables (no policy: the `commerce` schema is private to the server).
-- * Tags: at most 250 on an order and 30 saved views a store, each held under an advisory lock so two writers cannot both pass the count.
-- * Draft orders: `draft_orders_rules()` is the lifecycle (open, sent, paid, expired, cancelled; forward only, a reopen back to open), freezes
--   everything but the notes once a draft is not open, and refuses a changed identity; the lines are locked with it and capped at 100;
--   `orders_draft_follow()` marks the draft paid or expired when its order is paid or cancelled; `next_draft_number()` is the one writer of the
--   draft counter, a counter that is not an order number (D141).
-- * Gift: `orders_gift_frozen()` refuses a change of the buyer's gift text after the order is placed, except the erasure's own anonymising (D162).
-- * Copied orders (D129) may be tagged and archived and nothing else: `copied_orders_read_only()` and `refuse_copied_order_event()` are patched on
--   their live definitions (one anchored replacement each, idempotent, raising when the anchor is gone, as 20261004174402_gdpr_rules.sql did).
-- * `anonymise_order()` is patched to blank the gift fields; the invoice's payment section learns a third kind, `paid_outside`, for a payment taken
--   outside Kaizen (`commerce.build_invoice_snapshot()`, patched the same way; the TypeScript oracle `buildInvoiceSnapshot()` says the same).
--
-- No function here contains DELETE, TRUNCATE or DROP: retention of drafts and tags is application code. The re-added `orders_anonymised` check is in
-- the generated file before this one.

ALTER TABLE commerce.order_tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.order_views ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.order_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.draft_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.draft_order_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A draft belongs to a customer only through the link: when the customer is deleted (an erasure) the link goes and the draft stays until it is
-- deleted itself (the composite key would otherwise null the store id as well, so only the customer column is set null).
ALTER TABLE commerce.draft_orders DROP CONSTRAINT draft_orders_customer_fk;
--> statement-breakpoint
ALTER TABLE commerce.draft_orders ADD CONSTRAINT draft_orders_customer_fk
  FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers (store_id, id)
  ON DELETE SET NULL (customer_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Tags (3.3 point 1) and saved views (point 2)
-- ---------------------------------------------------------------------------

-- At most 250 tags on an order. The advisory lock is per order, so two bulk runs adding to one order take turns and the second sees the first's
-- rows; nothing else waits on it.
CREATE FUNCTION commerce.order_tags_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('order_tags:' || NEW.order_id::text, 0));
  IF (SELECT count(*) FROM commerce.order_tags t WHERE t.order_id = NEW.order_id) >= 250 THEN
    RAISE EXCEPTION 'order_tags.limit: an order has at most 250 tags' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_tags_limit BEFORE INSERT ON commerce.order_tags
  FOR EACH ROW EXECUTE FUNCTION commerce.order_tags_limit();
--> statement-breakpoint

-- At most 30 saved views a store.
CREATE FUNCTION commerce.order_views_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('order_views:' || NEW.store_id::text, 0));
  IF (SELECT count(*) FROM commerce.order_views v WHERE v.store_id = NEW.store_id) >= 30 THEN
    RAISE EXCEPTION 'order_views.limit: a store has at most 30 saved views' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_views_limit BEFORE INSERT ON commerce.order_views
  FOR EACH ROW EXECUTE FUNCTION commerce.order_views_limit();
--> statement-breakpoint

-- The store's tags with the number of orders each is on (for the filter and the suggestions): the first spelling written is the label.
CREATE FUNCTION commerce.order_tag_counts(p_store uuid, p_limit integer DEFAULT 200)
RETURNS TABLE (key text, label text, orders bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT t.key, (array_agg(t.label ORDER BY t.created_at, t.order_id))[1] AS label, count(*) AS orders
    FROM commerce.order_tags t
   WHERE t.store_id = p_store
   GROUP BY t.key
   ORDER BY count(*) DESC, t.key
   LIMIT greatest(p_limit, 0)
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Draft orders: the counter, the lifecycle, the lock on the lines, the order that follows (3.3 points 7 and 8)
-- ---------------------------------------------------------------------------

-- The next draft's number, `D-{n}`: the one writer of `next_draft_number`, under the settings row's lock (the row is made when missing). A counter that
-- promises no gap (a draft deleted is a number gone), never an order number (D141).
CREATE FUNCTION commerce.next_draft_number(p_store uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_n bigint;
BEGIN
  INSERT INTO commerce.order_settings (store_id) VALUES (p_store) ON CONFLICT (store_id) DO NOTHING;
  UPDATE commerce.order_settings SET next_draft_number = next_draft_number + 1, updated_at = now()
   WHERE store_id = p_store
  RETURNING next_draft_number - 1 INTO v_n;
  RETURN 'D-' || v_n;
END;
$$;
--> statement-breakpoint

-- The lifecycle of a draft (`src/lib/draft-status.ts` is the same table): open to sent; sent to paid, expired, cancelled or back to open (a reopen);
-- expired and cancelled to open or, when the payment arrived late, to paid; paid is final. The order, the time it was sent and the pay token are
-- written by a move only; the token and the expiry change inside `sent` only (a new link, a later day). Once a draft is not open its contents (market,
-- customer, addresses, notes to the buyer, tags, discount, shipping, validity) are frozen; only the internal note, the counters and the lifecycle
-- columns change. The customer link may still be cleared (the customer was erased). A draft is made `open`, and deleted unless it is `sent` (a live order
-- waits for it: reopen it first).
CREATE FUNCTION commerce.draft_orders_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'draft_order.start: a draft is made open' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'sent' THEN
      RAISE EXCEPTION 'draft_order.delete: draft % is sent and its order waits for payment: reopen it first', OLD.number USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF (to_jsonb(NEW) - ARRAY['updated_at']) = (to_jsonb(OLD) - ARRAY['updated_at']) THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'draft_order.fixed: a draft keeps its number, store and maker' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'draft_order.version: the version of a draft only goes up' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'open' AND NEW.status = 'sent')
      OR (OLD.status = 'sent' AND NEW.status IN ('paid', 'expired', 'cancelled', 'open'))
      OR (OLD.status IN ('expired', 'cancelled') AND NEW.status IN ('open', 'paid'))
    ) THEN
      RAISE EXCEPTION 'draft_order.move: a draft cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    -- Ending a send, or paying late, leaves the order, the times and the link as they were.
    IF NEW.status IN ('paid', 'expired', 'cancelled')
       AND (NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
            OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.pay_token_hash IS DISTINCT FROM OLD.pay_token_hash) THEN
      RAISE EXCEPTION 'draft_order.fixed: the order, the times and the link of a draft are not changed when it ends' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    IF NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
      RAISE EXCEPTION 'draft_order.fixed: the order and the time a draft was sent are written by sending it' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'sent' AND (NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.pay_token_hash IS DISTINCT FROM OLD.pay_token_hash) THEN
      RAISE EXCEPTION 'draft_order.fixed: the expiry and the link of a draft change only while it is sent' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF OLD.status <> 'open' THEN
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NEW.customer_id IS NOT NULL THEN
      RAISE EXCEPTION 'draft_order.frozen: a draft that is not open keeps its customer' USING ERRCODE = 'restrict_violation';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['status', 'version', 'internal_note', 'order_id', 'sent_at', 'expires_at', 'paid_at', 'pay_token_hash',
                              'pay_sends_today', 'pay_sent_on', 'updated_at', 'edited_at', 'customer_id'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'version', 'internal_note', 'order_id', 'sent_at', 'expires_at', 'paid_at', 'pay_token_hash',
                              'pay_sends_today', 'pay_sent_on', 'updated_at', 'edited_at', 'customer_id']) THEN
      RAISE EXCEPTION 'draft_order.frozen: a draft that is not open cannot be changed: reopen it first' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER draft_orders_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.draft_orders
  FOR EACH ROW EXECUTE FUNCTION commerce.draft_orders_rules();
--> statement-breakpoint

-- The lines lock with the draft: no insert, update or delete once it is not open. A line whose draft is already gone (the cascade of a deleted
-- draft) passes: the draft's own rule has said whether it could be deleted.
CREATE FUNCTION commerce.draft_order_lines_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT d.status INTO v_status FROM commerce.draft_orders d WHERE d.store_id = OLD.store_id AND d.id = OLD.draft_id;
    IF FOUND AND v_status <> 'open' THEN
      RAISE EXCEPTION 'draft_order.frozen: the lines of a draft that is not open cannot be changed: reopen it first' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT d.status INTO v_status FROM commerce.draft_orders d WHERE d.store_id = NEW.store_id AND d.id = NEW.draft_id;
    IF FOUND AND v_status <> 'open' THEN
      RAISE EXCEPTION 'draft_order.frozen: the lines of a draft that is not open cannot be changed: reopen it first' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER draft_order_lines_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.draft_order_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.draft_order_lines_rules();
--> statement-breakpoint

-- At most 100 lines a draft (an advisory lock per draft, so two inserts at once cannot both pass).
CREATE FUNCTION commerce.draft_order_lines_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('draft_lines:' || NEW.draft_id::text, 0));
  IF (SELECT count(*) FROM commerce.draft_order_lines l WHERE l.draft_id = NEW.draft_id) >= 100 THEN
    RAISE EXCEPTION 'draft_order.lines: a draft has at most 100 lines' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER draft_order_lines_limit BEFORE INSERT ON commerce.draft_order_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.draft_order_lines_limit();
--> statement-breakpoint

-- A draft's order follows it (like `orders_bookings_follow`): an order that becomes paid makes its draft paid (a sent one, or one that expired or was
-- cancelled while the payment was on its way), and an order cancelled while it waited for payment makes a sent draft expired. A reopen sets the draft
-- open and clears its order first, so the draft is no longer named and nothing happens. Only the draft that names this order is touched.
CREATE FUNCTION commerce.orders_draft_follow()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.draft_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'paid' THEN
    UPDATE commerce.draft_orders SET status = 'paid', paid_at = now(), updated_at = now()
     WHERE store_id = NEW.store_id AND id = NEW.draft_id AND order_id = NEW.id AND status IN ('sent', 'expired', 'cancelled');
  ELSIF NEW.status = 'cancelled' AND OLD.status = 'pending_payment' THEN
    UPDATE commerce.draft_orders SET status = 'expired', updated_at = now()
     WHERE store_id = NEW.store_id AND id = NEW.draft_id AND order_id = NEW.id AND status = 'sent';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_draft_follow AFTER UPDATE OF status ON commerce.orders
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION commerce.orders_draft_follow();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Gift: frozen once the order is placed (3.3 point 4)
-- ---------------------------------------------------------------------------

-- The buyer's text is the buyer's: after the insert it never changes, except that the erasure's own anonymising (`commerce.anonymising`, D162, set only
-- by commerce.anonymise_order()) blanks it.
CREATE FUNCTION commerce.orders_gift_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_gift IS DISTINCT FROM OLD.is_gift OR NEW.gift_to IS DISTINCT FROM OLD.gift_to
     OR NEW.gift_from IS DISTINCT FROM OLD.gift_from OR NEW.gift_message IS DISTINCT FROM OLD.gift_message THEN
    IF current_setting('commerce.anonymising', true) = 'on'
       AND NOT NEW.is_gift AND NEW.gift_to IS NULL AND NEW.gift_from IS NULL AND NEW.gift_message IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'order_gift.frozen: the gift message of order % is the buyer''s and cannot be changed', OLD.number USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_gift_frozen BEFORE UPDATE OF is_gift, gift_to, gift_from, gift_message ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.orders_gift_frozen();
--> statement-breakpoint

-- Where an order came from and what staff gave on it are written once, with the order: a draft's order stays a draft's, and the staff discount of its
-- lines and total is never rewritten afterwards.
CREATE FUNCTION commerce.orders_origin_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.source IS DISTINCT FROM OLD.source OR NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.made_by IS DISTINCT FROM OLD.made_by
     OR NEW.staff_discount_minor IS DISTINCT FROM OLD.staff_discount_minor OR NEW.staff_discount_label IS DISTINCT FROM OLD.staff_discount_label THEN
    RAISE EXCEPTION 'order_origin.frozen: where order % came from and its staff discount are written with the order', OLD.number USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_origin_frozen BEFORE UPDATE OF source, draft_id, made_by, staff_discount_minor, staff_discount_label ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.orders_origin_frozen();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Patches of live functions (each: one anchored replacement, idempotent by a marker, raising when the anchor is gone)
-- ---------------------------------------------------------------------------

-- A copied order (D129) is history, but it may be archived: `archived_at` joins `customer_id` among the columns that may change.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.copied_orders_read_only()'::regprocedure);
  IF position('archived_at' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'OR (to_jsonb(NEW) - ''customer_id'') IS DISTINCT FROM (to_jsonb(OLD) - ''customer_id'') THEN',
    E'OR (to_jsonb(NEW) - ARRAY[''customer_id'', ''archived_at'']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[''customer_id'', ''archived_at'']) THEN'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'copied_orders_read_only: the whole-row test was not found, so archiving a copied order cannot pass it'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- A copied order's history takes the event `copied` and, since it may be tagged and archived, the three events of those changes and nothing else.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.refuse_copied_order_event()'::regprocedure);
  IF position('order.tags_changed' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'IF NEW.type <> ''copied''',
    E'IF NEW.type NOT IN (''copied'', ''order.tags_changed'', ''order.archived'', ''order.unarchived'')'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'refuse_copied_order_event: the type test was not found, so tagging a copied order cannot pass it'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- Anonymising an order blanks its gift message, the recipient's name and the sender's (a third party's data, D162).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.anonymise_order(uuid, uuid, text)'::regprocedure);
  IF position('gift_message' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'    organisation_number = NULL,\n    customer_id = NULL,\n',
    E'    organisation_number = NULL,\n    is_gift = false,\n    gift_to = NULL,\n    gift_from = NULL,\n    gift_message = NULL,\n    customer_id = NULL,\n'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'anonymise_order: the personal columns were not found, so the gift message cannot be blanked'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- The invoice says how it was paid: the payment taken online (Stripe) is `paid_online`, a payment recorded outside Kaizen is `paid_outside` with its method.
-- The first payment that is not at the venue decides which (src/lib/invoice-snapshot.ts `buildInvoiceSnapshot()` is the oracle, held by invoice-parity.test.ts).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.build_invoice_snapshot(uuid, date, date)'::regprocedure);
  IF position('paid_outside' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'SELECT 1 AS ord, jsonb_build_object(''kind'', ''paid_online'', ''amountMinor'', v_online, ''provider'', v_provider) AS x WHERE v_online > 0',
    E'SELECT 1 AS ord, CASE WHEN v_provider = ''manual'' THEN jsonb_build_object(''kind'', ''paid_outside'', ''amountMinor'', v_online, ''provider'', ''manual'',\n'
    || E'      ''method'', (SELECT p.method FROM commerce.payments p WHERE p.store_id = o.store_id AND p.order_id = o.id AND p.provider = ''manual'' AND p.status NOT IN (''failed'', ''cancelled'') ORDER BY p.created_at, p.id LIMIT 1))\n'
    || E'      ELSE jsonb_build_object(''kind'', ''paid_online'', ''amountMinor'', v_online, ''provider'', v_provider) END AS x WHERE v_online > 0'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'build_invoice_snapshot: the payment section was not found, so a payment outside Kaizen cannot be stated'; END IF;
  EXECUTE v_new;
END
$patch$;
