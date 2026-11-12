# FM-9 ✓ Fiken's sync engine is a copy of Tripletex's: about 250 to 400 identical lines, and no third system is planned

Families and twins (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P3. **Effort:** M. **Confidence:** medium. **Step:** 4.2.
- **Second check:** corrected.
- **Where:** `src/server/fiken-sync.ts:28`, `src/server/tripletex-sync.ts:1`, `src/server/fiken.ts:1`, `src/app/admin/(gated)/[store]/integrations/fiken/page.tsx:1`, `src/app/admin/(gated)/[store]/integrations/tripletex/page.tsx:1`, `src/lib/accounting-docs.ts:1`, `docs/own-books-and-sales.md:45`
- **Evidence:** fiken-sync.ts says of itself that it is 'the same engine as Tripletex's' (line 28). Imports left out, 208 of its 386 significant lines (54%) are in tripletex-sync.ts unchanged, 143 in runs of three or more: sweep, claim, release, block, fail, the retry ladder, attaching PDFs. The connection modules are 25% alike (84 lines, 40 in runs). The two settings pages share 73 long lines (44%) and their actions 23. What a document is, is already shared (src/lib/accounting-docs.ts), and the two mapping files are not copies. A written decision closes the door on more: docs/own-books-and-sales.md:45-47 says Tripletex and Fiken stay as the bridge until a store's books move to Kaizena Flow's own ledger, and no new accounting connector is started.
- **Cost today:** About 250 to 400 duplicate lines today. A fix to the queue, the retry ladder or the alerts must be made twice. No run-time cost beyond one small query every five minutes; the job works per connected store, so a store without Fiken costs it nothing. Paid by: CI and an agent's session.
- **Saving:** About 250 to 400 lines (estimate from the 143 to 208 identical sync lines, 40 to 84 in the connection modules and about 75 to 126 in the pages; an interface costs some back). No saving from later connectors: none is planned.
- **Risk:** Medium. This code books invoices in an owner's accounts, and docs/fiken.md says Fiken has not yet been tried against a real Fiken company. A shared engine changed for one system could break the other; the integration tests are the guard.
- **Already tracked:** no. docs/own-books-and-sales.md decision 6 says no further accounting connector is started.

## The fix

1. Do nothing now. Leave both connectors as they are.
2. If one sync engine is opened for real work (a change to the retry ladder, the queue or the alerts), do it once: lift sweep, claim, release, block, fail and attach from src/server/tripletex-sync.ts into src/server/accounting-sync.ts behind a small connector interface (book a document, attach a file, read a problem), as carriers have ShippingCarrierAdapter, and make fiken-sync.ts and tripletex-sync.ts its two connectors.
3. Do not build the interface for a third system: the written decision is that none comes.

**Done when:** Not planned. If step 2 is done: node a scratch script src/server/tripletex-sync.ts src/server/fiken-sync.ts reports under 40 lines in runs of three or more (143 today) and the named integration tests pass without an edit.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/fiken.int.test.ts, tripletex-sync.int.test.ts, tripletex-invoices.int.test.ts, tripletex.int.test.ts and the unit tests fiken.test.ts, fiken-map.test.ts, tripletex-map.test.ts: must pass unchanged if step 2 is ever done.
- Rules: 'Tripletex' (D453, docs/tripletex.md) and 'Fiken' (D460, docs/fiken.md) in docs/rules/admin, and decision 6 of docs/own-books-and-sales.md (no further connector).

**Notes:** P3 because it is a true but small duplicate in code that books money, both connectors are a bridge to the own ledger, and no third is coming. Folding it now would spend risk to save a few hundred lines that are due to shrink anyway. Reported also by the copied-code area (CP-6).
