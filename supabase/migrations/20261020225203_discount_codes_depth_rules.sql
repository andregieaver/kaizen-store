-- Codes in depth (wave 5 unit E1, D299, docs/wave-5-marketing.md 7.1). Read and written only by server code over the database connection.
ALTER TABLE commerce.discount_code_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A code's text is one store's once: a generated code is never the text of one of the store's codes, nor the other way.
CREATE FUNCTION commerce.discount_code_text_unique()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'discount_code_items' THEN
    IF EXISTS (SELECT 1 FROM commerce.discount_codes d WHERE d.store_id = NEW.store_id AND d.code = NEW.code) THEN
      RAISE EXCEPTION 'discount_code_items.code: the store has a code %', NEW.code USING ERRCODE = 'unique_violation';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM commerce.discount_code_items i WHERE i.store_id = NEW.store_id AND i.code = NEW.code) THEN
    RAISE EXCEPTION 'discount_codes.code: the store has a generated code %', NEW.code USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER discount_code_items_text_unique BEFORE INSERT OR UPDATE OF code ON commerce.discount_code_items
  FOR EACH ROW EXECUTE FUNCTION commerce.discount_code_text_unique();
--> statement-breakpoint
CREATE TRIGGER discount_codes_text_unique BEFORE INSERT OR UPDATE OF code ON commerce.discount_codes
  FOR EACH ROW EXECUTE FUNCTION commerce.discount_code_text_unique();
--> statement-breakpoint

-- A generated code keeps its code and its text.
CREATE FUNCTION commerce.discount_code_items_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.discount_id <> OLD.discount_id OR NEW.code <> OLD.code OR NEW.store_id <> OLD.store_id THEN
    RAISE EXCEPTION 'discount_code_items.fixed: a generated code stays itself' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER discount_code_items_fixed BEFORE UPDATE ON commerce.discount_code_items FOR EACH ROW EXECUTE FUNCTION commerce.discount_code_items_fixed();
--> statement-breakpoint

-- A store's copy (D129) carries a code's new settings with its own categories, tags and groups, never its customers or generated codes:
-- duplicate_store() patched in place (as notifications_copy does), idempotent by a marker, raising when an anchor is gone.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('min_quantity, unique_codes' in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, $a$  INSERT INTO commerce.discount_codes (
    id, store_id, code, kind, percent, amounts, min_subtotals, product_ids, recurring, starts_at, ends_at,
    usage_limit, once_per_customer, active, created_at, updated_at
  )
  SELECT commerce.clone_id(v_store, id), v_store, code, kind, percent, amounts, min_subtotals, product_ids, recurring,
         starts_at, ends_at, usage_limit, once_per_customer, active, created_at, updated_at
    FROM commerce.discount_codes WHERE store_id = p_source;$a$, $b$  -- A code for some customers (D299) is copied without them, and switched off: the copy's customers are not yet there,
  -- and a code for nobody in particular would be a code for everyone. Its generated codes are never copied.
  INSERT INTO commerce.discount_codes (
    id, store_id, code, kind, percent, amounts, min_subtotals, product_ids, recurring, starts_at, ends_at,
    usage_limit, once_per_customer, active, created_at, updated_at, min_quantity, unique_codes
  )
  SELECT commerce.clone_id(v_store, id), v_store, code, kind, percent, amounts, min_subtotals, product_ids, recurring,
         starts_at, ends_at, usage_limit, once_per_customer, active AND jsonb_array_length(customer_ids) = 0,
         created_at, updated_at, min_quantity, unique_codes
    FROM commerce.discount_codes WHERE store_id = p_source;$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the discount codes copy was not found'; END IF;
  v_def := v_new;
  v_new := replace(v_def, $a$    FROM commerce.discount_codes t
   WHERE t.store_id = p_source AND t.product_ids IS NOT NULL AND d.store_id = v_store
     AND d.id = commerce.clone_id(v_store, t.id);$a$, $b$    FROM commerce.discount_codes t
   WHERE t.store_id = p_source AND t.product_ids IS NOT NULL AND d.store_id = v_store
     AND d.id = commerce.clone_id(v_store, t.id);

  -- Its categories, tags and customer groups (D299) are the copy's; one whose every one was left out is switched off.
  UPDATE commerce.discount_codes d
     SET term_ids = commerce.copy_remap(t.term_ids, p_source, v_store),
         tier_ids = commerce.copy_remap(t.tier_ids, p_source, v_store),
         active = d.active
           AND NOT (jsonb_array_length(t.term_ids) > 0 AND jsonb_array_length(commerce.copy_remap(t.term_ids, p_source, v_store)) = 0)
           AND NOT (jsonb_array_length(t.tier_ids) > 0 AND jsonb_array_length(commerce.copy_remap(t.tier_ids, p_source, v_store)) = 0)
    FROM commerce.discount_codes t
   WHERE t.store_id = p_source AND (jsonb_array_length(t.term_ids) > 0 OR jsonb_array_length(t.tier_ids) > 0)
     AND d.store_id = v_store AND d.id = commerce.clone_id(v_store, t.id);$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the discount codes remap was not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
