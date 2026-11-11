CREATE TABLE "commerce"."report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"frequency" text NOT NULL,
	"weekday" smallint,
	"month_day" smallint,
	"hour" smallint DEFAULT 7 NOT NULL,
	"recipients" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_on" date,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_schedules_frequency" CHECK ("commerce"."report_schedules"."frequency" in ('daily', 'weekly', 'monthly')),
	CONSTRAINT "report_schedules_day" CHECK (("commerce"."report_schedules"."frequency" = 'weekly') = ("commerce"."report_schedules"."weekday" is not null) and ("commerce"."report_schedules"."frequency" = 'monthly') = ("commerce"."report_schedules"."month_day" is not null)
        and ("commerce"."report_schedules"."weekday" is null or "commerce"."report_schedules"."weekday" between 1 and 7) and ("commerce"."report_schedules"."month_day" is null or "commerce"."report_schedules"."month_day" between 1 and 28)),
	CONSTRAINT "report_schedules_hour" CHECK ("commerce"."report_schedules"."hour" between 0 and 23),
	CONSTRAINT "report_schedules_recipients" CHECK (cardinality("commerce"."report_schedules"."recipients") between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "commerce"."report_schedules" ADD CONSTRAINT "report_schedules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."report_schedules" ADD CONSTRAINT "report_schedules_report_id_saved_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "commerce"."saved_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."report_schedules" ADD CONSTRAINT "report_schedules_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."report_schedules" ADD CONSTRAINT "report_schedules_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_schedules_store_idx" ON "commerce"."report_schedules" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "report_schedules_report_idx" ON "commerce"."report_schedules" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "report_schedules_created_by_idx" ON "commerce"."report_schedules" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "report_schedules_updated_by_idx" ON "commerce"."report_schedules" USING btree ("updated_by");