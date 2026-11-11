-- Invoices and credit notes for shop orders (D159, docs/wave-1b-invoices.md): the rules that live in the database.
--
-- * an invoice is made only by commerce.make_order_invoice(), called by commerce.issue_order_invoice() inside
--   commerce.complete_order_payment() (so every path that pays an order issues it), and a failure in it rolls back only
--   itself (the number comes back, the series stays gap-free) and never stops the payment;
-- * a credit note is made only by commerce.make_credit_note(): a deferred constraint trigger on refunds runs it at commit for
--   every refund that is succeeded (any path, present or future), and one on returns for a return refunded outside Kaizen;
-- * a document is a frozen JSON snapshot, immutable (an update only sets the PDF's path once, or anonymises it for unit 1g's
--   retention), never deleted, never inserted by anything but the issuing functions; one invoice per order, one credit note per
--   refund; copied, host, test-mode and unpaid orders get none; a credit note is never above what the invoice left uncredited,
--   per VAT-rate bucket, in net, VAT and gross;
-- * the series are gap-free (D141's guard, plus commerce.document_audit()); prefixes become F- and K- until the first number is issued;
-- * a refund's `succeeded` is final; a return's refund working is written once.
-- No function here contains DELETE, TRUNCATE or DROP (the production migration tool cancels them): the stored PDF of an
-- anonymised document is removed by application code. The migration itself drops two triggers outside any function (the old
-- append-only guards), which the one-time PDF update replaces.
-- Like every commerce table, row-level security on and no policies: the Data API reaches none of it.

ALTER TABLE commerce.invoice_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.document_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.document_pdf_state ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Private storage for the PDFs (nothing here on plain Postgres: tests, CI, local development)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('documents', 'documents', false)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Small helpers (each mirrored by a pure function in src/lib/invoice-snapshot.ts or credit-allocation.ts)
-- ---------------------------------------------------------------------------

-- The VAT in a VAT-inclusive amount, rounded half up in exact integers (vatIncludedExact()).
CREATE OR REPLACE FUNCTION commerce.vat_incl(p_amount bigint, p_rate numeric) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_rate IS NULL OR p_rate <= 0 OR p_amount <= 0 THEN 0::bigint
    ELSE (p_amount * round(p_rate * 10000)::bigint * 2 + (10000 + round(p_rate * 10000)::bigint))
         / (2 * (10000 + round(p_rate * 10000)::bigint))
  END
$$;
--> statement-breakpoint

-- Text, or null when it is empty (text() in the snapshot builder).
CREATE OR REPLACE FUNCTION commerce.nz(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN btrim(p_text) = '' THEN NULL ELSE p_text END
$$;
--> statement-breakpoint

-- Every currency Kaizen offers has two decimals (src/lib/money.ts; a test holds the two together).
CREATE OR REPLACE FUNCTION commerce.minor_unit_digits(p_currency text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT 2
$$;
--> statement-breakpoint

-- `round_half_up(amount x fx)` where fx has at most eight decimals (convertWith()).
CREATE OR REPLACE FUNCTION commerce.convert_with(p_amount bigint, p_fx numeric) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT floor(p_amount * p_fx + 0.5)::bigint
$$;
--> statement-breakpoint

-- A document's token: inv_ or crn_ and 43 base64url characters from 32 random bytes (newDocumentToken()).
CREATE OR REPLACE FUNCTION commerce.new_document_token(p_prefix text) RETURNS text
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT p_prefix || replace(translate(
    encode(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'),
    '+/', '-_'), '=', '')
$$;
--> statement-breakpoint

-- What turns an amount of one currency into another, eight decimals, from the store's euro-based rates (D109); null when either has none (fxFactor()).
CREATE OR REPLACE FUNCTION commerce.fx_factor(p_store uuid, p_from text, p_to text) RETURNS numeric
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_a numeric;
  v_b numeric;
BEGIN
  IF p_from = p_to THEN RETURN 1; END IF;
  v_a := CASE WHEN p_from = 'EUR' THEN 1 ELSE (SELECT c.rate FROM commerce.store_currencies c WHERE c.store_id = p_store AND c.currency = p_from) END;
  v_b := CASE WHEN p_to = 'EUR' THEN 1 ELSE (SELECT c.rate FROM commerce.store_currencies c WHERE c.store_id = p_store AND c.currency = p_to) END;
  IF v_a IS NULL OR v_b IS NULL OR v_a <= 0 OR v_b <= 0 THEN RETURN NULL; END IF;
  RETURN round(v_b * power(10::numeric, commerce.minor_unit_digits(p_to) - commerce.minor_unit_digits(p_from)) / v_a, 8);
END;
$$;
--> statement-breakpoint

-- The currency a store's own country keeps its prices in, which its markets list first: the store's main currency (mainCurrency()).
CREATE OR REPLACE FUNCTION commerce.main_currency(p_store uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(
    (SELECT m.currency::text FROM commerce.markets m JOIN commerce.stores s ON s.id = m.store_id
      WHERE m.store_id = p_store AND m.active
      ORDER BY (m.code = s.country) DESC NULLS LAST, m.created_at, m.code LIMIT 1),
    'EUR')
$$;
--> statement-breakpoint

-- Whether the invoice must carry the VAT in the seller's country's own currency (homeVatRequirement(): Directive Art. 230).
CREATE OR REPLACE FUNCTION commerce.home_vat_required(p_country text, p_currency text, p_home text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_country IS NOT NULL AND p_home IS NOT NULL AND p_currency <> p_home AND NOT (p_country = 'DK' AND p_currency = 'EUR')
$$;
--> statement-breakpoint

-- The store day (YYYY-MM-DD) of a moment.
CREATE OR REPLACE FUNCTION commerce.store_day(p_store uuid, p_at timestamptz) RETURNS date
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (p_at AT TIME ZONE coalesce((SELECT s.time_zone FROM commerce.stores s WHERE s.id = p_store), 'UTC'))::date
$$;
--> statement-breakpoint

-- Shares of a total over weights by the largest-remainder method (distribute()): floor(total x w / sum) each, the remaining
-- minor units one each to the largest fractional parts, ties to the higher rate and then the lower index.
CREATE OR REPLACE FUNCTION commerce.distribute_minor(p_total bigint, p_weights bigint[], p_rates numeric[] DEFAULT NULL)
RETURNS bigint[]
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_sum numeric;
  v_out bigint[];
BEGIN
  IF p_total < 0 THEN RAISE EXCEPTION 'distribute_minor: total must be 0 or more'; END IF;
  IF p_weights IS NULL OR coalesce(array_length(p_weights, 1), 0) = 0 THEN RETURN ARRAY[]::bigint[]; END IF;
  IF p_total = 0 THEN
    SELECT array_agg(0::bigint) INTO v_out FROM generate_subscripts(p_weights, 1);
    RETURN v_out;
  END IF;
  SELECT sum(w)::numeric INTO v_sum FROM unnest(p_weights) AS t(w);
  IF v_sum = 0 THEN RAISE EXCEPTION 'distribute_minor: nothing to share the amount over'; END IF;
  WITH w AS (
    SELECT i AS idx, p_weights[i]::numeric AS wt, coalesce(p_rates[i], 0) AS rate FROM generate_subscripts(p_weights, 1) AS i
  ), b AS (
    SELECT idx, rate, div(p_total::numeric * wt, v_sum) AS base, mod(p_total::numeric * wt, v_sum) AS frac FROM w
  ), r AS (
    SELECT idx, base, row_number() OVER (ORDER BY frac DESC, rate DESC, idx ASC) AS rk, p_total - sum(base) OVER () AS left_over FROM b
  )
  SELECT array_agg((base + CASE WHEN rk <= left_over THEN 1 ELSE 0 END)::bigint ORDER BY idx) INTO v_out FROM r;
  RETURN v_out;
END;
$$;
--> statement-breakpoint

-- The VAT of a share of one bucket (creditFromGross()): the whole of what is left carries the whole VAT left; a part carries the
-- VAT in it, never above the VAT left and never so little that the net exceeds the net left. The gross is already inside what is left.
CREATE OR REPLACE FUNCTION commerce.credit_vat(p_gross bigint, p_rate numeric, p_gross_left bigint, p_net_left bigint, p_vat_left bigint)
RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_gross <= 0 THEN 0::bigint
    WHEN p_gross >= p_gross_left THEN p_vat_left
    ELSE greatest(least(commerce.vat_incl(p_gross, p_rate), p_vat_left), p_gross - p_net_left)
  END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Series: prefixes F- and K- until the first number is issued
-- ---------------------------------------------------------------------------

-- Unissued series of existing stores (the guard of D141 allows a prefix change before the first number).
UPDATE commerce.document_series ds SET prefix = 'F-'
 WHERE ds.series = 'invoice' AND ds.prefix = 'INV-' AND NOT EXISTS (SELECT 1 FROM commerce.invoices i WHERE i.store_id = ds.store_id);
--> statement-breakpoint
UPDATE commerce.document_series ds SET prefix = 'K-'
 WHERE ds.series = 'credit_note' AND ds.prefix = 'CN-' AND NOT EXISTS (SELECT 1 FROM commerce.credit_notes c WHERE c.store_id = ds.store_id);
--> statement-breakpoint

-- New stores get the new prefixes: the live definition, patched.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.initialise_store()'::regprocedure);
  IF position('''F-''' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(replace(v_def, '''INV-''', '''F-'''), '''CN-''', '''K-''');
  IF v_new = v_def THEN RAISE EXCEPTION 'initialise_store: its invoice prefixes were not found, so new stores keep INV- and CN-'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- Choosing the prefix and the first number of a sales series, until the first document of the store's series is issued.
CREATE OR REPLACE FUNCTION commerce.set_sales_series(p_store uuid, p_series text, p_prefix text, p_next_number bigint) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF p_series NOT IN ('invoice', 'credit_note') THEN
    RAISE EXCEPTION 'document_series.unknown: % is not an invoice or credit note series', p_series USING ERRCODE = 'check_violation';
  END IF;
  IF p_prefix IS NULL OR p_prefix !~ '^[A-Za-z0-9._/-]{0,10}$' THEN
    RAISE EXCEPTION 'document_series.prefix: a prefix is up to 10 letters, digits and . _ / -' USING ERRCODE = 'check_violation';
  END IF;
  IF p_next_number IS NULL OR p_next_number < 1 THEN
    RAISE EXCEPTION 'document_series.number: the first number must be 1 or more' USING ERRCODE = 'check_violation';
  END IF;
  IF (p_series = 'invoice' AND EXISTS (SELECT 1 FROM commerce.invoices i WHERE i.store_id = p_store))
     OR (p_series = 'credit_note' AND EXISTS (SELECT 1 FROM commerce.credit_notes c WHERE c.store_id = p_store)) THEN
    RAISE EXCEPTION 'document_series.issued: numbers already issued cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  UPDATE commerce.document_series SET prefix = p_prefix, next_number = p_next_number
   WHERE store_id = p_store AND series = p_series;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_series.unknown: the store has no series %', p_series USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Invoicing settings: the switch, and when it started
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION commerce.invoice_settings_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.enabled THEN NEW.enabled_from := NULL; END IF;
    RETURN NEW;
  END IF;
  -- Switching on starts the count: invoices are issued from then on and never back-dated.
  IF NEW.enabled AND NOT OLD.enabled THEN NEW.enabled_from := now();
  ELSIF NOT NEW.enabled THEN NEW.enabled_from := NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_settings_rules BEFORE INSERT OR UPDATE ON commerce.invoice_settings
  FOR EACH ROW EXECUTE FUNCTION commerce.invoice_settings_rules();
--> statement-breakpoint

-- A store that already has real orders starts with invoicing off: nothing is numbered for it until its owner has read the
-- readiness list and switched it on. Every other store has no row, which means on.
INSERT INTO commerce.invoice_settings (store_id, enabled)
SELECT DISTINCT o.store_id, false
  FROM commerce.orders o
 WHERE o.copied_from IS NULL
   AND EXISTS (SELECT 1 FROM commerce.order_events e WHERE e.store_id = o.store_id AND e.order_id = o.id AND e.type = 'order.paid')
ON CONFLICT (store_id) DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The documents are immutable
-- ---------------------------------------------------------------------------

-- An update is refused unless it sets the PDF's path once, or anonymises the document (a transaction-local setting that only
-- anonymise_expired_documents() sets). Any other change, and any removal, is always refused.
CREATE OR REPLACE FUNCTION commerce.guard_document_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_pdf text[] := ARRAY['pdf_path', 'pdf_sha256'];
  v_anonymise text[] := ARRAY['pdf_path', 'pdf_sha256', 'snapshot', 'anonymised_at', 'public_token'];
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'commerce.% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF current_setting('commerce.anonymising', true) = 'on' THEN
    IF (to_jsonb(NEW) - v_anonymise) IS DISTINCT FROM (to_jsonb(OLD) - v_anonymise) THEN
      RAISE EXCEPTION 'commerce.% can only be anonymised, not otherwise changed', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.pdf_path IS NULL AND OLD.anonymised_at IS NULL AND NEW.pdf_path IS NOT NULL AND (to_jsonb(NEW) - v_pdf) = (to_jsonb(OLD) - v_pdf) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'commerce.% is append-only; UPDATE is not allowed (only the PDF path, once)', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER invoices_append_only ON commerce.invoices;
--> statement-breakpoint
CREATE TRIGGER invoices_append_only BEFORE DELETE OR UPDATE ON commerce.invoices
  FOR EACH ROW EXECUTE FUNCTION commerce.guard_document_change();
--> statement-breakpoint
DROP TRIGGER credit_notes_append_only ON commerce.credit_notes;
--> statement-breakpoint
CREATE TRIGGER credit_notes_append_only BEFORE DELETE OR UPDATE ON commerce.credit_notes
  FOR EACH ROW EXECUTE FUNCTION commerce.guard_document_change();
--> statement-breakpoint

-- An insert is refused unless the issuing function made it (it names the order, refund or return in a transaction-local
-- setting), and the row is what its snapshot says: its totals are the buckets', an invoice's total is its order's, a credit
-- note refers to a refund or return of the invoice's own order and is never above what the invoice left uncredited per rate.
CREATE OR REPLACE FUNCTION commerce.document_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_by text := current_setting('commerce.issuing_document', true);
  v_order uuid;
  v_order_row commerce.orders%ROWTYPE;
  v_sum record;
  v_prefix text;
  v_over integer;
BEGIN
  SELECT s.prefix INTO v_prefix FROM commerce.document_series s WHERE s.store_id = NEW.store_id AND s.series = NEW.series;
  IF NEW.document_number IS DISTINCT FROM v_prefix || NEW.number::text THEN
    RAISE EXCEPTION 'document.number_format: % is not the series prefix and number', NEW.document_number USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum((b ->> 'netMinor')::bigint), 0) AS net, coalesce(sum((b ->> 'vatMinor')::bigint), 0) AS vat,
         coalesce(sum((b ->> 'grossMinor')::bigint), 0) AS gross
    INTO v_sum FROM jsonb_array_elements(NEW.snapshot -> 'buckets') AS b;
  IF v_sum.net <> NEW.net_minor OR v_sum.vat <> NEW.tax_minor OR v_sum.gross <> NEW.total_minor THEN
    RAISE EXCEPTION 'document.totals_mismatch: the totals are not the snapshot''s buckets' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_TABLE_NAME = 'invoices' THEN
    IF v_by IS DISTINCT FROM NEW.order_id::text THEN
      RAISE EXCEPTION 'document.issuing_only: an invoice is made by commerce.issue_order_invoice()' USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT * INTO v_order_row FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id;
    IF NOT FOUND OR v_order_row.copied_from IS NOT NULL OR v_order_row.host_id IS NOT NULL THEN
      RAISE EXCEPTION 'document.order: a copied or host order, or one that does not exist, is not invoiced' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.total_minor <> v_order_row.total_minor OR NEW.currency <> v_order_row.currency THEN
      RAISE EXCEPTION 'invoice.total_not_order: the invoice is not for the order''s total' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Credit notes.
  IF v_by IS DISTINCT FROM coalesce(NEW.refund_id, NEW.return_id)::text THEN
    RAISE EXCEPTION 'document.issuing_only: a credit note is made by commerce.issue_credit_note()' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT i.order_id INTO v_order FROM commerce.invoices i WHERE i.store_id = NEW.store_id AND i.id = NEW.invoice_id;
  IF NEW.refund_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.refunds r JOIN commerce.payments p ON p.store_id = r.store_id AND p.id = r.payment_id
     WHERE r.store_id = NEW.store_id AND r.id = NEW.refund_id AND p.order_id = v_order AND r.status = 'succeeded'
  ) THEN
    RAISE EXCEPTION 'credit_note.refund: the refund is not a succeeded refund of the invoice''s order' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.return_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.returns r WHERE r.store_id = NEW.store_id AND r.id = NEW.return_id AND r.order_id = v_order AND r.refund_outside
  ) THEN
    RAISE EXCEPTION 'credit_note.return: the return is not one refunded outside for the invoice''s order' USING ERRCODE = 'check_violation';
  END IF;
  -- Never above the invoice, per rate bucket: net, VAT and gross, with what its earlier credit notes took.
  WITH inv AS (
    SELECT (b ->> 'rate')::numeric AS rate, b ->> 'basis' AS basis, (b ->> 'netMinor')::bigint AS net, (b ->> 'vatMinor')::bigint AS vat, (b ->> 'grossMinor')::bigint AS gross
      FROM commerce.invoices i, jsonb_array_elements(i.snapshot -> 'buckets') AS b
     WHERE i.store_id = NEW.store_id AND i.id = NEW.invoice_id
  ), prior AS (
    SELECT (b ->> 'rate')::numeric AS rate, b ->> 'basis' AS basis, sum((b ->> 'netMinor')::bigint) AS net, sum((b ->> 'vatMinor')::bigint) AS vat, sum((b ->> 'grossMinor')::bigint) AS gross
      FROM commerce.credit_notes c, jsonb_array_elements(c.snapshot -> 'buckets') AS b
     WHERE c.store_id = NEW.store_id AND c.invoice_id = NEW.invoice_id
     GROUP BY 1, 2
  ), mine AS (
    SELECT (b ->> 'rate')::numeric AS rate, b ->> 'basis' AS basis, (b ->> 'netMinor')::bigint AS net, (b ->> 'vatMinor')::bigint AS vat, (b ->> 'grossMinor')::bigint AS gross
      FROM jsonb_array_elements(NEW.snapshot -> 'buckets') AS b
  )
  SELECT count(*) INTO v_over
    FROM mine m
    LEFT JOIN inv ON inv.rate = m.rate AND inv.basis = m.basis
    LEFT JOIN prior p ON p.rate = m.rate AND p.basis = m.basis
   WHERE inv.rate IS NULL
      OR m.net < 0 OR m.vat < 0 OR m.gross <= 0
      OR m.net + coalesce(p.net, 0) > inv.net
      OR m.vat + coalesce(p.vat, 0) > inv.vat
      OR m.gross + coalesce(p.gross, 0) > inv.gross;
  IF v_over > 0 THEN
    RAISE EXCEPTION 'credit_note.over_invoice: a credit note cannot credit more than the invoice left uncredited' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_insert_guard BEFORE INSERT ON commerce.invoices
  FOR EACH ROW EXECUTE FUNCTION commerce.document_insert_guard();
--> statement-breakpoint
CREATE TRIGGER credit_notes_insert_guard BEFORE INSERT ON commerce.credit_notes
  FOR EACH ROW EXECUTE FUNCTION commerce.document_insert_guard();
--> statement-breakpoint

-- A refund that has succeeded stays succeeded, so a credit note is never left standing for a refund that stopped existing.
CREATE OR REPLACE FUNCTION commerce.refunds_succeeded_final() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'succeeded' AND NEW.status <> 'succeeded' THEN
    RAISE EXCEPTION 'refund.succeeded_final: a refund that has succeeded cannot become % (a credit note may stand for it)', NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refunds_succeeded_final BEFORE UPDATE OF status ON commerce.refunds
  FOR EACH ROW EXECUTE FUNCTION commerce.refunds_succeeded_final();
--> statement-breakpoint

-- The working of a return's refund is written once, with the refund.
CREATE OR REPLACE FUNCTION commerce.returns_working_once() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.refund_working IS NOT NULL AND NEW.refund_working IS DISTINCT FROM OLD.refund_working THEN
    RAISE EXCEPTION 'return.working_once: the working of a refund is written once' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.refund_minor IS NOT NULL AND OLD.refund_working IS NULL AND NEW.refund_working IS NOT NULL THEN
    RAISE EXCEPTION 'return.working_once: the working is written with the refund' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER returns_working_once BEFORE UPDATE OF refund_working ON commerce.returns
  FOR EACH ROW EXECUTE FUNCTION commerce.returns_working_once();
--> statement-breakpoint

-- The waiting query reads paid orders of one store that are not copied or a host's.
CREATE INDEX IF NOT EXISTS orders_invoice_candidates_idx ON commerce.orders (store_id, placed_at)
  WHERE copied_from IS NULL AND host_id IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- When an order gets an invoice (invoiceEligibility(), 2.1): the first reason that fails, from a closed list in this order
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION commerce.invoice_eligibility(p_order uuid) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  o commerce.orders%ROWTYPE;
  cfg commerce.invoice_settings%ROWTYPE;
  v_paid timestamptz;
  v_test boolean;
BEGIN
  SELECT * INTO o FROM commerce.orders WHERE id = p_order;
  IF NOT FOUND THEN RETURN 'not_paid'; END IF;
  IF o.copied_from IS NOT NULL THEN RETURN 'copied'; END IF;
  IF o.host_id IS NOT NULL THEN RETURN 'host'; END IF;
  SELECT min(e.created_at) INTO v_paid FROM commerce.order_events e
   WHERE e.store_id = o.store_id AND e.order_id = o.id AND e.type = 'order.paid';
  IF v_paid IS NULL THEN RETURN 'not_paid'; END IF;
  -- Paid in Stripe's test mode: a Stripe payment on a test account, or a venue payment made while the store was in test mode (`payments.test_mode`,
  -- frozen with the payment by a trigger, so a store that goes live later never gives a test order a number). A payment
  -- with no known account is treated as live, so a missing row can only produce an invoice, never lose one.
  SELECT EXISTS (
    SELECT 1 FROM commerce.payments p
     WHERE p.store_id = o.store_id AND p.order_id = o.id AND p.status NOT IN ('failed', 'cancelled')
       AND ((p.provider <> 'venue' AND p.provider_account IS NOT NULL AND EXISTS (
              SELECT 1 FROM commerce.connected_accounts a WHERE a.store_id = o.store_id AND a.account_id = p.provider_account AND a.mode = 'test'))
         OR (p.provider = 'venue' AND p.test_mode))
  ) INTO v_test;
  IF v_test THEN RETURN 'test_mode'; END IF;
  SELECT * INTO cfg FROM commerce.invoice_settings WHERE store_id = o.store_id;
  IF FOUND AND (NOT cfg.enabled OR (cfg.enabled_from IS NOT NULL AND v_paid < cfg.enabled_from)) THEN RETURN 'disabled'; END IF;
  IF o.total_minor = 0 THEN RETURN 'zero_total'; END IF;
  RETURN 'ok';
END;
$$;
--> statement-breakpoint

-- The seller's VAT number: the one the order was placed with (its frozen treatment), else the live profile's when registered.
-- (plpgsql, so the columns of the tax engine's migrations are read when it runs, not when it is made.)
CREATE OR REPLACE FUNCTION commerce.invoice_seller_vat(p_order uuid) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_result text;
BEGIN
  SELECT coalesce(
    commerce.nz(o.vat_treatment ->> 'sellerVatNumber'),
    (SELECT CASE WHEN tp.vat_registered THEN tp.vat_number END FROM commerce.store_tax_profile tp WHERE tp.store_id = o.store_id))
    INTO v_result FROM commerce.orders o WHERE o.id = p_order;
  RETURN v_result;
END;
$$;
--> statement-breakpoint

-- The day the store's rates are from, for the VAT in another currency: when they were updated, else when the two currencies' rows last were.
CREATE OR REPLACE FUNCTION commerce.fx_as_of(p_store uuid, p_a text, p_b text) RETURNS date
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT commerce.store_day(p_store, coalesce(
    (SELECT s.rates_updated_at FROM commerce.stores s WHERE s.id = p_store),
    (SELECT max(c.updated_at) FROM commerce.store_currencies c WHERE c.store_id = p_store AND c.currency IN (p_a, p_b)),
    now()))
$$;
--> statement-breakpoint

-- Whether an eligible order can be invoiced now (waitingReason(), 2.1): 'ready', or the first reason it waits.
CREATE OR REPLACE FUNCTION commerce.invoice_readiness(p_order uuid) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  o commerce.orders%ROWTYPE;
  st commerce.stores%ROWTYPE;
  prof record;
  v_have boolean;
  v_vat bigint;
  v_home text;
BEGIN
  SELECT * INTO o FROM commerce.orders WHERE id = p_order;
  SELECT * INTO st FROM commerce.stores WHERE id = o.store_id;
  SELECT * INTO prof FROM commerce.store_tax_profile WHERE store_id = o.store_id;
  v_have := FOUND;
  IF commerce.nz(st.legal_name) IS NULL OR commerce.nz(st.postal_address) IS NULL OR commerce.nz(st.organisation_number) IS NULL
     OR commerce.nz(st.country::text) IS NULL
     OR (v_have AND prof.vat_registered AND commerce.nz(commerce.invoice_seller_vat(p_order)) IS NULL) THEN
    RETURN 'seller_details';
  END IF;
  IF NOT v_have THEN RETURN 'tax_profile_missing'; END IF;
  v_vat := CASE WHEN o.vat_kind = 'reverse_charge' THEN 0 ELSE o.tax_minor END;
  IF NOT prof.vat_registered AND v_vat > 0 THEN RETURN 'vat_charged_not_registered'; END IF;
  SELECT c.currency::text INTO v_home FROM commerce.countries c WHERE c.code = st.country;
  IF v_vat > 0 AND commerce.home_vat_required(st.country::text, o.currency::text, v_home)
     AND commerce.fx_factor(o.store_id, o.currency::text, v_home) IS NULL THEN
    RETURN 'no_exchange_rate';
  END IF;
  RETURN 'ready';
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.doc_language(p_locale text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN left(lower(coalesce(p_locale, '')), 2) IN ('nb', 'nn', 'no') THEN 'nb'
              WHEN left(lower(coalesce(p_locale, '')), 2) = 'sv' THEN 'sv'
              WHEN left(lower(coalesce(p_locale, '')), 2) = 'da' THEN 'da'
              ELSE 'en' END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The invoice's snapshot (buildInvoiceSnapshot() is the oracle: src/db/invoice-parity.test.ts holds the two to the same rows).
-- Without its number, which is taken last (the series' row lock is held for as short a time as it can be).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION commerce.build_invoice_snapshot(p_order uuid, p_issued_on date, p_supply_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  o commerce.orders%ROWTYPE;
  st commerce.stores%ROWTYPE;
  prof record;
  cfg commerce.invoice_settings%ROWTYPE;
  v_have boolean;
  v_tz text;
  rc boolean;
  v_lines jsonb;
  v_deferred jsonb;
  v_lines_total bigint;
  v_lines_tax bigint;
  v_physical boolean;
  v_rounded boolean;
  v_ship_gross bigint;
  v_ship_vat bigint;
  v_ship_net bigint;
  v_ship_rate numeric;
  v_ship_list bigint;
  v_ship jsonb;
  v_buckets jsonb;
  v_net bigint;
  v_vat bigint;
  v_gross bigint;
  v_code bigint;
  v_discounts jsonb;
  v_exempt boolean;
  v_statements jsonb;
  v_seller_vat text;
  v_buyer_vat text;
  v_home text;
  v_fx numeric;
  v_vat_home jsonb := NULL;
  v_vat_main jsonb := NULL;
  v_main text;
  v_payments jsonb;
  v_online bigint;
  v_provider text;
  v_notes jsonb;
  v_b jsonb;
  v_billing jsonb;
  v_shipping_addr jsonb;
  v_pick jsonb;
  v_complete boolean;
  v_place jsonb;
BEGIN
  SELECT * INTO o FROM commerce.orders WHERE id = p_order;
  SELECT * INTO st FROM commerce.stores WHERE id = o.store_id;
  SELECT * INTO prof FROM commerce.store_tax_profile WHERE store_id = o.store_id;
  v_have := FOUND;
  SELECT * INTO cfg FROM commerce.invoice_settings WHERE store_id = o.store_id;
  v_tz := st.time_zone;
  rc := o.vat_kind = 'reverse_charge';

  -- Lines.
  WITH base AS (
    SELECT ol.ctid AS ord, ol.id, ol.sku, ol.title, ol.quantity, ol.unit_price_minor, ol.total_minor, ol.tax_minor, ol.tax_rate,
           ol.delivery, ol.gift, ol.booked_count, p.vat_category, bk.starts_at, bk.ends_at,
           (ol.selling_plan_id IS NOT NULL AND ol.unit_price_minor = 0 AND ol.total_minor = 0 AND NOT ol.gift) AS deferred
      FROM commerce.order_lines ol
      LEFT JOIN commerce.product_variants v ON v.store_id = ol.store_id AND v.id = ol.variant_id
      LEFT JOIN commerce.products p ON p.store_id = v.store_id AND p.id = v.product_id
      LEFT JOIN LATERAL (
        SELECT b.starts_at, b.ends_at FROM commerce.bookings b
         WHERE b.store_id = ol.store_id AND b.order_line_id = ol.id ORDER BY b.starts_at LIMIT 1
      ) bk ON true
     WHERE ol.store_id = o.store_id AND ol.order_id = o.id
  ), c1 AS (
    SELECT base.*,
           CASE WHEN rc THEN 0 ELSE tax_minor END AS vat,
           total_minor - CASE WHEN rc THEN 0 ELSE tax_minor END AS net
      FROM base
  ), c2 AS (
    SELECT c1.*,
           greatest(unit_price_minor * quantity - commerce.vat_incl(unit_price_minor * quantity, tax_rate), net) AS list_net
      FROM c1
  ), c3 AS (
    SELECT c2.*, (2 * list_net + quantity) / (2 * quantity::bigint) AS unit_net FROM c2
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'lineId', id, 'sku', sku, 'title', title,
      'kind', CASE WHEN gift THEN 'gift' WHEN sku = 'SIGNUP-FEE' THEN 'fee' WHEN starts_at IS NOT NULL THEN 'booking'
                   WHEN delivery = 'digital' THEN 'download' WHEN delivery = 'service' THEN 'service' ELSE 'goods' END,
      'quantity', quantity, 'listNetMinor', list_net, 'discountNetMinor', list_net - net, 'netMinor', net,
      'vatRate', CASE WHEN rc THEN 0 ELSE tax_rate END,
      'basis', CASE WHEN rc THEN 'reverse_charge' WHEN vat_category = 'exempt' THEN 'exempt' ELSE 'standard' END,
      'vatMinor', vat, 'grossMinor', total_minor, 'unitNetMinor', unit_net,
      'serviceDate', CASE WHEN starts_at IS NOT NULL THEN to_char(starts_at AT TIME ZONE v_tz, 'YYYY-MM-DD') END,
      'service', CASE WHEN starts_at IS NOT NULL THEN jsonb_build_object(
          'startsAt', to_char(starts_at AT TIME ZONE v_tz, 'YYYY-MM-DD"T"HH24:MI'),
          'endsAt', to_char(ends_at AT TIME ZONE v_tz, 'YYYY-MM-DD"T"HH24:MI'), 'count', booked_count) END,
      'wouldHaveRate', CASE WHEN rc THEN tax_rate END
    ) ORDER BY ord) FILTER (WHERE NOT deferred), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('lineId', id, 'title', title, 'grossMinor', NULL::bigint) ORDER BY ord) FILTER (WHERE deferred), '[]'::jsonb),
    coalesce(sum(total_minor), 0)::bigint, coalesce(sum(tax_minor), 0)::bigint,
    coalesce(bool_or(delivery = 'physical'), false),
    coalesce(bool_or(unit_net * quantity <> list_net) FILTER (WHERE NOT deferred), false)
    INTO v_lines, v_deferred, v_lines_total, v_lines_tax, v_physical, v_rounded
    FROM c3;

  -- Shipping: what the shopper paid for delivery after any discount and relief is the rest of the order's total.
  v_ship_gross := o.total_minor - v_lines_total;
  v_ship_vat := CASE WHEN rc THEN 0 ELSE o.tax_minor - v_lines_tax END;
  v_ship_net := v_ship_gross - v_ship_vat;
  v_ship_rate := coalesce(o.shipping_tax_rate, CASE WHEN o.shipping_minor > 0 THEN commerce.vat_rate(o.market_code, 'standard', o.placed_at) END, 0);
  v_ship_list := greatest(o.shipping_minor - commerce.vat_incl(o.shipping_minor, v_ship_rate), v_ship_net);
  IF o.shipping_minor = 0 AND v_ship_gross = 0 THEN
    v_ship := NULL;
  ELSE
    v_ship := jsonb_build_object(
      'label', commerce.nz(o.delivery ->> 'label'), 'netBeforeMinor', v_ship_list, 'discountNetMinor', v_ship_list - v_ship_net,
      'netMinor', v_ship_net, 'vatRate', CASE WHEN rc THEN 0 ELSE v_ship_rate END,
      'basis', CASE WHEN rc THEN 'reverse_charge' ELSE 'standard' END, 'vatMinor', v_ship_vat, 'grossMinor', v_ship_gross,
      'wouldHaveRate', CASE WHEN rc THEN v_ship_rate END);
  END IF;

  -- The VAT per rate: one bucket per rate and basis, highest rate first.
  SELECT coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'basis', basis, 'netMinor', n, 'vatMinor', v, 'grossMinor', g) ORDER BY rate DESC, basis), '[]'::jsonb)
    INTO v_buckets
    FROM (
      SELECT rate, basis, sum(n)::bigint AS n, sum(v)::bigint AS v, sum(g)::bigint AS g FROM (
        SELECT (l ->> 'vatRate')::numeric AS rate, l ->> 'basis' AS basis, (l ->> 'netMinor')::bigint AS n, (l ->> 'vatMinor')::bigint AS v, (l ->> 'grossMinor')::bigint AS g
          FROM jsonb_array_elements(v_lines) AS l
        UNION ALL
        SELECT (v_ship ->> 'vatRate')::numeric, v_ship ->> 'basis', (v_ship ->> 'netMinor')::bigint, (v_ship ->> 'vatMinor')::bigint, (v_ship ->> 'grossMinor')::bigint
         WHERE v_ship IS NOT NULL
      ) x GROUP BY rate, basis HAVING sum(n) <> 0 OR sum(v) <> 0 OR sum(g) <> 0
    ) y;
  SELECT coalesce(sum((b ->> 'netMinor')::bigint), 0), coalesce(sum((b ->> 'vatMinor')::bigint), 0), coalesce(sum((b ->> 'grossMinor')::bigint), 0),
         coalesce(bool_or(b ->> 'basis' = 'exempt'), false)
    INTO v_net, v_vat, v_gross, v_exempt FROM jsonb_array_elements(v_buckets) AS b;

  -- The discounts as the shopper saw them (VAT-inclusive, informational); the code's is what is left of the order's.
  v_code := o.discount_minor - o.member_discount_minor - o.campaign_discount_minor - o.credit_minor - o.referral_discount_minor - o.vat_relief_minor;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', k, 'label', lbl, 'grossMinor', amt) ORDER BY ord), '[]'::jsonb) INTO v_discounts
    FROM (VALUES
      (1, 'campaign', commerce.nz(o.campaign_label), o.campaign_discount_minor),
      (2, 'member', commerce.nz(o.member_label), o.member_discount_minor),
      (3, 'welcome', NULL::text, o.referral_discount_minor),
      (4, 'code', commerce.nz(o.discount_code), v_code),
      (5, 'credit', NULL::text, o.credit_minor)
    ) AS d(ord, k, lbl, amt) WHERE amt > 0;

  -- The treatment is the order's, frozen when it was placed; the invoice never decides VAT.
  v_seller_vat := commerce.invoice_seller_vat(p_order);
  v_buyer_vat := CASE WHEN rc THEN commerce.nz(o.vat_treatment ->> 'buyerVatNumber') END;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY ord), '[]'::jsonb) INTO v_statements
    FROM (VALUES
      (1, 'reverse_charge', rc),
      (2, 'ioss', o.vat_kind = 'ioss'),
      (3, 'not_registered', v_have AND NOT coalesce(prof.vat_registered, false)),
      (4, 'exempt', v_exempt)
    ) AS t(ord, s, cond) WHERE cond;

  -- The VAT in the seller's currency (Directive Art. 230), and in the store's main currency for the reports.
  SELECT c.currency::text INTO v_home FROM commerce.countries c WHERE c.code = st.country;
  IF v_vat > 0 AND commerce.home_vat_required(st.country::text, o.currency::text, v_home) THEN
    v_fx := commerce.fx_factor(o.store_id, o.currency::text, v_home);
    IF v_fx IS NOT NULL THEN
      v_vat_home := jsonb_build_object(
        'currency', v_home,
        'vatMinor', (SELECT coalesce(sum(commerce.convert_with((b ->> 'vatMinor')::bigint, v_fx)), 0) FROM jsonb_array_elements(v_buckets) AS b),
        'fxRate', v_fx, 'asOf', to_char(commerce.fx_as_of(o.store_id, o.currency::text, v_home), 'YYYY-MM-DD'),
        'source', CASE WHEN st.rates_auto THEN 'ecb_auto' ELSE 'owner' END);
    END IF;
  END IF;
  v_main := commerce.main_currency(o.store_id);
  IF o.currency::text = v_main THEN
    v_vat_main := jsonb_build_object('currency', v_main, 'vatMinor', v_vat, 'fxRate', NULL::numeric);
  ELSE
    v_fx := commerce.fx_factor(o.store_id, o.currency::text, v_main);
    IF v_fx IS NOT NULL THEN
      v_vat_main := jsonb_build_object(
        'currency', v_main,
        'vatMinor', (SELECT coalesce(sum(commerce.convert_with((b ->> 'vatMinor')::bigint, v_fx)), 0) FROM jsonb_array_elements(v_buckets) AS b),
        'fxRate', v_fx);
    END IF;
  END IF;

  -- Payment: what was paid online and what is left for the venue.
  v_online := o.total_minor - o.balance_minor;
  SELECT p.provider INTO v_provider FROM commerce.payments p
   WHERE p.store_id = o.store_id AND p.order_id = o.id AND p.provider <> 'venue' AND p.status NOT IN ('failed', 'cancelled')
   ORDER BY p.created_at, p.id LIMIT 1;
  v_provider := coalesce(v_provider, 'stripe');
  SELECT coalesce(jsonb_agg(x ORDER BY ord), '[]'::jsonb) INTO v_payments FROM (
    SELECT 1 AS ord, jsonb_build_object('kind', 'paid_online', 'amountMinor', v_online, 'provider', v_provider) AS x WHERE v_online > 0
    UNION ALL
    SELECT 2, jsonb_build_object('kind', 'pay_at_venue', 'amountMinor', o.balance_minor, 'provider', 'venue') WHERE o.balance_minor > 0
  ) pp;

  -- The buyer: the billing address if it has a street line, else the shipping address, else only the name, the email and the market's country.
  v_billing := coalesce(o.billing_address, '{}'::jsonb);
  v_shipping_addr := coalesce(o.shipping_address, '{}'::jsonb);
  v_pick := CASE WHEN commerce.nz(v_billing ->> 'line1') IS NOT NULL THEN v_billing
                 WHEN commerce.nz(v_shipping_addr ->> 'line1') IS NOT NULL THEN v_shipping_addr END;
  v_complete := v_pick IS NOT NULL;
  v_b := jsonb_build_object(
    'type', CASE WHEN commerce.nz(o.company_name) IS NOT NULL THEN 'business' ELSE 'consumer' END,
    'name', coalesce(commerce.nz(v_pick ->> 'name'), commerce.nz(v_billing ->> 'name'), commerce.nz(v_shipping_addr ->> 'name')),
    'company', commerce.nz(o.company_name), 'organisationNumber', commerce.nz(o.organisation_number), 'vatNumber', v_buyer_vat,
    'address', CASE WHEN v_complete THEN jsonb_build_object(
        'line1', commerce.nz(v_pick ->> 'line1'), 'line2', commerce.nz(v_pick ->> 'line2'), 'postalCode', commerce.nz(v_pick ->> 'postalCode'),
        'city', commerce.nz(v_pick ->> 'city'), 'country', coalesce(commerce.nz(v_pick ->> 'country'), o.market_code::text))
      ELSE jsonb_build_object('line1', NULL::text, 'line2', NULL::text, 'postalCode', NULL::text, 'city', NULL::text,
        'country', coalesce(commerce.nz(v_billing ->> 'country'), commerce.nz(v_shipping_addr ->> 'country'), o.market_code::text)) END,
    'email', o.email, 'complete', v_complete);

  v_place := CASE WHEN v_physical AND (commerce.nz(v_shipping_addr ->> 'city') IS NOT NULL OR commerce.nz(v_shipping_addr ->> 'country') IS NOT NULL)
    THEN jsonb_build_object('city', commerce.nz(v_shipping_addr ->> 'city'), 'country', coalesce(commerce.nz(v_shipping_addr ->> 'country'), o.market_code::text)) END;

  SELECT coalesce(jsonb_agg(n ORDER BY ord), '[]'::jsonb) INTO v_notes FROM (VALUES
    (1, 'buyer_incomplete', NOT v_complete),
    (2, 'unit_price_rounded', v_rounded),
    (3, 'trial_deferred', jsonb_array_length(v_deferred) > 0)
  ) AS t(ord, n, cond) WHERE cond;

  RETURN jsonb_build_object(
    'version', 1, 'documentType', 'invoice', 'issuedOn', to_char(p_issued_on, 'YYYY-MM-DD'), 'supplyDate', to_char(p_supply_date, 'YYYY-MM-DD'),
    'locale', o.locale, 'language', commerce.doc_language(o.locale), 'currency', o.currency,
    'seller', jsonb_build_object(
      'legalName', commerce.nz(st.legal_name), 'organisationNumber', commerce.nz(st.organisation_number),
      'vatRegistered', CASE WHEN v_have THEN prof.vat_registered ELSE false END, 'vatNumber', v_seller_vat,
      'address', commerce.nz(st.postal_address), 'country', st.country, 'email', commerce.nz(st.contact_email),
      'footerNote', commerce.nz(cfg.footer_note)),
    'buyer', v_b,
    'order', jsonb_build_object(
      'number', o.number, 'placedOn', to_char(commerce.store_day(o.store_id, o.placed_at), 'YYYY-MM-DD'),
      'paidOn', to_char(p_supply_date, 'YYYY-MM-DD'), 'deliveryPlace', v_place),
    'lines', v_lines, 'shipping', v_ship, 'discounts', v_discounts, 'buckets', v_buckets,
    'totals', jsonb_build_object('netMinor', v_net, 'vatMinor', v_vat, 'grossMinor', v_gross),
    'vatHome', v_vat_home, 'vatMain', v_vat_main,
    'treatment', jsonb_build_object(
      'kind', o.vat_kind, 'reason', commerce.nz(o.vat_treatment ->> 'reason'), 'sellerVatNumber', v_seller_vat, 'buyerVatNumber', v_buyer_vat,
      'iossNumber', CASE WHEN o.vat_kind = 'ioss' THEN commerce.nz(o.vat_treatment ->> 'iossNumber') END, 'statements', v_statements),
    'payments', v_payments, 'deferred', v_deferred, 'notes', v_notes);
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Making the invoice. make_order_invoice() raises on any problem and is what tests call; issue_order_invoice() is what the
-- payment calls: it catches everything, so a failure rolls back only itself (the number comes back) and never stops the payment.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION commerce.make_order_invoice(p_store uuid, p_order uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  o commerce.orders%ROWTYPE;
  v_id uuid;
  v_paid timestamptz;
  v_issued date;
  v_supply date;
  v_snap jsonb;
  v_number bigint;
  v_prefix text;
  v_docno text;
  v_home jsonb;
BEGIN
  -- One at a time per order: the payment's own transaction already holds this lock.
  SELECT * INTO o FROM commerce.orders WHERE store_id = p_store AND id = p_order FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT i.id INTO v_id FROM commerce.invoices i WHERE i.store_id = p_store AND i.order_id = p_order;
  IF FOUND THEN RETURN v_id; END IF;
  IF commerce.invoice_eligibility(p_order) <> 'ok' OR commerce.invoice_readiness(p_order) <> 'ready' THEN RETURN NULL; END IF;

  SELECT min(e.created_at) INTO v_paid FROM commerce.order_events e WHERE e.store_id = p_store AND e.order_id = p_order AND e.type = 'order.paid';
  v_issued := commerce.store_day(p_store, now());
  v_supply := commerce.store_day(p_store, v_paid);
  v_snap := commerce.build_invoice_snapshot(p_order, v_issued, v_supply);

  -- The number last: the series' row lock is held from here to the end of the transaction.
  v_number := commerce.next_document_number(p_store, 'invoice');
  SELECT s.prefix INTO v_prefix FROM commerce.document_series s WHERE s.store_id = p_store AND s.series = 'invoice';
  v_docno := v_prefix || v_number::text;
  v_snap := jsonb_set(v_snap, '{number}', to_jsonb(v_docno));
  v_home := v_snap -> 'vatHome';

  PERFORM set_config('commerce.issuing_document', p_order::text, true);
  INSERT INTO commerce.invoices (
    store_id, order_id, series, number, document_number, currency, total_minor, tax_minor, net_minor, kind, issued_on, supply_date,
    locale, vat_kind, vat_home_currency, vat_home_minor, fx_rate, fx_as_of, fx_source, snapshot, public_token
  ) VALUES (
    p_store, p_order, 'invoice', v_number, v_docno, o.currency,
    (v_snap -> 'totals' ->> 'grossMinor')::bigint, (v_snap -> 'totals' ->> 'vatMinor')::bigint, (v_snap -> 'totals' ->> 'netMinor')::bigint,
    'order', v_issued, v_supply, o.locale, o.vat_kind,
    (v_home ->> 'currency'), (v_home ->> 'vatMinor')::bigint, (v_home ->> 'fxRate')::numeric, (v_home ->> 'asOf')::date, (v_home ->> 'source'),
    v_snap, commerce.new_document_token('inv_')
  ) RETURNING id INTO v_id;
  PERFORM set_config('commerce.issuing_document', '', true);

  INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
  VALUES (p_store, p_order, 'invoice.issued', jsonb_build_object('invoiceId', v_id, 'number', v_docno), 'system');
  RETURN v_id;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.issue_order_invoice(p_store uuid, p_order uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_id uuid;
BEGIN
  BEGIN
    v_id := commerce.make_order_invoice(p_store, p_order);
  EXCEPTION WHEN OTHERS THEN
    -- Everything the block wrote, the number it took included, is undone. The order waits and the job tries again; the error is
    -- written down at most once an hour so a failure that stays does not fill the order's history.
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM commerce.order_events e
         WHERE e.store_id = p_store AND e.order_id = p_order AND e.type = 'invoice.failed' AND e.created_at > now() - interval '1 hour'
      ) THEN
        INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
        VALUES (p_store, p_order, 'invoice.failed', jsonb_build_object('error', left(SQLERRM, 300)), 'system');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN NULL;
  END;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- Every path that pays an order ends in complete_order_payment(): the live definition, patched, issues the invoice last. The
-- call cannot stop the payment (issue_order_invoice() catches everything).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.complete_order_payment(uuid, text)'::regprocedure);
  IF position('issue_order_invoice' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'  RETURN true;\nEND;',
    $r$  -- The invoice (D159): numbered and frozen in this transaction; an invoice that cannot be made yet waits, and never stops the payment.
  PERFORM commerce.issue_order_invoice(v_order.store_id, p_order_id);
  RETURN true;
END;$r$
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'complete_order_payment: its last statement was not found, so no invoice is issued'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Credit notes (creditNoteSnapshot(), creditAllocation() and creditForReturn() are the oracle)
-- ---------------------------------------------------------------------------

-- The position (1-based) of the bucket with this rate and basis, or 0.
CREATE OR REPLACE FUNCTION commerce.bucket_index(p_rates numeric[], p_basis text[], p_rate numeric, p_b text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce((SELECT i FROM generate_subscripts(p_rates, 1) AS i WHERE p_rates[i] = p_rate AND p_basis[i] = p_b ORDER BY i LIMIT 1), 0)
$$;
--> statement-breakpoint

-- The VAT of a credit note's shares converted at the invoice's rate as the difference of cumulative conversions, bucket by bucket:
-- convert(VAT credited so far including this note) - convert(VAT credited before it). Converting each note's parts on their own would
-- round differently from the invoice, which converts each bucket whole, and the notes would not add up to it (creditVatConverted()).
-- p_buckets are the invoice's buckets, p_left the VAT each has left before this note and p_vat what this note credits, in the same order.
CREATE OR REPLACE FUNCTION commerce.credit_vat_converted(p_buckets jsonb, p_left bigint[], p_vat bigint[], p_fx numeric) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(sum(commerce.convert_with(z.before + p_vat[z.i], p_fx) - commerce.convert_with(z.before, p_fx)), 0)::bigint
    FROM (
      SELECT i, ((p_buckets -> (i - 1)) ->> 'vatMinor')::bigint - p_left[i] AS before
        FROM generate_series(1, coalesce(array_length(p_vat, 1), 0)) AS i
    ) z
$$;
--> statement-breakpoint

-- Whether a payment is one of those the invoice covers: made no later than the invoice, and not a fee charged on its own (a no-show fee,
-- which `booking.no_show` names). A refund of any other payment of the order reverses nothing the invoice states.
CREATE OR REPLACE FUNCTION commerce.payment_on_invoice(p_store uuid, p_payment uuid, p_issued_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce((
    SELECT p.created_at <= p_issued_at
       AND NOT EXISTS (SELECT 1 FROM commerce.order_events e
                        WHERE e.store_id = p.store_id AND e.order_id = p.order_id AND e.type = 'booking.no_show' AND e.data ->> 'payment' = p.id::text)
      FROM commerce.payments p WHERE p.store_id = p_store AND p.id = p_payment), true)
$$;
--> statement-breakpoint

-- A credit note for a refund that succeeded (p_refund), or for a return refunded outside Kaizen (p_return). Raises on any problem;
-- returns null when there is nothing to credit (no invoice yet, a copied or host order, nothing left on the invoice).
CREATE OR REPLACE FUNCTION commerce.make_credit_note(p_store uuid, p_refund uuid, p_return uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_refund commerce.refunds%ROWTYPE;
  v_ret commerce.returns%ROWTYPE;
  v_have_ret boolean := false;
  v_order commerce.orders%ROWTYPE;
  v_order_id uuid;
  v_inv commerce.invoices%ROWTYPE;
  v_source text;
  v_key uuid;
  v_amount bigint;
  v_working jsonb := NULL;
  v_return_number text := NULL;
  v_id uuid;
  v_n integer;
  v_k integer;
  v_rate numeric[];
  v_basis text[];
  v_net_left bigint[];
  v_vat_left bigint[];
  v_gross_left bigint[];
  v_room bigint;
  v_target bigint;
  v_short bigint;
  v_sums bigint[];
  v_clamp bigint[];
  v_final bigint[];
  v_head bigint[];
  v_inw bigint[];
  v_weights bigint[];
  v_shares bigint[];
  v_d bigint;
  v_rows jsonb := '[]'::jsonb;
  v_used boolean := false;
  v_ok boolean;
  v_w jsonb;
  v_line jsonb;
  v_ship jsonb;
  v_vat bigint[];
  v_buckets jsonb := '[]'::jsonb;
  v_net bigint := 0;
  v_vat_sum bigint := 0;
  v_gross bigint := 0;
  v_before bigint;
  v_number bigint;
  v_prefix text;
  v_docno text;
  v_today date;
  v_notes jsonb;
  v_vh jsonb;
  v_vm jsonb;
  v_vat_home jsonb := NULL;
  v_vat_main jsonb := NULL;
  v_snap jsonb;
  v_event_key text;
  v_is_return boolean;
  v_fx numeric;
BEGIN
  IF p_refund IS NOT NULL THEN
    SELECT * INTO v_refund FROM commerce.refunds WHERE store_id = p_store AND id = p_refund;
    IF NOT FOUND OR v_refund.status <> 'succeeded' THEN RETURN NULL; END IF;
    SELECT p.order_id INTO v_order_id FROM commerce.payments p WHERE p.store_id = p_store AND p.id = v_refund.payment_id;
    SELECT * INTO v_ret FROM commerce.returns WHERE store_id = p_store AND refund_id = p_refund;
    v_have_ret := FOUND;
    v_source := 'refund';
    v_key := p_refund;
    v_amount := v_refund.amount_minor;
    SELECT c.id INTO v_id FROM commerce.credit_notes c WHERE c.store_id = p_store AND c.refund_id = p_refund;
  ELSE
    SELECT * INTO v_ret FROM commerce.returns WHERE store_id = p_store AND id = p_return;
    IF NOT FOUND OR NOT v_ret.refund_outside OR coalesce(v_ret.refund_minor, 0) <= 0 OR v_ret.refund_id IS NOT NULL THEN RETURN NULL; END IF;
    v_have_ret := true;
    v_order_id := v_ret.order_id;
    v_source := 'return_outside';
    v_key := p_return;
    v_amount := v_ret.refund_minor;
    SELECT c.id INTO v_id FROM commerce.credit_notes c WHERE c.store_id = p_store AND c.return_id = p_return AND c.source = 'return_outside';
  END IF;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF v_have_ret THEN
    v_working := v_ret.refund_working;
    v_return_number := v_ret.number;
  END IF;
  v_is_return := v_have_ret;
  v_event_key := v_key::text;
  IF v_amount IS NULL OR v_amount <= 0 THEN RETURN NULL; END IF;

  SELECT * INTO v_order FROM commerce.orders WHERE store_id = p_store AND id = v_order_id;
  IF NOT FOUND OR v_order.copied_from IS NOT NULL OR v_order.host_id IS NOT NULL THEN RETURN NULL; END IF;
  -- One at a time per invoice: two refunds that succeed together cannot both take what is left.
  SELECT * INTO v_inv FROM commerce.invoices WHERE store_id = p_store AND order_id = v_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_refund IS NOT NULL THEN
    SELECT c.id INTO v_id FROM commerce.credit_notes c WHERE c.store_id = p_store AND c.refund_id = p_refund;
  ELSE
    SELECT c.id INTO v_id FROM commerce.credit_notes c WHERE c.store_id = p_store AND c.return_id = p_return AND c.source = 'return_outside';
  END IF;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  -- A refund of a payment that is not on the invoice (a no-show fee charged afterwards, D65) reverses no sale: no credit note, and the order says so.
  IF p_refund IS NOT NULL AND NOT commerce.payment_on_invoice(p_store, v_refund.payment_id, v_inv.issued_at) THEN
    IF NOT EXISTS (SELECT 1 FROM commerce.order_events e WHERE e.store_id = p_store AND e.order_id = v_order_id AND e.type = 'credit_note.not_invoiced' AND e.data ->> 'key' = v_event_key) THEN
      INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
      VALUES (p_store, v_order_id, 'credit_note.not_invoiced', jsonb_build_object('key', v_event_key, 'amountMinor', v_amount, 'paymentId', v_refund.payment_id), 'system');
    END IF;
    RETURN NULL;
  END IF;

  -- What each bucket of the invoice has left after its credit notes so far.
  SELECT array_agg(inv.rate ORDER BY inv.ord), array_agg(inv.basis ORDER BY inv.ord),
         array_agg(greatest(0, inv.net - coalesce(pr.net, 0)) ORDER BY inv.ord),
         array_agg(greatest(0, inv.vat - coalesce(pr.vat, 0)) ORDER BY inv.ord),
         array_agg(greatest(0, inv.gross - coalesce(pr.gross, 0)) ORDER BY inv.ord)
    INTO v_rate, v_basis, v_net_left, v_vat_left, v_gross_left
    FROM (
      SELECT t.ord, (t.b ->> 'rate')::numeric AS rate, t.b ->> 'basis' AS basis, (t.b ->> 'netMinor')::bigint AS net,
             (t.b ->> 'vatMinor')::bigint AS vat, (t.b ->> 'grossMinor')::bigint AS gross
        FROM jsonb_array_elements(v_inv.snapshot -> 'buckets') WITH ORDINALITY AS t(b, ord)
    ) inv
    LEFT JOIN (
      SELECT (b ->> 'rate')::numeric AS rate, b ->> 'basis' AS basis, sum((b ->> 'netMinor')::bigint) AS net,
             sum((b ->> 'vatMinor')::bigint) AS vat, sum((b ->> 'grossMinor')::bigint) AS gross
        FROM commerce.credit_notes c, jsonb_array_elements(c.snapshot -> 'buckets') AS b
       WHERE c.store_id = p_store AND c.invoice_id = v_inv.id
       GROUP BY 1, 2
    ) pr ON pr.rate = inv.rate AND pr.basis = inv.basis;
  v_n := coalesce(array_length(v_rate, 1), 0);
  v_room := coalesce((SELECT sum(g) FROM unnest(v_gross_left) AS t(g)), 0);
  v_target := least(v_amount, v_room);
  v_short := v_amount - v_target;
  IF v_n = 0 OR v_target <= 0 THEN
    IF NOT EXISTS (SELECT 1 FROM commerce.order_events e WHERE e.store_id = p_store AND e.order_id = v_order_id AND e.type = 'credit_note.short' AND e.data ->> 'key' = v_event_key) THEN
      INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
      VALUES (p_store, v_order_id, 'credit_note.short', jsonb_build_object('key', v_event_key, 'amountMinor', v_amount, 'creditedMinor', 0, 'shortMinor', v_amount), 'system');
    END IF;
    RETURN NULL;
  END IF;

  -- A return's working is used when it fits the invoice and the amount refunded; else the amount is shared as a plain refund.
  v_ok := v_working IS NOT NULL AND jsonb_typeof(v_working) = 'object' AND jsonb_typeof(v_working -> 'lines') = 'array'
          AND (v_working ->> 'amountMinor')::bigint IS NOT DISTINCT FROM v_amount;
  IF v_ok THEN
    v_sums := array_fill(0::bigint, ARRAY[v_n]);
    v_rows := '[]'::jsonb;
    FOR v_w IN SELECT x FROM jsonb_array_elements(v_working -> 'lines') AS x LOOP
      SELECT l INTO v_line FROM jsonb_array_elements(v_inv.snapshot -> 'lines') AS l WHERE l ->> 'lineId' = v_w ->> 'lineId' LIMIT 1;
      IF v_line IS NULL THEN v_ok := false; EXIT; END IF;
      v_k := commerce.bucket_index(v_rate, v_basis, (v_line ->> 'vatRate')::numeric, v_line ->> 'basis');
      IF v_k = 0 THEN v_ok := false; EXIT; END IF;
      IF (v_w ->> 'valueMinor')::bigint > 0 THEN
        v_sums[v_k] := v_sums[v_k] + (v_w ->> 'valueMinor')::bigint;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'kind', 'goods', 'lineId', v_line ->> 'lineId', 'sku', v_line ->> 'sku', 'title', v_line ->> 'title', 'quantity', (v_w ->> 'quantity')::int,
          'vatRate', (v_line ->> 'vatRate')::numeric, 'basis', v_line ->> 'basis', 'grossMinor', (v_w ->> 'valueMinor')::bigint,
          'netMinor', NULL::bigint, 'vatMinor', NULL::bigint));
      END IF;
      IF (v_w ->> 'deductionMinor')::bigint > 0 THEN
        v_sums[v_k] := v_sums[v_k] - (v_w ->> 'deductionMinor')::bigint;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'kind', 'deduction', 'lineId', v_line ->> 'lineId', 'sku', v_line ->> 'sku', 'title', v_line ->> 'title', 'quantity', NULL::int,
          'vatRate', (v_line ->> 'vatRate')::numeric, 'basis', v_line ->> 'basis', 'grossMinor', -(v_w ->> 'deductionMinor')::bigint,
          'netMinor', NULL::bigint, 'vatMinor', NULL::bigint));
      END IF;
    END LOOP;
    IF v_ok AND ((v_working ->> 'deliveryMinor')::bigint > 0 OR (v_working ->> 'returnShippingMinor')::bigint > 0) THEN
      v_ship := v_inv.snapshot -> 'shipping';
      IF v_ship IS NULL OR jsonb_typeof(v_ship) <> 'object' THEN
        v_ok := false;
      ELSE
        v_k := commerce.bucket_index(v_rate, v_basis, (v_ship ->> 'vatRate')::numeric, v_ship ->> 'basis');
        IF v_k = 0 THEN
          v_ok := false;
        ELSE
          IF (v_working ->> 'deliveryMinor')::bigint > 0 THEN
            v_sums[v_k] := v_sums[v_k] + (v_working ->> 'deliveryMinor')::bigint;
            v_rows := v_rows || jsonb_build_array(jsonb_build_object(
              'kind', 'delivery', 'lineId', NULL::text, 'sku', NULL::text, 'title', v_ship ->> 'label', 'quantity', NULL::int,
              'vatRate', (v_ship ->> 'vatRate')::numeric, 'basis', v_ship ->> 'basis', 'grossMinor', (v_working ->> 'deliveryMinor')::bigint,
              'netMinor', NULL::bigint, 'vatMinor', NULL::bigint));
          END IF;
          IF (v_working ->> 'returnShippingMinor')::bigint > 0 THEN
            v_sums[v_k] := v_sums[v_k] - (v_working ->> 'returnShippingMinor')::bigint;
            v_rows := v_rows || jsonb_build_array(jsonb_build_object(
              'kind', 'return_shipping', 'lineId', NULL::text, 'sku', NULL::text, 'title', NULL::text, 'quantity', NULL::int,
              'vatRate', (v_ship ->> 'vatRate')::numeric, 'basis', v_ship ->> 'basis', 'grossMinor', -(v_working ->> 'returnShippingMinor')::bigint,
              'netMinor', NULL::bigint, 'vatMinor', NULL::bigint));
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_ok THEN
    v_used := true;
    v_clamp := ARRAY(SELECT greatest(0, least(v_sums[i], v_gross_left[i])) FROM generate_subscripts(v_sums, 1) AS i ORDER BY i);
    v_d := v_target - (SELECT sum(c) FROM unnest(v_clamp) AS t(c));
    v_final := v_clamp;
    IF v_d > 0 THEN
      v_head := ARRAY(SELECT v_gross_left[i] - v_clamp[i] FROM generate_subscripts(v_clamp, 1) AS i ORDER BY i);
      v_inw := ARRAY(SELECT CASE WHEN v_clamp[i] > 0 THEN v_head[i] ELSE 0 END FROM generate_subscripts(v_clamp, 1) AS i ORDER BY i);
      v_weights := CASE WHEN (SELECT sum(w) FROM unnest(v_inw) AS t(w)) >= v_d THEN v_inw ELSE v_head END;
      v_shares := commerce.distribute_minor(v_d, v_weights, v_rate);
      v_final := ARRAY(SELECT v_final[i] + v_shares[i] FROM generate_subscripts(v_final, 1) AS i ORDER BY i);
    ELSIF v_d < 0 THEN
      v_shares := commerce.distribute_minor(-v_d, v_clamp, v_rate);
      v_final := ARRAY(SELECT v_final[i] - v_shares[i] FROM generate_subscripts(v_final, 1) AS i ORDER BY i);
    END IF;
  ELSE
    v_used := false;
    v_final := commerce.distribute_minor(v_target, v_gross_left, v_rate);
  END IF;

  -- Net, VAT and gross per bucket.
  v_vat := ARRAY(SELECT commerce.credit_vat(v_final[i], v_rate[i], v_gross_left[i], v_net_left[i], v_vat_left[i]) FROM generate_subscripts(v_final, 1) AS i ORDER BY i);
  IF NOT v_used THEN
    v_rows := '[]'::jsonb;
    FOR v_k IN 1..v_n LOOP
      IF v_final[v_k] > 0 THEN
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'kind', 'refund', 'lineId', NULL::text, 'sku', NULL::text, 'title', NULL::text, 'quantity', NULL::int,
          'vatRate', v_rate[v_k], 'basis', v_basis[v_k], 'grossMinor', v_final[v_k],
          'netMinor', v_final[v_k] - v_vat[v_k], 'vatMinor', v_vat[v_k]));
      END IF;
    END LOOP;
  ELSE
    -- What the working did not fit into the buckets (a staff adjustment, a return shipping larger than the delivery given back) is shown as adjustment rows.
    FOR v_k IN 1..v_n LOOP
      IF v_final[v_k] - v_sums[v_k] <> 0 THEN
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'kind', 'adjustment', 'lineId', NULL::text, 'sku', NULL::text, 'title', NULL::text, 'quantity', NULL::int,
          'vatRate', v_rate[v_k], 'basis', v_basis[v_k], 'grossMinor', v_final[v_k] - v_sums[v_k],
          'netMinor', NULL::bigint, 'vatMinor', NULL::bigint));
      END IF;
    END LOOP;
  END IF;
  FOR v_k IN 1..v_n LOOP
    IF v_final[v_k] > 0 THEN
      v_buckets := v_buckets || jsonb_build_array(jsonb_build_object(
        'rate', v_rate[v_k], 'basis', v_basis[v_k], 'netMinor', v_final[v_k] - v_vat[v_k], 'vatMinor', v_vat[v_k], 'grossMinor', v_final[v_k]));
      v_net := v_net + v_final[v_k] - v_vat[v_k];
      v_vat_sum := v_vat_sum + v_vat[v_k];
      v_gross := v_gross + v_final[v_k];
    END IF;
  END LOOP;
  IF v_gross <= 0 THEN RETURN NULL; END IF;

  SELECT coalesce(sum(c.total_minor), 0) INTO v_before FROM commerce.credit_notes c WHERE c.store_id = p_store AND c.invoice_id = v_inv.id;
  SELECT coalesce(jsonb_agg(n ORDER BY ord), '[]'::jsonb) INTO v_notes FROM (VALUES
    (1, 'credit_capped', v_short > 0),
    (2, 'working_not_used', v_working IS NOT NULL AND NOT v_used)
  ) AS t(ord, n, cond) WHERE cond;

  -- The VAT in the seller's currency and in the main currency, at the invoice's rate (a credit note reduces the VAT of the same supply), as
  -- the difference of the cumulative conversions per bucket, so the credit notes of an invoice add up to the invoice's own converted VAT.
  v_vh := v_inv.snapshot -> 'vatHome';
  IF v_vh IS NOT NULL AND jsonb_typeof(v_vh) = 'object' THEN
    v_fx := (v_vh ->> 'fxRate')::numeric;
    v_vat_home := v_vh || jsonb_build_object('vatMinor', commerce.credit_vat_converted(v_inv.snapshot -> 'buckets', v_vat_left, v_vat, v_fx));
  END IF;
  v_vm := v_inv.snapshot -> 'vatMain';
  IF v_vm IS NOT NULL AND jsonb_typeof(v_vm) = 'object' THEN
    IF jsonb_typeof(v_vm -> 'fxRate') = 'number' THEN
      v_fx := (v_vm ->> 'fxRate')::numeric;
      v_vat_main := v_vm || jsonb_build_object('vatMinor', commerce.credit_vat_converted(v_inv.snapshot -> 'buckets', v_vat_left, v_vat, v_fx));
    ELSE
      v_vat_main := v_vm || jsonb_build_object('vatMinor', v_vat_sum);
    END IF;
  END IF;

  v_today := commerce.store_day(p_store, now());
  -- The number last: the series' row lock is held from here to the end of the transaction.
  v_number := commerce.next_document_number(p_store, 'credit_note');
  SELECT s.prefix INTO v_prefix FROM commerce.document_series s WHERE s.store_id = p_store AND s.series = 'credit_note';
  v_docno := v_prefix || v_number::text;

  v_snap := jsonb_build_object(
    'version', 1, 'documentType', 'credit_note', 'number', v_docno, 'issuedOn', to_char(v_today, 'YYYY-MM-DD'),
    'locale', v_inv.snapshot -> 'locale', 'language', v_inv.snapshot -> 'language', 'currency', v_inv.snapshot -> 'currency',
    'seller', v_inv.snapshot -> 'seller', 'buyer', v_inv.snapshot -> 'buyer', 'order', v_inv.snapshot -> 'order',
    'refersTo', jsonb_build_object('invoiceId', v_inv.id, 'invoiceNumber', v_inv.snapshot ->> 'number', 'invoiceIssuedOn', v_inv.snapshot ->> 'issuedOn'),
    'reason', jsonb_build_object('kind', CASE WHEN v_is_return THEN 'return' ELSE 'refund' END, 'returnNumber', v_return_number),
    'source', v_source, 'lines', v_rows, 'buckets', v_buckets,
    'totals', jsonb_build_object('netMinor', v_net, 'vatMinor', v_vat_sum, 'grossMinor', v_gross),
    'vatHome', v_vat_home, 'vatMain', v_vat_main, 'treatment', v_inv.snapshot -> 'treatment',
    'position', jsonb_build_object(
      'invoiceTotalMinor', (v_inv.snapshot -> 'totals' ->> 'grossMinor')::bigint, 'creditedBeforeMinor', v_before,
      'creditedNowMinor', v_gross, 'leftOnInvoiceMinor', (v_inv.snapshot -> 'totals' ->> 'grossMinor')::bigint - v_before - v_gross),
    'notes', v_notes);

  PERFORM set_config('commerce.issuing_document', v_key::text, true);
  INSERT INTO commerce.credit_notes (
    store_id, invoice_id, refund_id, return_id, series, number, document_number, currency, total_minor, tax_minor, net_minor,
    source, issued_on, locale, vat_home_currency, vat_home_minor, fx_rate, fx_as_of, fx_source, snapshot, public_token
  ) VALUES (
    p_store, v_inv.id, p_refund, CASE WHEN p_refund IS NULL THEN p_return END, 'credit_note', v_number, v_docno, v_inv.currency, v_gross, v_vat_sum, v_net,
    v_source, v_today, v_inv.locale,
    v_vat_home ->> 'currency', (v_vat_home ->> 'vatMinor')::bigint, v_inv.fx_rate, v_inv.fx_as_of, v_inv.fx_source,
    v_snap, commerce.new_document_token('crn_')
  ) RETURNING id INTO v_id;
  PERFORM set_config('commerce.issuing_document', '', true);

  INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
  VALUES (p_store, v_order_id, 'credit_note.issued',
          jsonb_build_object('creditNoteId', v_id, 'number', v_docno, 'key', v_event_key, 'amountMinor', v_gross), 'system');
  IF v_short > 0 THEN
    INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
    VALUES (p_store, v_order_id, 'credit_note.short', jsonb_build_object('key', v_event_key, 'amountMinor', v_amount, 'creditedMinor', v_gross, 'shortMinor', v_short), 'system');
  END IF;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- What the refund and return triggers and the job call: everything is caught, so a credit note never stops a refund.
