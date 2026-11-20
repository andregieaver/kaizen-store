# Performance (D211)

What a visitor's page loads, and how it is kept small. Measured with Lighthouse as PageSpeed Insights runs it: a phone on slow 4G
with its processor slowed four times, and a computer.

## Where it started

`kaizenalabs.com`, 12 October 2026, Lighthouse 12.8 (mobile / desktop):

| | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| Mobile | 43 | 96 | 100 | 69 |
| Desktop | 97 | 96 | 100 | 69 |

- SEO: the store has *Hide from search engines* on (`stores.seo.hidden`, Settings → SEO), so its pages say `noindex`. A setting, not
  code: the score is 100 once it is off.
- Accessibility: an embedded HTML component in the footer had no title, and a frame without one has no name for screen readers.
- Performance on a phone: the largest paint (6.3 s) was the footer's blurred background picture. The footer is *revealed on scroll*
  (D184), so it was pinned under the page from the first paint, and browsers count what is painted there though the page covers
  it; the picture was also loaded lazily, at 1600 px for a 436 px space. And 466 KB of scripts (compressed) blocked the phone for
  1.4 s: zod with all its translations (92 KB), the interface text of all four languages (60 KB), and every client component of
  the route, drawn or not.

## The rules

- **Only link-preview fetchers get a blocking per-request render** (bloat review step 2.5). Next renders a page per request, a static one
  included, for a user agent on its `htmlLimitedBots` list, so that the metadata is in the head. The default list held Bing, Apple, Yandex,
  Google's shop and ads fetchers and Meta's catalogue, so each of them cost a render that was not kept. The pattern in `next.config.ts`
  keeps only the fetchers that run no scripts and come once per shared link (Facebook, Twitter, LinkedIn, Slack, Discord and the like); the
  others get the cached page, as Googlebot always did. That is safe because `scripts/render-modes.mjs` holds that every prerendered public
  page has its title in the head of its static file, and `e2e/crawlers.spec.ts` reads a home, product, category and article page as a crawler
  without scripts and holds the head tags, the price and the JSON-LD. A crawler whose tool later shows a missing price or availability is put
  back on the list by adding its name to the pattern.
  Share of page runs by listed crawlers: to be measured after opening

- **The footer is pinned only near the page's end** (`FooterRevealGuard`): only after a scroll that brings the end within a screen,
  never at the first paint. Pinned while the end is still below the screen, the switch cannot be seen.
- **Pictures that may be on the first screen load at once.** A row is `eager` when it is the first of a page or a header (never a
  footer's, `late`): its background picture and an image component in it load with `loading="eager"` and `fetchpriority="high"`,
  and the first grid's first four tiles at once, the first with high priority. Everything else is `lazy`.
- **A background picture gives a phone its small copy.** Every upload keeps a 480 px copy (`media.thumbnail_url`); the page
  loader fills `image.small` from the library (`withSmallCopies()`, read only, never saved), and `backgroundSources()` sends a
  blurred picture (4 px or more) only that, and a sharp one its two sizes by width (`srcset`, `sizes="100vw"`).
- **No zod in a visitor's scripts.** A module with plain helpers and schemas keeps the schemas in `*-schema.ts` beside it
  (`cookie-consent-schema.ts`, `carousel-settings-schema.ts`, …); the browser imports the plain module. The page model
  (`lib/page-content`) is not a visitor's script either: `button-look.ts` and `slide-step.ts` hold the little the browser needs of
  it. `storefront-bundle.scan.test.ts` walks every visitor-facing client component's imports and fails if one reaches either.
  It holds for scripts loaded later too: the scan follows `import()`, so the tiles a recommending grid loads once the shopper's
  picks arrive read the page model's helpers from `grid-view.ts` and `grid-list-style.ts`, and typography's and colours' schemas
  are `typography-schema.ts` and `colour-schema.ts` (bloat review step 2.10); `e2e/recommendations.spec.ts` checks the scripts
  that arrive after `/api/recommendations` answers.
- **A client component that only some pages draw is loaded where it is drawn.** Turbopack puts every client component a route's
  server code imports into one group of scripts that every page of the route loads; a server-side `import()` does not split it
  (tried). So the shop's forms (`components/lazy/shop.tsx`), the page components' interactive parts (`lazy/blocks.tsx`) and the
  extras (`lazy/extras.tsx`) are `lazyView()` stand-ins: the server still draws the component into the page, and React keeps that
  HTML while the script loads; one that wraps the server's content shows it meanwhile (`showChildren`). The chat's button and a
  referral capture wait until the browser is idle; the consent manager and the owner's necessary code do not. A new client
  component that is not on most pages is added to the right `lazy/*.tsx` and imported from there. A press never waits for its
  script: a part a visitor may press at once either stays in first scripts or keeps its button there and loads the rest on the
  press or when a pointer nears (the listing's filter: `FilterDialog` draws the button, and `filter-panel.tsx` is fetched with
  `import()` when a pointer or the focus comes to it, or on the press, which is kept and opens the dialog when it arrives;
  `e2e/products-page.spec.ts`). What is typed or pressed before a part's own script runs is otherwise lost: the site's forms
  (`e2e/components.spec.ts`), a booking's changes (`e2e/bookings.spec.ts`), the cart's checkout button with its company and VAT
  fields (`e2e/vat-reverse-charge.spec.ts`), the discount codes, the gift box, the delivery choice and signing in stay in the first
  scripts. A product page's pickers (a stay's or rental's dates, an appointment's time, a gift card, a request for a quote) are
  `lazy/shop.tsx` stand-ins: the server draws them and asks for their scripts with the page's, and five runs each of the bookings,
  gift card, quote and filter specs lost no press (bloat review step 0.16). `next/dynamic` (not
  `React.lazy`) is what lets the server ask for a drawn part's script with the page's: with `React.lazy` alone, galleries, tabs
  and filters answered only a moment after the rest of the page, and 27 end-to-end tests failed.
- **Admin words, the features table and the cookie catalogue are not a visitor's scripts; a helper a client component reads lives
  in a file without them** (bloat review step 0.16): the cookies' categories are `COOKIE_PATTERNS` (`lib/cookie-patterns.ts`) and
  their purposes `lib/known-cookies.ts`, the server's; `effectiveAudience()` is `lib/store-audience.ts`, the feature labels
  `lib/feature-labels.ts`, `mayRemember()` is in `lib/cookie-consent.ts` and `drawerHasBackground()` in `lib/drawer-background.ts`;
  the cart's view (`cartView()`) is a server file, `cart/cart-view.ts`, so the product page reaches no cart form.
  `storefront-bundle.scan.test.ts` holds it.

- **A visitor's browser gets only the interface text its client components read (D212).** Every text of the four hand-written
  languages is 270 KB (`src/lib/messages/{nb,sv,da,en}.ts`), which `t()` in `i18n.ts` gives the server, emails and the admin. A
  visitor's client components read `browserText()` (`src/lib/browser-text.ts`): the few texts they use, in
  `messages/{lang}-browser.ts` (about 4 KB a language), which each language's whole module spreads in, so a text is written once.
  The withdrawal function's words are `messages/{lang}-returns.ts`, read through `returnsText()` by its page alone. These load
  with the page's first scripts: a first try loaded the page's language on its own and made the page wait for it before waking
  up, and a press in that moment was lost (`e2e/gallery.spec.ts`). A new text a visitor's client component reads goes in each
  `*-browser.ts`; the scan test fails for a visitor's component that reaches `lib/i18n`, `lib/email-text` or a whole language. A
  language translated by AI sends the same few texts and no more: `uiTextsFor()` (`src/server/ui-text-read.ts`) hands `UiTexts` only
  the keys of `en-browser.ts` (114 keys, under 9 KB, where it sent all 1,673 texts, 93 KB), and the withdrawal page sends its own with
  `returnsTextsFor()` and `part="returns"` (bloat review step 0.8). It holds for a view loaded later with `import()` too: it takes
  its words as a prop, as the recommending grid hands its tiles `browserText()` (bloat review step 2.10; the scan test and
  `e2e/recommendations.spec.ts` hold it).
- **A link whose press does not open its href** (a language or a currency: the handler goes to the same page in the other view), **or
  that few visitors press and that leads to another country's whole layout or to a legal page** (countries, cookies, withdrawal, the
  legal pages), **is not prefetched:** `prefetch={false}`.
- **A link that crosses to another root layout is not prefetched** (Kaizena Flow's site to the admin or to a store and back, a store's
  front door to a country, the admin's *View store*): the press is a full page load, so the answer cannot be used, and it pulls the
  other surface's scripts and stylesheet. The root layouts are the two `(platform)` groups, the two `(docs)` groups, the two
  `(theme-preview)` groups, `admin`, `s/[store]/(chooser)`, `s/[store]/[market]`, `s/[store]/private/[market]`, `holding`,
  `passport/[id]`, `sms`, `supply` (and `embed`). `src/lib/cross-root-links.scan.test.ts` and `e2e/prefetch.spec.ts` hold both
  (bloat review step 0.12).
- **Pictures are never resized on the server**: `images: { unoptimized: true }` in `next.config.ts`, so every `next/image` is served as stored and `/_next/image` does not exist (`src/lib/image-service.scan.test.ts`). A picture's sizes are the files kept for it (`src/lib/picture-sizes.ts`).
- **Font stylesheets and font files are kept for a year, at the CDN too** (`immutable`, `s-maxage`); a change to how one is written raises `FONT_CSS_VERSION`, which is in
  every stylesheet's address.
- **A store document holds its layout once**, held by `e2e/performance.spec.ts`: one `html` element in the payload and under 2,000
  bytes of duplicate rows (bloat review step 2.2). The `@drawer` slot sits in the `(shop)` route group because a slot on a root
  layout makes Next draw that layout twice; each layout-level sheet is in a document twice (HTML and payload): the breakpoint
  sheet and the theme sheet too, however many rows a page has (a three-row page in the same spec, step 2.3). The rows of an
  article, a header or a footer share one part sheet (`ArticleStyles`), so a page's HTML holds at most one `kz-parts-` sheet each
  for its header, its page and its footer, held by the six-row page in the same spec.

After D212 the demo store's front page, built locally, loads 206 KB of scripts (compressed; 266 KB after D211, 469 KB before) and
scores 92 to 96 for performance on a phone.

Not changed: Next's own polyfills (14 KB, flagged as legacy JavaScript; the audit carries no weight and the browsers Next targets
need none of them), React (70 KB) and the router (35 KB).

