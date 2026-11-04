-- D445 step 9: *Undo this copy* deletes the orders a move copied from Shopify. A copied order may be deleted (`order_number_guard()`), but its
-- history rows are append-only; this lets exactly one copied order's history go with it, inside `delete_copied_order()`, and nothing else.

-- `forbid_change()` keeps order_events append-only (with the erasure rules patched into it since gdpr_rules); patched in place here, as those
-- were, so the one thing it newly lets through is the deletion of one copied order's history, while that function says so.
DO $patch$
DECLARE
  v_def text;
  v_start int;
  v_at int;
  v_guard text := E'\n  IF TG_TABLE_NAME = ''order_events'' AND TG_OP = ''DELETE''\n     AND coalesce(current_setting(''kaizen.copied_order_delete'', true), '''') = to_jsonb(OLD) ->> ''order_id'' THEN\n    RETURN OLD;\n  END IF;';
BEGIN
  v_def := pg_get_functiondef('commerce.forbid_change()'::regprocedure);
  IF position('kaizen.copied_order_delete' in v_def) > 0 THEN
    RETURN;
  END IF;
  v_start := position('$function$' in v_def);
  v_at := position('BEGIN' in substr(v_def, v_start));
  IF v_start = 0 OR v_at = 0 THEN
    RAISE EXCEPTION 'forbid_change: its BEGIN was not found, so a copied order''s history cannot be let go';
  END IF;
  EXECUTE overlay(v_def placing v_guard from v_start + v_at - 1 + length('BEGIN') for 0);
END;
$patch$;
--> statement-breakpoint

-- One copied order and its history; false for any other order (a real order is never deleted).
CREATE FUNCTION commerce.delete_copied_order(p_store uuid, p_order uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.orders WHERE store_id = p_store AND id = p_order AND copied_from IS NOT NULL) THEN
    RETURN false;
  END IF;
  PERFORM set_config('kaizen.copied_order_delete', p_order::text, true);
  -- A copied order holds its lines, its tags and its history; anything else made for it since (a review request, say) keeps it.
  -- The lines of a copied order are read-only but to the writer that copies (`commerce.copying`): this one, for its own order alone.
  PERFORM set_config('commerce.copying', 'on', true);
  DELETE FROM commerce.order_lines WHERE order_id = p_order;
  PERFORM set_config('commerce.copying', '', true);
  DELETE FROM commerce.order_tags WHERE order_id = p_order;
  DELETE FROM commerce.order_events WHERE order_id = p_order;
  DELETE FROM commerce.orders WHERE store_id = p_store AND id = p_order AND copied_from IS NOT NULL;
  PERFORM set_config('kaizen.copied_order_delete', '', true);
  RETURN true;
END;
$$;
