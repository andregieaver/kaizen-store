-- Saved reports emailed on a schedule (wave 12 unit A, D395): the table is private like every commerce table (no policy: the server reaches it
-- through its own connection), and is written only by `src/server/report-schedules.ts`.
ALTER TABLE commerce.report_schedules ENABLE ROW LEVEL SECURITY;
