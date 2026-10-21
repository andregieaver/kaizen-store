-- Several codes on one order (wave 5 unit E2, D299, docs/wave-5-marketing.md 7.2). Read and written only by server code over the database connection.
ALTER TABLE commerce.order_discount_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A cart holds five codes at most: the first in discount_code, four more here.
ALTER TABLE commerce.carts ADD CONSTRAINT carts_more_codes CHECK (cardinality(more_codes) <= 4);
--> statement-breakpoint

-- What an order used stays as it was used: a row is written with its order and never changed.
CREATE FUNCTION commerce.order_discount_codes_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'order_discount_codes.fixed: an order''s codes stay as they were used' USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_discount_codes_fixed BEFORE UPDATE OR DELETE ON commerce.order_discount_codes
  FOR EACH ROW EXECUTE FUNCTION commerce.order_discount_codes_fixed();
--> statement-breakpoint

-- A store's copy (D129) carries which codes a code may be used with: duplicate_store() patched in place (as discount_codes_depth_rules does),
-- idempotent by a marker, raising when its anchor is gone.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('unique_codes, combines_with' in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, 'min_quantity, unique_codes', 'min_quantity, unique_codes, combines_with');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the discount codes copy was not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
