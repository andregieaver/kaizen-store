-- Our own ledger (B2 of docs/own-books-and-sales.md, D478): the rules the database keeps.
--   Row-level security on every table, as every commerce table.
--   Entries, their lines and the counters are written only by commerce.ledger_post(), which sets kaizen.ledger_posting for the moment it
--   writes: under the book's row lock, an entry is balanced to the øre, of two lines or more on active accounts of its own book, dated
--   within the book's days and after its lock, numbered in its series and year without gaps, and posted once for what it was posted from
--   (a document posted again returns the entry it has, unless that was reversed).
--   An entry and its lines are never changed or deleted: a mistake is put right by a reversing entry (commerce.ledger_reverse()), one for each
--   entry, and a reversal is not itself reversed.
--   A book keeps its store, country, currency and opening day; it closes once, never before an entry it holds; it is never deleted. An
--   account keeps its book and number, and its kind once it has lines.

ALTER TABLE "commerce"."ledger_books" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."ledger_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."ledger_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."ledger_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."ledger_counters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.ledger_writer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF coalesce(current_setting('kaizen.ledger_posting', true), '') <> 'on' THEN
    RAISE EXCEPTION 'ledger.writer: entries are posted only by commerce.ledger_post()' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_writer BEFORE INSERT ON commerce.ledger_entries FOR EACH ROW EXECUTE FUNCTION commerce.ledger_writer();
--> statement-breakpoint
CREATE TRIGGER ledger_lines_writer BEFORE INSERT ON commerce.ledger_lines FOR EACH ROW EXECUTE FUNCTION commerce.ledger_writer();
--> statement-breakpoint
CREATE TRIGGER ledger_counters_writer BEFORE INSERT OR UPDATE ON commerce.ledger_counters FOR EACH ROW EXECUTE FUNCTION commerce.ledger_writer();
--> statement-breakpoint

CREATE FUNCTION commerce.ledger_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'ledger.fixed: a posted entry is never changed or deleted (reverse it)' USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_fixed BEFORE UPDATE OR DELETE ON commerce.ledger_entries FOR EACH ROW EXECUTE FUNCTION commerce.ledger_fixed();
--> statement-breakpoint
CREATE TRIGGER ledger_lines_fixed BEFORE UPDATE OR DELETE ON commerce.ledger_lines FOR EACH ROW EXECUTE FUNCTION commerce.ledger_fixed();
--> statement-breakpoint
CREATE TRIGGER ledger_counters_fixed BEFORE DELETE ON commerce.ledger_counters FOR EACH ROW EXECUTE FUNCTION commerce.ledger_fixed();
--> statement-breakpoint

CREATE FUNCTION commerce.ledger_books_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger_books.kept: a book is never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.store_id, NEW.country, NEW.currency, NEW.opened_on, NEW.created_at) IS DISTINCT FROM (OLD.store_id, OLD.country, OLD.currency, OLD.opened_on, OLD.created_at) THEN
    RAISE EXCEPTION 'ledger_books.fixed: a book keeps its store, country, currency and opening day' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.closed_on IS NOT NULL AND NEW.closed_on IS DISTINCT FROM OLD.closed_on THEN
    RAISE EXCEPTION 'ledger_books.closed: a book closes once' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.closed_on IS NOT NULL AND EXISTS (SELECT 1 FROM commerce.ledger_entries e WHERE e.book_id = NEW.id AND e.entry_date > NEW.closed_on) THEN
    RAISE EXCEPTION 'ledger_books.closed: a book closes after the last entry it holds' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_books_rules BEFORE UPDATE OR DELETE ON commerce.ledger_books FOR EACH ROW EXECUTE FUNCTION commerce.ledger_books_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.ledger_accounts_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.store_id, NEW.book_id, NEW.number) IS DISTINCT FROM (OLD.store_id, OLD.book_id, OLD.number) THEN
    RAISE EXCEPTION 'ledger_accounts.fixed: an account keeps its book and number' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind <> OLD.kind AND EXISTS (SELECT 1 FROM commerce.ledger_lines l WHERE l.book_id = OLD.book_id AND l.account = OLD.number) THEN
    RAISE EXCEPTION 'ledger_accounts.kind: an account with postings keeps its kind' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_accounts_rules BEFORE UPDATE ON commerce.ledger_accounts FOR EACH ROW EXECUTE FUNCTION commerce.ledger_accounts_rules();
--> statement-breakpoint

