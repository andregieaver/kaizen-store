-- D216 step 14: a conversation keeps the mode its desk was in when it started, for the reports (docs/analytics.md, Support).
-- Set by the database on insert and never changed after; conversations from before this step keep null ("mode not recorded").
CREATE FUNCTION commerce.support_conversations_desk_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.desk_mode := commerce.support_mode(NEW.store_id);
  ELSE
    NEW.desk_mode := OLD.desk_mode;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER support_conversations_desk_mode
BEFORE INSERT OR UPDATE OF desk_mode ON commerce.support_conversations
FOR EACH ROW EXECUTE FUNCTION commerce.support_conversations_desk_mode();
