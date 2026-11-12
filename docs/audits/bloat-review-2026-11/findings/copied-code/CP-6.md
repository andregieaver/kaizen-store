# CP-6 ✓ Tripletex and Fiken are twins: the sync runner, the settings page and the actions

Copied code (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P2. **Effort:** M. **Confidence:** high. **Step:** 4.2.
- **Second check:** confirmed.
- **Where:** `src/server/fiken-sync.ts:71-602`, `src/server/tripletex-sync.ts:82-740`, `src/app/admin/(gated)/[store]/integrations/fiken/page.tsx:1`, `src/app/admin/(gated)/[store]/integrations/tripletex/page.tsx:1`, `src/app/admin/(gated)/[store]/integrations/fiken/actions.ts:1`, `src/app/admin/(gated)/[store]/integrations/tripletex/actions.ts:1`, `src/server/checkout.ts:1243`, `src/server/after-answer.ts:7`, `docs/audits/code-review-2026-11.md:114`, `docs/audits/code-review-2026-11.md:275`
- **Evidence:** lcs.mjs: fiken-sync against tripletex-sync 205 lines in runs of five or more; the two pages 220; the two action files 75; fiken.ts and tripletex.ts 59. The two files declare the same functions in the same order (sweep, claim, release, ensure the customer, booked, blockRow, failRow, onFailure, sendOne, attachable, attachPdfs, noteConnection, syncStore, syncDue, retry, check, post again: my rg listing). The two HTTP clients are not copies (7 lines in runs). A `try { after(fn) }` block is written 16 times in 12 files (multi-line rg), but I read each catch and there are two endings, not one: about seven run the work at once when there is no request (checkout.ts five times, booking-changes.ts:57, company-approvals.ts:147) and about nine leave it to a scheduled job (design-tools.ts:47, setup-tools.ts:110, site-tools.ts:126, store-drafts.ts:141, stripe-webhooks.ts:121, data-job-store.ts:419, store-copy.ts:357, search-cache.ts:54, after-answer.ts:7).
- **Cost today:** About 560 near-copied lines today; a retry fix is made twice. A third accounting system would be made by copying again. Paid by: The build, an agent's session, and owners when a retry fix reaches one system only.
- **Saving:** About 400 to 450 lines (estimate).
- **Risk:** Bookkeeping postings: a wrong retry or a double post would show in fiken.int.test.ts and tripletex-sync.int.test.ts, which cover block, fail, retry and post again. The after() helpers change nothing a request sees; the risk is picking the wrong one of the two, which would run work twice (now and again from the scheduled job) or not at all in a test, so each block's own catch decides.
- **Already tracked:** Yes: code review step 3.12 One accounting adapter, one afterOrNow (FV10), Open

## The fix

1. Add src/server/after-or-now.ts with two helpers, because the 16 blocks end in two ways. afterOrNow(fn) runs after(fn) and, outside a request, awaits fn(): use it for the blocks whose catch awaits the work (checkout.ts:1321, :1348, :1373, :1517 and :1584, booking-changes.ts:57, company-approvals.ts:147). afterOrLeave(fn) runs after(fn) and does nothing outside a request: use it for the blocks whose catch only holds a comment (design-tools.ts:47, setup-tools.ts:110, site-tools.ts:126, store-drafts.ts:141, stripe-webhooks.ts:121, data-job-store.ts:419, store-copy.ts:357, search-cache.ts:54). Read each catch before replacing it; keep after-answer.ts as it is.
2. Add src/server/books/accounting-sync.ts: the runner (sweep, claim, release, block, fail, onFailure, attachable, attachPdfs, noteConnection, syncStore, syncDue, retry, checkDocument, postAgain) taking an AccountingAdapter { system, ensureParty, send, attach, failureOf, grantRefused } and the system's table fragments, as carriers do behind src/server/carriers/index.ts.
3. src/server/fiken-sync.ts and tripletex-sync.ts keep their exported names (syncDueFiken, retryFiken, checkFikenDocument, postFikenAgain and the Tripletex four) as calls into the runner with their adapter; adoptTripletexCustomers stays Tripletex's own.
4. One connection page component for integrations/fiken/page.tsx and integrations/tripletex/page.tsx taking the adapter's words and fields, and one factory for the two actions.ts files.
5. Leave fiken-client.ts and tripletex-client.ts apart.
6. Set step 3.12 in the code review's Progress table with the date and commit, and correct FV10's wording: the clients are not the copy (the runner, page and actions are), and the after() blocks have two endings.

**Done when:** `rg -c 'for update skip locked' src/server/fiken-sync.ts src/server/tripletex-sync.ts` prints nothing (today one claim in each), and a multi-line rg for `try {` followed by `after(` finds only after-or-now.ts and after-answer.ts (today 16 in 12 files).

**Tests and rules that hold today's behaviour, and change with it:**

- Keep unchanged as the check: src/server/fiken.int.test.ts, tripletex-sync.int.test.ts, tripletex-invoices.int.test.ts, tripletex-panel.int.test.ts, ledger-compare.int.test.ts, vat-return.int.test.ts; src/lib/fiken.test.ts; e2e/signed-in/tripletex.spec.ts.
- src/lib/permissions.scan.test.ts lists integrations/fiken/actions.ts as owner-only: a factory must keep the guard call in the file the scan reads.
- docs/tripletex.md, docs/fiken.md and docs/rules/admin/integrations.md name the sync files; ratchet baseline after the reads move.

**Comes after:** code review step 3.12 (this is that step)

**Notes:** Not new: it is step 3.12. Worth doing when a third accounting system is asked for or when either sync is next changed. One correction to the code review's FV10, found while planning: the 16 after() blocks are not one block written 16 times; about seven run the work now and about nine leave it to a job, so one afterOrNow() for all of them would change behaviour.
