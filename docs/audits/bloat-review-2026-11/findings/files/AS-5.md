# AS-5 ✓ Flags are downloaded even while the switcher hides them, public files have no cache lifetime, and six flags and two textures are far bigger than their job

Files that ship or are stored (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P2. **Effort:** S. **Confidence:** medium. **Step:** 0.32.
- **Second check:** corrected.
- **Where:** `src/components/language-links.tsx:72`, `src/lib/part-css.ts:706`, `src/lib/language-switch.test.ts:14`, `src/lib/language-switch.test.ts:83`, `src/lib/language-flags.ts:29`, `next.config.ts:106`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/public-folder.md`, `node_modules/next/dist/compiled/send/index.js`, `public/flags/es.svg`, `public/flags/hr.svg`, `src/lib/signature/botanica.ts:549`, `src/lib/signature/botanica.ts:565`, `src/lib/signature/atelier.ts:615`, `scripts/theme-art.mjs:1`, `docs/audits/bloat-review-2026-11/scripts/sources/as-plan/lazy-test.cjs.txt`
- **Evidence:** 1. The switcher draws an <img> per language's flag in its list and its menu (language-links.tsx:72) with no loading attribute; flags are off by default (language-switch.test.ts:14) and hidden with display:none (part-css.ts:706). Measured in headless Chromium 153: an image hidden with display:none, on itself or a parent, or inside a closed <details>, is fetched at page load; with loading=lazy it is not, and it is fetched when the <details> opens. 2. The built app answers /flags/no.svg and /demo/themes/botanica/paper.webp with 'Cache-Control: public, max-age=0' (curl -I), as Next's guide says; next.config.ts adds no cache rule. 3. Six flags are 165 of the folder's 176 KB (es 88.9 KB, hr 40.4 KB; 39.8 KB together as brotli); they are drawn at 20 by 15 pixels. As 60 by 45 pixel WebP files they are 0.3 to 0.8 KB each, 3.0 KB together (made in memory with sharp). 4. Four signature themes' stylesheets load six files from public/: Botanica's 512 px paper tile is 114 KB and its 900 px sprig, drawn at 260 CSS pixels, 65 KB; Atelier's paper 67 KB. Re-encoded in memory: Botanica's paper 34 KB at 256 px, its sprig 26 KB at 520 px, Atelier's paper 18 KB at 256 px; a lower quality at the same size saves little (114 to 98 KB) because paper grain does not compress.
- **Cost today:** Per full page load (first view, reload, new tab; not an in-site navigation): one request per language's flag, shown or not, and one conditional request per public file already held. Up to 13 KB per heavy flag on a first view, and 179 KB of decoration on a first view of a Botanica store. Paid by: A shopper's browser, in every store with more than one language and every store on a signature theme. It grows with shoppers.
- **Saving:** Step 1: one request per language per full page load in a store that does not show flags (most are 0.2 KB; Spanish and Croatian 13 KB each). Step 2: estimate of two to six conditional requests less per repeat load within a day. Step 3: 13 KB per Spanish or Croatian flag on a first view. Step 4: estimate of 119 KB on Botanica's first view and 49 KB on Atelier's, if the smaller tiles pass the owner's eye.
- **Risk:** Step 2: a file changed under the same name stays up to a day in browsers; theme art takes a new name when it changes. Step 3: nothing visible at 20 by 15 pixels. Step 4 changes how a theme looks: a half-size paper tile has coarser grain, so it needs the owner's eye.

## The fix

1. src/components/language-links.tsx:72: add loading="lazy" to the flag <img>. A hidden flag is then never fetched; one in a closed menu is fetched when the menu opens.
2. next.config.ts headers(): add { source: "/:folder(flags|demo|kaizen)/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] }. Next's own server sets its default only when no Cache-Control is set yet (next/dist/compiled/send/index.js checks getHeader first), and Vercel applies configured headers to static files. Keep the rule as a small exported constant in src/lib/csp.ts beside baseRouteHeaders() so a unit test can hold it.
3. Flags: make public/flags/{es,hr,mt,li,pt,cy}.webp at 60 by 45 pixels from the SVGs (a one-off with sharp), delete those six SVGs, and let flagOf() in src/lib/language-flags.ts answer .webp for those six countries. Show the owner the switcher before and after at 1x and 3x.
4. Theme backgrounds: in scripts/theme-art/botanica.js draw sprig at 520 px, and try paper at 256 px there and in scripts/theme-art/atelier.js; run node scripts/theme-art.mjs botanica paper sprig (and atelier paper); show the owner each home page before and after and keep only what looks the same.

**Done when:** On a store page with the Languages part and flags off, the browser's request log has no request under /flags/ (one per language today); curl -sI /flags/no.svg shows max-age=86400; du -cb public/flags/* is under 20 KB (176 KB today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/language-switch.test.ts:83-86 (a file for every flag it names): read both extensions.
- src/lib/language-switch.test.ts:72-77 (flagOf's answers): none of the six heavy flags is asserted today.
- e2e/language-switcher.spec.ts:93 (a shown flag is visible): a lazy image keeps its box, so it passes.
- src/lib/csp.test.ts if the header rule lives in csp.ts; one e2e request for /flags/no.svg expecting max-age=86400.
- public/flags/LICENSE.txt stays (MIT; derived files are allowed).
- docs/signature-themes.md: art is drawn from recipes in scripts/theme-art, so the recipe changes, not the file by hand.

**Notes:** Steps 1 and 2 are one line each; do them with the next change to the switcher or to next.config.ts. I changed step 3 from simplified drawings to small raster copies: same look, no flag loses its arms.
