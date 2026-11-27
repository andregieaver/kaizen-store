-- kaizen:no-transaction
-- What a plan is (D912), held by the database as a gift card's rules are (check_gift_card_product): sold only by subscription, by the store
-- itself, and delivered as access, so each of its variants is a service (no shipping, no file, no stock) with no measure. Deferred to the
-- end of the transaction, so the editor's save may turn goods into a plan and its variants into services in either order.
-- A plan needs no picture to be on sale (assert_product_publishable(), as the baseline has it but for that one test).
-- Run statement by statement (the products kind check is validated outside a transaction, letting writes through, D569); each statement
-- can run again.
ALTER TABLE "commerce"."products" VALIDATE CONSTRAINT "products_kind";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.check_plan_product() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_product uuid;
  p commerce.products%ROWTYPE;
BEGIN
  -- Read apart: a row of products has no product_id for the planner to find.
  IF TG_TABLE_NAME = 'products' THEN
    v_product := NEW.id;
  ELSE
    v_product := NEW.product_id;
  END IF;
  SELECT * INTO p FROM commerce.products WHERE store_id = NEW.store_id AND id = v_product;
  IF NOT FOUND OR p.kind <> 'plan' THEN
    RETURN NULL;
  END IF;
  IF NOT p.subscription_only OR p.host_id IS NOT NULL THEN
    RAISE EXCEPTION 'plan.product: a plan is sold only by subscription, by the store itself' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM commerce.product_variants v
              WHERE v.store_id = NEW.store_id AND v.product_id = v_product AND (v.delivery <> 'service' OR v.measure_amount IS NOT NULL)) THEN
    RAISE EXCEPTION 'plan.variants: a plan is delivered as access, each variant a service with no measure' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS products_plan ON commerce.products;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER products_plan AFTER INSERT OR UPDATE ON commerce.products
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.check_plan_product();
--> statement-breakpoint
DROP TRIGGER IF EXISTS product_variants_plan ON commerce.product_variants;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER product_variants_plan AFTER INSERT OR UPDATE ON commerce.product_variants
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.check_plan_product();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.assert_product_publishable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_manufacturer_country char(2);
  v_responsible_country char(2);
  v_areas text[];
  v_area text;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  -- GPSR covers physical goods: a product sold only as downloads needs no
  -- manufacturer or responsible person (D24).
  IF NOT EXISTS (
    SELECT 1 FROM commerce.product_variants
     WHERE product_id = NEW.id AND active AND delivery = 'physical'
  ) THEN
    v_manufacturer_country := NULL;
  ELSIF NEW.manufacturer_id IS NULL THEN
    RAISE EXCEPTION 'product % cannot be active without a manufacturer', NEW.handle
      USING ERRCODE = 'check_violation';
  ELSE
    SELECT country INTO v_manufacturer_country
      FROM commerce.economic_operators
     WHERE store_id = NEW.store_id AND id = NEW.manufacturer_id;
  END IF;

  -- A responsible person established in each area the store's destinations ask for (D452).
  IF v_manufacturer_country IS NOT NULL THEN
    v_areas := commerce.responsible_person_areas(NEW.store_id, v_manufacturer_country);
    IF cardinality(v_areas) > 0 THEN
      SELECT country INTO v_responsible_country
        FROM commerce.economic_operators
       WHERE store_id = NEW.store_id AND id = NEW.responsible_person_id;
      FOREACH v_area IN ARRAY v_areas LOOP
        IF NOT commerce.is_established_in(v_area, v_responsible_country) THEN
          IF v_area = 'eu' THEN
            RAISE EXCEPTION 'product % has a manufacturer outside the EU and needs an EU responsible person', NEW.handle
              USING ERRCODE = 'check_violation';
          ELSE
            RAISE EXCEPTION 'product % has a manufacturer outside the EEA and needs an EEA responsible person', NEW.handle
              USING ERRCODE = 'check_violation';
          END IF;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- A plan (D912) has no page of its own and its pricing table shows no picture.
  IF NEW.kind <> 'plan' AND NOT EXISTS (SELECT 1 FROM commerce.product_media WHERE product_id = NEW.id) THEN
    RAISE EXCEPTION 'product % cannot be active without a picture', NEW.handle
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM commerce.product_translations
     WHERE product_id = NEW.id AND btrim(title) <> ''
  ) THEN
    RAISE EXCEPTION 'product % cannot be active without a title', NEW.handle
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM commerce.product_variants
     WHERE product_id = NEW.id AND active
  ) THEN
    RAISE EXCEPTION 'product % cannot be active without an active variant', NEW.handle
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
