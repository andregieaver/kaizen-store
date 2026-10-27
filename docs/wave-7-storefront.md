# Wave 7: storefront and international (decisions D335 to D344)

The contract for wave 7 of `docs/parity-plan.md`: what a store sells in each country and at what price, how fast its pages are and how
its checkout looks, what each country sees and on which address, a store that is not open to everyone yet, changes that happen by
themselves at a set time, blogs in depth, producer-responsibility registers, customs and duties, and themes from outside Kaizena Flow.
Written on 2026-10-27 from the sixteen rows of `docs/parity/rows` marked wave 7 (as re-rated through 2026-10-26), the plan, CLAUDE.md
and a read of the code. Code, tests and texts follow this file; a unit that must change course says so here first.

**What exists today (read in the code).**

- **Prices per country** (D109): a variant's price is entered by hand per market (`commerce.prices`, one current row per variant and
  market, written only by `commerce.set_price`, with the 30-day reference read from `commerce.current_prices`). Amounts are kept in the
  country's own currency and converted when a view shows another (`store_currencies.rate`, `round_to`). A bulk change by a percentage or
  an amount per market exists, previewed and undoable (D165), but no standing rule derives one country's prices from another's.
- **What is sold where**: a variant is sold in a market only while it has a current price there. "Leave the price empty to not sell there"
  is the editor's own advice, so taking a product out of one country loses its price. The Countries switch (D178) hides whole countries;
  exclusive price lists (D321) hide products from everyone outside a group or company, never by country. Twenty-three server modules read
  `commerce.current_prices`, the shopper's reads and the admin's alike.
- **Pictures**: compressed in the browser at upload (D213: WebP or AVIF, at most 1600 px, a 480 px copy). A product card draws one picture
  `unoptimized` without a `srcset` (`src/components/product-card.tsx`); background pictures carry the two copies (D211). `pnpm perf` is a
  developer's Lighthouse run; `e2e/performance.spec.ts` holds the first scripts' bytes and the eager first pictures. No speed report for
  owners.
- **Checkout look**: the page around the payment form is the store's (theme, header, footer, builder pieces, custom CSS); Stripe's form is
  drawn by `appearance()` in `src/components/checkout-form.tsx` with fixed colours, a system font and a 6 px radius.
- **Markets on the page** (D179 phase 4): a row, column or block can be shown only for chosen countries, languages or currencies
  (`visibility.show`), but a whole page cannot, and product texts and menus vary by language only. A language may have a domain of its own
  (D313); a country may not. The visitor's country (`x-vercel-ip-country`) is read only on the store's country chooser, which suggests and
  never redirects.
- **A store not open yet**: noindexed and left out of sitemaps, llms.txt and feeds until setup is finished (or with `seo.hidden`), but
  anyone with the address can look. No password, no coming-soon page, no way to hide an open store again.
- **Time**: pages, headers, footers and themes are draft or published, never scheduled; A/B tests, campaigns, codes and broadcasts start
  by themselves, and theme installs that follow updates are updated by the five-minute job (D245). A page keeps its versions (D305); the
  live look's saves in Design settings and the builder's Theme tab do not. The only signed preview links open one replicator job's draft
  (`replicate-token.ts`, D150) or one page's draft for the AI manager's look (D310), neither offered to owners.
- **Blog**: one blog per store at `/blog` (D57, a page role, D112), articles are pages of type `article` with a free-text author name,
  categories, tags, `Article` JSON-LD, translations and versions; no second blog, author records, comments, feed or scheduled article.
- **Producer responsibility**: products are tagged with schemes (`PRODUCER_SCHEMES`, `product_schemes`), registrations have a table
  (`producer_registrations`) and the view `commerce.missing_registrations` lists what is unregistered, but there is no screen to enter a
  registration, nothing reads the view and nothing stops a sale.
- **Customs**: HS code and country of origin per variant (`product_variants.hs_code`, `origin_country`), in the editor, the CSV and the AI
  manager's tools; IOSS for low-value consignments into the EU (D157). Nothing prices a duty, declares a consignment or says who pays.
- **Themes**: the theme store (D241 to D287): themes made by Kaizena Flow's platform admins, free or paid (D286), presets, demo content,
  versions, updates applied by the five-minute job to installs that follow them (on by default, D245). Paid themes are invoiced through
  Kaizena Flow's Stripe billing, proven only against the repository's stand-in for Stripe.

## 1. The units, in the order they are built

| Unit | Decision | What | Rows it moves |
|---|---|---|---|
| A | D335 | Markets in depth: a product or variant switched off in one country without losing its price; standing market price rules (a base country, a percentage, rounding, before or with VAT) with a fixed price overriding them | `international.market-specific-catalogs` (3), `international.fixed-per-market-prices-and-adjustment-rules` (4) |
| B | D336 | Speed: pictures at the visitor's device size with `srcset`, a speed report for owners from what visitors measured and lab runs, a page-weight and TTFB budget in CI | `storefront.page-speed-cdn-image-optimisation-report` (4) |
| C | D337 | Checkout branding: Stripe's payment form in the store's colours, font and corners, light and dark, and one *Checkout look* card | `checkout.checkout-branding` (3) |
| D | D338 | Each country's own: a page limited to chosen countries and out of their sitemap, product texts and menus per country over the language, the builder showing whose view it is, a domain per country, a dismissible country suggestion | `international.market-specific-content-adaptation` (2), `international.domains-and-subfolders-per-market` (3), `international.geolocation-suggestion` (2) |
| E | D339 | Private mode: a password and a landing page built in the builder, crawlers kept out, staff preview, an open store hidden again | `storefront.storefront-password-or-pre-launch-page` (2) |
| F | D340 | Changes by the clock and links to share: scheduled publish of a page, header, footer or theme with an automatic way back, preview links that expire, the live look's saves kept as versions | `storefront.scheduled-storefront-changes-with-auto-revert` (2), `storefront.version-history-restore-shareable-preview` (3) |
| G | D341 | Blogs in depth: several blogs, author records, an Atom feed per blog, comments held for moderation with a spam check, scheduled articles (through F) | `storefront.blog-multiple-blogs-authors-comments-rss` (3), `customers.blog-and-content-marketing` (3) |
| H | D342 | Producer responsibility: registrations entered by owners, a product under a scheme with no valid registration not sold in that country, the number shown where the law asks | `international.packaging-and-epr-registers` (3) |
| I | D343 | Customs and duties: an estimate of duty and import VAT for a destination outside the EU from a rates table the platform keeps, DDP or DAP per country, customs lines on a carrier booking | `orders.customs-and-duties` (3) |
| J | D344 | Themes from outside: owners and designers submit a theme, a review queue, an author on every theme, updates offered rather than applied, and a premium theme paid in Stripe's test mode | `platform.themes-and-templates-marketplace` (3), `storefront.theme-store-free-and-paid-themes` (3) |

Each unit is its own commit (or a few) with its own migration(s), tests and decision row, shipped before the next starts. Unit A is
detailed in section 3; the others are outlined in section 4 and get their detail when their turn comes. The order puts the heaviest rows
and what later units lean on first (A's availability is what D's per-country pages and H's blocked sales read; F's scheduler is what G's
scheduled articles use).

## 2. Rules for every unit

1. **One way to write.** A price changes only through `commerce.set_price` (and a derived price is written there too, with the 30-day
   reference kept genuine); a product through `saveProduct()`; a page through `savePage()` and `keepVersion()`; a look through the theme
   installs' own writers. An import, the AI manager, a bulk action and a job call the same functions.
2. **The cart and the order agree.** Anything that changes whether a line can be bought or what it costs (a product off in a country, a
   derived price, a missing registration, a duty) is decided by one function that `cartSummary()` and `placeOrder()` both call, with a
   scenario in `checkout-kinds.int.test.ts`, euro included.
3. **Store-scoped.** Every new table holds `store_id`, every query takes it, and an integration test shows one store cannot reach
   another's rules, schedules, comments or registrations.
4. **Copies and personal data.** Every new store-owned table is classified in `COPY_RULES` (rules and availability are catalogue,
   copied; comments and preview links are never copied) and every table holding a person's data is in `PERSONAL_DATA` with its export and
   erasure (comments).
