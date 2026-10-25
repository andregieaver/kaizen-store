-- A store's choice to have the AI write and keep its legal pages (D311, unit L3, docs/ai-autopilot.md 8.6): written only by
-- src/server/legal-writer.ts, never through the Data API.
ALTER TABLE commerce.legal_ai_settings ENABLE ROW LEVEL SECURITY;
