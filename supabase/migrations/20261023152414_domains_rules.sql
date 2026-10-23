-- Domains bought and DNS kept by Kaizena Flow (D315, docs/domains.md).
--
-- * A domain purchase only goes forward (quoted, invoiced, paid, registering, done; or failed, refunded, void) and is never deleted
--   (`domain_purchases_rules()`). It keeps its store, name, kind and price.
-- * A registration is never deleted and keeps its store, name and registrar (`domain_registrations_rules()`).
-- * A DNS change is append-only: only `undone_at` is set, once (`dns_changes_rules()`). A zone is never deleted.
-- * Starting prices per currency (D315 decision 3): the registrar's price converted at the ECB rate plus 25 %, rounded up, with a floor a
--   year. Platform admins change them at /admin/platform/domains; a row already there is kept.
CREATE FUNCTION commerce.domain_purchases_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'domain_purchases.kept: a domain purchase is never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.apex IS DISTINCT FROM OLD.apex
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.years IS DISTINCT FROM OLD.years OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'domain_purchases.fixed: a domain purchase keeps its store, name, kind and price' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'quoted' AND NEW.status IN ('invoiced', 'void', 'failed'))
    OR (OLD.status = 'invoiced' AND NEW.status IN ('paid', 'void'))
    OR (OLD.status = 'paid' AND NEW.status IN ('registering', 'done', 'failed'))
    OR (OLD.status = 'registering' AND NEW.status IN ('done', 'failed'))
    OR (OLD.status = 'failed' AND NEW.status = 'refunded')
  ) THEN
    RAISE EXCEPTION 'domain_purchases.forward: a domain purchase cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.stripe_invoice_id IS NOT NULL AND NEW.stripe_invoice_id IS DISTINCT FROM OLD.stripe_invoice_id THEN
    RAISE EXCEPTION 'domain_purchases.invoice: a domain purchase keeps its invoice' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.registrar_order_id IS NOT NULL AND NEW.registrar_order_id IS DISTINCT FROM OLD.registrar_order_id THEN
    RAISE EXCEPTION 'domain_purchases.order: a domain purchase keeps its registrar order' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER domain_purchases_rules BEFORE UPDATE OR DELETE ON commerce.domain_purchases
  FOR EACH ROW EXECUTE FUNCTION commerce.domain_purchases_rules();
--> statement-breakpoint
CREATE FUNCTION commerce.domain_registrations_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'domain_registrations.kept: a registration is never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.apex IS DISTINCT FROM OLD.apex OR NEW.registrar IS DISTINCT FROM OLD.registrar
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'domain_registrations.fixed: a registration keeps its name and registrar' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'transferred_out' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'domain_registrations.ended: a domain moved to another registrar stays moved' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER domain_registrations_rules BEFORE UPDATE OR DELETE ON commerce.domain_registrations
  FOR EACH ROW EXECUTE FUNCTION commerce.domain_registrations_rules();
--> statement-breakpoint
CREATE FUNCTION commerce.dns_changes_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'dns_changes.kept: a DNS change is never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - 'undone_at') IS DISTINCT FROM (to_jsonb(OLD) - 'undone_at') THEN
    RAISE EXCEPTION 'dns_changes.fixed: a DNS change is kept as it was made' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.undone_at IS NOT NULL AND NEW.undone_at IS DISTINCT FROM OLD.undone_at THEN
    RAISE EXCEPTION 'dns_changes.undone: a DNS change is undone once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dns_changes_rules BEFORE UPDATE OR DELETE ON commerce.dns_changes
  FOR EACH ROW EXECUTE FUNCTION commerce.dns_changes_rules();
--> statement-breakpoint
CREATE FUNCTION commerce.dns_zones_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'dns_zones.kept: a DNS zone is never deleted (it is left)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.apex IS DISTINCT FROM OLD.apex OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'dns_zones.fixed: a DNS zone keeps its name' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'left' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'dns_zones.left: a zone that was left stays left' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dns_zones_rules BEFORE UPDATE OR DELETE ON commerce.dns_zones
  FOR EACH ROW EXECUTE FUNCTION commerce.dns_zones_rules();
--> statement-breakpoint
INSERT INTO commerce.domain_pricing (currency, margin_bps, minimum_minor, round_minor) VALUES
  ('NOK', 2500, 15000, 1000),
  ('SEK', 2500, 15000, 1000),
  ('DKK', 2500, 10000, 1000),
  ('EUR', 2500, 1500, 100)
ON CONFLICT (currency) DO NOTHING;
