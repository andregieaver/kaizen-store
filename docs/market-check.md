# The market check (D900)

Written on 25 November 2026 from the owner's question: *would it make sense to run competitor analysis, a SWOT or the like, to find the
gaps and position a store better in its market?* The answer was yes, but not as a report a model writes from memory. A SWOT drawn from
what a model half remembers names rivals that may not exist, prices it guessed and lines like "strong brand, limited reach" that fit
every shop. CLAUDE.md forbids that (the model never states a price, stock level or product it was not given by a tool). Homer would not
read a two-by-two grid either. What he acts on is one sentence and one button: *Visitors in Germany buy at a third of your other
countries' rate, and they searched for "linen" 41 times and found nothing. Make a plan?*

So the market check is a set of **facts read by code**, each with its source, from which **findings are worked out in code**. The model
only writes the words of a plan for the owner's yes. A SWOT is one way of drawing those findings, never a text of its own.

## 1. What is built from what

The parts already exist; the market check joins them:

| Part | Where | What it gives |
|---|---|---|
| Visits, orders, conversion and the average order per country | `trafficReport().byMarket` (`src/server/analytics-traffic-data.ts`, D152) | the store's own performance, market by market |
| Searches that found nothing | `commerce.search_queries` (D72), `MISS` in `src/server/analytics-search-data.ts` | demand the store does not meet, by the market it was searched in |
| Prices per market | `commerce.kept_prices`, `commerce.market_availability` (D335) | what a market can buy |
| Text in a market's language | `product_translations`, written by the store translator (`src/server/store-translate.ts`, D110) | what a market reads in another language |
| Web research | `search_web`, `read_web_page`, research notes (D329, `docs/ai-autopilot.md` 13) | rivals' pages, read as data, cited |
| Goals, plans and goal reviews | D309, D328 | where a finding leads: a plan, kept for the owner's yes |
| *Ask the AI manager* | `AskAboutAlert`, `ASK_AI_MANAGER_EVENT` (D348, D416) | a finding handed over in words written by code |

## 2. The steps

| Step | What | State |
|---|---|---|
| **M1** | **Your markets side by side**: the store against itself, country by country, from its own data only. No rival is read. | Built (2026-11-25) |
| M1b | Kaizena Flow's sign-ups by country. | Parked (25 November 2026): its site sells in one country, so it would be one row (3.5) |
| M2 | **Rivals**: up to 8 per market, added by the owner, with offers read by code from their own pages and held against the store's prices. The SWOT as a view of M1 and M2. | Built, deployed at `9dfeeb3` (25 November 2026): migration `20261125181441_previous_black_crow.sql`, advisors INFO only |
| M3 | **Watching**: rivals' pages read again before they go old; a change is kept, a threat in the SWOT and an autopilot event, never an action. | Built, deployed at `afc199e` (26 November 2026): migration `20261125225113_whole_the_leader.sql`, advisors INFO only |
| M4 | **The platform's rivals**: Kaizena Flow against other store platforms (plan prices and fees), cited and checked on their pages, beside `platform_pricing_facts` (D854). | Built but EU features, deployed at `9fbb82c` (26 November 2026): migration `20261125234508_friendly_lily_hollister.sql`, advisors INFO only |
| M5a | **Rivals for every site**: rivals without a shop, and what changed on their sites, read from their own sitemaps (7.2). | Built, deployed at `4a5d1f7` (26 November 2026): migration `20261126083203_big_wild_child.sql`, advisors INFO only |
| M5b | **Search visibility**: where the store and its rivals stand for up to 10 words a market, monthly (7.3). | Spec |
| M5c | **Speed**: the store's and its rivals' speed as their visitors meet it, from the Chrome UX Report (7.4). | Spec |
| M5d | **Service prices**: a rival's published service prices kept by hand with their page and checked there by code, like M4 (7.5). | Built (26 November 2026): migration `20261126112637_absent_magma.sql` |
| M5e | **Enquiries as the conversion**: forms, bookings and appointments per country where a store has no orders (7.6). | Spec |

## 3. M1: your markets side by side (built)

