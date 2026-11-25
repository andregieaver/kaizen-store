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
| M2 | **Rivals**: 3 to 8 per market, confirmed by the owner, with facts read by code from their own pages. The SWOT as a view of M1 and M2. | Reading built (robots.txt, a page's offer data); rivals in progress |
| M3 | **Watching**: rivals' pages read again once a month in the goal reviews; a change is an autopilot event, never an action. | Planned |
| M4 | **The platform's rivals**: Kaizena Flow against other store platforms (plan prices, fees, EU features), shown beside `platform_pricing_facts` (D854). | Planned |

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

## 4. M2: rivals (planned)

- **Who they are.** The AI manager proposes rivals per market from `search_web` (a product's words, the country); the owner confirms each.
  A rival the owner does not recognise is not one. `commerce.market_rivals` (store, country, name, address, confirmed by, when), at most
  8 per country.
- **What is read, and how.** Only through `readWebPage()` (`safeFetch()`), which first honours the site's `robots.txt` (added to
  `readWebPage()` in this step), at most `RIVAL_PAGES` (10) pages per rival per month, never behind a sign-in, never a whole catalogue
  (the EU database right, Directive 96/9/EC). Facts are taken from what the page says in a machine-readable form where it has one
  (schema.org `Product` and `Offer`: price, currency, availability; `OfferShippingDetails`, `MerchantReturnPolicy`), else not taken.
  The model never reads a price off a page's text.
- **What is kept.** A fact is a row with its source (`research_sources`), the day it was read and the page's text hash: a price for a
  product the owner matched to their own, the shipping cost and time to that country, the free-shipping threshold, the returns window,
  the languages. A fact older than 30 days is shown as old.
- **What is compared.** By code: a price index per matched product (theirs over ours, VAT included as shoppers see both), delivery
  against delivery, returns against returns. **The SWOT** is drawn from M1 and M2 together, every line pointing at its fact: strengths and
  weaknesses where the store beats or trails its rivals and its own other markets, opportunities in searches that found nothing and gaps
  rivals leave, threats in rivals' moves (M3).
- **Staff only.** Like research notes, nothing of it is shown to shoppers. A store that publishes a comparison ("cheaper than X") must
  keep it objective and verifiable (Directive 2006/114/EC): the market check never writes one.

## 5. M3: watching (planned)

A rival's pages are read again once a month in the goal reviews (D328), within the same limits; a changed hash is read for its facts again.
A price, shipping or returns change is a row of `autopilot_events` of kind `rival_changed` (D331), answered as events are: a note, or a plan
kept for a yes. **A store's price never follows a rival's by itself**: a price change in an answer to this event always waits for the
owner's yes, whatever the autopilot's level. Prices that follow each other by algorithm are a live concern of EU competition law
(the Commission's horizontal guidelines, 2023), and the fastest way to a race to the bottom.

## 6. M4: the platform's rivals (planned)

Kaizena Flow's own manager compares Kaizena Flow with other store platforms on what their public pages say: plan prices per month,
transaction fees, EU-specific features (VAT OSS, the Omnibus 30-day price, the EAA). `docs/parity/` is already a careful hand-made
version of this for Shopify; M4 keeps its figures current and cites them. They are shown beside `platform_pricing_facts` (D854) as facts,
never as an input `set_platform_price` acts on by itself.

## 7. Guardrails, for every step

- Numbers only from code; the model words a plan, never a figure (CLAUDE.md, the eval's rules).
- Findings have minimum volumes and say when they are estimates.
- Reading the web is light, cited and dated; searches send only the words the agent chose, never a store's figures (Brave is a US
  company, D329).
- Nothing changes a store by itself: a finding leads to a plan, and a plan's changes wait for their gate.
- Cost: M1 costs no AI until *Make a plan* is pressed. A full M2 check is some 20 to 40 searches and a few dozen page reads, under the
  100 searches a day (`SEARCHES_PER_DAY`) and counted in the AI budget.
