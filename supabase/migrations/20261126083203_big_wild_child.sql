CREATE TABLE "commerce"."rival_pages" (
	"store_id" uuid NOT NULL,
	"rival_id" uuid NOT NULL,
	"path" text NOT NULL,
	"section" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gone_at" timestamp with time zone,
	CONSTRAINT "rival_pages_pkey" PRIMARY KEY("store_id","rival_id","path"),
	CONSTRAINT "rival_pages_path" CHECK ("commerce"."rival_pages"."path" ~ '^/' and length("commerce"."rival_pages"."path") <= 500),
	CONSTRAINT "rival_pages_section" CHECK ("commerce"."rival_pages"."section" is null or length("commerce"."rival_pages"."section") <= 120)
);
--> statement-breakpoint
ALTER TABLE "commerce"."rival_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."market_rivals" ADD COLUMN "site_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."market_rivals" ADD COLUMN "site_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."market_rivals" ADD COLUMN "site_pages" integer;--> statement-breakpoint
ALTER TABLE "commerce"."market_rivals" ADD COLUMN "site_cut" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."market_rivals" ADD COLUMN "site_problem" text;--> statement-breakpoint
ALTER TABLE "commerce"."rival_pages" ADD CONSTRAINT "rival_pages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."rival_pages" ADD CONSTRAINT "rival_pages_rival_fk" FOREIGN KEY ("store_id","rival_id") REFERENCES "commerce"."market_rivals"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rival_pages_seen_idx" ON "commerce"."rival_pages" USING btree ("store_id","rival_id","first_seen_at");--> statement-breakpoint
CREATE INDEX "market_rivals_site_read_idx" ON "commerce"."market_rivals" USING btree ("site_read_at");--> statement-breakpoint
ALTER TABLE "commerce"."market_rivals" ADD CONSTRAINT "market_rivals_site_problem" CHECK ("commerce"."market_rivals"."site_problem" is null or "commerce"."market_rivals"."site_problem" in ('robots', 'unread', 'none'));--> statement-breakpoint
ALTER TABLE "commerce"."market_rivals" ADD CONSTRAINT "market_rivals_site_pages" CHECK ("commerce"."market_rivals"."site_pages" is null or "commerce"."market_rivals"."site_pages" >= 0);