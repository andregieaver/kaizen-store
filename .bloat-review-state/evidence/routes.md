# What real pages send to a browser (production build, measured 11 Nov 2026)

Measured by `work/measure-routes.mjs` with Chromium against `pnpm start` on this machine: the build CI's `signed-in` job makes
(commit 0bd814c), the seeded demo catalogue, a warm server and a cold browser (empty cache) for each page. Storefront and site pages
on a phone-sized screen (390 px), the admin on 1440 px, signed in as the test owner of a store copied from the template (10 products).
"Transferred" is bytes on the wire with the server's gzip (Vercel sends Brotli, a little smaller). "Unused" is the share of the
script or style bytes loaded that had not run or matched anything when the page was idle (network quiet, plus three seconds), by
Chromium's own coverage: a visitor who presses nothing. Times on this machine say nothing about production and are left out.
Raw data: `routes.json` (every response, every script with its used bytes, the after-load requests) and `html/<name>.html`.

CAUTION for store-category and store-search: on this local build (stores at /s/{store}/... addresses) the client router asked for
one link's segment prefetch about 160 times a second without stopping (see `prefetch-storm.md`); their request counts and "rsc"
bytes are that loop, not the page. Production (stores on their own hosts) did not do it when checked.

## Bytes by page

| Page | Address | Document raw / gzip | of which RSC payload | Scripts transferred (files) | Scripts raw | unused | Styles raw | unused | Fonts | Requests | All transferred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| store-home | `/s/demo/no` | 135 / 18 KB | 94 KB (70%) | 273 KB (22) | 834 KB | 57% | 183 KB | 31% | 0 KB (0) | 48 | 397 KB |
| store-product | `/s/demo/no/p/demo-keramikkopp` | 137 / 20 KB | 90 KB (66%) | 295 KB (24) | 883 KB | 57% | 183 KB | 21% | 0 KB (0) | 43 | 413 KB |
| store-product-booking | `/s/demo/no/p/demo-hytte` | 134 / 20 KB | 89 KB (67%) | 295 KB (24) | 882 KB | 59% | 183 KB | 21% | 0 KB (0) | 44 | 415 KB |
| store-category | `/s/demo/no/category/belysning` | 115 / 16 KB | 79 KB (68%) | 324 KB (27) | 943 KB | 65% | 182 KB | 31% | 0 KB (0) | 10358 | 479 KB |
| store-products | `/s/demo/no/products` | 166 / 21 KB | 112 KB (68%) | 273 KB (22) | 851 KB | 54% | 183 KB | 31% | 0 KB (0) | 49 | 408 KB |
| store-page | `/s/demo/no/om-oss` | 108 / 15 KB | 77 KB (71%) | 324 KB (27) | 941 KB | 66% | 183 KB | 31% | 0 KB (0) | 70 | 538 KB |
| store-search | `/s/demo/no/search?q=lampe` | 114 / 16 KB | 77 KB (68%) | 327 KB (28) | 945 KB | 62% | 182 KB | 21% | 0 KB (0) | 10950 | 475 KB |
| store-blog-post | `/s/demo/no/blog/nye-produkter` | 112 / 16 KB | 79 KB (70%) | 268 KB (21) | 808 KB | 60% | 183 KB | 21% | 0 KB (0) | 38 | 372 KB |
| store-cart-empty | `/s/demo/no/cart` | 104 / 13 KB | 74 KB (71%) | 324 KB (27) | 938 KB | 67% | 182 KB | 32% | 0 KB (0) | 78 | 577 KB |
| store-checkout-empty | `/s/demo/no/checkout` | 104 / 14 KB | 74 KB (71%) | 324 KB (47) | 1098 KB | 70% | 365 KB | 66% | 0 KB (0) | 107 | 599 KB |
| store-account | `/s/demo/no/account` | 107 / 15 KB | 75 KB (70%) | 324 KB (27) | 940 KB | 66% | 182 KB | 21% | 0 KB (0) | 60 | 495 KB |
| store-wishlist | `/s/demo/no/wishlist` | 107 / 14 KB | 75 KB (71%) | 329 KB (28) | 951 KB | 65% | 182 KB | 32% | 0 KB (0) | 61 | 500 KB |
| site-home | `/` | 39 / 8 KB | 23 KB (60%) | 400 KB (27) | 1173 KB | 77% | 182 KB | 21% | 0 KB (0) | 40 | 488 KB |
| site-blog-post | `/blog/welcome` | 45 / 9 KB | 28 KB (63%) | 377 KB (24) | 1132 KB | 75% | 183 KB | 21% | 0 KB (0) | 34 | 456 KB |
| site-docs | `/docs` | 46 / 9 KB | 32 KB (69%) | 165 KB (10) | 517 KB | 60% | 182 KB | 32% | 0 KB (0) | 13 | 220 KB |
| site-themes | `/themes` | 70 / 11 KB | 41 KB (60%) | 377 KB (24) | 1146 KB | 75% | 182 KB | 21% | 0 KB (0) | 34 | 459 KB |
| admin-sign-in | `/admin/sign-in` | 34 / 10 KB | 27 KB (78%) | 267 KB (20) | 753 KB | 68% | 199 KB | 36% | 0 KB (0) | 31 | 354 KB |
| admin-stores | `/admin` | 80 / 18 KB | 52 KB (64%) | 467 KB (33) | 1376 KB | 65% | 199 KB | 36% | 0 KB (0) | 62 | 622 KB |
| admin-home | `/admin/e2e-shop` | 162 / 37 KB | 116 KB (72%) | 494 KB (35) | 1512 KB | 62% | 199 KB | 36% | 0 KB (0) | 70 | 690 KB |
| admin-orders | `/admin/e2e-shop/orders` | 160 / 32 KB | 104 KB (65%) | 504 KB (38) | 1510 KB | 63% | 199 KB | 36% | 0 KB (0) | 77 | 709 KB |
| admin-products | `/admin/e2e-shop/products` | 162 / 38 KB | 113 KB (70%) | 500 KB (37) | 1518 KB | 63% | 199 KB | 36% | 0 KB (0) | 92 | 753 KB |
| admin-product-editor | `/admin/e2e-shop/products/{id}` | 416 / 106 KB | 319 KB (77%) | 799 KB (48) | 2627 KB | 61% | 199 KB | 35% | 0 KB (0) | 81 | 1055 KB |
| admin-customers | `/admin/e2e-shop/customers` | 124 / 28 KB | 81 KB (65%) | 496 KB (37) | 1465 KB | 65% | 199 KB | 36% | 0 KB (0) | 74 | 687 KB |
| admin-pages | `/admin/e2e-shop/pages` | 273 / 53 KB | 174 KB (64%) | 762 KB (46) | 2358 KB | 69% | 199 KB | 36% | 0 KB (0) | 99 | 1038 KB |
| admin-page-builder | `/admin/e2e-shop/pages/{id}` | 572 / 133 KB | 392 KB (69%) | 1145 KB (56) | 3761 KB | 57% | 212 KB | 38% | 0 KB (0) | 97 | 1444 KB |
| admin-media | `/admin/e2e-shop/media` | 173 / 42 KB | 131 KB (76%) | 498 KB (37) | 1527 KB | 63% | 199 KB | 36% | 0 KB (0) | 68 | 685 KB |
| admin-analytics | `/admin/e2e-shop/analytics` | 239 / 48 KB | 165 KB (69%) | 484 KB (35) | 1531 KB | 60% | 199 KB | 35% | 0 KB (0) | 74 | 711 KB |
| admin-discounts | `/admin/e2e-shop/discounts` | 143 / 33 KB | 98 KB (69%) | 479 KB (35) | 1447 KB | 63% | 199 KB | 36% | 0 KB (0) | 70 | 670 KB |
| admin-settings | `/admin/e2e-shop/settings` | 159 / 32 KB | 87 KB (55%) | 477 KB (35) | 1430 KB | 64% | 199 KB | 36% | 0 KB (0) | 86 | 719 KB |
| admin-settings-features | `/admin/e2e-shop/settings/features` | 227 / 51 KB | 148 KB (65%) | 481 KB (35) | 1504 KB | 61% | 199 KB | 36% | 0 KB (0) | 86 | 742 KB |
| admin-platform-home | `/admin/platform` | 119 / 26 KB | 77 KB (65%) | 383 KB (25) | 1198 KB | 58% | 199 KB | 36% | 0 KB (0) | 55 | 545 KB |
| admin-platform-stores | `/admin/platform/stores` | 109 / 25 KB | 73 KB (67%) | 380 KB (24) | 1192 KB | 58% | 199 KB | 36% | 0 KB (0) | 54 | 541 KB |

