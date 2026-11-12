# BN-2 ✓ Kaizena Flow's front page prefetches the admin and downloads its signed-in frame, which a press on Sign in cannot use

The built client bundles, by page (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.10.
- **Second check:** confirmed.
- **Where:** `src/components/platform-layout.tsx:133`, `src/components/platform-layout.tsx:176`, `src/components/platform-layout.tsx:273`, `src/components/platform-routes/home.tsx:55`, `src/components/site-parts.tsx:261`, `src/components/platform-routes/sign-up.tsx:164`, `src/app/admin/sign-in/page.tsx:41`, `src/app/admin/sign-in/page.tsx:83`, `src/components/admin/ui/focus-frame.tsx:36`, `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md:304`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md:145`
- **Evidence:** Re-read in routes.json: after load the front page asks for /admin (two answers) and then fetches six scripts that are in /admin's first-load list and not in its own: 2du16ociar189 (179,419 bytes), 1-5xy7dnrat0_ (116,870), 2i4juo9spco86 (57,349), 2zizbcwzl-te- (50,434), 0hqyp5k5log8u (18,934), 3fkl-rwp5s-t7 (14,433), and the admin's stylesheet (21,083). Together 437,439 bytes raw and 134,674 transferred of scripts; coverage shows 95 to 580 bytes of each run. Five next/link tags point from the public site to /admin and one to /admin/sign-in (lines above); only four links in all of src set prefetch={false}. Next's docs: the site and the admin have different root layouts and a move across root layouts is a full page load (layout.md:145), so the prefetched answer is thrown away; prefetch={false} never prefetches (link.md:304). The sign-in page does the mirror image: its links to /sign-up and / fetch 248,085 bytes of the site's scripts after load.
- **Cost today:** 437 KB raw / 135 KB transferred of scripts and a 6 KB stylesheet per first visit to a page of kaizenaflow.com, on top of the 230 KB gzip the page needs: 59% more script bytes, none of it usable. Paid by: Every first-time visitor of Kaizena Flow's own site. Few today; this grows with marketing traffic from the day the platform opens.
- **Saving:** Measured: 437,439 bytes raw / 134,674 transferred of scripts, the 21,083-byte stylesheet and two server answers per first visit; the page's script transfer falls from about 400 to about 269 KB. The sign-in page saves 248,085 bytes raw the same way.
- **Risk:** Low. The press on Sign in is a full page load either way, so nothing a person sees gets slower. Noticed only as the admin's stylesheet loading on the press instead of before it.
- **Already tracked:** Not in the repo's plans. The same nine-line change is planned as CS-8 (css) and PL-4 (page-payload): do it once.

## The fix

1. Add prefetch={false} to the six links from the public site to the admin: src/components/platform-layout.tsx lines 133, 176 and 273, src/components/platform-routes/home.tsx line 55, src/components/site-parts.tsx line 261, src/components/platform-routes/sign-up.tsx line 164.
2. Add it to the three links from the admin's signed-out pages to the site: src/app/admin/sign-in/page.tsx lines 41 and 83, src/components/admin/ui/focus-frame.tsx line 36.
3. A scan test (a new case beside src/lib/storefront-bundle.scan.test.ts): every <Link whose href is a string starting with /admin, in a non-test file outside src/app/admin and src/components/admin, has prefetch={false} in the same tag; and the reverse for a <Link to '/' or '/sign-up' under src/app/admin/sign-in and src/components/admin/ui/focus-frame.tsx.
4. e2e/performance.spec.ts: a test that opens / in a phone context, waits 2 s after load and expects no request whose path starts with /admin.
5. docs/performance.md, The rules: a link that crosses a root layout (the site to the admin and back) is not prefetched: the answer cannot be used and it pulls the other surface's scripts and stylesheet.

**Done when:** On the built app, after loading / and waiting 2 s, 0 requests go to an address under /admin and none of the six scripts above is fetched (2 requests, 6 scripts and 437,439 bytes today), held by the new test in e2e/performance.spec.ts.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/sign-up.spec.ts, e2e/platform-languages.spec.ts and e2e/admin.spec.ts press these links; the press is a full page load today and stays one, so they pass unchanged.
- e2e/performance.spec.ts lines 40 to 50: the first-scripts budgets of / and /sign-up do not move (the fetches are after load).
- New scan rule and new e2e test (steps 3 and 4).

**Notes:** This is the whole answer to 'why does Kaizena Flow's front page load 400 KB more than a store's': its own first scripts are 666,071 bytes against a store home's 680,264; the difference is the prefetch. BN-1 and BN-4 also shrink what any such prefetch pulls. It must land before a split stylesheet (BN-12), or a prefetch of /admin would pull the admin's whole sheet into every site visit.
