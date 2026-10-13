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
