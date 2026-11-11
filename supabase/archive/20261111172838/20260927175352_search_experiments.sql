CREATE TABLE "commerce"."search_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"search_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_clicks_position" CHECK ("commerce"."search_clicks"."position" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "commerce"."search_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword_share" real NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"started_by" uuid,
	"ended_by" uuid,
	CONSTRAINT "search_experiments_share" CHECK ("commerce"."search_experiments"."keyword_share" between 0.05 and 0.95),
	CONSTRAINT "search_experiments_times" CHECK ("commerce"."search_experiments"."ended_at" is null or "commerce"."search_experiments"."ended_at" >= "commerce"."search_experiments"."started_at")
);
--> statement-breakpoint
ALTER TABLE "commerce"."search_queries" ADD COLUMN "experiment_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."search_queries" ADD COLUMN "arm" text;--> statement-breakpoint
ALTER TABLE "commerce"."search_clicks" ADD CONSTRAINT "search_clicks_search_id_search_queries_id_fk" FOREIGN KEY ("search_id") REFERENCES "commerce"."search_queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."search_clicks" ADD CONSTRAINT "search_clicks_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."search_experiments" ADD CONSTRAINT "search_experiments_started_by_accounts_id_fk" FOREIGN KEY ("started_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."search_experiments" ADD CONSTRAINT "search_experiments_ended_by_accounts_id_fk" FOREIGN KEY ("ended_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_clicks_search_idx" ON "commerce"."search_clicks" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "search_clicks_product_idx" ON "commerce"."search_clicks" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "search_experiments_started_by_idx" ON "commerce"."search_experiments" USING btree ("started_by");--> statement-breakpoint
CREATE INDEX "search_experiments_ended_by_idx" ON "commerce"."search_experiments" USING btree ("ended_by");--> statement-breakpoint
ALTER TABLE "commerce"."search_queries" ADD CONSTRAINT "search_queries_experiment_id_search_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "commerce"."search_experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_queries_experiment_idx" ON "commerce"."search_queries" USING btree ("experiment_id","arm");--> statement-breakpoint
ALTER TABLE "commerce"."search_queries" ADD CONSTRAINT "search_queries_arm" CHECK (("commerce"."search_queries"."arm" is null) = ("commerce"."search_queries"."experiment_id" is null) and coalesce("commerce"."search_queries"."arm" in ('hybrid', 'keyword'), true));