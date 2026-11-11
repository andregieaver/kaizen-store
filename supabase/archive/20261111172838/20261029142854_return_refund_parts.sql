-- A return refunded in parts (wave 11 unit M, D392): since D174 `refundOrder()` splits an amount over the order's captured payments, one refund per
-- payment, so a return refunded after a paid change may need two. The return names the first (`refund_id`); its rule compared that one refund's amount
-- with the return's, so a split refund was refused after Stripe had given the money back. The writer now names every part of the refund it records in
-- the transaction's setting `kaizen.return_refund_parts` (a uuid array); when that list names the return's refund, the parts are summed, each must be a
-- refund of this order, and the sum must equal what the return records. Without the setting the rule is as before.

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.returns_rules()'::regprocedure);
  IF position('return_refund_parts_sum' in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    $a$      IF NOT FOUND OR v_refund.amount_minor <> NEW.refund_minor - commerce.return_transferred(NEW.store_id, NEW.id) THEN$a$,
    $b$      IF NOT FOUND OR commerce.return_refund_parts_sum(NEW.store_id, NEW.order_id, NEW.refund_id, v_refund.amount_minor)
                        <> NEW.refund_minor - commerce.return_transferred(NEW.store_id, NEW.id) THEN$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'returns_rules: the refund match test was not found'; END IF;
  -- The helper is made first so the patched body compiles against it.
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION commerce.return_refund_parts_sum(p_store uuid, p_order uuid, p_named uuid, p_named_amount bigint)
    RETURNS bigint
    LANGUAGE plpgsql STABLE
    SET search_path = ''
    AS $body$
    DECLARE
      v_parts uuid[];
      v_sum bigint;
      v_ours int;
    BEGIN
      -- kaizen.return_refund_parts: the refunds one refund of a return was split into, named by the writer in this transaction.
      v_parts := nullif(current_setting('kaizen.return_refund_parts', true), '')::uuid[];
      IF v_parts IS NULL OR NOT (p_named = ANY (v_parts)) THEN RETURN p_named_amount; END IF;
      SELECT coalesce(sum(rf.amount_minor), 0), count(*) INTO v_sum, v_ours
        FROM commerce.refunds rf JOIN commerce.payments p ON p.store_id = rf.store_id AND p.id = rf.payment_id
       WHERE rf.store_id = p_store AND p.order_id = p_order AND rf.id = ANY (v_parts);
      -- Every part named must be a refund of this order; otherwise nothing matches.
      IF v_ours <> cardinality(v_parts) THEN RETURN -1; END IF;
      RETURN v_sum;
    END;
    $body$
  $fn$;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.return_refund_parts_sum(uuid, uuid, uuid, bigint) FROM PUBLIC;
