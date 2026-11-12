# SG-7 ✓ The sharp image library is loaded at cold start by routes that never touch a picture

The server code every route loads (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 0.4.
- **Second check:** corrected.
- **Where:** `src/server/theme-highlights.ts:3`, `src/server/theme-shot-files.ts:3`, `src/server/product-import.ts:6`, `src/server/brand-marks.ts:3`, `src/server/ai-pictures.ts:3`, `src/server/replicate-images.ts:3`, `src/server/seo.ts:48`, `src/components/page-article.tsx:35`
- **Evidence:** 12 server modules write import sharp from "sharp" at the top (counted again: ai-vision, content-packs, page-looks, picture-editor, ai-picture-marks, theme-highlights, product-import, replicate-images, replicate, ai-pictures, theme-shot-files, brand-marks); none loads it lazily. All are admin, AI or cron picture work. 181 handlers and 559 pages reach it, and its files (libvips 17.8 MiB, the addon and wrapper 1.0 MiB) are in each of those functions' traces; /api/health's trace has none. With the other cuts of this plan in the graph, 58 of 59 storefront pages still reach it through one chain, page-article.tsx -> theme-store-section.tsx -> theme-store.ts -> theme-shots.ts -> theme-highlights.ts (SG-17), and 428 admin pages through the store layout -> store-starters.ts -> theme-shots.ts.
- **Cost today:** 44 to 54 ms and 26 to 29 MB of RSS per cold instance (the skeptic's re-measurement: import('sharp') in a fresh process, 3 runs, warm disk); 18.9 MiB in the function package. Paid by: The server per cold instance of nearly every route; function package size at deploy.
- **Saving:** About 50 ms and about 28 MB of RSS per cold instance of every route that reaches it today. The package does not shrink from this: a module behind import() is still traced (unpdf's lazy chunks are in /api/visit's nft.json), so the 18.9 MiB leaves only the routes that lose every path to a picture module, such as the ten of SG-3.
- **Risk:** Low. The functions are already async. A function that forgets the await fails its test at once (sharp would be a promise).
- **Already tracked:** Not in the repo's plans. In this review the same change is deps DP-2 and assets AS-1.

## The fix

1. New file src/server/sharp-load.ts (the name deps DP-2 uses; assets AS-1 calls it sharp.ts: make one): import 'server-only'; import type sharp from 'sharp'; let loaded: Promise<typeof sharp> | undefined; export const loadSharp = () => (loaded ??= import('sharp').then((m) => m.default));
2. In each of the 12 modules replace the value import with types only (import type { Sharp, OverlayOptions } from 'sharp' where ai-pictures.ts, theme-shot-files.ts and theme-highlights.ts use them) and add const sharp = await loadSharp(); as the first line of each function that calls sharp(...) (theme-highlights.ts and replicate-images.ts hold most of the call sites). All are async already, so no signature changes.
3. eslint.config.mjs: a no-restricted-imports rule for src/**/*.{ts,tsx} naming sharp (type imports allowed, src/server/sharp-load.ts exempt), with a message that points to loadSharp(). This is the first rule of code review step 4.1.
4. Build; load .next/server/middleware.js and one storefront page entry in a fresh node process and check that require.cache holds no sharp module after the route's modules load.

**Done when:** pnpm lint fails on a new static value import of sharp outside src/server/sharp-load.ts (0 such imports under src outside tests; today 12), and a new next analyze export shows no [externals]/sharp among the sync modules of /s/[store]/[market] or the proxy.

**Tests and rules that hold today's behaviour, and change with it:**

- No test mocks sharp (rg). The integration tests of the 12 modules (theme-shots.int.test.ts, the replicator's, the picture editor's) run the real library and must pass.
- e2e/theme-shots.spec.ts covers the theme photographs.
- next.config.ts:47 keeps subset-font and fontverter external; sharp is external by Next's own list (node_modules/next/dist/lib/server-external-packages.jsonc:88): no config change.
- New: the lint rule above; the count of traces with sharp in the trace report of SG-14 (assets AS-3).

**Notes:** Needed whatever the cycle cuts do: admin pages keep their chain to sharp, and the storefront keeps one until SG-17.
