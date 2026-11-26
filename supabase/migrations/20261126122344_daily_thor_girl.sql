CREATE TABLE "commerce"."search_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"term" text NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"own_position" integer,
	"positions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"previous_position" integer,
	"previous_at" timestamp with time zone,
	"tried_at" timestamp with time zone,
	"problem" text,
	CONSTRAINT "search_terms_key" UNIQUE("store_id","market_code","term"),
	CONSTRAINT "search_terms_market" CHECK ("commerce"."search_terms"."market_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "search_terms_term" CHECK (length("commerce"."search_terms"."term") between 2 and 80),
	CONSTRAINT "search_terms_positions" CHECK (jsonb_typeof("commerce"."search_terms"."positions") = 'object'),
	CONSTRAINT "search_terms_places" CHECK (("commerce"."search_terms"."own_position" is null or "commerce"."search_terms"."own_position" between 1 and 100) and ("commerce"."search_terms"."previous_position" is null or "commerce"."search_terms"."previous_position" between 1 and 100)),
	CONSTRAINT "search_terms_problem" CHECK ("commerce"."search_terms"."problem" is null or "commerce"."search_terms"."problem" in ('off', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."search_terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."search_terms" ADD CONSTRAINT "search_terms_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."search_terms" ADD CONSTRAINT "search_terms_added_by_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_terms_added_by_idx" ON "commerce"."search_terms" USING btree ("added_by");--> statement-breakpoint
CREATE INDEX "search_terms_tried_idx" ON "commerce"."search_terms" USING btree ("tried_at");