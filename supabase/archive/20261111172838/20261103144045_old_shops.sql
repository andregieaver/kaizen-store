CREATE TABLE "commerce"."old_shops" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"origin" text NOT NULL,
	"paths" text[] NOT NULL,
	"files" integer NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"read_by" uuid,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "old_shops_origin" CHECK ("commerce"."old_shops"."origin" ~ '^https?://[^/?#]+$' and length("commerce"."old_shops"."origin") <= 300),
	CONSTRAINT "old_shops_paths" CHECK (cardinality("commerce"."old_shops"."paths") <= 20000),
	CONSTRAINT "old_shops_files" CHECK ("commerce"."old_shops"."files" between 0 and 1000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."old_shops" ADD CONSTRAINT "old_shops_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."old_shops" ADD CONSTRAINT "old_shops_read_by_accounts_id_fk" FOREIGN KEY ("read_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "old_shops_read_by_idx" ON "commerce"."old_shops" USING btree ("read_by");--> statement-breakpoint
ALTER TABLE "commerce"."old_shops" ENABLE ROW LEVEL SECURITY;