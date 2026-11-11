CREATE TABLE "commerce"."store_starters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"picture_url" text,
	"position" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_starters_category" CHECK ("commerce"."store_starters"."category" in ('appointments', 'retail', 'downloads', 'rentals_stays', 'subscriptions', 'services', 'other')),
	CONSTRAINT "store_starters_title" CHECK (length(btrim("commerce"."store_starters"."title")) between 1 and 80),
	CONSTRAINT "store_starters_summary" CHECK (length("commerce"."store_starters"."summary") <= 200),
	CONSTRAINT "store_starters_description" CHECK (length("commerce"."store_starters"."description") <= 2000),
	CONSTRAINT "store_starters_picture_url" CHECK ("commerce"."store_starters"."picture_url" is null or (length("commerce"."store_starters"."picture_url") <= 2000 and "commerce"."store_starters"."picture_url" ~ '^(https://|/[^/])'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD COLUMN "starter_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "starter" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "made_from_starter" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD CONSTRAINT "store_starters_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD CONSTRAINT "store_starters_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD CONSTRAINT "store_starters_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_starters_store_idx" ON "commerce"."store_starters" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_starters_offered_idx" ON "commerce"."store_starters" USING btree ("published","position");--> statement-breakpoint
CREATE INDEX "store_starters_created_by_idx" ON "commerce"."store_starters" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "store_starters_updated_by_idx" ON "commerce"."store_starters" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD CONSTRAINT "access_requests_starter_id_store_starters_id_fk" FOREIGN KEY ("starter_id") REFERENCES "commerce"."store_starters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_made_from_starter_store_starters_id_fk" FOREIGN KEY ("made_from_starter") REFERENCES "commerce"."store_starters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_requests_starter_idx" ON "commerce"."access_requests" USING btree ("starter_id");--> statement-breakpoint
CREATE INDEX "stores_made_from_starter_idx" ON "commerce"."stores" USING btree ("made_from_starter");--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_starter_not_template" CHECK (not ("commerce"."stores"."starter" and "commerce"."stores"."is_template"));