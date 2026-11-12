# CS-8 ✓ Kaizena Flow's own pages fetch the admin's stylesheet and two admin answers after load

Styles (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.10.
- **Second check:** confirmed.
- **Where:** `src/components/site-parts.tsx:261`, `src/components/platform-routes/home.tsx:55`, `src/components/platform-layout.tsx:133`, `src/components/platform-layout.tsx:176`, `src/components/platform-layout.tsx:273`, `src/components/platform-routes/sign-up.tsx:164`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md:145`, `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md:300`, `evidence/routes.json`
- **Evidence:** Read again from m/routes.json: site-home, site-blog-post and site-themes each fetch, after load, the admin's stylesheet 3jc9lkep25kye.css (6,015 B transferred) and two /admin?_rsc answers (2,099 and 4,044 B). site-docs, which has no link to /admin, fetches none; store-home and store-page fetch none. Five <Link href="/admin"> sit in the site's header part, its standard header, phone menu and bottom bar and on the front page, and sign-up links to /admin/sign-in (the six lines in 'where'; rg over the non-admin components finds no other). Next's docs: going between root layouts is a full page load (layout.md:145), so the prefetched answer for /admin cannot be used for a client navigation; prefetch={false} means never, on view or on hover (link.md:300-304).
- **Cost today:** About 12.2 KB transferred after load per view of a site page (local build, gzip), 6 KB of it CSS, and two requests. It does not delay first paint. The page-payload review (PL-4) measured the same links pulling six admin scripts, 135 KB more. It grows with marketing traffic at opening: every visitor of kaizenaflow.com triggers it and most never sign in. After CS-1 the stylesheet a prefetch pulls would be the admin's whole sheet, about 25 KB Brotli more. Paid by: A visitor's browser on kaizenaflow.com; the CDN or a function, which answers two prefetches per page view.
- **Saving:** Measured: 6.0 KB of CSS and 6.1 KB of payload per view of a site page, and two requests. With PL-4's scripts the same change saves about 135 KB more.
- **Risk:** Low. A visitor who presses Sign in loads the admin's CSS then instead of earlier: one request. Noticed only as a slightly later first paint of the sign-in page.

## The fix

1. Add prefetch={false} to the six links: src/components/site-parts.tsx:261, src/components/platform-routes/home.tsx:55, src/components/platform-layout.tsx:133, 176 and 273, src/components/platform-routes/sign-up.tsx:164.
2. src/lib/stylesheet-sources.scan.test.ts (or a small test beside it), rule 'a link across root layouts is not prefetched': every <Link whose href is a string starting with /admin, in a non-test file outside src/app/admin and src/components/admin, carries prefetch={false} in the same tag.
3. e2e/performance.spec.ts: a test that opens / in a phone context, waits 2 s after load and expects no request whose path starts with /admin and no stylesheet from /_next/static beyond the ones the HTML links.
4. docs/performance.md, under the rules: a link that crosses a root layout (the site to the admin) is not prefetched: the answer cannot be used and it pulls the other surface's CSS and scripts.
5. Tell the plans of PL-4, BN-2 and the prefetch dimension that this is the same six-line change, so it is done once.

**Done when:** After loading / on the built app and waiting 2 s, 0 requests go to /admin and no admin stylesheet is fetched (today: 2 requests and 1 stylesheet, 12.2 KB), held by the new test in e2e/performance.spec.ts.

**Tests and rules that hold today's behaviour, and change with it:**

- New scan rule and new e2e test (steps 2 and 3).
- e2e/sign-up.spec.ts and e2e/platform-languages.spec.ts press these links; a press still loads /admin as a full page load. They must pass unchanged.
- e2e/performance.spec.ts:40-50: the first-scripts budgets of / and /sign-up do not move (the fetches are after load).

**Notes:** A prefetch matter more than a style matter, kept here because it must land before CS-1: with two Tailwind entries a prefetch of /admin would otherwise pull the admin's whole sheet into every site visit. Same fix as PL-4 (page-payload) and BN-2 (client-bundles); merge them.
