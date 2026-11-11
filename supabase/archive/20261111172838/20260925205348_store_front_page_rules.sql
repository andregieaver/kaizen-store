-- A store's front page (D54) is one of its own pages. Deleting the page
-- sets only front_page_id back to null (the store's id stays), so the
-- store shows its product list again.
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_front_page_fk"
  FOREIGN KEY ("id", "front_page_id") REFERENCES "commerce"."pages" ("store_id", "id")
  ON DELETE SET NULL ("front_page_id");
