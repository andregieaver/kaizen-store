-- Support (D216, docs/support.md 3.5): the retention rules of support conversations, as `RETENTION_SEED` in src/lib/retention.ts says
-- (src/db/privacy.test.ts holds the two equal). Both are Kaizen's own proportionality choices, not statutes.
--
-- * `support_transcripts`: the longest a desk keeps a conversation's messages after it ends (a desk chooses 30, 60 or 90 days; one with
--   support off keeps them a day); then `runRetention()` deletes them and anonymises the conversation (application code, no DELETE here).
-- * `support_records`: anonymised conversations (dates, counts, closed fields) are deleted after 24 months.

INSERT INTO commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on, valid_from, enforced_by, note)
VALUES
  ('support_transcripts', NULL, 90, 'days', 'event',
   'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.',
   NULL, 'policy', '2026-10-13', '2000-01-01', 'runRetention: support_transcripts',
   'Counts from the conversation''s end. The desk''s own choice (TRANSCRIPT_DAYS) or a day with support off is shorter; a test holds the default equal.'),
  ('support_records', NULL, 24, 'months', 'event',
   'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.',
   NULL, 'policy', '2026-10-13', '2000-01-01', 'runRetention: support_records',
   'Anonymised conversations (dates, counts, closed fields) for the desk''s reports; RECORD_MONTHS, a test holds them equal.');
