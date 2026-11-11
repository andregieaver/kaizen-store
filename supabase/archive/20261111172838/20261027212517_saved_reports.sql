CREATE TABLE "commerce"."saved_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"spec" jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_reports_title" CHECK (length(btrim("commerce"."saved_reports"."title")) between 1 and 80),
	CONSTRAINT "saved_reports_spec" CHECK (jsonb_typeof("commerce"."saved_reports"."spec") = 'object' and length("commerce"."saved_reports"."spec"::text) <= 20000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."saved_reports" ADD CONSTRAINT "saved_reports_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."saved_reports" ADD CONSTRAINT "saved_reports_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."saved_reports" ADD CONSTRAINT "saved_reports_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_reports_store_idx" ON "commerce"."saved_reports" USING btree ("store_id","title");--> statement-breakpoint
CREATE INDEX "saved_reports_created_by_idx" ON "commerce"."saved_reports" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "saved_reports_updated_by_idx" ON "commerce"."saved_reports" USING btree ("updated_by");