# CP-7 ✓ The one wrapper for server actions is marked Done but carries 3 of the admin's 235 action files, and nothing counts the rest

Copied code (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P1. **Effort:** L. **Confidence:** high. **Step:** 4.1.
- **Second check:** confirmed.
- **Where:** `src/server/store-action.ts:33-50`, `src/server/ratchet.scan.test.ts:22-56`, `src/server/ratchet.baseline.json:1`, `scripts/lib/ratchet-count.mjs:72`, `scripts/ratchet.mjs:26-36`, `docs/audits/code-review-2026-11.md:61`, `docs/rules/admin/platform.md:87-89`, `src/app/admin/(gated)/platform/themes/actions.ts:130-142`, `src/app/admin/(gated)/[store]/customers/actions.ts:54-68`, `src/app/admin/(gated)/[store]/orders/actions.ts:71`
- **Evidence:** 271 files start with 'use server' (24,583 lines) and export 1,372 actions. Under src/app/admin there are 235 such files and 3 import store-action (orders, returns, books: 45 actions); my rg confirms 232 off the wrapper. 31 of the 271 files contain a catch. 23 admin action files define a local guard wrapper (asOwner 11, member 4, owner 3, change 3, guarded 1, act 1). The ratchet (ratchet.scan.test.ts, five tests) counts unchecked reads, casts and store-less writes, not actions off the wrapper. Admin files named actions.ts went from 183 at the code review to 191 now. Where the wrapper is used it costs one line per action (orders/actions.ts:71).
- **Cost today:** Few lines; the cost is that the hand-written shape stays the default for every new action file (8 more admin action files since the review), and an unplanned failure in the 232 files shows Next's error page instead of a line in the form. Paid by: Owners (an error page instead of a line in the form) and agents (each new file copies a hand-written neighbour).
- **Saving:** About 150 lines of local wrappers; the gain is one failure path for the admin's actions and a number that can only fall.
- **Risk:** The ratchet alone is small and cannot break a screen. Moving a file can change what a form shows on refusal; each action's refusal shape differs, which is what answer() is for, and the area's integration tests show a wrong one.
- **Already tracked:** Yes: code review step 1.4 (FV9), Done for orders, returns and books; the rest 'when touched' (docs/rules/admin/platform.md:89). No ratchet holds it.

## The fix

1. scripts/lib/ratchet-count.mjs: add actionFilesOffWrapper(root): the files under src/app/admin that start with 'use server' and do not import @/server/store-action. ratchetCounts() returns the list.
2. scripts/ratchet.mjs writes the list to src/server/ratchet.baseline.json (232 files today) and refuses to add one.
3. src/server/ratchet.scan.test.ts: a new test fails for a 'use server' file under src/app/admin that is neither on the wrapper nor in the list ('Run the action through storeAction() or platformAction()'), and for a listed file that has since moved, until the baseline is lowered.
4. Move the 23 files that already have a local wrapper first: keep the local function's name and result shape and make its body one call to storeAction() or platformAction() with `answer`.
5. Then Work's seven files (with CP-5), then each area when it is next touched, as docs/rules/admin/platform.md:89 says. Leave the storefront's 29 action files out: they have no member to guard.
6. In docs/audits/code-review-2026-11.md add to step 1.4's row how many files are on the wrapper and that the ratchet holds the rest, with a change-log line; add the ratchet's new count to CLAUDE.md's Conventions sentence about ratchet.scan.test.ts.

**Done when:** src/server/ratchet.scan.test.ts holds the new test, and adding a 'use server' file under src/app/admin that does not import store-action makes `pnpm test src/server/ratchet.scan.test.ts` fail; the baseline lists 232 files or fewer.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/store-action.test.ts (the wrapper's own tests) and returns-actions.int.test.ts (an approval that throws answers a plain line and logs action.failed once).
- src/lib/permissions.scan.test.ts: storeAction and platformAction are in DELEGATED_GUARDS (src/lib/permission-guards.ts), so a moved file still passes; the per-file key lists there stay true because the key is named in the storeAction call.
- docs/rules/admin/platform.md:87-89 and CLAUDE.md 'Server actions run through storeAction() / platformAction()' already state the rule; the ratchet makes it hold for new files.
- Each moved area's own integration tests for refusal shapes, since answer() must return what each form expects.

**Notes:** Two sizes in one finding: steps 1 to 3 are an hour's work and belong in the same push as CP-14's ratchet; steps 4 and 5 are L and are worth it for the failure path, not for lines. Before opening is a good time for the 23 files with a local wrapper: owners will then meet a line in the form, not Next's error page, from day one.
