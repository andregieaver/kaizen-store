-- The official legal texts the AI's legal pages rest on (D311, unit L, docs/ai-autopilot.md 8.2): Kaizena Flow's, written only by
-- src/server/legal-sources.ts, never through the Data API. A read and a text stay as they were made; pruning old reads, and texts no read
-- names, are deletes, which are allowed.
ALTER TABLE commerce.legal_source_texts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.legal_source_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION commerce.legal_sources_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'legal_sources.fixed: a source''s read and text stay as they were read' USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER legal_source_texts_fixed BEFORE UPDATE ON commerce.legal_source_texts
  FOR EACH ROW EXECUTE FUNCTION commerce.legal_sources_fixed();
--> statement-breakpoint
CREATE TRIGGER legal_source_reads_fixed BEFORE UPDATE ON commerce.legal_source_reads
  FOR EACH ROW EXECUTE FUNCTION commerce.legal_sources_fixed();