Analytics → **Markets** (`/admin/{store}/analytics/markets`), the AI manager's `market_check`, and the goal reviews' reading.

### 3.1 The facts, per country

Over the period picked (the analytics period, `?period=`), for each country the store sells to (its `markets`, one row per country
however many language or currency views it has) and any other country a visit or a search of the period was in:

| Fact | Read from | Not known when |
|---|---|---|
| Visits, orders from visits, revenue, conversion, average order | `trafficReport().byMarket`, D152's definitions unchanged | visit counting is off, or no day of the period was counted |
| Searches, searches that found nothing, their share | `searchesByMarket()`: `search_queries` of the period by `market_code`, `MISS` as the Traffic page counts it | the period lies before the 90 days searches are kept |
| The terms that found nothing most often there | the same read, at most `MARKET_TERMS` (5) per country | — |
| Products with no price there | active products (not demo products) with no variant priced in the country (`kept_prices`) that are not switched off there | — (a store with no shop has no prices: not shown) |
| Products without a name in the country's language | active products with no title in the country's own language, when it is not the store's main language (the translator, `/translate`, writes them) | the store's main language is the country's |

The definitions are written in `docs/analytics.md` ("Markets"). Every fact is read by code; a fact that cannot be known is shown as what
is missing and how to add it, never as zero.

### 3.2 The findings

Worked out in code (`marketFindings()` in `src/lib/market-check.ts`, pure), each with a minimum volume so small numbers raise nothing:

| Finding | When | Its figures |
|---|---|---|
| `weak_market` | a country's conversion is under the rest of the store's, with at least `MIN_VISITS` (200) visits on each side, at least `MIN_ORDERS` (10) orders in the rest, and a two-proportion z of −1.96 or lower (`twoProportionZ()`, D299) | the two rates; the orders it would have had at the rest's rate, an estimate that says so |
| `unmet_demand` | a term found nothing at least `MIN_MISSES` (5) times in the period, the countries' misses added up | the misses, the countries they were in |
| `untranslated` | a country's own language is not the main one, and products have no name in it | the products without one, of how many |
| `unpriced` | active products have no price in a country the store sells to | the products, of how many |
| `strong_market` | as `weak_market`, the other way: a country that buys clearly more than the rest | the two rates |

The order is fixed by code: one finding of each kind in the order of the table, then the next of each, each kind's own largest first
(the most orders at stake, the most misses, the most products). So Homer's three are three different kinds of work, not three searches.

### 3.3 The screen

- **Homer**: *What to do in your markets*, the first three findings, each one sentence with its figures, **Make a plan** (the AI manager
  opened with the finding's words and figures written by code, `askAboutFinding()`; nothing is sent until the person presses Send, and
  every change the plan makes waits for their yes as always) and a quiet link to the page that fixes it (Search for a term, Translate for
  a language, Products for prices, Traffic for a country). Without the AI manager on the page the link is the main action. Nothing to do
  says so in one line.
- **Lisa**, one step away: *Every country, side by side*, the table of 3.1 with each figure's definition a click away, every finding,
  and the terms that found nothing per country.
- A country with too little data says so (*too few visits to compare*) rather than show a rate that means nothing.

### 3.4 The AI manager and the autopilot

`market_check` (`analytics:read`, read-only, ungated) gives the facts and the findings as code wrote them, for the last 7 to 90 days. Its
description says to quote it and never compare or add up figures itself. A goal's review may call it (`REVIEW_READ_TOOLS`), so a plan toward
a revenue goal can start from a weak market or an unmet search. It never changes anything: what a plan does about a finding goes through
that tool's own gate.

### 3.5 Kaizena Flow's own store

The same page serves Kaizena Flow's store (`/admin/kaizenaflow/analytics/markets`), with what applies to it: visits by country, the
searches of its site that found nothing and its text by language. It sells plans through Stripe, not goods, so orders, the average order
and prices per country do not apply, and the page says so in one line. Its conversion is sign-ups per visit (`houseSignupRate()`, D757),
which is known for the site as a whole but not by country: a sign-up keeps no country.

