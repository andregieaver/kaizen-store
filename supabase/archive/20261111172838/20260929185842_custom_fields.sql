CREATE TABLE "commerce"."field_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"location" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" text DEFAULT 'main' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_groups_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "field_groups_store_slug_key" UNIQUE("store_id","slug"),
	CONSTRAINT "field_groups_name" CHECK (length(trim("commerce"."field_groups"."name")) between 1 and 80),
	CONSTRAINT "field_groups_slug" CHECK ("commerce"."field_groups"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "field_groups_position" CHECK ("commerce"."field_groups"."position" in ('main', 'side')),
	CONSTRAINT "field_groups_entities" CHECK (jsonb_typeof("commerce"."field_groups"."entities") = 'array' and jsonb_array_length("commerce"."field_groups"."entities") > 0),
	CONSTRAINT "field_groups_location" CHECK (jsonb_typeof("commerce"."field_groups"."location") = 'array'),
	CONSTRAINT "field_groups_fields" CHECK (jsonb_typeof("commerce"."field_groups"."fields") = 'array')
);
--> statement-breakpoint
CREATE TABLE "commerce"."field_values" (
	"store_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"locale" text DEFAULT '' NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_values_store_id_entity_entity_id_locale_pk" PRIMARY KEY("store_id","entity","entity_id","locale"),
	CONSTRAINT "field_values_entity" CHECK ("commerce"."field_values"."entity" in ('product', 'page', 'article')),
	CONSTRAINT "field_values_values" CHECK (jsonb_typeof("commerce"."field_values"."values") = 'object')
);
--> statement-breakpoint
ALTER TABLE "commerce"."field_groups" ADD CONSTRAINT "field_groups_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."field_values" ADD CONSTRAINT "field_values_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."products" DROP COLUMN "attributes";
--> statement-breakpoint
-- Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.field_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.field_values ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Values name their thing by id only (it may be a product, a page or an
-- article), so no foreign key can take them away with it: these triggers do.
CREATE FUNCTION commerce.forget_field_values() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  DELETE FROM commerce.field_values
   WHERE store_id = OLD.store_id
     AND entity = ANY (string_to_array(TG_ARGV[0], ','))
     AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER products_forget_field_values AFTER DELETE ON commerce.products
  FOR EACH ROW EXECUTE FUNCTION commerce.forget_field_values('product');
--> statement-breakpoint
CREATE TRIGGER pages_forget_field_values AFTER DELETE ON commerce.pages
  FOR EACH ROW EXECUTE FUNCTION commerce.forget_field_values('page,article');
