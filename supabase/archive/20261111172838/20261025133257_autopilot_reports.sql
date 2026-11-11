CREATE TABLE "commerce"."autopilot_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period_start" date NOT NULL,
	"facts" jsonb NOT NULL,
	"note" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autopilot_reports_period_key" UNIQUE NULLS NOT DISTINCT("store_id","account_id","kind","period_start"),
	CONSTRAINT "autopilot_reports_kind" CHECK ("commerce"."autopilot_reports"."kind" in ('daily', 'weekly')),
	CONSTRAINT "autopilot_reports_note" CHECK ("commerce"."autopilot_reports"."note" is null or length("commerce"."autopilot_reports"."note") <= 1500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_reports" ADD CONSTRAINT "autopilot_reports_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_reports" ADD CONSTRAINT "autopilot_reports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autopilot_reports_account_idx" ON "commerce"."autopilot_reports" USING btree ("account_id","created_at");