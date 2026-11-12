# CA-5 ✓ Each admin screen prefetches 13 to 22 other screens, and the storefront, on sight

Caching and rendering (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.13.
- **Second check:** confirmed.
- **Where:** `src/components/admin/admin-rail.tsx:47`, `src/components/admin/store-admin-nav.tsx:94`, `src/components/admin/store-admin-nav.tsx:131`, `src/components/admin/store-admin-nav.tsx:195`, `src/app/admin/(gated)/[store]/layout.tsx:132`, `node_modules/next/dist/docs/01-app/02-guides/prefetching.md:120`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/prefetch.md`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cacheLife.md:258`, `evidence/routes.json`
- **Evidence:** Regrouped routes.json in this pass, signed in as an owner: Home 28 prefetch requests to 13 addresses (98,047 bytes on the wire); Orders 32 to 15 (111,733); Pages 46 to 22 (160,192); Settings 44 to 21 (151,731). The View store link alone (layout.tsx:132) is 4 requests, 62,376 bytes decoded and 18,183 on the wire on every screen. The four Link sites of the rail, the area links, the tabs and the sidebar were opened: none sets prefetch. The admin reads cookies, so each prefetch is computed by the server. Next's doc (cacheLife.md:258): a Server Action that calls updateTag, revalidateTag or refresh clears the whole client cache, so after a save the links are fetched again; the verified report counted 668 server refresh() calls in 195 files.
- **Cost today:** 23 to 46 requests and 77 to 160 KB on the wire per admin screen, each a function run in production, for screens the owner mostly does not open next; again after most saves. It grows with owners at work in the admin. Paid by: The owner's admin (bytes); the server per request.
- **Saving:** Estimate: 28 to 44 of the 32 to 46 requests per screen. Measured ceiling: the 77 to 160 KB on the wire per screen, and as many function runs.
- **Risk:** The first click on a menu item waits for its shell unless the pointer or focus reached it first; on touch the prefetch starts at touchstart, a moment before the click. Low. Noticed by the signed-in e2e specs and by the new count.
- **Already tracked:** no. PERF-01 in docs/audits/psi-followups.md tracks the admin's scripts, not its prefetches.

## The fix

1. src/app/admin/(gated)/[store]/layout.tsx:132: add prefetch={false} to the View store link.
2. New client component src/components/admin/intent-link.tsx, Next's hover pattern (prefetching.md:120-152): a Link with prefetch={active ? null : false}, where active is set on onMouseEnter, onFocus and onTouchStart; it passes className, aria-current, aria-label and children through, so LinkPending inside it keeps working.
3. Use it at src/components/admin/admin-rail.tsx:47 and src/components/admin/store-admin-nav.tsx:94, :131 and :195, and at the platform admin's rail and tabs if they use other files (rg -n '<Link' src/components/admin/*nav* src/components/admin/*rail*).
4. Not chosen, but one line if the owner prefers the largest cut: export const prefetch = 'force-disabled' in src/app/admin/(gated)/layout.tsx stops segment prefetches for every link into the admin and keeps one small tree request per link (prefetch.md). The intent link is chosen because the shell is still ready when the pointer rests on a menu item.
5. New test in e2e/signed-in/: as the owner, load /admin/{store}/orders, wait 3 s, count requests that carry next-router-prefetch; expect at most 4. Then hover Products in the menu and expect its prefetch.

**Done when:** Signed in as the test owner, /admin/{store}/orders makes at most 4 prefetch requests in the 3 s after load (32 today, 111,733 bytes on the wire), held by the new test in e2e/signed-in/.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/signed-in/ navigation and a11y specs (the menu's links, aria-current, focus order) and e2e/admin-look.spec.ts must pass unchanged.
- docs/rules/admin (the frame's file, see its README.md) and docs/admin-navigation.md: add that the admin's menus prefetch on intent, not on sight.
- No existing test counts admin requests; PERF-01 in docs/audits/psi-followups.md tracks the admin's scripts, not its prefetches.

**Notes:** Partial Prefetching would not cut this much: nearly every admin link goes to a different route, so there is little shell to share. AD-13 and AD-5 in the admin-data dimension reduce what a save redraws; they do not touch the prefetches.