## What each document is made of (raw bytes)

| Page | Document | Markup | RSC payload (inline script) | Other inline script | JSON-LD | Style blocks | Style attributes | Elements | Hidden markup (display:none) | class attributes | data- attributes | Inline SVG (count) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| store-home | 135 KB | 33 KB | 94 KB | 1 KB | 2 KB | 4 KB | 0 KB | 383 | 10 KB | 12 KB | 1 KB | 3 KB (14) |
| store-product | 137 KB | 38 KB | 90 KB | 2 KB | 3 KB | 4 KB | 0 KB | 442 | 16 KB | 14 KB | 1 KB | 5 KB (21) |
| store-product-booking | 134 KB | 38 KB | 89 KB | 2 KB | 1 KB | 4 KB | 0 KB | 404 | 11 KB | 15 KB | 1 KB | 3 KB (15) |
| store-category | 115 KB | 31 KB | 79 KB | 1 KB | 0 KB | 3 KB | 0 KB | 356 | 13 KB | 11 KB | 0 KB | 4 KB (17) |
| store-products | 166 KB | 48 KB | 112 KB | 1 KB | 0 KB | 4 KB | 0 KB | 477 | 19 KB | 17 KB | 1 KB | 4 KB (16) |
| store-page | 108 KB | 25 KB | 77 KB | 1 KB | 0 KB | 4 KB | 0 KB | 304 | 10 KB | 9 KB | 1 KB | 3 KB (14) |
| store-search | 114 KB | 32 KB | 77 KB | 1 KB | 0 KB | 3 KB | 0 KB | 373 | 14 KB | 12 KB | 0 KB | 4 KB (18) |
| store-blog-post | 112 KB | 27 KB | 79 KB | 1 KB | 1 KB | 4 KB | 0 KB | 324 | 10 KB | 10 KB | 1 KB | 3 KB (14) |
| store-cart-empty | 104 KB | 25 KB | 74 KB | 1 KB | 0 KB | 3 KB | 0 KB | 304 | 10 KB | 9 KB | 0 KB | 3 KB (14) |
| store-checkout-empty | 104 KB | 25 KB | 74 KB | 1 KB | 0 KB | 3 KB | 0 KB | 304 | 10 KB | 9 KB | 0 KB | 3 KB (14) |
| store-account | 107 KB | 27 KB | 75 KB | 1 KB | 0 KB | 3 KB | 0 KB | 322 | 11 KB | 10 KB | 0 KB | 3 KB (14) |
| store-wishlist | 107 KB | 26 KB | 75 KB | 1 KB | 0 KB | 3 KB | 0 KB | 312 | 10 KB | 9 KB | 0 KB | 3 KB (14) |
| site-home | 39 KB | 11 KB | 23 KB | 1 KB | 1 KB | 3 KB | 0 KB | 181 | 3 KB | 4 KB | 0 KB | 2 KB (8) |
| site-blog-post | 45 KB | 11 KB | 28 KB | 1 KB | 1 KB | 4 KB | 0 KB | 194 | 3 KB | 4 KB | 0 KB | 2 KB (8) |
| site-docs | 46 KB | 10 KB | 32 KB | 0 KB | 0 KB | 3 KB | 0 KB | 161 | 1 KB | 4 KB | 0 KB | 0 KB (0) |
| site-themes | 70 KB | 23 KB | 41 KB | 1 KB | 0 KB | 3 KB | 0 KB | 225 | 3 KB | 7 KB | 0 KB | 2 KB (11) |
| admin-sign-in | 34 KB | 6 KB | 27 KB | 2 KB | 0 KB | 0 KB | 0 KB | 77 | 0 KB | 1 KB | 0 KB | 0 KB (0) |
| admin-stores | 80 KB | 26 KB | 52 KB | 2 KB | 0 KB | 0 KB | 0 KB | 275 | 8 KB | 13 KB | 0 KB | 4 KB (16) |
| admin-home | 162 KB | 44 KB | 116 KB | 2 KB | 0 KB | 0 KB | 0 KB | 424 | 15 KB | 19 KB | 0 KB | 10 KB (31) |
| admin-orders | 160 KB | 54 KB | 104 KB | 2 KB | 0 KB | 0 KB | 0 KB | 540 | 17 KB | 23 KB | 0 KB | 12 KB (36) |
| admin-products | 162 KB | 47 KB | 113 KB | 2 KB | 0 KB | 0 KB | 0 KB | 481 | 16 KB | 21 KB | 0 KB | 11 KB (34) |
| admin-product-editor | 416 KB | 95 KB | 319 KB | 2 KB | 0 KB | 0 KB | 0 KB | 1321 | 16 KB | 30 KB | 0 KB | 11 KB (34) |
| admin-customers | 124 KB | 41 KB | 81 KB | 2 KB | 0 KB | 0 KB | 0 KB | 366 | 17 KB | 19 KB | 0 KB | 12 KB (36) |
| admin-pages | 273 KB | 96 KB | 174 KB | 3 KB | 0 KB | 0 KB | 0 KB | 902 | 33 KB | 35 KB | 0 KB | 16 KB (44) |
| admin-page-builder | 572 KB | 172 KB | 392 KB | 2 KB | 0 KB | 4 KB | 1 KB | 1783 | 51 KB | 73 KB | 3 KB | 38 KB (120) |
| admin-media | 173 KB | 40 KB | 131 KB | 2 KB | 0 KB | 0 KB | 0 KB | 378 | 17 KB | 17 KB | 0 KB | 12 KB (35) |
| admin-analytics | 239 KB | 71 KB | 165 KB | 3 KB | 0 KB | 0 KB | 0 KB | 689 | 17 KB | 28 KB | 0 KB | 15 KB (41) |
| admin-discounts | 143 KB | 43 KB | 98 KB | 2 KB | 0 KB | 0 KB | 0 KB | 385 | 18 KB | 19 KB | 0 KB | 13 KB (38) |
| admin-settings | 159 KB | 69 KB | 87 KB | 2 KB | 0 KB | 0 KB | 0 KB | 659 | 26 KB | 29 KB | 0 KB | 26 KB (65) |
| admin-settings-features | 227 KB | 76 KB | 148 KB | 2 KB | 0 KB | 0 KB | 0 KB | 746 | 26 KB | 32 KB | 0 KB | 21 KB (54) |
| admin-platform-home | 119 KB | 40 KB | 77 KB | 2 KB | 0 KB | 0 KB | 0 KB | 356 | 14 KB | 18 KB | 0 KB | 8 KB (25) |
| admin-platform-stores | 109 KB | 34 KB | 73 KB | 2 KB | 0 KB | 0 KB | 0 KB | 306 | 13 KB | 17 KB | 0 KB | 8 KB (25) |

