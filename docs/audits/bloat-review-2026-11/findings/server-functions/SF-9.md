# SF-9 ✓ sharp, a font parser and Supabase's client load at start in functions that draw no picture, and every reader of a store loads the Stripe SDK

Server functions: size, cold start, per-request overhead (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** S. **Confidence:** medium. **Step:** 0.4.
- **Second check:** corrected.
- **Where:** `src/server/theme-highlights.ts:3`, `src/server/theme-shot-files.ts:3`, `src/server/ai-vision.ts:3`, `src/server/content-packs.ts:7`, `src/server/page-looks.ts:4`, `src/server/picture-editor.ts:3`, `src/server/ai-picture-marks.ts:4`, `src/server/product-import.ts:6`, `src/server/replicate.ts:6`, `src/server/replicate-images.ts:3`, `src/server/ai-pictures.ts:3`, `src/server/brand-marks.ts:3`, `src/server/font-outlines.ts:4`, `src/server/stores.ts:182`, `src/server/stores.ts:300`, `src/server/stripe.ts:58-60`, `src/server/invoice-storage.ts:3`, `src/server/browser.ts:11-15`
- **Evidence:** Twelve server modules import sharp statically (listed under where). sharp and libvips are 18.9 MB in 741 of 830 traces, and a cold /api/visit and a cold proxy both have sharp's native binary and five of its packages in require.cache (re-measured). require('sharp') alone costs 46 to 52 ms and 21 MB of RSS (verified report). Read from the source maps of the chunks the beacon loads at start: Supabase's packages are 1.19 MB of source there (auth-js 518 KB, postgrest-js 179, storage-js 140, realtime-js 118, phoenix 114), opentype.js 482 KB (one static import, src/server/font-outlines.ts:4), zod 362 KB, drizzle-orm 218 KB. stores.ts:182 imports ./stripe for platformModes(), which builds a Stripe client only to see which modes have keys (stripe.ts:58-60), so every reader of a store loads the SDK; inside the build its module evaluates in 7 to 9 ms with 0.6 MB (verified report). Chromium, Playwright, unpdf and mammoth are already imported on demand (browser.ts:11-15).
- **Cost today:** About 90 to 110 ms and 21 MB of RSS per cold instance: sharp 46 to 52 ms, Supabase's client about 40 ms, Stripe 7 to 9 ms; opentype.js was not timed alone. Plus 18.9 MB per trace for sharp. Paid by: Every cold start; the function package.
- **Saving:** Estimate from the measured package costs: about 46 to 52 ms and 21 MB of RSS per cold instance for sharp on the roughly 740 entries that load it; 7 to 9 ms for Stripe; about 40 ms more for Supabase's client only where step 4 is taken.
- **Risk:** Low. The first picture or payment on an instance pays the load instead. Step 3 is the part with reach: it changes what 113 test files see through their mock of ./stripe, which pnpm test:int shows at once.

## The fix

1. Steps 1, 2 and 5 are DP-2 of this review and step 3 is DP-3 step 1: make each once, with those names.
2. New src/server/sharp-load.ts: import "server-only"; import type sharp from "sharp"; let loaded: Promise<typeof sharp> | undefined; export const loadSharp = (): Promise<typeof sharp> => (loaded ??= import("sharp").then((m) => m.default)); with a comment giving the reason.
3. In each of the 12 modules make the import type-only (import type { Sharp, OverlayOptions } from "sharp" where theme-shot-files.ts, ai-pictures.ts and theme-highlights.ts use the types) and add const sharp = await loadSharp(); as the first line of each function that calls sharp(...); a helper that returns a pipeline without awaiting (theme-highlights.ts:44) becomes async or takes sharp as an argument. Start with theme-highlights.ts and theme-shot-files.ts: they are the two a storefront entry still reaches after SF-1's six cuts. src/server/font-outlines.ts:4 becomes import type { Font } from "opentype.js" with const { parse } = await import("opentype.js") inside the function that parses.
4. New src/server/stripe-keys.ts (server-only, no SDK import): platformPublishableKey(mode), a platformSecretKey(mode) and platformModes(), built on platformKey() of src/lib/stripe-account.ts; stripe.ts imports and re-exports them so its importers keep working; stores.ts:182, orders.ts:23 and settings.ts:16 import platformModes from ./stripe-keys. 113 test files name platformModes and 153 mock ./stripe: a mock of ./stripe no longer reaches getStore(), so set STRIPE_SECRET_KEY_TEST and STRIPE_PUBLISHABLE_KEY_TEST to dummy sk_test_ and pk_test_ values once in vitest.integration.config.mts (test.env) and fix what still differs.
5. Supabase's client: only if the cold-load script still shows it on a hot entry after SF-1 and SF-4 (the beacon loses it with SF-4). Then import createClient inside the function that builds the storage client in invoice-storage.ts:3, data-job-store.ts:5, media.ts:5, review-picture-store.ts:3 and supabase-admin.ts:3.
6. New src/server/lazy-packages.scan.test.ts: no non-test file under src has a static value import of sharp, opentype.js, playwright-core, @sparticuz/chromium, mammoth or unpdf; import type and import() are allowed; src/server/sharp-load.ts is the one home of import("sharp").
7. Build and run the cold-load script on /api/shop/tiles: no .node file in require.cache.

**Done when:** src/server/lazy-packages.scan.test.ts passes (0 static value imports of sharp or opentype.js under src outside tests; 13 today), and a fresh-process load of the built /api/shop/tiles route leaves no .node file in require.cache (1 today).

**Tests and rules that hold today's behaviour, and change with it:**

- The picture suites beside the 12 modules: src/server/theme-highlights.test.ts, theme-shot-files.test.ts, theme-shots.int.test.ts, ai-pictures.test.ts, ai-picture-marks.int.test.ts, brand-marks.int.test.ts, content-packs.int.test.ts, page-looks.int.test.ts, picture-editor.int.test.ts, product-import.int.test.ts, replicate.int.test.ts and replicate-revert.int.test.ts.
- vitest.integration.config.mts (the dummy Stripe keys of step 3) and the integration tests that mock ./stripe.
- No written rule requires a static import of these packages; docs/performance.md's new section (SF-7 step 4) records the rule that replaces the habit.

**Comes after:** SF-1 and SF-2 for the trace share (sharp leaves a function's package only when the entry cannot reach an importer at all, lazy or not)

**Notes:** The skeptic corrected Stripe's cost to 7 to 9 ms (the auditor timed the unbundled package) and the file list. Added in this pass: opentype.js (482 KB of source) is in the beacon's start chunks. Step 3 alone is worth little in time; take it when stores.ts or stripe.ts is next changed.
