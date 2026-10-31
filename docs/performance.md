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
- **A client component that only some pages draw is loaded where it is drawn.** Turbopack puts every client component a route's
  server code imports into one group of scripts that every page of the route loads; a server-side `import()` does not split it
  (tried). So the shop's forms (`components/lazy/shop.tsx`), the page components' interactive parts (`lazy/blocks.tsx`) and the
  extras (`lazy/extras.tsx`) are `lazyView()` stand-ins: the server still draws the component into the page, and React keeps that
  HTML while the script loads; one that wraps the server's content shows it meanwhile (`showChildren`). The chat's button and a
  referral capture wait until the browser is idle; the consent manager and the owner's necessary code do not. A new client
  component that is not on most pages is added to the right `lazy/*.tsx` and imported from there. Not one a visitor came to the
  page to use at once, as what is typed or pressed before a part's own script runs is lost: the site's forms
  (`e2e/components.spec.ts`), a booking's changes (`e2e/bookings.spec.ts`), the cart's checkout button with its company and VAT
  fields (`e2e/vat-reverse-charge.spec.ts`), the discount codes, the gift box, the delivery choice, a listing's filter button
  (`e2e/custom-fields-ranges.spec.ts`) and signing in stay in the
  first scripts. `next/dynamic` (not
  `React.lazy`) is what lets the server ask for a drawn part's script with the page's: with `React.lazy` alone, galleries, tabs
  and filters answered only a moment after the rest of the page, and 27 end-to-end tests failed.
- **A visitor's browser gets only the interface text its client components read (D212).** Every text of the four hand-written
  languages is 270 KB (`src/lib/messages/{nb,sv,da,en}.ts`), which `t()` in `i18n.ts` gives the server, emails and the admin. A
  visitor's client components read `browserText()` (`src/lib/browser-text.ts`): the few texts they use, in
  `messages/{lang}-browser.ts` (about 4 KB a language), which each language's whole module spreads in, so a text is written once.
  The withdrawal function's words are `messages/{lang}-returns.ts`, read through `returnsText()` by its page alone. These load
  with the page's first scripts: a first try loaded the page's language on its own and made the page wait for it before waking
  up, and a press in that moment was lost (`e2e/gallery.spec.ts`). A new text a visitor's client component reads goes in each
  `*-browser.ts`; the scan test fails for a visitor's component that reaches `lib/i18n`, `lib/email-text` or a whole language. A
  language translated by AI lays the catalogue's texts over these (`UiTexts`, which also keeps them for `returnsText()`).
- **Font stylesheets are kept for a year** (`immutable`); a change to how one is written raises `FONT_CSS_VERSION`, which is in
  every stylesheet's address.

After D212 the demo store's front page, built locally, loads 206 KB of scripts (compressed; 266 KB after D211, 469 KB before) and
scores 92 to 96 for performance on a phone.

Not changed: Next's own polyfills (14 KB, flagged as legacy JavaScript; the audit carries no weight and the browsers Next targets
need none of them), React (70 KB) and the router (35 KB).

## Checking

- `pnpm perf` builds nothing: after `pnpm build` it starts the app and runs Lighthouse on the demo store's front page, or on any
  address given (`pnpm perf https://kaizenalabs.com/`), for a phone and a computer, and lists the scores, the measures and the
  largest scripts; `--min=90` fails below a score.
- `e2e/performance.spec.ts` holds what does not wobble: the demo front page's first scripts under a byte budget, without zod, the
  lightbox or the checkout's payment form; no language's whole interface text; the first grid's and the first row's pictures eager and the next ones lazy; a blurred
  background from its small copy; an embedded frame named.

Scores move a few points between runs, and a page's own content (large pictures, many components) decides much of it.

## First scripts per route (PSI PERF-11, 30 October 2026)

Every route a visitor or a person signing in meets first has its own first-scripts budget in `e2e/performance.spec.ts`
(`FIRST_SCRIPTS_BUDGETS`, raw bytes, about 5 % above the build measured). Measuring them found Kaizena Flow's sign-up and status pages
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

**First scripts, signed in (31 October 2026).** `e2e/signed-in/admin-scripts.spec.ts` holds seven screens to budgets, counted from the
HTML the server sends (what a page has loaded by the time it is looked at grows with what it does after, and moved by 1.7 MB between two
runs). Raw, before compression:

| Screen | First scripts | Budget |
|---|---:|---:|
| The store's home | 3.02 MB | 3.15 MB |
| Products | 3.02 MB | 3.15 MB |
| A new product (the editor) | 3.71 MB | 3.87 MB |
| Orders | 3.02 MB | 3.15 MB |
| Pages (the list) | 3.59 MB | 3.74 MB |
| A page in the builder | 4.70 MB | 4.90 MB |
| Settings | 3.00 MB | 3.13 MB |

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
catalogue.
