# TX-9 ✓ Nothing measures where the words go, so each of the leaks above could return

Interface text (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P1. **Effort:** M. **Confidence:** high. **Step:** 1.4.
- **Second check:** confirmed.
- **Where:** `src/components/admin/admin-catalogues.scan.test.ts:45-55`, `src/components/admin/templates-helpers.ts:1`, `src/lib/store-features.ts:14`, `src/lib/admin-messages/notifications.en.ts:1-9`, `src/lib/admin-messages/orders.en.ts:2-8`, `src/lib/storefront-bundle.scan.test.ts:16`, `e2e/signed-in/admin-scripts.spec.ts:36-46`, `docs/performance.md:190-198`, `.github/workflows/ci.yml:35`
- **Evidence:** Scripts have budgets per admin screen; the documents the words are handed in have none. The ratchet for catalogues in client code reads only files that say 'use client' and import a catalogue directly (admin-catalogues.scan.test.ts:45-55), so it does not see templates-helpers.ts, store-features.ts or the lib modules that import a catalogue by value (68 outside the admin by my count). Nothing keeps the registry out of code outside the admin (TX-1). 14 catalogue files import code; notifications.en.ts bundled alone is 524 KB minified, of which 47 KB is its own text and 454 KB is zod (verified report). Nothing looks for keys no code names. The comment at ci.yml:35 names the catalogues as the reason for the 7 GB heap; measured alone they take about 125 MB.
- **Cost today:** No running cost of its own. It is how 3.6 MB of text reached 802 route entries and over half of two documents without a test going red. Paid by: Everyone who pays for TX-1, TX-2, TX-4, TX-5, TX-7 and TX-8 again later.
- **Saving:** Keeps the savings of the findings above; no bytes by itself.
- **Risk:** Low. Each list needs a first baseline that only falls. The dead-key scan without its table list would flag live entries, as TX-11 shows; with it, a key that is live only through a string built at run time must be added to the list by hand.
- **Already tracked:** partly: admin-catalogues.scan.test.ts and admin-scripts.spec.ts exist; the gaps named here are in no plan

## The fix

1. Server reach: src/lib/admin-text-reach.scan.test.ts (TX-1 step 4): no value import of lib/admin-text outside the admin, and a ceiling on the catalogue files the proxy, /api/visit and the storefront layout reach, which only falls.
2. Visitor scripts: src/lib/storefront-bundle.scan.test.ts forbids lib/admin-messages (TX-8 step 3) and lib/known-cookies (TX-5 step 5).
3. Admin scripts: replace the matcher of admin-catalogues.scan.test.ts lines 45-55 with a walk that follows imports through modules without a directive (the walk of storefront-bundle.scan.test.ts; AC-11 writes it as src/components/admin/admin-bundle.scan.test.ts). Today's indirect import sites start as a list that may only shrink; lib/i18n and whole language modules join it after TX-7.
4. Catalogue files stay text: new src/lib/admin-messages/imports.scan.test.ts. A file of src/lib/admin-messages may import types, other catalogue files and a named list of plain label modules; today's value imports (36 in 14 files) are the starting list, which may only shrink, and zod is refused outright.
5. Dead keys: new src/lib/message-keys.scan.test.ts. It reads every leaf name of the storefront's English and the admin's English catalogues and every identifier in non-test files outside the catalogues, and fails for a key whose name appears nowhere. Tables read by a computed key or by matching English sentences are listed by their parent path (the problems tables of TX-10, option and state tables), not key by key; 192 key names sit in such tables today.
6. Documents: the document budget of TX-2 step 6 in e2e/signed-in/admin-scripts.spec.ts.
7. Correct the comment at .github/workflows/ci.yml:35: the whole program's type check needs the heap; the catalogues alone take about 125 MB.
8. One sentence each in CLAUDE.md (Conventions, beside the visitor's-scripts rule) and docs/performance.md: where the admin's words may be imported, and that a catalogue file imports no code.

**Done when:** pnpm test runs admin-text-reach.scan.test.ts, imports.scan.test.ts and message-keys.scan.test.ts green, and each fails on its planted case: an import of @/lib/admin-text in src/server/cart.ts, an import of zod in a catalogue file, and a new key that nothing reads.

**Tests and rules that hold today's behaviour, and change with it:**

- src/components/admin/admin-catalogues.scan.test.ts: its ALREADY list becomes the walking test's list (step 3).
- src/lib/storefront-bundle.scan.test.ts: two more forbidden targets (step 2).
- src/server/ratchet.scan.test.ts is the model for numbers that only fall (ratchet.baseline.json, scripts/ratchet.mjs).
- The tests-and-CI dimension (TC-10) notes 67 private file walkers in tests: write these scans on one shared walker in src/test.

**Comes after:** Each scan lands with the fix it guards: TX-1 (step 1), TX-5 and TX-8 (step 2), TX-4 and TX-7 (step 3), TX-11 (step 5), TX-2 (step 6)

**Notes:** Overlaps AC-10 and AC-11 (admin-client), SC-6 (storefront-client) and SG-14 (server graph), which ask for the same kind of guard from their side. Steps 4 and 5 are this dimension's own.
