CREATE TABLE "commerce"."assistant_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"store_id" uuid,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"href" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_notices_kind" CHECK ("commerce"."assistant_notices"."kind" in ('page_built', 'follow_up', 'plan_question', 'plan_done', 'approval_waiting', 'report_ready')),
	CONSTRAINT "assistant_notices_ref" CHECK (length("commerce"."assistant_notices"."ref") between 1 and 200),
	CONSTRAINT "assistant_notices_href" CHECK ("commerce"."assistant_notices"."href" like '/admin/%' and length("commerce"."assistant_notices"."href") <= 300)
);
--> statement-breakpoint
CREATE TABLE "commerce"."assistant_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"store_id" uuid,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"when_to_use" text DEFAULT '' NOT NULL,
	"steps" text NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_skills_key" UNIQUE NULLS NOT DISTINCT("account_id","store_id","key"),
	CONSTRAINT "assistant_skills_key_shape" CHECK ("commerce"."assistant_skills"."key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length("commerce"."assistant_skills"."key") between 2 and 60),
	CONSTRAINT "assistant_skills_title" CHECK (length("commerce"."assistant_skills"."title") between 1 and 120),
	CONSTRAINT "assistant_skills_when" CHECK (length("commerce"."assistant_skills"."when_to_use") <= 300),
	CONSTRAINT "assistant_skills_steps" CHECK (length("commerce"."assistant_skills"."steps") between 1 and 2000),
	CONSTRAINT "assistant_skills_shared" CHECK (not "commerce"."assistant_skills"."shared" or "commerce"."assistant_skills"."store_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "commerce"."assistant_notices" ADD CONSTRAINT "assistant_notices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_notices" ADD CONSTRAINT "assistant_notices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_skills" ADD CONSTRAINT "assistant_skills_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_skills" ADD CONSTRAINT "assistant_skills_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_notices_once" ON "commerce"."assistant_notices" USING btree ("account_id","kind","ref");--> statement-breakpoint
CREATE INDEX "assistant_notices_unread_idx" ON "commerce"."assistant_notices" USING btree ("account_id","store_id","created_at") WHERE "commerce"."assistant_notices"."read_at" is null;--> statement-breakpoint
CREATE INDEX "assistant_notices_store_idx" ON "commerce"."assistant_notices" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "assistant_notices_created_idx" ON "commerce"."assistant_notices" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "assistant_skills_store_idx" ON "commerce"."assistant_skills" USING btree ("store_id","shared");--> statement-breakpoint
-- Neither is exposed through the Data API: server code reaches them through `db()` (D350).
ALTER TABLE "commerce"."assistant_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_skills" ENABLE ROW LEVEL SECURITY;
