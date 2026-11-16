CREATE TABLE "commerce"."click_cells" (
	"store_id" uuid NOT NULL,
	"day" date NOT NULL,
	"page" text NOT NULL,
	"device" text NOT NULL,
	"tag" text DEFAULT '' NOT NULL,
	"anchor" text NOT NULL,
	"cx" smallint NOT NULL,
	"cy" smallint NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"dead" integer DEFAULT 0 NOT NULL,
	"rage" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "click_cells_store_id_day_page_device_tag_anchor_cx_cy_pk" PRIMARY KEY("store_id","day","page","device","tag","anchor","cx","cy"),
	CONSTRAINT "click_cells_page" CHECK (char_length("commerce"."click_cells"."page") between 1 and 300),
	CONSTRAINT "click_cells_device" CHECK ("commerce"."click_cells"."device" in ('mobile', 'tablet', 'desktop')),
	CONSTRAINT "click_cells_tag" CHECK ("commerce"."click_cells"."tag" = '' or "commerce"."click_cells"."tag" ~ '^[0-9a-f-]{36}:[a-d]$'),
	CONSTRAINT "click_cells_anchor" CHECK (char_length("commerce"."click_cells"."anchor") between 1 and 60),
	CONSTRAINT "click_cells_cell" CHECK ("commerce"."click_cells"."cx" between 0 and 9 and "commerce"."click_cells"."cy" between 0 and 9)
);
--> statement-breakpoint
CREATE TABLE "commerce"."page_heat_days" (
	"store_id" uuid NOT NULL,
	"day" date NOT NULL,
	"page" text NOT NULL,
	"device" text NOT NULL,
	"tag" text DEFAULT '' NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"reach" integer[] NOT NULL,
	"fold_sum" bigint DEFAULT 0 NOT NULL,
	"attention_ms" bigint[] NOT NULL,
	"att_height_sum" bigint DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"dead_clicks" integer DEFAULT 0 NOT NULL,
	"rage_clicks" integer DEFAULT 0 NOT NULL,
	"dead_views" integer DEFAULT 0 NOT NULL,
	"rage_views" integer DEFAULT 0 NOT NULL,
	"frustrated_views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "page_heat_days_store_id_day_page_device_tag_pk" PRIMARY KEY("store_id","day","page","device","tag"),
	CONSTRAINT "page_heat_days_page" CHECK (char_length("commerce"."page_heat_days"."page") between 1 and 300),
	CONSTRAINT "page_heat_days_device" CHECK ("commerce"."page_heat_days"."device" in ('mobile', 'tablet', 'desktop')),
	CONSTRAINT "page_heat_days_tag" CHECK ("commerce"."page_heat_days"."tag" = '' or "commerce"."page_heat_days"."tag" ~ '^[0-9a-f-]{36}:[a-d]$'),
	CONSTRAINT "page_heat_days_arrays" CHECK (cardinality("commerce"."page_heat_days"."reach") = 21 and cardinality("commerce"."page_heat_days"."attention_ms") = 20),
	CONSTRAINT "page_heat_days_counts" CHECK ("commerce"."page_heat_days"."views" >= 0 and "commerce"."page_heat_days"."clicks" >= 0 and "commerce"."page_heat_days"."dead_clicks" >= 0 and "commerce"."page_heat_days"."rage_clicks" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."click_cells" ADD CONSTRAINT "click_cells_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_heat_days" ADD CONSTRAINT "page_heat_days_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Row-level security, no policy: the commerce schema is private to the server.
ALTER TABLE "commerce"."click_cells" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."page_heat_days" ENABLE ROW LEVEL SECURITY;
