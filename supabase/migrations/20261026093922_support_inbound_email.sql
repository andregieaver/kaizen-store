CREATE TABLE "commerce"."support_inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"store_id" uuid,
	"routed" boolean DEFAULT false NOT NULL,
	"conversation_id" uuid,
	"from_address" text NOT NULL,
	"subject" text,
	"message_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"tries" smallint DEFAULT 0 NOT NULL,
	"claimed_until" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "support_inbound_emails_provider_key" UNIQUE("provider_id"),
	CONSTRAINT "support_inbound_emails_status" CHECK ("commerce"."support_inbound_emails"."status" in ('pending', 'running', 'done', 'refused', 'failed')),
	CONSTRAINT "support_inbound_emails_lengths" CHECK (length("commerce"."support_inbound_emails"."provider_id") between 1 and 200 and length("commerce"."support_inbound_emails"."from_address") <= 320 and coalesce(length("commerce"."support_inbound_emails"."subject") <= 200, true) and coalesce(length("commerce"."support_inbound_emails"."message_id") <= 998, true) and coalesce(length("commerce"."support_inbound_emails"."reason") <= 200, true))
);
--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" DROP CONSTRAINT "support_conversations_source";--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD COLUMN "reply_key" text;--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD COLUMN "email_subject" text;--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD COLUMN "email_message_id" text;--> statement-breakpoint
ALTER TABLE "commerce"."support_settings" ADD COLUMN "email_key" text;--> statement-breakpoint
ALTER TABLE "commerce"."support_inbound_emails" ADD CONSTRAINT "support_inbound_emails_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_inbound_emails" ADD CONSTRAINT "support_inbound_emails_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."support_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_inbound_emails_pending_idx" ON "commerce"."support_inbound_emails" USING btree ("created_at") WHERE status in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "support_inbound_emails_store_idx" ON "commerce"."support_inbound_emails" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "support_inbound_emails_conversation_idx" ON "commerce"."support_inbound_emails" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "support_inbound_emails_from_idx" ON "commerce"."support_inbound_emails" USING btree ("from_address","created_at");--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD CONSTRAINT "support_conversations_reply_key" UNIQUE("reply_key");--> statement-breakpoint
ALTER TABLE "commerce"."support_settings" ADD CONSTRAINT "support_settings_email_key" UNIQUE("email_key");--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD CONSTRAINT "support_conversations_reply_key_shape" CHECK ("commerce"."support_conversations"."reply_key" is null or "commerce"."support_conversations"."reply_key" ~ '^[a-z0-9]{12,32}$');--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD CONSTRAINT "support_conversations_email_fields" CHECK (coalesce(length("commerce"."support_conversations"."email_subject") <= 200, true) and coalesce(length("commerce"."support_conversations"."email_message_id") <= 998, true));--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD CONSTRAINT "support_conversations_source" CHECK ("commerce"."support_conversations"."source" in ('site', 'admin', 'email'));--> statement-breakpoint
ALTER TABLE "commerce"."support_settings" ADD CONSTRAINT "support_settings_email_key_shape" CHECK ("commerce"."support_settings"."email_key" is null or "commerce"."support_settings"."email_key" ~ '^[a-z0-9]{12,32}$');