## What each page asks for after it has loaded (a visitor who does nothing)

Counted from the load event until the page was idle. "rsc" is the router prefetching a link's page (one request per segment of the
target route); "fetch" is the page's own calls.

| Page | Prefetches (rsc) | bytes | Fetches | Beacons | Other after load | Addresses fetched (not rsc) |
|---|---|---|---|---|---|---|
| store-home | 11 | 32 KB | 2 | 0 | 4 (other, script) | GET /s/demo/no/wishlist/saved; GET /api/shop/tiles |
| store-product | 12 | 41 KB | 1 | 0 | 4 (other, script) | GET /s/demo/no/wishlist/saved |
| store-product-booking | 14 | 46 KB | 1 | 0 | 4 (other, script) | GET /s/demo/no/wishlist/saved |
| store-category | 5176 | 86 KB | 1 | 0 | 5157 (other, script) | GET /s/demo/no/wishlist/saved |
| store-products | 12 | 38 KB | 2 | 0 | 4 (other, script) | GET /s/demo/no/wishlist/saved; GET /api/shop/tiles |
| store-page | 34 | 140 KB | 1 | 0 | 15 (other, script, picture) | GET /s/demo/no/wishlist/saved |
| store-search | 5470 | 75 KB | 2 | 0 | 5454 (other, script, picture) | GET /s/demo/no/wishlist/saved; POST /s/demo/no/search |
| store-blog-post | 12 | 38 KB | 1 | 0 | 5 (other, script) | GET /s/demo/no/wishlist/saved |
| store-cart-empty | 42 | 180 KB | 1 | 0 | 12 (other, script, picture) | GET /s/demo/no/wishlist/saved |
| store-checkout-empty | 50 | 189 KB | 2 | 0 | 32 (other, document, picture, style, script) | GET /s/demo/no/wishlist/saved |
| store-account | 28 | 106 KB | 1 | 0 | 8 (other, script) | GET /s/demo/no/wishlist/saved |
| store-wishlist | 28 | 106 KB | 1 | 0 | 8 (other, script) | GET /s/demo/no/wishlist/saved |
| site-home | 9 | 28 KB | 0 | 0 | 13 (other, script, style) |  |
| site-blog-post | 6 | 18 KB | 0 | 0 | 10 (other, script, style) |  |
| site-docs | 0 | 0 KB | 0 | 0 | 1 (other) |  |
| site-themes | 6 | 18 KB | 0 | 0 | 10 (other, script, style) |  |
| admin-sign-in | 7 | 24 KB | 0 | 0 | 11 (other, script) |  |
| admin-stores | 23 | 77 KB | 0 | 0 | 15 (other, script, picture) |  |
| admin-home | 28 | 96 KB | 1 | 0 | 14 (other, script, picture) | GET /admin/account/notices/feed |
| admin-orders | 32 | 109 KB | 1 | 0 | 17 (other, script, picture) | GET /admin/account/notices/feed |
| admin-products | 38 | 130 KB | 1 | 0 | 26 (other, picture, script) | GET /admin/account/notices/feed |
| admin-product-editor | 24 | 83 KB | 1 | 0 | 14 (other, script, picture) | GET /admin/account/notices/feed |
| admin-customers | 30 | 102 KB | 1 | 0 | 16 (other, script, picture) | GET /admin/account/notices/feed |
| admin-pages | 46 | 156 KB | 1 | 0 | 14 (picture, other, script) | GET /admin/account/notices/feed |
| admin-page-builder | 26 | 89 KB | 3 | 0 | 18 (picture, other, script) | GET /admin/account/notices/feed; POST /admin/e2e-shop/pages/{id} |
| admin-media | 24 | 83 KB | 1 | 0 | 14 (other, script, picture) | GET /admin/account/notices/feed |
| admin-analytics | 32 | 110 KB | 1 | 0 | 12 (other, script, picture) | GET /admin/account/notices/feed |
| admin-discounts | 28 | 96 KB | 1 | 0 | 14 (other, script, picture) | GET /admin/account/notices/feed |
| admin-settings | 44 | 148 KB | 1 | 0 | 13 (other, script, picture) | GET /admin/account/notices/feed |
| admin-settings-features | 44 | 148 KB | 1 | 0 | 14 (script, other, picture) | GET /admin/account/notices/feed |
| admin-platform-home | 24 | 77 KB | 1 | 0 | 2 (other, script) | GET /admin/account/notices/feed |
| admin-platform-stores | 24 | 76 KB | 1 | 0 | 2 (other, script) | GET /admin/account/notices/feed |

