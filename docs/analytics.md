# Store analytics (D152)

The owner's cockpit: `/admin/{store}/analytics`. It answers four questions fast:

1. **Are we making money?** (Overview, Finance)
2. **Why are sales changing?** (the change explained: traffic × conversion × basket, by device, channel, market, product)
3. **Which customers and products drive the business?** (Customers, Products, Marketing)
4. **Is there anything to act on today?** (alerts, targets, stock)

Eight to twelve instruments on the first screen; everything else is a drill-down. Every number has one
definition (below), worked out in code from the database, never by a model. The AI manager repeats it.

## Honesty rules

- A figure that cannot be known is **not shown as zero**: it shows what is missing and how to add it
  (costs not entered, visit counting off, no marketing spend entered).
- A figure that is estimated says so in its label ("estimated payment fees") and where the estimate comes from.
- Profit figures say how much of sales they cover (`costCoverage`): "based on 83 % of sales". Where cost is known for only part
  of sales, profit is an **estimate** and says so ("estimated from the 83 % of sales whose cost is known"); with too little known
  (under 30 %) it is missing, never a number that treats unknown cost as free (see Gross profit below).
- Small numbers do not raise alerts or verdicts: every rule has a minimum volume.
- Never a model for a number; a model may only word a diagnosis that code already worked out.

## Definitions (the one place they are written down)

All amounts are in the **store's main currency** (`mainCurrency(store)`), **without VAT**, unless a label says otherwise.
Dates are in the store's time zone (`store.timeZone`), a day being midnight to midnight there; a period is
`[from, to)` in whole days.

