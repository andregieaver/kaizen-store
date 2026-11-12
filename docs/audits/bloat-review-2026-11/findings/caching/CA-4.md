# CA-4 ✓ Language and currency links prefetch whole front pages that their click never opens

Caching and rendering (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.10.
- **Second check:** confirmed.
- **Where:** `src/components/view-menu.tsx:56`, `src/components/view-menu.tsx:62`, `src/components/store-layout.tsx:214`, `src/components/store-layout.tsx:531`, `src/components/language-links.tsx:84`, `evidence/routes.json`
- **Evidence:** Opened view-menu.tsx:50-76 in this pass: ViewMenu draws each language and currency as a next/link to that view's front page, but its click handler cancels the link and pushes the page the shopper is on. So the router prefetches a page the click does not open, except from the front page itself. Regrouped routes.json in this pass, demo's empty cart page at phone size: 42 prefetch requests, 625,516 bytes decoded, 184,408 on the wire; 18 of the requests, 509,776 decoded and 104,635 on the wire, are the six views' front pages (no-sv, no-da, no-en, no-sek, no-dkk, no-eur). Those views are not built ahead, so each first prefetch renders that front page on the server, and every one of the 18 also passes the proxy (44 matched requests on that page load). LanguageLinks uses a plain <a> (language-links.tsx:84) and does not prefetch.
- **Cost today:** For a store with several languages or currencies on: up to about 510 KB decoded (105 KB on the wire) and 18 requests per page load where the footer's list is on screen, each a proxy run, plus up to six page renders on a cold cache. Paid by: The shopper's browser (phone data); the server per request.
- **Saving:** Measured on the cart page: 18 of 42 prefetch requests, 57% of the wire bytes (104,635 of 184,408) and 81% of the decoded bytes (509,776 of 625,516); 18 fewer proxy runs per such page load.
- **Risk:** None seen: the click already moves with router.push to another address. From a front page the chosen view then loads on the click instead of ahead of it. Noticed by the two e2e specs above.

## The fix

1. src/components/view-menu.tsx:56: add prefetch={false} to the Link. Nothing else changes: the click handler already navigates with router.push, and without scripts the link still leads to that view's front page.
2. e2e/performance.spec.ts: add a test. Phone context, cold, /s/demo/no/cart, wait 3 s after load, collect requests that carry the next-router-prefetch header; expect none whose path is another view of the store (/s/demo/no-…).

**Done when:** A cold phone load of /s/demo/no/cart on pnpm start makes 0 prefetch requests to /s/demo/no-sv, -da, -en, -sek, -dkk or -eur in the 3 s after load (18 today, 104,635 bytes on the wire), held by the new test in e2e/performance.spec.ts.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/language-switcher.spec.ts and e2e/localization.spec.ts (choosing a language or currency keeps the page and the query) must pass unchanged.
- No written rule covers prefetching (rg prefetch in docs/rules and docs/performance.md: nothing). Add one line to docs/performance.md: a link whose click goes elsewhere takes prefetch={false}.

**Notes:** The same line as SC-1 step 1 in the storefront-client dimension, which also covers the footer's other links; do it once. The cost falls only on stores that offer several languages or currencies, so it follows use, but for them it is plain waste.
