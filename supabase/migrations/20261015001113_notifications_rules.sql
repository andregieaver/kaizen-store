-- Customer notifications, delivery tracking and staff alerts (wave 3, D238, docs/wave-3-notifications.md 3.3 and 3.4): the rules the database itself holds.
--
-- * Row-level security on the eight new tables (no policy: the `commerce` schema is private to the server).
-- * One store event once (`queue_store_event()`, `on conflict do nothing` on `store_events_once_key`), queued by two triggers in the paying or returning
--   transaction: `store_event_order_paid()` (an order paid at checkout or inserted paid, not copied, not of a store template or a store starter) and
--   `store_event_return_requested()` (a return made `requested`, not of a copied order). A weekly box's delivery order is queued like any (rules run on it;
--   the consumer leaves out its staff alert).
-- * A held order gets no shipment (`shipments_not_held()`, before insert on `shipments`: every path, the order page, bulk, carriers, handovers, raw SQL).
-- * At most 50 rules a store (`order_rules_rules()`, under a lock per store; a rule stays with its store).
-- * A carrier's delivery (`record_carrier_delivery()`): the only writer of `delivered_source = 'carrier'` (the trigger `orders_delivered_source` refuses it
--   written outside, by a transaction-local setting the function sets); under the order's row lock it writes only when nothing is recorded, the order is
--   sent in full (`fulfilled`) and not copied, and every standing parcel has a carrier delivery in `shipment_tracking`, at the latest of them, raised to
--   `placed_at` and capped at now, with the event `order.delivered`.
-- * `undo_shipment()` patched in place (anchored): it clears `delivered_source` with `delivered_at`, and stops the parcel's tracking (`undone`).
-- * `anonymise_order()` patched in place (anchored): the parcels' carrier events are cleared (an update, no delete; a carrier's text can name a person),
--   and a hold's reason typed by a person is replaced by the marker (a rule's reason is the owner's words about rules, kept).
-- * `audit_area_of()` replaced, generated from src/lib/audit.ts, which learns `notification.` and `automation.` (Settings).
--
-- No function here contains DELETE, TRUNCATE or DROP; the pruning of 3.5 is application code (`runRetention()`).

ALTER TABLE commerce.notification_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.email_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.staff_alert_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.staff_alert_recipients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.store_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.order_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.order_rule_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.shipment_tracking ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The store events queue
-- ---------------------------------------------------------------------------

