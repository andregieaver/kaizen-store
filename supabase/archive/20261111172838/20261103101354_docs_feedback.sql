CREATE TABLE "commerce"."docs_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"lang" text NOT NULL,
	"helpful" boolean NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docs_feedback_path" CHECK ("commerce"."docs_feedback"."path" ~ '^[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*){0,4}$'),
	CONSTRAINT "docs_feedback_lang" CHECK ("commerce"."docs_feedback"."lang" in ('en', 'nb')),
	CONSTRAINT "docs_feedback_comment" CHECK ("commerce"."docs_feedback"."comment" is null or char_length("commerce"."docs_feedback"."comment") between 1 and 500)
);
--> statement-breakpoint
CREATE INDEX "docs_feedback_created_idx" ON "commerce"."docs_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "docs_feedback_path_idx" ON "commerce"."docs_feedback" USING btree ("path","created_at");--> statement-breakpoint
-- The docs' "Was this page helpful?" (D442): written only by src/server/docs-feedback.ts, never through the Data API.
ALTER TABLE "commerce"."docs_feedback" ENABLE ROW LEVEL SECURITY;