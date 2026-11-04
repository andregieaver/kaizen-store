---
title: Reports, targets and alerts
summary: Open a ready report or build and save your own, download it or have it emailed, set targets and read the forecast, and choose who gets alert emails and the briefing with its one-press actions.
track: owners
section: analytics
kind: how-to
areas: [analytics, settings]
features: [shop]
plans: []
admin: /admin/{store}/analytics/reports
order: 20
checked: 2026-11-04
sources: [D238, D345, D346, D348, D395, D415, D416]
---

## Open a ready report

Open **Analytics** and choose [Reports](/admin/{store}/analytics/reports). Under **Ready reports**, press one: Sales by product,
Sales by variant and SKU, Sales by category, Sales by country, Sales by currency, Sales by payment method, Sales by channel, Sales by
day, New and returning customers, or Discount codes. It opens at once, and you can change it and save it.

The reports you saved are under **Your reports**.

## Build your own report

Press **New report**. Under **Build the report**:

1. **Figures**: up to six of Revenue, Gross sales, Discounts, Refunds, Orders, Units sold, Average order value, Customers, Gross
   profit and VAT.
2. **Cut by**: up to two of Day, Week, Month, Quarter, Product, Variant, Category, Tag, Kind of product, Country, Currency, Channel,
   Device, Discount code, Payment method, or New or returning. **Nothing: one total** gives one row. A cut that does not suit the
   figures you chose says *Not with the figures chosen*.
3. **Only where**: press **Add a filter**, choose what to filter on, and type the values, separated by commas.
4. **Period** and **Compare with**, as on the Overview.
5. **Sort by**, **Rows** (up to 500) and **Show as**: **Table**, **Bars** or **Line**.

Press **Show**. The table ends with a **Total**. With a comparison, each figure also has its *Before*.

> [!NOTE]
> Amounts are paid orders without VAT, in your main currency, worked out as on the analytics pages, so a report's total matches the
> page the figure comes from. When one order or customer can be in several rows, such as an order with two discount codes, the column
> does not add up to its total, and the report says so. Gross profit needs cost prices: with costs for less than 30 % of the sales, it
> is *Not known*.

### Save, share and download

- Under **Save report**, give it a **Name** and press **Save report**. To keep the one you opened as it was, tick **Save as a new
  report** first.
- **Delete report** removes a saved report. It does not touch the figures. A store can keep 200 reports.
- **Download CSV**, under the table, gives you the whole table as a file.
- The report's address holds everything it shows, so you can send the link to someone on your team.

Saving and downloading need a role that can change Analytics.

You can also ask the AI manager for figures in your own words. It answers from the same reports and can save one for you.

## Email a report on a schedule

Open a saved report. Under **Email this report**:

1. **How often**: **Every day**, **Every week** (choose the day under **On**) or **Every month** (choose **On day**, from 1 to 28).
2. **At**: the hour, on your store's clock.
3. **To**: tick who gets it, at most 10. Only people who may read analytics are listed.
4. Keep **Send it** ticked and press **Save schedule**.

Each email has the figures for the report's own period as of the day it is sent: the first 25 rows and the total, with the whole table
attached as a CSV file. Each person gets it in their own admin language. **Stop emailing it** ends the schedule. A store can email up
to 10 reports.

## Targets

### Set a monthly target

Owners set targets in [Analytics settings](/admin/{store}/analytics/settings). Under **Revenue targets**, choose the **Month**, type the
**Net revenue target** and press **Save target**. Net revenue is your sales after discounts and refunds, without VAT. A month that
already has a target gets the new one. **Targets for the next 12 months** lists them, each with **Remove**.

### Targets for orders, conversion and more

Under **Targets for orders, conversion and more**:

1. **What to aim for**: Net sales, Orders, Conversion rate or Average order value.
2. **Period**: **Week** (Monday to Sunday), **Month**, **Quarter** or **Days I choose**, up to two years.
3. **Any day in the period**, or for days you choose, the **First day** and the **Last day**.
4. **Target**, then **Save target**.

The AI manager can set and list targets too.

### Follow a target

On the Overview, **Target for** the current month shows net revenue so far this month against its target, whatever period you picked.
**Targets running now** shows every other target whose period includes today.

