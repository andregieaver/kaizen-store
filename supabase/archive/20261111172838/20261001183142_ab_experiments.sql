CREATE TABLE "commerce"."experiment_carts" (
	"store_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"visitor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiment_carts_store_id_cart_id_pk" PRIMARY KEY("store_id","cart_id"),
	CONSTRAINT "experiment_carts_visitor" CHECK (length("commerce"."experiment_carts"."visitor") between 8 and 64)
);
--> statement-breakpoint
CREATE TABLE "commerce"."experiment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"visitor" text NOT NULL,
	"variant" text NOT NULL,
	"goal" text NOT NULL,
	"ref" text DEFAULT '' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiment_events_once_key" UNIQUE("experiment_id","visitor","goal","ref"),
	CONSTRAINT "experiment_events_goal" CHECK ("commerce"."experiment_events"."goal" in ('cart', 'checkout', 'click')),
	CONSTRAINT "experiment_events_ref" CHECK (length("commerce"."experiment_events"."ref") <= 80)
);
--> statement-breakpoint
CREATE TABLE "commerce"."experiment_exposures" (
	"store_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"visitor" text NOT NULL,
	"variant" text NOT NULL,
	"market" text DEFAULT '' NOT NULL,
	"device" text DEFAULT 'desktop' NOT NULL,
	"returning" boolean DEFAULT false NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiment_exposures_experiment_id_visitor_pk" PRIMARY KEY("experiment_id","visitor"),
	CONSTRAINT "experiment_exposures_visitor" CHECK (length("commerce"."experiment_exposures"."visitor") between 8 and 64),
	CONSTRAINT "experiment_exposures_device" CHECK ("commerce"."experiment_exposures"."device" in ('mobile', 'tablet', 'desktop'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."experiment_variants" (
	"store_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"page_id" uuid,
	"share" numeric(4, 3) NOT NULL,
	CONSTRAINT "experiment_variants_experiment_id_key_pk" PRIMARY KEY("experiment_id","key"),
	CONSTRAINT "experiment_variants_key_format" CHECK ("commerce"."experiment_variants"."key" in ('a', 'b', 'c', 'd')),
	CONSTRAINT "experiment_variants_control" CHECK (("commerce"."experiment_variants"."key" = 'a') = ("commerce"."experiment_variants"."page_id" is null)),
	CONSTRAINT "experiment_variants_share" CHECK ("commerce"."experiment_variants"."share" >= 0 and "commerce"."experiment_variants"."share" <= 1),
	CONSTRAINT "experiment_variants_name" CHECK (length("commerce"."experiment_variants"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "commerce"."experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hypothesis" text DEFAULT '' NOT NULL,
	"target_page_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"traffic_share" numeric(4, 3) DEFAULT '1' NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"primary_goal" text NOT NULL,
	"goal_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"min_visitors" integer DEFAULT 0 NOT NULL,
	"min_days" integer DEFAULT 14 NOT NULL,
	"planned_end" timestamp with time zone,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"stop_reason" text,
	"applied_variant" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiments_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "experiments_status" CHECK ("commerce"."experiments"."status" in ('draft', 'running', 'stopped', 'applied', 'discarded')),
	CONSTRAINT "experiments_goal" CHECK ("commerce"."experiments"."primary_goal" in ('orders', 'revenue', 'cart', 'checkout', 'click')),
	CONSTRAINT "experiments_name" CHECK (length("commerce"."experiments"."name") between 1 and 120 and length("commerce"."experiments"."hypothesis") <= 500),
	CONSTRAINT "experiments_traffic" CHECK ("commerce"."experiments"."traffic_share" > 0 and "commerce"."experiments"."traffic_share" <= 1),
	CONSTRAINT "experiments_minimums" CHECK ("commerce"."experiments"."min_visitors" >= 0 and "commerce"."experiments"."min_days" between 1 and 90),
	CONSTRAINT "experiments_stop_reason" CHECK ("commerce"."experiments"."stop_reason" is null or "commerce"."experiments"."stop_reason" in ('person', 'guardrail', 'planned_end')),
	CONSTRAINT "experiments_applied" CHECK (("commerce"."experiments"."applied_variant" is not null) = ("commerce"."experiments"."status" = 'applied'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."pages" DROP CONSTRAINT "pages_type";--> statement-breakpoint
ALTER TABLE "commerce"."experiment_carts" ADD CONSTRAINT "experiment_carts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."experiment_events" ADD CONSTRAINT "experiment_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."experiment_events" ADD CONSTRAINT "experiment_events_exposure_fk" FOREIGN KEY ("experiment_id","visitor") REFERENCES "commerce"."experiment_exposures"("experiment_id","visitor") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."experiment_exposures" ADD CONSTRAINT "experiment_exposures_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."experiment_exposures" ADD CONSTRAINT "experiment_exposures_variant_fk" FOREIGN KEY ("experiment_id","variant") REFERENCES "commerce"."experiment_variants"("experiment_id","key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."experiment_exposures" ADD CONSTRAINT "experiment_exposures_experiment_fk" FOREIGN KEY ("store_id","experiment_id") REFERENCES "commerce"."experiments"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."experiment_variants" ADD CONSTRAINT "experiment_variants_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."experiment_variants" ADD CONSTRAINT "experiment_variants_experiment_fk" FOREIGN KEY ("store_id","experiment_id") REFERENCES "commerce"."experiments"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."experiment_variants" ADD CONSTRAINT "experiment_variants_page_fk" FOREIGN KEY ("store_id","page_id") REFERENCES "commerce"."pages"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD CONSTRAINT "experiments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD CONSTRAINT "experiments_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD CONSTRAINT "experiments_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD CONSTRAINT "experiments_target_fk" FOREIGN KEY ("store_id","target_page_id") REFERENCES "commerce"."pages"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiment_carts_visitor_idx" ON "commerce"."experiment_carts" USING btree ("store_id","visitor");--> statement-breakpoint
CREATE INDEX "experiment_carts_created_idx" ON "commerce"."experiment_carts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "experiment_events_store_idx" ON "commerce"."experiment_events" USING btree ("store_id","occurred_at");--> statement-breakpoint
CREATE INDEX "experiment_exposures_seen_idx" ON "commerce"."experiment_exposures" USING btree ("store_id","first_seen");--> statement-breakpoint
CREATE INDEX "experiment_exposures_visitor_idx" ON "commerce"."experiment_exposures" USING btree ("store_id","visitor");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_variants_page_key" ON "commerce"."experiment_variants" USING btree ("page_id") WHERE "commerce"."experiment_variants"."page_id" is not null;--> statement-breakpoint
CREATE INDEX "experiment_variants_page_idx" ON "commerce"."experiment_variants" USING btree ("store_id","page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "experiments_running_target_key" ON "commerce"."experiments" USING btree ("store_id","target_page_id") WHERE "commerce"."experiments"."status" = 'running';--> statement-breakpoint
CREATE INDEX "experiments_store_status_idx" ON "commerce"."experiments" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "experiments_target_idx" ON "commerce"."experiments" USING btree ("store_id","target_page_id");--> statement-breakpoint
CREATE INDEX "experiments_created_by_idx" ON "commerce"."experiments" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "experiments_updated_by_idx" ON "commerce"."experiments" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_variant_store" CHECK ("commerce"."pages"."type" <> 'variant' or "commerce"."pages"."store_id" is not null);--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_type" CHECK ("commerce"."pages"."type" in ('page', 'article', 'product_layout', 'header', 'footer', 'variant'));--> statement-breakpoint
-- A/B tests (D148): private tables like the rest of `commerce`, read and written only by server code with a direct connection.
ALTER TABLE commerce.experiments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.experiment_variants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.experiment_exposures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.experiment_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.experiment_carts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A test moves forward only: draft, running, stopped, then applied or discarded (a draft can also be discarded). Once it has
-- left draft, what it measures cannot change (its page, goal, traffic, audience and minimums), only its name, hypothesis
-- and planned end, so the results are about what was started. Starting needs a published page that has no address of
-- another kind (not the front page or one with a role), a control and one to three variants whose shares add up to one, each a
-- published variant page, and room under the store's limit of five running tests.
CREATE FUNCTION commerce.experiments_guard() RETURNS trigger
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
  ) THEN
    RAISE EXCEPTION 'experiments.locked: a test that has started cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = OLD.status THEN
    IF OLD.status IN ('applied', 'discarded') AND (NEW.name <> OLD.name OR NEW.hypothesis <> OLD.hypothesis OR NEW.planned_end IS DISTINCT FROM OLD.planned_end) THEN
      RAISE EXCEPTION 'experiments.locked: a finished test cannot be changed' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT ((OLD.status = 'draft' AND NEW.status IN ('running', 'discarded'))
       OR (OLD.status = 'running' AND NEW.status = 'stopped')
       OR (OLD.status = 'stopped' AND NEW.status IN ('applied', 'discarded'))) THEN
    RAISE EXCEPTION 'experiments.status: a test cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'running' THEN
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
    SELECT count(*) INTO v_running FROM commerce.experiments e WHERE e.store_id = NEW.store_id AND e.status = 'running' AND e.id <> NEW.id;
    IF v_running >= 5 THEN
      RAISE EXCEPTION 'experiments.limit: a store can run five tests at a time' USING ERRCODE = 'check_violation';
    END IF;
    NEW.started_at := COALESCE(NEW.started_at, now());
    NEW.planned_end := COALESCE(NEW.planned_end, NEW.started_at + make_interval(days => NEW.min_days));
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
CREATE TRIGGER experiments_guard BEFORE INSERT OR UPDATE ON commerce.experiments
  FOR EACH ROW EXECUTE FUNCTION commerce.experiments_guard();
--> statement-breakpoint
-- A test that has run is history and stays (its results are what the owner decided on); only a draft or a discarded
-- test can be deleted, or all of a store's when the store itself goes.
CREATE FUNCTION commerce.experiments_no_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status NOT IN ('draft', 'discarded') AND EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = OLD.store_id) THEN
    RAISE EXCEPTION 'experiments.delete: a test that has run is kept' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER experiments_no_delete BEFORE DELETE ON commerce.experiments
  FOR EACH ROW EXECUTE FUNCTION commerce.experiments_no_delete();
--> statement-breakpoint
-- The versions of a test are made and changed only while it is a draft, and a variant is a published-or-draft page of
-- type `variant` of the same store.
CREATE FUNCTION commerce.experiment_variants_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_experiment uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.experiment_id ELSE NEW.experiment_id END;
  v_status text;
BEGIN
  SELECT e.status INTO v_status FROM commerce.experiments e WHERE e.id = v_experiment;
  IF v_status IS NULL THEN
    -- The test is being deleted with its store or by itself (cascade): nothing to protect.
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'experiment_variants.locked: the versions of a test that has started cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.page_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.pages p WHERE p.id = NEW.page_id AND p.store_id = NEW.store_id AND p.type = 'variant'
  ) THEN
    RAISE EXCEPTION 'experiment_variants.page: a variant is a page made for the test' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER experiment_variants_guard BEFORE INSERT OR UPDATE OR DELETE ON commerce.experiment_variants
  FOR EACH ROW EXECUTE FUNCTION commerce.experiment_variants_guard();
--> statement-breakpoint
-- Who saw what is recorded only while the test runs and never changed: an exposure is the visitor's first sight of a
-- version, an event follows an exposure and carries its version.
CREATE FUNCTION commerce.experiment_exposures_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'experiment_exposures.changed: what a visitor was shown is never changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.experiments e WHERE e.id = NEW.experiment_id AND e.store_id = NEW.store_id AND e.status = 'running') THEN
    RAISE EXCEPTION 'experiment_exposures.closed: the test is not running' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER experiment_exposures_guard BEFORE INSERT OR UPDATE ON commerce.experiment_exposures
  FOR EACH ROW EXECUTE FUNCTION commerce.experiment_exposures_guard();
--> statement-breakpoint
CREATE FUNCTION commerce.experiment_events_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'experiment_events.changed: an event is never changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.experiments e WHERE e.id = NEW.experiment_id AND e.store_id = NEW.store_id AND e.status = 'running') THEN
    RAISE EXCEPTION 'experiment_events.closed: the test is not running' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.experiment_exposures x WHERE x.experiment_id = NEW.experiment_id AND x.visitor = NEW.visitor AND x.variant = NEW.variant) THEN
    RAISE EXCEPTION 'experiment_events.variant: an event belongs to the version the visitor was shown' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER experiment_events_guard BEFORE INSERT OR UPDATE ON commerce.experiment_events
  FOR EACH ROW EXECUTE FUNCTION commerce.experiment_events_guard();
--> statement-breakpoint
-- A page that is under test, or a version of one, is not deleted while the test exists (the foreign keys), and a page
-- under test is not turned into another kind of page.
CREATE FUNCTION commerce.pages_experiment_type_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.type <> OLD.type AND (
    EXISTS (SELECT 1 FROM commerce.experiments e WHERE e.target_page_id = OLD.id)
    OR EXISTS (SELECT 1 FROM commerce.experiment_variants v WHERE v.page_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'pages.experiment: a page in a test keeps its kind' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pages_experiment_type_guard BEFORE UPDATE OF type ON commerce.pages
  FOR EACH ROW EXECUTE FUNCTION commerce.pages_experiment_type_guard();
--> statement-breakpoint
-- A page in a running test stays published: the original and each version are what visitors are being shown.
CREATE FUNCTION commerce.pages_experiment_published_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.published_at IS NULL AND OLD.published_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM commerce.experiments e
    LEFT JOIN commerce.experiment_variants v ON v.experiment_id = e.id
    WHERE e.status = 'running' AND (e.target_page_id = OLD.id OR v.page_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'pages.experiment: a page in a running test stays published' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pages_experiment_published_guard BEFORE UPDATE OF published_at ON commerce.pages
  FOR EACH ROW EXECUTE FUNCTION commerce.pages_experiment_published_guard();
--> statement-breakpoint
-- The plan comparison (D132): the feature is listed, in no plan yet; the platform's admin ticks the plans that include it.
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT 'Design and content', 'A/B tests of pages', 'Show two versions of a page to real visitors and keep the one that sells more.', 195
WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features WHERE name = 'A/B tests of pages');
