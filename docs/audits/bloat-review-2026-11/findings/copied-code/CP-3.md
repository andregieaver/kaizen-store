# CP-3 ✓ Admin form fields, tables and loading skeletons are spelled out per file because the UI kit has no piece for them

Copied code (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P1. **Effort:** L. **Confidence:** medium. **Step:** 4.1.
- **Second check:** corrected.
- **Where:** `src/components/admin/ui/index.ts:1-9`, `src/components/admin/ui/card.tsx:13`, `src/components/admin/data/ui.ts:1-12`, `src/app/admin/(gated)/[store]/settings/legal/loading.tsx:3-21`, `src/app/admin/(gated)/[store]/settings/orders/loading.tsx:3-21`, `src/app/admin/(gated)/[store]/loading.tsx:3`, `src/app/admin/(gated)/[store]/analytics/customers/loading.tsx:4`, `src/components/admin/inventory/history-view.tsx:104`, `src/components/admin/bulk-result.tsx:98`, `docs/audits/code-review-2026-11.md:69`, `docs/audits/code-review-2026-11.md:250`, `docs/audits/code-review-2026-11.md:434`
- **Evidence:** My count: 284 top-level input, field, control, card, label and hint class constants in 171 admin files (the second check counted 376 with th, td, primary and secondary and files outside the admin; input alone has 15 spellings, field 20). The kit (ui/index.ts) exports Button, Chip, Card, bars, List, PageHeader and FocusFrame: no input, select, table or skeleton. data/ui.ts already shares field, label, hint, a table shell, th and td, for the data pages only. The admin holds 154 hand-written tables in 116 files; near-copy families 5 and 27 are that markup in 10 and 5 places. Loading: 85 loading.tsx, 1,157 lines; 38 are five-line re-exports; 39 are drawn by hand in 33 distinct bodies; 27 declare the same `const block`; the same ten lines open 14 of them, another ten open 8 (the analytics ones) and another eleven open 5 (activity and automation).
- **Cost today:** About 380 one-line declarations with 11 to 20 spellings of one control; 10 to 15 lines of shell and head per table; about 250 lines of repeated skeleton head. The cost is an uneven admin and a copy-the-neighbour habit, not bytes: Tailwind emits each utility once however many files spell it. Paid by: Owners (controls that look and behave slightly differently per screen) and agents (a new screen copies a neighbour's constants). The build pays almost nothing.
- **Saving:** About 900 to 1,100 lines (estimate: about 380 declarations, about 5 lines from each of some 100 tables, about 250 from skeleton heads). The gain that matters is one look per control.
- **Risk:** Visible changes across the admin. A wrong spacing or a lost focus ring shows in the signed-in suite's screenshots and in the a11y spec; do it area by area so one push changes one area.
- **Already tracked:** Mostly: code review step 1.12 Build the admin kit (FS4), Open, names Field, TextInput, Select, EmptyState, ConfirmButton, Pager and ListSearch and the scan test for raw input classes. Tables and skeletons are not in it. Step 0.10 (FS1, In progress) is about loading files existing, not their bodies.

## The fix

1. Build code review step 1.12 as written (docs/audits/code-review-2026-11.md:434): Field, TextInput, Select, EmptyState, ConfirmButton, Pager and ListSearch in src/components/admin/ui, exported from ui/index.ts, tested in ui/ui.test.ts.
2. Add the two pieces that step does not name. ui/table.tsx: DataTable({ caption, columns, rows, empty }) with the shell, th and td of src/components/admin/data/ui.ts:9-11. ui/skeleton.tsx: PageSkeleton({ words, blocks }) with the status wrapper and heading of [store]/settings/legal/loading.tsx:7-13 and a list of block heights.
3. Loading files: replace the 14 files that open with the same ten lines (near-copy family 2: [store]/loading.tsx, orders/[orderId]/loading.tsx, settings/accessibility, settings/legal, settings/notifications/[notification] and nine more) and the five activity and automation ones (family 35) with one PageSkeleton call each. Leave the eight analytics skeletons: they mirror their pages' layout on purpose.
4. Convert area by area, one push each: the 17 list pages step 1.12 names; then the data pages (data/ui.ts becomes re-exports of the kit); then settings forms. In each converted file delete the local class constants.
5. Extend step 1.12's raw-input-class scan test to fail on a new top-level `const input|field|control|card|label|hint|th|td = '...'` in src/app/admin and src/components/admin, with today's 171 files as an allow-list that may only shrink.
6. List the new pieces in docs/admin-style.md section 5 and set step 1.12 in the Progress table with the date, the commit and a change-log line.

**Done when:** Step 1.12's own done-when passes, and `rg -c '^const (input|field|control|card|label|hint) = ' src/app/admin src/components/admin` sums below 100 (today 284 in 171 files).

**Tests and rules that hold today's behaviour, and change with it:**

- The signed-in Playwright suite (e2e/signed-in, 209 tests by step 0.10's note) is the check for look and behaviour; send screenshots of each converted area as CLAUDE.md asks.
- src/components/admin/ui/ui.test.ts; src/app/admin/admin-type.scan.test.ts; src/components/admin/admin-catalogues.scan.test.ts.
- Step 0.10's note: Home has about 550 bytes of script room left. Keep kit pieces that hold no state as server components so a converted client page does not grow.
- CLAUDE.md Conventions (Homer and Lisa) and 'The admin's look' (D149, docs/admin-style.md): the kit must draw in the colour roles, as ui/index.ts:1 says.
- Code review steps 1.12 (Open) and 1.13 (after 1.12) own most of this; DataTable and PageSkeleton are additions to 1.12, not a new step.

**Comes after:** code review step 1.12 (this is that step, with two pieces added)

**Notes:** Corrections kept from the second check: the claim that 27 loading skeletons are three bodies does not reproduce (39 hand-drawn files, 33 distinct bodies), so the skeleton saving is about 250 lines, not 450; a class variant costs the build nothing. My counts differ slightly because I counted six names in the admin only.
