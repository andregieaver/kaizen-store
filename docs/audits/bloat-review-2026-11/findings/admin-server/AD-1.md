# AD-1 ✓ The store menu is rebuilt with 220 slow permission lookups on every shell render

What the server does for an admin navigation (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.17.
- **Second check:** confirmed.
- **Where:** `src/lib/admin-map.ts:1461-1479`, `src/lib/admin-map.ts:1375-1377`, `src/lib/permissions.ts:116-124`, `src/lib/permissions.ts:139-142`, `src/lib/store-nav.ts:388-401`, `src/lib/store-nav.ts:432-462`, `src/app/admin/(gated)/[store]/layout.tsx:82`, `src/app/admin/(gated)/[store]/layout.tsx:91-92`, `src/app/admin/(gated)/[store]/settings/page.tsx:21`, `src/app/admin/(gated)/[store]/website/page.tsx:21`, `src/server/owner-assistant.ts:362`
- **Evidence:** matchPath() filters the 416-page table and sorts the 264 store pages on every call, and the sort runs a regex twice per comparison (pageParams). The layout calls storeTabs() and storeAreas(); each runs storeSections(), which asks canOpenPath() -> permissionOfPath() -> matchPath() for all 110 menu items. My own run in Node 22: 220 lookups for 110 distinct paths and 125 ms per build with every feature on. The skeptic measured 121 to 125 ms (every feature), 101 to 112 ms (shop only), 60 ms (a website), 243 ms (a store that is not open: two lookups per item, layout.tsx:82), 0.46 to 0.53 ms per matchPath() call of which the filter and sort are 0.46 ms, and 0.1 ms for the whole build once the lookup is memoised by path. The answer depends only on the code and the member's keys. The shell is rendered on a hard load, after every save that calls refresh() (599 sites) and on every router.refresh(), not on a soft navigation.
- **Cost today:** 100 to 125 ms of blocking CPU per store shell render for a shop, 60 ms for a website, 243 ms for a suspended or closed store (measured on this machine). 64 ms more on the Settings and Website hub pages (one storeSections() pass, the skeptic's measure). About 130 ms per pass when the AI manager filters the 264 store pages (estimate: 264 times 0.5 ms). It is synchronous, so the instance serves nothing else meanwhile. Today only the team pays it; it multiplies with every owner's saves once stores open (estimate: 1,000 saves cost about 2 minutes of CPU). Paid by: The server per shell render (function CPU), and the owner, who waits for it on every hard load, every save and every progress poll tick.
- **Saving:** Measured here: 100 to 125 ms down to about 0.1 ms per shell render, 64 ms per hub page, and about 130 ms per AI manager pass (the last an estimate). Vercel's CPU differs; the same order there is an estimate.
- **Risk:** Low. Pure functions over a static table. What could break: a memo keyed on anything of the member would show one role's menu to another (key on path and access only; permissions.matrix.test.ts and e2e permissions.spec.ts would show it). A Map without a cap would grow with real addresses. matchPath() must keep trying pages with fewer params first, or a fixed address could lose to a [param] one: admin-map.test.ts holds that.
- **Already tracked:** no (docs searched for matchPath, permissionOfPath, storeTabs, storeAreas: no step or rule names this cost)

## The fix

1. src/lib/admin-map.ts: at module load, build the pages of each area once, sorted by number of [param]s (the same stable sort matchPath() runs per call at line 1472), each with its path already split into segments. Make matchPath() loop over that list. What it returns does not change.
2. src/lib/permissions.ts: keep permissionOfPath() answers in a module Map keyed by the access and the cleaned path. The 110 menu paths and the page patterns are a fixed set, but real addresses (an order's id) are not, so cap the Map (2,000 entries, cleared when full). The key is the path and the access only, never anything of the member.
3. src/lib/store-nav.ts: add storeNav(base, flags, canOpen, counts) that calls storeSections() once and returns { tabs, areas }; keep storeTabs() and storeAreas() as thin wrappers so their tests and other callers stand. src/app/admin/(gated)/[store]/layout.tsx:91-92: call storeNav() once.
4. src/app/admin/(gated)/[store]/layout.tsx:82: read the key once per path (key = permissionOfPath(path, 'read'); open when key is null or the holder has it, and, for a store that is not open, when keyAllowedWhenNotOpen(key)), so a closed store costs one lookup per item, not two.
5. No change is needed in settings/page.tsx:21, website/page.tsx:21 or owner-assistant.ts:362: they get the saving from the first two steps.
6. Add the count test named under tests, so the cost cannot come back unseen.

**Done when:** node --import docs/audits/bloat-review-2026-11/scripts/sources/hooks.mjs.txt docs/audits/bloat-review-2026-11/scripts/sources/planner-ad/nav.mjs.txt prints 110 lookups per build (220 today) and under 2 ms per build (125 ms today), and the new count test in src/lib/store-nav.test.ts passes.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/admin-map.test.ts (what matchPath() answers), src/lib/store-nav.test.ts (tabs and areas), src/lib/admin-layouts.test.ts.
- src/lib/permissions.test.ts, src/lib/permissions.matrix.test.ts and src/lib/permissions.scan.test.ts: every page's key against the baseline; none may move.
- src/lib/docs-content.test.ts and src/lib/docs-api-reference.test.ts reach matchPath() through src/lib/docs-guide-tools.ts:273.
- e2e/signed-in/permissions.spec.ts and e2e/signed-in/admin-view.spec.ts: the menu a role sees.
- New, in src/lib/store-nav.test.ts: storeNav() with every feature on calls canOpen at most once per menu item (110 today). A count, not a time, so it does not flake.
- Rule kept: docs/rules/admin/platform.md:15 (a new page goes in a section's items and in ADMIN_PAGES; a test fails otherwise). No written rule asks for the per-call sort.

**Notes:** Do this first: it is the largest measured cost in the dimension, a few dozen lines, and every other shell finding (AD-4, AD-5, AD-9, AD-13) is multiplied by it. Unit is per shell render, not per navigation.