-- One store event once: a second payment of the same order (a retried webhook, a replayed session, the order page and the webhook both) adds nothing.
CREATE FUNCTION commerce.queue_store_event(p_store uuid, p_event text, p_subject uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  INSERT INTO commerce.store_events (store_id, event, subject_id)
  VALUES (p_store, p_event, p_subject)
  ON CONFLICT ON CONSTRAINT store_events_once_key DO NOTHING
$$;
--> statement-breakpoint

-- An order paid: at checkout (from waiting for payment, or after it was cancelled for want of payment), or inserted paid (a subscription's renewal). Never a copied order, never a store template's or a
-- store starter's (they take no orders, and a test order there is no news).
CREATE FUNCTION commerce.store_event_order_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.copied_from IS NOT NULL OR NEW.status <> 'paid' THEN
    RETURN NULL;
  END IF;
  -- From either state complete_order_payment() accepts: waiting for payment, or cancelled for want of it (a hold that ran out before the
  -- shopper's session completed). The once key keeps a second payment from queuing it again.
  IF TG_OP = 'UPDATE' AND (OLD.status IS NULL OR OLD.status NOT IN ('pending_payment', 'cancelled')) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND (s.is_template OR s.starter)) THEN
    RETURN NULL;
  END IF;
  PERFORM commerce.queue_store_event(NEW.store_id, 'order.paid', NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER store_event_order_paid AFTER INSERT OR UPDATE OF status ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.store_event_order_paid();
--> statement-breakpoint

-- A return made: a shopper's return or a withdrawal's return starts `requested`. Never for a copied order (returns refuse them anyway).
CREATE FUNCTION commerce.store_event_return_requested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status::text <> 'requested' THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id AND o.copied_from IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  PERFORM commerce.queue_store_event(NEW.store_id, 'return.requested', NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER store_event_return_requested AFTER INSERT ON commerce.returns
  FOR EACH ROW EXECUTE FUNCTION commerce.store_event_return_requested();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Holds and rules
-- ---------------------------------------------------------------------------

-- Nothing of a held order is sent or handed over, whatever the path.
CREATE FUNCTION commerce.shipments_not_held()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id AND o.held_at IS NOT NULL) THEN
    RAISE EXCEPTION 'shipments.held: this order is on hold; release it before anything of it is sent' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shipments_not_held BEFORE INSERT ON commerce.shipments
  FOR EACH ROW EXECUTE FUNCTION commerce.shipments_not_held();
--> statement-breakpoint

-- At most 50 rules a store (RULE_LIMITS.rules in src/lib/order-rules.ts), counted under a lock per store; a rule stays with its store.
CREATE FUNCTION commerce.order_rules_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.store_id <> OLD.store_id THEN
    RAISE EXCEPTION 'order_rules.store_fixed: a rule stays with its store' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('order_rules:' || NEW.store_id::text, 0));
    IF (SELECT count(*) FROM commerce.order_rules r WHERE r.store_id = NEW.store_id) >= 50 THEN
      RAISE EXCEPTION 'order_rules.limit: a store has at most 50 automation rules' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_rules_limit BEFORE INSERT OR UPDATE ON commerce.order_rules
  FOR EACH ROW EXECUTE FUNCTION commerce.order_rules_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A delivery recorded from the carrier (D153's 14 days, spec 4.6)
-- ---------------------------------------------------------------------------

-- `delivered_source = 'carrier'` is written only by record_carrier_delivery(), which names the order in a transaction-local setting; a date that changes
-- while the source says carrier must change the source with it (staff correcting a carrier's date write `staff`).
CREATE FUNCTION commerce.orders_delivered_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.delivered_source = 'carrier'
     AND (TG_OP = 'INSERT' OR OLD.delivered_source IS DISTINCT FROM 'carrier' OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at)
     AND coalesce(current_setting('kaizen.carrier_delivery', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'orders.delivered_source: a delivery from a carrier is recorded only by commerce.record_carrier_delivery()' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_delivered_source BEFORE INSERT OR UPDATE OF delivered_at, delivered_source ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.orders_delivered_source();
--> statement-breakpoint

-- Records the receipt from the carrier when, under the order's row lock: nothing is recorded yet (never over staff's date, never twice), the order is sent
-- in full (`fulfilled`) and not a copy, it has a standing parcel, and every standing parcel has a carrier delivery (`shipment_tracking.delivered_at`,
-- which only a verified code sets, src/lib/tracking-phases.ts). The time is the latest parcel's delivery (or p_at when later), raised to `placed_at` and
-- capped at now. Returns whether it wrote.
CREATE FUNCTION commerce.record_carrier_delivery(p_store uuid, p_order uuid, p_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_order record;
  v_latest timestamptz;
  v_carrier text;
  v_missing integer;
  v_at timestamptz;
BEGIN
  SELECT o.id, o.status::text AS status, o.copied_from, o.delivered_at, o.placed_at INTO v_order
    FROM commerce.orders o WHERE o.store_id = p_store AND o.id = p_order FOR UPDATE;
  IF v_order IS NULL OR v_order.copied_from IS NOT NULL OR v_order.delivered_at IS NOT NULL OR v_order.status <> 'fulfilled' THEN
    RETURN false;
  END IF;
  SELECT count(*) FILTER (WHERE t.delivered_at IS NULL)::integer, max(t.delivered_at)
    INTO v_missing, v_latest
    FROM commerce.shipments s
    LEFT JOIN commerce.shipment_tracking t ON t.store_id = s.store_id AND t.shipment_id = s.id
   WHERE s.store_id = p_store AND s.order_id = p_order AND s.undone_at IS NULL;
  IF v_latest IS NULL OR v_missing > 0 THEN
    RETURN false;
  END IF;
  SELECT t.carrier INTO v_carrier
    FROM commerce.shipment_tracking t JOIN commerce.shipments s ON s.store_id = t.store_id AND s.id = t.shipment_id
   WHERE t.store_id = p_store AND t.order_id = p_order AND s.undone_at IS NULL
   ORDER BY t.delivered_at DESC LIMIT 1;
  v_at := least(greatest(v_latest, coalesce(p_at, v_latest), v_order.placed_at), now());

  PERFORM set_config('kaizen.carrier_delivery', p_order::text, true);
  UPDATE commerce.orders SET delivered_at = v_at, delivered_source = 'carrier' WHERE store_id = p_store AND id = p_order;
  PERFORM set_config('kaizen.carrier_delivery', '', true);

  INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
  VALUES (p_store, p_order, 'order.delivered', jsonb_build_object('by', 'carrier', 'carrier', v_carrier, 'at', v_at), 'system');
  RETURN true;
END;
$$;
--> statement-breakpoint

-- (Anchored on statements, never comments: production's function copies keep no comments.)
-- Undoing a parcel clears who recorded the receipt with the receipt, and stops following the parcel.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.undo_shipment(uuid, uuid, uuid, text)'::regprocedure);
  IF position('shipment_tracking' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(replace(
    v_def,
    E'UPDATE commerce.orders SET delivered_at = NULL WHERE store_id = p_store AND id = v_order_id;',
    E'UPDATE commerce.orders SET delivered_at = NULL, delivered_source = NULL WHERE store_id = p_store AND id = v_order_id;'),
    E'  PERFORM set_config(''kaizen.shipment_undo'', '''', true);\n',
    E'  PERFORM set_config(''kaizen.shipment_undo'', '''', true);\n'
    || E'  UPDATE commerce.shipment_tracking SET stopped = ''undone'', stopped_at = now(), updated_at = now()\n'
    || E'   WHERE store_id = p_store AND shipment_id = p_shipment AND stopped IS DISTINCT FROM ''undone'';\n'
  );
  IF position('delivered_source = NULL' IN v_new) = 0 OR position('shipment_tracking' IN v_new) = 0 THEN
    RAISE EXCEPTION 'undo_shipment: its receipt or parcel statements were not found, so an undone parcel would keep its carrier delivery';
  END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- Anonymising an order clears its parcels' carrier events (a carrier's text can name who signed) and a hold's reason typed by a person.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.anonymise_order(uuid, uuid, text)'::regprocedure);
  IF position('shipment_tracking' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'  UPDATE commerce.shipments SET undo_reason = ''[removed]''',
    E'  UPDATE commerce.shipment_tracking SET events = ''[]''::jsonb, updated_at = now()\n'
    || E'   WHERE store_id = p_store AND order_id = p_order AND events <> ''[]''::jsonb;\n'
    || E'  UPDATE commerce.orders SET held_reason = ''[removed]''\n'
    || E'   WHERE id = p_order AND held_by IS NOT NULL AND held_reason IS NOT NULL AND held_reason <> ''[removed]'';\n'
    || E'  UPDATE commerce.shipments SET undo_reason = ''[removed]'''
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'anonymise_order: the free-text step was not found, so carrier events would be kept'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- The areas of the activity log learn the notifications, staff alerts and automation rules (Settings). The same table as src/lib/audit.ts, which tests
-- hold equal to this function (the whole function is replaced, generated from that table). Entries already written keep the area they were given.
CREATE OR REPLACE FUNCTION commerce.audit_area_of(p_action text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_action = 'shipping.bring_booked' THEN 'orders'
    WHEN p_action = 'shipping.helthjem_booked' THEN 'orders'
    WHEN p_action = 'shipping.porterbuddy_booked' THEN 'orders'
    WHEN p_action = 'company.office_saved' THEN 'settings'
    WHEN p_action = 'store.bonus_settings' THEN 'marketing'
    WHEN p_action = 'store.affiliate_settings' THEN 'marketing'
    WHEN p_action = 'store.fields_updated' THEN 'website'
    WHEN p_action = 'store.ai_translated' THEN 'website'
    WHEN p_action = 'store.front_page_changed' THEN 'website'
    WHEN p_action = 'store.products_page_changed' THEN 'website'
    WHEN p_action = 'store.page_role_changed' THEN 'website'
    WHEN p_action = 'store.legal_role_changed' THEN 'website'
    WHEN p_action = 'store.navigation_updated' THEN 'website'
    WHEN p_action = 'store.part_sharing' THEN 'website'
    WHEN p_action = 'invoice.settings_updated' THEN 'settings'
    WHEN p_action = 'invoice.series_set' THEN 'settings'
    WHEN p_action = 'activity.exported' THEN 'staff'
    WHEN p_action = 'store.two_step_required' THEN 'staff'
    WHEN p_action = 'store.two_step_optional' THEN 'staff'
    WHEN p_action = 'store.legal_starter_made' THEN 'website'
    WHEN starts_with(p_action, 'store.product_layout_') THEN 'products'
    WHEN starts_with(p_action, 'store.products_page_') THEN 'website'
    WHEN starts_with(p_action, 'store.saved_theme_') THEN 'website'
    WHEN starts_with(p_action, 'booking_resource.') THEN 'bookings'
    WHEN starts_with(p_action, 'store.front_page_') THEN 'website'
    WHEN starts_with(p_action, 'google.platform_') THEN 'platform'
    WHEN starts_with(p_action, 'recommendations.') THEN 'marketing'
    WHEN starts_with(p_action, 'cart_reminders.') THEN 'marketing'
    WHEN starts_with(p_action, 'plan_reminders.') THEN 'platform'
    WHEN starts_with(p_action, 'product_layout.') THEN 'products'
    WHEN starts_with(p_action, 'resource_block.') THEN 'bookings'
    WHEN starts_with(p_action, 'store.template_') THEN 'website'
    WHEN starts_with(p_action, 'store.two_step_') THEN 'staff'
    WHEN starts_with(p_action, 'calendar_feed.') THEN 'bookings'
    WHEN starts_with(p_action, 'company.place_') THEN 'settings'
    WHEN starts_with(p_action, 'store.article_') THEN 'website'
    WHEN starts_with(p_action, 'localization.') THEN 'settings'
    WHEN starts_with(p_action, 'notification.') THEN 'settings'
    WHEN starts_with(p_action, 'store.footer_') THEN 'website'
    WHEN starts_with(p_action, 'store.header_') THEN 'website'
    WHEN starts_with(p_action, 'ai.platform_') THEN 'platform'
    WHEN starts_with(p_action, 'credit_note.') THEN 'orders'
    WHEN starts_with(p_action, 'field_group.') THEN 'website'
    WHEN starts_with(p_action, 'integration.') THEN 'settings'
    WHEN starts_with(p_action, 'search_test.') THEN 'marketing'
    WHEN starts_with(p_action, 'store.fonts_') THEN 'website'
    WHEN starts_with(p_action, 'store.media_') THEN 'website'
    WHEN starts_with(p_action, 'store.theme_') THEN 'website'
    WHEN starts_with(p_action, 'automation.') THEN 'settings'
    WHEN starts_with(p_action, 'deliveries.') THEN 'orders'
    WHEN starts_with(p_action, 'experiment.') THEN 'marketing'
    WHEN starts_with(p_action, 'store.menu_') THEN 'website'
    WHEN starts_with(p_action, 'store.page_') THEN 'website'
    WHEN starts_with(p_action, 'store.part_') THEN 'website'
    WHEN starts_with(p_action, 'analytics.') THEN 'analytics'
    WHEN starts_with(p_action, 'knowledge.') THEN 'support'
    WHEN starts_with(p_action, 'not_found.') THEN 'website'
    WHEN starts_with(p_action, 'redirects.') THEN 'website'
    WHEN starts_with(p_action, 'retention.') THEN 'platform'
    WHEN starts_with(p_action, 'store.css_') THEN 'website'
    WHEN starts_with(p_action, 'bookings.') THEN 'bookings'
    WHEN starts_with(p_action, 'campaign.') THEN 'marketing'
    WHEN starts_with(p_action, 'customer.') THEN 'customers'
    WHEN starts_with(p_action, 'discount.') THEN 'marketing'
    WHEN starts_with(p_action, 'document.') THEN 'orders'
    WHEN starts_with(p_action, 'language.') THEN 'platform'
    WHEN starts_with(p_action, 'payments.') THEN 'settings'
    WHEN starts_with(p_action, 'platform.') THEN 'platform'
    WHEN starts_with(p_action, 'products.') THEN 'products'
    WHEN starts_with(p_action, 'redirect.') THEN 'website'
    WHEN starts_with(p_action, 'shipping.') THEN 'settings'
    WHEN starts_with(p_action, 'account.') THEN 'account'
    WHEN starts_with(p_action, 'article.') THEN 'website'
    WHEN starts_with(p_action, 'billing.') THEN 'billing'
    WHEN starts_with(p_action, 'booking.') THEN 'orders'
    WHEN starts_with(p_action, 'company.') THEN 'customers'
    WHEN starts_with(p_action, 'cookies.') THEN 'settings'
    WHEN starts_with(p_action, 'invoice.') THEN 'orders'
    WHEN starts_with(p_action, 'privacy.') THEN 'customers'
    WHEN starts_with(p_action, 'product.') THEN 'products'
    WHEN starts_with(p_action, 'returns.') THEN 'settings'
    WHEN starts_with(p_action, 'support.') THEN 'support'
    WHEN starts_with(p_action, 'footer.') THEN 'website'
    WHEN starts_with(p_action, 'google.') THEN 'settings'
    WHEN starts_with(p_action, 'header.') THEN 'website'
    WHEN starts_with(p_action, 'return.') THEN 'orders'
    WHEN starts_with(p_action, 'hosts.') THEN 'bookings'
    WHEN starts_with(p_action, 'order.') THEN 'orders'
    WHEN starts_with(p_action, 'staff.') THEN 'staff'
    WHEN starts_with(p_action, 'store.') THEN 'settings'
    WHEN starts_with(p_action, 'chat.') THEN 'support'
    WHEN starts_with(p_action, 'host.') THEN 'bookings'
    WHEN starts_with(p_action, 'page.') THEN 'website'
    WHEN starts_with(p_action, 'role.') THEN 'staff'
    WHEN starts_with(p_action, 'site_') THEN 'website'
    WHEN starts_with(p_action, 'term.') THEN 'website'
    WHEN starts_with(p_action, 'tier.') THEN 'customers'
    WHEN starts_with(p_action, 'work.') THEN 'settings'
    WHEN starts_with(p_action, 'vat.') THEN 'platform'
    WHEN starts_with(p_action, 'ai.') THEN 'settings'
    ELSE 'settings'
  END
$$;
