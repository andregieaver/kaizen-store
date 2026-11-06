CREATE TABLE "commerce"."house_site_copies" (
	"store_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"copy_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"copied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "house_site_copies_store_id_source_id_pk" PRIMARY KEY("store_id","source_id"),
	CONSTRAINT "house_site_copies_copy_key" UNIQUE("store_id","copy_id"),
	CONSTRAINT "house_site_copies_kind" CHECK ("commerce"."house_site_copies"."kind" in ('page', 'menu', 'saved_part', 'text_style', 'term', 'content_type', 'content_entry'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."house_site_copies" ADD CONSTRAINT "house_site_copies_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;