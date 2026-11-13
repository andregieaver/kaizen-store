CREATE TABLE "commerce"."support_widget_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"widget_id" uuid NOT NULL,
	"host" text NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"checked_at" timestamp with time zone,
	"check_problem" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_widget_sites_host_key" UNIQUE("widget_id","host"),
	CONSTRAINT "support_widget_sites_host_shape" CHECK (length("commerce"."support_widget_sites"."host") between 4 and 253 and "commerce"."support_widget_sites"."host" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'),
	CONSTRAINT "support_widget_sites_verified" CHECK (("commerce"."support_widget_sites"."verified_at" is null) = ("commerce"."support_widget_sites"."verified_by" is null) and ("commerce"."support_widget_sites"."verified_by" is null or "commerce"."support_widget_sites"."verified_by" in ('page', 'dns'))),
	CONSTRAINT "support_widget_sites_check_problem" CHECK ("commerce"."support_widget_sites"."check_problem" is null or "commerce"."support_widget_sites"."check_problem" in ('unreachable', 'not_found', 'moved'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."support_widgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"market" text,
	"privacy_url" text,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_widgets_key" UNIQUE("key"),
	CONSTRAINT "support_widgets_name_key" UNIQUE NULLS NOT DISTINCT("store_id","name"),
	CONSTRAINT "support_widgets_key_shape" CHECK ("commerce"."support_widgets"."key" ~ '^[a-z0-9]{20}$'),
	CONSTRAINT "support_widgets_name" CHECK (length("commerce"."support_widgets"."name") between 1 and 60),
	CONSTRAINT "support_widgets_market" CHECK ("commerce"."support_widgets"."market" is null or ("commerce"."support_widgets"."store_id" is not null and length("commerce"."support_widgets"."market") between 2 and 20)),
	CONSTRAINT "support_widgets_privacy_url" CHECK ("commerce"."support_widgets"."privacy_url" is null or ("commerce"."support_widgets"."privacy_url" ~ '^https://' and length("commerce"."support_widgets"."privacy_url") <= 500)),
	CONSTRAINT "support_widgets_style" CHECK (jsonb_typeof("commerce"."support_widgets"."style") = 'object' and length("commerce"."support_widgets"."style"::text) <= 40000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."support_widget_sites" ADD CONSTRAINT "support_widget_sites_widget_id_support_widgets_id_fk" FOREIGN KEY ("widget_id") REFERENCES "commerce"."support_widgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_widgets" ADD CONSTRAINT "support_widgets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_widgets" ADD CONSTRAINT "support_widgets_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_widgets_created_by_idx" ON "commerce"."support_widgets" USING btree ("created_by");