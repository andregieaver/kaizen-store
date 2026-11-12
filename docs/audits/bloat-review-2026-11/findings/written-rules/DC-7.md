# DC-7 ✓ Dated reports, draft notes, review evidence and generated tables turn up in every docs search

The written rules and the agents' context (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P2. **Effort:** S. **Confidence:** medium. **Step:** 0.27.
- **Second check:** corrected.
- **Where:** `docs/audits/psi-2026-10-24.md:1`, `docs/audits/psi-2026-11-01.md:1`, `docs/wave-10-notes/d.md:1-5`, `docs/ab-testing-spike/README.md:3`, `docs/shopify-parity.md:5`, `docs/audits/bloat-review-2026-11/evidence`, `src/lib/rules-index.test.ts:45-49`
- **Evidence:** ripgrep lists 225 files and 10,518,218 bytes under docs. Not living rules and cited by no code: the 5 dated PSI reports (542,790 bytes), wave-10-notes (30,059; draft decision rows that decisions.md now holds), the A/B spike (9,110) and the evidence folder of this review's first draft (189,540). Generated: shopify-parity.md (288,921 bytes, 270,980 between its markers). Together 22 files and 1,060,420 bytes, 10% of docs. A search for 'placeOrder' lists 47 files in docs. The wave and phase specs beside them are cited as the contract and are left alone. There is no .rgignore or .ignore. Tested in scratch folders with ripgrep and the Grep tool: an ignore file placed in the folder itself with bare names (docs/.rgignore, docs/audits/.rgignore) is applied from the root and from every subfolder, and naming the skipped file or folder as the search path still finds it; one root .rgignore with paths is not applied when the search starts in a subfolder (rg x docs showed the PSI report and the evidence folder).
- **Cost today:** Longer file lists and cut-off results that need a second, narrower search. No token total is claimed: the harness shows 250 lines of a search by default and a 2 KB preview of a long output. Paid by: An agent's session
- **Saving:** 22 files and 1.06 MB (10% of docs) leave default searches. No token saving is claimed.
- **Risk:** The filter is silent: an agent that searches docs for a phrase and finds nothing may conclude it is not written down; the core's line and the rule that a named path is searched are the guard. A glob does not lift the filter, only a named path does (tested). A person using ripgrep or an editor built on it gets the same filter.

## The fix

1. Add docs/.rgignore with three lines: shopify-parity.md, wave-10-notes/ and ab-testing-spike/.
2. Add docs/audits/.rgignore with two lines: psi-2026-*.md (the five dated reports; psi-followups.md stays searchable) and evidence/ (any review's evidence folder).
3. Add supabase/.rgignore as DC-13 says, in the same commit.
4. One line in the core (with DC-1's commit): default searches skip dated audit reports, review evidence, the generated parity report, old migrations and Drizzle's snapshot; name the file or folder to search them.
5. Say in docs/audits (a short README there, or the core's line): a review's evidence tables go in a folder named evidence, or stay out of the repo.
6. Move nothing: 9 docs link the PSI reports by path.

**Done when:** From the repo root rg --files docs | wc -l prints 203 (today 225), rg -l placeOrder docs | wc -l prints 43 (today 47), and rg -l placeOrder docs/audits/psi-2026-10-24.md still finds the file when it is named.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/rules-index.test.ts:45-49 fails on any file in docs/rules/admin that its README does not name: put no ignore file there.
- docs/audits/psi-followups.md and other docs link the PSI reports by path: the files stay where they are.
- No test or script lists docs or docs/audits by folder (searched src and scripts).

**Notes:** I changed the skeptic's single root .rgignore to per-folder files: tested here, root-file patterns with a path are dropped when a search starts in docs or supabase, while bare names in the folder's own file hold from every starting point.
