-- Page replications (D150): like every commerce table, row-level security on and no policies.
-- A store's copies of other websites' pages are the store's own work and never copied with it
-- (`COPY_RULES`); the app removes a job's screenshots and the job itself after thirty days.
ALTER TABLE commerce.page_replications ENABLE ROW LEVEL SECURITY;