## The largest scripts each page loaded, with the bytes that ran

### store-home (31 scripts, 834 KB raw, 57% unused)

| Script | Raw | Ran | Unused |
|---|---|---|---|
| `3_-1ammthsmzm.js` | 229 KB | 86 KB | 62% |
| `22veshrt28b-t.js` | 129 KB | 64 KB | 51% |
| `no` | 94 KB | 94 KB | 0% |
| `1evi5k6aquxhb.js` | 49 KB | 30 KB | 38% |
| `1i4b_d7saujxh.js` | 45 KB | 3 KB | 94% |
| `38a-9vh9kbgd8.js` | 31 KB | 2 KB | 93% |
| `2ckxdz0mb_-4m.js` | 31 KB | 7 KB | 79% |
| `089dazvd7qg9r.js` | 31 KB | 14 KB | 55% |
| `2z7jlmv4qdt7l.js` | 28 KB | 0 KB | 99% |
| `01fvsecug_p8v.js` | 28 KB | 18 KB | 35% |
| `1d4jvdhcm38wv.js` | 27 KB | 11 KB | 58% |
| `0u8-5yw52bsvl.js` | 27 KB | 0 KB | 99% |
| `1-i09s1osoo9g.js` | 21 KB | 7 KB | 66% |
| `3r0si1dhleclm.js` | 17 KB | 3 KB | 85% |

