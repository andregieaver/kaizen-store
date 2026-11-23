-- A broadcast's split test (email plan M2.5, D868): a recipient outside the tested share is held until the call, then queued with the
-- winning version (or skipped if the send is stopped); a version once given never changes.
CREATE OR REPLACE FUNCTION commerce.broadcast_recipients_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM commerce.broadcasts b WHERE b.id = NEW.broadcast_id AND b.store_id = NEW.store_id AND b.status = 'sending'
    ) THEN
      RAISE EXCEPTION 'broadcast_recipients.frozen: recipients are frozen only when a send starts' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'queued' THEN
      RAISE EXCEPTION 'broadcast_recipients.status: a recipient starts queued' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.store_id <> OLD.store_id OR NEW.broadcast_id <> OLD.broadcast_id OR NEW.subscriber_id <> OLD.subscriber_id
    OR NEW.email <> OLD.email OR NEW.locale <> OLD.locale OR NEW.market_code IS DISTINCT FROM OLD.market_code THEN
    RAISE EXCEPTION 'broadcast_recipients.identity: a recipient stays the address it was' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'queued' AND NEW.status IN ('sent', 'failed', 'skipped', 'held'))
    OR (OLD.status = 'held' AND NEW.status IN ('queued', 'skipped'))
  ) THEN
    RAISE EXCEPTION 'broadcast_recipients.status: % cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.version IS NOT NULL AND NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'broadcast_recipients.version: a reader keeps the version they were given' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'skipped' AND NEW.skip_reason IS NULL THEN
    RAISE EXCEPTION 'broadcast_recipients.skip: a skipped recipient says why' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
