-- The books' inbox (D504): row-level security, as every commerce table (the server reads and writes them through its own connection; no
-- policy lets a client reach them). A document is kept until it is used as a purchase's receipt or set aside, once each: it then changes
-- no more, and it is never deleted, so the books can say where a voucher came from.

ALTER TABLE "commerce"."books_email" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."books_inbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A mail to a books address is a received email of its own purpose (the code that writes it ships with this file; until it runs, no row
-- has it).
ALTER TABLE commerce.support_inbound_emails DROP CONSTRAINT support_inbound_emails_purpose;
--> statement-breakpoint
ALTER TABLE commerce.support_inbound_emails ADD CONSTRAINT support_inbound_emails_purpose CHECK (purpose IN ('support', 'filing', 'books'));
--> statement-breakpoint

CREATE FUNCTION commerce.books_inbox_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'books_inbox.fixed: a document of the inbox is never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'waiting'
     OR (to_jsonb(NEW) - 'status' - 'entry_id' - 'decided_at' - 'decided_by') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'entry_id' - 'decided_at' - 'decided_by') THEN
    RAISE EXCEPTION 'books_inbox.fixed: a document changes only when it is used or set aside, once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER books_inbox_fixed BEFORE UPDATE OR DELETE ON commerce.books_inbox FOR EACH ROW EXECUTE FUNCTION commerce.books_inbox_fixed();
