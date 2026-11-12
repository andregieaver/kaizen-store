# DP-3 ✓ The Stripe and Supabase SDKs are evaluated by 97% of routes; reading a store imports the Stripe SDK to see if two keys exist

Dependencies (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P3. **Effort:** M. **Confidence:** medium. **Step:** tolerated.
- **Second check:** corrected.
- **Where:** `src/server/stripe.ts:3`, `src/server/stripe.ts:33-46`, `src/server/stripe.ts:58-60`, `src/server/stores.ts:182`, `src/server/stores.ts:300`, `src/server/orders.ts:23`, `src/server/settings.ts:16`, `src/server/media.ts:5`, `src/lib/stripe-account.ts:17-26`, `vitest.integration.config.mts:13-19`
- **Evidence:** getStore() computes paymentsOn with platformModes() (stores.ts:300), which calls platformStripe(mode) and so builds, once per instance, a Stripe client just to learn whether two environment keys are set. stores.ts therefore imports stripe.ts, whose first line imports the SDK; stores.ts reaches only 130 source files, so on a lean route this one edge is what brings the SDK (walked: with it cut, /api/visit after DP-10 reaches no Stripe code). In the build the Stripe SDK module (212 KB) is in the chunks of 804 of 830 routes and supabase-js (206 KB) in 803. New measurement: the beacon's own code after DP-10 and DP-1, bundled, loads in 130-143 ms and +18.3 MB heap with the Stripe SDK and in 128-144 ms and +17.1 MB without. The difference is inside the noise. New fact for the fix: 153 test files mock ./stripe and 113 of them supply platformModes: () => ['test'] so that getStore() reports payments on.
- **Cost today:** As the build holds them, Stripe evaluates in 18-28 ms and supabase-js in about 14 ms (skeptic); on a lean route the planner measured no difference beyond 1 MB of heap. 418 KB of JS compiled in 97% of routes. Paid by: The server once per new function instance. Small beside the hub itself.
- **Saving:** Measured: nothing visible in load time on the lean route and about 1 MB of heap; 220 KB less in its bundle. The skeptic's bundled timing gives up to 18-28 ms for Stripe and 14 ms for supabase-js on routes that do not use them.
- **Risk:** Step 1: low in the app, medium in the tests (113 mocks change meaning; a test that expected payments on would fail loudly). Step 2: medium, it touches every payment call. Before opening is the cheapest time to touch payment code, but the gain does not justify it.

## The fix

1. Not now. Take step 1 only when src/server/stores.ts or stripe.ts is next changed for another reason.
2. a new src/server/stripe-keys.ts (server-only, no SDK import) holding platformSecretKey(mode), platformPublishableKey(mode) and platformModes(), built on platformKey() from src/lib/stripe-account.ts. stripe.ts imports and re-exports them, so its 43 importers keep working. stores.ts:182, orders.ts:23 and settings.ts:16 import platformModes from ./stripe-keys.
3. With step 1, the 113 integration tests that mock ./stripe with platformModes no longer reach getStore() through that mock. Set STRIPE_SECRET_KEY_TEST and STRIPE_PUBLISHABLE_KEY_TEST to dummy sk_test_ and pk_test_ values once, in vitest.integration.config.mts (the test.env option, so every worker sees them), so paymentsOn stays true where the tests expect it; run pnpm test:int and fix what still differs.
4. Step 2 (async stripeFor() and platformStripe(), a lazy storage client in media.ts): only if a measurement on the built routes after DP-1, DP-10 and the hub cuts still shows the two SDKs. 65 call sites would gain an await.

**Done when:** The graph test shows the four /api/visit routes reaching no file that imports the stripe package, and pnpm test:int passes.

**Tests and rules that hold today's behaviour, and change with it:**

- 153 test files mock ./stripe; 113 supply platformModes (rg -l 'platformModes: \(\) =>' src -g '*.test.*'): the reason step 1 is not the one-line change it looks
- src/server/checkout.int.test.ts:253 sets STRIPE_SECRET_KEY_TEST itself: must keep passing
- CLAUDE.md: payment credentials are store settings, never environment variables (D15); the platform's own keys are the exception stripe.ts already reads from the environment: no rule changes
- Code review step 4.2 (all environment reads through env.ts, Open): the new file is one more reader to list there
- DP-6's graph test would then forbid src/server/stripe.ts on the beacon routes

**Comes after:** DP-10 and DP-1 first (until then other chains bring the SDK anyway)

**Notes:** True but not worth doing now. The planner's measurement puts the gain on a lean route inside the noise, and the test suite's mocks make step 1 an M, not an S. It stays on the list because the edge is a real oddity (a store read builds a payment client to count two keys) and the fix is known when the file is next opened.