CREATE OR REPLACE FUNCTION commerce.issue_credit_note(p_store uuid, p_refund uuid, p_return uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_order uuid;
BEGIN
  BEGIN
    v_id := commerce.make_credit_note(p_store, p_refund, p_return);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      IF p_refund IS NOT NULL THEN
        SELECT p.order_id INTO v_order FROM commerce.refunds r JOIN commerce.payments p ON p.store_id = r.store_id AND p.id = r.payment_id
         WHERE r.store_id = p_store AND r.id = p_refund;
      ELSE
        SELECT r.order_id INTO v_order FROM commerce.returns r WHERE r.store_id = p_store AND r.id = p_return;
      END IF;
      IF v_order IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM commerce.order_events e
         WHERE e.store_id = p_store AND e.order_id = v_order AND e.type = 'credit_note.failed'
           AND e.data ->> 'key' = coalesce(p_refund, p_return)::text AND e.created_at > now() - interval '1 hour'
      ) THEN
        INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
        VALUES (p_store, v_order, 'credit_note.failed', jsonb_build_object('key', coalesce(p_refund, p_return), 'error', left(SQLERRM, 300)), 'system');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN NULL;
  END;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- Deferred to commit, so the caller has written everything else in its transaction first (a return's refund_id and working are written
-- after the refund row). Any code, present or future, that makes a refund succeed gets a credit note without a call.
CREATE OR REPLACE FUNCTION commerce.refunds_issue_credit_note() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM commerce.issue_credit_note(NEW.store_id, NEW.id, NULL);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refunds_credit_note AFTER INSERT OR UPDATE OF status ON commerce.refunds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.status = 'succeeded')
  EXECUTE FUNCTION commerce.refunds_issue_credit_note();
