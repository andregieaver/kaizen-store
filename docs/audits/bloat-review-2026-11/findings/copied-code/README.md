# Copied code (CP)

Part of `docs/audits/bloat-review-2026-11.md`, on commit 0bd814c. Read by one reviewer, challenged by a second (who re-opened every citation, re-measured every number and applied the owner's note that the platform is not open yet) and planned by a third. A tick (✓) marks a finding the second reviewer confirmed or corrected; one the planner added has none. Each finding has a file of its own beside this one.

**In short.** Copied code is not where this codebase's bloat is, and that holds after a third look: 1.0% of non-test code is an exact copy (4,803 of 472,586 lines) and 4.75% a near-copy with every name and literal normalised; unit and integration tests (1.8% and 3.2%) and the e2e folder (1.7% and 7.4%) are no worse. The fourteen checked findings are true duplicates or missing checks, none rests on a feature being unused, and their corrected savings add up to about 5,500 lines (1.2%); my two additions are small too: about 1,100 to 1,500 test lines of repeated scaffolding (448 integration tests stub a module the test config already stubs) and helpers re-solved under one name (addDays in 10 files, countryName exported from 6 with three different answers for a missing code). Do first, because they are small and safe: one store-address helper for the 27 hand-written lookups behind production's most-called statement (560,090 calls with no shoppers), and a copy ratchet in CI. Do before opening, while every table holds only test rows: one import definition, one engine with a scope for the platform's workflows and deliveries, and one Work view for store and account.

## Findings

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [CP-2](CP-2.md) ✓ | A store's address by its id is looked up by hand in 27 places beside a cached helper that already exists; it is production's most-called statement | duplicate | P0 | S | 0.20 |
| [CP-14](CP-14.md) ✓ | Nothing in CI measures copied code, so each new kind or twin is made by copying a neighbour | no check | P0 | S | 1.17 |
| [CP-1](CP-1.md) ✓ | Five file imports each repeat the upload, register, start-check, start-apply and cursor code, the browser flow, the findings table, the pages and the routes (leases and retries are already shared) | duplicate | P1 | M | 3.13 |
| [CP-3](CP-3.md) ✓ | Admin form fields, tables and loading skeletons are spelled out per file because the UI kit has no piece for them | duplicate | P1 | L | 4.1 |
| [CP-4](CP-4.md) ✓ | The platform console has a second engine for workflows, own endpoints and integration deliveries beside the stores' engines *(your choice)* | duplicate | P1 | M | 3.10 |
| [CP-5](CP-5.md) ✓ | Work's account-level screens are copies of the store-level ones, and 58 Work actions are wrapped in a seven-line shell | duplicate | P1 | M | 3.14 |
| [CP-7](CP-7.md) ✓ | The one wrapper for server actions is marked Done but carries 3 of the admin's 235 action files, and nothing counts the rest | no check | P1 | L | 4.1 |
| [CP-6](CP-6.md) ✓ | Tripletex and Fiken are twins: the sync runner, the settings page and the actions | duplicate | P2 | M | 4.2 |
| [CP-8](CP-8.md) ✓ | Small helpers are declared again in file after file | duplicate | P2 | S | 3.15 |
| [CP-9](CP-9.md) ✓ | Three SQL fragments are typed out in dozens of files: the product title with its fallback, the usage counter and the order event | duplicate | P2 | S | 3.15 |
| [CP-11](CP-11.md) ✓ | The affiliate and bonus settings forms are one form written twice | duplicate | P2 | S | 4.2 |
| [CP-12](CP-12.md) ✓ | On the storefront an order's totals are drawn in two places (and a third, looser, in checkout) and the product card's query is written twice | duplicate | P2 | S | 3.16 |
| [CP-13](CP-13.md) ✓ | English words are kept twice: in a lib module and again in the English catalogue | duplicate | P2 | S | 3.15 |
| [CP-15](CP-15.md) | Integration tests repeat their scaffolding: 448 stub a module the config already stubs, next/cache is stubbed in five spellings, and 233 build their own store | duplicate | P2 | S | 4.3 |
| [CP-16](CP-16.md) | Day arithmetic, country names and the money label are re-solved under one name in many modules with different bodies; the copy detector sees none of it | duplicate | P2 | S | 3.15 |
| [CP-10](CP-10.md) ✓ | Eleven server files hand-write the same claim-with-a-lease statement for their own queue table; ten more use skip locked in other ways | duplicate | P3 | M | tolerated |

## Measured

| Measure | Value | How |
|---|---|---|
| Exact copies, all non-test src | 4,803 of 472,586 code lines (1.02%); 4,098 across files (0.87%) | The second check's run of work/cp/near.mjs level 0 on src (work/cpsk/all-0.json): 10-line window, 220 characters or more, 6 or more distinct lines, catalogues and schema.ts set aside |
| Near-copies, all non-test src (names and literals normalised) | 22,429 of 472,586 (4.75%); across files 15,404 (3.26%); inside one file 7,025 (1.49%) | near.mjs level 2 on src; I re-ran it with every file listed (work/cpp/near-within.mjs, 3.8 seconds) and got the same totals |
| Near-copy share by window size | 6-line window 6.43%; 10-line 4.75%; 15-line 2.40%; 20-line 1.40% | The second check's runs of near.mjs level 2 with WINDOW=6, 15 and 20 (work/cpsk/w6-l2.json, w15-l2.json, w20-l2.json) |
| Near-copy share by folder | src/app/admin 10.3%, src/app/s 10.2%, src/app/api 10.1% (of 2,168 lines), src/components/admin 6.7%, src/lib 3.8%, src/server 2.2% | perFolder of work/cpsk/all-2.json, printed in this session |
| Repeats inside one file | 7,025 lines in 161 files: email-text.ts 790, page-builder.tsx 449 of 5,455, ai-provider-form.tsx 197 of 604, product-editor.tsx 175, privacy-text.ts 139, owner-tools.ts 136; about 1,400 are per-language text that only looks alike once literals are normalised | any minus cross per file in work/cpp/all-2.json (my run) |
| Upper bound of lines extraction could remove | 8,489 lines in the top 400 of 446 cross-file families, of which 1,395 are data by design (signature themes 960, API catalogue entries 435); the largest family saves 152 lines (38 lines in 5 import files) | Sum of (places - 1) x lines per family from all-2.json; I printed the top 60 families and matched each to a finding |
| Platform against store, file by file | 26 file pairs share 198 ten-line windows; the largest are the two integration provider pages (38), the two domain-move pages (35) and cart reminders against plan reminders (18) | Pairs of all-2.json where exactly one path is under platform/, account/ or named platform-* |
| Near-twin files | 65 pairs among 3,969 files share 30% or more of their normalised 4-line shingles; every one belongs to a finding below or to the signature themes | work/cpsk/sib.json, read in full in this session |
| Tests | Unit and integration tests: 4,604 of 260,660 code lines exact (1.77%), 8,212 near (3.15%). e2e: 372 of 21,378 exact (1.74%), 1,584 near (7.41%) | The second check's near-tests.mjs runs; e2e is my run of the same detector on the e2e folder (work/cpp/e2e-0.json, e2e-2.json) |
| Integration test scaffolding | 556 files, 137,661 lines: 448 stub server-only although the config aliases it; 465 stub next/cache (425 one-line stubs in at least five spellings, 271 lines in blocks); 206 stub next/headers (617 lines, 24 bodies); 233 build their own store through the access request (711 lines) | work/cpp/testscaffold.mjs (my script) and rg counts; vitest.integration.config.mts:9-12 |
| Server actions on the shared wrapper | 271 'use server' files, 1,372 exported actions; under src/app/admin 235 files, 3 of them import store-action (45 actions); 23 files define a local guard wrapper | The second check's actions.mjs; my rg for files starting with 'use server' under src/app/admin and for the import |
| Data job routes | 15 route files (10 tick, 5 problems; 14 and 22 lines each) whose guard is exactly the key JOB_KEY gives the kind | A loop over the route files comparing each guard with src/server/data-jobs.ts:63-76 |
| A store's row read by its id, written by hand | 152 single-row reads in 102 server files with about 30 column lists: slug 27 (production's most-called statement, 560,090 calls in 78 days), time_zone 13, id 6, theme 4 | rg with pcre2 for 'select ... from commerce.stores where id = ${...}::uuid', tests and fixtures aside; m/prod-db-stats.md:86 |
| SQL repetition | 10,364 sql templates, 25,629 SQL lines in 639 files; 15 distinct lines of 40+ characters occur in 10 or more files. Counts today: chat_usage upsert 32 in 28 files, order_events insert 34 in 23, the title's lateral join 35 one-line forms in 27 files, 'published is not null' 24 in 15 | work/cp/sqlfrag.json and my rg counts |
| Small helpers | Identical text: 84 helpers in 3 or more files (412 declarations). Same name, any body: 331 top-level function names are declared in 3 or more of 1,757 server and lib files, 22 in 10 or more (iso 29 with 17 spellings, money 23, isUuid 22, addDays 10 with 5 bodies, countryName 7 with 7 bodies) | The second check's helpers.mjs; work/cpp/samename.mjs (my script) and rg for each name |
| Class-name constants and tables in the admin | 284 top-level input, field, control, card, label and hint constants in 171 admin files; 154 hand-written tables in 116 files; 27 loading.tsx files declare their own skeleton block | rg counts in this session (the second check's 376 also counts th, td, primary, secondary and non-admin files) |
| English admin catalogues | 24,127 one-line entries in 67 files, 18,908 distinct: 21.6% of entries repeat (Save 76 times, Name 75) but only 6.1% of the characters (55,917 of 920,267) | work/cpp/catdup.mjs (my script) |
| Sum of the findings' savings | CP-1 to CP-14: about 5,100 to 6,100 lines of non-test code (about 1.2%); CP-15 about 1,100 to 1,500 test lines; CP-16 about 150 to 250 | Estimate: each finding's corrected saving added up |

## Well made, and should stay

- Exact copy-paste is rare: 1.0% of non-test code, and only one block is copied into four or more files (a 10-line drag-handle icon).
- The top 60 near-copy families all belong to a finding below or to data that is parallel by design; nothing large was left unclassified.
- The import jobs' claim, lease, retry, progress and finish are written once (src/server/data-job-store.ts) and one runner dispatches by kind (src/server/data-jobs.ts:290); exports share runExport() and buildDirect().
- The platform-and-store rule has not filled the admin with copied pages: 26 file pairs share 198 windows in all, and of the platform-X server modules only workflows, endpoints and integrations are near-copies of their store twin.
- The 44 AI manager tool modules are not copies of each other, and carriers sit behind one 30-line registry (src/server/carriers/index.ts); the carrier settings page is one dynamic route.
- SQL is written once far more often than not: 25,629 SQL lines and only 15 distinct long lines in ten or more files. The conditions the brief named are small or already a database function: 'published is not null' 24 places in 15 files, commerce.store_is_active() is one SQL function called 67 times, and scan tests hold the order and price readers (restricted-orders, selling-readers, price-readers .scan.test.ts).
- A cached store-address helper already exists (storeSlugOf, src/server/menus.ts:282), so CP-2 is a matter of using it. One correction to the earlier checks: a slug is rewritten once in one case, when a sandbox is kept (commerce.adopt_sandbox(), called from src/server/platform.ts:388); a trigger holds a sandbox's address otherwise, and nothing rewrites the slug of a store that is not a sandbox.
- The six signature themes (960 lines of the near-copy bound) and the admin API catalogue entries (435) are data on a shared kit: parallel by design.
- Message catalogues repeat short words (Save, Name, Cancel) but only 6.1% of their characters; each screen reading its own catalogue is the design (D212, D312), so this is not a finding.
- Tests are no worse than code (1.8% exact, 3.2% near; e2e 1.7% and 7.4%), and 38 of 85 loading.tsx files are already five-line re-exports.
- The shared wrapper for actions costs one line per action where it is used (orders/actions.ts), so moving more files onto it adds no ceremony.
- Nothing in this dimension argues from a feature being unused or a table being empty. The one production figure used (the store-address statement) is read as idle and test load, as the owner's clarification says.
