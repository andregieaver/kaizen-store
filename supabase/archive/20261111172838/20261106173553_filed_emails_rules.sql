-- Email on the timeline (S5 of docs/own-books-and-sales.md, D476): the rules the database keeps.
--   Row-level security, as every commerce table. A received email's purpose is a desk's (support) or a filing address's.

ALTER TABLE "commerce"."email_filing" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."filed_emails" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.support_inbound_emails ADD CONSTRAINT support_inbound_emails_purpose CHECK (purpose IN ('support', 'filing'));
