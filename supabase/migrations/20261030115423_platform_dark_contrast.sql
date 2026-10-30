-- Kaizena Flow's own site reads at 4.5:1 in dark mode too (D408, PSI 2026-10-30 ACC-01 and ACC-04). D390 darkened the site's green to
-- #557400 for its light backgrounds; in dark mode the front page's green words on the page's own background (rows whose background is
-- see-through, so not marked `kz-on-light`) fell to 2.6:1, and the pricing page's badge and filled button, near-black theme text on #557400,
-- to 3.66:1. The words take #7fae00 in dark mode where no light surface is behind them (5.4:1 on the darkest such row); the badge and button
-- take white text, 5.4:1 in both modes. Two columns of white text on a light gradient take dark text (below). Each thing changed keeps its
-- version before the change (D305, D385); a database without these things is left as it is.

-- The site's CSS, its version kept first.
INSERT INTO commerce.css_versions (store_id, css, created_by, created_at)
SELECT NULL, s.custom_css, NULL, clock_timestamp()
  FROM commerce.platform_settings s
 WHERE s.custom_css ~ '\.green-text' AND s.custom_css !~ '#7fae00'
   AND NOT EXISTS (
     SELECT 1 FROM (
       SELECT v.css FROM commerce.css_versions v WHERE v.store_id IS NULL ORDER BY v.created_at DESC, v.id DESC LIMIT 1
     ) newest WHERE newest.css = s.custom_css
   );
--> statement-breakpoint
UPDATE commerce.platform_settings
   SET custom_css = custom_css || $css$

/* Dark mode: the green words where no light row is behind them (D408). */
:root[data-color-mode="dark"] .green-text:not(.kz-on-light .green-text),
:root[data-color-mode="dark"] .super-heading.dark-color:not(.kz-on-light .super-heading){
color:#7fae00;
}
@media (prefers-color-scheme: dark){
:root:not([data-color-mode="light"]) .green-text:not(.kz-on-light .green-text),
:root:not([data-color-mode="light"]) .super-heading.dark-color:not(.kz-on-light .super-heading){
color:#7fae00;
}
}$css$
 WHERE custom_css ~ '\.green-text' AND custom_css !~ '#7fae00';
--> statement-breakpoint
-- The pricing page's own CSS: its published content's version kept, then the published and the draft.
INSERT INTO commerce.page_versions (store_id, page_id, kind, content, created_by, created_at)
SELECT NULL, p.id, 'published', p.published, NULL, clock_timestamp()
  FROM commerce.pages p
 WHERE p.store_id IS NULL AND p.published IS NOT NULL
   AND strpos(p.published::text, '.text-accent-foreground{\nbackground:#557400') > 0;
--> statement-breakpoint
UPDATE commerce.pages
   SET published = CASE WHEN published IS NULL THEN NULL
         ELSE replace(published::text, '.text-accent-foreground{\nbackground:#557400', '.text-accent-foreground{\ncolor:#ffffff;\nbackground:#557400')::jsonb END,
       draft = CASE WHEN draft IS NULL THEN NULL
         ELSE replace(draft::text, '.text-accent-foreground{\nbackground:#557400', '.text-accent-foreground{\ncolor:#ffffff;\nbackground:#557400')::jsonb END
 WHERE store_id IS NULL
   AND (strpos(published::text, '.text-accent-foreground{\nbackground:#557400') > 0 OR strpos(draft::text, '.text-accent-foreground{\nbackground:#557400') > 0);
--> statement-breakpoint
-- The front page's and the page builder page's two columns whose text the page made white on the light gradient (#908064 to #ededed:
-- 2.0 to 2.6:1) take the colour their own headings have, #171717, and "Bulid" is spelt "Build". The published versions kept first.
INSERT INTO commerce.page_versions (store_id, page_id, kind, content, created_by, created_at)
SELECT NULL, p.id, 'published', p.published, NULL, clock_timestamp()
  FROM commerce.pages p
 WHERE p.store_id IS NULL AND p.slug IN ('home', 'page-builder') AND p.published IS NOT NULL
   AND (strpos(p.published::text, '"radius": 20, "typography": {"text": {"color": "#ffffff"}}}') > 0 OR strpos(p.published::text, 'Bulid your store') > 0);
--> statement-breakpoint
UPDATE commerce.pages
   SET published = CASE WHEN published IS NULL THEN NULL
         ELSE replace(replace(published::text, '"radius": 20, "typography": {"text": {"color": "#ffffff"}}}', '"radius": 20, "typography": {"text": {"color": "#171717"}}}'),
           'Bulid your store', 'Build your store')::jsonb END,
       draft = CASE WHEN draft IS NULL THEN NULL
         ELSE replace(replace(draft::text, '"radius": 20, "typography": {"text": {"color": "#ffffff"}}}', '"radius": 20, "typography": {"text": {"color": "#171717"}}}'),
           'Bulid your store', 'Build your store')::jsonb END
 WHERE store_id IS NULL AND slug IN ('home', 'page-builder')
   AND (strpos(published::text, '"radius": 20, "typography": {"text": {"color": "#ffffff"}}}') > 0 OR strpos(published::text, 'Bulid your store') > 0
     OR strpos(coalesce(draft::text, ''), '"radius": 20, "typography": {"text": {"color": "#ffffff"}}}') > 0 OR strpos(coalesce(draft::text, ''), 'Bulid your store') > 0);