### Kept in first scripts

What a visitor may press or type into at once stays in the page's first scripts (bloat review step 0.16). Bytes are each part's own
module, minified (esbuild, its imports not counted), measured on 14 November 2026:

| Part | File | Bytes |
|---|---|---:|
| The site's forms | `components/site-form.tsx` | 6,236 |
| A booking's changes | `components/booking-changes.tsx` | 2,166 |
| The cart's checkout button (company and VAT fields) | `components/checkout-button.tsx` | 8,343 |
| The discount codes | `components/discount-code-form.tsx` | 1,698 |
| The gift box | `app/s/[store]/[market]/cart/cart-gift.tsx` | 3,559 |
| The delivery choice | `components/delivery-choice.tsx` | 7,198 |
| The listing filter's button (its dialog, `filter-panel.tsx`, 9,237, loads on the press) | `components/filter-dialog.tsx` | 1,284 |
| Signing in | `components/account-sign-in.tsx` | 7,679 |

No product picker is kept: the trial moved all four out, and none lost a press. Their own chunks in the build: the range picker
9,597 bytes, the appointment picker 6,842, the gift card 4,592, the quote request 11,091; the product page's first scripts fell
from 686,952 to 661,266 bytes (`node first-scripts.mjs`, the plain build).

The carousel is split (bloat review step 0.16). As a whole `lazyView()` stand-in it failed: the server streams it after its
fallback, so a page read without JavaScript held its tiles twice and `e2e/carousel.spec.ts` ("without JavaScript the row scrolls")
failed. Now the frame (`carousel.tsx`: the group, the server's row and the arrows as the server draws them, Previous off and Next on,
from `carousel-arrows.tsx`) stays in first scripts and draws the same HTML as before; once in the browser it draws
`CarouselControls` (`carousel-controls.tsx`: the controller, measuring, the arrows' moves, dots, Pause/Play and autoplay), a
`lazy/blocks.tsx` stand-in whose fallback is the frame's own arrows, never the row. A press on an arrow before the controls arrive
is kept and made by them as they arrive (`e2e/gallery.spec.ts` and `e2e/custom-grid.spec.ts` press Next at once). /s/demo/no's
first scripts fell from 615,961 to 609,885 bytes, the product page's from 661,266 to 655,190, and the product page's own entry
chunks (`route.mjs`) from 223,068 to 216,992.

## Checking

- `pnpm perf` builds nothing: after `pnpm build` it starts the app and runs Lighthouse on the demo store's front page, or on any
  address given (`pnpm perf https://kaizenalabs.com/`), for a phone and a computer, and lists the scores, the measures and the
  largest scripts; `--min=90` fails below a score.
- `e2e/performance.spec.ts` holds what does not wobble, in the real build, with `E2E_MEASURE=1` printing every figure (17 November 2026):
  - first scripts of 8 store routes (the files the server's HTML names, no `nomodule` tag, each file once), within 3 %: the front page
    614,339 bytes, the product page 662,244, the other six store routes 729,906 or the front page's; six other routes within 4 %;
  - the document, its payload and its main element for five pages (the front page 134,151 characters, 93,017 of payload), one a six-row page
    made from Orbit's home, within 5 %;
  - the stylesheets of three routes, raw and Brotli, within 4 % (the store home 217,830 raw, 28,866 Brotli), the store home's style text (at
    most 6,000 characters; 4,365) and its breakpoint sheets (at most 4; 4);
  - five pages on a phone from a cold cache until the network has been quiet for three seconds: bytes on the wire within 4 % (the front page
    351,687), the late script files (one more fails) and their bytes with room of max(2,000, 2 %) (the front page 3 files, 61,416 bytes), the page's own calls, no other host;
  - no zod, lightbox or checkout form in the front page's scripts; no language's whole interface text; the first grid's and the first
    row's pictures eager and the next ones lazy; a blurred background from its small copy; an embedded frame named.
- `e2e/prefetch.spec.ts` holds a table of six pages' router requests on a phone (the front page, a product page, a content page, a listing and
  the cart 6 each since step 2.6, the front door 0; *What the router fetches ahead*).
- A budget only falls: a change that lowers a figure by more than its room lowers the budget in the same change, and a change that needs one
  raised says why in docs/decisions.md.
- These run in CI's full checks, which report beside the deploy of a push without a migration (D526), not before it.

- A store page's first scripts are held by name in `src/lib/storefront-bundle.baseline.json` (the client modules the server code of the
  layout, a built page, the product page, a listing and the cart imports); a new one needs a lazy stand-in in `src/components/lazy` or a
  line with its reason. The same test (`src/lib/storefront-bundle.scan.test.ts`) follows `import()`, keeps the admin's words and the
  cookie purposes out, and holds the four browser-language files at today's total, which only falls. The byte budgets (step 1.3) and
  this list are two holds on the same thing: bytes cannot see a 5 to 20 KB part, names can.

