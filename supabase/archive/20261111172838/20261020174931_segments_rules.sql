-- Segments and customer tags (wave 5 unit B, D296, docs/wave-5-marketing.md 4). Read and written only by server code over the database
-- connection, never by the Data API.
ALTER TABLE commerce.segments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.customer_tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- At most 100 segments a store.
CREATE FUNCTION commerce.segments_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('segments:' || NEW.store_id::text, 0));
  IF (SELECT count(*) FROM commerce.segments s WHERE s.store_id = NEW.store_id) >= 100 THEN
    RAISE EXCEPTION 'segments.limit: a store has at most 100 segments' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER segments_limit BEFORE INSERT ON commerce.segments
  FOR EACH ROW EXECUTE FUNCTION commerce.segments_limit();
--> statement-breakpoint

-- At most 50 tags a person.
CREATE FUNCTION commerce.customer_tags_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('customer_tags:' || NEW.store_id::text || ':' || NEW.email, 0));
  IF (SELECT count(*) FROM commerce.customer_tags t WHERE t.store_id = NEW.store_id AND t.email = NEW.email) >= 50 THEN
    RAISE EXCEPTION 'customer_tags.limit: a person has at most 50 tags' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER customer_tags_limit BEFORE INSERT ON commerce.customer_tags
  FOR EACH ROW EXECUTE FUNCTION commerce.customer_tags_limit();
