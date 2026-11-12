# CA-8 ✓ A store's robots.txt, sitemap, llms.txt, blog feed and favicon answer with no HTTP cache

Caching and rendering (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P3. **Effort:** S. **Confidence:** medium. **Step:** tolerated.
- **Second check:** corrected.
- **Where:** `src/app/s/[store]/robots.txt/route.ts:9`, `src/app/s/[store]/store-sitemap.xml/route.ts:4`, `src/app/s/[store]/llms.txt/route.ts:4`, `src/app/s/[store]/[market]/blog/feed.atom/route.ts:7`, `src/app/s/[store]/favicon.ico/route.ts:7`, `src/app/favicon.ico/route.ts:7`, `src/lib/site-icons.ts:25`, `src/app/robots.txt/route.ts:8`
- **Evidence:** Opened the six handlers in this pass: the store's robots, sitemap, llms.txt and feed set only Content-Type; faviconRedirect() (site-icons.ts:25-30) answers a 302 with public, max-age=3600 and no s-maxage, behind connection(). The build table marks all of them dynamic (build.log lines 1333-1459). The verified report's curl run found no Cache-Control on the four files; the site's own /sitemap.xml and /llms.txt answer s-maxage=3600. The reads behind these files are cached per instance, which helps only a warm instance. The site's /robots.txt is left uncached on purpose where it holds every store's rules, 'so a page closed or opened shows at once' (src/app/robots.txt/route.ts:8-10).
- **Cost today:** One function run per crawler request per store file. On a cold instance a sitemap reads the store, its products and terms, and every page and article with content (CA-3). A crawler usually asks for each file about once a day per store (estimate; volume not known), so the total is small per store and grows with the number of stores. Paid by: The server per request; the database.
- **Saving:** Small. Only requests that arrive inside the window are served without a function; a file asked for once a day still starts a function run each time and is served a day old.
- **Risk:** A change shows in these files up to the window later, and with stale-while-revalidate the first reader after a quiet day gets the old copy. A private store's files must not be cached. Noticed by e2e/private-mode.spec.ts.

## The fix

1. src/app/s/[store]/store-sitemap.xml/route.ts, llms.txt/route.ts and [market]/blog/feed.atom/route.ts (and blogs/[blog]/feed.atom/route.ts): add Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400 to the 200 answer.
2. src/app/s/[store]/robots.txt/route.ts: public, s-maxage=300, so a page closed to AI crawlers shows within five minutes.
3. src/lib/site-icons.ts:28: public, max-age=3600, s-maxage=86400 on the favicon redirect.
4. e2e/smoke.spec.ts or e2e/blog-feed.spec.ts: assert the header on one of each.

**Done when:** curl -sD - on pnpm start shows an s-maxage Cache-Control on /s/demo/store-sitemap.xml, /s/demo/llms.txt, /s/demo/no/blog/feed.atom and /s/demo/robots.txt (none today), held by the e2e assertion.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/smoke.spec.ts, e2e/blog-feed.spec.ts, e2e/icons.spec.ts, e2e/private-mode.spec.ts (a private store's files) and e2e/store-templates.spec.ts read these files; a private store's answers must stay uncached (check the handlers' private branch before adding the header).
- The written reason on src/app/robots.txt/route.ts:8-10 (shows at once) is why robots gets five minutes, not an hour.

**Notes:** P3 because the skeptic's correction stands: with about one crawler fetch a day per file, a one-hour window saves almost nothing. Do it when the handlers are next opened. CA-3 removes most of what a cold sitemap reads, which is the larger part of this cost.
