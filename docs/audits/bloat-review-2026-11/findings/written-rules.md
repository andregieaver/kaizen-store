# The written rules and the agents' context (DC)

Part of `docs/audits/bloat-review-2026-11.md`. One reviewer's reading of this area, 11 November 2026, commit 0bd814c. A tick (✓) marks a
finding checked a second time against the code, the build or production; the others were not (the second reviewers did not run: see
the review's section 6). "Step" is the step of the plan that closes the finding.

**In short.** The part every session pays for is bloated: CLAUDE.md plus AGENTS.md is 44 KB (about 11,000 tokens, estimate at 4 characters a token), 71% of it a 295-line feature index, and the median change of the last 65 code commits touched files named by 2 of those 295 rules. The docs read on demand are very large (7.9 MB of Markdown, about 2 million tokens; decisions.md alone 1.33 MB) but cost nothing until opened; their real fault is format: one decision ID costs 2 to 45 KB to look up, 885 lines over 1,000 characters hold 24% of all docs bytes, and 41% of the folder is finished history that a search returns beside the living rules. Nothing caps any of it: CLAUDE.md has regrown 35% in the 12 days since its last diet, docs/rules 51%, and one test requires a new always-loaded line for every new rule. Nothing from docs reaches the deployment, and source comments (13.8% of src bytes) are short, local and stripped from the build, so they are not the problem.

## Measured

| Measure | Value | How |
|---|---|---|
| Loaded into every session | CLAUDE.md 43,361 bytes, 448 lines; AGENTS.md 679 bytes (imported on line 1). Together about 11,000 tokens (estimate, 4 characters a token). The harness's own guidance is under 200 lines. | wc -c -l; the guidance read from code.claude.com/docs/en/memory in this session |
| Share of CLAUDE.md that is the feature index | 30,806 of 43,361 bytes (71%): Storefront 33 lines, Admin 262 lines; 28 lines are cut mid-sentence with an ellipsis. The rest (workflow, stack, commands, database, conventions) is 12,544 bytes. | node one-liner summing bytes per '## ' section of CLAUDE.md |
| Rules a typical change needs | Median 2 of 295 (p75 6, p90 9); 20 of 65 commits touched no file any rule names. Median size of the rules needed: 4.6 KB. | scripts/relevance.mjs: for each of the 65 commits in the clone that changed non-test src files, count rule sections whose text names a changed file |
| docs folder | 9,714,759 bytes in 193 files; 158 Markdown files hold 7,895,137 bytes and 56,618 lines (about 2 million tokens, estimate). Two images hold 856 KB (mockup.png 662 KB, reference.jpg 194 KB). | du -sb; find by extension; wc |
| docs/rules | 565,913 bytes, 295 rules in 7 files; largest website.md 162,812 bytes (about 40,700 tokens), commerce.md 112,671. Median rule 1,428 bytes; 17 over 5 KB; 151 rules are one paragraph; 114 lines over 1,000 characters hold 261 KB (46%). It was 374 KB on 30 October (docs/consolidation.md:12). | wc; node script splitting each file at '## ' headings |
| docs/decisions.md | 1,329,266 bytes, 930 lines, 563 decision rows (D1 to D572). Average row 1,579 bytes for D1-D100, 3,488 for D401-D500; longest 17,985 characters. 196 rows (585 KB) sit under the heading 'Migration versions'; the migration list itself is 19.8 KB, 272 rows, last entry 4 October. | wc; node script grouping lines by heading and by hundred |
| Cost of looking up one decision | A search for one ID in decisions.md returns 1.8 KB (D566), 9.1 KB (D211), 20.5 KB (D153), 22.3 KB (D442) or 45.3 KB (D178). Reading the single line of D442 returned 18 KB. Source cites decision IDs 19,251 times in 4,927 files (494 distinct IDs). | rg '\bDnnn\b' docs/decisions.md \| wc -c for 9 IDs; Read of line 782; rg -o count over src |
| Growth with no cap | CLAUDE.md: 382 KB before 30 Oct, 32 KB after its diet, 39.5 KB on 9 Nov, 43.4 KB on 11 Nov (+35% in 12 days). decisions.md +80 KB and all docs +156 KB in the 33 hours of history in this clone, while non-test src grew 919 KB. | docs/consolidation.md:12-13; code review FH5; git cat-file -s on the oldest (10 Nov 12:50) and newest (11 Nov 21:51) of the 101 commits; git ls-tree -l sums |
| Doc upkeep per commit | 57 of 101 commits touch docs/, 40 touch decisions.md, 23 CLAUDE.md, 21 docs/rules, 13 rewrite the parity rows and the generated report. | git log --name-only over the clone's 101 commits |
| Finished history in docs | 3.23 MB of 7.9 MB (41%): 26 wave specs 2,233,777 bytes; 5 dated PSI reports 542,790; 6 phase plans 81,674; generated tables of the parity report 269,616; plan.md 72,617; wave-10-notes 30,059. Living rules are 7%, decisions 17%. | node script classifying docs/*.md by name; wc on the named sets |
| Long lines in docs | 885 lines over 1,000 characters hold 1.93 MB (24% of docs Markdown). A content search of docs for 'placeOrder' returns 238 KB for 229 lines; 57 KB with history files and decisions.md left out. | awk over docs/**/*.md; rg \| wc -c with and without globs |
| Comment share of src | All of src: 96,842 comment lines of 1,102,973 (8.8%), 7.84 MB of 56.85 MB (13.8%). By bytes, non-test code: lib 24.9%, server 19.6%, db 31.7% (schema.ts alone 342 KB of comments, 32%), components 12.8%, app 13.1%. Tests 4 to 8%. 2,408 of 4,139 non-test files open with a header comment, average 517 bytes; 2,139 of those cite a decision. | scripts/comments.mjs (lines starting with // or inside block comments, per top-level folder) |
| Copies of one feature's rule (sample of 18 features) | Each is described in 4 to 6 places. Together 869 KB: CLAUDE.md lines 2.1 KB, rule sections 62 KB, decision rows 66 KB, 13 feature docs 592 KB, comments in the main files 147 KB. Word-for-word overlap is low: on average 11% of a rule's 5-word runs also appear in its decision, doc or main files (2% to 26%). | scripts/copies.mjs and overlap.mjs; three features read side by side |
| Docs in the deployment | None of docs/, CLAUDE.md or README.md. Only content/docs (168 files, 885 KB) is traced, into 22 of 832 route traces. | rg over every .nft.json in .next/server of the finished build (build-summary.txt exit=0) |
| content/ and .claude/ | content/docs: 96 English and 70 Norwegian articles, 885,306 bytes. .claude: one file, workflows/parity-wave.js, 37,138 bytes; no rules, settings or hooks. | find, wc, du |

## Well made, and should stay

- Nothing under docs/, CLAUDE.md or README.md reaches a deployed function: all 832 route traces in the finished build were searched; only content/docs appears, in 22 routes (the docs pages and APIs, the platform's docs admin, the platform AI page and two crons).
- Tailwind does not scan docs: src/app/globals.css:6-9 imports it with source(none) and names its sources.
- Source comments are stripped from both the browser's and the server's build output: comment text searched for in .next/static and .next/server gave no hit, and the largest server chunk is minified.
- Comments are the cheapest copy of a rule and are well aimed: file headers average 517 bytes, function comments explain why. They load only when the file is read. Keep them; cut the docs side instead.
- The written rules are accurate where they can be checked: all 1,322 src paths cited in docs/rules exist, all 92 docs cited in CLAUDE.md exist, and src/lib/rules-index.test.ts holds every index line to exactly one heading.
- The docs portal's content is read from disk at build, prerendered, and traced only into the docs routes; /docs is the lightest page measured (220 KB transferred, routes.md).
- .claude holds one workflow file that loads only when run; there are no stale settings, hooks or rule files.
- Binary assets in docs are two images, 856 KB together, each used by one doc.
- Later specs shrank by themselves: waves 9 to 13 are 7 to 31 KB, against an average of 121 KB for the 14 specs written in the saved workflow's shape.
- An ignore file works as an archive switch: tested in a scratch folder, a .rgignore line makes both rg and the harness's Grep tool skip a folder unless the search names it.

## Findings

### DC-1 ✓ Every session loads a 295-line feature index; a typical change needs 2 of its lines

- **Kind:** eager. **Effort:** M. **Confidence:** high. **Step:** 4.4. **The owner's decision.**
- **Where:** `CLAUDE.md:95-399`, `CLAUDE.md:61-93`, `src/lib/rules-index.test.ts:28-43`, `docs/audits/code-review-2026-11.md:291`, `docs/audits/code-review-2026-11.md:432`, `.claude/workflows/parity-wave.js:185-274`
- **Evidence:** CLAUDE.md is 43,361 bytes and 448 lines (wc). Its Storefront and Admin sections are 30,806 bytes (71%), 295 one-line pointers. Over the 65 commits in this clone that changed non-test src, the median commit touched files named by 2 of the 295 rules (p75 6, p90 9; 20 commits none), measured by matching each commit's files against the paths each rule names. The harness's documentation (code.claude.com/docs/en/memory, read in this session) says: target under 200 lines; the root CLAUDE.md is put back after every compaction; a file in .claude/rules with a paths: front matter loads only when a matching file is read, written or edited; a CLAUDE.md in a subfolder loads only when a file there is read. 273 of the 295 rules already name at least one src path and all 1,322 named paths exist. A named file has a median of 1 rule (2.0 KB), p90 6.9 KB, max 17.6 KB (page-content.ts, 5 rules). src/lib (1,798 files) and src/server (1,395) are flat, so a nested CLAUDE.md there would load for everything.
- **Cost today:** About 11,000 tokens (estimate) at the start of every session and every subagent, and again after each compaction. One parity-wave run starts 13 agents: about 143,000 tokens of CLAUDE.md (estimate). Paid by: An agent's session
- **Fix:** Keep a core of about 7 KB: what the product is, workflow, stack, commands, the money rule, the conventions that hold everywhere (Homer and Lisa, platform parity, the name, env, server-only) and five lines on where rules live. Make each rule its own file in .claude/rules/{area}/{slug}.md with a paths: list generated from the paths its text already names (22 rules name none and need globs by hand); the harness then loads a rule when the agent opens a file it covers. Move the migration bullets (1,980 bytes) to src/db/CLAUDE.md and supabase/CLAUDE.md, the signed-in testing paragraph to e2e/CLAUDE.md and the cron rule to src/app/api/cron/CLAUDE.md, which are real folders. Generate docs/rules/INDEX.md (one line a rule) for search by word; it is not loaded. Rewrite rules-index.test.ts to check that every glob matches a file and the index is current. Try three rules first and confirm they load (the harness's InstructionsLoaded hook logs it).
- **Saving:** About 36 KB, about 9,000 tokens, per session, per subagent and per compaction (estimate). A change then loads the rules of the files it opens: median 2 KB (measured fan-in).
- **Risk:** A rule loads on Read, Write or Edit, not on a search alone, so an agent that plans before opening files must search the index. Globs for src/app paths with [store] need escaping. Tools other than Claude Code that read AGENTS.md will not load the rule files. Path-scoped loading inside subagents was read in the docs, not tested here.
- **Already tracked:** Code review step 1.10 (FH5), Open: it already plans to cut CLAUDE.md to about a quarter by moving the index to the top of the six area files. New here: the measured need (2 of 295), path-scoped rule files as the mechanism, the nested files, and the subagent and compaction multipliers.

### DC-2 One decision costs 2 to 45 KB to look up, and the newest 196 decisions sit under the wrong heading

- **Kind:** oversize. **Effort:** M. **Confidence:** high. **Step:** 4.4.
- **Where:** `docs/decisions.md:8-379`, `docs/decisions.md:420-707`, `docs/decisions.md:708-903`, `docs/decisions.md:782`, `src/lib/docs-content.test.ts:43`, `scripts/parity.mjs:44`, `src/lib/parity.test.ts:441`, `docs/audits/code-review-2026-11.md:254`
- **Evidence:** decisions.md is 1,329,266 bytes in 930 lines. 'Settled' holds D1 to D369 (718 KB). From line 708, D366 to D572 (196 rows, 585 KB) follow a paragraph under '### Migration versions' with no table header, so they no longer render as a table. The code review read lines 420-866 as the migration list; the list is 19.8 KB. The average row grew from 1,579 bytes (D1-D100) to 3,488 (D401-D500). 219 of 563 rows cite a CI run and 204 the advisors; the text from the first such marker to the row's end is about 160 KB (rough). A search for one ID returns 1.8 to 45.3 KB; reading line 782 (D442) returned 18 KB covering four build steps, test lists and bugs found. Source cites decisions 19,251 times. Splitting per hundred, as step 1.10 offers, would give files of 146 to 349 KB, over that step's own 100 KB target.
- **Cost today:** About 500 to 11,000 tokens per ID looked up (estimate), so most of the 19,251 pointers in code are not affordable to follow; about 332,000 tokens to read whole. The file grew 80 KB in the last 33 hours. Paid by: An agent's session
- **Fix:** One file per decision (docs/decisions/D566.md) with a generated one-line index. A new decision says what was decided, why, what was rejected and where it lives, in at most 1,200 characters; what was built goes to the rule or feature doc, and the CI run and advisor result to the commit message. Today, as a first small step, move rows 708-903 into the Settled table. Change the three readers that parse '| Dnnn |' rows in the same commit.
- **Saving:** A lookup returns that decision alone: median 1.9 KB, about 500 tokens, instead of up to 11,000 (estimate). Dropping release notes from rows: about 160 KB (rough estimate).
- **Risk:** Three readers parse the table (docs-content.test.ts:43, parity.mjs:44, parity.test.ts:441) and must move together. Shortening old rows by hand risks losing a reason; split mechanically first and shorten only new rows.
- **Already tracked:** Code review step 1.10 (FH4), Open: split with a generated index and a scan test. New here: the heading mix-up, the per-ID costs, the growth of row size, the release-log content, and that per-hundred files miss the step's own target.

### DC-3 Nothing caps the written rules, and one test makes the always-loaded file grow with every feature

- **Kind:** no check. **Effort:** S. **Confidence:** high. **Step:** 1.6.
- **Where:** `src/lib/rules-index.test.ts:28-43`, `docs/consolidation.md:12-13`, `docs/audits/code-review-2026-11.md:291`, `CLAUDE.md:133-399`
- **Evidence:** CLAUDE.md was cut from 382 KB to 32 KB on 30 October (consolidation.md:12-13), was 39.5 KB on 9 November (code review FH5) and is 43,361 bytes on 11 November: +35% in 12 days. 23 of the last 101 commits changed it, net +26 lines. docs/rules went from 374 KB to 566 KB in the same 12 days (+51%). decisions.md grew 80 KB in 33 hours and its average row doubled. rules-index.test.ts fails when a rule heading has no line in CLAUDE.md, so each new rule must add an always-loaded line. In the same 33 hours docs grew 156 KB against 919 KB of non-test code.
- **Cost today:** About 0.95 KB a day added to what every session loads (about 240 tokens a day, measured average since 30 October); about 16 KB a day in docs/rules and 58 KB a day in decisions.md. Paid by: An agent's session, every later one
- **Fix:** A docs ratchet beside src/server/ratchet.scan.test.ts: CLAUDE.md at most 10,000 bytes and 200 lines; a rule at most 4,000 bytes (the 17 over 5 KB go in a baseline that may only shrink); a new decision at most 1,200 characters; no line over 600 characters in a rule file. Drop the check that every rule heading needs a CLAUDE.md line.
- **Saving:** Stops the regrowth measured above; keeps the saving of DC-1 and DC-2 from being spent again.
- **Risk:** A hard cap can push agents to write cryptic text; the baseline of allowed exceptions and a plain error message that says where the overflow belongs avoid that.
- **Already tracked:** no (step 1.10 sets one-time targets, no standing check)

### DC-4 The six rule files are too big to open and are written as walls of text

- **Kind:** oversize. **Effort:** M. **Confidence:** high. **Step:** 4.4.
- **Where:** `docs/rules/admin/website.md:1`, `docs/rules/admin/commerce.md:40`, `docs/rules/admin/platform.md:227`, `docs/rules/storefront.md:1-12`, `docs/rules/admin/README.md:8-13`, `CLAUDE.md:97`, `CLAUDE.md:135`
- **Evidence:** CLAUDE.md tells agents to read a rule before changing its part. The files are 49 to 163 KB: website.md 162,812 bytes (about 40,700 tokens), commerce.md 112,671 (about 28,200). 151 of 295 rules are one paragraph; 114 lines over 1,000 characters hold 261 KB (46%); the longest line is 7,436 characters. 191 rules repeat their heading in bold as the body's first words (19.1 KB); the same words are the CLAUDE.md line, so each title is stored three times. A content search of docs/rules for 'placeOrder' returns 52.8 KB for 37 lines; 'featureOn' returns 6.7 KB for one line. The README's counts say 241 rules; the files hold 262.
- **Cost today:** A whole-file read costs 12,000 to 40,000 tokens (estimate); one search hit returns up to 7.4 KB. Paid by: An agent's session
- **Fix:** When the rules are split one per file (DC-1): drop the bold repeat of the heading, write one fact per bullet of at most 400 characters, and hold a rule to 4 KB with a pointer to the feature doc's section for the rest. Generate the README's counts or delete them.
- **Saving:** 19 KB of repeated titles gone; a search hit returns one bullet instead of up to 7.4 KB; opening a rule costs its own size (median 1.4 KB, about 360 tokens).
- **Risk:** Reflowing text by script can break a sentence: split by script, reflow by hand when a rule is next touched.
- **Already tracked:** no (step 1.10 keeps the six area files and moves the index to their tops)

### DC-5 CLAUDE.md sends agents to a 73 KB plan written before the platform was multi-tenant

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 4.4.
- **Where:** `CLAUDE.md:5-6`, `README.md:15`, `docs/plan.md:3`, `docs/decisions.md:3-6`, `docs/decisions.md:422`
- **Evidence:** CLAUDE.md:5-6 says to read docs/plan.md before architectural work; README.md:15 says to skim it. plan.md is 72,617 bytes. Its banner was last updated 23 September 2026; decisions.md:422 dates multi-tenancy to 24 September. It recommends Frankfurt, Supabase eu-central-1, AI SDK 7 through Vercel AI Gateway and a monorepo; package.json has no AI SDK and CLAUDE.md's own Stack section says Dublin. decisions.md:3-6 says the plan predates some decisions and loses where they differ.
- **Cost today:** About 18,000 tokens (estimate) for any agent that follows the instruction, for a stack that was not built. Paid by: An agent's session
- **Fix:** Point CLAUDE.md:5-6 and README.md:15 at docs/platform.md (16,193 bytes) for how the platform is built; move plan.md to docs/archive as research.
- **Saving:** About 14,000 tokens per session that does architectural work (72.6 KB less 16.2 KB; estimate).
- **Risk:** The plan's conversion and legal research still has value; it stays in the archive and can be cited by section.

### DC-6 The code review's Progress table must be read before every fix and grows by about 0.9 KB a step

- **Kind:** oversize. **Effort:** S. **Confidence:** high. **Step:** 4.4.
- **Where:** `CLAUDE.md:446-448`, `docs/audits/code-review-2026-11.md:26-164`, `docs/audits/code-review-2026-11.md:31`
- **Evidence:** CLAUDE.md:447 says to read the table before starting a fix. Lines 22-135 are 21,722 bytes. The 18 rows written so far total 16,641 bytes (average 925, largest 1,615); 55 of 73 steps are still Open and empty. The doc's own rule (line 31) asks only for the date and the commit in Notes. The notes restate the decision rows: D572 is told in CLAUDE.md, ci-migrations.md, two places in the review and decisions.md (3,340 bytes of lines).
- **Cost today:** About 5,400 tokens per fix session today; about 17,000 when all 73 rows are written at the same average (estimate). Paid by: An agent's session
- **Fix:** Hold Notes to status, date, commit and decision ID (at most 200 characters), as line 31 already says; the story belongs in the decision. Shorten the 18 written rows the same way.
- **Saving:** About 4,000 tokens per fix session now, about 15,000 by the end of the plan (estimates).
- **Risk:** Low; the detail is kept in the decisions and the change log.

### DC-7 41% of the docs is finished history that a search returns beside the living rules

- **Kind:** dead. **Effort:** S. **Confidence:** high. **Step:** 4.4.
- **Where:** `docs/audits/psi-2026-10-24.md:1`, `docs/audits/psi-2026-11-01.md:1`, `docs/audits/psi-followups.md:1-5`, `docs/wave-3-orders.md:1051-1123`, `docs/wave-10-notes/d.md:1-5`, `docs/ab-testing-spike/README.md:3`, `docs/shopify-parity.md:5`
- **Evidence:** Of 7.9 MB of Markdown in docs, 3.23 MB is history or generated: 26 wave specs (2,233,777 bytes), 5 dated PSI reports (542,790; nothing in src, scripts, e2e or CI names them; the follow-ups file has 93 of 105 items ticked), 6 phase plans (81,674), the parity report's generated tables (269,616), plan.md and wave-10-notes. Inside the wave specs, 53 handover sub-sections (draft decision rows, draft CLAUDE.md bullets, merge notes) hold 86 KB. Source cites wave docs by path and section number about 1,900 times, so they cannot simply be deleted. A content search of docs for 'placeOrder' returns 238 KB; 177 KB without the history files; 57 KB without them and decisions.md. In a scratch folder, a .rgignore line made rg and the Grep tool skip a folder unless the search named it.
- **Cost today:** A docs-wide search for a common name returns up to about 59,000 tokens (estimate), most of it history and long decision rows. Paid by: An agent's session
- **Fix:** Add a .rgignore at the root listing docs/archive/, docs/wave-*.md, docs/theme-phase-*.md, docs/theme-showcase-phase-*.md, docs/audits/psi-2026-*.md and docs/shopify-parity.md: default searches skip them, a search or Read that names the file still works, and no reference in code breaks. Move what nothing cites to docs/archive: the five dated PSI reports, wave-10-notes, the A/B spike and plan.md. Add one line to the core: wave and phase docs are build history; open the cited section only.
- **Saving:** Default docs searches skip 3.2 MB of 7.9 MB (41%). For 'placeOrder': 61 KB less from the history files (measured), 119 KB more once decisions.md is split (DC-2).
- **Risk:** An agent that needs a spec's detail must name the file; the comments that cite it already do. A person using rg locally gets the same filter.

### DC-8 A feature's facts are restated in four to six places, in different words, and the copies drift

- **Kind:** duplicate. **Effort:** L. **Confidence:** medium. **Step:** 4.4.
- **Where:** `CLAUDE.md:365`, `docs/rules/admin/website.md:439`, `docs/decisions.md:897`, `docs/combined-listings.md:1-12`, `src/server/product-groups.ts:14-18`, `src/db/schema.ts:2547-2552`, `src/lib/store-features.ts:16-31`, `docs/rules/admin/platform.md:227`, `docs/store-features.md:12-23`
- **Evidence:** Combined listings, built on 11 November: 'written only by product-groups.ts' and 'each product keeps its own page, price and stock' appear in the CLAUDE.md line, the rule, the decision row (1,786 bytes), the feature doc (2,087), the server file's header and the table's comment in schema.ts: about 5.7 KB of prose for a 12.6 KB server file. Across 18 sampled features the places hold 869 KB together. The copies are rewritten, not pasted: on average 11% of a rule's 5-word runs appear in its decision, doc or main files, so no test can hold them equal. Drift found: the code has 14 store features (store-features.ts:16-31, with gift_cards, reviews and sales); the rule lists 11; the feature doc's table lists 12.
- **Cost today:** Each feature's facts are written 4 to 6 times (the agent's output) and read 2 to 6 times; a reader of the rule or doc gets an out-of-date list. Paid by: An agent's session
- **Fix:** One home per kind of fact, said in the core and in the parity-wave prompt: the invariant (never, only through) in the rule file; why and what was rejected in the decision; how it works in the code's own comments; a feature doc only for a spec that spans many files. A list that lives in code is named, not copied (the ids are FEATURE_IDS). Apply to new work now and to old text when it is touched; fix the store-features rule and doc.
- **Saving:** For a small feature like combined listings about half of 5.7 KB (estimate); no total is claimed, because the overlap is paraphrase and must be cut by hand.
- **Risk:** Cutting too much removes context an agent needs; the rule file stays the complete list of invariants and is the last place to trim.

### DC-9 The saved parity-wave workflow writes 120 KB specs and tells twelve agents to read them whole

- **Kind:** no check. **Effort:** S. **Confidence:** medium. **Step:** 4.4.
- **Where:** `.claude/workflows/parity-wave.js:74`, `.claude/workflows/parity-wave.js:188`, `.claude/workflows/parity-wave.js:205`, `docs/wave-3-orders.md:1051-1123`
- **Evidence:** The spec step's prompt (line 188) asks for nine sections with no size limit, including what Shopify does, a section for the lead and drafts of the decision row and CLAUDE.md bullet. The 14 specs in that shape total 1,694,387 bytes: average 121 KB, largest 184 KB; their 'For the lead' sections alone are 119 KB. Line 74 tells every later agent to read the spec completely, and a run starts 13 agents (lines 185-274). The 12 wave docs not in that shape average 45 KB.
- **Cost today:** Per run about 12 x 30,000 tokens of spec reading plus 13 x 11,000 of CLAUDE.md (estimates). Only when run; no run falls inside the 101 commits of this clone. Paid by: An agent's session
- **Fix:** In the prompt: cap the spec at about 30 KB, have each agent read the common sections and its own area's part, and return the lead's hand-over in the final report instead of writing it into the doc.
- **Saving:** About 270,000 tokens per run (estimate).
- **Risk:** A thinner spec may miss an edge case the long ones caught; the three review lenses and the gates stay.

### DC-10 The Migration versions list has been frozen since 4 October, but CLAUDE.md still tells agents to record versions there

- **Kind:** dead. **Effort:** S. **Confidence:** high. **Step:** 4.4.
- **Where:** `CLAUDE.md:76-78`, `docs/decisions.md:420-707`, `scripts/db-migrate.mjs:31`, `docs/ci-migrations.md:154-155`
- **Evidence:** The list has 272 rows and its last entry is dated 4 October 2026; 789 migration files existed by 11 November (decision D572). The database keeps its own ledger of applied files (supabase_migrations.kaizen_files, db-migrate.mjs:31). Since the list stopped, the version and the advisor result are written into decision rows (219 rows cite a CI run, 204 the advisors), and new decisions are appended under this heading (DC-2).
- **Cost today:** A ritual sentence or two in the agent's output per migration push, about 160 KB (rough) of release notes inside decisions.md, and the wrong place to append. Paid by: An agent's session
- **Fix:** Remove 'record the file's version in docs/decisions.md (Migration versions)' from CLAUDE.md:77. Keep the advisor check and say its result goes in the commit message. Move the 19.8 KB list to docs/archive.
- **Saving:** About 20 KB out of decisions.md now, and no more release notes added to decision rows.
- **Risk:** If the owner uses the advisor notes as a record, the commit message keeps them; say so in the rule.
- **Already tracked:** Partly: step 1.10 moves Migration versions to its own file; it does not retire the instruction.

### DC-11 The parity report commits 270 KB of generated tables beside the rows they are made from

- **Kind:** duplicate. **Effort:** S. **Confidence:** medium. **Step:** 4.4. **The owner's decision.**
- **Where:** `docs/shopify-parity.md:5`, `docs/parity/README.md:1-6`, `package.json:21-23`, `src/lib/parity.test.ts:449-457`
- **Evidence:** docs/shopify-parity.md is 288,921 bytes; 269,616 lie between its parity:generated markers and are written by pnpm parity:write from docs/parity/rows (9 files, 794,555 bytes, 233 rows, 183 rated full). 13 of the last 101 commits changed both the rows and the report.
- **Cost today:** Every rating change rewrites a 270 KB generated block; both copies land in docs searches and diffs. Paid by: An agent's session and the repository
- **Fix:** Keep the report's 19 KB of hand-written text and its headline; print the tables with pnpm parity when wanted, and have parity:check hold the headline only. If the owner reads the tables on GitHub, keep the file and list it in .rgignore instead (DC-7).
- **Saving:** 270 KB out of docs and out of about one commit in eight.
- **Risk:** The owner loses a ready-made table view unless the command is run.