--> statement-breakpoint

-- A return refunded outside Kaizen's Stripe (an order paid some other way) has no refund row: the credit note comes from the return.
CREATE OR REPLACE FUNCTION commerce.returns_issue_credit_note() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM commerce.issue_credit_note(NEW.store_id, NULL, NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER returns_credit_note AFTER INSERT OR UPDATE OF refund_minor, refund_outside, refund_working ON commerce.returns
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.refund_outside AND NEW.refund_id IS NULL AND NEW.refund_minor > 0)
  EXECUTE FUNCTION commerce.returns_issue_credit_note();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The queue: orders waiting for an invoice, and refunds still without a credit note (the five-minute job and the admin's Waiting tab)
-- ---------------------------------------------------------------------------

-- Eligible orders that have no invoice, with the reason in the closed list of invoiceReadiness (or invoice_failed when nothing is in the way).
CREATE OR REPLACE FUNCTION commerce.waiting_invoices(p_store uuid)
RETURNS TABLE (order_id uuid, order_number text, paid_at timestamptz, reason text, vat_kind text, total_minor bigint, currency text)
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.number, pe.paid_at,
         CASE WHEN commerce.invoice_readiness(o.id) = 'ready' THEN 'invoice_failed' ELSE commerce.invoice_readiness(o.id) END,
         o.vat_kind, o.total_minor, o.currency::text
    FROM commerce.orders o
    CROSS JOIN LATERAL (
      SELECT min(e.created_at) AS paid_at FROM commerce.order_events e WHERE e.store_id = o.store_id AND e.order_id = o.id AND e.type = 'order.paid'
    ) pe
   WHERE o.store_id = p_store AND o.copied_from IS NULL AND o.host_id IS NULL AND pe.paid_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM commerce.invoices i WHERE i.store_id = o.store_id AND i.order_id = o.id)
     AND commerce.invoice_eligibility(o.id) = 'ok'
   ORDER BY pe.paid_at, o.id;
