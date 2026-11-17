-- Questions the chat assistant could not answer (ecosystem plan E4.3, D729): the rules the database holds.
--
-- A question keeps its site, its language, its wording key and when it was first asked. Its answer is a knowledge document of the same
-- site (a store's, or Kaizena Flow's own when store_id is null), never another's.

CREATE FUNCTION commerce.unanswered_questions_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.lang IS DISTINCT FROM OLD.lang OR NEW.key IS DISTINCT FROM OLD.key
       OR NEW.first_at IS DISTINCT FROM OLD.first_at THEN
      RAISE EXCEPTION 'unanswered_questions.fixed: a question keeps its site, language, wording and first day' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.document_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.document_id IS DISTINCT FROM OLD.document_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM commerce.knowledge_documents d WHERE d.id = NEW.document_id AND d.store_id IS NOT DISTINCT FROM NEW.store_id
    ) THEN
      RAISE EXCEPTION 'unanswered_questions.document: the answer is a knowledge document of the same site' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER unanswered_questions_rules BEFORE INSERT OR UPDATE ON commerce.unanswered_questions FOR EACH ROW EXECUTE FUNCTION commerce.unanswered_questions_rules();
--> statement-breakpoint

-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection.
ALTER TABLE commerce.unanswered_questions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

INSERT INTO commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on, valid_from, enforced_by, note)
SELECT 'unanswered_questions', NULL, 90, 'days', 'event', 'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-11-17', '2000-01-01', 'runRetention: unanswered_questions',
   'A question the chat assistant could not answer, counted from the last time a conversation asked it: deleted this long after, whether answered, dismissed or still open; the words kept are always the newest asker''s. QUESTION_KEEP_DAYS, a test holds them equal.'
 WHERE NOT EXISTS (SELECT 1 FROM commerce.retention_rules r WHERE r.kind = 'unanswered_questions' AND r.country IS NULL);
