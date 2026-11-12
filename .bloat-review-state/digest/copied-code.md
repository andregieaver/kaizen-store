# copied-code: Copied code, measured

Copied code is not where this codebase's bloat is, and that holds after a third look: 1.0% of non-test code is an exact copy (4,803 of 472,586 lines) and 4.75% a near-copy with every name and literal normalised; unit and integration tests (1.8% and 3.2%) and the e2e folder (1.7% and 7.4%) are no worse. The fourteen checked findings are true duplicates or missing checks, none rests on a feature being unused, and their corrected savings add up to about 5,500 lines (1.2%); my two additions are small too: about 1,100 to 1,500 test lines of repeated scaffolding (448 integration tests stub a module the test config already stubs) and helpers re-solved under one name (addDays in 10 files, countryName exported from 6 with three different answers for a missing code). Do first, because they are small and safe: one store-address helper for the 27 hand-written lookups behind production's most-called statement (560,090 calls with no shoppers), and a copy ratchet in CI. Do before opening, while every table holds only test rows: one import definition, one engine with a scope for the platform's workflows and deliveries, and one Work view for store and account.

## Measures
- Exact copies, all non-test src: 4,803 of 472,586 code lines (1.02%); 4,098 across files (0.87%)
- Near-copies, all non-test src (names and literals normalised): 22,429 of 472,586 (4.75%); across files 15,404 (3.26%); inside one file 7,025 (1.49%)
- Near-copy share by window size: 6-line window 6.43%; 10-line 4.75%; 15-line 2.40%; 20-line 1.40%
- Near-copy share by folder: src/app/admin 10.3%, src/app/s 10.2%, src/app/api 10.1% (of 2,168 lines), src/components/admin 6.7%, src/lib 3.8%, src/server 2.2%
- Repeats inside one file: 7,025 lines in 161 files: email-text.ts 790, page-builder.tsx 449 of 5,455, ai-provider-form.tsx 197 of 604, product-editor.tsx 175, privacy-text.ts 139, owner-tools.ts 136; about 1,400 are per-language text that only looks alike once literals are normalised
- Upper bound of lines extraction could remove: 8,489 lines in the top 400 of 446 cross-file families, of which 1,395 are data by design (signature themes 960, API catalogue entries 435); the largest family saves 152 lines (38 lines in 5 import files)
- Platform against store, file by file: 26 file pairs share 198 ten-line windows; the largest are the two integration provider pages (38), the two domain-move pages (35) and cart reminders against plan reminders (18)
- Near-twin files: 65 pairs among 3,969 files share 30% or more of their normalised 4-line shingles; every one belongs to a finding below or to the signature themes
- Tests: Unit and integration tests: 4,604 of 260,660 code lines exact (1.77%), 8,212 near (3.15%). e2e: 372 of 21,378 exact (1.74%), 1,584 near (7.41%)
- Integration test scaffolding: 556 files, 137,661 lines: 448 stub server-only although the config aliases it; 465 stub next/cache (425 one-line stubs in at least five spellings, 271 lines in blocks); 206 stub next/headers (617 lines, 24 bodies); 233 build their own store through the access…
- Server actions on the shared wrapper: 271 'use server' files, 1,372 exported actions; under src/app/admin 235 files, 3 of them import store-action (45 actions); 23 files define a local guard wrapper
- Data job routes: 15 route files (10 tick, 5 problems; 14 and 22 lines each) whose guard is exactly the key JOB_KEY gives the kind
- A store's row read by its id, written by hand: 152 single-row reads in 102 server files with about 30 column lists: slug 27 (production's most-called statement, 560,090 calls in 78 days), time_zone 13, id 6, theme 4
- SQL repetition: 10,364 sql templates, 25,629 SQL lines in 639 files; 15 distinct lines of 40+ characters occur in 10 or more files. Counts today: chat_usage upsert 32 in 28 files, order_events insert 34 in 23, the title's lateral join 35 one-line forms in 27 files, 'publishe…
- Small helpers: Identical text: 84 helpers in 3 or more files (412 declarations). Same name, any body: 331 top-level function names are declared in 3 or more of 1,757 server and lib files, 22 in 10 or more (iso 29 with 17 spellings, money 23, isUuid 22, addDays 10 with 5 bod…
- Class-name constants and tables in the admin: 284 top-level input, field, control, card, label and hint constants in 171 admin files; 154 hand-written tables in 116 files; 27 loading.tsx files declare their own skeleton block
- English admin catalogues: 24,127 one-line entries in 67 files, 18,908 distinct: 21.6% of entries repeat (Save 76 times, Name 75) but only 6.1% of the characters (55,917 of 920,267)
- Sum of the findings' savings: CP-1 to CP-14: about 5,100 to 6,100 lines of non-test code (about 1.2%); CP-15 about 1,100 to 1,500 test lines; CP-16 about 150 to 250

## Well made
- Exact copy-paste is rare: 1.0% of non-test code, and only one block is copied into four or more files (a 10-line drag-handle icon).
- The top 60 near-copy families all belong to a finding below or to data that is parallel by design; nothing large was left unclassified.
- The import jobs' claim, lease, retry, progress and finish are written once (src/server/data-job-store.ts) and one runner dispatches by kind (src/server/data-jobs.ts:290); exports share runExport() and buildDirect().
- The platform-and-store rule has not filled the admin with copied pages: 26 file pairs share 198 windows in all, and of the platform-X server modules only workflows, endpoints and integrations are near-copies of their store twin.
- The 44 AI manager tool modules are not copies of each other, and carriers sit behind one 30-line registry (src/server/carriers/index.ts); the carrier settings page is one dynamic route.
- SQL is written once far more often than not: 25,629 SQL lines and only 15 distinct long lines in ten or more files. The conditions the brief named are small or already a database function: 'published is not null' 24 places in 15 files, commerce.store_is_activ…
- A cached store-address helper already exists (storeSlugOf, src/server/menus.ts:282), so CP-2 is a matter of using it. One correction to the earlier checks: a slug is rewritten once in one case, when a sandbox is kept (commerce.adopt_sandbox(), called from src…
- The six signature themes (960 lines of the near-copy bound) and the admin API catalogue entries (435) are data on a shared kit: parallel by design.
- Message catalogues repeat short words (Save, Name, Cancel) but only 6.1% of their characters; each screen reading its own catalogue is the design (D212, D312), so this is not a finding.
- Tests are no worse than code (1.8% exact, 3.2% near; e2e 1.7% and 7.4%), and 38 of 85 loading.tsx files are already five-line re-exports.
- The shared wrapper for actions costs one line per action where it is used (orders/actions.ts), so moving more files onto it adds no ceremony.
- Nothing in this dimension argues from a feature being unused or a table being empty. The one production figure used (the store-address statement) is read as idle and test load, as the owner's clarification says.

## Findings (16)

### CP-1 [P1 M duplicate corrected] Five file imports each repeat the upload, register, start-check, start-apply and cursor code, the browser flow, the findings table, the pages and the routes (leases and retries are already shared)
- evidence: Read side by side: customer-import.ts:89-197 and inventory-jobs.ts:212-323 are the same upload, register, check and apply code with another kind string, permission key and default file name. Measured against customer-import.ts (lcs.mjs, lines in runs of five or more after normalising): inventory-jobs 204, redirect 128, order history 106, product 79. The four upload flows share 68 to 117 lines in runs pair by pair, a…
- cost: About 6,000 file lines for five kinds, of which roughly 1,300 to 1,600 are repeats; 15 route handlers where two would do; a fix to the upload, the register step or the check loop is made five times (a fix to leases or r… (The build and CI (15 routes, ten pages), an agent's session (five copies to rea…)
- fix: 8 steps; first: 1. Add src/server/data-import.ts with defineImport({ kind, key, defaultName, openProblem, readFile, parseOptions, dryOf, canApply, auditStart }) that returns startUpload, register, check, apply and problemsCsv. Move into it, once, what is the same today: cust…
- done when: `rg -l 'insert into commerce[.]data_jobs' src/server --glob '!*.test.ts'` prints one file (today five), with the nine integration tests named above passing unchanged.
- saving: About 1,300 to 1,600 code lines (estimate from the measured runs: server about 500, components about 570, pages, actions and routes 300 to 500) and 13 route handlers (15 become 2).
- after: nothing
- notes: Corrections kept from the second check: leases and retries are not copied, and a page file cannot go away, so the saving is 1,300 to 1,600 lines. The route count is mine: the five export tick routes guard with JOB_KEY's key too, so 15 routes can become 2 (the…

### CP-2 [P0 S duplicate corrected] A store's address by its id is looked up by hand in 27 places beside a cached helper that already exists; it is production's most-called statement
- evidence: rg finds `select slug from commerce.stores where id = ...` written out 27 times in 21 server files (custom-fields.ts five times); 25 are exactly the statement that tops production's call list: 560,090 calls in 78 days, about 5 a minute, with no shoppers (prod-db-stats.md:86). The usual next line is the cached getStore(slug). A cached helper exists: storeSlugOf() in menus.ts:282 ('use cache', cacheLife days, 12 calle…
- cost: One database round trip each time code knows a store by its id; today about 7,200 a day from builds, crawlers, scheduled work and the team's testing. On storefront sections it is paid per uncached render, so it grows wi… (The database and the server, per render and per scheduled run.)
- fix: 10 steps; first: 1. src/server/stores.ts: move the cached reader here from src/server/menus.ts:281-287, keep 'use cache' and cacheLife('days') so prerendered callers stay cacheable, make it select slug and sandbox, and give it a tag by id (cacheTag of a new storeIdTag(id)). P…
- done when: `rg -c 'select slug from commerce[.]stores where id' src --glob '!*.test.ts'` sums to at most 3 (the helper and the two support reads; today 27 in 21 files).
- saving: 27 hand-written lookups become one helper (about 25 lines). Fewer database calls per uncached storefront render and per job; how many of the 560,090 calls go is not known until it is measured.
- after: nothing
- tracked: no (code review step 3.8, Open, cuts round trips in cart, checkout and auth only)
- notes: Corrections kept from the second check: the lookup is not 'never cached' (storeSlugOf is cached and has 12 callers), and the saving in calls is unknown on serverless. A correction of my own to both earlier passes: 'a slug never changes' is wrong for a kept sa…

### CP-3 [P1 L duplicate corrected] Admin form fields, tables and loading skeletons are spelled out per file because the UI kit has no piece for them
- evidence: My count: 284 top-level input, field, control, card, label and hint class constants in 171 admin files (the second check counted 376 with th, td, primary and secondary and files outside the admin; input alone has 15 spellings, field 20). The kit (ui/index.ts) exports Button, Chip, Card, bars, List, PageHeader and FocusFrame: no input, select, table or skeleton. data/ui.ts already shares field, label, hint, a table s…
- cost: About 380 one-line declarations with 11 to 20 spellings of one control; 10 to 15 lines of shell and head per table; about 250 lines of repeated skeleton head. The cost is an uneven admin and a copy-the-neighbour habit, … (Owners (controls that look and behave slightly differently per screen) and agen…)
- fix: 6 steps; first: 1. Build code review step 1.12 as written (docs/audits/code-review-2026-11.md:434): Field, TextInput, Select, EmptyState, ConfirmButton, Pager and ListSearch in src/components/admin/ui, exported from ui/index.ts, tested in ui/ui.test.ts.
- done when: Step 1.12's own done-when passes, and `rg -c '^const (input|field|control|card|label|hint) = ' src/app/admin src/components/admin` sums below 100 (today 284 in 171 files).
- saving: About 900 to 1,100 lines (estimate: about 380 declarations, about 5 lines from each of some 100 tables, about 250 from skeleton heads). The gain that matters is one look per control.
- after: code review step 1.12 (this is that step, with two pieces added)
- tracked: Mostly: code review step 1.12 Build the admin kit (FS4), Open, names Field, TextInput, Select, EmptyState, ConfirmButton, Pager and ListSearch and the scan tes…
- notes: Corrections kept from the second check: the claim that 27 loading skeletons are three bodies does not reproduce (39 hand-drawn files, 33 distinct bodies), so the skeleton saving is about 250 lines, not 450; a class variant costs the build nothing. My counts d…

### CP-4 [P1 M duplicate corrected OWNER-CHOICE] The platform console has a second engine for workflows, own endpoints and integration deliveries beside the stores' engines
- evidence: Read side by side: runPlatformWorkflows() (platform-workflows.ts:315-378) and runWorkflows() (workflows.ts:390-459) are the same claim statement, loop, outcome update and 90-day delete with other table names, a join to stores on the store side and another payload reader. Measured with lcs.mjs (lines in runs of five or more): workflows 119, endpoints 84, integrations 65, the two provider pages 108. API tokens and the…
- cost: About 1,830 lines that follow the stores' engines by hand, of which about 400 are near-copies; two extra claim passes each minute, a fixed cost that does not grow with the number of stores; every later change to signing… (An agent's session and the build; the server and the database for two small ext…)
- fix: 7 steps; first: 1. Workflows first (largest overlap). Add src/server/workflow-engine.ts with queueScheduled(scope, now), runQueued(scope, limit, now) and runsOf(scope, workflowId, limit). The scope names its tables as sql fragments written in code (never sql.raw: src/lib/sql…
- done when: `rg -c 'for update skip locked' src/server/workflows.ts src/server/platform-workflows.ts` prints nothing (the claim lives in workflow-engine.ts only; today one in each), and the six integration tests pass unchanged.
- saving: About 300 to 450 lines with shared engines (estimate from 376 measured lines in runs, less the scope objects).
- after: nothing
- tracked: no; docs/decisions.md D465, D515 and D516 record the choice of separate tables and its reason
- notes: The shared engine with a scope needs no decision from the owner and is what this plan proposes. owner_decision is true only for the larger alternative, which reverses D465: making the platform's events the Kaizena Flow store's own integration topics so the tw…

### CP-5 [P1 M duplicate corrected] Work's account-level screens are copies of the store-level ones, and 58 Work actions are wrapped in a seven-line shell
- evidence: Lines in runs of five or more shared after normalising (lcs.mjs): time-filters in owner-time 98 of 122 code lines; invoices-list and owner-invoices 136 of 178; clients-list and owner-clients 64 of 80; report-filters in owner-report 50 of 81; work-overview and owner-overview 147 of 224. The five owner-* files are 1,209 file lines (wc). Separately, `inWorkLang(` is called 58 times in seven Work action files (my rg), e…
- cost: About 495 copied component lines and about 250 lines of wrapper; a change to a filter or a column is made twice. (The build, an agent's session, and owners when the two views drift apart.)
- fix: 5 steps; first: 1. src/components/admin/work/time-filters.tsx: add optional props stores and storeSlug and draw the StoreFilter of owner-common.tsx only when stores is given. owner-time.tsx:60-125 then renders TimeFilters with stores, and its copy of the form goes.
- done when: `wc -l` of the five owner-time, owner-invoices, owner-clients, owner-report and owner-overview files totals under 800 (today 1,209), and `rg -c 'inWorkLang[(]' src/app/admin` sums to at most 14 (today 58 in seven files).
- saving: About 650 lines (estimate: about 400 from the views, about 250 from the wrappers).
- after: nothing
- tracked: Partly: code review step 3.13 Domain folders (FV4, FH6), Open, moves Work first but does not merge the twin views
- notes: Correction kept from the second check: 58 actions, of which 33 wrap one call; the wrapper saving is about 250 lines. The wrapper's odd indentation (actions.ts:91-97) shows it was written by a codemod, so a codemod can take it out.

### CP-6 [P2 M duplicate confirmed] Tripletex and Fiken are twins: the sync runner, the settings page and the actions
- evidence: lcs.mjs: fiken-sync against tripletex-sync 205 lines in runs of five or more; the two pages 220; the two action files 75; fiken.ts and tripletex.ts 59. The two files declare the same functions in the same order (sweep, claim, release, ensure the customer, booked, blockRow, failRow, onFailure, sendOne, attachable, attachPdfs, noteConnection, syncStore, syncDue, retry, check, post again: my rg listing). The two HTTP c…
- cost: About 560 near-copied lines today; a retry fix is made twice. A third accounting system would be made by copying again. (The build, an agent's session, and owners when a retry fix reaches one system o…)
- fix: 6 steps; first: 1. Add src/server/after-or-now.ts with two helpers, because the 16 blocks end in two ways. afterOrNow(fn) runs after(fn) and, outside a request, awaits fn(): use it for the blocks whose catch awaits the work (checkout.ts:1321, :1348, :1373, :1517 and :1584, b…
- done when: `rg -c 'for update skip locked' src/server/fiken-sync.ts src/server/tripletex-sync.ts` prints nothing (today one claim in each), and a multi-line rg for `try {` followed by `after(` finds only after-or-now.ts and after-answer.ts (today 16 in 12 files).
- saving: About 400 to 450 lines (estimate).
- after: code review step 3.12 (this is that step)
- tracked: Yes: code review step 3.12 One accounting adapter, one afterOrNow (FV10), Open
- notes: Not new: it is step 3.12. Worth doing when a third accounting system is asked for or when either sync is next changed. One correction to the code review's FV10, found while planning: the 16 after() blocks are not one block written 16 times; about seven run th…

### CP-7 [P1 L process confirmed] The one wrapper for server actions is marked Done but carries 3 of the admin's 235 action files, and nothing counts the rest
- evidence: 271 files start with 'use server' (24,583 lines) and export 1,372 actions. Under src/app/admin there are 235 such files and 3 import store-action (orders, returns, books: 45 actions); my rg confirms 232 off the wrapper. 31 of the 271 files contain a catch. 23 admin action files define a local guard wrapper (asOwner 11, member 4, owner 3, change 3, guarded 1, act 1). The ratchet (ratchet.scan.test.ts, five tests) cou…
- cost: Few lines; the cost is that the hand-written shape stays the default for every new action file (8 more admin action files since the review), and an unplanned failure in the 232 files shows Next's error page instead of a… (Owners (an error page instead of a line in the form) and agents (each new file …)
- fix: 6 steps; first: 1. scripts/lib/ratchet-count.mjs: add actionFilesOffWrapper(root): the files under src/app/admin that start with 'use server' and do not import @/server/store-action. ratchetCounts() returns the list.
- done when: src/server/ratchet.scan.test.ts holds the new test, and adding a 'use server' file under src/app/admin that does not import store-action makes `pnpm test src/server/ratchet.scan.test.ts` fail; the baseline lists 232 files or fewer.
- saving: About 150 lines of local wrappers; the gain is one failure path for the admin's actions and a number that can only fall.
- after: nothing
- tracked: Yes: code review step 1.4 (FV9), Done for orders, returns and books; the rest 'when touched' (docs/rules/admin/platform.md:89). No ratchet holds it.
- notes: Two sizes in one finding: steps 1 to 3 are an hour's work and belong in the same push as CP-14's ratchet; steps 4 and 5 are L and are worth it for the failure path, not for lines. Before opening is a good time for the 23 files with a local wrapper: owners wil…

### CP-8 [P2 S duplicate corrected] Small helpers are declared again in file after file
- evidence: helpers.mjs (second check): 84 helpers are declared with identical text in three or more files (412 declarations, 576 lines beyond one copy); 169 more in exactly two files (377 lines). My counts today: `const fail = (message: string): never` in 43 server files, each of which already imports OwnerToolError from owner-tool-error.ts (two lines long, exports only the class); isUuid declared 23 times in 23 files in three…
- cost: 953 lines gross beyond one copy each, but most are one-liners; the real cost is three spellings of 'is this a uuid' and of 'is this a unique violation'. (An agent's session and correctness where two spellings disagree; the build hard…)
- fix: 6 steps; first: 1. src/server/owner-tool-error.ts: export `fail` (the body of redirect-tools.ts:31-33). In the 43 files delete the local const and add fail to the import they already have.
- done when: `rg -c '^(export )?(const|function) (isUuid|isUniqueViolation)' src --glob '!*.test.ts'` sums to 2 (today 32 in 32 files) and `rg -l 'const fail = [(]message: string[)]: never' src/server` prints one file (today 43).
- saving: About 300 to 500 lines net (estimate): 126 from fail, about 30 from isUniqueViolation, the rest from multi-line helpers; 953 is the gross bound before the import lines that replace the copies.
- after: nothing
- notes: Correction kept from the second check: the net saving is about a third of the gross 950, because a one-line helper replaced by an import saves nothing but the drift. The helpers that share a name but not a body are CP-16.

### CP-9 [P2 S duplicate confirmed] Three SQL fragments are typed out in dozens of files: the product title with its fallback, the usage counter and the order event
- evidence: The join that finds a product's title in a language with a fallback to any language is in 33 files and 40 places (second check, multi-line rg; my one-line rg finds 35 in 27 files). Its result is spelled six ways: coalesce(tl.title, tf.title, p.handle) 28 times, coalesce(tl.title, tf.title) 9 times with no fallback to the handle, and four one-offs. `insert into commerce.chat_usage` is written 32 times in 28 files alt…
- cost: About 250 lines; a product with no title row shows a null title in nine reads and its handle in 28. (Agents and the build; shoppers and owners where the fallback differs.)
- fix: 5 steps; first: 1. Add src/server/product-title.ts: titleJoin(productAlias, locale) returns the two joins as one sql fragment with the fixed aliases tl and tf; titleOf(productAlias) is coalesce(tl.title, tf.title, p.handle). Replace the 40 places (catalog.ts:297, exchanges.t…
- done when: `rg -c 'insert into commerce[.]chat_usage' src --glob '!*.test.ts'` sums to at most 2 (today 32 in 28 files) and `rg -c 'insert into commerce[.]order_events' src --glob '!*.test.ts'` to 1 (today 34 in 23 files).
- saving: About 250 lines (estimate) and one definition of the title a person sees.
- after: nothing
- notes: A SQL function commerce.product_title(product_id, locale) would also work but needs a migration and hides the join from the planner; the fragment is the smaller change.

### CP-10 [P3 M duplicate corrected] Eleven server files hand-write the same claim-with-a-lease statement for their own queue table; ten more use skip locked in other ways
- evidence: `for update skip locked` appears 24 times in 21 server files (my rg agrees). Only 11 of those files use a claimed_until lease (legal-writer, page-looks, fiken-sync, tripletex-sync, site-tools, workflows, platform-workflows, follow-up-runner, support-inbound, theme-shots, dream-factory); the other 10 lock rows in other ways. The claims read are the same idea with another table, join, retry column and returning list. …
- cost: About 12 lines of claim SQL in each of 11 files (about 130 lines); a lease rule is decided eleven times. The larger cost, each queue polled by its own scheduled pass, belongs to the scheduled-work dimension and was not … (Agents (eleven places to read when a lease rule changes); the database for the …)
- fix: 3 steps; first: 1. Do nothing for the lines alone.
- done when: Not planned for its own sake. If done: `rg -c 'for update skip locked' src/server --glob '!*.test.ts'` sums to 13 or fewer (today 24 in 21 files).
- saving: About 100 to 150 lines (estimate); fewer polling passes only if queues are merged, which this dimension did not measure.
- after: a decision from the scheduled-work dimension on one job table
- notes: P3 because it is an idiom, not a copy: 130 lines spread over eleven files, with a medium risk each. Correction kept from the second check: eleven lease queues, not twenty-one, and 100 to 150 lines, not 300.

### CP-11 [P2 S duplicate confirmed] The affiliate and bonus settings forms are one form written twice
- evidence: affiliate-settings-form.tsx (453 file lines) and bonus-settings-form.tsx (515): 292 code lines match exactly and 347 lie in runs of five or more after normalising (lcs.mjs). The state-and-submit blocks (affiliate 46-110, bonus 39-103) differ only in type names, the catalogue key and the field-id prefix; the problems list, saved line and submit row at the foot are the same markup. Smaller cases: chat-agent-form and d…
- cost: About 550 near-copied lines in six files. (Agents and the build; owners when the two forms behave differently.)
- fix: 4 steps; first: 1. Add src/components/admin/use-settings-form.ts (a client hook): the state, dirty flag, submit in a transition, saved line and problems of affiliate-settings-form.tsx:46-110, taking { initial, toInput, save, words }.
- done when: `wc -l src/components/admin/affiliate-settings-form.tsx src/components/admin/bonus-settings-form.tsx` totals under 700 (today 968), with affiliate-ui.test.ts and bonus-ui.test.ts passing.
- saving: About 250 to 300 lines (estimate).
- after: CP-3 for Field and FormProblems in the kit (the hook itself needs nothing first)
- tracked: Partly: Field falls under code review step 1.12 (FS4), Open; the form state is not in it
- notes: Do it with CP-3 when the settings forms are converted to the kit, not as a push of its own.

### CP-12 [P2 S duplicate confirmed] On the storefront an order's totals are drawn in two places (and a third, looser, in checkout) and the product card's query is written twice
- evidence: The order's totals list is the same JSX in the account's order page and in the confirmation page: exact runs of 42, 19 and 12 lines, 102 lines in runs after normalising. Checkout draws nearly the same rows a third time with net amounts for a business (near-copy family 7 names all three files, 43 lines), and the pay page shares a 19-line run with the two order pages (family 47). In catalog.ts, listProducts() (:284) a…
- cost: About 160 lines; the risk is larger than the size: a money row or a card field added in one place and not the other. (Shoppers, if the copies drift; the build.)
- fix: 4 steps; first: 1. Add src/components/order-totals.tsx (a server component beside order-vat.tsx and order-customs.tsx): props are the totals' rows, the words and the locale, and a net flag for a business. Take its body from account/orders/[orderId]/page.tsx:181-250.
- done when: The two order page files total under 900 lines (today 327 + 661 = 988), each draws its totals through OrderTotals, and catalog.ts is under 700 lines (today 750).
- saving: About 160 lines and one place for what a shopper is shown as owed.
- after: nothing
- tracked: The card query yes: code review step 3.11 (FF10), Open. The order totals: no.
- notes: Small in lines, but it is the one copy a shopper could see go wrong, and before opening nobody has an order whose page would change. Do the totals with the next change to any of the three pages.

### CP-13 [P2 S duplicate confirmed] English words are kept twice: in a lib module and again in the English catalogue
- evidence: clones.json lists 17 pairs where a .en.ts catalogue and a code module share exact windows, 311 lines: privacy.en.ts with erasure-plan.ts (39 lines: TABLE_LABELS at erasure-plan.ts:93 is the same list as tables: at privacy.en.ts:175, read), returns.en.ts with exchange.ts (34), builder.en.ts with page-content.ts (22), design.en.ts with theme-changes.ts and theme-update.ts (22 and 19), legal.en.ts with legal-roles.ts (…
- cost: About 310 lines, and two sources for one English sentence: an edit to one leaves the other, which the AI tools and server messages still use. (Owners and the AI manager (two wordings of one thing); the build slightly.)
- fix: 4 steps; first: 1. src/lib/admin-messages/privacy.en.ts:175-183: replace the literal list with `tables: TABLE_LABELS` imported from ../erasure-plan, as inventory.en.ts:2-5 imports its words.
- done when: Re-running the review's exact-copy detector with the catalogues included lists no pair of a .en.ts catalogue and a code module (today 17 pairs, 311 lines).
- saving: About 310 lines.
- after: nothing
- notes: By count the catalogues repeat short words a lot (21.6% of entries) but only 6.1% of characters, and that repetition is by design; this finding is only the 311 lines where a catalogue copies a code module's own list.

### CP-14 [P0 S process confirmed] Nothing in CI measures copied code, so each new kind or twin is made by copying a neighbour
- evidence: No jscpd in package.json, no duplicate rule in the lint config and no copy check in the workflows (second check's rg; I re-read package.json). There are 46 *.scan.test.ts files and a ratchet with a baseline of four counts (unknownCasts, anySuppressed, untypedReads in 453 files, byIdWrites in 100 files); none counts copies. The pattern in the findings above is the same each time: the fifth import, the second accounti…
- cost: Today's level is low (1.0% exact, 4.75% near), but nothing keeps it there; each cloned feature adds a few hundred to about 1,300 lines. (The build and CI over time; agents, whose sessions read every copy.)
- fix: 6 steps; first: 1. Add scripts/lib/copy-count.mjs: the detector of the review (work/cp/near.mjs at level 0: trim, drop comments, imports and lone brackets; a 10-line window of 220 characters or more with 6 or more distinct lines; tests aside). Set aside what is parallel by d…
- done when: `pnpm test src/server/ratchet.scan.test.ts` passes on main and fails on a branch where a 30-line block of one file is pasted into another.
- saving: Holds copied code at about 4,800 exact and 22,400 near lines; removes no lines by itself.
- after: nothing
- notes: Do it in the same push as CP-7's count of action files off the wrapper: both are a number in the same baseline. It is P0 because it is an afternoon's work, cannot break a screen, and is what keeps CP-1, CP-4 and CP-5 from growing back once many features are a…

### CP-15 [P2 S duplicate added] Integration tests repeat their scaffolding: 448 stub a module the config already stubs, next/cache is stubbed in five spellings, and 233 build their own store
- evidence: My script over the 556 *.int.test.ts files (137,661 lines): 448 contain `vi.mock('server-only', () => ({}))` although vitest.integration.config.mts:10 aliases server-only to test/server-only.ts, an empty module, so the line does nothing there (131 unit tests carry it too; the unit config has no alias). 465 stub next/cache: 425 with a one-line stub in at least five spellings (318 files stub cacheLife, cacheTag, updat…
- cost: About 2,470 lines (448 + 425 + 271 + 617 + 711), 1.8% of the integration tests; 448 of them do nothing today. The real cost is drift: when server code starts calling a next/cache function that an older stub leaves out (… (CI a little (every file parses its own stubs); agents, who copy a neighbour's h…)
- fix: 6 steps; first: 1. Delete the line `vi.mock('server-only', () => ({}));` from the 448 integration tests (a codemod that removes exactly that line) and run pnpm test:int.
- done when: `rg -c "vi[.]mock[(].server-only" src --glob '*.test.ts'` sums to 0 (today 579 files: 448 integration, 131 unit) and `rg -c "^vi[.]mock[(].next/cache" src --glob '*.int.test.ts'` sums to about 40 (today 465), with pnpm test and pnpm test:int green.
- saving: About 1,100 test lines at once (448 + 131 + 425 + 122) and about 1,500 with the shared store helper; no production code.
- after: nothing
- notes: Added by the completeness check: the report measured tests only as a percentage. It is small (tests are 30% of the codebase and this is under 2% of the integration tests), so P2: step 1 is ten minutes and worth doing now; the rest when test support is next to…

### CP-16 [P2 S duplicate added] Day arithmetic, country names and the money label are re-solved under one name in many modules with different bodies; the copy detector sees none of it
- evidence: My script over the 1,757 non-test files of src/server and src/lib: 331 top-level function names are declared in three or more files and 22 in ten or more. Opened: addDays is declared in 10 lib modules, exported from 7, with 5 bodies (all UTC, written five ways); daysBetween in 7 files with 5 bodies (one rounds, one floors, one takes Dates); isDay in 7 with 6 bodies (a pattern test in src/server/invoices.ts:29 and in…
- cost: About 150 to 250 lines. The cost is behaviour, not size: the same question gets a slightly different answer by file (what a missing country shows, whether a day difference rounds or floors, which locale a tool's amount … (Owners and shoppers where two screens answer differently; agents, who find seve…)
- fix: 5 steps; first: 1. Add src/lib/day.ts for calendar days as 'YYYY-MM-DD' strings: isDay, addDays and daysBetween, taking src/lib/analytics-period.ts:93-108 as the body. Make the other exported versions re-exports (addDays in src/lib/retention.ts:256, order-list.ts:467, gift-c…
- done when: `rg -c '^(export )?(function|const) (addDays|daysBetween|isDay|countryName)' src/lib src/server --glob '!*.test.ts'` sums to at most 8 (today 31 declarations: addDays 10, daysBetween 7, isDay 7, countryName 7).
- saving: About 150 to 250 lines (estimate), and one answer per question.
- after: CP-8 (its helper module for the tools and its scan test)
- tracked: no (code review step 1.14, Open, covers date formatting in the admin; step 1.2's ratchet will remove the local iso helpers as reads are typed)
- notes: Added by the completeness check, as the brief asked for near-copies the detector cannot see: these are one-liners with one name and several spellings, below any window size. I opened addDays, daysBetween, isDay, countryName, money, iso, clip, adminLink and ma…