| Term | Definition |
|---|---|
| **Paid order** | `orders.copied_from is null and orders.host_id is null` and a `captured` payment exists. A paid order that was later cancelled and refunded still counts here; its refund is subtracted as a refund. Pending, unpaid and copied orders and hosts' orders (the store earns a commission there, not the sale) never count. Dated by `placed_at`. |
| **Revenue** | Σ over paid orders of `total_minor − tax_minor`: goods after discounts plus shipping income, without VAT. |
| **Gross sales** | Goods before discounts, without VAT: Σ line `unit_price × quantity / (1 + tax_rate)`. |
| **Discounts** | Σ line `discount_minor / (1 + tax_rate)` (campaign, group, referral, bonus credit and code, all of them) **plus the discount on shipping** (a free-shipping code): what an order's `discount_minor` holds beyond its lines' discounts, without VAT at the shipping's rate (the country's standard rate). |
| **Shipping income** | Shipping **as charged before any discount on it**, without VAT: `shipping_minor` less its VAT, plus the shipping discount's VAT-free amount (which Discounts holds). Shipping charged after the discount is `shipping_minor − shipping discount − (the order's `tax_minor` − its lines' `tax_minor`)`, because `placeOrder()` takes VAT on `shipping − shipping discount`. Revenue = gross sales − discounts + shipping income (a free-shipping code lowers both discounts and shipping income's net by the same amount, so nothing is left for a "rounding" line). |
| **VAT** | Σ `tax_minor`: the VAT **charged**. An order whose VAT was not charged (reverse charge to a business with a valid EU VAT number, D157: `orders.vat_kind = 'reverse_charge'`) has `tax_minor` 0 and its total is net; the VAT it did not charge (the **VAT relieved**, `orders.vat_relief_minor`, each line's share in `order_lines.vat_relief_minor`) is part of the order's `discount_minor` so the database's sums add up, and is **never a discount here**: Discounts, the discount kinds and the shipping split all take `vat_relief_minor` out of `discount_minor` first, so the same sale is the same gross sales, discounts, shipping income and revenue with or without its VAT. Shipping's VAT rate is the order's own `shipping_tax_rate` (the country's current standard rate only for an order that has none). |
| **Refunds** | Succeeded `refunds`, dated by `refunds.created_at`, each scaled to without-VAT by its order's `(total − tax) / total`. Refunds made only in Stripe's dashboard are not seen (Kaizen has no refund webhook); the page says so. |
| **Net revenue** | Revenue − refunds. |
| **Orders** | Count of paid orders. |
| **AOV** | Revenue / orders. |
| **COGS** | Σ `order_lines.unit_cost_minor × quantity` (main currency, kept on the line when it was sold). A line whose cost was not known has `unit_cost_minor` null and is not counted in COGS; **cost coverage** = share of the **lines'** revenue (Σ line `total − tax`) whose cost is known (lines with no variant, such as sign-up fees, count as known at 0; an order with no line at all counts as known too). Shipping income is not a line, so it is in neither the numerator nor the denominator: with no product cost entered, coverage is 0 and profit needs costs, whatever shipping was charged. The Overview, Finance, Products and Marketing (per channel) all use this one definition. |
| **Gross profit** | Net revenue − COGS, by **coverage** (`costModeOf()` in `analytics-kpi.ts`, `ESTIMATE_MIN_COVERAGE` = 0.3): at coverage **1** (or nothing sold) it is exact. From **0.3 up to, not including, 1** it is **estimated**: COGS is scaled from the covered sales to all of them, `COGS_est = COGS / coverage` (= COGS / covered line revenue × line revenue; `estimatedCogs()`), gross profit = net revenue − COGS_est, and every place that shows it says "estimated from the N % of sales whose cost is known" (the Finance bridge marks the COGS, gross, contribution and operating lines estimated; KPI cards carry the "based on N % of sales" hint). **Below 0.3** (and at 0) there is **no figure** (null, an "add costs" prompt): too little is known to scale from. Unknown cost is never taken as zero. **Gross margin %** is computed on the **covered revenue only** and is shown whenever coverage > 0, with its coverage: (covered net revenue − COGS) / covered net revenue, where covered net revenue = net revenue × coverage (refunds and shipping income spread in proportion; `coveredMargin()`). It therefore equals estimated gross profit / net revenue where profit is estimated, and gross profit / net revenue where it is exact. A series point (a day, a week) is judged on its own coverage, so its estimates do not add up to the period's own. Per-product and per-channel profit is **not** estimated: a product's profit is net revenue − the cost of the lines whose cost is known (none known: no figure) and a channel's contribution counts a sale's cost only where it is known, so both say so ("based on N % of this product's sales", the Marketing page's note) and a part-costed row looks better than it is. |
| **Payment fees** | Estimated: per paid order, `payment_fee_bps` of its total (with VAT) + `payment_fee_fixed_minor` (settings). |
| **Platform fees** | Σ `payments.kaizen_fee_minor` of captured payments (what Kaizen took, real). |
| **Shipping costs** | Estimated: `shipping_cost_minor` (settings) per paid order with a physical line. |
| **Marketing spend** | Σ `marketing_spend.amount_minor` in the period (entered by the owner, per day, channel and campaign). |
| **Contribution profit** | Net revenue − COGS − payment fees − platform fees − shipping costs − marketing spend, with the COGS of the Gross profit row (so estimated while coverage is under 1 and missing under 0.3). |
| **Operating profit (estimate)** | Contribution profit − fixed costs (`fixed_costs_monthly_minor`, pro rata by day); estimated and missing with contribution profit. |
| **Customer key** | `lower(coalesce(customers.email, orders.email))` over paid orders (an account's orders follow the account, a guest is their email). Orders with no key are not customers. **An erased person's order** (its personal data restricted for the bookkeeping duty, or anonymised: `orders.restricted_at` / `anonymised_at`, D162) belongs to nobody: it counts in revenue, VAT, refunds and orders exactly as before, but as a customer of its own with the key `order:{id}` (`GONE`, `CUSTOMER_KEY` in `analytics-sql.ts`), never joined to the person's other orders or to a later sign-up with the same address, and never in the top-customers list (which names people). The AI manager's `customer_insights` leaves such an order out of its customers but keeps it in the period's average order. |
| **New customer** | Their first paid order is in the period. **Returning customer**: a paid order in the period, first one earlier. |
| **Sessions (visits)** | Rows in `visits` for the period (a visitor-day: one hashed visitor on one day), bots and people who send Global Privacy Control left out. Only when `stores.visit_counting` is on. |
| **Conversion rate** | Paid orders / sessions over the days both are known (from the first counted day). |
| **Revenue per visitor** | Net revenue / sessions. **Contribution profit per visitor** likewise. |
| **Repeat purchase rate (N days)** | Of customers whose first order is at least N days old, the share who bought again within N days of it. N = 30, 90, 180, 365. |
| **Purchase frequency** | Paid orders in the last 365 days / distinct customers in the last 365 days. |
| **LTV (historic)** | Mean over customers of (their net revenue, and contribution when costs are known, to date). **LTV (predicted)** = contribution per order × orders per customer per year × lifespan (`ltv_lifespan_years`, default 3); with no costs, revenue per order is used and the label says revenue. |
| **CAC** | Acquisition marketing spend / new customers (blended; per channel where spend and attribution allow). **ROAS** (a channel's) = revenue attributed to the channel / its spend. **ROAS (blended)**, the "All channels" row and the Marketing headline = revenue attributed to the channels that **have ad spend** / the spend of those channels: direct, organic and unknown sales are not a return on ad spend and are never in it. **MER** (marketing efficiency ratio) = **all** revenue / **all** ad spend, shown as its own card, labelled "every sale divided by every ad krone" (the currency's own unit), never as a ROAS; it flatters the ads, since sales that came without them are in it. **Profit ROAS** = contribution before marketing / spend, per channel, and blended likewise over the channels that have spend (none when any of those channels' costs are unknown; per-channel profit is on known costs, see Gross profit). **LTV:CAC** = predicted LTV / CAC. |
| **Refund rate** | Refunds / revenue (same period, refunds by their own date). Also shown: share of orders with a refund. |
| **Discount dependency** | Paid orders with any discount / paid orders. |
| **Velocity** | Units sold per day over 7 and over 30 days (goods only); **days of stock** = on hand / (0.6 × 7-day + 0.4 × 30-day velocity); none when nothing sold. |
| **Dead stock** | On hand > 0 and not sold for 90 days. **Sell-through** = units sold / (units sold + on hand at the end). **Turnover** = COGS over 365 days / current stock at cost. |
| **On hand** (D172, wave 3) | Units at the store's **active** locations, summed (`inventory_levels.on_hand`). It is below zero only for a variant that sells on backorder (`stock_policy = 'continue'`), where it is what the store still has to receive. **A negative figure counts as 0** in stock value, units on hand, days of stock, dead stock, sell-through and the stock-out alert's "on hand"; the table shows the figure as it is and the owed units beside it, never a 0 that hides a debt. A variant on backorder is **out** (nothing on hand), not a separate state: its pill says "On backorder" and the page says how many units are owed. |
| **Owed** (D172) | Units on backorder that paid orders still wait for: Σ `order_lines.backorder_quantity` of orders with status `paid` (a captured payment, not yet sent), copied (`C-…`) orders left out. Per variant and in total; it is the Inventory page's own figure (`inventoryCounts().owed`, held equal by a test). A sent order owes nothing. Units are a count, so there is no currency and no VAT in it. |
| **Warning level** (D172) | The variant's own `low_stock_threshold` (set in the product editor or by file; empty = none). A variant is **at or below its level** when on hand is at or below it, **and is shown as running low** unless it is out (nothing on hand is out) or dead (unsold for 90 days, where restocking is not the advice). Without a level of its own, **running low** is the pace rule (days of stock 14 or fewer, with at least 3 units sold in 30 days). The control center's and the store Home's "at or below their level" count is `stock_alerts` rows in state `low` for the store's goods in active or draft products, the same variants the Inventory page lists under *low* (`inventoryCounts().low`, held equal by a test): a level that never was set is never counted, and a variant that is out is counted there only when it has a level. Their other stock counts (D172): **out of stock** is a variant that stops at zero (`deny`) with nothing on hand over the active locations (one that sells on backorder is not out, it is owed); **running low** is a variant with no level of its own and 1 to 3 on hand (a variant that is gone is out, not also low); **owed** is the figure above, for the same variants the Inventory page lists. A member who may not open Products sees none of them, left out and never shown as 0. |
| **MRR** | Active and past-due subscriptions: renewal total without VAT, per interval normalised to a month (week × 52/12, year / 12, divided by `interval_count`), in the main currency (subscriptions are in the country's own currency). |
| **Churn rate** | Of the subscriptions active at the period's start, the share cancelled during it: `cancelled.fromStart / activeAtStart`. A subscription begun and cancelled inside the period is not in the base and so not in the rate (it is in the MRR bridge's churned line, which counts every cancellation). **Revenue churn** = MRR of those cancelled-from-start subscriptions / MRR at the start. |

### Currencies

`orders.currency` is the currency the shopper saw; no rate is kept on an order and `store_currencies` keeps only
today's rate. Aggregates are grouped by currency in SQL and converted **in code** with `convertMinor()` and
`store.localization.rates`; a currency with no rate is left out and counted (`unconverted`), and the page says so. This holds on every page: the Customers page leaves such orders out of its new/returning customers and orders (the customer is counted in `unconverted`), as the Overview does, never as an order of 0. History is
therefore valued at today's rates. Costs, spend, fees and targets are entered in the main currency.

## Data

New (migration `analytics` + `analytics_rules`):

- `product_variants.cost_minor` (nullable, main currency): what one unit costs. Edited in the product editor.
- `product_variants.low_stock_threshold` (nullable, wave 3, D172): the owner's own warning level (units, on hand over the active locations); `stock_policy` (`deny` or `continue`) and `order_lines.backorder_quantity` say what sells on backorder and what is owed. Read, never written, by the Inventory analysis, the control center and the AI manager's stock tools.
- `order_lines.unit_cost_minor` (nullable): the variant's cost when the line was sold (`placeOrder()`, the subscription renewal, `copy_orders`), so later cost changes never rewrite history. Costs entered later can be applied to earlier lines with null cost (`backfillCosts()`, owner only).
- `analytics_settings` (store): `payment_fee_bps`, `payment_fee_fixed_minor`, `shipping_cost_minor`, `fixed_costs_monthly_minor`, `ltv_lifespan_years`.
- `analytics_targets` (store, month): net revenue target.
- `marketing_spend` (store, day, channel, campaign): amount.
- `stores.visit_counting` (default **off**): cookieless visit counting (below).
- `visits`, `product_views`, `carts.visit_id`: only filled while visit counting is on.

All are `never` in `COPY_RULES` except the variant cost column, which `duplicate_store()` and `clone_store()` copy with the variant.

## Visit counting (no cookies, no storage, no cookie banner)

An owner switches it on under Analytics settings, knowing what it is; it is off until then. The store's Cookies page
(shopper-facing, in each of the store's languages, `visitCounting` in `src/lib/i18n.ts`) and the admin's Cookies page say what
it does, including that a cart ties the visit to a sale. The owner's own privacy policy is theirs to write.

**What is and is not claimed.** A visit row holds no name, contact detail, IP address or user agent, and nothing is set or
stored in the browser, so it shows no cookie banner. It is *not* "anonymous": the id is a keyed hash of address and user agent
(not random), and a visit that has a cart is tied to that cart, and so to the order made from it and whoever placed it.
Whoever holds the server's secret (`SETTINGS_ENCRYPTION_KEY`, from which every day's key is derived; it is not destroyed) could
test a known address and user agent against a day's ids, so the id is a pseudonym, not a proof of anonymity. What the text to
shoppers promises is only: no cookies, no IP address or browser details stored, an id that changes every store day so it
cannot be followed from one day to the next, and that adding to the cart lets the store tell which channel a sale came from.

- **The beacon.** `VisitBeacon` (`src/components/visit-beacon.tsx`, mounted by `StoreVisits` in the market layout and in the
  country chooser's layout, only while the store has counting on) sends `navigator.sendBeacon` (a plain-text body) with the
  page's path (never its query), on the first page view of a page load the referring site's host (when it is another site), the
  three `utm_*` tags, and a flag for each ad click id that was in the address (`gclid`, `fbclid`, `ttclid`: true or absent,
  never its value), and nothing else. It sends nothing when the browser says Global Privacy Control or Do Not Track. The
  path is raw in the request; the server never stores it (below).
- **The endpoint.** `/api/visit` (POST only, same-site, at most 1000 bytes, no cookie, always an empty uncached 204 once the
  request is read) drops bots (`isBot()`), and anyone who sends Global Privacy Control or Do Not Track, and keeps **no IP
  address and no user agent**. The request must also come from a page *of the store the body names*
  (`fromStoresOwnPage()`): `Origin` and/or `Referer` must be the host the request came to, which is one of this store's own
  hosts, or, while stores live on Kaizen's host, a page under `/s/{store}` (so a `Referer` is needed there). A request with
  neither header, or from another store's page, is dropped (`wrong_site`).
- **The visitor.** One day clock: the **store's calendar day** (`storeDayKey(now, store.timeZone)`) is both the row's `day` and
  the day the key is for. The visitor is `HMAC-SHA256(key = HMAC(purpose key, store day), JSON[store id, ip, user agent])` cut
  to 24 hex characters, where the purpose key is `HMAC(SETTINGS_ENCRYPTION_KEY, "kaizen:visit-counting")`. The key changes every
  store day, so a stored id cannot be followed from one day to the next, and the cut hash cannot be turned back into an
  address. A row is one visitor-day: `visits (store_id, day, visitor)` with market, device class, channel, source, campaign,
  landing path, page views, product views, and when checkout was reached. One person on one store day is one row, whichever side
  of UTC midnight they are on.
- **The landing path is never the raw path.** Pages carry orders' ids and tokens in their addresses (a sign-in link, an invoice,
  an unsubscribe link), so `placeOfPath().landing` (`src/lib/visit-record.ts`) keeps only a short list of shapes, with the
  market's country in front (`/no`), and everything else is `(other)`: `/` (the country chooser), `/no`, `/no/p/{handle}` (the
  handle checked against a handle's characters and 100 characters), `/no/category/{slug}`, `/no/tag/{slug}`, `/no/blog`,
  `/no/blog/{slug}`, `/no/cart`, `/no/checkout`, `/no/search`, `/no/products`, and `/no/{slug}` for one segment that is a slug
  and not a working route (`account`, `order`, `unsubscribe`, `download`, `subscription`, `deliveries`, `wishlist`, `cookies`
  and the other reserved page slugs). Anything after those shapes (`/account/sign-in/{token}`, `/order/{id}`,
  `/cart/restore/{token}`, `/download/{token}`) makes the whole path `(other)`; the query and fragment are dropped first.
  The product counter still follows the real product handle.
- **Channel** is decided once, on the visitor-day's first page view, by `classifyChannel()` (referrer host and `utm_medium`
  / `utm_source`): direct, organic search, paid search, organic social, paid social, email, affiliate, referral, other.
- **Carts.** A cart made when the same visitor-day already has a row gets `carts.visit_id` (`openCart()` →
  `attachVisitToCart()`: the same store day, one lookup), which is how an order knows its channel and device; orders with no
  visit are "Unknown". This is the one place a visit meets an order, and so a customer: nothing else links them, and deleting a
  visit (below) sets `visit_id` to null.
- **Limits against abuse** (`NEW_VISITS_PER_STORE_DAY` = 50,000 new rows per store per day; `NEW_VISITS_PER_ADDRESS_WINDOW` =
  100 new rows per address in ten minutes; `PAGE_VIEW_CAP` = 3,000 page views per visitor-day). They are counted in
  `commerce.chat_usage` (buckets `visits` and `vn:{keyed hash of the address}`, a keyed hash that holds no address and is
  deleted with the other counters after two days, `pruneChatUsage()`), before a *new* row is written; page views on a row that
  exists are not counted against the first two. They **bound** what a script can do (varying its user agent to start many
  rows, or posting from a script on the same host); they do not prevent it, and a count is not tamper-proof: the endpoint is
  open to the web and `Origin`/`Referer` are only what the sender says. A sudden jump in visits is worth a look before it is
  trusted. The check and the count are two statements, so a burst can overshoot a limit slightly.
- Rows older than 25 months are deleted by the daily job.

## Pages

`/admin/{store}/analytics` and below, one new store section **Analytics** (`src/lib/store-nav.ts`), pages in `ADMIN_PAGES`:

| Page | For |
|---|---|
| Overview | 8–12 KPIs with change vs previous period and vs last year, revenue and profit charts, funnel, top products, top channels, alerts, target progress |
| Finance | gross sales → net revenue → contribution → operating profit, costs, refunds, VAT |
| Customers | new vs returning, repeat rate, frequency, LTV, RFM segments, cohorts |
| Products | revenue, units, orders, margin, refund rate, revenue and profit share, velocity |
| Inventory | stock, value, days remaining, stockouts, dead stock, turnover, sell-through |
| Marketing | channels: sessions, orders, revenue, conversion, CAC, ROAS, profit ROAS, LTV:CAC; spend entry; discounts and coupons |
| Subscriptions | MRR and its movements, churn, failed renewals, subscribers |
| Traffic | funnel, devices, geography, search, sales by weekday and hour; refunds and returns (D153) at the bottom |
| Settings | costs, fees, fixed costs, lifespan, targets, visit counting |

Common: a period (today, yesterday, 7 days, 30 days, this month, previous month, this year, custom) and a comparison
(previous period, same period last year, none) kept in the address (`?period=&from=&to=&compare=`); every chart has a table
behind it; amounts and percentages are formatted once, by the same functions. "Same period last year" starts on the same
date one year earlier (29 February becomes 28 February) and is as many days long as the period (`lastYearOf()`), so totals
are never held against a span a day longer or shorter. Figures are written one way
everywhere (`formatNumber()` in `analytics-core.ts` is the only place digits are rounded and grouped): a decimal point and
thousands split by a no-break space ("2 110", "2.7 %", "1 234.5"), whatever the store's market; only an amount of money
follows its market's locale (through `formatAmount()` in `analytics-format.ts`). A negative number or amount is written with
the proper minus sign **−** (U+2212) everywhere ("−3.2 %", "−1 234", "−300,00 kr"; `MINUS`, `withMinus()`), never a hyphen.
Months and days are labelled by one helper (`formatMonth()`, `formatDate()` in `analytics-core.ts`; the short names "Jan" …
"Sep" … "Dec", never the runtime's "Sept"), so a cohort's "Sep 2026" and a period's "3 Sep 2026" agree. Customer segments (RFM) are scored by rank percentiles with ties
sharing the middle of their places; At risk and Lost are only for customers who have gone quiet (R 1 or 2).

The comparison's dashed line is aligned **by day offset**, never by bucket index: when a chart is by week or month, each
current bucket (cut to the period at its edges) is held against the comparison's days at the same offsets from its own
start (`alignedSpans()`), so a 5-day first bucket meets 5 days, not a whole week that starts on another weekday. A bucket
the comparison has too few days for has no point (null), not a shorter one.

## Alerts, targets, forecast, diagnosis

- **Alerts** (`alertsFor()`, computed on read, never stored): conversion drop, a day's revenue far under its weekday's
  normal, a product's refunds over twice its normal, CAC up, stock out within a week, high checkout abandonment, rising
  discount dependency, target at risk, missing costs (under 30 % of sales with a cost: a warning that profit is not shown;
  from there to 80 %: information that profit is estimated), and the good news (yesterday the best day in 90 days; returning
  customers' revenue at a 12-month high). Each has severity, words, a link (a path after the store's admin base), and its
  evidence; each has a minimum volume (`ALERT_RULES`). The stock-out alert names a variant that keeps selling with nothing on hand as *on backorder* with the units owed, and is a warning, not urgent (the store chose to sell past its stock; D172): it is urgent only when something that stops at zero is gone. `alertSnapshotFor()` (`src/server/analytics-insights.ts`) reads the
  inputs from the existing reports, all at once; a report that fails leaves its rule out and never reaches the page
  (`alertsForStore()` does not throw). A product's refund rate is in units, and Kaizen keeps a refund as an amount: a refund
  counts as the share of the order it paid back of each goods line's quantity. The Overview shows them under "Needs you
  today", the store's home page the top three (read after the page is shown) with a link to the Overview.
  Rising discount dependency (`detectCreeping()`) needs three consecutive monthly rises of at least 8 points, **and** at least
  30 paid orders in the first and in the last month of the run, **and** a pooled two-proportion z-test of the first month's
  share against the last's at z >= 2.58 (p < 0.01): small months move by chance (7, 16, 18, 32 % on 15, 28, 33, 41 orders
  does not fire; 22, 31, 46, 58 % on 120 orders or more does).
  Two rules guard against chance, proved by simulation tests over 200 ordinary days each (fewer than 3 % may fire):
  a day's revenue against its weekday's usual speaks only from 20:00 (sales are not linear over the clock, and the
  snapshot has no hourly profile) and only when a usual day brings 15 orders by then; a target at risk needs seven whole
  days of the month, 30 orders in it, and a shortfall over 2.5 standard deviations of what the days so far could add up
  to by chance (from the last 56 days' spread of a day's revenue).
- **Targets** (`analytics_targets`): a month's net revenue; progress, the share expected by today (the month's
  weekday-weighted run), and ahead or behind.
- **Forecast** (`forecastMonth()`): level from the last eight weeks × weekday profile × last year's seasonality when a year
  exists; a range from the spread of the days; labelled an estimate. Under 14 days of sales it says too little history and
  gives no figure. The level is the plain eight-week mean, so a steady rise or fall is not extended (the card says so).
- **Diagnosis** (`explainChange()`): revenue = sessions × conversion × AOV (orders × AOV without visits), each factor's
  share of the change in code, the segment that moved most (device, channel, market, product), when it started, and
  a recommended place to look. The words are templates; a model is never involved. Revenue here is before refunds,
  without VAT (the AOV of the definitions, and what the tables by device, channel, market and product show; refunds are
  on the Finance page). Sessions, and the device and channel tables, are used only when visits were counted from before
  both periods began; otherwise it is orders × AOV and says so. A period with fewer than 10 orders is explained with a
  warning that it may be chance.
- The AI manager gets read-only, ungated tools over the same functions (`analytics_overview`, `explain_change`,
  `analytics_alerts`; `src/server/analytics-tools.ts`), served to Kaizen Life's assistant like every owner tool.

## Returns (D153)

The Returns section of the Traffic page (under Refunds), `returnsReport()` in `src/server/analytics-returns-data.ts`, pure parts in
`src/lib/analytics-returns.ts`. It reads `commerce.returns` and `return_lines` (`docs/returns.md`); copied and hosts' orders never count,
amounts are in the main currency without VAT, days are the store's, and an order (or a return of an order) in a currency with no rate is left
out of every figure and counted (`unconverted`), like every other page.

| Term | Definition |
|---|---|
| **Return** | A row of `returns` (a withdrawal return, `kind = 'withdrawal'`, or a voluntary return, `kind = 'return'`), dated by `created_at` (a withdrawal return is made when the withdrawal is confirmed). A **counting return** is one that is not `declined` or `cancelled`: it asks for goods back. **Returns made** = counting returns created in the period, split into withdrawals and voluntary returns; declined voluntary requests and cancelled returns are shown beside, never in the rates. |
| **Cohort** | Paid orders placed in the period that have at least one **goods line** (`variant_id` set and `delivery = 'physical'`): orders that could be returned. **Units sold** = Σ quantity of those goods lines. Services, bookings and digital content are not units that can come back, so they are in neither the numerator nor the denominator. |
| **Return rate (orders)** | Cohort orders with at least one counting return, **made at any time**, / cohort orders. Like the share of orders with a refund it keeps growing while the cohort's returns arrive; the page says so when the period's last days are still inside the store's return window (`return_settings.window_days`). |
| **Return rate (units)** | Units on accepted lines (`return_lines.decision = 'accept'`) of counting returns of cohort orders / units sold in the cohort. A line the law excludes is declined, so it is never in the numerator. |
| **Returned value** | The cohort's accepted return lines at what they were sold for, without VAT: `(total − tax) × returned quantity / line quantity`, before any deduction for diminished value. |
| **Refunded for returns** | Σ `returns.refund_minor` dated by `refunded_at` in the period, each scaled to without VAT by its order's `(total − tax) / total`, as Refunds scales a refund. A return refunded outside Kaizen's Stripe (`refund_outside`) is included, because the return records it, and counted apart. |
| **Reasons** | `returns.reason`, a fixed list. A withdrawal asks for no reason and is never refused for one, so most withdrawals have none: **No reason given** is its own row and is never spread over the others. Shares are of the returns that have a reason, and are shown only when at least `MIN_REASON_SAMPLE` (10) returns made in the period have one; counts are always shown. |
| **Time to refund** | For returns refunded in the period: **request to refund** (a withdrawal's confirmation, or a voluntary request's date, to `refunded_at`) and **received to refund** (`received_at` to `refunded_at`; only returns received before the refund: a store that refunds on the request has none). Shown as the **median** in days with the slowest, only from `MIN_TIMING_SAMPLE` (5) returns; fewer shows what is missing. **Refunded after the deadline** counts withdrawals refunded in the period after their `refund_deadline` (14 days after the confirmation). |
| **Overdue** | Right now (not in the period): withdrawal returns past their refund deadline with no refund recorded and still open. It is the queue's own condition (`OVERDUE_SQL`), so the figure is the queue's count. |
| **By product** | The cohort per product: units returned (accepted lines of counting returns) and their value, against units sold of the same product in the same cohort. The most returned first. A product's rate is shown only from `MIN_PRODUCT_UNITS` (20) units sold, otherwise the units are shown and the rate says why it is not. |

Honesty: the rates need at least `MIN_RATE_ORDERS` (30) cohort orders and `MIN_RATE_UNITS` (30) units sold; below that the card says how many
there were and shows no percentage. A store with **no return recorded at all** shows what is missing ("no return has been recorded in Kaizen yet"),
never 0 %. Returns a shopper made without using Kaizen (a parcel sent back with no withdrawal) are not seen, and the page says so, always. Reasons
are the shopper's own choice (and never asked first for a withdrawal): they describe, they never refuse. The section is for the owner; the AI manager's
`list_returns` and `explain_return` repeat the queue, not these figures.

## Tax reports (D161)

`/admin/{store}/analytics/tax` (`docs/wave-1c-reports.md`): VAT per country and rate, the quarterly OSS and monthly IOSS return data in euro, and a
reconciliation. **These are the owner's own figures for the owner's accountant. They are never a tax return and Kaizen files nothing**; every rule
(where a sale is reported, which date, the euro conversion, corrections) is `needs review: accountant` and lives in one pure function. The reports
read **documents only** (the store's invoices and credit notes, D159) through the one database function `commerce.tax_document_groups()`; an order with
no document is counted and shown on the reconciliation by its cause, never added, and VAT is never recomputed from orders for a report.

| Figure | Definition |
|---|---|
| **Document** | An invoice or a credit note. Copied (`C-...`) and hosts' orders have none, so they are in no report and no reconciliation line. |
| **Tax date** | An invoice's `supply_date` (the payment day in the store's time zone), a credit note's `issued_on`. A period is half open, `[from, to)`, in store days. Finance dates an order by `placed_at`, so the two differ by a named line, not an error. |
| **Delivery country** | `orders.market_code` of the document's order (D109), never the snapshot's address (it is anonymised later). |
| **VAT charged / Net / Gross** | Σ of the invoices' VAT buckets (`snapshot.buckets`, shipping inside the bucket of its own rate) in the document's currency. In the main currency each bucket is converted on its own with the document's **stored** rate (`snapshot.vatMain.fxRate`, the store's rate the day it was issued, `commerce.convert_with`), so an invoice's converted VAT is its stored `vatMain.vatMinor` exactly. A document with no stored rate is **not converted**: counted, left out of the main-currency figures, kept in its own currency. Nothing is converted at today's rate. |
| **VAT credited / after credits** | Σ of the credit notes' buckets (positive amounts in the table, negative in files), converted likewise with the credit note's own stored rate (its invoice's); a credit note's converted VAT can differ from its stored `vatMain.vatMinor` by at most one minor unit per bucket. VAT after credits is charged less credited. |
| **Orders** | Per row the distinct orders with an invoice in the period that have a bucket in the row; the total is the number of distinct orders (not the sum of rows), and likewise a document with two rates is one document. |
| **Where it is reported** | Only `classify()` (`src/lib/tax-classes.ts`): IOSS (the invoice's `vat_kind`), the Union scheme part 2a, 2b or 2d, the non-Union scheme, the national return (a market outside the EU, or a domestic sale), or a named reason it is in no return. A row of the VAT table is one `(country, rate, basis, currency, where it is reported)`, so a row never straddles two returns. The dispatch country is frozen on the order (`orders.vat_treatment.dispatchCountry`); an order without it uses the store's live setting and is counted as assumed. A credit note is classed like its invoice's order. |
| **Return euro amounts** | Taxable amount and VAT in euro per `(period, part, Member State, rate, document currency)`: each summed in the document currency and converted **once** at the ECB reference rate of the period's last day (or of the next publication day), `round_half_up(amount / rate)` in BigInt, kept in `commerce.ecb_reference_rates` (append-only) or the owner's override with its reason. A missing rate makes the return **incomplete**: left out of the totals, counted, and its file refused. A document in euro is not converted. |
| **Books and filing** | *Books*: a credit note counts, negative, in the period it is issued (as Finance counts a refund), no Part 3. *Filing*: a credit note of the same period as its invoice reduces Part 2; a later one is a Part 3 correction of the period of its sale, converted at that period's rate. Part 4 is the balance per Member State (Part 2 plus Part 3, negative = the Member State reimburses it); Part 5 is the sum of the positive balances only. |
| **Reconciliation** | Per document currency, exactly: `report = Finance + timing_in + not_captured - timing_out - invoicing_off - test_mode - waiting - other`, where Finance is `periodTotals().vatMinor`'s source (Σ `tax_minor` of `PAID` orders placed in the period). A bridge that does not balance says **Does not reconcile**. In the main currency each line is converted at today's rates as Finance does, with a named *Rounding* line and a named *Exchange-rate difference* (stored against today's). |
| **Registration** | A warning, never a block, when the sales found do not fit the profile (Union sales with no OSS registration, goods with a non-Union registration, IOSS sales with no number). |

Exports are four fixed CSV layouts (`src/lib/tax-csv.ts`), formula-safe, with no totals row, each written to `commerce.tax_report_exports` with its aggregate
totals so that a later change to a period shows as drift ("changed since you exported this"). Not built, and said on the page: filing, the EC sales list,
national return mapping, the 10,000 EUR threshold watch, booked services in OSS.

The AI manager repeats these figures and makes none (`vat_report` and `oss_return_data`, `src/server/tax-report-tools.ts`): read only, `analytics:read`, each
answer from the functions the page calls with the amounts written by `formatMoney`; a rate that is missing is said as not known, never as zero; every answer
says it is not a tax return. The owner's overview and the store's Home add a not-urgent item when an OSS or IOSS return period has ended, its due date is
within 14 days or passed in the last 45, and no Return data was exported in filing mode (`returnsDue()`, `src/lib/tax-returns-due.ts`; owners only, a registration
with an intermediary or a period with nothing to report is left out): it says the data has not been exported and when it is due, never that a return is late.

## CSV of every table (D165)

Every table and chart data table of the analytics pages has a **Download CSV** button (`ExportButton`, `src/components/admin/analytics/export-scope.tsx`: a
POST form to `/admin/{store}/analytics/export`, never a link, drawn only for a member with `analytics:write`). The file is the table **as the page shows it**
for the period, the comparison and the sort in the address, made by `exportAnalyticsTable()` (`src/server/analytics-export.ts`) from the page's own loaders
(`overviewHead()`, `productsReport()`, `trafficReport()` and the rest, with the arguments the page passes): there is no second query, so a figure cannot differ
from the page's. No figure is defined here that is not defined above; the file adds none.

- **Registry.** `ANALYTICS_TABLES` (`src/lib/analytics-export.ts`) names every exportable table: its id, the page and view that draw it, its columns (a fixed
  English snake_case header, a kind: text, whole number, amount, percentage, decimal, date) and whether it has amounts. `NOT_EXPORTED` lists the tables that are
  deliberately not here, each with its reason: the VAT, OSS and IOSS tables keep the four files of D161. `analytics-export-views.test.ts` scans every view and fails
  for a table or chart with neither an `exportId` in the registry nor `exportable={false}` with a reason in `NOT_EXPORTED`.
- **The columns.** The table's own columns, then `{column}_previous` for each figure the page compares (the comparison's row lined up with the current one, empty where it
  has none), then `currency` (the store's main currency, where the table has amounts), `period_from` and `period_to` (the last day, inclusive), and `previous_from` and
  `previous_to` when the page compares. A table with no period (the stock today, the targets) says the day it was made. A chart's series are its buckets (`bucket`: the
  bucket's first day) and a bar chart is a `label` and a `value`.
- **Amounts** are decimals without VAT in the main currency (`amountCell()`, minor units to a decimal by the currency's own digits, never a float), a share is a
  percentage with two decimals (`42.55`), a figure the page shows as a dash is **empty, never 0**, and there is **no totals row**, so a column sums. The file goes beyond
  the screen's row limits (every product, not the first 50), with the page's own filter and sort.
- **A currency with no rate** is left out as on the page, and counted: the button's label repeats it ("Download CSV: 3 orders in SEK left out, as on this page") and the
  activity-log entry records the count.
- **Who.** `analytics:write`; the top customers (people) and the owner's targets are also the owner's (`OWNER_ONLY_TABLES`). The entry `analytics.table_exported` (table
  id, period, rows, left-out count; never a cell) is written **before** the file is handed back, and with no entry there is no file. Spreadsheet text goes through the one
  writer (`src/lib/csv.ts`), so a product titled `=1+1` is written as text. Defaults: Excel (Nordic), a semicolon and a decimal comma with a byte order mark.
- Orders and customers are not tables of these pages: they are the owner's exports of `docs/wave-2-data.md` 2.3 and 2.4.

## Not tracked (said on the pages)

Refunds made only in Stripe's dashboard; returns made without Kaizen's withdrawal function or return request; subscription expansion, contraction and
reactivation (no status history); regions inside a country (only country and city); revenue after a search (searches are
not tied to a visit); anything before visit counting was switched on.
