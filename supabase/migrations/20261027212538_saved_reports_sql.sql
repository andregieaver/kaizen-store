-- Saved reports (wave 8 unit A, D345, docs/wave-8-analytics-ai.md A.3): a store's own report definitions, read and written only by the
-- server (src/server/saved-reports.ts) through the direct connection; nothing reaches them through Supabase's Data API.
ALTER TABLE commerce.saved_reports ENABLE ROW LEVEL SECURITY;
