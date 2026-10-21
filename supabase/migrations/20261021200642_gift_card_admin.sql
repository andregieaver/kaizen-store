-- Gift cards, step F4 (D300, docs/wave-5-marketing.md 8.4): the owner's screens and figures. The invoice of an order marks its gift card lines
-- (`"voucher": true` on the snapshot's line, a product of kind `gift_card`, VAT category `voucher`), so the document can say why such a line carries
-- no VAT: a multi-purpose voucher, its VAT charged when it is spent. Invoices already issued keep their snapshot. `buildInvoiceSnapshot()` is the
-- same in TypeScript (`invoice-parity.test.ts`).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.build_invoice_snapshot(uuid, date, date)'::regprocedure);
  IF position($m$'{"voucher": true}'$m$ in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    $a$      'wouldHaveRate', CASE WHEN rc THEN tax_rate END
    ) ORDER BY ord) FILTER (WHERE NOT deferred), '[]'::jsonb),$a$,
    $b$      'wouldHaveRate', CASE WHEN rc THEN tax_rate END
    ) || CASE WHEN vat_category = 'voucher' THEN '{"voucher": true}'::jsonb ELSE '{}'::jsonb END ORDER BY ord) FILTER (WHERE NOT deferred), '[]'::jsonb),$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'build_invoice_snapshot: the lines were not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
