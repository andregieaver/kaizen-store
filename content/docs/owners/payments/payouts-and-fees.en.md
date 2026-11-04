---
title: Payouts and fees
summary: See what Stripe paid to your bank, what each payout settles and whether it adds up, and what Stripe and Kaizena Flow take from each sale.
track: owners
section: payments
kind: how-to
areas: [payments, analytics]
features: []
plans: []
admin: /admin/{store}/analytics/payouts
order: 30
checked: 2026-11-04
sources: [D17, D288, D289, D290]
---

## How the money reaches you

Shoppers pay into your store's own Stripe account. Stripe's fee and Kaizena Flow's fee are taken from each payment, and Stripe pays the
rest out to your bank, on its own schedule. Each transfer to your bank is a payout. The bank account is the one you gave Stripe when you
[set up payments](/docs/owners/payments/set-up-payments); you change it under **Business and bank details** on Payments.

## See your payouts

Open **Analytics** in the menu and choose [Payouts](/admin/{store}/analytics/payouts). Choose the period at the top. Each payout that
arrives in the period has a row:

- **Arrives**: the day it reaches your bank.
- **Status**: *Pending*, *On its way*, *Paid*, *Failed* or *Cancelled*.
- **Amount** and **Stripe's fees**.
- **Settles**: what is in it, such as payments, refunds and disputes.
- **Reconciliation**: whether it adds up to your orders.

Each payout is in its own currency, as Stripe paid it; the totals are the paid payouts in your store's main currency. Test payouts are
listed but left out of the totals. A payout appears once Stripe reports it, so a new one can take a little while to show.

**Download CSV** gives the period's payouts as a file for your bookkeeping.

### Does it add up?

The **Reconciliation** column says, for each payout:

- *Adds up*: the payments, refunds, disputes and fees in it come to what reached your bank.
- *Does not add up*, and by how much.
- *Money not tied to an order*: a payment taken in Stripe directly, or one Kaizena Flow has no record of.
- *Manual payout*: made by hand in Stripe, which does not list what it settles.
- *Not read yet*: what it settles is read once it is paid. Check back later.
- *Too many lines to read*: Stripe's own payout report has them all.

When a payout does not add up, a note under the list says so. Open it to see the lines.

### One payout

Press a payout's date under **Arrives** to see what it settles, line by line: each **Payment**, **Refund**, **Dispute**, **Stripe fee** or **Adjustment**, with
the order it is for, its **Gross**, **Fee** and **Net**, and Stripe's reference. A line that could not be tied to an order says so.

## The fees

### Stripe's fee

Stripe sets its own price for each payment. Kaizena Flow reads the fee Stripe actually took for each payment.

Analytics, [Finance](/admin/{store}/analytics/finance) shows **Payment fees** for the period. For each order whose payments all have their
fee from Stripe, it is that fee. For the rest it is your own estimate, from **Payment fee, percent of each order** and **Payment fee,
fixed amount per order** in [Analytics settings](/admin/{store}/analytics/settings), and the line then reads *Payment fees (estimated)*.
With no estimate entered, those orders count as no fee.

### Kaizena Flow's fee

Kaizena Flow takes a fee on each sale: a share of what the shopper pays, taken from the payment when the shopper pays. How large it is
depends on your plan. **Billing** shows it as **Kaizena Flow's fee**, and each plan's card shows its own; see
[Choose a plan](/docs/owners/getting-started/choose-a-plan).

You see what Kaizena Flow took as **Platform fees** on Finance, and as **Kaizena Flow's fee** on an order's **Profit** card.

- On a payout, the **Fee** of a line and the payout's **Stripe's fees** include Kaizena Flow's fee as well as Stripe's.
- When you capture less than a held card holds, Kaizena Flow's fee is taken on what you capture.
- A payment you record as taken outside Kaizena Flow, such as a bank transfer or cash, has no fee: Kaizena Flow did not touch the money.
- On a Mollie payment, Kaizena Flow's fee is not given back when you refund it.

## More options

### Payments by method

Finance also has **Payments by method**: what the period's paid orders were paid with, the number of payments, the money received with
VAT, refunds and fees, and a CSV file. A note says when a payment's method is not known yet: Kaizena Flow reads it from Stripe shortly
after the payment.

### Lost disputes

A dispute the bank decides against you is money out, shown on Finance as **Lost disputes**. See
[Disputes and risky payments](/docs/owners/payments/disputes-and-risk).
