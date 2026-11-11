CREATE TABLE "commerce"."search_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"action" text NOT NULL,
	"product_id" uuid,
	"term_id" uuid,
	"content_type" text DEFAULT 'product' NOT NULL,
	"target" text,
	"queries" text[] DEFAULT '{}'::text[] NOT NULL,
	"match" text DEFAULT 'contains' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_rules_action" CHECK ("commerce"."search_rules"."action" in ('pin', 'boost', 'bury', 'redirect')),
	CONSTRAINT "search_rules_match" CHECK ("commerce"."search_rules"."match" in ('contains', 'exact')),
	CONSTRAINT "search_rules_content_type" CHECK ("commerce"."search_rules"."content_type" = 'product'),
	CONSTRAINT "search_rules_position" CHECK ("commerce"."search_rules"."position" between 0 and 1000),
	CONSTRAINT "search_rules_queries" CHECK (cardinality("commerce"."search_rules"."queries") <= 20),
	CONSTRAINT "search_rules_shape" CHECK (case "commerce"."search_rules"."action"
        when 'pin' then "commerce"."search_rules"."product_id" is not null and "commerce"."search_rules"."term_id" is null and "commerce"."search_rules"."target" is null and cardinality("commerce"."search_rules"."queries") >= 1
        when 'redirect' then "commerce"."search_rules"."target" is not null and "commerce"."search_rules"."product_id" is null and "commerce"."search_rules"."term_id" is null and cardinality("commerce"."search_rules"."queries") >= 1
        else "commerce"."search_rules"."target" is null and (("commerce"."search_rules"."product_id" is null) <> ("commerce"."search_rules"."term_id" is null)) end)
);
--> statement-breakpoint
ALTER TABLE "commerce"."search_queries" ADD COLUMN "redirected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."search_rules" ADD CONSTRAINT "search_rules_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."search_rules" ADD CONSTRAINT "search_rules_term_fk" FOREIGN KEY ("store_id","content_type","term_id") REFERENCES "commerce"."terms"("store_id","content_type","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_rules_store_idx" ON "commerce"."search_rules" USING btree ("store_id","position");--> statement-breakpoint
CREATE INDEX "search_rules_product_idx" ON "commerce"."search_rules" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "search_rules_term_idx" ON "commerce"."search_rules" USING btree ("store_id","content_type","term_id");