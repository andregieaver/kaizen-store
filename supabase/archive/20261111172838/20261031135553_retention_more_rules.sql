ALTER TABLE "commerce"."retention_rules" DROP CONSTRAINT "retention_rules_kind";--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" ADD CONSTRAINT "retention_rules_kind" CHECK ("commerce"."retention_rules"."kind" in ('bookkeeping', 'host_bookkeeping', 'unpaid_orders', 'email_bodies', 'security_emails', 'carts', 'delivery_quotes', 'customer_codes', 'customer_sessions', 'webhook_payloads', 'consents', 'privacy_request_contact', 'privacy_requests', 'search_queries', 'visits', 'audit_log', 'form_submissions', 'integration_deliveries', 'abandoned_checkouts', 'recommendation_events', 'ai_usage', 'support_transcripts', 'support_records', 'blog_comments', 'assistant_conversations', 'access_requests', 'unconfirmed_signups', 'content_report_senders'));-- Two pruners that ran on constants become retention rules the platform's admin sees and changes (PSI REG-05): self-serve sign-ups never
-- confirmed (deleted 7 days after their link ended) and the senders of notices of illegal content (name and address blanked 12 months after
-- the decision). Both enforced by runRetention's steps of the same names.
INSERT INTO commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on, valid_from, enforced_by, note)
VALUES
  ('unconfirmed_signups', NULL, 7, 'days', 'event',
   'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.',
   NULL, 'policy', '2026-10-31', '2000-01-01', 'runRetention: unconfirmed_signups',
   'Self-serve sign-ups whose address was never confirmed: the request (a name, an address, a description) is deleted this long after its confirmation link ended. UNCONFIRMED_KEPT_DAYS, a test holds them equal.'),
  ('content_report_senders', NULL, 12, 'months', 'event',
   'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.',
   NULL, 'policy', '2026-10-31', '2000-01-01', 'runRetention: content_report_senders',
   'Notices of illegal content (DSA art. 16): the sender''s name and address are blanked this long after the decision, long enough to answer a complaint about it (art. 20 allows six months); the notice and its decision stay as the record. REPORT_SENDER_MONTHS, a test holds them equal.');