### store-product (41 scripts, 883 KB raw, 57% unused)

| Script | Raw | Ran | Unused |
|---|---|---|---|
| `3_-1ammthsmzm.js` | 229 KB | 94 KB | 59% |
| `22veshrt28b-t.js` | 129 KB | 64 KB | 51% |
| `demo-keramikkopp` | 81 KB | 81 KB | 0% |
| `1evi5k6aquxhb.js` | 49 KB | 29 KB | 41% |
| `1i4b_d7saujxh.js` | 45 KB | 3 KB | 94% |
| `1x39x1g4jf9_o.js` | 32 KB | 6 KB | 81% |
| `38a-9vh9kbgd8.js` | 31 KB | 4 KB | 89% |
| `2ckxdz0mb_-4m.js` | 31 KB | 11 KB | 64% |
| `089dazvd7qg9r.js` | 31 KB | 14 KB | 54% |
| `2z7jlmv4qdt7l.js` | 28 KB | 1 KB | 98% |
| `01fvsecug_p8v.js` | 28 KB | 16 KB | 43% |
| `1d4jvdhcm38wv.js` | 27 KB | 11 KB | 58% |
| `0u8-5yw52bsvl.js` | 27 KB | 0 KB | 99% |
| `0gs3z5zooftty.js` | 22 KB | 6 KB | 74% |

