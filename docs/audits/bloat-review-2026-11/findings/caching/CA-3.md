# CA-3 ✓ To read one page, the code loads every published page with its whole content

Caching and rendering (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P0. **Effort:** M. **Confidence:** high. **Step:** 0.19.
- **Second check:** confirmed.
- **Where:** `src/server/pages.ts:664`, `src/server/pages.ts:688`, `src/server/pages.ts:720`, `src/server/pages.ts:799`, `src/server/pages.ts:862`, `src/server/legal-links.ts:24`, `src/app/s/[store]/[market]/page.tsx:29`, `src/app/s/[store]/[market]/[slug]/page.tsx:20`, `src/server/platform-navigation.ts:138`, `src/server/platform-roles.ts:37`, `src/server/checkout-terms.ts:46`, `src/components/site-chat.tsx:110`, `src/server/seo.ts:465`, `src/server/seo.ts:687`
- **Evidence:** Opened in this pass. listPublishedPages() (pages.ts:664-679) selects the published JSON of every published page of an owner, parses each with the page schema, joins picture alt texts, and keeps the list as one cached value. rg finds 35 call sites. Nine are (await listPublishedPages(x)).find(...) for one page (the store's front page at page.tsx:29, pages.ts:799 and 862, platform-roles.ts:37, site-chat.tsx:110, blog-listing.tsx:89 and three account pages). The store layout reaches it through legalLinksFor() (legal-links.ts:24) for four or five titles, so the list is in every store page's resume data: 4,275 bytes on the demo, measured by inflating no.meta. getPlatformChrome() (platform-navigation.ts:138-140) loads all pages and all articles to build id, slug, title and translated titles. Two lighter reads already sit beside it: findPublishedPage() (one page by address) and publishedPageNames() (titles pulled out in SQL). Production, not open: 79,778 calls, 2,334,038 rows (29 a call), 9.8 ms mean, 781 s in 78 days: the app's most expensive statement after the scheduler's own.
- **Cost today:** About 29 page documents read and parsed per cold call today; at most about 190 KB of JSON a call (9.1 MB over 1,389 rows times 29, an upper bound: a row also holds its draft). It is paid once per store and type per cold instance, so it grows with stores and with pages per store. Paid by: The database; the server on each cold render; each built store page, whose resume data carries the list.
- **Saving:** Estimate: over 90% of the bytes this statement reads at today's 29 rows a call; less for a store with few pages. Every store page's kept data shrinks by the list (4,275 bytes on the demo).
- **Risk:** Low. Same tag (pagesTag), same rows. A page that is drawn must still get its picture alt texts (withPageAlts). A cold render makes two small reads where it made one large one. Noticed by: the integration tests above and the footer's legal links in e2e.
- **Already tracked:** no. Step 3.9 (FF2, FF5, Open) of docs/audits/code-review-2026-11.md is the same pattern for products, not pages.

## The fix

1. This is DQ-2 of the database dimension; use its names so the work is done once. In src/server/pages.ts add publishedPageIndex(owner, type = 'page'): 'use cache', cacheLife('hours'), cacheTag(pagesTag(owner)), the same where and order as listPublishedPages but no document: id, slug, published ->> 'title' as title, the translated titles as one small object, published_at, first_published_at, and the aiAssistants flag the robots and sitemap readers need.
2. Add publishedPageById(owner, id): same cache settings and tag; one row by primary key with the owner's condition and published_at is not null; parsePageContent; withPageAlts([page]).
3. Move the readers of one page to publishedPageById: src/app/s/[store]/[market]/page.tsx:29, src/server/pages.ts:799 and :862, src/server/platform-roles.ts:37, src/server/checkout-terms.ts:46, src/components/site-chat.tsx:110, src/app/s/[store]/[market]/blog/blog-listing.tsx:89, account/change/[token]/page.tsx:60, account/exchange/[token]/page.tsx:60, account/pay/[token]/page.tsx:55, and the two admin previews (admin/try/.../preview/page.tsx:28, admin/account/themes/[presetId]/preview/page.tsx:91).
4. Move the readers of titles and addresses to publishedPageIndex: src/server/platform-navigation.ts:138 and :140 (id, slug, title and titles are exactly what byId() builds), src/server/legal-links.ts:24 (take the title with a small pure helper that picks from titles by the rule localizePage uses), and generateStaticParams in [slug]/page.tsx:20 and [slug]/[...sub]/page.tsx:22.
5. Leave on listPublishedPages, with a comment that it is for readers of every document: src/server/page-ai.ts:96-97, blogs.ts:114, blog/article-page.tsx:40 and :53, the platform's blog and page routes, the admin's search page. Move robots, llms.txt and the sitemaps (seo.ts:465, 600, 687, 796, 872) to the index when the fields they read are on it; the type checker shows which.
6. Run pnpm typecheck, pnpm test, pnpm test:int; build; pnpm test:e2e for store and platform pages.

**Done when:** rg -c 'listPublishedPages\(' over src without tests gives at most 20 lines (35 today), and the new integration test passes; on production a week after the deploy, the whole-content pages statement has fewer than a quarter of the calls of the new index statement in pg_stat_statements.

**Tests and rules that hold today's behaviour, and change with it:**

- Integration tests that call these reads: src/server/pages.int.test.ts, legal-starters.int.test.ts, country-content.int.test.ts, experiments.int.test.ts, redirect-resolve.int.test.ts, alt-texts.int.test.ts (a drawn page must still get its picture alt texts), page-duplicate.int.test.ts.
- New unit test: the title helper gives the same title as localizePage() for a page with and without a translation.
- New integration test: publishedPageIndex returns no content field and the same ids, slugs and order as listPublishedPages for a seeded store.
- e2e: legal-pages.spec.ts (the footer's legal links), menus.spec.ts, blog.spec.ts, smoke.spec.ts (robots, sitemap).
- Rule: new reads go through typedRows() with col (CLAUDE.md, Conventions); ratchet.scan.test.ts must not rise. No written rule names listPublishedPages.

**Comes after:** DQ-8 (the owned() helper, if the database dimension's order is followed; not needed for the caching gain)

**Notes:** Same change as DQ-2 (database dimension), which carries the step list in more detail; do it once. A read per page is also the first step toward a per-page tag, so that publishing one page stops marking every page of the store stale (the pages twin of step 3.10). Before opening is a cheap time to split it.