END;
$$;
--> statement-breakpoint

-- Credit notes for refunds that succeeded before their invoice existed (or whose note failed), in the order the refunds were made.
CREATE OR REPLACE FUNCTION commerce.issue_missing_credit_notes(p_store uuid) RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT x.refund_id, x.return_id FROM (
      SELECT rf.id AS refund_id, NULL::uuid AS return_id, rf.created_at AS at
        FROM commerce.refunds rf
        JOIN commerce.payments p ON p.store_id = rf.store_id AND p.id = rf.payment_id
        JOIN commerce.invoices i ON i.store_id = rf.store_id AND i.order_id = p.order_id
       WHERE rf.store_id = p_store AND rf.status = 'succeeded'
         AND NOT EXISTS (SELECT 1 FROM commerce.credit_notes c WHERE c.store_id = rf.store_id AND c.refund_id = rf.id)
         AND NOT EXISTS (SELECT 1 FROM commerce.order_events e WHERE e.store_id = rf.store_id AND e.order_id = p.order_id AND e.type IN ('credit_note.short', 'credit_note.not_invoiced') AND e.data ->> 'key' = rf.id::text)
      UNION ALL
      SELECT NULL::uuid, rt.id, coalesce(rt.refunded_at, rt.created_at)
        FROM commerce.returns rt
        JOIN commerce.invoices i ON i.store_id = rt.store_id AND i.order_id = rt.order_id
       WHERE rt.store_id = p_store AND rt.refund_outside AND rt.refund_id IS NULL AND coalesce(rt.refund_minor, 0) > 0
         AND NOT EXISTS (SELECT 1 FROM commerce.credit_notes c WHERE c.store_id = rt.store_id AND c.return_id = rt.id AND c.source = 'return_outside')
         AND NOT EXISTS (SELECT 1 FROM commerce.order_events e WHERE e.store_id = rt.store_id AND e.order_id = rt.order_id AND e.type = 'credit_note.short' AND e.data ->> 'key' = rt.id::text)
    ) x ORDER BY x.at, x.refund_id, x.return_id
  LOOP
    IF commerce.issue_credit_note(p_store, r.refund_id, r.return_id) IS NOT NULL THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END;
