CREATE TABLE "commerce"."docs_guide" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"occupation" text DEFAULT '' NOT NULL,
	"avatar" jsonb,
	"avatar_style" jsonb,
	"greeting" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"daily_limit" integer DEFAULT 500 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "docs_guide_one" CHECK ("commerce"."docs_guide"."id" = 1),
	CONSTRAINT "docs_guide_name" CHECK (length("commerce"."docs_guide"."name") <= 60),
	CONSTRAINT "docs_guide_occupation" CHECK (length("commerce"."docs_guide"."occupation") <= 80),
	CONSTRAINT "docs_guide_instructions" CHECK (length("commerce"."docs_guide"."instructions") <= 2000),
	CONSTRAINT "docs_guide_daily_limit" CHECK ("commerce"."docs_guide"."daily_limit" between 1 and 100000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."docs_guide_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text,
	"lang" text NOT NULL,
	"page_path" text,
	"message_seq" integer DEFAULT 0 NOT NULL,
	"unanswered" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"anonymised_at" timestamp with time zone,
	CONSTRAINT "docs_guide_conversations_token_key" UNIQUE("token_hash"),
	CONSTRAINT "docs_guide_conversations_lang" CHECK ("commerce"."docs_guide_conversations"."lang" in ('en', 'nb')),
	CONSTRAINT "docs_guide_conversations_token" CHECK ("commerce"."docs_guide_conversations"."token_hash" is not null or "commerce"."docs_guide_conversations"."anonymised_at" is not null),
	CONSTRAINT "docs_guide_conversations_page" CHECK ("commerce"."docs_guide_conversations"."page_path" is null or char_length("commerce"."docs_guide_conversations"."page_path") between 1 and 300),
	CONSTRAINT "docs_guide_conversations_counts" CHECK ("commerce"."docs_guide_conversations"."message_seq" >= 0 and "commerce"."docs_guide_conversations"."unanswered" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."docs_guide_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."docs_guide_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docs_guide_messages_seq_key" UNIQUE("conversation_id","seq"),
	CONSTRAINT "docs_guide_messages_author" CHECK ("commerce"."docs_guide_messages"."author" in ('reader', 'ai')),
	CONSTRAINT "docs_guide_messages_body" CHECK (char_length("commerce"."docs_guide_messages"."body") between 1 and 4000),
	CONSTRAINT "docs_guide_messages_seq" CHECK ("commerce"."docs_guide_messages"."seq" >= 1)
);
--> statement-breakpoint
ALTER TABLE "commerce"."docs_search_misses" DROP CONSTRAINT "docs_search_misses_count";--> statement-breakpoint
ALTER TABLE "commerce"."docs_search_misses" ADD COLUMN "guide_misses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."docs_guide" ADD CONSTRAINT "docs_guide_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."docs_guide_messages" ADD CONSTRAINT "docs_guide_messages_conversation_id_docs_guide_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."docs_guide_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "docs_guide_updated_by_idx" ON "commerce"."docs_guide" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "docs_guide_conversations_open_idx" ON "commerce"."docs_guide_conversations" USING btree ("last_message_at") WHERE "commerce"."docs_guide_conversations"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "docs_guide_conversations_ended_idx" ON "commerce"."docs_guide_conversations" USING btree ("ended_at") WHERE "commerce"."docs_guide_conversations"."anonymised_at" is null;--> statement-breakpoint
ALTER TABLE "commerce"."docs_search_misses" ADD CONSTRAINT "docs_search_misses_count" CHECK ("commerce"."docs_search_misses"."misses" >= 0 and "commerce"."docs_search_misses"."guide_misses" >= 0 and "commerce"."docs_search_misses"."misses" + "commerce"."docs_search_misses"."guide_misses" >= 1);--> statement-breakpoint
-- The docs guide (D444): its settings and its conversations are reached only through server code, never through the Data API.
ALTER TABLE "commerce"."docs_guide" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."docs_guide_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."docs_guide_messages" ENABLE ROW LEVEL SECURITY;
