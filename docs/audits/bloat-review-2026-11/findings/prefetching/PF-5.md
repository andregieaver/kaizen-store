# PF-5 ✓ The admin prefetches its whole sidebar on every load and again after every refresh, to fetch nearly the same loading skeleton twelve times

Prefetching: what the router asks for unasked (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 0.10.
- **Second check:** corrected.
- **Where:** `src/components/admin/store-admin-nav.tsx:94,131,148-162,195`, `src/components/admin/admin-rail.tsx:47,88`, `src/components/admin/admin-menus.tsx:126,137,146,154,164,169,172,233`, `src/components/admin/admin-frame.tsx:163,250`, `src/components/admin/refresh-while.tsx:7-13`, `src/components/admin/analytics/live-refresh.tsx:10-25`, `node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js:213-229`, `node_modules/next/dist/client/components/links.js:285-306`, `docs/audits/code-review-2026-11.md:51,414`, `e2e/signed-in/admin-text-fallbacks.spec.ts:82-102`
- **Evidence:** Planner's run on the admin home, signed in as the test owner at 1440x900: 28 router requests for 13 links, 171 KB decoded, 98 KB on the wire: 2 for each of the 12 store-admin links of the rail (a route tree and a page answer of 8.9 to 11.5 KB that holds the loading skeleton), 2 for /admin and 4 for the View store link (local only). The skeptic's measures stand: the Products and Customers answers differ in the segment's name, the title and one script address; a router.refresh() throws the segment cache away and re-asks for every link in view, 25 prefetch requests and 78 to 116 KB on the wire on the product list; there are 103 router.refresh() call sites in 56 files (re-counted here). RefreshWhile polls only while a job runs and the Live page every 10 s, so the standing rate is about 25 requests per 10 s on the Live page. A save whose action revalidates evicts the whole prefetch cache the same way (server-action-reducer.js:228-229); the planner measured that mechanism on the storefront (PF-12). One frame serves the store, owner and platform levels (admin-frame.tsx), so one change covers all three.
- **Cost today:** Per admin load 24 to 38 requests and 110 to 225 KB decoded; about 25 more per refresh or save; about 150 a minute while the Live page is open (the skeptic's estimate from the measured refresh). The answers are prerendered shells outside the proxy, so the server's share is small. Paid by: The owner's browser and connection; the CDN. It grows with owners and with how often they save.
- **Saving:** Measured: 24 requests and about 110 KB decoded per load of the admin home (28 and 171 KB with the two local extras); about 25 requests per refresh, save and Live tick.
- **Risk:** Low to medium. A touch or keyboard press shows the pending bar for one round trip before the skeleton where today the skeleton is already held; that is the FS1 trade named above, and the pending-bar spec says if the bar is lost. A dropped prop (aria-current, role=menuitem) would show in the nav unit tests and the a11y spec.
- **Already tracked:** no for the cost. Related: docs/audits/code-review-2026-11.md step 0.10 (FS1, In progress), whose done-criterion leans on the prefetched skeleton.

## The fix

1. Create src/components/admin/ui/link.tsx: AdminLink = PolicyLink (PF-3's src/components/policy-link.tsx; create that file here if PF-3 has not landed) with policy intent unless a policy is given. Export it from src/components/admin/ui/index.ts.
2. src/components/admin/store-admin-nav.tsx:94, 131, 195 and src/components/admin/admin-rail.tsx:47, 88: use AdminLink. LinkPending stays a child of the link and keeps importing useLinkStatus from next/link.
3. src/components/admin/admin-menus.tsx (126 to 233, the store switcher and account menu) and src/components/admin/admin-frame.tsx:163, 250: use AdminLink.
4. src/app/admin/(gated)/[store]/layout.tsx:132 (View store): policy none, since the press leaves the admin's root layout (PF-11).
5. Create e2e/signed-in/prefetch.spec.ts: as the test owner, /admin/{store} makes 0 router prefetch requests in the 3 s after load (28 today); hovering the Products link of the rail makes at most 2; pressing it shows the pending bar or the skeleton and lands on the page.
6. docs/audits/code-review-2026-11.md, step 0.10 (FS1, In progress): add a change-log line that the skeleton is now fetched on hover, touch or focus and that the pending bar answers the press itself; leave the status as it is.

**Done when:** e2e/signed-in/prefetch.spec.ts passes: 0 router prefetch requests in the 3 s after the admin home loads (28 today in my run, 24 of them for the 12 store-admin links) and at most 2 after hovering one rail link.

**Tests and rules that hold today's behaviour, and change with it:**

- Code review step 0.10 (FS1), done-criterion 'a slow page shows the skeleton within a frame of the click' (docs/audits/code-review-2026-11.md:414): it holds today because the skeleton is prefetched in view. With intent a mouse press still has it (hover comes first); a touch or keyboard press may show the pending bar for one round trip first. The rule's reason, that the owner sees the click worked, is kept by LinkPending (D540).
- e2e/signed-in/admin-text-fallbacks.spec.ts:82-102 holds the pending bar by holding back every RSC request for the pressed page: passes unchanged.
- src/components/admin/store-admin-nav.test.ts and src/components/admin/admin-rail.test.ts render the nav to static markup: the anchors come out the same; run them.
- e2e/signed-in/a11y.spec.ts and admin-phone.spec.ts wait for network idle on admin pages: they get there sooner.
- e2e/performance.spec.ts: the admin's first-scripts budgets gain one small component (Home had 60 KB of room after PSI PERF-01).

**Comes after:** PF-3

**Notes:** One line could do much of this without touching links: export const prefetch = 'force-disabled' on the admin's gated layout (Next's prefetch segment config; route trees are still fetched). It also stops the fetch on hover, so the skeleton would never be ready at the press; not proposed. PF-9's spike measures the other one-line option, 'partial'.
