CREATE TABLE "commerce"."assistant_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb NOT NULL,
	"summary" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "assistant_approvals_category" CHECK ("commerce"."assistant_approvals"."category" in ('send', 'public', 'spend')),
	CONSTRAINT "assistant_approvals_status" CHECK ("commerce"."assistant_approvals"."status" in ('pending', 'done', 'declined', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."assistant_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_conversations_title" CHECK (length("commerce"."assistant_conversations"."title") <= 200)
);
--> statement-breakpoint
CREATE TABLE "commerce"."assistant_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_messages_role" CHECK ("commerce"."assistant_messages"."role" in ('user', 'assistant')),
	CONSTRAINT "assistant_messages_content" CHECK (length("commerce"."assistant_messages"."content") <= 20000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."assistant_approvals" ADD CONSTRAINT "assistant_approvals_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_approvals" ADD CONSTRAINT "assistant_approvals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_approvals" ADD CONSTRAINT "assistant_approvals_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_conversations" ADD CONSTRAINT "assistant_conversations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_conversations" ADD CONSTRAINT "assistant_conversations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_messages" ADD CONSTRAINT "assistant_messages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_messages" ADD CONSTRAINT "assistant_messages_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_approvals_conversation_idx" ON "commerce"."assistant_approvals" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_approvals_store_idx" ON "commerce"."assistant_approvals" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "assistant_approvals_account_idx" ON "commerce"."assistant_approvals" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "assistant_conversations_owner_idx" ON "commerce"."assistant_conversations" USING btree ("store_id","account_id","updated_at");--> statement-breakpoint
CREATE INDEX "assistant_conversations_account_idx" ON "commerce"."assistant_conversations" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "assistant_messages_conversation_idx" ON "commerce"."assistant_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_messages_store_idx" ON "commerce"."assistant_messages" USING btree ("store_id","created_at");