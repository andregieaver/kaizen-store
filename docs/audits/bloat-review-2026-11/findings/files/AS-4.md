# AS-4 ✓ Search suggestions ask Next's image service for uploaded pictures and get a 400, so real stores will show empty thumbnails; the service itself is open and unused

Files that ship or are stored (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** dead. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.23.
- **Second check:** confirmed.
- **Where:** `src/components/search-box.tsx:144`, `src/lib/picture-sizes.ts:6`, `src/server/media.ts:93`, `src/server/search.ts:376`, `src/server/catalog.ts:298`, `next.config.ts:41`, `.next/images-manifest.json`, `node_modules/next/dist/server/next-server.js:193`, `node_modules/next/dist/shared/lib/get-img-props.js:242`, `node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md:392`
- **Evidence:** Ten next/image tags; nine carry unoptimized, as picture-sizes.ts:6 says they must; the one in the search box does not (re-counted with rg). Stored pictures have absolute Supabase Storage addresses (media.ts:93); next.config.ts has no images key, and the build's manifest shows remotePatterns [] and unoptimized false. Measured on the built app in this pass: /_next/image?url=<a Supabase Storage picture address>&w=48&q=75 answers 400 with '"url" parameter is not allowed'. The same endpoint with /demo/themes/orbit/stars.webp and w=64 answers 200 with an image: the resizing service is live although no picture is meant to use it. Next leaves .svg sources alone (get-img-props.js:245) and the demo products' pictures are SVG files, so neither the e2e search test nor the team's demo stores show the fault. With images.unoptimized set, Next treats every Image as unoptimized (get-img-props.js:242) and answers /_next/image with 404 (next-server.js:193).
- **Cost today:** One failed request per suggested product with an uploaded picture, up to six each time the list is drawn (search.ts:376), and an empty thumbnail. On Vercel an open /_next/image is also a billed transformation per distinct file, width and quality; only the 150 files of public/ can be asked for, so that exposure is small. Paid by: A shopper's browser and Vercel's image endpoint, in every store whose products have uploaded photographs: every real store, from its first day.
- **Saving:** Working thumbnails in every store with uploaded photographs, up to six failed requests less per suggestion list, and one public resizing endpoint closed.
- **Risk:** None found: all ten tags are meant to be unoptimized and no code calls /_next/image (rg over src and e2e). A later feature that wants Next's resizing must change this line knowingly.

## The fix

1. next.config.ts: add images: { unoptimized: true } to nextConfig, beside poweredByHeader. Every Image is then served as stored, the search box included, and /_next/image answers 404.
2. src/components/search-box.tsx:144: add unoptimized to the tag, as the other nine have, so the tag is right whatever the config says.
3. A ten-line unit test beside src/lib/chromium-trace.test.ts that reads next.config.ts and expects the text images: { unoptimized: true }, with the reason in its comment (pictures are never resized on the server, D336).
4. e2e/search.spec.ts, in 'a shopper searches from the header': give the demo mug a picture row whose address ends in .webp (insert into commerce.product_media as e2e/performance.spec.ts:100 inserts a media row), type 'kera', and expect the option's img src not to start with /_next/image.
5. docs/performance.md, under the rules: 'Pictures are never resized on the server: images.unoptimized is on, so /_next/image does not exist.'

**Done when:** On the built app, curl -s -o /dev/null -w '%{http_code}' 'http://localhost:3000/_next/image?url=%2Fdemo%2Fthemes%2Forbit%2Fstars.webp&w=64&q=75' prints 404 (200 today), and the new assertion in e2e/search.spec.ts passes.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/picture-sizes.ts:6 states the rule already ('the pictures stay unoptimized').
- e2e/search.spec.ts:27 (suggestions) passes today only because the demo pictures are SVG.
- src/lib/store-address.test.ts:228 lists /_next/image among the paths the proxy leaves alone: unchanged.
- e2e/performance.spec.ts (picture budgets): unchanged.

**Notes:** A bug more than bloat: do it before opening. I changed the fix from 'a scan test that every tag carries the prop' to the one config line, which makes the mistake impossible and closes the unused endpoint as well.
