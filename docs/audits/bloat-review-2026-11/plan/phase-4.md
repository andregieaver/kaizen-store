# Phase 4: Tidy

Part of `docs/audits/bloat-review-2026-11.md`: its Progress table says where each step stands. **Goal:** Smaller things, each done when its area is next touched. The ratchets of phase 1 hold every count until then, so nothing here can grow while it waits, and the last small findings close. **A person will notice:** Little. Admin forms and tables come from one kit, the last small twins are folded, tests share their scaffolding, and three more screens read less.

Each step names the findings it closes; a finding's own file has the evidence, the fix in detail, and the tests and rules that change with it.

## 4.1 Build the admin kit and move action files onto the shared wrapper, area by area

Admin form fields, tables and loading skeletons are spelled out per file (284 class constants in 171 files) because the UI kit has no piece for them: build the field, table and skeleton parts (code review step 1.12), and convert an area when it is next touched. The one wrapper for server actions carries 3 of 235 action files: first move the 23 files that have a guard wrapper of their own (asOwner, member, guarded and the like), then the rest when touched. The ratchet of step 1.9 holds both counts.

- **Closes:** [CP-3](../findings/copied-code/CP-3.md), [CP-7](../findings/copied-code/CP-7.md)
- **Effort:** L. **Areas it moves:** The code itself.
- **Done when:** rg -c '^const (input|field|control|card|label|hint) = ' src/app/admin src/components/admin sums below 100 (284 today), no 'use server' file under src/app/admin defines a local guard wrapper (23 today), and unwrappedActionFiles in src/server/ratchet.baseline.json is 209 or lower (232 today).
- **Platform:** The platform admin's screens use the same kit and platformAction(), and convert with their areas.

## 4.2 Fold the remaining twins as each is opened

Tripletex and Fiken are twins (the sync runner, the settings page and the actions; 143 shared lines in the two sync files): one accounting sync core and one afterOrNow (code review step 3.12). Ten small pairs share about 840 lines: the bonus and affiliate settings forms, the campaign and discount editors, the two agent forms, the reminders, the speed recorders. The three provider blocks of ai-provider-form.tsx become one ProviderFields part. Until each is opened, the twin baseline keeps it with its reason.

- **Closes:** [CP-6](../findings/copied-code/CP-6.md), [FM-9](../findings/families/FM-9.md), [CP-11](../findings/copied-code/CP-11.md), [FM-11](../findings/families/FM-11.md)
- **Effort:** M. **Areas it moves:** The code itself.
- **Done when:** The twin counter lists at most 8 pairs, none over 50 shared lines, each with its reason in src/lib/copies.baseline.json, and rg -c 'for update skip locked' src/server/fiken-sync.ts src/server/tripletex-sync.ts prints nothing.
- **Platform:** The platform's AI provider form is the same ai-provider-form.tsx, and the platform's affiliate programme shares the folded settings form.

## 4.3 Tidy the tests' side: exports only a test keeps alive, shared mocks and one tree walker

About 330 exports in production files are kept alive only by a test (443 names, 2,959 lines): delete each, or name it in keptForTests with a reason. 579 test files mock server-only, which the config already stubs, and next/cache is stubbed in five spellings: one setup file and shared store-makers. 86 test files read the source tree with 67 private walkers: one helper, src/test/source-files.ts, walks and reads it once per worker.

- **Closes:** [DD-2](../findings/unused-code/DD-2.md), [CP-15](../findings/copied-code/CP-15.md), [TC-11](../findings/tests-ci-build/TC-11.md), [TC-10](../findings/tests-ci-build/TC-10.md)
- **Effort:** M. **Areas it moves:** The code itself; Tests, CI and the build.
- **Done when:** node scripts/unused.mjs (the scan of step 1.9) shows testOnlyExports empty with 100 to 130 reasoned names in keptForTests, no test file mocks server-only (579 today), fewer than 60 integration tests stub next/cache themselves (465 today), and rg -l readdirSync src --glob '*.test.ts' | wc -l prints 20 or less (86 today).
- **Platform:** Test code only: nothing differs for the platform.

## 4.4 Make the last reads fetch what they show

Three screens read more than they draw: the platform Home holds its first paint for 18 statements and reads whole lists to show a number, the orders list re-reads store facts it already holds, and the Payments page reads one table three or four times and waits on Stripe and Mollie before it paints. Some reads fetch whole JSON documents where a card or a count is needed (the theme cards read every snapshot, the speed report every sample), and six lists have no limit. The catalogue's listing calls a VAT function and an alt-text function once per product row: ask each VAT rate once and join the alt text. Ending a sandbox runs 800 deletes and holds about 2,100 locks: purge one at a time, and write the lock arithmetic into docs/builder-sandbox.md.

- **Closes:** [AD-6](../findings/admin-server/AD-6.md), [AD-11](../findings/admin-server/AD-11.md), [AD-15](../findings/admin-server/AD-15.md), [DQ-10](../findings/queries/DQ-10.md), [DQ-14](../findings/queries/DQ-14.md), [DQ-16](../findings/queries/DQ-16.md), [DS-11](../findings/database-shape/DS-11.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; The database.
- **Done when:** src/server/admin-statements.baseline.json holds the platform Home's loaders at 11 or fewer (18 today) and the Payments page at 7 or fewer in 2 waves, theme-store.int.test.ts asserts that loadCards() reads no snapshot key, and on a database seeded with 2,000 products one listProducts() raises the scans of commerce.countries by at most 10 (at least 2,000 today).
- **Platform:** The platform Home is the first of the three screens: the platform gets what the store Home got in step 2.18.
