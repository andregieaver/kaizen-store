-- The AI manager's conversations get a retention period (wave 11 unit L, D391, docs/dpia-ai.md R6): their messages and decided approvals
-- go 12 months after they were written unless the store's owner chose another period (stores.assistant_keep_months).
INSERT INTO commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on, valid_from, enforced_by, note)
VALUES
  ('assistant_conversations', NULL, 12, 'months', 'event',
   'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.',
   NULL, 'policy', '2026-10-29', '2000-01-01', 'runRetention: assistant_conversations',
   'Counts from the conversation''s last message. A store''s owner may keep its conversations for fewer or more months (stores.assistant_keep_months, 1 to 60); Kaizena Flow''s own follow this period. ASSISTANT_KEEP_MONTHS, a test holds them equal.');