- **Net sales and orders** are held against what was expected by today. *Expected by today* follows your usual busy and quiet weekdays
  once there are four weeks of history; until then every day counts alike. The card says **Ahead of pace**, **On pace** or **Behind
  pace**, and where the period ends if the pace holds, as an estimate. In the first three days there is no verdict yet.
- **Average order value** and **conversion rate** are held against the target itself. Average order value needs 10 paid orders before a
  verdict, and conversion 300 visits. Conversion is not known unless visits were counted on every day of the period.

### The forecast

**Forecast for** the current month, on the Overview, shows where the month's net revenue is heading if the pace of the last weeks
holds, with a likely range. It uses the last eight weeks, your usual weekdays and, once there is a year of history, last year's
pattern. It forecasts the month's paid orders the same way. A steady rise or fall is not extended, and it always says it is an
estimate. With fewer than 14 days of sales, it says there is too little history. With a monthly target, it says whether the range
reaches it.

## Alerts

**Needs you today**, on the Overview, lists what the analytics found, most urgent first. Each is marked **Urgent**, **Needs a look**,
**Good to know** or **Good news**:

- conversion falling, revenue so far today far under a usual day of the same weekday (judged from 20:00), refunds on a product running
  at over twice their usual rate, a new customer costing more in a channel, stock running out within a week, more checkouts left
  unfinished, the share of orders with a discount rising month after month, the month's target at risk, and product costs missing;
- the good news: yesterday was the best day in 90 days, or returning customers brought in more than in any of the last 12 months.

Each kind needs enough orders or visits first, so a few sales do not raise an alert. The link beside an alert opens where to look.
**The figures behind it** shows what it is worked out from.

Beside some alerts there is one more step, with the work prepared:

- **Prepare reorder**, for stock running out: a purchase order filled in from your recent sales.
- **Create campaign**, for returning customers at a high: a marketing email from the thank-you template.
- **Ask the AI manager**: the AI manager opens with the alert's words and figures as your question. It asks for a next step, and to
  keep any change for your yes.

A purchase order is saved, or a campaign sent, only when you press that page's own button.

### Alerts by email

Owners choose who gets them, under **Settings**, **Notifications**, [Staff alerts](/admin/{store}/settings/notifications/staff):

1. In **Who is emailed**, tick **Analytics alerts** for each person. The box is offered only where the person's role may read
   analytics.
2. Under **Analytics alerts by email**, choose **Only what is urgent**, **Urgent and warnings** or **Everything but good news**.
3. Press **Save**.

Alerts are emailed once a day, after 20:00 in your store's time, each alert once a day, with the same minimums as the page. Good news
is never emailed. Nobody gets them until you tick them.

## The briefing

The briefing is a daily or weekly email about your store. Your home page offers it once to an owner, under **Get a briefing by
email**: press **Weekly** or **Daily**, or **Not now**.

To choose who gets it and when, open [Staff alerts](/admin/{store}/settings/notifications/staff). Under **Briefing**, choose **How
often**: **Off**, **Daily (yesterday)** or **Weekly (the last seven days)**, then the **Day** for a weekly one and the **Hour**, on your
store's clock. Tick **Briefing** for each person, and press **Save**.

It holds:

- paid orders, net sales and refunds without VAT, and **Profit before fixed costs, excl. VAT**, each beside the period before. Profit is
  marked *estimated* where it rests on estimates, and left out while too few sales have a cost price;
- returns requested and open, orders to send, variants at or below their stock level and conversations waiting in support;
- what the analytics found, what the store checkup found, and your targets;
- a note written by AI from those facts, when your store has an AI text model. It states no figure: check before you act.

A quiet period, with no paid order and no alert, sends nothing.

Each finding links to the page that acts on it. Where there is one, it has the same next step as on the Overview: **Prepare
reorder**, **Create campaign** or **Ask the AI manager**, which opens your home page with the AI manager. No purchase order is saved and
no campaign is sent from the email itself.

Other staff emails, such as new orders and low stock, are chosen on the same page: see
[notifications](/docs/owners/team-and-settings/notifications).
