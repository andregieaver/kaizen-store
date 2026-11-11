-- The vouchers of a store's books (B3, D490): row-level security, as every commerce table (the server reads and writes them through its own
-- connection; no policy lets a client reach them), and, as the entries they document, never changed or deleted once written.

ALTER TABLE "commerce"."ledger_vouchers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.ledger_voucher_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'ledger.voucher_fixed: a voucher of the books is never changed or deleted' USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_vouchers_fixed BEFORE UPDATE OR DELETE ON commerce.ledger_vouchers FOR EACH ROW EXECUTE FUNCTION commerce.ledger_voucher_fixed();
