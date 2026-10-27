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
- **C (D337) Checkout branding.** `appearance()` reads the theme (primary, text, background, border colours in light and dark, the body
  font's family when it is a web font Stripe can load from our own font CSS, corner radius from the theme's button radius), with a unit
  test for two themes; a *Checkout look* card in Design settings (logo on checkout, background, the pay button's colour and corners, the
  form's field style) saved into the theme's settings; the pay routes' CSP unchanged (no new script origin).
- **D (D338) Each country's own.** A page's `markets` (none = all): not drawn, a 404 and out of the sitemap in the others; a product's
  title, description and a menu's labels may have a text per country over the language's (`texts.{locale}@{country}`), falling back to the
  language's; the builder's view bar names the country and language shown, and the translation worklist counts per-country texts. A
  country may have a domain (`store_domains.market`, beside D313's `language`; one host is a country's or a language's, never both),
  verified as any domain, its other addresses moved to it (308), canonical, hreflang, emails and Stripe return addresses built on it
  through `marketUrl()`. A dismissible suggestion on every store page for a visitor whose country (`x-vercel-ip-country`) has another
  market: a link to the same page there, never a redirect, never for crawlers, dismissal kept in memory or, with preferences consent, in
  `kaizen_country_hint_{store}`.
- **E (D339) Private mode.** `stores.private_mode` (a password's hash, a landing page chosen as a page role `private`), served by the proxy
  to anyone without the unlock cookie (`kaizen_unlock_{store}`, necessary, HttpOnly) or a staff session; noindex, robots disallow, no
  sitemap, llms.txt or feed; the pay routes of orders already placed, webhooks and after-sale links keep working; turning it on and off is
  audited; a new store is private until it opens (decision 5).
- **F (D340) By the clock, and links to share.** `commerce.page_schedules` (publish a page's draft at a time, and optionally put the
  version before back at another), the same for a header, a footer and a theme install going live (`theme_schedules`), run by
  `runSchedules()` in the five-minute dispatcher in the name of who scheduled, refused for a page in a running A/B test, with failures in
  the page list and the audit log. Preview links: a token per page or theme install (`preview_links`, hashed, an expiry the owner picks up
  to 30 days, revocable, noindex, the draft only), from the builder's Share button. The live look's saves (Design settings and the Theme
  tab) keep versions (`look_versions`, the newest 50) taken back as unsaved changes.
- **G (D341) Blogs in depth.** A blog is a record (`commerce.blogs`: title, address, its listing page, comments setting), the first one
  being today's `/blog`; articles belong to one blog; authors are records (`commerce.blog_authors`: name, picture, short text, link) chosen
  on an article, shown on it and in its JSON-LD; an Atom feed per blog (`/blog/{blog}.atom`, published articles only, a test parses it);
  comments (`commerce.blog_comments`, decision 3) held for moderation by default, checked for spam in code, rate-limited by hashed keys, no
  cookie, personal data with export and erasure; scheduled articles through F's schedules.
- **H (D342) Producer responsibility.** A *Producer responsibility* page under Settings: registrations (scheme, country, number,
  authority, valid from and to) written only by `src/server/producer-registrations.ts`; `commerce.registration_blocks()` (the view's rule)
  read by the cart and `placeOrder()` alike: a product under a scheme with no valid registration in a country is not sold there from the
  day after its registration ends, with a plain reason; staff see what is blocked; the number shown on the product page and the invoice
  where the scheme asks. Copies carry nothing (a registration is the company's).
- **I (D343) Customs and duties.** A rates table the platform keeps (`commerce.duty_rates`: destination, HS heading prefix, rate,
  threshold, source, checked-on, verified; decision 2), `dutyEstimate()` pure in code (BigInt, a missing HS code gives no estimate and a
  plain message, never zero), shown at checkout for a destination outside the EU as an estimate, collected (DDP) or left to the carrier
  (DAP) per country by the store's choice, kept on the order; `ShippingCarrierAdapter.book()` carries customs lines for such a destination
  and refuses without them (Bring first); the EU's end of the 150 EUR duty exemption (1 July 2026) is a dated rule in the table.
- **J (D344) Themes from outside.** An owner's live look (or a demo store's) is submitted as a theme by its author (owner or invited
  designer account), waits in a review queue at Themes → Submissions (approve, reject with a reason, hide), shows its author, version and
  the number of stores using it; an author's update is offered to installs (*What's new*, Update), and following updates becomes a choice
  the owner makes per install, off by default for new installs (decision 4). A premium theme is invoiced and paid in Stripe's test mode on
  a real test store, recorded as the row's evidence.

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
