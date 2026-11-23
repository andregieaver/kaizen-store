CREATE TABLE "commerce"."marketing_topic_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"opted_in" boolean NOT NULL,
	"source" text NOT NULL,
	"words" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_topic_choices_source" CHECK ("commerce"."marketing_topic_choices"."source" in ('preferences', 'form', 'staff', 'api')),
	CONSTRAINT "marketing_topic_choices_words" CHECK (char_length("commerce"."marketing_topic_choices"."words") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."marketing_topic_choices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."marketing_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"names" jsonb NOT NULL,
	"default_on" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_topics_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "marketing_topics_names" CHECK (jsonb_typeof("commerce"."marketing_topics"."names") = 'object' and "commerce"."marketing_topics"."names" <> '{}'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "commerce"."marketing_topics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."broadcasts" ADD COLUMN "topic_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."marketing_topic_choices" ADD CONSTRAINT "marketing_topic_choices_subscriber_fk" FOREIGN KEY ("store_id","subscriber_id") REFERENCES "commerce"."marketing_subscribers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."marketing_topic_choices" ADD CONSTRAINT "marketing_topic_choices_topic_fk" FOREIGN KEY ("store_id","topic_id") REFERENCES "commerce"."marketing_topics"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."marketing_topics" ADD CONSTRAINT "marketing_topics_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketing_topic_choices_newest_idx" ON "commerce"."marketing_topic_choices" USING btree ("subscriber_id","topic_id","created_at");--> statement-breakpoint
CREATE INDEX "marketing_topic_choices_topic_idx" ON "commerce"."marketing_topic_choices" USING btree ("store_id","topic_id");--> statement-breakpoint
CREATE INDEX "marketing_topics_list_idx" ON "commerce"."marketing_topics" USING btree ("store_id","position");