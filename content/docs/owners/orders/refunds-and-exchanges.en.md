---
title: Refunds, cancellations and exchanges
summary: Refund all or part of an order to the card or as store credit, cancel an order before it is sent, and swap returned goods for others.
track: owners
section: orders
kind: how-to
areas: [orders, returns, payments]
features: [shop]
plans: []
admin: /admin/{store}/orders/{id}
order: 50
checked: 2026-11-04
sources: [D174, D364, D239, D381, D289, D173]
---

## Refund an order

Open the order. Under **Refund**:

1. Type the **Amount to refund**, or press **Everything left (…)**.
2. Under **Refund to**, keep **The original payment**, or choose **Store credit**.
3. Write a **Reason** if you like. It is for your records.
4. Under **Put back in stock**, give how many of each item go back in stock. With several stock locations, choose where.
5. Keep **Email the customer about the refund** ticked to tell them.
6. Press **Refund**.

A refund to the original payment goes back to the customer's card or payment method through Stripe, and Kaizena Flow's fee on the
refunded amount is returned to you. You can refund in parts, as often as you like, until nothing is left. Each refund that goes through
gets a credit note: see [Invoices and credit notes](/docs/owners/orders/invoices-and-credit-notes).

For goods that come back under a withdrawal or a return, refund from the return instead, as
[Returns and withdrawals](/docs/owners/orders/returns-and-withdrawals) shows: it works out the amount for you.

Orders are part of the online shop, switched on under Settings, Features.

### Store credit

**Store credit** gives the money back as one of your store's gift cards. Its code is emailed to the order's own address and shown to you
once, so you can pass it on if the email does not arrive. It counts as a refund everywhere, its credit note included. Stripe is not
asked, so Kaizena Flow's fee is not returned. See [Gift cards](/docs/owners/marketing/gift-cards) for how customers spend it.

### Items you will not send

If part of a paid order will never be sent, for example because it ran out, refund it with **These units were not sent: take them off
what is still to send** ticked. The units come off what is still to send, so the order no longer waits for them. With nothing to refund,
the same box only closes the units. This is also how you stop the rest of a partly sent order.

### Paid outside Kaizena Flow

When the customer paid you by bank transfer or cash, Kaizena Flow sends no money: pay the customer back yourself, then press **Record
the refund**. Only the owner can record it, unless the owner allows staff under Settings, Orders.

## Cancel an order

A paid order with nothing sent yet can be cancelled. Under **Cancel the order**, write a reason if you like, keep **Email the customer
that the order is cancelled** ticked, and press **Cancel order**. It refunds what is left, puts every item back in stock and stops any
download links.

- **Something is already sent?** It cannot be cancelled: refund the units that are not sent, as above.
- **A change waits for the customer's payment?** Cancel the change first.

### Orders not charged yet

- **Card held, to capture.** When your store charges the card as the order is sent or when you capture it (**Take payment** under
  Settings, Orders), the order shows this card. **Cancel and release** cancels the order and releases the hold: nothing is charged. An
  order not captured before the hold ends is cancelled by itself.
- **A draft's order waiting for payment** is cancelled when you reopen the draft, or when its link runs out. See
  [Draft orders and quotes](/docs/owners/orders/draft-orders-and-quotes).

A cancelled order is never deleted: it keeps its number.

## Exchanges

Instead of money back, a return's credit can pay for other goods. Owners switch on **Offer exchanges** under **Exchanges** in
[Settings, Returns](/admin/{store}/settings/returns). Customers can then ask for one on their return's page, and you can propose one.

1. Open the return. Under **Exchange**, press **Propose an exchange**.
2. **Add a product** to the **Replacements**. You can lower a replacement's price, never raise it.
3. Choose the **Shipping of the new order** and check the **Delivery address**.
4. The summary sets the replacements against the return's credit: a refund due to the customer, an even exchange, or a payment to
   collect.
5. Press **Send to the customer**. They confirm on a page of their own. To send it yourself, press **Create a link to share**.
6. Once confirmed, press **Process the exchange** where you would refund the return. The new order is made with its own number and its
   stock is held. The rest of the credit is refunded at once, or the customer is emailed a link to pay the difference.

Nothing is held or charged before you process it. Until the customer confirms, the return is refunded as usual.

> [!NOTE]
> A withdrawal's exchange goes by email to the order's own address, and only the customer's own confirmation counts. For a return
> request, you may also **Record the customer's agreement** when they agreed by phone, letter or in person.

The original order gets a credit note for the returned items, and the new order its own invoice. Some orders cannot be exchanged, such
as one sold with reverse charge or one holding a subscription or a booking: the return says why, and you refund instead.

## What you owe customers

Store credit and gift cards, like bonus credit, are money you owe until customers use it. Under **Analytics**, **Finance**, the table
**Owed to customers** shows each from the start of a period to its end, and what customers hold now, each currency on its own row. See
[Analytics](/docs/owners/analytics/analytics).

## More options

- **Change the items** of a paid order that is not sent yet, and a lower total is refunded at once: see
  [Find and manage orders](/docs/owners/orders/manage-orders).
- If the refund of such a change fails, the order says what the customer is still owed. The **Fulfilment** filter **Change refund owed**
  on Orders finds them.
- A refund made straight in Stripe is recorded on the order, with its credit note.