### store-cart-empty (36 scripts, 938 KB raw, 67% unused)

| Script | Raw | Ran | Unused |
|---|---|---|---|
| `3_-1ammthsmzm.js` | 229 KB | 86 KB | 63% |
| `22veshrt28b-t.js` | 129 KB | 66 KB | 49% |
| `cart` | 74 KB | 74 KB | 0% |
| `1evi5k6aquxhb.js` | 49 KB | 21 KB | 56% |
| `1i4b_d7saujxh.js` | 45 KB | 3 KB | 94% |
| `1vgm22n9a-a_8.js` | 37 KB | 0 KB | 100% |
| `43b7lln6d-c2x.js` | 33 KB | 0 KB | 99% |
| `1x39x1g4jf9_o.js` | 32 KB | 0 KB | 99% |
| `38a-9vh9kbgd8.js` | 31 KB | 2 KB | 93% |
| `2ckxdz0mb_-4m.js` | 31 KB | 6 KB | 79% |
| `089dazvd7qg9r.js` | 31 KB | 14 KB | 56% |
| `2z7jlmv4qdt7l.js` | 28 KB | 0 KB | 99% |
| `01fvsecug_p8v.js` | 28 KB | 4 KB | 87% |
| `1d4jvdhcm38wv.js` | 27 KB | 11 KB | 58% |

