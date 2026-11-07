-- A store's menu links a page or an article by its slug; Kaizena Flow's own menus link one by its id (D85). The copy of Kaizena Flow's site
-- into its own store (`copy_platform_site()`, D469) moved each id to the copy's but kept the id, so the store's menus could not read a page
-- link and dropped every one: kaizenaflow.com's header showed only its "#" groups once it was served from the store (D484). Now a store's
-- menu is written with a page's or an article's slug whatever wrote it: a link by `pageId` to a page of the same store becomes a link by its
-- slug. A link to a page the store has not got stays as it was (a store's menu shows nothing for it, as before). Kaizena Flow's own menus
-- (`store_id` null) keep their ids. The menus written so far are written again, so the rule applies to them too.

CREATE OR REPLACE FUNCTION commerce.menus_store_page_links()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.store_id IS NULL OR jsonb_typeof(NEW.items) <> 'array'
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.items) e WHERE jsonb_typeof(e -> 'link') = 'object' AND (e -> 'link') ? 'pageId') THEN
    RETURN NEW;
  END IF;
  NEW.items := (
    SELECT coalesce(jsonb_agg(
             CASE WHEN jsonb_typeof(x.e -> 'link') = 'object' AND (x.e -> 'link') ? 'pageId' AND p.slug IS NOT NULL
                       AND (x.e -> 'link' ->> 'kind') IN ('page', 'article')
                  THEN jsonb_set(x.e, '{link}', jsonb_build_object('kind', x.e -> 'link' ->> 'kind', 'slug', p.slug))
                  ELSE x.e END
             ORDER BY x.n), '[]'::jsonb)
      FROM jsonb_array_elements(NEW.items) WITH ORDINALITY x(e, n)
      LEFT JOIN commerce.pages p ON p.id::text = x.e -> 'link' ->> 'pageId' AND p.store_id = NEW.store_id
  );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS menus_store_page_links ON commerce.menus;
CREATE TRIGGER menus_store_page_links
  BEFORE INSERT OR UPDATE OF items, store_id ON commerce.menus
  FOR EACH ROW EXECUTE FUNCTION commerce.menus_store_page_links();

UPDATE commerce.menus SET items = items
 WHERE store_id IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(items) e WHERE jsonb_typeof(e -> 'link') = 'object' AND (e -> 'link') ? 'pageId');
