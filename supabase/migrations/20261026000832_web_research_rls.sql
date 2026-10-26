-- Web research (D329, docs/ai-autopilot.md 13): the search service's key and the stores' research are written only by the server
-- (src/server/web-search-settings.ts, src/server/research.ts), never through the Data API.
ALTER TABLE commerce.search_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.research_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.research_notes ENABLE ROW LEVEL SECURITY;
