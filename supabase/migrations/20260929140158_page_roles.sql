CREATE TABLE "commerce"."page_roles" (
	"store_id" uuid NOT NULL,
	"role" text NOT NULL,
	"page_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_roles_store_id_role_pk" PRIMARY KEY("store_id","role"),
	CONSTRAINT "page_roles_store_page_key" UNIQUE("store_id","page_id"),
	CONSTRAINT "page_roles_role" CHECK ("commerce"."page_roles"."role" in ('blog', 'search', 'not_found'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."page_roles" ADD CONSTRAINT "page_roles_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."page_roles" ADD CONSTRAINT "page_roles_page_fk" FOREIGN KEY ("store_id","page_id") REFERENCES "commerce"."pages"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.page_roles ENABLE ROW LEVEL SECURITY;
