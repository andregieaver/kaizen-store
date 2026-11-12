CREATE TABLE "commerce"."platform_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"figures" jsonb NOT NULL,
	"query" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_readings_kind" CHECK ("commerce"."platform_readings"."kind" in ('statement', 'table', 'schema'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "platform_readings_day_kind_name_key" ON "commerce"."platform_readings" USING btree ("day","kind","name");