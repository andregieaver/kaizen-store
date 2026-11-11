CREATE TABLE "commerce"."own_speed_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" text NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"screen" text NOT NULL,
	"lcp_ms" integer,
	"inp_ms" integer,
	"cls_milli" integer,
	"ttfb_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "own_speed_samples_site" CHECK ("commerce"."own_speed_samples"."site" in ('platform', 'admin')),
	CONSTRAINT "own_speed_samples_kind" CHECK ("commerce"."own_speed_samples"."kind" in ('home', 'product', 'category', 'list', 'page')),
	CONSTRAINT "own_speed_samples_screen" CHECK ("commerce"."own_speed_samples"."screen" in ('phone', 'computer')),
	CONSTRAINT "own_speed_samples_values" CHECK (coalesce("commerce"."own_speed_samples"."lcp_ms", "commerce"."own_speed_samples"."inp_ms", "commerce"."own_speed_samples"."cls_milli", "commerce"."own_speed_samples"."ttfb_ms") is not null
        and ("commerce"."own_speed_samples"."lcp_ms" is null or "commerce"."own_speed_samples"."lcp_ms" between 0 and 120000) and ("commerce"."own_speed_samples"."inp_ms" is null or "commerce"."own_speed_samples"."inp_ms" between 0 and 60000)
        and ("commerce"."own_speed_samples"."cls_milli" is null or "commerce"."own_speed_samples"."cls_milli" between 0 and 50000) and ("commerce"."own_speed_samples"."ttfb_ms" is null or "commerce"."own_speed_samples"."ttfb_ms" between 0 and 120000))
);
--> statement-breakpoint
CREATE INDEX "own_speed_samples_site_day_idx" ON "commerce"."own_speed_samples" USING btree ("site","day");