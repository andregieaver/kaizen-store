-- The tasks the assistants hand each other over the account link (docs/assistants-together.md, step 2): row-level security, as every
-- commerce table (the server reads and writes it through its own connection; no policy lets a client reach it). A handoff's account,
-- direction and task never change: another task is another row.

ALTER TABLE "commerce"."kaizen_life_handoffs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.kaizen_life_handoffs_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.direction IS DISTINCT FROM OLD.direction OR NEW.task IS DISTINCT FROM OLD.task THEN
    RAISE EXCEPTION 'kaizen_life_handoffs.fixed: a handoff is one task of one account, in one direction' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER kaizen_life_handoffs_fixed BEFORE UPDATE ON commerce.kaizen_life_handoffs FOR EACH ROW EXECUTE FUNCTION commerce.kaizen_life_handoffs_fixed();
