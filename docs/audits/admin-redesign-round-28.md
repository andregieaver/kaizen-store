# Admin redesign, round 28: Pages, customer analytics and finance on a phone

Decision D701, 16 November 2026. The boards are on the design canvas of round 28. After rounds 26 and 27 I measured all 270 store pages on
a phone again. The tallest were:

| Page | Height |
|---|---|
| Pages | 6,417 px |
| Analytics → Customers | 5,875 px |
| Analytics → Finance | 5,800 px |
| Analytics → Marketing | 5,105 px |

Marketing is the same kind of report as Customers and Finance, so it is the next to take the same rows. Everything below is below 640 px
wide; from 640 px each page is as before.

## Pages (`PageCards`: a store's pages and its blog's articles)

- **On a phone, one line per page:**
  - a 44 px square, showing the page's picture where it has one, else a plain one
  - the title, with what the page is to the shop
  - its state chip and day
  - the ··· menu

  The lines are one card. The *New page* tile waits for wider screens, since *New page* is already in the header.
- **A search, *Find a page*,** appears above the list once there are more than eight pages. It matches the title or address. With nothing
  found it says *No page matches.*
- **Platform:** the blog's article list uses the same cards, so it gets the lines too. Kaizena Flow's own pages use `PagesTable`, which is
  already one line per page.

## Customer analytics (`CustomersView`)

- **One card of three answers:**
  - customers in the period (*all new*, or how many came back)
  - orders each a year
  - spent each so far

  At a glance's three cards wait for wider screens.
- **Each question is a row with its answer:**
  - New and returning (*16 new · 0 returning*)
  - Do customers buy again? (*Too soon: nobody has been here 30 days*, or the first rate)
  - What a customer is worth (*4 370 kr over 3 years, predicted*)
  - Customer groups (*From 20 customers · 16 so far*, or how many groups)
  - Do new customers stay? (how many months of customers)
- **Top customers:**
  - the first three by name, with what they spent and their orders, each opening the customer
  - then *All 16 customers*, which opens the table
- **The page's long line** waits for wider screens.
- **Old links still open their row:** `#cust-repeat` and the others.

## Finance (`FinanceView` and the finance page)

- **The answer first:** *44 paid orders brought in NOK 23,304.00 after refunds.*
- **One amber strip** where the coverage warning and the cards' *Needs product costs* were: *Profit needs what your products cost. 15
  have none yet.*, with *Add costs*.
- **Three figures:** net revenue, VAT collected and refunds. On a phone they stand in for the four cards and the VAT and refunds section.
- **The rest, as rows:**
  - From gross sales to operating profit (*Gross sales …*)
  - Where net revenue went (the bars and the chart per day)
  - How these are worked out
  - Profit by order (how many orders)
  - Payments by method (*Recorded by staff: Bank transfer 29*)
  - Invoices on payment terms, Owed to customers and Gift cards, when they have anything
- **The page's long line** waits for wider screens.

## How this differs from the boards

- **Pages:** *New page* stays in the header's row with More and Create with AI. The line above the list is the header's own (*12 pages
  are live. Your shop opens on Forside.*).
- **Customers:** the three answers are customers, orders a year and spent so far, as drawn.
- **Finance:** the line about nothing to compare with stays a warning above, as before, rather than joining the answer.
- **Finance:** the statement's row says gross sales only.

## Tests

- `customers-view.test.ts` counts the phone's heading over the top customers.
- The other tests and specs run at desktop width, where nothing moved.
