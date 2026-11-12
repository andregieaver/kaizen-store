# CP-8 ✓ Small helpers are declared again in file after file

Copied code (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P2. **Effort:** S. **Confidence:** high. **Step:** 3.9.
- **Second check:** corrected.
- **Where:** `src/server/redirect-tools.ts:31-33`, `src/server/owner-tool-error.ts:1-2`, `src/server/customer-import.ts:104-107`, `src/server/privacy-erasure.ts:366`, `src/lib/experiments.ts:127`, `src/lib/admin-api.ts:116`, `src/server/exchanges.ts:394`, `src/server/work-time.ts:57`, `src/app/admin/(gated)/[store]/settings/shipping/actions.ts:39`, `src/server/owner-tools.ts:369`
- **Evidence:** helpers.mjs (second check): 84 helpers are declared with identical text in three or more files (412 declarations, 576 lines beyond one copy); 169 more in exactly two files (377 lines). My counts today: `const fail = (message: string): never` in 43 server files, each of which already imports OwnerToolError from owner-tool-error.ts (two lines long, exports only the class); isUuid declared 23 times in 23 files in three spellings; isUniqueViolation exported once (privacy-erasure.ts:366) and declared 9 times in 9 files; adminLink 19 times (13 identical); mainLocale 10 times (8 identical). Most of the repeated helpers are one line long.
- **Cost today:** 953 lines gross beyond one copy each, but most are one-liners; the real cost is three spellings of 'is this a uuid' and of 'is this a unique violation'. Paid by: An agent's session and correctness where two spellings disagree; the build hardly at all.
- **Saving:** About 300 to 500 lines net (estimate): 126 from fail, about 30 from isUniqueViolation, the rest from multi-line helpers; 953 is the gross bound before the import lines that replace the copies.
- **Risk:** Low: the bodies are identical. Where isUuid's spellings differ (a regex against z.uuid()), a value one accepted and the other refused would change; pick the regex and run the tests of the files that used zod's.

## The fix

1. src/server/owner-tool-error.ts: export `fail` (the body of redirect-tools.ts:31-33). In the 43 files delete the local const and add fail to the import they already have.
2. Add src/server/pg-errors.ts with isUniqueViolation (from privacy-erasure.ts:366, which re-exports it); replace the 8 other declarations (customer-import.ts:104-107 and the import files, which CP-1 also removes) and, when touched, the 30 files that test '23505' by hand.
3. Add src/lib/guards.ts with isUuid in the regex spelling (so zod stays out of the storefront's bundles), obj, list, finite and isRecord; lib/experiments.ts:127 and lib/admin-api.ts:116 re-export it; replace the identical copies.
4. Add adminLink(store, path) and mainLocale(store) to a tools helper (src/server/tool-words.ts) for the 13 and 8 identical copies in the *-tools.ts files.
5. Move only helpers of two lines or more, or with more than one spelling. A one-line helper used once is left alone.
6. Add src/lib/local-helpers.scan.test.ts: outside their home module no file declares isUuid, isUniqueViolation, or `const fail = (message: string): never`.

**Done when:** `rg -c '^(export )?(const|function) (isUuid|isUniqueViolation)' src --glob '!*.test.ts'` sums to 2 (today 32 in 32 files) and `rg -l 'const fail = [(]message: string[)]: never' src/server` prints one file (today 43).

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/storefront-bundle.scan.test.ts: guards.ts must import nothing a storefront bundle may not carry.
- The tools' integration tests (redirect-tools, product-tools, screen-tools and the rest of src/server/*-tools.int.test.ts) and src/lib/agent-eval.test.ts keep passing: fail() throws the same class.
- src/server/prompt-versions.ts hashes prompts, not helpers: no new prompt version is needed.

**Notes:** Correction kept from the second check: the net saving is about a third of the gross 950, because a one-line helper replaced by an import saves nothing but the drift. The helpers that share a name but not a body are CP-16.
