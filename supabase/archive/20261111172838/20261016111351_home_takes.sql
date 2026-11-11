CREATE TABLE "commerce"."store_home_takes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"pack" text NOT NULL,
	"page_id" uuid,
	"previous_front_page_id" uuid,
	"taken_by" uuid,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "store_home_takes_pack" CHECK ("commerce"."store_home_takes"."pack" ~ '^[a-z0-9][a-z0-9-]{0,39}$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."store_home_takes" ADD CONSTRAINT "store_home_takes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_home_takes" ADD CONSTRAINT "store_home_takes_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "commerce"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_home_takes" ADD CONSTRAINT "store_home_takes_previous_front_page_id_pages_id_fk" FOREIGN KEY ("previous_front_page_id") REFERENCES "commerce"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_home_takes" ADD CONSTRAINT "store_home_takes_taken_by_accounts_id_fk" FOREIGN KEY ("taken_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_home_takes_store_idx" ON "commerce"."store_home_takes" USING btree ("store_id","taken_at");--> statement-breakpoint
CREATE INDEX "store_home_takes_page_idx" ON "commerce"."store_home_takes" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "store_home_takes_previous_idx" ON "commerce"."store_home_takes" USING btree ("previous_front_page_id");--> statement-breakpoint
CREATE INDEX "store_home_takes_taken_by_idx" ON "commerce"."store_home_takes" USING btree ("taken_by");--> statement-breakpoint
-- Row-level security, no policy: the commerce schema is private to the server (docs/theme-showcase-phase-1.md step 4c).
ALTER TABLE "commerce"."store_home_takes" ENABLE ROW LEVEL SECURITY;
