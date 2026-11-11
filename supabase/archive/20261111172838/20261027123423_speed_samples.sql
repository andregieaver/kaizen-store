CREATE TABLE "commerce"."speed_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"screen" text NOT NULL,
	"lcp_ms" integer,
	"inp_ms" integer,
	"cls_milli" integer,
	"ttfb_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "speed_samples_kind" CHECK ("commerce"."speed_samples"."kind" in ('home', 'product', 'category', 'list', 'page')),
	CONSTRAINT "speed_samples_screen" CHECK ("commerce"."speed_samples"."screen" in ('phone', 'computer')),
	CONSTRAINT "speed_samples_values" CHECK (coalesce("commerce"."speed_samples"."lcp_ms", "commerce"."speed_samples"."inp_ms", "commerce"."speed_samples"."cls_milli", "commerce"."speed_samples"."ttfb_ms") is not null
        and ("commerce"."speed_samples"."lcp_ms" is null or "commerce"."speed_samples"."lcp_ms" between 0 and 120000) and ("commerce"."speed_samples"."inp_ms" is null or "commerce"."speed_samples"."inp_ms" between 0 and 60000)
        and ("commerce"."speed_samples"."cls_milli" is null or "commerce"."speed_samples"."cls_milli" between 0 and 50000) and ("commerce"."speed_samples"."ttfb_ms" is null or "commerce"."speed_samples"."ttfb_ms" between 0 and 120000))
);
--> statement-breakpoint
CREATE INDEX "speed_samples_store_day_idx" ON "commerce"."speed_samples" USING btree ("store_id","day");