### store-checkout-empty (38 scripts, 1098 KB raw, 70% unused)

| Script | Raw | Ran | Unused |
|---|---|---|---|
| `3_-1ammthsmzm.js` | 229 KB | 84 KB | 63% |
| `22veshrt28b-t.js` | 129 KB | 20 KB | 84% |
| `22veshrt28b-t.js` | 129 KB | 66 KB | 49% |
| `cart` | 74 KB | 74 KB | 0% |
| `1evi5k6aquxhb.js` | 49 KB | 21 KB | 56% |
| `1i4b_d7saujxh.js` | 45 KB | 3 KB | 94% |
| `1vgm22n9a-a_8.js` | 37 KB | 0 KB | 100% |
| `43b7lln6d-c2x.js` | 33 KB | 0 KB | 99% |
| `1x39x1g4jf9_o.js` | 32 KB | 0 KB | 99% |
| `38a-9vh9kbgd8.js` | 31 KB | 2 KB | 93% |
| `2ckxdz0mb_-4m.js` | 31 KB | 6 KB | 79% |
| `089dazvd7qg9r.js` | 31 KB | 0 KB | 100% |
| `089dazvd7qg9r.js` | 31 KB | 14 KB | 56% |
| `2z7jlmv4qdt7l.js` | 28 KB | 0 KB | 99% |

### site-home (56 scripts, 1173 KB raw, 77% unused)

| Script | Raw | Ran | Unused |
|---|---|---|---|
| `3_-1ammthsmzm.js` | 229 KB | 89 KB | 61% |
| `2du16ociar189.js` | 175 KB | 0 KB | 100% |
| `22veshrt28b-t.js` | 129 KB | 62 KB | 52% |
| `1-5xy7dnrat0_.js` | 114 KB | 0 KB | 100% |
| `2i4juo9spco86.js` | 56 KB | 0 KB | 100% |
| `2zizbcwzl-te-.js` | 49 KB | 0 KB | 100% |
| `1evi5k6aquxhb.js` | 49 KB | 0 KB | 99% |
| `1i4b_d7saujxh.js` | 45 KB | 28 KB | 37% |
| `38a-9vh9kbgd8.js` | 31 KB | 3 KB | 89% |
| `2ckxdz0mb_-4m.js` | 31 KB | 8 KB | 75% |
| `089dazvd7qg9r.js` | 31 KB | 14 KB | 54% |
| `01fvsecug_p8v.js` | 28 KB | 6 KB | 77% |
| `1d4jvdhcm38wv.js` | 27 KB | 11 KB | 59% |
| `1r8qaea7t31c5.js` | 25 KB | 0 KB | 99% |

### admin-home (62 scripts, 1512 KB raw, 62% unused)

