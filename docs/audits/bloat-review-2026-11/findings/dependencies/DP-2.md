# DP-2 ✓ sharp's native library and a font parser load on nearly every cold start

Dependencies (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 0.5.
- **Second check:** confirmed.
- **Where:** `src/server/theme-highlights.ts:3`, `src/server/product-import.ts:6`, `src/server/picture-editor.ts:3`, `src/server/page-looks.ts:4`, `src/server/ai-pictures.ts:3`, `src/server/brand-marks.ts:3`, `src/server/ai-vision.ts:3`, `src/server/content-packs.ts:7`, `src/server/replicate.ts:6`, `src/server/replicate-images.ts:3`, `src/server/theme-shot-files.ts:3`, `src/server/ai-picture-marks.ts:4`, `src/server/font-outlines.ts:4`, `src/server/browser.ts:11`, `src/server/seo.ts`, `src/server/theme-store.ts`, `src/server/theme-shots.ts`
- **Evidence:** Twelve server modules start with a static import of sharp (43 call sites in 28 functions, every one async; no call at module level), and they sit on static import chains from almost everything. Re-walked: the storefront layout and page reach sharp through seo.ts, theme-store.ts, theme-shots.ts, theme-highlights.ts, and still do after the storefront review's cut at customers.ts; checkout and the admin reach it through customers.ts, privacy-erasure.ts, data-jobs.ts, product-import.ts. Loading the built /api/visit route in a fresh process loads sharp; /api/health does not (re-run). sharp and libvips (18.8 MB) are in the file trace of 741 of 830 routes; opentype.js (226 KB, used only by font-outlines.ts to draw a brand mark) is in the chunks of 740. The repo already loads Chromium, mammoth and unpdf with await import() at the call site (browser.ts:11, knowledge.ts:70).
- **Cost today:** sharp 31-38 ms and 21.5 MB RSS per cold start; opentype.js 11-23 ms and about 2 MB (timed here). Together about 45-60 ms and 24 MB, roughly 5% of a hub route's 1.0 s, for requests that never touch a picture or a font. Paid by: The server once per new function instance: shoppers' first page after a deploy or idle spell, webhooks, owners' first admin page. Grows with instances, so with traffic and deploys.
- **Saving:** Estimate from the timings here: 45-60 ms and about 24 MB RSS per cold start on the roughly 740 routes that load them today. The storefront layout keeps its chain to sharp after the other dimensions' cuts, so this is needed whatever they do.
- **Risk:** Low. The first picture job in an instance pays the 31-38 ms instead of every instance. All 28 functions are already async, so no signature changes. A missed call site fails pnpm typecheck (sharp is then only a type). Picture output is unchanged; the integration tests compare real pixels.

## The fix

1. Create src/server/sharp-load.ts: import 'server-only'; import type sharp from 'sharp'; let loaded: Promise<typeof sharp> | undefined; export const loadSharp = (): Promise<typeof sharp> => (loaded ??= import('sharp').then((m) => m.default)); with a comment giving the reason (21 MB of native library most requests never need).
2. In each of the 12 modules replace the value import with types only (import type { Sharp, OverlayOptions } from 'sharp' where theme-shot-files.ts, ai-pictures.ts and theme-highlights.ts use them) and add const sharp = await loadSharp(); as the first line of each of the 28 functions that call sharp(...): theme-highlights.ts 7, replicate-images.ts 7, theme-shot-files.ts 3, replicate.ts 2, ai-pictures.ts 2, and one each in ai-vision.ts, content-packs.ts, page-looks.ts, picture-editor.ts, ai-picture-marks.ts, brand-marks.ts and product-import.ts. Calls inside callbacks of those functions (replicate-images.ts:58) use the same local.
3. src/server/font-outlines.ts:4: import type { Font } from 'opentype.js'; and inside fontOutlines(), before parse(data) at line 60: const { parse } = await import('opentype.js');
4. Leave seek-bzip (legal-sources.ts:6): it costs 2-3 ms and its one caller is synchronous.
5. Add a scan, src/server/lazy-packages.scan.test.ts: no non-test file under src has a static value import of sharp, opentype.js, playwright-core, @sparticuz/chromium, mammoth or unpdf; import type and import() are allowed; src/server/sharp-load.ts is the one home of import('sharp').
6. Run the unit and integration tests that use these modules, then build and re-time /api/shop/tiles with a cold-load script: sharp must not be in require.cache after the route's modules load.

**Done when:** src/server/lazy-packages.scan.test.ts passes (0 static value imports of sharp or opentype.js under src outside tests; today 13), and a fresh-process load of the built /api/shop/tiles route leaves sharp out of require.cache.

**Tests and rules that hold today's behaviour, and change with it:**

- Unit: src/server/theme-highlights.test.ts, ai-pictures.test.ts, theme-shot-files.test.ts, src/lib/review-pictures.test.ts, src/lib/webp-xmp.test.ts: must pass unchanged (none mocks sharp)
- Integration: src/server/picture-editor.int.test.ts, brand-marks.int.test.ts, ai-picture-marks.int.test.ts, replicate.int.test.ts, replicate-revert.int.test.ts, product-import.int.test.ts, theme-shots.int.test.ts, review-pictures.int.test.ts, admin-api.int.test.ts, money-review.int.test.ts
- e2e: e2e/theme-shots.spec.ts, e2e/page-look.spec.ts, e2e/replicate*.spec.ts
- next.config.ts outputFileTracingIncludes: untouched; the file trace still lists sharp for routes that can reach these modules, which is right (they may call it)
- New: src/server/lazy-packages.scan.test.ts; DP-6's graph test forbids sharp and opentype.js on the shopper entries

**Notes:** Counted by the planner: 28 functions, all async, so the skeptic's worry about synchronous helpers does not arise. Two font engines are installed (opentype.js for outlines, HarfBuzz inside subset-font for trimming); replacing one with the other is possible but not worth doing once opentype.js loads on demand.
