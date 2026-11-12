# SG-9 ✓ getStore() imports the Stripe SDK to learn which payment modes have keys

The server code every route loads (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P3. **Effort:** S. **Confidence:** high. **Step:** 2.22.
- **Second check:** corrected.
- **Where:** `src/server/stores.ts:182`, `src/server/stores.ts:300`, `src/server/orders.ts:23`, `src/server/orders.ts:555`, `src/server/stripe.ts:3`, `src/server/stripe.ts:33-46`, `src/server/stripe.ts:58-60`, `src/lib/stripe-account.ts:17-26`
- **Evidence:** stores.ts:182 imports platformModes from stripe.ts to decide paymentsOn (line 300); orders.ts:23 does the same (line 555); stripe.ts imports the Stripe package at the top (line 3). The SDK is 189 modules and 212 KB in the server chunks. platformModes() is not a pure read of the environment today: it calls platformStripe(mode), which builds a Stripe client when a key is set (stripe.ts:33-46); its answer depends only on whether the two keys have the right shape (platformKey in src/lib/stripe-account.ts:17-26). 16 non-test files import platformModes. The price of moving it is in the tests: 113 test files mention platformModes, nearly all in a vi.mock of ./stripe that answers ['test'] (rg, counted here; the skeptic counted 98 integration files).
- **Cost today:** 212 KB and about 190 modules per cold start of every route that reads a store and has no other path to Stripe (6 ms measured for Stripe's own factory; the rest is parsing). Paid by: The server per cold instance.
- **Saving:** /api/visit 663 -> 465 module paths, 1,173 -> 956 KB (simulated, after SG-3 and SG-6). Handlers that reach the SDK: 244 -> 201 today, -> 155 once the cycle is cut, -> 95 with SG-18 as well. Storefront pages do not move with this cut; they lose the SDK through SG-18.
- **Risk:** Low in the code, but not 'two pure functions move': the function is rewritten not to build a client, and the tests' mocks of ./stripe no longer reach stores.ts unless the shared setup hands them on. A wrong setup shows as paymentsOn false in tests that expect checkout to open.
- **Already tracked:** Not in the repo's plans. In this review: deps DP-3 (P3, same reasoning).

## The fix

1. Not now. Do SG-18 first: it removes the commoner path to the SDK (ai.ts and mollie.ts -> settings.ts -> connect.ts) with no test to change.
2. When stores.ts or stripe.ts is next changed for another reason: add to src/lib/stripe-account.ts a pure configuredModes(keys) that answers the modes whose secret and publishable keys both pass platformKey(); add src/server/stripe-modes.ts (server-only, no SDK import) whose platformModes() calls it with the four environment values; src/server/stripe.ts keeps its own exported platformModes() written on the same pure function (it no longer builds a client to answer).
3. src/server/stores.ts:182 and src/server/orders.ts:23 import platformModes from './stripe-modes'.
4. Keep the 113 test files unchanged with one shared setup file (the unit config already has src/test/eager-lazy-views.ts as the pattern for a vi.mock in a setup file; add the new file to setupFiles in vitest.config.mts and vitest.integration.config.mts): vi.mock('@/server/stripe-modes', async () => { const stripe = await import('@/server/stripe'); return { platformModes: () => stripe.platformModes() }; }); Each test file's own mock of ./stripe then still decides the modes, as today, and a file with no mock gets the real answer from the environment.
5. Run pnpm test and pnpm test:int; fix what still differs.

**Done when:** A new next analyze export shows /api/visit with no ~/stripe module (today 189 modules, 212 KB), at or under about 500 modules and 1.0 MB, and pnpm test:int passes.

**Tests and rules that hold today's behaviour, and change with it:**

- 113 test files supply platformModes in a mock of ./stripe (rg -l 'platformModes' src -g '*.test.*'): the reason this is not the one-line change it looks.
- src/server/checkout.int.test.ts sets STRIPE_SECRET_KEY_TEST itself: must keep passing.
- CLAUDE.md: payment credentials are store settings, never environment variables (D15); the platform's own keys are the exception stripe.ts already reads from the environment: no rule changes.
- Code review step 4.2 (all environment reads through env.ts, Open): the new file is one more reader to list there.

**Comes after:** SG-3; SG-6; SG-18

**Notes:** P3: 212 KB and a few milliseconds on routes that read a store but take no payment, against a change to how 113 test files get their payment modes. The skeptic's note that storefront pages reach Stripe 'through checkout code' is corrected in SG-18: the home page does not reach checkout.ts at all.
