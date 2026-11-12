# DD-7 ✓ English words kept twice: old constants beside the catalogues, held equal by tests

Code nothing uses (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P2. **Effort:** S. **Confidence:** medium. **Step:** 3.15.
- **Second check:** confirmed.
- **Where:** `src/lib/finance-words.test.ts:28`, `src/lib/payouts.ts:12`, `src/lib/payouts.ts:24`, `src/lib/payouts.ts:114`, `src/lib/inventory-words.test.ts:26`, `src/lib/marketing-consent.ts:48`, `src/lib/payment-terms.ts:50`, `src/lib/payment-terms.ts:110`, `src/lib/capture.ts:81`, `src/lib/store-starters.ts:81`, `src/lib/shipping-carriers.ts:39`, `src/lib/privacy-text.ts:720`, `src/lib/data-admin.ts:179`
- **Evidence:** Between 86 and 121 of the suspect exports are word lists or sentence helpers no production file reads (363 to 572 lines, by the planner's two patterns; the skeptic's gave 85 to 119 and 360 to 577). 52 are read by nothing; 69 are named by a test, in 59 test files. Tests hold a catalogue section equal to the older constant: finance-words.test.ts:27-31 holds financeEn.payouts equal to three constants in payouts.ts that nothing else reads (rg -w: the definitions and the test only), and inventory-words.test.ts:26-35 holds translated sentences equal to old English-only functions. rg counts 37 assertions of the form toEqual(X_WORDS) or toBe(X_TEXT) in tests. The words moved to src/lib/admin-messages and the originals stayed. The same shows inside exported objects: STAFF_TEXT has 11 of 15 members nothing reads, KIND_TITLES 8 of 10 (planner's member scan). No rule in docs/platform-admin-i18n.md or docs/rules asks for the twin.
- **Cost today:** 363 to 572 lines, a subset of DD-2 and DD-3 (do not add them). A wording change must be made in two places or a test fails. Not shipped: the build keeps the catalogue's copy only. Paid by: Whoever edits interface text; CI.
- **Saving:** Up to about 500 lines and 30 to 40 assertions (measured upper bound; part of DD-2's and DD-3's totals, not on top of them).
- **Risk:** Low. Typecheck shows any remaining reader. One thing to watch: a constant that an AI tool's description is built from is production text, so it falls under step 3, not step 2.

## The fix

1. List them: from node scripts/unused.mjs take the unused and tests-only exports whose names end WORDS, LABELS, TEXT, TEXTS, NOTE, COPY, NAMES, TITLES, or Words, Text, Label, Sentence (scratchpad/work/ddplan/words.txt holds today's 121).
2. Where nothing but a test reads the constant (the usual case: PAYOUT_STATUS_WORDS, PAYOUT_LINE_KIND_WORDS, PAYOUT_STATE_WORDS, TERMS_STATE_LABELS, TERMS_REFUSAL_WORDS, CAPTURE_PROBLEM_WORDS, CARRIER_FEATURE_LABELS, CONTENT_SOURCE_WORDS, the marketing-consent lists): delete the constant and the assertion that holds the catalogue equal to it. The catalogue's English is then the one copy; the test that Norwegian has every English key stays.
3. Where production code with no language still reads the constant (an assistant's tool, a log line): keep one copy by letting the catalogue file import the constant, and delete the equality assertion.
4. In exported word objects, delete the members nothing reads (STAFF_TEXT in src/lib/privacy-text.ts:720, redirectSentences in src/lib/redirects.ts:283): confirm each with rg of X.member first. Leave KIND_TITLES (src/lib/data-admin.ts:179) and LIFECYCLE_WORDS (src/lib/lifecycle.ts:27) whole: they are typed as a full Record, and the catalogue already imports KIND_TITLES (inventory.en.ts:327), which is the one-copy pattern of step 3.
5. pnpm lint, typecheck, test; node scripts/unused.mjs.

**Done when:** rg -n "toEqual\(\w+_(WORDS|LABELS|TEXT|NAMES|COPY|NOTE)\)|toBe\(\w+_(WORDS|LABELS|TEXT|NAMES|COPY|NOTE)\)" src --glob '*.test.*' | wc -l prints 0 (37 today), and pnpm test passes.

**Tests and rules that hold today's behaviour, and change with it:**

- The *-words tests in src/lib (14 files, among them finance-words.test.ts, inventory-words.test.ts, marketing-words.test.ts, order-list-words.test.ts) and the catalogue tests under src/lib/admin-messages (builder.test.ts names 7 of the constants, legal.test.ts 3, tax-payments.test.ts 3): the equality cases go, the parity cases stay.
- src/lib/admin-strings.baseline.json and brand.scan.test.ts: unaffected (fewer strings).
- docs/platform-admin-i18n.md: no rule asks for an English twin; no edit needed.

**Comes after:** DD-4

**Notes:** The size of the catalogues and how they load is the i18n dimension's; this is only the second copy.