**M1b is parked** (read on 25 November 2026): kaizenaflow.com sells in one country (NO, in English and Norwegian), so every visit's
country is NO (153 in 30 days) and a sign-up's country would be the same one row; there was one sign-up in those 30 days, far under any
minimum volume. A split worth having is by language (a sign-up already keeps its `locale`), and it is taken up when the site has at least
`MIN_ORDERS` (10) sign-ups a month, or when Kaizena Flow sells in a second country.

## 4. M2: rivals and the SWOT (built 25 November 2026)

- **Who they are.** The owner adds each rival on Analytics → Markets, by country, name and web address: adding it is the owner's own act,
  so a rival is always one they recognise (the AI manager may suggest shops it found with `search_web`, never add one).
  `commerce.market_rivals` (store, country, name, host without `www.`, who added it, when), at most `RIVALS_PER_MARKET` (8) a country,
  written only by `src/server/market-rivals.ts`.
- **What is read, and how.** A rival's product page is read by `readOfferPage()` (`src/server/research.ts`): `safeFetch()`, the site's
  robots.txt first (`obeyRobots()`: a page it closes is refused; so is every page of a site whose robots.txt answers with a server error or
  not at all), the day's page limit, the page kept as a research source. Only a page on the rival's own host (`onRivalSite()`). The offer
  is taken from the page's own JSON-LD (`pageOffers()`: schema.org `Product` and `Offer` or `AggregateOffer`, `OfferShippingDetails`,
  `MerchantReturnPolicy`), else nothing is kept and the reader says so; the model never reads a price off a page's words. One page at a
  time, by a person on the page (*Read the page*) or the AI manager (`read_rival_offer`), at most `OFFERS_PER_RIVAL` (50) a rival; never
  behind a sign-in and never a whole catalogue (the EU database right, Directive 96/9/EC).
- **What is kept.** `commerce.rival_offers`: the page, the rival's product name, its price and currency (an `AggregateOffer`'s lowest and
  highest), availability, the cheapest shipping stated and its currency, delivery days, the returns window, when it was read, and the
  store's own product it is held against (by handle). Reading a page again replaces its row. An offer read over `OFFER_FRESH_DAYS` (30)
  ago is shown as old and makes no finding.
- **What is compared.** By code (`priceGap()`): the store's price for the product in the rival's country (the lowest of its variants'
  current prices there, VAT included as shoppers see it) against the rival's, only in one currency, never converted. A rival at least
  `PRICE_GAP_MIN` (a tenth) cheaper on a fresh offer is a finding of kind `rival_cheaper`, in the market check's order after the searches
  that found nothing; one a tenth dearer is `rival_dearer`, kept last. A fresh offer whose page says it cannot be bought now (out of stock or
  discontinued, `rivalGone()`), for a product the store has a price for there, is `rival_out`, a gap the rival leaves; no price is compared
  then. Delivery and returns are kept and shown; they are not compared yet.
- **Where it is seen.** Lisa's part of Analytics → Markets, *Your rivals*: the rivals with their country and *Remove*, *Add rival*, *Read
  the page*, and the offers' table (theirs, yours, the difference, when read). Homer sees a rival only as a finding among the three. The AI
  manager reads them with `list_rivals`. Kaizena Flow's own store has no rivals here: its rivals are other platforms (M4).
- **The SWOT.** Every finding of M1 and M2 drawn in one of four parts by its kind (`SWOT_OF`, `swotOf()`), each line the finding's own
  sentence with its page and *Make a plan*: **strengths** where the store beats its own other countries (`strong_market`) or a rival
  (`rival_dearer`); **weaknesses** where it trails them (`weak_market`, `rival_cheaper`) or lacks a price or a name (`unpriced`,
  `untranslated`); **opportunities** in searches that found nothing (`unmet_demand`) and gaps rivals leave (`rival_out`); **threats** in
  rivals' moves, which only watching them shows (M3): the part is empty until then and says so. It sits in Lisa's part of the page, above
  the countries' table; Homer still sees three findings. `market_check` names each finding's part, so a SWOT the AI manager is asked for
  is these lines sorted, never one written from memory. Kaizena Flow's own store gets the same SWOT of its own findings; its threats part
  says its rivals are other platforms (M4).
