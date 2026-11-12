# docs-context: Documentation and the agents' context

These costs are paid per agent session and grow with every feature built, not with shoppers, so the owner's clarification changes none of them. Every session and every subagent loads 44 KB (about 11,000 tokens, estimate at 4 characters a token); 71% of it is a 295-line index of which a typical change needs 2 to 4 lines, and taking it out saves about 29.5 KB (about 7,400 tokens) each time. What a search can show matters more than what is loaded: the harness's search tool prints nothing for a line over 500 characters, and such lines hold 98% of decisions.md and 52% of the rules, while source code has almost none (0.3%). Nothing caps any of it (CLAUDE.md regrew 35% in 12 days), and one cost the report missed is real work: sessions running at once take the same decision number, so 5 of 24 merges in 35 hours renumbered one, twice across 64 and 77 files.

## Measures
- Loaded into every session: CLAUDE.md 43,361 bytes, 448 lines; AGENTS.md 679 bytes (imported on line 1). Together about 11,000 tokens (estimate, 4 characters a token). The harness's guidance is under 200 lines per CLAUDE.md. This subagent's own context began with the whole of both files.
- CLAUDE.md by section: Storefront 3,529 bytes (38 lines, 33 rule lines) and Admin 27,277 bytes (267 lines, 262 rule lines): 30,806 bytes, 71%. The rest is 12,555 bytes in 143 lines: Conventions 5,988, Database 2,870, Commands 1,792, Workflow 1,013, Stack 630. Area-specific how-to i…
- Rules a typical change needs: Median 2 of 295 by exact path (p75 6, p90 9); 22 of 69 commits that change non-test src touch no file a rule names. The rules that match total 4,564 bytes at the median. A looser match by file or component name gave the skeptic a median of 4.
- Source files a rule names: 865 of 4,139 non-test files (21%): src/server 408 of 796, src/lib 417 of 1,146, src/components 39 of 878, src/app 0 of 1,307.
- For proportion: what a code change reads: Over 66 commits that change non-test source (the clone's first commit left out), the median commit touches 5 source files that total 143,085 bytes at HEAD (p25 28 KB, p75 798 KB). CLAUDE.md's 44 KB is about 30% of the median. Eight touched files are over 100 …
- docs/rules: 7 rule files, 564,581 bytes, 295 rules, 295 unique headings (30,724 bytes; longest 194 characters). Median rule 1,428 bytes; 24 over 4,000 bytes, 17 over 5,000, largest 11,212. 151 rules have a body of one line. 156 lines over 500 characters hold 291,981 byte…
- docs/decisions.md: 1,330,879 bytes, 931 lines, 564 rows (D1 to D573, D541 to D549 unused, no duplicate). Row size: median 1,940 bytes, p90 3,731, largest 17,985 (D442). 545 rows are over 500 characters. Rows have 2 cells (170), 4 cells (379) or 3, 5 or 6 (15). 197 rows (lines 7…
- What the search and read tools show: Grep in content mode printed '897:[Omitted long matching line]' for the D566 row. Read returned a line of 2,535 characters and one of 17,985 characters whole. A fetched page of 54 KB arrived as a 2 KB preview with the rest saved to a file. Lines over 500 char…
- Growth with no cap: CLAUDE.md: 382 KB before 30 October, 32 KB after its diet, 39.5 KB on 9 November, 43.4 KB on 11 November (+35% in 12 days). docs/rules 374 KB on 30 October, 566 KB now. 34 decisions were added in the clone's 35 hours (530 rows at its first commit, 564 now). T…
- Sessions at once, merges and decision numbers: 116 commits from 10 November 12:50 to 11 November 23:59 by 10 sessions; 24 are merges. 5 merge subjects say a decision was renumbered because its number was taken on main; at least 8 of the 34 new decisions changed number, five of them twice. Merge 8839dc1 di…
- What a search for a table name returns: gift_cards from the repo root: 172 lines from non-test source (25 in schema.ts), 89 from tests, 141 from the baseline SQL, 81 from Drizzle's snapshot, 124 from 13 archived migrations, 36 from docs. order_lines: 326, 319, 227, 192, 221 (56 files), 120. supabas…
- Finished and generated text in docs: docs at HEAD: 225 files, 10,518,218 bytes. Cited by no code and not living rules: 5 dated PSI reports 542,790 bytes, wave-10-notes 30,059, the A/B spike 9,110, the first review draft's evidence folder 189,540. Generated: 270,980 bytes of 288,921 in shopify-pa…
- Are the rules true?: docs/rules cites 3,145 distinct code names (2,179 functions, 361 components, 363 constants, 242 SQL names). 5 no longer exist in src, scripts, e2e, the baseline SQL or the WordPress plugin: CustomFieldsView, freeUnitsFor(), revertGrids(), TemplatesPreview, mo…
- Trackers a change must consult: Code review Progress: 73 steps (14 Done, 4 In progress, 55 Open); the 18 rows with notes are 16,641 bytes (average 925, largest 1,615; 15 over 500 characters) and a change log of 3,330 bytes repeats them. psi-followups.md: 60,043 bytes, 93 ticked items and 12…
- Docs in the deployment and in CI: None of docs/, CLAUDE.md, AGENTS.md or README.md is in any of the 834 trace files; content/docs (168 files, 885,306 bytes) is traced into 22 routes (skeptic's nft.mjs, not re-run). The cart-reminders cron reads it because it refreshes the docs search index (r…
- Comment share of src: All of src: 8.8% of lines, 13.8% of bytes (7.84 of 56.86 MB). Non-test code by bytes: lib 24.9%, server 19.6%, db 31.7% (schema.ts 341,884 bytes of comments), components 12.8%, app 13.1%. A file header averages 410 to 520 bytes. Only 5 comment lines in src ar…

## Well made
- Nothing under docs/, CLAUDE.md, AGENTS.md or README.md reaches a deployed function. Only content/docs is traced, into 22 routes that serve or index the docs portal.
- A push of Markdown or docs alone costs nothing: ci.yml:10-14 skips it and vercel.json:12-19 turns Vercel's own deploys from main off.
- Tailwind does not read docs: src/app/globals.css:6-9 imports it with source(none) and names src and the migrations' SQL only. It does read all of src, which matters for where rule files may go (DC-1).
- Source code is searchable as it is: 223 of its 1.1 million lines are over 500 characters (0.3% of bytes), and one file holds a third of them. The search blind spot is a docs problem.
- The written rules are accurate where they can be checked: every src path they cite exists (skeptic), and of 3,145 code names they cite, 5 no longer exist (0.16%).
- Comments are short and local (a header averages 410 to 520 bytes) and load only with their file. They are the cheapest place for how something works. Keep them.
- A rule can already be read alone: all 295 headings are unique and under 200 characters, so a search for '^## ' lists an area's rules (3.1 to 8.3 KB per file) and a Read from the heading's line costs the rule's own size (median 1.4 KB).
- The Read tool returns a long line whole: tested on a 17,985-character decision row. Only the search tool hides long lines.
- The wave specs and phase plans are finished but in use: 64 index lines, 102 rule mentions and 1,081 source paths cite them as the contract. They stay where they are and stay searchable.
- Dead docs are few: 9 files (55 KB) have no reference by path or name: jev-plan.md, checkout-fields-tasks.md, comparison-page.md, five JSON files under comparison-evidence and wave-10-notes/i-k.md. Not worth a finding.
- Binary assets in docs are two images, 856 KB together, each used by one doc.
- .claude holds one workflow file that runs only when called; feature waves have been paused since 29 October (docs/consolidation.md:3), so it costs nothing today (DC-9).
- Commit messages are short (median 554 bytes, p90 1,011 over 92 non-merge commits): they are not another long copy of a feature's facts.
- No finding in this dimension argues from an unused feature or an empty table.

## Findings (13)

### DC-1 [P0 M eager corrected OWNER-CHOICE] Every session loads a 295-line feature index; a typical change needs 2 to 4 of its lines
- evidence: CLAUDE.md is 43,361 bytes and 448 lines. Its Storefront and Admin sections are 30,806 bytes (71%) in 305 lines: 295 one-line pointers, 28 cut with an ellipsis. The rest is 12,555 bytes in 143 lines. Over the 69 commits that changed non-test src, the median commit touched files named by 2 of the 295 rules (p75 6, p90 9; 22 commits none). This subagent's context began with the whole file. The index is not needed to fi…
- cost: About 11,000 tokens (estimate) at the start of every session and every subagent, and again after each compaction. The index alone is 30,806 bytes, about 7,700 tokens (estimate). For proportion, the median code change to… (An agent's session)
- fix: 9 steps; first: 1. Ask the owner (code review question 5): CLAUDE.md is the owner's instruction file. Steps 2 to 5 are step 1.10's CLAUDE.md half; steps 6 to 9 are new and can be declined separately.
- done when: wc -c -l CLAUDE.md prints under 15,000 bytes and under 200 lines after step 5 (today 43,361 and 448) and under 10,500 bytes after step 7, with src/lib/rules-index.test.ts passing.
- saving: Steps 2 to 5: 30,806 bytes out and about 1,300 in, so about 29.5 KB, about 7,400 tokens (estimate), per session, per subagent and per compaction. This is the saving step 1.10 already claims. Steps 6 and 7: about 5 KB more, about 1,300 tokens (estimate from th…
- after: The owner's answer to code review question 5; DC-3 (so the saving cannot be spent again)
- tracked: Code review step 1.10 (FH5), Open: it cuts CLAUDE.md to about a quarter by moving the index to the area files. That covers steps 2 to 5 and their saving. New h…
- notes: The skeptic's saving of 30.8 KB is gross; net of the new section it is about 29.5 KB. The skeptic's ceiling of 10,000 bytes cannot be met by removing the index alone (12,555 bytes remain); it needs steps 6 and 7. I changed the optional second step: path files…

### DC-2 [P1 M oversize corrected] decisions.md cannot be searched with the harness's search tool, a row runs to 18 KB, and the newest 197 rows sit under the wrong heading
- evidence: decisions.md is 1,330,879 bytes in 931 lines, 564 rows. 545 rows are over 500 characters, and lines that long hold 97.8% of the file. The Grep tool in content mode prints no text for such a line: a search for '^\| D566 \|' returned '897:[Omitted long matching line]' in this session. A Read of one line returns it whole (tested at 2,535 and 17,985 characters), so a look-up is two calls and costs the row: median 1,940 …
- cost: One look-up: a search that shows only a line number, then a Read of the whole row, about 490 tokens at the median and up to 4,500 (estimates). A keyword search of the decisions shows no text at all. The file grew by 34 … (An agent's session)
- fix: 8 steps; first: 1. Now, on its own: move lines 708-904 of docs/decisions.md to directly after line 378 (the Settled table's last row) with a small node script, not by hand (the lines run to 18 KB). Check that rg -c '^\| D\d+ \|' docs/decisions.md still prints 564 and that wc…
- done when: ls docs/decisions/D*.md | wc -l prints 564; awk 'length($0)>500' docs/decisions.md docs/decisions/D*.md | wc -l prints 0 (today 548 in decisions.md); rg -c '^\| D\d+ \|' docs/decisions.md prints 564; src/lib/decisions.scan.test.ts passes.
- saving: A search then shows the decision's text instead of a line number, for all 564 decisions, and the table renders again. docs/decisions.md falls from 1.33 MB to about 75 KB (index and prose, estimate). No token saving is claimed for a look-up by ID: it already c…
- after: Steps 1 and 2: nothing; Steps 3 to 8: DC-10 (where the migration list goes) and DC-3 (the ratchet then holds the 500-character line)
- tracked: Code review step 1.10 (FH4), Open: split with a generated index and a scan test. New here: the search tool's 500-character limit as the reason for a file per d…
- notes: Steps 1 and 2 take minutes and are safe; do them at once. A file per decision also ends hand-merging of one table by sessions working at once (DC-12).

### DC-3 [P0 S process corrected] Nothing caps the written rules, and one test makes the always-loaded file grow with every feature
- evidence: CLAUDE.md was cut from 382 KB to 32 KB on 30 October (consolidation.md:12-13), was 39.5 KB on 9 November (code review FH5) and is 43,361 bytes now: +35% in 12 days. docs/rules went from 374 KB to 566 KB in the same time. decisions.md gained 34 rows in the clone's 35 hours. rules-index.test.ts:30 and :38 fail when a rule heading has no line in CLAUDE.md, so each new rule adds an always-loaded line. A ratchet exists f…
- cost: About 0.95 KB a day added to what every session loads (about 240 tokens a day, average since 30 October); about 16 KB a day in docs/rules. It follows the number of features built, not the task in hand. (An agent's session, every later one)
- fix: 6 steps; first: 1. Add scripts/lib/docs-count.mjs (node built-ins only) that returns: CLAUDE.md's bytes and lines; per file, the number of lines over 500 characters in CLAUDE.md, docs/rules/**/*.md and docs/decisions.md (docs/decisions/** after DC-2); and each rule over 4,00…
- done when: pnpm test src/lib/docs-budget.scan.test.ts passes with a baseline equal to today's numbers, and node scripts/docs-ratchet.mjs --check exits 1 when a 600-character line is added to a file under docs/rules.
- saving: Stops the regrowth measured above and keeps the savings of DC-1, DC-2 and DC-4 from being spent again. No token figure is claimed.
- after: nothing
- tracked: no (step 1.10 sets one-time targets and an index test, no standing size check)
- notes: Ship this first, with today's numbers, so it does not wait for the owner's answer on DC-1. The skeptic's later ceiling of 10,000 bytes is not reachable by removing the index alone (12,555 bytes remain); I set 15,000 until DC-1's how-to has moved.

### DC-4 [P0 S oversize corrected] Half of the rules' text is in lines the search tool cannot show
- evidence: CLAUDE.md:97 and :135 tell agents to read a rule before changing its part. The seven rule files are 49 to 163 KB. 156 lines are over 500 characters and hold 291,981 of 564,581 bytes (52%): website.md 62 lines (110,926 bytes), commerce.md 35 (73,887), marketing.md 18, ai.md 20, platform.md 12, integrations.md 6, storefront.md 3. The longest is 7,436 characters (marketing.md:202). The Grep tool prints no text for any …
- cost: A content search of the rules returns no text for the lines that hold 52% of the bytes. The agent then reads the whole line (up to 7.4 KB, about 1,900 tokens, estimate) or searches through the shell, where one hit is th… (An agent's session)
- fix: 5 steps; first: 1. Write scripts/wrap-docs.mjs (DC-2's split can use it too): for each line over 500 characters in docs/rules/storefront.md and docs/rules/admin/*.md, break it at sentence ends ('. ' before a capital, a backtick or an asterisk; then at '; ' if a piece is stil…
- done when: awk 'length($0)>500' docs/rules/storefront.md docs/rules/admin/*.md | wc -l prints 0 (today 156), and the script reports the seven files identical once whitespace is collapsed.
- saving: 291,981 bytes of rule text (52%) become visible to a content search, and a hit returns one sentence instead of a paragraph of up to 7.4 KB. No saving is claimed for reading a rule: it can already be read alone by its heading.
- after: nothing
- tracked: no (step 1.10 keeps the area files and moves the index to their tops)
- notes: The skeptic set effort M for a hand check of 156 lines. A mechanical break with a proof of no changed word makes it S. Shortening rules and dropping the repeated headings changes wording, so it waits for the next edit of each rule.

### DC-5 [P1 S eager confirmed] CLAUDE.md sends agents to a 73 KB plan written before the platform was multi-tenant
- evidence: CLAUDE.md:5-6 says the research and phased build plan are in docs/plan.md and to read it before architectural work; README.md:15 says to skim it. plan.md is 72,617 bytes. Its own banner (line 3, updated 23 September) notes that the region and the single app differ from the plan. decisions.md:422 dates multi-tenancy to 24 September, and decisions.md:3-6 says the plan loses where they differ. docs/platform.md (16,193 …
- cost: About 18,000 tokens (estimate) for an agent that follows the instruction, much of it a stack that was not built. How often sessions follow it was not measured. (An agent's session)
- fix: 3 steps; first: 1. CLAUDE.md:5-6: replace 'The research and phased build plan are in docs/plan.md; read it before architectural work.' with 'How the platform is built is in docs/platform.md: read it before architectural work. docs/plan.md is the research behind the first bui…
- done when: rg -c 'plan\.md`; read it before architectural work' CLAUDE.md and rg -c 'Skim \[`docs/plan.md`\]' README.md both print nothing (today 1 each), and CLAUDE.md's opening names docs/platform.md.
- saving: About 14,000 tokens per session that follows the instruction (72.6 KB less 16.2 KB; estimate).
- after: nothing
- notes: Two sentences. Do it in the same commit as DC-1; it is not P0 only because how often the instruction is followed is unknown.

### DC-6 [P2 S oversize confirmed] The trackers a fix must consult keep their finished work in the way: the code review's table grows 0.9 KB a step, and 12 open PSI items hide among 93 ticked
- evidence: CLAUDE.md:446-448 says to read the Progress table before starting a fix from the code review. Of its 73 steps, 14 are Done, 4 In progress and 55 Open. The 18 rows with notes total 16,641 bytes (average 925, largest 1,615); 15 are over 500 characters, so a search for a step shows no text. The document's own rule (line 31) asks only for the date and the commit in Notes, and a change log (lines 136-164, 3,330 bytes) te…
- cost: About 5,400 tokens per fix session today for the Progress table, about 17,000 when all 73 rows carry notes of the same size (estimates). To see whether a change does an open PSI item, an agent reads up to 60 KB (about 1… (An agent's session)
- fix: 5 steps; first: 1. docs/audits/code-review-2026-11.md:31: make the rule exact: Notes holds the date, the commit and the decision's ID, at most 200 characters; what was found goes in the decision and in one line of the change log.
- done when: No row between '## Progress' and '**Change log**' in docs/audits/code-review-2026-11.md is over 300 characters (today 15 are over 500), and rg -n '^\s*- \[ \]' docs/audits/psi-followups.md lists all open items within one section before the first '## Done' heading.
- saving: About 4,000 tokens per fix session now and about 15,000 by the end of the plan (estimates). For the PSI list, about 3 KB to read instead of 60 KB when looking for open items.
- after: nothing
- notes: I added psi-followups.md to this finding (the skeptic named it in a note): same shape, same fix. This review's own plan should follow the same rule from its first day: status, date, commit, decision.

### DC-7 [P2 S oversize corrected] Dated reports, draft notes, review evidence and generated tables turn up in every docs search
- evidence: ripgrep lists 225 files and 10,518,218 bytes under docs. Not living rules and cited by no code: the 5 dated PSI reports (542,790 bytes), wave-10-notes (30,059; draft decision rows that decisions.md now holds), the A/B spike (9,110) and the evidence folder of this review's first draft (189,540). Generated: shopify-parity.md (288,921 bytes, 270,980 between its markers). Together 22 files and 1,060,420 bytes, 10% of do…
- cost: Longer file lists and cut-off results that need a second, narrower search. No token total is claimed: the harness shows 250 lines of a search by default and a 2 KB preview of a long output. (An agent's session)
- fix: 6 steps; first: 1. Add docs/.rgignore with three lines: shopify-parity.md, wave-10-notes/ and ab-testing-spike/.
- done when: From the repo root rg --files docs | wc -l prints 203 (today 225), rg -l placeOrder docs | wc -l prints 43 (today 47), and rg -l placeOrder docs/audits/psi-2026-10-24.md still finds the file when it is named.
- saving: 22 files and 1.06 MB (10% of docs) leave default searches. No token saving is claimed.
- after: nothing
- notes: I changed the skeptic's single root .rgignore to per-folder files: tested here, root-file patterns with a path are dropped when a search starts in docs or supabase, while bare names in the folder's own file hold from every starting point.

### DC-8 [P2 S duplicate corrected] A feature's facts are written at four to six levels, in different words; lists copied from code drift
- evidence: Combined listings, built on 11 November, is told in a CLAUDE.md line, a rule (with its title three times), a decision row (1.8 KB), a feature doc, the server file's header and the table's comment. The texts are rewritten, not pasted: the skeptic measured 11% shared 5-word runs on average over 18 features, so no test can hold them equal. What can be checked is whether they are true. Of 3,145 distinct code names cited…
- cost: Each new feature's facts are written four to six times by the agent that builds it, and a reader of a rule or doc can get an out-of-date list. No total in bytes is claimed. (An agent's session)
- fix: 4 steps; first: 1. Fix the list: in docs/rules/admin/platform.md:229 replace the bracketed list of ids by 'the ids are FEATURE_IDS in src/lib/store-features.ts'. In docs/store-features.md:10-22 add the missing rows (gift_cards, reviews) and one sentence that the code's list …
- done when: A re-run of the name check finds 0 cited names missing from the code (today 5), and rg -c FEATURE_IDS docs/store-features.md prints at least 1 (today none).
- saving: No total is claimed: the overlap is paraphrase. For a small feature like combined listings, about half of 5.7 KB of prose not written (estimate).
- after: nothing
- notes: Added to the skeptic's version: the check of 3,145 cited names (5 stale, 0.16%), which shows the rules are kept true and that the drift is in copied lists, not in names.

### DC-9 [P3 S process corrected] The saved parity-wave workflow asks for specs with no size limit and tells every agent to read them whole; it is dormant
- evidence: Line 188 asks for a spec of nine sections with no size limit; line 74 tells every later agent to 'read it completely before anything else'. The 14 wave specs written in that shape total 1,694,387 bytes (88 to 184 KB each). The workflow accepts only waves 0 to 9 (line 29), and docs/consolidation.md:3 says feature waves were paused on 29 October. No run falls inside the clone's history.
- cost: Nothing today. If run again as written: about 12 agents reading a spec of about 120 KB each (about 30,000 tokens each, estimate). (An agent's session, only when the workflow is run)
- fix: 3 steps; first: 1. Before the next run, not before: in .claude/workflows/parity-wave.js:188 cap the spec ('at most 30,000 characters') and ask for the lead's hand-over and the drafts of the decision and the rule in the final report, not in the spec.
- done when: rg -c 'read it completely' .claude/workflows/parity-wave.js prints nothing (today 1) and line 188 names a size limit.
- saving: None until the workflow is run again; then about 270,000 tokens per run (skeptic's estimate).
- after: nothing
- notes: P3 because it has no running cost: the workflow is not in use. Change it on the day a wave is next run.

### DC-10 [P2 S dead corrected OWNER-CHOICE] The Migration versions list has been frozen since 4 October, and the instruction to record versions there now fills decision rows with release notes
- evidence: The list under '### Migration versions' has 272 rows and ends at 20261004. The database keeps its own ledger of applied files with checksum, time and who applied it (supabase_migrations.kaizen_files, scripts/db-migrate.mjs:31-40), and the 789 migrations up to 11 November are now a four-file baseline (D572). Agents still follow CLAUDE.md:76-78 by writing the version and the advisor result into the decision's row: 182…
- cost: A follow-up docs commit or a sentence or two per migration push, release notes inside the decisions (about 150 KB, the skeptic's rough figure), and a heading that new decisions were appended under by mistake (DC-2). (An agent's session)
- fix: 5 steps; first: 1. The owner decides whether the routine note 'advisors checked, nothing new' is kept. The check itself stays either way.
- done when: rg -n -i "record (the file's|the migration|its) versions?|version recorded in" CLAUDE.md README.md docs/capacity.md docs/ci-migrations.md | wc -l prints 0 (today 3).
- saving: About 20 KB out of decisions.md, no more release notes added to decisions, and no docs-only follow-up commit after a migration.
- after: The owner's decision on the routine advisor note; DC-2 step 5 for the move of the list
- tracked: Partly: step 1.10 moves Migration versions to its own file; it does not retire the instruction.
- notes: The frozen list is dead text; whether to keep noting each advisor check is the owner's choice, not waste.

### DC-11 [P3 S duplicate confirmed OWNER-CHOICE] The parity report commits 270 KB of generated tables beside the rows they are made from
- evidence: docs/shopify-parity.md is 288,921 bytes; 270,980 lie in 16 blocks between parity:generated markers, written by pnpm parity:write from docs/parity/rows (9 files, 794,555 bytes). The large blocks are 'since' (46,477 bytes), 'gaps' (24,963) and nine detail tables (194,858); the five small ones (summary, headline, domains, evidence, projection) are 4,682 bytes. 13 commits in the clone change both the rows and the report…
- cost: Every rating change means running parity:write and committing a rewritten block of up to 270 KB; both copies appear in docs searches and diffs. No runtime cost and little token cost. (An agent's session and the repository)
- fix: 2 steps; first: 1. Default, no decision needed: keep the file and skip it in default searches (docs/.rgignore, DC-7 step 1).
- done when: Step 1: rg -l Shopify docs from the repo root no longer lists docs/shopify-parity.md. Step 2, if chosen: wc -c docs/shopify-parity.md prints under 30,000 (today 288,921) and src/lib/parity.test.ts passes.
- saving: Step 1: one 289 KB file out of default searches. Step 2: about 266 KB out of docs and out of about one commit in nine.
- after: DC-7 for step 1; The owner's answer for step 2
- notes: P3: the copy is deliberate, held by a test and a written rule, and costs nothing at run time. Step 1 comes free with DC-7; step 2 is only a matter of how the owner reads the report.

### DC-12 [P1 S process added] Sessions working at once take the same decision number: 5 of 24 merges in 35 hours renumbered one, twice across 64 and 77 files
- evidence: The clone holds 116 commits from 10 November 12:50 to 11 November 23:59 by 10 sessions (distinct Claude-Session trailers); 24 are merges. A decision's number is the next free row in one shared table, taken from each session's own checkout, and code comments cite it (19,273 citations in src, skeptic's count). Five merge subjects say a number was taken on main in the meantime: 8839dc1 ('storefront components renumbere…
- cost: Per collision: a merge that rewrites the number in every file that cites it (4 to 77 files in the five seen), a second run of the checks, and the risk that one comment keeps the old number and now points at another sess… (An agent's session, and later the reader of a comment that cites the wrong deci…)
- fix: 5 steps; first: 1. Add scripts/claim-decision.mjs "short title". It runs git fetch origin main; reads the highest D number on origin/main (from the rows of docs/decisions.md; after DC-2, from the file names in docs/decisions); builds a commit on top of origin/main that adds …
- done when: Over the next 100 commits on main, git log --merges --format=%s | rg -ci 'renumber|taken on main|decision is D' prints nothing (it prints 5 for today's 116 commits), and the helper's unit test passes.
- saving: No merge that renumbers a decision: 5 in 35 hours today, two of them touching 64 and 77 files. docs/decisions.md stops being the most hand-merged file once each decision is its own file (DC-2).
- after: DC-2 (optional: after it the claim adds a file, so two claims can no longer conflict in one table)
- notes: Not in the report. Evidence is from git alone: merge subjects, combined diffs and session trailers. The same contention explains why CLAUDE.md is hand-merged (3 of 24 merges): every feature adds a line to its index, which DC-1 ends.

### DC-13 [P2 S oversize added] A table's definition is in the repo four times, and a search for its name returns more lines from old migrations and Drizzle's snapshot than from code
- evidence: ripgrep lists 796 files and 11.3 MB under supabase: the 4 baseline files (4.0 MB), Drizzle's snapshot (one JSON of 2.7 MB) and the 789 squashed migrations kept in supabase/archive (4.6 MB). A table is therefore written in schema.ts, in the snapshot, in the baseline and in its old migrations. A search for gift_cards from the repo root returns 172 lines from non-test source (25 of them in schema.ts), 141 from the base…
- cost: For a table or column name, 79 to 413 extra lines (12 to 69 KB) per search in the four names tried, in a tool that shows 250 lines by default, so history and generated JSON take places from code. No runtime cost. (An agent's session)
- fix: 3 steps; first: 1. Add supabase/.rgignore with two lines: archive/ and meta/. Put it in supabase itself, never inside supabase/archive: src/db/migration-files.ts:25 reads every entry there as a folder of migrations.
- done when: rg --files supabase | wc -l prints 5 (today 796), rg -c gift_cards supabase sums to 141 lines (today 346), and rg -l gift_cards supabase/archive still lists files when the folder is named.
- saving: 791 files and 7.3 MB leave default searches; 79 to 413 fewer lines per table-name search in the four names tried.
- after: DC-7 (same commit: the three ignore files and one line in the core)
- notes: Not in the report, which tested an ignore file for docs only. Same mechanism as DC-7, larger volume: 7.3 MB against 1.06 MB.
