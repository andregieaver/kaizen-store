CREATE TABLE "commerce"."search_cache" (
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" char(32) NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_cache_store_id_kind_key_pk" PRIMARY KEY("store_id","kind","key"),
	CONSTRAINT "search_cache_kind" CHECK ("commerce"."search_cache"."kind" in ('vector', 'filters'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."search_cache" ADD CONSTRAINT "search_cache_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_cache_created_idx" ON "commerce"."search_cache" USING btree ("created_at");