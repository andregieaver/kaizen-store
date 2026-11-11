-- Kaizen's reminders about plans left unpaid (decision D33). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.plan_reminder_steps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.abandoned_plan_checkouts ENABLE ROW LEVEL SECURITY;
