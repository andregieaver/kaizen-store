# PM-7 ✓ Each row repeats the same stylesheet text in the payload and the same cached store lookups

The page builder's model and a built page's render (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P3. **Effort:** S. **Confidence:** medium. **Step:** 2.3.
- **Second check:** corrected.
- **Where:** `src/components/page-article.tsx:197`, `src/components/page-article.tsx:223`, `src/components/part-styles.tsx:40`, `src/components/store-theme.tsx:31`, `src/components/site-parts.tsx:345`, `src/server/theme-elements.ts:10`, `src/server/store-links.ts:15`, `src/server/breakpoints.ts:12`
- **Evidence:** RowView draws PartStyles for its one row (page-article.tsx:223), and a store's PartStyles draws the breakpoint sheet again (part-styles.tsx:40-48), though the layout already drew it (store-theme.tsx:31). React keeps one copy in the HTML head, but the payload carries the text each time: in the captured one-row page the 1,760 B sheet is three text rows (the layout's, the layout's second copy from PM-1, and the row's). Generated for the Orbit home (6 rows): per-row part sheets sum to 4,982 B against 3,071 B as one sheet, plus 6 times 1,760 B of breakpoint sheet. Each store row also awaits themeLayersFor, storeLinkBase and breakpointsFor (page-article.tsx:198, part-styles.tsx:42): six `use cache` calls a row.
- **Cost today:** Orbit home: about 15.5 KB of style text in the payload against 4.8 KB if sent once (computed from the generated CSS, not from a rendered page). Almost none of it reaches the wire: a repeated breakpoint sheet costs 15 to 18 B gzip and nothing with Brotli. What is left is a little parsing in the browser and six cached reads a row on each server render. Paid by: The server per render; a shopper's browser, slightly
- **Saving:** Computed for the Orbit home: 10.7 KB raw of payload and 1.9 KB of HTML style; well under 0.5 KB on the wire (estimate). Cached reads fall from six a row to three a page.
- **Risk:** A row drawn outside PageArticle and outside a store layout (a preview, a template's drawing) must still get its breakpoint sheet: `bare` is opt-in. A wrong move shows as a row without its per-size rules, which e2e/responsive-parity.spec.ts catches.

## The fix

1. src/components/part-styles.tsx: give PartStyles a `bare` prop that leaves the BreakpointSheet out, for rows drawn inside a store's layout, which draws that sheet itself (store-theme.tsx:31). Previews in the admin keep it.
2. src/components/page-article.tsx: add an async ArticleStyles({ rows, place }) drawn once by PageArticle before its rows: it awaits the theme layers (place.theme, else themeLayersFor(place.owner)), lays them under all rows with themedRows(), and draws one PartStyles for them. RowView takes a `styled` flag and then draws no PartStyles of its own. A modal's row and a row behind a visibility hole get their rules from the article's sheet, which sits outside the holes.
3. The same for a header's or footer's rows (src/components/site-parts.tsx:345): one sheet for the layout's rows.
4. Resolve the theme layers and the link base once per article and hand them down on `place` (GridPlace already has `theme`; add `linkBase`), so StoreRowView awaits nothing when both are there.

**Done when:** the review's working files (not kept) on a capture of a seeded six-row page (PM-14's page) counts the 1,760-byte breakpoint sheet once (the layout's), whatever the number of rows; today it is the layout's, the layout's second copy and one more per row.

**Tests and rules that hold today's behaviour, and change with it:**

- src/components/page-article-theme.test.ts, page-article-motion.test.ts, page-article-binding.test.ts, page-article-edit-marks.test.ts, row-lines-render.test.ts, page-modal.test.ts and background-layers.test.ts draw rows through PageArticle or PageRowView and read the styles: they change with it.
- e2e/responsive-parity.spec.ts (per-size rules reach the page), e2e/components.spec.ts, e2e/store-pages.spec.ts.
- The written rule is the comment at src/components/part-styles.tsx:52-57 (every place that draws rows draws their part stylesheet beside them, PageRowView); check docs/rules/admin/website.md:272 (Responsive editing) for the same sentence. Kept: the sheet moves from each row to the article or layout that holds the rows, and the comment says so.

**Comes after:** PM-1 (removes one of the three copies of the breakpoint sheet by itself)

**Notes:** True, and close to nothing for a visitor once compressed: the skeptic measured 15 to 18 B gzip a repeat. Not worth a change of its own; do it when page-article.tsx is next opened, for instance with code review step 3.2. CS-4 (stylesheets) is the same finding.
