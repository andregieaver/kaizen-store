-- A webhook event is claimed before it is worked on (D528, code review FV6).
--
-- A provider may deliver one event twice at the same moment. Until now the second delivery found the row with
-- `processed_at` still null and worked on it as well: a confirmation email, a dispute or a payout could be written
-- twice. `commerce.claim_webhook_event()` records the event and says whether this caller may work on it: true for a
-- new event, and for one that failed or whose claim is more than five minutes old (the worker died); false for one
-- that is done or that another delivery is working on now. The caller clears `claimed_at` when its work fails, so
-- the provider's retry claims it at once.
CREATE FUNCTION commerce.claim_webhook_event(p_store uuid, p_provider text, p_event_id text, p_type text, p_payload jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO commerce.webhook_events AS e (store_id, provider, event_id, type, payload, claimed_at)
  VALUES (p_store, p_provider, p_event_id, p_type, p_payload, now())
  ON CONFLICT (store_id, provider, event_id) DO UPDATE
    SET attempts = e.attempts + 1,
        claimed_at = CASE
          WHEN e.processed_at IS NULL AND (e.claimed_at IS NULL OR e.claimed_at < now() - interval '5 minutes') THEN now()
          ELSE e.claimed_at
        END
  -- Mine when the claim carries this statement's own time: a new row, or one this call took over.
  RETURNING e.processed_at IS NULL AND e.claimed_at = now();
$$;
