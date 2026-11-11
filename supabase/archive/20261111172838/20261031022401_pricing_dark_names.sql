-- The pricing page's plan names read in dark mode too (PSI 2026-10-30 ACC-01, ACC-04; found by the scan of production in both colour
-- modes, 31 October 2026). The plans block gave its names the colour #171717 in both modes, while its cards follow the colour mode: in dark
-- mode that is #171717 on #1c1c1c, 1.05:1, and the names could not be read. The block's own name colour is taken away, so the names take
-- the cards' text colour (#171717 in light mode, as before; #ededed in dark mode). The published version is kept first (D305); a database
-- without this block is left as it is.
INSERT INTO commerce.page_versions (store_id, page_id, kind, content, created_by, created_at)
SELECT NULL, p.id, 'published', p.published, NULL, clock_timestamp()
  FROM commerce.pages p
 WHERE p.store_id IS NULL AND p.slug = 'pricing' AND p.published IS NOT NULL
   AND strpos(p.published::text, '"comparison": true, "typography": {"name": {"color": "#171717"}}, ') > 0;
--> statement-breakpoint
UPDATE commerce.pages
   SET published = CASE WHEN published IS NULL THEN NULL
         ELSE replace(published::text, '"comparison": true, "typography": {"name": {"color": "#171717"}}, ', '"comparison": true, ')::jsonb END,
       draft = CASE WHEN draft IS NULL THEN NULL
         ELSE replace(draft::text, '"comparison": true, "typography": {"name": {"color": "#171717"}}, ', '"comparison": true, ')::jsonb END
 WHERE store_id IS NULL AND slug = 'pricing'
   AND (strpos(coalesce(published::text, ''), '"comparison": true, "typography": {"name": {"color": "#171717"}}, ') > 0
     OR strpos(coalesce(draft::text, ''), '"comparison": true, "typography": {"name": {"color": "#171717"}}, ') > 0);
