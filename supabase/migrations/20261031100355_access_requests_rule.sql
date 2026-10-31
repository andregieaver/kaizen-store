ALTER TABLE "commerce"."retention_rules" DROP CONSTRAINT "retention_rules_kind";--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" ADD CONSTRAINT "retention_rules_kind" CHECK ("commerce"."retention_rules"."kind" in ('bookkeeping', 'host_bookkeeping', 'unpaid_orders', 'email_bodies', 'security_emails', 'carts', 'delivery_quotes', 'customer_codes', 'customer_sessions', 'webhook_payloads', 'consents', 'privacy_request_contact', 'privacy_requests', 'search_queries', 'visits', 'audit_log', 'form_submissions', 'integration_deliveries', 'abandoned_checkouts', 'recommendation_events', 'ai_usage', 'support_transcripts', 'support_records', 'blog_comments', 'assistant_conversations', 'access_requests'));--> statement-breakpoint
-- Applications to open a store get a retention period (PSI REG-05): once decided, the applicant's name, address and message are blanked 12
-- months after the decision by runRetention's access_requests step; a waiting one is kept, and the row stays as the record of the decision.
INSERT INTO commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on, valid_from, enforced_by, note)
VALUES
  ('access_requests', NULL, 12, 'months', 'event',
   'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.',
   NULL, 'policy', '2026-10-31', '2000-01-01', 'runRetention: access_requests',
   'Applications to open a store, once decided (approved or declined): the name, the email address and the message are blanked 12 months after the decision; the row stays as the record that it was decided. One still waiting is kept. An approved applicant has their own account by then.');
