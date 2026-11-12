# SD-9 ✓ A store's pages ask about every optional feature, whether that store uses it or not

What the server does for a storefront request (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P3. **Effort:** S. **Confidence:** medium. **Step:** 2.10.
- **Second check:** corrected.
- **Where:** `src/server/site-cookies.ts:86-108`, `src/server/experiments.ts:130-133`, `src/server/experiments.ts:155-158`, `src/server/experiments.ts:178-181`, `src/server/experiments.ts:234-237`, `src/server/search-rules.ts:51`, `src/server/search-rules.ts:88`, `src/components/product-parts.tsx:997-1019`
- **Evidence:** On a cold draw a store's page runs separate cached statements for the chat agent, remembered modals, the affiliate site, recommendation settings, cookie notes and campaigns, and asks about running experiments four separate ways: experimentOfPage (experiments.ts:130), storeHasExperiments (:155), siteTests (:178) and runningExperimentIds (:234), each its own 'use cache' with its own statement. Per search I measured 11 to 12 statements with search_rules read twice (+2), search_synonyms once and search_experiments once. The per-product-view part (back in stock, checkout questions, price breaks, producer schemes) is SD-2. The verifier struck three tables that are read inside statements that run anyway.
- **Cost today:** Estimate: about 6 to 8 of a cold page's 30 or so statements answer 'not used' for a store that uses none of these; each is a sub-millisecond indexed read. A few milliseconds per cold draw. Paid by: The database and the server per cold render.
- **Saving:** Estimate: 3 to 4 statements and a few milliseconds per cold draw beyond what SD-2 and SD-5 save, and one statement per search. Small.
- **Risk:** Low. The four functions keep their names and answers.

## The fix

1. src/server/experiments.ts gains one cached runningTests(storeId) (one statement: each running test's id, target page, the page's type and place, goal, goal block and variants with their pages), and experimentOfPage, storeHasExperiments, siteTests and runningExperimentIds (:130-240) become pure filters over it.
2. a search reads the store's search rules once: the caller that reads them first (src/server/search-rules.ts:51 or :88) hands them to the second.
3. Nothing else here: the consent chain is SD-5 step 3 and the per-view reads are SD-2. No feature is removed or hidden, and no store-level flags are added.

**Done when:** rg -c '"use cache"' src/server/experiments.ts prints 2 (5 today: the one read and siteVersionContent remain) and experiments.int.test.ts passes.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/experiments.int.test.ts, src/lib/experiments.test.ts, src/lib/ab-routing.test.ts; e2e A/B specs; docs/ab-testing.md names the readers.
- src/server tests of search rules and e2e search specs for step 2.

**Comes after:** SD-2; SD-5

**Notes:** P3 because the gain is a few sub-millisecond reads per cold draw. Do step 1 when experiments.ts is opened for SD-1 step 1g. Nothing in this finding is a case to retire, park or hide a feature.
