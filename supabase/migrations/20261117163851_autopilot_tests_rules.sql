-- The autopilot tests its page changes first (ecosystem plan E4.1, D729): the rules the database holds for `commerce.autopilot_tests`.
--
-- A row is a test of the whole page it names, in its own store, and a page has at most one undecided autopilot test at a time (one change
-- under test; the next waits until the store has decided). What a row records of its start never changes; once decided it stays decided,
-- except that a decision kept for the owner's yes (`asked`) may still end as made, kept or theirs. The account goes when the account does.

CREATE FUNCTION commerce.autopilot_tests_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM commerce.experiments e
      WHERE e.store_id = NEW.store_id AND e.id = NEW.experiment_id AND e.target_page_id = NEW.page_id AND e.target_part IS NULL
    ) THEN
      RAISE EXCEPTION 'autopilot_tests.experiment: an autopilot test is a test of the whole page it names, in its own store' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM commerce.autopilot_tests t JOIN commerce.experiments e ON e.store_id = t.store_id AND e.id = t.experiment_id
      WHERE t.store_id = NEW.store_id AND t.page_id = NEW.page_id AND t.experiment_id <> NEW.experiment_id
        AND (t.outcome IS NULL OR t.outcome = 'asked') AND e.status IN ('draft', 'scheduled', 'running', 'stopped')
    ) THEN
      RAISE EXCEPTION 'autopilot_tests.one_per_page: the page already has a change of the autopilot''s under test' USING ERRCODE = 'unique_violation';
    END IF;
    IF NEW.outcome IS NOT NULL THEN
      RAISE EXCEPTION 'autopilot_tests.outcome: a test starts undecided' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.store_id <> OLD.store_id OR NEW.experiment_id <> OLD.experiment_id OR NEW.page_id <> OLD.page_id
     OR NEW.goal <> OLD.goal OR NEW.days <> OLD.days OR NEW.created_at <> OLD.created_at
     OR (NEW.account_id IS DISTINCT FROM OLD.account_id AND NEW.account_id IS NOT NULL) THEN
    RAISE EXCEPTION 'autopilot_tests.locked: what an autopilot test started with does not change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.outcome IS NOT NULL AND NEW.outcome IS DISTINCT FROM OLD.outcome AND (OLD.outcome <> 'asked' OR NEW.outcome IS NULL) THEN
    RAISE EXCEPTION 'autopilot_tests.decided: a decided autopilot test stays decided' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER autopilot_tests_rules BEFORE INSERT OR UPDATE ON commerce.autopilot_tests FOR EACH ROW EXECUTE FUNCTION commerce.autopilot_tests_rules();
--> statement-breakpoint

-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection.
ALTER TABLE commerce.autopilot_tests ENABLE ROW LEVEL SECURITY;
