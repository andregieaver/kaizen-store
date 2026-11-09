-- Kaizen Life's account link (docs/life-work-summary.md 3.3) and the signed requests already taken: row-level security, as every
-- commerce table (the server reads and writes them through its own connection; no policy lets a client reach them). A link's account
-- and Kaizen Life user never change: another pair is another row, and only undoing it (or the person's own relink) touches it.

ALTER TABLE "commerce"."kaizen_life_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."kaizen_life_jtis" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.kaizen_life_accounts_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.life_user_id IS DISTINCT FROM OLD.life_user_id THEN
    RAISE EXCEPTION 'kaizen_life_accounts.fixed: a link joins one account and one Kaizen Life user for good' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER kaizen_life_accounts_fixed BEFORE UPDATE ON commerce.kaizen_life_accounts FOR EACH ROW EXECUTE FUNCTION commerce.kaizen_life_accounts_fixed();
