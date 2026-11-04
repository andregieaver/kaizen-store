---
title: See how your store is doing
summary: Read the Overview for any period, watch the store live, follow profit on Finance and on each order, look deeper at customers, products, stock, marketing, traffic and speed, and give profit what it needs.
track: owners
section: analytics
kind: how-to
areas: [analytics, settings]
features: [shop]
plans: []
admin: /admin/{store}/analytics
order: 10
checked: 2026-11-04
sources: [D152, D178, D336, D347, D415]
---

## Open the Overview

Open **Analytics** in the menu. The [Overview](/admin/{store}/analytics) answers three questions: are you making money, why are
sales moving, and is there anything to do today? Each figure links to the page that explains it.

Every amount is in your store's main currency without VAT. Every figure is worked out from your own orders, never guessed. A figure
that cannot be known is never shown as 0: it says what is missing and how to add it.

### Choose the period

At the top, press **Today**, **Yesterday**, **Last 7 days**, **Last 30 days**, **This month**, **Previous month** or **This year**. For
other days, fill in **From** and **To** and press **Apply range**.

Under **Compare with**, choose **Previous period**, **Same period last year** or **No comparison**, and press **Update**. Each figure
then shows how much it went up or down. The period is kept in the page's address, so a link opens the same view.

### What the Overview shows

From the top:

- **Needs you today**: what is worth a look now, most urgent first. See
  [alerts](/docs/owners/analytics/reports-targets-and-alerts).
- **Are we making money?**: twelve figures. Revenue, Net revenue, Orders, Conversion rate, Average order value, Gross profit, Gross
  margin, New customers, Returning customers, Refund rate, Visits and Revenue per visitor.
- **Why did sales change?**: the change in revenue split into traffic, conversion and average order, the place that moved most (a
  device, a channel, a country or a product) and where to look next. With few orders it says the change may be chance.
- **Sales and profit over time**: net revenue and contribution profit by day, week or month. The dashed line is the comparison.
- **From visit to purchase**: how many visitors look at a product, add to the cart, reach checkout and buy.
- **Best sellers**: the five products that brought in the most, and the five that left the most after their cost.
- **Where sales come from**: the channels that brought in the most revenue.
- **Target** and **Forecast** for the month: see [targets](/docs/owners/analytics/reports-targets-and-alerts).

Every chart has a **Data table** with its figures. Your home page shows the top three items of **Needs you today** under **Worth a look
in Analytics**, with **See all**.

> [!NOTE]
> **Revenue** is paid orders without VAT, after discounts, with shipping income. Refunds are not taken off here. **Net revenue** is
> revenue less the refunds made in the period. Unpaid orders are not counted.

## See what is happening now

[Live](/admin/{store}/analytics/live) reads its figures again every 10 seconds while the page is open:

- **Visitors now**: visitors who opened a page in the last 5 minutes, and **Where visitors are now**, by country.
- **Visits today**.
- **Orders today** and **Revenue today**: paid orders since midnight in the store's time zone, and their revenue without VAT.
- **Carts in use**: carts with something in them that changed in the last 30 minutes.
- **Checkouts in progress**: orders waiting for payment, placed in the last 30 minutes.

