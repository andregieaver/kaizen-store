# PF-8 ✓ Links in closed drop-down and mega menus are prefetched while invisible

Prefetching: what the router asks for unasked (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P2. **Effort:** S. **Confidence:** medium. **Step:** 2.3.
- **Second check:** confirmed.
- **Where:** `src/components/menu-view.tsx:101,109-118,131,142-146,167`, `node_modules/next/dist/client/components/links.js:95-97,199-216`
- **Evidence:** The panels under a menu link are hidden with 'invisible ... opacity-0' and stay laid out (menu-view.tsx:131, 167). Next counts a link as in view when its box meets the viewport plus 200 px, by intersection ratio alone (links.js:95-97, 213). The skeptic's browser test (work/pf2/io.mjs): a link in a visibility:hidden panel counts as in view; one in a closed <details>, a hidden part or display:none does not. No menu in the local test database has sub-links, so this is shown by the code and the browser test, not on a real page.
- **Cost today:** Nothing on the demo store. On a store with nested menus, 2 to 3 requests per sub-link on every full page load at desktop width, plus the chunks their pages name: 30 sub-links would be 60 to 90 requests (estimate by multiplication), each a proxy run and, cold or stale, a render. Paid by: Desktop shoppers' browsers and the server, on stores with real catalogue menus: the stores that are about to arrive.
- **Saving:** All of it: sub-links are fetched only on hover or focus (estimate; no nested menu in the test data to measure).
- **Risk:** Low. A sub-link pressed at once after the panel opens may wait one round trip.

## The fix

1. src/components/menu-view.tsx: in the row layout, draw the links of a dropdown (the anchor() call at 113) and of a mega menu's panel (142, 146) with PolicyLink policy intent (PF-3 gives anchor() its policy argument). The top links keep view.
2. src/components/menu-view.test.ts: with policy-link mocked to print its policy, render a row menu with a dropdown and one with a mega menu: every top link prints view, every sub-link intent.
3. e2e/menus.spec.ts (it already builds menus): add a case with one sub-link under a header link: at 1280x720 no router prefetch request for the sub-link's address until the top link is hovered, at least one after.

**Done when:** The menu-view unit test shows intent on every sub-link, and the new e2e/menus.spec.ts case sees 0 router prefetch requests for a sub-link before its top link is hovered.

**Tests and rules that hold today's behaviour, and change with it:**

- D85 and D87 (menus and mega menus need no script; lists open on hover or keyboard focus): unchanged, the panel is still CSS. Focus counts as intent, so keyboard users get the fetch too.
- src/components/menu-view.test.ts (the Suspense around MenuGlide) and e2e/menu-hover.spec.ts, e2e/menus.spec.ts, e2e/navigation.spec.ts: run them.

**Comes after:** PF-3

**Notes:** Same file and same change as PF-3's menu step; listed apart because its cost only shows on stores with nested menus.
