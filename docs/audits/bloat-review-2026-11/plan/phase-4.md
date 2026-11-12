# Phase 4: Tidy

Part of `docs/audits/bloat-review-2026-11.md`: its Progress table says where each step stands. **Goal:** Smaller things. The twins, the exports only a test keeps alive, the 23 guard wrappers and the last heavy reads are work of their own and end before step 4.5; class constants, hand-made tables, mocks and tree walkers go when their area is next touched, under a per-file ratchet. The ratchets of phase 1 hold every count until then, so nothing here can grow while it waits, and the last small findings close. The last step reads every measure against its bar: the plan is done when every area is an A, not when its steps are ticked. **A person will notice:** Little. Admin forms and tables come from one kit, the last small twins are folded, tests share their scaffolding, and three more screens read less. A table shows each area's measures against its bar.

Each step names the findings it closes; a finding's own file has the evidence, the fix in detail, and the tests and rules that change with it.

## 4.1 Build the admin kit and move action files onto the shared wrapper, area by area

Admin form fields, tables and loading skeletons are spelled out per file (284 class constants in 171 files) because the UI kit has no piece for them: build the field, table and skeleton parts (code review step 1.12), and convert an area when it is next touched: no new file may declare a class constant or a hand-made table, and the per-file counts only fall (296 constants and 154 tables today). The one wrapper for server actions carries 3 of 235 action files: the 23 files that have a guard wrapper of their own (asOwner, member, guarded and the like) move before step 4.5, as work of its own; the rest move when touched. The ratchet of step 1.17 holds both counts.

- **Closes:** [CP-3](../findings/copied-code/CP-3.md), [CP-7](../findings/copied-code/CP-7.md)
- **Effort:** L. **Areas it moves:** The code itself.
- **Done when:** The kit's field, table and skeleton parts exist; a per-file ratchet in src/server/ratchet.baseline.json fails a new file that declares a class constant or a hand-made table and lets each file's count only fall; no 'use server' file under src/app/admin defines a local guard wrapper (23 today), before step 4.5; and unwrappedActionFiles is 209 or lower (232 today).
- **Platform:** The platform admin's screens use the same kit and platformAction(), and convert with their areas.
- **To carry it out:** [steps/4.1.md](steps/4.1.md) (strong)

## 4.2 Fold the remaining twins

Tripletex and Fiken are twins (the sync runner, the settings page and the actions; 143 shared lines in the two sync files): one accounting sync core and one afterOrNow (code review step 3.12). Ten small pairs share about 840 lines: the bonus and affiliate settings forms, the campaign and discount editors, the two agent forms, the reminders, the speed recorders. The three provider blocks of ai-provider-form.tsx become one ProviderFields part. This is work of its own, largest file first, and ends before step 4.5: 'when next touched' has no end. The twin baseline keeps a pair with its reason only where it stays on purpose.

- **Closes:** [CP-6](../findings/copied-code/CP-6.md), [FM-9](../findings/families/FM-9.md), [CP-11](../findings/copied-code/CP-11.md), [FM-11](../findings/families/FM-11.md), GAP-code-s6
- **Effort:** M. **Areas it moves:** The code itself.
- **Done when:** Before step 4.5 the twin counter lists at most 5 pairs, none over 45 shared lines, each with its reason in src/lib/copies.baseline.json, and rg -c 'for update skip locked' src/server/fiken-sync.ts src/server/tripletex-sync.ts prints nothing.
- **Platform:** The platform's AI provider form is the same ai-provider-form.tsx, and the platform's affiliate programme shares the folded settings form.
- **To carry it out:** [steps/4.2.md](steps/4.2.md) (strong)

## 4.3 Tidy the tests' side: exports only a test keeps alive, shared mocks and one tree walker

About 330 exports in production files are kept alive only by a test (443 names, 2,959 lines): delete each, or name it in keptForTests with a reason; this part ends before step 4.5, as work of its own. The mocks and the tree walkers stay 'when touched', under a per-file ratchet. 579 test files mock server-only, which the config already stubs, and next/cache is stubbed in five spellings: one setup file and shared store-makers. 86 test files read the source tree with 67 private walkers: one helper, src/test/source-files.ts, walks and reads it once per worker.

- **Closes:** [DD-2](../findings/unused-code/DD-2.md), [CP-15](../findings/copied-code/CP-15.md), [TC-11](../findings/tests-ci-build/TC-11.md), [TC-10](../findings/tests-ci-build/TC-10.md)
- **Effort:** M. **Areas it moves:** The code itself; Tests, CI and the build.
- **Done when:** node scripts/unused.mjs (the scan of step 1.17) shows testOnlyExports empty with 100 to 130 reasoned names in keptForTests before step 4.5, no test file mocks server-only (579 today), fewer than 60 integration tests stub next/cache themselves (465 today), and rg -l readdirSync src --glob '*.test.ts' | wc -l prints 20 or less (86 today).
- **Platform:** Test code only: nothing differs for the platform.
- **To carry it out:** [steps/4.3.md](steps/4.3.md) (strong)

## 4.4 Make the last reads fetch what they show

Three screens read more than they draw: the platform Home holds its first paint for 18 statements and reads whole lists to show a number, the orders list re-reads store facts it already holds, and the Payments page reads one table three or four times and waits on Stripe and Mollie before it paints. Some reads fetch whole JSON documents where a card or a count is needed: the theme cards read every snapshot, the speed report every sample. Ending a sandbox runs 800 deletes and holds about 2,100 locks: purge one at a time, and write the lock arithmetic into docs/builder-sandbox.md. The parts that grow with a store left this step for phase 2: the per-product VAT and alt-text calls and the lists with no limit are steps 2.19 and 2.17. What stays ends before step 4.5.

