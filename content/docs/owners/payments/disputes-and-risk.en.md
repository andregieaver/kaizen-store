---
title: Disputes and risky payments
summary: See how an order was paid and when Stripe rates it risky, hold risky orders before they are sent, and answer a dispute with evidence drafted from the order.
track: owners
section: payments
kind: how-to
areas: [payments, orders, customers]
features: []
plans: []
admin: /admin/{store}/orders
order: 40
checked: 2026-11-04
sources: [D288, D417]
---

## How an order was paid

Each order's **Payment** card shows how it was paid, as Stripe reported it: the method, and for a card its brand and any wallet. Kaizena
Flow reads it from Stripe shortly after the payment; until then the card says *Unknown (not read from Stripe yet)*. Nothing is guessed.
Payments through Mollie have none of these details.

## Payments Stripe rates as risky

Stripe rates the risk of each card payment. Kaizena Flow shows it only when it is raised:

- the order's **Payment** card says *Stripe: elevated risk* or *Stripe: highest risk*, with Stripe's score out of 100;
- the **Orders** list marks the order *Elevated risk* or *Highest risk*;
- under **Payment** in the list's filters, *Elevated risk (Stripe)* shows only those orders.

Look at such an order before you send it.

### Hold risky orders automatically

1. Open **Settings**, choose [Automation](/admin/{store}/settings/automation) under Selling, and press **New rule**.
2. Add the condition **Stripe's risk is**, with *Elevated or highest* or *Highest*.
3. Add the action **Hold fulfilment**, write why it is held, and save the rule.

A held order cannot be sent or handed over until someone presses **Release** on its page. The rule reads Stripe's risk before it
decides, and an order whose risk is not known does not match.

## When a payment is disputed

A dispute, or chargeback, is a customer asking their bank to take back a payment. Stripe holds the amount until the bank decides.

- You are emailed when a dispute opens, and again three days before its deadline. The owners get these emails unless you choose
  others under Settings, Notifications, [Staff alerts](/admin/{store}/settings/notifications/staff).
- The order is marked *Disputed* in the Orders list, and *Disputed* under **Payment** in the filters finds every one.
- The order's **Payment** card shows the dispute's reason, its status and **Evidence due**, with **Open in Stripe**.

The status is *Needs a response*, *Under review*, *Won*, *Lost* or *Prevented*. A bank's inquiry before a dispute reads *Inquiry: needs
a response*.

> [!WARNING]
> Without evidence the dispute is lost. Answer before the day shown under **Evidence due**.

## Answer with the chargeback assistant

1. On the order's **Payment** card, press **Prepare the evidence**. **Answer the dispute** opens.
2. Kaizena Flow has drafted Stripe's evidence fields from the order: who bought and the addresses, what was bought, the parcels with
   their carrier and tracking, how it was delivered, the terms accepted at checkout, the return window, refunds made, the customer's
   earlier orders and disputes, and their messages to you. A field with nothing behind it stays empty.
3. The fields a bank looks at first for this dispute's reason come first. **Everything else Stripe takes** holds the rest.
4. Read each field, change what is not right, and add what only you know. **Why no refund was due** is always yours to write.
   **The order's story** goes to the bank as written, so write it in English.
5. Press **Save draft** at any time.
6. When it is right, tick *I have read this evidence and it is true. Once sent it cannot be changed.* and press **Send to Stripe**.

The bank decides, and the outcome shows on the order when Stripe tells Kaizena Flow.

> [!IMPORTANT]
> Stripe takes one answer per dispute, and it is final. Files such as a receipt or a signature are added in your Stripe Dashboard:
> use **Open in Stripe** on the order.

Good to know:

- Evidence is sent only by a person pressing **Send to Stripe**, never by the AI manager or the autopilot.
- Everyone who can read orders can open the page; only staff who can change orders can send.
- A chargeback through Mollie is answered in your Mollie Dashboard.
- A dispute in test mode sends what you write to Stripe's test mode.

## If the dispute is lost

A lost dispute is money out. [Finance](/admin/{store}/analytics/finance) shows it as **Lost disputes** in the period it closed, without
VAT and with Stripe's dispute fee where it is known, and the order's **Profit** card shows a *Lost dispute* line. It is not a refund: no
credit note is issued and nothing goes back in stock.

## Customers who return a lot

A customer whose paid orders in the last year include at least three with a return or a refund, making at least half of those orders,
gets a *Returns often* chip, with how many: on their orders, subscriptions and wishlists, on their customer page and on the evidence page.