- **Staff only.** Like research notes, nothing of it is shown to shoppers. A store that publishes a comparison ("cheaper than X") must
  keep it objective and verifiable (Directive 2006/114/EC): the market check never writes one.

## 5. M3: watching (built 25 November 2026)

- **What moved is kept by every read.** `keepOffer()` (`src/server/market-rivals.ts`) is the one upsert of an offer: where a read differs
  from what was kept in price, currency, availability, shipping or returns, what was kept becomes `previous` and `changed_at` is now. A
  person's *Read the page*, the AI manager's `read_rival_offer` and the watcher alike keep it.
- **The watcher.** The five-minute dispatcher's `rivalWatch` (`watchRivals()`) reads a few offers read longer ago than `RIVAL_WATCH_DAYS`
  (28) again, oldest first, before they go old at 30 days: `WATCH_PER_RUN` (3) a run, at most `WATCH_PER_STORE_DAY` (30) a store a day,
  within the store's 200 pages, as the person who added the rival (robots.txt first, kept as a source). A page it cannot read waits
  `RIVAL_RETRY_DAYS` (7) and goes old. It is code, not AI, so it runs for every open store with rivals, not only in the goal reviews the
  first plan named; Kaizena Flow's own store has none.
- **A threat.** A fresh offer that changed within 30 days in the rival's favour is a finding of kind `rival_move` (`rivalMove()`): its price
  down by `RIVAL_MOVE_MIN` (a twentieth) or more in one currency, else its shipping down, else its returns window longer. It is the SWOT's
  threats part, after a rival being cheaper in the order. The rivals' table shows the price it was.
- **An event, never an action.** For a store that reacts (`planning.reacts`), a change held against one of its products is a row of
  `autopilot_events` of kind `rival_changed` (D331), found by a scan, since a rival's page is not an event the database queues; once per
  change. Its turn has `list_rivals`, `market_check`, `get_product`, `list_products` and the review's planning tools, and may make one plan.
  **A store's price never follows a rival's by itself**: that plan always waits for the owner's yes, whatever the autopilot's levels
  (`runEvents()` never starts it). Prices that follow each other by algorithm are a live concern of EU competition law (the Commission's
  horizontal guidelines, 2023), and the fastest way to a race to the bottom.

## 6. M4: the platform's rivals (built 26 November 2026, but the EU features)

- **What is kept.** `commerce.platform_rival_prices`, the platform's own rows: another store platform's plan, its price, currency and
  interval, the transaction fee it takes on top, the page it was read from, and Kaizena Flow's plan it is held against. A platform admin
  keeps one on Platform → Plans (*Other platforms' prices*, beside *AI and prices*), at most `PLATFORM_RIVAL_PRICES_MAX` (60); kept again in
  place by platform, plan, currency and interval. Written only by `src/server/market-rivals.ts`.
- **Cited and checked by code.** When a price is kept, its page is read (`readWebPage()`, robots.txt first, kept as a research source) and
  `priceOnPage()` says whether the figure stands there beside its currency's mark: *On its page*, *Not found on its page* or *Page not read*.
  The dispatcher's `rivalWatch` reads each page again once it was checked longer ago than `PLATFORM_WATCH_DAYS` (28), two a run, as the admin
  who kept it: found, it is checked today; a price that was on its page and is no longer is *Gone from its page* for a person to check again.
  Code never guesses the new figure, and the model never reads a price off a page.
- **Compared by code.** Against the active price of the plan it is held against in the same currency and interval (`priceGap()`), never
  converted. The card says how much dearer or cheaper Kaizena Flow is.
- **For the AI, facts only.** `platform_pricing_facts` carries them as `other_platforms`, each with its difference, whether it is on its
  page and its source, and the note that they are facts to weigh, never on their own a reason for `set_platform_price` (D854's own gate and
  range still decide every change). Kaizena Flow's own store's Analytics → Markets points to them.
- **Still to come in M4.** EU features side by side (VAT OSS, the Omnibus 30-day price, the EAA): `docs/parity/` already keeps them by
  hand for Shopify, with sources and dates.

## 7. M5: rivals for every site (D905)

Asked on 26 November 2026 by the owner: M2 to M4 need the online store turned on, and *offer no value to sites with it turned off. How can
we bring value to these as well in terms of competitor watch and analysis?* A store without a shop (a service business, a consultant, a
booking or appointment site, a content site) has no products and prices to hold against a rival's offer, so M2's rivals and M3's watching
were closed to it.

### 7.1 What every site has

Every site can still be held against its rivals on what they publish for anyone, and robots, to read, without a product or a price of its
own: the pages they add and take down (their sitemaps), where they stand in search for the words that matter, how fast their pages are for
their visitors, the prices they publish for services, and, on the store's side, its own enquiries per country. Each is a fact read by code
with its source and a finding worked out by code, as in M1 to M4; the model only words a plan.

Never read: a rival's ratings and reviews over time from Google (the Places terms allow them shown when fetched, never kept), social media
pages (their terms, and most are behind a sign-in), anything behind a sign-in, and a site's words in bulk (the EU database right, Directive
96/9/EC): a sitemap gives addresses, not content.

