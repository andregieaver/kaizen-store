-- Sequential order numbering (required by law in some countries): every store numbers its orders 1001, 1002, … in one
-- series, without gaps. `next_document_number()` already gives a number inside the transaction that inserts the order, and a
-- rolled-back transaction gives its number back. This makes the rest hold too: a number, once issued, is never renumbered,
-- reused, skipped or deleted, and anyone can check a store's sequence.

-- The order, invoice and credit note series: once a document has been issued in one, its prefix stays, its next number moves
-- one at a time (only `next_document_number()` does that), and it is not deleted while its store exists.
CREATE FUNCTION commerce.sales_series_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_issued boolean;
BEGIN
  IF OLD.series NOT IN ('order', 'invoice', 'credit_note') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_issued := CASE OLD.series
    WHEN 'order' THEN EXISTS (SELECT 1 FROM commerce.orders o WHERE o.store_id = OLD.store_id AND o.copied_from IS NULL)
    WHEN 'invoice' THEN EXISTS (SELECT 1 FROM commerce.invoices i WHERE i.store_id = OLD.store_id)
    ELSE EXISTS (SELECT 1 FROM commerce.credit_notes c WHERE c.store_id = OLD.store_id)
  END;
  IF TG_OP = 'DELETE' THEN
    IF v_issued AND EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = OLD.store_id) THEN
      RAISE EXCEPTION 'document_series.issued: the % series has issued numbers and cannot be removed', OLD.series USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.series <> OLD.series OR NEW.store_id <> OLD.store_id THEN
    RAISE EXCEPTION 'document_series.moved: a document series cannot be renamed or moved' USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_issued AND NEW.prefix IS DISTINCT FROM OLD.prefix THEN
    RAISE EXCEPTION 'document_series.prefix: the prefix of the % series cannot change once numbers are issued', OLD.series USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_issued AND NEW.next_number <> OLD.next_number AND NEW.next_number <> OLD.next_number + 1 THEN
    RAISE EXCEPTION 'document_series.sequence: numbers in the % series go up one at a time, with no gaps and no reuse', OLD.series USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER document_series_sales_guard
  BEFORE UPDATE OR DELETE ON commerce.document_series
  FOR EACH ROW EXECUTE FUNCTION commerce.sales_series_guard();
--> statement-breakpoint

-- An order keeps its number, and is never deleted while its store exists (a cancelled order stays, cancelled). Orders copied
-- from another store (D129) keep their own rules.
CREATE FUNCTION commerce.order_number_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.copied_from IS NULL AND EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = OLD.store_id) THEN
      RAISE EXCEPTION 'order_number.deleted: order % cannot be deleted: its number would leave a gap', OLD.number USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.copied_from IS NULL AND (NEW.number IS DISTINCT FROM OLD.number OR NEW.store_id IS DISTINCT FROM OLD.store_id) THEN
    RAISE EXCEPTION 'order_number.changed: order % keeps its number', OLD.number USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER orders_number_guard
  BEFORE UPDATE OF number, store_id OR DELETE ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.order_number_guard();
--> statement-breakpoint

-- Whether a store's order numbers are one unbroken sequence: how many orders it has (not counting history copied from another
-- store), the first and last number, how many numbers are missing between them, the first missing one, how many numbers do
-- not look like the series' (prefix and digits), and whether the series' next number is the one after the last. `ok` is all of that.
CREATE FUNCTION commerce.order_number_audit(p_store uuid)
RETURNS TABLE (orders bigint, first_number bigint, last_number bigint, missing bigint, first_missing bigint, off_format bigint, next_number bigint, ok boolean)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_prefix text;
  v_next bigint;
BEGIN
  SELECT s.prefix, s.next_number INTO v_prefix, v_next
    FROM commerce.document_series s WHERE s.store_id = p_store AND s.series = 'order';
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::bigint, NULL::bigint, NULL::bigint, 0::bigint, NULL::bigint, 0::bigint, NULL::bigint, false;
    RETURN;
  END IF;
  RETURN QUERY
  WITH mine AS (
    SELECT o.number FROM commerce.orders o WHERE o.store_id = p_store AND o.copied_from IS NULL
  ),
  numbered AS (
    SELECT substr(m.number, length(v_prefix) + 1)::bigint AS n
      FROM mine m
     WHERE left(m.number, length(v_prefix)) = v_prefix AND substr(m.number, length(v_prefix) + 1) ~ '^[0-9]{1,15}$'
  ),
  ends AS (SELECT min(n) AS lo, max(n) AS hi, count(*) AS c FROM numbered),
  -- Gaps are found from the numbers' neighbours, so a wild number never makes this walk through every value between.
  steps AS (SELECT n, lag(n) OVER (ORDER BY n) AS before FROM (SELECT DISTINCT n FROM numbered) d)
  SELECT (SELECT count(*) FROM mine),
         e.lo, e.hi,
         COALESCE(e.hi - e.lo + 1 - (SELECT count(DISTINCT n) FROM numbered), 0),
         (SELECT min(st.before + 1) FROM steps st WHERE st.before IS NOT NULL AND st.n > st.before + 1),
         (SELECT count(*) FROM mine) - e.c,
         v_next,
         COALESCE(e.hi - e.lo + 1 = (SELECT count(DISTINCT n) FROM numbered), true)
           AND (SELECT count(*) FROM mine) = e.c AND (e.hi IS NULL OR v_next = e.hi + 1)
    FROM ends e;
END;
$$;
