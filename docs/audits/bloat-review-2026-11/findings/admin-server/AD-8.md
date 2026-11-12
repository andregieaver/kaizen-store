# AD-8 ✓ An account's memberships are read two to four times per request, in four shapes

What the server does for an admin navigation (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P2. **Effort:** M. **Confidence:** high. **Step:** 2.18.
- **Second check:** corrected.
- **Where:** `src/server/auth.ts:271-287`, `src/server/auth.ts:328-340`, `src/server/support-desk.ts:130-139`, `src/server/books-clients.ts:32-41`, `src/server/control-center.ts:61-75`, `src/app/admin/(gated)/(owner)/layout.tsx:30-38`, `src/app/admin/(gated)/(owner)/stores/page.tsx:32`
- **Evidence:** listStores(), ownerDesks(), booksMemberships() and controlCenter()'s first statement each join store_members to stores (three also to store_roles) for the same account with slightly different columns and filters. The owner layout awaits them one after another (stores, desks, domains for a non-owner, books clients, support count: 4 or 5 sequential awaits), and the owner's Stores page calls listStores() directly instead of the cached storesOf(), so the layout's read is repeated. In a store, the member row and the stores list are read on every hard load, and the control center reads the same membership a third time on Home.
- **Cost today:** 2 near-identical statements per store hard load, 3 on the store Home, 4 on the owner's home, and 4 or 5 sequential waits before the owner level's frame paints. Paid by: The database and the server per request; the owner on each hard load of /admin.
- **Saving:** Estimate: 2 to 3 statements and 2 to 3 sequential waits per owner-level hard load; 1 statement on the Stores page for certain.
- **Risk:** Medium-low. Each caller filters differently, so the shared read must carry the fields and each caller keeps its own filter; a starter or closed store appearing in the level switcher would be the visible fault, and the three int tests above are the checks.

## The fix

1. src/app/admin/(gated)/(owner)/stores/page.tsx:32: call storesOf(account) (the request-cached reader the layout already used) instead of listStores(account). One statement less, no other change.
2. src/app/admin/(gated)/(owner)/layout.tsx:30-38: run ownerDesks(), holdsDomains() and booksClientStores() together after storesOf(), then the support count. Five waits become three.
3. src/server/auth.ts: add membershipsOf(account) behind React cache(): one statement returning, for every membership that is not disabled or expired, the store's id, slug, name, status, starter, sandbox, whether it is a template's working store, time zone, modules, and the member's role, kind, role id and role permissions.
4. Derive from it, each keeping its own filter: listStores() (not closed, not starter, not sandbox), ownerDesks() (keeps closed stores and working starters, support-desk.ts:133-134) and booksMemberships(). Leave controlCenter()'s first statement as it is (it also reads the plan and payments) unless AD-2 reworks it.
5. Do not touch memberRow() (auth.ts:319-340): its rule is to be read each time, never from a cache.

**Done when:** AD-12's counter shows the owner level's shell at 4 statements or fewer after the guard (5 or 6 today), and rg -n 'listStores\(' src/app shows no call outside storesOf().

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/security-review.int.test.ts, store-starters.int.test.ts and design-presets.int.test.ts (listStores: starters and sandboxes stay out).
- src/server/support.int.test.ts (ownerDesks: closed stores stay in), src/server/accountants.int.test.ts and src/lib/books-clients.test.ts (books clients).
- src/server/store-features-website.int.test.ts (storesOf).
- Rule kept: auth.ts:319-327 (the member's row is never cached). React cache() spans one render, so a membership taken away is gone on the next request.

**Comes after:** AD-12 step 1 (the statement counter)

**Notes:** A true duplicate, but small next to AD-1 and AD-2. The first two steps are an afternoon; the shared reader is worth doing when AD-2 touches the control center, not before.
