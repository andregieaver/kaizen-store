# DC-8 ✓ A feature's facts are written at four to six levels, in different words; lists copied from code drift

The written rules and the agents' context (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P2. **Effort:** S. **Confidence:** medium. **Step:** 0.41.
- **Second check:** corrected.
- **Where:** `CLAUDE.md:365`, `docs/rules/admin/website.md:439-441`, `docs/decisions.md:897`, `docs/combined-listings.md:1-12`, `src/server/product-groups.ts:14-18`, `src/lib/store-features.ts:15-30`, `docs/rules/admin/platform.md:229`, `docs/store-features.md:10-22`, `docs/rules/admin/commerce.md:272`, `docs/rules/admin/commerce.md:488`, `docs/rules/admin/website.md:152`, `docs/rules/admin/website.md:252`, `docs/rules/admin/website.md:469`
- **Evidence:** Combined listings, built on 11 November, is told in a CLAUDE.md line, a rule (with its title three times), a decision row (1.8 KB), a feature doc, the server file's header and the table's comment. The texts are rewritten, not pasted: the skeptic measured 11% shared 5-word runs on average over 18 features, so no test can hold them equal. What can be checked is whether they are true. Of 3,145 distinct code names cited in docs/rules, 5 no longer exist: CustomFieldsView (commerce.md:272; the code has CustomFieldView), freeUnitsFor() (commerce.md:488; freeUnits), revertGrids() (website.md:152), TemplatesPreview (website.md:252 and CLAUDE.md:309) and modalPanelStyle() (website.md:469; modalPanelClass). One copied list has drifted: the code has 14 store features (store-features.ts:15-30), the rule lists 11 (platform.md:229) and the feature doc's table 12 (store-features.md:10-22; no gift_cards or reviews).
- **Cost today:** Each new feature's facts are written four to six times by the agent that builds it, and a reader of a rule or doc can get an out-of-date list. No total in bytes is claimed. Paid by: An agent's session
- **Saving:** No total is claimed: the overlap is paraphrase. For a small feature like combined listings, about half of 5.7 KB of prose not written (estimate).
- **Risk:** Cutting too much from a rule removes context an agent needs: the rule stays the complete list of invariants and is the last place to trim. A name check can fail on a name that lives only in prose examples; keep it to names followed by a bracket.

## The fix

1. Fix the list: in docs/rules/admin/platform.md:229 replace the bracketed list of ids by 'the ids are FEATURE_IDS in src/lib/store-features.ts'. In docs/store-features.md:10-22 add the missing rows (gift_cards, reviews) and one sentence that the code's list is the truth.
2. Correct the five stale names after reading the code for each: commerce.md:272, commerce.md:488, website.md:152, website.md:252 with its CLAUDE.md line 309 (the heading and the line must stay equal while DC-1 has not landed), website.md:469.
3. One bullet in the core's Conventions (with DC-1's commit) on where each kind of fact lives: the invariant (never, only through) in the rule; why and what was rejected in the decision; how it works in the code's comments; a feature doc only for a spec that spans many files; a list that lives in code is named, not copied; test lists, CI runs and advisor results are not part of a decision.
4. Optional, in DC-3's scan test: every backticked name followed by '(' in docs/rules exists as an identifier in src, scripts, e2e, the migrations or the WordPress plugin. It holds the 5 at 0 once step 2 is done.

**Done when:** A re-run of the name check finds 0 cited names missing from the code (today 5), and rg -c FEATURE_IDS docs/store-features.md prints at least 1 (today none).

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/rules-index.test.ts holds website.md:252's heading equal to CLAUDE.md:309 until DC-1 lands.
- src/lib/store-features.ts:15-30 (FEATURE_IDS) is the list; store-nav.test.ts holds the admin's sections to it.
- docs/rules/admin/README.md:5: a rule changes in its file.

**Notes:** Added to the skeptic's version: the check of 3,145 cited names (5 stale, 0.16%), which shows the rules are kept true and that the drift is in copied lists, not in names.
