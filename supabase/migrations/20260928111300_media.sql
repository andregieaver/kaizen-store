CREATE TABLE "commerce"."media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"thumbnail_url" text,
	"bucket" text NOT NULL,
	"path" text NOT NULL,
	"thumbnail_path" text,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"alt" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_url_key" UNIQUE("url"),
	CONSTRAINT "media_kind" CHECK ("commerce"."media"."kind" in ('image', 'video')),
	CONSTRAINT "media_file_name" CHECK (length(trim("commerce"."media"."file_name")) between 1 and 255),
	CONSTRAINT "media_alt" CHECK (length("commerce"."media"."alt") <= 500),
	CONSTRAINT "media_size" CHECK ("commerce"."media"."size_bytes" >= 0),
	CONSTRAINT "media_dimensions" CHECK (("commerce"."media"."width" is null and "commerce"."media"."height" is null) or ("commerce"."media"."width" is not null and "commerce"."media"."height" is not null and "commerce"."media"."width" > 0 and "commerce"."media"."height" > 0))
);
--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD CONSTRAINT "media_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD CONSTRAINT "media_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_store_created_idx" ON "commerce"."media" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "media_created_by_idx" ON "commerce"."media" USING btree ("created_by");