| Script | Raw | Ran | Unused |
|---|---|---|---|
| `3_-1ammthsmzm.js` | 229 KB | 88 KB | 62% |
| `2du16ociar189.js` | 175 KB | 22 KB | 87% |
| `22veshrt28b-t.js` | 129 KB | 66 KB | 49% |
| `1-5xy7dnrat0_.js` | 114 KB | 31 KB | 73% |
| `0pmozty218j-z.js` | 70 KB | 70 KB | 0% |
| `2i4juo9spco86.js` | 56 KB | 7 KB | 88% |
| `19lnsvtmfev_l.js` | 55 KB | 24 KB | 56% |
| `0loby10hkd70k.js` | 52 KB | 25 KB | 52% |
| `2zizbcwzl-te-.js` | 49 KB | 21 KB | 57% |
| `1evi5k6aquxhb.js` | 49 KB | 0 KB | 99% |
| `1i4b_d7saujxh.js` | 45 KB | 0 KB | 100% |
| `e2e-shop` | 44 KB | 44 KB | 0% |
| `2-qbqk-gdin9b.js` | 32 KB | 11 KB | 65% |
| `38a-9vh9kbgd8.js` | 31 KB | 0 KB | 99% |

### admin-product-editor (73 scripts, 2627 KB raw, 61% unused)

| Script | Raw | Ran | Unused |
|---|---|---|---|
| `3lclkawi229rq.js` | 424 KB | 26 KB | 94% |
| `3_-1ammthsmzm.js` | 229 KB | 88 KB | 62% |
| `0b262999-76ee-496b-835e-1c697e3c24b2` | 217 KB | 217 KB | 0% |
| `2du16ociar189.js` | 175 KB | 22 KB | 87% |
| `22veshrt28b-t.js` | 129 KB | 64 KB | 51% |
| `2k30von4nd7x_.js` | 125 KB | 43 KB | 66% |
| `1-5xy7dnrat0_.js` | 114 KB | 34 KB | 70% |
| `3553h5joaqwch.js` | 73 KB | 52 KB | 29% |
| `0pmozty218j-z.js` | 70 KB | 70 KB | 0% |
| `0ermlzh559yop.js` | 63 KB | 14 KB | 78% |
| `2i4juo9spco86.js` | 56 KB | 7 KB | 88% |
| `0loby10hkd70k.js` | 52 KB | 25 KB | 51% |
| `2zizbcwzl-te-.js` | 49 KB | 22 KB | 55% |
| `1evi5k6aquxhb.js` | 49 KB | 0 KB | 99% |

### admin-page-builder (81 scripts, 3761 KB raw, 57% unused)

| Script | Raw | Ran | Unused |
|---|---|---|---|
| `1jj1xvz8qgfpw.js` | 450 KB | 134 KB | 70% |
| `3lclkawi229rq.js` | 424 KB | 27 KB | 94% |
| `1u2592k6jkhim.js` | 308 KB | 237 KB | 23% |
| `91a06263-61bb-4ec5-8f1f-d24812120be7` | 295 KB | 295 KB | 0% |
| `3_-1ammthsmzm.js` | 229 KB | 100 KB | 56% |
| `2du16ociar189.js` | 175 KB | 22 KB | 87% |
| `3u3sqc5kdsh-x.js` | 133 KB | 24 KB | 82% |
| `22veshrt28b-t.js` | 129 KB | 67 KB | 48% |
| `1-5xy7dnrat0_.js` | 114 KB | 34 KB | 70% |
| `0-_y079740d6n.js` | 112 KB | 68 KB | 40% |
| `3553h5joaqwch.js` | 73 KB | 54 KB | 26% |
| `0pmozty218j-z.js` | 70 KB | 70 KB | 0% |
| `2i4juo9spco86.js` | 56 KB | 7 KB | 88% |
| `0dihzklglb8_d.js` | 52 KB | 11 KB | 78% |

## Scripts every page of a group loads

- **storefront** (12 pages): 20 scripts in common, 719 KB raw; the most any one page ran of them: 294 KB.
- **site** (5 pages): 8 scripts in common, 450 KB raw; the most any one page ran of them: 192 KB.
- **admin** (15 pages): 23 scripts in common, 1095 KB raw; the most any one page ran of them: 458 KB.
