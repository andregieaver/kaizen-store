CREATE TABLE "commerce"."content_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"type_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"draft" jsonb NOT NULL,
	"published" jsonb,
	"published_at" timestamp with time zone,
	"first_published_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "content_entries_type_slug_key" UNIQUE("type_id","slug"),
	CONSTRAINT "content_entries_slug" CHECK ("commerce"."content_entries"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length("commerce"."content_entries"."slug") <= 120 and "commerce"."content_entries"."slug" <> 'ab'),
	CONSTRAINT "content_entries_draft" CHECK (jsonb_typeof("commerce"."content_entries"."draft") = 'object'),
	CONSTRAINT "content_entries_published" CHECK (("commerce"."content_entries"."published" is null) = ("commerce"."content_entries"."published_at" is null)),
	CONSTRAINT "content_entries_position" CHECK ("commerce"."content_entries"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."content_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title_field" text NOT NULL,
	"summary_field" text,
	"picture_field" text,
	"has_pages" boolean DEFAULT false NOT NULL,
	"layout_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "content_types_store_key_key" UNIQUE NULLS NOT DISTINCT("store_id","key"),
	CONSTRAINT "content_types_store_slug_key" UNIQUE NULLS NOT DISTINCT("store_id","slug"),
	CONSTRAINT "content_types_key" CHECK ("commerce"."content_types"."key" ~ '^t_[0-9a-f]{12}$'),
	CONSTRAINT "content_types_name" CHECK (length(trim("commerce"."content_types"."name")) between 1 and 80),
	CONSTRAINT "content_types_slug" CHECK ("commerce"."content_types"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length("commerce"."content_types"."slug") <= 60),
	CONSTRAINT "content_types_fields" CHECK (jsonb_typeof("commerce"."content_types"."fields") = 'array'),
	CONSTRAINT "content_types_title_field" CHECK ("commerce"."content_types"."title_field" ~ '^f_[a-z0-9]{6,24}$'),
	CONSTRAINT "content_types_position" CHECK ("commerce"."content_types"."position" between 0 and 1000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."content_entries" ADD CONSTRAINT "content_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."content_entries" ADD CONSTRAINT "content_entries_type_id_content_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "commerce"."content_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."content_entries" ADD CONSTRAINT "content_entries_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."content_entries" ADD CONSTRAINT "content_entries_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."content_types" ADD CONSTRAINT "content_types_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."content_types" ADD CONSTRAINT "content_types_layout_id_pages_id_fk" FOREIGN KEY ("layout_id") REFERENCES "commerce"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."content_types" ADD CONSTRAINT "content_types_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_entries_store_type_idx" ON "commerce"."content_entries" USING btree ("store_id","type_id","position");