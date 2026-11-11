CREATE TABLE "commerce"."store_demo_items" (
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_demo_items_store_id_kind_ref_id_pk" PRIMARY KEY("store_id","kind","ref_id"),
	CONSTRAINT "store_demo_items_kind" CHECK ("commerce"."store_demo_items"."kind" in ('product', 'page', 'term'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."store_demo_items" ADD CONSTRAINT "store_demo_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Row-level security, no policy: the commerce schema is private to the server (docs/theme-showcase-phase-1.md step 4b).
ALTER TABLE "commerce"."store_demo_items" ENABLE ROW LEVEL SECURITY;