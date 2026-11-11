-- Broadcasts (wave 5 unit C, D297, docs/wave-5-marketing.md 5). Read and written only by server code over the database connection, never by
-- the Data API.
ALTER TABLE commerce.broadcasts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.broadcast_recipients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.broadcast_link_clicks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A broadcast's life (5.1): draft -> scheduled | sending, scheduled -> draft | sending, sending -> sent | cancelled; what it says and who it is
-- for are fixed once a send starts; only a draft is deleted; a segment is the broadcast's own store's.
CREATE FUNCTION commerce.broadcasts_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'broadcasts.delete: only a draft is deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.segment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.segments s WHERE s.id = NEW.segment_id AND s.store_id = NEW.store_id
  ) THEN
    RAISE EXCEPTION 'broadcasts.segment: the segment is another store''s' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'broadcasts.status: a broadcast starts as a draft' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id THEN
    RAISE EXCEPTION 'broadcasts.identity: a broadcast stays itself' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('scheduled', 'sending'))
    OR (OLD.status = 'scheduled' AND NEW.status IN ('draft', 'sending'))
    OR (OLD.status = 'sending' AND NEW.status IN ('sent', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'broadcasts.status: % cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;

  -- Once a send starts, its words, its audience and when it started stay as they were. A deleted segment may still clear `segment_id`.
  IF OLD.status IN ('sending', 'sent', 'cancelled') AND (
    NEW.title IS DISTINCT FROM OLD.title
    OR NEW.audience IS DISTINCT FROM OLD.audience
    OR (NEW.segment_id IS DISTINCT FROM OLD.segment_id AND NEW.segment_id IS NOT NULL)
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.started_at IS DISTINCT FROM OLD.started_at
    OR NEW.audience_words IS DISTINCT FROM OLD.audience_words
  ) THEN
    RAISE EXCEPTION 'broadcasts.fixed: a broadcast that was sent keeps what it said and who it went to' USING ERRCODE = 'check_violation';
  END IF;
  -- The count is written once the send's addresses are frozen, in the same transaction that starts it.
  IF OLD.status IN ('sent', 'cancelled') AND (NEW.finished_at IS DISTINCT FROM OLD.finished_at OR NEW.recipient_count IS DISTINCT FROM OLD.recipient_count) THEN
    RAISE EXCEPTION 'broadcasts.fixed: a finished broadcast keeps when it ended and how many it went to' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'scheduled' AND NEW.scheduled_for IS NULL THEN
    RAISE EXCEPTION 'broadcasts.scheduled: a scheduled broadcast needs its time' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('sending', 'sent', 'cancelled') AND NEW.started_at IS NULL THEN
    RAISE EXCEPTION 'broadcasts.started: a send needs its start' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('sent', 'cancelled') AND NEW.finished_at IS NULL THEN
    RAISE EXCEPTION 'broadcasts.finished: a finished send needs its end' USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER broadcasts_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.broadcasts
  FOR EACH ROW EXECUTE FUNCTION commerce.broadcasts_rules();
--> statement-breakpoint

-- Recipients (5.3): frozen only while their broadcast is sending; each stays the address it was, and moves only from queued to sent, failed or
-- skipped.
CREATE FUNCTION commerce.broadcast_recipients_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
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
  IF NEW.status <> OLD.status AND NOT (OLD.status = 'queued' AND NEW.status IN ('sent', 'failed', 'skipped')) THEN
    RAISE EXCEPTION 'broadcast_recipients.status: % cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'skipped' AND NEW.skip_reason IS NULL THEN
    RAISE EXCEPTION 'broadcast_recipients.skip: a skipped recipient says why' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER broadcast_recipients_rules BEFORE INSERT OR UPDATE ON commerce.broadcast_recipients
  FOR EACH ROW EXECUTE FUNCTION commerce.broadcast_recipients_rules();
--> statement-breakpoint

-- Every minute Supabase's scheduler asks Kaizena Flow to send the next batches of broadcasts and start the scheduled ones that are due (5.3), as
-- it asks for the theme photographs. Not where the extensions are missing, such as in tests.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    PERFORM cron.schedule(
      'kaizen-broadcasts',
      '* * * * *',
      $job$
        SELECT net.http_post(
          url := 'https://kaizenaflow.com/api/cron/broadcasts',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'kaizen_cron_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 30000
        );
      $job$
    );
  END IF;
END
$do$;
