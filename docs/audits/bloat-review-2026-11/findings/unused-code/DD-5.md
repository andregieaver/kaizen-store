# DD-5 ✓ Three Work actions have no screen: a logged time entry's hours cannot be corrected

Code nothing uses (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** dead. **Priority:** P2. **Effort:** S. **Confidence:** high. **Step:** your choice. **The owner's choice.**
- **Second check:** corrected.
- **Where:** `src/app/admin/(gated)/(owner)/account/work/s/[store]/actions.ts:254`, `src/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-actions.ts:100`, `src/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-actions.ts:115`, `src/server/work-time.ts:347`, `src/server/work-invoices.ts:1167`, `src/server/work-invoices.ts:1202`, `src/components/admin/work/time-entry-list.tsx:6`, `src/components/admin/work/log-time-form.tsx:75`, `src/lib/work-ui.ts:352`
- **Evidence:** These are the only 3 of 1,372 server actions no component imports. updateTimeEntryAction has no importer and no test. saveInvoiceLinesAction and saveInvoiceHeaderAction are called by one integration test only (work-invoices.int.test.ts:1498 and :1512); the invoice editor saves a whole draft through saveDraftInvoiceAction. The time-entry list imports only setEntryNoteAction and deleteTimeEntryAction (time-entry-list.tsx:6), entryAccess() knows only note and delete (work-ui.ts:352-361), and no AI tool calls updateTimeEntry (work-tools.ts has log_time only). So the hours, date or task of an entry cannot be changed on screen although updateTimeEntry() (53 lines) exists and is tested in two integration tests, which also test the database's rule that time on an issued invoice does not change. saveDraftHeader (44 lines) is reached only through its unused action. saveLines (33 lines) is different: 14 test files call it 41 times as set-up.
- **Cost today:** 35 lines of actions, 97 lines of server code reached only through them, and their tests; and a gap in Work: a wrong entry must be deleted and logged again. Paid by: A Work user who mistyped hours; maintainers.
- **Saving:** About 130 lines removed (35 of actions, 97 of server code), or one finished feature for an afternoon's work and about 80 lines removed.
- **Risk:** Low. The three actions already run through the same membership guard as the others, so leaving them is safe. Under B the risk is losing the only tests of the immutable-time rules; the rewrite in B covers it.

## The fix

1. Owner's choice for time entries, A or B. A is recommended: the server side is done and tested.
2. A1. src/lib/work-ui.ts: give entryAccess() an edit flag (true where delete is true; on a draft invoice only the date and the note may change, as updateTimeEntry() rules at src/server/work-time.ts:341-346).
3. A2. src/components/admin/work/time-entry-list.tsx: add Edit to EntryRow, shown when access.edit: the date, duration, task and billable fields of log-time-form.tsx, saved with updateTimeEntryAction(storeSlug, entry.id, input) and its problems shown with Problems. Words in src/lib/admin-messages/work.en.ts and work.nb.ts. Homer's view stays one row with Edit and Delete; nothing new to read.
4. A3. Tests: a case in src/components/admin/work/work-pages.test.ts (Edit shows for an owner, not on an invoiced entry) and in the work-ui test for the flag.
5. B. Or delete: updateTimeEntryAction (actions.ts:253-262 and its import at :34) and updateTimeEntry() (work-time.ts:341-399). Then rewrite the cases that reach the database's rules through it (work-time.int.test.ts:197-200, 252-257, 294-300, 318-319; work-glue.int.test.ts:201-218) as direct SQL updates, so the rules stay tested.
6. Invoices, either way: delete saveInvoiceLinesAction and saveInvoiceHeaderAction (invoice-actions.ts:99-126), saveDraftHeader() (work-invoices.ts:1202-1245) and the test at work-invoices.int.test.ts:1498-1512, if the invoice editor is meant to save a whole draft at once. Leave saveLines(): it is the tests' set-up.

**Done when:** node scripts/unused.mjs lists none of updateTimeEntryAction, saveInvoiceLinesAction and saveInvoiceHeaderAction; under A, the component test changes an entry's minutes through the row.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/work-time.int.test.ts and work-glue.int.test.ts (updateTimeEntry: kept under A, rewritten under B).
- src/server/work-invoices.int.test.ts:1498-1512 (the two invoice actions).
- src/components/admin/work/work-pages.test.ts; src/lib/admin-messages/work.en.ts and work.nb.ts (parity).
- Rule: docs/rules/admin/commerce.md:336 (Work) and docs/work.md do not say an entry can or cannot be edited; add one line with the choice. The Homer and Lisa rule in CLAUDE.md applies to the new Edit.

**Notes:** A product choice, not waste. The question for the owner: should a logged entry's hours be editable, or is delete and log again the intended way?
