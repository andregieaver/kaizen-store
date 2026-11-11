-- The autopilot's goals and plans (D309, docs/ai-autopilot.md 7): written only by src/server/autopilot-goals.ts,
-- autopilot-plans.ts and the loop, never through the Data API. The database holds the plans' and steps' life cycles.
ALTER TABLE commerce.assistant_goals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.assistant_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.assistant_plan_steps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A plan moves draft -> running <-> paused, running -> done, anything unfinished -> stopped; a change of its steps puts a running or
-- paused plan back to draft with its version raised (a start is for the version the owner was shown). Done and stopped are final.
CREATE OR REPLACE FUNCTION commerce.autopilot_plans_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.account_id <> OLD.account_id
     OR NEW.conversation_id <> OLD.conversation_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'A plan''s store, person and conversation are fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('done', 'stopped') AND (NEW.status <> OLD.status OR NEW.version <> OLD.version) THEN
    RAISE EXCEPTION 'A plan that is % cannot change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('running', 'stopped'))
    OR (OLD.status = 'running' AND NEW.status IN ('paused', 'done', 'stopped', 'draft'))
    OR (OLD.status = 'paused' AND NEW.status IN ('running', 'stopped', 'draft'))
  ) THEN
    RAISE EXCEPTION 'A plan cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'A plan''s version only grows' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.version <> OLD.version AND NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'A plan''s steps change only while it is a draft' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('running', 'paused') AND NEW.status = 'draft' AND NEW.version = OLD.version THEN
    RAISE EXCEPTION 'A plan goes back to a draft only when its steps change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'running' AND OLD.status <> 'running' THEN
    NEW.started_at := coalesce(OLD.started_at, now());
    NEW.pause_reason := null;
  END IF;
  IF NEW.status IN ('done', 'stopped') AND OLD.status NOT IN ('done', 'stopped') THEN
    NEW.finished_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assistant_plans_rules BEFORE UPDATE ON commerce.assistant_plans
  FOR EACH ROW EXECUTE FUNCTION commerce.autopilot_plans_rules();
--> statement-breakpoint

-- A step is added, removed or rewritten only while its plan is a draft (done and running steps are never removed), runs only while
-- its plan runs, moves forward (done, skipped and cancelled are final), and is answered only while it asks.
CREATE OR REPLACE FUNCTION commerce.autopilot_steps_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_plan record;
  v_row record;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT status, store_id INTO v_plan FROM commerce.assistant_plans WHERE id = v_row.plan_id;
  IF TG_OP = 'DELETE' THEN
    -- A plan (or its store) being deleted takes its steps with it.
    IF NOT FOUND THEN RETURN OLD; END IF;
    IF v_plan.status <> 'draft' OR OLD.status IN ('done', 'running') THEN
      RAISE EXCEPTION 'A step is removed only from a draft, and never once it ran' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF v_plan.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Steps are added only to a draft plan' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.store_id IS DISTINCT FROM v_plan.store_id THEN
      RAISE EXCEPTION 'A step belongs to its plan''s store' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'pending' OR NEW.tries <> 0 OR NEW.answer IS NOT NULL THEN
      RAISE EXCEPTION 'A step starts pending' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.plan_id <> OLD.plan_id OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'A step''s plan is fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.key <> OLD.key OR NEW.kind <> OLD.kind OR NEW.spec <> OLD.spec OR NEW.after_keys <> OLD.after_keys
      OR NEW.done_check <> OLD.done_check OR NEW.title <> OLD.title OR NEW.position <> OLD.position)
     AND v_plan.status <> 'draft' THEN
    RAISE EXCEPTION 'A step is rewritten only while its plan is a draft' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('done', 'skipped', 'cancelled') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'A step that is % cannot change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('running', 'waiting', 'asking', 'done', 'skipped', 'cancelled'))
    OR (OLD.status = 'running' AND NEW.status IN ('pending', 'waiting', 'asking', 'done', 'skipped', 'cancelled'))
    OR (OLD.status = 'waiting' AND NEW.status IN ('pending', 'asking', 'done', 'skipped', 'cancelled'))
    OR (OLD.status = 'asking' AND NEW.status IN ('pending', 'done', 'skipped', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'A step cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'running' AND OLD.status <> 'running' AND v_plan.status <> 'running' THEN
    RAISE EXCEPTION 'A step runs only while its plan runs' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.answer IS DISTINCT FROM OLD.answer AND OLD.status <> 'asking' THEN
    RAISE EXCEPTION 'A step is answered only while it asks' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.tries < OLD.tries AND NOT (OLD.status = 'asking' AND NEW.status = 'pending' AND NEW.tries = 0) THEN
    RAISE EXCEPTION 'A step''s tries start again only when the owner says try again' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'running' AND OLD.status <> 'running' THEN
    NEW.started_at := now();
  END IF;
  IF NEW.status IN ('done', 'skipped', 'cancelled') AND OLD.status NOT IN ('done', 'skipped', 'cancelled') THEN
    NEW.finished_at := now();
    NEW.claimed_until := null;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assistant_plan_steps_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.assistant_plan_steps
  FOR EACH ROW EXECUTE FUNCTION commerce.autopilot_steps_rules();
