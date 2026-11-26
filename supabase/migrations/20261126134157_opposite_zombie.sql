CREATE TABLE "commerce"."site_speeds" (
	"store_id" uuid NOT NULL,
	"site" text NOT NULL,
	"own" boolean NOT NULL,
	"lcp_ms" integer,
	"inp_ms" integer,
	"cls_milli" integer,
	"period_end" date,
	"checked_at" timestamp with time zone,
	"tried_at" timestamp with time zone DEFAULT now() NOT NULL,
	"problem" text,
	CONSTRAINT "site_speeds_pkey" PRIMARY KEY("store_id","site"),
	CONSTRAINT "site_speeds_site" CHECK (length("commerce"."site_speeds"."site") between 3 and 300),
	CONSTRAINT "site_speeds_figures" CHECK (("commerce"."site_speeds"."lcp_ms" is null or "commerce"."site_speeds"."lcp_ms" >= 0) and ("commerce"."site_speeds"."inp_ms" is null or "commerce"."site_speeds"."inp_ms" >= 0) and ("commerce"."site_speeds"."cls_milli" is null or "commerce"."site_speeds"."cls_milli" >= 0)),
	CONSTRAINT "site_speeds_problem" CHECK ("commerce"."site_speeds"."problem" is null or "commerce"."site_speeds"."problem" in ('none', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."site_speeds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."speed_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"single" boolean DEFAULT true NOT NULL,
	"key_encrypted" text NOT NULL,
	"key_hint" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "speed_settings_single_key" UNIQUE("single"),
	CONSTRAINT "speed_settings_single" CHECK ("commerce"."speed_settings"."single")
);
--> statement-breakpoint
ALTER TABLE "commerce"."speed_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."site_speeds" ADD CONSTRAINT "site_speeds_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."speed_settings" ADD CONSTRAINT "speed_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_speeds_tried_idx" ON "commerce"."site_speeds" USING btree ("tried_at");--> statement-breakpoint
CREATE INDEX "speed_settings_updated_by_idx" ON "commerce"."speed_settings" USING btree ("updated_by");