-- Mollie behind the payment-provider adapter (wave 4 unit E, D292, docs/wave-4-payments.md 7).
--
-- A store's Mollie connection holds its refresh token (encrypted by the server) and is read only by server code over the database connection, never by
-- the Data API; the checkout's provider per mode is the store's setting. Both stay closed to every API role.
ALTER TABLE commerce.mollie_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.checkout_providers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A Mollie payment made in Mollie's test mode is a test (D292): its mode is kept on the row when Kaizena Flow records it (`payments.test_mode`), since its
-- account is a Mollie profile and not one of `connected_accounts`. So an order paid in Mollie's test mode never gets a legal invoice number either.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.invoice_eligibility(uuid)'::regprocedure);
  IF position($m$p.provider IN ('venue', 'exchange', 'mollie')$m$ in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, $a$OR (p.provider IN ('venue', 'exchange') AND p.test_mode))$a$, $b$OR (p.provider IN ('venue', 'exchange', 'mollie') AND p.test_mode))$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'invoice_eligibility: the venue and exchange test was not found'; END IF;
  v_new := replace(v_new, $a$AND ((p.provider NOT IN ('venue', 'exchange') AND p.provider_account$a$, $b$AND ((p.provider NOT IN ('venue', 'exchange', 'mollie') AND p.provider_account$b$);
  EXECUTE v_new;
END;
$patch$;
