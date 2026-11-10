-- The claim no longer rests on two clock readings being different (D529, corrected the day it was written).
--
-- The first version said a claim was this caller's when `claimed_at` equalled this statement's `now()`. Two
-- deliveries whose statements began in the same clock tick both read that as theirs: seen in the unit tests, where
-- the clock ticks in milliseconds. The steps are now explicit, and each one is decided by whether a row was written:
--   1. insert the event: written means it is new, and ours;
--   2. otherwise take it over where it is not done and nobody holds it (never claimed, given up after a failure, or
--      held for more than five minutes): written means ours;
--   3. otherwise count the delivery and say no.
-- A second delivery waits on the first one's row lock in step 1 or 2 and then sees its claim.
CREATE OR REPLACE FUNCTION commerce.claim_webhook_event(p_store uuid, p_provider text, p_event_id text, p_type text, p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO commerce.webhook_events (store_id, provider, event_id, type, payload, claimed_at)
  VALUES (p_store, p_provider, p_event_id, p_type, p_payload, now())
  ON CONFLICT (store_id, provider, event_id) DO NOTHING;
  IF FOUND THEN
    RETURN true;
  END IF;

  UPDATE commerce.webhook_events
     SET attempts = attempts + 1, claimed_at = now()
   WHERE store_id = p_store AND provider = p_provider AND event_id = p_event_id
     AND processed_at IS NULL
     AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes');
  IF FOUND THEN
    RETURN true;
  END IF;

  UPDATE commerce.webhook_events
     SET attempts = attempts + 1
   WHERE store_id = p_store AND provider = p_provider AND event_id = p_event_id;
  RETURN false;
END;
$$;
