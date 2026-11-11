CREATE TABLE "commerce"."support_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"store_id" uuid,
	"kind" text NOT NULL,
	"confirmer" text NOT NULL,
	"args" jsonb NOT NULL,
	"summary" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"result" jsonb,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_actions_confirmer" CHECK ("commerce"."support_actions"."confirmer" in ('customer', 'staff')),
	CONSTRAINT "support_actions_status" CHECK ("commerce"."support_actions"."status" in ('proposed', 'done', 'declined', 'failed', 'expired')),
	CONSTRAINT "support_actions_lengths" CHECK (length("commerce"."support_actions"."summary") between 1 and 500 and coalesce(length("commerce"."support_actions"."details") <= 500, true) and length("commerce"."support_actions"."kind") between 1 and 60),
	CONSTRAINT "support_actions_expiry" CHECK (("commerce"."support_actions"."confirmer" = 'customer') = ("commerce"."support_actions"."expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."support_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"account_id" uuid NOT NULL,
	"status" text DEFAULT 'away' NOT NULL,
	"max_chats" smallint DEFAULT 5 NOT NULL,
	"partner" boolean DEFAULT true NOT NULL,
	"display_name" text,
	"last_seen_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_agents_key" UNIQUE NULLS NOT DISTINCT("store_id","account_id"),
	CONSTRAINT "support_agents_status" CHECK ("commerce"."support_agents"."status" in ('online', 'away')),
	CONSTRAINT "support_agents_max_chats" CHECK ("commerce"."support_agents"."max_chats" between 1 and 20),
	CONSTRAINT "support_agents_display_name" CHECK (coalesce(length("commerce"."support_agents"."display_name") between 1 and 40, true))
);
--> statement-breakpoint
CREATE TABLE "commerce"."support_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"source" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"handler" text NOT NULL,
	"assignee_id" uuid,
	"token_hash" text,
	"email_token_hash" text,
	"customer_id" uuid,
	"requester_id" uuid,
	"about_store_id" uuid,
	"market" text,
	"locale" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"page_path" text,
	"tone" smallint,
	"tone_alert_at" timestamp with time zone,
	"handoff_reason" text,
	"ai_reason" text,
	"message_seq" integer DEFAULT 0 NOT NULL,
	"partner_seq" integer DEFAULT 0 NOT NULL,
	"partner_paused" boolean DEFAULT false NOT NULL,
	"visitor_seen_at" timestamp with time zone,
	"email_sent_seq" integer DEFAULT 0 NOT NULL,
	"email_count" smallint DEFAULT 0 NOT NULL,
	"contact_changes" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_customer_at" timestamp with time zone,
	"first_agent_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	"waiting_alert_at" timestamp with time zone,
	"summary" jsonb,
	"summary_status" text DEFAULT 'none' NOT NULL,
	"summary_tries" smallint DEFAULT 0 NOT NULL,
	"brief" jsonb,
	"rating" text,
	"rating_comment" text,
	"channel_key" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL,
	"anonymised_at" timestamp with time zone,
	CONSTRAINT "support_conversations_token_key" UNIQUE("token_hash"),
	CONSTRAINT "support_conversations_email_token_key" UNIQUE("email_token_hash"),
	CONSTRAINT "support_conversations_source" CHECK ("commerce"."support_conversations"."source" in ('site', 'admin')),
	CONSTRAINT "support_conversations_status" CHECK ("commerce"."support_conversations"."status" in ('open', 'ended')),
	CONSTRAINT "support_conversations_handler" CHECK ("commerce"."support_conversations"."handler" in ('ai', 'queue', 'human')),
	CONSTRAINT "support_conversations_assignee" CHECK (("commerce"."support_conversations"."assignee_id" is not null) = ("commerce"."support_conversations"."status" = 'open' and "commerce"."support_conversations"."handler" = 'human') or "commerce"."support_conversations"."anonymised_at" is not null),
	CONSTRAINT "support_conversations_token" CHECK ("commerce"."support_conversations"."source" <> 'site' or "commerce"."support_conversations"."token_hash" is not null or "commerce"."support_conversations"."anonymised_at" is not null),
	CONSTRAINT "support_conversations_requester" CHECK (("commerce"."support_conversations"."source" = 'admin') = ("commerce"."support_conversations"."requester_id" is not null) or "commerce"."support_conversations"."anonymised_at" is not null),
	CONSTRAINT "support_conversations_kaizen_customer" CHECK ("commerce"."support_conversations"."store_id" is not null or "commerce"."support_conversations"."customer_id" is null),
	CONSTRAINT "support_conversations_handoff_reason" CHECK ("commerce"."support_conversations"."handoff_reason" is null or "commerce"."support_conversations"."handoff_reason" in ('customer', 'ai', 'tone', 'no_ai', 'limit')),
	CONSTRAINT "support_conversations_ended_by" CHECK ("commerce"."support_conversations"."ended_by" is null or "commerce"."support_conversations"."ended_by" in ('customer', 'agent', 'timeout', 'system')),
	CONSTRAINT "support_conversations_summary_status" CHECK ("commerce"."support_conversations"."summary_status" in ('none', 'pending', 'done', 'failed', 'skipped')),
	CONSTRAINT "support_conversations_rating" CHECK ("commerce"."support_conversations"."rating" is null or "commerce"."support_conversations"."rating" in ('good', 'bad')),
	CONSTRAINT "support_conversations_tone" CHECK ("commerce"."support_conversations"."tone" is null or "commerce"."support_conversations"."tone" between -100 and 100),
	CONSTRAINT "support_conversations_lengths" CHECK (coalesce(length("commerce"."support_conversations"."contact_name") <= 120, true) and coalesce(length("commerce"."support_conversations"."contact_email") <= 254, true) and coalesce(length("commerce"."support_conversations"."page_path") <= 300, true) and coalesce(length("commerce"."support_conversations"."ai_reason") <= 200, true) and coalesce(length("commerce"."support_conversations"."rating_comment") <= 500, true) and length("commerce"."support_conversations"."locale") between 2 and 16),
	CONSTRAINT "support_conversations_emails" CHECK ("commerce"."support_conversations"."email_count" between 0 and 20 and "commerce"."support_conversations"."contact_changes" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "commerce"."support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"store_id" uuid,
	"seq" integer NOT NULL,
	"author" text NOT NULL,
	"account_id" uuid,
	"body" text NOT NULL,
	"kind" text,
	"data" jsonb,
	"action_id" uuid,
	"tone" smallint,
	"tone_label" text,
	"tools" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_messages_seq_key" UNIQUE("conversation_id","seq"),
	CONSTRAINT "support_messages_author" CHECK ("commerce"."support_messages"."author" in ('customer', 'ai', 'agent', 'system', 'note', 'partner')),
	CONSTRAINT "support_messages_body" CHECK (case "commerce"."support_messages"."author" when 'customer' then length("commerce"."support_messages"."body") between 1 and 1000 when 'ai' then length("commerce"."support_messages"."body") between 1 and 2000 when 'agent' then length("commerce"."support_messages"."body") between 1 and 4000 when 'note' then length("commerce"."support_messages"."body") between 1 and 2000 when 'partner' then length("commerce"."support_messages"."body") <= 3000 else "commerce"."support_messages"."body" = '' end),
	CONSTRAINT "support_messages_tone" CHECK ("commerce"."support_messages"."tone" is null or ("commerce"."support_messages"."author" = 'customer' and "commerce"."support_messages"."tone" between -100 and 100)),
	CONSTRAINT "support_messages_tone_label" CHECK ("commerce"."support_messages"."tone_label" is null or "commerce"."support_messages"."tone_label" in ('happy', 'calm', 'neutral', 'confused', 'worried', 'frustrated', 'angry'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."support_reads" (
	"conversation_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"last_read_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "support_reads_conversation_id_account_id_pk" PRIMARY KEY("conversation_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."support_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"shortcut" text,
	"locale" text,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_replies_shortcut_key" UNIQUE NULLS NOT DISTINCT("store_id","shortcut"),
	CONSTRAINT "support_replies_lengths" CHECK (length("commerce"."support_replies"."title") between 1 and 80 and length("commerce"."support_replies"."body") between 1 and 2000 and coalesce(length("commerce"."support_replies"."shortcut") between 1 and 20, true))
);
--> statement-breakpoint
CREATE TABLE "commerce"."support_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"mode" text DEFAULT 'off' NOT NULL,
	"email_followup" boolean DEFAULT true NOT NULL,
	"hours" jsonb,
	"end_after_minutes" smallint DEFAULT 30 NOT NULL,
	"partner" boolean DEFAULT true NOT NULL,
	"tone_on" boolean DEFAULT true NOT NULL,
	"summaries_on" boolean DEFAULT true NOT NULL,
	"tone_alert" smallint DEFAULT -40,
	"tone_handoff" smallint DEFAULT -60,
	"notify_after_minutes" smallint DEFAULT 5 NOT NULL,
	"ai_actions" text[],
	"transcript_days" smallint DEFAULT 90 NOT NULL,
	"agent_naming" text DEFAULT 'first_name' NOT NULL,
	"channel_key" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "support_settings_store_key" UNIQUE NULLS NOT DISTINCT("store_id"),
	CONSTRAINT "support_settings_mode" CHECK ("commerce"."support_settings"."mode" in ('off', 'ai_first', 'people')),
	CONSTRAINT "support_settings_end_after" CHECK ("commerce"."support_settings"."end_after_minutes" between 10 and 240),
	CONSTRAINT "support_settings_tone_alert" CHECK ("commerce"."support_settings"."tone_alert" is null or "commerce"."support_settings"."tone_alert" between -100 and 0),
	CONSTRAINT "support_settings_tone_handoff" CHECK ("commerce"."support_settings"."tone_handoff" is null or "commerce"."support_settings"."tone_handoff" between -100 and 0),
	CONSTRAINT "support_settings_notify_after" CHECK ("commerce"."support_settings"."notify_after_minutes" between 1 and 60),
	CONSTRAINT "support_settings_transcript_days" CHECK ("commerce"."support_settings"."transcript_days" in (30, 60, 90)),
	CONSTRAINT "support_settings_agent_naming" CHECK ("commerce"."support_settings"."agent_naming" in ('first_name', 'desk'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."support_actions" ADD CONSTRAINT "support_actions_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."support_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_actions" ADD CONSTRAINT "support_actions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_actions" ADD CONSTRAINT "support_actions_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_agents" ADD CONSTRAINT "support_agents_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_agents" ADD CONSTRAINT "support_agents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD CONSTRAINT "support_conversations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD CONSTRAINT "support_conversations_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD CONSTRAINT "support_conversations_requester_id_accounts_id_fk" FOREIGN KEY ("requester_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD CONSTRAINT "support_conversations_about_store_id_stores_id_fk" FOREIGN KEY ("about_store_id") REFERENCES "commerce"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD CONSTRAINT "support_conversations_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_messages" ADD CONSTRAINT "support_messages_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."support_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_messages" ADD CONSTRAINT "support_messages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_messages" ADD CONSTRAINT "support_messages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_messages" ADD CONSTRAINT "support_messages_action_id_support_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "commerce"."support_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_reads" ADD CONSTRAINT "support_reads_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."support_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_reads" ADD CONSTRAINT "support_reads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_replies" ADD CONSTRAINT "support_replies_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_replies" ADD CONSTRAINT "support_replies_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_settings" ADD CONSTRAINT "support_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_settings" ADD CONSTRAINT "support_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_actions_conversation_idx" ON "commerce"."support_actions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "support_actions_open_idx" ON "commerce"."support_actions" USING btree ("store_id","confirmer") WHERE "commerce"."support_actions"."status" = 'proposed';--> statement-breakpoint
CREATE INDEX "support_actions_decided_by_idx" ON "commerce"."support_actions" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "support_agents_account_idx" ON "commerce"."support_agents" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "support_conversations_list_idx" ON "commerce"."support_conversations" USING btree ("store_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "support_conversations_open_idx" ON "commerce"."support_conversations" USING btree ("store_id","handler") WHERE "commerce"."support_conversations"."status" = 'open';--> statement-breakpoint
CREATE INDEX "support_conversations_assignee_idx" ON "commerce"."support_conversations" USING btree ("assignee_id") WHERE "commerce"."support_conversations"."status" = 'open';--> statement-breakpoint
CREATE INDEX "support_conversations_customer_idx" ON "commerce"."support_conversations" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "support_conversations_requester_idx" ON "commerce"."support_conversations" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "support_conversations_about_store_idx" ON "commerce"."support_conversations" USING btree ("about_store_id");--> statement-breakpoint
CREATE INDEX "support_conversations_ended_idx" ON "commerce"."support_conversations" USING btree ("ended_at") WHERE "commerce"."support_conversations"."anonymised_at" is null;--> statement-breakpoint
CREATE INDEX "support_messages_account_idx" ON "commerce"."support_messages" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "support_messages_action_idx" ON "commerce"."support_messages" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "support_messages_store_idx" ON "commerce"."support_messages" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "support_reads_account_idx" ON "commerce"."support_reads" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "support_replies_created_by_idx" ON "commerce"."support_replies" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "support_settings_updated_by_idx" ON "commerce"."support_settings" USING btree ("updated_by");