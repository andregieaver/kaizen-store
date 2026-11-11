ALTER TABLE "commerce"."experiments" DROP CONSTRAINT "experiments_status";--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD COLUMN "target_part" text;--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD COLUMN "target_part_kind" text;--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD COLUMN "scheduled_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD COLUMN "schedule_problem" text;--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD CONSTRAINT "experiments_part" CHECK (("commerce"."experiments"."target_part" is null and "commerce"."experiments"."target_part_kind" is null) or ("commerce"."experiments"."target_part" is not null and length("commerce"."experiments"."target_part") between 1 and 64 and coalesce("commerce"."experiments"."target_part_kind" in ('row', 'column', 'block'), false)));--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD CONSTRAINT "experiments_scheduled" CHECK ("commerce"."experiments"."status" <> 'scheduled' or "commerce"."experiments"."scheduled_start" is not null);--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD CONSTRAINT "experiments_status" CHECK ("commerce"."experiments"."status" in ('draft', 'scheduled', 'running', 'stopped', 'applied', 'discarded'));

--> statement-breakpoint
-- Part tests and scheduled starts (D148, phase 2). A test moves forward only: draft, optionally scheduled (it starts by
-- itself at `scheduled_start`, or goes back to draft), running, stopped, then applied or discarded. The checks for a start
-- are made when it is scheduled and again when it starts; a test of a part keeps its part like its page.
CREATE OR REPLACE FUNCTION commerce.experiments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_count integer;
  v_sum numeric;
  v_running integer;
  v_page record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'experiments.start: a test is made as a draft' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = NEW.target_page_id AND p.store_id = NEW.store_id AND p.type = 'page') THEN
      RAISE EXCEPTION 'experiments.target: only a page of the store can be tested' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id THEN
    RAISE EXCEPTION 'experiments.moved: a test belongs to its store' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'draft' AND (
    NEW.target_page_id <> OLD.target_page_id OR NEW.traffic_share <> OLD.traffic_share OR NEW.audience <> OLD.audience
    OR NEW.primary_goal <> OLD.primary_goal OR NEW.goal_params <> OLD.goal_params OR NEW.min_visitors <> OLD.min_visitors
    OR NEW.min_days <> OLD.min_days
    OR NEW.target_part IS DISTINCT FROM OLD.target_part OR NEW.target_part_kind IS DISTINCT FROM OLD.target_part_kind
  ) THEN
    -- A scheduled test goes back to draft to be changed; only the time of its start moves while it waits.
    IF NOT (OLD.status = 'scheduled' AND NEW.status = 'draft' AND NEW.target_page_id = OLD.target_page_id AND NEW.target_part IS NOT DISTINCT FROM OLD.target_part) THEN
      RAISE EXCEPTION 'experiments.locked: a test that has started cannot be changed' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.status = OLD.status THEN
    IF OLD.status IN ('applied', 'discarded') AND (NEW.name <> OLD.name OR NEW.hypothesis <> OLD.hypothesis OR NEW.planned_end IS DISTINCT FROM OLD.planned_end) THEN
      RAISE EXCEPTION 'experiments.locked: a finished test cannot be changed' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT ((OLD.status = 'draft' AND NEW.status IN ('scheduled', 'running', 'discarded'))
       OR (OLD.status = 'scheduled' AND NEW.status IN ('draft', 'running', 'discarded'))
       OR (OLD.status = 'running' AND NEW.status = 'stopped')
       OR (OLD.status = 'stopped' AND NEW.status IN ('applied', 'discarded'))) THEN
    RAISE EXCEPTION 'experiments.status: a test cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'scheduled' AND (NEW.scheduled_start IS NULL OR NEW.scheduled_start <= now()) THEN
    RAISE EXCEPTION 'experiments.schedule: choose a time in the future' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IN ('scheduled', 'running') AND OLD.status = 'draft' OR (NEW.status = 'running' AND OLD.status = 'scheduled') THEN
    SELECT p.type, p.published_at, p.id INTO v_page FROM commerce.pages p WHERE p.id = NEW.target_page_id AND p.store_id = NEW.store_id;
    IF v_page.published_at IS NULL THEN
      RAISE EXCEPTION 'experiments.start: the page under test must be published' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND (s.front_page_id = NEW.target_page_id OR s.products_page_id = NEW.target_page_id))
       OR EXISTS (SELECT 1 FROM commerce.page_roles r WHERE r.store_id = NEW.store_id AND r.page_id = NEW.target_page_id) THEN
      RAISE EXCEPTION 'experiments.start: the front page, the All products page and pages chosen for a place cannot be tested yet' USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*), COALESCE(sum(v.share), 0) INTO v_count, v_sum FROM commerce.experiment_variants v WHERE v.experiment_id = NEW.id;
    IF v_count < 2 OR v_count > 4 OR NOT EXISTS (SELECT 1 FROM commerce.experiment_variants v WHERE v.experiment_id = NEW.id AND v.key = 'a') THEN
      RAISE EXCEPTION 'experiments.variants: a test needs the original and one to three variants' USING ERRCODE = 'check_violation';
    END IF;
    IF abs(v_sum - 1) > 0.0005 THEN
      RAISE EXCEPTION 'experiments.split: the shares of the versions must add up to 100 %%' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM commerce.experiment_variants v
      LEFT JOIN commerce.pages p ON p.id = v.page_id AND p.store_id = v.store_id
      WHERE v.experiment_id = NEW.id AND v.key <> 'a' AND (p.id IS NULL OR p.type <> 'variant' OR p.published_at IS NULL)
    ) THEN
      RAISE EXCEPTION 'experiments.variants: every variant must be published before the test starts' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status = 'running' THEN
    SELECT count(*) INTO v_running FROM commerce.experiments e WHERE e.store_id = NEW.store_id AND e.status = 'running' AND e.id <> NEW.id;
    IF v_running >= 5 THEN
      RAISE EXCEPTION 'experiments.limit: a store can run five tests at a time' USING ERRCODE = 'check_violation';
    END IF;
    NEW.started_at := COALESCE(NEW.started_at, now());
    NEW.planned_end := COALESCE(NEW.planned_end, NEW.started_at + make_interval(days => NEW.min_days));
    NEW.schedule_problem := NULL;
  ELSIF NEW.status = 'stopped' THEN
    NEW.stopped_at := COALESCE(NEW.stopped_at, now());
    NEW.stop_reason := COALESCE(NEW.stop_reason, 'person');
  ELSIF NEW.status = 'applied' THEN
    IF NEW.applied_variant IS NULL OR NEW.applied_variant = 'a' OR NOT EXISTS (SELECT 1 FROM commerce.experiment_variants v WHERE v.experiment_id = NEW.id AND v.key = NEW.applied_variant) THEN
      RAISE EXCEPTION 'experiments.applied: choose one of the variants, not the original' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
