# SD-4 ✓ Every published page is read whole to pick one page or a few titles

What the server does for a storefront request (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P2. **Effort:** M. **Confidence:** high. **Step:** 0.24.
- **Second check:** corrected.
- **Where:** `src/server/pages.ts:664-680`, `src/server/pages.ts:715-736`, `src/server/pages.ts:797-800`, `src/server/pages.ts:859-863`, `src/app/s/[store]/[market]/page.tsx:28-30`, `src/server/legal-links.ts:24-29`, `src/server/checkout-terms.ts:45-57`, `src/components/site-chat.tsx:107-112`, `src/server/platform-roles.ts:34-38`, `src/server/platform-navigation.ts:135-151`, `src/server/media-alts.ts:53-57`
- **Evidence:** listPublishedPages() selects the whole published document of every published page of an owner, parses each, and looks up every picture of every page in media (withPageAlts, media-alts.ts:53-57). I count 35 call sites. Nine keep one page by id: the front page (page.tsx:29), All products (pages.ts:799), a role page (:862), the chat's privacy link, a blog's listing page, two account pages, the platform's role page and a preview. Legal links (legal-links.ts:24-29) and the terms sentence (checkout-terms.ts:45-57) use titles and addresses only. Kaizena Flow's own header reads all its pages and all its articles this way to name menu links (platform-navigation.ts:138-140), while a store's header uses publishedPageNames(), which takes titles in SQL. The result is cached per owner, so callers in one instance share one read: the waste is in what one fill reads and parses. The read sits in the layout's blocking wave (layout.tsx:127). Production: 79,778 calls, 29 rows a call, 9.8 ms mean, 781 s in all.
- **Cost today:** Per cold fill: about 10 ms in the database, every published document of the owner over the wire and through zod, and one media lookup for all their pictures. Today about 1,023 fills a day from the team, crawlers and deploys. After opening it is paid once per store per instance per hour and per deploy, and it grows with the number of pages a store has. Paid by: The database and server CPU on every cold render; the shopper's first byte on a cold visit.
- **Saving:** Estimate: a cold storefront fill reads and parses 1 to 3 pages instead of every published page (29 a call on average today), and the all-pages read leaves the path to the first byte. In database time the statement is about 10 s a day today, so the gain is cold first byte and CPU, not database load.
- **Risk:** Low. The same data through narrower reads; A/B versions keep working on the one page. A footer's title could differ from today's if SQL and localizePage() disagree on the fallback: the new test shows it.

## The fix

1. src/server/pages.ts gains publishedPageById(owner, id, type): 'use cache', cacheLife("hours"), cacheTag(pagesTag(owner)); one row by id, parsed and passed through withPageAlts().
2. the nine callers that keep one page use it: src/app/s/[store]/[market]/page.tsx:28-30, pages.ts:797-800 and :859-863, src/app/s/[store]/[market]/blog/blog-listing.tsx:89, account/exchange/[token]/page.tsx:60, account/pay/[token]/page.tsx:55, src/server/platform-roles.ts:37, src/app/admin/try/[sandbox]/[kind]/[pageId]/preview/page.tsx:28.
3. publishedPageNames() (pages.ts:715-736) also returns each page's id. legalLinksFor() (legal-links.ts:24-29), the titles of termsPagesFor() (checkout-terms.ts:45-57) and privacyHref() (site-chat.tsx:107-112) find their pages by id there. recordTermsForOrder() (checkout-terms.ts:73-76), which keeps the whole text, reads its pages with publishedPageById().
4. getPlatformChrome() (src/server/platform-navigation.ts:135-151) takes ids, slugs, titles and translated titles in SQL, not whole documents.
5. listPublishedPages() stays for generateStaticParams (src/app/s/[store]/[market]/[slug]/page.tsx:18-24), the sitemap and llms.txt (src/server/seo.ts) and the blogs.

**Done when:** rg 'listPublishedPages\(' over src (tests aside) shows no caller that picks one page by id after it (9 today), and src/server/legal-links.ts and src/server/platform-navigation.ts no longer import it.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/pages.int.test.ts, checkout-terms.int.test.ts, house-pages.int.test.ts, site-layouts.int.test.ts, src/lib/checkout-terms.test.ts; src/app/s/[store]/[market]/checkout/checkout-section.test.ts and order/[orderId]/order-section.test.ts mock @/server/checkout-terms.
- e2e/pages.spec.ts, e2e/menus.spec.ts, e2e/store-pages.spec.ts, e2e/site-layouts.spec.ts (footers with legal links).
- A new test compares the SQL title of publishedPageNames() with localizePage(content, locale).title for a translated and an untranslated page. No written rule names listPublishedPages() (searched docs/rules).

**Notes:** Worth doing when pages.ts is next touched, or together with SD-5 step 2, which takes the same read out of the layout's blocking wave.
