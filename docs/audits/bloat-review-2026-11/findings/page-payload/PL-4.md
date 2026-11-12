# PL-4 ✓ Kaizena Flow's own pages download the admin's sign-in scripts for every visitor

What a page sends: document, payload and requests (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.12.
- **Second check:** corrected.
- **Where:** `src/components/platform-layout.tsx:133`, `src/components/platform-layout.tsx:176`, `src/components/platform-layout.tsx:273`, `src/components/platform-routes/home.tsx:55`, `src/components/platform-routes/sign-up.tsx:164`, `src/components/site-parts.tsx:261`, `src/app/admin/layout.tsx:1`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md:145`, `evidence/routes.json`
- **Evidence:** Five next/link elements outside the admin point at /admin and one at /admin/sign-in (rg for a Link whose href starts with /admin outside src/app/admin and src/components/admin: the six lines above): the site's header, its phone menu, its bottom bar, the front page, the sign-up page and the built header's account part. The router prefetches the link in view and pulls its scripts and stylesheet. Listed from routes.json (docs/audits/bloat-review-2026-11/scripts/sources/plpl/after.mjs.txt): the front page fetched 11 scripts after load (168,158 bytes transferred, 500,593 raw) and one stylesheet (6,015 transferred, 21,083 raw); the verified report matched six of the scripts (134,674 bytes transferred, 437 KB raw) and the stylesheet to the signed-out /admin document. The blog post and the themes page fetch the same six. /admin has its own root layout (src/app/admin/layout.tsx), and Next's docs say a navigation across root layouts is a full page load, so the prefetched payload is thrown away on the press; only the cached files help.
- **Cost today:** About 135 KB of scripts and 6 KB of CSS on the wire per first visit to any Kaizena Flow page: 28% of everything the front page transfers (499,407 bytes). Paid by: Every visitor of kaizenaflow.com (browser and data); the CDN.
- **Saving:** Measured: 6 scripts and one stylesheet, about 141 KB on the wire (458 KB raw), per first visit to the site's pages.
- **Risk:** Low: an owner who presses Sign in loads its files then, as on any first visit to /admin; returning owners have them cached.

## The fix

1. Add prefetch={false} to the six links: src/components/platform-layout.tsx:133, 176 and 273, src/components/platform-routes/home.tsx:55, src/components/platform-routes/sign-up.tsx:164 and src/components/site-parts.tsx:261.
2. New scan test src/lib/cross-root-links.scan.test.ts: in every .tsx file outside src/app/admin and src/components/admin, a Link whose href is a literal that starts with /admin must carry prefetch={false} in the same tag. Give it a 'would notice' case on a made-up line.
3. e2e/performance.spec.ts: on / wait 2 seconds after load and expect no request that carries the next-router-prefetch header for a path under /admin.
4. docs/performance.md, The rules: 'A link that crosses to another root layout (the site to the admin) is not prefetched: the press is a full page load, so only its files could help, and most visitors never press it.'

**Done when:** The new assertion in e2e/performance.spec.ts passes (0 prefetch requests to /admin from /), and measure-routes.mjs shows the front page's after-load scripts fall from 11 files and 168,158 bytes transferred to 5 files and about 33,500 bytes, with no admin stylesheet.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/platform-languages.spec.ts and the sign-up specs (the Sign in links still lead to /admin).
- e2e/performance.spec.ts FIRST_SCRIPTS_BUDGETS for / and /sign-up: unchanged (they count the document's own script tags, not what a prefetch pulls).
- src/lib/platform-chrome.scan.test.ts (the site's chrome): read it before adding the new scan, and put the new case there if it already walks these files.
- No written rule covers prefetching (rg prefetch in docs finds only docs/plan.md:120).

**Notes:** Same finding as BN-2 (client-bundles). The admin's View store link is the mirror case on the local build only (it prefetched the storefront and about 92 KB of its scripts on every admin screen measured); in production a store is on its own host, storeHref() is absolute and next/link does not prefetch it, so it is left alone.
