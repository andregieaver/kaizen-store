-- What the autopilot reacted to (D331, docs/ai-autopilot.md 15): written only by src/server/autopilot-events.ts, never through the Data API.
ALTER TABLE commerce.autopilot_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.autopilot_event_checks ENABLE ROW LEVEL SECURITY;