- `node scripts/bundle-budget.mjs`, after `pnpm build`, holds every route's first scripts
  (`.next/diagnostics/route-bundle-stats.json`, raw bytes) within 15,000 bytes of `scripts/bundle-budget.baseline.json`, and the
  number of routes whose first scripts hold each of eight marker sentences (Supabase's client, zod, the rich text editor, the
  builder's English, sign-in's English, a storefront language, the cookie purposes, the admin's common English on store routes).
  CI's e2e job runs it. The figures only fall.

Scores move a few points between runs, and a page's own content (large pictures, many components) decides much of it.

## Fonts found late (kaizenaflow.com, 5 November 2026)

Lighthouse 12 as PageSpeed Insights runs it, against production at `a88cec7`, warm cache: a phone 83 to 88, a computer 97;
accessibility 98, best practices and SEO 100. A run while a deploy went live scored 66 on a phone: the page took 3.1 s to answer, and
Lighthouse counts that wait in every measure. So a score read just after a push is not the page's.

On a phone the largest paint (the front row's picture, 14 KB) is 3.7 to 4.3 s, though the browser paints it at about 0.9 s. Lighthouse
simulates slow 4G and charges the paint with every file that finished before it: 259 KB of scripts, 82 KB of fonts, 38 KB of CSS and the
document. Blocking each in turn: without the fonts 93 (largest paint 2.9 s), without any script 97 (2.5 s). The two families
(Montserrat, Inter) are whole variable fonts, weights 100 to 900, found only through their stylesheets (document, then
`/api/fonts/css/…`, then the file).

- **The site's fonts are preloaded** (`FontPreloads` in `StoreThemeStyles`, `latinUprightFile()`): the file each of the site's families
  draws upright Latin text from, which React names in the response's `Link` header. Only where one file serves every upright weight (a
  variable family); a family with a file per weight is left to its stylesheet. Through a proxy that rewrote the front page, four runs
  each: largest paint 4.05 s before, 3.88 s preloaded (the median; scores within the runs' noise).
- **Variable fonts are cut to the weights the builder installs** (`trimFontFiles()`, `src/server/font-trim.ts`, D461): Google sends a
  variable family's whole weight axis (100 to 900) even when asked for a range, and the builder installs 400 to 700. The five-minute
  dispatcher cuts each file it has not looked at (`font_files.trimmed_at`) with HarfBuzz (`subset-font`) to its family's installed
  weights (`installedWeightRange()`), keeping every character, OpenType feature and other axis, under the same name, so no stylesheet
  or page changes. Inter's Latin file 48 KB to 34 KB, Montserrat's 35 to 32: the front page's fonts 82 KB to 67. Drawn at 400 to 700
  the glyphs are the same and a line's width within 0.1 % (1.2 px in 1,550). In the proxy's test the largest paint was 3.75 s.
- **The shops' working parts load only where they draw** (D461): the cart's, checkout's, order's and My account's components
  (`StorePartSection`) were imported by `PageArticle`, so every page built in the builder loaded their scripts, Kaizena Flow's own
  included, though they draw only on a store's working page. `RolePage`, the one place that draws one, now hands `PageArticle` what
  draws them (`StorePartDrawer`), so only its routes carry them. Measured on a build (the gzipped chunks each route's client manifest
  names): Kaizena Flow's front page 96 to 71 KB, a store's front page 100 to 76, a product page 116 to 100, the cart unchanged. Since
  bloat review step 2.9 each working route has its own parts module on `storePartDrawer()` (`src/components/store-part-frame.tsx`:
  `cart-parts.tsx`, `checkout-parts.tsx`, `order-parts.tsx`, ..., `term-parts.tsx` for a category and a tag), handed to `RolePage`
  as `storePart`, so a listing no longer carries the cart's, checkout's and account's forms, and the search page, which draws no
  part, carries none (`store-part-drawers.scan.test.ts`). First scripts (raw, `e2e/performance.spec.ts`), measured on the build
  of 20 November 2026: 729,906 bytes on each of these routes before (778,166 when the step was planned); after, a category, a tag and
  the search 621,749 (the store's front page's figure), the cart 683,531, the checkout 673,336, My account 636,534, the wishlist
  626,775, an order 644,334 and the cookie list 625,054. The listing page's server code imports 20 client modules (41 before,
  `storefront-bundle.baseline.json`). The cookie banner still loads where it is drawn (`lazy/extras.tsx`); the cookie list's
  settings button is its own file (`consent/cookie-settings-button.tsx`) and no longer carries the banner.

## First scripts per route (PSI PERF-11, 30 October 2026)

Every route a visitor or a person signing in meets first has its own first-scripts budget in `e2e/performance.spec.ts`
(`FIRST_SCRIPTS_BUDGETS`, raw bytes; see Checking: a store route within 3 % of the build measured, the others 4 %). Measuring them found Kaizena Flow's sign-up and status pages
and the admin's sign-in and forgot-password pages loading 2.0 to 2.1 MB: `ActionForm`'s submit button read one word through
`useAdminText()`, whose English fallback holds every area of the admin's catalogue. A part shown outside the signed-in admin reads its
words through `src/components/admin/admin-text-context.tsx` (`useCommonText()`, `useSignInText()`, and `AdminTextProvider`, which carries no
catalogue); the pages now load 0.71 to 0.84 MB.

## The admin as people use it (PSI PERF-01, 31 October 2026)

The status page's Dublin check times `/admin/sign-in`, which Vercel's edge serves from its cache, so it says nothing about the signed-in
admin. What does is the speed beacon in the admin itself (`commerce.own_speed_samples`, site `admin`, `src/server/own-speed.ts`; Platform →
Usage and limits shows it): real page loads of signed-in people, no robots, nobody with Global Privacy Control or Do Not Track. Read from
production on 31 October 2026, the 30 days then held 52 loads (29 and 30 October, so a first look, not a settled figure):

| Admin, p75 | Loads | LCP | INP | CLS | TTFB |
|---|---:|---:|---:|---:|---:|
| All | 52 | 3.93 s | 136 ms | 0.026 | 321 ms |
| Computer | 42 | 3.95 s | 172 ms | 0.026 | 327 ms |
| Phone | 10 | 2.99 s | 104 ms | 0 | 156 ms |

By the page's kind (`ownSpeedKind()`): an editor (a product, page or article: `product`) 3.90 s LCP at 499 ms TTFB over 25 loads, the
other screens (`page`) 4.18 s at 133 ms over 21, the store's home 2.50 s over 4. INP and CLS are within Google's "good" (200 ms, 0.1); LCP
is not (2.5 s), and with the server answering in 0.1 to 0.5 s the rest is the browser's: the editors' and settings' client scripts, which
the first-scripts budgets above do not yet cover for signed-in routes. Kaizena Flow's own site for comparison: 80 loads, LCP 2.06 s, INP
72 ms, CLS 0.001, TTFB 113 ms. The next step is a first-scripts budget for the product editor and the page builder, and this table read
again once a month of loads is in.

**Held by the morning briefing (step 1.15).** A kind of screen with 100 loads or more whose largest paint or interaction time at p75 over
28 days is not "good" is a line in the platform's morning briefing (`adminSpeedAlerts()`). The page builder is its own row from this change
(kind `category` on site `admin`; a product's editor stays `product`), so rows of `product` recorded before it mix editors and the builder
and are not comparable with October's for 28 days. Read from Platform, Usage and limits; a kind with 100 loads or more that misses 2.5 s
or 200 ms gets a step in the plan.

**The admin's client modules are walked like the visitor's (step 1.4).** `src/components/admin/admin-bundle.scan.test.ts` walks every
`"use client"` module of the admin through its static imports: the four gated layouts' client parts reach no zod, no Supabase client
and no area's catalogue, and the modules that reach zod (ZOD_REACH, `admin-bundle.baseline.json`: 145 today) only shrink. A static
walk does not follow `import()`, so a part loaded on a press may be large. Catalogue files hold text only
(`src/lib/admin-messages/imports.scan.test.ts`, 36 value imports of code in 14 files at the start).

28 days to <date>, after phase 0:

| Kind | Screen | Loads | LCP | INP | CLS | TTFB |
|---|---|---:|---:|---:|---:|---:|
|  |  |  |  |  |  |  |

28 days to <date>, after phase 2:

| Kind | Screen | Loads | LCP | INP | CLS | TTFB |
|---|---|---:|---:|---:|---:|---:|
|  |  |  |  |  |  |  |

**First scripts, signed in (31 October 2026, again 4 November).** `e2e/signed-in/admin-scripts.spec.ts` holds seven screens to budgets,
counted from the HTML the server sends (what a page has loaded by the time it is looked at grows with what it does after, and moved by
1.7 MB between two runs). Raw, before compression:

| Screen | 31 October | 4 November, before | 4 November, after | Budget |
|---|---:|---:|---:|---:|
| The store's home | 3.02 MB | 3.12 MB | 2.37 MB | 2.47 MB |
| Products | 3.02 MB | 3.12 MB | 2.36 MB | 2.46 MB |
| A new product (the editor) | 3.71 MB | 3.83 MB | 3.27 MB | 3.40 MB |
| Orders | 3.02 MB | 3.12 MB | 2.37 MB | 2.47 MB |
| Pages (the list) | 3.59 MB | 3.71 MB | 3.16 MB | 3.30 MB |
| A page in the builder | 4.70 MB | 4.90 MB | 4.39 MB | 4.57 MB |
| Settings | 3.00 MB | 3.10 MB | 2.34 MB | 2.44 MB |

In four days every screen grew about 0.1 MB, the builder 0.2, and the docs guide's entry in the admin map (D444) took the builder 1,307
bytes over its budget of 4.90 MB. The build's chunks showed why an entry in the map weighs on every screen: the AI manager's launcher, in
every admin layout, imported its chat statically, and the chat imports the admin map (to name the page a person is on in its first
suggestion) and the Norwegian page names, 0.48 MB in one chunk. The chat is drawn only after the launcher is pressed, so it is now
fetched then (`loadChat()` in `ai-manager-launcher.tsx`, beside the start call; a failed fetch offers the AI manager's own page, and the
next opening tries again; `e2e/signed-in/ai-manager-panel.spec.ts` holds that the screen asks for its scripts only on opening and that
the panel draws the chat). Each screen dropped 0.51 to 0.76 MB, and the budgets were set again with about 4 % of room, so growth is
caught where it starts.

The chat still weighed 496,206 bytes on opening, about 437 KB of it three tables read for two labels: the tool definitions (for the
words of a working line), the admin map and the Norwegian page list (for the first suggestion). Step 0.11 of the bloat review
(14 November 2026) moved the labels to `src/lib/tool-words.ts` and made the server name the page (`pageHere`, a server action beside
the chat's others), so the chat imports neither; the budget lives in the panel's spec, 130,000 bytes of script on first opening, and the
chat now fetches 49,786 bytes in two files there (496,206 before).
The Work invoice screen carried the whole admin catalogue in both languages because two shared parts (`ReadinessList`,
`InvoiceTotalsParts`) imported `work-text.ts`; they now take their words as props, and the route's first load fell from 4,274,839
to 982,520 bytes (the largest chunk from 1,704,595 to 464,505 bytes; routes over 1,300,000 bytes from 90 to 26).

Measuring found the page lists loading the whole builder (4.71 MB, the builder's own figure): a route loads every client component its
server modules import, drawn or not, and the lists and the editor shared one `views.tsx`. The editors now live in `editor-views.tsx` (a
store's and Kaizena Flow's), and every list of pages, articles, headers, footers and product layouts dropped 1.13 MB. What is left is the
3.0 MB every screen shares. Broken down the same day from the build's client manifest (`page_client-reference-manifest.js`): the
signed-in layout's largest chunk is 1.17 MB, and it holds the admin's whole English catalogue, every area's words (1.37 MB of source in 54
files), because `useAdminText()` reads English for an area a page did not hand down and `admin-text.tsx` imports every area for that.
Fetching each area's English only when first asked took every screen down by about 1.0 MB (home 3.02 to 2.04 MB, the builder 4.70 to
3.78 MB), but was backed out before it shipped: a part waiting for its area's words is not interactive yet when the page has loaded, and the
signed-in end-to-end tests caught the content type editor's Save, pressed that early, submitting its form without its script (to the
address without `?preset`, so the type was not made). The way there is for every page to hand down the areas its parts read, so the
fallback is never needed and can then go; `admin-catalogues.scan.test.ts` meanwhile keeps any new client module from importing a whole
catalogue. A crawl of 270 admin screens (every static route as an owner and as a platform admin, and the first item of the lists whose links it
could follow), on a build that logged each fallback, found 14 screens reading an area they were not handed, each also drawing those parts
in English for a Norwegian account: the store's page and article categories (`products`), article authors, the chat agent and Kaizena
Flow's menus, navigation, media, chat and page studio (`website`), both support settings (`settings`), Kaizena Flow's Google reviews
(`notifications`), discounts and a discount (`discounts`) and fonts (`design`); visiting a content type's pages by hand found two more,
its settings and its entry editor (`builder`). Each now hands its area down (`AdminAreas`, `src/components/admin/admin-areas.tsx`, or its
own `AdminTextScope`), and the crawl found none left. Pages with an id the crawl could not reach from a list are not yet covered, and why
the content type editor's early Save failed with the per-area fallback is not explained by these (the editor itself reads nothing it is
not handed), so the fallback stays whole for now.

