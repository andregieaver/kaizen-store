# AD-4 ✓ The store shell reads one thing after another, and checks Stripe set-up on every render

What the server does for an admin navigation (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 2.32.
- **Second check:** confirmed.
- **Where:** `src/app/admin/(gated)/[store]/layout.tsx:60-88`, `src/app/admin/(gated)/[store]/layout.tsx:68-73`, `src/app/admin/(gated)/[store]/layout.tsx:151`, `src/app/admin/(gated)/layout.tsx:22-26`, `src/components/admin/admin-shell-parts.tsx:52`, `src/server/connect.ts:257-279`, `src/server/connect.ts:539-546`, `src/server/store-trial.ts:63-70`, `docs/rules/admin/commerce.md:62-65`, `docs/decisions.md:31`, `docs/decisions.md:34`
- **Evidence:** The layout awaits the member, then the account's stores (used at top level for one footer link, line 151), then the support count, then the starter (starter stores only), then the trial pause, each after the last; the account menu then awaits the Kaizen Life link with no Suspense. A top-level await in a layout holds the whole segment, children included, and the only boundary above is the gate's, so the person sees the waiting screen until all are done. On every render the layout also schedules ensureTestAccount() and ensureStorePaymentMethods() with after(): one statement each, and a Stripe API call per render while a Kaizen-made test account is not yet active (connect.ts:270-275). The second looks for payment methods added to the platform, which changes only at a deploy; checkout runs the same check.
- **Cost today:** 5 database round trips in a row before the frame can paint on a hard load, and 2 statements (sometimes a Stripe call) after every shell render, which includes every save and every poll tick. New stores start in test mode (D20), so every new store's first minutes in the admin are the Stripe-call case. Paid by: The owner on each hard load and save; the server and database per shell render; Stripe's API quota in the not-yet-ready case.
- **Saving:** Estimate: 3 fewer sequential waits before the frame paints on a hard load, and 2 fewer statements per shell render for every active selling store after its first render in an instance.
- **Risk:** Low. What could break: a test account that goes from active back to restricted would not be re-read by the admin in that instance (checkout still checks before every payment, and the account webhook keeps the status current). A badge or banner read in parallel instead of in order changes nothing a person sees. Noticed by billing.int.test.ts and the signed-in specs.

## The fix

1. src/app/admin/(gated)/[store]/layout.tsx:74-88: after the member is known, run the reads that depend only on it in one Promise.all: storesOf(account), waitingCount (when the member may read support), starterOfStore (starter stores), pausedAfter (open stores) and requestIp(). Four waits become one.
2. Move the reads out of a function a test can call: a small storeShellData(member) in src/server that returns { stores, waiting, starter, trialPaused }, so AD-12's budget test can count the shell's statements.
3. src/components/admin/admin-shell-parts.tsx:52: read the Kaizen Life link in a small async component inside its own Suspense (fallback null) among the menu's rows, so the account menu no longer waits for it.
4. src/server/connect.ts: keep, per instance, the stores whose test account this instance has seen active, and the stores for which this instance found nothing left to ask Stripe for (two module Sets; a store is added only on those two answers, so what Stripe refused is still tried again). ensureTestAccount() and ensureStorePaymentMethods() return at once for a store in the set. A new deploy starts new instances with empty sets, so a method added to the platform is still asked for at the first admin visit after the deploy, as D23 says. Checkout keeps its own calls unchanged.
5. src/app/admin/(gated)/[store]/layout.tsx:68-73: schedule the two after() calls only when the store is not yet in those sets (export a cheap needsPaymentCheck(storeId)), so no closure and no statement is spent on a store already settled.

**Done when:** The layout has one await after the member besides the Promise.all (read the file), and AD-12's counter shows the store shell at 2 statements for the guard plus one wave, and 0 statements after the response for a store whose test account is active, on the second render in one instance (2 after the response today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/billing.int.test.ts (ensureTestAccount and ensureStorePaymentMethods): add that a second call for an active account sends no statement, and that a fresh module state asks again.
- src/server/store-trial.int.test.ts (pausedAfter), src/server/kaizen-life-accounts.int.test.ts (kaizenLifeAppUrl), src/server/store-features-website.int.test.ts (storesOf), src/server/support.int.test.ts (waitingCount).
- e2e/signed-in/admin-phone.spec.ts and a11y.spec.ts draw the shell; the menu's footer link and the Support badge must still show.
- Rules kept to the letter: docs/rules/admin/commerce.md:62-65 (the test account is made 'in the background from the store admin layout, on the Payments page, or at checkout') and D20, D23 in docs/decisions.md:31 and 34 (methods asked 'when the store's admin is opened or a checkout starts'). The memo only stops asking again in the same instance.

**Comes after:** AD-12 step 1 (the statement counter, for the check only)

**Notes:** The planner chose a per-instance memo over the skeptic's move to the Payments page and a job: it removes the same statements without changing D23's letter or adding a job. If the owner later wants the check out of the admin altogether, that is a decision row, not a performance fix.
