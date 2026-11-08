-- A book opened earlier (D498): the owner moves the opening day of the store's open book back, so the books hold the whole year (Human Web
-- opened its books on 1 November 2026 and keeps all of 2026 here). Moving it back holds every entry the book has (they are all after the old
-- day); it never moves forward, nor past an earlier book of the same store, nor while the book is locked (the days it would add are before
-- the lock). Everything else a book keeps stays as it was (ledger_rules, D478).

CREATE OR REPLACE FUNCTION commerce.ledger_books_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger_books.kept: a book is never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.store_id, NEW.country, NEW.currency, NEW.created_at) IS DISTINCT FROM (OLD.store_id, OLD.country, OLD.currency, OLD.created_at) THEN
    RAISE EXCEPTION 'ledger_books.fixed: a book keeps its store, country, currency and opening day' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.opened_on IS DISTINCT FROM OLD.opened_on THEN
    IF NEW.opened_on > OLD.opened_on OR OLD.closed_on IS NOT NULL OR NEW.locked_through IS NOT NULL THEN
      RAISE EXCEPTION 'ledger_books.fixed: a book keeps its store, country, currency and opening day' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM commerce.ledger_books o WHERE o.store_id = NEW.store_id AND o.id <> NEW.id AND coalesce(o.closed_on, 'infinity'::date) >= NEW.opened_on) THEN
      RAISE EXCEPTION 'ledger_books.earlier: a book opens after the store''s earlier book closed' USING ERRCODE = 'check_violation';
    END IF;
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
