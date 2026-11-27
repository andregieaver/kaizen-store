-- A purchase option for one variant (D911): monthly and yearly are two variants with their own prices, each with its own option.
--
-- 1. An option's variant is always one of its own product's variants.
-- 2. A copied store keeps each such option on the copy of its variant. clone_store() and duplicate_store() name every column
--    they copy, so each is wrapped: the original copies as before (the option for every variant), then the wrapper points
--    each copied option at the copy of its variant. Both name a copied row commerce.clone_id(new store, old id), the same
--    way for options and for variants, so no map is needed. Callers keep calling the same names with the same arguments.

CREATE FUNCTION commerce.selling_plans_variant_of_product() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.product_variants v
     WHERE v.store_id = NEW.store_id AND v.id = NEW.variant_id AND v.product_id = NEW.product_id
  ) THEN
    RAISE EXCEPTION 'selling_plans.variant_of_product: a purchase option is for one of its own product''s variants'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER selling_plans_variant_of_product
  BEFORE INSERT OR UPDATE OF variant_id, product_id ON commerce.selling_plans
  FOR EACH ROW EXECUTE FUNCTION commerce.selling_plans_variant_of_product();
--> statement-breakpoint
ALTER FUNCTION commerce.clone_store(uuid, text, text, uuid) RENAME TO clone_store_rows;
--> statement-breakpoint
COMMENT ON FUNCTION commerce.clone_store_rows(uuid, text, text, uuid) IS
  'The copy of a template made by commerce.clone_store() (D911 wraps it); call clone_store(), never this.';
--> statement-breakpoint
CREATE FUNCTION commerce.clone_store(p_template_id uuid, p_slug text, p_name text, p_owner_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_store uuid;
BEGIN
  v_store := commerce.clone_store_rows(p_template_id, p_slug, p_name, p_owner_id);
  -- Each purchase option for one variant (D911) on the copy of that variant.
  UPDATE commerce.selling_plans np
     SET variant_id = commerce.clone_id(v_store, sp.variant_id)
    FROM commerce.selling_plans sp
   WHERE sp.store_id = p_template_id AND sp.variant_id IS NOT NULL
     AND np.store_id = v_store AND np.id = commerce.clone_id(v_store, sp.id)
     AND EXISTS (
       SELECT 1 FROM commerce.product_variants nv
        WHERE nv.store_id = v_store AND nv.id = commerce.clone_id(v_store, sp.variant_id)
     );
  RETURN v_store;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[]) RENAME TO duplicate_store_rows;
--> statement-breakpoint
COMMENT ON FUNCTION commerce.duplicate_store_rows(uuid, text, text, uuid, uuid[], uuid[], uuid[]) IS
  'The copy of a store made by commerce.duplicate_store() (D911 wraps it); call duplicate_store(), never this.';
--> statement-breakpoint
CREATE FUNCTION commerce.duplicate_store(
  p_source uuid, p_slug text, p_name text, p_owner uuid,
  p_page_ids uuid[] DEFAULT NULL::uuid[], p_product_ids uuid[] DEFAULT NULL::uuid[], p_post_ids uuid[] DEFAULT NULL::uuid[]
) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_store uuid;
BEGIN
  v_store := commerce.duplicate_store_rows(p_source, p_slug, p_name, p_owner, p_page_ids, p_product_ids, p_post_ids);
  -- Each purchase option for one variant (D911) on the copy of that variant; an option is copied only with its product.
  UPDATE commerce.selling_plans np
     SET variant_id = commerce.clone_id(v_store, sp.variant_id)
    FROM commerce.selling_plans sp
   WHERE sp.store_id = p_source AND sp.variant_id IS NOT NULL
     AND np.store_id = v_store AND np.id = commerce.clone_id(v_store, sp.id)
     AND EXISTS (
       SELECT 1 FROM commerce.product_variants nv
        WHERE nv.store_id = v_store AND nv.id = commerce.clone_id(v_store, sp.variant_id)
     );
  RETURN v_store;
END;
$$;
