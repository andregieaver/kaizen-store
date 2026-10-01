CREATE TABLE "commerce"."platform_page_roles" (
	"role" text PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "platform_page_roles_page_key" UNIQUE("page_id"),
	CONSTRAINT "platform_page_roles_role" CHECK ("commerce"."platform_page_roles"."role" in ('front', 'blog', 'not_found'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_page_roles" ADD CONSTRAINT "platform_page_roles_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "commerce"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_page_roles" ADD CONSTRAINT "platform_page_roles_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_page_roles_updated_by_idx" ON "commerce"."platform_page_roles" USING btree ("updated_by");--> statement-breakpoint
-- Kaizen's pages with a place of their own (D143): private, read and written only by server code with a direct connection.
ALTER TABLE commerce.platform_page_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Only a page of Kaizen's own (type `page`, no store) can hold a place, and a place is taken from a page that is still
-- a page of Kaizen's, checked when a place is given or moved.
CREATE FUNCTION commerce.platform_page_role_is_kaizens_page() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = NEW.page_id AND p.store_id IS NULL AND p.type = 'page') THEN
    RAISE EXCEPTION 'platform_page_roles.page: only one of Kaizen''s own pages can have a place on its site' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER platform_page_roles_page_check
  BEFORE INSERT OR UPDATE OF page_id ON commerce.platform_page_roles
  FOR EACH ROW EXECUTE FUNCTION commerce.platform_page_role_is_kaizens_page();
