CREATE TABLE "commerce"."platform_admin_click_cells" (
	"day" date NOT NULL,
	"screen" text NOT NULL,
	"device" text NOT NULL,
	"anchor" text NOT NULL,
	"cx" smallint NOT NULL,
	"cy" smallint NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"dead" integer DEFAULT 0 NOT NULL,
	"rage" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "platform_admin_click_cells_day_screen_device_anchor_cx_cy_pk" PRIMARY KEY("day","screen","device","anchor","cx","cy"),
	CONSTRAINT "platform_admin_click_cells_screen" CHECK ("commerce"."platform_admin_click_cells"."screen" ~ '^(s|a)(/[a-z0-9-]{1,30}){0,2}$'),
	CONSTRAINT "platform_admin_click_cells_device" CHECK ("commerce"."platform_admin_click_cells"."device" in ('mobile', 'tablet', 'desktop')),
	CONSTRAINT "platform_admin_click_cells_anchor" CHECK (char_length("commerce"."platform_admin_click_cells"."anchor") between 1 and 60),
	CONSTRAINT "platform_admin_click_cells_cell" CHECK ("commerce"."platform_admin_click_cells"."cx" between 0 and 9 and "commerce"."platform_admin_click_cells"."cy" between 0 and 9)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_admin_click_cells" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."platform_admin_heat_days" (
	"day" date NOT NULL,
	"screen" text NOT NULL,
	"device" text NOT NULL,
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
	CONSTRAINT "platform_admin_heat_days_day_screen_device_pk" PRIMARY KEY("day","screen","device"),
	CONSTRAINT "platform_admin_heat_days_screen" CHECK ("commerce"."platform_admin_heat_days"."screen" ~ '^(s|a)(/[a-z0-9-]{1,30}){0,2}$'),
	CONSTRAINT "platform_admin_heat_days_device" CHECK ("commerce"."platform_admin_heat_days"."device" in ('mobile', 'tablet', 'desktop')),
	CONSTRAINT "platform_admin_heat_days_arrays" CHECK (cardinality("commerce"."platform_admin_heat_days"."reach") = 21 and cardinality("commerce"."platform_admin_heat_days"."attention_ms") = 20),
	CONSTRAINT "platform_admin_heat_days_counts" CHECK ("commerce"."platform_admin_heat_days"."views" >= 0 and "commerce"."platform_admin_heat_days"."clicks" >= 0 and "commerce"."platform_admin_heat_days"."dead_clicks" >= 0 and "commerce"."platform_admin_heat_days"."rage_clicks" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_admin_heat_days" ENABLE ROW LEVEL SECURITY;