The visitor figures need [visit counting](#count-visits). While it is off, they say so instead of showing 0.

## Profit

### Give profit your costs

Profit needs to know what your goods cost you. In the product editor, each variant has **Cost per unit**, in your main currency and
without VAT. The cost is kept on each order line when it sells, so changing it later never rewrites earlier sales.

- **Costs for every sale**: profit is exact.
- **Costs for 30 % of sales or more**: profit is estimated from those sales, and every figure says how much of your sales it is based on.
- **Costs for less than 30 %**: no profit is shown. The page asks you to add the missing costs.

### Finance

[Finance](/admin/{store}/analytics/finance) goes step by step from **Gross sales** to what is left: discounts, shipping income,
refunds, the cost of goods sold, payment fees, platform fees, shipping costs, marketing and lost disputes give **Contribution profit**,
and your fixed costs then give **Operating profit (estimate)**. A line that rests on your own estimates says so. Payment fees are
Stripe's own where Stripe reported them, otherwise your estimate.

Finance also shows **Payments by method**, with VAT, as the money moved. What Stripe paid to your bank is on Payouts, described in
[payouts and fees](/docs/owners/payments/payouts-and-fees). The VAT reports are described in [OSS and IOSS](/docs/owners/markets-and-tax/oss-and-ioss).

### Profit on each order

**Profit by order**, on Finance, lists the period's orders with their average profit, how many lost money and how many wait for a cost
price. **Least profitable orders** links to each of the ten worst.

Each order's own page has a **Profit** card: what the order left you after the cost of the goods, the payment fee, Kaizena Flow's fee
and sending, before ads and fixed costs. Sending is a booked label's own price where it is known, otherwise your estimate. **How it
adds up** shows each line. If an item has no cost price, the profit is not known yet, and **Add cost prices** takes you there.

## Look deeper

These pages have the Overview's period and comparison, except Inventory, which is always as of now.

| Page | What it shows |
|---|---|
| [Customers](/admin/{store}/analytics/customers) | New and returning customers, repeat purchases, lifetime value, groups (VIP, Loyal, Promising, New, At risk, Lost) and cohorts |
| [Products](/admin/{store}/analytics/products) | What sells, what earns, what is refunded, and each product's share of your sales |
| [Inventory](/admin/{store}/analytics/inventory) | Stock and its value, how many days it lasts, what is about to run out and what has not sold for 90 days |
| [Marketing](/admin/{store}/analytics/marketing) | Channels with their visits, orders, revenue, conversion, cost to win a customer (CAC) and return on ad spend (ROAS); ad spend; discounts and coupons; campaigns |
| [Subscriptions](/admin/{store}/analytics/subscriptions) | Monthly recurring revenue and how it moves, churn and failed renewals, while Subscriptions is switched on |
| [Traffic](/admin/{store}/analytics/traffic) | The way from visit to purchase, devices, countries and cities, searches, sales by weekday and hour, and refunds and returns at the bottom |

**Ad spend**, on Marketing, is where you enter what you paid for ads: **Day**, **Channel**, **Campaign (optional)**, **Amount** without
VAT and **Note (optional)**, then **Add spend**. CAC and ROAS come only from what you enter. One amount is kept for each day, channel
and campaign: entering it again replaces it.

Tables have **Download CSV** for people whose role can change Analytics.

## Count visits

Visits, conversion, the funnel, channels, devices and speed need visit counting. It is off until an owner switches it on: open
[Analytics settings](/admin/{store}/analytics/settings) and, under **Visit counting**, press **Turn on visit counting**.

What it counts, as the page says:

- One line per visitor per day, with no name, contact detail, IP address or browser details on it.
- No cookies, and nothing stored in the visitor's browser, so it shows no cookie banner.
- The visitor is a hashed id made with a key that changes every day, so they cannot be followed from one day to the next. It is not
  random: the same visitor keeps the same id for the rest of that day.
- Bots are not counted, and neither are visitors whose browser sends Global Privacy Control or Do Not Track.
- When something is added to the cart that day, the visit is tied to that cart and to the order made from it. That is how a sale gets
  its channel and device.

> [!IMPORTANT]
> While counting is on, your store's cookie page describes it in each of your languages. Mention it in your privacy policy too,
> including that a visit is tied to a cart and its order: that text is yours to write.

Counting starts the day you switch it on, and earlier days cannot be filled in. Counted visits are deleted after 25 months. A count is
not tamper-proof, so look at a sudden jump before you trust it.

## Speed

[Speed](/admin/{store}/analytics/speed) shows how fast your pages load for the people who open them, measured in their browsers while
visits are counted. For the front page, product pages, category and tag pages, lists and other pages, on phones and on computers, it
gives four figures as Google defines them: Largest Contentful Paint, Interaction to Next Paint, Cumulative Layout Shift and Time to
First Byte. Three in four page loads of the last 28 days were as fast as the figure, or faster. Each is rated **Good**, **Needs
improvement** or **Poor**.

A figure needs 20 page loads. With fewer, the page says how many there are. **What to look at first** says what usually slows a
figure and where to change it. The cart, checkout and order pages are never measured.

## More options

### Analytics settings

Only owners open [Analytics settings](/admin/{store}/analytics/settings). Besides visit counting and
[targets](/docs/owners/analytics/reports-targets-and-alerts), it has:

- **What your products cost**: how many variants on sale have a cost, with a link to your products. **Apply costs to earlier orders**
  gives order lines sold before their variant had a cost the cost it has today. It is done once, with today's costs, and cannot be
  undone in one step. A line that already has a cost is never changed.
- **Fees and costs we cannot see**: **Payment fee, percent of each order**, **Payment fee, fixed amount per order**, **Shipping cost
  per order** and **Fixed costs per month**, then **Save estimates**. They are used only in the profit figures, which say they are
  estimated, and they never change an order. What Kaizena Flow takes on each sale is known exactly and needs no entry.
- **Customer lifetime**: **Years a customer keeps buying**, between 1 and 10, for the predicted lifetime value. Until you set it, 3
  years is used.

### Who sees what

A team member's role needs Analytics *Can view* to open these pages, and *Can change* to download CSV files. See
[staff and permissions](/docs/owners/team-and-settings/staff-and-permissions).

The sales pages are part of the online shop. With the shop switched off under **Settings**, **Features**, only Traffic, Speed and
Analytics settings are left.