5. **No redirect by place, no cookie without its entry.** A visitor is never sent elsewhere because of where they are (the Geo-blocking
   Regulation): a country is suggested, never forced. Every cookie or storage item is in `KNOWN_COOKIES` (a private store's unlock cookie
   is necessary; a dismissed suggestion is kept only after consent, or in memory).
6. **Jobs run with nobody signed in** through `runJobs()` in the five-minute dispatcher or a tracked cron route, in the name of who
   asked, read again when they run (`passMembership()`), and never for a store that is not open (`commerce.store_is_active()`).
7. **Words.** New admin words go in the area's catalogues (en and nb, D312); shopper words in nb, sv, da and en by hand; anything a law
   asks for (EPR numbers, duties, a private store's notice) is hand-written and flagged for legal review.
8. **The AI manager** gets tools for each new area where an owner would ask for it, gated where it changes what shoppers see or pay, and
   every new tool has a line in `TOOL_WORDS` and a permission key.

## 3. Unit A (D335): markets in depth

### A.1 What is sold where

- **The model.** `commerce.market_availability` holds what is switched **off**: `(store_id, product_id, variant_id null, market_code)`,
  a row with no variant switching the whole product off in that country, a row with one switching that variant off. No row means sold
  (as today, where a price exists). A product's own row wins over its variants' (off is off).
- **One reader.** `commerce.current_prices` leaves out a variant that is off in that market, so every shopper-facing read (listings,
  search, the product page, the cart, checkout, the chat, the sitemap, structured data, feeds, WordPress, recommendations, wishlists)
  treats it as not sold there, exactly as a missing price is treated today, without touching its twenty-three readers. The admin's reads
  that edit or report prices (`products.ts`'s editor read, `owner-tools.ts`'s `get_product`, the bulk editor, unit-price gaps) move to a
  view of their own, `commerce.kept_prices`, which keeps every current price; a scan test lists who may read which.
- **The price is kept.** Switching off never touches `commerce.prices`; switching back on shows the same price with its history.
- **Writers.** The product editor's Prices card gets a switch per country beside each price (and per variant in the variant grid's
  country columns), saved by `saveProduct()` through `ProductInput.availability` (`{ off: [{ market, sku? }] }`, left out = kept as
  stored, like `standardCategory`). The CSV gains a `not_sold_in` column (country codes per variant row; the countries every variant shares are the product's own), the bulk bar *Sell in* / *Stop selling in* (step A3), and
  the AI manager's `create_product`/`update_product` take `not_sold_in` (a live product's change waits for a yes, as any change does).
- **The cart and the order.** A cart line for a variant off in the cart's market is unavailable (`status: 'not_sold_here'`, the cart's
  existing unavailable path) and `placeOrder()` refuses it, both because the line has no current price in that market.
- **Copies.** `clone_store()` and `duplicate_store()` carry the rows (catalogue); `COPY_RULES` `catalogue`.

### A.2 Market price rules

- **The model.** `commerce.market_price_rules`: per store and market, a `base_market` (another market of the store that has no rule of
  its own, so rules never chain), `percent_bps` (−9,000 to 100,000 basis points), `basis` (`net`: the price before VAT carries over, so a
  25 % Norwegian price becomes the same price before VAT with the destination's own VAT; `gross`: the price with VAT carries over as it
  is), `round_to_minor` (the step a derived price is rounded to, in the market's minor units) and `ending_minor` (an optional ending, such
  as 90 öre or 9 kroner, below the step). A market with a rule takes its prices from the base for every variant whose price there is not
  fixed.
- **Fixed or derived.** `commerce.prices.derived` (boolean, false for every price today): a price an owner typed is fixed; a price the
  rule wrote is derived. In the editor a ruled market's field shows the derived price as its placeholder and stays empty while derived;
  typing a price there fixes it, and *Use the rule* empties it again.
- **One sum.** `derivedPrice()` (`src/lib/market-prices.ts`, pure, BigInt, half up) is the only arithmetic: the base price, its VAT taken
  off with the base country's rate for the product's VAT category (basis `net`), converted from the base currency to the market's own
  currency at the store's rates (`store_currencies.rate`, through the main currency as `convertMinor()` does), the percentage applied, the
  market's VAT put back (basis `net`), rounded to the step and given the ending. A currency with no rate gives no derived price (the
  variant is not priced there, and the rule's screen says which currency lacks a rate), never a guess. VAT rates are read through
  `commerce.vat_rate()` only.