-- Posts an entry: p_lines is an array of {account, amount, vat_code?, text?}, amounts in the book's minor units (a debit positive).
CREATE FUNCTION commerce.ledger_post(
  p_book uuid, p_series text, p_date date, p_text text, p_source_kind text, p_source_id text, p_lines jsonb, p_by uuid, p_reverses uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  b commerce.ledger_books%ROWTYPE;
  o commerce.ledger_entries%ROWTYPE;
  v_id uuid;
  v_year integer := extract(year FROM p_date)::integer;
  v_number integer;
  v_count integer;
  v_zero integer;
  v_sum numeric;
BEGIN
  SELECT * INTO b FROM commerce.ledger_books WHERE id = p_book FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ledger.book: no such book' USING ERRCODE = 'check_violation';
  END IF;
  IF p_date < b.opened_on OR (b.closed_on IS NOT NULL AND p_date > b.closed_on) THEN
    RAISE EXCEPTION 'ledger.open: an entry is dated within its book''s days' USING ERRCODE = 'check_violation';
  END IF;
  IF b.locked_through IS NOT NULL AND p_date <= b.locked_through THEN
    RAISE EXCEPTION 'ledger.locked: the book is locked through %', b.locked_through USING ERRCODE = 'check_violation';
  END IF;
  IF p_source_kind IS NOT NULL THEN
    SELECT e.id INTO v_id FROM commerce.ledger_entries e
     WHERE e.book_id = p_book AND e.source_kind = p_source_kind AND e.source_id = p_source_id AND e.reverses IS NULL
       AND NOT EXISTS (SELECT 1 FROM commerce.ledger_entries r WHERE r.reverses = e.id)
     LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;
  IF p_reverses IS NOT NULL THEN
    SELECT * INTO o FROM commerce.ledger_entries WHERE id = p_reverses;
    IF NOT FOUND OR o.book_id <> p_book THEN
      RAISE EXCEPTION 'ledger.reverses: an entry reverses one of its own book' USING ERRCODE = 'check_violation';
    END IF;
    IF o.reverses IS NOT NULL THEN
      RAISE EXCEPTION 'ledger.reverses: a reversal is not itself reversed' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM commerce.ledger_entries r WHERE r.reverses = p_reverses) THEN
      RAISE EXCEPTION 'ledger.reversed: an entry is reversed once' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'ledger.lines: an entry''s lines are a list' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE coalesce((l->>'amount')::numeric, 0) = 0), coalesce(sum((l->>'amount')::numeric), 0)
    INTO v_count, v_zero, v_sum
    FROM jsonb_array_elements(p_lines) AS l;
  IF v_count < 2 THEN
    RAISE EXCEPTION 'ledger.lines: an entry has two lines or more' USING ERRCODE = 'check_violation';
  END IF;
  IF v_zero > 0 THEN
    RAISE EXCEPTION 'ledger.zero: no line is zero' USING ERRCODE = 'check_violation';
  END IF;
  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'ledger.balance: an entry''s lines sum to zero' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) AS l
     WHERE NOT EXISTS (SELECT 1 FROM commerce.ledger_accounts a WHERE a.book_id = p_book AND a.number = (l->>'account')::integer AND a.active)
  ) THEN
    RAISE EXCEPTION 'ledger.account: every line is on an active account of the book' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('kaizen.ledger_posting', 'on', true);
  INSERT INTO commerce.ledger_counters (store_id, book_id, series, year, last)
  VALUES (b.store_id, p_book, p_series, v_year, 1)
  ON CONFLICT (book_id, series, year) DO UPDATE SET last = commerce.ledger_counters.last + 1
  RETURNING last INTO v_number;
  INSERT INTO commerce.ledger_entries (store_id, book_id, series, year, number, entry_date, text, source_kind, source_id, reverses, posted_by)
  VALUES (b.store_id, p_book, p_series, v_year, v_number, p_date, p_text, p_source_kind, p_source_id, p_reverses, p_by)
  RETURNING id INTO v_id;
  INSERT INTO commerce.ledger_lines (entry_id, store_id, book_id, line, account, amount_minor, vat_code, text)
  SELECT v_id, b.store_id, p_book, l.n::integer, (l.v->>'account')::integer, (l.v->>'amount')::bigint, nullif(l.v->>'vat_code', ''), nullif(btrim(l.v->>'text'), '')
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS l(v, n);
  PERFORM set_config('kaizen.ledger_posting', '', true);
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- Reverses an entry on a day (its own when that is open): the same lines with their signs turned, in its series, saying which it reverses.
CREATE FUNCTION commerce.ledger_reverse(p_entry uuid, p_date date, p_text text, p_by uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  o commerce.ledger_entries%ROWTYPE;
  v_lines jsonb;
BEGIN
  SELECT * INTO o FROM commerce.ledger_entries WHERE id = p_entry;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ledger.reverses: no such entry' USING ERRCODE = 'check_violation';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('account', l.account, 'amount', -l.amount_minor, 'vat_code', l.vat_code, 'text', l.text) ORDER BY l.line)
    INTO v_lines
    FROM commerce.ledger_lines l WHERE l.entry_id = p_entry;
  RETURN commerce.ledger_post(o.book_id, o.series, coalesce(p_date, o.entry_date), p_text, NULL, NULL, v_lines, p_by, p_entry);
END;
$$;
