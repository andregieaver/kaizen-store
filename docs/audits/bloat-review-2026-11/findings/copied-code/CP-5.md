# CP-5 ✓ Work's account-level screens are copies of the store-level ones, and 58 Work actions are wrapped in a seven-line shell

Copied code (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P1. **Effort:** M. **Confidence:** high. **Step:** 3.14.
- **Second check:** corrected.
- **Where:** `src/components/admin/work/owner-time.tsx:60-125`, `src/components/admin/work/time-filters.tsx:46-122`, `src/components/admin/work/owner-invoices.tsx:1`, `src/components/admin/work/invoices-list.tsx:1`, `src/components/admin/work/owner-clients.tsx:1`, `src/components/admin/work/clients-list.tsx:1`, `src/components/admin/work/owner-report.tsx:1`, `src/components/admin/work/report-filters.tsx:1`, `src/components/admin/work/owner-overview.tsx:230`, `src/components/admin/work/work-overview.tsx:146`, `src/app/admin/(gated)/(owner)/account/work/s/[store]/actions.ts:71-125`, `src/lib/work-text.ts:83-88`
- **Evidence:** Lines in runs of five or more shared after normalising (lcs.mjs): time-filters in owner-time 98 of 122 code lines; invoices-list and owner-invoices 136 of 178; clients-list and owner-clients 64 of 80; report-filters in owner-report 50 of 81; work-overview and owner-overview 147 of 224. The five owner-* files are 1,209 file lines (wc). Separately, `inWorkLang(` is called 58 times in seven Work action files (my rg), each time as `const lang = await actionAdminLang(); return inWorkLang(await (async () => { ... })(), lang);` around a call to the file's own change() (actions.ts:71-125, read); in 33 of them the wrapped body is one return line.
- **Cost today:** About 495 copied component lines and about 250 lines of wrapper; a change to a filter or a column is made twice. Paid by: The build, an agent's session, and owners when the two views drift apart.
- **Saving:** About 650 lines (estimate: about 400 from the views, about 250 from the wrappers).
- **Risk:** Low to medium. The store filter must stay out of the single-store view: work-pages.test.ts and owner-pages.test.ts draw both, and e2e/work.spec.ts walks them. A missed inWorkLang would show a Norwegian owner an English problem line, which work-screens.test.ts checks.
- **Already tracked:** Partly: code review step 3.13 Domain folders (FV4, FH6), Open, moves Work first but does not merge the twin views

## The fix

1. src/components/admin/work/time-filters.tsx: add optional props stores and storeSlug and draw the StoreFilter of owner-common.tsx only when stores is given. owner-time.tsx:60-125 then renders TimeFilters with stores, and its copy of the form goes.
2. The same for invoices-list.tsx and owner-invoices.tsx (a storeColumn prop adds the store's name), clients-list.tsx and owner-clients.tsx, report-filters.tsx and owner-report.tsx.
3. work-overview.tsx and owner-overview.tsx: move the sections both draw (work-overview.tsx:146 and :187, owner-overview.tsx:230 and :280) into work-parts.tsx and use them from both.
4. Actions: in each of the seven Work action files make the file's own change() end with `return inWorkLang(result, await actionAdminLang())` and turn each wrapped one-liner into `return change(...)` (33 actions). For the 25 longer bodies add one file-local inLang(run) helper so each loses its wrapper lines.
5. Or do step 4 by moving the seven files onto storeAction() (CP-7), whose handler is handed the language. Choose one of the two, not both.

**Done when:** `wc -l` of the five owner-time, owner-invoices, owner-clients, owner-report and owner-overview files totals under 800 (today 1,209), and `rg -c 'inWorkLang[(]' src/app/admin` sums to at most 14 (today 58 in seven files).

**Tests and rules that hold today's behaviour, and change with it:**

- src/components/admin/work/owner-pages.test.ts, work-pages.test.ts, work-screens.test.ts, report-components.test.ts, invoice-list.test.ts; src/lib/work-owner.test.ts, work-overview.test.ts; src/server/work-settings.int.test.ts and the other Work integration tests; e2e/work.spec.ts.
- docs/work.md and docs/rules/admin/commerce.md:336 describe the combined account view as a feature: it stays; only its components merge. Nothing there asks for separate components.
- src/lib/permissions.scan.test.ts reads each action file's guard: the guard call (checkPermission in workMember) stays in the file.
- Code review step 3.13 (Domain folders, Open) moves Work first: do this before or with it so the move carries fewer files.

**Notes:** Correction kept from the second check: 58 actions, of which 33 wrap one call; the wrapper saving is about 250 lines. The wrapper's odd indentation (actions.ts:91-97) shows it was written by a codemod, so a codemod can take it out.
