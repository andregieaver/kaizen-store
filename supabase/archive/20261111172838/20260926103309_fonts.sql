CREATE TABLE "commerce"."font_files" (
	"name" text PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "font_files_name" CHECK ("commerce"."font_files"."name" ~ '^[0-9a-f]{32}\.woff2$'),
	CONSTRAINT "font_files_size" CHECK (octet_length("commerce"."font_files"."data") between 1 and 2000000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."fonts" (
	"family" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"category" text NOT NULL,
	"css" text NOT NULL,
	"bytes" integer NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fonts_slug_unique" UNIQUE("slug"),
	CONSTRAINT "fonts_slug" CHECK ("commerce"."fonts"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "fonts_category" CHECK ("commerce"."fonts"."category" in ('sans-serif', 'serif', 'display', 'handwriting', 'monospace'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "fonts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "fonts" jsonb DEFAULT '{}'::jsonb NOT NULL;