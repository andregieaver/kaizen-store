-- The AI writing a store's legal pages (D311, unit L, docs/ai-autopilot.md 8.3, 8.4): written only by src/server/legal-writer.ts, never
-- through the Data API.
ALTER TABLE commerce.legal_ai_writes ENABLE ROW LEVEL SECURITY;
