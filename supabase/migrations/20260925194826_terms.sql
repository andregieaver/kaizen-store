CREATE TABLE "commerce"."product_terms" (
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"content_type" text DEFAULT 'product' NOT NULL,
	CONSTRAINT "product_terms_product_id_term_id_pk" PRIMARY KEY("product_id","term_id"),
	CONSTRAINT "product_terms_content_type" CHECK ("commerce"."product_terms"."content_type" = 'product')
);
--> statement-breakpoint
CREATE TABLE "commerce"."terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"content_type" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_scope_slug_key" UNIQUE NULLS NOT DISTINCT("store_id","content_type","kind","slug"),
	CONSTRAINT "terms_store_content_id_key" UNIQUE("store_id","content_type","id"),
	CONSTRAINT "terms_content_type" CHECK ("commerce"."terms"."content_type" in ('page', 'article', 'product')),
	CONSTRAINT "terms_kind" CHECK ("commerce"."terms"."kind" in ('category', 'tag')),
	CONSTRAINT "terms_products_in_stores" CHECK ("commerce"."terms"."content_type" <> 'product' or "commerce"."terms"."store_id" is not null),
	CONSTRAINT "terms_tags_flat" CHECK ("commerce"."terms"."kind" = 'category' or "commerce"."terms"."parent_id" is null),
	CONSTRAINT "terms_not_own_parent" CHECK ("commerce"."terms"."parent_id" is null or "commerce"."terms"."parent_id" <> "commerce"."terms"."id"),
	CONSTRAINT "terms_name" CHECK (length(trim("commerce"."terms"."name")) between 1 and 80),
	CONSTRAINT "terms_slug_format" CHECK ("commerce"."terms"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length("commerce"."terms"."slug") <= 80)
);
--> statement-breakpoint
ALTER TABLE "commerce"."product_terms" ADD CONSTRAINT "product_terms_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_terms" ADD CONSTRAINT "product_terms_term_fk" FOREIGN KEY ("store_id","content_type","term_id") REFERENCES "commerce"."terms"("store_id","content_type","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD CONSTRAINT "terms_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD CONSTRAINT "terms_parent_id_terms_id_fk" FOREIGN KEY ("parent_id") REFERENCES "commerce"."terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_terms_product_idx" ON "commerce"."product_terms" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "product_terms_term_idx" ON "commerce"."product_terms" USING btree ("store_id","content_type","term_id");--> statement-breakpoint
CREATE INDEX "terms_scope_idx" ON "commerce"."terms" USING btree ("store_id","content_type","kind","position");--> statement-breakpoint
CREATE INDEX "terms_parent_idx" ON "commerce"."terms" USING btree ("parent_id");