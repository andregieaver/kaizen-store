-- The autopilot tests kaizenaflow.com's pages on its sign-ups (ecosystem plan E5.3, D757): `commerce.autopilot_tests` may count a sign-up to
-- Kaizena Flow (`goal` 'signup', widened by the migration before this one), and the database holds where.
--
-- A sign-up is a goal of Kaizena Flow's own store alone (`commerce.house_store()`, D466; its A/B tests' `signup` goal, D712), so an autopilot
-- test that counts one is that store's; and every autopilot test counts its own test's goal. The rest of the rules are E4.1's (D729) as they
-- were: a test of the whole page it names, in its own store, one undecided a page, starting undecided, what it started with never changing,
-- and once decided staying decided (a decision kept for the owner's yes may still end).

CREATE OR REPLACE FUNCTION commerce.autopilot_tests_rules() RETURNS trigger
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
    IF NOT EXISTS (SELECT 1 FROM commerce.experiments e WHERE e.store_id = NEW.store_id AND e.id = NEW.experiment_id AND e.primary_goal = NEW.goal) THEN
      RAISE EXCEPTION 'autopilot_tests.goal: an autopilot test counts its own test''s goal' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.goal = 'signup' AND NEW.store_id IS DISTINCT FROM commerce.house_store() THEN
      RAISE EXCEPTION 'autopilot_tests.signup: only Kaizena Flow''s own store tests on its sign-ups' USING ERRCODE = 'check_violation';
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
