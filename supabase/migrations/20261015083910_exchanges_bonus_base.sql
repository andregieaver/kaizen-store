-- Exchanges (D239, docs/wave-3-exchanges.md 4.6, review finding): an exchange order is paid partly or wholly by the return's credit, a captured payment with
-- provider 'exchange'. The bonus program (D130) and the store's affiliate program (D131) earn on that order as on any paid order, so the share of credits a
-- refund takes back (and gives back) is measured against what the order was paid with: Stripe's payments AND the exchange payment. Before this, `v_paid`
-- counted Stripe's only, so an even exchange refunded later reversed nothing (credits kept on goods paid back) and a refund of a card-paid difference alone
-- reversed the whole grant. One anchored replacement per function, idempotent by its marker, raising when the anchor is gone.
DO $patch$
DECLARE
  v_fn text;
  v_def text;
  v_new text;
  v_anchor text := E'p.status = ''captured'' AND p.provider = ''stripe''\n     AND commerce.payment_of_order(p.store_id, p.id);';
  v_with text := E'p.status = ''captured'' AND p.provider IN (''stripe'', ''exchange'') /* D239 exchange base */\n     AND commerce.payment_of_order(p.store_id, p.id);';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['commerce.bonus_refund_applied(uuid)', 'commerce.affiliate_refund_applied(uuid)'] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF position('D239 exchange base' IN v_def) > 0 THEN CONTINUE; END IF;
    v_new := replace(v_def, v_anchor, v_with);
    IF v_new = v_def THEN RAISE EXCEPTION '%: the paid sum was not found, so an exchange order''s refund would not move credits', v_fn; END IF;
    EXECUTE v_new;
  END LOOP;
END
$patch$;
