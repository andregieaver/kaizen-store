---
title: Draft orders and quotes
summary: Make an order for a customer and send them a link to pay, record a payment taken another way, and answer shoppers' requests for a quote.
track: owners
section: orders
kind: how-to
areas: [orders, quotes, payments]
features: [shop]
plans: []
admin: /admin/{store}/orders/drafts
order: 30
checked: 2026-11-04
sources: [D173, D431, D435, D437]
---

## Make a draft order

A draft is an order you make for a customer, for a sale on the phone, by email or in person. Draft orders are part of the online shop,
switched on under Settings, Features.

1. On **Orders**, press **Make a draft order**.
2. Choose the **Country**, **Language** and **Currency** it is for, and press **Start the draft**. They decide the prices, the VAT, the
   shipping rate and the language of the customer's page and emails.
3. Under **Customer**, **Find a customer** by name or email, or type the **Email**. Add a **Shipping address** for goods.
4. Under **Lines**, **Add a product** by title or SKU, or **Add a custom item** for something that is not in the catalogue. Type a
   **Price each** to give your own price.
5. If you like, give a **Discount**, a percent or an amount with a name the buyer sees, and choose the **Shipping**: the market's rate,
   **Free shipping** or **A price I set**.
6. Press **Save draft**. The **Summary** shows the total with VAT, worked out by the checkout's own rules.

A draft holds no stock and takes no order number until you send it. Find your drafts under
[Draft orders](/admin/{store}/orders/drafts).

## Send it to the customer

Under **Send it**, choose how many days **The link is valid for**, from 1 to 30, and press **Send to the customer**. The customer gets an
email with a link to a page that shows the order and a button to pay on Stripe's page. To send the link yourself, press **Create a link
to share** instead: it is shown only once, so copy it.

Sending makes the order, takes its number and holds its stock until the link ends. When the customer pays, it is an ordinary order.

- **The link ran out unpaid?** The order is cancelled and its stock released; the number stays on the cancelled order.
- **Need to change a sent draft?** Press **Reopen to edit**. Its order is cancelled and the link stops working. Sending again makes a new
  order with a new number.

The days start at what you set under **Draft orders** in [Settings, Orders](/admin/{store}/settings/orders): 7 unless you change
it.

## Paid another way

If the customer paid you by bank transfer, in cash or another way, press **Mark as paid outside Kaizena Flow**. Choose **How was it
paid?**, the day it was **Received on** (at most 31 days back) and a **Reference** if you like, and press **Record the payment**.

The order is made and paid, its invoice says it was paid outside the online checkout, and the confirmation is emailed to the customer.
Kaizena Flow did not take the money and takes no sale fee on it. This cannot be undone: a mistake is corrected with a refund.

> [!IMPORTANT]
> Cash taken when goods are handed over is a cash sale under the cash register rules in many countries, and some countries cap how much
> cash a business may take. Record cash here only if your accountant says it is allowed.

Only the owner can record a payment taken another way, unless the owner lets staff do it under **Money taken outside Kaizena Flow** in
Settings, Orders.

## Requests for a quote

### Let shoppers ask

Under **Request a quote** in [Settings, Orders](/admin/{store}/settings/orders), choose who may ask: **Off** (the default), **For
everyone** or **For business customers only**. Where quotes are offered, product pages show **Request a quote**, and the cart shows
**Request a quote for these items** when everything in it is goods sent by post and bought once.

A product you mark **Price on request** in its editor shows no price anywhere and offers only a quote, whatever this setting. See
[Prices](/docs/owners/products/prices).

The shopper gives their name and email, and if they like a phone number, a company and a message. They get an email that their request
came in.

### Answer a request

Each request becomes a draft marked **Quote requested**, and staff who get new-order emails are told. On Draft orders, the filter
**Quote requests** shows them.

1. Open the request. The **Quote requested** panel shows **Their note** and **Their company**, as they typed them. To invoice the
   company, add it with its organisation number under **Billing address and company**.
2. Check the lines. A product priced on request starts with no price: type the price for this customer. Its list price is only your
   guide. The quote cannot be sent until every line has a price.
3. Press **Send quote**. The customer gets an email with their quote and a link. The page it opens is worded as their quote, and its
   button reads **Accept and pay**.

When they pay, the quote is accepted and the order is made, as with any draft.

### Decline a request

Press **Decline the request**, write **Your reply to the customer** and press **Decline and send the reply**. The customer is emailed
your reply. The request can no longer be sent, and it is deleted 30 days later.

> [!TIP]
> The [AI manager](/docs/owners/ai/the-ai-manager) can list the requests that wait, type their prices and decline one with a short reply.
> It sends a quote or a reply only when you say yes.

## What a draft does not do

- Campaigns, discount codes, bonus credits and VAT-number checks do not apply: the prices and the discount are the ones you set. A draft
  never uses reverse charge.
- A custom item cannot be sold to a private customer yet. Make the draft for a business, with a company name and an organisation number,
  or add the service as a product.
- The shipping address must be in the market's country.
- Downloads, subscriptions and bookings cannot be on a draft.
- A draft holds up to 100 lines, and a store has up to 500 open drafts.
