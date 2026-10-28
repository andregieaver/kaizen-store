CREATE TABLE "commerce"."store_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"account_id" uuid,
	"description" text NOT NULL,
	"job_ids" uuid[] NOT NULL,
	"install_id" uuid,
	"status" text DEFAULT 'drafting' NOT NULL,
	"problem" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "store_drafts_status" CHECK ("commerce"."store_drafts"."status" in ('drafting', 'published', 'discarded')),
	CONSTRAINT "store_drafts_description" CHECK (length("commerce"."store_drafts"."description") between 10 and 1500),
	CONSTRAINT "store_drafts_jobs" CHECK (cardinality("commerce"."store_drafts"."job_ids") between 1 and 4),
	CONSTRAINT "store_drafts_problem" CHECK ("commerce"."store_drafts"."problem" is null or length("commerce"."store_drafts"."problem") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."store_drafts" ADD CONSTRAINT "store_drafts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_drafts" ADD CONSTRAINT "store_drafts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_drafts" ADD CONSTRAINT "store_drafts_install_id_store_theme_installs_id_fk" FOREIGN KEY ("install_id") REFERENCES "commerce"."store_theme_installs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_drafts_store_idx" ON "commerce"."store_drafts" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "store_drafts_account_idx" ON "commerce"."store_drafts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "store_drafts_install_idx" ON "commerce"."store_drafts" USING btree ("install_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_drafts_one_open" ON "commerce"."store_drafts" USING btree ("store_id") WHERE "commerce"."store_drafts"."status" = 'drafting';--> statement-breakpoint
-- Reached only through server code (D351).
ALTER TABLE "commerce"."store_drafts" ENABLE ROW LEVEL SECURITY;
