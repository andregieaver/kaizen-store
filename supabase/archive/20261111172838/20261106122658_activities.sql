CREATE TABLE "commerce"."activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"due_at" timestamp with time zone NOT NULL,
	"timed" boolean DEFAULT true NOT NULL,
	"duration_minutes" integer,
	"assignee_id" uuid,
	"customer_id" uuid,
	"company_id" uuid,
	"deal_id" uuid,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"notified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "activities_kind" CHECK ("commerce"."activities"."kind" in ('call', 'meeting', 'task')),
	CONSTRAINT "activities_title" CHECK ("commerce"."activities"."title" = btrim("commerce"."activities"."title") and char_length("commerce"."activities"."title") between 1 and 200),
	CONSTRAINT "activities_note" CHECK ("commerce"."activities"."note" is null or char_length("commerce"."activities"."note") between 1 and 2000),
	CONSTRAINT "activities_duration" CHECK ("commerce"."activities"."duration_minutes" is null or ("commerce"."activities"."kind" = 'meeting' and "commerce"."activities"."duration_minutes" between 1 and 720)),
	CONSTRAINT "activities_done" CHECK ("commerce"."activities"."done_by" is null or "commerce"."activities"."done_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "commerce"."activities" ADD CONSTRAINT "activities_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."activities" ADD CONSTRAINT "activities_assignee_id_accounts_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."activities" ADD CONSTRAINT "activities_done_by_accounts_id_fk" FOREIGN KEY ("done_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."activities" ADD CONSTRAINT "activities_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."activities" ADD CONSTRAINT "activities_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."activities" ADD CONSTRAINT "activities_company_fk" FOREIGN KEY ("store_id","company_id") REFERENCES "commerce"."customer_companies"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."activities" ADD CONSTRAINT "activities_deal_fk" FOREIGN KEY ("store_id","deal_id") REFERENCES "commerce"."deals"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_today_idx" ON "commerce"."activities" USING btree ("store_id","assignee_id","due_at") WHERE "commerce"."activities"."done_at" is null;--> statement-breakpoint
CREATE INDEX "activities_store_due_idx" ON "commerce"."activities" USING btree ("store_id","due_at") WHERE "commerce"."activities"."done_at" is null;--> statement-breakpoint
CREATE INDEX "activities_deal_idx" ON "commerce"."activities" USING btree ("store_id","deal_id") WHERE "commerce"."activities"."deal_id" is not null;--> statement-breakpoint
CREATE INDEX "activities_customer_idx" ON "commerce"."activities" USING btree ("store_id","customer_id") WHERE "commerce"."activities"."customer_id" is not null;--> statement-breakpoint
CREATE INDEX "activities_company_idx" ON "commerce"."activities" USING btree ("store_id","company_id") WHERE "commerce"."activities"."company_id" is not null;--> statement-breakpoint
CREATE INDEX "activities_due_push_idx" ON "commerce"."activities" USING btree ("due_at") WHERE "commerce"."activities"."timed" and "commerce"."activities"."done_at" is null and "commerce"."activities"."notified_at" is null;--> statement-breakpoint
CREATE INDEX "activities_assignee_idx" ON "commerce"."activities" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "activities_done_by_idx" ON "commerce"."activities" USING btree ("done_by");--> statement-breakpoint
CREATE INDEX "activities_created_by_idx" ON "commerce"."activities" USING btree ("created_by");