- **When derived prices are written.** Only by `src/server/market-prices.ts`, always through `commerce.set_price` (so the 30-day
  reference stays genuine) with `derived` set: after a save that changes a base price (`saveProduct()` derives that product's ruled
  markets in the same transaction; every writer of prices goes through it), when a rule is saved or removed (all of the store's variants
  for that market, in batches, as one audit entry; removing a rule keeps the derived prices as they are and marks them fixed), and when
  the owner changes a currency's rate or rounding (the markets in that currency). A rate that changes by itself does not exist today
  (rates are the owner's); should one come, it re-derives at most once a day so the 30-day reference does not move with every tick.
- **Bundles.** A bundle with a computed price (D322) is priced from its components' prices in each market, derived or not; a rule does
  not apply to it twice. A fixed bundle price follows the rule like any product.
- **The screen.** Settings → Countries and languages → each country: *Prices* — "Set by hand" (as today) or "Worked out from {country}",
  with the percentage, the basis in words ("Keep the price before VAT the same" / "Keep the price with VAT the same"), rounding and ending,
  and a preview of five products' prices before saving. Owners and staff with `settings:write`. The bulk editor (D165) keeps working on
  fixed prices; on a derived price it fixes it, and its preview says so.
- **AI manager.** `market_price_rules` (read) and `set_market_price_rule` (gate `public`: it changes what shoppers pay), through the
  screen's saver and its preview.
- **Tests.** `market-prices.test.ts` (the sum: net and gross, currencies, rounding, endings, no rate), `market-prices.int.test.ts` (a base
  change re-derives, a fixed price is kept, removing a rule, the 30-day reference through `set_price`, another store's rule unreachable),
  a scenario in `checkout-kinds.int.test.ts` (a derived euro price shown equals charged), availability's reads and the cart's refusal, and
  an e2e that switches a product off in one country and sets a rule.

**A2 as built (2026-10-27).** As above, with these differences. The editor shows a derived price in its field with *By rule* beside it
(not as a placeholder): typing another price fixes it, and emptying the field puts it back under the rule. Rates do change by themselves
(*Follow the ECB*, `applyEcbRates()`, daily), so derived prices follow them there as well as on a currency save, each time as one audit entry
for the batch (`settings.market_prices_derived`, by no person for the ECB's). The screen offers a rule for every country but the store's own
(the first), which is the natural base; the database and `ruleProblem()` allow any pair that does not chain. A rule written by the AI manager
never runs by itself under the autopilot (`NEVER_AUTOMATIC`: it rewrites a whole country's prices). Store copies keep every price as it was,
fixed, and no rule (`COPY_RULES` `never`). A new store has no rates of its own, so a rule between two currencies is refused until both
have one (`rateProblem()`, on the screen, the preview and the AI manager's preflight, naming the currency), and a rate taken away later leaves
the rule's prices as they were rather than ending them. The bulk editor's preview saying that it fixes a derived price is left to A3.

### A.3 Steps

A1 availability (model, view, editor, CSV, cart, copies, tools); A2 rules (model, sum, writer, screen, tools); A3 the bulk bar's *Sell in* /
*Stop selling in*, an e2e, the tracker rows, docs and the AI manager's skill.

## 4. The other units, outlined

- **B (D336) Speed.** Product cards, grids and page pictures get a `srcset` of the library's two copies (480 and 1600 px) and `sizes` from
  the column's width (`pictureSizes()`), still unoptimised by Vercel (the copies are made at upload, D213); a test reads the markup. A
  speed report at Analytics → Speed: field data from visitors (Largest Contentful Paint, Interaction to Next Paint, Cumulative Layout
  Shift, Time to First Byte; `web-vitals` sent by the visit beacon while the store's visit counting is on, no cookie, no identifier, the
  page's place only, `placeOfPath()`), the 75th percentile per page kind over 28 days, with minimum samples, and lab runs of the front page
  and the top product and category page (decision 1). It says what it cannot measure. CI checks page weight, the largest picture and TTFB
  of the demo store's home and a product page (`e2e/performance.spec.ts`).
  **B as built (2026-10-27).** Pictures: `SizedPicture` draws a product card, a content grid's tile, a picture component and the product
  gallery's main picture with both files by width (`pictureSources()`) and `sizes` from `gridSizes()` (columns per screen size, on the
  store's sizes) or `fixedSizes()` (a picture at its own size); product summaries carry the large file and its width from the library, and
  page loaders give picture components their small copy (`withSmallCopies()`, never saved). The report has no lab scores (decision 1 is
  open): it says so under *What this report cannot measure*. The beacon is `SpeedBeacon`, its own component beside the visit beacon (the
  visit beacon sends before the page is used; speed is known only when it is hidden), loading `web-vitals` after the page and sending once
  when the page is hidden (`visibilitychange`, never `pagehide`: leaving a page fires `pagehide` first, before `web-vitals` has the main
  content's time). The e2e closes the tab: headless Chromium did not deliver a beacon sent while it navigated to another page, which was
  not checked in other browsers. Samples are page kinds (`speedKind()`: front page, product, category or tag, lists, other pages; never the cart,
  checkout or a working page) and screens (phone below 768 px), a figure needs 20 page loads, each figure counts its own (a load with no
  press has no response time). The CSV `speed.figures` and the AI manager's `speed_report` repeat the page. CI's budget is three numbers
  per page (bytes transferred, the largest picture, the median first byte of three warm loads) for the demo store's front page and a
  product page on a phone's screen.
- **C (D337) Checkout branding.** `appearance()` reads the theme (primary, text, background, border colours in light and dark, the body
  font's family when it is a web font Stripe can load from our own font CSS, corner radius from the theme's button radius), with a unit
  test for two themes; a *Checkout look* card in Design settings (logo on checkout, background, the pay button's colour and corners, the
  form's field style) saved into the theme's settings; the pay routes' CSP unchanged (no new script origin).

  **C as built (2026-10-27).** The look is `ThemeSettings.checkout` (`CheckoutLook`: `mark`, `background` `page`/`surface`, `button`
  `{light, dark}`, `corners`, `fields` `outlined`/`filled`/`underlined`; every template carries the defaults, so a stored theme is filled in
  on read and no migration is needed). The logo's switch is named `mark`, since a theme holds no `logo` key (D176's look and brand apart).
  The server works the look out (`checkoutAppearanceFor()` in `src/lib/checkout-look.ts`: colours per set, the body font's stack from the
  catalogue, radii in pixels) and hands it to the client as plain data; `stripeAppearance()` and `stripeFonts()` in
  `src/lib/checkout-appearance.ts` (no zod, types only from the theme) draw Stripe's Appearance. One difference from the outline: Stripe's
  fields take the theme's *field* corners (`borderRadius`) and its buttons the *button* corners (`buttonBorderRadius`, the express
  buttons too), since a pill radius on every field and tab would not read as the theme. The font is our own stylesheet as `cssSrc` on the
  page's own origin (`?for=stripe`, served now with `Access-Control-Allow-Origin: *`, as the font files already were); if Stripe cannot load
  it, its system fallbacks show. The page's own pay button takes the checkout's colour and corners through `themeCss()`'s `--checkout-*`
  variables, read by `.checkout-look` (globals.css) around the payment form, which also draws the surface panel and the logo. The card is
  the theme editor's (Homer: one sentence and the logo; Lisa: *Customise the checkout*, and *Follow the theme again*), with a checkout in its
  preview; Kaizena Flow's own site's editor leaves it out (`checkout={false}`). Not done: a checkout-only background colour of its own (the
  surface panel is the one choice), and the e2e (`e2e/signed-in/checkout-branding.spec.ts`) checks the saved setting and the pay routes'
  variables, not Stripe's frames, since the end-to-end server has no Stripe keys.
- **D (D338) Each country's own.** A page's `markets` (none = all): not drawn, a 404 and out of the sitemap in the others; a product's
  title, description and a menu's labels may have a text per country over the language's (`texts.{locale}@{country}`), falling back to the
  language's; the builder's view bar names the country and language shown, and the translation worklist counts per-country texts. A
  country may have a domain (`store_domains.market`, beside D313's `language`; one host is a country's or a language's, never both),
  verified as any domain, its other addresses moved to it (308), canonical, hreflang, emails and Stripe return addresses built on it
  through `marketUrl()`. A dismissible suggestion on every store page for a visitor whose country (`x-vercel-ip-country`) has another
  market: a link to the same page there, never a redirect, never for crawlers, dismissal kept in memory or, with preferences consent, in
  `kaizen_country_hint_{store}`.
  **D in detail (2026-10-27).** Built in three steps, each its own commit.
  - **D1, each country's content.** A page or article may be limited to chosen countries (`PageContent.markets`, country codes; none =
    every country): in another country it is not drawn (the route's 404, so a manual redirect still applies), not in the sitemap, not
    listed by a content grid of pages or articles and not in llms.txt. Rows, columns and blocks already have this (D179's visibility). A
    product's description may have a text per country over its language's (`commerce.product_market_texts`: product, country, language,
    description), written only by `saveProduct()`, drawn on that country's product page and in its structured data, falling back to the
    language's; the title stays the language's everywhere (carts, orders, invoices, feeds and search name a product one way), and the copy,
    the CSV and the AI manager leave country texts as they are. A menu link's label may have one per country over its language's (a label
    keyed `{locale}@{COUNTRY}` in the link's labels, read first by `menuLabel()` given the market's country). The builder's bar names the
    view the canvas draws (a country and a language) and the countries a limited page is for; the translation worklist counts the
    country texts per language.
  - **D2, a domain per country.** A domain may be one country's (`store_domains.market`, beside D313's `language`; one host is a country's
    or a language's, never both, and a store gives domains to its countries or to its languages, never both, so every market has one
    address). Only for a store that sells in several countries, and never its own country (its address is the store's). On a country's
    domain the country goes without saying (`/x` is that country in its own language, `/en/x` in English, `/eur/x` in euro); an address in
    that country anywhere else moves there (308), and one in another country on it moves to that country's own address. Routing, links
    (`marketHost()`, `marketPath()`, `marketUrl()`, `marketMetaPath()`, `marketLink()`), emails, Stripe's return addresses, the sitemap,
    canonical and `hreflang` follow it as they follow a language's domain (`countryHostDecision()` beside `languageHostDecision()`).
  - **D3, the country suggestion.** A visitor whose country (`x-vercel-ip-country`) is one the store sells in, other than the market shown,
    sees a dismissible line on every store page linking to the same page in that country's market. Never a redirect; never for crawlers;
    never on the pay routes; nothing for a country the store does not sell in; in the shopper's language. The country is read on the
    server per request inside a `<Suspense>` hole, so pages stay cached; a dismissal is kept in memory, or with preferences consent in
    `kaizen_country_hint_{store}` (session storage, in `KNOWN_COOKIES`).
  **D as built (2026-10-27).** As above, with these choices. A product's text per country is its description only, in a table of its own
  (`product_market_texts`) rather than a key of `product_translations` (68 modules read that by exact language), shown on that country's
  product page and in its structured data; a country text is copied with the store, never translated, and counted on the Translate page.
  A menu link's per-country label is in the country's own language (one field per country in the menu editor). The builder's note
  (`ViewNote`) names the country and language the canvas draws and the countries a limited page is for; the Countries choice sits under the
  page's *Who may read it*. Country domains are only for a store that sells in several countries, never its own country (the primary's),
  and refused beside language domains (`setDomainCountry()`, `setDomainLanguage()`, trigger `store_domains_one_kind`); a country domain is
  never the store's address. On a country's domain a short view (`/en/x`) is that country in that language, the country's own language
  named is moved off (`/sv/x` to `/x`), and another country is moved to its own address. The suggestion is a fixed card, read per request
  (`x-vercel-ip-country`, never a crawler); its dismissal is kept in memory only, so no cookie entry and no consent banner come with it.
- **E (D339) Private mode.** `stores.private_mode` (a password's hash, a landing page chosen as a page role `private`), served by the proxy
  to anyone without the unlock cookie (`kaizen_unlock_{store}`, necessary, HttpOnly) or a staff session; noindex, robots disallow, no
  sitemap, llms.txt or feed; the pay routes of orders already placed, webhooks and after-sale links keep working; turning it on and off is
  audited; a new store is private until it opens (decision 5).
  **E in detail (2026-10-27).**
  - **Model.** `stores.private_mode` (boolean, default on: decision 5) and `stores.private_password` (a scrypt hash, `scrypt$…`; none: no
    visitor gets in, staff still do), and `stores.private_version` (raised whenever the password changes or the owner signs everyone out,
    so an unlock made before stops working). Written only by `src/server/private-mode.ts` (`setPrivateMode()`, `setPrivatePassword()`,
    `signEveryoneOut()`), each audited (`store.private_mode`, `store.private_password`, area `settings`, never the password). The migration
    turns it off for every store that has opened (`setup_completed_at`) and for store templates and demo stores, so only stores still in setup
    become private (decision 5: an open store is never made private by the change). Opening a store (`completeSetup()`) turns it off through
    the same writer; a store copy starts private, its password not copied. A store template or demo store is never private (its pages are the
    theme store's previews), whatever the column says.
  - **Who gets in.** The proxy (`src/proxy.ts`), which already reads a store's facts every few seconds (`storeFactsOf()`), learns whether it
    is private and its version, and serves every page request of a private store to a visitor without a good unlock cookie from the landing
    page instead (a rewrite, `noindex`, `no-store`). The unlock cookie is `kaizen_unlock_{storeId}` (necessary, HttpOnly, `SameSite=Lax`,
    path `/`): a signed token (`src/lib/unlock-pass.ts`, a key made from `SETTINGS_ENCRYPTION_KEY` for this use alone) of the store, its kind
    (`password`, 30 days, tied to `private_version`; `staff`, 12 hours) and its end, checked without the database. Paths of what was already
    sold stay open (`privateOpenPath()`: the order page, My account and its token pages, downloads, the withdrawal function, returns,
    unsubscribing, a subscription's and a box list's links), as do the API routes (webhooks), which the proxy never sees.
  - **The landing page.** A page role `private` (`PAGE_ROLES`, D112/D113), built in the builder like the other working pages, holding the
    shop component *Password* (`STORE_PARTS.private`: the store's name, a line and the password form), the standard page until one is chosen.
    It is drawn at `/s/{store}/private/{market}` under a root layout of its own (`src/app/s/[store]/private/[market]/layout.tsx`): the store's
    theme, fonts and CSS, but no header, footer, search, cart, chat, consent extras or visit counting, so nothing on it reaches the catalogue.
    Not private: it moves to the store's home.
  - **Unlocking.** The form posts to `/api/private/unlock` (same site; the password checked against the hash in constant time; tries counted
    per store by `takeBudget()`), which sets the cookie and sends the visitor back where they asked (`safeBack()`: a path of the store, never
    another site); a wrong password goes back to the landing page saying so, the same answer for every wrong word.
  - **Staff preview.** *Preview the store* on the Private mode page goes to `/api/private/preview` on the admin's host (a member who may read
    the website, `website:read`), which sets a `staff` cookie at once where the store's pages are on the admin's host, and otherwise hands a
    90-second signed `enter` token to `/api/private/enter` on the store's own host (the D193 pattern), which sets it there.
  - **Crawlers and lists.** A private store is not `indexable` (sitemaps, llms.txt, the platform's lists), its robots.txt disallows all, its
    product feeds (`/api/feeds/…`) and blog feeds answer not found, and its chat, recommendations and blog comment routes refuse a visitor
    without the cookie (`unlockedFor()`).
  - **Admin.** Settings → *Private mode* (`/settings/private`, `settings:read` to see, `settings:write` to change): the state in one line, one
    switch, the password (set, change, remove; shown once as typed, never again), *Sign everyone out*, the landing page (choose or make it on
    Pages → special pages), and *Preview the store*. Owner and staff words in the `settings` catalogue (en, nb); shopper words in
    `m.privateStore` (nb, sv, da, en by hand). The AI manager reads the state in `store_checkup`; no tool changes it (a password never passes
    through a model).
  **E as built (2026-10-27).** As above, with these choices. The landing page is drawn under a root layout of its own at
  `/s/{store}/private/{market}` rather than in the market layout, whose header search, chat and extras would reach the catalogue; the proxy
  rewrites to it with the address asked as `to`. Its path names its market itself, so the address rules (D181's `addressDecision()`) leave
  `/private/{market}` as written, also in a store that sells in one country. A store's facts that cannot be read leave a request alone (as the address's decisions do),
  so a database hiccup never takes every store down. The unlock cookie is declared on the Cookies page only while the store is private. The
  test databases start stores public (`e2e/global-setup.ts`, `test/integration-setup.ts`): their stores stand for open ones, and the private
  mode tests switch it on themselves; `src/db/commerce.test.ts` holds the real default. No AI manager tool, as a password never passes through
  a model; the owner switches it from Settings, *Private mode* (Settings, Site), where *Preview the store* hands a staff pass to the store's
  own host as D193's edit pass does.
- **F (D340) By the clock, and links to share.** `commerce.page_schedules` (publish a page's draft at a time, and optionally put the
  version before back at another), the same for a header, a footer and a theme install going live (`theme_schedules`), run by
  `runSchedules()` in the five-minute dispatcher in the name of who scheduled, refused for a page in a running A/B test, with failures in
  the page list and the audit log. Preview links: a token per page or theme install (`preview_links`, hashed, an expiry the owner picks up
  to 30 days, revocable, noindex, the draft only), from the builder's Share button. The live look's saves (Design settings and the Theme
  tab) keep versions (`look_versions`, the newest 50) taken back as unsaved changes.

  **F in detail (2026-10-27).** Built on G's schedules (D341: `page_schedules`, `src/server/page-schedules.ts`, the editor's Schedule
  dialog, `runSchedules()` in the five-minute dispatcher, the AI manager's `schedule_article`); no second scheduler.
  - **A way back for pages.** `page_schedules` gains `revert_at` (optional, after `publish_at`, at most a year after it) and a second leg of
    its own: `revert_status` (`waiting`, `done`, `failed`, `cancelled`; null when there is no way back, `(revert_at is null) = (revert_status
    is null)` by check), `revert_problem`, `reverted_at`, and what the job needs to go back: `before_content` (the published content the
    publish replaced; null when the page was not published, so going back takes it off the site) and `published_hash` (md5 of what the
    publish put live). `page_schedules_rules()` grows: the way back is settled once, only after the publish was `done`, and a publish that
    failed or was cancelled settles it as cancelled in the same update; `revert_at` is fixed once the publish ran. When the time comes, the
    job puts the version before back **only while the page is still live as the schedule left it** (`published_hash` against the published
    content): a page someone published again since, or took off the site, is left as it is and the way back fails with that reason (never a
    silent overwrite of a person's later publish). Going back goes through `savePage()` (a publish of the content before, so addresses and
    their redirects follow the database's rules and a version is kept), and the draft the person had is saved back as the draft afterwards
    when it differs, so their work is never lost; with nothing before it is `unpublishPage()`. A publish whose way-back time passed before it
    could run (a store that was not open) fails (`expired`), never published for a moment. Scheduling a page again cancels the way back of
    its earlier schedule (one plan per page at a time; `page_schedules_one_revert_idx`).
  - **Headers and footers.** `SCHEDULED_TYPES` grows to `header` and `footer`: their drafts are published at a time and put back the same
    way, from the same dialog in their editor. A header or footer the store has chosen shows the new version at once; one not chosen is only
    published (choosing one stays the Header and footer page's, as it changes what every page shows). Product layouts, test versions and
    Kaizena Flow's own pages are still not scheduled.
  - **Theme installs going live.** `commerce.theme_schedules` (a table of its own: an install is not a page) holds a store's plan to make an
    installed theme live at a time and, optionally, to put the theme that was live back at another: `install_id` (on delete set null, so a
    removed theme fails its plan rather than losing its record), `live_at`, `revert_at`, `scheduled_by`, `status`/`problem`/`done_at`,
    `revert_status`/`revert_problem`/`reverted_at`, `before_install_id` (the live install when it ran). One waiting plan per store
    (`theme_schedules_one_waiting_idx`) and one waiting way back. Written only by `src/server/theme-schedules.ts` (`scheduleTheme()`,
    `cancelThemeSchedule()`, `runThemeSchedules()`, called by `runSchedules()`), with the same rules trigger as pages'. It goes live through
    `switchToInstall()`, the Design page's own switch, in the maker's name read again; the way back only while the scheduled install is still
    the live one, and only to an install that still exists. **A schedule never spends money:** a premium theme the store does not own is
    refused at scheduling (`themeCharge()` `now` or `at_opening`), and a charge refused when it runs fails the plan. A theme is refused
    while a running A/B test holds the store's header or footer (as switching is, `stores_experiment_guard`).
  - **Running.** `runSchedules()` takes four kinds of due work, each claimed `for update skip locked` and settled in its own transaction, at
    most `SCHEDULES_PER_RUN` of each: page publishes, page ways back, theme switches, theme ways back. Every one reads its maker again
    (`passMembership()`, the kind of page's write key or `website:write`), skips a store that is not open (it waits), refuses a page in a
    running A/B test (the publish and the way back), and fails with a reason written on the row, audited (`store.{type}_schedule_failed`,
    `store.{type}_revert_failed`, `store.theme_schedule_failed`, `store.theme_revert_failed`; done: `store.{type}_reverted`, and
    `store.theme_switched` by `switchToInstall()`) and logged. A failed start leaves everything as it was. The dispatcher refreshes the
    pages tag of each store whose pages changed and `designTags()` of each whose theme changed.
  - **Where it shows.** The pages, articles, headers and footers lists show a chip per page (`scheduleChips()`): *Publishes …*, *Goes back
    …*, or *Did not publish* / *Did not go back* with the reason for the latest failure since. The Design page's theme library shows the
    same for each install, and the theme's own page has *Make it live later* (day and time, and *Put the theme before back* behind a
    disclosure) with *Cancel*. The editor's Schedule dialog gets the way back the same way: Homer picks a day and a time; *Put the version
    before back later* opens two more fields for Lisa. All of it is also in the activity log.
  - **Preview links.** `commerce.preview_links`: a store's link to one page's or article's draft (`page_id`) or one installed theme
    (`install_id`), the token kept only as its SHA-256 (`token_hash`, unique), an expiry the person picks (`PREVIEW_DAY_CHOICES` 1, 7 or 30
    days, 7 to start with; a check holds it to 30), `created_by`, and `revoked_at`/`revoked_by` (set once). Written only by
    `src/server/preview-links.ts` (`makePreviewLink()`, `revokePreviewLink()`), at most `PREVIEW_LINKS_PER_TARGET` live links per page or
    theme; a token is read only by `previewLinkOf()`, which answers a live token of an open store. The token (`pv_` and 32 random bytes in
    base64url) is shown once, when made, and never again; the list shows when each was made, by whom, until when, and *Revoke*. Made and
    revoked by those who may change that kind of page (`website:write` for a theme), audited `store.preview_link_made`/`_revoked` (never
    the token). The link is `/admin/account/share/{token}` (Kaizena Flow's admin host, beside D310's look frame, outside the signed-in
    layout): a page's **draft**, read per request with `getPageForEdit()` and drawn by `PageDrawing` (never `findPublishedPage()` or any
    cached read of the published page), or a theme on the store's own pages (the signed-in preview's view, `InstallPreviewView`, shared by
    both, its page links keeping the token). `noindex, nofollow`, `Referrer-Policy: no-referrer` (the token never leaves in a Referer), no
    cookie, no tracking, no chat; an expired, revoked or unknown token, or a store that is not open, is a plain 404 (never saying which). The
    builder's *Share* button (pages and articles once saved) and the theme's page open the same panel (`ShareLinks`).
  - **Versions of the live look.** `commerce.look_versions` (store, `kind` `design` | `theme_tab` | `colours`, the whole `stores.theme`
    value after the save, `created_by`, `created_at`), written only by `keepLookVersion()` (`src/server/look-versions.ts`) inside
    `saveStoreTheme()`'s transaction (Design settings, the builder's Theme tab and saved colours all save through it), never changed (trigger),
    the newest `LOOK_VERSIONS_KEPT` (50) per store, the same theme twice in a row kept once. Design settings has *Versions*: the list with
    what made each, who and when, and *Use this version*, which loads it into the theme editor as unsaved changes through the editor's own
    `load()` (fonts made ready first); nothing is live until Save. The site's own CSS and an install that is not live are not part of it
    (the CSS has the builder's panel; a theme not live keeps its look in its install).
  - **AI manager.** `list_scheduled_changes` (read-only, `website:read`: what is scheduled and what failed, per page, header, footer and
    theme) and `schedule_site_change` (gate `public`, `website:write`, `TOOL_AREAS` website, refused before a yes by what the dialog would
    refuse: `kind` page, article, header, footer or theme, `at`, optional `back_at`, `at` null cancels). `schedule_article` stays as it is.
    Preview links have no tool: a token is a key to unpublished work, made by a person's press and shown to them once, never put in a
    model's answer. Taking a look version back has none either (it only loads an editor).
  - **Copies and personal data.** `theme_schedules`, `preview_links` and `look_versions` are `never` in `COPY_RULES` (a copy starts with
    nothing scheduled, shared or remembered). None holds a shopper's data: `NOT_PERSONAL` entries (staff accounts only; a look version is the
    theme's settings).
  - **Words.** The admin's words are a new catalogue area, `schedules` (en, nb); the Schedule dialog moves its words there from `blog`.
  - **Tests.** `commerce.test.ts` (the rules of the three tables and the grown `page_schedules`), unit tests for the pure parts
    (`page-schedules.test.ts`: the way back's time; `preview-links.test.ts`: tokens and expiries), integration tests
    (`schedules.int.test.ts`: a page and a header published and put back by the job, a person's later publish left alone, a theme switched
    and switched back, a premium theme refused, a removed maker failed, one store never reaching another's; `preview-links.int.test.ts`;
    `look-versions.int.test.ts`), and e2e (`e2e/signed-in/schedules-and-sharing.spec.ts`: a page shared and opened signed out, then revoked;
    a look version taken back).

  **F as built (2026-10-27).** As above, with these differences and choices.
  - **The database's rules are tested in `src/db/schedules.test.ts`**, beside G's `src/db/blogs.test.ts` (the same PGlite database every
    migration is applied to, `createTestDatabase()`), not in `commerce.test.ts` itself.
  - **A way back keeps the person's draft.** Going back publishes the content from before through `savePage()` and then saves the draft the
    page had back as its draft when it differs, so after a sale page goes back the live page is the old one and the editor still holds the
    sale's words (the page reads *changed*). Every step keeps a page version (D305), so nothing is lost either way.
  - **A plan for a theme shows on both installs.** `themeFactsFor()` gives the planned install its *Goes live* chip and, once it ran, the
    install that comes back its *Goes back* chip, so the theme before's page (which is not live, so it can be opened) carries *Cancel the
    schedule*; the live theme's own page still redirects to Design settings.
  - **The way back of a theme needs no money check of its own**: the theme before was live on the store, so it is free or the store's.
  - **A preview link that finds nothing** draws the admin's not-found page. The page is read inside a `<Suspense>` (it reads the address
    and the database, as D310's look frame does), so the answer is streamed and its status may be 200, as D168 notes for any dynamic miss;
    nothing in it says whether the token was wrong, expired, revoked or its store closed.
  - **The banner of a shared page** is in the store's main language where the admin has it (nb), else English (`schedules.preview`).
  - **The e2e spec** (`e2e/signed-in/schedules-and-sharing.spec.ts`) was first run at the merge, where its signed-out visitor needed an empty
    storage state of its own (a context made in a signed-in file takes its state); `blogs.spec.ts` finds the dialog's first *Time* exactly.
- **G (D341) Blogs in depth.** A blog is a record (`commerce.blogs`: title, address, its listing page, comments setting), the first one
  being today's `/blog`; articles belong to one blog; authors are records (`commerce.blog_authors`: name, picture, short text, link) chosen
  on an article, shown on it and in its JSON-LD; an Atom feed per blog (`/blog/{blog}.atom`, published articles only, a test parses it);
  comments (`commerce.blog_comments`, decision 3) held for moderation by default, checked for spam in code, rate-limited by hashed keys, no
  cookie, personal data with export and erasure; scheduled articles through F's schedules.

  **G as built (2026-10-27).** As above, with these differences and choices.
  - **Addresses.** The first blog stays `/blog` (its row is made for every store by the trigger `stores_first_blog()`, and for every store
    there was by the migration, so no address moved); every other blog is at `/blogs/{handle}` (`blogPath()`, `articlePath()` in
    `src/lib/blogs.ts`), with its articles at `/blogs/{handle}/{slug}` and its category and tag pages under it. An article's blog is a field of
    its content (`PageContent.blogId`, kept by `savePage()` only when it is the store's own and not the first blog; none, or a blog that is
    gone, is the first blog's), so moving an article between blogs is published with the article like any change. Article addresses stay
    unique per store: an article asked for under another blog's address (an old `/blog/{slug}` link included) moves to its own for good
    (308). `blogs` is reserved for pages by the app only (`RESERVED_STORE_PAGE_SLUGS`); the database's check is unchanged, so a page a store
    already had there cannot stop the migration (such a page could no longer be saved under that address).
  - **The feed** is each blog's address with `/feed.atom` after it (`/blog/feed.atom`, `/blogs/{handle}/feed.atom`, `feedPath()`), not
    `/blog/{blog}.atom`: a dynamic segment cannot be both a page and `{handle}.atom`, and `feed.atom` cannot be an article's address. It is
    Atom (RFC 4287) written by `atomFeed()` (`src/lib/atom.ts`: every text escaped, XML-forbidden characters dropped, the summary plain
    text), the newest 50 published articles of that blog in the market's language (`blogFeed()` in `src/server/blogs.ts`, cached under the
    store's pages tag, which publishing and a schedule's run refresh), and linked from the blog's, its term pages' and its articles' heads
    (`alternates.types`) and from the standard list. `src/lib/atom.test.ts` and `blogs.int.test.ts` parse it with a strict reader.
  - **Each blog's own categories and tags.** Terms stay the store's article terms (D50), shared by its blogs; a blog's list offers the
    categories its own articles are in, and its category and tag pages list only its own articles (`source.blog` on the articles grid). A
    content grid of articles can be limited to one blog in code (the builder's grid field does not offer it yet).
  - **Its listing page.** The first blog's stays the `blog` page role (D112, chosen under Pages, Special pages); another blog names a page of
    its own store (`blogs.listing_page_id`, `blogs_rules()`), left out of the sitemap as a page.
  - **Authors** are `commerce.blog_authors`, written only by `src/server/blogs.ts` (`saveAuthor()`: the picture must be in the store's media
    library, the link `isSafeAddress()`), chosen in the article editor (`PageContent.authorId`), drawn under the article (`ArticleView`'s
    author box) and in its `Article` JSON-LD as a `Person` with `url`, `image` and `description`; the free-text name stays the fallback. Their
    pictures are in `mediaUses()` (`author`, a picture that leaves the site) and `rewriteAddresses()`.
  - **Comments** are `commerce.blog_comments`, written only by `src/server/blog-comments.ts`: posted to `/api/blog/comments` (same site, no
    cookie, no storage), counted against `COMMENTS_PER_VISITOR_HOUR` per visitor (a keyed hash of the address and the store, bucket
    `comment:…` in `commerce.chat_usage`) and `COMMENTS_PER_STORE_HOUR` per store, checked by `spamReasons()` (the hidden field, sent within
    three seconds, more than one web address, an address as the name, the same normalised text in the store within 24 hours), and kept as
    `commentOutcome()` says: a robot's (the hidden field) answered as taken and dropped, a flagged one kept as `spam` (staff may still
    approve it), the rest `pending` (`moderated`, the default) or `approved` (`automatic`). The visitor is never told why one waits. Only
    `approved` comments are drawn (`approvedComments()`, cached under `commentsTag()`), as plain text; `off` draws no form and no comments.
    A comment's words, name and email are fixed by `blog_comments_rules()`; a decided one never waits again. Staff decide at Website, Blog
    comments (`/admin/{store}/articles/comments`: waiting, shown, spam, refused, with the spam check's findings). Personal data: the
    register's `blog_comments` (by the email, export section `comments`, erasure deletes), and the retention rule `blog_comments` deletes
    refused and spam comments 30 days after they were posted (`runRetention()`). An approved comment stays with its article until erased
    or deleted; a comment without an email cannot be found by a person's request (the store deletes it by hand).
  - **Schedules** are `commerce.page_schedules` (D341, the start of F's model), written only by `src/server/page-schedules.ts`
    (`schedulePage()`, `cancelSchedule()`), one waiting per page (`page_schedules_one_waiting_idx`), settled only once
    (`page_schedules_rules()`), and run by `runSchedules()` in the five-minute dispatcher: each due row is claimed `for update skip locked`,
    its maker read again (`passMembership()`, the kind of page's write key), refused for a page in a running A/B test, and published through
    `savePage()` with the checker's issues the maker chose to publish with (`acknowledged`; the editor and the AI manager never schedule
    past a blocking issue, so it stays empty for now), the store's pages tag refreshed. A schedule of a store that is not open waits (it is
    not failed); one that cannot run fails with its reason, audited `store.{type}_schedule_failed` and shown in the editor's Schedule
    dialog. The time is the store's clock (`scheduleInstant()`, at least two minutes ahead, at most a year); it publishes within five
    minutes after it. Pages and articles both get *Schedule* beside Publish (it cost nothing more); layouts, test versions and Kaizena
    Flow's own pages do not.
  - **What F still adds to the schedules:** a way back (`revert_at` and the version before, put back at another time), headers, footers
    and theme installs going live (`theme_schedules`), failures listed in the page lists, preview links, and the live look's versions.
  - **The AI manager:** `list_blogs` and `blog_comments` (read-only, `website:read`; a comment's words, name and email never reach the model,
    as a review's never do), `moderate_blog_comment` (gate `public`, `website:write`, `NEVER_AUTOMATIC`: a person reads a visitor's words
    before they are shown) and `schedule_article` (gate `public`, `website:write`, `TOOL_AREAS` website as `publish_page`), each refused before
    a yes by what its page would refuse.
  - **Copies.** `blogs` is `derived` (the first blog is made with the new store; other blogs are not copied, and their articles fall to the
    copy's first blog), `blog_authors`, `blog_comments` and `page_schedules` are `never`.
  - Shopper words are `blogComments` in the browser catalogues (nb, sv, da, en by hand); admin words are the `blog` catalogue (en, nb).
- **H (D342) Producer responsibility.** A *Producer responsibility* page under Settings: registrations (scheme, country, number,
  authority, valid from and to) written only by `src/server/producer-registrations.ts`; `commerce.registration_blocks()` (the view's rule)
  read by the cart and `placeOrder()` alike: a product under a scheme with no valid registration in a country is not sold there from the
  day after its registration ends, with a plain reason; staff see what is blocked; the number shown on the product page and the invoice
  where the scheme asks. Copies carry nothing (a registration is the company's).

  **H as built (2026-10-27).** Settings → Selling → *Producer responsibility* (`/admin/{store}/settings/producer-responsibility`,
  `settings:read`/`settings:write`, feature `shop`): what is not sold now and what has no registration recorded, each grouped by scheme and
  country with the products named and *Add the registration* beside them; the store's registrations (scheme, country, number, authority,
  valid from and to, state, *Shown on product pages*, a warning thirty days before one ends with nothing after it); and one form to add or
  change one. Written only by `src/server/producer-registrations.ts` (`saveRegistration()`, `removeRegistration()`), checked by
  `checkRegistration()` in `src/lib/producer-registrations.ts`, audited `settings.producer_registration_saved`/`_removed` (scheme, country and
  days, never the number). Differences from the bullet above:
  - **What blocks.** `commerce.registration_gaps()` lists every product under a scheme with nothing valid in an active market on the store's own
    day (its time zone), each marked `recorded` when the store has any registration or exemption for that scheme and market;
    `commerce.registration_blocks()` is the recorded gaps. A registration covers its last day, so a lapsed one stops sales from the next day,
    and one not begun stops them until its first. A scheme and country the store **never recorded anything for** is listed as a warning
    (*No registration recorded*) and **still sold**: every new product is ticked as packaging by default (`emptyProduct()`), so blocking it
    would have taken almost every store's goods off sale at deploy. Making the rule strict is one line (`registration_blocks()` without
    `WHERE g.recorded`) once the default tick is settled (an owner's decision; the row stays partial until then). Taking a registration away
    (for one entered by mistake) leaves nothing on record, so the country is warned of again.
  - **Exemptions.** A row may say why no registration is needed in a country (`producer_registrations.exemption`, in the owner's words; no
    number or authority, never shown). It covers as a registration does: a furniture product sold in a country with no furniture scheme
    would otherwise have no way to be sold once anything is on record.
  - **The cart and the order.** `commerce.line_unregistered()` (the variant's product and a bundle's components') is read by `getCart()`
    (line status `unregistered`, `m.producer.lineProblem`), `sellableQuantity()` (adding is refused) and `placeOrder()` (problem
    `unregistered`, `m.producer.problem`); the product page's buy part says `m.producer.notSoldHere` in place of the button, read per request.
    A euro scenario in `checkout-kinds.int.test.ts`.
  - **The number.** Each registration has *Show the number on product pages in this country* (`show_number`), ticked to start with by
    `numberShownByDefault()` (`SHOW_NUMBER_RULES`: Germany's WEEE and battery numbers, France's unique identifier for every scheme), our
    reading and flagged for legal review; the product page's *Product safety* part lists the shown numbers valid today
    (`ProductDetail.producerNumbers`, read in `getProduct()`'s cached read). **The invoice is left out**: the invoice snapshot is held to its SQL
    twin by `invoice-parity.test.ts` (D159), and adding a field to both is a change of its own; an owner who must print the number on invoices
    can put it in the invoice note meanwhile.
  - **Copies.** `producer_registrations` is `never` in `COPY_RULES`; `duplicate_store()` no longer copies them (patched in place, as A1 did).
  - **AI manager.** `producer_registrations` (read, `settings:read`) and `save_producer_registration` (gate `public`, `settings:write`,
    `NEVER_AUTOMATIC`, its preflight the page's checks); the tool's description tells the model never to make up a number.
  - Shopper words (`m.producer`, nb, sv, da, en by hand) are `HAND_WRITTEN_ONLY` until a legal review, as is the wording of what each country
    asks.
- **I (D343) Customs and duties.** A rates table the platform keeps (`commerce.duty_rates`: destination, HS heading prefix, rate,
  threshold, source, checked-on, verified; decision 2), `dutyEstimate()` pure in code (BigInt, a missing HS code gives no estimate and a
  plain message, never zero), shown at checkout for a destination outside the EU as an estimate, collected (DDP) or left to the carrier
  (DAP) per country by the store's choice, kept on the order; `ShippingCarrierAdapter.book()` carries customs lines for such a destination
  and refuses without them (Bring first); the EU's end of the 150 EUR duty exemption (1 July 2026) is a dated rule in the table.

  **I as built (2026-10-27).** As above (decision 2: the platform's own table, every figure labelled an estimate, DAP the default), with these
  details and differences.
  - **The table.** `commerce.duty_rates`, kept at Platform → Settings → *Duty rates* (`/admin/platform/duty-rates`), written only by
    `src/server/duty-rates.ts` (platform admins; `platform.duty_rate_saved`, `_verified`, `_removed`). A row is for a destination (a country, or
    `EU` for every member state) and an HS heading prefix: the base row (`''`) holds what a consignment's value decides (the duty threshold and
    the VAT-at-sale threshold, per consignment or per item, in their currency; a fixed duty per distinct six-digit sub-heading under the threshold;
    the import VAT rate where it differs from the goods' own; whether shipping is part of the customs value), a heading row its rate, maybe only for
    an origin (a country or `EU`). `applies_to` picks rows for consignments whose VAT is collected at the sale under the destination's scheme
    (IOSS into the EU, decided by the tax decision; VOEC into Norway, the store's tick per country) or not. Every row has its source address,
    the day it was read and `verified`, false until a person checks it.
  - **The starter rows** (all unverified, read on 2026-10-27 at the addresses they cite): the UK's 135 GBP threshold for duty and for VAT at the
    sale (gov.uk), cotton T-shirts (6109.10) at 12 % and 0 % for EU, Norwegian and Swiss origin (the UK Trade Tariff's API); the US with no de
    minimis (the Federal Register's indefinite suspension, 2026-12670) and no VAT; Norway's VOEC (under 3000 NOK per item, no duty, VAT in the shop;
    toll.no); and the EU's dated rule: relief for consignments not exceeding 150 EUR (Regulation 1186/2009 Art. 23, read on legislation.gov.uk's
    copy) until 30 June 2026, then 3 EUR per different item in IOSS parcels under 150 EUR from 1 July 2026 (read in a report of the Council's
    agreement of 12 December 2025; the Council's own page refused the request), the relief staying for consignments outside IOSS. **Not added**:
    Switzerland (duties by gross weight, which the table cannot express), US heading rates (the 2025–2026 additional duties are not settled enough
    to state), Norway's heading rates and its rules outside VOEC (tolltariffen.toll.no could not be read), the EU's heading rates. So most
    estimates today say *no rate* for the heading: the table needs rows before DDP is useful anywhere but the UK's T-shirts.
  - **The estimate.** `dutyEstimate()` (`src/lib/duties.ts`): the customs value of each shipped line is its price after every discount less its
    VAT, with its share of the shipping without VAT where the destination counts it; thresholds compare the goods, rounded up in the threshold's
    currency (the store's rates, else the ECB's latest); duty per line half up; import VAT at the border on value and duty, none at or below the
    VAT-at-sale threshold. What DDP collects is the duty and the import VAT the price does not already carry (every market's prices include its
    VAT: the line's VAT and its shipping share come off its import VAT, never below zero); what DAP's carrier may collect is the duty and the whole
    import VAT, before its own fees. Goods sent inside one customs territory (one country, or both in the EU) get no estimate; a destination in the
    EU from Norway is a border, and the EU's rows apply.
  - **One decision.** `loadCustomsFacts()` and `decideCustoms()` (`src/server/customs.ts`), called by `cartSummary()` and `placeOrder()` with the
    tax decision's lines and shipping; a euro scenario in `checkout-kinds.int.test.ts` holds cart, order, Stripe and the DDP block together.
  - **Money: outside the total.** What DDP collects is `orders.duties_minor`, kept OUT of `total_minor`: the order's total stays goods and
    shipping with their VAT, so the invoice (D159) and its SQL twin, the VAT and OSS reports and every sales figure are unchanged and need no
    change on both sides. **The duties are not on the invoice**; they are recorded on the order (`orders.customs`), shown on the order page,
    in the confirmation email and at Stripe as a line of their own. The payment is the total plus the duties (`dueNowMinor`, also Mollie's
    amount); no sale fee is taken on them; gift cards never pay them (a basket with duties always has a payment page); a refund can return
    them (a credit note covers only the invoice, `creditAllocation()`'s short part). A subscription, a host's listing, a venue part and an order
    on payment terms are DAP whatever the choice (`fallback`, said on the order); a company order waiting for approval keeps its duties for the
    payment that follows (`placedOrderOf()`). Drafts and exchanges never collect duties.
  - **The store's choice.** Settings → Selling → *Duties and import VAT* (`/admin/{store}/settings/customs`, `settings:read`/`settings:write`,
    feature `shop`): the countries the goods cross a border into (from the tax profile's dispatch country), DAP or DDP for each, the VAT scheme
    tick, whether the table covers the country, and how many products have no HS code. `commerce.customs_settings`, never copied.
  - **Shopper words.** `src/lib/customs-text.ts`, hand-written nb, sv, da and en, kept out of the AI catalogue, for legal review: the cart's DDP row
    (*estimate*) and sentence, DAP's estimate of what the carrier may collect, what blocks a DDP checkout (the products without a customs code
    named), the order's and the email's sentence. The generic import notice is not shown where a customs sentence is.
  - **Bookings.** `BookingRequest.customs` (`BookingCustoms`: incoterm, currency, invoice number and date, lines with HS code, origin, value,
    description, quantity and weight); every carrier's `book()` asks `bookingCustomsProblem()` first and refuses a parcel across a customs border
    without complete lines, before the carrier is called. Bring then sends the lines to its Customs API (`POST /customs/v1/declarations`, read from
    its OpenAPI document), which takes only services 0300, 0336, 0342 and 0344: for others, and when Bring refuses, the booking stands and the
    result says why (`BookingResult.customs`). `bringBook()` builds the lines from the order (`bookingCustomsFor()`), though its own screen still
    books only Norwegian parcels from a Norwegian sender.
  - **AI manager.** `customs_duties` (read-only, `settings:read`, feature `shop`): who pays in a country, each product's HS code and origin, and
    one item's estimate there or why there is none. No tool changes the choice.
  - **Not built.** IOSS through an intermediary (criterion 4's bucket B part: the IOSS number and markets are recorded per store, D157, and the
    estimate reads them; an intermediary's own details are not recorded), a paid landed-cost service (decision 2), carriers' handling fees, the
    duties on the invoice, and DDP for subscriptions and drafts.
- **J (D344) Themes from outside.** An owner's live look (or a demo store's) is submitted as a theme by its author (owner or invited
  designer account), waits in a review queue at Themes → Submissions (approve, reject with a reason, hide), shows its author, version and
  the number of stores using it; an author's update is offered to installs (*What's new*, Update), and following updates becomes a choice
  the owner makes per install, off by default for new installs (decision 4). A premium theme is invoiced and paid in Stripe's test mode on
  a real test store, recorded as the row's evidence.

  **J in detail.**
  - **Who submits.** Anyone who may change a store's website (`website:write`: its owner, staff given it, or a designer invited as a
    collaborator, D158) submits the store's live look as a theme, from Design settings' *Share this look as a theme* (one page: a name, a
    line, a description and the author's name as shown). The look is taken at once by `takeSnapshot()` (the look only, never the store's
    words, products or menus' links) and kept with the submission, so the store can change after. A real, open store only (never a store
    template, a demo store or a theme's workspace); at most three open submissions an account.
  - **The queue.** `commerce.theme_submissions` (written only by `src/server/theme-submissions.ts`; status `waiting`, `reviewing`,
    `approved`, `rejected`, `withdrawn`, moved only forward by the database, the snapshot and who fixed) at Themes → Submissions. *Review*
    makes the theme as a draft (a new theme from the snapshot, unpublished, with its author; an update written into the theme's draft), so
    the reviewer previews it and its checks on the theme's own pages; *Approve* publishes it through `publishDesign()` (the theme checks
    refuse a blocking finding, and the submission waits in review), giving a new theme its address from its name; *Reject* needs a reason,
    which the author reads. *Hide* is the theme's own Archive.
  - **Authors.** `design_presets.author_id` and `author_name` (none: Kaizena Flow's own). The author's page, Account → *Your themes*, lists
    their submissions with their state and reason, and their themes with the version and the number of stores using each, with *Submit an
    update* (from a store they may change, with what's new). Only the author submits an update of their theme.
  - **The theme store** names the author (*By …*, or Kaizena Flow) and how many stores use the theme on its page.
  - **Updates offered (decision 4).** A new install no longer follows its theme's updates (`store_theme_installs.follows_updates` defaults
    to off); Design settings offers each new version with *What's new* and *Update* (and *Undo*, D245); installs that followed keep following.
  - **Free.** An outside author's theme has no price (the database refuses one) until a revenue share is decided.
  - **Not here:** the premium theme paid in Stripe's test mode on a real test store needs the platform's Stripe test keys, which this
    environment does not have; the row keeps it as its gap.

  **J as built (2026-10-27).** As above, with these choices.
  - **Review makes the theme.** Nothing is made when a look is sent; *Review* makes it a draft theme (a new theme through `createDesign()` with
    the submission's look, its author set and its pictures copied from the sending store's library), so the reviewer uses the theme's own
    pages, previews and checks before *Approve and publish*. A rejected or withdrawn submission's draft theme is archived, never published.
  - **An update with the same look** makes no new version (D241's rule), so its what's new shows only with a changed look.
  - **Content.** A submission carries the look only. An outside theme has no demo content until Kaizena Flow gives it some on its Content tab
    (D275); until then the theme store shows its colours and no preview, as for any theme without content.
  - **Who sees the queue.** The author follows their own submissions on Account → *Your themes*; there is no email on a decision yet.
  - **Tests.** `src/db/theme-submissions.test.ts` (the database's rules), `src/server/theme-submissions.int.test.ts` (the flow),
    `src/lib/theme-submissions.test.ts`, the theme page's part (`theme-page-parts.test.ts`) and `e2e/signed-in/theme-submissions.spec.ts`.

## 5. Decisions (to be taken by the owner)

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | **Where the speed report's lab scores come from** (unit B) | Google's PageSpeed Insights API (free with a key; sends only the store's public addresses to Google, outside the EU); our own Lighthouse run in a cron with the Chromium we have; field data from visitors only | Field data from visitors as the main figure (our own beacon, EU, no personal data), and lab scores from our own Chromium run (one page at a time in a tracked cron, as the theme photographs are): no new vendor. |
| 2 | **Where duty rates come from** (unit I) | A rates table the platform keeps by hand for the destinations stores ship to most (Norway, Switzerland, the UK, the US), each with its source and a verified flag; a paid landed-cost service (Zonos, Avalara; bucket B) | The platform's own table, labelled as an estimate, DAP the default; a paid service only when an owner asks for DDP to countries the table does not cover. |
| 3 | **Blog comments** (unit G) | Build them, held for moderation by default, with a spam check in code (links, repeated text, rate by hashed keys); use a spam service (Akismet, outside the EU); skip comments | Build them without a spam service; moderated by default; the owner may switch to automatic or off per blog. |
| 4 | **Theme updates: applied or offered** (unit J) | Keep D245 (installs follow updates by default and are updated by the job); offer updates and let the owner choose per install | Offer by default for new installs (an update is a press, with What's new and undo); installs that follow today keep following. Outside designers' themes are free until a revenue share is decided. |
| 5 | **A new store is private until it opens** (unit E) | Private by default until setup is finished; public as today | Private by default for new stores and for stores still in setup today (staff see them as before; a store that is open is never made private by this change). |
| 6 | **The two blog rows** (unit G) | Keep both; merge `customers.blog-and-content-marketing` into `storefront.blog-multiple-blogs-authors-comments-rss` (README rule 8: one Shopify feature, one row) | Merge, keeping the stricter criteria of each. |
| 7 | **Prices before or with VAT across countries** (unit A) | One fixed basis; a choice per rule | A choice per rule, "Keep the price before VAT the same" by default (what an EU merchant selling into countries with other VAT rates expects); built that way in unit A. |

Unit A needs none of decisions 1 to 6 and is built first; decision 7 is built as recommended (a choice per rule) and can be changed.

**Taken (2026-10-27).** The owner accepted the recommendations of decisions 2 to 6: duty rates from the platform's own table, labelled
as an estimate, DAP by default (I); blog comments built without a spam service, held for moderation by default, automatic or off per blog
(G); theme updates offered for new installs, installs that follow today keep following, outside designers' themes free (J); new stores
and stores still in setup private by default, an open store never made private by the change (E); the two blog rows merged with the
stricter criteria of each (G). Decision 1 stays open: the speed report rests on visitors' measured figures and says lab runs are not
run (B, D336).
