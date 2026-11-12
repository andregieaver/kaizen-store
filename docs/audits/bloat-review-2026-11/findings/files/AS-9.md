# AS-9 ✓ The font file route does not tell the CDN to keep the file, unlike the stylesheet route beside it

Files that ship or are stored (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** medium. **Step:** 0.32.
- **Second check:** confirmed.
- **Where:** `src/app/api/fonts/files/[file]/route.ts:16`, `src/app/api/fonts/css/[slug]/route.ts:40`, `src/server/fonts.ts:185`, `e2e/fonts.spec.ts:85`, `docs/performance.md:61`, `https://vercel.com/docs/caching/cdn-cache (Using Vercel Functions), read 12 November 2026`
- **Evidence:** The file route answers with 'public, max-age=31536000, immutable' and no s-maxage (route.ts:16); the stylesheet route sends s-maxage=31536000 as well (css route.ts:40). fontFile() has no cache of its own: each call reads the bytea row (fonts.ts:185-189). The second check could not say whether Vercel keeps a function's answer on max-age alone. Vercel's CDN guide answers it: 'To cache the response of Functions on Vercel's CDN, you must include Cache-Control headers with any of the following directives: s-maxage=N ...'. So as written, each browser that does not hold the file reaches the function and Postgres. Not observed in production (no production access in this review).
- **Cost today:** One function call and one read of about 35 KB of bytea (5.7 MB in 163 files) per font file for every visitor whose browser does not hold it yet: one to a few files per store per new visitor. Not counted in production's statistics, which show no shoppers yet. Paid by: The server per request and the database, growing with new visitors once the platform opens. A returning browser keeps the file for a year either way.
- **Saving:** After the first request per region and deploy, font file requests stop at the CDN: no function call and no database read. The count depends on visitors and is not measurable before opening.
- **Risk:** None: the file is named by a hash of its content. Vercel empties its cache of function answers at each deploy, so the first request after a deploy still reaches the function.

## The fix

1. src/app/api/fonts/files/[file]/route.ts:16: 'public, max-age=31536000, s-maxage=31536000, immutable'.
2. e2e/fonts.spec.ts:85: also expect the file's cache-control to contain s-maxage=31536000 (the local server sends the header whole; Vercel takes s-maxage out before the browser sees it).
3. docs/performance.md:61: 'Font stylesheets and font files are kept for a year, at the CDN too.'
4. After the deploy: ask production for one font file twice with curl -sI and read x-vercel-cache: MISS, then HIT.

**Done when:** The second curl -sI of one /api/fonts/files/{name}.woff2 on a production host answers x-vercel-cache: HIT.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/fonts.spec.ts:83-85 (content type and immutable) stays true.
- src/server/fonts.int.test.ts:73-74 (fontFile) is not touched.
- The route's own comment (route.ts:6-7): a variable family's file may later be cut to its weights and draws the same, so a kept whole file is not wrong.

**Notes:** Confidence raised from low to medium on Vercel's own documentation. One line; cheaper to make than to investigate further.
