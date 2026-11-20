# The partial-prefetching trial (bloat review step 2.8)

Run on 20 November 2026 on local production builds of commit 6483fe597 (branch bloat-b, step 2.8's commits 1 and 2 on
origin/main 980e481ef), Next 16.4.6, on a local Postgres cloned from the template (the demo catalogue). Each build ran with
`pnpm build` (SKIP_BUILD_TYPECHECK=1) and was served by Playwright's `pnpm start` on port 3000. "Before" is the build with no
line added. Each "after" build added `export const prefetch = 'partial';` to one destination's page file, and the file was
restored with `git checkout` before the next build. The admin's two builds were the signed-in stand-in build
(`E2E_SIGNED_IN=1`, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3912`). No build printed a warning about the line, the `@drawer`
slot or the root layout's params.

## How each figure was read

A trial spec (not committed; it used the helpers `testStore()` and `fullCategory()` of e2e/db.ts) made a new store with the
48-product category `full`, opened each page once to warm the server, then for each destination ran six times, each in a new
phone context (390 by 844, touch):

- **at rest**: the linking page loaded and read to the end (3 s, a mouse wheel of 800 px every 300 ms until the page stops
  moving, 3 s more). A router request is one carrying `next-router-prefetch` or `next-router-segment-prefetch`, as in
  e2e/prefetch.spec.ts; bytes are the decoded bodies of those responses (Playwright's `response.body()`).
- **touched**: the link to the destination focused (PolicyLink asks on focus), then 2 s; the router requests started in those 2 s.
- **click to heading**: the link clicked; in the page, a capturing click listener noted `performance.now()` and polled each
  animation frame for the destination's `h1` with a box and the destination's path; the difference in ms. "price on screen" is
  whether the main element held "kr" at that frame. "fetches after the press" counts the requests with an `rsc` header and no
  prefetch header started in the press and the second after it (the navigation's own fetch).
- Runs 4 to 6 held each such navigation fetch for 1 s (Playwright's `page.route`): a heading drawn well under 1 s was drawn from
  what had been fetched ahead; one drawn after 1 s waited for the fetch.

The admin's orders page was read at 1280 by 800 as the owner of the stand-in's store: the admin home loaded and left 3 s (at
rest), the rail's Orders link pointed at (hover) and 2 s, then pressed; the heading is the `h1` "Orders" on the orders path.
"a list with order numbers on screen" is whether a visible table or list held a number of three or more digits at that frame.
Its three runs held no fetch. The listing's and the home's "after" builds ran before runs 4 to 6 were added to the spec, so they
have three runs each.

The seeded category read to the end on a phone with e2e/prefetch.spec.ts (`E2E_MEASURE=1`), on the "before" build:

```text
[router] full listing 15
/s/prefetch-full-mwofmb3u/cart
/s/prefetch-full-mwofmb3u/p/full-1
/s/prefetch-full-mwofmb3u/p/full-10
/s/prefetch-full-mwofmb3u/p/full-11
/s/prefetch-full-mwofmb3u/p/full-12
/s/prefetch-full-mwofmb3u/p/full-13
/s/prefetch-full-mwofmb3u/p/full-14
/s/prefetch-full-mwofmb3u/p/full-1
/s/prefetch-full-mwofmb3u/p/full-10
/s/prefetch-full-mwofmb3u/p/full-11
/s/prefetch-full-mwofmb3u/p/full-12
/s/prefetch-full-mwofmb3u/cart
/s/prefetch-full-mwofmb3u/cart
/s/prefetch-full-mwofmb3u/p/full-14
/s/prefetch-full-mwofmb3u/p/full-13
```

## The product page, linked from the seeded category

Before (no line):

```text
[trial before] product page (from the seeded category)
run 1: at rest 15 requests 70692 bytes; link /s/trial28-mwofmths/p/full-1 touched: 0 requests 0 bytes; click to heading 58 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/p/full-1; h1 then: Full 01 / Full kategori
  at rest: /s/trial28-mwofmths/cart 640 | /s/trial28-mwofmths/cart 1129 | /s/trial28-mwofmths/cart 4702 | /s/trial28-mwofmths/p/full-1 662 | /s/trial28-mwofmths/p/full-10 662 | /s/trial28-mwofmths/p/full-11 662 | /s/trial28-mwofmths/p/full-12 662 | /s/trial28-mwofmths/p/full-13 662 | /s/trial28-mwofmths/p/full-1 10039 | /s/trial28-mwofmths/p/full-10 10042 | /s/trial28-mwofmths/p/full-11 10042 | /s/trial28-mwofmths/p/full-12 10042 | /s/trial28-mwofmths/p/full-13 10042 | /s/trial28-mwofmths/p/full-14 662 | /s/trial28-mwofmths/p/full-14 10042
  touched:
run 2: at rest 15 requests 70692 bytes; link /s/trial28-mwofmths/p/full-1 touched: 0 requests 0 bytes; click to heading 36 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/p/full-1; h1 then: Full 01 / Full kategori
run 3: at rest 15 requests 70692 bytes; link /s/trial28-mwofmths/p/full-1 touched: 0 requests 0 bytes; click to heading 43 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/p/full-1; h1 then: Full 01 / Full kategori
run 4 (navigation fetches held 1 s): at rest 15 requests 70692 bytes; link /s/trial28-mwofmths/p/full-1 touched: 0 requests 0 bytes; click to heading 50 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/p/full-1; h1 then: Full 01 / Full kategori
run 5 (navigation fetches held 1 s): at rest 15 requests 70692 bytes; link /s/trial28-mwofmths/p/full-1 touched: 0 requests 0 bytes; click to heading 48 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/p/full-1; h1 then: Full 01 / Full kategori
run 6 (navigation fetches held 1 s): at rest 15 requests 70692 bytes; link /s/trial28-mwofmths/p/full-1 touched: 0 requests 0 bytes; click to heading 53 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/p/full-1; h1 then: Full 01 / Full kategori
```

```text
[trial before] product page, second tile (from the seeded category)
run 1: at rest 15 requests 70692 bytes; link /s/trial28-mwofmths/p/full-10 touched: 0 requests 0 bytes; click to heading 32 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/p/full-10; h1 then: Full 10 / Full kategori
  at rest: /s/trial28-mwofmths/cart 640 | /s/trial28-mwofmths/cart 1129 | /s/trial28-mwofmths/cart 4702 | /s/trial28-mwofmths/p/full-1 662 | /s/trial28-mwofmths/p/full-10 662 | /s/trial28-mwofmths/p/full-11 662 | /s/trial28-mwofmths/p/full-12 662 | /s/trial28-mwofmths/p/full-13 662 | /s/trial28-mwofmths/p/full-14 662 | /s/trial28-mwofmths/p/full-10 10042 | /s/trial28-mwofmths/p/full-1 10039 | /s/trial28-mwofmths/p/full-11 10042 | /s/trial28-mwofmths/p/full-12 10042 | /s/trial28-mwofmths/p/full-13 10042 | /s/trial28-mwofmths/p/full-14 10042
  touched:
run 2: at rest 15 requests 70692 bytes; link /s/trial28-mwofmths/p/full-10 touched: 0 requests 0 bytes; click to heading 46 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/p/full-10; h1 then: Full 10 / Full kategori
run 3: at rest 15 requests 70692 bytes; link /s/trial28-mwofmths/p/full-10 touched: 0 requests 0 bytes; click to heading 43 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/p/full-10; h1 then: Full 10 / Full kategori
run 4 (navigation fetches held 1 s): at rest 15 requests 70692 bytes; link /s/trial28-mwofmths/p/full-10 touched: 0 requests 0 bytes; click to heading 63 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/p/full-10; h1 then: Full 10 / Full kategori
run 5 (navigation fetches held 1 s): at rest 15 requests 70692 bytes; link /s/trial28-mwofmths/p/full-10 touched: 0 requests 0 bytes; click to heading 52 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/p/full-10; h1 then: Full 10 / Full kategori
run 6 (navigation fetches held 1 s): at rest 15 requests 70692 bytes; link /s/trial28-mwofmths/p/full-10 touched: 0 requests 0 bytes; click to heading 40 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/p/full-10; h1 then: Full 10 / Full kategori
```

After (`prefetch = 'partial'` on `src/app/s/[store]/[market]/(shop)/p/[handle]/page.tsx`):

```text
[trial product] product page (from the seeded category)
run 1: at rest 10 requests 20481 bytes; link /s/trial28-mwogaorc/p/full-1 touched: 0 requests 0 bytes; click to heading 40 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwogaorc/p/full-1; h1 then: Full 01 / Full kategori
  at rest: /s/trial28-mwogaorc/p/full-1 662 | /s/trial28-mwogaorc/cart 640 | /s/trial28-mwogaorc/p/full-10 662 | /s/trial28-mwogaorc/p/full-11 662 | /s/trial28-mwogaorc/p/full-12 662 | /s/trial28-mwogaorc/p/full-1 10038 | /s/trial28-mwogaorc/cart 1129 | /s/trial28-mwogaorc/cart 4702 | /s/trial28-mwogaorc/p/full-14 662 | /s/trial28-mwogaorc/p/full-13 662
  touched:
run 2: at rest 10 requests 20481 bytes; link /s/trial28-mwogaorc/p/full-1 touched: 0 requests 0 bytes; click to heading 38 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwogaorc/p/full-1; h1 then: Full 01 / Full kategori
run 3: at rest 10 requests 20481 bytes; link /s/trial28-mwogaorc/p/full-1 touched: 0 requests 0 bytes; click to heading 63 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwogaorc/p/full-1; h1 then: Full 01 / Full kategori
run 4 (navigation fetches held 1 s): at rest 10 requests 20481 bytes; link /s/trial28-mwogaorc/p/full-1 touched: 0 requests 0 bytes; click to heading 54 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwogaorc/p/full-1; h1 then: Full 01 / Full kategori
run 5 (navigation fetches held 1 s): at rest 10 requests 20481 bytes; link /s/trial28-mwogaorc/p/full-1 touched: 0 requests 0 bytes; click to heading 48 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwogaorc/p/full-1; h1 then: Full 01 / Full kategori
run 6 (navigation fetches held 1 s): at rest 10 requests 20481 bytes; link /s/trial28-mwogaorc/p/full-1 touched: 0 requests 0 bytes; click to heading 46 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwogaorc/p/full-1; h1 then: Full 01 / Full kategori
```

```text
[trial product] product page, second tile (from the seeded category)
run 1: at rest 10 requests 20481 bytes; link /s/trial28-mwogaorc/p/full-10 touched: 0 requests 0 bytes; click to heading 89 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwogaorc/p/full-10; h1 then: Full 10 / Full kategori
  at rest: /s/trial28-mwogaorc/cart 640 | /s/trial28-mwogaorc/cart 1129 | /s/trial28-mwogaorc/cart 4702 | /s/trial28-mwogaorc/p/full-1 662 | /s/trial28-mwogaorc/p/full-10 662 | /s/trial28-mwogaorc/p/full-11 662 | /s/trial28-mwogaorc/p/full-12 662 | /s/trial28-mwogaorc/p/full-13 662 | /s/trial28-mwogaorc/p/full-14 662 | /s/trial28-mwogaorc/p/full-1 10038
  touched:
run 2: at rest 10 requests 20481 bytes; link /s/trial28-mwogaorc/p/full-10 touched: 0 requests 0 bytes; click to heading 118 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwogaorc/p/full-10; h1 then: Full 10 / Full kategori
run 3: at rest 10 requests 20481 bytes; link /s/trial28-mwogaorc/p/full-10 touched: 0 requests 0 bytes; click to heading 134 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwogaorc/p/full-10; h1 then: Full 10 / Full kategori
run 4 (navigation fetches held 1 s): at rest 10 requests 20481 bytes; link /s/trial28-mwogaorc/p/full-10 touched: 0 requests 0 bytes; click to heading 1098 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwogaorc/p/full-10; h1 then: Full 10 / Full kategori
run 5 (navigation fetches held 1 s): at rest 10 requests 20484 bytes; link /s/trial28-mwogaorc/p/full-10 touched: 0 requests 0 bytes; click to heading 37 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwogaorc/p/full-10; h1 then: Full 10 / Full kategori
run 6 (navigation fetches held 1 s): at rest 10 requests 20481 bytes; link /s/trial28-mwogaorc/p/full-10 touched: 0 requests 0 bytes; click to heading 1114 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwogaorc/p/full-10; h1 then: Full 10 / Full kategori
```

## The category listing, linked from the store home

Before (no line):

```text
[trial before] category listing (from the store home)
run 1: at rest 3 requests 6471 bytes; link /s/trial28-mwofmths/category/hjem touched: 2 requests 8327 bytes; click to heading 50 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/category/hjem; h1 then: Hjem / Produkter
  at rest: /s/trial28-mwofmths/cart 640 | /s/trial28-mwofmths/cart 1129 | /s/trial28-mwofmths/cart 4702
  touched: /s/trial28-mwofmths/category/hjem 667 | /s/trial28-mwofmths/category/hjem 7660
run 2: at rest 3 requests 6471 bytes; link /s/trial28-mwofmths/category/hjem touched: 2 requests 8327 bytes; click to heading 48 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/category/hjem; h1 then: Hjem / Produkter
run 3: at rest 3 requests 6471 bytes; link /s/trial28-mwofmths/category/hjem touched: 2 requests 8327 bytes; click to heading 45 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/category/hjem; h1 then: Hjem / Produkter
run 4 (navigation fetches held 1 s): at rest 3 requests 6471 bytes; link /s/trial28-mwofmths/category/hjem touched: 2 requests 8327 bytes; click to heading 56 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/category/hjem; h1 then: Hjem / Produkter
run 5 (navigation fetches held 1 s): at rest 3 requests 6471 bytes; link /s/trial28-mwofmths/category/hjem touched: 2 requests 8327 bytes; click to heading 48 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/category/hjem; h1 then: Hjem / Produkter
run 6 (navigation fetches held 1 s): at rest 3 requests 6471 bytes; link /s/trial28-mwofmths/category/hjem touched: 2 requests 8327 bytes; click to heading 51 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/category/hjem; h1 then: Hjem / Produkter
```

After (`prefetch = 'partial'` on `src/app/s/[store]/[market]/(shop)/category/[slug]/page.tsx`):

```text
[trial listing] category listing (from the store home)
run 1: at rest 3 requests 6471 bytes; link /s/trial28-mwoepx45/category/hjem touched: 2 requests 8326 bytes; click to heading 38 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwoepx45/category/hjem; h1 then: Hjem / Produkter
  at rest: /s/trial28-mwoepx45/cart 640 | /s/trial28-mwoepx45/cart 1129 | /s/trial28-mwoepx45/cart 4702
  touched: /s/trial28-mwoepx45/category/hjem 667 | /s/trial28-mwoepx45/category/hjem 7659
run 2: at rest 3 requests 6471 bytes; link /s/trial28-mwoepx45/category/hjem touched: 2 requests 8326 bytes; click to heading 48 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwoepx45/category/hjem; h1 then: Hjem / Produkter
run 3: at rest 3 requests 6471 bytes; link /s/trial28-mwoepx45/category/hjem touched: 2 requests 8326 bytes; click to heading 48 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwoepx45/category/hjem; h1 then: Hjem / Produkter
```

## The store home, linked from a product page (its logo)

Before (no line):

```text
[trial before] category listing (from the store home)
run 1: at rest 3 requests 6471 bytes; link /s/trial28-mwofmths/category/hjem touched: 2 requests 8327 bytes; click to heading 50 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/category/hjem; h1 then: Hjem / Produkter
  at rest: /s/trial28-mwofmths/cart 640 | /s/trial28-mwofmths/cart 1129 | /s/trial28-mwofmths/cart 4702
  touched: /s/trial28-mwofmths/category/hjem 667 | /s/trial28-mwofmths/category/hjem 7660
run 2: at rest 3 requests 6471 bytes; link /s/trial28-mwofmths/category/hjem touched: 2 requests 8327 bytes; click to heading 48 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/category/hjem; h1 then: Hjem / Produkter
run 3: at rest 3 requests 6471 bytes; link /s/trial28-mwofmths/category/hjem touched: 2 requests 8327 bytes; click to heading 45 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/category/hjem; h1 then: Hjem / Produkter
run 4 (navigation fetches held 1 s): at rest 3 requests 6471 bytes; link /s/trial28-mwofmths/category/hjem touched: 2 requests 8327 bytes; click to heading 56 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/category/hjem; h1 then: Hjem / Produkter
run 5 (navigation fetches held 1 s): at rest 3 requests 6471 bytes; link /s/trial28-mwofmths/category/hjem touched: 2 requests 8327 bytes; click to heading 48 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/category/hjem; h1 then: Hjem / Produkter
run 6 (navigation fetches held 1 s): at rest 3 requests 6471 bytes; link /s/trial28-mwofmths/category/hjem touched: 2 requests 8327 bytes; click to heading 51 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwofmths/category/hjem; h1 then: Hjem / Produkter
[trial before] store home (from a product page)
run 1: at rest 5 requests 83865 bytes; link /s/trial28-mwofmths touched: 2 requests 81893 bytes; click to heading 86 ms (price on screen: true); fetches after the press: 0 ; h1 then: Produkter / Full 02
  at rest: /s/trial28-mwofmths/cart 640 | /s/trial28-mwofmths/cart 1129 | /s/trial28-mwofmths/cart 4702 | /s/trial28-mwofmths/products 585 | /s/trial28-mwofmths/products 76809
  touched: /s/trial28-mwofmths 531 | /s/trial28-mwofmths 81362
run 2: at rest 5 requests 83865 bytes; link /s/trial28-mwofmths touched: 2 requests 81893 bytes; click to heading 71 ms (price on screen: true); fetches after the press: 0 ; h1 then: Produkter / Full 02
run 3: at rest 5 requests 83865 bytes; link /s/trial28-mwofmths touched: 2 requests 81893 bytes; click to heading 65 ms (price on screen: true); fetches after the press: 0 ; h1 then: Produkter / Full 02
run 4 (navigation fetches held 1 s): at rest 5 requests 83865 bytes; link /s/trial28-mwofmths touched: 2 requests 81893 bytes; click to heading 78 ms (price on screen: true); fetches after the press: 0 ; h1 then: Produkter / Full 02
run 5 (navigation fetches held 1 s): at rest 5 requests 83865 bytes; link /s/trial28-mwofmths touched: 2 requests 81893 bytes; click to heading 87 ms (price on screen: true); fetches after the press: 0 ; h1 then: Produkter / Full 02
run 6 (navigation fetches held 1 s): at rest 5 requests 83865 bytes; link /s/trial28-mwofmths touched: 2 requests 81893 bytes; click to heading 71 ms (price on screen: true); fetches after the press: 0 ; h1 then: Produkter / Full 02
```

After (`prefetch = 'partial'` on `src/app/s/[store]/[market]/(shop)/page.tsx`):

```text
[trial home] category listing (from the store home)
run 1: at rest 3 requests 6471 bytes; link /s/trial28-mwof75wc/category/hjem touched: 2 requests 8327 bytes; click to heading 42 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwof75wc/category/hjem; h1 then: Hjem / Produkter
  at rest: /s/trial28-mwof75wc/cart 640 | /s/trial28-mwof75wc/cart 1129 | /s/trial28-mwof75wc/cart 4702
  touched: /s/trial28-mwof75wc/category/hjem 667 | /s/trial28-mwof75wc/category/hjem 7660
run 2: at rest 3 requests 6471 bytes; link /s/trial28-mwof75wc/category/hjem touched: 2 requests 8327 bytes; click to heading 57 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwof75wc/category/hjem; h1 then: Hjem / Produkter
run 3: at rest 3 requests 6471 bytes; link /s/trial28-mwof75wc/category/hjem touched: 2 requests 8327 bytes; click to heading 38 ms (price on screen: true); fetches after the press: 1 /s/trial28-mwof75wc/category/hjem; h1 then: Hjem / Produkter
[trial home] store home (from a product page)
run 1: at rest 5 requests 83865 bytes; link /s/trial28-mwof75wc touched: 2 requests 81893 bytes; click to heading 71 ms (price on screen: true); fetches after the press: 0 ; h1 then: Produkter / Full 02
  at rest: /s/trial28-mwof75wc/cart 640 | /s/trial28-mwof75wc/products 585 | /s/trial28-mwof75wc/cart 1129 | /s/trial28-mwof75wc/cart 4702 | /s/trial28-mwof75wc/products 76809
  touched: /s/trial28-mwof75wc 531 | /s/trial28-mwof75wc 81362
run 2: at rest 5 requests 83865 bytes; link /s/trial28-mwof75wc touched: 2 requests 81893 bytes; click to heading 70 ms (price on screen: true); fetches after the press: 0 ; h1 then: Produkter / Full 02
run 3: at rest 5 requests 83865 bytes; link /s/trial28-mwof75wc touched: 2 requests 81893 bytes; click to heading 141 ms (price on screen: true); fetches after the press: 0 ; h1 then: Produkter / Full 02
```

## The admin's orders page, linked from the admin home (the rail)

Before (no line):

```text
[trial admin-before] admin orders (from the admin home)
run 1: at rest 0 requests 0 bytes; link /admin/e2e-shop/orders pointed at: 2 requests 9165 bytes; click to heading 350 ms (a list with order numbers on screen: false)
  at rest:
  pointed at: /admin/e2e-shop/orders 462 | /admin/e2e-shop/orders 8703
run 2: at rest 0 requests 0 bytes; link /admin/e2e-shop/orders pointed at: 2 requests 9165 bytes; click to heading 332 ms (a list with order numbers on screen: false)
run 3: at rest 0 requests 0 bytes; link /admin/e2e-shop/orders pointed at: 2 requests 9165 bytes; click to heading 332 ms (a list with order numbers on screen: false)
```

After (`prefetch = 'partial'` on `src/app/admin/(gated)/[store]/orders/page.tsx`):

```text
[trial admin-orders] admin orders (from the admin home)
run 1: at rest 0 requests 0 bytes; link /admin/e2e-shop/orders pointed at: 2 requests 9164 bytes; click to heading 333 ms (a list with order numbers on screen: false)
  at rest:
  pointed at: /admin/e2e-shop/orders 462 | /admin/e2e-shop/orders 8702
run 2: at rest 0 requests 0 bytes; link /admin/e2e-shop/orders pointed at: 2 requests 9164 bytes; click to heading 346 ms (a list with order numbers on screen: false)
run 3: at rest 0 requests 0 bytes; link /admin/e2e-shop/orders pointed at: 2 requests 9164 bytes; click to heading 329 ms (a list with order numbers on screen: false)
```