**Editors only where one is drawn (14 November 2026, bloat review step 0.10, D588).** On a local build, before and after: a page's preview
3,303,372 to 877,072 bytes, the pages list 658,928 and the content list 619,531, an order page 1,998,644 to 913,239, a product's editor
2,130,796 to 1,102,108. Routes with the rich text editor in their first scripts: 73 before (39 of the builder's family and 34 others), 26
after, the builder's editors only. A screen that only sometimes draws a rich text field takes the editor from
`src/components/admin/lazy/editors.tsx`; the builder and the block fields import it directly.

**The fallback goes (10 November 2026, D540).** Each area's English is now fetched only when a part reads an area its page did not hand
down (`src/components/admin/admin-text-later.ts`); `common` and `signIn`, read outside the admin too, stay at hand. So that no screen waits
for its words, a part that falls back notes it on the page (`window.__adminTextFallbacks`) and `e2e/signed-in/admin-text-fallbacks.spec.ts`
visits every admin screen without an id in its address (the store's as its owner, the platform's and the account's as a platform admin)
and fails on any. Its first runs found the platform's docs guide (`website`) and the content types' new type from a preset and their editors (`builder`,
`website`), each now handed down; a part that waited there was the early Save of 31 October. First scripts, raw:

| Screen | Before (last measured 4 to 10 November) | After | Budget |
|---|---:|---:|---:|
| The store's home | 2.46 MB | 1.28 MB | 1.34 MB |
| Products | 2.46 MB | 1.26 MB | 1.31 MB |
| A new product (the editor) | 3.27 MB | 2.22 MB | 2.31 MB |
| Orders | 2.46 MB | 1.28 MB | 1.33 MB |
| Pages (the list) | 3.16 MB | 2.09 MB | 2.18 MB |
| A page in the builder | 4.39 MB | 3.34 MB | 3.48 MB |
| Settings | 2.34 MB | 1.23 MB | 1.28 MB |

Besides every screen without an id in its address, the test follows each screen's links to one screen of each kind behind them (an
order, a product, a type made from a preset), at most 150 for each person.

**Cuts: each page hands only the groups its parts read (19 November 2026, bloat review step 2.27).** A page hands its client parts a cut of
an area, some of its top-level groups (`cut()` in `src/lib/admin-text.ts`, `docs/platform-admin-i18n.md` 3.3), where they read few of
them: the rich text editor and text styles read `builderText`, the pickers `websitePick`, the AI manager's button and notices
`assistantBar` (the chat's words come with its start call), the home's drafts card `homeDrafts`, the page lists' rows `websiteList`,
and the page editor's parts `fieldsEditor`, `productsEditor`, `designEditor`, `blogEditor` and `schedulesEditor`. Measured on a local
signed-in build (`e2e/signed-in/admin-scripts.spec.ts`; the English home's document after the whole suite, as CI reads it):

| Screen | Figure | Before (baseline of 18 November) | After |
|---|---|---:|---:|
| Every store and platform screen | Shared words handed, English / Norwegian | 33,723 / 47,103 | 16,617 / 17,180 |
| The store's home | Document, after the suite / on a fresh store | 215,768 / 165,942 | 189,565 / 134,689 |
| Orders | Document, after the suite | 202,030 | 188,197 |
| A product's editor | Document / words handed | 431,497 / 246,259 | 241,677 / 64,711 |
| The builder | Document / words handed | 606,658 / 319,551 | 468,351 / 182,315 |
| Platform home | Document | 123,638 | 106,804 |

The product editor's save answers 134,598 bytes (311,274 before), as it sends its words back (step 2.28). The shared words miss the
plan's 15.5 KB (16 KB in Norwegian): `common` and `shell`, which every screen reads, are 15 KB together today. The words baseline
(`admin-words-handed.baseline.json`) fell from 13,219,401 to 10,881,284 bytes handed in English over 231 sites. The shared words are
held at the figure reached (`SHARED_WORDS` in the spec: 16,617 and 17,180 bytes). Then the screens' own areas were cut the same way
(integrations, settings, support settings, analytics' export, campaigns, the platform's wizards, staging, the media library, menus,
imports, the forms editor): 6,132,124 bytes over 216 sites, and 3 sites still hand over 50 KB at more than 1.25 times what their parts
name (the theme shell, whose parts the scan cannot see, Work's layout and an order's page).

**Three stray imports go (13 November 2026, bloat review step 0.9).** Three imports put 481 KB on 432 of 449 admin routes: the session
listener and every upload imported the Supabase client (`GoTrueClient`), the shortcut sheet took the page builder's English through
`typingIn()`, and the gated layout's service worker took zod through the push schema; sign-in's English sat in the shared text module and
the layout handed every screen the `setup` area, which no client part reads. Now the client arrives by `import()` once the page is idle
(at most 2 s after it) or when an upload is pressed (`uploadToSignedUrl()`, `src/lib/supabase/signed-upload.ts`), the public settings are
checked without zod (`src/lib/public-env.ts`), and sign-in's words live in `sign-in-text.tsx`. From the build's route statistics
(`docs/audits/bloat-review-2026-11/scripts/markers.mjs`), raw first scripts:

| Route or marker | Before (11 November build) | After |
|---|---:|---:|
| `/admin/[store]` | 1,194,862 bytes | 682,999 bytes |
| The median admin route | 1,152,953 bytes | 641,331 bytes |
| Routes holding `GoTrueClient` | 432 | 0 |
| Routes holding `ZodError` | 432 | 159 |
| Routes holding the builder's `Set for {size}` | 423 | 39, all the builder's own |
| Routes holding sign-in's two-step sentence | 456 | 2 (`/admin/account`, the two-step set-up) |

Counted from the HTML the server sends (`admin-scripts.spec.ts`), with the budgets lowered to the new figures plus about 4 %:

| Screen | Before (10 November) | After | Budget |
|---|---:|---:|---:|
| The store's home | 1.28 MB | 0.78 MB | 0.81 MB |
| Products | 1.26 MB | 0.74 MB | 0.78 MB |
| A new product (the editor) | 2.22 MB | 1.87 MB | 1.95 MB |
| Orders | 1.28 MB | 0.76 MB | 0.80 MB |
| Pages (the list) | 2.09 MB | 1.74 MB | 1.82 MB |
| A page in the builder | 3.34 MB | 3.14 MB | 3.27 MB |
| Settings | 1.23 MB | 0.72 MB | 0.75 MB |

The rule: the signed-in frame's client parts import no schema, no SDK and no catalogue at their top: a helper they need lives in a file
without them (`src/lib/typing-in.ts`, `src/lib/public-env.ts`, `src/lib/push-schema.ts`, `admin-service-worker.tsx`, `sign-in-text.tsx`),
and the Supabase client arrives by `import()`.

The admin fetches a link's page when it is pointed at, not when it is in view (bloat review step 0.13, `AdminLink`). Router prefetches in the 3 s after load, held by `e2e/signed-in/prefetch.spec.ts` (home 28 before, product editors on the Products list 8 before): home 0, orders 8 (none an order or customer row), products 8 (none a product's editor), pages 6, settings 16, a product's editor 2, the builder 0, the platform home 0 (its two section links are AdminLinks too); hovering a rail link 2.
Since bloat review step 2.6 all eight screens make 0 (the orders list's new-draft link, the products and pages lists' toolbar links and the
product editor's way back are AdminLinks; 2, 2, 4 and 2 before it).

Every place the admin hands words to the browser (each `adminTexts()` call and `<AdminAreas>`) is in `src/components/admin/admin-words-handed.baseline.json` with the bytes
handed in English and Norwegian and the bytes its client parts name (229 sites on 17 November 2026, 80 handing over 50 KB). A site may not hand more than its
baseline (200 bytes of room) or an area no client part under it names (`src/components/admin/admin-words-handed.scan.test.ts`). Rewrite the baseline with
`WRITE_ADMIN_WORDS_BASELINE=1 pnpm exec vitest run src/components/admin/admin-words-handed.scan.test.ts`: it only lowers a site's bytes and shortens its
`unnamed` list. Named is counted from source, by static import, not what a browser reads at load: `e2e/signed-in/admin-scripts.spec.ts` (step 1.5) is the
browser's cross-check on five screens.

Five signed-in screens are held in English and in Norwegian (bloat review step 1.5, `e2e/signed-in/admin-scripts.spec.ts`,
`e2e/signed-in/admin-handed.baseline.json`; two Norwegian accounts sign in through the Auth stand-in, `accounts.admin_locale = 'nb-NO'`).
Each has three figures. The document is the server's HTML. The words handed are the bytes of the `texts` objects `AdminAreas` gives
`AdminTextProvider`, read from the flight payload in the document. The script by idle is every script the page fetched until three quiet
seconds. The first product and the first page are the store's first by creation, then by handle and slug (a store's rows share a
`created_at`). A save's answer is the response to the server action that carries the changed title, on the product editor and the
builder, for the English owner. The day's figures (18 November 2026, the largest of several runs, the baseline):

| Screen | Language | Document | Words handed | Script by idle |
|---|---|---|---|---|
| Store home | English | 215,768 | 67,199 | 953,731 |
| Store home | Norwegian | 205,204 | 82,220 | 953,731 |
| Orders | English | 202,030 | 33,723 | 939,235 |
| Orders | Norwegian | 189,524 | 47,103 | 939,235 |
| A product's editor | English | 431,540 | 246,302 | 1,379,355 |
| A product's editor | Norwegian | 452,922 | 268,191 | 1,379,355 |
| The builder | English | 606,720 | 319,588 | 3,179,230 |
| The builder | Norwegian | 632,988 | 346,167 | 3,179,230 |
| Platform home | English | 123,368 | 33,723 | 896,262 |
| Platform home | Norwegian | 138,023 | 47,103 | 896,262 |

A save's answer: the product editor 311,274 bytes (it sends the words again, which step 2.28 takes out), the builder 1,122.
The document is streamed, so a screen's loading skeleton is in it or not by timing: it varies by about 1% between runs; the admin is rebuilt daily, so the spec allows
5% over the baseline for the document, the script and a save, and max(2,000 bytes, 5%) for the words (a whole area handed is 20 KB or more). The English owner's home and orders documents grow
with what the specs before them made in the store (188 KB and 174 KB alone): their figures are what CI sees after the whole suite. A fall is a note: lower the baseline in the
same change (`E2E_MEASURE=1` prints them), and a figure that must rise is the owner's call.

## What a server route loads, and what holds it (bloat review step 1.8)

Four guards hold what a server entry loads and carries, from the numbers of 18 November 2026. Three rules keep them low. A route
imports a helper from the file that defines it, never through a feature's module. A package or module most requests do not need is
loaded with `import()` where it is used. A feature's readers do not import its writers.

The files each entry reaches by static value imports (`node scripts/route-load.mjs`; `import()` is not followed, and a client
component's own imports are left out):

| Entry | Files reached | Forbidden modules it reaches today |
|---|---|---|
| proxy | 325 | admin-messages, ai.ts, auth.ts, pages.ts, seo.ts |
| start hook | 1 | none |
| health | 13 | none |
| beacon-visit | 116 | admin-messages |
| beacon-touch | 116 | admin-messages |
| beacon-speed | 130 | admin-messages |
| beacon-own-speed | 118 | admin-messages |
| beacon-recommendation-events | 112 | admin-messages |
| shop-tiles | 320 | supabase-js, admin-messages, auth.ts |
| store-layout | 596 | none |
| store-home | 488 | none |
| store-product | 886 | none |
| admin-store-layout | 1,070 | none |
| admin-orders | 1,078 | none |
| platform-admin-layout | 1,067 | none |
| platform-admin-home | 1,064 | none |
| site-front-page | 488 | none |
| docs-feedback | 282 | none |

The largest import cycle in `src/server` is 23 files, and one route handler reaches over 1,500 files: the reminders job
(1,502, with its reason in `src/server/route-load.baseline.json`). The cold-start helper (step 1.16) added two files to each entry
that reaches it, three to health, which now reaches the log.

### The proxy imports leaf readers only (bloat review step 2.20)

`src/proxy.ts` runs before every page and prefetch, so it imports six small reader files and nothing else of `src/server`:
`store-facts.ts` (a store's few-second facts and the private-mode gate), `redirect-resolve.ts` (the shape of a store's addresses and
the lookup of an address with no country), `not-found-record.ts` (a missing address counted for the 404 report), `holding-read.ts`
(held domains), `site-switch-read.ts` (Kaizena Flow's site served from its store) and `experiments-running.ts` (running A/B tests),
beside `private-secret.ts` and the cold-start note. The rule: a feature's cached reads and tag names live in a reader file that
imports the database client, typed-rows, the log, the short memory (`src/server/short-memory.ts`, which shares a read in flight) and
pure `src/lib` code; the feature file keeps the writes and imports the reader, never the other way; a reader never imports `auth.ts`;
tag names live in `src/lib/cache-tags.ts`, which imports nothing. `route-load.graph.test.ts` holds the proxy to 120 files and forbids
it auth, pages, catalog, stores, seo, stripe, permissions, customers, the page model, the schema, the admin's words, sharp and Stripe.

| The proxy | Before (18 November) | After (19 November, local build) |
|---|---|---|
| Source files reached | 321 (1,309 when the review began) | 57 |
| Chunk bytes listed at start | 2,200.9 KB | 572.2 KB (budget 1,024 KB) |
| Traced beside it | 60.7 MB | 2.1 MB |
| Cold load, median of five | about 290 to 330 ms beyond a function that does nothing | 145 ms, 3 ms under `/api/health`'s 148 |

### Page reads apart from page writes (bloat review step 2.21)

The reads of published pages are in `src/server/page-reads.ts` (the site's cached reads, the cards of a grid and a blog's feed, the
All products and role pages), which imports the database client, the tag leaf, the page model, the media library's alt texts and pure
`src/lib` code, and never `src/server/pages.ts`. `pages.ts` keeps the writers, imports the few helpers they share from the reader and
re-exports every read for its tests; a file that only reads pages imports the reader, and one that only needs a tag imports
`src/lib/cache-tags.ts`. The page renderer (`src/components/page-article.tsx`) may not reach `pages.ts`, `design-presets.ts`,
`page-ai.ts` or `src/lib/signature/`: the one path it had went through the content types' reads, which now have their own file
(`src/server/content-types-read.ts`, re-exported by the writer `content-types.ts`). `route-load.graph.test.ts` holds both entries:
`page-reads` at 130 files or fewer with `pages.ts`, `auth.ts`, `design-presets.ts`, `page-ai.ts` and `src/lib/signature/` forbidden,
and `page-article` with the four forbidden.

| Files reached by static value imports | Before (19 November) | After |
|---|---|---|
| Reading a page | 183 through `pages.ts` (1,307 on 12 November) | 72 (`page-reads.ts`) |
| The page renderer (`page-article.tsx`) | 467, `pages.ts` among them (1,396 on 12 November) | 430, none of the four |

The cut moved the admin's client chunks, though it changed server imports only. The root admin layout had reached, through
`getPlatformFavicon()` and `pages.ts`, server components that draw `AdminLink` and Lucide icons, so Turbopack put the link wrapper
(with `PolicyLink` and next/link) and Lucide's icon base among the root layout's client references, in the chunk every admin route
loads. Without that path each layout's and page's own first chunks took a copy: 459 of 482 admin routes grew by a median of 12.6 KB
(CI run 1732). The root layout now imports `src/components/admin/shared-client-parts.ts`, which names them on purpose
(`shared-client-parts.scan.test.ts`); on a local build the admin routes fell by a median of 10.5 KB, 481 of 482.

### A store read without the Stripe SDK or the block schemas (bloat review step 2.22)

Two rules hold what reading a store loads. A store is read without the Stripe SDK: which payment modes Kaizena Flow has comes from
`src/server/stripe-keys.ts` (step 0.6), so `src/server/stores.ts` and the five beacons may not reach `src/server/stripe.ts` or the
`stripe` package. `stores.ts` reaches no file that defines a block schema: a theme's part styles (spacing, border, corners, shadow,
colour, the per-size overrides and `themeElementSchema`) live in `src/lib/part-styles.ts`, a leaf that imports zod, the
typography schemas and `src/lib/content-width.ts` and never `page-content.ts`; the role names come from `src/lib/page-role-copy.ts`,
the reserved addresses from `src/lib/reserved-slugs.ts`, and `mapChildBlocks()` from `src/lib/block-walk.ts` (type-only imports of
the page model). `page-content.ts` re-exports every moved name. `route-load.graph.test.ts` holds the entry `stores` and the beacons
to it; the speed beacon still reaches the page model through the heat tags' running tests (`signal-tags.ts` imports
`runningExperiments` through `experiments.ts`), kept as its exception.

| Measured on a local build (`next analyze --output`, `server-graph.mjs`) | Before (main, 19 November) | After |
|---|---|---|
| `/api/visit` and `/api/visit/touch`, server modules (KB) | 461 (891) | 431 (797) |
| `/api/visit/speed` | 477 (919) | 477 (914) |
| `/api/visit/speed/own` | 463 (896) | 433 (802) |
| `/api/recommendations/events` | 457 (877) | 426 (784) |
| `/s/[store]/[market]` | 1,534 (4,994) | 1,538 (4,995) |
| `src/server/stores.ts`, files reached by static imports | 102 | 72 |

No beacon loads a module of the `stripe` package. The store home is still over its bar of 1,500 modules and 4.0 MB: the admin's
words (`src/lib/admin-map.ts`, `src/lib/admin-messages/`), the AI manager's tools (`owner-tools.ts`, `owner-assistant.ts`) and the
Supabase client are loaded with it, which other steps of the plan own.

### The product taxonomy beside the functions that read it (bloat review step 2.23)

The taxonomy's five data files (12.7 MB) are traced only beside the functions that reach `src/server/product-taxonomy.ts`.
`next.config.ts` has no include for them: Turbopack's trace follows the reader's reads, each a literal
`path.join(process.cwd(), "src/data/product-taxonomy", "<file>")` (`product-taxonomy.scan.test.ts` holds the form). An exclude would
not have done it: in Next 16.4 Turbopack applies `outputFileTracingExcludes` only to the modules it traces, never to the files an
include adds (`crates/next-api/src/nft.rs`, v16.4.6). After a build, `node scripts/trace-sizes.mjs --check` (CI's e2e job) also
fails when one of eleven routes that read the taxonomy on purpose (`TAXONOMY_ROUTES`: the product page, the store home, a
category, search, the admin's product editor, new product and import, the AI manager, the admin API, the feeds, the dispatcher)
lacks a file. A new route that reads the taxonomy or draws a picture needs nothing by hand: the trace follows its imports. Sharp
was already traced only where it is reached, `next/og` included.

| `node scripts/trace-sizes.mjs`, local build, 891 traces | Before (the budgets on main) | After |
|---|---|---|
| Traces carrying the taxonomy | 883 | 757 |
| Traces carrying sharp | 776 | 749 |
| `/api/health`'s trace | 15.4 MB | 2.1 MB |
| `/api/visit`'s trace | 16.0 MB | 2.5 MB |
| Median trace | 64.8 MB | 52.9 MB |

Once the product page reads its category from the product's row (`products.standard_shown`, step 2.23's second change), `catalog.ts`
no longer imports the reader, and the traces carrying the taxonomy fall again, to 747.

## Cold starts in production (bloat review step 1.16)

Each server instance notes its first answer once, as the log line `instance.start` and a row in `commerce.instance_starts`: what the
instance was started for, the milliseconds to the end of `register()` and to its first answer, its memory and the bytes of
translated text read at start. Platform, Usage and limits, under `#cold-starts`, shows cold starts a day with the median and the
95th percentile by kind, against three lines: the proxy within 150 ms of the health check's median, a store page within 400 ms and
an admin page within 600 ms. Rows go after 30 days. Next's own loading of its route list is not in these figures;
`scripts/route-budget.mjs` times it on every build. A kind is recorded where its first request of an instance reaches it: the
`store` kind when an instance first answers `/api/shop/mine` (a store page is a static file since step 2.4), and Kaizena Flow's own pages (`site`)
are not recorded by this step.

The megabytes traced beside a function (`node scripts/trace-sizes.mjs`, after `pnpm build`; 883 traces):

| Trace | MB |
|---|---|
| median trace | 62.2 |
| the proxy's | 60.7 |
| the store home's | 56.3 |
| the store checkout's | 56.8 |
| `/api/health` | 14.8 |
| `/api/visit` | 15.3 |

Sharp is in 776 traces, the product taxonomy in 883, Chromium in 14, react-dom in 6, a file under `public/` in 4, a source map in
none.

The chunk bytes an entry lists at start, the largest route of each kind, and the server-reference manifest
(`node scripts/route-budget.mjs`):

| Kind | Largest route | KB |
|---|---|---|
| beacon | `/api/visit/speed` | 974.5 |
| api | `/api/cron/cart-reminders` | 10,346.2 |
| store | `/s/[store]/[market]/search` | 10,818.1 |
| pay | `/s/[store]/[market]/cart` | 10,818.6 |
| site | `/(platform-nb)/no/sign-up` | 10,626.3 |
| admin-store | `/admin/[store]/articles/[pageId]/preview` | 13,059.6 |
| admin-platform | `/admin/platform/ai/dream/[runId]` | 12,920.9 |
| proxy | `.next/server/middleware.js` | 2,200.9 |
| instrumentation | `.next/server/instrumentation.js` | 0.4 |

The manifest is 11,406,364 bytes with 1,566 entries (a median of 115 per route, 121 per admin route, 4 per beacon) and reads in
about 82 ms. There are 1,018 routing rules of the 1,600 held (Vercel's cap is 2,048). A cold load of `/api/health` takes about
110 to 145 ms, the proxy about 290 to 330 ms beyond a function that does nothing, and the store and admin pages about 300 to 380 ms.
Those timings moved by up to 30% between runs on a shared machine, so they are printed beside the bars (100 ms for a beacon and
the proxy, 300 for a store page, 450 for an admin page) and not held yet.

- `src/server/route-load.graph.test.ts` with `node scripts/route-load.mjs`: files per entry, the cycle, the forbidden modules and the
  handlers over 1,500 files, against `src/server/route-load.baseline.json`.
- `src/lib/dependencies.scan.test.ts`: every direct package has a line saying why it is here, and an importer.
- `scripts/trace-sizes.mjs` in CI's e2e job, after the build: the traced megabytes and what carries them, against `scripts/trace-budgets.json`.
- `scripts/route-budget.mjs` in CI's e2e job, after the build: chunk bytes per kind, the manifest, the routing rules, the cold loads and the words,
  against `scripts/route-budget.json`.

## Statements per screen (bloat review step 1.9)

The database client counts statements (`src/db/statement-count.ts`): off unless a test asks inside `countStatements()` or an admin render
is running, when it adds one to the render's count. `src/server/admin-statements.int.test.ts` holds what five screens send, through the
reads in `src/server/admin-screens.ts`, in `src/server/admin-statements.baseline.json` (17 November 2026, a store whose setup is done):

| Screen | Statements |
|---|---|
| Store shell (the layout's reads) | 4 |
| Store Home | 33 |
| Orders list | 6 |
| Products list | 5 |
| Platform Home (its layout and page) | 22 |

A change that adds a read to the shell or to a home screen raises its number in the baseline in the same commit and says why
(`UPDATE_BASELINE=1 pnpm vitest run --config vitest.integration.config.mts src/server/admin-statements.int.test.ts` writes today's
counts); one that removes a read lowers it. Waves are not held: they move with how many of the pool's five connections are free.
To count anything else, wrap it in `countStatements()`. Production's figure is the `admin.render` log line: `statements` and `ms`, nothing else.

### Scheduled work (bloat review step 1.10)

`src/server/query-budget.int.test.ts` runs each of the dispatcher's 78 jobs idle, the nine minute routes, the two daily routes and two
cold frames, on the freshly seeded database (the demo store and Kaizena Flow's) and again with 20 stores of 200 products and 30 pages
that have every per-store feature a job looks at switched on, and holds statements and rows read in the key `queryBudget` of
`src/server/ratchet.baseline.json` (17 November 2026, local Postgres 16):

| | Statements, 1 store | Rows read, 1 store | Statements, 20 stores | Rows read, 20 stores |
|---|---|---|---|---|
| The idle tick (78 jobs, one by one) | 143 | 387 | 595 | 54,235 |
| The minute and daily routes (11) | 286 | 2,877 | 526 | 13,870 |
| A store's cold frame (the demo store) | 5 | 54 | 5 | 444 |
| Kaizena Flow's cold frame | 17 | 47 | 17 | 329 |

What 20 stores add is held too (growth, which only falls; 0 once a job reads every store's work in one statement): one statement or more
per store in auto-archive (+20), the autopilot's budget alerts (+20), Tripletex and Fiken (+80 each, ten stores each), the knowledge base
(+160), the ledger (+50), repeating Work invoices (+40), the broadcasts route (+100) and the daily route (+140). The frames send no more
statements with 20 stores, but read more rows. Two rows-read figures are written down but not held: the VAT labels' check, which
follows the database's own clock (29 rows, 257 in the minutes around a country's midnight), and the broadcasts route's with 20 stores,
which moves by a few rows between runs; their statements are held.

## What one order writes (bloat review step 1.12)

`src/server/order-writes.int.test.ts` places one guest order of three lines in a store with only the shop on, and counts one visit, and
holds what they send and write in the key `orderWrites` of `src/server/ratchet.baseline.json` (17 November 2026):

| | Statements | Rows inserted | Rows updated | Tables written |
|---|---|---|---|---|
| One guest order of three lines (`placeOrder()`) | 46 | 9 | 1 | document_series, events, inventory_reservations, order_events, order_lines, orders |
| One counted visit (`recordVisit()`) | 5 | 3 | 0 | chat_usage, visits |

A trigger that writes a row, or a write to a table not in the list, fails the test with the table's name. The time each trigger of
`commerce.orders` took on one insert of an order row (one run, `explain (analyze, buffers)` inside a transaction rolled back, on a local
seeded database; written once, not held):

| Trigger | Time (ms) | Calls |
|---|---|---|
| integration_order_events | 3.211 | 1 |
| orders_store_open | 1.069 | 1 |
| orders_ad_consent | 0.815 | 1 |
| constraint orders_market_fk | 0.431 | 1 |
| constraint orders_held_by_accounts_id_fk | 0.353 | 1 |
| orders_exchange_rules | 0.277 | 1 |
| constraint orders_cart_fk | 0.264 | 1 |
| orders_delivered_source | 0.169 | 1 |
| constraint orders_customer_fk | 0.169 | 1 |
| store_event_order_paid | 0.129 | 1 |
| constraint orders_discount_code_fk | 0.105 | 1 |
| constraint orders_vat_check_fk | 0.075 | 1 |
| constraint orders_host_fk | 0.074 | 1 |
| constraint orders_subscription_fk | 0.069 | 1 |
| orders_copied_is_history | 0.043 | 1 |
| constraint orders_replaces_fk | 0.010 | 1 |
| constraint orders_exchange_fk | 0.007 | 1 |
| constraint orders_made_by_accounts_id_fk | 0.004 | 1 |

The insert took 9.2 ms in all, of which the triggers 7.3 ms.

## What one placed order costs (step 2.48)

The describe block *a placed order's ceilings* of `src/server/order-writes.int.test.ts` holds five ceilings on a store with only the shop
on (first figures 19 November 2026, local Postgres 16). A case that fails names its figure and asks to lower the cost or do code review
step 3.7 for that part; a ceiling is never raised.

| Ceiling | First figure | Ceiling | Case |
|---|---|---|---|
| The same statements with 10 and with 2,000 earlier orders (copies numbered `C-…`, D384) | 41 and 41 (a one-line order) | equal | (1) |
| Statements per added line | 41, 43 and 49 for 1, 2 and 5 lines: +2 a line | +2 a line | (2) |
| Trigger time, of the order's database time (`pg_stat_user_functions`, track_functions on) | 5.6 of 81.8 ms (7%) | under a fifth | (3) |
| A visitor's first page view of the day (`recordVisit()`) | 5 statements, 3 rows | 5 statements, 3 rows | (4) |
| Optional features' triggers on a shop-only store's paid order, warm connection | 1.44 to 1.88 ms (six runs) | under 2.9 ms | (5) |

Case 2's ceiling is today's figure, so one more statement per line in `insertOrderLine()` fails it. Case 4's is today's figure too (the
owner's rule from step 0.43): the store, whether the visitor is known today, the two rate-limit upserts of `takeNewVisit()`, which protect
the counts against a script and stay, and the visit's upsert; a repeat page view sends 3 and writes 1. Case 3 sums each trigger
function's total time, so a trigger fired inside another counts twice; it is skipped only where track_functions cannot be set.

The fifth line counts the trigger functions of bonus (`orders_bonus`), gift cards (`orders_issue_gift_cards`,
`payments_issue_gift_cards`, `orders_gift_card_payments`, `payments_gift_card`, `orders_gift_card_people`), affiliates
(`orders_affiliate`), creators (`orders_creator`, `payments_creator`) and bookings (`order_bookings_follow`); standing orders and
suppliers have no trigger on the order's tables, `payments_referral` is Kaizena Flow's own fee and `orders_deal_win` the CRM's. They run
when an order is paid. On a fresh connection they took 4.2 to 6.2 ms, as a function's first call there also compiles it and plans its
statements: a cold start of the connection, not a cost of each order. So case 5 places two orders and pays both on one connection, in one
transaction, as the checkout pays them (the payment row, then `complete_order_payment()`, constraints immediate as each of the checkout's
statements is its own transaction), and measures the second from `pg_stat_xact_user_functions`: 1.44 to 1.88 ms, of which the gift card
issue 0.67 to 0.98. Over 1.5 ms, so the ceiling held is today's worst plus a half (2.82, rounded up to 2.9) rather than the plan's 2 ms.

None of these functions returns early on the store's switch, and none may: with a feature off they still have work for a store that had
it on (cards already sold are still spent and refunded, D178's gift card words; credits held come back on a cancel, as bonus is never
blocked from switching off; an attributed order is rewarded when due, the comment in `affiliate_order_paid()`; creators have no switch;
`order_bookings_follow()` also confirms appointments, which are not the `bookings` feature). Even that unsafe gate, tried on a local
copy, left 1.7 to 2.6 ms on a fresh connection.

## Kaizena Flow's front page, served from its store (measured 12 November 2026)

The bloat review measured this page in the platform's own form (`/`, the `(platform)` route), which production stopped serving when the
switch of D484 went on; these are the figures of the store's form, read with `curl --compressed` twice from outside, after the deploy job
had requested the page itself (D575). Production ran `b357302`.

| Address | Status | Document, compressed (br) | Document, uncompressed | First byte, 1st request | First byte, 2nd request | x-vercel-cache (1st, 2nd) | x-nextjs-cache (1st, 2nd) | Script tags |
|---|---|---|---|---|---|---|---|---|
| https://kaizenaflow.com/ | 200 | 38,158 bytes | 346,565 bytes | 1.86 s | 0.42 s | HIT, HIT | none, none | 18 |

`cache-control` was `public, max-age=0, must-revalidate` on both. The deploy job's own first request after the deploy read
`x-vercel-cache PRERENDER` and its second `HIT` (CI run 1229).

## What a server route loads (bloat review step 0.4)

Two cuts made light routes light: `src/db/client.ts` no longer loads the Drizzle schema (it is drizzle-kit's source only, held by
`src/db/schema-import.scan.test.ts`), and `sameSite()`, `fail()` and `visitorKey()` are imported from the files that define them
(`src/lib/same-site.ts`, `src/lib/route-fail.ts`, `src/server/chat-turns.ts`), so a beacon no longer loads the chat's modules
(`src/server/beacon-imports.scan.test.ts`). Measured on a production build with `next analyze --output` and
`docs/audits/bloat-review-2026-11/scripts/server-graph.mjs`, 12 November 2026:

| Route | Server modules loaded with the route, before | KB, before | Modules, after | KB, after |
|---|---|---|---|---|
| `/api/visit` | 1,890 | 10,475 | 639 | 1,188 |
| `/api/health` | 308 | 1,155 | 259 | 418 |

The import walker (`scripts/import-reach.mjs`) counts the source files each of the five beacons reaches: 103 for `/api/visit` and
`/api/visit/touch`, 107 for `/api/visit/speed` and `/api/visit/speed/own`, 100 for `/api/recommendations/events` (1,308 before),
none of them reaching the chat, the AI, the admin's words or the schema.

Step 0.6 of the bloat review cut the import cycle of `src/server` (12 November 2026): six imports moved to where they are
called, two helpers (`bought`, `storeObligations()`) and the settings key (`encryptionKey()`) got files of their own, and which
payment modes Kaizena Flow has is read by `src/server/stripe-keys.ts`, which never loads the Stripe SDK. Measured with the import
walker and with `next analyze --output` and `server-graph.mjs` on a production build of `4a8f058`:

| Measure | Before | After |
|---|---|---|
| Largest import cycle in `src/server` (files) | 229 | 15 |
| Source files behind `src/app/s/[store]/[market]/page.tsx` | 1,419 | 616 |
| Server modules loaded with `/s/[store]/[market]` | 2,419 (11,944 KB) | 1,594 (7,619 KB); no module of the stripe package, no `theme-store.ts` |
| Server modules loaded with `/admin/[store]/orders` | 2,349 | 1,333 (6,701 KB) |

The 15 left are the AI manager's own (`owner-assistant.ts`, its tools, the Dream Factory, sign-up and retention). A count of
modules loaded is of the chunk files a route requires: the orders page requires a 608 KB chunk that Turbopack built with the AI
manager's tools beside modules the page uses, so `owner-tools.ts` is parsed there, though a cold load evaluates 1,258 modules and
not that one. Each built route and page is also loaded in a fresh process in CI (`scripts/cold-load-routes.mjs`), because a lazy
import changes the order modules load in: step 0.6's second commit made Mollie's webhook meet the provider list before the Mollie
provider was made, a 500 that neither the tests nor the deploy's page checks could see.

- A function used once from a heavy module is imported where it is called (`await import()`), and a small helper that many files
  need lives in a file of its own; the import walker's cycle figure may only fall.
- A heavy package is loaded where it is used, never at the top of a server module: `loadSharp()` (`src/server/sharp-load.ts`),
  `launchBrowser()` (`src/server/browser.ts`), `await import("opentype.js")`; `src/server/lazy-packages.scan.test.ts` fails on a
  static import of sharp, opentype.js, playwright-core, @sparticuz/chromium, mammoth or unpdf.

## The router's two settings (bloat review step 0.14, D592)

`next.config.ts` states both: `optimisticRouting: false` and `partialPrefetching: false`.

`optimisticRouting` is false because of the `@drawer/[...rest]` slot (the phone's cart drawer, D64). Next guesses a link's route
tree from a route of the same shape, and the guess never fills the slot's `rest` param (the TODO "This should never happen. Bail
out with null" in `node_modules/next/dist/client/components/segment-cache/optimistic-routes.js`), so the slot's segment is asked
for without end at /s/{store} addresses, about 165 requests a second. On the search page at 1440x900 that was 624 router requests
in 4 s and no end; with route guessing off it is about 55 and quiet. Production could not loop while stores are on their own
hosts, since behind a rewrite no shape is learned.

`e2e/prefetch.spec.ts` ('a store page goes quiet') holds it on four pages: fewer than 60 router prefetches in the 3 s after load
and none in the next 2 s. At each Next upgrade read `optimistic-routes.js` for the TODO; when it is gone, remove the flag and case
(a) of `src/lib/next-config-prefetch.test.ts`, and keep the e2e test.

`partialPrefetching` is false as a recorded choice: unset, Next treats it as false and prints a warning on every build and start,
and the next major release turns it on for everyone. Step 2.8 of the bloat review decides adoption by trial.

## What the router fetches ahead (bloat review step 2.6)

A link states what it may fetch ahead through `PolicyLink` (`src/components/policy-link.tsx`) or, in the admin, `AdminLink`; each takes one of
three policies. `e2e/prefetch.spec.ts` holds the counts per page.

| Policy | What it does | Links |
| --- | --- | --- |
| sight | Next's default: fetched when it scrolls into view | the cart link on phones, a header menu's top links, the first six product tiles of a listing (step 2.8, below), the site's sign-up button |
| intent | fetched when the pointer, a touch or the focus reaches it | the logo, search, account, wishlist, the bottom bar's home and account, footers (menu, cookies, withdrawal, legal pages), menu sub-links, the phone menu, builder blocks (`BlockLink`, step 2.7: a built page's tiles, buttons, pictures, icon lists and column links to an address of the app; a pay path, a file, a handler, a new tab or another site stays a plain anchor), every admin link (`AdminLink`) |
| never | not fetched ahead | countries, languages and currencies, links that leave their root layout, file links, the cart link from 768 px (a plain anchor) |
| sight, then intent | product tiles: the first six of a listing on sight, the rest on intent | `ProductGrid` and the store's own product list (`SIGHT_TILES` in `src/components/product-card.tsx`, bloat review step 2.8) |
| intent | swatches under a tile and category chips: intent | `GroupSwatches`, the category page's subcategory chips and the blog's term chips (step 2.8) |

A link states its policy through `PolicyLink` or `AdminLink` and `next/link` is imported only by them (ratchet count `directLinks`, in
`src/server/ratchet.baseline.json`: a new file may not import it, and the old ones move as they are touched). A server action that sets a
cookie or revalidates makes the router ask again for every link in view, so the number of sight links is also the cost of every such action.

Measured on 19 November 2026 on a phone, read to the footer (two runs, the same but where noted): the front page, a product page and a
content page 3 router requests each (19, 18 and 20 before), the listing 4 (20), the cart 5 (20); the first Add to cart 7 in the next 4 s (32
before), the second 0; the home at 1280 px 6 and 7 (47 on the phone home before step 0.12). The money path of `e2e/performance.spec.ts`: the
two-line cart 7 (15 before), the checkout 3 (18). Held at 6 on each phone page, 8 on the home at 1280 px and 10 after the first add (the
step's figures), and 9 and 5 on the money path (the count plus 2).

A 48-product category read to the end on a phone makes 15 router requests (the cart's 3 and 2 for each of the first six tiles; 47
with every tile on sight), held at 20 (`FULL_LISTING_MOST` in `e2e/prefetch.spec.ts`); focusing a later tile fetches it.

### The partial-prefetching trial (bloat review step 2.8)

20 November 2026, Next 16.4.6, local production builds of one commit: for each destination, one build without and one with
`export const prefetch = 'partial'` in its page file. Requests and decoded bytes are the router requests of the linking page
read to the end on a phone, plus those of touching the link where the link waits for intent; the ms are the median of three
presses, from the click to the destination's heading drawn. Every figure is copied from [the trial's raw
output](audits/bloat-review-2026-11/evidence/partial-prefetching-trial.md).

| Destination | Linking page | Requests before | Requests after | Bytes before | Bytes after | ms to heading before | ms to heading after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Product page | the seeded category, read to the end | 15 | 10 | 70692 | 20481 | 43 (second tile 43) | 40 (second tile 118) |
| Category listing | the store home, its footer link touched | 3 + 2 | 3 + 2 | 6471 + 8327 | 6471 + 8326 | 48 | 48 |
| Store home | a product page, its logo touched | 5 + 2 | 5 + 2 | 83865 + 81893 | 83865 + 81893 | 71 | 71 |
| Admin orders | the admin home at 1280 px, the rail's Orders pointed at | 0 + 2 | 0 + 2 | 0 + 9165 | 0 + 9164 | 332 | 333 |

Decision: the first-screen rule stands, no page sets `prefetch = 'partial'` and `partialPrefetching` stays false. Only the
product page changed: its six tiles share one shell (a third fewer requests, 71% fewer bytes), but the shell holds one tile's
product, the first fetched (the page reads its params outside a Suspense boundary), so the other tiles' heading waits for a
fetch (118 ms against 43; with the fetch held 1 s, 1098 against 52). Look again when the product page reads its params behind
Suspense, or at Next's next major release, which turns partial prefetching on for everyone.

## What is static (bloat review step 1.11)

`scripts/render-modes.mjs` reads the build (`.next`, no server) and holds, in `scripts/render-modes.baseline.json`, the compute mode, the
holes, the platform-wide tags and the revalidate time of twelve routes, and what the demo store's resume data keeps. CI runs it after
the build in the e2e job and fails on a regression or on a gain not yet written down (`node scripts/render-modes.mjs --write`).

<!-- render-modes:start -->
| / | static | 3 | 3600 | platform-navigation, platform-pages, platform-seo, referrals, site-from-store, template-store | yes |
| /docs | static | 0 | 3600 | platform-navigation | yes |
| /docs/owners/getting-started/create-your-store | static | 0 | 3600 | platform-navigation | yes |
| /themes | resuming | 4 | 3600 | design-presets, platform-navigation, platform-pages, platform-seo, referrals, site-from-store, store-starters | yes |
| /s/demo/no | static | 0 | 900 | catalog | yes |
| /s/demo/no/om-oss | static | 0 | 3600 | none | yes |
| /s/demo/no/blog/nye-produkter | static | 0 | 3600 | none | yes |
| /s/demo/no/products | resuming | 1 | 900 | catalog | yes |
| /s/demo/no/category/belysning | resuming | 1 | 3600 | catalog | yes |
| /s/demo/no/p/demo-keramikkopp | resuming | 1 | 3600 | buy-platform, catalog | yes |
| /s/demo/no/search | resuming | 1 | 3600 | none | yes |
| /s/demo/no/cart | resuming | 1 | 3600 | none | yes |
<!-- render-modes:end -->

A hole is a boundary that is not in the prerendered file (it streams at request time). What makes a page per-request: the cart cookie,
the country header, `searchParams`, stock, sign-in. The rule in one sentence: a new `cookies()`, `headers()` or `connection()` in a layout
or a shared part moves every page under it to per-request, and `scripts/render-modes.mjs` says so in CI.

Since bloat review step 2.4 nothing per visitor is in the store's frame: the cart's count, the saved products and the country suggestion
come from one small call, `/api/shop/mine` (`src/components/shopper-own.tsx`), made only when the marker cookie `kaizen_mine_{storeId}` is
there or the store sells in several countries. The home, built pages and the blog moved from resuming to static (holes 3 to 0), every
other store page lost its three frame holes, and the manifest's resuming routes fell from 268 to 211 (static 570 to 627); /s/demo/no
answers `x-nextjs-cache: HIT` with `s-maxage=900`. An add answers the cart's count and redraws the page only when the form sends `redraw`
(a basket note, the cart's upsells): an add with a cart already made is one request with a 104-byte answer (16 requests and 193 KB
before; the first add, which sets the cart's cookies, still makes Next empty its router cache: 13 requests). Measured locally: a store
page with a further dynamic segment (a built page, the blog) that Next regenerates at run time (its revalidate time passed, or a tag was
refreshed) is served per request again, with its metadata at the end of the body; the home stays static.

## A store on a launch theme (bloat review step 1.6)

The twelve measured store pages are the bare template: no font file, one-row pages, pictures of about 1 KB. CI's e2e job therefore seeds
a store that wears Orbit whole before the build (`pnpm seed:themed`, `e2e/seed/themed-store.seed.ts`): the content packs and launch
themes synced, Orbit's own content photographed and published, and a demo store made from them (`createDemoStore()`, `publishDemoStore()`)
at `e2e-orbit`. Two things CI cannot reach are fixtures: the two families' latin files (`e2e/fixtures/fonts`, Unbounded and Manrope, OFL)
are installed through the real `installFont()`, and the theme's art is resized with sharp into `public/e2e-orbit/` (1,600, 800 and 480
px, never committed) and kept in the media library as an upload would leave it; each photograph Orbit's pack needs is its slot's art.
`e2e/performance.spec.ts` (describe *a store on a launch theme*) holds the figures below, each its first measure plus 5 %.

Measured on the build of 18 November 2026, on a fresh seed and again after the whole end-to-end suite had run (the same figures: the
other specs do not touch this store). Characters for the document, payload, main and style text; bytes for the rest.

| Page | Document | Payload | Main | Style text | Identical rows | Stylesheets | Font files | Pictures at 3x | Router requests |
|---|---|---|---|---|---|---|---|---|---|
| Home `/s/e2e-orbit/no` | 216,550 | 154,157 | 22,855 | 17,224 | 0 | 3: 217,830 + 584 + 576 | 2, 75,740 | 142,903 on 4G (the test pins it; CI's runner reads as 3G, where two more tiles load: 223,837), none too wide | 21 |
| Product `/p/andromeda` | 177,126 | 124,513 | 10,533 | 11,376 | 0 | | | | |
| Listing `/products` | 192,183 | 136,556 | 10,444 | 11,373 | 0 | | | | |
| About `/about` | 153,134 | 112,645 | 4,833 | 12,709 | 0 | | | | |

Both font files are preloaded, in the response's `Link` header (`FontPreloads`). Orbit's home as stored is 11,384 bytes, over the
review's bar of 11,100 (its six pictures carry the test server's full address), and is held at 11,400. The first request after the
server starts streams the product page in another order, tens of characters apart; later runs are identical. After phase 2 these pages are
judged against the bare store's bars (`docs/rules/budgets.md`).

## Server budgets (bloat review step 1.11)

`scripts/server-budget.mjs` is the one home of a store page's statement count: on the built app it counts the statements of the demo
store's pages, a large store's pages (500 products, cold and warm, with a price break on one product and a producer scheme on another) and the cart and checkout of a guest with three lines, from the
server's own statement log (`STATEMENT_LOG=1`, `src/db/statement-log.ts`; CI's Postgres image does not load `pg_stat_statements`). A page is requested once unmeasured, then twice more with the smaller count kept (a cached read whose lifetime ends repeats its statement on one request); the cache-event flush and the house store's lookup are left out as noise. Each
budget is today's count plus 2 in `scripts/server-budget.json`; CI runs it after Playwright and fails the e2e job for a page over its max.
To lower a budget after a change that cut statements, run `node scripts/server-budget.mjs --write` (it never raises one).
A shop-only store's pages scan only the tables listed in ratchet.baseline.json's shopJourney (`src/server/shop-journey.int.test.ts`,
bloat review step 1.12), none of a switched-off feature beyond its named exceptions, and read no more rows with 19 other stores.

<!-- server-budget:start -->
| Page | Statements | Max | Bar |
|---|---|---|---|
| home | 0 | 2 |  |
| product | 1 | 3 |  |
| all products | 1 | 3 |  |
| category | 1 | 3 |  |
| search | 6 | 8 |  |
| home with a cart cookie | 1 | 3 |  |
| cart with three lines | 30 | 32 | 12 or fewer |
| checkout at its first step | 2 | 4 |  |
| large store home | 0 | 2 |  |
| large store product | 3 | 5 |  |
| product with price breaks | 3 | 5 |  |
| product with producer schemes | 2 | 4 |  |
| large store home, cold | 22 | 24 | made once, then served static (step 2.4) |
| large store product, cold | 6 | 8 |  |
<!-- server-budget:end -->

## Whose classes the stylesheet holds, and the style text owners add

The one stylesheet carries every audience's classes. A class's audience is decided by which root layouts can reach a file that
names it: store pages (`src/app/s`); Kaizena Flow's own pages, docs and theme previews; the admin; and the on-site editor, meaning
files of `src/components/admin` and `src/components/inline-edit` that a public page reaches.
`docs/audits/bloat-review-2026-11/scripts/stylesheet-audiences.mjs` (after the build, in CI's e2e job) prints the bytes each
audience alone names.

First reading, 18 November 2026, site sheet `2mz2so11lb4_y.css` (218,793 bytes raw, 29,059 Brotli, one sheet for every audience):

| Audience | Rules | Raw bytes | Brotli bytes |
|---|---|---|---|
| store | 766 | 49,251 | 7,127 |
| platform-only | 114 | 9,396 | 1,609 |
| editor-only | 164 | 10,505 | 2,098 |
| platform+editor | 48 | 3,388 | 985 |
| admin-only | 925 | 69,838 | 8,195 |
| unknown | 264 | 27,607 | 4,113 |

No store page can draw 23,289 bytes raw and 3,903 Brotli (platform-only, editor-only and platform+editor together); only admin
files name 69,838 bytes raw. The review's figures of 12 November were 13.8 to 16.2 KB and 51.8 KB: the sheet has grown since.

The tolerance: at most 15 KB raw of classes no store page can draw once step 2.11 has split the sheet. Until then the script
fails above 25,000 bytes raw or 4,200 Brotli, today's figure with room for the daily work; step 2.11 takes the lines to 17,000 raw
and 2,000 Brotli, and then fails on any admin-only class in the site's sheet. A third stylesheet for stores is weighed only above
the tolerance.

An owner's own CSS is limited per sheet: 50,000 characters for each of the store's, the header's and the footer's (CSS_MAX in
`src/lib/custom-css.ts` and the database checks). The limit is not on the sum (the owner, bloat review step 1.23); the 20 KB line
below watches the sum.

The style text each store adds to every document (its own, its header's and its footer's) is read on Platform, Usage and limits
with `?reading=styles`. First reading: to be taken on production before opening.

| Store | Style text bytes | Published pages | Pages with motion |
|---|---|---|---|
| | | | |

Median, stores above 20 KB and the share of published pages with motion: to be filled in with the first reading.

The three lines, each a trigger:

- Above 10 KB for the median store: look again at serving owners' CSS as an external stylesheet.
- Any store above 20 KB: its sheets move to one external hashed stylesheet, and the page marks that store.
- Under half of published pages using motion: build step 2.49 (motion.css loaded only where a page uses it).

Read again each quarter, with the migrations' squash.