### 7.2 M5a: rivals for every site, and what changed on their sites

- **Rivals without a shop.** Adding a rival no longer needs the shop: *Your rivals* on Analytics → Markets is for every store. What needs
  products stays the shop's: reading a product page (*Read the page*, `read_rival_offer`), the offers' table and the price findings.
  Kaizena Flow's own store gets rivals too: other store platforms' sites, beside M4's prices on Platform → Plans.
- **What is read.** Each rival's sitemap (sitemaps.org), which a site publishes for robots to read: robots.txt first (`obeyRobots()`: a
  sitemap it closes is not read, nor any of a site whose robots.txt cannot be heard), the sitemaps robots.txt names and `/sitemap.xml`, an
  index's files followed up to `SITE_FILES_MAX` (5), on the rival's own host only. Each file is counted in the store's 200 pages a day and
  kept as a research source. Only the addresses (`<loc>`) are kept, as paths; no page is fetched and no page's words are read.
- **What is kept.** `commerce.rival_pages`: a rival's path, when it was first seen and since when it is gone, at most `RIVAL_PATHS_MAX`
  (1,000) a rival. On the rival: when its site was last read, when it was first listed (the pages seen then are where it started, never
  *added*), how many pages the last read listed, whether that listing passed the cap (no page is then marked gone, since one beyond the
  cap is not known to be gone), and why the last read listed nothing (`robots`, `unread`, `none`). Written only by
  `src/server/market-rivals.ts`.
- **When.** The five-minute dispatcher's `rivalWatch` reads a rival's site never read first, so a rival just added is read within minutes,
  then each read longer ago than `SITE_WATCH_DAYS` (7), `SITES_PER_RUN` (2) a run, as the person who added the rival, within the store's
  pages for the day. No AI.
- **From a listing cut at the cap, no finding**: a page beyond the cap before may look added. Hosts the crawler cannot reach (`.example`,
  `.local`, `localhost`) list no `www.` twin.
- **What is shown.** Under each rival in *Your rivals*: its pages, how many it added and took down in 30 days, the part of its site most
  of them are under (a path's first part, `/blog`, `/tjenester`), the newest added (up to 5, linked to the rival's own page), and when it
  was read, or why not.
