-- Tests of the working pages and of modals (D148, phase 9). The page a store chose for the cart, the checkout, the order confirmation, My
-- account, sign-in, wishlists, a subscription or weekly deliveries can be tested by a part of it (the rows around the shop's own
-- component, which the code keeps out of a part), served from its own route; the front page, the All products page, the cookies page and the
-- content pages (blog, search, 404, categories, tags) still cannot be tested. A page in a running test cannot change the place it is chosen
-- for, and a page cannot be chosen for a place while it is in one: the test would then be about something else.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.experiments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_count integer;
  v_sum numeric;
  v_running integer;
  v_page record;
  v_role text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'experiments.start: a test is made as a draft' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = NEW.target_page_id AND p.store_id = NEW.store_id AND p.type IN ('page', 'product_layout', 'header', 'footer')) THEN
      RAISE EXCEPTION 'experiments.target: only a page, a product layout, a header or a footer of the store can be tested' USING ERRCODE = 'check_violation';
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
    IF v_page.type = 'page' AND EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND (s.front_page_id = NEW.target_page_id OR s.products_page_id = NEW.target_page_id)) THEN
      RAISE EXCEPTION 'experiments.start: the front page and the All products page cannot be tested yet' USING ERRCODE = 'check_violation';
    END IF;
    -- A page chosen for a place of its own: the working pages (the cart, the checkout, the order confirmation, My account, sign-in,
    -- wishlists, a subscription, weekly deliveries) can be tested by a part of them, never as a whole, since the shop's own component is on
    -- them; the cookies page and the content pages (blog, search, 404, categories, tags) cannot be tested yet.
    IF v_page.type = 'page' THEN
      SELECT r.role INTO v_role FROM commerce.page_roles r WHERE r.store_id = NEW.store_id AND r.page_id = NEW.target_page_id;
      IF v_role IS NOT NULL AND v_role NOT IN ('cart', 'checkout', 'order', 'account', 'sign_in', 'wishlist', 'subscription', 'deliveries') THEN
        RAISE EXCEPTION 'experiments.start: the cookies page and the blog, search, 404, category and tag pages cannot be tested yet' USING ERRCODE = 'check_violation';
      END IF;
      IF v_role IS NOT NULL AND NEW.target_part IS NULL THEN
        RAISE EXCEPTION 'experiments.start: a working page can be tested by a part around its shop component, not as a whole' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    -- What every page shows is tested only where it is shown: the header or footer the store uses, a layout some product uses.
    IF v_page.type = 'header' AND NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.header_id = NEW.target_page_id) THEN
      RAISE EXCEPTION 'experiments.start: only the header the store uses can be tested' USING ERRCODE = 'check_violation';
    END IF;
    IF v_page.type = 'footer' AND NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.footer_id = NEW.target_page_id) THEN
      RAISE EXCEPTION 'experiments.start: only the footer the store uses can be tested' USING ERRCODE = 'check_violation';
    END IF;
    IF v_page.type = 'product_layout' AND NOT (
         EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.product_layout_id = NEW.target_page_id)
         OR EXISTS (SELECT 1 FROM commerce.terms t WHERE t.store_id = NEW.store_id AND t.product_layout_id = NEW.target_page_id)
         OR EXISTS (SELECT 1 FROM commerce.products pr WHERE pr.store_id = NEW.store_id AND pr.product_layout_id = NEW.target_page_id)
       ) THEN
      RAISE EXCEPTION 'experiments.start: no product uses this layout yet, so nobody would see the test' USING ERRCODE = 'check_violation';
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

--> statement-breakpoint
CREATE FUNCTION commerce.page_roles_experiment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (SELECT 1 FROM commerce.experiments e WHERE e.store_id = OLD.store_id AND e.status = 'running' AND e.target_page_id = OLD.page_id)
     AND (TG_OP = 'DELETE' OR NEW.page_id IS DISTINCT FROM OLD.page_id OR NEW.role IS DISTINCT FROM OLD.role) THEN
    RAISE EXCEPTION 'page_roles.experiment: the page is in a running test: stop the test before choosing another page for this place' USING ERRCODE = 'restrict_violation';
  END IF;
  -- Choosing the page already chosen again (an upsert that changes nothing) is not a change.
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.page_id IS DISTINCT FROM OLD.page_id)
     AND NOT EXISTS (SELECT 1 FROM commerce.page_roles r WHERE r.store_id = NEW.store_id AND r.role = NEW.role AND r.page_id = NEW.page_id)
     AND EXISTS (SELECT 1 FROM commerce.experiments e WHERE e.store_id = NEW.store_id AND e.status = 'running' AND e.target_page_id = NEW.page_id) THEN
    RAISE EXCEPTION 'page_roles.experiment: the page is in a running test: stop the test before choosing it for a place of its own' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER page_roles_experiment_guard BEFORE INSERT OR UPDATE OR DELETE ON commerce.page_roles
  FOR EACH ROW EXECUTE FUNCTION commerce.page_roles_experiment_guard();