$$;
--> statement-breakpoint

-- The job: issue what was waiting (up to p_limit orders), then the credit notes that were waiting for an invoice. Returns the invoices issued.
CREATE OR REPLACE FUNCTION commerce.issue_waiting_invoices(p_store uuid, p_limit integer DEFAULT 200) RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT w.order_id FROM commerce.waiting_invoices(p_store) w WHERE w.reason = 'invoice_failed' LIMIT greatest(p_limit, 0)
  LOOP
    IF commerce.issue_order_invoice(p_store, r.order_id) IS NOT NULL THEN v_n := v_n + 1; END IF;
  END LOOP;
  PERFORM commerce.issue_missing_credit_notes(p_store);
  RETURN v_n;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Numbers: the audit (like order_number_audit)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION commerce.document_audit(p_store uuid)
RETURNS TABLE (series text, documents bigint, first_number bigint, last_number bigint, missing bigint, first_missing bigint, off_format bigint, next_number bigint, ok boolean)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH s AS (
    SELECT ds.series, ds.prefix, ds.next_number FROM commerce.document_series ds WHERE ds.store_id = p_store AND ds.series IN ('invoice', 'credit_note')
  ), d AS (
    SELECT 'invoice'::text AS series, i.number, i.document_number FROM commerce.invoices i WHERE i.store_id = p_store
    UNION ALL
    SELECT 'credit_note', c.number, c.document_number FROM commerce.credit_notes c WHERE c.store_id = p_store
  ), ends AS (
    SELECT d.series, min(d.number) AS lo, max(d.number) AS hi, count(*) AS c, count(DISTINCT d.number) AS cd FROM d GROUP BY d.series
  ), steps AS (
    SELECT x.series, x.number, lag(x.number) OVER (PARTITION BY x.series ORDER BY x.number) AS before
      FROM (SELECT DISTINCT d.series, d.number FROM d) x
  )
  SELECT s.series, coalesce(e.c, 0)::bigint, e.lo, e.hi,
         coalesce(e.hi - e.lo + 1 - e.cd, 0)::bigint,
         (SELECT min(st.before + 1) FROM steps st WHERE st.series = s.series AND st.before IS NOT NULL AND st.number > st.before + 1),
         (SELECT count(*) FROM d WHERE d.series = s.series AND d.document_number <> s.prefix || d.number::text),
         s.next_number,
         coalesce(e.hi - e.lo + 1 = e.cd, true) AND (e.hi IS NULL OR s.next_number = e.hi + 1)
    FROM s LEFT JOIN ends e ON e.series = s.series
   ORDER BY s.series
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Retention (unit 1g's hook): the personal data of a document past its period is replaced by a marker; numbers, dates, amounts, buckets
-- and the seller stay. Refuses a cutoff younger than five years (the shortest period of the four countries read: a floor under a wrong
-- rule). No DELETE: the stored PDFs of the rows it changed are removed by the application (storage cannot be SQL).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION commerce.anonymised_snapshot(p_snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v jsonb := p_snapshot;
  k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['name', 'company', 'organisationNumber', 'vatNumber', 'email'] LOOP
    IF jsonb_typeof(v -> 'buyer' -> k) = 'string' THEN v := jsonb_set(v, ARRAY['buyer', k], '"[removed]"'); END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['line1', 'line2', 'postalCode', 'city', 'country'] LOOP
    IF jsonb_typeof(v -> 'buyer' -> 'address' -> k) = 'string' THEN v := jsonb_set(v, ARRAY['buyer', 'address', k], '"[removed]"'); END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['city', 'country'] LOOP
    IF jsonb_typeof(v -> 'order' -> 'deliveryPlace' -> k) = 'string' THEN v := jsonb_set(v, ARRAY['order', 'deliveryPlace', k], '"[removed]"'); END IF;
  END LOOP;
  IF jsonb_typeof(v -> 'treatment' -> 'buyerVatNumber') = 'string' THEN v := jsonb_set(v, ARRAY['treatment', 'buyerVatNumber'], '"[removed]"'); END IF;
  RETURN v;
END;
$$;
--> statement-breakpoint

-- The stored PDFs of documents that anonymise_expired_documents() would change, so the application can remove them afterwards.
CREATE OR REPLACE FUNCTION commerce.expired_document_files(p_store uuid, p_before date)
RETURNS TABLE (document_type text, document_id uuid, pdf_path text)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT 'invoice'::text, i.id, i.pdf_path FROM commerce.invoices i
   WHERE i.store_id = p_store AND i.issued_on < p_before AND i.anonymised_at IS NULL AND i.pdf_path IS NOT NULL
  UNION ALL
  SELECT 'credit_note'::text, c.id, c.pdf_path FROM commerce.credit_notes c
   WHERE c.store_id = p_store AND c.issued_on < p_before AND c.anonymised_at IS NULL AND c.pdf_path IS NOT NULL
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.anonymise_expired_documents(p_store uuid, p_before date) RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_n integer := 0;
  v_m integer;
BEGIN
  IF p_before IS NULL OR p_before > (current_date - interval '5 years')::date THEN
    RAISE EXCEPTION 'document.cutoff_too_young: documents are kept at least five years, so the cutoff cannot be after %', (current_date - interval '5 years')::date
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('commerce.anonymising', 'on', true);
  INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
  SELECT i.store_id, i.order_id, 'document.anonymised', jsonb_build_object('document', i.document_number), 'system'
    FROM commerce.invoices i WHERE i.store_id = p_store AND i.issued_on < p_before AND i.anonymised_at IS NULL;
  UPDATE commerce.invoices SET snapshot = commerce.anonymised_snapshot(snapshot), anonymised_at = now(), public_token = NULL, pdf_path = NULL, pdf_sha256 = NULL
   WHERE store_id = p_store AND issued_on < p_before AND anonymised_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
  SELECT c.store_id, i.order_id, 'document.anonymised', jsonb_build_object('document', c.document_number), 'system'
    FROM commerce.credit_notes c JOIN commerce.invoices i ON i.store_id = c.store_id AND i.id = c.invoice_id
   WHERE c.store_id = p_store AND c.issued_on < p_before AND c.anonymised_at IS NULL;
  UPDATE commerce.credit_notes SET snapshot = commerce.anonymised_snapshot(snapshot), anonymised_at = now(), public_token = NULL, pdf_path = NULL, pdf_sha256 = NULL
   WHERE store_id = p_store AND issued_on < p_before AND anonymised_at IS NULL;
  GET DIAGNOSTICS v_m = ROW_COUNT;
  PERFORM set_config('commerce.anonymising', '', true);
  RETURN v_n + v_m;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Copying a store: the footer note and the confirmation switch go with a duplicate (it starts enabled with no start date); a clone of
-- the template copies nothing (a row is made on first save). Documents, series and tokens are never copied (COPY_RULES: never).
-- The live definition is patched, one statement added before its last line.
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('commerce.invoice_settings' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'  RETURN v_store;\nEND;',
    $r$  -- The note printed on invoices and the confirmation switch (D159); the invoice and credit note numbers start again.
  INSERT INTO commerce.invoice_settings (store_id, enabled, footer_note, email_with_confirmation, updated_by)
  SELECT v_store, true, footer_note, email_with_confirmation, p_owner
    FROM commerce.invoice_settings WHERE store_id = p_source;

  RETURN v_store;
END;$r$
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: its last statement was not found, so the invoicing settings are not copied'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- The plan comparison (D132) learns the feature; it describes and enables nothing.
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT 'Checkout and selling', 'Invoices and credit notes for orders',
       'A legal invoice for every paid order in the store''s own numbered series, a credit note for every refund and return, VAT per rate with reverse charge and IOSS stated, a PDF for the shopper and for the accountant, and a CSV export.', 218
 WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features f WHERE f.name = 'Invoices and credit notes for orders');