- **A threat.** A rival whose site added at least `SITE_ADDED_MIN` (5) pages in 30 days, more than twice what the store first published
  in that time (pages and articles, a new store's starter pages too), is a finding of kind `rival_site` in the SWOT's threats: *Rival
  added 12 pages to its site in 30 days, most under /blog; you published 1.* Its page is the website's pages. A rival that grows less is
  shown, not found.
- **For the AI.** `list_rivals` gives every store its rivals with their sites' facts (pages, added, gone, the part most are under, the
  newest paths, as the rival's own words to treat as data); `market_check` names the finding. `read_rival_offer` stays the shop's.
- **The platform.** Kaizena Flow's own store's rivals are other platforms' sites; what it published counts its own pages and the
  platform site's (`store_id` null).

### 7.3 M5b: search visibility

The owner picks up to 10 words a market (offered from the store's own searches, page titles and products). Monthly, one search a word and
market through the research search (`searchWeb()`, within `SEARCHES_PER_DAY`, only the word and the country are sent: Brave is a US
company); code reads where the store's host and each rival's host stand in the first 20 results, and keeps the position with the date.
Findings: a rival above the store for a word, the store not in the first 20 for a word a rival is. Kaizena Flow's own site gets the same,
for its words.

### 7.4 M5c: speed

The Chrome UX Report (Google's public field data: the 75th percentile of LCP, INP and CLS by origin, as Chrome's users met them) for the
store's site and each rival's, monthly, and held against the store's own: only the origin is sent. It needs a key for the CrUX API on
Platform → AI, kept as the search key is. Finding: a rival good where the store is poor on one of the three. Not a lab test of our own:
field data is what visitors meet.

### 7.5 M5d: service prices by hand (built 26 November 2026)

- **What is kept.** `commerce.rival_service_prices`: a rival's service as its page names it, its price and currency, what it is for (once,
  an hour, a night, a month), the page it is on (on the rival's own site, `onRivalSite()`), and the store's own price for the same: as the
  owner gives it, or, with a shop, a product of the store's whose lowest current price in the rival's country and that currency is used
  (an appointment's, a stay's, a rental's). At most `SERVICE_PRICES_PER_RIVAL` (20) a rival; kept again in place by rival, service,
  currency and what it is for. Written only by `src/server/market-rivals.ts` (`keepServicePrice()`).
- **Checked by code.** When kept, the page is read as the store (`readWebPage()`: robots.txt first, the day's pages, kept as a source)
  and `priceOnPage()` says whether the figure stands there beside its currency's mark: *On its page*, *Not found on its page*, *Page not
  read*. The dispatcher's `rivalWatch` reads it again once it was checked longer ago than `RIVAL_WATCH_DAYS` (28), two a run, as the
  person who kept it; a price that was on its page and is no longer is *Gone from its page: check it*. Code never guesses the new figure,
  and the model never reads a price off a page (prices are often drawn by scripts: then a person checks).
- **Compared by code.** Only a price found on its page within 30 days and not gone since, against the store's own in the same currency
  (`serviceGap()`, `priceGap()`), never converted. At least a tenth cheaper is a weakness (`service_cheaper`), a tenth dearer a strength
  (`service_dearer`); its page is the website's pages, where a site without a shop shows its prices. A price not found is shown, not found.
- **Where.** *Their published prices* under *Your rivals* (Lisa's part): each price with what it is for, against yours, its state, when
  checked, its page and *Remove*; *Keep a price* a step in, open while there are none. `list_rivals` gives them per rival.
- **The platform.** Kaizena Flow's prices are its plans: other platforms' plan prices are kept beside them on Platform → Plans (M4), so
  its own store's Markets page has no service prices.

### 7.6 M5e: enquiries as the conversion

For a store without a shop, M1's countries count enquiries (forms sent, bookings, appointments booked) where a shop counts orders, so a weak
or strong market is found the same way and with the same minimums (`MIN_VISITS`, `MIN_ORDERS` as enquiries). Kaizena Flow's own store's
sign-ups stay M1b's, parked.

## 8. Guardrails, for every step

- Numbers only from code; the model words a plan, never a figure (CLAUDE.md, the eval's rules).
- Findings have minimum volumes and say when they are estimates.
- Reading the web is light, cited and dated; searches send only the words the agent chose, never a store's figures (Brave is a US
  company, D329).
- Nothing changes a store by itself: a finding leads to a plan, and a plan's changes wait for their gate.
- Cost: M1 costs no AI until *Make a plan* is pressed. A full M2 check is some 20 to 40 searches and a few dozen page reads, under the
  100 searches a day (`SEARCHES_PER_DAY`) and counted in the AI budget.
- M5a costs no AI: a rival's sitemap is one to six files a week, within the store's pages for the day.
