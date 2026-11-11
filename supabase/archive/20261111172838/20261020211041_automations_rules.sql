-- Automations (wave 5 unit D, D298, docs/wave-5-marketing.md 6). Read and written only by server code over the database connection, never by
-- the Data API.
ALTER TABLE commerce.automations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.automation_sends ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.stock_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- An automation keeps its store and kind; `updated_at` follows each change.
CREATE FUNCTION commerce.automations_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.store_id <> OLD.store_id OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'automations.identity: an automation stays itself' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER automations_rules BEFORE UPDATE ON commerce.automations FOR EACH ROW EXECUTE FUNCTION commerce.automations_rules();
--> statement-breakpoint

-- A back-in-stock request (6.4): pending -> waiting | cancelled, waiting -> sent | cancelled; sent and cancelled are final. It keeps its store,
-- variant, product and address; a waiting one has been confirmed (or asked by a verified customer), a sent one says when.
CREATE FUNCTION commerce.stock_requests_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('pending', 'waiting') THEN
      RAISE EXCEPTION 'stock_requests.status: a request starts pending or waiting' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.variant_id <> OLD.variant_id OR NEW.product_id <> OLD.product_id
      OR NEW.email <> OLD.email THEN
      RAISE EXCEPTION 'stock_requests.identity: a request stays itself' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
      (OLD.status = 'pending' AND NEW.status IN ('waiting', 'cancelled'))
      OR (OLD.status = 'waiting' AND NEW.status IN ('sent', 'cancelled'))
    ) THEN
      RAISE EXCEPTION 'stock_requests.status: % cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  IF NEW.status = 'pending' AND (NEW.confirm_hash IS NULL OR NEW.confirm_until IS NULL) THEN
    RAISE EXCEPTION 'stock_requests.pending: a pending request needs its link' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'sent' AND NEW.notified_at IS NULL THEN
    RAISE EXCEPTION 'stock_requests.sent: a sent request says when' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stock_requests_rules BEFORE INSERT OR UPDATE ON commerce.stock_requests FOR EACH ROW EXECUTE FUNCTION commerce.stock_requests_rules();
