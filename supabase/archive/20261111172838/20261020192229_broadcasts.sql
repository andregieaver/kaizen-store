CREATE TABLE "commerce"."broadcast_link_clicks" (
	"store_id" uuid NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"link" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "broadcast_link_clicks_broadcast_id_link_pk" PRIMARY KEY("broadcast_id","link"),
	CONSTRAINT "broadcast_link_clicks_link" CHECK ("commerce"."broadcast_link_clicks"."link" ~ '^[a-z]{2}(-[A-Z]{2})?[.][0-9]{1,2}$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."broadcast_recipients" (
	"store_id" uuid NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"email" text NOT NULL,
	"locale" text NOT NULL,
	"market_code" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"skip_reason" text,
	"claimed_until" timestamp with time zone,
	"email_message_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcast_recipients_broadcast_id_subscriber_id_pk" PRIMARY KEY("broadcast_id","subscriber_id"),
	CONSTRAINT "broadcast_recipients_status" CHECK ("commerce"."broadcast_recipients"."status" in ('queued', 'sent', 'failed', 'skipped')),
	CONSTRAINT "broadcast_recipients_skip" CHECK ("commerce"."broadcast_recipients"."skip_reason" is null or "commerce"."broadcast_recipients"."skip_reason" in ('unsubscribed', 'stopped')),
	CONSTRAINT "broadcast_recipients_email" CHECK ("commerce"."broadcast_recipients"."email" = lower("commerce"."broadcast_recipients"."email") and char_length("commerce"."broadcast_recipients"."email") between 3 and 254)
);
--> statement-breakpoint
CREATE TABLE "commerce"."broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"audience" text DEFAULT 'everyone' NOT NULL,
	"segment_id" uuid,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"schedule_problem" text,
	"audience_words" text,
	"recipient_count" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"counts" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcasts_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "broadcasts_title" CHECK (char_length("commerce"."broadcasts"."title") between 1 and 80 and "commerce"."broadcasts"."title" = btrim("commerce"."broadcasts"."title")),
	CONSTRAINT "broadcasts_audience" CHECK ("commerce"."broadcasts"."audience" in ('everyone', 'segment')),
	CONSTRAINT "broadcasts_status" CHECK ("commerce"."broadcasts"."status" in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
	CONSTRAINT "broadcasts_content" CHECK (jsonb_typeof("commerce"."broadcasts"."content") = 'object')
);
--> statement-breakpoint
ALTER TABLE "commerce"."broadcast_link_clicks" ADD CONSTRAINT "broadcast_link_clicks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."broadcast_link_clicks" ADD CONSTRAINT "broadcast_link_clicks_broadcast_fk" FOREIGN KEY ("store_id","broadcast_id") REFERENCES "commerce"."broadcasts"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_email_message_id_email_messages_id_fk" FOREIGN KEY ("email_message_id") REFERENCES "commerce"."email_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_fk" FOREIGN KEY ("store_id","broadcast_id") REFERENCES "commerce"."broadcasts"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_subscriber_fk" FOREIGN KEY ("store_id","subscriber_id") REFERENCES "commerce"."marketing_subscribers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."broadcasts" ADD CONSTRAINT "broadcasts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."broadcasts" ADD CONSTRAINT "broadcasts_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "commerce"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."broadcasts" ADD CONSTRAINT "broadcasts_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_recipients_queue_idx" ON "commerce"."broadcast_recipients" USING btree ("broadcast_id","status");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_email_idx" ON "commerce"."broadcast_recipients" USING btree ("store_id","email");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_message_idx" ON "commerce"."broadcast_recipients" USING btree ("email_message_id");--> statement-breakpoint
CREATE INDEX "broadcasts_list_idx" ON "commerce"."broadcasts" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "broadcasts_due_idx" ON "commerce"."broadcasts" USING btree ("scheduled_for") WHERE "commerce"."broadcasts"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "broadcasts_sending_idx" ON "commerce"."broadcasts" USING btree ("status") WHERE "commerce"."broadcasts"."status" = 'sending';--> statement-breakpoint
CREATE INDEX "broadcasts_segment_idx" ON "commerce"."broadcasts" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "broadcasts_created_by_idx" ON "commerce"."broadcasts" USING btree ("created_by");