- **Closes:** [AD-6](../findings/admin-server/AD-6.md), [AD-11](../findings/admin-server/AD-11.md), [AD-15](../findings/admin-server/AD-15.md), [DQ-10](../findings/queries/DQ-10.md), [DS-11](../findings/database-shape/DS-11.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; The database.
- **Done when:** Before step 4.5, src/server/admin-statements.baseline.json holds the platform Home's loaders at 11 or fewer (18 today), the Payments page at 7 or fewer in 2 waves and the orders list at 2 fewer than its first figure; theme-store.int.test.ts asserts that loadCards() reads no snapshot key; and src/server/sandbox.int.test.ts has a case where two purges started together both finish.
- **Platform:** The platform Home is the first of the three screens: the platform gets what the store Home got in step 2.32.
- **To carry it out:** [steps/4.4.md](steps/4.4.md) (review)

## 4.5 Measure everything again, and read each area against its bar

The goal is an A in every area, not ticked steps. When the cuts are in, run the whole measured set again (measure-routes.mjs, server-graph.mjs, the route, server and query budgets, the daily reading) and the build under a memory cap. Write one table per area: each measure, its figure, its bar and the check that holds it. Report repeated server chunks (123.6 MiB of 195.5 MiB is the same three chunks written many times today), and try server source maps off, on Vercel only, if memory needs it. Read the figures that need time: decision numbers changed in merges over 100 commits, the scheduler's calls on a quiet day, the AI manager's tokens per call. A measure short of its bar gets a step; the bar does not move. The table also carries the figures that need time, each with the day it can first be read: the first 20 sessions after steps 2.1 and 2.40, 100 commits on main, seven nightly runs, a week of AI use and 28 days of admin loads. The plan is done when those are read, not when the last cut lands.

- **Closes:** [SG-11](../findings/server-module-graph/SG-11.md), [SF-11](../findings/server-functions/SF-11.md), GAP-surface-s4
- **Effort:** M. **Areas it moves:** The code itself; What a shopper's browser gets; What an owner's browser gets; What the server loads and asks; Scheduled work; The database; AI calls; The product's surface; The written rules; The page builder's model and a built page; Styles; Interface text; Tests, CI and the build.
- **Done when:** docs/audits/bloat-review-2026-11 holds the table with no measure short of its bar and no figure that needs time left blank: each carries the day it was read. Among its rows: each of five store pages at 350,000 bytes on the wire or less, with at most 2 late script files of 30,000 bytes together; each themed and money-path figure of steps 1.6 and 1.7 beside its bar; the first 20 sessions after steps 2.1 and 2.40 at a median of 25 KB or less of rules and docs per code change, with no single read of a rule file or the decisions index over 20 KB and no omitted long line in a search of docs/rules or docs/decisions (if whole rule files are being read, the plan gets the step that splits them); and the surface's measures 3 and 6 read against the done-whens of steps 3.3 and 2.37. scripts/route-budget.mjs reports under 40 MiB of repeated server chunk bytes (123.6 MiB today), and docs/build-memory.md holds the build's peak after the cuts.
- **Platform:** The platform's screens, jobs and pages are rows of the same tables.
- **To carry it out:** [steps/4.5.md](steps/4.5.md) (strong)

## 4.6 Let a logged time entry be corrected in Work, and delete two invoice actions no screen uses

A logged time entry's hours cannot be corrected on any screen, though updateTimeEntry() is built and tested (src/server/work-time.ts). Give entryAccess() in src/lib/work-ui.ts an edit flag, true where delete is true; on a draft invoice only the date and the note may change, as the server already rules. Add Edit to the entry's row in src/components/admin/work/time-entry-list.tsx with the fields of the log-time form, saved through updateTimeEntryAction, with its words in the Work catalogue in both languages. The default view stays one row with Edit and Delete. Delete saveInvoiceLinesAction and saveInvoiceHeaderAction, which no screen uses, as finding DD-5 lists.

- **Closes:** 
- **Effort:** S. **Areas it moves:** The code itself.
- **Done when:** A case in src/components/admin/work/work-pages.test.ts shows Edit for an owner and not on an invoiced entry, the work-ui test covers the flag, and rg -n 'saveInvoiceLinesAction|saveInvoiceHeaderAction' src prints nothing.
- **Platform:** Work runs at the store owner's level, and Kaizena Flow's own store uses the same list; the platform console logs no time, so it has no twin to change.
- **To carry it out:** [steps/4.6.md](steps/4.6.md) (cheap)

## 4.7 Say that live drills are a console tool

Live drills can only be asked for by an insert into commerce.live_drills, and three texts say 'a platform admin' asks for them. They stay a console tool on purpose. Correct docs/rules/admin/platform.md, the row for D406 in docs/decisions.md and the comment in src/server/live-drills.ts to say: asked for by an insert into commerce.live_drills, read from the row. No code changes.

- **Closes:** 
- **Effort:** S. **Areas it moves:** The code itself.
- **Done when:** The three texts say that a drill is asked for by an insert into commerce.live_drills and read from its row, and none says a screen or a button asks for one.
- **Platform:** Live drills are the platform's own tool; stores have no part in it.
- **To carry it out:** [steps/4.7.md](steps/4.7.md) (cheap)
