# FT-2 ✓ Nothing makes a new feature state what it costs a store that does not use it

The product's surface (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 1.18. **The owner's choice.**
- **Second check:** corrected.
- **Where:** `docs/decisions.md:749`, `docs/audits/code-review-2026-11.md:222`, `src/lib/store-nav.test.ts:245`, `src/lib/tool-budget.ts:5`, `src/app/api/cron/cart-reminders/route.ts:128`, `src/server/ratchet.scan.test.ts:1`, `src/server/cron-routes.scan.test.ts:1`, `scripts/ratchet.mjs:1`
- **Evidence:** Between 29 October and 11 November docs/decisions.md gained 158 rows (D406 to D572, the skeptic's count), many on the owner's instruction: the owner building towards opening, not a pause that failed. What is missing is a check on idle cost. Counted today: 83 dispatcher jobs (78 in runJobs() and 5 after it, cart-reminders/route.ts:128-275), 9 routes every minute (trackedRoute(..., 60) under src/app/api/cron), 560 page.tsx, 268 route handlers, 481 tables, 110 store links (42 in Basic), 254 store tools (tool-budget.ts:5 still says about 190 and 24 of the manager's own). The one budget test covers Basic links only (store-nav.test.ts:245-253). The cart finding (FT-15) is what an unstated idle cost looks like: three features each added a read to every basket and nothing asked. The repo already has the pattern for a count that may only fall or must be raised on purpose: ratchet.scan.test.ts with its baseline file and scripts/ratchet.mjs.
- **Cost today:** Each addition raises fixed costs every store shares: statements every five minutes, definitions in an AI round up to the cap, pages in a build that peaked at 7.6 GB on this machine, a read on a shared path. None is stated when the feature is built. Paid by: The build, CI, the server every five minutes and per request, an agent's session
- **Saving:** No direct saving. It makes a feature's idle cost visible before it is built, when it is cheapest to avoid.
- **Risk:** A baseline is easy to raise by habit; the 'Idle cost:' line is what gives it meaning, and only a reader can judge it. It adds a step to features the owner asks for the same day. A count is a proxy: one heavy read on the cart costs more than ten pages, so the line matters more than the number.

## The fix

1. scripts/lib/surface-count.mjs (new, pure, no database): count the dispatcher's jobs (keys of runJobs("dispatcher") plus tracked("dispatcher.…") in src/app/api/cron/cart-reminders/route.ts), every-minute cron routes, page.tsx files and route handlers under src/app, tables (`commerce.table(` in src/db/schema.ts), store links and Basic links per section and in all (STORE_SECTIONS), platform links, store tools, tools offered to a store whose features are ['shop'], the manager's own tools, feature ids.
2. src/lib/surface-budget.baseline.json (new): today's numbers (83, 9, 560, 268, 481, 110 and 42, 52, 254, 234, 26, 14) and a list `raises` of { count, from, to, decision }.
3. src/lib/surface-budget.scan.test.ts (new, built like src/server/ratchet.scan.test.ts): fails when a count is above its baseline; fails when a raise names a decision whose row in docs/decisions.md has no sentence beginning 'Idle cost:'; fails when a count fell and the baseline was not lowered; one case proves the counter counts what it says.
4. scripts/surface-budget.mjs (new, like scripts/ratchet.mjs): `node scripts/surface-budget.mjs` lowers; `--raise D<n>` raises after checking the decision row says, after 'Idle cost:', what the feature costs a store that does not use it per request, per scheduled run, per AI round and per build ('none' where none).
5. One line in CLAUDE.md Conventions and its full text in docs/rules/admin (the frame's file): a change that adds a job, an every-minute route, a page, a table, a link or a tool raises the surface budget with its decision's 'Idle cost:' line. Keep CLAUDE.md to that one line.
6. Correct src/lib/tool-budget.ts:5 (254 store tools and 26 of the manager's own, or derive the numbers) and let step 4.3 generate docs/admin-navigation.md (it says 104 and 40).

**Done when:** `pnpm test src/lib/surface-budget.scan.test.ts` passes on main, and its own case shows that one more job in the dispatcher's list without `--raise` fails it.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/store-nav.test.ts:245-253 stays (at most 12 Basic links a section, Basic under half).
- src/server/cron-routes.scan.test.ts stays (every cron route tracked, with a time limit).
- CI: the quick gate before a deploy (D526) runs lint, types and the money tests; this scan runs with the full checks beside it, so it reports and does not hold a deploy back. Say so in docs/ci-migrations.md.
- CLAUDE.md Conventions (the ratchet's paragraph is the model for the wording).

**Notes:** Other dimensions of this review ask for budgets of their own (scheduled work, the schema, the size of an AI call, statements per screen, the server side). One baseline file and one script can hold all of them; this finding supplies the surface counts. Do it before the next feature, so the first one built after opening already states its idle cost.
