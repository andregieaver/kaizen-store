-- The owner assistant (D94). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.assistant_conversations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE commerce.assistant_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE commerce.assistant_approvals ENABLE ROW LEVEL SECURITY;
