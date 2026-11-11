-- Kaizena Flow's own front page reads at 4.5:1 (wave 11 unit K, D390, PSI 2026-10-28 ACC-01 and ACC-04). Its site CSS gave the classes
-- `green-text`, `dark-color` (#709900, 3.36:1 on white), `light-color` (#908064, 3.84:1) and `greyed-text` (#999, 2.59:1) colours too
-- light to read, and the front page's main button and the pricing page's plan badge were white on #709900. The same hues, darkened until
-- they read at 4.5:1 on the page's lightest backgrounds (#557400 and #756851, 5.4:1 on white); `greyed-text` takes the theme's secondary
-- text colour, so it reads in both colour sets. Each thing changed keeps its version before the change (D305, D385), so a person can
-- take it back from the CSS panel or the page's versions; a database without these colours is left as it is.

-- The site's CSS, its version kept first.
INSERT INTO commerce.css_versions (store_id, css, created_by, created_at)
SELECT NULL, s.custom_css, NULL, clock_timestamp()
  FROM commerce.platform_settings s
 WHERE s.custom_css ~* '#709900|#908064|color:#999;'
   AND NOT EXISTS (
     SELECT 1 FROM (
       SELECT v.css FROM commerce.css_versions v WHERE v.store_id IS NULL ORDER BY v.created_at DESC, v.id DESC LIMIT 1
     ) newest WHERE newest.css = s.custom_css
   );
--> statement-breakpoint
UPDATE commerce.platform_settings
   SET custom_css = replace(replace(replace(regexp_replace(regexp_replace(custom_css, '#709900', '#557400', 'gi'), '#908064', '#756851', 'gi'),
         '.greyed-text{' || chr(10) || 'color:#999;', '.greyed-text{' || chr(10) || 'color:var(--muted);'),
         '.greyed-text{color:#999;', '.greyed-text{color:var(--muted);'),
         '.greyed-text {' || chr(10) || 'color:#999;', '.greyed-text {' || chr(10) || 'color:var(--muted);')
 WHERE custom_css ~* '#709900|#908064|color:#999;';
--> statement-breakpoint
-- The saved colour "Dark green" in the site's colour library follows, so a colour chosen from it again reads too.
UPDATE commerce.platform_settings
   SET theme = regexp_replace(theme::text, '#709900', '#557400', 'gi')::jsonb
 WHERE theme::text ~* '#709900';
--> statement-breakpoint
-- Kaizena Flow's own pages with the button's or badge's colour: the published content's version kept, then the published and the draft.
INSERT INTO commerce.page_versions (store_id, page_id, kind, content, created_by, created_at)
SELECT NULL, p.id, 'published', p.published, NULL, clock_timestamp()
  FROM commerce.pages p
 WHERE p.store_id IS NULL AND p.published IS NOT NULL AND p.published::text ~* '#709900';
--> statement-breakpoint
UPDATE commerce.pages
   SET published = CASE WHEN published IS NULL THEN NULL ELSE regexp_replace(published::text, '#709900', '#557400', 'gi')::jsonb END,
       draft = CASE WHEN draft IS NULL THEN NULL ELSE regexp_replace(draft::text, '#709900', '#557400', 'gi')::jsonb END
 WHERE store_id IS NULL AND (published::text ~* '#709900' OR draft::text ~* '#709900');
