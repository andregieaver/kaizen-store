CREATE TABLE "commerce"."blog_authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"picture_url" text,
	"bio" text DEFAULT '' NOT NULL,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_authors_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "blog_authors_name" CHECK (length(btrim("commerce"."blog_authors"."name")) between 1 and 100),
	CONSTRAINT "blog_authors_bio" CHECK (length("commerce"."blog_authors"."bio") <= 600),
	CONSTRAINT "blog_authors_link" CHECK ("commerce"."blog_authors"."link" is null or length("commerce"."blog_authors"."link") <= 500)
);
--> statement-breakpoint
CREATE TABLE "commerce"."blog_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"body" text NOT NULL,
	"body_hash" text NOT NULL,
	"locale" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"spam_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_comments_status" CHECK ("commerce"."blog_comments"."status" in ('pending', 'approved', 'rejected', 'spam')),
	CONSTRAINT "blog_comments_name" CHECK (length(btrim("commerce"."blog_comments"."name")) between 1 and 80),
	CONSTRAINT "blog_comments_body" CHECK (length(btrim("commerce"."blog_comments"."body")) between 1 and 2000),
	CONSTRAINT "blog_comments_email" CHECK ("commerce"."blog_comments"."email" is null or length("commerce"."blog_comments"."email") <= 254)
);
--> statement-breakpoint
CREATE TABLE "commerce"."blogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"main" boolean DEFAULT false NOT NULL,
	"titles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"listing_page_id" uuid,
	"comments" text DEFAULT 'moderated' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blogs_store_handle_key" UNIQUE("store_id","handle"),
	CONSTRAINT "blogs_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "blogs_handle_format" CHECK ("commerce"."blogs"."handle" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length("commerce"."blogs"."handle") <= 60),
	CONSTRAINT "blogs_comments" CHECK ("commerce"."blogs"."comments" in ('off', 'moderated', 'automatic')),
	CONSTRAINT "blogs_main_lists_by_role" CHECK (not "commerce"."blogs"."main" or "commerce"."blogs"."listing_page_id" is null)
);
--> statement-breakpoint
CREATE TABLE "commerce"."page_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"publish_at" timestamp with time zone NOT NULL,
	"scheduled_by" uuid,
	"acknowledged" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"problem" text,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_schedules_status" CHECK ("commerce"."page_schedules"."status" in ('waiting', 'done', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" DROP CONSTRAINT "retention_rules_kind";--> statement-breakpoint
ALTER TABLE "commerce"."blog_authors" ADD CONSTRAINT "blog_authors_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."blog_comments" ADD CONSTRAINT "blog_comments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."blog_comments" ADD CONSTRAINT "blog_comments_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."blog_comments" ADD CONSTRAINT "blog_comments_page_fk" FOREIGN KEY ("store_id","page_id") REFERENCES "commerce"."pages"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."blogs" ADD CONSTRAINT "blogs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."blogs" ADD CONSTRAINT "blogs_listing_page_id_pages_id_fk" FOREIGN KEY ("listing_page_id") REFERENCES "commerce"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_schedules" ADD CONSTRAINT "page_schedules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_schedules" ADD CONSTRAINT "page_schedules_scheduled_by_accounts_id_fk" FOREIGN KEY ("scheduled_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_schedules" ADD CONSTRAINT "page_schedules_page_fk" FOREIGN KEY ("store_id","page_id") REFERENCES "commerce"."pages"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blog_comments_page_idx" ON "commerce"."blog_comments" USING btree ("store_id","page_id","status","created_at");--> statement-breakpoint
CREATE INDEX "blog_comments_status_idx" ON "commerce"."blog_comments" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "blog_comments_hash_idx" ON "commerce"."blog_comments" USING btree ("store_id","body_hash","created_at");--> statement-breakpoint
CREATE INDEX "blog_comments_email_idx" ON "commerce"."blog_comments" USING btree ("store_id",lower("email"));--> statement-breakpoint
CREATE INDEX "blog_comments_decided_by_idx" ON "commerce"."blog_comments" USING btree ("decided_by");--> statement-breakpoint
CREATE UNIQUE INDEX "blogs_one_main_idx" ON "commerce"."blogs" USING btree ("store_id") WHERE "commerce"."blogs"."main";--> statement-breakpoint
CREATE INDEX "blogs_listing_page_idx" ON "commerce"."blogs" USING btree ("listing_page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_schedules_one_waiting_idx" ON "commerce"."page_schedules" USING btree ("page_id") WHERE "commerce"."page_schedules"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "page_schedules_due_idx" ON "commerce"."page_schedules" USING btree ("publish_at") WHERE "commerce"."page_schedules"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "page_schedules_store_idx" ON "commerce"."page_schedules" USING btree ("store_id","page_id");--> statement-breakpoint
CREATE INDEX "page_schedules_scheduled_by_idx" ON "commerce"."page_schedules" USING btree ("scheduled_by");--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" ADD CONSTRAINT "retention_rules_kind" CHECK ("commerce"."retention_rules"."kind" in ('bookkeeping', 'host_bookkeeping', 'unpaid_orders', 'email_bodies', 'security_emails', 'carts', 'delivery_quotes', 'customer_codes', 'customer_sessions', 'webhook_payloads', 'consents', 'privacy_request_contact', 'privacy_requests', 'search_queries', 'visits', 'audit_log', 'form_submissions', 'integration_deliveries', 'abandoned_checkouts', 'recommendation_events', 'ai_usage', 'support_transcripts', 'support_records', 'blog_comments'));